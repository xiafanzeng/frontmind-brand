// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RAG_GAUGE_CUTOUT_RADIUS,
  RAG_GAUGE_DOT_RADIUS,
  RAG_GAUGE_STROKE_WIDTH,
  RAG_GAUGE_SWEEP_DEGREES,
  RagEvaluationGauge,
  ragGaugePoint,
} from "./RagEvaluationGauge";

afterEach(cleanup);

describe("approved RAG evaluation gauge", () => {
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

  it("keeps zero valid while refusing to turn missing or invalid values into a score", () => {
    const { rerender } = render(
      <RagEvaluationGauge score={0} />,
    );

    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("0");
    expect(screen.getByTestId("rag-gauge-marker")).toBeTruthy();
    expect(ragGaugePoint(0)).toEqual({ x: 30.56, y: 59, angle: 150 });
    expect(ragGaugePoint(100)).toEqual({ x: 89.44, y: 59, angle: 390 });

    for (const invalid of [null, Number.NaN, -1, 101]) {
      rerender(
        <RagEvaluationGauge score={invalid} />,
      );
      expect(screen.getByTestId("rag-gauge-value").textContent).toBe("—");
      expect(screen.queryByTestId("rag-gauge-marker")).toBeNull();
      expect(screen.queryByTestId("rag-gauge-cutout")).toBeNull();
    }
  });

  it("keeps a failed risk gate from presenting a misleading numeric score", () => {
    render(
      <RagEvaluationGauge score={83} unavailable />,
    );

    expect(screen.getByRole("img", { name: "重大问题，数值分不适用" })).toBeTruthy();
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("!");
    expect(screen.queryByTestId("rag-gauge-marker")).toBeNull();
  });
});
