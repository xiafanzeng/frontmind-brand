// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mock=vi.hoisted(()=>({ports:null as any,monitorSubmits:[] as any[],monitorWait:null as any,runs:[] as any[],pending:new Map<string,any>(),workflowHash:'workflow-v2'}));
vi.mock('../server/intent-skill-runtime.js',()=>({intentSkillPorts:()=>mock.ports,intentHash:(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
vi.mock('../server/report-model.js',()=>({reportWorkflowFingerprint:async()=>mock.workflowHash,
 reportModelArchive:async(input:any)=>Buffer.from(JSON.stringify(input)),validateReportModelOutput:(v:any,input:any)=>{if(v.inputHash!==input.inputHash)throw new Error('WRONG_INPUT');return v;}}));
vi.mock('../server/report-harness.js',()=>({
 reportHarnessConfig:()=>({model:'deepseek-flash'}),reportHarnessDocuments:async()=>[],reportHarnessDocument:async()=>({text:'saved'}),closeReportHarness:async()=>{},
 runReportHarness:async(options:any)=>{mock.runs.push(options);await options.onSession('session-1');await options.onEvent({kind:'text',message:'正在核实企业资料。'});
  return new Promise((resolve,reject)=>{mock.pending.set(options.jobId,{resolve,reject,options});options.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});},
}));
vi.mock('../server/report-monitor.js',async(original)=>{const real=await original<any>();return {...real,reportMonitorClient:()=>({configured:true,submit:async(a:any)=>{mock.monitorSubmits.push(a);return mock.monitorWait?await mock.monitorWait:'task-'+a.consumerTaskId;},poll:async()=>null})};});
vi.mock('drizzle-orm',()=>{
 const get=(r:any,k:any)=>typeof k==='string'&&k.includes('.')?r[k.split('.')[0]]?.[k.split('.')[1]]:k;
 return {eq:(a:any,b:any)=>(r:any)=>get(r,a)===get(r,b),and:(...predicates:any[])=>(r:any)=>predicates.every(p=>!p||p(r)),desc:(k:any)=>k,
  sql:(strings:TemplateStringsArray,...values:any[])=>{const pattern=strings.join('?');
   if(pattern.includes('<=>'))return (r:any)=>(get(r,values[0])??null)===(get(r,values[1])??null);
   if(pattern.includes('CONCAT'))return (r:any)=>get(r,values[0])===`brand-report:${get(r,values[1])}`;
   return {strings,values};},
 };
});
import {createBrandReportService,reportView} from '../server/report-service.js';
import {intentHash} from '../server/intent-skill-runtime.js';
const table=(name:string)=>new Proxy({name} as any,{get:(target,key)=>key==='name'?name:`${name}.${String(key)}`});
class MemoryDb{
 data:Record<string,any[]>={operations:[],tasks:[]};pending=Promise.resolve();
 select(projection?:any){const db=this;let tableName='',joined='',join:any,where:any,limit=Infinity;return {
  from(t:any){tableName=t.name;return this;},innerJoin(t:any,on:any){joined=t.name;join=on;return this;},where(p:any){where=p;return this;},orderBy(){return this;},limit(n:number){limit=n;return this;},for(){return this;},
  then(resolve:any,reject:any){try{let rows=db.data[tableName]!.flatMap(item=>joined?db.data[joined]!.map(other=>({[tableName]:item,[joined]:other})):[{[tableName]:item}]);if(join)rows=rows.filter(join);if(where)rows=rows.filter(where);rows=rows.slice(0,limit);
   return Promise.resolve(rows.map(row=>!projection?structuredClone(row[tableName]):Object.fromEntries(Object.entries(projection).map(([k,v]:[string,any])=>[k,typeof v==='string'?row[v.split('.')[0]]?.[v.split('.')[1]]:structuredClone(row[v.name])])))).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject);}}
 };}
 insert(t:any){return {values:async(value:any)=>{if(this.data[t.name]!.some(r=>r.id===value.id))throw new Error('duplicate id');this.data[t.name]!.push({createdAt:new Date(),updatedAt:new Date(),...structuredClone(value)});}};}
 update(t:any){return {set:(changes:any)=>({where:async(predicate:any)=>{for(const row of this.data[t.name]!)if(predicate({[t.name]:row}))Object.assign(row,structuredClone(changes));}})};}
 async execute(){return [[]];}
 transaction<T>(work:(tx:MemoryDb)=>Promise<T>):Promise<T>{const run=this.pending.then(()=>work(this));this.pending=run.then(()=>{},()=>{});return run;}
}

let db:MemoryDb,root:string;
const context={accountUserId:7,actorUserId:7,enterpriseProjectId:'project-a',businessOwnerId:'7',businessActorId:'7'};
const profile={brandName:'测试企业',headline:'企业介绍',summary:'企业真实介绍',sections:[]};
const makeService=(override={})=>createBrandReportService({database:async()=>db as any,context:()=>context,environment:{FRONTMIND_DASHBOARD_ASSET_DIR:root,MOLIZHISHU_TOKEN:'test'}},{...context,...override},{id:7,role:'user'});
const state=(id:string)=>db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`).providerRuntime.brandReport;
const owned=(id:string)=>({operation:db.data.operations.find(o=>o.id===id),task:db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`)});
async function until(check:()=>boolean){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('test did not reach state');}
beforeEach(async()=>{
 root=await mkdtemp(path.join(os.tmpdir(),'brand-report-service-'));db=new MemoryDb();mock.runs=[];mock.pending.clear();mock.monitorSubmits=[];mock.monitorWait=null;mock.workflowHash='workflow-v2';
 mock.ports={agentOperations:table('operations'),agentTasks:table('tasks'),assertActorAllowed:()=>{},lockAccountRecord:async()=>{},lockCustomerProjectBusinessWrite:async()=>{},getDashboardWorkspace:async()=>({payload:profile}),createCredentialAgentClient:()=>{throw new Error('XTY must never run');}};
});
afterEach(async()=>{for(const operation of db.data.operations){const service=makeService();await service.stop(operation.id).catch(()=>{});await service.schedule(operation.id);}await rm(root,{recursive:true,force:true});});
async function begin(){const id=randomUUID(),service=makeService();await service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile)});await until(()=>mock.pending.has(state(id).job?.id));return {id,service};}
async function finishStage(id:string,service:ReturnType<typeof makeService>){
 const job=state(id).job;await until(()=>mock.pending.has(job.id));
 const input=job.input;mock.pending.get(job.id).resolve({operationToken:input.operationToken,inputHash:input.inputHash,
 stage:{id:input.stageId,title:input.stageId,summary:'真实阶段结论',markdown:'完整研究正文',sources:[{title:'来源',url:'https://example.org'}]},
 products:input.stageId==='S4.8'?[{id:'product',label:'核心产品',question:'核心产品有哪些推荐品牌？'}]:[]});await service.schedule(id);
}
describe('DeepSeek report durable lifecycle',()=>{
 it('starts once, binds the server DeepSeek profile, and isolates tenant reads',async()=>{
  const {id,service}=await begin();await service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile)});
  expect(mock.runs).toHaveLength(1);expect(db.data.operations).toHaveLength(1);
  expect(db.data.operations[0]).toMatchObject({provider:'deepseek',upstreamModel:'deepseek-flash',apiCredentialId:'server:brand-report:deepseek'});
  await expect(makeService({enterpriseProjectId:'project-b'}).processView(id,0)).rejects.toMatchObject({code:'REPORT_NOT_FOUND'});
  await expect(service.start({clientRequestId:id,includeKnowledge:true,profileHash:intentHash(profile)})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 });
 it('reuses an active report only for the same frozen inputs and workflow',async()=>{
  const {id,service}=await begin();
  const repeated=await service.start({clientRequestId:randomUUID(),includeKnowledge:false,profileHash:intentHash(profile)});
  expect(repeated.id).toBe(id);expect(db.data.operations).toHaveLength(1);expect(mock.runs).toHaveLength(1);
 });
 it('rejects a new request with a different subject, company snapshot or workflow while a report is active',async()=>{
  const {id,service}=await begin();
  const request=()=>({clientRequestId:randomUUID(),includeKnowledge:false,profileHash:intentHash(profile)});
  await expect(service.start({...request(),subjectScope:'医学美容科'})).rejects.toMatchObject({code:'REPORT_ALREADY_ACTIVE'});
  const updatedProfile={...profile,summary:'已更新的企业介绍'};
  mock.ports.getDashboardWorkspace=async()=>({payload:updatedProfile});
  await expect(service.start({...request(),profileHash:intentHash(updatedProfile)})).rejects.toMatchObject({code:'REPORT_ALREADY_ACTIVE'});
  mock.ports.getDashboardWorkspace=async()=>({payload:profile});mock.workflowHash='workflow-v3';
  await expect(service.start(request())).rejects.toMatchObject({code:'REPORT_ALREADY_ACTIVE'});
  expect(state(id).context.profile).toEqual(profile);expect(state(id).context.subject.scope).toBe('');
  expect(db.data.operations).toHaveLength(1);expect(mock.runs).toHaveLength(1);
 });
 it('compares the full frozen knowledge snapshot before reusing a waiting report',async()=>{
  let documents=[{title:'产品资料',text:'已核实的原始内容'}];
  db.execute=async()=>[[{id:'knowledge-1',documentCount:1,documents}]];
  const id=randomUUID(),service=makeService(),request=()=>({clientRequestId:randomUUID(),includeKnowledge:true,profileHash:intentHash(profile)});
  await service.start({...request(),clientRequestId:id});await until(()=>mock.pending.has(state(id).job?.id));
  await finishStage(id,service);state(id).phase='awaiting_confirmation';
  expect((await service.start(request())).id).toBe(id);
  documents=[{title:'产品资料',text:'同一知识库中的更新内容'}];
  await expect(service.start(request())).rejects.toMatchObject({code:'REPORT_ALREADY_ACTIVE'});
  expect(state(id).context.knowledge).toEqual([{title:'产品资料',text:'已核实的原始内容'}]);
  expect(db.data.operations).toHaveLength(1);expect(mock.runs).toHaveLength(1);
 });
 it('shows public progress while running, persists complete stage documents and paginates without replay',async()=>{
  const {id,service}=await begin();const before=await service.processView(id,0);expect(before.events.some(e=>e.message==='正在核实企业资料。')).toBe(true);
  await finishStage(id,service);const after=await makeService().processView(id,before.nextCursor);
  expect(after.events.every(e=>e.seq>before.nextCursor)).toBe(true);expect(after.documents[0]?.markdown).toBe('完整研究正文');
  expect(new Set([...before.events,...after.events].map(e=>e.seq)).size).toBe(before.events.length+after.events.length);
 });
 it('allows session recovery for a new stage without treating new research as a stage retry',async()=>{
  const {id,service}=await begin();expect(mock.runs[0].resumeCurrentStage).toBe(false);
  await finishStage(id,service);void service.schedule(id);await until(()=>mock.runs.length===2&&mock.pending.has(mock.runs[1].jobId));
  expect(mock.runs[1].input.stageId).toBe('S2');
  expect(mock.runs[1].recovery).toBe(true);expect(mock.runs[1].resumeCurrentStage).toBe(false);
 });
 it('pauses exactly after S4.8 and keeps confirmation and monitoring idempotent',async()=>{
  const {id,service}=await begin();for(let i=0;i<5;i++){if(i){void service.schedule(id);await until(()=>state(id).job?.phase==='running');}await finishStage(id,service);}
  const view=reportView(owned(id));expect(view.phase).toBe('awaiting_confirmation');expect(mock.runs).toHaveLength(5);expect(mock.monitorSubmits).toHaveLength(0);
  await service.schedule(id);expect(mock.runs).toHaveLength(5);
  await expect(service.confirm(id,{expectedRevision:view.revision-1,productId:'product',platforms:['doubao']})).rejects.toMatchObject({code:'REPORT_CHANGED'});
  const selection={expectedRevision:view.revision,productId:'product',platforms:['doubao']};await service.confirm(id,selection);await service.schedule(id);
  const keys=state(id).attempts.map((a:any)=>a.consumerTaskId);await service.confirm(id,selection);await service.schedule(id);
  expect(state(id).attempts.map((a:any)=>a.consumerTaskId)).toEqual(keys);expect(keys).toHaveLength(10);
  expect(new Set(mock.monitorSubmits.map(a=>a.consumerTaskId)).size).toBe(mock.monitorSubmits.length);
 });
 it('stops an active request, retains events and rejects late completion and retry',async()=>{
  const {id,service}=await begin();const pending=mock.pending.get(state(id).job.id);const stopped=await service.stop(id);await service.schedule(id);
  expect(stopped.phase).toBe('cancelled');expect(pending.options.signal.aborted).toBe(true);expect(state(id).stages).toHaveLength(0);
  expect((await service.processView(id,0)).events.length).toBeGreaterThan(0);
  await expect(service.retry(id)).rejects.toMatchObject({code:'REPORT_STOPPED'});await service.schedule(id);expect(mock.runs).toHaveLength(1);
 });
 it('retains a supplier receipt arriving after stop without resuming the report',async()=>{
  const {id,service}=await begin();await finishStage(id,service);
  const r=state(id);r.phase='awaiting_confirmation';r.products=[{id:'product',label:'服务',question:'服务有哪些推荐？'}];
  let accept!:(id:string)=>void;mock.monitorWait=new Promise(resolve=>{accept=resolve;});
  await service.confirm(id,{expectedRevision:r.revision,productId:'product',platforms:['doubao']});await until(()=>mock.monitorSubmits.length===1);
  await service.stop(id);accept('accepted-before-stop');await service.schedule(id);
  expect(state(id).phase).toBe('cancelled');expect(state(id).attempts[0].taskId).toBe('accepted-before-stop');expect(mock.monitorSubmits).toHaveLength(1);
 });
 it('does not restart legacy XTY tasks or user-stopped history',async()=>{
  const {id,service}=await begin();await service.stop(id);await service.schedule(id);
  const r=state(id);delete r.engine;r.phase='failed';r.error={code:'REPORT_STOPPED_BY_USER',message:'stopped'};
  expect(reportView(owned(id))).toMatchObject({phase:'cancelled',canRetry:false});await expect(service.retry(id)).rejects.toMatchObject({code:'REPORT_STOPPED'});
  r.phase='researching';delete r.error;await service.advance(id);
  expect(state(id).error.code).toBe('REPORT_LEGACY_STOPPED');expect(mock.runs).toHaveLength(1);
 });
 it('requires explicit recovery after a harness process interruption',async()=>{
  const {id,service}=await begin();mock.pending.get(state(id).job.id).reject(new Error('process ended'));await service.schedule(id);
  const r=state(id);r.phase='researching';delete r.error;delete r.lease;
  await service.advance(id);expect(state(id).error.code).toBe('HARNESS_INTERRUPTED');expect(mock.runs).toHaveLength(1);
  await service.retry(id);await until(()=>mock.runs.length===2);expect(mock.runs[1].jobId).toBe(mock.runs[0].jobId);
  expect(mock.runs[1].recovery).toBe(true);expect(mock.runs[1].resumeCurrentStage).toBe(true);
 });
 it('reports context capacity failure clearly while preserving current-stage recovery',async()=>{
  const {id,service}=await begin();
  mock.pending.get(state(id).job.id).reject(new Error('REPORT_HARNESS_TURN_ERROR: pi-ai detected context overflow for model "deepseek-flash"'));
  await service.schedule(id);
  const view=reportView(owned(id));
  expect(view).toMatchObject({phase:'failed',canRetry:true,error:{code:'REPORT_CONTEXT_LIMIT'}});
  expect(view.error?.message).toContain('上下文容量不足');expect(view.error?.message).toContain('已有采集结果会继续复用');
  expect(state(id).job.input.operationToken).toBe(mock.runs[0].input.operationToken);
  expect((await service.processView(id,0)).events.at(-1)?.message).toBe(view.error?.message);
 });
 it('freezes a department subject without rewriting the enterprise background',async()=>{
  const id=randomUUID(),service=makeService();
  await service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile),subjectScope:'医学美容科'});
  await until(()=>mock.pending.has(state(id).job?.id));
  expect(state(id).brandName).toBe('测试企业（医学美容科）');
  expect(mock.runs[0].input.context).toMatchObject({profile,subject:{name:'测试企业（医学美容科）',scope:'医学美容科',backgroundBrandName:'测试企业'}});
  await expect(service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile),subjectScope:'康复科'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 });
 it('rejects a stale company snapshot before creating a report',async()=>{
  await expect(makeService().start({clientRequestId:randomUUID(),includeKnowledge:false,profileHash:'a'.repeat(64)})).rejects.toMatchObject({code:'PROFILE_CHANGED'});
  expect(mock.runs).toHaveLength(0);expect(db.data.operations).toHaveLength(0);
 });
});
