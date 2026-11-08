// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  scoreWebsiteBuildEvaluation,
  websiteBuildEvaluationDecisionSchema,
  websiteBuildEvaluationReportSchema,
} from "../contracts/website-build-evaluation-run.js";
import {
  requireWebsiteEvaluationVisitorTask,
  SiteOpsServiceError,
  validateWebsiteReleaseEvaluationDecision,
} from "../server/siteops/service.js";
import { websiteEvaluationReportHash } from "../server/website-evaluation-runtime.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "report-1";

function report(input: {
  anchor?: 0 | 0.5 | 1;
  criticalRisk?: boolean;
  criticalRiskCount?: number;
} = {}) {
  const judgments = WEBSITE_BUILD_EVALUATION_CHECKS.map(({ id }) => ({
    checkId: id,
    anchor: input.anchor ?? 1,
    rationale: `Evidence-backed judgment for ${id}`,
    evidenceIds: [`evidence-${id}`],
  }));
  const criticalRiskCount = input.criticalRiskCount ?? (input.criticalRisk ? 1 : 0);
  const criticalRisks = Array.from({ length: criticalRiskCount }, (_, index) => ({
          id: criticalRiskCount === 1 ? "risk-core-task" : `risk-core-task-${index + 1}`,
          kind: "core_task_broken" as const,
          title: "Core task is interrupted",
          summary: "The frozen visitor task cannot reach its success state.",
          checkIds: ["visitor_success_reachable" as const],
          evidenceIds: ["evidence-visitor_success_reachable"],
        }));
  const scored = scoreWebsiteBuildEvaluation({ judgments, criticalRisks });
  if (!scored.complete) throw new Error("test report must be complete");
  const withoutHash = {
    schemaVersion: 1,
    reportId: REPORT_ID,
    runId: RUN_ID,
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    buildOrdinal: 1,
    stage: "build_readiness",
    evidenceFingerprint: "b".repeat(64),
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "local-fake-judge",
      skillHash: "c".repeat(64),
      outputHash: "d".repeat(64),
    },
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: 100,
      criticalRouteIds: ["route-home"],
      structuralRouteIds: [],
      viewports: ["1440x1000", "390x844", "320x720"],
    },
    score: scored.score,
    verdict: scored.verdict,
    summary: "Local immutable evaluation result.",
    judgments,
    dimensions: scored.dimensions,
    criticalRisks,
    findings: [],
    relatedRagReportIds: [],
    comparablePreviousReportId: null,
    createdAt: "2026-11-08T01:00:00.000Z",
    completedAt: "2026-11-08T01:01:00.000Z",
  };
  return websiteBuildEvaluationReportSchema.parse({
    ...withoutHash,
    reportHash: websiteEvaluationReportHash(withoutHash as any),
  });
}

function reportCoordinate(result = report()) {
  return {
    id: REPORT_ID,
    runId: RUN_ID,
    buildId: BUILD_ID,
    resultHash: result.reportHash,
    result,
  };
}

function decision(
  value: Record<string, unknown>,
) {
  return websiteBuildEvaluationDecisionSchema.parse({
    buildId: BUILD_ID,
    runId: RUN_ID,
    reportId: REPORT_ID,
    reportHash: report().reportHash,
    acknowledgedRiskIds: [],
    reason: "",
    ...value,
  });
}

