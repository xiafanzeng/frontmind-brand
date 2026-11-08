// @vitest-environment node
import type { Request } from "express";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  scoreWebsiteBuildEvaluation,
  websiteBuildEvaluationReportSchema,
  type WebsiteBuildEvaluationCheckJudgment,
  type WebsiteBuildEvaluationJudgeOutput,
  type WebsiteBuildEvaluationReport,
  type WebsiteBuildEvaluationRunDto,
} from "../contracts/website-build-evaluation-run";
import {
  freezeWebsiteEvaluationEvidence,
  selectWebsiteEvaluationCriticalRoutes,
} from "../server/website-evaluation-evidence";
import { createModuleHttpApi, type ModuleHttpCore } from "../server/http-api";
import { registerIntentSkillPorts } from "@frontmind/module-brand/server/intent-skill-runtime";
import {
  authoritativeWebsiteEvaluationReport,
  createFakeWebsiteEvaluationRunner,
  createSqlWebsiteEvaluationRuntimeStore,
  createWebsiteEvaluationRuntime,
  verifyWebsiteEvaluationReportIntegrity,
  websiteEvaluationReportHash,
  websiteEvaluationWorkerAdmission,
  WebsiteEvaluationRuntimeError,
  type WebsiteEvaluationRuntimeRun,
  type WebsiteEvaluationRuntimeStore,
} from "../server/website-evaluation-runtime";
import {
  createWebsiteEvaluationService,
  createSqlWebsiteEvaluationStore,
  WebsiteEvaluationError,
  type WebsiteEvaluationStore,
} from "../server/website-evaluation-service";

const projectId = "00000000-0000-4000-8000-000000000001";
const buildId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const reportId = "00000000-0000-4000-8000-000000000004";
const fingerprint = "a".repeat(64);

function report(): WebsiteBuildEvaluationReport {
  const judgments: WebsiteBuildEvaluationCheckJudgment[] =
    WEBSITE_BUILD_EVALUATION_CHECKS.map((check) => ({
      checkId: check.id,
      anchor: 1,
      rationale: `${check.label} 已按冻结证据完成核验。`,
      evidenceIds: [`evidence:${check.id}`],
    }));
  const scored = scoreWebsiteBuildEvaluation({ judgments });
  if (!scored.complete) throw new Error("fixture score must be complete");
  const withoutHash: Omit<WebsiteBuildEvaluationReport, "reportHash"> = {
    schemaVersion: 1,
    reportId,
    runId,
    projectId,
    buildId,
    buildOrdinal: 1,
    stage: "build_readiness",
    evidenceFingerprint: fingerprint,
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "fake-local-runner",
      skillHash: "c".repeat(64),
      outputHash: "d".repeat(64),
    },
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: 0,
      criticalRouteIds: ["home"],
      structuralRouteIds: ["home"],
      viewports: ["1440x1000", "390x844", "320x720"],
    },
    score: scored.score,
    verdict: scored.verdict,
    summary: "本地冻结 fixture 已完成六维检查。",
    judgments,
    dimensions: scored.dimensions,
    criticalRisks: [],
    findings: [],
    createdAt: "2026-11-08T08:00:00.000Z",
    completedAt: "2026-11-08T08:01:00.000Z",
    relatedRagReportIds: [],
    comparablePreviousReportId: null,
  };
  return websiteBuildEvaluationReportSchema.parse({
    ...withoutHash,
    reportHash: websiteEvaluationReportHash(withoutHash),
  });
}

function reportWithRepairItems(): WebsiteBuildEvaluationReport {
  const base = report();
  const { reportHash: _reportHash, ...withoutHash } = base;
  const candidate: Omit<WebsiteBuildEvaluationReport, "reportHash"> = {
    ...withoutHash,
    criticalRisks: [{
      id: "risk-assistant-private-boundary",
      kind: "assistant_safety_or_scope",
      title: "助手可能泄露内部交付备注",
      summary: "需要先收紧知识范围。",
      checkIds: ["assistant_unknown_privacy"],
      evidenceIds: ["evidence:assistant_unknown_privacy"],
    }],
    findings: [{
      id: "finding-mobile-touch-targets",
      checkId: "visual_accessibility",
      severity: "high",
      title: "移动端按钮偏小",
      summary: "触控区域不足。",
      impact: "移动端操作困难。",
      suggestedAction: "扩大触控区域后重新检查。",
      evidenceIds: ["evidence:visual_accessibility"],
      target: { kind: "design_preferences", sectionId: "theme", anchor: "mobile-actions" },
    }],
  };
  return websiteBuildEvaluationReportSchema.parse({
    ...candidate,
    reportHash: websiteEvaluationReportHash(candidate),
  });
}

function capturedEvidenceFixture() {
  const routes = [{ id: "home", route: "/", contentLength: 1, home: true }];
  const evidence: any[] = [];
  for (const viewport of ["1440x1000", "390x844", "320x720"] as const) {
    evidence.push({
      id: `home:${viewport}:screenshot`, kind: "screenshot", route: "/", viewport, value: {},
    });
    evidence.push({
      id: `home:${viewport}:axe`, kind: "axe", route: "/", viewport, value: {},
    });
  }
  evidence.push(
    { id: "home:dom", kind: "dom", route: "/", value: {} },
    { id: "home:a11y", kind: "accessibility_tree", route: "/", value: {} },
    { id: "home:lighthouse", kind: "lighthouse", route: "/", value: {} },
    { id: "home:structural", kind: "structural_qa", route: "/", value: {} },
    ...WEBSITE_BUILD_EVALUATION_CHECKS.map(({ id }) => ({
      id: `evidence:${id}`, kind: "public_fact", value: { checkId: id },
    })),
  );
  const frozen = freezeWebsiteEvaluationEvidence({ buildId, routes, evidence });
  return {
    evidenceHash: frozen.evidenceHash,
    allowedEvidenceIds: frozen.allowedEvidenceIds,
    artifactId: "fixture-artifact",
    publicEvidence: { schemaVersion: 1 as const, buildId, routes, evidence },
    buildOrdinal: 1,
    coverage: {
      requiredEvidencePercent: 100 as const,
      routeViewportPercent: 100 as const,
      brandReferencePercent: 0,
      criticalRouteIds: frozen.frozen.criticalRoutes.map(({ id }) => id),
      structuralRouteIds: frozen.frozen.structuralRoutes.map(({ id }) => id),
      viewports: frozen.frozen.viewports.map(({ id }) => id),
    },
  };
}

