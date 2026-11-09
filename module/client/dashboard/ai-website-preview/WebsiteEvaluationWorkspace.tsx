import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardCheck,
  FileText,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import {
  EvaluationGauge,
  type EvaluationGaugePresentation,
} from "./EvaluationGauge";
import {
  EvaluationRadar,
  type EvaluationRadarAxis,
  type EvaluationRadarPresentation,
} from "./EvaluationRadar";
import { RagAnswerWindows, type AnswerPanel } from "./RagAnswerWindows";
import { RagProgressiveText, revealOpacity, textGraphemes } from "./RagProgressiveText";
import { useDataReveal } from "./useDataReveal";
import { useRagEvaluationLayout } from "./useRagEvaluationLayout";
// The result primitives intentionally share the exact presentation stylesheet
// with Enterprise RAG while keeping website data and ARIA copy domain-owned.
import "./rag-page-entrance.css";
import "./rag-evaluation-ui.css";
import "./website-evaluation-workspace.css";

export type WebsiteEvaluationRunStatus =
  | "disabled"
  | "idle"
  | "not_evaluated"
  | "restoring"
  | "building"
  | "queued"
  | "capturing"
  | "running"
  | "result_pending"
  | "completed"
  | "failed"
  | "build_failed";

export type WebsiteEvaluationDimensionView = {
  id: string;
  label: string;
  weight: number;
  score: number | null;
  summary: string;
  evidenceIds?: string[];
  anchors?: Array<{
    id: string;
    label: string;
    score: 0 | 0.5 | 1;
    summary: string;
    evidenceIds: string[];
  }>;
};

export type WebsiteEvaluationRepairTargetKind =
  | "route"
  | "brand_kit"
  | "design_preferences"
  | "knowledge"
  | "assistant"
  | "build";

export type WebsiteEvaluationRepairTarget = {
  kind: WebsiteEvaluationRepairTargetKind;
  routeId?: string;
  sectionId?: string;
  anchor?: string;
};

export type WebsiteEvaluationRiskView = {
  id: string;
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low";
  target: WebsiteEvaluationRepairTarget;
  repairItem?: WebsiteEvaluationRepairItem;
};

export type WebsiteEvaluationRepairItem = {
  kind: "critical_risk" | "finding";
  id: string;
};

export type WebsiteEvaluationHistoryView = {
  reportId: string;
  score: number;
  createdAt: string;
  coordinateLabel: string;
  comparisonEligible: boolean;
  scoreDelta: number | null;
  reportUrl?: string | null;
};

export type WebsiteEvaluationReviewView = {
  reviewId: string;
  reviewerLabel: string;
  dispositionLabel: string;
  disposition?: WebsiteEvaluationReviewDisposition;
  repairItem?: WebsiteEvaluationRepairItem;
  note: string;
  createdAt: string;
};

export type WebsiteEvaluationReviewDisposition = "agree" | "concerns" | "reject";

export type WebsiteEvaluationManualReviewInput = {
  repairItem: WebsiteEvaluationRepairItem;
  disposition: WebsiteEvaluationReviewDisposition;
  note: string;
};

/** Narrow client view model for the immutable, server-authoritative report.
 * The connected adapter owns transport and tenancy checks; this component
 * never derives or persists a score in the browser. */
export type WebsiteEvaluationAuthorityView = {
  buildId: string;
  status: WebsiteEvaluationRunStatus;
  runId?: string | null;
  reportId?: string | null;
  reportHash?: string | null;
  reportUrl?: string | null;
  statusLabel?: string | null;
  score: number | null;
  recommendation?: "recommended" | "repair_or_continue" | "not_recommended" | null;
  verdict: string;
  summary: string;
  judgmentCoverage: number;
  brandReferenceCoverage: number;
  dimensions: WebsiteEvaluationDimensionView[];
  risks: WebsiteEvaluationRiskView[];
  criticalRiskIds?: string[];
  evidenceUpdatedLabel?: string | null;
  frozenBrandKitLabel?: string | null;
  frozenVisitorTaskLabel?: string | null;
  comparisonCoordinateLabel?: string | null;
  history?: WebsiteEvaluationHistoryView[];
  historyHasMore?: boolean;
  historyLoadingMore?: boolean;
  reviews?: WebsiteEvaluationReviewView[];
  reviewsLoading?: boolean;
  reviewsError?: string | null;
};

export type WebsiteTechnicalCheckView = {
  id: string;
  title: string;
  detail: string;
  passed: boolean;
  actionLabel: string;
  onAction: () => void;
};

export type WebsiteEvaluationWorkspaceProps = {
  status: WebsiteEvaluationRunStatus;
  score: number | null;
  verdict: string;
  summary: string;
  reportId?: string | null;
  reportUrl?: string | null;
  evidenceUpdatedLabel: string;
  judgmentCoverage: number;
  dimensions: WebsiteEvaluationDimensionView[];
  risks: WebsiteEvaluationRiskView[];
  technicalChecks: WebsiteTechnicalCheckView[];
  legacyReports?: Array<{
    reportId: string;
    score: number | null;
    createdAt: string;
    version: string;
  }>;
  history?: WebsiteEvaluationHistoryView[];
  historyHasMore?: boolean;
  historyLoadingMore?: boolean;
  reviews?: WebsiteEvaluationReviewView[];
  reviewsLoading?: boolean;
  reviewsError?: string | null;
  onRepairTarget: (target: WebsiteEvaluationRepairTarget) => void;
  onRetry?: () => void;
  onReevaluate?: () => void | Promise<void>;
  reevaluatePending?: boolean;
  reevaluateDisabledReason?: string | null;
  onLoadMoreHistory?: () => void;
  onManualReview?: (input: WebsiteEvaluationManualReviewInput) => Promise<void>;
};

type DetailPanel = Extract<AnswerPanel, "improve" | "review">;

