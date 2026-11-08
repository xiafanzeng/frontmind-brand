// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RagEvaluationRadar } from "./RagEvaluationRadar";
import { RAG_DIMENSIONS } from "./rag-evaluation";
import type { EvaluationDimension } from "./evaluation-skill-contract";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run";
import { createRagChecklist, scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const dimensions = (): EvaluationDimension[] => RAG_DIMENSIONS.map(d => ({
  id: d.id,
  label: d.label,
  score: d.weight * .9,
  maxScore: d.weight,
  status: "partial",
  summary: "明确缺陷及对应影响",
  evidenceIds: ["合成来源段落1"],
}));

const checklistJudgments = (): EnterpriseRagChecklistJudgeOutput => {
  const checklist = createRagChecklist("医院地址是什么？", "query");
  const checks = checklist.checks.map((check, index) => ({
    id: check.id,
    status: index === 0 ? "met" as const : "partial" as const,
    rationale: index === 0 ? "核心问题已直接回答。" : "仍有一项细节可以补充。",
    evidenceIds: ["claim-1"],
  }));
  const scored = scoreRagChecklist(checklist, checks);
  return {
    schemaVersion: 3,
    operationToken: "evaluation-operation-1",
    inputHash: "f".repeat(64),
    checklist,
    checks,
    dimensions: scored.dimensions.map(dimension => ({
      id: dimension.id,
      level: dimension.score === null ? null : 4 * dimension.score / dimension.maxScore,
      rationale: dimension.summary,
      evidenceIds: dimension.evidenceIds,
    })),
    findings: [],
    claims: [],
  } as unknown as EnterpriseRagChecklistJudgeOutput;
};

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
    expect(screen.getByLabelText("22.5 / 25")).toBeTruthy();
    expect(screen.queryByText(/合成来源段落1/)).toBeNull();
    const shell = document.querySelector(".rag-radar-detail-shell");
    expect(shell?.classList.contains("is-open")).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(shell?.classList.contains("is-open")).toBe(false);
    expect(shell?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the title and score in one header and presents compact semantic checklist states", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} judgments={checklistJudgments()} />);

    fireEvent.click(screen.getByRole("button", { name: /需求满足 90%/ }));
    const heading = screen.getByRole("heading", { name: "需求满足" });
    const score = screen.getByLabelText("18.0 / 20");
    const header = heading.closest(".rag-radar-detail__header");
    expect(header).toBeTruthy();
    expect(score.parentElement).toBe(header);

    const detail = document.querySelector(".rag-radar-detail")!;
    expect(detail.textContent).not.toContain("原始分");
    expect(detail.textContent).not.toContain("· 满足");
    const items = [...detail.querySelectorAll(".rag-radar-detail__check")];
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".rag-radar-detail__check-title")?.textContent).toContain("回应核心目标");
    const statuses = [...detail.querySelectorAll(".rag-radar-detail__check-status")];
    expect(statuses[0]?.classList.contains("is-met")).toBe(true);
    expect(statuses[0]?.querySelector(".rag-evaluation-status-orb")).toBeTruthy();
    expect(statuses[0]?.textContent).toContain("满足");
    expect(statuses[1]?.classList.contains("is-partial")).toBe(true);
    expect(statuses[1]?.textContent).toContain("部分满足");
  });

  it("reveals a classic earned-over-maximum score and never exposes internal evidence IDs", () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
    const runFrame = (timestamp: number) => act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(timestamp));
    });
    const items = dimensions();
    items[0] = { ...items[0], score: 3.75, maxScore: 15, evidenceIds: ["promise-1", "audit:KB-SYN-v1"] };
    render(<RagEvaluationRadar dimensions={items} />);

    fireEvent.click(screen.getByRole("button", { name: /需求满足 25%/ }));
    const score = screen.getByLabelText("3.8 / 15");
    const earned = screen.getByTestId("rag-radar-detail-earned");
    const detailCharacters = [...document.querySelectorAll<HTMLElement>(".rag-radar-detail__content [aria-hidden='true'] > span")];
    expect(score.querySelector(".rag-radar-detail-score__maximum")?.textContent).toBe("/15");
    expect(earned.textContent).toBe("0.0");
    expect(detailCharacters.length).toBeGreaterThan(2);
    expect(detailCharacters[0].style.opacity).toBe("0");
    expect(screen.queryByText(/promise-1|audit:KB-SYN-v1|证据：/)).toBeNull();
    runFrame(0);
    runFrame(400);
    expect(earned.textContent).toBe("3.3");
    expect(Number(detailCharacters[0].style.opacity)).toBeGreaterThan(Number(detailCharacters.at(-1)?.style.opacity ?? 0));
    runFrame(800);
    expect(earned.textContent).toBe("3.8");
    expect(detailCharacters.at(-1)?.style.opacity).toBe("1");
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

  it("uses six gray empty-state dots with no invented score until a question exists", () => {
    const items = dimensions();
    items[1] = { ...items[1], score: null, status: "pending" };
    items[2] = { ...items[2], score: null, status: "not_applicable" };
    const view = render(<RagEvaluationRadar dimensions={items} />);
    fireEvent.click(screen.getByRole("button", { name: /正确与有据 待核验/ }));
    expect(screen.getByText("明确缺陷及对应影响")).toBeTruthy();
    view.rerender(<RagEvaluationRadar dimensions={items} emptyQuestion />);
    const buttons = screen.getAllByTestId("rag-evaluation-dimension");
    expect(buttons).toHaveLength(6);
    expect(buttons.every(button => button.getAttribute("aria-label")?.includes("暂无评分"))).toBe(true);
    expect(buttons.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(buttons.every(button => button.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-empty"))).toBe(true);
    expect(screen.getAllByText("暂无评分")).toHaveLength(6);
    expect(screen.queryByTestId("rag-radar-area")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("明确缺陷及对应影响")).toBeNull();
    (buttons[1] as HTMLButtonElement).click();
    expect(screen.queryByText("明确缺陷及对应影响")).toBeNull();
    view.rerender(<RagEvaluationRadar dimensions={items} />);
    const pending = screen.getByRole("button", { name: /正确与有据 待核验/ });
    expect((pending as HTMLButtonElement).disabled).toBe(false);
    expect(pending.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-pending")).toBe(true);
    fireEvent.click(pending);
    expect(screen.getByText("明确缺陷及对应影响")).toBeTruthy();
    expect(screen.getByRole("button", { name: /信息完整 不适用/ }).querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-not-applicable")).toBe(true);
  });

  it("places six real zero scores on distinct inner-ring vertices", () => {
    const items = dimensions().map(item => ({ ...item, score: 0, status: "failed" as const }));
    items[0] = { ...items[0], maxScore: 15 };
    render(<RagEvaluationRadar dimensions={items} />);

    const buttons = screen.getAllByTestId("rag-evaluation-dimension");
    expect(buttons).toHaveLength(6);
    expect(screen.getAllByText("0%")).toHaveLength(6);
    expect(new Set(buttons.map(button => `${button.style.left}:${button.style.top}`)).size).toBe(6);
    expect(buttons.every(button => button.querySelector("[data-testid='rag-radar-point-marker']")?.classList.contains("is-zero"))).toBe(true);
    expect(buttons.every(button => !(button.style.left === "50%" && button.style.top === "50%"))).toBe(true);
    expect(screen.getByTestId("rag-radar-area")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /需求满足 0%/ }));
    const earned = screen.getByTestId("rag-radar-detail-earned");
    expect(earned.textContent).toBe("0.0");
    expect(earned.classList.contains("is-zero")).toBe(true);
    expect(earned.parentElement?.querySelector(".rag-radar-detail-score__maximum")?.textContent).toBe("/15");
    expect(screen.getByLabelText("0.0 / 15")).toBeTruthy();
  });
});
