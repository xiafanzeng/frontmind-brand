import type { CSSProperties, ReactNode, Ref } from "react";

export const EVALUATION_RADAR_VIEWBOX_WIDTH = 400;
export const EVALUATION_RADAR_VIEWBOX_HEIGHT = 368;
export const EVALUATION_RADAR_CENTER_X = 200;
export const EVALUATION_RADAR_CENTER_Y = 184;
export const EVALUATION_RADAR_INNER_RADIUS = 20;
export const EVALUATION_RADAR_OUTER_RADIUS = 100;
export const EVALUATION_RADAR_MIN_CONTROL_RADIUS = 42;
export const EVALUATION_RADAR_LABEL_RADIUS = 152;
export const EVALUATION_RADAR_GRID_RADII = [20, 40, 60, 80, 100] as const;

export type EvaluationRadarAxisState = "known" | "zero" | "pending" | "not-applicable" | "empty";

export type EvaluationRadarAxis = {
  id: string;
  label: string;
  normalizedScore: number | null;
  valueLabel: string;
  state: EvaluationRadarAxisState;
  disabled?: boolean;
};

export type EvaluationRadarPresentation = {
  classes: {
    root: string;
    chart: string;
    grid: string;
    axis: string;
    area: string;
    label: string;
    control: string;
    marker: string;
    centerCutout: string;
  };
  testIds: {
    root?: string;
    centerMask: string;
    area: string;
    label: string;
    control: string;
    marker: string;
  };
  labels: {
    root: string;
    title: string;
    description: (state: { complete: boolean; empty: boolean; axes: readonly EvaluationRadarAxis[] }) => string;
    control: (axis: EvaluationRadarAxis) => string;
  };
};

export type EvaluationRadarProps = {
  axes: readonly EvaluationRadarAxis[];
  presentation: EvaluationRadarPresentation;
  instanceId: string;
  maskId: string;
  detailId: string;
  progress?: number;
  reportRevealKey?: string;
  rootRef?: Ref<HTMLElement>;
  interactive?: boolean;
  selectedId?: string | null;
  onFinishReveal?: () => void;
  onSelectAxis?: (axisId: string) => void;
  details?: ReactNode;
};

function point(index: number, radius: number) {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  return [
    EVALUATION_RADAR_CENTER_X + Math.cos(angle) * radius,
    EVALUATION_RADAR_CENTER_Y + Math.sin(angle) * radius,
  ];
}

function isScored(axis: EvaluationRadarAxis) {
  return (axis.state === "known" || axis.state === "zero")
    && axis.normalizedScore !== null
    && Number.isFinite(axis.normalizedScore)
    && axis.normalizedScore >= 0
    && axis.normalizedScore <= 100;
}

function scoreRadius(axis: EvaluationRadarAxis) {
  const ratio = Math.min(1, Math.max(0, (axis.normalizedScore ?? 0) / 100));
  return EVALUATION_RADAR_INNER_RADIUS
    + (EVALUATION_RADAR_OUTER_RADIUS - EVALUATION_RADAR_INNER_RADIUS) * ratio;
}

