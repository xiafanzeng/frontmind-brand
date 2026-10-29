// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RagEvaluationRadar } from "./RagEvaluationRadar";
import { RAG_DIMENSIONS } from "./rag-evaluation";
import type { EvaluationDimension } from "./evaluation-skill-contract";

afterEach(cleanup);

const dimensions = (): EvaluationDimension[] => RAG_DIMENSIONS.map(d => ({
  id: d.id,
  label: d.label,
  score: d.weight * .9,
  maxScore: d.weight,
  status: "partial",
  summary: "明确缺陷及对应影响",
  evidenceIds: ["合成来源段落1"],
}));

describe("five-layer transparent-center accessible radar", () => {
  it("uses five unlabeled rings, a real center cutout, and static compact labels", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} />);

    const image = screen.getByRole("img", { name: /六维质量雷达图/ });
    expect(image.getAttribute("viewBox")).toBe("0 0 400 368");
    expect(image.querySelectorAll(".rag-radar-grid")).toHaveLength(5);
    expect(image.querySelector(".rag-radar-tick")).toBeNull();
    expect(image.querySelectorAll(".rag-radar-axis")).toHaveLength(6);

    const firstAxis = image.querySelector(".rag-radar-axis");
    expect(firstAxis?.getAttribute("x1")).toBe("200");
    expect(firstAxis?.getAttribute("y1")).toBe("164");
    expect(firstAxis?.getAttribute("x2")).toBe("200");
    expect(firstAxis?.getAttribute("y2")).toBe("84");

    const mask = screen.getByTestId("rag-radar-center-mask");
    expect(mask.querySelector(".rag-radar-center-cutout")).toBeTruthy();
    expect(screen.getByTestId("rag-radar-area").getAttribute("mask")).toMatch(/^url\(#.+-center-mask\)$/);

    const labels = screen.getAllByTestId("rag-evaluation-dimension-label");
    expect(labels).toHaveLength(6);
    expect(labels.every(label => label.tagName === "DIV")).toBe(true);
    expect(labels.every(label => label.closest("button") === null)).toBe(true);
    expect(screen.getAllByText("90%")).toHaveLength(6);

    const correctAndGrounded = labels[1];
    expect(Number.parseFloat(correctAndGrounded.style.left)).toBeLessThan(84);
    expect(Number.parseFloat(correctAndGrounded.style.left)).toBeGreaterThan(82);
  });

  it("opens and collapses details from six real point buttons", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} />);

    const buttons = screen.getAllByTestId("rag-evaluation-dimension");
    expect(buttons).toHaveLength(6);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByTestId("rag-radar-area")).toBeTruthy();
    expect(screen.queryByText("明确缺陷及对应影响")).toBeNull();

    const button = screen.getByRole("button", { name: /正确与有据 90%/ });
    const marker = button.querySelector("[data-testid='rag-radar-point-marker']");
    expect(marker?.classList.contains("is-known")).toBe(true);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.mouseEnter(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "正确与有据" })).toBeTruthy();
    expect(screen.queryByText("正确性与依据忠实度")).toBeNull();
    expect(screen.getByText("22.5 / 25")).toBeTruthy();
    expect(screen.getByText(/合成来源段落1/)).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByText("22.5 / 25")).toBeNull();
  });

  it("keeps pending and N/A axes distinct without filling an incomplete area", () => {
    const items = dimensions();
    items[1] = { ...items[1], score: null, status: "pending" };
    items[2] = { ...items[2], score: null, status: "not_applicable" };
    render(<RagEvaluationRadar dimensions={items} />);

    expect(screen.queryByTestId("rag-radar-area")).toBeNull();
    expect(screen.getAllByTestId("rag-evaluation-dimension")).toHaveLength(6);
    const pending = screen.getByRole("button", { name: /正确与有据 待核验/ });
    const notApplicable = screen.getByRole("button", { name: /信息完整 不适用/ });
    expect(pending.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-pending")).toBe(true);
    expect(notApplicable.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-not-applicable")).toBe(true);
    expect(screen.getByText("待核验")).toBeTruthy();
    expect(screen.getByText("不适用")).toBeTruthy();
  });

  it("places six real zero scores on distinct inner-ring vertices", () => {
    const items = dimensions().map(item => ({ ...item, score: 0, status: "failed" as const }));
    render(<RagEvaluationRadar dimensions={items} />);

    const buttons = screen.getAllByTestId("rag-evaluation-dimension");
    expect(buttons).toHaveLength(6);
    expect(screen.getAllByText("0%")).toHaveLength(6);
    expect(new Set(buttons.map(button => `${button.style.left}:${button.style.top}`)).size).toBe(6);
    expect(buttons.every(button => button.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-zero"))).toBe(true);
    expect(buttons.every(button => !(button.style.left === "50%" && button.style.top === "50%"))).toBe(true);
    expect(screen.getByTestId("rag-radar-area")).toBeTruthy();
  });
});
