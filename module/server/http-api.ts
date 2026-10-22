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
  try {res.setHeader("Cache-Control","no-store");res.json(await createIntentWorkbenchService(core,req).observe());}
  catch {res.status(503).json({error:{code:"INTENT_UNAVAILABLE",message:"优化工作台暂不可用，请确认数据库迁移已完成后重新读取"}});}
 });
 router.get("/capabilities",(req,res)=>{
  const context=core.context(req);
  res.setHeader("Cache-Control","no-store");
  res.json({module:"brand",apiVersion:1,workspaceId:context.enterpriseProjectId,
   features:["knowledge", "keywords", "intent-workbench", "enterprise-qa", "siteops"]});
 });
 return router;
}
