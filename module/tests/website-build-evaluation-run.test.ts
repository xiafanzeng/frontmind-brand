import { describe, expect, it } from "vitest";
import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  scoreWebsiteBuildEvaluation,
  validateWebsiteBuildEvaluationJudgeOutput,
  websiteBuildEvaluationDecisionSchema,
  websiteBuildEvaluationFrozenInputSchema,
  websiteBuildEvaluationHistoryDtoSchema,
  websiteBuildEvaluationReportSchema,
  websiteBuildEvaluationReviewInputSchema,
  type WebsiteBuildEvaluationAnchor,
  type WebsiteBuildEvaluationCheckJudgment,
  type WebsiteBuildEvaluationCriticalRisk,
} from "../contracts/website-build-evaluation-run";
import { siteBriefSchema } from "../contracts/siteops";

const projectId = "00000000-0000-4000-8000-000000000001";
const buildId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const evidenceFingerprint = "a".repeat(64);

function anchorsForUnits(units: number): WebsiteBuildEvaluationAnchor[] {
  const values: WebsiteBuildEvaluationAnchor[] = [];
  let remaining = units;
  while (values.length < 4) {
    if (remaining >= 2) {
      values.push(1);
      remaining -= 2;
    } else if (remaining === 1) {
      values.push(0.5);
      remaining -= 1;
    } else {
      values.push(0);
    }
  }
  return values;
}

function judgments(
  dimensionUnits: readonly number[] = [8, 8, 8, 8, 8, 8],
): WebsiteBuildEvaluationCheckJudgment[] {
  const anchorsByDimension = new Map(
    WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension, index) => [
      dimension.id,
      anchorsForUnits(dimensionUnits[index] ?? 0),
    ]),
  );
  const offsets = new Map<string, number>();
  return WEBSITE_BUILD_EVALUATION_CHECKS.map((check) => {
    const offset = offsets.get(check.dimensionId) ?? 0;
    offsets.set(check.dimensionId, offset + 1);
    return {
      checkId: check.id,
      anchor: anchorsByDimension.get(check.dimensionId)![offset]!,
      rationale: `${check.label} 已按冻结证据核验。`,
      evidenceIds: [`evidence:${check.id}`],
    };
  });
}

function criticalRisk(): WebsiteBuildEvaluationCriticalRisk {
  return {
    id: "risk-core-task",
    kind: "core_task_broken",
    title: "核心任务中断",
    summary: "关键转化入口无法完成。",
    checkIds: ["visitor_success_reachable"],
    evidenceIds: ["evidence:visitor_success_reachable"],
  };
}

function finding(id = "finding-entry") {
  const checkId = WEBSITE_BUILD_EVALUATION_CHECKS[0]!.id;
  return {
    id,
    checkId,
    severity: "medium" as const,
    title: "入口提示需要完善",
    summary: "入口提示不够明确。",
    impact: "访客可能无法快速开始核心任务。",
    suggestedAction: "补充清晰的入口说明。",
    evidenceIds: [`evidence:${checkId}`],
    target: { kind: "build" as const },
  };
}

function frozenInput() {
  return websiteBuildEvaluationFrozenInputSchema.parse({
    schemaVersion: 1,
    operationToken: "website-evaluation-operation",
    evidenceFingerprint,
    projectId,
    buildId,
    stage: "build_readiness",
    allowedEvidenceIds: WEBSITE_BUILD_EVALUATION_CHECKS.map(
      ({ id }) => `evidence:${id}`,
    ),
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "gpt-6.1-sol",
    },
  });
}

function judgeOutput() {
  return {
    schemaVersion: 1 as const,
    operationToken: "website-evaluation-operation",
    evidenceFingerprint,
    judgments: judgments(),
    criticalRisks: [],
    findings: [],
    summary: "六维检查均已完成。",
  };
}

