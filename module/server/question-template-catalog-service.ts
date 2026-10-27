import type {Request} from "express";
import {z} from "zod";
import type {ModuleHttpCore} from "./http-api.js";
import type {BrandKeywordPorts} from "./brand-keyword-ports.js";
import {intentSkillPorts} from "@frontmind/module-brand/server/intent-skill-runtime";

const questionSchema=z.object({
 question:z.string().trim().min(2).max(500),
 coreWord:z.string().trim().max(120).default(""),
 category:z.string().trim().max(80).default(""),
 mainCategory:z.enum(["industry","competitor_comparison","reputation","product_scenario"]),
 heat:z.union([z.string().max(80),z.number().finite(),z.null()]).optional(),
}).strict();
export const questionTemplateSaveSchema=z.object({
 brand:z.string().trim().min(1).max(120),
 questions:z.array(questionSchema).min(1).max(160),
}).strict();
type Table={id:string;title:string;description?:string;columns:string[];rows:string[][]};
const TABLE_ID="question-template-api:v1";
const categoryLabels:Record<string,string>={brand:"品牌相关",brand_related:"品牌相关",category:"品类相关",category_related:"品类相关",scene:"场景相关",scenario:"场景相关"};
const mainCategoryLabels={industry:"行业排名词",competitor_comparison:"竞品对比词",reputation:"美誉舆情词",product_scenario:"产品场景词"};
const normalize=(value:string)=>value.normalize("NFKC").replace(/\s+/gu,"").toLocaleLowerCase();
export class QuestionTemplateCatalogError extends Error {
 constructor(public code:string,message:string,public status=409){super(message);}
}

/** Preserve every existing row and table; deduplicate question text across the whole catalog. */
export function appendRecommendedQuestions(tables:Table[],input:z.infer<typeof questionTemplateSaveSchema>){
 const seen=new Set<string>();
 for(const table of tables){
  const index=table.columns.findIndex(column=>normalize(column)==="问题");
  if(index>=0)for(const row of table.rows)seen.add(normalize(row[index]??""));
 }
 const rows:string[][]=[];
 for(const item of input.questions){
  const key=normalize(item.question);
  if(seen.has(key))continue;
  seen.add(key);
  rows.push([item.question,item.coreWord,mainCategoryLabels[item.mainCategory],"",String(item.heat??""),input.brand,categoryLabels[item.category]??item.category]);
 }
 if(!rows.length)return {tables,added:0,duplicates:input.questions.length};
 const existing=tables.find(table=>table.id===TABLE_ID);
 const columns=["问题","核心词","核心词分类","问题细分","热度","企业名称","核心词来源"];
 if(existing&&(JSON.stringify(existing.columns)!==JSON.stringify(columns)))
  throw new QuestionTemplateCatalogError("CATALOG_FORMAT_CONFLICT","推荐问题词库格式已变更，请联系支持人员。");
 if(!existing&&tables.length>=20)
  throw new QuestionTemplateCatalogError("CATALOG_CAPACITY","词库表数量已达上限，请先整理现有词库。");
 if((existing?.rows.length??0)+rows.length>10_000)
  throw new QuestionTemplateCatalogError("CATALOG_CAPACITY","推荐问题词库已达上限，请先整理现有问题。");
 const next=existing
  ?tables.map(table=>table.id===TABLE_ID?{...table,rows:[...table.rows,...rows]}:table)
  :[...tables,{id:TABLE_ID,title:"已保存的推荐问题",description:"根据企业名称和所选核心词推荐，经确认后保存。",columns,rows}];
 return {tables:next,added:rows.length,duplicates:input.questions.length-rows.length};
}

export function createQuestionTemplateCatalogService(core:ModuleHttpCore,request:Request,ports:()=>BrandKeywordPorts=intentSkillPorts){
 return {async save(value:unknown){
  const context=core.context(request);
  const actor=(request as Request&{frontmindUser?:{id:number;role:string}}).frontmindUser;
  if(!actor||actor.id!==context.actorUserId)
   throw new QuestionTemplateCatalogError("ACTOR_INVALID","当前账号无权修改此工作区。",403);
  const model=ports();
  model.assertActorAllowed(actor);
  try {await model.assertServiceCapability(context.accountUserId,"globalKeywords");}
  catch(error){
   const known=error as {statusCode?:number;code?:string;message?:string};
   if([403,409,412].includes(known.statusCode??0))
    throw new QuestionTemplateCatalogError(known.code??"FORBIDDEN",known.message??"当前账号暂无词库保存权限。",known.statusCode);
   throw error;
  }
  const input=questionTemplateSaveSchema.parse(value);
  for(let attempt=0;attempt<3;attempt++){
   const workspace=await model.getDashboardWorkspace(context.accountUserId);
   const merged=appendRecommendedQuestions(workspace.payload.keywordTables,input);
   if(!merged.added)return {success:true,added:0,duplicates:merged.duplicates,revision:workspace.revision};
   try {
    const published=await model.updateDashboardWorkspace({
     userId:context.accountUserId,actorUserId:actor.id,
     payload:model.dashboardPayloadSchema.parse({...workspace.payload,keywordTables:merged.tables}),
     expectedRevision:workspace.revision,businessSubmission:true,
     beforeWrite:(tx:unknown)=>model.lockCustomerProjectBusinessWrite(tx,context.accountUserId,actor),
     sourceName:"recommended-questions.json",reason:"客户将所选推荐问题追加保存到全域词库",
    });
    return {success:true,added:merged.added,duplicates:merged.duplicates,revision:published.revision};
   }catch(error){
    if(!(error instanceof model.DashboardRevisionConflictError))throw error;
   }
  }
  throw new QuestionTemplateCatalogError("REVISION_CONFLICT","词库正在被更新，请稍后重新保存。");
 }};
}
