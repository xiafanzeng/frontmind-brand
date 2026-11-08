import { describe, expect, it } from "vitest";
import { computeEnterpriseRagReviewDiff } from "../server/enterprise-rag-human-review-service.js";
import { RAG_DIMENSIONS, RAG_GATES, type DimensionJudgment, type GateJudgment } from "../client/dashboard/ai-website-preview/rag-evaluation.js";

const dimensions = (level = 4): DimensionJudgment[] => RAG_DIMENSIONS.map(({ id }) => ({
  id, level: level as 0 | 1 | 2 | 3 | 4, rationale: "已依据冻结材料核验。", evidenceIds: ["answer:a"], applicable: true,
}));
const gates = (status: GateJudgment["status"] = "passed"): GateJudgment[] => RAG_GATES.map(({ id }) => ({ id, status, reason: "已核验。" }));
function report(level = 4, verdict: "usable" | "usable_with_improvements" | "unusable" | "pending" = "usable") {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    sourceQaTaskId: "00000000-0000-4000-8000-000000000002",
    sourceTurnId: "00000000-0000-4000-8000-000000000003",
    conversationId: "conversation", questionMessageId: "q", answerMessageId: "a", questionHash: "q", answerHash: "a",
    knowledgeBase: { snapshotId: "s", version: 1, sourceFileName: "knowledge.zip", documentCount: 1, contentHash: "h" },
    evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "3.0.0", ruleVersion: "rag-eval-1.4", judgeVersion: "3.0.0", provider: "xty_codex", model: "model", effort: null, skillHash: "h", outputHash: "o" },
    judgments: { schemaVersion: 3, operationToken: "op", inputHash: "i", checks: [], claims: [], summary: "ok", task: { status: "completed", rationale: "ok", evidenceIds: ["answer:a"] }, findings: [], gates: gates().map(item => ({ ...item, evidenceIds: ["answer:a"] })) },
    result: {
      answerVerdict: verdict, skillId: "enterprise-rag-evaluation", version: "3.0.0", status: verdict === "pending" ? "pending" : "completed",
      score: verdict === "pending" ? null : level === 4 ? 100 : 50, coverage: 100, recommendation: verdict === "unusable" ? "not_recommended" : verdict === "usable_with_improvements" ? "publish_with_risk" : "recommended", summary: "ok",
      dimensions: RAG_DIMENSIONS.map(({ id, label, weight }) => ({ id, label, status: "passed", score: weight * level / 4, maxScore: weight, summary: "ok", evidenceIds: ["answer:a"] })), risks: [], relatedReportIds: [],
    }, createdAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(),
  } as any;
}

describe("企业 RAG 人工改判差异", () => {
  it("把 checklist 小数分稳定折算为现有 0..4 人工档位", () => {
    const source = report(4);
    source.result.dimensions[0].score = 18;
    const result = computeEnterpriseRagReviewDiff(source, dimensions(4), gates());
    expect(result.diff.dimensions).toEqual([]);
    expect(result.diff.alignment).toBe("aligned");
  });

  it("识别人工高、AI 低与 AI 高、人工低两个方向", () => {
    expect(computeEnterpriseRagReviewDiff(report(2, "usable_with_improvements"), dimensions(4), gates()).diff.alignment).toBe("human_more_positive");
    expect(computeEnterpriseRagReviewDiff(report(4, "usable"), dimensions(2), gates("failed")).diff.alignment).toBe("human_more_negative");
  });

  it("同时包含人工调高和调低的维度时标记为混合分歧", () => {
    const mixed = dimensions(3);
    mixed[0] = { ...mixed[0]!, level: 4 };
    mixed[1] = { ...mixed[1]!, level: 2 };
    expect(computeEnterpriseRagReviewDiff(report(3, "usable"), mixed, gates()).diff.alignment).toBe("mixed");
  });

  it("待核验的任一方不被误标为高低分歧", () => {
    expect(computeEnterpriseRagReviewDiff(report(4, "pending"), dimensions(4), gates()).diff.alignment).toBe("insufficient_information");
    const pending = dimensions(4); pending[0] = { ...pending[0]!, level: null };
    expect(computeEnterpriseRagReviewDiff(report(4), pending, gates()).diff.alignment).toBe("insufficient_information");
  });
});
