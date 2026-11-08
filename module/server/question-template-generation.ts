import {createHash} from "node:crypto";

type Result = {status:number; payload:unknown};
type Entry = {fingerprint:string; result?:Result; expiresAt:number};
export class QuestionTemplateGenerationError extends Error {
  constructor(readonly status:number, readonly code:string, message:string){super(message);}
}

/** Short polling keeps slow recommendations off a single long browser connection.
 * Results are temporary and process-local; a missing task is never silently resubmitted. */
export function createQuestionTemplateGenerationStore(now=Date.now, capacity=100, retentionMs=300_000){
  const entries=new Map<string,Entry>();
  const key=(scope:string,id:string)=>JSON.stringify([scope,id]);
  const prune=()=>{for(const [id,entry] of entries)if(entry.result&&entry.expiresAt<=now())entries.delete(id);};
  const snapshot=(id:string,entry:Entry):Result=>entry.result??{status:202,payload:{generation:{id,status:"running"}}};
  return {
    start(scope:string,id:string,input:unknown,work:()=>Promise<Result>):Result {
      prune();
      const cacheKey=key(scope,id),fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const previous=entries.get(cacheKey);
      if(previous){
        if(previous.fingerprint!==fingerprint)throw new QuestionTemplateGenerationError(409,"GENERATION_CONFLICT","生成标识已用于其他内容，请重新发起生成。");
        return snapshot(id,previous);
      }
      if(entries.size>=capacity)throw new QuestionTemplateGenerationError(503,"GENERATION_BUSY","生成任务较多，请稍后重试。");
      const entry:Entry={fingerprint,expiresAt:Infinity};
      entries.set(cacheKey,entry);
      // Store before dispatch, so a repeated POST shares the existing operation.
      void Promise.resolve().then(work).catch(()=>({status:502,payload:{error:{code:"GENERATION_FAILED",message:"推荐生成暂时失败，请重试。"}}})).then(result=>{
        entry.result=result;entry.expiresAt=now()+retentionMs;
      });
      return snapshot(id,entry);
    },
    read(scope:string,id:string):Result {
      prune();const entry=entries.get(key(scope,id));
      if(!entry)throw new QuestionTemplateGenerationError(404,"GENERATION_MISSING","生成任务已失效或未提交成功，请保留当前选择并重新生成。");
      return snapshot(id,entry);
    },
  };
}