const ACTIVE_STATUSES = new Set<WebsiteEvaluationRunStatus>([
  "building",
  "restoring",
  "queued",
  "capturing",
  "running",
  "result_pending",
]);

const INITIAL_STATUSES = new Set<WebsiteEvaluationRunStatus>([
  "disabled",
  "idle",
  "not_evaluated",
]);

const STATUS_COPY: Record<WebsiteEvaluationRunStatus, { title: string; detail: string }> = {
  disabled: {
    title: "暂无评估",
    detail: "当前项目继续使用原有建站与技术发布门禁，不会生成浏览器评分。",
  },
  idle: {
    title: "暂无评估",
    detail: "尚无可评估的网站版本。完成网站生成后，系统会自动开始评估。",
  },
  not_evaluated: {
    title: "暂无评估",
    detail: "当前网站版本没有评估记录。生成新版本后，系统会自动开始评估。",
  },
  restoring: {
    title: "正在恢复建设评估",
    detail: "正在读取当前构建已有的权威任务；不会在浏览器创建新评估。",
  },
  building: {
    title: "网站正在生成",
    detail: "构建产物完成绑定后会自动开始评估，无需手动启动。",
  },
  queued: {
    title: "评估已排队",
    detail: "正在等待证据采集任务，刷新或离开页面不会创建重复任务。",
  },
  capturing: {
    title: "正在采集评估证据",
    detail: "正在核对关键路由、桌面与移动视口、结构和可访问性。",
  },
  running: {
    title: "正在评估当前网站",
    detail: "规则检查与多模态判断正在运行，完成后会同步揭示六维结果。",
  },
  result_pending: {
    title: "正在整理评估报告",
    detail: "评分已经返回，系统正在校验证据引用并保存不可变报告。",
  },
  completed: {
    title: "建设评估已完成",
    detail: "分数、风险和修复建议均绑定当前网站版本。",
  },
  failed: {
    title: "评估未完成",
    detail: "当前网站版本仍可继续处理；评估任务没有生成质量分。",
  },
  build_failed: {
    title: "暂无可评估成品",
    detail: "网站构建没有形成可检查的完整版本，请先返回修改并重新生成。",
  },
};

const SEVERITY_LABELS: Record<WebsiteEvaluationRiskView["severity"], string> = {
  critical: "优先修复",
  high: "优先修复",
  medium: "建议修复",
  low: "一般优化",
};

const SEVERITY_TONES: Record<WebsiteEvaluationRiskView["severity"], "danger" | "attention" | "muted"> = {
  critical: "danger",
  high: "danger",
  medium: "attention",
  low: "muted",
};

const REVIEW_DISPOSITION_LABELS: Record<WebsiteEvaluationReviewDisposition, string> = {
  agree: "认可计划",
  concerns: "需要调整",
  reject: "不采纳",
};

const WEBSITE_GAUGE_PRESENTATION: EvaluationGaugePresentation = {
  classes: {
    root: "erag-evaluation-score rag-evaluation-gauge rag-evaluation-gauge-card wev-evaluation-gauge",
    graphic: "rag-evaluation-gauge-graphic",
    arc: "rag-evaluation-gauge-arc",
    marker: "rag-evaluation-gauge-marker",
    value: "rag-evaluation-gauge-value",
    endpoint: "rag-evaluation-gauge-endpoint",
    control: "rag-gauge-marker-control",
    tooltip: "rag-gauge-marker-tooltip",
    danger: "is-danger",
    muted: "is-muted",
    empty: "is-empty",
    pending: "is-pending",
    unavailable: "is-unavailable",
    markerActive: "is-marker-active",
  },
  testIds: {
    root: "website-evaluation-score",
    cutout: "website-evaluation-gauge-cutout",
    track: "website-evaluation-gauge-track",
    marker: "website-evaluation-gauge-marker",
    value: "website-evaluation-gauge-value",
    minimum: "website-evaluation-gauge-minimum",
    maximum: "website-evaluation-gauge-maximum",
  },
  colors: {
    track: "rgba(60, 60, 67, 0.22)",
    marker: "#7542b0",
    mutedMarker: "#aeaeb2",
  },
  labels: {
    root: "网站建设评估最终分",
    scoreImage: (score) => `网站建设评估最终分 ${score}，量程 0 至 100；圆点标示当前分数`,
    pendingImage: "网站建设评估待生成",
    unavailableImage: "网站建设评估不可用",
    scoreControl: (score) => `网站建设评估精确分值 ${score} 分`,
    unavailableControl: "网站建设评估不可用",
  },
};

const WEBSITE_RADAR_PRESENTATION: EvaluationRadarPresentation = {
  classes: {
    root: "rag-radar wev-radar",
    chart: "rag-radar-chart",
    grid: "rag-radar-grid",
    axis: "rag-radar-axis",
    area: "rag-radar-area",
    label: "rag-radar-label",
    control: "rag-radar-point-control",
    marker: "rag-radar-point-marker",
    centerCutout: "rag-radar-center-cutout",
  },
  testIds: {
    root: "website-evaluation-radar",
    centerMask: "website-evaluation-radar-center-mask",
    area: "website-evaluation-radar-area",
    label: "website-evaluation-radar-label",
    control: "website-evaluation-radar-point",
    marker: "website-evaluation-radar-marker",
  },
  labels: {
    root: "网站建设六维评分雷达图",
    title: "网站建设六维评分雷达图",
    description: ({ complete, empty, axes }) => `${axes.map((axis) => `${axis.label} ${axis.valueLabel}`).join("，")}。${empty ? "暂无评分。" : complete ? "已绘制六维完整评分区域。" : "当前报告维度不完整，不绘制评分区域。"}`,
    control: (axis) => `${axis.label} ${axis.valueLabel}${axis.disabled ? "" : "，查看详情"}`,
  },
};

