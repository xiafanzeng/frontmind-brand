// @vitest-environment node
import {expect,it,vi} from "vitest";
import {createQuestionTemplateGenerationStore} from "../server/question-template-generation";

it("长任务立即返回202，重连与重复提交只发出一次上游调用，成功结果可重复读取",async()=>{
 const store=createQuestionTemplateGenerationStore();let finish!:(value:any)=>void;
 const work=vi.fn(()=>new Promise<any>(resolve=>{finish=resolve;}));
 expect(store.start("account1/project1/actor1","request1",{word:"台资综合医院"},work).status).toBe(202);
 await Promise.resolve();
 expect(store.read("account1/project1/actor1","request1").status).toBe(202);
 expect(store.start("account1/project1/actor1","request1",{word:"台资综合医院"},work).status).toBe(202);
 expect(work).toHaveBeenCalledTimes(1);
 finish({status:200,payload:{data:[{question:"如何选择医院？"}]}});
 await vi.waitFor(()=>expect(store.read("account1/project1/actor1","request1").status).toBe(200));
 expect(store.read("account1/project1/actor1","request1").payload).toEqual({data:[{question:"如何选择医院？"}]});
 expect(store.start("account1/project1/actor1","request1",{word:"台资综合医院"},work).status).toBe(200);
 expect(work).toHaveBeenCalledTimes(1);
});

it("账号、项目和操作者的请求相互隔离，重复标识不能替换输入",async()=>{
 const store=createQuestionTemplateGenerationStore(),work=vi.fn(async()=>({status:200,payload:{data:[]}}));
 store.start("a/p1/u1","same",{word:"甲"},work);
 expect(()=>store.start("a/p1/u1","same",{word:"乙"},work)).toThrow(/其他内容/);
 for(const scope of ["b/p1/u1","a/p2/u1","a/p1/u2"]){
  expect(()=>store.read(scope,"same")).toThrow(/未提交成功/);
  store.start(scope,"same",{word:"甲"},work);
 }
 await Promise.resolve();expect(work).toHaveBeenCalledTimes(4);
});

it("失败结果保留供重读，过期或进程重启不自动重新生成，缓存有数量上限",async()=>{
 let now=0;const store=createQuestionTemplateGenerationStore(()=>now,1,5000);
 const work=vi.fn(async()=>({status:504,payload:{error:{message:"上游超时"}}}));
 store.start("scope","id",{},work);
 expect(()=>store.start("scope","other",{},work)).toThrow(/任务较多/);
 await vi.waitFor(()=>expect(store.read("scope","id").status).toBe(504));
 expect(store.start("scope","id",{},work).status).toBe(504);
 expect(work).toHaveBeenCalledTimes(1);
 now=5001;expect(()=>store.read("scope","id")).toThrow(/已失效/);
 expect(()=>createQuestionTemplateGenerationStore().read("scope","id")).toThrow(/已失效/);
 expect(work).toHaveBeenCalledTimes(1);
});
