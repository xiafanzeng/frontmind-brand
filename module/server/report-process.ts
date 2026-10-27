import {appendFile,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import type {ReportProcessEvent} from '../contracts/report-run.js';

export type ReportEventInput=Omit<ReportProcessEvent,'seq'|'at'|'stageId'>;
const queues=new Map<string,Promise<unknown>>();
const sequences=new Map<string,number>();

/** Only public model text and observed tool receipts enter this ledger. The
 * harness session (which can contain private model state) is never served. */
export async function readReportEvents(directory:string,after=0,limit=200){
 let raw:string;
 try{raw=await readFile(path.join(directory,'process.jsonl'),'utf8');}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 const events:ReportProcessEvent[]=[];
 for(const line of raw.split('\n')){
  if(!line.trim())continue;
  let event:ReportProcessEvent;try{event=JSON.parse(line);}catch{continue;}
  if(Number.isSafeInteger(event.seq)&&event.seq>after)events.push(event);
  if(events.length>=limit)break;
 }
 return events;
}

export async function appendReportEvent(directory:string,stageId:string,event:ReportEventInput){
 const pending=(queues.get(directory)??Promise.resolve()).then(async()=>{
  await mkdir(directory,{recursive:true,mode:0o700});
  if(!sequences.has(directory))sequences.set(directory,(await readReportEvents(directory,0,Number.MAX_SAFE_INTEGER)).at(-1)?.seq??0);
  const next:ReportProcessEvent={seq:sequences.get(directory)!+1,at:new Date().toISOString(),stageId,
   kind:event.kind,message:event.message.slice(0,16000),
   ...(event.detail?{detail:event.detail.slice(0,32000)}:{}),
   ...(event.toolCallId?{toolCallId:event.toolCallId.slice(0,200)}:{})};
  // A preceding newline also isolates any partial last line after a crash.
  await appendFile(path.join(directory,'process.jsonl'),`\n${JSON.stringify(next)}\n`,{mode:0o600});
  sequences.set(directory,next.seq);
 });
 queues.set(directory,pending);
 try{await pending;}finally{if(queues.get(directory)===pending)queues.delete(directory);}
}
