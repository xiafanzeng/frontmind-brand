// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';

const mock=vi.hoisted(()=>({spawn:null as any}));
vi.mock('node:child_process',()=>({spawn:(...args:any[])=>mock.spawn(...args)}));
vi.mock('../server/report-model.js',()=>({validateReportModelOutput:(value:unknown)=>value}));
import {runReportHarness} from '../server/report-harness.js';

let directory:string;
afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
it.each(['REPORT_LEASE_CHANGED','REPORT_HEARTBEAT_FAILED'])('preserves the %s abort reason through the actual harness runner',async code=>{
 directory=await mkdtemp(path.join(os.tmpdir(),'report-harness-abort-'));
 let started!:()=>void;const pending=new Promise<void>(resolve=>{started=resolve;});
 mock.spawn=()=>{
  const child=new EventEmitter() as any;child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,_encoding,done){
   const command=JSON.parse(String(chunk));
   if(command.type==='run')started();
   if(command.type==='close')queueMicrotask(()=>child.emit('close',0));
   done();
  }});
  queueMicrotask(()=>child.stdout.write(`${JSON.stringify({type:'ready'})}\n`));return child;
 };
 const controller=new AbortController(),zip=new JSZip();zip.file('SKILL.md','离线终止原因测试');
 const running=runReportHarness({directory,jobId:'test-stage',input:{stageId:'S1',operationToken:'test',inputHash:'test'} as any,
  archive:await zip.generateAsync({type:'nodebuffer'}),environment:{REPORT_DEEPSEEK_API_KEY:'offline-test',REPORT_HARNESS_NODE_BIN:process.execPath},signal:controller.signal});
 await pending;
 const reason=Object.assign(new Error('执行器租约或数据库续租失败'),{code});
 const rejected=expect(running).rejects.toBe(reason);controller.abort(reason);await rejected;
});