describe("SiteOps website evaluation release decision", () => {
  it("requires a confirmed visitor task only for admitted new evaluations", () => {
    expect(
      requireWebsiteEvaluationVisitorTask({
        brief: {},
        projectId: PROJECT_ID,
        environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "off" },
      }),
    ).toBeNull();
    expect(() =>
      requireWebsiteEvaluationVisitorTask({
        brief: {},
        projectId: PROJECT_ID,
        environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "live" },
      }),
    ).toThrow("开始制作前必须确认核心访客任务");
    expect(
      requireWebsiteEvaluationVisitorTask({
        projectId: PROJECT_ID,
        environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "live" },
        brief: {
          companyName: "FrontMind",
          primaryLanguage: "zh-CN",
          contacts: [],
          offerings: [],
          audience: [],
          conversionGoal: "Book a consultation",
          routes: [
            {
              id: "home",
              slug: "/",
              title: "Home",
              sourceDocumentIds: [],
            },
          ],
          verifiedFacts: [],
          publicAssetIds: [],
          unknowns: [],
          visitorTaskV1: {
            schemaVersion: 1,
            goal: "Book a consultation",
            entryRouteId: "home",
            successCriteria: ["The booking request is confirmed"],
            requiredRouteIds: ["home"],
            assistantRequired: false,
            generatedFromBriefHash: "f".repeat(64),
            confirmedAt: "2026-11-08T00:00:00.000Z",
            confirmedByUserId: 7,
          },
        },
      })?.goal,
    ).toBe("Book a consultation");
  });

  it("requires a decision once the build has an evaluation coordinate", () => {
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "running" },
        latestReport: null,
      }),
    ).toThrowError(SiteOpsServiceError);
  });

  it("requires an unavailable decision for a user-visible build before a run exists", () => {
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decisionRequired: true,
        buildId: BUILD_ID,
        latestRun: null,
        latestReport: null,
      }),
    ).toThrowError(SiteOpsServiceError);
    expect(
      validateWebsiteReleaseEvaluationDecision({
        decisionRequired: false,
        buildId: BUILD_ID,
        latestRun: null,
        latestReport: null,
      }),
    ).toBeNull();
  });

  it("allows a strong unavailable acknowledgement while a run failed", () => {
    const unavailable = decision({
      mode: "assessment_unavailable",
      reportId: null,
      reportHash: null,
      acknowledgedRiskIds: ["assessment_unavailable"],
      reason: "The terminal evaluation failure was reviewed by the operator.",
    });
    expect(
      validateWebsiteReleaseEvaluationDecision({
        decision: unavailable,
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "failed" },
        latestReport: null,
      }),
    ).toEqual(unavailable);
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: decision({
          mode: "assessment_unavailable",
          reportId: null,
          reportHash: null,
          acknowledgedRiskIds: ["some_other_risk"],
          reason: "An unrelated acknowledgement must not bypass the fixed risk.",
        }),
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "failed" },
        latestReport: null,
      }),
    ).toThrow("风险确认已变化");
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: websiteBuildEvaluationDecisionSchema.parse({
          ...unavailable,
          runId: null,
        }),
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "failed" },
        latestReport: null,
      }),
    ).toThrow("任务已变化");
  });

  it("rejects an unavailable acknowledgement after a report completes", () => {
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: decision({
          mode: "assessment_unavailable",
          reportId: null,
          reportHash: null,
          acknowledgedRiskIds: ["assessment_unavailable"],
          reason: "Evaluation was unavailable when the dialog opened.",
        }),
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: reportCoordinate(),
      }),
    ).toThrow("建设评估已完成");
  });

  it("follows only a current recommended immutable report", () => {
    const follow = decision({ mode: "follow_recommendation" });
    expect(
      validateWebsiteReleaseEvaluationDecision({
        decision: follow,
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: reportCoordinate(),
      }),
    ).toEqual(follow);
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: follow,
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: { ...reportCoordinate(), resultHash: "e".repeat(64) },
      }),
    ).toThrow("报告已变化");
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: follow,
        buildId: BUILD_ID,
        latestRun: {
          id: "44444444-4444-4444-8444-444444444444",
          buildId: BUILD_ID,
          status: "queued",
        },
        latestReport: reportCoordinate(),
      }),
    ).toThrow("报告已变化");
  });

  it("rejects schema-valid report content changed without a new hash", () => {
    const original = report();
    const tampered = {
      ...original,
      score: 0,
      verdict: "not_recommended",
    };
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: decision({ mode: "follow_recommendation" }),
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: {
          ...reportCoordinate(original),
          result: tampered,
        },
      })
    ).toThrow("内容摘要不一致");
  });

  it("requires every current critical and recommendation risk", () => {
    const lowReport = report({ anchor: 0.5, criticalRisk: true });
    const accepted = decision({
      mode: "accepted_risk",
      reportHash: lowReport.reportHash,
      acknowledgedRiskIds: ["risk-core-task", "quality_recommendation"],
      reason: "The owner reviewed both the broken task and low recommendation.",
    });
    expect(
      validateWebsiteReleaseEvaluationDecision({
        decision: accepted,
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: reportCoordinate(lowReport),
      }),
    ).toEqual(accepted);
    expect(() =>
      validateWebsiteReleaseEvaluationDecision({
        decision: decision({
          mode: "accepted_risk",
          reportHash: lowReport.reportHash,
          acknowledgedRiskIds: ["risk-core-task"],
          reason: "Only one risk was acknowledged.",
        }),
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: reportCoordinate(lowReport),
      }),
    ).toThrow("风险清单已变化");
  });

  it("accepts all 20 critical risks plus the recommendation acknowledgement", () => {
    const maximal = report({ anchor: 0.5, criticalRiskCount: 20 });
    const acknowledgedRiskIds = [
      ...maximal.criticalRisks.map(({ id }) => id),
      "quality_recommendation",
    ];
    const accepted = decision({
      mode: "accepted_risk",
      reportHash: maximal.reportHash,
      acknowledgedRiskIds,
      reason: "The owner reviewed every current risk before continuing.",
    });
    expect(acknowledgedRiskIds).toHaveLength(21);
    expect(
      validateWebsiteReleaseEvaluationDecision({
        decision: accepted,
        decisionRequired: true,
        buildId: BUILD_ID,
        latestRun: { id: RUN_ID, buildId: BUILD_ID, status: "completed" },
        latestReport: reportCoordinate(maximal),
      }),
    ).toEqual(accepted);
  });
});
