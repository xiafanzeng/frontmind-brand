import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {listDocuments,readDocument,writeDocument} from '../workflows/report-harness/safe-files.mjs';
import {validateReportModelOutput,type ReportModelInput} from './report-model.js';
import {REPORT_STAGES} from '../contracts/report-run.js';

export type ReportHarnessEvent={kind:'status'|'text'|'tool_start'|'tool_end'|'usage'|'artifact'|'error';message:string;detail?:string;toolCallId?:string};
type EventSink=(event:ReportHarnessEvent)=>void|Promise<void>;
export type ReportHarnessOptions={directory:string;jobId:string;input:ReportModelInput;archive:Buffer;environment:NodeJS.ProcessEnv;signal?:AbortSignal;recovery?:boolean;resumeCurrentStage?:boolean;onEvent?:EventSink;onSession?:(sessionId:string)=>void|Promise<void>};
type Pending={requestId:string;resolve:(text:string)=>void;reject:(error:Error)=>void;onEvent?:EventSink;events:Promise<void>};
type Worker={child:ChildProcessWithoutNullStreams;root:string;sessionId:string;pending?:Pending;ready:Promise<void>;closed:boolean;closing?:Promise<void>;idle?:ReturnType<typeof setTimeout>};
const workers=new Map<string,Worker>();
const require=createRequire(import.meta.url);
const host=fileURLToPath(new URL('../workflows/report-harness/host.mjs',import.meta.url));
export const REPORT_HARNESS_VERSION='deepseek-harness-0.2.0-rc.2/report-v1';
export function reportHarnessConfig(environment:NodeJS.ProcessEnv=process.env){
 if(!environment.REPORT_DEEPSEEK_API_KEY?.trim())throw new Error('REPORT_DEEPSEEK_API_KEY_MISSING');
 return {model:'deepseek-flash' as const,provider:'deepseek' as const,credentialId:'server:brand-report:deepseek',version:REPORT_HARNESS_VERSION};
}
function nodeExecutable(environment:NodeJS.ProcessEnv){
 if(environment.REPORT_HARNESS_NODE_BIN)return path.resolve(environment.REPORT_HARNESS_NODE_BIN);
 if(Number(process.versions.node.split('.')[0])>=24)return process.execPath;
 if(process.platform==='linux'&&process.arch==='x64')return require.resolve('node-linux-x64/bin/node');
 throw new Error('REPORT_HARNESS_NODE24_REQUIRED');
}
const reportRoot=(directory:string)=>path.join(path.resolve(directory),'harness');
export async function reportHarnessDocuments(directory:string){
 const root=reportRoot(directory);try{await access(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 return listDocuments(root,'work');
}
export async function reportHarnessDocument(directory:string,id:string){
 if(!/^work\/[^/]+\.(md|json)$/.test(id))throw new Error('REPORT_DOCUMENT_SCOPE_DENIED');
 return {id,title:path.basename(id),text:await readDocument(reportRoot(directory),id)};
}
function failure(value:unknown){return value instanceof Error?value:new Error(String(value));}
async function closeWorker(worker:Worker){
 if(worker.closing)return worker.closing;
 worker.closing=(async()=>{
  clearTimeout(worker.idle);if(worker.closed)return;
  const exited=new Promise<void>(resolve=>worker.child.once('close',()=>resolve()));
  worker.child.stdin.end(`${JSON.stringify({type:'close'})}\n`);
  let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(()=>{try{if(process.platform!=='win32'&&worker.child.pid)process.kill(-worker.child.pid,'SIGKILL');else worker.child.kill('SIGKILL');}catch{}resolve();},15000);})]);clearTimeout(timer);
  worker.closed=true;
  await writeDocument(worker.root,'session.json',JSON.stringify({sessionId:worker.sessionId,status:'closed',updatedAt:new Date().toISOString()}));
  if(workers.get(worker.root)===worker)workers.delete(worker.root);
 })();return worker.closing;
}
export async function closeReportHarness(directory:string){const worker=workers.get(reportRoot(directory));if(worker)await closeWorker(worker);}
async function workerFor(options:ReportHarnessOptions){
 const root=reportRoot(options.directory);const existing=workers.get(root);if(existing&&!existing.closed&&!existing.closing){clearTimeout(existing.idle);return existing;}
 if(existing?.closing)await existing.closing;
 if(workers.size>=2){const idle=[...workers.values()].find(worker=>!worker.pending);if(idle)await closeWorker(idle);else throw new Error('REPORT_HARNESS_CAPACITY: 报告研究正在占用执行资源，请稍后继续。');}
 await mkdir(path.join(root,'work'),{recursive:true,mode:0o700});
 let previous:unknown;try{previous=JSON.parse(await readDocument(root,'session.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(previous&&!options.recovery)throw new Error('REPORT_HARNESS_SESSION_INTERRUPTED: 原执行进程已结束，请明确从已保存的阶段检查点继续。');
 const sessionId=randomUUID();await writeDocument(root,'session.json',JSON.stringify({sessionId,previousSession:previous??null,status:'starting',updatedAt:new Date().toISOString()}));
 await options.onSession?.(sessionId);
 if(previous)await options.onEvent?.({kind:'status',message:'从已保存的阶段检查点恢复',detail:'原 Harness 会话已结束。本次建立新会话，读取已有阶段产物，不重跑已完成阶段或监测。'});
 const environment:NodeJS.ProcessEnv={};for(const name of ['PATH','LANG','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR'])if(options.environment[name])environment[name]=options.environment[name];
 environment.REPORT_DEEPSEEK_API_KEY=options.environment.REPORT_DEEPSEEK_API_KEY;environment.HOME=path.join(root,'home');
 const child=spawn(nodeExecutable(options.environment),[host,root,sessionId],{cwd:root,env:environment,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
 let readyResolve!:()=>void,readyReject!:(error:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const worker:Worker={child,root,sessionId,ready,closed:false};workers.set(root,worker);let stderr='';
 const scrub=(text:string)=>text.replaceAll(options.environment.REPORT_DEEPSEEK_API_KEY!,'[REDACTED]').slice(0,5000);
 child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-5000);});
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{
  if(line.length>1024*1024){void closeWorker(worker);return;}
  let frame:{type:string;requestId?:string;event?:ReportHarnessEvent;text?:string;message?:string};try{frame=JSON.parse(line);}catch{return;}
  if(frame.type==='ready'){readyResolve();return;}
  const pending=worker.pending;
  if(frame.type==='fatal'){const error=new Error(scrub(frame.message??'REPORT_HARNESS_FAILED'));readyReject(error);pending?.reject(error);void closeWorker(worker);return;}
  if(!pending||frame.requestId!==pending.requestId)return;
  if(frame.type==='event'&&frame.event){const event=frame.event;pending.events=pending.events.then(async()=>{await pending.onEvent?.(event);});pending.events.catch(error=>{pending.reject(failure(error));void closeWorker(worker);});}
  else if(frame.type==='result'||frame.type==='error'){
   worker.pending=undefined;void pending.events.then(()=>frame.type==='result'?pending.resolve(frame.text??''):pending.reject(new Error(scrub(frame.message??'REPORT_HARNESS_FAILED'))),pending.reject);
  }
 });
 child.on('error',error=>{readyReject(error);worker.pending?.reject(error);});
 child.once('close',(code)=>{worker.closed=true;if(!worker.closing&&workers.get(root)===worker)workers.delete(root);clearTimeout(worker.idle);const error=new Error(`REPORT_HARNESS_SESSION_INTERRUPTED (${code}): ${scrub(stderr)}`);readyReject(error);worker.pending?.reject(error);worker.pending=undefined;});
 const startupTimer=setTimeout(()=>{readyReject(new Error('REPORT_HARNESS_STARTUP_TIMEOUT'));void closeWorker(worker);},60000);
 try{await ready;}finally{clearTimeout(startupTimer);}return worker;
}
async function stageFiles(options:ReportHarnessOptions,root:string){
 if(![...REPORT_STAGES.map(stage=>String(stage[0])),'briefing'].includes(options.input.stageId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(options.jobId))throw new Error('REPORT_STAGE_ID_INVALID');
 const inputDirectory=`stages/${options.jobId}`;const archive=await JSZip.loadAsync(options.archive);let total=0;
 for(const [name,entry] of Object.entries(archive.files)){
  if(entry.dir)continue;if(entry.unsafeOriginalName&&entry.unsafeOriginalName!==name)throw new Error('REPORT_ARCHIVE_PATH_INVALID');
  if(!/\.(md|json)$/.test(name)||(typeof entry.unixPermissions==='number'&&(entry.unixPermissions&0o170000)===0o120000))throw new Error('REPORT_ARCHIVE_ENTRY_INVALID');
  const text=await entry.async('string');total+=Buffer.byteLength(text);if(total>8*1024*1024)throw new Error('REPORT_ARCHIVE_TOO_LARGE');
  await writeDocument(root,`${inputDirectory}/${name}`,text);
 }
 return {jobId:options.jobId,stageId:options.input.stageId,inputHash:options.input.inputHash,operationToken:options.input.operationToken,inputDirectory};
}
async function turn(worker:Worker,stage:Record<string,string>,prompt:string,onEvent?:EventSink){
 if(worker.pending)throw new Error('REPORT_HARNESS_ALREADY_RUNNING');
 return new Promise<string>((resolve,reject)=>{
  const requestId=randomUUID();worker.pending={requestId,resolve,reject,onEvent,events:Promise.resolve()};
  worker.child.stdin.write(`${JSON.stringify({type:'run',requestId,stage,prompt})}\n`,error=>{if(error){worker.pending=undefined;reject(error);}});
 });
}
export async function runReportHarness(options:ReportHarnessOptions){
 reportHarnessConfig(options.environment);options.signal?.throwIfAborted();
 const worker=await workerFor(options);if(worker.pending)throw new Error('REPORT_HARNESS_ALREADY_RUNNING');
 const abort=()=>{worker.pending?.reject(failure(options.signal?.reason??new Error('REPORT_HARNESS_ABORTED')));void closeWorker(worker);};options.signal?.addEventListener('abort',abort,{once:true});
 try{
  options.signal?.throwIfAborted();const stage=await stageFiles(options,worker.root);
  const prompt=`本轮执行阶段 ${stage.stageId}。先调用 list_report_files，然后完整读取 ${stage.inputDirectory}/SKILL.md、input.json、OUTPUT_SCHEMA.json 与本阶段 workflow Skill。只完成该阶段，保留真实来源和全部必需内容。先前阶段与冻结监测数据在 input.json 中。持续报告当前动作与发现；用 write_research_note 保存中间分析，便于用户查看。搜索使用公开网页工具，无法检索时注明限制，不捏造成功。当前只运行本阶段，不添加暂停点，也不继续下一阶段。完成时先用 write_research_note 保存完整阶段正文，再调用 save_stage_output：用 output 结构化对象提供 operationToken、inputHash、stage 元信息/来源与根级 products，另用 markdownPath 引用该完整正文，工具会填充 stage.markdown；不要把整个结果再编码为 JSON 字符串，也不要因为格式错误缩短正文。汇报阶段用结构化 output.slides。最后简短说明已保存结果。${options.resumeCurrentStage?'这是技术恢复：优先完整读取 work/ 中已有的本阶段全稿、来源与修订，复用已核实研究，只修复未完成产物。若 work/ 中存在明确标记的验收审校反馈，先读取并逐项核对修订；反馈本身不得作为事实来源。核对来源归属：尚未核验与企业关系的站点不能称为官方或一手；研究推断须明确标记，尚无本轮监测时不能断言GEO风险或竞争压力的主要性。保留完整表格与正文，不能选择短版探测文件代替全稿。':''}`;
  let text=await turn(worker,stage,prompt,options.onEvent);
  for(let repair=0;repair<2;repair++){
   options.signal?.throwIfAborted();
   try{
    let raw;try{raw=await readDocument(worker.root,`work/${stage.stageId}-${stage.jobId}-output.json`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;raw=text;}
    const result=validateReportModelOutput(JSON.parse(raw),options.input);
    await writeDocument(worker.root,'session.json',JSON.stringify({sessionId:worker.sessionId,status:'idle',stageId:stage.stageId,updatedAt:new Date().toISOString()}));
    return result;
   }catch(error){
    if(repair===1)throw error;
    await options.onEvent?.({kind:'status',message:'正在修正阶段产物格式',detail:failure(error).message.slice(0,3000)});
    text=await turn(worker,stage,`本阶段产物未通过校验：${failure(error).message.slice(0,6000)}。请检查本阶段 OUTPUT_SCHEMA.json，修正并再次调用 save_stage_output。保留原 operationToken、inputHash、已核查事实与来源。只允许本次结构修复，不重做监测、不跳到其他阶段。`,options.onEvent);
   }
  }
  throw new Error('REPORT_HARNESS_OUTPUT_MISSING');
 }finally{
  options.signal?.removeEventListener('abort',abort);
  if(options.signal?.aborted)await closeWorker(worker);
  if(!worker.closed&&!worker.closing){worker.idle=setTimeout(()=>void closeWorker(worker),15*60*1000);worker.idle.unref();}
 }
}
