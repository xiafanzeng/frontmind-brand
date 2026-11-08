// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RagEvaluationRadar } from "./RagEvaluationRadar";
import { RAG_DIMENSIONS } from "./rag-evaluation";
import type { EvaluationDimension } from "./evaluation-skill-contract";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run";
import { createRagChecklist, scoreRagChecklist, type RagChecklist } from "../../../contracts/enterprise-rag-checklist";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const dimensions = (): EvaluationDimension[] => RAG_DIMENSIONS.map(dimension => ({
  id: dimension.id,
  label: dimension.label,
  score: dimension.weight * .9,
  maxScore: dimension.weight,
  status: "partial",
  summary: "明确缺陷及对应影响",
  evidenceIds: ["合成来源段落1"],
}));

function buildJudgments({ mixedCitations = false, withFinding = false } = {}): EnterpriseRagChecklistJudgeOutput {
  const created = createRagChecklist("医院地址是什么？", "query");
  const checklist: RagChecklist = mixedCitations ? {
    ...created,
    checks: created.checks.map(check => check.id === "citation_currency"
      ? { ...check, applicable: false, exclusionReason: "当前问题不涉及时效性。" }
      : check),
  } : created;
  const checks = checklist.checks.map((check, index) => {
    const status = !check.applicable
      ? "not_applicable" as const
      : mixedCitations && check.id === "citation_display"
        ? "undetermined" as const
        : index === 0 || check.id === "citation_support"
          ? "met" as const
          : "partial" as const;
    return {
      id: check.id,
      status,
      rationale: status === "met" ? "核心问题已直接回答。" : status === "not_applicable" ? "使用冻结排除理由。" : "仍有一项细节可以补充。",
      evidenceIds: status === "not_applicable" ? [] : ["promise-1", "audit:KB-SYN-v1"],
    };
  });
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
    findings: withFinding ? [{
      id: "finding-1",
      kind: "citation",
      severity: "improvement",
      summary: "引用展示需要补充",
      impact: "客户暂时无法核对该项信息。",
      claimIds: ["claim-public-1"],
      evidenceIds: ["audit:internal-finding"],
      dimensionIds: ["citations"],
      checkId: "citation_display",
      rootCauseId: "root-cause-1",
    }] : [],
    claims: [{
      id: "claim-public-1",
      statement: "请以医院正式公开的联系方式为准。",
      kind: "uncertainty",
      relevance: "supporting",
      status: "supported",
      sourceIds: ["source-internal-1"],
      rationale: "公开声明已得到冻结资料支持。",
    }],
    gates: [],
    summary: "评估完成。",
    task: { status: "completed", rationale: "已回答。", evidenceIds: ["audit:task"] },
    optionalSuggestions: [],
  } as unknown as EnterpriseRagChecklistJudgeOutput;
}

