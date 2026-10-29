import { useId, useState, type CSSProperties } from "react";
import type { EvaluationDimension } from "./evaluation-skill-contract";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run";
import { scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";
import { RAG_DIMENSIONS } from "./rag-evaluation";

const labels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];
const RADAR_VIEWBOX_WIDTH = 400;
const RADAR_VIEWBOX_HEIGHT = 368;
const RADAR_CENTER_X = 200;
const RADAR_CENTER_Y = 184;
const RADAR_INNER_RADIUS = 20;
const RADAR_OUTER_RADIUS = 100;
const RADAR_MIN_CONTROL_RADIUS = 28;
const RADAR_LABEL_RADIUS = 152;
const RADAR_GRID_RADII = [20, 40, 60, 80, 100];

const format = (n: number) => Number(n.toFixed(2)).toString();
const point = (i: number, radius: number) => {
  const angle = -Math.PI / 2 + i * Math.PI / 3;
  return [RADAR_CENTER_X + Math.cos(angle) * radius, RADAR_CENTER_Y + Math.sin(angle) * radius];
};
const known = (d: EvaluationDimension | undefined): d is EvaluationDimension & { score: number } => Boolean(
  d
  && d.status !== "pending"
  && d.status !== "not_applicable"
  && d.score !== null
  && Number.isFinite(d.score)
  && d.maxScore > 0
  && d.score >= 0
  && d.score <= d.maxScore,
);
const scoreRadius = (d: EvaluationDimension & { score: number }) => {
  const ratio = Math.min(1, Math.max(0, d.score / d.maxScore));
  return RADAR_INNER_RADIUS + (RADAR_OUTER_RADIUS - RADAR_INNER_RADIUS) * ratio;
};
const valueLabel = (d: EvaluationDimension | undefined) => d?.status === "not_applicable"
  ? "不适用"
  : !known(d)
    ? "待核验"
    : `${format(100 * d.score / d.maxScore)}%`;
const markerState = (d: EvaluationDimension | undefined) => d?.status === "not_applicable"
  ? "is-not-applicable"
  : !known(d)
    ? "is-pending"
    : d.score === 0
      ? "is-zero"
      : "is-known";

const checkLabels = { met: "满足", partial: "部分满足", unmet: "不满足", undetermined: "待核验", not_applicable: "不适用" };

