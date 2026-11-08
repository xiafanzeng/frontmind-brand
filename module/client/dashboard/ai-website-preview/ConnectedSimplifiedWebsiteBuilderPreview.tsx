import ConnectedSiteOpsConversationPanel from "../siteops/ConnectedSiteOpsConversationPanel";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import { useLocation } from "wouter";
import { useRuntimeContext } from "../../host";
import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  type WebsiteBuildEvaluationReport,
  type WebsiteBuildEvaluationRunDto,
} from "../../../contracts/website-build-evaluation-run";
import { useWebsiteEvaluationAuthority } from "../website-evaluation-api";
import {
  SimplifiedWebsiteBuilderPreview,
  normalizeWebsiteBuildStep,
  type BuildStep,
  type LegacyBuildStep,
  type WebsiteDesignSection,
} from "./SimplifiedWebsiteBuilderPreview";
import type {
  WebsiteEvaluationAuthorityView,
  WebsiteEvaluationRepairTarget,
} from "./WebsiteEvaluationWorkspace";
import { websiteEvaluationVerdictLabel } from "./website-evaluation-copy";

export type ConnectedSimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep | LegacyBuildStep;
  initialSection?: WebsiteDesignSection | null;
  onOpenRag?: () => void;
  onStepChange?: (step: BuildStep) => void;
  storageScope?: string;
};

type FrozenBuildBriefView = NonNullable<
  NonNullable<SiteOpsConversationPanelProps["observation"]>["builds"][number]["brief"]
>;

const RUN_STATUS_LABELS: Record<WebsiteBuildEvaluationRunDto["status"], string> = {
  queued: "评估已排队",
  capturing: "正在采集评估证据",
  running: "正在评估当前网站",
  result_pending: "正在整理评估报告",
  completed: "建设评估已完成",
  failed: "评估未完成",
};

