import {createHash} from 'node:crypto';

export type ReportSample = {
 id:string;platform:string;question:string;answer:string;mentioned:boolean;rank:number|null;
 citations:Array<{title:string;url:string;site?:string}>;
};
export type ReportMonitorAttempt = {
 consumerTaskId:string;question:string;platform:string;run:number;
 status:'queued'|'submitting'|'submitted'|'completed'|'failed';
 taskId?:string;submittedAt?:string;nextPollAt?:number;error?:string;sample?:ReportSample;
};
export class ReportMonitorError extends Error {
 constructor(readonly code:string,message:string,readonly ambiguous=false){super(message);}
}
export function reportMonitorAttempts(reportId:string,questions:readonly string[],platforms:readonly string[]) {
 return questions.flatMap(question=>platforms.flatMap(platform=>Array.from({length:5},(_,run)=>({
  consumerTaskId:`fm${createHash('sha256').update(JSON.stringify(['brand-report-v1',reportId,question,platform,run])).digest('hex')}`.slice(0,64),
  question,platform,run:run+1,status:'queued' as const,
 }))));
}
const record=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const items=(v:any):any[]=>Array.isArray(v)?v:['subTaskList','results','resultList','subTasks','list','records','items'].map(k=>v?.[k]).find(Array.isArray)??[];
const safeUrl=(value:unknown)=>{try{const u=new URL(String(value));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const positiveRank=(value:unknown)=>{
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^\d+$/.test(value.trim()))return null;
 const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;
};
const exactKeyword=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').trim().toLocaleLowerCase():'';

export function reportSampleFromResult(attempt:ReportMonitorAttempt,brandName:string,raw:unknown):ReportSample {
 const data=record(raw);
 const all=items(raw);const candidates=(all.length?all:[data]).filter(v=>v.platform===attempt.platform);
 if(candidates.length!==1)throw new ReportMonitorError('SAMPLE_MISMATCH','采集结果与本轮平台不一致，未写入报告。');
 const v=record(candidates[0]);
 const question=String(v.prompt??v.question??attempt.question);
 if(question!==attempt.question)throw new ReportMonitorError('QUESTION_MISMATCH','采集返回了不同的问题，未写入报告。');
 const answer=String(v.answerContent??v.answer??v.content??'').trim();
 if(!answer||['failed','error','cancelled'].includes(String(v.status).toLowerCase()))throw new ReportMonitorError('SAMPLE_FAILED','本条采集未取得有效回答。');
 // mentionPosition is the supplier's monitored-keyword field. Generic rank is a
 // compatibility fallback only; a missing or non-positive rank is never made up.
 const rank=positiveRank(v.mentionPosition)??positiveRank(v.rank);
 const keywordMatched=items(v.keywordEvaluations).some(entry=>
  exactKeyword(entry?.keyword)===exactKeyword(brandName)&&
  ['positive','neutral','negative'].includes(String(entry?.nature??'').toLowerCase()));
 // Each request contains exactly this enterprise as monitorKeywords. Use the
 // supplier's explicit attribution even when its answer uses an abbreviation;
 // never infer an unknown alias or count another enterprise's evaluation.
 const mentioned=rank!==null||keywordMatched||answer.toLocaleLowerCase().includes(brandName.toLocaleLowerCase());
 const citations=items(v.citationList??v.citations).map(c=>({title:String(c.title??c.name??'引用来源'),url:safeUrl(c.url??c.link),site:String(c.media??c.site??c.domain??'')})).filter(c=>c.url);
 return {id:attempt.consumerTaskId,platform:attempt.platform,question:attempt.question,answer,
  mentioned,rank,citations};
}

export function reportMonitorClient(environment:Readonly<Record<string,string|undefined>>) {
 const token=(environment.MOLI_API_TOKEN??environment.MOLIZHISHU_TOKEN??environment.MOLIZHISHU_API_KEY??'').trim();
 const origin=(environment.MOLI_API_ORIGIN??environment.MOLIZHISHU_API_BASE_URL??'https://business-api.molizhishu.com').replace(/\/+$/,'');
 async function request(path:string,body?:unknown) {
  if(!token)throw new ReportMonitorError('MONITOR_NOT_CONFIGURED','诊断采集服务尚未配置，请联系维护人员。');
  let response:Response;
  try{response=await fetch(`${origin}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25_000)});}
  catch{throw new ReportMonitorError('MONITOR_NETWORK','采集服务连接暂未确认，将使用原任务标识恢复。',!!body);}
  const raw=await response.text();let envelope:any;
  try{envelope=JSON.parse(raw);}catch{throw new ReportMonitorError('MONITOR_RESPONSE','采集服务返回格式异常，请稍后恢复。',!!body);}
  if(!response.ok||envelope.success===false||(envelope.code!==undefined&&![0,200,'0','200','SUCCESS','success'].includes(envelope.code)))
   throw new ReportMonitorError('MONITOR_REJECTED',`采集服务未完成请求（HTTP ${response.status}），请检查服务状态后重试。`,!!body&&response.status>=500);
  return envelope.data??envelope;
 }
 return {
  configured:!!token,
  async submit(a:ReportMonitorAttempt,brandName:string) {
   const data=await request('/api/business/monitor/task/batch/shared',{
    monitorKeywords:brandName,monitorKeywordAliases:[],competitors:[],prompts:[a.question],
    platforms:[{platform:a.platform,mode:'search',screenshot:0}],consumerTaskId:a.consumerTaskId,
   });
   const id=String(data.taskId??data.id??data.monitorTaskId??'');
   if(!id)throw new ReportMonitorError('MONITOR_SUBMISSION_UNKNOWN','采集提交结果尚未确认，将保留原任务标识。',true);
   return id;
  },
  async poll(a:ReportMonitorAttempt,brandName:string) {
   if(!a.taskId)throw new ReportMonitorError('MONITOR_TASK_MISSING','采集任务标识不存在。');
   const state=await request(`/api/business/monitor/task/status/${encodeURIComponent(a.taskId)}`);
   const status=String(state.status??state.taskStatus??'').toLowerCase();
   if(['failed','error','cancelled'].includes(status))throw new ReportMonitorError('MONITOR_FAILED','采集服务已确认本条任务失败，已保存其他结果，请联系维护人员处理失败样本。');
   if(!['completed','success','done','finished','stopped'].includes(status))return null;
   return reportSampleFromResult(a,brandName,await request(`/api/business/monitor/task/result/${encodeURIComponent(a.taskId)}`));
  },
 };
}