const WEBSITE_EMPTY_RADAR_AXES: readonly EvaluationRadarAxis[] = [
  ["visitor_task", "访客任务完成度"],
  ["brand_consistency", "品牌一致性"],
  ["facts_evidence", "事实与证据"],
  ["information_architecture", "信息架构"],
  ["visual_usability", "视觉与可用性"],
  ["assistant_boundary", "助手集成与边界"],
].map(([id, label]) => ({
  id,
  label,
  normalizedScore: null,
  valueLabel: "暂无评分",
  state: "empty",
  disabled: true,
}));

function isWebsiteNormalizedScore(score: number | null): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
}

function verdictTone(score: number, risks: readonly WebsiteEvaluationRiskView[]) {
  if (score < 70 || risks.some((risk) => risk.severity === "critical")) return "danger";
  if (score < 85) return "pending";
  return "positive";
}

function formatWebsiteScore(score: number) {
  return Number(score.toFixed(1)).toString();
}

function formatWebsiteDetailScore(score: number) {
  return formatWebsiteScore(score);
}

function websiteCheckStatus(score: 0 | 0.5 | 1) {
  if (score === 1) return { label: "已通过", tone: "passed" } as const;
  if (score === 0.5) return { label: "需完善", tone: "pending" } as const;
  return { label: "未通过", tone: "failed" } as const;
}

function WaitingState({ status }: { status: WebsiteEvaluationRunStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <section className="wev-waiting" role="status" aria-live="polite" data-testid="website-evaluation-waiting">
      <span className="wev-wait-mark" aria-hidden="true"><i /><i /></span>
      <span>
        <strong className="wev-waiting__shimmer">{copy.title}</strong>
        <small>{copy.detail}</small>
      </span>
    </section>
  );
}

function WebsiteEvaluationGauge({ score, reportId, reveal }: {
  score: number | null;
  reportId?: string | null;
  reveal: boolean;
}) {
  const valid = isWebsiteNormalizedScore(score);
  const gaugeInstanceId = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const markerActive = hovered || focused;
  const { ref, progress, finish } = useDataReveal<HTMLOutputElement>(
    valid && reveal,
    `${reportId ?? "local"}:${score ?? "empty"}:website-gauge`,
  );

  useEffect(() => {
    setHovered(false);
    setFocused(false);
  }, [reportId, score]);

  return <EvaluationGauge
    state={valid ? { kind: "score", score, preciseScore: score } : { kind: "pending" }}
    presentation={WEBSITE_GAUGE_PRESENTATION}
    rootAriaLabel={valid ? `网站建设评估最终分 ${score} 分` : "网站建设评估暂无评分"}
    progress={progress}
    reportRevealKey={reportId ?? ""}
    rootRef={ref}
    maskId={`website-evaluation-gauge-mask-${gaugeInstanceId}`}
    tooltipId={`website-evaluation-gauge-tooltip-${gaugeInstanceId}`}
    markerActive={markerActive}
    interactive={valid}
    onMarkerPointerEnter={(event) => {
      if (event.pointerType !== "touch") {
        finish();
        setHovered(true);
      }
    }}
    onMarkerPointerLeave={() => setHovered(false)}
    onMarkerFocus={() => {
      finish();
      setFocused(true);
    }}
    onMarkerBlur={() => setFocused(false)}
    onMarkerPointerDown={(event) => {
      event.preventDefault();
      finish();
      if (event.pointerType === "touch") setHovered(false);
      event.currentTarget.blur();
    }}
    onMarkerKeyDown={(event) => {
      if (event.key === "Escape") {
        setHovered(false);
        setFocused(false);
        event.currentTarget.blur();
      }
    }}
  />;
}

function WebsiteEvaluationInitialConclusion({ detail }: { detail: string }) {
  return <section
    className="rag-verdict is-neutral"
    data-evaluation-state="lifecycle"
    aria-label="当前网站评估状态"
    data-testid="website-evaluation-conclusion"
  >
    <div className="rag-evaluation-summary-flow">
      <h3 className="rag-evaluation-status-title" aria-label="暂无评估">
        <i className="rag-evaluation-status-orb" aria-hidden="true" />
        <span className="rag-evaluation-status-title-text" role="status">暂无评估</span>
      </h3>
      <p className="rag-evaluation-summary-copy">{detail}</p>
    </div>
  </section>;
}

function WebsiteEvaluationConclusion({ score, verdict, summary, judgmentCoverage, risks, reportId, reveal }: {
  score: number;
  verdict: string;
  summary: string;
  judgmentCoverage: number;
  risks: readonly WebsiteEvaluationRiskView[];
  reportId?: string | null;
  reveal: boolean;
}) {
  const criticalRiskCount = risks.filter((risk) => risk.severity === "critical").length;
  const riskText = criticalRiskCount > 0 ? `关键风险 ${criticalRiskCount} 项` : "未发现关键风险";
  const coverageText = `判定证据覆盖 ${judgmentCoverage}%`;
  const titleGraphemes = textGraphemes(verdict);
  const summaryGraphemes = textGraphemes(summary);
  const riskGraphemes = textGraphemes(riskText);
  const coverageGraphemes = textGraphemes(coverageText);
  const metricCount = Math.max(1, riskGraphemes.length + coverageGraphemes.length);
  const { ref, progress } = useDataReveal<HTMLElement>(
    reveal,
    `${reportId ?? "local"}:${score}:${verdict}:${summary}:${riskText}:${coverageText}:website-verdict`,
    800,
    "linear",
  );

  return <section
    ref={ref}
    className={`rag-verdict is-${verdictTone(score, risks)}`}
    data-evaluation-state="quality"
    aria-label="当前网站评估摘要"
    data-testid="website-evaluation-conclusion"
  >
    <div className="rag-evaluation-summary-flow">
      <h3 className="rag-evaluation-status-title" aria-label={verdict}>
        <i className="rag-evaluation-status-orb" aria-hidden="true" style={{ opacity: revealOpacity(progress, 0, titleGraphemes.length) }} />
        <span className="rag-evaluation-status-title-text">
          <RagProgressiveText graphemes={titleGraphemes} offset={0} total={Math.max(1, titleGraphemes.length)} progress={progress} />
        </span>
      </h3>
      <p className="rag-evaluation-summary-copy">
        <RagProgressiveText graphemes={summaryGraphemes} offset={0} total={Math.max(1, summaryGraphemes.length)} progress={progress} />
      </p>
    </div>
    <div className="rag-evaluation-supporting-meta">
      <div className="rag-status-row rag-evaluation-metrics">
        <ShieldCheck size={14} aria-hidden="true" style={{ opacity: revealOpacity(progress, 0, metricCount) }} />
        <span className="rag-evaluation-metric-copy">
          <span><RagProgressiveText graphemes={riskGraphemes} offset={0} total={metricCount} progress={progress} /></span>
          <span><RagProgressiveText graphemes={coverageGraphemes} offset={riskGraphemes.length} total={metricCount} progress={progress} /></span>
        </span>
      </div>
    </div>
  </section>;
}

