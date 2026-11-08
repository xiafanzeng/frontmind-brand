import { Router, type Request, type Response } from "express";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {z} from "zod";
import {requestQuestionTemplate} from "./question-template-request.js";
import {assertQuestionTemplateAccess,createQuestionTemplateCatalogService,QuestionTemplateCatalogError} from "./question-template-catalog-service.js";
// 包名导入保持运行时从模块自身 dist 加载；相对导入会被 Dashboard 构建内联进 bundle，破坏 workflow 清单路径解析。
import {createIntentWorkbenchService, IntentWorkbenchError} from "@frontmind/module-brand/server/intent-workbench-service";
import {assembleResponseLogicCore} from "@frontmind/module-brand/server/response-logic-runtime";
import {createResponseLogicApi} from "@frontmind/module-brand/server/response-logic-api";
import {createResponseLogicRecordRouter} from "@frontmind/module-brand/server/response-logic-record-api";
import {createResponseLogicCredentialMiddleware} from "@frontmind/module-brand/server/response-logic-credential-middleware";
import {createDiagnosticRouter} from "@frontmind/module-brand/server/diagnostic-api";
import type {IntentQuestion} from "../contracts/intent-workbench.js";
import type {ResponseLogicHostPorts} from "./response-logic-runtime.js";
import {
 createEnterpriseRagEvaluationService,
 EnterpriseRagEvaluationError,
} from "@frontmind/module-brand/server/enterprise-rag-evaluation-service";
import { recordRagEvaluationError } from "@frontmind/module-brand/server/enterprise-rag-evaluation-errors";
import {createRagStarterQuestionService,RagStarterQuestionError} from "@frontmind/module-brand/server/rag-starter-question-service";
import {
 createEnterpriseRagHumanReviewService,
 EnterpriseRagHumanReviewError,
} from "@frontmind/module-brand/server/enterprise-rag-human-review-service";
import {createEnterpriseRagGovernanceService} from "@frontmind/module-brand/server/enterprise-rag-governance-service";

import type { DiagnosticCollectionPort } from "./diagnostic-monitor.js";

/** Supplied by the host after authentication; never derive ownership from request data. */
export interface ModuleHttpCore {
 context(request:Request):{accountUserId:number;actorUserId:number;enterpriseProjectId:string|null;businessOwnerId:string;businessActorId:string};
 database():Promise<MySql2Database<any>>;
 /** Server-only runtime settings. Never return this object or secret values to the browser. */
 environment:Readonly<Record<string,string|undefined>>;
 /** Host-owned formal questions are projected without replacing their authority. */
 intentQuestionCatalog?(request:Request):Promise<IntentQuestion[]>;
 responseLogicHost?:ResponseLogicHostPorts;
 diagnosticCollection?:DiagnosticCollectionPort;
}

