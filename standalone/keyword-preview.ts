import {keywordCategoryKey, type KeywordCategoryKey} from "@frontmind/module-ui/keyword-categories";
import type {ManagedKeywordTable} from "../module/client/dashboard/ManagedKeywordTables";
import type {SavedQuestionSelection} from "../module/client/dashboard/QuestionTemplateApiFlow";

const seed: ManagedKeywordTable[] = [{id:"local-brand",title:"品牌全域词库",description:"本地合成示例",columns:["问题","主分类","问题细分"],rows:[
  ["隆鼻材料应该怎么选","product_scenario","场景方案"],
  ["东莞整形美容医院哪家好","industry","采购决策"],
  ["东莞双眼皮修复医院哪家专业","industry","信任验证"],
  ["隆鼻术后应该如何护理","product_scenario","售后合作"],
  ["整形医院的资质怎么核验","reputation","信任验证"],
  ["不同隆鼻材料的费用有什么区别","product_scenario","采购决策"],
]}];
type Catalog = {revision:number;tables:ManagedKeywordTable[]};
export function readPreviewCatalog(scope:string):Catalog {
  const stored=localStorage.getItem(`frontmind:keyword-preview:v1:${scope}`);
  if(stored)try{return JSON.parse(stored) as Catalog;}catch{}
  return {revision:1,tables:structuredClone(seed)};
}
const normalize=(text:unknown)=>String(text??"").normalize("NFKC").replace(/\s+/gu,"").toLocaleLowerCase();
export function previewCoreWords(brand:string) {
  const medical=/医院|医疗|诊所|口腔|整形/.test(brand);
  const subject=medical?"医疗服务":/科技|软件|智能|硅基/.test(brand)?"智能产品":"产品与服务";
  return [{word:brand,category:"brand"},{word:`${brand}资质与口碑`,category:"brand"},
    {word:subject,category:"category"},{word:medical?"机构选择与比较":"品牌选择与比较",category:"category"},
    {word:medical?"就诊流程与费用":"使用流程与费用",category:"scene"},{word:medical?"诊后随访服务":"售后服务与维护",category:"scene"}];
}
export function previewQuestions(brand:string,coreWords:string[]) {
  const words=previewCoreWords(brand);
  return coreWords.flatMap((coreWord,index)=>{
    const category=words.find(item=>item.word===coreWord)?.category??"scene";
    const mainCategory:KeywordCategoryKey=category==="brand"?"reputation":category==="category"?"industry":"product_scenario";
    const questions=category==="brand"?[`${coreWord}有哪些值得了解的特点？`,`${coreWord}的资质和服务信息如何核验？`]
      :category==="category"?[`选择${coreWord}时应该比较哪些条件？`,`${brand}的${coreWord}适合哪些需求？`]
      :[`${brand}的${coreWord}具体如何安排？`,`${coreWord}有哪些需要提前确认的事项？`];
    return questions.map((question,i)=>({question,coreWord,category,mainCategory,heat:680-index*47-i*31}));
  });
}
export function savePreviewQuestions(scope:string,input:{brand:string;questions:Array<{question:string;mainCategory:KeywordCategoryKey;coreWord?:string;category?:string;heat?:unknown}>}) {
  const catalog=readPreviewCatalog(scope);
  const selections:SavedQuestionSelection[]=[];
  let added=0;
  for(const item of input.questions){
    if(selections.some(selection=>normalize(selection.question)===normalize(item.question)))continue;
    let table=catalog.tables.find(table=>table.rows.some(row=>normalize(row[table.columns.indexOf("问题")])===normalize(item.question)));
    if(!table){
      table=catalog.tables.find(table=>table.id==="question-template-api:v1");
      if(!table){table={id:"question-template-api:v1",title:"已保存的推荐问题",columns:["问题","核心词","核心词分类","问题细分","热度","企业名称","核心词来源"],rows:[]};catalog.tables.push(table);}
      table.rows.push([item.question,item.coreWord??"",item.mainCategory,"",String(item.heat??""),input.brand,item.category??""]);added++;
    }
    const rowIndex=table.rows.findIndex(row=>normalize(row[table.columns.indexOf("问题")])===normalize(item.question));
    const categoryIndex=table.columns.findIndex(column=>["主分类","核心词分类"].includes(column));
    selections.push({question:String(table.rows[rowIndex][table.columns.indexOf("问题")]),category:keywordCategoryKey(table.rows[rowIndex][categoryIndex])??item.mainCategory,tableId:table.id,rowIndex,dashboardRevision:0});
  }
  if(added)catalog.revision++;
  selections.forEach(item=>item.dashboardRevision=catalog.revision);
  localStorage.setItem(`frontmind:keyword-preview:v1:${scope}`,JSON.stringify(catalog));
  return {success:true,added,duplicates:input.questions.length-added,revision:catalog.revision,selections};
}
