import {captureWorkspaceRestOperation} from "./workspace-rest-scope";

const base="/api/modules/brand/question-templates/";
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"?value as Record<string,unknown>:{};

/** Recover reads of the same generation after a dropped connection; never replay a paid POST. */
export async function generateQuestionTemplate(path:string,body:unknown){
  const operation=captureWorkspaceRestOperation(),requestId=crypto.randomUUID();
  const deadline=Date.now()+150_000;
  const pause=()=>new Promise<void>((resolve,reject)=>{
    operation.assertActive();
    const finish=()=>{clearTimeout(timer);operation.signal?.removeEventListener("abort",abort);resolve();};
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};
    const timer=setTimeout(finish,1500);operation.signal?.addEventListener("abort",abort,{once:true});
  });
  const read=async(url:string,init:RequestInit)=>{
    operation.assertActive();
    const response=await operation.fetch(url,{credentials:"same-origin",...init});
    const payload:unknown=await response.json();operation.assertActive();
    const value=object(payload);
    if(!response.ok||value.success===false||value.error)
      throw new Error(String(object(value.error).message??value.message??"推荐生成失败，请重试。"));
    return {response,payload};
  };
  const transient=(error:unknown)=>error instanceof TypeError||error instanceof SyntaxError;
  let failures=0;
  try{
    const result=await read(`${base}${path}`,{method:"POST",headers:operation.headers({"Content-Type":"application/json","Prefer":"respond-async","X-FrontMind-Request-Id":requestId}),body:JSON.stringify(body)});
    if(result.response.status!==202)return result.payload;
  }catch(error){operation.assertActive();if(!transient(error))throw error;}
  // Even if the POST response was lost, the known request id retrieves its result.
  // A missing/expired task is surfaced instead of starting a second generation.
  while(Date.now()<deadline){
    await pause();
    try{
      const result=await read(`${base}generations/${requestId}`,{method:"GET",headers:operation.headers()});
      failures=0;
      if(result.response.status!==202)return result.payload;
    }catch(error){
      operation.assertActive();
      if(!transient(error))throw error;
      if(++failures>=4)throw new Error("连接暂时中断，未能读取生成结果；当前核心词选择已保留，请稍后重试。");
    }
  }
  throw new Error("生成等待超时，当前核心词选择已保留，请稍后重试。");
}
