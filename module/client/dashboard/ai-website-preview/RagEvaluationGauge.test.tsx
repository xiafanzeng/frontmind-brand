// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RAG_GAUGE_CUTOUT_RADIUS,
  RAG_GAUGE_DOT_RADIUS,
  RAG_GAUGE_RENDERED_WIDTH,
  RAG_GAUGE_STROKE_WIDTH,
  RAG_GAUGE_SWEEP_DEGREES,
  RAG_GAUGE_VIEWBOX_WIDTH,
  RagEvaluationGauge,
  ragGaugePoint,
} from "./RagEvaluationGauge";

// jsdom has no PointerEvent; retain pointerType so touch and mouse tests exercise distinct paths.
beforeAll(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  });
});
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

describe("approved RAG evaluation gauge", () => {
  it("marks a missing score with a decorative gray start point, not a zero score or tooltip", () => {
    const view = render(<RagEvaluationGauge score={null} />);
    expect(screen.getByTestId("rag-evaluation-score").classList.contains("is-empty")).toBe(true);
    expect(screen.queryByTestId("rag-gauge-empty-symbol")).toBeNull();
    expect(screen.queryByTestId("rag-gauge-value")).toBeNull();
    const pending = screen.getByTestId("rag-gauge-pending");
    expect(pending.textContent).toBe("N/A");
    expect(pending.getAttribute("x")).toBe("60");
    expect(pending.getAttribute("y")).toBe("41");
    expect(pending.getAttribute("aria-hidden")).toBe("true");
    const marker = screen.getByTestId("rag-gauge-marker");
    expect(marker.classList.contains("is-pending")).toBe(true);
    expect(marker.getAttribute("fill")).toBe("#aeaeb2");
    expect(marker.getAttribute("cx")).toBe(String(ragGaugePoint(0).x));
    expect(marker.getAttribute("cy")).toBe(String(ragGaugePoint(0).y));
    expect(screen.getByTestId("rag-gauge-cutout").getAttribute("cx")).toBe(marker.getAttribute("cx"));
    expect(screen.queryByRole("button")).toBeNull();
    const graphic = screen.getByRole("img", { name: "六维诊断分待评估，量程 0 至 100；灰色圆点位于量程起点，不代表零分" });
    expect(graphic.querySelectorAll("text")).toHaveLength(3); // N/A and the endpoint labels.
    expect(graphic.querySelectorAll("circle")).toHaveLength(2); // Track cutout and decorative marker.
    view.rerender(<RagEvaluationGauge score={0} />);
    expect(screen.getByTestId("rag-evaluation-score").classList.contains("is-empty")).toBe(false);
    expect(screen.queryByTestId("rag-gauge-empty-symbol")).toBeNull();
    expect(screen.queryByTestId("rag-gauge-pending")).toBeNull();
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("0");
    expect(screen.getByTestId("rag-gauge-marker").classList.contains("is-pending")).toBe(false);
    expect(screen.getByTestId("rag-gauge-marker").getAttribute("fill")).toBe("#7542b0");
    expect(screen.getByRole("button", { name: "具体分值 0.00 分" })).toBeTruthy();
    view.rerender(<RagEvaluationGauge score={null} unavailable />);
    expect(screen.getByTestId("rag-evaluation-score").classList.contains("is-empty")).toBe(false);
    expect(screen.getByTestId("rag-evaluation-score").classList.contains("is-muted")).toBe(true);
    expect(screen.getByTestId("rag-gauge-pending").textContent).toBe("N/A");
    expect(screen.queryByTestId("rag-gauge-value")).toBeNull();
    expect(screen.getByTestId("rag-gauge-marker").classList.contains("is-pending")).toBe(false);
    expect(screen.getByTestId("rag-gauge-marker").classList.contains("is-unavailable")).toBe(true);
    expect(screen.getByTestId("rag-gauge-marker").getAttribute("fill")).toBe("#aeaeb2");
    expect(screen.getByRole("button", { name: "评分不适用" })).toBeTruthy();
  });
  it("keeps the accepted 240 degree geometry and the 67 marker on the true score position", () => {
    render(
      <RagEvaluationGauge score={67} />,
    );

    expect(RAG_GAUGE_SWEEP_DEGREES).toBe(240);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("img", { name: /六维诊断分 67/ })).toBeTruthy();

    const track = screen.getByTestId("rag-gauge-track");
    expect(track.getAttribute("d")).toBe("M30.56 59 A34 34 0 1 1 89.44 59");
    expect(track.getAttribute("stroke-width")).toBe(String(RAG_GAUGE_STROKE_WIDTH));
    expect(track.getAttribute("stroke-linecap")).toBe("round");

    const expected = ragGaugePoint(67);
    expect(expected).toEqual({ x: 82.22, y: 16.26, angle: 310.8 });

    const marker = screen.getByTestId("rag-gauge-marker");
    const cutout = screen.getByTestId("rag-gauge-cutout");
    expect(marker.getAttribute("r")).toBe(String(RAG_GAUGE_DOT_RADIUS));
    expect(cutout.getAttribute("r")).toBe(String(RAG_GAUGE_CUTOUT_RADIUS));
    expect(marker.getAttribute("cx")).toBe("82.22");
    expect(marker.getAttribute("cy")).toBe("16.26");
    expect(cutout.getAttribute("cx")).toBe(marker.getAttribute("cx"));
    expect(cutout.getAttribute("cy")).toBe(marker.getAttribute("cy"));
  });

  it("moves the score up one SVG unit and shortens the endpoint-label spacing symmetrically", () => {
    render(
      <RagEvaluationGauge score={67} />,
    );

    expect(screen.getByTestId("rag-gauge-value").getAttribute("y")).toBe("41");
    expect(screen.getByTestId("rag-gauge-min").getAttribute("x")).toBe("38.19");
    expect(screen.getByTestId("rag-gauge-max").getAttribute("x")).toBe("81.81");
  });

  it("displays a conservative whole-number score while keeping the marker on the exact value", () => {
    const { rerender } = render(
      <RagEvaluationGauge score={98.5} />,
    );

    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("98");
    expect(screen.getByRole("img", { name: /六维诊断分 98，/ })).toBeTruthy();

    const exactPoint = ragGaugePoint(98.5);
    const marker = screen.getByTestId("rag-gauge-marker");
    expect(marker.getAttribute("cx")).toBe(String(exactPoint.x));
    expect(marker.getAttribute("cy")).toBe(String(exactPoint.y));

    rerender(<RagEvaluationGauge score={99.99} />);
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("99");

    rerender(<RagEvaluationGauge score={100} />);
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("100");
  });

  it("reveals two decimal places on hover and focus without changing the integer display", () => {
    render(<RagEvaluationGauge score={98.5} />);

    const control = screen.getByRole("button", { name: "具体分值 98.50 分" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.hasAttribute("aria-describedby")).toBe(false);

    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("98.50");
    expect(control.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("98");
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(true);

    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.hasAttribute("aria-describedby")).toBe(false);
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);

    fireEvent.focus(control);
    expect(screen.getByRole("tooltip").textContent).toBe("98.50");
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("98.50");
    fireEvent.blur(control);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);
  });

  it("prevents pointer clicks from keeping the hovered marker active after the mouse leaves", () => {
    render(<RagEvaluationGauge score={98.5} />);
    const control = screen.getByRole("button", { name: "具体分值 98.50 分" });

    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("98.50");
    expect(fireEvent.pointerDown(control, { pointerType: "mouse", cancelable: true })).toBe(false);
    fireEvent.pointerUp(control, { pointerType: "mouse" });
    fireEvent.click(control);
    expect(document.activeElement).not.toBe(control);
    expect(screen.getByRole("tooltip").textContent).toBe("98.50");

    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);
    expect(control.hasAttribute("aria-describedby")).toBe(false);
  });

  it("releases existing keyboard focus on pointer down without disabling later keyboard focus", () => {
    render(<RagEvaluationGauge score={67} />);
    const control = screen.getByRole("button", { name: "具体分值 67.00 分" });

    act(() => control.focus());
    expect(document.activeElement).toBe(control);
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(fireEvent.pointerDown(control, { pointerType: "mouse", cancelable: true })).toBe(false);
    expect(document.activeElement).not.toBe(control);
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);

    act(() => control.focus());
    expect(document.activeElement).toBe(control);
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
    act(() => control.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not show or retain a tooltip for touch pointers, including after prior mouse hover", () => {
    render(<RagEvaluationGauge score={67} />);
    const control = screen.getByRole("button", { name: "具体分值 67.00 分" });

    fireEvent.pointerEnter(control, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(fireEvent.pointerDown(control, { pointerType: "touch", cancelable: true })).toBe(false);
    fireEvent.pointerUp(control, { pointerType: "touch" });
    fireEvent.click(control);
    expect(document.activeElement).not.toBe(control);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
    fireEvent.pointerDown(control, { pointerType: "touch", cancelable: true });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);
  });

  it("uses the unrounded score for the marker and tooltip while preserving the supplied display score", () => {
    render(<RagEvaluationGauge score={84} preciseScore={83.75} />);

    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("84");
    expect(screen.getByRole("img", { name: /六维诊断分 84，/ })).toBeTruthy();
    const exactPoint = ragGaugePoint(83.75);
    const marker = screen.getByTestId("rag-gauge-marker");
    expect(marker.getAttribute("cx")).toBe(String(exactPoint.x));
    expect(marker.getAttribute("cy")).toBe(String(exactPoint.y));

    fireEvent.pointerEnter(screen.getByRole("button", { name: "具体分值 83.75 分" }), { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("83.75");
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("84");
  });

  it("dismisses an active tooltip with Escape and releases keyboard focus", () => {
    render(<RagEvaluationGauge score={67} />);
    const control = screen.getByRole("button", { name: "具体分值 67.00 分" });
    act(() => control.focus());
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(document.activeElement).toBe(control);
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");

    fireEvent.keyDown(control, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).not.toBe(control);
    expect(control.hasAttribute("aria-describedby")).toBe(false);
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);

    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("67.00");
  });

  it("clears active interaction when the score becomes missing", () => {
    const { rerender } = render(<RagEvaluationGauge score={84} preciseScore={83.75} />);
    const control = screen.getByRole("button", { name: "具体分值 83.75 分" });
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    fireEvent.focus(control);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(<RagEvaluationGauge score={null} preciseScore={83.75} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(<RagEvaluationGauge score={84} preciseScore={83.75} />);
    const restoredControl = screen.getByRole("button", { name: "具体分值 83.75 分" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(restoredControl.parentElement?.classList.contains("is-marker-active")).toBe(false);
    fireEvent.focus(restoredControl);
    expect(screen.getByRole("tooltip").textContent).toBe("83.75");
  });

  it("clears active interaction when switching between a score and an inapplicable rating", () => {
    const { rerender } = render(<RagEvaluationGauge score={84} preciseScore={83.75} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "具体分值 83.75 分" }), { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("83.75");

    rerender(<RagEvaluationGauge score={84} preciseScore={83.75} unavailable />);
    const unavailableControl = screen.getByRole("button", { name: "评分不适用" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(unavailableControl, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("评分不适用");

    rerender(<RagEvaluationGauge score={84} preciseScore={83.75} />);
    const restoredControl = screen.getByRole("button", { name: "具体分值 83.75 分" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(restoredControl.parentElement?.classList.contains("is-marker-active")).toBe(false);
    fireEvent.pointerEnter(restoredControl, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("83.75");
  });

  it("reduces the previous clearance by one rendered pixel on both sides and preserves it when the marker grows", () => {
    render(<RagEvaluationGauge score={50} />);

    const marker = screen.getByTestId("rag-gauge-marker");
    const cutout = screen.getByTestId("rag-gauge-cutout");
    const pixelsPerUnit = RAG_GAUGE_RENDERED_WIDTH / RAG_GAUGE_VIEWBOX_WIDTH;
    const previousCutoutRadius = 8 + 0.5 * RAG_GAUGE_VIEWBOX_WIDTH / RAG_GAUGE_RENDERED_WIDTH;
    const previousGap = (previousCutoutRadius - RAG_GAUGE_DOT_RADIUS) * pixelsPerUnit;
    const gapOnBothSides = (markerScale: number) => {
      const markerX = Number(marker.getAttribute("cx"));
      const cutoutX = Number(cutout.getAttribute("cx"));
      const markerRadius = Number(marker.getAttribute("r")) * markerScale;
      const cutoutRadius = Number(cutout.getAttribute("r"));
      expect(cutout.getAttribute("cy")).toBe(marker.getAttribute("cy"));
      return [
        (markerX - markerRadius - (cutoutX - cutoutRadius)) * pixelsPerUnit,
        (cutoutX + cutoutRadius - (markerX + markerRadius)) * pixelsPerUnit,
      ];
    };

    for (const gap of gapOnBothSides(1)) expect(previousGap - gap).toBeCloseTo(1, 10);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "具体分值 50.00 分" }), { pointerType: "mouse" });
    expect(Number(cutout.getAttribute("r"))).toBeGreaterThan(RAG_GAUGE_CUTOUT_RADIUS);
    for (const gap of gapOnBothSides(1.35)) expect(previousGap - gap).toBeCloseTo(1, 10);
    fireEvent.pointerLeave(screen.getByRole("button", { name: "具体分值 50.00 分" }), { pointerType: "mouse" });
    expect(Number(cutout.getAttribute("r"))).toBe(RAG_GAUGE_CUTOUT_RADIUS);
  });

  it.each([0, 100])("allows the valid endpoint %s to reveal its precise score", (score) => {
    render(<RagEvaluationGauge score={score} />);

    expect(screen.getByTestId("rag-gauge-value").textContent).toBe(String(score));
    const control = screen.getByRole("button", { name: `具体分值 ${score.toFixed(2)} 分` });
    fireEvent.focus(control);
    expect(screen.getByRole("tooltip").textContent).toBe(score.toFixed(2));
    fireEvent.blur(control);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps zero valid while refusing to turn missing or invalid values into a score", () => {
    const { rerender } = render(
      <RagEvaluationGauge score={0} />,
    );

    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("0");
    expect(screen.getByTestId("rag-gauge-marker")).toBeTruthy();
    expect(ragGaugePoint(0)).toEqual({ x: 30.56, y: 59, angle: 150 });
    expect(ragGaugePoint(100)).toEqual({ x: 89.44, y: 59, angle: 390 });

    for (const invalid of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 101]) {
      rerender(
        <RagEvaluationGauge score={invalid} />,
      );
      expect(screen.queryByTestId("rag-gauge-empty-symbol")).toBeNull();
      expect(screen.queryByTestId("rag-gauge-value")).toBeNull();
      expect(screen.getByTestId("rag-gauge-pending").textContent).toBe("N/A");
      expect(screen.getByTestId("rag-gauge-marker").classList.contains("is-pending")).toBe(true);
      expect(screen.getByTestId("rag-gauge-marker").getAttribute("fill")).toBe("#aeaeb2");
      expect(screen.getByTestId("rag-gauge-cutout")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("tooltip")).toBeNull();
    }
  });

  it.each([83, 0, null])("shows an interactive zero-position marker when risk makes the score inapplicable (%s)", (score) => {
    render(<RagEvaluationGauge score={score} unavailable />);

    expect(screen.getByRole("img", { name: "重大问题，评分不适用；灰色圆点位于量程起点，不代表数值分" })).toBeTruthy();
    expect(screen.getByTestId("rag-gauge-pending").textContent).toBe("N/A");
    expect(screen.queryByTestId("rag-gauge-value")).toBeNull();
    const marker = screen.getByTestId("rag-gauge-marker");
    expect(marker.classList.contains("is-unavailable")).toBe(true);
    expect(marker.getAttribute("fill")).toBe("#aeaeb2");
    const cutout = screen.getByTestId("rag-gauge-cutout");
    const origin = ragGaugePoint(0);
    expect(marker.getAttribute("cx")).toBe(String(origin.x));
    expect(marker.getAttribute("cy")).toBe(String(origin.y));
    expect(cutout.getAttribute("cx")).toBe(marker.getAttribute("cx"));
    expect(cutout.getAttribute("cy")).toBe(marker.getAttribute("cy"));

    const control = screen.getByRole("button", { name: "评分不适用" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("评分不适用");
    expect(control.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(true);
    expect(fireEvent.pointerDown(control, { pointerType: "mouse", cancelable: true })).toBe(false);
    fireEvent.pointerUp(control, { pointerType: "mouse" });
    fireEvent.click(control);
    expect(document.activeElement).not.toBe(control);
    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(control.parentElement?.classList.contains("is-marker-active")).toBe(false);

    act(() => control.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("评分不适用");
    act(() => control.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
