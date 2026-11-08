import {and,asc,eq,sql} from "drizzle-orm";
import {z} from "zod";
import type {Request} from "express";
import type {ModuleHttpCore} from "./http-api.js";
import {intentSkillPorts} from "@frontmind/module-brand/server/intent-skill-runtime";
import {createIntentWorkbenchService} from "@frontmind/module-brand/server/intent-workbench-service";

const storedScope=z.object({
  intentContext:z.object({accountUserId:z.number().int().positive(),actorUserId:z.number().int().positive(),enterpriseProjectId:z.string().nullable(),businessOwnerId:z.string(),businessActorId:z.string()}),
  intentActor:z.object({id:z.number().int().positive(),role:z.string().min(1)}),
});

/** Discover durable accepted tasks after page closure or process restart. No model task is reserved here. */
export async function runIntentWorkbenchSweep(core:ModuleHttpCore,serviceFactory=createIntentWorkbenchService){
  const model=intentSkillPorts(),db=await core.database();
  const records=await db.select({operation:model.agentOperations,task:model.agentTasks}).from(model.agentOperations)
    .innerJoin(model.agentTasks,and(eq(model.agentTasks.operationId,model.agentOperations.id),
      sql`${model.agentTasks.createMarker}=CONCAT('brand-intent:',${model.agentOperations.id})`))
    .where(and(eq(model.agentOperations.operationType,"brand_intent_optimization"),
      sql`${model.agentOperations.status} IN ('queued','running','result_pending')`,
      sql`${model.agentTasks.providerState} <> 'paused'`))
    .orderBy(asc(model.agentOperations.updatedAt)).limit(100);
  const scopes=new Map<string,z.infer<typeof storedScope>>();
  for(const {operation,task} of records){
    let runtime=task.providerRuntime;
    if(typeof runtime==="string")try{runtime=JSON.parse(runtime);}catch{continue;}
    const parsed=storedScope.safeParse(runtime);if(!parsed.success)continue;
    const stored=parsed.data,c=stored.intentContext;
    if(operation.accountUserId!==c.accountUserId||(operation.enterpriseProjectId??null)!==c.enterpriseProjectId||stored.intentActor.id!==c.actorUserId)continue;
    scopes.set(JSON.stringify([c.accountUserId,c.enterpriseProjectId,c.actorUserId]),stored);
  }
  const pending=[...scopes.values()];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
    while(cursor<pending.length){
      const stored=pending[cursor++]!,context=stored.intentContext;
      try{
        await model.runWithStoredEnterpriseProjectScope(context.accountUserId,context.enterpriseProjectId,async()=>{
          // Only accepted server-written context is used. Public reads and execute
          // still reconcile the authoritative host catalog before exposing/applying results.
          const workerCore:ModuleHttpCore={...core,context:()=>context,intentQuestionCatalog:undefined};
          const request={frontmindUser:stored.intentActor} as unknown as Request;
          await serviceFactory(workerCore,request).poll();
        });
      }catch(error){console.error("[Brand intent] workspace sweep",error instanceof Error?error.name:"WORKER_ERROR");}
    }
  }));
}

const workers=new WeakSet<object>();
export function startIntentWorkbenchWorker(core:ModuleHttpCore){
  if(workers.has(core))return;
  workers.add(core);let busy=false;
  const tick=async()=>{
    if(busy)return;busy=true;
    try{await runIntentWorkbenchSweep(core);}catch{console.error("[Brand intent] worker unavailable");}finally{busy=false;}
  };
  const timer=setInterval(()=>void tick(),3000);timer.unref();
  setTimeout(()=>void tick(),1000).unref();
}
