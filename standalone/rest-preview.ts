import {savePreviewAsset} from "./preview-assets";
import {previewCoreWords,previewQuestions,savePreviewQuestions} from "./keyword-preview";
import {responseLogicPreview,PreviewHttpError} from "./response-logic-preview";

/** Preview transport is injected only into the local host; it never falls through to fetch. */
export function createPreviewRestFetch(scope:string){return async(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>=>{
  const request=input instanceof Request?input:undefined;
  const url=new URL(request?.url??String(input),window.location.origin);
  const signal=init.signal??request?.signal;
  if(signal?.aborted)throw new DOMException("操作已取消","AbortError");
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{signal?.removeEventListener("abort",abort);resolve();},350);
    const abort=()=>{clearTimeout(timer);reject(new DOMException("操作已取消","AbortError"));};
    signal?.addEventListener("abort",abort,{once:true});
  });
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
  if(url.origin!==window.location.origin)return json({error:{message:"本地预览只使用 mock 数据"}},403);
  try{
    const method=init.method??request?.method??"GET";
    if(url.pathname==="/api/frontmind/v2/assets"&&method==="POST"&&init.body instanceof Blob)return json(await savePreviewAsset(scope,init.body,new Headers(init.headers)));
    const body=typeof init.body==="string"?JSON.parse(init.body):request?await request.clone().json().catch(()=>({})):{};
    const base="/api/modules/brand/";
    if(url.pathname.startsWith(`${base}question-templates/`)&&method==="POST"){
      const brand=String(body.brand??"").trim();if(!brand)throw new PreviewHttpError("请填写企业名称");
      const action=url.pathname.slice(`${base}question-templates/`.length);
      if(action==="recommend-core-words")return json({coreWords:previewCoreWords(brand)});
      if(action==="recommend-questions")return json({questions:previewQuestions(brand,body.coreWords??[])});
      if(action==="save")return json(savePreviewQuestions(scope,body));
    }
    if(url.pathname===`${base}response-logic`||url.pathname.startsWith(`${base}response-logic/`))return json(await responseLogicPreview(scope,url.pathname.slice(`${base}response-logic`.length),url,method,body));
    throw new PreviewHttpError(`本地预览未实现接口：${url.pathname}`,404,"PREVIEW_ROUTE_NOT_FOUND");
  }catch(error){
    if(error instanceof DOMException&&error.name==="AbortError")throw error;
    return json({error:{code:error instanceof PreviewHttpError?error.code:"PREVIEW_REQUEST_INVALID",message:error instanceof Error?error.message:"预览请求失败"}},error instanceof PreviewHttpError?error.status:400);
  }
};}
