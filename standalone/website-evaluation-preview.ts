import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  scoreWebsiteBuildEvaluation,
  type WebsiteBuildEvaluationCheckId,
  type WebsiteBuildEvaluationCheckJudgment,
  type WebsiteBuildEvaluationCriticalRisk,
  type WebsiteBuildEvaluationFinding,
  type WebsiteBuildEvaluationReport,
} from "../module/contracts/website-build-evaluation-run";
import type {
  WebsiteEvaluationAuthorityView,
  WebsiteEvaluationDimensionView,
  WebsiteEvaluationHistoryView,
  WebsiteEvaluationRiskView,
} from "../module/client/dashboard/ai-website-preview/WebsiteEvaluationWorkspace";
import { websiteEvaluationVerdictLabel } from "../module/client/dashboard/ai-website-preview/website-evaluation-copy";

export const WEBSITE_EVALUATION_PREVIEW_STAGES = [
  "queued",
  "capturing",
  "running",
  "result_pending",
  "completed",
] as const;

export type WebsiteEvaluationPreviewStage =
  (typeof WEBSITE_EVALUATION_PREVIEW_STAGES)[number];

export type WebsiteEvaluationPreviewRevision = Readonly<{
  generation: number;
  evaluation: WebsiteEvaluationAuthorityView;
  report: WebsiteBuildEvaluationReport;
}>;

export const WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS = 2_200;

export const WEBSITE_EVALUATION_PREVIEW_COORDINATES = {
  projectId: "10000000-0000-4000-8000-000000000001",
  buildId: "20000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000002",
  reportId: "report-local-authority-20261108",
} as const;

const STATUS_COPY: Record<
  Exclude<WebsiteEvaluationPreviewStage, "completed">,
  { statusLabel: string; verdict: string; summary: string }
> = {
  queued: {
    statusLabel: "等待采集证据",
    verdict: "评估已排队",
    summary: "当前构建已完成绑定，权威评估任务已预留，刷新不会重复创建任务。",
  },
  capturing: {
    statusLabel: "正在采集证据",
    verdict: "正在检查网站成品",
    summary: "正在采集关键路由、三档视口、页面结构、链接与无障碍证据。",
  },
  running: {
    statusLabel: "正在执行判断",
    verdict: "正在评估网站质量",
    summary: "固定规则与多模态裁判正在检查 24 个锚点，当前不会提前展示分数。",
  },
  result_pending: {
    statusLabel: "正在保存报告",
    verdict: "正在整理评估结论",
    summary: "评分已返回，正在核对证据引用并写入不可变报告。",
  },
};

const BASE_ANCHOR_SCORES: Record<WebsiteBuildEvaluationCheckId, 0 | 0.5 | 1> = {
  visitor_entry_clear: 1,
  visitor_path_continuous: 1,
  visitor_success_reachable: 1,
  visitor_failure_recovery: 0.5,
  brand_identity: 1,
  brand_visual_tokens: 1,
  brand_voice: 1,
  brand_cross_route: 1,
  facts_traceable: 1,
  facts_not_invented: 1,
  facts_unknown_boundary: 0.5,
  facts_public_privacy: 1,
  ia_required_routes: 1,
  ia_navigation_links: 1,
  ia_hierarchy_labels: 1,
  ia_long_content: 1,
  visual_hierarchy: 1,
  visual_responsive: 1,
  visual_accessibility: 0.5,
  visual_feedback_stability: 1,
  assistant_entry: 1,
  assistant_identity_scope: 1,
  assistant_unknown_privacy: 0,
  assistant_task_recovery: 0.5,
};

const ANCHOR_SUMMARIES: Partial<Record<WebsiteBuildEvaluationCheckId, string>> = {
  visitor_failure_recovery: "表单错误提示清楚，但提交失败后的人工联系入口仍不够醒目。",
  facts_unknown_boundary: "大多数未知项已说明资料边界，价格与交付时效仍需增加条件提示。",
  visual_accessibility: "键盘路径完整，320px 视口下有两个触控目标尚未达到建议尺寸。",
  assistant_unknown_privacy: "隔离探测发现助手会复述一段仅供内部使用的交付备注，属于关键边界风险。",
  assistant_task_recovery: "助手故障时提供返回页面入口，但没有明确显示人工联系的预计响应方式。",
};

