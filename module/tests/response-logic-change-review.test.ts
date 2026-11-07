import {describe,expect,it} from "vitest";
import {buildOptimizationReview,compareLogicText,resolveOptimizationReview} from "../contracts/response-logic-change-review";
import type {OptimizationOutput} from "../contracts/response-logic-optimization";

describe("real candidate change projection",()=>{
  it.each([
    ["原句。保留。","新句。保留。"], ["原句。","原句。补充。"], ["删除。保留！","保留！"],
    ["甲😀。\r\n相同。\n甲😀。","乙🧑‍💻。\r\n相同。\n甲😀。"], ["","新增。"], ["原文。",""],
    ["同。".repeat(600),"同。".repeat(200)+"不同。"+"同。".repeat(399)],
  ])("reconstructs both complete texts including punctuation: %s",(before,after)=>{
    const changes=compareLogicText(before,after);let reconstructed="",cursor=0;
    for(const change of changes){expect(change.beforeStart).toBeGreaterThanOrEqual(cursor);reconstructed+=before.slice(cursor,change.beforeStart)+after.slice(change.afterStart,change.afterEnd);cursor=change.beforeEnd;}
    expect(reconstructed+before.slice(cursor)).toBe(after);
  });
  const logic={concern:"原句。保留。",conclusion:"重复。重复。",facts:"来源。",boundaries:"边界。"};
  const result:OptimizationOutput={kind:"judge-optimization",summary:"原始摘要",optimizedDraft:{...logic,concern:"新句。保留。",conclusion:"重复。新句。",facts:"来源。新增。"},changes:[
    {field:"concern",summary:"真实说明",evidence:[{source:"draft",excerpt:"原句。",supports:"真实证据"}]},
    {field:"conclusion",summary:"歧义引用",evidence:[{source:"draft",excerpt:"重复。",supports:"段落说明"}]},
    {field:"facts",summary:"知识依据",evidence:[{source:"knowledge",excerpt:"材料",supports:"补充"}]},
  ]};
  it("links unique intersecting excerpts but never invents a per-span cause",()=>{
    const review=buildOptimizationReview(logic,result);
    expect(review.fields.concern[0]).toMatchObject({reasonScope:"excerpt",reasonIndexes:[0]});
    expect(review.fields.conclusion[0]).toMatchObject({reasonScope:"section",reasonIndexes:[1]});
    expect(review.fields.facts[0]).toMatchObject({kind:"add",reasonScope:"section",reasonIndexes:[2]});
    expect(review.fields.boundaries).toEqual([]);
    expect(compareLogicText("原文。","候选。现在。" )[0].afterEnd).toBe("候选。现在。".length);
  });
  it("rejects stale, malformed or misassigned optional projections using actual drafts",()=>{
    const review=buildOptimizationReview(logic,result);
    expect(resolveOptimizationReview(logic,{...result,review})).toEqual(review);
    for(const corrupted of [{...review,sourceFingerprint:"another-question"},{...review,fields:{...review.fields,concern:[{...review.fields.concern[0],reasonIndexes:[1],afterEnd:9999}]}}])expect(resolveOptimizationReview(logic,{...result,review:corrupted})).toEqual(review);
    expect(buildOptimizationReview(logic,{...result,changes:[]}).fields.concern[0]).toMatchObject({reasonScope:"none",reasonIndexes:[]});
  });
});
