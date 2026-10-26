import { Router, type Request } from "express";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {z} from "zod";
// 包名导入保持运行时从模块自身 dist 加载；相对导入会被 Dashboard 构建内联进 bundle，破坏 workflow 清单路径解析。
import {createIntentWorkbenchService, IntentWorkbenchError} from "@frontmind/module-brand/server/intent-workbench-service";

/** Supplied by the host after authentication; never derive ownership from request data. */
export interface ModuleHttpCore {
 context(request:Request):{accountUserId:number;actorUserId:number;enterpriseProjectId:string|null;businessOwnerId:string;businessActorId:string};
 database():Promise<MySql2Database<any>>;
 /** Server-only runtime settings. Never return this object or secret values to the browser. */
 environment:Readonly<Record<string,string|undefined>>;
}

/** Add new module-owned APIs here. Mounted in both Dashboard and the development subdomain. */
export function createModuleHttpApi(core:ModuleHttpCore):Router {
 const router=Router();
 for (const [path, method] of [["/intent/command","command"],["/intent/execute","execute"],["/intent/rollback","rollback"]] as const) {
  router.post(path, async (req,res) => {
   try {
    res.setHeader("Cache-Control","no-store");
    res.json(await createIntentWorkbenchService(core,req)[method](req.body));
   } catch (error) {
    const known=error instanceof IntentWorkbenchError;
    const invalid=error instanceof z.ZodError;
    res.status(known?error.status:invalid?400:503).json({error:{code:known?error.code:invalid?"INVALID_INPUT":"INTENT_UNAVAILABLE",message:known?error.message:invalid?"提交内容格式不正确":"优化工作台暂不可用，请确认数据库迁移已完成后重新读取"}});
   }
  });
 }
 router.get("/intent",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createIntentWorkbenchService(core,req).poll());}
  catch {res.status(503).json({error:{code:"INTENT_UNAVAILABLE",message:"优化工作台暂不可用，请确认数据库迁移已完成后重新读取"}});}
 });
 // API-backed question-template flow. Credentials stay server-side; never pass tokens to the browser.
 const recommendQuestionTemplates = (path:string) => async (req:Request,res:import("express").Response) => {
  res.setHeader("Cache-Control","no-store");
  const token=(core.environment.MOLIZHISHU_TOKEN ?? core.environment.MOLIZHISHU_API_KEY ?? "").trim();
  if(!token){res.status(503).json({error:{code:"MOLIZHISHU_NOT_CONFIGURED",message:"模力指数 API 尚未配置，请由部署人员设置服务端 MOLIZHISHU_TOKEN。"}});return;}
  const companyName=typeof req.body?.companyName === "string" ? req.body.companyName.trim() : typeof req.body?.company_name === "string" ? req.body.company_name.trim() : "";
  if(!companyName || companyName.length>120){res.status(400).json({error:{code:"INVALID_COMPANY_NAME",message:"请填写有效的企业名称。"}});return;}
  if(path.endsWith("recommend-questions")){
   const words=Array.isArray(req.body?.coreWords)?req.body.coreWords:Array.isArray(req.body?.core_words)?req.body.core_words:[];
   if(!words.length || words.length>100 || words.some((word:unknown)=>typeof word!=="string"||!word.trim()||word.length>120)){res.status(400).json({error:{code:"INVALID_CORE_WORDS",message:"请选择一个或多个有效核心词。"}});return;}
  }
  const base=(core.environment.MOLIZHISHU_API_BASE_URL ?? "https://business-api.molizhishu.com").replace(/\/+$/, "").trim();
  const normalizedBase=base;
  try{
   const response=await fetch(`${normalizedBase}/api/business/question-templates/${path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(req.body),signal:AbortSignal.timeout(30_000)});
   const text=await response.text();let payload:unknown;try{payload=JSON.parse(text);}catch{payload={message:"上游接口返回非 JSON 内容。"};}
   const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
   if(!response.ok||record.success===false){res.status(response.ok?502:response.status).json({error:{code:"MOLIZHISHU_UPSTREAM_ERROR",message:typeof record.message==="string"?record.message:"模力指数接口暂时无法完成请求。"}});return;}
   res.status(200).json(payload);
  }catch(error){
   const timeout=error instanceof Error && error.name==="TimeoutError";
   res.status(502).json({error:{code:timeout?"MOLIZHISHU_TIMEOUT":"MOLIZHISHU_UNAVAILABLE",message:timeout?"模力指数接口请求超时，请稍后重试。":"无法连接模力指数接口，请检查服务端网络与配置。"}});
  }
 };
 router.post("/question-templates/recommend-core-words",recommendQuestionTemplates("recommend-core-words"));
 router.post("/question-templates/recommend-questions",recommendQuestionTemplates("recommend-questions"));
 router.get("/capabilities",(req,res)=>{
  const context=core.context(req);
  res.setHeader("Cache-Control","no-store");
  res.json({module:"brand",apiVersion:1,workspaceId:context.enterpriseProjectId,
   features:["knowledge", "keywords", "intent-workbench", "enterprise-qa", "siteops"]});
 });
 return router;
}