function WebsiteEvaluationRadar({ dimensions, reportId, reveal, empty = false }: {
  dimensions: readonly WebsiteEvaluationDimensionView[];
  reportId?: string | null;
  reveal: boolean;
  empty?: boolean;
}) {
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [renderedDimensionId, setRenderedDimensionId] = useState<string | null>(null);
  const radarInstanceId = useId();
  const detailId = `${radarInstanceId}-website-detail`;
  const axes = empty
    ? WEBSITE_EMPTY_RADAR_AXES
    : dimensions.flatMap<EvaluationRadarAxis>((dimension) => {
      if (!isWebsiteNormalizedScore(dimension.score)) return [];
      return [{
        id: dimension.id,
        label: dimension.label,
        normalizedScore: dimension.score,
        valueLabel: `${formatWebsiteScore(dimension.score)}%`,
        state: dimension.score === 0 ? "zero" : "known",
      }];
    });
  const dimensionKey = axes.map((axis) => `${axis.id}:${axis.normalizedScore}`).join("|");
  const { ref: radarRevealRef, progress: radarProgress, finish: finishRadarReveal } = useDataReveal<HTMLElement>(
    !empty && reveal,
    `${reportId ?? "local"}:${dimensionKey}:website-radar`,
  );
  const detail = dimensions.find((dimension) => dimension.id === renderedDimensionId) ?? null;
  const detailWeightedScore = detail ? (detail.score ?? 0) * detail.weight / 100 : 0;
  const { ref: detailRevealRef, progress: detailProgress } = useDataReveal<HTMLElement>(
    Boolean(selectedDimensionId && detail),
    `${reportId ?? "local"}:${selectedDimensionId ?? "closed"}:${detail?.score ?? "missing"}:website-dimension`,
  );

  useLayoutEffect(() => {
    setSelectedDimensionId(null);
    setRenderedDimensionId(null);
  }, [reportId]);

  const detailTexts = detail ? [
    detail.label,
    ...(detail.anchors ?? []).flatMap((anchor) => [
      anchor.label,
      anchor.summary,
      websiteCheckStatus(anchor.score).label,
    ]),
  ] : [];
  const detailCharacterTotal = Math.max(1, detailTexts.reduce(
    (total, text) => total + textGraphemes(text).length,
    0,
  ));
  let detailCharacterOffset = 0;
  const revealDetailText = (text: string) => {
    const graphemes = textGraphemes(text);
    const offset = detailCharacterOffset;
    detailCharacterOffset += graphemes.length;
    return <RagProgressiveText graphemes={graphemes} offset={offset} total={detailCharacterTotal} progress={detailProgress} />;
  };

  const details = <div
    className={`rag-radar-detail-shell${selectedDimensionId && detail ? " is-open" : ""}`}
    aria-hidden={!selectedDimensionId}
  >
    <div className="rag-radar-detail-shell__inner">
      {detail && <section
        ref={detailRevealRef}
        id={detailId}
        className="rag-radar-detail wev-radar-detail"
        role="region"
        aria-label={`${detail.label}详情`}
      >
        <div className="rag-radar-detail__content">
          <div className="wev-radar-detail__heading">
            <h3>{revealDetailText(detail.label)}</h3>
            <output
              className="rag-radar-detail-score"
              aria-label={`得分 ${formatWebsiteDetailScore(detailWeightedScore)} / 权重 ${detail.weight}`}
            >
              <span
                className={`rag-radar-detail-score__earned${detail.score === 0 ? " is-zero" : ""}`}
                aria-hidden="true"
              >{formatWebsiteDetailScore(detailWeightedScore * detailProgress)}</span>
              <span className="rag-radar-detail-score__maximum" aria-hidden="true">/{detail.weight}</span>
            </output>
          </div>
          <div className="wev-radar-detail__checks">
            {(detail.anchors ?? []).map((anchor) => {
              const status = websiteCheckStatus(anchor.score);
              return <article key={anchor.id}>
                <div className="wev-radar-detail__check-copy">
                  <strong>{revealDetailText(anchor.label)}</strong>
                  <p>{revealDetailText(anchor.summary)}</p>
                </div>
                <span
                  className="wev-radar-detail__status"
                  data-testid="website-evaluation-check-status"
                  role="img"
                  aria-label={`${anchor.label}：${status.label}`}
                >
                  <i className={`rag-evaluation-status-orb rag-gate-status-orb is-${status.tone}`} aria-hidden="true" />
                  <span aria-hidden="true">{revealDetailText(status.label)}</span>
                </span>
              </article>;
            })}
          </div>
        </div>
      </section>}
    </div>
  </div>;

  return <EvaluationRadar
    axes={axes}
    presentation={WEBSITE_RADAR_PRESENTATION}
    instanceId={radarInstanceId}
    maskId={`${radarInstanceId}-website-center-mask`}
    detailId={detailId}
    progress={radarProgress}
    reportRevealKey={reportId ?? ""}
    rootRef={radarRevealRef}
    selectedId={selectedDimensionId}
    onFinishReveal={finishRadarReveal}
    onSelectAxis={(dimensionId) => {
      if (selectedDimensionId === dimensionId) {
        setSelectedDimensionId(null);
        return;
      }
      setRenderedDimensionId(dimensionId);
      setSelectedDimensionId(dimensionId);
    }}
    details={empty ? undefined : details}
  />;
}

