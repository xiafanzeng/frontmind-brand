import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import type { EvaluationDimension } from "./evaluation-skill-contract";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run";
import { scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";
import { RAG_DIMENSIONS } from "./rag-evaluation";
import { useDataReveal } from "./useDataReveal";
import { useRagEntranceReady } from "./RagEntranceContext";
import { RagProgressiveText, textGraphemes } from "./RagProgressiveText";

const labels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];
const RADAR_VIEWBOX_WIDTH = 400;
const RADAR_VIEWBOX_HEIGHT = 368;
const RADAR_CENTER_X = 200;
const RADAR_CENTER_Y = 184;
const RADAR_INNER_RADIUS = 20;
const RADAR_OUTER_RADIUS = 100;
const RADAR_MIN_CONTROL_RADIUS = 42;
const RADAR_LABEL_RADIUS = 152;
const RADAR_GRID_RADII = [20, 40, 60, 80, 100];

const format = (n: number) => Number(n.toFixed(2)).toString();
const formatDetailScore = (n: number) => n.toFixed(1);
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
const valueLabel = (d: EvaluationDimension | undefined, emptyQuestion = false) => emptyQuestion
  ? "暂无评分"
  : d?.status === "not_applicable"
  ? "不适用"
  : !known(d)
    ? "待核验"
    : `${format(100 * d.score / d.maxScore)}%`;
const markerState = (d: EvaluationDimension | undefined, emptyQuestion = false) => emptyQuestion
  ? "is-empty"
  : d?.status === "not_applicable"
  ? "is-not-applicable"
  : !known(d)
    ? "is-pending"
    : d.score === 0
      ? "is-zero"
      : "is-known";

const checkLabels = { met: "满足", partial: "部分满足", unmet: "不满足", undetermined: "待核验", not_applicable: "不适用" };
const checkNote = (check: { earned: number | null; status: keyof typeof checkLabels; exclusionReason: string }) =>
  check.earned !== null ? null : check.status === "not_applicable" ? check.exclusionReason : "待补证，不计为零分";

