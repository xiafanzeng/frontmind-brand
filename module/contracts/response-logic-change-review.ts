import {z} from "zod";
import {fingerprintLogic, LOGIC_FIELDS, type LogicSections} from "./response-logic-evaluation.js";
import type {OptimizationOutput} from "./response-logic-optimization.js";

const offset=z.number().int().nonnegative();
export const textChangeSchema=z.object({
  id:z.string(), kind:z.enum(["adjust","add","remove"]),
  beforeStart:offset, beforeEnd:offset, afterStart:offset, afterEnd:offset,
  reasonIndexes:z.array(offset), reasonScope:z.enum(["excerpt","section","none"]),
}).strict();
export type TextChange=z.infer<typeof textChangeSchema>;
export const optimizationReviewSchema=z.object({
  version:z.literal(1), sourceFingerprint:z.string(), candidateFingerprint:z.string(),
  fields:z.object({concern:z.array(textChangeSchema),conclusion:z.array(textChangeSchema),facts:z.array(textChangeSchema),boundaries:z.array(textChangeSchema)}).strict(),
}).strict();
export type OptimizationReview=z.infer<typeof optimizationReviewSchema>;
export type ReviewedOptimization=OptimizationOutput & {review?:OptimizationReview};

// Sentence boundaries retain punctuation and whitespace. Offsets use JS UTF-16,
// so slicing reproduces the exact server-validated text, including emoji/newlines.
function sentences(text:string):string[]{return text.match(/[^。！？!?；;\r\n]+[。！？!?；;]*|[。！？!?；;]+|\r\n|[\r\n]/gu)??[];}

/** Bounded, deterministic text comparison. Never produces a reason or changes content. */
export function compareLogicText(before:string,after:string):TextChange[]{
  if(before===after)return [];
  const a=sentences(before),b=sentences(after),operations:Array<{kind:"same"|"remove"|"add";text:string}>=[];
  if((a.length+1)*(b.length+1)>160_000){
    // Bound CPU/memory for large documents while retaining the complete changed text.
    let prefix=0,suffix=0;
    while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
    while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
    operations.push(...a.slice(0,prefix).map(text=>({kind:"same" as const,text})));
    operations.push({kind:"remove",text:a.slice(prefix,a.length-suffix).join("")},{kind:"add",text:b.slice(prefix,b.length-suffix).join("")});
    operations.push(...a.slice(a.length-suffix).map(text=>({kind:"same" as const,text})));
  }else{
    const width=b.length+1,dp=new Uint32Array((a.length+1)*width);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i*width+j]=a[i]===b[j]?dp[(i+1)*width+j+1]+1:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
    let i=0,j=0;
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){operations.push({kind:"same",text:a[i++]});j++;}
      else if(i<a.length&&(j===b.length||dp[(i+1)*width+j]>=dp[i*width+j+1]))operations.push({kind:"remove",text:a[i++]});
      else operations.push({kind:"add",text:b[j++]});
    }
  }
  let beforeOffset=0,afterOffset=0,pending:TextChange|null=null;
  const changes:TextChange[]=[];
  const flush=()=>{if(!pending)return;pending.kind=pending.beforeEnd===pending.beforeStart?"add":pending.afterEnd===pending.afterStart?"remove":"adjust";changes.push(pending);pending=null;};
  for(const op of operations){
    if(!op.text)continue;
    if(op.kind==="same"){flush();beforeOffset+=op.text.length;afterOffset+=op.text.length;continue;}
    pending??={id:`change-${changes.length}`,kind:"adjust",beforeStart:beforeOffset,beforeEnd:beforeOffset,afterStart:afterOffset,afterEnd:afterOffset,reasonIndexes:[],reasonScope:"none"};
    if(op.kind==="remove")beforeOffset+=op.text.length;else afterOffset+=op.text.length;
    pending.beforeEnd=beforeOffset;pending.afterEnd=afterOffset;
  }
  flush();return changes;
}

/** Project verified real output; evidence linkage is textual, never a guessed semantic mapping. */
export function buildOptimizationReview(logic:LogicSections,result:OptimizationOutput):OptimizationReview{
  const fields={} as OptimizationReview["fields"];
  for(const {field} of LOGIC_FIELDS){
    const fieldIndexes=result.changes.flatMap((change,index)=>change.field===field?[index]:[]);
    fields[field]=compareLogicText(logic[field],result.optimizedDraft[field]).map(change=>{
      const linked=fieldIndexes.filter(index=>result.changes[index].evidence.some(evidence=>{
        if(evidence.source!=="draft")return false;
        const start=logic[field].indexOf(evidence.excerpt);
        return start>=0&&start===logic[field].lastIndexOf(evidence.excerpt)&&start<change.beforeEnd&&start+evidence.excerpt.length>change.beforeStart;
      }));
      return {...change,id:`${field}-${change.id}`,reasonIndexes:linked.length?linked:fieldIndexes,reasonScope:linked.length?"excerpt":fieldIndexes.length?"section":"none"};
    });
  }
  return {version:1,sourceFingerprint:fingerprintLogic(logic),candidateFingerprint:fingerprintLogic(result.optimizedDraft),fields};
}

/** Optional projection must match the actual drafts and reasons before it can annotate text. */
export function resolveOptimizationReview(logic:LogicSections,result:ReviewedOptimization):OptimizationReview{
  const expected=buildOptimizationReview(logic,result);
  const parsed=optimizationReviewSchema.safeParse(result.review);
  if(!parsed.success||JSON.stringify(parsed.data)!==JSON.stringify(expected))return expected;
  return parsed.data;
}
