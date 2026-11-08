// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvaluationRadar,
  type EvaluationRadarAxis,
  type EvaluationRadarPresentation,
} from "./EvaluationRadar";

afterEach(cleanup);

const presentation: EvaluationRadarPresentation = {
  classes: {
    root: "evaluation-radar",
    chart: "evaluation-radar__chart",
    grid: "evaluation-radar__grid",
    axis: "evaluation-radar__axis",
    area: "evaluation-radar__area",
    label: "evaluation-radar__label",
    control: "evaluation-radar__control",
    marker: "evaluation-radar__marker",
    centerCutout: "evaluation-radar__cutout",
  },
  testIds: {
    root: "evaluation-radar",
    centerMask: "evaluation-radar-mask",
    area: "evaluation-radar-area",
    label: "evaluation-radar-label",
    control: "evaluation-radar-control",
    marker: "evaluation-radar-marker",
  },
  labels: {
    root: "共享六维评分",
    title: "共享六维雷达图",
    description: ({ complete, empty }) => empty ? "暂无评分" : complete ? "完整评分" : "部分评分",
    control: axis => `${axis.label} ${axis.valueLabel}`,
  },
};

const axes = (): EvaluationRadarAxis[] => [
  ["task", "访客任务", 0],
  ["brand", "品牌一致性", 20],
  ["facts", "事实与证据", 40],
  ["ia", "信息架构", 60],
  ["visual", "视觉与可用性", 80],
  ["assistant", "助手与边界", 100],
].map(([id, label, score]) => ({
  id: String(id),
  label: String(label),
  normalizedScore: Number(score),
  valueLabel: `${score}%`,
  state: Number(score) === 0 ? "zero" : "known",
}));

function radar(overrides: Partial<Parameters<typeof EvaluationRadar>[0]> = {}) {
  return <EvaluationRadar
    axes={axes()}
    presentation={presentation}
    instanceId="evaluation-radar-instance"
    maskId="evaluation-radar-mask-id"
    detailId="evaluation-radar-detail"
    {...overrides}
  />;
}

describe("EvaluationRadar primitive", () => {
  it("renders configured six-axis semantics without changing normalized geometry", () => {
    render(radar());

    const image = screen.getByRole("img", { name: "共享六维雷达图 完整评分" });
    expect(image.getAttribute("viewBox")).toBe("0 0 400 368");
    expect(image.querySelectorAll(".evaluation-radar__grid")).toHaveLength(5);
    expect(image.querySelectorAll(".evaluation-radar__axis")).toHaveLength(6);
    expect(screen.getByTestId("evaluation-radar-area")).toBeTruthy();
    expect(screen.getAllByTestId("evaluation-radar-label")).toHaveLength(6);
    expect(screen.getAllByTestId("evaluation-radar-control")).toHaveLength(6);
  });

  it("keeps six true zero scores on distinct inner-ring vertices", () => {
    const zeroAxes = axes().map(axis => ({ ...axis, normalizedScore: 0, valueLabel: "0%", state: "zero" as const }));
    render(radar({ axes: zeroAxes }));

    const controls = screen.getAllByTestId("evaluation-radar-control");
    expect(new Set(controls.map(control => `${control.style.left}:${control.style.top}`)).size).toBe(6);
    expect(controls.every(control => control.querySelector(".evaluation-radar__marker")?.classList.contains("is-zero"))).toBe(true);
    expect(controls.every(control => !(control.style.left === "50%" && control.style.top === "50%"))).toBe(true);
    expect(screen.getByTestId("evaluation-radar-area")).toBeTruthy();
  });

  it("does not fill incomplete data and supports a non-interactive chart", () => {
    const incomplete = axes();
    incomplete[2] = { ...incomplete[2], normalizedScore: null, valueLabel: "待核验", state: "pending" };
    const view = render(radar({ axes: incomplete, interactive: false }));

    expect(screen.queryByTestId("evaluation-radar-area")).toBeNull();
    expect(screen.getByRole("img", { name: "共享六维雷达图 部分评分" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(view.container.querySelectorAll(".evaluation-radar__control")).toHaveLength(6);
  });

  it("delegates selection while preserving accessible expansion coordinates", () => {
    const onFinishReveal = vi.fn();
    const onSelectAxis = vi.fn();
    render(radar({
      selectedId: "brand",
      onFinishReveal,
      onSelectAxis,
      details: <section id="evaluation-radar-detail">详情</section>,
    }));

    const control = screen.getByRole("button", { name: "品牌一致性 20%" });
    const capturePointer = vi.fn();
    Object.defineProperty(control, "setPointerCapture", { configurable: true, value: capturePointer });
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.getAttribute("aria-controls")).toBe("evaluation-radar-detail");
    fireEvent.pointerDown(control, { pointerId: 7 });
    expect(capturePointer).toHaveBeenCalledOnce();
    control.focus();
    fireEvent.click(control);
    expect(onFinishReveal).toHaveBeenCalledTimes(2);
    expect(onSelectAxis).toHaveBeenCalledWith("brand");
    expect(document.activeElement).toBe(control);
  });
});