export function RagEvaluationRadar({ dimensions, judgments, emptyQuestion = false, revealKey: externalRevealKey = "" }: {
  dimensions: EvaluationDimension[];
  judgments?: EnterpriseRagChecklistJudgeOutput | null;
  emptyQuestion?: boolean;
  revealKey?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renderedDetailId, setRenderedDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (!emptyQuestion) return;
    setSelected(null);
    setRenderedDetailId(null);
  }, [emptyQuestion]);
  const id = useId();
  const maskId = `${id}-center-mask`;
  const axes = RAG_DIMENSIONS.map(d => dimensions.find(item => item.id === d.id));
  const dimensionRevealKey = axes.map(d => `${d?.id}:${d?.status}:${d?.score}:${d?.maxScore}`).join("|");
  const entranceReady = useRagEntranceReady();
  const { ref: revealRef, progress, finish: finishReveal } = useDataReveal<HTMLElement>(!emptyQuestion && axes.some(known), `${externalRevealKey}:${emptyQuestion}:${dimensionRevealKey}`, undefined, undefined, entranceReady);
  const checklistDimensions = useMemo(() => {
    if (!judgments) return null;
    try {
      return scoreRagChecklist(judgments.checklist, judgments.checks).dimensions;
    } catch {
      // Persisted reports are validated at the API boundary. This fallback
      // keeps the page readable if local/corrupt data reaches this component.
      return null;
    }
  }, [judgments]);

  const full = !emptyQuestion && axes.every(known);
  const animatedRadius = (d: EvaluationDimension & { score: number }) =>
    RADAR_INNER_RADIUS + (scoreRadius(d) - RADAR_INNER_RADIUS) * progress;
  const values = axes.map((d, i) => !emptyQuestion && known(d) ? point(i, animatedRadius(d)) : null);
  const markerLayouts = axes.map((d, i) => {
    const markerRadius = !emptyQuestion && known(d) ? animatedRadius(d) : RADAR_INNER_RADIUS;
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
  const detail = axes.find(d => d?.id === renderedDetailId);
  const detailIndex = axes.findIndex(d => d?.id === renderedDetailId);
  const detailLabel = detailIndex >= 0 ? labels[detailIndex] : detail?.label;
  const checks = checklistDimensions?.find(d => d.id === renderedDetailId)?.checks;
  const normalizedForExclusions = Boolean(checks?.some(check => !check.applicable));
  const { ref: detailRevealRef, progress: detailScoreProgress } = useDataReveal<HTMLElement>(
    Boolean(selected && detail && known(detail)),
    `${externalRevealKey}:${selected ?? "closed"}:${detail?.score ?? "pending"}:${detail?.maxScore ?? "unknown"}:detail`,
    800,
    "ease-out",
    entranceReady,
  );
  const detailScoreLabel = detail?.score === null
    ? detail.status === "not_applicable" ? "不适用" : "待核验"
    : detail ? `${formatDetailScore(detail.score)} / ${format(detail.maxScore)}` : "";
  const detailTexts = detail ? [
    detailLabel ?? detail.label,
    ...(checks ? checks.flatMap(check => [
      check.label,
      checkLabels[check.status],
      checkNote(check),
      check.rationale,
    ]) : [detail.summary]),
    ...(normalizedForExclusions ? ["本维存在预先冻结的不适用项，维度分按其余适用项归一计算。"] : []),
    ...(judgments?.findings.filter(f => f.dimensionIds.includes(detail.id as typeof f.dimensionIds[number])).flatMap(f => [
      f.summary,
      f.impact,
      ...f.claimIds.map(claimId => judgments.claims.find(c => c.id === claimId)?.statement ?? ""),
    ]) ?? []),
  ].filter((text): text is string => Boolean(text)) : [];
  const detailCharacterTotal = Math.max(1, detailTexts.reduce((total, text) => total + textGraphemes(text).length, 0));
  let detailCharacterOffset = 0;
  const revealDetailText = (text: string) => {
    const graphemes = textGraphemes(text);
    const offset = detailCharacterOffset;
    detailCharacterOffset += graphemes.length;
    return <RagProgressiveText graphemes={graphemes} offset={offset} total={detailCharacterTotal} progress={detailScoreProgress} />;
  };

  return <section ref={revealRef} className="rag-radar" aria-label="六维加权评分" data-report-reveal-key={externalRevealKey || undefined}>
    <div className="rag-radar-chart">
      <svg viewBox={`0 0 ${RADAR_VIEWBOX_WIDTH} ${RADAR_VIEWBOX_HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>六维质量雷达图</title>
        <desc id={`${id}-description`}>五层六边形表示从0%到100%的相对范围，实际百分比标在各维度名称下方。中心保持透明，点选维度标记可查看分数与依据。{emptyQuestion ? "暂无评分。" : full ? "已绘制完整评分区域。" : "存在待核验或不适用项，仅绘制已知标记，不填充完整区域。"}</desc>
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
          <span>{labels[i]}</span><strong>{valueLabel(d, emptyQuestion)}</strong>
        </div>;
      })}
      {RAG_DIMENSIONS.map((definition, i) => {
        const d = axes[i];
        const { controlPosition: [x, y], offsetX, offsetY } = markerLayouts[i];
        const value = valueLabel(d, emptyQuestion);
        const state = markerState(d, emptyQuestion);
        const style = {
          left: `${100 * x / RADAR_VIEWBOX_WIDTH}%`,
          top: `${100 * y / RADAR_VIEWBOX_HEIGHT}%`,
          "--rag-point-offset-x": `${offsetX}px`,
          "--rag-point-offset-y": `${offsetY}px`,
          "--rag-point-relative-x": `${100 * offsetX / RADAR_VIEWBOX_WIDTH}cqw`,
          "--rag-point-relative-y": `${100 * offsetY / RADAR_VIEWBOX_WIDTH}cqw`,
        } as CSSProperties;
        return <button key={definition.id} type="button" data-testid="rag-evaluation-dimension" className={`rag-radar-point-control ${state}`}
          style={style}
          disabled={emptyQuestion}
          aria-label={`${labels[i]} ${value}${emptyQuestion ? "" : "，查看详情"}`} aria-expanded={emptyQuestion ? undefined : selected === definition.id} aria-controls={emptyQuestion ? undefined : `${id}-detail`}
          onPointerEnter={finishReveal} onFocus={finishReveal}
          onClick={() => {
            finishReveal();
            if (selected === definition.id) {
              setSelected(null);
              return;
            }
            setRenderedDetailId(definition.id);
            setSelected(definition.id);
          }}>
          <span data-testid="rag-radar-point-marker" className={`rag-radar-point-marker ${state}`} style={{ opacity: !emptyQuestion && known(d) ? progress : 1 }} aria-hidden="true" />
        </button>;
      })}
    </div>
    <div className={`rag-radar-detail-shell${selected && detail ? " is-open" : ""}`} aria-hidden={!selected}>
      <div className="rag-radar-detail-shell__inner">
        {!emptyQuestion && detail && <section ref={detailRevealRef} id={`${id}-detail`} className="rag-radar-detail" aria-label={`${detailLabel}详情`}>
          <header className="rag-radar-detail__header">
            <h3>{revealDetailText(detailLabel ?? detail.label)}</h3>
            <strong className={`rag-radar-detail-score${detail.score === null ? " is-unavailable" : ""}`} aria-label={detailScoreLabel}>
              {detail.score === null
                ? <span>{detailScoreLabel}</span>
                : <><span className={`rag-radar-detail-score__earned${detail.score === 0 ? " is-zero" : ""}`} data-testid="rag-radar-detail-earned" aria-hidden="true">{formatDetailScore(detail.score * detailScoreProgress)}</span><span className="rag-radar-detail-score__maximum" aria-hidden="true">/{format(detail.maxScore)}</span></>}
            </strong>
          </header>
          <div key={renderedDetailId} className="rag-radar-detail__content">
          {checks ? checks.map(check => <article key={check.id} className="rag-radar-detail__check">
            <div className="rag-radar-detail__check-heading">
              <strong className="rag-radar-detail__check-title">{revealDetailText(check.label)}</strong>
              <span className={`rag-radar-detail__check-status is-${check.status}`}>
                <i className="rag-evaluation-status-orb" aria-hidden="true" />
                <span>{revealDetailText(checkLabels[check.status])}</span>
              </span>
            </div>
            {checkNote(check) && <p className="rag-radar-detail__note">{revealDetailText(checkNote(check)!)}</p>}
            <p>{revealDetailText(check.rationale)}</p>
          </article>) : <p>{revealDetailText(detail.summary)}</p>}
          {normalizedForExclusions && <p className="rag-muted">{revealDetailText("本维存在预先冻结的不适用项，维度分按其余适用项归一计算。")}</p>}
          {judgments?.findings.filter(f => f.dimensionIds.includes(detail.id as typeof f.dimensionIds[number])).map(f => <article key={f.id} className="rag-radar-detail__finding">
            <strong>{revealDetailText(f.summary)}</strong><p>{revealDetailText(f.impact)}</p>
            {f.claimIds.map(claimId => { const statement = judgments.claims.find(c => c.id === claimId)?.statement; return statement ? <blockquote key={claimId}>{revealDetailText(statement)}</blockquote> : null; })}
          </article>)}</div>
        </section>}
      </div>
    </div>
  </section>;
}