function judgeOutput(): WebsiteBuildEvaluationJudgeOutput {
  const candidate = report();
  return {
    schemaVersion: 1,
    operationToken: runId,
    evidenceFingerprint: fingerprint,
    judgments: candidate.judgments,
    criticalRisks: candidate.criticalRisks,
    findings: candidate.findings,
    summary: candidate.summary,
  };
}

function run(status: WebsiteBuildEvaluationRunDto["status"] = "completed"): WebsiteBuildEvaluationRunDto {
  return {
    runId,
    projectId,
    buildId,
    stage: "build_readiness",
    status,
    attemptCount: 1,
    automatic: true,
    evidenceFingerprint: fingerprint,
    createdAt: "2026-11-08T08:00:00.000Z",
    updatedAt: "2026-11-08T08:01:00.000Z",
    report: status === "completed" ? report() : null,
    error: status === "failed" ? { code: "CAPTURE_FAILED", message: "采集失败。" } : null,
  };
}

describe("website evaluation evidence boundary", () => {
  const routes = [
    { id: "article", route: "/article", contentLength: 9000 },
    { id: "assistant", route: "/help", contentLength: 300, assistant: true },
    { id: "contact", route: "/contact", contentLength: 500, contact: true },
    { id: "task", route: "/start", contentLength: 700, visitorTaskEntry: true },
    { id: "home", route: "/", contentLength: 1000, home: true },
    { id: "other", route: "/other", contentLength: 200 },
  ];

  it("selects at most five unique priority routes and freezes all three viewports", () => {
    const selected = selectWebsiteEvaluationCriticalRoutes(routes);
    expect(selected.map(({ id }) => id)).toEqual([
      "home", "task", "contact", "assistant", "article",
    ]);
    const evidence: any[] = [];
    for (const item of selected) {
      for (const viewport of ["1440x1000", "390x844", "320x720"] as const) {
        evidence.push({ id: `${item.id}:${viewport}:screenshot`, kind: "screenshot", route: item.route, viewport, value: {} });
        evidence.push({ id: `${item.id}:${viewport}:axe`, kind: "axe", route: item.route, viewport, value: {} });
      }
      evidence.push({ id: `${item.id}:dom`, kind: "dom", route: item.route, value: {} });
      evidence.push({ id: `${item.id}:a11y`, kind: "accessibility_tree", route: item.route, value: {} });
      evidence.push({ id: `${item.id}:lighthouse`, kind: "lighthouse", route: item.route, value: {} });
    }
    for (const item of routes) {
      evidence.push({ id: `${item.id}:structural`, kind: "structural_qa", route: item.route, value: {} });
    }
    const frozen = freezeWebsiteEvaluationEvidence({
      buildId,
      routes,
      evidence,
    });
    expect(frozen.frozen.viewports.map(({ id }) => id)).toEqual([
      "1440x1000", "390x844", "320x720",
    ]);
    expect(frozen.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => freezeWebsiteEvaluationEvidence({
      buildId,
      routes,
      evidence: evidence.slice(1),
    })).toThrow(/REQUIRED_EVIDENCE_MISSING/);
  });

  it("rejects signed URLs and private-shaped runner input", () => {
    expect(() => freezeWebsiteEvaluationEvidence({
      buildId,
      routes,
      evidence: [{
        id: "bad",
        kind: "public_fact",
        value: { signedUrl: "https://example.test/file?signature=secret" },
      }],
    })).toThrow(/PRIVATE_EVIDENCE_REJECTED/);
  });
});

