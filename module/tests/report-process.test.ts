// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {mkdtemp,appendFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
});