function repairItemForRisk(
  risk: WebsiteEvaluationRiskView,
): WebsiteEvaluationRepairItem | null {
  return risk.repairItem ?? null;
}

function sameRepairItem(
  left: WebsiteEvaluationRepairItem | null | undefined,
  right: WebsiteEvaluationRepairItem | null | undefined,
) {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

function RepairActionButton({
  label,
  tone,
  selected,
  disabledReason,
  onClick,
  children,
}: {
  label: "修复" | "评审";
  tone: "repair" | "review";
  selected?: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const disabled = Boolean(disabledReason);
  return <button
    type="button"
    className={`wev-repair-action is-${tone}${disabled ? " is-disabled" : ""}`}
    aria-label={disabled ? `${label}不可用：${disabledReason}` : label}
    aria-describedby={tooltipVisible ? tooltipId : undefined}
    aria-disabled={disabled || undefined}
    data-answer-panel-trigger={tone === "review" && selected && !disabled ? "review" : undefined}
    onClick={() => {
      if (!disabled) onClick();
    }}
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse") setTooltipVisible(true);
    }}
    onPointerLeave={() => setTooltipVisible(false)}
    onPointerDown={(event) => {
      if (event.pointerType !== "mouse") setTooltipVisible(false);
    }}
    onFocus={() => setTooltipVisible(true)}
    onBlur={() => setTooltipVisible(false)}
    onKeyDown={(event) => {
      if (event.key === "Escape") setTooltipVisible(false);
    }}
  >
    <span className="wev-icon-action__surface" aria-hidden="true">{children}</span>
    {tooltipVisible && <span id={tooltipId} className="wev-repair-action__tooltip" role="tooltip">{label}</span>}
  </button>;
}

function visibleReviewerLabel(label: string) {
  const value = label.trim();
  return !value || /^复核人\s*#\s*\d+$/u.test(value) ? "评审人" : value;
}

function WebsiteReviewPanelBody({
  selectedRisk,
  reviews,
  reviewsLoading,
  reviewsError,
  onManualReview,
}: {
  selectedRisk: WebsiteEvaluationRiskView | null;
  reviews: WebsiteEvaluationReviewView[];
  reviewsLoading: boolean;
  reviewsError: string | null;
  onManualReview?: (input: WebsiteEvaluationManualReviewInput) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [disposition, setDisposition] =
    useState<WebsiteEvaluationReviewDisposition>("concerns");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [reviewSubmitError, setReviewSubmitError] = useState<string | null>(null);
  const reviewSubmittingRef = useRef(false);
  const reviewGenerationRef = useRef(0);
  const repairItem = selectedRisk ? repairItemForRisk(selectedRisk) : null;
  const repairItemKey = repairItem ? `${repairItem.kind}:${repairItem.id}` : "none";
  const itemReviews = reviews.filter((review) => sameRepairItem(review.repairItem, repairItem));

  useEffect(() => {
    reviewGenerationRef.current += 1;
    reviewSubmittingRef.current = false;
    setNote("");
    setDisposition("concerns");
    setReviewSubmitting(false);
    setReviewFeedback(null);
    setReviewSubmitError(null);
    return () => {
      reviewGenerationRef.current += 1;
      reviewSubmittingRef.current = false;
    };
  }, [repairItemKey]);

  if (!selectedRisk || !repairItem) return null;
  return (
    <div className="wev-detail-body wev-review-panel">
      <section className="wev-review-target" aria-label="当前修复计划">
        <span className="wev-review-kicker">当前计划</span>
        <h3>{selectedRisk.title}</h3>
        <p>{selectedRisk.summary}</p>
      </section>
      <form className="wev-review" onSubmit={async (event) => {
        event.preventDefault();
        if (!note.trim() || !onManualReview || reviewSubmittingRef.current) return;
        const submissionGeneration = reviewGenerationRef.current;
        reviewSubmittingRef.current = true;
        setReviewSubmitting(true);
        setReviewFeedback(null);
        setReviewSubmitError(null);
        try {
          await onManualReview({ repairItem, disposition, note: note.trim() });
          if (reviewGenerationRef.current !== submissionGeneration) return;
          setNote("");
          setReviewFeedback("评审反馈已保存。");
        } catch (error) {
          if (reviewGenerationRef.current !== submissionGeneration) return;
          setReviewSubmitError(error instanceof Error && error.message.trim()
            ? error.message
            : "评审反馈暂时无法保存，请重试。");
        } finally {
          if (reviewGenerationRef.current === submissionGeneration) {
            reviewSubmittingRef.current = false;
            setReviewSubmitting(false);
          }
        }
      }}>
        <section className="wev-review-history" aria-label="评审反馈历史">
          <h3>历史反馈</h3>
          {reviewsLoading && <p className="wev-review-empty" role="status">正在读取评审反馈</p>}
          {reviewsError && <p className="wev-review-error" role="alert">{reviewsError}</p>}
          {!reviewsLoading && !reviewsError && itemReviews.length === 0 && <p className="wev-review-empty">这条计划还没有评审反馈。</p>}
          {itemReviews.length > 0 && <ul>{itemReviews.map((review) => <li key={review.reviewId}>
            <div className="wev-review-history__heading">
              <strong>{review.disposition ? REVIEW_DISPOSITION_LABELS[review.disposition] : review.dispositionLabel}</strong>
              <small>{visibleReviewerLabel(review.reviewerLabel)} · <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString("zh-CN")}</time></small>
            </div>
            <p>{review.note || "未填写补充说明。"}</p>
          </li>)}</ul>}
        </section>
        <fieldset className="wev-review-disposition" disabled={!onManualReview || reviewSubmitting}>
          <legend>评审结论</legend>
          <div className="wev-review-disposition__options">
            <label>
              <input type="radio" name="website-evaluation-review-disposition" value="agree" checked={disposition === "agree"} onChange={() => setDisposition("agree")} />
              <span>认可计划</span>
            </label>
            <label>
              <input type="radio" name="website-evaluation-review-disposition" value="concerns" checked={disposition === "concerns"} onChange={() => setDisposition("concerns")} />
              <span>需要调整</span>
            </label>
            <label>
              <input type="radio" name="website-evaluation-review-disposition" value="reject" checked={disposition === "reject"} onChange={() => setDisposition("reject")} />
              <span>不采纳</span>
            </label>
          </div>
        </fieldset>
        <div className="wev-review-note-field">
          <label htmlFor="website-evaluation-review-note">评审反馈</label>
          <textarea id="website-evaluation-review-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明认可、调整建议或不采纳原因" disabled={!onManualReview || reviewSubmitting} maxLength={4000} required />
        </div>
        <div className="wev-review-submit-row">
          <div className="wev-review-messages">
            {reviewFeedback && <p className="wev-review-feedback" role="status">{reviewFeedback}</p>}
            {reviewSubmitError && <p className="wev-review-error" role="alert">{reviewSubmitError}</p>}
          </div>
          <button type="submit" disabled={!note.trim() || !onManualReview || reviewSubmitting}>{reviewSubmitting ? "正在保存" : "保存反馈"}</button>
        </div>
      </form>
    </div>
  );
}

