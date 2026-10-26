// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';

const mock=vi.hoisted(()=>({ports:null as any,output:null as any,creates:[] as any[],recoveries:[] as any[],clientOptions:[] as any[],createError:null as any,recoverError:null as any,findError:null as any,found:null as any,monitorSubmits:[] as any[],inputs:new Map<string,any>()}));
vi.mock('../server/intent-skill-runtime.js',async()=>{const {createHash}=await import('node:crypto');return {intentSkillPorts:()=>mock.ports,intentHash:(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex')};});
vi.mock('../server/report-model.js',async()=>{return {reportWorkflowFingerprint:async()=> 'workflow-v1',reportModelWireSchema:()=>({type:'object'}),
 reportModelArchive:async(input:any)=>{mock.inputs.set(input.operationToken,input);return Buffer.from(JSON.stringify(input));},validateReportModelOutput:(v:any,input:any)=>{if(v.inputHash!==input.inputHash)throw new Error('WRONG_INPUT');return v;}};});
vi.mock('../server/report-monitor.js',async(original)=>{const real=await original<any>();return {...real,reportMonitorClient:()=>({configured:true,submit:async(a:any)=>{mock.monitorSubmits.push(a);return 'task-'+a.consumerTaskId;},poll:async()=>null})};});
vi.mock('drizzle-orm',()=>{
 const get=(r:any,k:any)=>typeof k==='string'&&k.includes('.')?r[k.split('.')[0]]?.[k.split('.')[1]]:k;
 return {eq:(a:any,b:any)=>(r:any)=>get(r,a)===get(r,b),and:(...predicates:any[])=>(r:any)=>predicates.every(p=>!p||p(r)),desc:(k:any)=>k,
  sql:(strings:TemplateStringsArray,...values:any[])=>{const pattern=strings.join('?');
   if(pattern.includes('<=>'))return (r:any)=>(get(r,values[0])??null)===(get(r,values[1])??null);
   if(pattern.includes('CONCAT'))return (r:any)=>get(r,values[0])===`brand-report:${get(r,values[1])}`;
   return {strings,values};},
 };
});
import {createBrandReportService} from '../server/report-service.js';
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
let db:MemoryDb;
const context={accountUserId:7,actorUserId:7,enterpriseProjectId:'project-a',businessOwnerId:'7',businessActorId:'7'};
const profile={brandName:'测试企业',headline:'企业介绍',summary:'企业真实介绍',sections:[]};
const makeService=(override={})=>createBrandReportService({database:async()=>db as any,context:()=>context,environment:{FRONTMIND_DASHBOARD_ASSET_DIR:'/tmp/report-test',MOLIZHISHU_TOKEN:'test'}},{...context,...override},{id:7,role:'user'});
class ProviderError extends Error{
 constructor(readonly code:string,readonly outcomeUnknown:boolean,readonly status=400){super('private provider error');this.name='ManusV2ApiError';}
}
beforeEach(()=>{
 db=new MemoryDb();mock.creates=[];mock.recoveries=[];mock.clientOptions=[];mock.monitorSubmits=[];mock.inputs.clear();mock.output=null;mock.createError=null;mock.recoverError=null;mock.findError=null;mock.found=null;
 const credential={id:'credential-1',version:0,status:'active',provider:'xty_codex',agentProfile:'frontmind-pro',upstreamModel:'test-model'};
 mock.ports={agentOperations:table('operations'),agentTasks:table('tasks'),assertActorAllowed:()=>{},lockAccountRecord:async()=>{},lockCustomerProjectBusinessWrite:async()=>{},
  getDashboardWorkspace:async()=>({payload:profile}),getDecryptedCredentialForUser:async()=>credential,getApiCredentialStatus:async()=>({status:'active'}),getDecryptedCredentialForAccountById:async()=>credential,
  ManusV2ApiError:ProviderError,recordUpstreamResource:async()=>{},classifyManusV2StructuredResultEnvelope:(v:any)=>({kind:'accepted',value:v}),orderManusV2EventsByProviderRank:(v:any)=>v,latestManusV2TaskState:()=>mock.output?'completed':'running',
  createCredentialAgentClient:(_:any,options:any)=>{mock.clientOptions.push(options);return {uploadFile:async()=>({fileId:'file-1'}),createTask:async(input:any)=>{mock.creates.push(input);if(mock.createError)throw mock.createError;return {taskId:options.localTaskId};},
   recoverMissingCreate:async(input:any)=>{mock.recoveries.push({input,options});if(mock.recoverError)throw mock.recoverError;return {taskId:options.localTaskId};},
   listAllMessages:async()=>mock.output?[{id:'event-'+options.localTaskId,type:'structured_output_result',structured_output_result:mock.output}]:[],taskDetail:async()=>({status:'running'}),findCreatedTask:async()=>{if(mock.findError)throw mock.findError;return {matches:mock.found?[mock.found]:[],unique:mock.found};},sendMessage:async()=>{}};},
 };
});
async function begin(service=makeService()){
 const id=randomUUID();await service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile)});await service.schedule(id);return {id,service};
}
async function finishStage(id:string,service:ReturnType<typeof makeService>){
 const state=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`).providerRuntime.brandReport;
 const input=state.job.input;mock.output={operationToken:input.operationToken,inputHash:input.inputHash,stage:{id:input.stageId,title:input.stageId,summary:'真实阶段结论',markdown:'完整研究正文',sources:[{title:'来源',url:'https://example.org'}]},products:input.stageId==='S4'?[{id:'product',label:'核心产品',question:'核心产品有哪些推荐品牌？'}]:[]};
 await service.schedule(id);mock.output=null;
}
describe('brand report durable lifecycle',()=>{
 it('starts once on replay and keeps task scope separate between projects',async()=>{
  const {id,service}=await begin();
  await service.start({clientRequestId:id,includeKnowledge:false,profileHash:intentHash(profile)});await service.schedule(id);
  expect(mock.creates).toHaveLength(1);expect(db.data.operations).toHaveLength(1);
  await expect(makeService({enterpriseProjectId:'project-b'}).observe(id)).rejects.toMatchObject({code:'REPORT_NOT_FOUND'});
  await expect(service.start({clientRequestId:id,includeKnowledge:true,profileHash:intentHash(profile)})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 });
 it('has exactly one required confirmation after four research stages; refresh cannot dispatch monitoring',async()=>{
  const {id,service}=await begin();
  for(let i=0;i<4;i++){if(i)await service.schedule(id);await finishStage(id,service);}
  const before=await service.observe(id);await service.schedule(id);
  expect(before.phase).toBe('awaiting_confirmation');expect(before.stages).toHaveLength(4);expect(mock.monitorSubmits).toHaveLength(0);
  const after=await service.observe(id);await service.schedule(id);expect(after.revision).toBe(before.revision);
  await expect(service.confirm(id,{expectedRevision:before.revision-1,productId:'product',platforms:['doubao']})).rejects.toMatchObject({code:'REPORT_CHANGED'});
  await service.confirm(id,{expectedRevision:after.revision,productId:'product',platforms:['doubao','yuanbao','qianwen']});await service.schedule(id);
  const state=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`).providerRuntime.brandReport;
  expect(state.attempts).toHaveLength(30);expect(mock.monitorSubmits).toHaveLength(1);
  const first=state.attempts[0].taskId;await service.confirm(id,{expectedRevision:after.revision,productId:'product',platforms:['doubao','yuanbao','qianwen']});await service.schedule(id);
  const current=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`).providerRuntime.brandReport;
  expect(current.attempts[0].taskId).toBe(first);expect(current.attempts).toHaveLength(30);
  await expect(service.confirm(id,{expectedRevision:after.revision,productId:'product',platforms:['doubao']})).rejects.toMatchObject({code:'CONFIRMATION_FROZEN'});
 });
 it('rejects a changed enterprise profile before creating a model task',async()=>{
  await expect(makeService().start({clientRequestId:randomUUID(),includeKnowledge:false,profileHash:'a'.repeat(64)})).rejects.toMatchObject({code:'PROFILE_CHANGED'});
  expect(mock.creates).toHaveLength(0);expect(db.data.operations).toHaveLength(0);
 });
 it('restores the original stage after a process restart and never creates a replacement automatically',async()=>{
  const {id}=await begin();const resumed=makeService();await resumed.schedule(id);
  expect(mock.creates).toHaveLength(1);await finishStage(id,resumed);
  expect((await resumed.observe(id)).stages[0]?.id).toBe('S1');await resumed.schedule(id);
  expect(mock.creates).toHaveLength(2);
 });
 it('extends the wait window on explicit timeout recovery without replacing the original model task',async()=>{
  const {id,service}=await begin();const record=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`);
  const state=record.providerRuntime.brandReport;const original=state.job.id;
  state.job.startedAt=new Date(Date.now()-3*60*60_000).toISOString();state.phase='failed';state.resumePhase='researching';state.error={code:'MODEL_TIMEOUT',message:'timeout'};
  await service.retry(id);await service.schedule(id);
  const current=record.providerRuntime.brandReport;
  expect(current.phase).toBe('researching');expect(current.job.id).toBe(original);expect(current.job.resumedAt).toBeTruthy();expect(mock.creates).toHaveLength(1);
 });

 it('records only a known pre-dispatch schema rejection and retries the same stage identity',async()=>{
  mock.createError=new ProviderError('XTY_STRUCTURED_OUTPUT_SCHEMA_INVALID',false);
  const {id,service}=await begin();const record=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`);
  const original=structuredClone(record.providerRuntime.brandReport.job);
  expect(record.providerRuntime.brandReport).toMatchObject({phase:'failed',error:{code:'MODEL_SCHEMA_REJECTED'},job:{phase:'queued'}});
  await service.schedule(id);expect(mock.creates).toHaveLength(1);
  mock.createError=null;await service.retry(id);await service.schedule(id);
  const current=record.providerRuntime.brandReport;
  expect(current).toMatchObject({phase:'researching',job:{id:original.id,attempt:1,phase:'running',providerTaskId:original.id}});
  expect(current.job.input).toEqual(original.input);expect(db.data.tasks).toHaveLength(2);expect(mock.creates).toHaveLength(2);expect(mock.recoveries).toHaveLength(0);
  expect(mock.clientOptions.every(options=>options.localTaskId===original.id&&options.intentId===original.id)).toBe(true);
 });

 it.each([
  ['XTY_STRUCTURED_OUTPUT_SCHEMA_INVALID',true],
  ['XTY_RUNNER_REQUEST_FAILED',false],
 ])('does not treat %s outcomeUnknown=%s as a proven pre-dispatch rejection',async(code,unknown)=>{
  mock.createError=new ProviderError(code as string,unknown as boolean);
  const {id,service}=await begin();const state=db.data.tasks.find(t=>t.createMarker===`brand-report:${id}`).providerRuntime.brandReport;
  expect(state).toMatchObject({phase:'failed',error:{code:'REPORT_EXECUTION_FAILED'},job:{phase:'create_unknown'}});
  await service.schedule(id);expect(mock.creates).toHaveLength(1);expect(mock.recoveries).toHaveLength(0);
 });

 async function legacyUnknown(){
  mock.createError=new Error('legacy error without saved code');
  const run=await begin();mock.createError=null;
  const record=db.data.tasks.find(t=>t.createMarker===`brand-report:${run.id}`);
  const original=structuredClone(record.providerRuntime.brandReport.job);
  return {...run,record,original};
 }
 it('recovers a legacy missing create only after explicit retry through the fixed-ID provider helper',async()=>{
  const {id,service,record,original}=await legacyUnknown();
  await service.observe(id);await service.schedule(id);expect(mock.recoveries).toHaveLength(0);
  await service.retry(id);await service.schedule(id);
  expect(mock.recoveries).toHaveLength(1);expect(mock.creates).toHaveLength(1);
  expect(mock.recoveries[0].options).toMatchObject({operationId:id,localTaskId:original.id,intentId:original.id});
  expect(mock.recoveries[0].input).toEqual(mock.creates[0]);
  expect(record.providerRuntime.brandReport).toMatchObject({phase:'researching',job:{id:original.id,attempt:original.attempt,phase:'running',providerTaskId:original.id,input:original.input}});
  expect(db.data.tasks).toHaveLength(2);
 });
 it('reattaches an existing legacy task without invoking recovery or creating a replacement',async()=>{
  const {id,service,record,original}=await legacyUnknown();mock.found={id:original.id};
  await service.retry(id);await service.schedule(id);
  expect(mock.recoveries).toHaveLength(0);expect(mock.creates).toHaveLength(1);
  expect(record.providerRuntime.brandReport.job).toMatchObject({id:original.id,providerTaskId:original.id,phase:'running'});
 });
 it('does not interpret an unavailable runner or a conflicting recovery as absence',async()=>{
  const {id,service,record,original}=await legacyUnknown();mock.findError=new ProviderError('XTY_RUNNER_UNREACHABLE',false,503);
  await service.retry(id);await service.schedule(id);
  expect(mock.recoveries).toHaveLength(0);expect(mock.creates).toHaveLength(1);
  mock.findError=null;mock.recoverError=new ProviderError('XTY_CREATE_INTENT_CONFLICT',false,409);
  await service.retry(id);await service.schedule(id);
  expect(mock.recoveries).toHaveLength(1);expect(mock.creates).toHaveLength(1);expect(db.data.tasks).toHaveLength(2);
  expect(record.providerRuntime.brandReport).toMatchObject({phase:'failed',job:{id:original.id,phase:'create_unknown'}});
 });
 it('never falls back to createTask when the provider lacks fixed-ID recovery',async()=>{
  const {id,service,record}=await legacyUnknown();
  const client=mock.ports.createCredentialAgentClient;
  mock.ports.createCredentialAgentClient=(...args:any[])=>{const result=client(...args);delete result.recoverMissingCreate;return result;};
  record.providerRuntime.brandReport.job.createClaimedAt=Date.now()-300_000;
  await service.retry(id);await service.schedule(id);
  expect(mock.recoveries).toHaveLength(0);expect(mock.creates).toHaveLength(1);
  expect(record.providerRuntime.brandReport).toMatchObject({phase:'failed',error:{code:'MODEL_CREATE_UNKNOWN'},job:{phase:'create_unknown'}});
 });

});
