import { describe, expect, it } from "vitest";
import { runEvaluationSkill } from "./evaluation-skill-contract";
import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  websiteBuildEvaluationSkill,
  type WebsiteBuildEvaluationCheckStatus,
  type WebsiteBuildEvaluationInput,
} from "./website-build-evaluation-skill";

function judgments(
  status: WebsiteBuildEvaluationCheckStatus = "passed",
): WebsiteBuildEvaluationInput["judgments"] {
  return WEBSITE_BUILD_EVALUATION_CHECKS.map((check) => ({
    checkId: check.id,
    status,
    summary: `${check.title} 已核验。`,
    evidenceIds: [`evidence:${check.id}`],
  }));
}

describe("websiteBuildEvaluationSkill", () => {
  it("defines a website-only 40/40/20 model worth exactly 100 points", () => {
    expect(WEBSITE_BUILD_EVALUATION_DIMENSIONS.map(({ weight }) => weight)).toEqual([40, 40, 20]);
    expect(WEBSITE_BUILD_EVALUATION_DIMENSIONS.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(WEBSITE_BUILD_EVALUATION_CHECKS.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    for (const dimension of WEBSITE_BUILD_EVALUATION_DIMENSIONS) {
      expect(WEBSITE_BUILD_EVALUATION_CHECKS
        .filter(({ dimensionId }) => dimensionId === dimension.id)
        .reduce((sum, item) => sum + item.weight, 0)).toBe(dimension.weight);
    }
    expect(WEBSITE_BUILD_EVALUATION_CHECKS.some((item) => /rag/i.test(`${item.id} ${item.title}`))).toBe(false);
  });

  it("returns a contract-valid recommendation without exposing release authorization", async () => {
    const result = await runEvaluationSkill(websiteBuildEvaluationSkill, { judgments: judgments() });

    expect(result).toMatchObject({
      skillId: "website-build-evaluation",
      version: "1.0.0",
      status: "completed",
      score: 100,
      coverage: 100,
      recommendation: "recommended",
      risks: [],
      relatedReportIds: [],
    });
    expect("canPublish" in result).toBe(false);
    expect("canConfirm" in result).toBe(false);
  });

  it("awards no points and no coverage to a claimed pass without evidence", () => {
    const input = judgments().map((judgment) => judgment.checkId === "website-content-structure"
      ? { ...judgment, evidenceIds: [] }
      : judgment);
    const result = websiteBuildEvaluationSkill.evaluate({ judgments: input });

    expect(result).toMatchObject({
      status: "pending",
      score: 80,
      coverage: 80,
      recommendation: "publish_with_risk",
    });
    expect(result.dimensions.find(({ id }) => id === "content-experience")).toMatchObject({
      status: "pending",
      score: 20,
      maxScore: 40,
    });
  });

  it("turns an evidence-backed critical failure into advice, not a release lock", () => {
    const input = judgments().map((judgment) => judgment.checkId === "website-draft-release-state"
      ? { ...judgment, status: "failed" as const, summary: "公开地址尚未验证。" }
      : judgment);
    const result = websiteBuildEvaluationSkill.evaluate({ judgments: input });

    expect(result).toMatchObject({
      status: "completed",
      score: 95,
      coverage: 100,
      recommendation: "publish_with_risk",
    });
    expect(result.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "risk-website-draft-release-state", severity: "high" }),
    ]));
    expect("canPublish" in result).toBe(false);
    expect("canConfirm" in result).toBe(false);
  });

  it("uses critical website risks for recommendation without importing related report scores", () => {
    const criticalFailure = judgments().map((judgment) => judgment.checkId === "website-facts-evidence"
      ? { ...judgment, status: "failed" as const, summary: "能力声明缺少可靠依据。" }
      : judgment);
    const withoutReference = websiteBuildEvaluationSkill.evaluate({ judgments: criticalFailure });
    const withReferences = websiteBuildEvaluationSkill.evaluate({
      judgments: criticalFailure,
      relatedReportIds: ["rag-high-score", " rag-high-score ", "rag-low-score"],
    });

    expect(withReferences.score).toBe(withoutReference.score);
    expect(withReferences.coverage).toBe(withoutReference.coverage);
    expect(withReferences.recommendation).toBe("not_recommended");
    expect(withReferences.relatedReportIds).toEqual(["rag-high-score", "rag-low-score"]);
    expect(withReferences.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "risk-website-facts-evidence", severity: "critical" }),
    ]));
  });

  it("reports an untouched evaluation as not run instead of inventing a zero-quality verdict", () => {
    const result = websiteBuildEvaluationSkill.evaluate({ judgments: [] });

    expect(result).toMatchObject({
      status: "not_run",
      score: null,
      coverage: 0,
      recommendation: "not_recommended",
    });
  });

  it("rejects ad-hoc not-applicable judgments under the fixed 100-point scope", () => {
    const input = judgments().map((judgment) => judgment.checkId === "website-content-structure"
      ? { ...judgment, status: "not_applicable" as const }
      : judgment);

    const result = websiteBuildEvaluationSkill.evaluate({ judgments: input });
    expect(result).toMatchObject({
      status: "failed",
      score: null,
      recommendation: "not_recommended",
    });
    expect(result.risks).toContainEqual(expect.objectContaining({
      id: "risk-website-evaluation-input",
      severity: "critical",
    }));
  });

  it("fails safely for invalid runtime statuses and evidence shapes", async () => {
    const invalidStatus = judgments().map((judgment) => judgment.checkId === "website-content-structure"
      ? { ...judgment, status: "bogus" }
      : judgment) as unknown as WebsiteBuildEvaluationInput["judgments"];
    const invalidEvidence = judgments().map((judgment) => judgment.checkId === "website-navigation-contact"
      ? { ...judgment, evidenceIds: "not-an-array" }
      : judgment) as unknown as WebsiteBuildEvaluationInput["judgments"];

    for (const sample of [invalidStatus, invalidEvidence]) {
      const direct = websiteBuildEvaluationSkill.evaluate({ judgments: sample });
      expect(direct).toMatchObject({
        status: "failed",
        score: null,
        recommendation: "not_recommended",
      });
      expect(Number.isNaN(direct.score)).toBe(false);
      await expect(runEvaluationSkill(websiteBuildEvaluationSkill, { judgments: sample }))
        .resolves.toMatchObject({ status: "failed", score: null });
    }
  });
});
