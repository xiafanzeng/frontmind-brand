// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mysqlTable,varchar,int,timestamp} from "drizzle-orm/mysql-core";
const workerPorts=vi.hoisted(()=>({value:undefined as any}));
vi.mock("@frontmind/module-brand/server/intent-skill-runtime",()=>({intentSkillPorts:()=>workerPorts.value}));
import {runIntentWorkbenchSweep,startIntentWorkbenchWorker} from "../server/intent-workbench-worker";
import type {BrandKeywordPorts} from "../server/brand-keyword-ports";
import type {ModuleHttpCore} from "../server/http-api";

const operations=mysqlTable("worker_operations",{id:varchar("id",{length:191}),accountUserId:int("accountUserId"),enterpriseProjectId:varchar("enterpriseProjectId",{length:191}),operationType:varchar("operationType",{length:191}),status:varchar("status",{length:191}),updatedAt:timestamp("updatedAt")});
const tasks=mysqlTable("worker_tasks",{operationId:varchar("operationId",{length:191}),createMarker:varchar("createMarker",{length:191}),providerState:varchar("providerState",{length:191})});
function accepted(id="one",owner=42,project:string|null="project"){
  return {operation:{id,accountUserId:owner,enterpriseProjectId:project},task:{providerRuntime:{
    intentContext:{accountUserId:owner,actorUserId:owner,enterpriseProjectId:project,businessOwnerId:String(owner),businessActorId:String(owner)},
    intentActor:{id:owner,role:"user"},
  }}};
}
function setup(records:any[]){
  const limit=vi.fn(async()=>records);
  const db={select:()=>({from:()=>({innerJoin:()=>({where:()=>({orderBy:()=>({limit})})})})})};
  const scope=vi.fn(async(_owner:number,_project:string|null,action:()=>unknown)=>action());
  workerPorts.value={agentOperations:operations,agentTasks:tasks,runWithStoredEnterpriseProjectScope:scope} as unknown as BrandKeywordPorts;
  const catalog=vi.fn();
  const core={database:async()=>db,context:()=>{throw new Error("HTTP-only context");},intentQuestionCatalog:catalog,environment:{}} as unknown as ModuleHttpCore;
  const poll=vi.fn(async()=>({}));
  const factory=vi.fn((workerCore:ModuleHttpCore,request:any)=>{
    expect(workerCore.context(request).actorUserId).toBe(request.frontmindUser.id);
    expect(workerCore.intentQuestionCatalog).toBeUndefined();
    return {poll};
  });
  return {core,scope,poll,factory,limit,catalog,records};
}
beforeEach(()=>vi.restoreAllMocks());
describe("意图任务持久化后台推进",()=>{
  it("从数据库发现任务并恢复原账号项目范围，重复工作区仅扫描一次",async()=>{
    const a=accepted(),b=accepted("two");b.task.providerRuntime=JSON.stringify(b.task.providerRuntime) as any;
    const h=setup([a,b,accepted("three",43,"other")]);
    await runIntentWorkbenchSweep(h.core,h.factory as any);
    expect(h.scope.mock.calls.map(call=>call.slice(0,2))).toEqual([[42,"project"],[43,"other"]]);
    expect(h.factory).toHaveBeenCalledTimes(2);expect(h.poll).toHaveBeenCalledTimes(2);
    expect(h.catalog).not.toHaveBeenCalled();
  });
  it("不接受缺失或错配的持久化账号、项目、操作人上下文",async()=>{
    const owner=accepted(),project=accepted(),actor=accepted();
    owner.operation.accountUserId=43;project.operation.enterpriseProjectId="another";
    actor.task.providerRuntime.intentActor.id=43;
    const h=setup([owner,project,actor,{...accepted(),task:{providerRuntime:"invalid"}},{...accepted(),task:{providerRuntime:{input:{}}}}]);
    await runIntentWorkbenchSweep(h.core,h.factory as any);
    expect(h.scope).not.toHaveBeenCalled();expect(h.factory).not.toHaveBeenCalled();
  });
  it("一个工作区异常不阻塞其他工作区，也不向日志输出正文或凭据",async()=>{
    const h=setup([accepted(),accepted("two",43,"other")]);
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    h.poll.mockRejectedValueOnce(new Error("private credential and knowledge"));
    await runIntentWorkbenchSweep(h.core,h.factory as any);
    expect(h.poll).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("[Brand intent] workspace sweep","Error");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private credential");
  });
  it("每轮从持久化队列重新发现任务，不依赖页面或内存注册",async()=>{
    const h=setup([]);await runIntentWorkbenchSweep(h.core,h.factory as any);
    expect(h.poll).not.toHaveBeenCalled();h.records.push(accepted());
    await runIntentWorkbenchSweep(h.core,h.factory as any);
    expect(h.poll).toHaveBeenCalledTimes(1);
  });
  it("同一实例仅启动一个后台定时器",()=>{
    vi.useFakeTimers();
    try {const h=setup([]);startIntentWorkbenchWorker(h.core);startIntentWorkbenchWorker(h.core);expect(vi.getTimerCount()).toBe(2);}
    finally {vi.clearAllTimers();vi.useRealTimers();}
  });
});
