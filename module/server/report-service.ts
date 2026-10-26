import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {and,desc,eq,sql} from 'drizzle-orm';
import JSZip from 'jszip';
import {chromium} from 'playwright';
import {z} from 'zod';
import type {ModuleHttpCore} from './http-api.js';
import {intentHash,intentSkillPorts} from './intent-skill-runtime.js';
import {REPORT_STAGES,type ReportWorkspace,type ReportRunView,type ReportProduct,type ReportPhase,type ReportArtifactId} from '../contracts/report-run.js';
import type {BrandReportDocument,BrandReportStage} from '../contracts/brand-report.js';
import {renderPanoramaHtml,renderBriefingHtml,renderBriefingPptx,validateBrandReportDocument} from './report-renderer.js';
import {reportMonitorAttempts,reportMonitorClient,ReportMonitorError,type ReportMonitorAttempt} from './report-monitor.js';
import {reportModelArchive,reportWorkflowFingerprint,reportOutputSchema,validateReportModelOutput,type ReportModelInput} from './report-model.js';

const OP='brand_report_workflow_v1';
const RUNTIME='brandReport';
const LEASE=180_000;
const active=new Map<string,Promise<void>>();
type Context=ReturnType<ModuleHttpCore['context']>;
type Actor={id:number;role:string};
type Artifact={id:ReportArtifactId;label:string;mimeType:string;sizeBytes:number;sha256:string};
type Job={id:string;stageId:string;attempt:number;phase:'queued'|'uploading'|'create_unknown'|'running';input:ReportModelInput;providerTaskId?:string;startedAt:string;resumedAt?:string;createClaimedAt?:number;repairId?:string;baselineEvents?:string[];repairClaimedAt?:number;repairSent?:boolean};
type Runtime={
 version:1;revision:number;actorId:number;brandName:string;context:{profile:unknown;knowledge?:unknown};inputHash:string;workflowHash:string;
 credentialId:string;credentialVersion:number;model:string;phase:ReportPhase;resumePhase?:ReportPhase;
 stages:BrandReportStage[];products:ReportProduct[];attempts:ReportMonitorAttempt[];
 confirmation?:{productId:string;questions:[string,string];platforms:string[];confirmedAt:string};
 job?:Job;stageAttempts:Record<string,number>;briefingSlides?:BrandReportDocument['briefingSlides'];document?:BrandReportDocument;
 artifactGeneration?:string;monitorResumedAt?:string;artifacts:Artifact[];createdAt:string;updatedAt:string;error?:{code:string;message:string};lease?:{owner:string;expiresAt:number};nextPollAt?:number;
};
type Owned={operation:any;task:any};
export class BrandReportError extends Error {constructor(readonly code:string,message:string,readonly status=409){super(message);}}
const iso=()=>new Date().toISOString();
const digest=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const object=(value:any)=>typeof value==='string'?JSON.parse(value):value;
const publicStateHash=(r:Runtime)=>{const {lease:_lease,nextPollAt:_poll,revision:_revision,updatedAt:_updated,...state}=r;return intentHash(state);};
function runtime(owned:Owned):Runtime{
 const r=object(owned.task.providerRuntime)?.[RUNTIME];
 if(r?.version!==1||!Array.isArray(r.stages)||!Array.isArray(r.attempts))throw new BrandReportError('REPORT_STATE_INVALID','报告状态无法读取，请联系维护人员。',503);
 return structuredClone(r);
}
export function reportView(owned:Owned):ReportRunView {
 const r=runtime(owned);
 return {id:owned.operation.id,brandName:r.brandName,createdAt:r.createdAt,updatedAt:r.updatedAt,revision:r.revision,phase:r.phase,
  currentStage:r.phase==='monitoring'?'诊断采集':r.phase==='rendering'?'生成报告':r.job?.stageId??REPORT_STAGES[r.stages.length]?.[0]??'汇报编制',
  stages:r.stages.map(({id,title,summary})=>({id,title,summary})),products:r.products,questions:r.confirmation?.questions??[],platforms:r.confirmation?.platforms??[],
  sampleCount:r.attempts.filter(a=>a.status==='completed').length,expectedSamples:r.attempts.length,
  error:r.error??null,canRetry:r.phase==='failed'&&!['MONITOR_FAILED','SAMPLE_FAILED'].includes(r.error?.code??''),artifacts:r.artifacts.map(({sha256:_hash,...item})=>item)};
}
const startSchema=z.object({clientRequestId:z.string().uuid(),includeKnowledge:z.boolean(),profileHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const confirmSchema=z.object({expectedRevision:z.number().int().nonnegative(),productId:z.string().min(1).max(80),platforms:z.array(z.enum(['doubao','yuanbao','qianwen'])).min(1).max(3)}).strict();
const artifactIds=new Set<ReportArtifactId>(['panorama.html','panorama.pdf','briefing.html','briefing.pptx','reports.zip']);

export function createBrandReportService(core:ModuleHttpCore,context:Context,actor:Actor) {
 const model=intentSkillPorts();
 const scope=and(eq(model.agentOperations.accountUserId,context.accountUserId),sql`${model.agentOperations.enterpriseProjectId} <=> ${context.enterpriseProjectId}`,eq(model.agentOperations.operationType,OP),eq(model.agentOperations.contractName,OP));
 const assetRoot=core.environment.FRONTMIND_DASHBOARD_ASSET_DIR;
 function assertActor(){if(actor.id!==context.actorUserId)throw new BrandReportError('REPORT_FORBIDDEN','当前账号无权修改此企业报告。',403);model.assertActorAllowed(actor);}
 async function find(id:string,tx?:any):Promise<Owned|undefined>{
  const db=tx??await core.database();
  return (await db.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations)
   .innerJoin(model.agentTasks,and(eq(model.agentTasks.operationId,model.agentOperations.id),eq(model.agentTasks.createMarker,`brand-report:${id}`)))
   .where(and(scope,eq(model.agentOperations.id,id))).limit(1))[0];
 }
 async function requireOwned(id:string){const owned=await find(z.string().uuid().parse(id));if(!owned)throw new BrandReportError('REPORT_NOT_FOUND','报告不存在或无权访问。',404);return owned;}
 async function mutate<T>(id:string,work:(r:Runtime,tx:any,owned:Owned)=>Promise<T>|T,leaseOwner?:string){
  const db=await core.database();return db.transaction(async(tx:any)=>{
   const found=await find(id,tx);if(!found)throw new BrandReportError('REPORT_NOT_FOUND','报告不存在。',404);
   const [task]=await tx.select().from(model.agentTasks).where(eq(model.agentTasks.id,found.task.id)).limit(1).for('update');
   const owned={...found,task},r=runtime(owned),before=intentHash(r),beforePublic=publicStateHash(r);
   if(leaseOwner&&(r.lease?.owner!==leaseOwner||r.lease.expiresAt<Date.now()))throw new BrandReportError('REPORT_LEASE_CHANGED','报告正在另一执行器更新，请稍后查看。');
   const value=await work(r,tx,owned);
   if(leaseOwner&&r.lease?.owner===leaseOwner)r.lease.expiresAt=Date.now()+LEASE;
   if(intentHash(r)===before)return value;
   if(publicStateHash(r)!==beforePublic){r.revision++;r.updatedAt=iso();}
   await tx.update(model.agentTasks).set({providerRuntime:{...object(task.providerRuntime),[RUNTIME]:r},providerState:r.phase,updatedAt:new Date()}).where(eq(model.agentTasks.id,task.id));
   await tx.update(model.agentOperations).set({status:r.phase==='completed'?'succeeded':r.phase==='failed'?'attention_required':'running',errorCode:r.error?.code??null,updatedAt:new Date()}).where(eq(model.agentOperations.id,id));
   return value;
  });
 }
 async function company(){
  const workspace=await model.getDashboardWorkspace(context.accountUserId);
  const payload=workspace?.payload??{};
  const profile={brandName:String(payload.brandName??''),headline:String(payload.headline??''),summary:String(payload.summary??''),sections:payload.sections??[]};
  const name=profile.brandName.trim();
  const ready=!!name&&!['企业知识中枢','默认企业项目','企业内容与 GEO 工作台'].includes(name);
  const db=await core.database();
  const [rows]=await db.execute(sql`SELECT id, documents, documentCount FROM knowledge_base_snapshots WHERE userId=${context.accountUserId} AND enterpriseProjectId <=> ${context.enterpriseProjectId} AND status='active' ORDER BY version DESC LIMIT 1`) as any;
  return {profile,profileHash:intentHash(profile),name,ready,snapshot:rows?.[0]};
 }
 async function list(){
  const db=await core.database();
  return await db.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations).innerJoin(model.agentTasks,
   and(eq(model.agentTasks.operationId,model.agentOperations.id),sql`${model.agentTasks.createMarker}=CONCAT('brand-report:',${model.agentOperations.id})`))
   .where(scope).orderBy(desc(model.agentOperations.createdAt)).limit(40) as Owned[];
 }
 async function workspace():Promise<ReportWorkspace&{profileHash:string}>{
  const [info,runs]=await Promise.all([company(),list()]);
  runs.filter(o=>!['completed','awaiting_confirmation','failed'].includes(runtime(o).phase)).forEach(o=>schedule(o.operation.id));
  return {company:{name:info.name,summary:info.profile.summary,ready:info.ready},profileHash:info.profileHash,knowledge:{available:!!info.snapshot,documentCount:Number(info.snapshot?.documentCount??0)},runs:runs.map(reportView)};
 }
 async function start(value:unknown){
  assertActor();const input=startSchema.parse(value);const old=await find(input.clientRequestId);
  if(old){const previous=runtime(old);if(intentHash(previous.context.profile)!==input.profileHash||Boolean(previous.context.knowledge)!==input.includeKnowledge)throw new BrandReportError('IDEMPOTENCY_CONFLICT','这个请求标识已用于不同的资料选择。');schedule(old.operation.id);return reportView(old);}
  const info=await company();
  if(!info.ready)throw new BrandReportError('COMPANY_REQUIRED','请先在企业资料中确定当前企业，再开始诊断。');
  if(info.profileHash!==input.profileHash)throw new BrandReportError('PROFILE_CHANGED','企业资料已更新，请重新读取后开始。');
  if(input.includeKnowledge&&!info.snapshot)throw new BrandReportError('KNOWLEDGE_MISSING','所选知识库已变化，请重新选择资料。');
  const frozen={profile:info.profile,...(input.includeKnowledge?{knowledge:object(info.snapshot.documents)}:{})};
  if(Buffer.byteLength(JSON.stringify(frozen))>6*1024*1024)throw new BrandReportError('SOURCE_TOO_LARGE','本轮资料超过处理范围，请先整理企业资料。');
  const [credential,status,workflowHash]=await Promise.all([model.getDecryptedCredentialForUser(context.accountUserId),model.getApiCredentialStatus(context.accountUserId),reportWorkflowFingerprint()]);
  if(!credential||credential.status!=='active'||status.status!=='active')throw new BrandReportError('MODEL_UNAVAILABLE','模型服务暂不可用，请检查账户配置。',503);
  if(!assetRoot||!path.isAbsolute(assetRoot))throw new BrandReportError('REPORT_STORAGE_UNAVAILABLE','报告持久化目录尚未配置。',503);
  const db=await core.database();let operationId=input.clientRequestId;
  await db.transaction(async(tx:any)=>{
   await model.lockAccountRecord(tx,context.accountUserId);await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   const concurrent=(await tx.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations).innerJoin(model.agentTasks,
    and(eq(model.agentTasks.operationId,model.agentOperations.id),sql`${model.agentTasks.createMarker}=CONCAT('brand-report:',${model.agentOperations.id})`))
    .where(scope).orderBy(desc(model.agentOperations.createdAt)).limit(40) as Owned[]).find(o=>!['completed','failed'].includes(runtime(o).phase));
   if(concurrent){operationId=concurrent.operation.id;return;}
   if(await find(input.clientRequestId,tx))return;
   const inputHash=intentHash({context:frozen,workflowHash,includeKnowledge:input.includeKnowledge});
   const r:Runtime={version:1,revision:0,actorId:actor.id,brandName:info.name,context:frozen,inputHash,workflowHash,
    credentialId:credential.id,credentialVersion:credential.version,model:credential.upstreamModel,phase:'researching',stages:[],products:[],attempts:[],stageAttempts:{},artifacts:[],createdAt:iso(),updatedAt:iso()};
   await tx.insert(model.agentOperations).values({id:operationId,enterpriseProjectId:context.enterpriseProjectId,provider:credential.provider,scope:'managed_user',accountUserId:context.accountUserId,presalesProjectId:null,
    operationType:OP,idempotencyKeyHash:intentHash([OP,context.accountUserId,context.enterpriseProjectId,operationId]),requestHash:inputHash,contractName:OP,contractRevision:1,schemaHash:intentHash('brand-report-v1'),apiCredentialId:credential.id,credentialVersion:credential.version,publicProfile:credential.agentProfile,upstreamModel:credential.upstreamModel,status:'queued'});
   await tx.insert(model.agentTasks).values({id:randomUUID(),operationId,providerTaskId:null,providerRequestId:null,createMarker:`brand-report:${operationId}`,title:`品牌报告 · ${info.name}`,providerState:'researching',providerRuntime:{[RUNTIME]:r}});
  });schedule(operationId);return reportView(await requireOwned(operationId));
 }
 async function confirm(id:string,value:unknown){
  assertActor();const input=confirmSchema.parse(value);
  if(new Set(input.platforms).size!==input.platforms.length)throw new BrandReportError('PLATFORMS_DUPLICATE','请勿重复选择平台。',400);
  if(!reportMonitorClient(core.environment).configured)throw new BrandReportError('MONITOR_NOT_CONFIGURED','诊断采集服务尚未配置，请联系维护人员。',503);
  await mutate(id,async(r,tx)=>{
   await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   if(r.confirmation){
    if(r.confirmation.productId===input.productId&&intentHash([...r.confirmation.platforms].sort())===intentHash([...input.platforms].sort()))return;
    throw new BrandReportError('CONFIRMATION_FROZEN','本轮诊断范围已经确认，请使用新的报告任务调整范围。');
   }
   if(r.phase!=='awaiting_confirmation'||r.revision!==input.expectedRevision)throw new BrandReportError('REPORT_CHANGED','报告状态已更新，请重新读取后确认。');
   const product=r.products.find(p=>p.id===input.productId);if(!product)throw new BrandReportError('PRODUCT_INVALID','请选择本轮研究得到的核心产品。',400);
   r.confirmation={productId:product.id,questions:[product.question,`${r.brandName}有什么缺点和问题？`],platforms:input.platforms,confirmedAt:iso()};
   r.attempts=reportMonitorAttempts(id,r.confirmation.questions,r.confirmation.platforms);r.phase='monitoring';delete r.error;
  });schedule(id);return reportView(await requireOwned(id));
 }
 async function retry(id:string){
  assertActor();await mutate(id,async(r,tx)=>{
   await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   if(r.phase!=='failed')return;
   if(['MONITOR_FAILED','SAMPLE_FAILED'].includes(r.error?.code??''))throw new BrandReportError('MONITOR_TERMINAL','采集服务已确认该任务失败，已有结果已保存，请联系维护人员处理失败样本。');
   if(r.error?.code==='MODEL_TIMEOUT'&&r.job)r.job.resumedAt=iso();
   if(r.error?.code==='MONITOR_TIMEOUT')r.monitorResumedAt=iso();
   // Completed samples and ambiguous POST markers remain intact. Only a proven failed model run gets a new stage task.
   if(r.error?.code==='MODEL_FAILED'||r.error?.code==='MODEL_OUTPUT_INVALID'){delete r.job;}
   for(const a of r.attempts)if(a.status==='failed'&&a.taskId){a.status='submitted';a.nextPollAt=0;}
   r.phase=r.resumePhase??'researching';delete r.error;delete r.lease;delete r.nextPollAt;
  });schedule(id);return reportView(await requireOwned(id));
 }
 async function observe(id:string){const owned=await requireOwned(id);schedule(id);return reportView(owned);}
 async function fail(id:string,owner:string,phase:ReportPhase,error:unknown){
  const known=error instanceof BrandReportError||error instanceof ReportMonitorError;
  const code=known?error.code:'REPORT_EXECUTION_FAILED';
  const message=known?error.message:'当前步骤未能完成，已保留本轮进度。请恢复重试；若仍失败，请联系维护人员查看任务记录。';
  await mutate(id,r=>{r.resumePhase=phase;r.phase='failed';r.error={code,message};delete r.lease;},owner);
  console.error('[BrandReport]',id,code,error instanceof Error?error.name:'unknown');
 }
 async function advance(id:string){
  const owner=randomUUID();let acquired:Runtime|undefined;
  await mutate(id,r=>{if(['completed','failed','awaiting_confirmation'].includes(r.phase)||(r.lease?.expiresAt??0)>Date.now()||(r.nextPollAt??0)>Date.now())return;
   r.lease={owner,expiresAt:Date.now()+LEASE};acquired=structuredClone(r);});
  if(!acquired)return;const r:Runtime=acquired;
  try{
   if(r.workflowHash!==await reportWorkflowFingerprint())throw new BrandReportError('WORKFLOW_VERSION_CHANGED','工作流版本已更新，原报告的阶段结果已保留。请完成旧版本兼容处理后恢复。');
   if(r.phase==='monitoring'){await monitor(id,owner,r);return;}
   if(r.phase==='rendering'){await render(id,owner,r);return;}
   if(r.stages.length===4&&!r.confirmation){await mutate(id,state=>{state.phase='awaiting_confirmation';delete state.job;},owner);return;}
   await runModel(id,owner,r);
  }catch(error){await fail(id,owner,r.phase,error).catch(()=>{});}
  finally{await mutate(id,state=>{if(state.lease?.owner===owner)delete state.lease;}).catch(()=>{});}
 }
 async function monitor(id:string,owner:string,r:Runtime){
  const client=reportMonitorClient(core.environment);
  const pending=r.attempts.find(a=>a.status!=='completed'&&(a.nextPollAt??0)<=Date.now());
  if(!pending){if(r.attempts.every(a=>a.status==='completed'))await mutate(id,state=>{state.phase='analyzing';},owner);return;}
  if(!pending.taskId){
   await mutate(id,state=>{const a=state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId)!;a.status='submitting';a.submittedAt??=iso();},owner);
   // The supplier documents consumerTaskId as idempotent. An ambiguous retry uses the exact original key and body.
   const taskId=await client.submit(pending,r.brandName);
   await mutate(id,state=>{const a=state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId)!;a.taskId=taskId;a.status='submitted';a.nextPollAt=Date.now()+300_000;},owner);
  }else{
   if(Date.now()-Math.max(Date.parse(pending.submittedAt??r.createdAt),Date.parse(r.monitorResumedAt??r.createdAt))>4*60*60_000)throw new BrandReportError('MONITOR_TIMEOUT','采集等待时间较长，已保留供应商任务。请检查服务状态后恢复。');
   const sample=await client.poll(pending,r.brandName);
   await mutate(id,state=>{const a=state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId)!;a.nextPollAt=Date.now()+30_000;if(sample){a.sample=sample;a.status='completed';}},owner);
  }
 }
 async function reserveJob(id:string,owner:string,r:Runtime):Promise<Job>{
  const stageId=REPORT_STAGES[r.stages.length]?.[0]??'briefing';const attempt=(r.stageAttempts[stageId]??0)+1;
  const data={stageId,brandName:r.brandName,context:r.context,previousStages:r.stages,monitoring:r.confirmation?{...r.confirmation,samples:r.attempts.flatMap(a=>a.sample?[a.sample]:[])}:null};
  const job:Job={id:randomUUID(),stageId,attempt,phase:'queued',input:{...data,operationToken:`brand-report:${id}:${stageId}:${attempt}`,inputHash:intentHash(data)},startedAt:iso()};
  await mutate(id,async(state,tx)=>{
   if(state.job)throw new BrandReportError('JOB_EXISTS','当前阶段已开始，请重新读取。');
   state.job=job;state.stageAttempts[stageId]=attempt;
   await tx.insert(model.agentTasks).values({id:job.id,operationId:id,providerTaskId:null,providerRequestId:null,createMarker:job.input.operationToken,title:`FrontMind report ${id} ${stageId} ${attempt}`,providerState:'queued',providerRuntime:{reportStage:{input:job.input}}});
  },owner);return job;
 }
 async function runModel(id:string,owner:string,r:Runtime){
  const job=r.job??await reserveJob(id,owner,r);
  const credential=await model.getDecryptedCredentialForAccountById(context.accountUserId,r.credentialId);
  if(!credential||credential.version!==r.credentialVersion)throw new BrandReportError('MODEL_CREDENTIAL_UNAVAILABLE','原报告使用的模型凭据暂不可用，请检查服务配置。',503);
  const client=model.createCredentialAgentClient(credential,{accountUserId:context.accountUserId,operationId:id,localTaskId:job.id,intentId:job.id});
  const setJob=async(change:Partial<Job>)=>{await mutate(id,async(state,tx)=>{
   if(state.job?.id!==job.id)throw new BrandReportError('JOB_CHANGED','报告执行阶段已变化。');Object.assign(state.job,change);
   await tx.update(model.agentTasks).set({providerState:state.job.phase,...(change.providerTaskId?{providerTaskId:change.providerTaskId}:{}),updatedAt:new Date()}).where(eq(model.agentTasks.id,job.id));
  },owner);Object.assign(job,change);};
  if(job.phase==='queued'||job.phase==='uploading'){
   await setJob({phase:'uploading'});
   const uploaded=await client.uploadFile({filename:'brand-report-stage.zip',bytes:await reportModelArchive(job.input),contentType:'application/zip',observer:{onCandidateCreated:async({fileId}:{fileId:string})=>model.recordUpstreamResource({userId:context.accountUserId,apiCredentialId:r.credentialId,kind:'file',upstreamId:fileId})}});
   await setJob({phase:'create_unknown',createClaimedAt:Date.now()});
   const created=await client.createTask({title:`FrontMind report ${id} ${job.stageId} ${job.attempt}`,prompt:`读取附件SKILL.md与input.json，完成${job.stageId}阶段。真实检索、深入分析、输出完整结构化结果。\nFRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({operationToken:job.input.operationToken})}`,attachments:[{file_id:uploaded.fileId,filename:'brand-report-stage.zip'}],agentProfile:credential.upstreamModel,locale:'zh-CN',interactiveMode:false,structuredOutputSchema:z.toJSONSchema(reportOutputSchema(job.stageId),{target:'draft-7'})});
   await setJob({phase:'running',providerTaskId:created.taskId});
   await model.recordUpstreamResource({userId:context.accountUserId,apiCredentialId:r.credentialId,kind:'task',upstreamId:created.taskId});return;
  }
  if(!job.providerTaskId){
   const found=await client.findCreatedTask({title:`FrontMind report ${id} ${job.stageId} ${job.attempt}`,operationToken:job.input.operationToken,createdAfterSeconds:Math.floor(Date.parse(job.startedAt)/1000)-60,createdBeforeSeconds:Math.floor(Date.now()/1000)+60});
   if(found.matches.length>1)throw new BrandReportError('MODEL_CREATE_AMBIGUOUS','模型任务标识有多个匹配，请联系维护人员核对；不会重复创建。');
   if(!found.unique){if(Date.now()-(job.createClaimedAt??Date.parse(job.startedAt))>180_000)throw new BrandReportError('MODEL_CREATE_UNKNOWN','模型任务创建结果未确认。恢复时会查询原任务，不重复提交。');return;}
   await setJob({phase:'running',providerTaskId:String(found.unique.id)});
  }
  if(Date.now()-Date.parse(job.resumedAt??job.startedAt)>2*60*60_000)throw new BrandReportError('MODEL_TIMEOUT','当前研究阶段等待时间较长，已保留原任务，请恢复查看。');
  const allEvents=await client.listAllMessages({taskId:job.providerTaskId,order:'asc'});
  const events=allEvents.filter((e:any)=>!(job.baselineEvents??[]).includes(e.id));
  const ordered=model.orderManusV2EventsByProviderRank(events,'newest_first');
  const structured=ordered.find((e:any)=>e.type==='structured_output_result') as any;
  let value:unknown,invalid:string|undefined;
  if(structured){const result=model.classifyManusV2StructuredResultEnvelope(structured.structured_output_result);if(result.kind==='accepted')value=result.value;}
  const status=model.latestManusV2TaskState(events)??(await client.taskDetail(job.providerTaskId)).status;
  if(value===undefined&&['completed','finished','stopped'].includes(status)){
   const message=ordered.find((e:any)=>e.type==='assistant_message'&&typeof e.assistant_message?.content==='string') as any;
   if(message){try{value=JSON.parse(String(message.assistant_message.content).trim().replace(/^```(?:json)?\s*\n/u,'').replace(/\n```$/u,''));}catch{invalid='最终结果不是完整JSON';}}
  }
  if(value!==undefined){
   let result:ReturnType<typeof validateReportModelOutput>|undefined;
   try{result=validateReportModelOutput(value,job.input);}catch(error){invalid=error instanceof z.ZodError?'结构化字段或研究内容不完整':error instanceof Error?error.message:'研究结果校验失败';}
   if(result){const validated=result;
   await mutate(id,async(state,tx)=>{
    if(state.job?.id!==job.id)throw new BrandReportError('JOB_CHANGED','报告阶段已变化。');
    if('stage' in validated){state.stages.push(validated.stage as BrandReportStage);if(job.stageId==='S4')state.products=validated.products;
     if(state.stages.length===4&&!state.confirmation)state.phase='awaiting_confirmation';}
    else{state.briefingSlides=validated.slides as BrandReportDocument['briefingSlides'];state.phase='rendering';}
    delete state.job;delete state.error;
    await tx.update(model.agentTasks).set({providerState:'completed',updatedAt:new Date()}).where(eq(model.agentTasks.id,job.id));
   },owner);return;
  }}
  if(['error','failed','cancelled'].includes(status))throw new BrandReportError('MODEL_FAILED','当前研究阶段执行失败。可恢复此阶段，已完成的阶段会保留。');
  if(['completed','finished','stopped'].includes(status)){
   if(!job.repairId){
    const repairId=randomUUID();await setJob({repairId,repairClaimedAt:Date.now(),baselineEvents:allEvents.map((e:any)=>e.id)});
    const repairClient=model.createCredentialAgentClient(credential,{accountUserId:context.accountUserId,operationId:id,localTaskId:job.id,intentId:repairId});
    await repairClient.sendMessage({taskId:job.providerTaskId,prompt:`本阶段结果未通过校验：${invalid??'缺少结构化结果'}。读取原附件，补齐内容并返回完整JSON；不得改变operationToken=${job.input.operationToken}和inputHash=${job.input.inputHash}，不得制造来源。`,structuredOutputSchema:z.toJSONSchema(reportOutputSchema(job.stageId),{target:'draft-7'})});await setJob({repairSent:true});return;
   }
   if(Date.now()-(job.repairClaimedAt??0)>120_000)throw new BrandReportError('MODEL_OUTPUT_INVALID',`本阶段结果未通过检查：${invalid??'缺少完整研究结果'}。请恢复此阶段。`);
  }
 }
 function directory(id:string){if(!assetRoot||!path.isAbsolute(assetRoot))throw new BrandReportError('REPORT_STORAGE_UNAVAILABLE','报告存储不可用。',503);return path.join(assetRoot,'brand-reports',intentHash([context.accountUserId,context.enterpriseProjectId]),z.string().uuid().parse(id));}
 async function render(id:string,owner:string,r:Runtime){
  if(!r.confirmation||!r.briefingSlides||r.attempts.some(a=>a.status!=='completed'||!a.sample))throw new BrandReportError('REPORT_INCOMPLETE','诊断证据尚不完整，不能生成最终报告。');
  const doc:BrandReportDocument={schemaVersion:'brand-report-v1',brandName:r.brandName,generatedAt:iso(),overview:r.stages.find(s=>s.id==='S4')!.summary,stages:r.stages,
   monitoring:{confirmedAt:r.confirmation.confirmedAt,questions:r.confirmation.questions,platforms:r.confirmation.platforms,samples:r.attempts.map(a=>a.sample!)},briefingSlides:r.briefingSlides};
  validateBrandReportDocument(doc);
  const panorama=renderPanoramaHtml(doc),briefing=renderBriefingHtml(doc);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});let pdf:Buffer;
  try{const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(panorama,{waitUntil:'load',timeout:30_000});await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{(node as HTMLDetailsElement).open=true;}));await page.emulateMedia({media:'print'});pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});}finally{await browser.close();}
  const pptx=Buffer.from(await renderBriefingPptx(doc));
  const files:Array<Artifact&{bytes:Buffer}>=[];
  function add(id:ReportArtifactId,label:string,mimeType:string,bytes:Buffer){files.push({id,label,mimeType,bytes,sizeBytes:bytes.length,sha256:digest(bytes)});}
  add('panorama.html','全景报告 · 网页版','text/html',Buffer.from(panorama));add('panorama.pdf','全景报告 · PDF','application/pdf',pdf);
  add('briefing.html','汇报报告 · 网页版','text/html',Buffer.from(briefing));add('briefing.pptx','汇报报告 · PPTX','application/vnd.openxmlformats-officedocument.presentationml.presentation',pptx);
  const zip=new JSZip();for(const f of files)zip.file(f.id,f.bytes);zip.file('report-data.json',JSON.stringify(doc,null,2));
  add('reports.zip','全部报告与证据','application/zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const dir=path.join(directory(id),owner);await mkdir(dir,{recursive:true,mode:0o700});
  for(const f of files){const target=path.join(dir,f.id),temp=`${target}.${owner}.tmp`;await writeFile(temp,f.bytes,{mode:0o600});await rename(temp,target);}
  await mutate(id,state=>{state.document=doc;state.artifactGeneration=owner;state.artifacts=files.map(({bytes:_bytes,...f})=>f);state.phase='completed';delete state.error;},owner);
 }
 async function artifact(id:string,file:string){
  const owned=await requireOwned(id),r=runtime(owned);if(r.phase!=='completed'||!artifactIds.has(file as ReportArtifactId))throw new BrandReportError('REPORT_FILE_NOT_FOUND','报告文件尚未生成。',404);
  const info=r.artifacts.find(a=>a.id===file);if(!info)throw new BrandReportError('REPORT_FILE_NOT_FOUND','报告文件不存在。',404);
  const bytes=await readFile(path.join(directory(id),z.string().uuid().parse(r.artifactGeneration),info.id));if(bytes.length!==info.sizeBytes||digest(bytes)!==info.sha256)throw new BrandReportError('REPORT_FILE_INVALID','报告文件完整性检查失败，请联系维护人员。',503);
  return {info,bytes,brandName:r.brandName};
 }
 function schedule(id:string){const prior=active.get(id);if(prior)return prior;const task=advance(id).catch(error=>console.error('[BrandReport advance]',id,error instanceof Error?error.name:'unknown')).finally(()=>active.delete(id));active.set(id,task);return task;}
 return {workspace,start,confirm,retry,observe,artifact,advance,schedule};
}

