// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {mkdtemp,appendFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {appendReportEvent,readReportEvents} from '../server/report-process.js';

describe('report public event ledger',()=>{
 it('serializes concurrent writes and recovers valid events around a truncated tail',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'report-events-'));
  try{
   await appendFile(path.join(dir,'process.jsonl'),'\n{"seq":3,"at":"2026-10-26","stageId":"S1","kind":"status","message":"saved"}\n{"seq":4');
   await Promise.all(Array.from({length:12},(_,i)=>appendReportEvent(dir,'S2',{kind:'text',message:`part ${i}`})));
   const all=await readReportEvents(dir);expect(all).toHaveLength(13);expect(all.map(e=>e.seq)).toEqual(Array.from({length:13},(_,i)=>i+3));
   const page=await readReportEvents(dir,7,3);expect(page.map(e=>e.seq)).toEqual([8,9,10]);
   expect(all.every(e=>Object.keys(e).every(k=>['seq','at','stageId','kind','message','detail','toolCallId'].includes(k)))).toBe(true);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('keeps every legacy receipt when separate writers reused or regressed a sequence',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'report-legacy-events-'));
  try{
   const rows=[1,2,2,3,2].map((seq,index)=>({seq,at:'2026-10-27',stageId:'monitoring',kind:'artifact',message:`receipt ${index}`,toolCallId:`paid-task-${index}`}));
   await appendFile(path.join(dir,'process.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
   await appendReportEvent(dir,'monitoring',{kind:'artifact',message:'receipt 5',toolCallId:'paid-task-5'});
   const first=await readReportEvents(dir,0,3),second=await readReportEvents(dir,first.at(-1)!.seq,3);
   expect([...first,...second].map(e=>e.seq)).toEqual([1,2,3,4,5,6]);
   expect([...first,...second].map(e=>e.toolCallId)).toEqual(Array.from({length:6},(_,i)=>`paid-task-${i}`));
   expect(await readReportEvents(dir,6)).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('recovers all records written by independent Node processes with paginated cursors',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'report-process-writers-'));
  try{
   const moduleUrl=pathToFileURL(path.resolve('dist/server/report-process.js')).href;
   const writer=(name:string)=>new Promise<void>((resolve,reject)=>{
    const code=`import {appendReportEvent} from ${JSON.stringify(moduleUrl)};for(let i=0;i<20;i++){await appendReportEvent(${JSON.stringify(dir)},'monitoring',{kind:'artifact',message:${JSON.stringify(name)}+'-'+i,detail:'证据'.repeat(16000),toolCallId:${JSON.stringify(name)}+'-'+i});await new Promise(r=>setTimeout(r,2));}`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','pipe']});let error='';
    child.stderr.on('data',chunk=>{error+=String(chunk);});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error||`writer exit ${code}`)));
   });
   await Promise.all([writer('web'),writer('worker')]);
   const stored=(await readFile(path.join(dir,'process.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
   expect(stored).toHaveLength(40);expect(stored.every(row=>!('seq' in row))).toBe(true);
   let cursor=0;const received=[];
   while(true){const page=await readReportEvents(dir,cursor,7);if(!page.length)break;received.push(...page);cursor=page.at(-1)!.seq;}
   expect(received.map(e=>e.seq)).toEqual(Array.from({length:40},(_,i)=>i+1));
   expect(new Set(received.map(e=>e.toolCallId)).size).toBe(40);
   expect(await readReportEvents(dir)).toEqual(received);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
