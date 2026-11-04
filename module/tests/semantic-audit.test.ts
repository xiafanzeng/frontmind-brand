// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateSemanticAudit } from "../server/semantic-audit.js";
import { SEMANTIC_AUDIT_METRICS, SEMANTIC_AUDIT_DIMENSIONS } from "../contracts/semantic-audit.js";
import type { DiagnosticSample, KnowledgeBasis } from "../contracts/diagnostics.js";
const knowledge: KnowledgeBasis = { snapshotId: "v3", version: 3, buildId: "b", conversationId: "c", companyName: "医院", contentHash: "hash", documents: [{ path: "scope.md", title: "科室", content: "医学美容科提供皮肤咨询。", evidenceStatus: "needs_verification" }] };
const samples: DiagnosticSample[] = [{ id: "sample-1", category: "product_scenario", platform: "doubao", run: 1, question: "医学美容科服务？", answer: "医学美容科提供皮肤咨询。", citations: [] }];
const meta = { inputHash: "frozen", skillVersion: "skill", generatedAt: "2026-11-01T12:00:00Z", model: "gpt-6.1-sol", fallback: false };
function output() {
  return { category: "product_scenario", checkedSampleIds: ["A0"],
    metrics: SEMANTIC_AUDIT_METRICS.filter((m) => m.id !== "sample_coverage").map((m) => ({ id: m.id, status: "insufficient", value: null as number | null, explanation: "没有足够基准", satisfied: "", limitations: "缺少可核验依据", knowledgeRefs: [] as any[], answerRefs: [] as any[] })),
    findings: SEMANTIC_AUDIT_DIMENSIONS.map((d) => ({ dimension: d.id, text: "本题现有证据有限，部分指标无法判断" })),
  };
}
const evaluate = (value: unknown, overrides = {}) => validateSemanticAudit(value, { category: "product_scenario", samples, knowledge, plannedSamples: 2, ...overrides }, meta);
describe("evidence-based semantic audit", () => {
  it("calculates sample coverage on the server and never imputes missing dimension weights", () => {
    const result = evaluate(output());
    expect(result.metrics.find((m) => m.id === "sample_coverage")).toMatchObject({ method: "calculated", value: .5, score: 2.5 });
    expect(result.dimensions[0]).toMatchObject({ score: null, assessed: 1, total: 3 });
    expect(result.dimensions.every((d) => d.score === null)).toBe(true);
    expect(result).not.toHaveProperty("totalScore");
  });
  it("resolves exact source-local quotes and scores fixed bands", () => {
    const out = output();
    for (const id of ["accurate_recognition", "brand_evidence"]) {
      Object.assign(out.metrics.find((m) => m.id === id)!, { status: "scored", value: .5, satisfied: "已有主体描述", limitations: "缺少进一步服务边界", knowledgeRefs: [{ docPath: "scope.md", excerpt: "@quote:K0.0" }], answerRefs: [{ sampleId: "A0", excerpt: "@quote:A0.0" }] });
    }
    const result = evaluate(out);
    expect(result.dimensions[0]).toMatchObject({ score: 15, maximum: 30, assessed: 3 });
    expect(result.metrics[0].answerRefs[0]).toEqual({ sampleId: "sample-1", excerpt: samples[0].answer });
  });
  it("rejects fabricated scores, quotes, incomplete samples and duplicate metrics", () => {
    const out = output();
    Object.assign(out.metrics[0], { status: "scored", value: .8 });
    expect(() => evaluate(out)).toThrow();
    Object.assign(out.metrics[0], { status: "scored", value: 1 });
    expect(() => evaluate(out)).toThrow("回答依据");
    out.metrics[0].answerRefs = [{ sampleId: "another", excerpt: "医学美容科" }];
    expect(() => evaluate(out)).toThrow("回答证据");
    const omitted = output(); omitted.checkedSampleIds = ["other"];
    expect(() => evaluate(omitted)).toThrow("全部样本");
    const duplicated = output(); duplicated.metrics[1] = duplicated.metrics[0];
    expect(() => evaluate(duplicated)).toThrow("重复");
  });
  it("does not treat legacy empty source arrays as observed zero authority", () => {
    const out = output();
    Object.assign(out.metrics.find((m) => m.id === "authoritative_support")!, { status: "scored", value: 0, answerRefs: [{ sampleId: "A0", excerpt: "@quote:A0.0" }] });
    expect(() => evaluate(out)).toThrow("来源正文");
    const observed = samples.map((s) => ({ ...s, sourceObservability: { citations: "returned", references: "returned" } }));
    expect(evaluate(out, { samples: observed }).metrics.find((m) => m.id === "authoritative_support")?.score).toBe(0);
  });
  it("rejects authority inferred from URL metadata and competition inferred from unverified self-description", () => {
    const out = output();
    const item = out.metrics.find((m) => m.id === "authoritative_support")!;
    Object.assign(item, { status: "scored", value: .5, satisfied: "有链接", answerRefs: [{ sampleId: "A0", excerpt: "@quote:A0.0" }] });
    expect(() => evaluate(out, { samples: [{ ...samples[0], citations: [{ title: "权威网站", url: "https://example.com" }] }] })).toThrow("来源正文");
    const comp = output(); comp.category = "industry_ranking";
    Object.assign(comp.metrics.find((m) => m.id === "verified_differences")!, { status: "scored", value: .5, satisfied: "企业宣称", knowledgeRefs: [{ docPath: "scope.md", excerpt: "@quote:K0.0" }], answerRefs: [{ sampleId: "A0", excerpt: "@quote:A0.0" }] });
    expect(() => evaluate(comp, { category: "industry_ranking" })).toThrow("独立核实");
  });
});