/** Pure six-axis radar renderer. Domain adapters own labels, selection and detail data. */
export function EvaluationRadar({
  axes,
  presentation,
  instanceId,
  maskId,
  detailId,
  progress = 1,
  reportRevealKey = "",
  rootRef,
  interactive = true,
  selectedId = null,
  onFinishReveal,
  onSelectAxis,
  details,
}: EvaluationRadarProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const complete = axes.length === 6 && axes.every(isScored);
  const empty = axes.length > 0 && axes.every(axis => axis.state === "empty");
  const animatedRadius = (axis: EvaluationRadarAxis) => EVALUATION_RADAR_INNER_RADIUS
    + (scoreRadius(axis) - EVALUATION_RADAR_INNER_RADIUS) * clampedProgress;
  const values = axes.map((axis, index) => isScored(axis) ? point(index, animatedRadius(axis)) : null);
  const markerLayouts = axes.map((axis, index) => {
    const markerRadius = isScored(axis) ? animatedRadius(axis) : EVALUATION_RADAR_INNER_RADIUS;
    const controlRadius = Math.max(markerRadius, EVALUATION_RADAR_MIN_CONTROL_RADIUS);
    const markerPosition = point(index, markerRadius);
    const controlPosition = point(index, controlRadius);
    return {
      controlPosition,
      offsetX: markerPosition[0] - controlPosition[0],
      offsetY: markerPosition[1] - controlPosition[1],
    };
  });
  const innerPoints = axes.map((_, index) => point(index, EVALUATION_RADAR_INNER_RADIUS).join(",")).join(" ");

  return <section
    ref={rootRef}
    className={presentation.classes.root}
    aria-label={presentation.labels.root}
    data-testid={presentation.testIds.root}
    data-report-reveal-key={reportRevealKey || undefined}
  >
    <div className={presentation.classes.chart}>
      <svg viewBox={`0 0 ${EVALUATION_RADAR_VIEWBOX_WIDTH} ${EVALUATION_RADAR_VIEWBOX_HEIGHT}`} role="img" aria-labelledby={`${instanceId}-title ${instanceId}-description`}>
        <title id={`${instanceId}-title`}>{presentation.labels.title}</title>
        <desc id={`${instanceId}-description`}>{presentation.labels.description({ complete, empty, axes })}</desc>
        <defs>
          <mask id={maskId} data-testid={presentation.testIds.centerMask} maskUnits="userSpaceOnUse" x="0" y="0" width={EVALUATION_RADAR_VIEWBOX_WIDTH} height={EVALUATION_RADAR_VIEWBOX_HEIGHT}>
            <rect x="0" y="0" width={EVALUATION_RADAR_VIEWBOX_WIDTH} height={EVALUATION_RADAR_VIEWBOX_HEIGHT} fill="#fff" />
            <polygon className={presentation.classes.centerCutout} points={innerPoints} fill="#000" />
          </mask>
        </defs>
        {EVALUATION_RADAR_GRID_RADII.map(radius => <polygon key={radius} className={presentation.classes.grid} points={axes.map((_, index) => point(index, radius).join(",")).join(" ")} />)}
        {axes.map((_, index) => {
          const [x1, y1] = point(index, EVALUATION_RADAR_INNER_RADIUS);
          const [x2, y2] = point(index, EVALUATION_RADAR_OUTER_RADIUS);
          return <line key={index} className={presentation.classes.axis} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {complete && <polygon data-testid={presentation.testIds.area} className={presentation.classes.area} mask={`url(#${maskId})`} points={values.map(value => value!.join(",")).join(" ")} />}
      </svg>
      {axes.map((axis, index) => {
        const [x, y] = point(index, EVALUATION_RADAR_LABEL_RADIUS);
        return <div
          key={axis.id}
          data-testid={presentation.testIds.label}
          className={presentation.classes.label}
          aria-hidden="true"
          style={{ left: `${100 * x / EVALUATION_RADAR_VIEWBOX_WIDTH}%`, top: `${100 * y / EVALUATION_RADAR_VIEWBOX_HEIGHT}%` }}
        >
          <span>{axis.label}</span><strong>{axis.valueLabel}</strong>
        </div>;
      })}
      {axes.map((axis, index) => {
        const { controlPosition: [x, y], offsetX, offsetY } = markerLayouts[index];
        const style = {
          left: `${100 * x / EVALUATION_RADAR_VIEWBOX_WIDTH}%`,
          top: `${100 * y / EVALUATION_RADAR_VIEWBOX_HEIGHT}%`,
          "--rag-point-offset-x": `${offsetX}px`,
          "--rag-point-offset-y": `${offsetY}px`,
          "--rag-point-relative-x": `${100 * offsetX / EVALUATION_RADAR_VIEWBOX_WIDTH}cqw`,
          "--rag-point-relative-y": `${100 * offsetY / EVALUATION_RADAR_VIEWBOX_WIDTH}cqw`,
        } as CSSProperties;
        const marker = <span
          data-testid={presentation.testIds.marker}
          className={`${presentation.classes.marker} is-${axis.state}`}
          style={{ opacity: isScored(axis) ? clampedProgress : 1 }}
          aria-hidden="true"
        />;
        if (!interactive) {
          return <span key={axis.id} data-testid={presentation.testIds.control} className={`${presentation.classes.control} is-${axis.state}`} style={style} aria-hidden="true">{marker}</span>;
        }
        return <button
          key={axis.id}
          type="button"
          data-testid={presentation.testIds.control}
          className={`${presentation.classes.control} is-${axis.state}`}
          style={style}
          disabled={axis.disabled}
          aria-label={presentation.labels.control(axis)}
          aria-expanded={axis.disabled ? undefined : selectedId === axis.id}
          aria-controls={axis.disabled ? undefined : detailId}
          onPointerEnter={onFinishReveal}
          onPointerDown={event => event.currentTarget.setPointerCapture?.(event.pointerId)}
          onFocus={onFinishReveal}
          onClick={event => {
            onFinishReveal?.();
            onSelectAxis?.(axis.id);
            event.currentTarget.focus({ preventScroll: true });
          }}
        >{marker}</button>;
      })}
    </div>
    {details}
  </section>;
}
