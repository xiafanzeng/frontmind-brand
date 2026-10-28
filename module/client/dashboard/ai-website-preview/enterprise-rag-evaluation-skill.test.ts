// Frozen v1.2 compatibility regression suite. New behavior is tested in rag-evaluation-graded.test.ts.
import { describe, expect, it } from "vitest";
import { enterpriseRagEvaluationSkill } from "./enterprise-rag-evaluation-skill-legacy";
import { RAG_DIMENSIONS, RAG_GATES, type EvaluationInput, type Rating } from "./rag-evaluation-legacy";

function input(level: Rating = 4): EvaluationInput {
  return {
    dimensions: RAG_DIMENSIONS.map(({ id }) => ({
      id,
      level,
      rationale: "已按回答快照和授权来源核验。",
      evidenceIds: [`evidence-${id}`],
      applicable: true,
    })),
    gates: RAG_GATES.map(({ id }) => ({ id, status: "passed", reason: "已核验。" })),
  };
}

describe("enterpriseRagEvaluationSkill", () => {
  it("returns a callable shared-contract result without publication authority", () => {
    const result = enterpriseRagEvaluationSkill.evaluate(input());
    expect(result).toMatchObject({
      skillId: "enterprise-rag-evaluation",
      version: "1.0.0",
      status: "completed",
      score: 100,
      coverage: 100,
      recommendation: "recommended",
      risks: [],
    });
    expect("canPublish" in result).toBe(false);
    expect("canConfirm" in result).toBe(false);
  });

  it("turns a failed answer-quality gate into advice without a publish lock", () => {
    const sample = input();
    sample.gates[2] = { id: "permissions", status: "failed", reason: "回答暴露了内部资料。" };
    const result = enterpriseRagEvaluationSkill.evaluate(sample);
    expect(result).toMatchObject({
      status: "completed",
      score: 100,
      recommendation: "not_recommended",
    });
    expect(result.risks).toContainEqual(expect.objectContaining({
      id: "risk-rag-permissions",
      severity: "critical",
    }));
    expect("canPublish" in result).toBe(false);
  });

  it("does not invent a score when the evaluation has not run", () => {
    const result = enterpriseRagEvaluationSkill.evaluate({
      dimensions: RAG_DIMENSIONS.map(({ id }) => ({ id, level: null, rationale: "", evidenceIds: [], applicable: true })),
      gates: RAG_GATES.map(({ id }) => ({ id, status: "pending", reason: "" })),
    });
    expect(result).toMatchObject({ status: "not_run", score: null, coverage: 0, recommendation: "not_recommended" });
  });

  it("keeps explicit related reports as references without changing the score", () => {
    const base = enterpriseRagEvaluationSkill.evaluate(input(3));
    const linked = enterpriseRagEvaluationSkill.evaluate({ ...input(3), relatedReportIds: ["website-1", " website-1 ", "website-2"] });
    expect(linked.score).toBe(base.score);
    expect(linked.relatedReportIds).toEqual(["website-1", "website-2"]);
  });

  it("maps an approved inapplicable dimension without making the completed result look pending", () => {
    const sample = input();
    sample.dimensions[3] = {
      id: "citations",
      level: null,
      rationale: "用例启动前已批准不含企业事实的纯澄清问题。",
      evidenceIds: [],
      applicable: false,
    };

    const result = enterpriseRagEvaluationSkill.evaluate(sample);
    expect(result).toMatchObject({ status: "completed", score: 100, coverage: 100 });
    expect(result.dimensions.find(({ id }) => id === "citations")).toMatchObject({
      status: "not_applicable",
      score: null,
    });
  });

  it("treats an inapplicable dimension without a reason as a pending judgment", () => {
    const sample: EvaluationInput = {
      dimensions: RAG_DIMENSIONS.map(({ id }) => ({
        id,
        level: null,
        rationale: "",
        evidenceIds: [],
        applicable: true,
      })),
      gates: RAG_GATES.map(({ id }) => ({ id, status: "pending", reason: "" })),
    };
    sample.dimensions[0].applicable = false;

    const result = enterpriseRagEvaluationSkill.evaluate(sample);
    expect(result).toMatchObject({
      status: "pending",
      score: null,
      coverage: 0,
      recommendation: "not_recommended",
    });
    expect(result.dimensions.find(({ id }) => id === sample.dimensions[0].id)).toMatchObject({
      status: "pending",
      score: null,
    });
  });

  it.each(["failed-first", "failed-last"] as const)(
    "keeps a duplicated failed gate visible when it appears %s",
    (order) => {
      const sample = input();
      const failedGate: EvaluationInput["gates"][number] = {
        id: "facts",
        status: "failed",
        reason: "核心事实与授权来源冲突。",
      };
      sample.gates = order === "failed-first"
        ? [failedGate, ...sample.gates]
        : [...sample.gates, failedGate];

      const result = enterpriseRagEvaluationSkill.evaluate(sample);
      expect(result).toMatchObject({ status: "pending", recommendation: "not_recommended" });
      expect(result.risks).toContainEqual(expect.objectContaining({
        id: "risk-rag-facts",
        severity: "critical",
        summary: "核心事实与授权来源冲突。",
      }));
      expect(result.risks).toContainEqual(expect.objectContaining({
        id: "risk-rag-evaluation-input",
        severity: "critical",
      }));
    },
  );

  const invalidConfigurationCases: Array<[
    label: string,
    expectedSummary: string,
    mutate: (sample: EvaluationInput) => void,
  ]> = [
    ["duplicate dimension", "重复维度：intent", (sample) => {
      sample.dimensions.push({ ...sample.dimensions[0] });
    }],
    ["unknown dimension", "未知维度：unexpected-dimension", (sample) => {
      sample.dimensions.push({ ...sample.dimensions[0], id: "unexpected-dimension" as never });
    }],
    ["duplicate gate", "重复门禁：facts", (sample) => {
      sample.gates.push({ ...sample.gates[0] });
    }],
    ["unknown gate", "未知门禁：unexpected-gate", (sample) => {
      sample.gates.push({ ...sample.gates[0], id: "unexpected-gate" as never });
    }],
  ];

  it.each(invalidConfigurationCases)(
    "reports a critical input risk for a %s",
    (_label, expectedSummary, mutate) => {
      const sample = input();
      mutate(sample);

      const result = enterpriseRagEvaluationSkill.evaluate(sample);
      expect(result).toMatchObject({ status: "pending", recommendation: "not_recommended" });
      expect(result.risks).toContainEqual(expect.objectContaining({
        id: "risk-rag-evaluation-input",
        severity: "critical",
        summary: expect.stringContaining(expectedSummary),
      }));
    },
  );
});