describe("website build evaluation scoring contract", () => {
  it("freezes six dimensions, four checks per dimension and exactly 100 points", () => {
    expect(WEBSITE_BUILD_EVALUATION_DIMENSIONS).toHaveLength(6);
    expect(
      WEBSITE_BUILD_EVALUATION_DIMENSIONS.reduce(
        (sum, dimension) => sum + dimension.weight,
        0,
      ),
    ).toBe(100);
    expect(WEBSITE_BUILD_EVALUATION_CHECKS).toHaveLength(24);
    for (const dimension of WEBSITE_BUILD_EVALUATION_DIMENSIONS) {
      expect(
        WEBSITE_BUILD_EVALUATION_CHECKS.filter(
          ({ dimensionId }) => dimensionId === dimension.id,
        ),
      ).toHaveLength(4);
    }
  });

  it.each([
    [[0, 0, 0, 0, 0, 0], 0, "not_recommended"],
    [[8, 8, 7, 8, 1, 0], 69, "not_recommended"],
    [[8, 8, 8, 8, 0, 0], 70, "repair_or_continue"],
    [[3, 6, 8, 8, 8, 8], 84, "repair_or_continue"],
    [[8, 8, 8, 8, 8, 0], 85, "recommended"],
    [[8, 8, 8, 8, 8, 8], 100, "recommended"],
  ] as const)(
    "scores anchored judgments at %s as %i with %s",
    (units, score, verdict) => {
      expect(scoreWebsiteBuildEvaluation({ judgments: judgments(units) }))
        .toMatchObject({ complete: true, score, verdict });
    },
  );

  it("keeps a real zero distinct from missing required evidence", () => {
    expect(scoreWebsiteBuildEvaluation({ judgments: judgments([0, 0, 0, 0, 0, 0]) }))
      .toMatchObject({ complete: true, score: 0 });

    const missing = judgments().slice(1);
    expect(scoreWebsiteBuildEvaluation({ judgments: missing })).toEqual({
      complete: false,
      score: null,
      verdict: null,
      missingCheckIds: ["visitor_entry_clear"],
      dimensions: [],
    });

    const evidenceMissing = judgments();
    evidenceMissing[0] = { ...evidenceMissing[0]!, evidenceIds: [] };
    expect(scoreWebsiteBuildEvaluation({ judgments: evidenceMissing }))
      .toMatchObject({ complete: false, score: null });
  });

  it("downgrades the verdict for critical risk without changing the score", () => {
    const baseline = scoreWebsiteBuildEvaluation({ judgments: judgments() });
    const risky = scoreWebsiteBuildEvaluation({
      judgments: judgments(),
      criticalRisks: [criticalRisk()],
    });
    expect(baseline).toMatchObject({ score: 100, verdict: "recommended" });
    expect(risky).toMatchObject({ score: 100, verdict: "not_recommended" });
  });
});

describe("website build evaluation frozen model boundary", () => {
  it("accepts a complete output bound to the operation, fingerprint and evidence", () => {
    expect(validateWebsiteBuildEvaluationJudgeOutput(judgeOutput(), frozenInput()))
      .toEqual(judgeOutput());
  });

  it.each([
    ["operation token", (value: ReturnType<typeof judgeOutput>) => {
      value.operationToken = "other-operation";
    }, "OPERATION_TOKEN_MISMATCH"],
    ["evidence fingerprint", (value: ReturnType<typeof judgeOutput>) => {
      value.evidenceFingerprint = "b".repeat(64);
    }, "EVIDENCE_FINGERPRINT_MISMATCH"],
    ["unfrozen evidence", (value: ReturnType<typeof judgeOutput>) => {
      value.judgments[0]!.evidenceIds = ["private:unfrozen"];
    }, "EVIDENCE_REFERENCE_INVALID"],
  ] as const)("rejects a mismatched %s", (_label, mutate, code) => {
    const value = judgeOutput();
    mutate(value);
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(value, frozenInput()))
      .toThrow(expect.objectContaining({ code }));
  });

  it("rejects missing, duplicate and unsupported anchored judgments", () => {
    const missing = judgeOutput();
    missing.judgments.pop();
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(missing, frozenInput()))
      .toThrow();

    const duplicate = judgeOutput();
    duplicate.judgments[23] = duplicate.judgments[0]!;
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(duplicate, frozenInput()))
      .toThrow(expect.objectContaining({ code: "CHECKLIST_INCOMPLETE" }));

    const continuous = judgeOutput() as unknown as {
      judgments: Array<{ anchor: number }>;
    };
    continuous.judgments[0]!.anchor = 0.75;
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(continuous, frozenInput()))
      .toThrow();
  });

  it("requires unique repair coordinates while allowing the same id across kinds", () => {
    const duplicateRisks = {
      ...judgeOutput(),
      criticalRisks: [criticalRisk(), criticalRisk()],
    };
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(duplicateRisks, frozenInput()))
      .toThrow();

    const duplicateFindings = {
      ...judgeOutput(),
      findings: [finding(), finding()],
    };
    expect(() => validateWebsiteBuildEvaluationJudgeOutput(duplicateFindings, frozenInput()))
      .toThrow();

    const sharedId = "shared-repair-id";
    expect(validateWebsiteBuildEvaluationJudgeOutput({
      ...judgeOutput(),
      criticalRisks: [{ ...criticalRisk(), id: sharedId }],
      findings: [finding(sharedId)],
    }, frozenInput())).toMatchObject({
      criticalRisks: [{ id: sharedId }],
      findings: [{ id: sharedId }],
    });
  });

  it("rejects silent evaluator version drift", () => {
    const frozen = {
      ...frozenInput(),
      evaluator: { ...frozenInput().evaluator, ruleVersion: "changed" },
    };
    expect(() => websiteBuildEvaluationFrozenInputSchema.parse(frozen)).toThrow();
  });
});