function WebsiteHistoryPanelBody({
  score,
  currentReportId,
  currentReportUrl,
  currentTime,
  history,
  historyHasMore,
  historyLoadingMore,
  legacyReports,
  onLoadMoreHistory,
}: {
  score: number | null;
  currentReportId?: string | null;
  currentReportUrl?: string | null;
  currentTime: string;
  history: WebsiteEvaluationHistoryView[];
  historyHasMore: boolean;
  historyLoadingMore: boolean;
  legacyReports: NonNullable<WebsiteEvaluationWorkspaceProps["legacyReports"]>;
  onLoadMoreHistory?: () => void;
}) {
  const formatHistoryTime = (value: string) => {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(timestamp);
  };
  const previousReports = history.filter((report) => report.reportId !== currentReportId);
  return <div className="wev-detail-body wev-history-panel">
    <div className="wev-history-table" role="table" aria-label="评估历史">
      <div className="wev-history-table__head" role="row">
        <span role="columnheader">评估时间</span>
        <span role="columnheader">得分</span>
        <span role="columnheader">操作</span>
      </div>
      {score !== null && <div className="wev-history-row is-current" role="row">
        <span className="wev-history-time" role="cell">
          <time>{formatHistoryTime(currentTime)}</time>
          <span className="wev-history-current">当前</span>
        </span>
        <strong role="cell">{formatWebsiteScore(score)}/100</strong>
        <span className="wev-history-row__action" role="cell">
          {currentReportUrl && <a href={currentReportUrl} target="_blank" rel="noopener noreferrer">查看报告</a>}
        </span>
      </div>}
      {previousReports.map((report) => <div className="wev-history-row" role="row" key={report.reportId}>
        <span className="wev-history-time" role="cell"><time dateTime={report.createdAt}>{formatHistoryTime(report.createdAt)}</time></span>
        <strong role="cell">{formatWebsiteScore(report.score)}/100</strong>
        <span className="wev-history-row__action" role="cell">
          {report.reportUrl
            ? <a href={report.reportUrl} target="_blank" rel="noopener noreferrer">查看报告</a>
            : <span className="wev-history-unavailable">暂无报告</span>}
        </span>
      </div>)}
    </div>
    {historyHasMore && <button
      type="button"
      className="wev-history-more"
      onClick={onLoadMoreHistory}
      disabled={historyLoadingMore || !onLoadMoreHistory}
    >{historyLoadingMore ? "正在读取更多" : "加载更多"}</button>}
    {legacyReports.length > 0 && <section className="wev-history-legacy" aria-label="旧版记录">
      <h3>旧版记录</h3>
      <div className="wev-history-table">
        {legacyReports.map((report) => <div className="wev-history-row" key={report.reportId}>
          <span className="wev-history-time"><time dateTime={report.createdAt}>{formatHistoryTime(report.createdAt)}</time></span>
          <strong>{report.score === null ? "未形成分数" : `${formatWebsiteScore(report.score)}/100`}</strong>
        </div>)}
      </div>
    </section>}
  </div>;
}