describe("enterprise RAG evaluation radar", () => {
  it("preserves the five-ring transparent-center geometry and six real controls", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} />);

    const image = screen.getByRole("img", { name: /六维质量雷达图/ });
    expect(image.getAttribute("viewBox")).toBe("0 0 400 368");
    expect(image.querySelectorAll(".rag-radar-grid")).toHaveLength(5);
    expect(image.querySelector(".rag-radar-tick")).toBeNull();
    expect(image.querySelectorAll(".rag-radar-axis")).toHaveLength(6);
    expect(image.querySelector(".rag-radar-axis")?.getAttribute("x1")).toBe("200");
    expect(image.querySelector(".rag-radar-axis")?.getAttribute("y1")).toBe("164");
    expect(image.querySelector(".rag-radar-axis")?.getAttribute("x2")).toBe("200");
    expect(image.querySelector(".rag-radar-axis")?.getAttribute("y2")).toBe("84");
    expect(screen.getByTestId("rag-radar-center-mask").querySelector(".rag-radar-center-cutout")).toBeTruthy();
    expect(screen.getByTestId("rag-radar-area").getAttribute("mask")).toMatch(/^url\(#.+-center-mask\)$/);
    expect(screen.getAllByTestId("rag-evaluation-dimension-label")).toHaveLength(6);
    const controls = screen.getAllByTestId("rag-evaluation-dimension");
    expect(controls).toHaveLength(6);
    expect(controls.every(control => control.tagName === "BUTTON")).toBe(true);
    expect(controls.every(control => Boolean(document.getElementById(control.getAttribute("aria-controls")!)))).toBe(true);
    expect(screen.getAllByText("90%")).toHaveLength(6);
  });

  it("starts collapsed, toggles one detail, switches dimensions, and retains trigger focus", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} />);

    const controls = screen.getAllByTestId("rag-evaluation-dimension");
    expect(controls.every(control => control.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(document.querySelector(".rag-radar-detail")).toBeNull();

    const intent = screen.getByRole("button", { name: /需求满足 90%/ });
    intent.focus();
    fireEvent.click(intent);
    expect(document.activeElement).toBe(intent);
    const intentDetail = screen.getByRole("region", { name: "需求满足详情" });
    expect(intent.getAttribute("aria-expanded")).toBe("true");
    const controlledDetail = document.getElementById(intent.getAttribute("aria-controls")!);
    expect(controlledDetail).toBeTruthy();
    expect(controlledDetail?.contains(intentDetail)).toBe(true);

    const correctness = screen.getByRole("button", { name: /正确与有据 90%/ });
    correctness.focus();
    fireEvent.click(correctness);
    expect(document.activeElement).toBe(correctness);
    expect(intent.getAttribute("aria-expanded")).toBe("false");
    expect(correctness.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("region", { name: "需求满足详情" })).toBeNull();
    expect(screen.getByRole("region", { name: "正确与有据详情" })).toBeTruthy();

    fireEvent.click(correctness);
    expect(correctness.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "正确与有据详情" })).toBeNull();
    expect(document.querySelector(".rag-radar-detail-shell")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("closes the previous detail when a new report reveal key arrives", () => {
    const view = render(<RagEvaluationRadar dimensions={dimensions()} revealKey="report-before" />);
    fireEvent.click(screen.getByRole("button", { name: /需求满足 90%/ }));
    expect(screen.getByRole("region", { name: "需求满足详情" })).toBeTruthy();

    view.rerender(<RagEvaluationRadar dimensions={dimensions()} revealKey="report-after" />);

    expect(screen.getByRole("button", { name: /需求满足 90%/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "需求满足详情" })).toBeNull();
  });

  it("renders the authoritative checklist in order with raw scores, rationale, and named double-dot states", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} judgments={buildJudgments()} />);
    fireEvent.click(screen.getByRole("button", { name: /需求满足 90%/ }));

    const detail = screen.getByRole("region", { name: "需求满足详情" });
    expect(detail.classList.contains("rag-radar-detail--enterprise")).toBe(true);
    const heading = within(detail).getByRole("heading", { name: "需求满足" });
    const score = within(detail).getByRole("status", { name: "得分 18 / 权重 20" });
    expect(score.parentElement).toBe(heading.parentElement);

    const items = [...detail.querySelectorAll<HTMLElement>(".rag-radar-detail__check")];
    expect(items).toHaveLength(2);
    expect(items.map(item => item.querySelector(".rag-radar-detail__check-title .rag-reveal-screen-reader-text")?.textContent)).toEqual(["回应核心目标", "遵守明确约束"]);
    expect(items[0].textContent).toContain("12 / 12 原始分");
    expect(items[1].textContent).toContain("4 / 8 原始分");
    expect(items[0].textContent).toContain("核心问题已直接回答。");
    expect(items[1].textContent).toContain("仍有一项细节可以补充。");
    expect(within(items[0]).getByRole("img", { name: "回应核心目标：满足" }).querySelector(".rag-evaluation-status-orb")).toBeTruthy();
    expect(within(items[1]).getByRole("img", { name: "遵守明确约束：部分满足" })).toBeTruthy();
    expect(detail.textContent).not.toMatch(/promise-1|audit:KB-SYN-v1|证据：/);
  });

  it("keeps pending and not-applicable checks distinct while preserving normalization and findings", () => {
    render(<RagEvaluationRadar dimensions={dimensions()} judgments={buildJudgments({ mixedCitations: true, withFinding: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /引用与时效 90%/ }));

    const detail = screen.getByRole("region", { name: "引用与时效详情" });
    expect(within(detail).getByRole("img", { name: "引用展示完整：待核验" }).classList.contains("is-undetermined")).toBe(true);
    expect(within(detail).getByRole("img", { name: "版本与时效准确：不适用" }).classList.contains("is-not_applicable")).toBe(true);
    expect(detail.textContent).toContain("待核验；权重 3");
    expect(detail.textContent).toContain("不适用；权重 2");
    expect(detail.textContent).toContain("当前问题不涉及时效性。");
    expect(detail.textContent).toContain("本维存在预先冻结的不适用项");
    expect(detail.textContent).toContain("引用展示需要补充");
    expect(detail.textContent).toContain("客户暂时无法核对该项信息。");
    expect(detail.textContent).toContain("请以医院正式公开的联系方式为准。");
    expect(detail.textContent).not.toMatch(/audit:internal-finding|source-internal-1/);
  });

  it.each([
    { score: 0, percentage: "0%", expected: "0/15", accessible: "得分 0 / 权重 15" },
    { score: 12, percentage: "80%", expected: "12/15", accessible: "得分 12 / 权重 15" },
    { score: 12.5, percentage: "83.3%", expected: "12.5/15", accessible: "得分 12.5 / 权重 15" },
  ])("formats $score without invented decimal places", ({ score, percentage, expected, accessible }) => {
    const items = dimensions();
    items[0] = { ...items[0], score, maxScore: 15, status: score === 0 ? "failed" : "partial" };
    render(<RagEvaluationRadar dimensions={items} />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`需求满足 ${percentage.replace(".", "\\.")}`) }));
    expect(screen.getByRole("status", { name: accessible }).textContent).toBe(expected);
  });

  it("does not turn unavailable dimensions into zero and disables all controls for an empty question", () => {
    const items = dimensions();
    items[1] = { ...items[1], score: 12, status: "pending" };
    items[2] = { ...items[2], score: null, status: "not_applicable" };
    const view = render(<RagEvaluationRadar dimensions={items} />);

    expect(screen.queryByTestId("rag-radar-area")).toBeNull();
    const pending = screen.getByRole("button", { name: /正确与有据 待核验/ });
    fireEvent.click(pending);
    expect(screen.getByRole("status", { name: "待核验" }).textContent).toBe("待核验");
    fireEvent.click(screen.getByRole("button", { name: /信息完整 不适用/ }));
    expect(screen.getByRole("status", { name: "不适用" }).textContent).toBe("不适用");

    view.rerender(<RagEvaluationRadar dimensions={items} emptyQuestion />);
    const controls = screen.getAllByTestId("rag-evaluation-dimension");
    expect(controls.every(control => (control as HTMLButtonElement).disabled)).toBe(true);
    expect(controls.every(control => control.getAttribute("aria-expanded") === null)).toBe(true);
    expect(controls.every(control => control.getAttribute("aria-label")?.includes("暂无评分"))).toBe(true);
    expect(document.querySelector(".rag-radar-detail")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("reveals score and graphemes together over 800ms without exposing internal IDs", () => {
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
    const earned = screen.getByTestId("rag-radar-detail-earned");
    const detailCharacters = [...document.querySelectorAll<HTMLElement>(".rag-radar-detail__content [aria-hidden='true'] > span[style*='opacity']")];
    expect(screen.getByRole("status", { name: "得分 3.8 / 权重 15" })).toBeTruthy();
    expect(earned.textContent).toBe("0");
    expect(detailCharacters.length).toBeGreaterThan(2);
    expect(detailCharacters[0].style.opacity).toBe("0");
    runFrame(0);
    runFrame(400);
    expect(earned.textContent).toBe("3.3");
    expect(Number(detailCharacters[0].style.opacity)).toBeGreaterThan(Number(detailCharacters.at(-1)?.style.opacity ?? 0));
    runFrame(800);
    expect(earned.textContent).toBe("3.8");
    expect(detailCharacters.at(-1)?.style.opacity).toBe("1");
    expect(screen.queryByText(/promise-1|audit:KB-SYN-v1|证据：/)).toBeNull();
  });

  it("shows final score and text immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const items = dimensions();
    items[0] = { ...items[0], score: 12.5, maxScore: 15 };
    render(<RagEvaluationRadar dimensions={items} judgments={buildJudgments()} />);

    fireEvent.click(screen.getByRole("button", { name: /需求满足 83\.3%/ }));
    expect(screen.getByTestId("rag-radar-detail-earned").textContent).toBe("12.5");
    const detailCharacters = [...document.querySelectorAll<HTMLElement>(".rag-radar-detail__content [aria-hidden='true'] > span[style*='opacity']")];
    expect(detailCharacters.length).toBeGreaterThan(2);
    expect(detailCharacters.every(character => character.style.opacity === "1")).toBe(true);
  });
});