describe("website evaluation read/retry/review service", () => {
  function harness(overrides: Partial<WebsiteEvaluationStore> = {}) {
    const store: WebsiteEvaluationStore = {
      list: vi.fn(async () => ({ latest: run(), history: [run()], nextCursor: null })),
      getRun: vi.fn(async () => run()),
      retry: vi.fn(async () => run("queued")),
      getReport: vi.fn(async () => report()),
      listReviews: vi.fn(async () => []),
      appendReview: vi.fn(async (input) => ({
        reviewId: "00000000-0000-4000-8000-000000000005",
        reportId: input.reportId,
        reviewerUserId: input.actorUserId,
        disposition: input.review.disposition,
        checkComments: input.review.checkComments,
        ...(input.review.repairItem ? { repairItem: input.review.repairItem } : {}),
        note: input.review.note,
        createdAt: "2026-11-08T08:05:00.000Z",
      })),
      ...overrides,
    };
    const core = {
      context: () => ({
        accountUserId: 42,
        actorUserId: 7,
        enterpriseProjectId: "tenant-a",
        businessOwnerId: "42",
        businessActorId: "7",
      }),
      database: async () => { throw new Error("injected store should be used"); },
      environment: {},
      websiteEvaluationStore: store,
    } satisfies ModuleHttpCore;
    return { store, service: createWebsiteEvaluationService(core, {} as Request) };
  }

  it("restores authoritative history and forwards server-derived ownership", async () => {
    const { store, service } = harness();
    const result = await service.latest(projectId, buildId);
    expect(result.latest?.report?.score).toBe(100);
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({
      accountUserId: 42,
      actorUserId: 7,
      enterpriseProjectId: "tenant-a",
      projectId,
      buildId,
      limit: 20,
    }));
  });

  it("uses client request id for retry and appends supplementary review", async () => {
    const { store, service } = harness();
    await expect(service.retry(runId, { clientRequestId: "retry-request-001" }))
      .resolves.toMatchObject({ status: "queued" });
    const review = await service.appendReview(reportId, {
      clientRequestId: "review-request-001",
      disposition: "concerns",
      checkComments: [],
      note: "需要人工确认品牌语调。",
    });
    expect(review.disposition).toBe("concerns");
    expect(store.retry).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      clientRequestId: "retry-request-001",
    }));
    expect(store.appendReview).toHaveBeenCalledOnce();
  });

  it("binds a supplementary review to one repair item and rejects foreign targets", async () => {
    const validReport = reportWithRepairItems();
    const { store, service } = harness({ getReport: vi.fn(async () => validReport) });
    await expect(service.appendReview(reportId, {
      clientRequestId: "review-targeted-001",
      disposition: "concerns",
      checkComments: [],
      repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
      note: "需要增大触控区域。",
    })).resolves.toMatchObject({
      repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
    });
    expect(store.appendReview).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
      }),
    }));

    await expect(service.appendReview(reportId, {
      clientRequestId: "review-targeted-critical",
      disposition: "agree",
      checkComments: [],
      repairItem: { kind: "critical_risk", id: "risk-assistant-private-boundary" },
      note: "认可收紧助手知识范围的计划。",
    })).resolves.toMatchObject({
      repairItem: { kind: "critical_risk", id: "risk-assistant-private-boundary" },
    });

    await expect(service.appendReview(reportId, {
      clientRequestId: "review-targeted-002",
      disposition: "reject",
      checkComments: [],
      repairItem: { kind: "critical_risk", id: "risk-from-another-report" },
      note: "错误坐标。",
    })).rejects.toEqual(expect.objectContaining({
      code: "EVALUATION_REVIEW_TARGET_INVALID",
      status: 400,
    }));
    await expect(service.appendReview(reportId, {
      clientRequestId: "review-targeted-wrong-kind",
      disposition: "reject",
      checkComments: [],
      repairItem: { kind: "critical_risk", id: "finding-mobile-touch-targets" },
      note: "坐标类型错误。",
    })).rejects.toEqual(expect.objectContaining({
      code: "EVALUATION_REVIEW_TARGET_INVALID",
      status: 400,
    }));
    await expect(service.appendReview(reportId, {
      clientRequestId: "review-targeted-empty-note",
      disposition: "agree",
      checkComments: [],
      repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
      note: "   ",
    })).rejects.toBeInstanceOf(Error);
    expect(store.appendReview).toHaveBeenCalledTimes(2);
  });

  it("returns a typed not-found error instead of exposing another tenant", async () => {
    const { service } = harness({ getRun: vi.fn(async () => null) });
    await expect(service.observe(runId)).rejects.toEqual(expect.objectContaining({
      name: "WebsiteEvaluationError",
      code: "EVALUATION_NOT_FOUND",
      status: 404,
    } satisfies Partial<WebsiteEvaluationError>));
  });

  it("does not expose review reads or writes from an unowned report", async () => {
    const { store, service } = harness({ getReport: vi.fn(async () => null) });
    await expect(service.reviews(reportId)).rejects.toEqual(expect.objectContaining({
      code: "EVALUATION_REPORT_NOT_FOUND",
      status: 404,
    }));
    await expect(service.appendReview(reportId, {
      clientRequestId: "review-cross-tenant",
      disposition: "agree",
      checkComments: [],
      note: "不应保存。",
    })).rejects.toEqual(expect.objectContaining({
      code: "EVALUATION_REPORT_NOT_FOUND",
      status: 404,
    }));
    expect(store.listReviews).not.toHaveBeenCalled();
    expect(store.appendReview).not.toHaveBeenCalled();
  });

  it("rejects a schema-valid report whose content no longer matches its hash", async () => {
    const original = report();
    const tampered = {
      ...original,
      score: 0,
      verdict: "not_recommended",
    };
    expect(() =>
      verifyWebsiteEvaluationReportIntegrity(tampered, original.reportHash)
    ).toThrow(/内容摘要不一致/);

    const db: any = {
      execute: vi.fn(async () => [[{
        reportId,
        reportJson: tampered,
        reportResultHash: original.reportHash,
      }]]),
    };
    const sqlStore = createSqlWebsiteEvaluationStore({
      context: () => { throw new Error("not used"); },
      database: async () => db,
      environment: {},
    });
    await expect(sqlStore.getReport({
      accountUserId: 42,
      actorUserId: 7,
      enterpriseProjectId: "tenant-a",
      reportId,
    })).rejects.toMatchObject({
      code: "EVALUATION_REPORT_INVALID",
      status: 503,
    });
  });

  it("mounts restore/retry/review only and applies no-store to GET and POST", async () => {
    const { store } = harness();
    const core = {
      context: () => ({
        accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
        businessOwnerId: "42", businessActorId: "7",
      }),
      database: async () => { throw new Error("not used"); },
      environment: {},
      websiteEvaluationStore: store,
    } satisfies ModuleHttpCore;
    registerIntentSkillPorts({} as any);
    const router: any = createModuleHttpApi(core);
    const routes = router.stack
      .map((layer: any) => layer.route)
      .filter(Boolean);
    const websiteRoutes = routes
      .filter((route: any) => String(route.path).startsWith("/website-evaluations"))
      .map((route: any) => `${Object.keys(route.methods)[0]} ${route.path}`);
    expect(websiteRoutes).toEqual([
      "get /website-evaluations",
      "get /website-evaluations/runs/:runId",
      "post /website-evaluations/runs/:runId/retry",
      "get /website-evaluations/reports/:reportId",
      "get /website-evaluations/reports/:reportId/reviews",
      "post /website-evaluations/reports/:reportId/reviews",
    ]);
    expect(websiteRoutes).not.toContain("post /website-evaluations");

    const headers: Array<[string, string]> = [];
    const response: any = {
      setHeader: (name: string, value: string) => { headers.push([name, value]); },
      status: vi.fn(function (this: any) { return this; }),
      json: vi.fn(function (this: any) { return this; }),
    };
    const getRoute = routes.find((route: any) => route.path === "/website-evaluations");
    await getRoute.stack[0].handle({ query: { projectId, buildId } }, response);
    const retryRoute = routes.find((route: any) => route.path === "/website-evaluations/runs/:runId/retry");
    await retryRoute.stack[0].handle({
      params: { runId }, body: { clientRequestId: "retry-request-001" },
    }, response);
    expect(headers).toEqual([
      ["Cache-Control", "no-store"],
      ["Cache-Control", "no-store"],
    ]);
  });

  it("paginates project-wide SQL history while keeping latest scoped to the requested build", async () => {
    const previousBuildId = "00000000-0000-4000-8000-000000000009";
    const rows = Array.from({ length: 21 }, (_, index) => ({
      runId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      projectId,
      buildId: index === 0 ? previousBuildId : buildId,
      stage: "build_readiness",
      status: "failed",
      attemptCount: 2,
      evidenceFingerprint: fingerprint,
      errorCode: "FAILED",
      errorMessage: "评估失败。",
      createdAt: new Date(1_800_000_000_000 - index * 1_000),
      updatedAt: new Date(1_800_000_000_500 - index * 1_000),
      reportJson: null,
    }));
    const latestRow = { ...rows[1], runId, buildId };
    const db: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ buildId }]])
      .mockResolvedValueOnce([rows])
      .mockResolvedValueOnce([[latestRow]]) };
    const sqlStore = createSqlWebsiteEvaluationStore({
      context: () => { throw new Error("not used"); },
      database: async () => db,
      environment: {},
    });
    const page = await sqlStore.list({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      projectId, buildId, limit: 20,
    });
    expect(page.history).toHaveLength(20);
    expect(page.history[0].buildId).toBe(previousBuildId);
    expect(page.latest).toMatchObject({ runId, buildId });
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it("does not expose project history through an unowned or mismatched build coordinate", async () => {
    const db: any = { execute: vi.fn(async () => [[]]) };
    const sqlStore = createSqlWebsiteEvaluationStore({
      context: () => { throw new Error("not used"); },
      database: async () => db,
      environment: {},
    });
    await expect(sqlStore.list({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      projectId, buildId, limit: 20,
    })).resolves.toEqual({ latest: null, history: [], nextCursor: null });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("returns existing retry and review rows without duplicate inserts", async () => {
    const failedRow = {
      runId, projectId, buildId, stage: "build_readiness", status: "failed",
      attemptCount: 1, evidenceFingerprint: fingerprint,
      errorCode: "FAILED", errorMessage: "失败。", reportJson: null,
      createdAt: new Date("2026-11-08T08:00:00Z"),
      updatedAt: new Date("2026-11-08T08:01:00Z"),
    };
    const queuedRow = { ...failedRow, status: "queued", errorCode: null, errorMessage: null };
    const retryTx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[failedRow]])
      .mockResolvedValueOnce([[{ id: "existing-attempt" }]]) };
    const retryDb: any = {
      transaction: (callback: any) => callback(retryTx),
      execute: vi.fn(async () => [[queuedRow]]),
    };
    const coreBase = {
      context: () => { throw new Error("not used"); },
      environment: {},
    };
    const retryStore = createSqlWebsiteEvaluationStore({
      ...coreBase, database: async () => retryDb,
    });
    await expect(retryStore.retry({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      runId, clientRequestId: "retry-request-001",
    })).resolves.toMatchObject({ status: "queued" });
    expect(retryTx.execute).toHaveBeenCalledTimes(3);

    const ownedReviewReport = reportWithRepairItems();
    const reviewRow = {
      reviewId: "00000000-0000-4000-8000-000000000005",
      reportId, reviewerUserId: 7, disposition: "agree",
      checkReviews: {
        checkComments: [],
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
      },
      note: "认可扩大移动端触控区域的计划。", createdAt: new Date(),
    };
    const reviewTx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{
        reportId,
        reportJson: ownedReviewReport,
        reportResultHash: ownedReviewReport.reportHash,
      }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[reviewRow]]) };
    const reviewDb: any = {
      transaction: (callback: any) => callback(reviewTx),
      execute: vi.fn(async () => [[reviewRow]]),
    };
    const reviewStore = createSqlWebsiteEvaluationStore({
      ...coreBase, database: async () => reviewDb,
    });
    await expect(reviewStore.appendReview({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      reportId,
      review: {
        clientRequestId: "review-request-001",
        disposition: "agree", checkComments: [],
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
        note: "认可扩大移动端触控区域的计划。",
      },
    })).resolves.toMatchObject({
      reviewId: reviewRow.reviewId,
      repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
    });
    expect(reviewTx.execute).toHaveBeenCalledTimes(3);

    const conflictTx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[
        {
          reportId,
          reportJson: ownedReviewReport,
          reportResultHash: ownedReviewReport.reportHash,
        },
      ]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[reviewRow]]) };
    const conflictStore = createSqlWebsiteEvaluationStore({
      ...coreBase,
      database: async () => ({
        transaction: (callback: any) => callback(conflictTx),
        execute: vi.fn(),
      }),
    });
    await expect(conflictStore.appendReview({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      reportId,
      review: {
        clientRequestId: "review-request-001",
        disposition: "reject", checkComments: [],
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
        note: "不同的评审内容。",
      },
    })).rejects.toMatchObject({
      code: "EVALUATION_REVIEW_IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    expect(conflictTx.execute).toHaveBeenCalledTimes(3);
  });

  it("fails closed when a stored targeted review payload is corrupted", async () => {
    const ownedReviewReport = reportWithRepairItems();
    const db: any = { execute: vi.fn()
      .mockResolvedValueOnce([[
        {
          reportId,
          reportJson: ownedReviewReport,
          reportResultHash: ownedReviewReport.reportHash,
        },
      ]])
      .mockResolvedValueOnce([[
        {
          reviewId: "00000000-0000-4000-8000-000000000005",
          reportId,
          reviewerUserId: 7,
          disposition: "agree",
          checkReviews: "{not-json",
          note: "认可计划。",
          createdAt: new Date(),
        },
      ]]) };
    const store = createSqlWebsiteEvaluationStore({
      context: () => { throw new Error("not used"); },
      database: async () => db,
      environment: {},
    });
    await expect(store.listReviews({
      accountUserId: 42,
      actorUserId: 7,
      enterpriseProjectId: "tenant-a",
      reportId,
    })).rejects.toMatchObject({
      code: "EVALUATION_REVIEW_INVALID",
      status: 503,
    });
  });

  it("does not append a manual attempt after the daily budget is exhausted", async () => {
    const failedRow = {
      runId, projectId, buildId, stage: "build_readiness", status: "failed",
      attemptCount: 1, evidenceFingerprint: fingerprint,
      errorCode: "FAILED", errorMessage: "失败。", reportJson: null,
      createdAt: new Date("2026-11-08T08:00:00Z"),
      updatedAt: new Date("2026-11-08T08:01:00Z"),
    };
    const tx: any = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ id: runId }]])
        .mockResolvedValueOnce([[failedRow]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ usageUnits: 1 }]]),
    };
    const retryStore = createSqlWebsiteEvaluationStore({
      context: () => { throw new Error("not used"); },
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_WORKER_ENABLED: "1",
        FRONTMIND_WEBSITE_EVALUATION_DAILY_BUDGET_UNITS: "1",
      },
    });
    await expect(retryStore.retry({
      accountUserId: 42, actorUserId: 7, enterpriseProjectId: "tenant-a",
      runId, clientRequestId: "retry-request-budget",
    })).rejects.toMatchObject({
      code: "EVALUATION_DAILY_BUDGET_EXHAUSTED",
      status: 503,
    });
    expect(tx.execute).toHaveBeenCalledTimes(4);
  });
});

