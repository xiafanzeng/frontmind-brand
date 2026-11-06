import { describe, expect, it } from "vitest";
import type { EnterpriseRagEvaluationReport } from "../../../contracts/enterprise-rag-evaluation-run";
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { buildRagImprovementPlan } from "./rag-improvement-plan";

// Only the immutable presentation inputs are needed; transport metadata has no
// role in arranging a plan and is deliberately absent from these fixtures.
function reportFixture(schemaVersion: 1 | 2 | 3, findings: unknown[] = [], risks: unknown[] = [], optionalSuggestions: unknown[] = []) {
  return {
    judgments: {
      ...(schemaVersion === 1 ? {} : { schemaVersion, findings }),
      ...(schemaVersion === 3 ? { optionalSuggestions } : {}),
      claims: [{ id: "claim-1", statement: "原始回答中的陈述。" }],
    },
    result: { risks },
  } as unknown as EnterpriseRagEvaluationReport;
}

const finding = (id: string, severity = "improvement", kind = "citation") => ({
  id, kind, severity, summary: "引用定位不够清晰", impact: "用户难以核对对应原文。",
  claimIds: ["claim-1", "missing-claim"], evidenceIds: ["source-1", "source-1"], dimensionIds: ["citations"],
});

describe("RAG improvement plan presentation", () => {
  it("gives the synthetic overview a goal and actionable sequence without changing its frozen answer", () => {
    const sample = RAG_SAMPLE_CASES[0];
    const snapshot = JSON.stringify(sample);
    const plan = buildRagImprovementPlan({ sample, issues: sample.issues, complete: true });
    expect(plan.goal).toContain("让首次访客理解 FrontMind 的用途");
    expect(plan.steps.map(step => step.title)).toEqual(["补齐操作指引", "说明演示边界", "补充使用场景"]);
    expect(plan.steps.map(step => step.priority)).toEqual(["P1", undefined, "P2"]);
    expect(plan.steps.every(step => step.evidenceIds.every(id => sample.sources.some(source => source.id === id)))).toBe(true);
    expect(plan.rewrite).toBe(sample.improvement.answer);
    expect(plan.checks.some(check => check.includes("第一步"))).toBe(true);
    expect(JSON.stringify(sample)).toBe(snapshot);
  });

  it("keeps every synthetic scenario within its own facts and treats deployment prerequisites as pending", () => {
    for (const sample of RAG_SAMPLE_CASES) {
      const plan = buildRagImprovementPlan({ sample, issues: sample.issues, complete: true });
      if (sample.issues.length) {
        expect(plan.goal).not.toBe(sample.issues[0].title);
        expect(plan.steps.length).toBeGreaterThan(0);
        expect(plan.checks.length).toBeGreaterThan(0);
        expect(plan.rewrite).toBe(sample.improvement.answer);
      } else {
        expect(plan.emptyState).toBe("no-issues");
        expect(plan.steps).toEqual([]);
      }
    }
    const sample = RAG_SAMPLE_CASES.find(item => item.id === "syn-deployment-prereq")!;
    const plan = buildRagImprovementPlan({ sample, issues: sample.issues, complete: true });
    expect(plan.steps[0].pending).toBe(true);
    expect(plan.steps[0].body).toContain("尚不能形成通过或不通过的判定");
    expect(plan.rewrite).toBeUndefined();
  });

  it("prefers real findings over the synthetic sample and deduplicates only shared source IDs", () => {
    const report = reportFixture(2, [finding("finding-1"), finding("finding-2")], [
      { id: "finding-1", title: "投影中的同一问题", summary: "不应重复展示", severity: "low", evidenceIds: ["source-1"] },
      { id: "risk-extra", title: "另一项保留风险", summary: "需要继续核对。", severity: "critical", evidenceIds: ["source-2"] },
    ]);
    const snapshot = JSON.stringify(report);
    const sample = RAG_SAMPLE_CASES[0];
    const plan = buildRagImprovementPlan({ report, sample, issues: sample.issues, complete: true });
    expect(plan.steps.map(step => step.id)).toEqual(["risk-extra", "finding-1", "finding-2"]);
    expect(plan.steps[1].body).toContain("用户难以核对对应原文。");
    expect(plan.steps[1].body).not.toContain("评估发现");
    expect(plan.steps[1].quotes).toEqual([{ id: "claim-1", text: "原始回答中的陈述。" }]);
    expect(plan.steps[1].evidenceIds).toEqual(["source-1"]);
    expect(JSON.stringify(plan)).not.toContain("不应重复展示");
    expect(JSON.stringify(plan)).not.toContain("网站建设");
    expect(plan.rewrite).toBeUndefined();
    expect(JSON.stringify(report)).toBe(snapshot);
  });

  it("keeps critical, pending and improvement findings in treatment order without treating pending as a confirmed failure", () => {
    const report = reportFixture(3, [finding("improve"), finding("pending", "undetermined", "task"), finding("critical", "critical", "privacy")]);
    const plan = buildRagImprovementPlan({ report, issues: [], complete: false });
    expect(plan.steps.map(step => step.id)).toEqual(["critical", "pending", "improve"]);
    expect(plan.steps[1]).toMatchObject({ pending: true, title: "补齐核验依据" });
    expect(plan.steps[1].priority).toBeUndefined();
    expect(plan.steps[1].body).toContain("保留待核验结论");
    expect(plan.checks).toHaveLength(3);
  });

  it("retains legacy risks and manual actions without inventing rewritten answers", () => {
    const report = reportFixture(1, [], [{ id: "old-risk", title: "历史问题", summary: "原有依据尚需核对。", severity: "high", evidenceIds: ["source-old"] }]);
    const legacy = buildRagImprovementPlan({ report, issues: [], complete: true });
    expect(legacy.steps[0]).toMatchObject({ id: "old-risk", priority: "P1", evidenceIds: ["source-old"] });
    expect(legacy.steps[0].body).toContain("原有依据尚需核对");
    const manual = buildRagImprovementPlan({ issues: [{ id: "manual", priority: "P2", title: "表达可改进", impact: "存在重复信息。", action: "合并重复的第二段。", dimensionId: "clarity" }], complete: false });
    expect(manual.steps[0]).toMatchObject({ title: "理顺表达步骤", quotes: [], evidenceIds: [] });
    expect(manual.steps[0].body).toContain("合并重复的第二段。");
    expect(legacy.rewrite).toBeUndefined();
    expect(manual.rewrite).toBeUndefined();
  });

  it("does not turn optional suggestions into mandatory work or a revised score", () => {
    const report = reportFixture(3, [], [], [{ id: "optional-1", summary: "可附示意图", benefit: "方便扫读，不影响当前答案质量。", evidenceIds: ["source-1"] }]);
    const plan = buildRagImprovementPlan({ report, issues: [], complete: true });
    expect(plan.emptyState).toBe("optional-only");
    expect(plan.steps).toEqual([]);
    expect(plan.checks).toEqual([]);
    expect(plan.goal).toContain("不影响当前评分");
    expect(plan.optionalSuggestions).toEqual([{ id: "optional-1", title: "可附示意图", body: "方便扫读，不影响当前答案质量。", evidenceIds: ["source-1"] }]);
  });

  it("distinguishes an unassessed answer from a completed record with no repair items", () => {
    const pending = buildRagImprovementPlan({ issues: [], complete: false });
    const clear = buildRagImprovementPlan({ issues: [], complete: true });
    expect(pending).toMatchObject({ emptyState: "unassessed", goal: "先补齐当前回答的判断依据，再确定优化方向。", steps: [], checks: [] });
    expect(clear).toMatchObject({ emptyState: "no-issues", goal: "当前记录没有待修复项；继续用更多真实场景验证。", steps: [], checks: [] });
  });
});