describe("website evaluation DTO and publication decision contracts", () => {
  it("requires comments for targeted repair reviews while preserving legacy reviews", () => {
    expect(websiteBuildEvaluationReviewInputSchema.safeParse({
      clientRequestId: "review-request-legacy",
      disposition: "agree",
      checkComments: [],
      note: "",
    }).success).toBe(true);
    expect(websiteBuildEvaluationReviewInputSchema.safeParse({
      clientRequestId: "review-request-targeted",
      disposition: "agree",
      checkComments: [],
      repairItem: { kind: "finding", id: "finding-entry" },
      note: "   ",
    }).success).toBe(false);
  });

  it("keeps Brand Kit optional and validates a confirmed visitor task against frozen routes", () => {
    const legacyBrief = {
      companyName: "FrontMind",
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: [],
      audience: [],
      conversionGoal: "预约咨询",
      routes: [{ id: "home", slug: "/", title: "首页", sourceDocumentIds: [] }],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    };
    expect(siteBriefSchema.safeParse(legacyBrief).success).toBe(true);

    const current = {
      ...legacyBrief,
      brandKitV1: {
        schemaVersion: 1,
        primaryColor: "#6D28D9",
        toneKeywords: ["可信"],
      },
      visitorTaskV1: {
        schemaVersion: 1,
        goal: "找到并提交咨询入口",
        entryRouteId: "home",
        successCriteria: ["可以进入咨询流程"],
        requiredRouteIds: ["home"],
        assistantRequired: false,
        generatedFromBriefHash: "c".repeat(64),
        confirmedAt: "2026-11-08T08:00:00.000Z",
        confirmedByUserId: 7,
      },
    };
    expect(siteBriefSchema.parse(current)).toMatchObject(current);
    expect(siteBriefSchema.safeParse({
      ...current,
      visitorTaskV1: { ...current.visitorTaskV1, requiredRouteIds: ["missing"] },
    }).success).toBe(false);
  });

  it("requires report coordinates for recommendations and strong acknowledgement otherwise", () => {
    expect(websiteBuildEvaluationDecisionSchema.safeParse({
      mode: "follow_recommendation",
      buildId,
      reportId: "report-1",
      reportHash: "d".repeat(64),
    }).success).toBe(true);
    expect(websiteBuildEvaluationDecisionSchema.safeParse({
      mode: "accepted_risk",
      buildId,
      reportId: "report-1",
      reportHash: "d".repeat(64),
      acknowledgedRiskIds: ["risk-1"],
      reason: "确认风险并安排后续修复。",
    }).success).toBe(true);
    expect(websiteBuildEvaluationDecisionSchema.safeParse({
      mode: "assessment_unavailable",
      buildId,
      acknowledgedRiskIds: ["assessment_unavailable"],
      reason: "当前评估服务不可用，先发布已通过技术检查的版本。",
    }).success).toBe(true);
    expect(websiteBuildEvaluationDecisionSchema.safeParse({
      mode: "accepted_risk",
      buildId,
      acknowledgedRiskIds: [],
      reason: "",
    }).success).toBe(false);
  });

  it("keeps brand-reference coverage separate in immutable report and history DTOs", () => {
    const scored = scoreWebsiteBuildEvaluation({ judgments: judgments() });
    if (!scored.complete) throw new Error("expected complete score");
    const report = websiteBuildEvaluationReportSchema.parse({
      schemaVersion: 1,
      reportId: "report-1",
      runId,
      projectId,
      buildId,
      buildOrdinal: 1,
      stage: "build_readiness",
      evidenceFingerprint,
      reportHash: "d".repeat(64),
      evaluator: {
        ...frozenInput().evaluator,
        skillHash: "e".repeat(64),
        outputHash: "f".repeat(64),
      },
      coverage: {
        requiredEvidencePercent: 100,
        routeViewportPercent: 100,
        brandReferencePercent: 25,
        criticalRouteIds: ["home"],
        structuralRouteIds: [],
        viewports: ["1440x1000", "390x844", "320x720"],
      },
      score: scored.score,
      verdict: scored.verdict,
      summary: "评估完成。",
      judgments: judgments(),
      dimensions: scored.dimensions,
      criticalRisks: [],
      findings: [],
      createdAt: "2026-11-08T08:00:00.000Z",
      completedAt: "2026-11-08T08:01:00.000Z",
    });
    expect(report.score).toBe(100);
    expect(report.coverage.brandReferencePercent).toBe(25);
    expect(websiteBuildEvaluationReportSchema.safeParse({
      ...report,
      criticalRisks: [criticalRisk(), criticalRisk()],
    }).success).toBe(false);
    expect(websiteBuildEvaluationReportSchema.safeParse({
      ...report,
      findings: [finding(), finding()],
    }).success).toBe(false);

    expect(websiteBuildEvaluationHistoryDtoSchema.safeParse({
      latest: {
        runId,
        projectId,
        buildId,
        stage: "build_readiness",
        status: "completed",
        attemptCount: 1,
        automatic: true,
        evidenceFingerprint,
        createdAt: report.createdAt,
        updatedAt: report.completedAt,
        report,
        error: null,
      },
      history: [],
      nextCursor: null,
    }).success).toBe(true);
  });
});
