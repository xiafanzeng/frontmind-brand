import type {
  FocusEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
  Ref,
} from "react";

export const EVALUATION_GAUGE_VIEWBOX_WIDTH = 120;
export const EVALUATION_GAUGE_VIEWBOX_HEIGHT = 80;
export const EVALUATION_GAUGE_CENTER_X = 60;
export const EVALUATION_GAUGE_CENTER_Y = 42;
export const EVALUATION_GAUGE_RADIUS = 34;
export const EVALUATION_GAUGE_START_ANGLE = 150;
export const EVALUATION_GAUGE_SWEEP_DEGREES = 240;
export const EVALUATION_GAUGE_STROKE_WIDTH = 9;
export const EVALUATION_GAUGE_DOT_RADIUS = 4.5;
export const EVALUATION_GAUGE_ACTIVE_DOT_SCALE = 1.35;
export const EVALUATION_GAUGE_RENDERED_WIDTH = 152;
export const EVALUATION_GAUGE_CUTOUT_RADIUS = 8 - 0.5 * EVALUATION_GAUGE_VIEWBOX_WIDTH / EVALUATION_GAUGE_RENDERED_WIDTH;
export const EVALUATION_GAUGE_DOT_GAP = EVALUATION_GAUGE_CUTOUT_RADIUS - EVALUATION_GAUGE_DOT_RADIUS;
export const EVALUATION_GAUGE_SCORE_Y = EVALUATION_GAUGE_CENTER_Y - 1;
export const EVALUATION_GAUGE_ENDPOINT_LABEL_INSET = 0.5;

const EVALUATION_GAUGE_MIN_LABEL_BASE_X = 37.69;
const EVALUATION_GAUGE_MAX_LABEL_BASE_X = 82.31;
const EVALUATION_GAUGE_ENDPOINT_LABEL_Y = 67.66;
const EVALUATION_GAUGE_ARC_PATH = "M30.56 59 A34 34 0 1 1 89.44 59";

export type EvaluationGaugeState =
  | { kind: "score"; score: number; preciseScore?: number | null }
  | { kind: "pending" }
  | { kind: "unavailable" };

export type EvaluationGaugePresentation = {
  classes: {
    root: string;
    graphic: string;
    arc: string;
    marker: string;
    value: string;
    endpoint: string;
    control: string;
    tooltip: string;
    danger: string;
    muted: string;
    empty: string;
    pending: string;
    unavailable: string;
    markerActive: string;
  };
  testIds: {
    root: string;
    cutout: string;
    track: string;
    marker: string;
    value: string;
    minimum: string;
    maximum: string;
  };
  colors: {
    track: string;
    marker: string;
    mutedMarker: string;
  };
  labels: {
    root: string;
    scoreImage: (score: string) => string;
    pendingImage: string;
    unavailableImage: string;
    scoreControl: (score: string) => string;
    unavailableControl: string;
  };
};

export type EvaluationGaugeProps = {
  state: EvaluationGaugeState;
  presentation: EvaluationGaugePresentation;
  rootAriaLabel?: string;
  progress?: number;
  reportRevealKey?: string;
  rootRef?: Ref<HTMLOutputElement>;
  maskId: string;
  tooltipId: string;
  markerActive?: boolean;
  interactive?: boolean;
  onMarkerPointerEnter?: PointerEventHandler<HTMLButtonElement>;
  onMarkerPointerLeave?: PointerEventHandler<HTMLButtonElement>;
  onMarkerPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onMarkerFocus?: FocusEventHandler<HTMLButtonElement>;
  onMarkerBlur?: FocusEventHandler<HTMLButtonElement>;
  onMarkerKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
};

const roundGeometry = (value: number) => Number(value.toFixed(2));

export function evaluationGaugePoint(score: number) {
  const angle = EVALUATION_GAUGE_START_ANGLE + score / 100 * EVALUATION_GAUGE_SWEEP_DEGREES;
  const radians = angle * Math.PI / 180;
  return {
    x: roundGeometry(EVALUATION_GAUGE_CENTER_X + Math.cos(radians) * EVALUATION_GAUGE_RADIUS),
    y: roundGeometry(EVALUATION_GAUGE_CENTER_Y + Math.sin(radians) * EVALUATION_GAUGE_RADIUS),
    angle: roundGeometry(angle),
  };
}

export function isEvaluationGaugeScore(score: number | null | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
}

function formatScore(score: number) {
  return Math.floor(score).toString();
}

/**
 * Evaluation-agnostic gauge renderer. Evaluation ownership, reveal timing and
 * interaction state remain with the consumer so RAG and Website can share the
 * geometry without sharing lifecycle semantics.
 */
