// @vitest-environment node
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_RAG_DIMENSION_IDS, ENTERPRISE_RAG_GATE_IDS, createEnterpriseRagEvidenceAliasContract,
  decodeEnterpriseRagAliasedJudgeOutput, enterpriseRagAliasedJudgeWireSchema, enterpriseRagJudgeWireSchema,
  validateEnterpriseRagJudgeOutput, type EnterpriseRagEvaluationFrozenInput, type EnterpriseRagGradedJudgeOutput,
} from "../contracts/enterprise-rag-evaluation-run";
import { enterpriseRagEvaluationSkill } from "../client/dashboard/ai-website-preview/enterprise-rag-evaluation-skill";
import { runEvaluationSkill } from "../client/dashboard/ai-website-preview/evaluation-skill-contract";

function fixture() {
  const input: EnterpriseRagEvaluationFrozenInput = {
    schemaVersion: 2, taskScope: "single_turn", operationToken: "test:graded", inputHash: "a".repeat(64), sourceQaTaskId: "qa", sourceTurnId: "turn", conversationId: "conversation", questionMessageId: "q", answerMessageId: "a",
    question: "怎么预约？", answer: "可通过官网预约入口申请。建议提前向服务中心核实准备事项。",
    sources: [{ id: "doc-1", title: "合成预约规则", kind: "published_knowledge", citedByAnswer: true, content: "可通过官网预约入口申请。" }],
    allowedEvidenceIds: ["question:q", "answer:a", "doc-1"],
    knowledgeBase: { snapshotId: "snapshot", version: 1, sourceFileName: "synthetic.json", documentCount: 1, contentHash: "b".repeat(64) },
    evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "2.0.0", judgeVersion: "2.0.0", ruleVersion: "rag-eval-1.3" },
  };
  const output: EnterpriseRagGradedJudgeOutput = {
    schemaVersion: 2, operationToken: input.operationToken, inputHash: input.inputHash,
    dimensions: ENTERPRISE_RAG_DIMENSION_IDS.map(id => ({ id, level: 4, rationale: "当前任务已满足。", evidenceIds: ["answer:a", "doc-1"] })),
    gates: ENTERPRISE_RAG_GATE_IDS.map(id => ({ id, status: "passed", reason: "冻结证据中未发现此项重大风险。", evidenceIds: ["answer:a", "doc-1"] })),
    claims: [
      { id: "claim-1", statement: "可通过官网预约入口申请。", kind: "fact", relevance: "core", status: "supported", sourceIds: ["doc-1"], rationale: "冻结正文直接支持。" },
      { id: "claim-2", statement: "建议提前向服务中心核实准备事项。", kind: "advice", relevance: "supporting", status: "not_applicable", sourceIds: [], rationale: "仅建议核实，不声称具体准备要求已成立。" },
    ],
    task: { status: "completed", rationale: "回答当前预约方式，不追加未请求的价格或准备任务。", evidenceIds: ["question:q", "claim-1"] }, findings: [], summary: "合成固定评估输出，不代表模型已验收。",
  };
  return { input, output };
}
function score(output: EnterpriseRagGradedJudgeOutput) {
  return runEvaluationSkill(enterpriseRagEvaluationSkill, { ...output, dimensions: output.dimensions.map(item => ({ ...item, level: item.level as 0|1|2|3|4|null, applicable: true })) });
}
function issue(output: EnterpriseRagGradedJudgeOutput, severity: "critical"|"improvement"|"undetermined", kind: "fact"|"citation"|"task"|"safety"|"privacy" = "fact") {
  const dimension = kind === "citation" ? "citations" : ["privacy", "safety"].includes(kind) ? "boundaries" : kind === "task" ? "intent" : "correctness";
  output.dimensions.find(item => item.id === dimension)!.level = severity === "undetermined" ? null : 3;
  output.findings.push({ id: `finding-${output.findings.length + 1}`, kind, severity, summary: "固定问题标签", impact: severity === "critical" ? "会改变用户的核心行动或安全判断。" : severity === "improvement" ? "不改变核心任务，仅需改进呈现。" : "必要依据缺失，需要补证。", claimIds: ["claim-1"], evidenceIds: ["claim-1", "doc-1"], dimensionIds: [dimension as "correctness"] });
  const gate = kind === "citation" ? "citations" : kind === "privacy" ? "permissions" : kind === "task" ? "availability" : kind === "safety" ? "safety" : "facts";
  output.gates.find(item => item.id === gate)!.status = severity === "critical" ? "failed" : severity === "undetermined" ? "pending" : "passed";
}
describe("rag-eval-1.3 graded contract and score", () => {
  it("does not turn a verification suggestion into an unsupported factual assertion", async () => {
    const { input, output } = fixture();
    expect(new Ajv({ strict: false }).compile(enterpriseRagJudgeWireSchema(input))(output)).toBe(true);
    expect(validateEnterpriseRagJudgeOutput(output, input)).toEqual(output);
    expect(await score(output)).toMatchObject({ status: "completed", answerVerdict: "usable", score: 100, risks: [] });
  });
  it("keeps an uncited but supported fact usable with an improvement", async () => {
    const { input, output } = fixture(); input.sources[0].citedByAnswer = false;
    issue(output, "improvement", "citation");
    validateEnterpriseRagJudgeOutput(output, input);
    expect(await score(output)).toMatchObject({ answerVerdict: "usable_with_improvements", recommendation: "publish_with_risk" });
    output.findings = []; expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow();
  });
  it("does not make partial support an automatic critical finding", async () => {
    const { input, output } = fixture(); output.claims[0].status = "partial";
    issue(output, "improvement"); validateEnterpriseRagJudgeOutput(output, input);
    expect((await score(output)).answerVerdict).toBe("usable_with_improvements");
    output.claims[0].sourceIds = [];
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/部分支持必须定位/);
  });
  it("keeps low scores diagnostic when the core task is completed without major risks", async () => {
    const { input, output } = fixture(); issue(output, "improvement");
    output.dimensions.forEach(item => item.level = 1);
    output.findings[0].dimensionIds = [...ENTERPRISE_RAG_DIMENSION_IDS];
    validateEnterpriseRagJudgeOutput(output, input);
    expect(await score(output)).toMatchObject({ score: 25, answerVerdict: "usable_with_improvements", status: "completed" });
  });
  it.each(["fact", "safety", "privacy"] as const)("a high score cannot hide a confirmed %s risk", async kind => {
    const { input, output } = fixture(); issue(output, "critical", kind);
    if (kind === "fact") { output.claims[0].status = "contradicted"; input.sources[0].content = "当前不提供官网预约入口。"; }
    validateEnterpriseRagJudgeOutput(output, input);
    expect(await score(output)).toMatchObject({ answerVerdict: "unusable", recommendation: "not_recommended" });
  });
  it("cannot downgrade an unsupported core fact, including facts inside advice", () => {
    const { input, output } = fixture(); input.answer = "建议拨打 00000000 预约。";
    output.claims = [{ ...output.claims[0], statement: input.answer, status: "unsupported", sourceIds: [] }];
    issue(output, "improvement"); expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/不能降级/);
    output.findings[0].severity = "critical"; output.gates[0].status = "failed";
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).not.toThrow();
  });
  it("rejects an empty audit or an invented critical fact error on a fully supported claim", () => {
    const { input, output } = fixture();
    const empty = { ...output, claims: [] };
    expect(() => validateEnterpriseRagJudgeOutput(empty, input)).toThrow();
    issue(output, "critical", "fact");
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/重大事实风险必须对应/);
  });
  it("keeps missing source bodies and unknown task results pending", async () => {
    const { input, output } = fixture(); input.sources[0].content = null;
    output.claims[0].status = "unverifiable"; issue(output, "undetermined");
    validateEnterpriseRagJudgeOutput(output, input);
    expect(await score(output)).toMatchObject({ status: "pending", answerVerdict: "pending", score: null });
    output.findings[0].severity = "improvement"; output.dimensions[1].level = 3; output.gates[0].status = "passed";
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/无法核验/);
  });
  it("requires critical task failure and preserves it even with other unknown evidence", async () => {
    const { input, output } = fixture(); output.task.status = "failed";
    issue(output, "critical", "task"); issue(output, "undetermined"); output.claims[0].status = "unverifiable";
    validateEnterpriseRagJudgeOutput(output, input);
    expect(await score(output)).toMatchObject({ answerVerdict: "unusable", status: "pending" });
  });
  it("binds new task/finding evidence aliases exactly and rejects fabricated references", () => {
    const { input, output } = fixture(); issue(output, "improvement", "citation");
    const contract = createEnterpriseRagEvidenceAliasContract(input);
    const alias = (id: string) => id.startsWith("claim-") ? id : contract.bindings.find(binding => binding.canonicalId === id)!.alias;
    const wire = structuredClone(output);
    for (const item of [...wire.dimensions, ...wire.gates, wire.task, ...wire.findings]) item.evidenceIds = item.evidenceIds.map(alias);
    wire.claims.forEach(claim => claim.sourceIds = claim.sourceIds.map(alias));
    expect(new Ajv({ strict: false }).compile(enterpriseRagAliasedJudgeWireSchema(input, contract))(wire)).toBe(true);
    expect(decodeEnterpriseRagAliasedJudgeOutput(wire, input, contract)).toEqual(output);
    wire.findings[0].evidenceIds = ["invented"];
    expect(() => decodeEnterpriseRagAliasedJudgeOutput(wire, input, contract)).toThrow(/未授权/);
  });
  it("does not accept v2 judgments under the frozen legacy schema", () => {
    const { input, output } = fixture(); input.schemaVersion = 1;
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow();
  });
  it("requires deduction reasons and rejects task/answer/hash mismatches", () => {
    const { input, output } = fixture(); output.dimensions[2].level = 3;
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/扣分项/);
    output.dimensions[2].level = 4; output.task.status = "undetermined";
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/核心任务未知/);
    output.task.status = "completed"; output.claims[0].statement = "不存在的原句";
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/连续原文/);
    output.claims[0].statement = input.answer; output.inputHash = "c".repeat(64);
    expect(() => validateEnterpriseRagJudgeOutput(output, input)).toThrow(/不属于本次/);
  });
});