export function RagEvaluationRadar({ dimensions, judgments }: {
  dimensions: EvaluationDimension[];
  judgments?: EnterpriseRagChecklistJudgeOutput | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const maskId = `${id}-center-mask`;
  const axes = RAG_DIMENSIONS.map(d => dimensions.find(item => item.id === d.id));
  let checklistDimensions: ReturnType<typeof scoreRagChecklist>["dimensions"] | null = null;
  if (judgments) {
    try {
      checklistDimensions = scoreRagChecklist(judgments.checklist, judgments.checks).dimensions;
    } catch {
      // Persisted reports are validated at the API boundary. This fallback
      // keeps the page readable if local/corrupt data reaches this component.
      checklistDimensions = null;
    }
  }

  const full = axes.every(known);
  const values = axes.map((d, i) => known(d) ? point(i, scoreRadius(d)) : null);
  const markerLayouts = axes.map((d, i) => {
    const markerRadius = known(d) ? scoreRadius(d) : RADAR_INNER_RADIUS;
    const controlRadius = Math.max(markerRadius, RADAR_MIN_CONTROL_RADIUS);
    const markerPosition = point(i, markerRadius);
    const controlPosition = point(i, controlRadius);
    return {
      controlPosition,
      offsetX: markerPosition[0] - controlPosition[0],
      offsetY: markerPosition[1] - controlPosition[1],
    };
  });
  const innerPoints = axes.map((_, i) => point(i, RADAR_INNER_RADIUS).join(",")).join(" ");
  const detail = axes.find(d => d?.id === selected);
  const detailIndex = axes.findIndex(d => d?.id === selected);
  const detailLabel = detailIndex >= 0 ? labels[detailIndex] : detail?.label;
  const checks = checklistDimensions?.find(d => d.id === selected)?.checks;
  const normalizedForExclusions = Boolean(checks?.some(check => !check.applicable));

  return <section className="rag-radar" aria-label="六维加权评分">
    <div className="rag-radar-chart">
      <svg viewBox={`0 0 ${RADAR_VIEWBOX_WIDTH} ${RADAR_VIEWBOX_HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>六维质量雷达图</title>
        <desc id={`${id}-description`}>五层六边形表示从0%到100%的相对范围，实际百分比标在各维度名称下方。中心保持透明，点选维度标记可查看分数与依据。{full ? "已绘制完整评分区域。" : "存在待核验或不适用项，仅绘制已知标记，不填充完整区域。"}</desc>
        <defs>
          <mask id={maskId} data-testid="rag-radar-center-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={RADAR_VIEWBOX_WIDTH} height={RADAR_VIEWBOX_HEIGHT}>
            <rect x="0" y="0" width={RADAR_VIEWBOX_WIDTH} height={RADAR_VIEWBOX_HEIGHT} fill="#fff" />
            <polygon className="rag-radar-center-cutout" points={innerPoints} fill="#000" />
          </mask>
        </defs>
        {RADAR_GRID_RADII.map(radius => <polygon key={radius} className="rag-radar-grid" points={axes.map((_, i) => point(i, radius).join(",")).join(" ")} />)}
        {axes.map((_, i) => {
          const [x1, y1] = point(i, RADAR_INNER_RADIUS);
          const [x2, y2] = point(i, RADAR_OUTER_RADIUS);
          return <line key={i} className="rag-radar-axis" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {full && <polygon data-testid="rag-radar-area" className="rag-radar-area" mask={`url(#${maskId})`} points={values.map(p => p!.join(",")).join(" ")} />}
      </svg>
      {RAG_DIMENSIONS.map((definition, i) => {
        const d = axes[i];
        const [x, y] = point(i, RADAR_LABEL_RADIUS);
        return <div key={definition.id} data-testid="rag-evaluation-dimension-label" className="rag-radar-label" aria-hidden="true"
          style={{ left: `${100 * x / RADAR_VIEWBOX_WIDTH}%`, top: `${100 * y / RADAR_VIEWBOX_HEIGHT}%` }}>
          <span>{labels[i]}</span><strong>{valueLabel(d)}</strong>
        </div>;
      })}
      {RAG_DIMENSIONS.map((definition, i) => {
        const d = axes[i];
        const { controlPosition: [x, y], offsetX, offsetY } = markerLayouts[i];
        const value = valueLabel(d);
        const state = markerState(d);
        const style = {
          left: `${100 * x / RADAR_VIEWBOX_WIDTH}%`,
          top: `${100 * y / RADAR_VIEWBOX_HEIGHT}%`,
          "--rag-point-offset-x": `${offsetX}px`,
          "--rag-point-offset-y": `${offsetY}px`,
        } as CSSProperties;
        return <button key={definition.id} type="button" data-testid="rag-evaluation-dimension" className={`rag-radar-point-control ${state}`}
          style={style}
          aria-label={`${labels[i]} ${value}，查看详情`} aria-expanded={selected === definition.id} aria-controls={`${id}-detail`}
          onClick={() => setSelected(selected === definition.id ? null : definition.id)}>
          <span data-testid="rag-radar-point-marker" className={`rag-radar-point-marker ${state}`} aria-hidden="true" />
        </button>;
      })}
    </div>
    {detail && <section id={`${id}-detail`} className="rag-radar-detail" aria-label={`${detailLabel}详情`}>
      <header><h3>{detailLabel}</h3><strong>{detail.score === null ? detail.status === "not_applicable" ? "不适用" : "待核验" : `${format(detail.score)} / ${detail.maxScore}`}</strong></header>
      {checks ? checks.map(check => <article key={check.id}>
        <strong>{check.label} · {checkLabels[check.status]}</strong>
        <small>{check.earned === null ? check.status === "not_applicable" ? check.exclusionReason : "待补证，不计为零分" : `${format(check.earned)} / ${check.weight} 原始分`}</small>
        <p>{check.rationale}</p><small>证据：{check.evidenceIds.join("、")}</small>
      </article>) : <><p>{detail.summary}</p><small>证据：{detail.evidenceIds.join("、") || "待补充"}</small></>}
      {normalizedForExclusions && <p className="rag-muted">本维存在预先冻结的不适用项，维度分按其余适用项归一计算。</p>}
      {judgments?.findings.filter(f => f.dimensionIds.includes(detail.id as typeof f.dimensionIds[number])).map(f => <article key={f.id}>
        <strong>{f.summary}</strong><p>{f.impact}</p>
        {f.claimIds.map(claimId => <blockquote key={claimId}>{judgments.claims.find(c => c.id === claimId)?.statement}</blockquote>)}
        <small>证据：{f.evidenceIds.join("、")}</small>
      </article>)}
    </section>}
  </section>;
}