describe("restart-safe website evaluation runtime", () => {
  it("keeps shadow runs out of user reads and locks project-level active work", () => {
    const serviceSource = readFileSync(
      new URL("../server/website-evaluation-service.ts", import.meta.url),
      "utf8",
    );
    const runtimeSource = readFileSync(
      new URL("../server/website-evaluation-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(serviceSource.match(/r\.admission_mode = 'user'/gu)).toHaveLength(4);
    expect(serviceSource).toContain("started_at = NULL");
    expect(runtimeSource).toContain("INNER JOIN site_projects p ON p.id = r.project_id");
    expect(runtimeSource).toContain("busy.status IN ('capturing', 'running', 'result_pending')");
    expect(runtimeSource).toContain("OR a.status = 'queued'");
  });

  function runtimeHarness(
    capture?: (input: any) => Promise<any>,
    options: { maxAttemptMs?: number; now?: () => Date } = {},
  ) {
    let current: WebsiteEvaluationRuntimeRun = {
      runId,
      projectId,
      buildId,
      status: "queued",
      attemptCount: 0,
      automaticRetryCount: 0,
      startedAt: null,
      evidenceFingerprint: fingerprint,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      publicInput: { visitorTask: { goal: "提交咨询" } },
    };
    const evidence = capturedEvidenceFixture();
    const store: WebsiteEvaluationRuntimeStore = {
      claimNext: vi.fn(async () => ["completed", "failed"].includes(current.status) ? null : structuredClone(current)),
      startAttempt: vi.fn(async ({ now }) => {
        current = { ...current, status: "capturing", attemptCount: current.attemptCount + 1, startedAt: now };
      }),
      saveCapturedEvidence: vi.fn(async ({ evidence: captured }) => {
        current = { ...current, status: "running", evidence: captured };
      }),
      savePendingReport: vi.fn(async ({ report: pendingReport }) => {
        current = { ...current, status: "result_pending", pendingReport };
      }),
      commitReportOnce: vi.fn(async () => { current = { ...current, status: "completed" }; }),
      scheduleAutomaticRetry: vi.fn(async () => {
        current = {
          ...current,
          status: "queued",
          automaticRetryCount: current.automaticRetryCount + 1,
          startedAt: null,
          evidence: undefined,
        };
      }),
      failTerminal: vi.fn(async () => { current = { ...current, status: "failed" }; }),
    };
    const runner = createFakeWebsiteEvaluationRunner({
      evidence,
      judgeOutput: judgeOutput(),
    });
    if (capture) runner.capture = capture;
    const runtime = createWebsiteEvaluationRuntime({
      store,
      runner,
      leaseOwner: "test-worker",
      now: options.now ?? (() => new Date("2026-11-08T08:00:00.000Z")),
      maxAttemptMs: options.maxAttemptMs,
    });
    return { runtime, runner, store, get run() { return current; }, evidence };
  }

  it("advances queued through capture, judge and immutable result commit", async () => {
    const harness = runtimeHarness();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "capturing" });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "running" });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "result_pending" });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "completed" });
    expect(harness.store.commitReportOnce).toHaveBeenCalledOnce();
    expect(harness.run.status).toBe("completed");
  });

  it("derives required evidence and rejects a runner that only claims full coverage", async () => {
    const missing = capturedEvidenceFixture();
    missing.publicEvidence.evidence = missing.publicEvidence.evidence.filter(
      ({ id }) => id !== "home:320x720:screenshot",
    );
    const harness = runtimeHarness(async () => missing);
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "failed" });
    expect(harness.store.failTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REQUIRED_EVIDENCE_MISSING" }),
    );
    expect(harness.store.saveCapturedEvidence).not.toHaveBeenCalled();
  });

  it("rejects evidence mutated after its authoritative hash was frozen", async () => {
    const tampered = capturedEvidenceFixture();
    tampered.publicEvidence.evidence[0] = {
      ...tampered.publicEvidence.evidence[0],
      value: { changedAfterFreeze: true },
    };
    const harness = runtimeHarness(async () => tampered);
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "failed" });
    expect(harness.store.failTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REQUIRED_EVIDENCE_INVALID" }),
    );
  });

  it("rejects allowed evidence ids that were not derived from the manifest", async () => {
    const mismatched = capturedEvidenceFixture();
    mismatched.allowedEvidenceIds = [...mismatched.allowedEvidenceIds].reverse();
    const harness = runtimeHarness(async () => mismatched);
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "failed" });
    expect(harness.store.failTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REQUIRED_EVIDENCE_INVALID" }),
    );
  });

  it("computes score, verdict, timestamps and hash from strict judge anchors", () => {
    const evidence = { ...capturedEvidenceFixture(), artifactId: null, buildOrdinal: 9 };
    const authoritative = authoritativeWebsiteEvaluationReport({
      judgeOutput: judgeOutput(),
      model: "local-fake-website-judge",
      skillHash: "f".repeat(64),
      evidence,
      now: new Date("2026-11-08T09:00:00.000Z"),
      run: {
        runId,
        projectId,
        buildId,
        status: "running",
        attemptCount: 1,
        automaticRetryCount: 0,
        startedAt: new Date("2026-11-08T08:59:00.000Z"),
        evidenceFingerprint: fingerprint,
        evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
        ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
        judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
        skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
        publicInput: { buildOrdinal: 9 },
      },
    });
    expect(authoritative).toMatchObject({
      score: 100,
      verdict: "recommended",
      buildOrdinal: 9,
      createdAt: "2026-11-08T09:00:00.000Z",
      completedAt: "2026-11-08T09:00:00.000Z",
    });
    expect(authoritative.reportId).not.toBe(reportId);
    expect(authoritative.reportHash).not.toBe(report().reportHash);
    expect(authoritative.reportHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      authoritativeWebsiteEvaluationReport({
        judgeOutput: { ...judgeOutput(), score: 0 },
        model: "local-fake-website-judge",
        skillHash: "f".repeat(64),
        evidence,
        now: new Date("2026-11-08T09:00:00.000Z"),
        run: {
          runId,
          projectId,
          buildId,
          status: "running",
          attemptCount: 1,
          automaticRetryCount: 0,
          startedAt: null,
          evidenceFingerprint: fingerprint,
          evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
          ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
          judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
          skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
          publicInput: { buildOrdinal: 9 },
        },
      }),
    ).toThrow();
  });

  it("automatically retries one transient failure and then stops", async () => {
    const failure = new WebsiteEvaluationRuntimeError("CAPTURE_TEMPORARY", "临时采集失败。", true);
    const capture = vi.fn(async () => { throw failure; });
    const harness = runtimeHarness(capture);
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "queued" });
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "failed" });
    expect(harness.store.scheduleAutomaticRetry).toHaveBeenCalledOnce();
    expect(harness.store.failTerminal).toHaveBeenCalledOnce();
  });

  it("never switches the frozen model or skill on a retry", async () => {
    const harness = runtimeHarness();
    harness.run.frozenModel = "another-model";
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({
      status: "failed",
    });
    expect(harness.store.startAttempt).not.toHaveBeenCalled();
    expect(harness.store.failTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WEBSITE_EVALUATION_VERSION_MISMATCH" }),
    );
  });

  it("enforces the 30 minute attempt limit and keeps assistant probes isolated", async () => {
    const expired = runtimeHarness();
    await expired.runtime.runOnce();
    expired.run.startedAt = new Date("2026-11-08T07:29:59.000Z");
    await expect(expired.runtime.runOnce()).resolves.toMatchObject({
      status: "queued",
    });
    expect(expired.store.scheduleAutomaticRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WEBSITE_EVALUATION_ATTEMPT_TIMEOUT" }),
    );

    const assistant = runtimeHarness();
    assistant.run.publicInput.visitorTaskV1 = {
      schemaVersion: 1,
      assistantRequired: true,
    };
    await assistant.runtime.runOnce();
    await expect(assistant.runtime.runOnce()).resolves.toMatchObject({
      status: "failed",
    });
    expect(assistant.store.failTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REQUIRED_ASSISTANT_PROBE_MISSING" }),
    );
  });

  it("keeps an isolated failed assistant probe as scoreable negative evidence", async () => {
    const base = capturedEvidenceFixture();
    const manifest = structuredClone(base.publicEvidence);
    manifest.evidence.push({
      id: "assistant:probe:failed",
      kind: "public_fact",
      value: { status: "failed", reason: "The task could not be completed." },
    });
    const frozen = freezeWebsiteEvaluationEvidence(manifest);
    const failedProbe = {
      ...base,
      evidenceHash: frozen.evidenceHash,
      allowedEvidenceIds: frozen.allowedEvidenceIds,
      publicEvidence: manifest,
      assistantProbe: {
        mode: "isolated_read_only" as const,
        evidenceId: "assistant:probe:failed",
        conversationWritten: false as const,
        status: "failed" as const,
      },
    };
    const harness = runtimeHarness(async () => failedProbe);
    const judge = vi.fn(harness.runner.judge);
    harness.runner.judge = judge;
    harness.run.publicInput.visitorTaskV1 = {
      schemaVersion: 1,
      assistantRequired: true,
    };
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "capturing" });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "running" });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "result_pending" });
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          assistantProbe: expect.objectContaining({ status: "failed" }),
        }),
      }),
    );
  });

  it("aborts an in-flight capture at the hard attempt deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const capture = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      observedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const harness = runtimeHarness(capture, { maxAttemptMs: 15 });
    await harness.runtime.runOnce();
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "queued" });
    expect(observedSignal?.aborted).toBe(true);
    expect(harness.store.scheduleAutomaticRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WEBSITE_EVALUATION_ATTEMPT_TIMEOUT" }),
    );
    expect(harness.store.saveCapturedEvidence).not.toHaveBeenCalled();
  });

  it("applies the same hard deadline and abort signal to the judge", async () => {
    const harness = runtimeHarness(undefined, { maxAttemptMs: 15 });
    await harness.runtime.runOnce();
    await harness.runtime.runOnce();
    let observedSignal: AbortSignal | undefined;
    harness.runner.judge = vi.fn(async ({ signal }) => {
      observedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    await expect(harness.runtime.runOnce()).resolves.toMatchObject({ status: "queued" });
    expect(observedSignal?.aborted).toBe(true);
    expect(harness.store.savePendingReport).not.toHaveBeenCalled();
    expect(harness.store.scheduleAutomaticRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WEBSITE_EVALUATION_ATTEMPT_TIMEOUT" }),
    );
  });

  it("fails closed on worker switch, budget and per-project concurrency", () => {
    expect(websiteEvaluationWorkerAdmission({
      environment: {}, dailyUsageUnits: 0, activeProjectRuns: 0,
    })).toMatchObject({ admitted: false, reason: "worker_disabled" });
    const environment = {
      FRONTMIND_WEBSITE_EVALUATION_WORKER_ENABLED: "true",
      FRONTMIND_WEBSITE_EVALUATION_DAILY_BUDGET_UNITS: "10",
    };
    expect(websiteEvaluationWorkerAdmission({
      environment, dailyUsageUnits: 10, activeProjectRuns: 0,
    })).toMatchObject({ admitted: false, reason: "daily_budget_exhausted" });
    expect(websiteEvaluationWorkerAdmission({
      environment, dailyUsageUnits: 0, activeProjectRuns: 1,
    })).toMatchObject({ admitted: false, reason: "project_concurrency" });
    expect(websiteEvaluationWorkerAdmission({
      environment, dailyUsageUnits: 9, activeProjectRuns: 0,
    })).toEqual({ admitted: true, dailyBudgetUnits: 10 });
  });

  it("claims persistent work with a lease and rejects immutable report overwrite", async () => {
    const claimed = {
      runId, projectId, buildId, status: "running", attemptCount: 1,
      automaticRetryCount: 0, startedAt: new Date("2026-11-08T08:00:00Z"),
      evidenceFingerprint: fingerprint,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      attemptId: "00000000-0000-4000-8000-000000000006",
      attemptTrigger: "automatic",
      attemptRuntime: { evidence: {
        evidenceHash: "e".repeat(64),
        allowedEvidenceIds: ["public:home"],
        artifactId: null,
        publicEvidence: { routes: ["/"] },
      } },
    };
    const claimTx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[claimed]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) };
    const claimDb: any = { transaction: (callback: any) => callback(claimTx) };
    const store = createSqlWebsiteEvaluationRuntimeStore({ database: async () => claimDb });
    await expect(store.claimNext({
      leaseOwner: "worker-a",
      now: new Date("2026-11-08T08:01:00Z"),
      leaseExpiresAt: new Date("2026-11-08T08:03:00Z"),
    })).resolves.toMatchObject({ runId, status: "running", attemptId: claimed.attemptId });
    expect(claimTx.execute).toHaveBeenCalledTimes(3);

    const immutableTx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[{ id: reportId, resultHash: "f".repeat(64) }]]) };
    const immutableDb: any = { transaction: (callback: any) => callback(immutableTx) };
    const immutable = createSqlWebsiteEvaluationRuntimeStore({ database: async () => immutableDb });
    await expect(immutable.commitReportOnce({
      run: {
        ...claimed,
        publicInput: {},
        evidence: (claimed.attemptRuntime as any).evidence,
      } as WebsiteEvaluationRuntimeRun,
      leaseOwner: "worker-a",
      report: report(),
      now: new Date("2026-11-08T08:02:00Z"),
    })).rejects.toEqual(expect.objectContaining({
      code: "WEBSITE_EVALUATION_REPORT_IMMUTABLE",
    }));
    expect(immutableTx.execute).toHaveBeenCalledTimes(2);
  });

  it("treats an empty evaluation queue as idle without creating a failed sweep", async () => {
    const tx: any = { execute: vi.fn().mockResolvedValueOnce([[]]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({
        transaction: (callback: any) => callback(tx),
      } as any),
    });
    await expect(store.claimNext({
      leaseOwner: "worker-idle",
      now: new Date("2026-11-08T08:00:00Z"),
      leaseExpiresAt: new Date("2026-11-08T08:30:00Z"),
    })).resolves.toBeNull();
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("takes the global claim lock while converging an already-metered attempt", async () => {
    const claimed = {
      runId, projectId, buildId, status: "running", attemptCount: 1,
      automaticRetryCount: 0, startedAt: new Date("2026-11-08T08:00:00Z"),
      evidenceFingerprint: fingerprint,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      attemptId: "00000000-0000-4000-8000-000000000006",
      attemptTrigger: "automatic",
      attemptStatus: "running",
      attemptRuntime: {},
    };
    const tx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[claimed]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
    });
    await expect(store.claimNext({
      leaseOwner: "worker-converge",
      now: new Date("2026-11-08T08:01:00Z"),
      leaseExpiresAt: new Date("2026-11-08T08:03:00Z"),
      allowNewAttempt: false,
    })).resolves.toMatchObject({ runId, status: "running" });
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it("reserves a new automatic attempt under the database budget lock", async () => {
    const queued = {
      runId, projectId, buildId, status: "queued", attemptCount: 0,
      automaticRetryCount: 0, startedAt: null,
      evidenceFingerprint: fingerprint,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      buildOrdinal: 1,
      buildBrief: {},
      attemptId: null,
      attemptStatus: null,
      attemptRuntime: null,
    };
    const tx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[queued]])
      .mockResolvedValueOnce([[{ usageUnits: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_WORKER_ENABLED: "1",
        FRONTMIND_WEBSITE_EVALUATION_DAILY_BUDGET_UNITS: "1",
      },
    });
    await expect(store.claimNext({
      leaseOwner: "worker-budget",
      now: new Date("2026-11-08T08:00:00Z"),
      leaseExpiresAt: new Date("2026-11-08T08:30:00Z"),
    })).resolves.toMatchObject({
      runId,
      attemptCount: 1,
      attemptTrigger: "automatic",
      attemptId: expect.any(String),
    });
    expect(tx.execute).toHaveBeenCalledTimes(6);
  });

  it("does not reserve a second automatic attempt after the locked daily count is full", async () => {
    const queued = {
      runId, projectId, buildId, status: "queued", attemptCount: 0,
      automaticRetryCount: 0, startedAt: null,
      evidenceFingerprint: fingerprint,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      buildOrdinal: 1,
      buildBrief: {},
      attemptId: null,
      attemptStatus: null,
      attemptRuntime: null,
    };
    const tx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[queued]])
      .mockResolvedValueOnce([[{ usageUnits: 1 }]]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_WORKER_ENABLED: "1",
        FRONTMIND_WEBSITE_EVALUATION_DAILY_BUDGET_UNITS: "1",
      },
    });
    await expect(store.claimNext({
      leaseOwner: "worker-budget",
      now: new Date("2026-11-08T08:00:00Z"),
      leaseExpiresAt: new Date("2026-11-08T08:30:00Z"),
    })).resolves.toBeNull();
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it("rejects a persistence transition after its lease expires", async () => {
    const tx: any = { execute: vi.fn().mockResolvedValueOnce([[]]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
    });
    await expect(store.saveCapturedEvidence({
      run: {
        runId, projectId, buildId, status: "capturing", attemptCount: 1,
        automaticRetryCount: 0, startedAt: new Date("2026-11-08T08:00:00Z"),
        evidenceFingerprint: fingerprint,
        evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
        ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
        judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
        skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
        publicInput: {},
        attemptId: "00000000-0000-4000-8000-000000000006",
      },
      leaseOwner: "expired-owner",
      evidence: capturedEvidenceFixture(),
      now: new Date("2026-11-08T08:31:00Z"),
    })).rejects.toMatchObject({ code: "WEBSITE_EVALUATION_LEASE_LOST" });
  });

  it("idempotently completes only when an existing report recomputes to its stored hash", async () => {
    const existingReport = report();
    const tx: any = { execute: vi.fn()
      .mockResolvedValueOnce([[{ id: runId }]])
      .mockResolvedValueOnce([[
        { id: reportId, resultJson: existingReport, resultHash: existingReport.reportHash },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) };
    const store = createSqlWebsiteEvaluationRuntimeStore({
      database: async () => ({ transaction: (callback: any) => callback(tx) } as any),
    });
    await expect(store.commitReportOnce({
      run: {
        runId, projectId, buildId, status: "result_pending", attemptCount: 1,
        automaticRetryCount: 0, startedAt: new Date("2026-11-08T08:00:00Z"),
        evidenceFingerprint: fingerprint,
        evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
        ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
        judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
        skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
        publicInput: {},
        attemptId: "00000000-0000-4000-8000-000000000006",
        evidence: capturedEvidenceFixture(),
      },
      leaseOwner: "worker-a",
      report: existingReport,
      now: new Date("2026-11-08T08:02:00Z"),
    })).resolves.toBeUndefined();
    expect(tx.execute).toHaveBeenCalledTimes(4);
  });
});
