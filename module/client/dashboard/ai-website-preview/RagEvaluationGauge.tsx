// Apple UI Design System – Verified: 8pt Grid, SF Pro Typography, Material-Depth, Natural Spring Motion
import { useId } from "react";

export const RAG_GAUGE_VIEWBOX_WIDTH = 120;
export const RAG_GAUGE_VIEWBOX_HEIGHT = 80;
export const RAG_GAUGE_CENTER_X = 60;
export const RAG_GAUGE_CENTER_Y = 42;
export const RAG_GAUGE_RADIUS = 34;
export const RAG_GAUGE_START_ANGLE = 150;
export const RAG_GAUGE_SWEEP_DEGREES = 240;
export const RAG_GAUGE_STROKE_WIDTH = 9;
export const RAG_GAUGE_DOT_RADIUS = 4.5;
export const RAG_GAUGE_CUTOUT_RADIUS = 8;
export const RAG_GAUGE_DOT_GAP = RAG_GAUGE_CUTOUT_RADIUS - RAG_GAUGE_DOT_RADIUS;
export const RAG_GAUGE_SCORE_Y = RAG_GAUGE_CENTER_Y - 1;
export const RAG_GAUGE_ENDPOINT_LABEL_INSET = 0.5;

const RAG_GAUGE_MIN_LABEL_BASE_X = 37.69;
const RAG_GAUGE_MAX_LABEL_BASE_X = 82.31;
const RAG_GAUGE_ENDPOINT_LABEL_Y = 67.66;
const RAG_GAUGE_ARC_PATH = "M30.56 59 A34 34 0 1 1 89.44 59";

export type RagEvaluationGaugeProps = {
  score: number | null | undefined;
  unavailable?: boolean;
};

const roundGeometry = (value: number) => Number(value.toFixed(2));

export function ragGaugePoint(score: number) {
  const angle = RAG_GAUGE_START_ANGLE + score / 100 * RAG_GAUGE_SWEEP_DEGREES;
  const radians = angle * Math.PI / 180;
  return {
    x: roundGeometry(RAG_GAUGE_CENTER_X + Math.cos(radians) * RAG_GAUGE_RADIUS),
    y: roundGeometry(RAG_GAUGE_CENTER_Y + Math.sin(radians) * RAG_GAUGE_RADIUS),
    angle: roundGeometry(angle),
  };
}

function isDisplayableScore(score: number | null | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
}

function formatScore(score: number) {
  return Number(score.toFixed(2)).toString();
}

export function RagEvaluationGauge({ score, unavailable = false }: RagEvaluationGaugeProps) {
  const maskId = `rag-gauge-cutout-${useId().replace(/:/g, "")}`;
  const valid = !unavailable && isDisplayableScore(score);
  const marker = valid ? ragGaugePoint(score) : null;
  const scoreText = unavailable ? "!" : valid ? formatScore(score) : "—";
  const gaugeLabel = unavailable
    ? "重大问题，数值分不适用"
    : valid
      ? `六维诊断分 ${scoreText}，量程 0 至 100；紫色圆点标示当前分数`
      : "六维诊断分待评估，量程 0 至 100";

  return <output
    data-testid="rag-evaluation-score"
    className={`erag-evaluation-score rag-evaluation-gauge rag-evaluation-gauge-card${unavailable ? " is-danger" : ""}`}
    aria-label="六维诊断评分"
    aria-live="polite"
  >
    <span className="rag-evaluation-gauge-graphic" role="img" aria-label={gaugeLabel}>
      <svg
        viewBox={`0 0 ${RAG_GAUGE_VIEWBOX_WIDTH} ${RAG_GAUGE_VIEWBOX_HEIGHT}`}
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId}>
            <rect width={RAG_GAUGE_VIEWBOX_WIDTH} height={RAG_GAUGE_VIEWBOX_HEIGHT} fill="white" />
            {marker && <circle
              data-testid="rag-gauge-cutout"
              cx={marker.x}
              cy={marker.y}
              r={RAG_GAUGE_CUTOUT_RADIUS}
              fill="black"
            />}
          </mask>
        </defs>
        <path
          data-testid="rag-gauge-track"
          className="rag-evaluation-gauge-arc"
          mask={`url(#${maskId})`}
          d={RAG_GAUGE_ARC_PATH}
          fill="none"
          stroke="rgba(60, 60, 67, 0.22)"
          strokeWidth={RAG_GAUGE_STROKE_WIDTH}
          strokeLinecap="round"
        />
        {marker && <circle
          data-testid="rag-gauge-marker"
          className="rag-evaluation-gauge-marker"
          cx={marker.x}
          cy={marker.y}
          r={RAG_GAUGE_DOT_RADIUS}
          fill="#7542b0"
        />}
        <text
          data-testid="rag-gauge-value"
          className="rag-evaluation-gauge-value"
          x={RAG_GAUGE_CENTER_X}
          y={RAG_GAUGE_SCORE_Y}
          dominantBaseline="central"
          textAnchor="middle"
        >{scoreText}</text>
        <text
          data-testid="rag-gauge-min"
          className="rag-evaluation-gauge-endpoint"
          x={RAG_GAUGE_MIN_LABEL_BASE_X + RAG_GAUGE_ENDPOINT_LABEL_INSET}
          y={RAG_GAUGE_ENDPOINT_LABEL_Y}
          dominantBaseline="central"
          textAnchor="start"
        >0</text>
        <text
          data-testid="rag-gauge-max"
          className="rag-evaluation-gauge-endpoint"
          x={RAG_GAUGE_MAX_LABEL_BASE_X - RAG_GAUGE_ENDPOINT_LABEL_INSET}
          y={RAG_GAUGE_ENDPOINT_LABEL_Y}
          dominantBaseline="central"
          textAnchor="end"
        >100</text>
      </svg>
    </span>
  </output>;
}