/** Resume persisted work after process restarts without relying on a browser tab. */
export function startBrandReportWorker(core:ModuleHttpCore){
 let busy=false;
 const timer=setInterval(async()=>{
  if(busy)return;busy=true;
  try{
   const model=intentSkillPorts(),db=await core.database();
   const rows=await db.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations).innerJoin(model.agentTasks,
    and(eq(model.agentTasks.operationId,model.agentOperations.id),sql`${model.agentTasks.createMarker}=CONCAT('brand-report:',${model.agentOperations.id})`))
    .where(and(eq(model.agentOperations.operationType,OP),sql`${model.agentOperations.status} IN ('queued','running','result_pending')`,sql`${model.agentTasks.providerState} IN ('researching','monitoring','analyzing','rendering')`)).limit(30) as Owned[];
   for(const row of rows){const r=runtime(row);if(['awaiting_confirmation','completed','failed'].includes(r.phase))continue;
    const owner=Number(row.operation.accountUserId),project=row.operation.enterpriseProjectId??null;
    await model.runWithStoredEnterpriseProjectScope(owner,project,async()=>{
     const context:Context={accountUserId:owner,actorUserId:owner,enterpriseProjectId:project,businessOwnerId:String(owner),businessActorId:String(owner)};
     createBrandReportService(core,context,{id:owner,role:'user'}).schedule(row.operation.id);
    });
   }
  }catch(error){console.error('[BrandReport worker]',error instanceof Error?error.name:'unknown');}finally{busy=false;}
 },15_000);timer.unref();return()=>clearInterval(timer);
}