function websiteEvaluationReportHref(location: string, reportId: string) {
  const currentSearch = typeof window === "undefined" ? "" : window.location.search;
  const value = location.includes("?") ? location : `${location}${currentSearch}`;
  const url = new URL(value || "/", "https://frontmind.local");
  url.searchParams.set("view", "website");
  url.searchParams.set("websiteReport", reportId);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function coordinateLabel(report: WebsiteBuildEvaluationReport) {
  return `${report.evaluator.ruleVersion} · ${report.evaluator.judgeVersion} · ${report.evaluator.evidenceVersion}`;
}

function sameComparisonCoordinate(
  left: WebsiteBuildEvaluationReport,
  right: WebsiteBuildEvaluationReport,
) {
  return left.evaluator.ruleVersion === right.evaluator.ruleVersion
    && left.evaluator.judgeVersion === right.evaluator.judgeVersion
    && left.evaluator.evidenceVersion === right.evaluator.evidenceVersion;
}

function repairTargetForReportFinding(
  report: WebsiteBuildEvaluationReport,
  checkIds: readonly string[],
): WebsiteEvaluationRepairTarget {
  const target = report.findings.find((finding) => checkIds.includes(finding.checkId))?.target;
  return target ? { ...target } : { kind: "build" };
}

function frozenBrandKitLabel(
  brief: FrozenBuildBriefView | null | undefined,
) {
  const kit = brief?.brandKitV1;
  if (!kit) return "当前构建未冻结可选 Brand Kit";
  const references = [
    kit.logo ? "Logo" : null,
    kit.primaryColor ? `主色 ${kit.primaryColor}` : null,
    kit.secondaryColors.length ? `${kit.secondaryColors.length} 个辅助色` : null,
    kit.fontPreferences.length ? `${kit.fontPreferences.length} 个字体偏好` : null,
    kit.toneKeywords.length ? `${kit.toneKeywords.length} 个语调词` : null,
    kit.forbiddenPhrases.length ? `${kit.forbiddenPhrases.length} 条禁用表达` : null,
  ].filter(Boolean);
  return references.join("、") || "当前构建未冻结可选 Brand Kit";
}

function frozenVisitorTaskLabel(brief: {
  routes?: Array<{ id: string; title: string; slug: string }>;
  visitorTaskV1?: {
    goal: string;
    entryRouteId: string;
    successCriteria: string[];
    requiredRouteIds: string[];
    assistantRequired: boolean;
  };
} | null | undefined) {
  const task = brief?.visitorTaskV1;
  if (!task) return "当前构建未冻结已确认的访客任务";
  const route = brief?.routes?.find((item) => item.id === task.entryRouteId);
  return `${task.goal} · 入口 ${route?.title ?? route?.slug ?? task.entryRouteId} · ${task.successCriteria.length} 个成功条件 · ${task.requiredRouteIds.length} 条必经路由${task.assistantRequired ? " · 必须使用助手" : ""}`;
}

export function projectWebsiteEvaluationAuthority(input: {
  run: WebsiteBuildEvaluationRunDto;
  history: WebsiteBuildEvaluationRunDto[];
  buildBrief?: FrozenBuildBriefView | null;
  location: string;
}): WebsiteEvaluationAuthorityView {
  const report = input.run.report;
  const judgments = new Map(report?.judgments.map((item) => [item.checkId, item]) ?? []);
  const reportUrl = report
    ? websiteEvaluationReportHref(input.location, report.reportId)
    : null;
  const dimensions = report?.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    score: dimension.normalizedScore,
    summary: `${dimension.judgmentCount} 个固定检查项，${dimension.evidenceIds.length} 个去重证据引用。`,
    evidenceIds: dimension.evidenceIds,
    anchors: WEBSITE_BUILD_EVALUATION_CHECKS
      .filter((check) => check.dimensionId === dimension.id)
      .flatMap((check) => {
        const judgment = judgments.get(check.id);
        return judgment ? [{
          id: check.id,
          label: check.label,
          score: judgment.anchor,
          summary: judgment.rationale,
          evidenceIds: judgment.evidenceIds,
        }] : [];
      }),
  })) ?? [];
  const criticalRisks = report?.criticalRisks.map((risk) => ({
    id: risk.id,
    title: risk.title,
    summary: risk.summary,
    severity: "critical" as const,
    target: repairTargetForReportFinding(report, risk.checkIds),
    repairItem: { kind: "critical_risk" as const, id: risk.id },
  })) ?? [];
  const criticalRiskCheckIds = new Set(
    report?.criticalRisks.flatMap((risk) => risk.checkIds) ?? [],
  );
  const findings = report?.findings
    .filter((finding) => !criticalRiskCheckIds.has(finding.checkId))
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      summary: `${finding.summary} ${finding.suggestedAction}`,
      severity: finding.severity,
      target: { ...finding.target },
      repairItem: { kind: "finding" as const, id: finding.id },
    })) ?? [];
  const history = input.history.flatMap((run) => {
    const prior = run.report;
    if (!prior || prior.reportId === report?.reportId) return [];
    return [{
      reportId: prior.reportId,
      score: prior.score,
      createdAt: prior.completedAt,
      coordinateLabel: coordinateLabel(prior),
      comparisonEligible: Boolean(report && sameComparisonCoordinate(report, prior)),
      scoreDelta: report && sameComparisonCoordinate(report, prior)
        ? report.score - prior.score
        : null,
      reportUrl: websiteEvaluationReportHref(input.location, prior.reportId),
    }];
  });
  return {
    buildId: input.run.buildId,
    status: report || input.run.status !== "completed" ? input.run.status : "failed",
    runId: input.run.runId,
    reportId: report?.reportId ?? null,
    reportHash: report?.reportHash ?? null,
    reportUrl,
    statusLabel: RUN_STATUS_LABELS[input.run.status],
    score: report?.score ?? null,
    recommendation: report?.verdict ?? null,
    verdict: report ? websiteEvaluationVerdictLabel(report.verdict) : input.run.error?.message ?? RUN_STATUS_LABELS[input.run.status],
    summary: report?.summary ?? input.run.error?.message ?? "评估将从当前构建的冻结产物恢复。",
    judgmentCoverage: report?.coverage.requiredEvidencePercent ?? 0,
    brandReferenceCoverage: report?.coverage.brandReferencePercent ?? 0,
    dimensions,
    risks: [...criticalRisks, ...findings],
    criticalRiskIds: report?.criticalRisks.map((risk) => risk.id) ?? [],
    evidenceUpdatedLabel: report?.completedAt
      ? new Date(report.completedAt).toLocaleString("zh-CN")
      : new Date(input.run.updatedAt).toLocaleString("zh-CN"),
    frozenBrandKitLabel: frozenBrandKitLabel(input.buildBrief),
    frozenVisitorTaskLabel: frozenVisitorTaskLabel(input.buildBrief),
    comparisonCoordinateLabel: report ? coordinateLabel(report) : null,
    history,
  };
}