/** Add new module-owned APIs here. Mounted in both Dashboard and the development subdomain. */
export function createModuleHttpApi(core:ModuleHttpCore):Router {
 const router=Router();
 router.use('/diagnostics',createDiagnosticRouter(core));
 const sendStarterError=(res:Response,error:unknown)=>{
  const known=error instanceof RagStarterQuestionError;
  const invalid=error instanceof z.ZodError;
  res.status(known?error.status:invalid?400:503).json({error:{
   code:known?error.code:invalid?"INVALID_INPUT":"RAG_STARTER_UNAVAILABLE",
   message:known?error.message:invalid?"预设问题内容不符合要求。":"预设问题服务暂时无法读取，请稍后重试。",
  }});
 };
 router.get("/rag-starter-questions",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createRagStarterQuestionService(core,req).read());}
  catch(error){sendStarterError(res,error);}
 });
 router.post("/rag-starter-questions/regenerations",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.status(202).json(await createRagStarterQuestionService(core,req).regenerate(req.body));}
  catch(error){sendStarterError(res,error);}
 });
 router.put("/rag-starter-questions/current",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createRagStarterQuestionService(core,req).confirm(req.body));}
  catch(error){sendStarterError(res,error);}
 });
 router.delete("/rag-starter-questions/draft",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createRagStarterQuestionService(core,req).discard(req.body));}
  catch(error){sendStarterError(res,error);}
 });
 const ragEvaluationCoordinate=z.object({
  sourceQaTaskId:z.string().uuid(),
  turnId:z.string().uuid(),
 }).strict();
 const sendRagEvaluationError=(res:Response,error:unknown,action:"start"|"history"|"observe")=>{
  const failure=recordRagEvaluationError(error,action);
  const {requestId}=failure;
  res.setHeader("X-FrontMind-Request-Id",requestId);
  res.status(failure.status).json({error:{code:failure.code,message:failure.message,requestId}});
 };
 const sendRagReviewError=(res:Response,error:unknown)=>{
  const known=error instanceof EnterpriseRagEvaluationError || error instanceof EnterpriseRagHumanReviewError;
  const invalid=error instanceof z.ZodError;
  res.status(known?error.status:invalid?400:503).json({error:{
   code:known?error.code:invalid?"INVALID_INPUT":"RAG_EVALUATION_UNAVAILABLE",
   message:known?error.message:invalid?"人工评审内容不符合要求。":"人工评审服务暂时无法读取，请稍后重试。",
  }});
 };
 router.post("/rag-evaluations",async(req,res)=>{
  try {
   res.setHeader("Cache-Control","no-store");
   res.status(202).json(await createEnterpriseRagEvaluationService(core,req).start(req.body));
  } catch(error) {sendRagEvaluationError(res,error,"start");}
 });
 router.get("/rag-evaluations",async(req,res)=>{
  try {
   res.setHeader("Cache-Control","no-store");
   const coordinate=ragEvaluationCoordinate.parse(req.query);
   res.json(await createEnterpriseRagEvaluationService(core,req).latest(coordinate.sourceQaTaskId,coordinate.turnId));
  } catch(error) {sendRagEvaluationError(res,error,"history");}
 });
 router.get("/rag-evaluations/:operationId/review-context",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagHumanReviewService(core,req).context(z.string().uuid().parse(req.params.operationId)));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.get("/rag-evaluations/:operationId/reviews",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagHumanReviewService(core,req).list(z.string().uuid().parse(req.params.operationId)));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.get("/rag-evaluations/:operationId",async(req,res)=>{
  try {
   res.setHeader("Cache-Control","no-store");
   const operationId=z.string().uuid().parse(req.params.operationId);
   res.json(await createEnterpriseRagEvaluationService(core,req).observe(operationId));
  } catch(error) {sendRagEvaluationError(res,error,"observe");}
 });
 router.post("/rag-evaluation-reviews",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.status(201).json(await createEnterpriseRagHumanReviewService(core,req).create(req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.post("/rag-evaluation-review-cases/:caseId/reconcile",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagHumanReviewService(core,req).reconcile(z.string().uuid().parse(req.params.caseId),req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.get("/rag-evaluation-records/:reportId/lineage",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagHumanReviewService(core,req).lineage(z.string().uuid().parse(req.params.reportId)));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.post("/rag-evaluation-governance/bootstrap",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagGovernanceService(core,req).initialize(req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.post("/rag-evaluation-optimization-runs",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.status(202).json(await createEnterpriseRagGovernanceService(core,req).startOptimization(req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.get("/rag-evaluation-optimization-runs/:runId",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagGovernanceService(core,req).optimization(req.params.runId));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.post("/rag-evaluation-proposals/:proposalId/regression-runs",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.status(202).json(await createEnterpriseRagGovernanceService(core,req).startRegression(req.params.proposalId,req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.get("/rag-evaluation-regression-runs/:runId",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.json(await createEnterpriseRagGovernanceService(core,req).regression(req.params.runId));}
  catch(error){sendRagReviewError(res,error);}
 });
 router.post("/rag-evaluation-versions/:versionId/releases",async(req,res)=>{
  try {res.setHeader("Cache-Control","no-store");res.status(201).json(await createEnterpriseRagGovernanceService(core,req).release(req.params.versionId,req.body));}
  catch(error){sendRagReviewError(res,error);}
 });
 for (const [path, method] of [["/intent/command","command"],["/intent/execute","execute"],["/intent/rollback","rollback"],["/intent/control","control"]] as const) {
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
 router.get("/intent/stream",async(req,res)=>{
  const parsed=z.string().uuid().safeParse(req.query.jobId);
  if(!parsed.success){res.status(400).json({error:{message:"任务标识格式不正确"}});return;}
  const service=createIntentWorkbenchService(core,req);
  let closed=false;
  res.on("close",()=>{closed=true;});
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache, no-transform");
  res.setHeader("X-Accel-Buffering","no");
  res.flushHeaders();
  let last="";
  try {
   // Each connection is bounded; clients can safely fall back to GET reads.
   for(let attempt=0;attempt<120 && !closed;attempt++){
    const workspace=await service.poll();
    if(closed)break;
    const job=workspace.state.jobs?.find(item=>item.id===parsed.data);
    if(!job){res.write('event: unavailable\ndata: {}\n\n');break;}
    const payload=JSON.stringify(job);
    if(payload!==last){res.write(`event: progress\ndata: ${payload}\n\n`);last=payload;}
    else res.write(": heartbeat\n\n");
    if(["succeeded","failed"].includes(job.status))break;
    await new Promise<void>(resolve=>{
     const timer=setTimeout(done,2500);
     function done(){clearTimeout(timer);res.off("close",done);resolve();}
     res.once("close",done);
    });
   }
  } catch {if(!closed)res.write('event: unavailable\ndata: {}\n\n');}
  finally {if(!closed)res.end();}
 });
 // API-backed question-template flow. Credentials stay server-side; never pass tokens to the browser.
 const recommendQuestionTemplates = (path:string) => async (req:Request,res:import("express").Response) => {
  res.setHeader("Cache-Control","no-store");
  const token=(core.environment.MOLIZHISHU_TOKEN ?? core.environment.MOLIZHISHU_API_KEY ?? "").trim();
  // 线上实测契约：两个 recommend 端点部署在 business.molizhishu.com，企业字段名为 brand。
  const brand=typeof req.body?.brand === "string" ? req.body.brand.trim() : "";
  if(!brand || brand.length>120){res.status(400).json({error:{code:"INVALID_BRAND",message:"请填写有效的企业名称。"}});return;}
  if(path.endsWith("recommend-questions")){
   const words=Array.isArray(req.body?.coreWords)?req.body.coreWords:Array.isArray(req.body?.core_words)?req.body.core_words:[];
   if(!words.length || words.length>100 || words.some((word:unknown)=>typeof word!=="string"||!word.trim()||word.length>120)){res.status(400).json({error:{code:"INVALID_CORE_WORDS",message:"请选择一个或多个有效核心词。"}});return;}
  }
  const base=(core.environment.MOLIZHISHU_API_BASE_URL ?? "https://business.molizhishu.com").replace(/\/+$/, "").trim();
  const normalizedBase=base;
  try{
   await assertQuestionTemplateAccess(core,req);
   if(!token){res.status(503).json({error:{code:"MOLIZHISHU_NOT_CONFIGURED",message:"模力指数 API 尚未配置，请由部署人员设置服务端 MOLIZHISHU_TOKEN。"}});return;}
   const response=await requestQuestionTemplate(normalizedBase,path,token,req.body);
   const text=await response.text();let payload:unknown;try{payload=JSON.parse(text);}catch{payload={message:"上游接口返回非 JSON 内容。"};}
   const record=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
   if(!response.ok||record.success===false){res.status(response.ok?502:response.status).json({error:{code:"MOLIZHISHU_UPSTREAM_ERROR",message:typeof record.message==="string"?record.message:"模力指数接口暂时无法完成请求。"}});return;}
   res.status(200).json(payload);
  }catch(error){
   if(error instanceof QuestionTemplateCatalogError){res.status(error.status).json({error:{code:error.code,message:error.message}});return;}
   const timeout=error instanceof Error && error.name==="TimeoutError";
   res.status(timeout?504:502).json({error:{code:timeout?"MOLIZHISHU_TIMEOUT":"MOLIZHISHU_UNAVAILABLE",message:timeout?"模力指数生成超过2分钟仍未返回，请稍后重试。":"无法连接模力指数接口，请检查服务端网络与配置。"}});
  }
 };
 router.post("/question-templates/recommend-core-words",recommendQuestionTemplates("recommend-core-words"));
 router.post("/question-templates/recommend-questions",recommendQuestionTemplates("recommend-questions"));
 router.post("/question-templates/save",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try {res.json(await createQuestionTemplateCatalogService(core,req).save(req.body));}
  catch(error){
   const known=error instanceof QuestionTemplateCatalogError,invalid=error instanceof z.ZodError;
   const denied=error instanceof Error&&["FORBIDDEN","ACTOR_INVALID","CAPABILITY_UNAVAILABLE"].includes(String((error as Error&{code?:string}).code));
   res.status(known?error.status:invalid?400:denied?403:503).json({error:{
    code:known?error.code:invalid?"INVALID_INPUT":denied?"FORBIDDEN":"CATALOG_UNAVAILABLE",
    message:known?error.message:invalid?"请选择有效的推荐问题。":denied?"当前账号暂无词库保存权限。":"词库保存暂不可用，请稍后重试。",
   }});
  }
 });
 // Response-logic full API — generation, materials, adopt, task status,
 // evaluation, judge, optimizer — all mounted via the original Intent
 // router factory (response-logic-api.ts, 2,236 lines) with runtime ports
 // assembled from BrandKeywordPorts + Brand ledger question resolver.
 const rlRuntime = assembleResponseLogicCore({ getDb: () => core.database(), environment: core.environment, host: core.responseLogicHost });
 // The module namespace mount has no Core credential attachment middleware;
 // resolve the server-side credential (XTY-aware keyword chain) for the
 // response-logic routes before the handlers read it.
 router.use("/response-logic", createResponseLogicCredentialMiddleware(core));
 // Record list/save first (exact "/" match, falls through for everything
 // else), then the full migrated router: generation, materials, adopt, task
 // status, evaluation, judge, optimizer.
 router.use("/response-logic", createResponseLogicRecordRouter(core, rlRuntime));
 router.use("/response-logic", createResponseLogicApi(rlRuntime as never).router);

 router.get("/capabilities",(req,res)=>{
  const context=core.context(req);
  res.setHeader("Cache-Control","no-store");
  res.json({module:"brand",apiVersion:1,workspaceId:context.enterpriseProjectId,
   features:["diagnostics", "knowledge", "keywords", "intent-workbench", "response-logic", "enterprise-qa", "enterprise-rag-evaluation", "enterprise-rag-human-review", "siteops"]});
 });
 return router;
}
