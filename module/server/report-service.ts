import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {and,desc,eq,sql} from 'drizzle-orm';
import JSZip from 'jszip';
import {z} from 'zod';
import type {ModuleHttpCore} from './http-api.js';
import {intentHash,intentSkillPorts} from './intent-skill-runtime.js';
import {REPORT_STAGES,type ReportWorkspace,type ReportRunView,type ReportProduct,type ReportPhase,type ReportArtifactId,type ReportProcessView} from '../contracts/report-run.js';
import type {BrandReportDocument,BrandReportStage} from '../contracts/brand-report.js';
import {renderPanoramaHtml,renderBriefingHtml,validateBrandReportDocument} from './report-renderer.js';
import {reportMonitorAttempts,reportMonitorClient,ReportMonitorError,type ReportMonitorAttempt} from './report-monitor.js';
import {reportModelArchive,reportWorkflowFingerprint,validateReportModelOutput,type ReportModelInput} from './report-model.js';

import {reportHarnessConfig,runReportHarness,reportHarnessDocuments,reportHarnessDocument,closeReportHarness} from './report-harness.js';
import {appendReportEvent,readReportEvents,type ReportEventInput} from './report-process.js';

const ENGINE='deepseek-harness-v1';
const stoppedPhases=['completed','failed','cancelled','awaiting_confirmation'];
const runningControllers=new Map<string,AbortController>();
const OP='brand_report_workflow_v1';
const RUNTIME='brandReport';
const LEASE=180_000;
const active=new Map<string,Promise<void>>();
type Context=ReturnType<ModuleHttpCore['context']>;
type Actor={id:number;role:string};
type Artifact={id:ReportArtifactId;label:string;mimeType:string;sizeBytes:number;sha256:string};
type Job={id:string;stageId:string;attempt:number;phase:'queued'|'uploading'|'create_unknown'|'running';input:ReportModelInput;providerTaskId?:string;startedAt:string;resumedAt?:string;createClaimedAt?:number;recoverMissingCreate?:boolean;repairId?:string;baselineEvents?:string[];repairClaimedAt?:number;repairSent?:boolean};
type Runtime={
 engine?:typeof ENGINE;sessionId?:string;version:1;revision:number;actorId:number;brandName:string;context:{profile:unknown;knowledge?:unknown;subject?:{name:string;scope:string;backgroundBrandName:string;boundary:string}};inputHash:string;workflowHash:string;
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
 return {id:owned.operation.id,brandName:r.brandName,createdAt:r.createdAt,updatedAt:r.updatedAt,revision:r.revision,phase:r.error?.code==='REPORT_STOPPED_BY_USER'?'cancelled':r.phase,
  currentStage:r.phase==='monitoring'?'诊断采集':r.phase==='rendering'?'生成报告':r.job?.stageId??REPORT_STAGES[r.stages.length]?.[0]??'汇报编制',
  stages:r.stages.map(({id,title,summary})=>({id,title,summary})),products:r.products,questions:r.confirmation?.questions??[],platforms:r.confirmation?.platforms??[],
  sampleCount:r.attempts.filter(a=>a.status==='completed').length,expectedSamples:r.attempts.length,
  error:r.error??null,engine:r.engine??'legacy',model:r.model,canStop:!['completed','failed','cancelled'].includes(r.phase),canRetry:r.engine===ENGINE&&r.phase==='failed'&&!['MONITOR_FAILED','SAMPLE_FAILED','REPORT_STOPPED_BY_USER'].includes(r.error?.code??''),artifacts:r.artifacts.map(({sha256:_hash,...item})=>item)};
}
const startSchema=z.object({clientRequestId:z.string().uuid(),includeKnowledge:z.boolean(),profileHash:z.string().regex(/^[a-f0-9]{64}$/),subjectScope:z.string().trim().min(1).max(120).optional()}).strict();
const confirmSchema=z.object({expectedRevision:z.number().int().nonnegative(),productId:z.string().min(1).max(80),platforms:z.array(z.enum(['doubao','yuanbao','qianwen'])).min(1).max(3)}).strict();
const artifactIds=new Set<ReportArtifactId>(['panorama.html','briefing.html','reports.zip']);

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
   await tx.update(model.agentOperations).set({status:r.phase==='completed'?'succeeded':r.phase==='cancelled'?'cancelled':r.phase==='failed'?'attention_required':'running',errorCode:r.error?.code??null,updatedAt:new Date()}).where(eq(model.agentOperations.id,id));
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
  runs.filter(o=>!stoppedPhases.includes(runtime(o).phase)).forEach(o=>schedule(o.operation.id));
  return {company:{name:info.name,summary:info.profile.summary,ready:info.ready},profileHash:info.profileHash,knowledge:{available:!!info.snapshot,documentCount:Number(info.snapshot?.documentCount??0)},runs:runs.map(reportView)};
 }
 async function start(value:unknown){
  assertActor();const input=startSchema.parse(value);const old=await find(input.clientRequestId);
  if(old){const previous=runtime(old);if(intentHash(previous.context.profile)!==input.profileHash||Boolean(previous.context.knowledge)!==input.includeKnowledge||(previous.context.subject?.scope??'')!==(input.subjectScope??''))throw new BrandReportError('IDEMPOTENCY_CONFLICT','这个请求标识已用于不同的资料或研究主体。');schedule(old.operation.id);return reportView(old);}
  const info=await company();
  if(!info.ready)throw new BrandReportError('COMPANY_REQUIRED','请先在企业资料中确定当前企业，再开始诊断。');
  if(info.profileHash!==input.profileHash)throw new BrandReportError('PROFILE_CHANGED','企业资料已更新，请重新读取后开始。');
  if(input.includeKnowledge&&!info.snapshot)throw new BrandReportError('KNOWLEDGE_MISSING','所选知识库已变化，请重新选择资料。');
  const subject={name:input.subjectScope?`${info.name}（${input.subjectScope}）`:info.name,scope:input.subjectScope??'',backgroundBrandName:info.name,
   boundary:input.subjectScope?`本轮仅研究和诊断${input.subjectScope}。企业整体资料只作为相关背景，不得把其他部门的产品、业绩或采集结果归属于研究主体。`:'本轮研究当前企业整体；所有事实和结论仍须与来源对应。'};
  const frozen={profile:info.profile,subject,...(input.includeKnowledge?{knowledge:object(info.snapshot.documents)}:{})};
  if(Buffer.byteLength(JSON.stringify(frozen))>6*1024*1024)throw new BrandReportError('SOURCE_TOO_LARGE','本轮资料超过处理范围，请先整理企业资料。');
  let config:ReturnType<typeof reportHarnessConfig>;
  try{config=reportHarnessConfig(core.environment);}catch{throw new BrandReportError('MODEL_UNAVAILABLE','DeepSeek 报告执行服务尚未配置，请联系维护人员。',503);}
  const workflowHash=await reportWorkflowFingerprint();
  if(!assetRoot||!path.isAbsolute(assetRoot))throw new BrandReportError('REPORT_STORAGE_UNAVAILABLE','报告持久化目录尚未配置。',503);
  const inputHash=intentHash({context:frozen,workflowHash,includeKnowledge:input.includeKnowledge});
  const db=await core.database();let operationId=input.clientRequestId;
  await db.transaction(async(tx:any)=>{
   await model.lockAccountRecord(tx,context.accountUserId);await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   const concurrent=(await tx.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations).innerJoin(model.agentTasks,
    and(eq(model.agentTasks.operationId,model.agentOperations.id),sql`${model.agentTasks.createMarker}=CONCAT('brand-report:',${model.agentOperations.id})`))
    .where(scope).orderBy(desc(model.agentOperations.createdAt)).limit(40) as Owned[]).find(o=>!['completed','failed','cancelled'].includes(runtime(o).phase));
   if(concurrent){
    const previous=runtime(concurrent);
    if(previous.engine!==ENGINE||previous.workflowHash!==workflowHash||previous.inputHash!==inputHash||intentHash(previous.context)!==intentHash(frozen))
     throw new BrandReportError('REPORT_ALREADY_ACTIVE','当前企业已有一份资料、研究主体或工作流版本不同的报告尚未结束。请先查看或停止现有报告，再新建。');
    operationId=concurrent.operation.id;return;
   }
   if(await find(input.clientRequestId,tx))return;
   const r:Runtime={engine:ENGINE,version:1,revision:0,actorId:actor.id,brandName:subject.name,context:frozen,inputHash,workflowHash,
    credentialId:'server:brand-report:deepseek',credentialVersion:1,model:config.model,phase:'researching',stages:[],products:[],attempts:[],stageAttempts:{},artifacts:[],createdAt:iso(),updatedAt:iso()};
   await tx.insert(model.agentOperations).values({id:operationId,enterpriseProjectId:context.enterpriseProjectId,provider:'deepseek',scope:'managed_user',accountUserId:context.accountUserId,presalesProjectId:null,
    operationType:OP,idempotencyKeyHash:intentHash([OP,context.accountUserId,context.enterpriseProjectId,operationId]),requestHash:inputHash,contractName:OP,contractRevision:2,schemaHash:intentHash('brand-report-deepseek-v1'),apiCredentialId:'server:brand-report:deepseek',credentialVersion:1,publicProfile:'brand-report-server',upstreamModel:config.model,status:'queued'});
   await tx.insert(model.agentTasks).values({id:randomUUID(),operationId,providerTaskId:null,providerRequestId:null,createMarker:`brand-report:${operationId}`,title:`品牌报告 · ${subject.name}`,providerState:'researching',providerRuntime:{[RUNTIME]:r}});
  });schedule(operationId);return reportView(await requireOwned(operationId));
 }
 async function confirm(id:string,value:unknown){
  assertActor();const input=confirmSchema.parse(value);
  let confirmed=false;
  if(new Set(input.platforms).size!==input.platforms.length)throw new BrandReportError('PLATFORMS_DUPLICATE','请勿重复选择平台。',400);
  if(!reportMonitorClient(core.environment).configured)throw new BrandReportError('MONITOR_NOT_CONFIGURED','诊断采集服务尚未配置，请联系维护人员。',503);
  await mutate(id,async(r,tx)=>{
   await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   if(r.engine!==ENGINE||r.phase==='cancelled'||r.error?.code==='REPORT_STOPPED_BY_USER')throw new BrandReportError('REPORT_STOPPED','这份历史报告已停止，请新建报告。');
   if(r.confirmation){
    if(r.confirmation.productId===input.productId&&intentHash([...r.confirmation.platforms].sort())===intentHash([...input.platforms].sort()))return;
    throw new BrandReportError('CONFIRMATION_FROZEN','本轮诊断范围已经确认，请使用新的报告任务调整范围。');
   }
   if(r.phase!=='awaiting_confirmation'||r.revision!==input.expectedRevision)throw new BrandReportError('REPORT_CHANGED','报告状态已更新，请重新读取后确认。');
   const product=r.products.find(p=>p.id===input.productId);if(!product)throw new BrandReportError('PRODUCT_INVALID','请选择本轮研究得到的核心产品。',400);
   r.confirmation={productId:product.id,questions:[product.question,`${r.brandName}有什么缺点和问题？`],platforms:input.platforms,confirmedAt:iso()};
   r.attempts=reportMonitorAttempts(id,r.confirmation.questions,r.confirmation.platforms);r.phase='monitoring';delete r.error;
   confirmed=true;
  });
  if(confirmed)await appendReportEvent(directory(id),'monitoring',{kind:'status',message:'诊断范围已确认，开始按所选问题和平台采集真实回答。'});
  schedule(id);return reportView(await requireOwned(id));
 }
 async function retry(id:string){
  assertActor();await mutate(id,async(r,tx)=>{
   await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   if(r.engine!==ENGINE||r.phase==='cancelled'||r.error?.code==='REPORT_STOPPED_BY_USER')throw new BrandReportError('REPORT_STOPPED','已停止或旧版任务保留为历史记录，请新建报告。');
   if(r.phase!=='failed')return;
   if(['MONITOR_FAILED','SAMPLE_FAILED'].includes(r.error?.code??''))throw new BrandReportError('MONITOR_TERMINAL','采集服务已确认任务失败，已有结果已保存，请核对失败样本。');
   if(r.error?.code==='MONITOR_TIMEOUT')r.monitorResumedAt=iso();
   // Explicit retry resumes the saved harness session and exact stage identity;
   // it never changes monitoring idempotency keys or replays completed stages.
   if(r.job){r.job.phase='queued';r.job.resumedAt=iso();}
   r.phase=r.resumePhase??'researching';delete r.error;delete r.lease;delete r.nextPollAt;
  });schedule(id);return reportView(await requireOwned(id));
 }
 async function stop(id:string){
  let stopped=false;
  assertActor();await mutate(id,async(r,tx)=>{
   await model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor);
   if(['completed','cancelled'].includes(r.phase))return;
   r.phase='cancelled';r.error={code:'REPORT_STOPPED_BY_USER',message:'本轮已停止，已完成的研究和采集记录已保留。'};
   delete r.lease;delete r.nextPollAt;
   stopped=true;
  });
  if(!stopped)return reportView(await requireOwned(id));
  runningControllers.get(id)?.abort(new Error('REPORT_STOPPED_BY_USER'));
  await closeReportHarness(directory(id));
  await appendReportEvent(directory(id),'stop',{kind:'status',message:'本轮报告已停止。已发出的采集请求可能仍由平台完成，系统不会继续提交新请求。'});
  return reportView(await requireOwned(id));
 }
 async function processView(id:string,after:number):Promise<ReportProcessView>{
  const r=runtime(await requireOwned(id));
  const events=await readReportEvents(directory(id),after,201);
  const page=events.slice(0,200);
  return {events:page,nextCursor:page.at(-1)?.seq??after,hasMore:events.length>200,intermediate:await reportHarnessDocuments(directory(id)),
   documents:r.stages.map(({id,title,summary,markdown,sources})=>({id,title,summary,markdown,sources}))};
 }
 async function intermediateDocument(id:string,file:string){
  await requireOwned(id);return reportHarnessDocument(directory(id),file);
 }
 async function observe(id:string){const owned=await requireOwned(id);schedule(id);return reportView(owned);}
 async function fail(id:string,owner:string,phase:ReportPhase,error:unknown){
  const known=error instanceof BrandReportError||error instanceof ReportMonitorError;
  let diagnostic=error instanceof Error?error.message:String(error);
  for(const [key,value] of Object.entries(core.environment))if(/KEY|TOKEN|SECRET|PASSWORD/i.test(key)&&value&&value.length>5)diagnostic=diagnostic.replaceAll(value,'[REDACTED]');
  diagnostic=diagnostic.replace(/Bearer\s+[^\s"',]+/gi,'Bearer [REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g,'[REDACTED]').slice(0,2000);
  const harnessCode=diagnostic.match(/^REPORT_HARNESS_[A-Z0-9_]+/)?.[0];
  const code=known?error.code:harnessCode??'REPORT_EXECUTION_FAILED';
  const message=known?error.message:/\b401\b|\b403\b/.test(diagnostic)?'DeepSeek 连接认证未通过，请维护人员检查服务器凭据。':/\b429\b|CAPACITY/.test(diagnostic)?'模型或报告执行资源暂时繁忙，已保留进度，可以稍后恢复。':/TIMEOUT|INTERRUPTED/.test(diagnostic)?'模型执行超时或中断，已有过程和文件已保存，可以恢复当前阶段。':'当前步骤未能完成，已保留本轮进度。请恢复重试；若仍失败，请联系维护人员查看任务记录。';
  await mutate(id,r=>{r.resumePhase=phase;r.phase='failed';r.error={code,message};delete r.lease;},owner);
  await appendReportEvent(directory(id),phase,{kind:'error',message});
  console.error('[BrandReport]',id,code,diagnostic);
 }
 async function advance(id:string){
  const owner=randomUUID();let acquired:Runtime|undefined;
  await mutate(id,r=>{if(stoppedPhases.includes(r.phase)||(r.lease?.expiresAt??0)>Date.now()||(r.nextPollAt??0)>Date.now())return;
   r.lease={owner,expiresAt:Date.now()+LEASE};acquired=structuredClone(r);});
  if(!acquired)return;const r:Runtime=acquired;
  try{
   if(r.engine!==ENGINE)throw new BrandReportError('REPORT_LEGACY_STOPPED','旧版执行已停用，已有研究保留为历史记录。请新建 DeepSeek 报告。');
   if(r.workflowHash!==await reportWorkflowFingerprint())throw new BrandReportError('WORKFLOW_VERSION_CHANGED','工作流版本已更新，原报告的阶段结果已保留。请完成旧版本兼容处理后恢复。');
   if(r.phase==='monitoring'){await monitor(id,owner,r);return;}
   if(r.phase==='rendering'){await render(id,owner,r);return;}
   if(r.stages.some(stage=>stage.id==='S4.8')&&!r.confirmation){await mutate(id,state=>{state.phase='awaiting_confirmation';delete state.job;},owner);return;}
   await runModel(id,owner,r);
  }catch(error){await fail(id,owner,r.phase,error).catch(()=>{});}
  finally{await mutate(id,state=>{if(state.lease?.owner===owner)delete state.lease;}).catch(()=>{});}
 }
 async function monitor(id:string,owner:string,r:Runtime){
  const client=reportMonitorClient(core.environment);
  const pending=r.attempts.find(a=>a.status!=='completed'&&(a.nextPollAt??0)<=Date.now());
  if(!pending){if(r.attempts.every(a=>a.status==='completed'))await mutate(id,state=>{state.phase='analyzing';},owner);return;}
  const saveReceipt=async(update:(attempt:ReportMonitorAttempt)=>void)=>{
   try{await mutate(id,state=>{update(state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId)!);},owner);}
   catch(error){
    if(!(error instanceof BrandReportError)||error.code!=='REPORT_LEASE_CHANGED')throw error;
    // A stop can race an already dispatched supplier request. Preserve its
    // receipt under the cancelled parent without scheduling any new action.
    await mutate(id,state=>{if(state.phase==='cancelled'){const attempt=state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId);if(attempt)update(attempt);}});
    throw error;
   }
  };
  if(!pending.taskId){
   await mutate(id,state=>{const a=state.attempts.find(a=>a.consumerTaskId===pending.consumerTaskId)!;a.status='submitting';a.submittedAt??=iso();},owner);
   await appendReportEvent(directory(id),'monitoring',{kind:'tool_start',message:`${pending.platform} · ${pending.question===r.confirmation?.questions[0]?'Q1 可见度':'Q2 风险信任'} · 第 ${pending.run}/5 次采集`,detail:JSON.stringify({question:pending.question,platform:pending.platform,consumerTaskId:pending.consumerTaskId}),toolCallId:pending.consumerTaskId});
   // The supplier documents consumerTaskId as idempotent. An ambiguous retry uses the exact original key and body.
   const taskId=await client.submit(pending,r.brandName);
   await saveReceipt(a=>{a.taskId=taskId;a.status='submitted';a.nextPollAt=Date.now()+300_000;});
   await appendReportEvent(directory(id),'monitoring',{kind:'tool_end',message:`${pending.platform}第 ${pending.run}/5 次采集请求已受理。`,detail:JSON.stringify({supplierTaskId:taskId,consumerTaskId:pending.consumerTaskId,question:pending.question}),toolCallId:pending.consumerTaskId});
  }else{
   if(Date.now()-Math.max(Date.parse(pending.submittedAt??r.createdAt),Date.parse(r.monitorResumedAt??r.createdAt))>4*60*60_000)throw new BrandReportError('MONITOR_TIMEOUT','采集等待时间较长，已保留供应商任务。请检查服务状态后恢复。');
   const sample=await client.poll(pending,r.brandName);
   await saveReceipt(a=>{a.nextPollAt=Date.now()+30_000;if(sample){a.sample=sample;a.status='completed';}});
   if(sample){
    const dir=path.join(directory(id),'harness','work');await mkdir(dir,{recursive:true,mode:0o700});
    const target=path.join(dir,`monitor-${pending.consumerTaskId}.json`),temp=`${target}.${owner}.tmp`;
    await writeFile(temp,JSON.stringify(sample,null,2),{mode:0o600});await rename(temp,target);
    await appendReportEvent(directory(id),'monitoring',{kind:'artifact',message:`${pending.platform}第 ${pending.run}/5 次真实回答已保存，含 ${sample.citations.length} 条引用。`,detail:JSON.stringify(sample,null,2),toolCallId:pending.consumerTaskId});
   }
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
  if(job.phase!=='queued')throw new BrandReportError('HARNESS_INTERRUPTED','执行进程已中断，已有过程与文件已保留。点击恢复后从当前阶段继续。');
  const controller=new AbortController();runningControllers.set(id,controller);
  const emit=async(event:ReportEventInput)=>{
   controller.signal.throwIfAborted();
   await appendReportEvent(directory(id),job.stageId,event);
  };
  let beating=false;
  const heartbeat=setInterval(()=>{
   if(beating)return;beating=true;
   void mutate(id,state=>{
    if(state.phase==='cancelled')throw new Error('REPORT_STOPPED_BY_USER');
   },owner).catch(error=>controller.abort(error)).finally(()=>{beating=false;});
  },20_000);heartbeat.unref();
  try{
   await mutate(id,async(state,tx)=>{
    if(state.job?.id!==job.id)throw new BrandReportError('JOB_CHANGED','报告阶段已变化。');
    state.job.phase='running';
    await tx.update(model.agentTasks).set({providerState:'running'}).where(eq(model.agentTasks.id,job.id));
   },owner);
   await emit({kind:'status',message:`开始 ${job.stageId==='briefing'?'汇报编制':REPORT_STAGES.find(s=>s[0]===job.stageId)?.[1]??job.stageId} · DeepSeek Flash`});
   const value=await runReportHarness({directory:directory(id),jobId:job.id,input:job.input,
    archive:await reportModelArchive(job.input),environment:core.environment,signal:controller.signal,onEvent:emit,recovery:Boolean(job.resumedAt||(!r.job&&r.stages.length)),resumeCurrentStage:Boolean(job.resumedAt),
    onSession:async(sessionId:string)=>{await mutate(id,state=>{state.sessionId=sessionId;},owner);}});
   controller.signal.throwIfAborted();
   let validated:ReturnType<typeof validateReportModelOutput>;
   try{validated=validateReportModelOutput(value,job.input);}
   catch{throw new BrandReportError('MODEL_OUTPUT_INVALID','本阶段内容尚未通过完整性检查，研究文件和过程已保留。可恢复修订当前阶段。');}
   await mutate(id,async(state,tx)=>{
    if(state.job?.id!==job.id)throw new BrandReportError('JOB_CHANGED','报告阶段已变化。');
    if('stage' in validated){state.stages.push(validated.stage as BrandReportStage);if(job.stageId==='S4.8')state.products=validated.products.map(p=>({...p,question:`${p.label}推荐`}));
     if(job.stageId==='S4.8'&&!state.confirmation)state.phase='awaiting_confirmation';}
    else{state.briefingSlides=validated.slides as BrandReportDocument['briefingSlides'];state.phase='rendering';}
    delete state.job;delete state.error;
    await tx.update(model.agentTasks).set({providerState:'completed',updatedAt:new Date()}).where(eq(model.agentTasks.id,job.id));
   },owner);
   await emit({kind:'artifact',message:`${job.stageId==='briefing'?'汇报内容':REPORT_STAGES.find(s=>s[0]===job.stageId)?.[1]??job.stageId}已保存，可展开阅读。`});
  }finally{clearInterval(heartbeat);if(runningControllers.get(id)===controller)runningControllers.delete(id);}
 }
 function directory(id:string){if(!assetRoot||!path.isAbsolute(assetRoot))throw new BrandReportError('REPORT_STORAGE_UNAVAILABLE','报告存储不可用。',503);return path.join(assetRoot,'brand-reports',intentHash([context.accountUserId,context.enterpriseProjectId]),z.string().uuid().parse(id));}
 async function render(id:string,owner:string,r:Runtime){
  await closeReportHarness(directory(id));
  await appendReportEvent(directory(id),'rendering',{kind:'status',message:'研究与汇报内容已完成，正在排版全景报告和汇报报告。'});
  if(!r.confirmation||!r.briefingSlides||r.attempts.some(a=>a.status!=='completed'||!a.sample))throw new BrandReportError('REPORT_INCOMPLETE','诊断证据尚不完整，不能生成最终报告。');
  const doc:BrandReportDocument={schemaVersion:'brand-report-v1',brandName:r.brandName,generatedAt:iso(),overview:r.stages.find(s=>s.id==='S4')!.summary,stages:r.stages,
   monitoring:{confirmedAt:r.confirmation.confirmedAt,questions:r.confirmation.questions,platforms:r.confirmation.platforms,samples:r.attempts.map(a=>a.sample!)},briefingSlides:r.briefingSlides};
  validateBrandReportDocument(doc);
  const panorama=renderPanoramaHtml(doc),briefing=renderBriefingHtml(doc);
  const files:Array<Artifact&{bytes:Buffer}>=[];
  function add(id:ReportArtifactId,label:string,mimeType:string,bytes:Buffer){files.push({id,label,mimeType,bytes,sizeBytes:bytes.length,sha256:digest(bytes)});}
  add('panorama.html','全景报告 · HTML','text/html',Buffer.from(panorama));
  add('briefing.html','汇报报告 · HTML','text/html',Buffer.from(briefing));
  const zip=new JSZip();for(const f of files)zip.file(f.id,f.bytes);zip.file('report-data.json',JSON.stringify(doc,null,2));
  add('reports.zip','全部报告与证据','application/zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const dir=path.join(directory(id),owner);await mkdir(dir,{recursive:true,mode:0o700});
  for(const f of files){const target=path.join(dir,f.id),temp=`${target}.${owner}.tmp`;await writeFile(temp,f.bytes,{mode:0o600});await rename(temp,target);}
  await mutate(id,state=>{state.document=doc;state.artifactGeneration=owner;state.artifacts=files.map(({bytes:_bytes,...f})=>f);state.phase='completed';delete state.error;},owner);
  await appendReportEvent(directory(id),'completed',{kind:'artifact',message:'全景报告 HTML、汇报报告 HTML 和本轮证据包已保存。两份报告使用同一批真实采集数据。'});
 }
 async function artifact(id:string,file:string){
  const owned=await requireOwned(id),r=runtime(owned);if(r.phase!=='completed'||!artifactIds.has(file as ReportArtifactId))throw new BrandReportError('REPORT_FILE_NOT_FOUND','报告文件尚未生成。',404);
  const info=r.artifacts.find(a=>a.id===file);if(!info)throw new BrandReportError('REPORT_FILE_NOT_FOUND','报告文件不存在。',404);
  const bytes=await readFile(path.join(directory(id),z.string().uuid().parse(r.artifactGeneration),info.id));if(bytes.length!==info.sizeBytes||digest(bytes)!==info.sha256)throw new BrandReportError('REPORT_FILE_INVALID','报告文件完整性检查失败，请联系维护人员。',503);
  return {info,bytes,brandName:r.brandName};
 }
 function schedule(id:string){const prior=active.get(id);if(prior)return prior;const task=advance(id).catch(error=>console.error('[BrandReport advance]',id,error instanceof Error?error.name:'unknown')).finally(()=>active.delete(id));active.set(id,task);return task;}
 return {workspace,start,confirm,retry,stop,processView,intermediateDocument,observe,artifact,advance,schedule};
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
   for(const row of rows){const r=runtime(row);if(stoppedPhases.includes(r.phase))continue;
    const owner=Number(row.operation.accountUserId),project=row.operation.enterpriseProjectId??null;
    await model.runWithStoredEnterpriseProjectScope(owner,project,async()=>{
     const context:Context={accountUserId:owner,actorUserId:owner,enterpriseProjectId:project,businessOwnerId:String(owner),businessActorId:String(owner)};
     createBrandReportService(core,context,{id:owner,role:'user'}).schedule(row.operation.id);
    });
   }
  }catch(error){console.error('[BrandReport worker]',error instanceof Error?error.name:'unknown');}finally{busy=false;}
 },15_000);timer.unref();return()=>clearInterval(timer);
}
