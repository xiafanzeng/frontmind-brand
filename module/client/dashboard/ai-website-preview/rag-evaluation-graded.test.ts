import { describe, expect, it } from "vitest";
import { aggregateEvaluations, resolveConversationOutcome, scoreEvaluation, RAG_DIMENSIONS, RAG_GATES, type ConversationLayer, type EvaluationInput } from "./rag-evaluation";
import { scoreEvaluation as legacyScore } from "./rag-evaluation-legacy";
import { enterpriseRagEvaluationSkill } from "./enterprise-rag-evaluation-skill";
import { parseEvaluationResult, runEvaluationSkill } from "./evaluation-skill-contract";
function input(): EvaluationInput {
  return { dimensions: RAG_DIMENSIONS.map(({id}) => ({id,level: 2,applicable:true,rationale:"合成表达问题，不影响核心任务。",evidenceIds:["answer"]})), gates: RAG_GATES.map(({id}) => ({id,status:"passed",reason:"已核验。"})) };
}
const layer = (): ConversationLayer => ({ task: "完成查询", completionPoints: [{id:"task",label:"提供真实路径",met:true}], runsRequired: 1 });
describe("graded task decisions and legacy boundaries", () => {
  it("removes score vetoes without reinterpreting legacy scores", () => {
    expect(scoreEvaluation(input())).toMatchObject({score:50, usable:true, verdict:"improve"});
    expect(legacyScore(input())).toMatchObject({score:50, usable:false, verdict:"unusable"});
  });
  it("does not reintroduce thresholds through aggregate results", () => {
    expect(aggregateEvaluations([{id:"one",scenario:"lookup",weight:1,result:scoreEvaluation(input())}])).toMatchObject({score:50,usableRate:100,meetsQualityTarget:true});
  });
  it("distinguishes false completion from unknown, and keeps pending gates unverified", () => {
    const task = layer(), gates = input().gates;
    task.completionPoints[0].met = null;
    expect(resolveConversationOutcome(task,gates).status).toBe("unverified");
    task.completionPoints[0].met = false;
    expect(resolveConversationOutcome(task,gates).status).toBe("fail");
    task.completionPoints[0].met = true; gates[0].status = "pending";
    expect(resolveConversationOutcome(task,gates).status).toBe("unverified");
  });
  it("retains confirmed major failures when prerequisites or other checks are unknown", () => {
    const task = layer(); task.prerequisiteMissing = true;
    const gates = input().gates; gates[2].status = "failed";
    expect(resolveConversationOutcome(task,gates)).toMatchObject({status:"fail",blockingCount:1});
  });
  it("keeps invalid configuration pending and provides no publication authority", async () => {
    const sample = input(); sample.gates.push({...sample.gates[0]});
    const result = await runEvaluationSkill(enterpriseRagEvaluationSkill, sample);
    expect(result).toMatchObject({status:"pending",answerVerdict:"pending"});
    expect(result.risks.some(risk => risk.severity === "critical")).toBe(false);
    expect("canPublish" in result).toBe(false);
  });
  it("rejects a forged usable conclusion when high/critical risks or incomplete checks remain", () => {
    const result = enterpriseRagEvaluationSkill.evaluate(input());
    expect(parseEvaluationResult({...result,answerVerdict:"usable",recommendation:"recommended",risks:[{id:"risk",severity:"critical",title:"重大风险",summary:"有证据",evidenceIds:["answer"]}]})).toBeNull();
    expect(parseEvaluationResult({...result,status:"pending",answerVerdict:"usable_with_improvements"})).toBeNull();
  });
});
