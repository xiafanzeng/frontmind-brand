// @vitest-environment node
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { calibrationCase, tasks } from "../scripts/rag-checklist-calibration.mjs";
import { createRagChecklist, scoreRagChecklist } from "../contracts/enterprise-rag-checklist";
import { createEnterpriseRagEvidenceAliasContract, decodeEnterpriseRagAliasedJudgeOutput, enterpriseRagAliasedJudgeWireSchema, enterpriseRagJudgeWireSchema, isChecklistRagJudgment, validateEnterpriseRagJudgeOutput } from "../contracts/enterprise-rag-evaluation-run";
import { checklistEnterpriseRagEvaluationSkill } from "../client/dashboard/ai-website-preview/enterprise-rag-checklist-skill";
import { runEvaluationSkill } from "../client/dashboard/ai-website-preview/evaluation-skill-contract";

async function evaluate(sample = calibrationCase()) {
  const parsed = validateEnterpriseRagJudgeOutput(sample.output, sample.input);
  if (!isChecklistRagJudgment(parsed)) throw new Error("Expected checklist judgment");
  return runEvaluationSkill(checklistEnterpriseRagEvaluationSkill, parsed);
}
function unknown(sample: any) {
  sample.output.checks.find((c: any) => c.id === "citation_currency").status = "undetermined";
  sample.output.findings.push({ id: "finding-20", rootCauseId: "root-cause-20", checkId: "citation_currency", kind: "evidence", severity: "undetermined", summary: "资料时效待确认", impact: "必要的当前版本信息缺失。", dimensionIds: ["citations"], claimIds: [], evidenceIds: ["synthetic-source"] });
  sample.output.gates.find((g: any) => g.id === "unknown").status = "pending";
}
describe("rag-eval-1.4 fixed checklist calibration (synthetic, no model)", () => {
  for (const task of tasks) for (const quality of ["complete", "minor", "noticeable", "critical"]) {
    it(`${task.taskKind}/${quality} uses evidence-based deduction and independent risk`, async () => {
      const sample = calibrationCase(task, quality);
      expect(new Ajv({ strict: false }).compile(enterpriseRagJudgeWireSchema(sample.input))(sample.output)).toBe(true);
      expect(await evaluate(sample)).toMatchObject({ score: sample.expectedScore, answerVerdict: sample.expectedVerdict });
    });
  }
  it("allows full marks, ties and optional suggestions without inventing defects", async () => {
    const sample = calibrationCase();
    sample.output.optionalSuggestions.push({ id: "suggestion-1", dimensionId: "clarity", summary: "可增加步骤示意图", benefit: "锦上添花，不影响现有路径理解。", evidenceIds: ["answer:a"] });
    const result = await evaluate(sample);
    expect(result).toMatchObject({ score: 100, answerVerdict: "usable", risks: [] });
    expect((await evaluate(calibrationCase(tasks[1]))).score).toBe(result.score);
  });
  it("reserves a 1.5 point difference for the explicit single-repetition anchor", async () => {
    expect((await evaluate(calibrationCase(tasks[0], "minor"))).dimensions.find(d => d.id === "clarity")?.score).toBe(13.5);
  });
  it("rejects unreasoned deductions and multi-dimensional penalties for one defect", () => {
    const sample = calibrationCase(tasks[0], "minor");
    sample.output.findings[0].dimensionIds.push("intent");
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow();
    sample.output.findings[0].dimensionIds = ["clarity"];
    sample.output.findings = [];
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/缺少具体缺陷/);
  });
  it("rejects duplicate defects under different check IDs while allowing independent defects", async () => {
    const sample = calibrationCase(tasks[0], "minor");
    sample.output.checks.find((c: any) => c.id === "clarity_direct").status = "partial";
    sample.output.findings[0].claimIds = ["claim-1"];
    sample.output.findings.push({ ...sample.output.findings[0], id: "finding-2", checkId: "clarity_direct" });
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/重复扣分/);
    sample.output.findings[1].rootCauseId = "root-cause-2";
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/陈述不能跨检查项|缺少具体缺陷/);
    expect((await evaluate(calibrationCase(tasks[0], "noticeable"))).score).toBe(94.5);
  });
  it("does not turn missing evidence into zero, full marks, or a usable verdict", async () => {
    const sample = calibrationCase(); unknown(sample);
    const result = await evaluate(sample);
    expect(result).toMatchObject({ score: null, answerVerdict: "pending", status: "pending" });
    expect(result.coverage).toBeLessThan(100);
    expect(result.dimensions.find(d => d.id === "citations")?.score).toBeNull();
    sample.output.findings = [];
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/待补证/);
  });
  it("confirmed critical risk wins even when other evidence remains unknown", async () => {
    const sample = calibrationCase(tasks[0], "critical"); unknown(sample);
    expect(await evaluate(sample)).toMatchObject({ score: null, answerVerdict: "unusable", status: "pending" });
  });
  it("cannot hide a contradicted core fact in an optional suggestion", () => {
    const sample = calibrationCase(tasks[0], "critical");
    sample.output.findings = []; sample.output.gates[0].status = "passed";
    sample.output.checks.find((c: any) => c.id === "facts_core").status = "met";
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/证据问题必须记录/);
  });
  it("does not charge a contradicted fact again only because its rebuttal was not displayed", async () => {
    const sample = calibrationCase(tasks[0], "critical");
    sample.input.sources[0].citedByAnswer = false;
    expect((await evaluate(sample)).score).toBe(83);
    const supported = calibrationCase();
    supported.input.sources[0].citedByAnswer = false;
    expect(() => validateEnterpriseRagJudgeOutput(supported.output, supported.input)).toThrow(/已支持事实的依据未展示/);
  });
  it("only accepts pre-frozen N/A and handles all-inapplicable dimensions separately", async () => {
    const sample = calibrationCase();
    sample.output.checks[0].status = "not_applicable";
    sample.output.checks[0].evidenceIds = [];
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/适用性/);
    sample.output.checks[0].status = "met"; sample.output.checks[0].evidenceIds = ["answer:a", "synthetic-source"];
    for (const check of sample.input.checklist.checks.filter((c: any) => c.dimensionId === "citations")) {
      check.applicable = false; check.exclusionReason = "合成测试预先批准此维度不适用。";
      const judgment = sample.output.checks.find((c: any) => c.id === check.id);
      judgment.status = "not_applicable"; judgment.evidenceIds = [];
    }
    const result = await evaluate(sample);
    expect(result.dimensions.find(d => d.id === "citations")).toMatchObject({ score: null, status: "not_applicable" });
    expect(result.score).toBe(100);
    sample.input.checklist.checks.forEach((c: any) => { c.applicable = false; c.exclusionReason = "合成排除"; });
    expect(() => scoreRagChecklist(sample.input.checklist, sample.output.checks)).toThrow(/没有适用/);
  });
  it("rejects missing/duplicate checks, unauthorized evidence and mixed rule versions", () => {
    const sample = calibrationCase();
    sample.output.checks[1].id = sample.output.checks[0].id;
    expect(() => validateEnterpriseRagJudgeOutput(sample.output, sample.input)).toThrow(/检查项/);
    const other = calibrationCase(); other.output.checks[0].evidenceIds = ["another-enterprise"];
    expect(() => validateEnterpriseRagJudgeOutput(other.output, other.input)).toThrow(/未授权/);
    const mixed = calibrationCase(); mixed.input.evaluator.ruleVersion = "rag-eval-1.3";
    expect(() => validateEnterpriseRagJudgeOutput(mixed.output, mixed.input)).toThrow(/冻结评估版本/);
  });
  it("decodes checks and optional suggestion evidence with the same frozen alias whitelist", async () => {
    const sample = calibrationCase(tasks[0], "minor");
    sample.output.optionalSuggestions.push({ id: "suggestion-1", dimensionId: "clarity", summary: "可附示意图", benefit: "便于扫读", evidenceIds: ["answer:a"] });
    const binding = createEnterpriseRagEvidenceAliasContract(sample.input);
    const alias = (id: string) => id.startsWith("claim-") ? id : binding.bindings.find(b => b.canonicalId === id)!.alias;
    const wire = structuredClone(sample.output);
    [...wire.checks, ...wire.gates, wire.task, ...wire.findings, ...wire.optionalSuggestions].forEach(item => { item.evidenceIds = item.evidenceIds.map(alias); });
    wire.claims.forEach((c: any) => { c.sourceIds = c.sourceIds.map(alias); });
    expect(new Ajv({ strict: false }).compile(enterpriseRagAliasedJudgeWireSchema(sample.input, binding))(wire)).toBe(true);
    sample.output = decodeEnterpriseRagAliasedJudgeOutput(wire, sample.input, binding);
    expect(sample.output.dimensions).toHaveLength(6);
    expect((await evaluate(sample)).score).toBe(98.5);
    wire.optionalSuggestions[0].evidenceIds = ["answer:a"];
    expect(() => decodeEnterpriseRagAliasedJudgeOutput(wire, sample.input, binding)).toThrow(/未授权/);
  });
  it("never trusts supplied dimension scores and freezes unequal task-specific checks", async () => {
    const sample = calibrationCase(tasks[0], "minor");
    sample.output.dimensions = [{ id: "clarity", level: 4 }];
    expect((await evaluate(sample)).score).toBe(98.5);
    expect(createRagChecklist("设备故障怎样报修？").taskKind).toBe("after_sales");
    expect(createRagChecklist("对比两款产品").taskKind).toBe("comparison");
    expect(createRagChecklist("推荐哪款产品").checks[0].requirement).toContain("总结需求");
  });
});
