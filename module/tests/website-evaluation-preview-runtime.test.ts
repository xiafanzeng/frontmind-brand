// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  type WebsiteBuildEvaluationCheckId,
  type WebsiteBuildEvaluationJudgeOutput,
  type WebsiteBuildEvaluationReport,
} from "../contracts/website-build-evaluation-run";
import { freezeWebsiteEvaluationEvidence } from "../server/website-evaluation-evidence";
import {
  createFakeWebsiteEvaluationRunner,
  createWebsiteEvaluationRuntime,
  type WebsiteEvaluationCapturedEvidence,
  type WebsiteEvaluationRuntimeRun,
  type WebsiteEvaluationRuntimeStore,
} from "../server/website-evaluation-runtime";
import {
  createWebsiteEvaluationPreview,
  WEBSITE_EVALUATION_PREVIEW_COORDINATES,
} from "../../standalone/website-evaluation-preview";

const projectId = "10000000-0000-4000-8000-000000000001";
const buildId = WEBSITE_EVALUATION_PREVIEW_COORDINATES.buildId;
const runId = WEBSITE_EVALUATION_PREVIEW_COORDINATES.runId;
const fingerprint = "a".repeat(64);

function runnerFixture(): {
  evidence: WebsiteEvaluationCapturedEvidence;
  judgeOutput: WebsiteBuildEvaluationJudgeOutput;
} {
  const preview = createWebsiteEvaluationPreview("completed");
  const anchors = preview.dimensions.flatMap((dimension) => dimension.anchors ?? []);
  const evidenceIds = Array.from(new Set(anchors.flatMap((anchor) => anchor.evidenceIds)));
  const routes = [{ id: "home", route: "/", contentLength: 1_200, home: true }];
  const manifestEvidence: any[] = [];
  for (const viewport of ["1440x1000", "390x844", "320x720"] as const) {
    manifestEvidence.push(
      { id: `home:${viewport}:screenshot`, kind: "screenshot", route: "/", viewport, value: {} },
      { id: `home:${viewport}:axe`, kind: "axe", route: "/", viewport, value: {} },
    );
  }
  manifestEvidence.push(
    { id: "home:dom", kind: "dom", route: "/", value: {} },
    { id: "home:a11y", kind: "accessibility_tree", route: "/", value: {} },
    { id: "home:lighthouse", kind: "lighthouse", route: "/", value: {} },
    { id: "home:structural", kind: "structural_qa", route: "/", value: {} },
    ...evidenceIds.map((id) => ({ id, kind: "public_fact", value: { source: "local-preview" } })),
  );
  const publicEvidence = {
    schemaVersion: 1 as const,
    buildId,
    routes,
    evidence: manifestEvidence,
  };
  const frozen = freezeWebsiteEvaluationEvidence({
    buildId,
    routes,
    evidence: manifestEvidence,
  });
  const evidence: WebsiteEvaluationCapturedEvidence = {
    evidenceHash: frozen.evidenceHash,
    allowedEvidenceIds: frozen.allowedEvidenceIds,
    artifactId: "local-preview-artifact",
    publicEvidence,
    buildOrdinal: 7,
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: preview.brandReferenceCoverage,
      criticalRouteIds: frozen.frozen.criticalRoutes.map(({ id }) => id),
      structuralRouteIds: frozen.frozen.structuralRoutes.map(({ id }) => id),
      viewports: frozen.frozen.viewports.map(({ id }) => id),
    },
    assistantProbe: {
      mode: "isolated_read_only",
      evidenceId: "ev-assistant-probe-transcript",
      conversationWritten: false,
      status: "failed",
    },
  };
  const judgeOutput: WebsiteBuildEvaluationJudgeOutput = {
    schemaVersion: 1,
    operationToken: runId,
    evidenceFingerprint: fingerprint,
    judgments: anchors.map((anchor) => ({
      checkId: anchor.id as WebsiteBuildEvaluationCheckId,
      anchor: anchor.score,
      rationale: anchor.summary,
      evidenceIds: anchor.evidenceIds,
    })),
    criticalRisks: [{
      id: "risk-assistant-private-boundary",
      kind: "assistant_safety_or_scope",
      title: "助手可能泄露内部交付备注",
      summary: "隔离探测发现私有知识边界失控。",
      checkIds: ["assistant_unknown_privacy"],
      evidenceIds: ["ev-assistant-private-boundary", "ev-assistant-probe-transcript"],
    }],
    findings: [
      {
        id: "finding-mobile-touch-targets",
        checkId: "visual_accessibility",
        severity: "high",
        title: "移动端有两个按钮偏小",
        summary: "320px 视口有两个触控目标不足。",
        impact: "移动访客更容易误触或放弃操作。",
        suggestedAction: "扩大按钮触控区域后重新生成。",
        evidenceIds: ["ev-axe-key-routes", "ev-mobile-320-touch-targets"],
        target: { kind: "design_preferences", sectionId: "theme", anchor: "mobile-actions" },
      },
      {
        id: "finding-brand-font-coverage",
        checkId: "brand_visual_tokens",
        severity: "medium",
        title: "品牌字体参考还不完整",
        summary: "长内容页仍使用默认衬线字体。",
        impact: "跨页面品牌识别不一致。",
        suggestedAction: "补齐 Brand Kit 字体偏好后重新生成。",
        evidenceIds: ["ev-brand_visual_tokens"],
        target: { kind: "brand_kit", sectionId: "evaluation-inputs", anchor: "font-preferences" },
      },
      {
        id: "finding-unknown-boundary",
        checkId: "facts_unknown_boundary",
        severity: "medium",
        title: "未知信息提示可以更明确",
        summary: "价格和交付时效缺少适用条件。",
        impact: "访客可能把条件性信息理解为确定承诺。",
        suggestedAction: "补充公开知识和边界说明后重新生成。",
        evidenceIds: ["ev-facts_unknown_boundary"],
        target: { kind: "knowledge", anchor: "commercial-boundaries" },
      },
      {
        id: "finding-long-content-navigation",
        checkId: "ia_long_content",
        severity: "low",
        title: "长内容页缺少页内定位",
        summary: "解决方案页缺少移动端章节跳转。",
        impact: "长页面扫描效率下降。",
        suggestedAction: "增加页内定位后重新生成。",
        evidenceIds: ["ev-ia_long_content"],
        target: { kind: "route", routeId: "solutions", anchor: "section-navigation" },
      },
    ],
    summary: preview.summary,
  };
  return { evidence, judgeOutput };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("standalone preview fake-runner parity", () => {
  it("advances the local fixture through the real runtime contract without network work", async () => {
    const preview = createWebsiteEvaluationPreview("completed");
    const fixtures = runnerFixture();
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
      publicInput: {
        buildOrdinal: 7,
        visitorTaskV1: { assistantRequired: true },
      },
    };
    let committedReport: WebsiteBuildEvaluationReport | null = null;
    const store: WebsiteEvaluationRuntimeStore = {
      claimNext: vi.fn(async () => current.status === "completed" ? null : structuredClone(current)),
      startAttempt: vi.fn(async ({ now }) => {
        current = { ...current, status: "capturing", attemptCount: 1, startedAt: now };
      }),
      saveCapturedEvidence: vi.fn(async ({ evidence }) => {
        current = { ...current, status: "running", evidence };
      }),
      savePendingReport: vi.fn(async ({ report }) => {
        current = { ...current, status: "result_pending", pendingReport: report };
      }),
      commitReportOnce: vi.fn(async ({ report }) => {
        committedReport = report;
        current = { ...current, status: "completed" };
      }),
      scheduleAutomaticRetry: vi.fn(async () => {
        throw new Error("local fixture should not retry");
      }),
      failTerminal: vi.fn(async ({ code, message }) => {
        throw new Error(`local fixture failed: ${code} ${message}`);
      }),
    };
    const runner = createFakeWebsiteEvaluationRunner(fixtures);
    const runtime = createWebsiteEvaluationRuntime({
      store,
      runner,
      leaseOwner: "local-preview-worker",
      now: () => new Date("2026-11-08T08:00:00.000Z"),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("unexpected network request"))));

    await expect(runtime.runOnce()).resolves.toMatchObject({ status: "capturing" });
    await expect(runtime.runOnce()).resolves.toMatchObject({ status: "running" });
    await expect(runtime.runOnce()).resolves.toMatchObject({ status: "result_pending" });
    await expect(runtime.runOnce()).resolves.toMatchObject({ status: "completed" });

    expect(committedReport).toMatchObject({
      score: preview.score,
      verdict: preview.recommendation,
      summary: preview.summary,
    });
    expect(committedReport?.judgments).toHaveLength(24);
    expect(committedReport?.criticalRisks.map(({ id }) => id)).toEqual(
      preview.criticalRiskIds,
    );
    expect(committedReport?.findings.map(({ id }) => id)).toEqual(
      preview.risks
        .filter((risk) => !(preview.criticalRiskIds ?? []).includes(risk.id))
        .map(({ id }) => id),
    );
    expect(store.commitReportOnce).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