function normalizedGeneration(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function sequenceUuid(sequence: number): string {
  return `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function previewCoordinates(generation: number) {
  const revision = normalizedGeneration(generation);
  return {
    projectId: WEBSITE_EVALUATION_PREVIEW_COORDINATES.projectId,
    buildId: sequenceUuid(revision * 2 + 1),
    runId: sequenceUuid(revision * 2 + 2),
    reportId: revision === 0
      ? WEBSITE_EVALUATION_PREVIEW_COORDINATES.reportId
      : `report-local-authority-recheck-${revision}`,
  };
}

function previewHash(sequence: number): string {
  return Math.max(0, sequence).toString(16).padStart(64, "0").slice(-64);
}

function reportTimes(generation: number) {
  const createdAt = new Date(Date.UTC(2026, 10, 8, 6, 35 + generation * 10));
  return {
    createdAt: createdAt.toISOString(),
    completedAt: new Date(createdAt.getTime() + 60_000).toISOString(),
  };
}

function anchorScore(
  checkId: WebsiteBuildEvaluationCheckId,
  generation: number,
): 0 | 0.5 | 1 {
  if (generation >= 2) return 1;
  if (
    generation >= 1
    && (checkId === "assistant_unknown_privacy" || checkId === "visual_accessibility")
  ) {
    return 1;
  }
  return BASE_ANCHOR_SCORES[checkId];
}

function evidenceIds(checkId: WebsiteBuildEvaluationCheckId) {
  if (checkId === "assistant_unknown_privacy") {
    return ["ev-assistant-private-boundary", "ev-assistant-probe-transcript"];
  }
  if (checkId === "visual_accessibility") {
    return ["ev-axe-key-routes", "ev-mobile-320-touch-targets"];
  }
  return [`ev-${checkId}`];
}

function anchorSummary(checkId: WebsiteBuildEvaluationCheckId, generation: number) {
  const score = anchorScore(checkId, generation);
  if (score === 1 && BASE_ANCHOR_SCORES[checkId] < score) {
    return "本轮修改已通过固定检查，结构、截图与交互证据相互一致。";
  }
  return ANCHOR_SUMMARIES[checkId]
    ?? (score === 1
      ? "固定检查已通过，结构、截图与交互证据相互一致。"
      : score === 0.5
        ? "主要路径可用，但仍有局部问题需要修复。"
        : "当前证据显示该检查未通过，需要先处理关键风险。");
}

function createJudgments(generation: number): WebsiteBuildEvaluationCheckJudgment[] {
  return WEBSITE_BUILD_EVALUATION_CHECKS.map((check) => ({
    checkId: check.id,
    anchor: anchorScore(check.id, generation),
    rationale: anchorSummary(check.id, generation),
    evidenceIds: evidenceIds(check.id),
  }));
}

function createCriticalRisks(generation: number): WebsiteBuildEvaluationCriticalRisk[] {
  if (generation > 0) return [];
  return [{
    id: "risk-assistant-private-boundary",
    kind: "assistant_safety_or_scope",
    title: "助手可能泄露内部交付备注",
    summary: "只读探测中出现了不应公开的内部备注，需要先收紧知识范围并重新生成。",
    checkIds: ["assistant_unknown_privacy"],
    evidenceIds: ["ev-assistant-private-boundary", "ev-assistant-probe-transcript"],
  }];
}

function createFindings(generation: number): WebsiteBuildEvaluationFinding[] {
  if (generation >= 2) return [];
  const findings: WebsiteBuildEvaluationFinding[] = [
    {
      id: "finding-brand-font-coverage",
      checkId: "brand_visual_tokens",
      severity: "medium",
      title: "品牌字体参考还不完整",
      summary: "Brand Kit 已冻结主字体，但长内容页仍使用了默认衬线字体。",
      impact: "跨页面的品牌识别仍不完全一致。",
      suggestedAction: "补齐 Brand Kit 字体偏好后重新生成。",
      evidenceIds: ["ev-brand_visual_tokens"],
      target: { kind: "brand_kit", sectionId: "evaluation-inputs", anchor: "font-preferences" },
    },
    {
      id: "finding-unknown-boundary",
      checkId: "facts_unknown_boundary",
      severity: "medium",
      title: "未知信息提示可以更明确",
      summary: "价格和交付时效缺少适用条件，建议补充公开知识后重新生成。",
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
      summary: "解决方案页内容完整，但移动端需要更清楚的章节跳转。",
      impact: "长页面的扫描效率会下降。",
      suggestedAction: "为长内容增加页内定位后重新生成。",
      evidenceIds: ["ev-ia_long_content"],
      target: { kind: "route", routeId: "solutions", anchor: "section-navigation" },
    },
  ];
  if (generation === 0) {
    findings.unshift({
      id: "finding-mobile-touch-targets",
      checkId: "visual_accessibility",
      severity: "high",
      title: "移动端有两个按钮偏小",
      summary: "320px 视口的页脚按钮触控区域不足，建议扩大后重新检查。",
      impact: "移动访客更容易误触或放弃操作。",
      suggestedAction: "扩大按钮触控区域后重新生成。",
      evidenceIds: ["ev-axe-key-routes", "ev-mobile-320-touch-targets"],
      target: { kind: "design_preferences", sectionId: "theme", anchor: "mobile-actions" },
    });
  }
  return findings;
}

function reportSummary(generation: number) {
  if (generation === 0) {
    return "总分达到建议线，但助手隐私边界存在关键风险；真实分数保持不变，结论已降级。";
  }
  if (generation === 1) {
    return "助手边界和移动端触控问题已修复，当前版本达到推荐发布标准。";
  }
  return "当前版本已通过全部固定检查，达到推荐发布标准。";
}

/** Creates one immutable, contract-valid report for the standalone preview. */
export function createWebsiteEvaluationPreviewReport(
  generation = 0,
): WebsiteBuildEvaluationReport {
  const revision = normalizedGeneration(generation);
  const coordinates = previewCoordinates(revision);
  const judgments = createJudgments(revision);
  const criticalRisks = createCriticalRisks(revision);
  const scoring = scoreWebsiteBuildEvaluation({ judgments, criticalRisks });
  if (!scoring.complete) {
    throw new Error("Local website evaluation fixture is missing fixed judgments.");
  }
  return {
    schemaVersion: 1,
    reportId: coordinates.reportId,
    runId: coordinates.runId,
    projectId: coordinates.projectId,
    buildId: coordinates.buildId,
    buildOrdinal: 7 + revision,
    stage: "build_readiness",
    evidenceFingerprint: previewHash(revision + 1),
    reportHash: previewHash(revision + 128),
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "fixed-website-judge",
      skillHash: previewHash(2_048),
      outputHash: previewHash(revision + 4_096),
    },
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: 80,
      criticalRouteIds: ["home", "solutions", "contact", "assistant"],
      structuralRouteIds: ["home", "solutions", "about", "contact", "assistant"],
      viewports: ["1440x1000", "390x844", "320x720"],
    },
    score: scoring.score,
    verdict: scoring.verdict,
    summary: reportSummary(revision),
    judgments,
    dimensions: scoring.dimensions,
    criticalRisks,
    findings: createFindings(revision),
    relatedRagReportIds: ["rag-local-reference-20261108"],
    comparablePreviousReportId: revision === 0
      ? "report-local-authority-previous"
      : previewCoordinates(revision - 1).reportId,
    ...reportTimes(revision),
  };
}

export function websiteEvaluationPreviewReportUrl(reportId: string): string {
  const params = new URLSearchParams({ view: "website", websiteReport: reportId });
  return `/?${params.toString()}`;
}

/** Resolves only deterministic local report identifiers; it never reads an API. */
export function resolveWebsiteEvaluationPreviewReport(
  reportId: string | null | undefined,
): WebsiteBuildEvaluationReport | null {
  const normalizedReportId = reportId?.trim();
  if (!normalizedReportId) return null;
  if (normalizedReportId === WEBSITE_EVALUATION_PREVIEW_COORDINATES.reportId) {
    return createWebsiteEvaluationPreviewReport(0);
  }
  const match = /^report-local-authority-recheck-(\d+)$/u.exec(normalizedReportId);
  const generation = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(generation) && generation > 0 && generation <= 9_999
    ? createWebsiteEvaluationPreviewReport(generation)
    : null;
}

function createCompletedDimensions(
  report: WebsiteBuildEvaluationReport,
): WebsiteEvaluationDimensionView[] {
  const judgments = new Map(report.judgments.map((item) => [item.checkId, item]));
  const scoredDimensions = new Map(report.dimensions.map((item) => [item.id, item]));
  return WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension) => {
    const anchors = WEBSITE_BUILD_EVALUATION_CHECKS
      .filter((check) => check.dimensionId === dimension.id)
      .map((check) => {
        const judgment = judgments.get(check.id)!;
        return {
          id: check.id,
          label: check.label,
          score: judgment.anchor,
          summary: judgment.rationale,
          evidenceIds: judgment.evidenceIds,
        };
      });
    const scored = scoredDimensions.get(dimension.id)!;
    return {
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      score: scored.normalizedScore,
      summary: anchors.every((anchor) => anchor.score === 1)
        ? "固定检查全部通过。"
        : "仍有检查项需要处理。",
      evidenceIds: scored.evidenceIds,
      anchors,
    };
  });
}

function createRisks(report: WebsiteBuildEvaluationReport): WebsiteEvaluationRiskView[] {
  const critical: WebsiteEvaluationRiskView[] = report.criticalRisks.map((risk) => ({
    id: risk.id,
    title: risk.title,
    summary: risk.summary,
    severity: "critical",
    target: { kind: "assistant", sectionId: "assistant", anchor: "knowledge-boundary" },
    repairItem: { kind: "critical_risk", id: risk.id },
  }));
  const findings: WebsiteEvaluationRiskView[] = report.findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    summary: finding.summary,
    severity: finding.severity,
    target: finding.target,
    repairItem: { kind: "finding", id: finding.id },
  }));
  return [...critical, ...findings];
}

function createHistory(
  report: WebsiteBuildEvaluationReport,
  generation: number,
): WebsiteEvaluationHistoryView[] {
  const generatedHistory = Array.from({ length: generation }, (_, index) => {
    const previous = createWebsiteEvaluationPreviewReport(generation - index - 1);
    return {
      reportId: previous.reportId,
      score: previous.score,
      createdAt: previous.createdAt,
      coordinateLabel: "相同评估口径",
      comparisonEligible: true,
      scoreDelta: report.score - previous.score,
      reportUrl: websiteEvaluationPreviewReportUrl(previous.reportId),
    } satisfies WebsiteEvaluationHistoryView;
  });
  return [...generatedHistory, {
    reportId: "report-local-authority-previous",
    score: 84,
    createdAt: "2026-11-05T06:20:00.000Z",
    coordinateLabel: "相同评估口径",
    comparisonEligible: true,
    scoreDelta: report.score - 84,
    reportUrl: null,
  }, {
    reportId: "report-local-authority-legacy-coordinate",
    score: 91,
    createdAt: "2026-10-28T09:10:00.000Z",
    coordinateLabel: "旧版评估记录",
    comparisonEligible: false,
    scoreDelta: null,
    reportUrl: null,
  }].slice(0, 20);
}

function createCompletedPreview(generation: number): WebsiteEvaluationAuthorityView {
  const report = createWebsiteEvaluationPreviewReport(generation);
  return {
    buildId: report.buildId,
    status: "completed",
    runId: report.runId,
    reportId: report.reportId,
    reportHash: report.reportHash,
    reportUrl: websiteEvaluationPreviewReportUrl(report.reportId),
    statusLabel: null,
    score: report.score,
    recommendation: report.verdict,
    verdict: websiteEvaluationVerdictLabel(report.verdict),
    summary: report.summary,
    judgmentCoverage: report.coverage.requiredEvidencePercent,
    brandReferenceCoverage: report.coverage.brandReferencePercent,
    dimensions: createCompletedDimensions(report),
    risks: createRisks(report),
    criticalRiskIds: report.criticalRisks.map((risk) => risk.id),
    evidenceUpdatedLabel: generation === 0
      ? "2026/11/8 14:36"
      : report.completedAt,
    frozenBrandKitLabel: "Logo、主色 #6D5BE7、Inter / PingFang SC、专业清晰的语调与 2 条禁用表达",
    frozenVisitorTaskLabel: "了解企业能力并提交合作咨询 · 入口：首页 · 2 个成功条件 · 3 条必经路由 · 必须使用助手",
    comparisonCoordinateLabel: "相同评估口径",
    history: createHistory(report, generation),
    historyHasMore: false,
    historyLoadingMore: false,
    reviews: generation === 0 ? [{
      reviewId: "review-local-authority-1",
      reviewerLabel: "本地产品复核",
      disposition: "concerns",
      dispositionLabel: "需要调整",
      repairItem: { kind: "critical_risk", id: "risk-assistant-private-boundary" },
      note: "分数与证据结构可用于 UI 调整；助手边界风险必须保留为关键风险。",
      createdAt: "2026-11-08T06:45:00.000Z",
    }] : [],
    reviewsLoading: false,
    reviewsError: null,
  };
}

export function normalizeWebsiteEvaluationPreviewStage(
  value: unknown,
): WebsiteEvaluationPreviewStage | null {
  return typeof value === "string"
    && WEBSITE_EVALUATION_PREVIEW_STAGES.includes(value as WebsiteEvaluationPreviewStage)
    ? value as WebsiteEvaluationPreviewStage
    : null;
}

export function resolveWebsiteEvaluationPreviewSelection(
  search: string | URLSearchParams,
): { stage: WebsiteEvaluationPreviewStage; flow: boolean } {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const fixedStage = normalizeWebsiteEvaluationPreviewStage(params.get("evaluationStage"));
  if (fixedStage) return { stage: fixedStage, flow: false };
  const flow = params.get("evaluationDemo") === "flow";
  return { stage: flow ? "queued" : "completed", flow };
}

export function createWebsiteEvaluationPreview(
  stage: WebsiteEvaluationPreviewStage,
  generation = 0,
): WebsiteEvaluationAuthorityView {
  const revision = normalizedGeneration(generation);
  if (stage === "completed") return createCompletedPreview(revision);
  const copy = STATUS_COPY[stage];
  const coordinates = previewCoordinates(revision);
  return {
    buildId: coordinates.buildId,
    status: stage,
    runId: coordinates.runId,
    reportId: null,
    reportHash: null,
    reportUrl: null,
    statusLabel: copy.statusLabel,
    score: null,
    recommendation: null,
    verdict: copy.verdict,
    summary: copy.summary,
    judgmentCoverage: 0,
    brandReferenceCoverage: 0,
    dimensions: [],
    risks: [],
    criticalRiskIds: [],
    evidenceUpdatedLabel: "等待当前评估阶段完成",
    frozenBrandKitLabel: "Logo、主色 #6D5BE7、Inter / PingFang SC、专业清晰的语调与 2 条禁用表达",
    frozenVisitorTaskLabel: "了解企业能力并提交合作咨询 · 入口：首页 · 2 个成功条件 · 3 条必经路由 · 必须使用助手",
    comparisonCoordinateLabel: "相同评估口径",
    history: [],
    historyHasMore: false,
    historyLoadingMore: false,
    reviews: [],
    reviewsLoading: false,
    reviewsError: null,
  };
}

/** Pure revision helper for the local re-evaluation flow. */
export function createWebsiteEvaluationPreviewRevision(
  generation = 0,
): WebsiteEvaluationPreviewRevision {
  const revision = normalizedGeneration(generation);
  return {
    generation: revision,
    evaluation: createWebsiteEvaluationPreview("completed", revision),
    report: createWebsiteEvaluationPreviewReport(revision),
  };
}

export function createNextWebsiteEvaluationPreviewRevision(
  currentGeneration = 0,
): WebsiteEvaluationPreviewRevision {
  return createWebsiteEvaluationPreviewRevision(normalizedGeneration(currentGeneration) + 1);
}
