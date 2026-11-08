import { describe, expect, it } from "vitest";
import { websiteBuildEvaluationReportSchema } from "../contracts/website-build-evaluation-run";
import {
  createNextWebsiteEvaluationPreviewRevision,
  createWebsiteEvaluationPreview,
  createWebsiteEvaluationPreviewReport,
  normalizeWebsiteEvaluationPreviewStage,
  resolveWebsiteEvaluationPreviewReport,
  resolveWebsiteEvaluationPreviewSelection,
  WEBSITE_EVALUATION_PREVIEW_STAGES,
} from "../../standalone/website-evaluation-preview";

describe("standalone website evaluation preview", () => {
  it("defaults to a completed authority report for immediate UI work", () => {
    expect(resolveWebsiteEvaluationPreviewSelection("")).toEqual({
      stage: "completed",
      flow: false,
    });
    expect(resolveWebsiteEvaluationPreviewSelection("evaluationStage=unknown")).toEqual({
      stage: "completed",
      flow: false,
    });
  });

  it.each(WEBSITE_EVALUATION_PREVIEW_STAGES)(
    "selects the fixed %s stage and gives it priority over autoplay",
    (stage) => {
      expect(normalizeWebsiteEvaluationPreviewStage(stage)).toBe(stage);
      expect(resolveWebsiteEvaluationPreviewSelection(
        `evaluationStage=${stage}&evaluationDemo=flow`,
      )).toEqual({ stage, flow: false });
    },
  );

  it("starts autoplay at the queued stage", () => {
    expect(resolveWebsiteEvaluationPreviewSelection("evaluationDemo=flow")).toEqual({
      stage: "queued",
      flow: true,
    });
  });

  it.each(WEBSITE_EVALUATION_PREVIEW_STAGES.slice(0, -1))(
    "keeps authority result fields empty while %s",
    (stage) => {
      const preview = createWebsiteEvaluationPreview(stage);
      expect(preview.status).toBe(stage);
      expect(preview.score).toBeNull();
      expect(preview.recommendation).toBeNull();
      expect(preview.reportId).toBeNull();
      expect(preview.reportHash).toBeNull();
      expect(preview.dimensions).toEqual([]);
      expect(preview.risks).toEqual([]);
      expect(preview.history).toEqual([]);
      expect(preview.reviews).toEqual([]);
    },
  );

  it("provides a complete, internally consistent 24-anchor authority result", () => {
    const preview = createWebsiteEvaluationPreview("completed");
    const anchors = preview.dimensions.flatMap((dimension) => dimension.anchors ?? []);
    const weightedScore = Math.round(preview.dimensions.reduce(
      (sum, dimension) => sum + (dimension.score ?? 0) * dimension.weight / 100,
      0,
    ));

    expect(preview.status).toBe("completed");
    expect(preview.reportId).toBeTruthy();
    expect(preview.reportHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(preview.reportUrl).toContain(`websiteReport=${preview.reportId}`);
    expect(preview.score).toBe(weightedScore);
    expect(preview.score).toBe(88);
    expect(preview.recommendation).toBe("not_recommended");
    expect(preview.verdict).toBe("暂缓发布");
    expect(preview.criticalRiskIds).toEqual(["risk-assistant-private-boundary"]);
    expect(preview.dimensions).toHaveLength(6);
    expect(preview.dimensions.every((dimension) => dimension.anchors?.length === 4)).toBe(true);
    expect(anchors).toHaveLength(24);
    expect(new Set(anchors.map((anchor) => anchor.score))).toEqual(new Set([0, 0.5, 1]));
    expect(anchors.every((anchor) => anchor.evidenceIds.length > 0)).toBe(true);
    expect(preview.history).toHaveLength(2);
    expect(preview.history?.map((item) => item.comparisonEligible)).toEqual([true, false]);
    expect(preview.reviews).toHaveLength(1);
    expect(preview.risks.every((risk) => Boolean(risk.repairItem))).toBe(true);
    expect(preview.reviews?.[0]?.repairItem).toEqual({
      kind: "critical_risk",
      id: "risk-assistant-private-boundary",
    });
  });

  it("keeps build and run coordinates stable while revealing a report only at completion", () => {
    const previews = WEBSITE_EVALUATION_PREVIEW_STAGES.map(
      (stage) => createWebsiteEvaluationPreview(stage),
    );
    expect(new Set(previews.map((preview) => preview.buildId)).size).toBe(1);
    expect(new Set(previews.map((preview) => preview.runId)).size).toBe(1);
    expect(previews.slice(0, -1).every((preview) => preview.reportId === null)).toBe(true);
    expect(previews.at(-1)?.reportId).toBeTruthy();
  });

  it("provides a contract-valid immutable report that can be resolved by its local URL", () => {
    const report = createWebsiteEvaluationPreviewReport();

    expect(websiteBuildEvaluationReportSchema.parse(report)).toEqual(report);
    expect(report.score).toBe(88);
    expect(report.judgments).toHaveLength(24);
    expect(report.dimensions).toHaveLength(6);
    expect(resolveWebsiteEvaluationPreviewReport(report.reportId)).toEqual(report);
    expect(resolveWebsiteEvaluationPreviewReport("report-not-local")).toBeNull();
  });

  it("creates a pure follow-up revision and moves the previous report into history", () => {
    const previous = createWebsiteEvaluationPreviewReport();
    const next = createNextWebsiteEvaluationPreviewRevision();

    expect(websiteBuildEvaluationReportSchema.parse(next.report)).toEqual(next.report);
    expect(next.generation).toBe(1);
    expect(next.report.reportId).not.toBe(previous.reportId);
    expect(next.report.score).toBe(93);
    expect(next.report.verdict).toBe("recommended");
    expect(next.evaluation.history?.[0]).toMatchObject({
      reportId: previous.reportId,
      score: previous.score,
      comparisonEligible: true,
    });
    expect(next.evaluation.history?.[0]?.reportUrl).toContain(
      `websiteReport=${previous.reportId}`,
    );
    expect(resolveWebsiteEvaluationPreviewReport(next.report.reportId)).toEqual(next.report);
  });
});
