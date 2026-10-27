import {expect,it,vi} from "vitest";
import type {Request} from "express";
import type {BrandKeywordPorts} from "../server/brand-keyword-ports";
import {appendRecommendedQuestions,createQuestionTemplateCatalogService,questionTemplateSaveSchema} from "../server/question-template-catalog-service";
import {createBrandQuestionUniverseService} from "../server/brand-question-universe-service";

const input=questionTemplateSaveSchema.parse({brand:"东莞台心医院",questions:[{question:"综合医院如何选择？",coreWord:"综合医院",category:"category",mainCategory:"industry",heat:12}]});
const table={id:"existing",title:"原有词库",columns:["问题","核心词分类"],rows:[["旧问题？","品牌相关"]]};
class Conflict extends Error {}
function fixture(){
 let workspace={revision:2,payload:{keywordTables:[table],knowledge:{untouched:true}}};
 const update=vi.fn(async (value:any)=>{await value.beforeWrite({});workspace={revision:workspace.revision+1,payload:value.payload};return workspace;});
 const model={assertActorAllowed:vi.fn(),assertServiceCapability:vi.fn(),getDashboardWorkspace:vi.fn(async()=>workspace),updateDashboardWorkspace:update,dashboardPayloadSchema:{parse:(value:any)=>value},DashboardRevisionConflictError:Conflict,lockCustomerProjectBusinessWrite:vi.fn()} as unknown as BrandKeywordPorts;
 const core={context:()=>({accountUserId:7,actorUserId:8,enterpriseProjectId:"project",businessOwnerId:"7",businessActorId:"8"}),database:vi.fn(),environment:{}};
 const request={frontmindUser:{id:8,role:"customer"}} as unknown as Request;
 return {model,core,request,update,read:()=>workspace,service:createQuestionTemplateCatalogService(core,request,()=>model)};
}
it("保留原有词库与看板，保存后重试不产生重复行或新版本",async()=>{
 const f=fixture();
 expect(await f.service.save(input)).toMatchObject({added:1,duplicates:0,revision:3});
 expect(f.read().payload.knowledge).toEqual({untouched:true});
 expect(f.read().payload.keywordTables[0]).toBe(table);
 expect(f.read().payload.keywordTables[1].rows[0]).toEqual(["综合医院如何选择？","综合医院","行业排名词","","12","东莞台心医院","品类相关"]);
 expect(await f.service.save(input)).toMatchObject({added:0,duplicates:1,revision:3});
 expect(f.update).toHaveBeenCalledTimes(1);
 expect(f.model.lockCustomerProjectBusinessWrite).toHaveBeenCalledWith({},7,{id:8,role:"customer"});
});
it("版本竞争后重读并合并，不丢失另一用户保存的问题",async()=>{
 const f=fixture();
 f.update.mockImplementationOnce(async()=>{f.read().revision++;f.read().payload.keywordTables.push({...table,id:"concurrent",rows:[["并发问题？","场景相关"]]});throw new Conflict();});
 expect(await f.service.save(input)).toMatchObject({added:1,revision:4});
 expect(f.read().payload.keywordTables.map(t=>t.id)).toEqual(["existing","concurrent","question-template-api:v1"]);
});
it("跨词表和提交内去重，并拒绝客户端指定账户",()=>{
 const duplicate=questionTemplateSaveSchema.parse({brand:"医院",questions:[{question:"旧 问题？",mainCategory:"industry"},{question:"新问题？",mainCategory:"reputation"},{question:"新问题？",mainCategory:"industry"}]});
 expect(appendRecommendedQuestions([table],duplicate)).toMatchObject({added:1,duplicates:2});
 expect(()=>questionTemplateSaveSchema.parse({...input,accountUserId:99})).toThrow();
});
it("错误身份不能读取或写入词库",async()=>{
 const f=fixture();
 f.request.frontmindUser=undefined;
 await expect(f.service.save(input)).rejects.toMatchObject({status:403});
 expect(f.model.getDashboardWorkspace).not.toHaveBeenCalled();
 expect(f.update).not.toHaveBeenCalled();
});
it("无词库权限不能写入",async()=>{
 const f=fixture();
 vi.mocked(f.model.assertServiceCapability).mockRejectedValueOnce(new Error("denied"));
 await expect(f.service.save(input)).rejects.toThrow("denied");
 expect(f.update).not.toHaveBeenCalled();
});
it("旧生成服务拒绝新任务，不读取知识包或派发上游",async()=>{
 const model={assertActorAllowed:vi.fn(),getDashboardWorkspace:vi.fn(),getDb:vi.fn()} as unknown as BrandKeywordPorts;
 const service=createBrandQuestionUniverseService(model);
 await expect(service.startBrandQuestionUniverse({actor:{id:7,role:"customer"},value:{} as any})).rejects.toMatchObject({code:"GENERATION_RETIRED",statusCode:410});
 expect(model.getDb).not.toHaveBeenCalled();
 expect(model.getDashboardWorkspace).not.toHaveBeenCalled();
});
