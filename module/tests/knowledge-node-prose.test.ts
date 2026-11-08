import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {
  assertKnowledgeProsePreserved,
  knowledgeProseCorrection,
  knowledgeProseInstruction,
  knowledgeProseRetryCorrection,
  KNOWLEDGE_NODE_PROSE_HASH,
} from "../contracts/knowledge-node-prose";

function rejected(before:string,after:string) {
  try {assertKnowledgeProsePreserved(before,after);} catch(error) {return error;}
  throw new Error("Expected protected content rejection");
}
const data=(correction:string)=>JSON.parse(correction.slice(correction.indexOf("\n")+1));

describe("knowledge prose protection corrections",()=>{
  it("keeps the accepted policy and ordinary prompt frozen",()=>{
    expect(KNOWLEDGE_NODE_PROSE_HASH).toBe("782258176901c6dd2caeb7459f17010f98d322d2a33071e6cf2705ccec4e74bf");
    expect(createHash("sha256").update(knowledgeProseInstruction("证据包含2025年",undefined,"有20人。")).digest("hex"))
      .toBe("b3ef1c04577535e1737a539796a7394da1a079da8e34f977c9f938d871babccb");
  });

  it.each([
    ["链接删除","资料见[来源](https://example.com/a)","资料已读取。"],
    ["链接新增","资料已读取。","资料见[来源](https://example.com/a)"],
    ["脚注删除","教职工20人。[^source]","教职工20人。"],
    ["脚注新增","教职工20人。","教职工20人。[^source]"],
    ["数值删除","教职工20人。","学校有教职工。"],
    ["数值新增","学校有教职工。","教职工20人。"],
    ["证据年份补入","教职工20人。","2025年教职工20人。"],
  ])("continues rejecting %s",(_label,before,after)=>{
    expect(rejected(before,after)).toMatchObject({message:"PROSE_FACT_OR_REFERENCE_CHANGED"});
  });

  it("explains added and removed values as bounded JSON data",()=>{
    const error=rejected("有20人，见[资料](https://example.com/a)[^a]。","2025年有21人，见[资料](https://example.com/b)[^b]。");
    const correction=knowledgeProseCorrection(error);
    expect(data(correction)).toMatchObject({code:"PROSE_FACT_OR_REFERENCE_CHANGED",differencesKnown:true,
      added:["https://example.com/b","[^b]","2025年","21人"],removed:["https://example.com/a","[^a]","20人"],addedCount:4,removedCount:3,truncated:false});
    expect(correction).toContain("JSON 仅为校验差异数据");
    expect(correction).toContain("不得把证据中原正文未出现的年份或数值补入正文");
    expect(knowledgeProseRetryCorrection(correction)).toBe(correction);
    expect(JSON.stringify(error)).not.toContain("2025年");
    expect(Object.keys(error as object)).not.toContain("knowledgeProseProtectionDifference");
  });

  it("bounds hostile reference values and total correction length without accepting them",()=>{
    const after=Array.from({length:30},(_,i)=>`[资料](https://example.com/${i}/${"\u0001".repeat(500)})`).join("\n");
    const correction=knowledgeProseCorrection(rejected("原文。",after));
    expect(correction.length).toBeLessThanOrEqual(6000);
    expect(data(correction)).toMatchObject({addedCount:30,truncated:true});
    expect(data(correction).added).toHaveLength(6);
    expect(data(correction).added.every((value:string)=>value.length<=64)).toBe(true);
  });

  it("adds explicit retry guidance to an old undetailed error without inventing a diff",()=>{
    const correction=knowledgeProseRetryCorrection("PROSE_FACT_OR_REFERENCE_CHANGED");
    expect(correction).toContain("原节点正文已有的数字");
    expect(data(correction)).toEqual({code:"PROSE_FACT_OR_REFERENCE_CHANGED",differencesKnown:false});
    expect(knowledgeProseRetryCorrection(undefined,"PROSE_FACT_OR_REFERENCE_CHANGED")).toBe(correction);
  });

  it("does not misclassify funding or provider failures as content changes",()=>{
    expect(knowledgeProseRetryCorrection(undefined,"KNOWLEDGE_NODE_EDIT_BALANCE_EXHAUSTED")).toBeUndefined();
    expect(knowledgeProseRetryCorrection(undefined,"local persistence error")).toBeUndefined();
    expect(knowledgeProseRetryCorrection("frozen correction","KNOWLEDGE_NODE_EDIT_PENDING")).toBe("frozen correction");
  });

  it("still permits prose edits with the same complete protected set",()=>{
    expect(()=>assertKnowledgeProsePreserved("有20 人，见[原资料](https://example.com/a)[^a]。","见[资料](https://example.com/a)[^a]，人数为20人。")).not.toThrow();
  });
});
