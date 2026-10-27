import {readDocument} from './safe-files.mjs';

/** Transport assembly only: the service still validates the complete frozen output schema. */
export async function assembleStageOutput(root,stage,args){
 if((args.output!==undefined)===(args.json!==undefined))throw new Error('REPORT_OUTPUT_ARGUMENTS: 提供结构化 output 对象，或旧版 json 字符串，不能同时提供。优先 output + markdownPath，避免长正文二次转义。');
 let value=args.output;
 if(args.json!==undefined){
  try{value=JSON.parse(args.json);}catch(error){throw new Error(`REPORT_OUTPUT_JSON_INVALID: ${error.message}。这是 JSON 结构错误，不是正文长度限制。请勿缩短正文。改用结构化 output 对象及 markdownPath 引用已保存的完整正文；stage 与 products 必须为根对象的并列字段，先闭合 stage 再写 products。`);}
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('REPORT_OUTPUT_OBJECT_REQUIRED');
 if(value.operationToken!==stage.operationToken||value.inputHash!==stage.inputHash)throw new Error('REPORT_OUTPUT_INPUT_MISMATCH');
 if(stage.stageId==='briefing'){
  if(args.markdownPath!==undefined||!Array.isArray(value.slides)||value.slides.length!==13)throw new Error('REPORT_BRIEFING_SHAPE: 汇报 output 使用根字段 slides（13项），不使用 stage 或 markdownPath。');
 }else{
  if(!value.stage||typeof value.stage!=='object'||Array.isArray(value.stage)||!Array.isArray(value.products)||'products' in value.stage)
   throw new Error('REPORT_STAGE_SHAPE: output 根字段为 operationToken、inputHash、stage、products；products 与 stage 并列，不能放入 stage 内。');
  if(value.stage.id!==stage.stageId)throw new Error('REPORT_OUTPUT_STAGE_MISMATCH');
  if(args.markdownPath!==undefined){
   if(typeof args.markdownPath!=='string'||!args.markdownPath.startsWith(`work/${stage.stageId}-`)||!/^work\/[^/]+\.md$/.test(args.markdownPath))throw new Error('REPORT_OUTPUT_MARKDOWN_SCOPE_DENIED');
   const markdown=await readDocument(root,args.markdownPath);
   if(!markdown.trim())throw new Error('REPORT_OUTPUT_MARKDOWN_EMPTY');
   value={...value,stage:{...value.stage,markdown}};
  }
  if(typeof value.stage.markdown!=='string'||!value.stage.markdown.trim())throw new Error('REPORT_OUTPUT_MARKDOWN_REQUIRED: 先保存完整正文，再用 markdownPath 引用；不要用摘要代替正文。');
 }
 return value;
}