function ConnectedWebsiteEvaluationBridge({
  siteOps,
  currentLocation,
  builderProps,
}: {
  siteOps: SiteOpsConversationPanelProps;
  currentLocation: string;
  builderProps: Omit<ConnectedSimplifiedWebsiteBuilderPreviewProps, "storageScope"> & { storageScope: string };
}) {
  const latestBuild = siteOps.observation?.builds[0] ?? null;
  const projectId = siteOps.observation?.project.id ?? null;
  const websiteEvaluationAdmission = siteOps.observation?.websiteEvaluationAdmission
    ?? { mode: "off" as const, required: false, userVisible: false };
  const authority = useWebsiteEvaluationAuthority({
    projectId,
    buildId: latestBuild?.id ?? null,
    enabled: Boolean(
      websiteEvaluationAdmission.userVisible
      && projectId
      && latestBuild?.id,
    ),
  });
  const currentRun = authority.run?.buildId === latestBuild?.id ? authority.run : null;
  const websiteEvaluation = websiteEvaluationAdmission.userVisible && currentRun
    ? projectWebsiteEvaluationAuthority({
        run: currentRun,
        history: authority.history?.history ?? [],
        buildBrief: latestBuild?.brief ?? null,
        location: currentLocation,
      })
    : websiteEvaluationAdmission.userVisible && authority.error && latestBuild
      ? {
          buildId: latestBuild.id,
          status: "failed" as const,
          runId: null,
          reportId: null,
          reportHash: null,
          reportUrl: null,
          score: null,
          recommendation: null,
          verdict: "评估暂不可用",
          summary: authority.error.message,
          judgmentCoverage: 0,
          brandReferenceCoverage: 0,
          dimensions: [],
          risks: [],
          criticalRiskIds: [],
          frozenBrandKitLabel: frozenBrandKitLabel(latestBuild.brief),
          frozenVisitorTaskLabel: frozenVisitorTaskLabel(latestBuild.brief),
        }
      : websiteEvaluationAdmission.userVisible && authority.loading && latestBuild
        ? {
            buildId: latestBuild.id,
            status: "restoring" as const,
            runId: null,
            reportId: null,
            reportHash: null,
            reportUrl: null,
            score: null,
            recommendation: null,
            verdict: "正在恢复建设评估",
            summary: "正在读取当前构建已有的权威任务；不会在浏览器创建新评估。",
            judgmentCoverage: 0,
            brandReferenceCoverage: 0,
            dimensions: [],
            risks: [],
            criticalRiskIds: [],
            frozenBrandKitLabel: frozenBrandKitLabel(latestBuild.brief),
            frozenVisitorTaskLabel: frozenVisitorTaskLabel(latestBuild.brief),
          }
      : null;
  const evaluationView = websiteEvaluation
    ? {
        ...websiteEvaluation,
        historyHasMore: Boolean(authority.history?.nextCursor),
        historyLoadingMore: authority.loadingMore,
        reviews: authority.reviews.map((review) => ({
          reviewId: review.reviewId,
          reviewerLabel: "评审人",
          disposition: review.disposition,
          dispositionLabel: review.disposition === "agree"
            ? "同意报告"
            : review.disposition === "reject"
              ? "不同意报告"
              : "存在疑问",
          repairItem: review.repairItem,
          note: review.note,
          createdAt: review.createdAt,
        })),
        reviewsLoading: authority.reviewsLoading,
        reviewsError: authority.reviewsError?.message ?? null,
      }
    : null;
  return (
    <SimplifiedWebsiteBuilderPreview
      {...builderProps}
      siteOps={siteOps}
      websiteEvaluationAdmission={websiteEvaluationAdmission}
      websiteEvaluation={evaluationView}
      onRetryWebsiteEvaluation={currentRun?.status === "failed"
        ? () => { void authority.retry().catch(() => undefined); }
        : undefined}
      onLoadMoreWebsiteEvaluationHistory={authority.history?.nextCursor
        ? () => { void authority.loadMore().catch(() => undefined); }
        : undefined}
      onSubmitWebsiteEvaluationReview={currentRun?.report
        ? async ({ repairItem, disposition, note }) => {
            await authority.appendReview({
              disposition,
              checkComments: [],
              repairItem,
              note,
            });
          }
        : undefined}
    />
  );
}

/**
 * Production transport for the redesigned website builder. The established
 * SiteOps controller still owns idempotency, polling, uploads and retries.
 * Design, domain configuration and release share this one transport.
 */
export default function ConnectedSimplifiedWebsiteBuilderPreview({
  initialStep,
  initialSection,
  onOpenRag,
  onStepChange,
  storageScope: explicitStorageScope,
}: ConnectedSimplifiedWebsiteBuilderPreviewProps) {
  const [location, navigate] = useLocation();
  const runtime = useRuntimeContext();
  const storageScope = explicitStorageScope
    ?? `live:${runtime.accountId}:${runtime.workspaceId}`;
  const openRag = onOpenRag ?? (() => {
    const returnStep = normalizeWebsiteBuildStep(initialStep) ?? "template";
    navigate(`/?view=enterprise-qa&returnStep=${returnStep}`);
  });
  const changeStep = onStepChange ?? ((step: BuildStep) => {
    navigate(step === "template" ? "/?view=website" : `/?view=website&step=${step}`, {
      replace: true,
    });
  });

  return (
      <ConnectedSiteOpsConversationPanel
        render={(siteOps) => (
              <ConnectedWebsiteEvaluationBridge
                key={storageScope}
                siteOps={siteOps}
                currentLocation={location}
                builderProps={{
                  initialStep,
                  initialSection,
                  onOpenRag: openRag,
                  onStepChange: changeStep,
                  storageScope,
                }}
              />
            )}
      />
  );
}
