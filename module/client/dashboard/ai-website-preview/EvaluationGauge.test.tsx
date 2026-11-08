// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVALUATION_GAUGE_CUTOUT_RADIUS,
  EVALUATION_GAUGE_ACTIVE_DOT_SCALE,
  EVALUATION_GAUGE_DOT_RADIUS,
  EvaluationGauge,
  evaluationGaugePoint,
  type EvaluationGaugePresentation,
} from "./EvaluationGauge";

afterEach(cleanup);

const presentation: EvaluationGaugePresentation = {
  classes: {
    root: "evaluation-gauge",
    graphic: "evaluation-gauge__graphic",
    arc: "evaluation-gauge__arc",
    marker: "evaluation-gauge__marker",
    value: "evaluation-gauge__value",
    endpoint: "evaluation-gauge__endpoint",
    control: "evaluation-gauge__control",
    tooltip: "evaluation-gauge__tooltip",
    danger: "is-danger",
    muted: "is-muted",
    empty: "is-empty",
    pending: "is-pending",
    unavailable: "is-unavailable",
    markerActive: "is-marker-active",
  },
  testIds: {
    root: "evaluation-score",
    cutout: "evaluation-cutout",
    track: "evaluation-track",
    marker: "evaluation-marker",
    value: "evaluation-value",
    minimum: "evaluation-minimum",
    maximum: "evaluation-maximum",
  },
  colors: {
    track: "#ddd",
    marker: "#123456",
    mutedMarker: "#999",
  },
  labels: {
    root: "共享评分仪表",
    scoreImage: score => `当前分数 ${score}`,
    pendingImage: "分数待评估",
    unavailableImage: "分数不适用",
    scoreControl: score => `精确分数 ${score}`,
    unavailableControl: "评分不适用",
  },
};

function gauge(overrides: Partial<Parameters<typeof EvaluationGauge>[0]> = {}) {
  return <EvaluationGauge
    state={{ kind: "score", score: 0 }}
    presentation={presentation}
    maskId="evaluation-mask"
    tooltipId="evaluation-tooltip"
    {...overrides}
  />;
}

describe("EvaluationGauge primitive", () => {
  it("keeps a real zero distinct from pending and uses configured semantics", () => {
    const view = render(gauge());

    expect(screen.getByTestId("evaluation-score").getAttribute("aria-label")).toBe("共享评分仪表");
    expect(screen.getByRole("img", { name: "当前分数 0" })).toBeTruthy();
    expect(screen.getByTestId("evaluation-value").textContent).toBe("0");
    expect(screen.getByTestId("evaluation-marker").getAttribute("fill")).toBe("#123456");
    expect(screen.getByRole("button", { name: "精确分数 0.00" })).toBeTruthy();

    view.rerender(gauge({ state: { kind: "pending" } }));
    expect(screen.getByRole("img", { name: "分数待评估" })).toBeTruthy();
    expect(screen.queryByTestId("evaluation-value")).toBeNull();
    expect(screen.getByTestId("evaluation-marker").classList.contains("is-pending")).toBe(true);
    expect(screen.getByTestId("evaluation-marker").getAttribute("fill")).toBe("#999");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders exact marker progress and delegates interaction ownership", () => {
    const onFocus = vi.fn();
    const expected = evaluationGaugePoint(37.5);
    render(gauge({
      state: { kind: "score", score: 75, preciseScore: 75 },
      progress: 0.5,
      markerActive: true,
      onMarkerFocus: onFocus,
    }));

    const marker = screen.getByTestId("evaluation-marker");
    expect(marker.getAttribute("cx")).toBe(String(expected.x));
    expect(marker.getAttribute("cy")).toBe(String(expected.y));
    expect(marker.getAttribute("r")).toBe(String(EVALUATION_GAUGE_DOT_RADIUS * EVALUATION_GAUGE_ACTIVE_DOT_SCALE));
    expect(screen.getByTestId("evaluation-value").textContent).toBe("37");
    expect(screen.getByTestId("evaluation-cutout").getAttribute("r")).toBe(String(EVALUATION_GAUGE_CUTOUT_RADIUS + EVALUATION_GAUGE_DOT_RADIUS * 0.35));
    expect(screen.getByRole("tooltip").textContent).toBe("75.00");
    screen.getByRole("button", { name: "精确分数 75.00" }).focus();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("supports a static non-interactive presentation without inventing controls", () => {
    render(gauge({
      state: { kind: "score", score: 100 },
      interactive: false,
      reportRevealKey: "report-1",
    }));

    expect(screen.getByTestId("evaluation-score").getAttribute("data-report-reveal-key")).toBe("report-1");
    expect(screen.getByTestId("evaluation-value").textContent).toBe("100");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
