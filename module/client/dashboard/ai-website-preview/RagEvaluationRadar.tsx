import { useId, useLayoutEffect, useMemo, useState } from "react";
import type { EvaluationDimension } from "./evaluation-skill-contract";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run";
import { scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";
import {
  EvaluationRadar,
  type EvaluationRadarAxis,
  type EvaluationRadarPresentation,
} from "./EvaluationRadar";
import { RAG_DIMENSIONS } from "./rag-evaluation";
import { useDataReveal } from "./useDataReveal";
import { useRagEntranceReady } from "./RagEntranceContext";
import { RagProgressiveText, textGraphemes } from "./RagProgressiveText";

const labels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"] as const;
const checkLabels = {
  met: "满足",
  partial: "部分满足",
  unmet: "不满足",
  undetermined: "待核验",
  not_applicable: "不适用",
} as const;

const formatScore = (value: number) => Number(value.toFixed(1)).toString();
const known = (dimension: EvaluationDimension | undefined): dimension is EvaluationDimension & { score: number } => Boolean(
  dimension
  && dimension.status !== "pending"
  && dimension.status !== "not_applicable"
  && dimension.score !== null
  && Number.isFinite(dimension.score)
  && dimension.maxScore > 0
  && dimension.score >= 0
  && dimension.score <= dimension.maxScore,
);
const valueLabel = (dimension: EvaluationDimension | undefined, emptyQuestion = false) => emptyQuestion
  ? "暂无评分"
  : dimension?.status === "not_applicable"
    ? "不适用"
    : !known(dimension)
      ? "待核验"
      : `${formatScore(100 * dimension.score / dimension.maxScore)}%`;
const axisState = (dimension: EvaluationDimension | undefined, emptyQuestion = false): EvaluationRadarAxis["state"] => emptyQuestion
  ? "empty"
  : dimension?.status === "not_applicable"
    ? "not-applicable"
    : !known(dimension)
      ? "pending"
      : dimension.score === 0
        ? "zero"
        : "known";
const checkNote = (check: { earned: number | null; status: keyof typeof checkLabels; exclusionReason: string }) =>
  check.earned !== null ? null : check.status === "not_applicable" ? check.exclusionReason : "待补证，不计为零分";
const checkRawScore = (check: { earned: number | null; weight: number; status: keyof typeof checkLabels }) => check.earned !== null
  ? `${formatScore(check.earned)} / ${formatScore(check.weight)} 原始分`
  : `${checkLabels[check.status]}；权重 ${formatScore(check.weight)}`;

const RAG_RADAR_PRESENTATION: EvaluationRadarPresentation = {
  classes: {
    root: "rag-radar rag-radar--enterprise",
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
    root: "rag-evaluation-radar",
    centerMask: "rag-radar-center-mask",
    area: "rag-radar-area",
    label: "rag-evaluation-dimension-label",
    control: "rag-evaluation-dimension",
    marker: "rag-radar-point-marker",
  },
  labels: {
    root: "六维加权评分",
    title: "六维质量雷达图",
    description: ({ complete, empty }) => `五层六边形表示从0%到100%的相对范围，实际百分比标在各维度名称下方。中心保持透明，点选维度标记可查看分数与依据。${empty ? "暂无评分。" : complete ? "已绘制完整评分区域。" : "存在待核验或不适用项，仅绘制已知标记，不填充完整区域。"}`,
    control: axis => `${axis.label} ${axis.valueLabel}${axis.disabled ? "" : "，查看详情"}`,
  },
};

export function RagEvaluationRadar({ dimensions, judgments, emptyQuestion = false, revealKey: externalRevealKey = "" }: {
  dimensions: EvaluationDimension[];
  judgments?: EnterpriseRagChecklistJudgeOutput | null;
  emptyQuestion?: boolean;
  revealKey?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renderedDetailId, setRenderedDetailId] = useState<string | null>(null);
  useLayoutEffect(() => {
    setSelected(null);
    setRenderedDetailId(null);
  }, [emptyQuestion, externalRevealKey]);

  const id = useId();
  const detailId = `${id}-detail`;
  const sourceDimensions = RAG_DIMENSIONS.map(definition => dimensions.find(item => item.id === definition.id));
  const axes = sourceDimensions.map<EvaluationRadarAxis>((dimension, index) => ({
    id: RAG_DIMENSIONS[index].id,
    label: labels[index],
    normalizedScore: known(dimension) ? 100 * dimension.score / dimension.maxScore : null,
    valueLabel: valueLabel(dimension, emptyQuestion),
    state: axisState(dimension, emptyQuestion),
    disabled: emptyQuestion,
  }));
  const dimensionRevealKey = sourceDimensions.map(dimension => `${dimension?.id}:${dimension?.status}:${dimension?.score}:${dimension?.maxScore}`).join("|");
  const entranceReady = useRagEntranceReady();
  const { ref: revealRef, progress, finish: finishReveal } = useDataReveal<HTMLElement>(
    !emptyQuestion && sourceDimensions.some(known),
    `${externalRevealKey}:${emptyQuestion}:${dimensionRevealKey}`,
    undefined,
    undefined,
    entranceReady,
  );
  const checklistDimensions = useMemo(() => {
    if (!judgments) return null;
    try {
      return scoreRagChecklist(judgments.checklist, judgments.checks).dimensions;
    } catch {
      // Persisted reports are validated at the API boundary. Keep the report
      // readable if corrupt local data reaches this presentation layer.
      return null;
    }
  }, [judgments]);

  const detail = sourceDimensions.find(dimension => dimension?.id === renderedDetailId);
  const detailIndex = sourceDimensions.findIndex(dimension => dimension?.id === renderedDetailId);
  const detailLabel = detailIndex >= 0 ? labels[detailIndex] : detail?.label;
  const checks = checklistDimensions?.find(dimension => dimension.id === renderedDetailId)?.checks;
  const normalizedForExclusions = Boolean(checks?.some(check => !check.applicable));
  const detailFindings = detail && judgments
    ? judgments.findings.filter(finding => finding.dimensionIds.includes(detail.id as typeof finding.dimensionIds[number]))
    : [];
  const { ref: detailRevealRef, progress: detailScoreProgress } = useDataReveal<HTMLElement>(
    Boolean(selected && detail && known(detail)),
    `${externalRevealKey}:${selected ?? "closed"}:${detail?.score ?? "pending"}:${detail?.maxScore ?? "unknown"}:detail`,
    800,
    "ease-out",
    entranceReady,
  );
  const detailUnavailableLabel = detail?.status === "not_applicable" ? "不适用" : "待核验";
  const detailHasKnownScore = known(detail);
  const detailScoreAccessibleLabel = detailHasKnownScore
    ? `得分 ${formatScore(detail.score)} / 权重 ${formatScore(detail.maxScore)}`
    : detailUnavailableLabel;
  const detailTexts = detail ? [
    detailLabel ?? detail.label,
    ...(checks ? checks.flatMap(check => [
      check.label,
      checkRawScore(check),
      checkNote(check),
      check.rationale,
      checkLabels[check.status],
    ]) : [detail.summary]),
    ...(normalizedForExclusions ? ["本维存在预先冻结的不适用项，维度分按其余适用项归一计算。"] : []),
    ...detailFindings.flatMap(finding => [
      finding.summary,
      finding.impact,
      ...finding.claimIds.map(claimId => judgments?.claims.find(claim => claim.id === claimId)?.statement ?? ""),
    ]),
  ].filter((text): text is string => Boolean(text)) : [];
  const detailCharacterTotal = Math.max(1, detailTexts.reduce((total, text) => total + textGraphemes(text).length, 0));
  let detailCharacterOffset = 0;
  const revealDetailText = (text: string) => {
    const graphemes = textGraphemes(text);
    const offset = detailCharacterOffset;
    detailCharacterOffset += graphemes.length;
    return <RagProgressiveText graphemes={graphemes} offset={offset} total={detailCharacterTotal} progress={detailScoreProgress} />;
  };

  const details = <div id={detailId} className={`rag-radar-detail-shell${selected && detail ? " is-open" : ""}`} aria-hidden={!selected}>
    <div className="rag-radar-detail-shell__inner">
      {!emptyQuestion && detail && <section
        ref={detailRevealRef}
        className="rag-radar-detail rag-radar-detail--enterprise"
        role="region"
        aria-label={`${detailLabel ?? detail.label}详情`}
      >
        <header className="rag-radar-detail__header">
          <h3>{revealDetailText(detailLabel ?? detail.label)}</h3>
          <output
            className={`rag-radar-detail-score${detailHasKnownScore ? "" : " is-unavailable"}`}
            aria-label={detailScoreAccessibleLabel}
          >
            {detailHasKnownScore
              ? <>
                <span
                  className={`rag-radar-detail-score__earned${detail.score === 0 ? " is-zero" : ""}`}
                  data-testid="rag-radar-detail-earned"
                  aria-hidden="true"
                >{formatScore(detail.score * detailScoreProgress)}</span>
                <span className="rag-radar-detail-score__maximum" aria-hidden="true">/{formatScore(detail.maxScore)}</span>
              </>
              : <span aria-hidden="true">{detailUnavailableLabel}</span>}
          </output>
        </header>
        <div key={renderedDetailId} className="rag-radar-detail__content">
          {checks
            ? <div className="rag-radar-detail__checks">
              {checks.map(check => <article key={check.id} className="rag-radar-detail__check">
                <div className="rag-radar-detail__check-copy">
                  <strong className="rag-radar-detail__check-title">{revealDetailText(check.label)}</strong>
                  <p className="rag-radar-detail__raw-score">{revealDetailText(checkRawScore(check))}</p>
                  {checkNote(check) && <p className="rag-radar-detail__note">{revealDetailText(checkNote(check)!)}</p>}
                  <p className="rag-radar-detail__rationale">{revealDetailText(check.rationale)}</p>
                </div>
                <span
                  className={`rag-radar-detail__check-status is-${check.status}`}
                  role="img"
                  aria-label={`${check.label}：${checkLabels[check.status]}`}
                >
                  <i className="rag-evaluation-status-orb" aria-hidden="true" />
                  <span aria-hidden="true">{revealDetailText(checkLabels[check.status])}</span>
                </span>
              </article>)}
            </div>
            : <p className="rag-radar-detail__summary">{revealDetailText(detail.summary)}</p>}
          {normalizedForExclusions && <p className="rag-radar-detail__supplement">{revealDetailText("本维存在预先冻结的不适用项，维度分按其余适用项归一计算。")}</p>}
          {detailFindings.map(finding => <article key={finding.id} className="rag-radar-detail__finding">
            <strong>{revealDetailText(finding.summary)}</strong>
            <p>{revealDetailText(finding.impact)}</p>
            {finding.claimIds.map(claimId => {
              const statement = judgments?.claims.find(claim => claim.id === claimId)?.statement;
              return statement ? <blockquote key={claimId}>{revealDetailText(statement)}</blockquote> : null;
            })}
          </article>)}
        </div>
      </section>}
    </div>
  </div>;

  return <EvaluationRadar
    axes={axes}
    presentation={RAG_RADAR_PRESENTATION}
    instanceId={id}
    maskId={`${id}-center-mask`}
    detailId={detailId}
    progress={progress}
    reportRevealKey={externalRevealKey}
    rootRef={revealRef}
    selectedId={selected}
    onFinishReveal={finishReveal}
    onSelectAxis={(dimensionId) => {
      if (selected === dimensionId) {
        setSelected(null);
        return;
      }
      setRenderedDetailId(dimensionId);
      setSelected(dimensionId);
    }}
    details={details}
  />;
}
