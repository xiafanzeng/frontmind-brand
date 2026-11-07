import {readPreviewAssets} from "./preview-assets";
import {saveResponseLogicSchema,type ResponseLogicRecordDto,type ResponseLogicStructuredDraft} from "../module/contracts/response-logic";
import {fingerprintLogic,createResponseLogicRuleEvaluation,RULE_EVALUATION_VERSION} from "../module/contracts/response-logic-evaluation";
import {judgeEvaluationEnvelopeSchema,type JudgeOutput} from "../module/contracts/response-logic-judge";
import {optimizationEnvelopeSchema,type OptimizationOutput} from "../module/contracts/response-logic-optimization";
import {buildOptimizationReview} from "../module/contracts/response-logic-change-review";
import {createIntentPreviewApi} from "./intent-preview";

type Task={id:string;kind:string;questionId:string;revision:number;fingerprint:string;startedAt:number;judgeTaskId?:string;draft:ResponseLogicStructuredDraft};
type Store={records:ResponseLogicRecordDto[];tasks:Task[];publications:Record<string,ResponseLogicRecordDto>};
export class PreviewHttpError extends Error {constructor(message:string,readonly status=400,readonly code="PREVIEW_REQUEST_INVALID"){super(message);}}
const draftFor=(question:string):ResponseLogicStructuredDraft=>({
  concern:`用户希望了解“${question}”的选择条件、信息依据和适用范围。`,
  conclusion:`针对“${question}”，建议先确认需求，再比较服务范围、资质和费用信息。\n1. 明确需求与适用条件。\n2. 对照公开资料核验信息。\n3. 与服务方确认后续安排。`,
  facts:"本地示例知识库：机构资质、服务介绍和项目流程。以上为合成材料，用于页面交互预览，具体信息以核验后的资料为准。",
  boundaries:"不得作出无依据排名或效果保证；涉及价格、周期与适用范围，须说明前提，并以正式确认信息为准。",
});
function judgeFor(draft:ResponseLogicStructuredDraft):JudgeOutput{
  const finding={severity:"improve" as const,evidence:draft.conclusion.slice(0,50),evidenceSource:"draft" as const,evidenceConfidence:"partial" as const,
    reason:"示例应答已经覆盖基本流程，具体判断条件仍可补充。",suggestion:"补充逐项确认条件与资料来源。"};
  return {kind:"judge-evaluation",overallAssessment:"本地 mock 四维评估：用于预览评估详情与后续优化流程。",dimensions:{
    relevance:{score:78,band:"mostly_relevant",findings:[finding]},
    completeness:{score:72,coverage:(["concern","conclusion","facts","boundaries"] as const).map(field=>({field,status:"covered",findings:[]})),findings:[]},
    actionability:{score:74,subMetrics:(["content_specificity","evidence_guidance","structure_guidance"] as const).map(key=>({key,score:74,band:"mostly_actionable",findings:[finding]})),findings:[]},
    boundaryRisk:{score:86,risks:(["unverified_ranking","absolute_claim","effect_promise","unverified_comparison","unsupported_fact","missing_precondition"] as const).map(key=>({key,status:"controlled",findings:[]})),findings:[]},
  }};
}
export async function responseLogicPreview(scope:string,path:string,url:URL,method:string,input:any):Promise<unknown>{
  const key=`frontmind:response-logic-preview:v1:${scope}`;
  const store:Store=JSON.parse(localStorage.getItem(key)??'{"records":[],"tasks":[],"publications":{}}');
  const persist=()=>localStorage.setItem(key,JSON.stringify(store));
  const questionId=input.questionId??url.searchParams.get("questionId");
  const record=store.records.find(item=>item.questionId===questionId);
  const requireRecord=()=>{if(!record)throw new PreviewHttpError("请先保存应答逻辑",404);return record;};
  const checkRevision=(revision:unknown)=>{const current=requireRecord();if(revision!==undefined&&Number(revision)!==current.revision)throw new PreviewHttpError("应答逻辑已更新，请重新读取",409,"RESPONSE_LOGIC_REVISION_CONFLICT");return current;};
  if(path===""&&method==="GET")return {records:store.records};
  if(path==="/question-context"){
    const data=await createIntentPreviewApi(scope).observe();
    const question=data.state.questions.find(item=>item.id===questionId);
    if(!question)throw new PreviewHttpError("当前问题不存在",404);
    return {questionId,question:question.question,intent:"",workspaceRevision:data.revision};
  }
  if(path===""&&method==="POST"){
    const value=saveResponseLogicSchema.parse(input);
    if(value.publicationRequestId&&store.publications[value.publicationRequestId])return {record:store.publications[value.publicationRequestId]};
    if(value.expectedRevision!==(record?.revision??0))throw new PreviewHttpError("应答逻辑已更新，请重新读取",409,"RESPONSE_LOGIC_REVISION_CONFLICT");
    if(record&&!value.publish&&Object.keys(value.draft).every(field=>JSON.stringify(value.draft[field as keyof typeof value.draft])===JSON.stringify(record.draft[field as keyof typeof record.draft]))&&["question","intent","summary","groupId","groupTitle","conversationId"].every(field=>(value[field as keyof typeof value]===undefined||value[field as keyof typeof value]===record[field as keyof typeof record])))return {record};
    const next:ResponseLogicRecordDto={...record,...value,id:record?.id??crypto.randomUUID(),revision:(record?.revision??0)+1,version:record?.version??0,createdAt:record?.createdAt??Date.now(),updatedAt:Date.now()};
    if(value.publish){next.version++;next.confirmed={...value.draft,version:next.version,updatedAt:new Date().toISOString()};}
    store.records=store.records.filter(item=>item.questionId!==questionId).concat(next);
    if(value.publicationRequestId)store.publications[value.publicationRequestId]=next;
    persist();return {record:next};
  }
  if((path==="/start"||["/evaluation/judge","/optimization","/regeneration"].includes(path))&&method==="POST"){
    const current=checkRevision(input.expectedRevision??input.operationRevision);
    const kind=path==="/start"?"generation":path==="/evaluation/judge"?"judge":path.slice(1);
    const task:Task={id:crypto.randomUUID(),kind,questionId:current.questionId,revision:current.revision,fingerprint:fingerprintLogic(current.draft),startedAt:Date.now(),
      draft:kind==="generation"||kind==="regeneration"?draftFor(current.question):{concern:current.draft.concern,conclusion:current.draft.conclusion,facts:current.draft.facts,boundaries:current.draft.boundaries},judgeTaskId:input.judgeTaskId};
    store.tasks.push(task);
    if(kind==="generation")current.lastTaskId=task.id;
    persist();
    return kind==="generation"?{task:{id:task.id,operationRevision:task.revision}}:kind==="regeneration"?{taskId:task.id,attempt:0,recordRevision:task.revision}:{taskId:task.id,attempt:0,recordRevision:task.revision,sourceFingerprint:task.fingerprint,knowledgeFingerprint:"local-mock",...(kind==="optimization"?{judgeTaskId:task.judgeTaskId}:{})};
  }
  if(path.endsWith("/recovery")){
    const current=requireRecord();
    const kind=path.startsWith("/evaluation")?"judge":path.split("/")[1];
    const task=[...store.tasks].reverse().find(task=>task.kind===kind&&task.questionId===questionId&&task.revision===current.revision&&task.fingerprint===fingerprintLogic(current.draft)&&(kind!=="optimization"||task.judgeTaskId===url.searchParams.get("judgeTaskId")));
    return task?{status:"found",taskId:task.id,attempt:0,recordRevision:task.revision,sourceFingerprint:task.fingerprint}:{status:"none"};
  }
  if(path.includes("/tasks/")&&path.endsWith("/status")){
    const id=decodeURIComponent(path.split("/tasks/")[1].split("/")[0]);
    const task=store.tasks.find(item=>item.id===id&&item.questionId===questionId);
    if(!task)throw new PreviewHttpError("任务不存在",404);
    const ready=Date.now()-task.startedAt>=800;
    if(task.kind==="generation")return {status:ready?"completed":"running",taskId:id,operationRevision:task.revision,model:"local-mock",...(ready?{resultId:`${id}:result`,source:"structured_output",structuredDraft:task.draft}:{})};
    if(!ready)return {status:"running",taskId:id};
    if(task.kind==="regeneration")return {status:"completed",taskId:id,recordRevision:task.revision,resultId:`${id}:result`,source:"structured_output",structuredDraft:task.draft};
    if(task.kind==="judge")return judgeEvaluationEnvelopeSchema.parse({status:"completed",judgeVersion:"local-mock",recordRevision:task.revision,sourceFingerprint:task.fingerprint,evaluatedAt:new Date().toISOString(),judge:judgeFor(task.draft)});
    const optimization:OptimizationOutput={kind:"judge-optimization",summary:"补充选择条件和资料核验步骤（本地示例）",optimizedDraft:{...task.draft,conclusion:`${task.draft.conclusion}\n4. 逐项记录需求、核验来源、费用边界和下一步确认事项。`},changes:[{field:"conclusion",summary:"增加逐项核验与确认步骤。",evidence:[{source:"draft",excerpt:task.draft.conclusion.slice(0,50),supports:"保留原有回答并补充具体确认动作。"}]}]};
    return {...optimizationEnvelopeSchema.parse({status:"completed",optimizerVersion:"local-mock",recordRevision:task.revision,sourceFingerprint:task.fingerprint,judgeTaskId:task.judgeTaskId,knowledgeFingerprint:"local-mock",evaluatedAt:new Date().toISOString(),optimization}),review:buildOptimizationReview(task.draft,optimization)};
  }
  if(path==="/materials"&&method==="POST"){
    const current=checkRevision(input.expectedRevision);
    const removed=new Set<string>(input.removeAssetIds??[]);
    const assets=readPreviewAssets(scope);
    const attachments=current.draft.attachments.filter(item=>!removed.has(item.fileId));
    for(const id of input.addAssetIds??[]){
      const asset=assets.find(item=>item.id===id);if(!asset)throw new PreviewHttpError("本地参考材料不存在",404);
      if(!attachments.some(item=>item.fileId===id))attachments.push({fileId:id,filename:asset.filename,mimeType:asset.mimeType,kind:asset.mimeType.startsWith("image/")?"image":"file",uploadedAt:asset.uploadedAt,expiresAt:asset.expiresAt});
    }
    current.draft.attachments=attachments;current.revision++;current.updatedAt=Date.now();persist();return {record:current};
  }
  if(path==="/adopt-result"){
    const current=requireRecord();const task=store.tasks.find(item=>item.id===input.taskId&&item.questionId===questionId);
    if(!task)throw new PreviewHttpError("生成结果不存在",404);
    if(current.appliedModelResult?.taskId===task.id)return {adopted:false,resultId:input.resultId,record:current};
    checkRevision(input.operationRevision);
    current.draft={...current.draft,...task.draft};current.revision++;current.updatedAt=Date.now();
    current.appliedModelResult={taskId:task.id,resultId:input.resultId,source:"structured_output",adoptedAt:new Date().toISOString()};
    persist();return {adopted:true,resultId:input.resultId,record:current};
  }
  if(path==="/evaluation/latest"||path==="/evaluation"){
    const current=checkRevision(input.expectedRevision);
    const evaluation=createResponseLogicRuleEvaluation({questionId:current.questionId,question:current.question,intent:current.intent,version:current.version||null,revision:current.revision,logic:current.draft});
    return {status:"completed",ruleVersion:RULE_EVALUATION_VERSION,recordRevision:current.revision,confirmedVersion:current.version||null,evaluation,...(path.endsWith("latest")?{stale:false}:{persisted:true,evaluatedAt:new Date().toISOString()})};
  }
  throw new PreviewHttpError(`本地预览未实现接口：${path}`,404,"PREVIEW_ROUTE_NOT_FOUND");
}