export function EvaluationGauge({
  state,
  presentation,
  rootAriaLabel,
  progress = 1,
  reportRevealKey = "",
  rootRef,
  maskId,
  tooltipId,
  markerActive = false,
  interactive = true,
  onMarkerPointerEnter,
  onMarkerPointerLeave,
  onMarkerPointerDown,
  onMarkerFocus,
  onMarkerBlur,
  onMarkerKeyDown,
}: EvaluationGaugeProps) {
  const unavailable = state.kind === "unavailable";
  const valid = state.kind === "score" && isEvaluationGaugeScore(state.score);
  const pending = !unavailable && !valid;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const exactScore = valid && isEvaluationGaugeScore(state.preciseScore)
    ? state.preciseScore
    : valid
      ? state.score
      : null;
  const marker = unavailable || pending
    ? evaluationGaugePoint(0)
    : exactScore !== null
      ? evaluationGaugePoint(exactScore * clampedProgress)
      : null;
  const scoreText = valid ? formatScore(state.score * clampedProgress) : "—";
  const finalScoreText = valid ? formatScore(state.score) : "—";
  const markerText = unavailable ? presentation.labels.unavailableControl : exactScore !== null ? exactScore.toFixed(2) : null;
  const gaugeLabel = unavailable
    ? presentation.labels.unavailableImage
    : valid
      ? presentation.labels.scoreImage(finalScoreText)
      : presentation.labels.pendingImage;
  const rootStateClasses = unavailable
    ? ` ${presentation.classes.danger} ${presentation.classes.muted}`
    : valid
      ? ""
      : ` ${presentation.classes.empty} ${presentation.classes.muted}`;
  const markerStateClass = pending
    ? ` ${presentation.classes.pending}`
    : unavailable
      ? ` ${presentation.classes.unavailable}`
      : "";
  const markerRadius = EVALUATION_GAUGE_DOT_RADIUS * (markerActive ? EVALUATION_GAUGE_ACTIVE_DOT_SCALE : 1);

  return <output
    ref={rootRef}
    data-testid={presentation.testIds.root}
    data-report-reveal-key={reportRevealKey || undefined}
    className={`${presentation.classes.root}${rootStateClasses}`}
    aria-label={rootAriaLabel ?? presentation.labels.root}
    aria-live={clampedProgress < 1 ? "off" : "polite"}
  >
    <span className={`${presentation.classes.graphic}${markerActive ? ` ${presentation.classes.markerActive}` : ""}`}>
      <svg
        viewBox={`0 0 ${EVALUATION_GAUGE_VIEWBOX_WIDTH} ${EVALUATION_GAUGE_VIEWBOX_HEIGHT}`}
        role="img"
        aria-label={gaugeLabel}
      >
        <defs>
          <mask id={maskId}>
            <rect width={EVALUATION_GAUGE_VIEWBOX_WIDTH} height={EVALUATION_GAUGE_VIEWBOX_HEIGHT} fill="white" />
            {marker && <circle
              data-testid={presentation.testIds.cutout}
              cx={marker.x}
              cy={marker.y}
              r={EVALUATION_GAUGE_CUTOUT_RADIUS + (markerActive ? EVALUATION_GAUGE_DOT_RADIUS * 0.35 : 0)}
              fill="black"
            />}
          </mask>
        </defs>
        <path
          data-testid={presentation.testIds.track}
          className={presentation.classes.arc}
          mask={`url(#${maskId})`}
          d={EVALUATION_GAUGE_ARC_PATH}
          fill="none"
          stroke={presentation.colors.track}
          strokeWidth={EVALUATION_GAUGE_STROKE_WIDTH}
          strokeLinecap="round"
        />
        {marker && <circle
          data-testid={presentation.testIds.marker}
          className={`${presentation.classes.marker}${markerStateClass}`}
          cx={marker.x}
          cy={marker.y}
          r={markerRadius}
          fill={pending || unavailable ? presentation.colors.mutedMarker : presentation.colors.marker}
        />}
        {valid && <text
          data-testid={presentation.testIds.value}
          className={presentation.classes.value}
          x={EVALUATION_GAUGE_CENTER_X}
          y={EVALUATION_GAUGE_SCORE_Y}
          dominantBaseline="central"
          textAnchor="middle"
        >{scoreText}</text>}
        <text
          data-testid={presentation.testIds.minimum}
          className={presentation.classes.endpoint}
          x={EVALUATION_GAUGE_MIN_LABEL_BASE_X + EVALUATION_GAUGE_ENDPOINT_LABEL_INSET}
          y={EVALUATION_GAUGE_ENDPOINT_LABEL_Y}
          dominantBaseline="central"
          textAnchor="start"
        >0</text>
        <text
          data-testid={presentation.testIds.maximum}
          className={presentation.classes.endpoint}
          x={EVALUATION_GAUGE_MAX_LABEL_BASE_X - EVALUATION_GAUGE_ENDPOINT_LABEL_INSET}
          y={EVALUATION_GAUGE_ENDPOINT_LABEL_Y}
          dominantBaseline="central"
          textAnchor="end"
        >100</text>
      </svg>
      {interactive && marker && markerText !== null && <button
        type="button"
        className={presentation.classes.control}
        aria-label={unavailable ? presentation.labels.unavailableControl : presentation.labels.scoreControl(markerText)}
        aria-describedby={markerActive ? tooltipId : undefined}
        style={{ left: `${marker.x / EVALUATION_GAUGE_VIEWBOX_WIDTH * 100}%`, top: `${marker.y / EVALUATION_GAUGE_VIEWBOX_HEIGHT * 100}%` }}
        onPointerEnter={onMarkerPointerEnter}
        onPointerLeave={onMarkerPointerLeave}
        onFocus={onMarkerFocus}
        onBlur={onMarkerBlur}
        onPointerDown={onMarkerPointerDown}
        onKeyDown={onMarkerKeyDown}
      >
        {markerActive && <span id={tooltipId} role="tooltip" className={presentation.classes.tooltip}>{markerText}</span>}
      </button>}
    </span>
  </output>;
}