export function WebsiteEvaluationWorkspace(props: WebsiteEvaluationWorkspaceProps) {
  const [openPanels, setOpenPanels] = useState<DetailPanel[]>([]);
  const [activePanel, setActivePanel] = useState<DetailPanel | null>(null);
  const [selectedRepairItem, setSelectedRepairItem] = useState<WebsiteEvaluationRepairItem | null>(null);
  const [sheetModal, setSheetModal] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const reevaluateReasonId = useId();
  const backgroundRef = useRef<HTMLDivElement>(null);
  const completedScore = props.status === "completed" && isWebsiteNormalizedScore(props.score) ? props.score : null;
  const completed = completedScore !== null;
  const waiting = ACTIVE_STATUSES.has(props.status);
  const initial = INITIAL_STATUSES.has(props.status);
  const copy = STATUS_COPY[props.status];
  const failureDetail = (props.status === "failed" || props.status === "build_failed") && props.summary.trim()
    ? props.summary
    : copy.detail;
  const allDimensionScores = completed && props.dimensions.length === 6
    && props.dimensions.every((dimension) => isWebsiteNormalizedScore(dimension.score));
  const criticalRiskCount = props.risks.filter((risk) => risk.severity === "critical").length;
  const {
    overviewRef,
    stacked: overviewStacked,
    summaryTwoLines,
  } = useRagEvaluationLayout([
    completed ? props.reportId ?? "completed-without-report" : props.status,
    props.verdict,
    props.summary,
    props.judgmentCoverage,
    criticalRiskCount,
  ].join(":"));
  const selectedRisk = selectedRepairItem
    ? props.risks.find((risk) => sameRepairItem(risk.repairItem, selectedRepairItem)) ?? null
    : null;
  const historyAvailable = completed || Boolean(props.history?.length || props.legacyReports?.length);
  const retryFailedEvaluation = props.status === "failed" && Boolean(props.onRetry);
  const reevaluateDisabled = retryFailedEvaluation
    ? false
    : !completed || Boolean(props.reevaluatePending || props.reevaluateDisabledReason || !props.onReevaluate);
  const listEntranceScope = completed
    ? `website-report:${props.reportId ?? "completed-without-report"}`
    : "website-pre-result";

  useEffect(() => {
    if (completed) return;
    setOpenPanels([]);
    setActivePanel(null);
    setSelectedRepairItem(null);
  }, [completed]);

  useEffect(() => {
    setOpenPanels((current) => current.filter((panel) => panel !== "review"));
    setActivePanel((current) => current === "review" ? null : current);
    setSelectedRepairItem(null);
  }, [props.reportId]);

  useLayoutEffect(() => {
    const background = backgroundRef.current;
    if (!background) return;
    if (!sheetModal) {
      background.removeAttribute("inert");
      return;
    }
    background.setAttribute("inert", "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      background.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, [sheetModal]);

  useLayoutEffect(() => {
    if (!completed || !props.reportId) {
      setRevealing(false);
      return;
    }
    if (typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealing(false);
      return;
    }
    setRevealing(true);
    const timer = window.setTimeout(() => setRevealing(false), 800);
    return () => window.clearTimeout(timer);
  }, [completed, props.reportId]);

  const openPanel = (panel: DetailPanel) => {
    setOpenPanels((current) => current.includes(panel) ? current : [...current, panel]);
    setActivePanel(panel);
  };

  const closePanel = (panel: DetailPanel) => {
    setOpenPanels((current) => {
      const next = current.filter((item) => item !== panel);
      setActivePanel((active) => active === panel ? next.at(-1) ?? null : active);
      return next;
    });
  };

  return (
    <section className={`wev-workspace rag-eval-root${revealing ? " is-revealing" : ""}`} aria-label="建设评估">
      <div ref={backgroundRef} className="wev-workspace-content">
        <div className="wev-decision-grid">
        <div className="wev-column wev-column--decision">
          <section className="sfp-panel wev-card wev-decision-card" aria-label="评估结论">
            {waiting && <WaitingState status={props.status} />}
            {initial && (
              <div className="wev-score-card is-empty" data-testid="website-evaluation-initial-state">
                <header><span><span className="wev-title-icon"><FileText size={18} /></span><strong>评估结论</strong></span></header>
                <div
                  ref={overviewRef}
                  className="rag-evaluation-overview wev-evaluation-overview"
                  data-testid="website-evaluation-overview"
                  data-layout={overviewStacked ? "stacked" : "side-by-side"}
                  data-two-lines={summaryTwoLines ? "true" : "false"}
                >
                  <WebsiteEvaluationGauge score={null} reveal={false} />
                  <WebsiteEvaluationInitialConclusion detail={copy.detail} />
                </div>
                <WebsiteEvaluationRadar dimensions={[]} reveal={false} empty />
              </div>
            )}
            {!waiting && !completed && !initial && (
              <div className={`wev-no-score is-${props.status}`} role="status">
                <span className="wev-title-icon"><CircleAlert size={18} /></span>
                <span><strong>{copy.title}</strong><small>{failureDetail}</small></span>
                {props.status === "build_failed" && <button type="button" onClick={() => props.onRepairTarget({ kind: "build" })}>返回修改</button>}
              </div>
            )}

            {completed && (
              <div className="wev-score-card">
                <header><span><span className="wev-title-icon"><FileText size={18} /></span><strong>评估结论</strong></span></header>
                <div
                  ref={overviewRef}
                  className="rag-evaluation-overview wev-evaluation-overview"
                  data-testid="website-evaluation-overview"
                  data-report-reveal-key={props.reportId || undefined}
                  data-layout={overviewStacked ? "stacked" : "side-by-side"}
                  data-two-lines={summaryTwoLines ? "true" : "false"}
                >
                  <WebsiteEvaluationGauge score={completedScore} reportId={props.reportId} reveal={revealing} />
                  <WebsiteEvaluationConclusion
                    score={completedScore}
                    verdict={props.verdict}
                    summary={props.summary}
                    judgmentCoverage={props.judgmentCoverage}
                    risks={props.risks}
                    reportId={props.reportId}
                    reveal={revealing}
                  />
                </div>
                {allDimensionScores && <WebsiteEvaluationRadar dimensions={props.dimensions} reportId={props.reportId} reveal={revealing} />}
              </div>
            )}

            <div className="wev-actions rag-evaluation-actions" role="group" aria-label="评估操作">
              {completed && props.reportUrl
                ? <a className="sfp-button sfp-button--primary rag-evaluation-action" href={props.reportUrl} target="_blank" rel="noopener noreferrer">生成报告</a>
                : <button type="button" className="sfp-button sfp-button--primary rag-evaluation-action" disabled>生成报告</button>}
              <button
                type="button"
                className="sfp-button sfp-button--ghost rag-evaluation-action"
                aria-label={props.reevaluatePending ? "正在重新评估" : "重新评估"}
                aria-busy={props.reevaluatePending || undefined}
                aria-describedby={completed && props.reevaluateDisabledReason ? reevaluateReasonId : undefined}
                disabled={reevaluateDisabled}
                onClick={() => {
                  if (retryFailedEvaluation) props.onRetry?.();
                  else void props.onReevaluate?.();
                }}
              >重新评估</button>
              <button type="button" className="sfp-button sfp-button--ghost rag-evaluation-action" data-answer-panel-trigger="improve" disabled={!historyAvailable} onClick={() => openPanel("improve")}>评估历史</button>
              {completed && props.reevaluateDisabledReason && <span id={reevaluateReasonId} className="rag-reveal-screen-reader-text">{props.reevaluateDisabledReason}</span>}
            </div>
          </section>
        </div>

        <div className="wev-column wev-column--checks">
          <section className="sfp-panel wev-card wev-technical" aria-label="发布检查" data-testid="website-config-checks">
            <header><span><span className="wev-title-icon"><ShieldCheck size={18} /></span><strong>发布检查</strong></span></header>
            <ul>
              {props.technicalChecks.map((check, index) => (
                <li
                  key={`${listEntranceScope}:${check.id}`}
                  className={check.passed ? "is-passed" : "is-pending"}
                  data-wev-list-entrance={`technical-${check.id}`}
                  style={{ "--wev-list-entrance-delay": `${index * 120}ms` } as CSSProperties}
                >
                  <span>{check.passed ? <Check size={15} /> : <CircleAlert size={15} />}</span>
                  <div><strong>{check.title}</strong><small>{check.detail}</small></div>
                  <button
                    type="button"
                    className="wev-technical-action"
                    aria-label={check.actionLabel}
                    onClick={check.onAction}
                  >
                    <span className="wev-icon-action__surface" aria-hidden="true"><ArrowRight size={17} /></span>
                    <span className="wev-technical-action__tooltip" aria-hidden="true">{check.actionLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {completed && props.risks.length > 0 && <section className="sfp-panel wev-card wev-risk-card">
            <header><span><span className="wev-title-icon"><CircleAlert size={18} /></span><strong>风险修复</strong></span></header>
            <div className="wev-repair-items">
              {props.risks.map((risk, index) => {
                const repairItem = repairItemForRisk(risk);
                const selected = sameRepairItem(repairItem, selectedRepairItem);
                const repairItemKey = repairItem
                  ? `${repairItem.kind}-${repairItem.id}`
                  : `unavailable-${risk.id}`;
                return <article
                  className="wev-repair-item"
                  data-wev-list-entrance={`repair-${repairItemKey}`}
                  key={`${listEntranceScope}:${repairItemKey}`}
                  style={{ "--wev-list-entrance-delay": `${index * 120}ms` } as CSSProperties}
                >
                  <div className="wev-repair-item__content">
                    <div className="wev-repair-item__copy"><strong>{risk.title}</strong><small>{risk.summary}</small></div>
                    <span className={`rag-priority-label wev-repair-severity is-${SEVERITY_TONES[risk.severity]}`}>
                      <i className="rag-evaluation-status-orb" aria-hidden="true" />
                      <span>{SEVERITY_LABELS[risk.severity]}</span>
                    </span>
                  </div>
                  <RepairActionButton label="修复" tone="repair" onClick={() => props.onRepairTarget(risk.target)}>
                    <Wrench size={18} aria-hidden="true" />
                  </RepairActionButton>
                  <RepairActionButton
                    label="评审"
                    tone="review"
                    selected={selected}
                    disabledReason={repairItem ? undefined : "当前报告缺少稳定修复项坐标"}
                    onClick={() => {
                      if (!repairItem) return;
                      setSelectedRepairItem(repairItem);
                      openPanel("review");
                    }}
                  >
                    <ClipboardCheck size={18} aria-hidden="true" />
                  </RepairActionButton>
                </article>;
              })}
            </div>
          </section>}
        </div>
      </div>
      </div>
      <RagAnswerWindows
        panels={openPanels}
        activePanel={activePanel}
        onActivate={(panel) => (panel === "improve" || panel === "review") && openPanel(panel)}
        onClose={(panel) => (panel === "improve" || panel === "review") && closePanel(panel)}
        titles={{ evidence: "评估依据", improve: "评估历史", review: "评审反馈", answer: "建设评估", starter: "预设问题" }}
        renderBody={(panel) => panel === "improve" && historyAvailable
          ? <WebsiteHistoryPanelBody
              score={completedScore}
              currentReportId={props.reportId}
              currentReportUrl={props.reportUrl}
              currentTime={props.evidenceUpdatedLabel}
              history={props.history ?? []}
              historyHasMore={Boolean(props.historyHasMore)}
              historyLoadingMore={Boolean(props.historyLoadingMore)}
              legacyReports={props.legacyReports ?? []}
              onLoadMoreHistory={props.onLoadMoreHistory}
            />
          : panel === "review"
            ? <WebsiteReviewPanelBody
                selectedRisk={selectedRisk}
                reviews={props.reviews ?? []}
                reviewsLoading={Boolean(props.reviewsLoading)}
                reviewsError={props.reviewsError ?? null}
                onManualReview={props.onManualReview}
              />
            : null}
        renderFooter={() => null}
        availability={{ evidence: false, improve: historyAvailable, review: completed && Boolean(selectedRisk), answer: false, starter: false }}
        modalBlocked={false}
        onModalChange={setSheetModal}
      />
    </section>
  );
}
