import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebsiteEvaluationWorkspace,
  type WebsiteEvaluationRunStatus,
  type WebsiteEvaluationWorkspaceProps,
} from "./WebsiteEvaluationWorkspace";

const dimensions: WebsiteEvaluationWorkspaceProps["dimensions"] = [
  ["visitor-task", "访客任务", 20],
  ["brand", "品牌一致性", 15],
  ["facts", "事实与证据", 20],
  ["ia", "信息架构", 15],
  ["visual", "视觉与可用性", 15],
  ["assistant", "助手与边界", 15],
].map(([id, label, weight], index) => ({
  id: String(id),
  label: String(label),
  weight: Number(weight),
  score: index === 0 ? 0 : 80,
  summary: `${label}的固定检查摘要。`,
  evidenceIds: [`evidence-${index + 1}`],
  anchors: Array.from({ length: 4 }, (_, anchorIndex) => ({
    id: `${id}-anchor-${anchorIndex + 1}`,
    label: `${label}检查项 ${anchorIndex + 1}`,
    score: (anchorIndex === 0 ? 0 : anchorIndex === 1 ? 0.5 : 1) as 0 | 0.5 | 1,
    summary: "固定检查项判定。",
    evidenceIds: [`evidence-${index + 1}-${anchorIndex + 1}`],
  })),
}));

function props(overrides: Partial<WebsiteEvaluationWorkspaceProps> = {}): WebsiteEvaluationWorkspaceProps {
  return {
    status: "completed",
    score: 0,
    verdict: "暂缓发布",
    summary: "真实分数保持不变，关键风险只调整结论。",
    reportId: "report-ui-1",
    evidenceUpdatedLabel: "2026-11-08T13:30:45+08:00",
    judgmentCoverage: 100,
    dimensions,
    risks: [{
      id: "risk-1",
      title: "核心任务在移动端中断",
      summary: "320 视口的转化入口不可达。",
      severity: "critical",
      target: { kind: "route", routeId: "home", sectionId: "pages", anchor: "home-cta" },
      repairItem: { kind: "critical_risk", id: "risk-1" },
    }],
    technicalChecks: [
      { id: "C01", title: "模板选择", detail: "已确认", passed: true, actionLabel: "查看模板", onAction: vi.fn() },
      { id: "C02", title: "页面结构", detail: "待确认", passed: false, actionLabel: "查看页面", onAction: vi.fn() },
      { id: "C03", title: "网站信息", detail: "已确认", passed: true, actionLabel: "查看网站", onAction: vi.fn() },
      { id: "C04", title: "助手配置", detail: "待试用", passed: false, actionLabel: "查看助手", onAction: vi.fn() },
    ],
    onRepairTarget: vi.fn(),
    onReevaluate: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  // jsdom has no PointerEvent; preserve pointerType so mouse and touch paths
  // exercise the same contract as the shared RAG gauge adapter.
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WebsiteEvaluationWorkspace", () => {
  it("keeps the evaluation region accessible without the removed introduction copy", () => {
    render(<WebsiteEvaluationWorkspace {...props()} />);

    expect(screen.getByRole("region", { name: "建设评估" })).toBeTruthy();
    expect(screen.queryByText("建设检查与评估")).toBeNull();
    expect(screen.queryByText("质量结论与技术发布资格分开呈现；企业 RAG 仅作关联参考。")).toBeNull();
    expect(screen.queryByTestId("website-evaluation-status")).toBeNull();
    expect(screen.queryByText("网站预览")).toBeNull();
    expect(screen.getByText("发布检查")).toBeTruthy();
    expect(screen.queryByText("网站质量")).toBeNull();
    expect(screen.queryByText("风险只影响结论，不改变分数")).toBeNull();
    expect(screen.getByText("风险修复")).toBeTruthy();
    expect(screen.queryByText("报告与版本")).toBeNull();
    expect(screen.queryByText("RAG 参考")).toBeNull();
    expect(screen.queryByText("不计入评分")).toBeNull();
    expect(screen.queryByText(/^C0[1-4]/)).toBeNull();
    for (const [title, selector] of [
      ["发布检查", ".wev-technical"],
      ["评估结论", ".wev-score-card"],
      ["风险修复", ".wev-risk-card"],
    ] as const) {
      expect(screen.getByText(title).closest(selector)?.querySelector(".wev-title-icon")).toBeTruthy();
    }
    expect(document.querySelector(".wev-column--decision")?.nextElementSibling?.classList.contains("wev-column--checks")).toBe(true);
    const moduleCards = Array.from(document.querySelectorAll<HTMLElement>(".wev-card.sfp-panel"));
    expect(moduleCards).toHaveLength(3);
    expect(moduleCards.every((card) => card.classList.contains("sfp-panel"))).toBe(true);
    expect(document.querySelector(".wev-decision-card")?.querySelector(".wev-actions")).toBeTruthy();
    const scoreCard = document.querySelector(".wev-score-card");
    expect(scoreCard?.querySelector(".wev-radar")).toBeTruthy();
    expect(document.querySelector(".wev-dimensions-card")).toBeNull();
  });

  it("lists every repair as body copy with status and two square icon actions", () => {
    const onRepairTarget = vi.fn();
    const risks: WebsiteEvaluationWorkspaceProps["risks"] = [
      props().risks[0],
      { id: "finding-high", title: "高优先级问题", summary: "需要先处理高优先级问题。", severity: "high", target: { kind: "build" }, repairItem: { kind: "finding", id: "finding-high" } },
      { id: "finding-medium", title: "中优先级问题", summary: "需要调整中优先级问题。", severity: "medium", target: { kind: "knowledge" }, repairItem: { kind: "finding", id: "finding-medium" } },
      { id: "finding-low", title: "一般优化问题", summary: "可以继续改善一般问题。", severity: "low", target: { kind: "brand_kit" }, repairItem: { kind: "finding", id: "finding-low" } },
    ];
    const view = render(<WebsiteEvaluationWorkspace {...props({ risks, onRepairTarget })} />);

    const section = screen.getByText("风险修复").closest(".wev-risk-card") as HTMLElement;
    expect(section.querySelector("header")?.textContent).toBe("风险修复");
    expect(section.querySelectorAll(".wev-repair-item")).toHaveLength(4);
    expect(section.textContent).not.toContain("项需要处理");
    expect(screen.queryByRole("button", { name: "修复计划" })).toBeNull();
    expect(screen.queryByRole("button", { name: "人工复核" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看修复优先级" })).toBeNull();

    const rows = Array.from(section.querySelectorAll<HTMLElement>(".wev-repair-item"));
    expect(rows.map((row) => row.querySelector(".wev-repair-severity")?.textContent)).toEqual([
      "优先修复", "优先修复", "建议修复", "一般优化",
    ]);
    expect(rows[0].querySelector(".wev-repair-severity")?.classList.contains("is-danger")).toBe(true);
    expect(rows[1].querySelector(".wev-repair-severity")?.classList.contains("is-danger")).toBe(true);
    expect(rows[2].querySelector(".wev-repair-severity")?.classList.contains("is-attention")).toBe(true);
    expect(rows[3].querySelector(".wev-repair-severity")?.classList.contains("is-muted")).toBe(true);
    expect(rows.every((row) => row.querySelector(".wev-repair-item__content"))).toBe(true);
    expect(rows.every((row) => row.querySelectorAll(".wev-repair-action").length === 2)).toBe(true);
    expect(rows.every((row) => row.dataset.wevListEntrance?.startsWith("repair-") === true)).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".wev-technical li"))
      .every((row) => row.dataset.wevListEntrance?.startsWith("technical-") === true)).toBe(true);

    const repair = within(rows[2]).getByRole("button", { name: "修复" });
    fireEvent.pointerEnter(repair, { pointerType: "mouse" });
    expect(within(repair).getByRole("tooltip").textContent).toBe("修复");
    fireEvent.pointerLeave(repair, { pointerType: "mouse" });
    expect(within(repair).queryByRole("tooltip")).toBeNull();
    const review = within(rows[2]).getByRole("button", { name: "评审" });
    fireEvent.focus(review);
    expect(within(review).getByRole("tooltip").textContent).toBe("评审");
    fireEvent.keyDown(review, { key: "Escape" });
    expect(within(review).queryByRole("tooltip")).toBeNull();
    fireEvent.focus(review);
    fireEvent.pointerDown(review, { pointerType: "touch" });
    expect(within(review).queryByRole("tooltip")).toBeNull();
    fireEvent.blur(review);
    fireEvent.click(repair);
    expect(onRepairTarget).toHaveBeenCalledWith({ kind: "knowledge" });
    expect(view.container.querySelectorAll(".wev-repair-item")).toHaveLength(4);
  });

  it("keeps repairs usable but disables review when an authoritative coordinate is missing", () => {
    const onRepairTarget = vi.fn();
    render(<WebsiteEvaluationWorkspace {...props({
      risks: [{
        id: "legacy-risk",
        title: "旧报告修复项",
        summary: "可以继续前往修复，但不能伪造评审坐标。",
        severity: "medium",
        target: { kind: "knowledge" },
      }],
      onRepairTarget,
    })} />);

    const row = screen.getByText("旧报告修复项").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "修复" }));
    expect(onRepairTarget).toHaveBeenCalledWith({ kind: "knowledge" });
    const unavailable = within(row).getByRole("button", {
      name: "评审不可用：当前报告缺少稳定修复项坐标",
    });
    expect(unavailable.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(unavailable);
    expect(within(unavailable).getByRole("tooltip").textContent).toBe("评审");
    fireEvent.click(unavailable);
    expect(screen.queryByRole("dialog", { name: "评审反馈" })).toBeNull();
  });

  it("hides the complete repair module when the report has no repair items", () => {
    render(<WebsiteEvaluationWorkspace {...props({ risks: [] })} />);
    expect(screen.queryByText("风险修复")).toBeNull();
    expect(document.querySelector(".wev-risk-card")).toBeNull();
  });

  it.each<WebsiteEvaluationRunStatus>(["queued", "capturing", "running", "result_pending"])(
    "uses the neutral waiting surface without numeric placeholders while %s",
    (status) => {
      const view = render(<WebsiteEvaluationWorkspace {...props({ status, score: null, reportId: null })} />);

      expect(screen.getByTestId("website-evaluation-waiting").getAttribute("role")).toBe("status");
      expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
      expect(screen.queryByTestId("website-evaluation-gauge-marker")).toBeNull();
      expect(screen.queryByTestId("website-evaluation-radar")).toBeNull();
      expect(screen.queryByTestId("website-evaluation-radar-area")).toBeNull();
      expect(view.container.querySelector(".wev-coverage")).toBeNull();
      expect(screen.getByTestId("website-evaluation-waiting").textContent).not.toContain("—");
      expect(screen.getByTestId("website-evaluation-waiting").textContent).not.toContain("0/100");
    },
  );

  it("shows no score for a failed build and routes back to build editing", () => {
    const onRepairTarget = vi.fn();
    render(<WebsiteEvaluationWorkspace {...props({ status: "build_failed", score: null, reportId: null, onRepairTarget })} />);

    expect(screen.getByText("暂无可评估成品")).toBeTruthy();
    expect(screen.queryByTestId("website-evaluation-status")).toBeNull();
    expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
    expect(screen.queryByTestId("website-evaluation-radar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(onRepairTarget).toHaveBeenCalledWith({ kind: "build" });
  });

  it("keeps three actions visible without a report and retries a failed evaluation", () => {
    const onRetry = vi.fn();
    render(<WebsiteEvaluationWorkspace {...props({ status: "failed", score: null, reportId: null, history: [], legacyReports: [], onRetry })} />);

    const actions = document.querySelector(".wev-actions") as HTMLElement;
    const retry = within(actions).getByRole("button", { name: "重新评估" });
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(within(actions).getByRole("button", { name: "评估历史" }).hasAttribute("disabled")).toBe(true);
    expect(within(actions).getByRole("button", { name: "生成报告" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a completed true zero and all six scored dimensions", () => {
    render(<WebsiteEvaluationWorkspace {...props()} />);

    const gauge = screen.getByTestId("website-evaluation-score");
    expect(gauge.tagName).toBe("OUTPUT");
    expect(gauge.getAttribute("aria-label")).toBe("网站建设评估最终分 0 分");
    expect(gauge.getAttribute("data-report-reveal-key")).toBe("report-ui-1");
    expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("0");
    expect(screen.getByTestId("website-evaluation-gauge-marker").classList.contains("is-pending")).toBe(false);
    expect(screen.getByRole("button", { name: "网站建设评估精确分值 0.00 分" })).toBeTruthy();
    const radar = screen.getByTestId("website-evaluation-radar");
    expect(radar.getAttribute("aria-label")).toBe("网站建设六维评分雷达图");
    expect(radar.getAttribute("data-report-reveal-key")).toBe("report-ui-1");
    expect(screen.getByTestId("website-evaluation-radar-area")).toBeTruthy();
    expect(screen.getAllByTestId("website-evaluation-radar-label")).toHaveLength(6);
    expect(screen.getAllByTestId("website-evaluation-radar-point")).toHaveLength(6);
    expect(screen.getAllByTestId("website-evaluation-radar-marker")[0].classList.contains("is-zero")).toBe(true);
    expect(screen.getByRole("img", { name: /访客任务 0%/ })).toBeTruthy();
    expect(screen.getByText("暂缓发布")).toBeTruthy();
    expect(screen.getByText("核心任务在移动端中断")).toBeTruthy();
    expect(screen.getByText("发布检查")).toBeTruthy();
  });

  it("uses the RAG gauge control to reveal the precise score", () => {
    render(<WebsiteEvaluationWorkspace {...props({ score: 88, reportId: "report-gauge" })} />);

    expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("88");
    const control = screen.getByRole("button", { name: "网站建设评估精确分值 88.00 分" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(control, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("88.00");
    fireEvent.pointerLeave(control, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(control);
    expect(screen.getByRole("tooltip").textContent).toBe("88.00");
    expect(control.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.keyDown(control, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerDown(control, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(control);
    fireEvent.blur(control);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("starts all six radar details collapsed and toggles a single evidence-backed dimension from its point", () => {
    render(<WebsiteEvaluationWorkspace {...props()} />);

    const points = screen.getAllByTestId("website-evaluation-radar-point");
    expect(points).toHaveLength(6);
    expect(points.every((point) => point.tagName === "BUTTON")).toBe(true);
    expect(points.every((point) => point.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(screen.queryByRole("region", { name: "访客任务详情" })).toBeNull();

    const visitorTask = screen.getByRole("button", { name: /访客任务 0%/ });
    visitorTask.focus();
    fireEvent.click(visitorTask);
    expect(document.activeElement).toBe(visitorTask);
    expect(visitorTask.getAttribute("aria-expanded")).toBe("true");
    const visitorDetail = screen.getByRole("region", { name: "访客任务详情" });
    expect(visitorTask.getAttribute("aria-controls")).toBe(visitorDetail.id);
    expect(visitorDetail.textContent).not.toContain("访客任务的固定检查摘要。");
    expect(visitorDetail.textContent).not.toContain("0 分 · 权重 20");
    expect(within(visitorDetail).getByRole("status", { name: "得分 0 / 权重 20" }).textContent).toBe("0/20");

    for (const [anchorIndex, status, tone] of [
      [1, "未通过", "failed"],
      [2, "需完善", "pending"],
      [3, "已通过", "passed"],
      [4, "已通过", "passed"],
    ] as const) {
      const anchorLabel = within(visitorDetail).getByText(`访客任务检查项 ${anchorIndex}`);
      const anchor = anchorLabel.closest("article, li");
      expect(anchor).toBeInstanceOf(HTMLElement);
      const anchorElement = anchor as HTMLElement;
      const statusIndicator = within(anchorElement).getByRole("img", { name: `访客任务检查项 ${anchorIndex}：${status}` });
      expect(statusIndicator.textContent).toContain(status);
      expect(status).toHaveLength(3);
      expect(statusIndicator.parentElement).toBe(anchorElement);
      expect(anchorElement.querySelector(".wev-radar-detail__check-copy")).toBeTruthy();
      expect(statusIndicator.querySelector(".rag-evaluation-status-orb")?.classList.contains(`is-${tone}`)).toBe(true);
      expect(anchorElement.querySelector("b, small")).toBeNull();
      expect(anchorElement.textContent).not.toContain("证据：");
    }
    expect(within(visitorDetail).queryByText(/evidence-1-/)).toBeNull();

    const brand = screen.getByRole("button", { name: /品牌一致性 80%/ });
    fireEvent.click(brand);
    expect(visitorTask.getAttribute("aria-expanded")).toBe("false");
    expect(brand.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("region", { name: "访客任务详情" })).toBeNull();
    const brandDetail = screen.getByRole("region", { name: "品牌一致性详情" });
    expect(within(brandDetail).getByRole("status", { name: "得分 12 / 权重 15" }).textContent).toBe("12/15");

    fireEvent.click(brand);
    expect(brand.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "品牌一致性详情" })).toBeNull();
  });

  it("shows integer radar values without decimals and keeps one decimal only when needed", () => {
    const decimalDimensions = dimensions.map((dimension) => dimension.id === "brand"
      ? { ...dimension, score: 82.5 }
      : dimension);
    render(<WebsiteEvaluationWorkspace {...props({ dimensions: decimalDimensions })} />);

    expect(screen.getByRole("button", { name: /访客任务 0%/ })).toBeTruthy();
    const brand = screen.getByRole("button", { name: /品牌一致性 82\.5%/ });
    fireEvent.click(brand);
    expect(within(screen.getByRole("region", { name: "品牌一致性详情" }))
      .getByRole("status", { name: "得分 12.4 / 权重 15" }).textContent).toBe("12.4/15");
  });

  it("closes an expanded dimension before presenting a new report", () => {
    const view = render(<WebsiteEvaluationWorkspace {...props({ reportId: "report-before" })} />);
    const visitorTask = screen.getByRole("button", { name: /访客任务 0%/ });
    fireEvent.click(visitorTask);
    expect(visitorTask.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "访客任务详情" })).toBeTruthy();

    view.rerender(<WebsiteEvaluationWorkspace {...props({ reportId: "report-after" })} />);

    expect(screen.getByRole("button", { name: /访客任务 0%/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "访客任务详情" })).toBeNull();
  });

  it("keeps only reevaluation, history, and report actions below the conclusion", () => {
    const onReevaluate = vi.fn();
    render(<WebsiteEvaluationWorkspace {...props({
      onReevaluate,
      reportUrl: "/website-evaluations/reports/report-ui-1",
    })} />);

    const actions = screen.getByRole("region", { name: "建设评估" }).querySelector(".wev-actions") as HTMLElement;
    expect(Array.from(actions.querySelectorAll(":scope > :is(a,button)")).map((item) => item.textContent)).toEqual([
      "生成报告",
      "重新评估",
      "评估历史",
    ]);
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
    expect(within(actions).getByRole("button", { name: "重新评估" }).classList.contains("rag-evaluation-action")).toBe(true);
    expect(within(actions).getByRole("button", { name: "评估历史" }).classList.contains("sfp-button--ghost")).toBe(true);
    const report = within(actions).getByRole("link", { name: "生成报告" });
    expect(report.classList.contains("sfp-button--primary")).toBe(true);
    expect(report.getAttribute("target")).toBe("_blank");
    expect(report.getAttribute("href")).toBe("/website-evaluations/reports/report-ui-1");
    expect(within(actions).queryByRole("button", { name: "评估依据" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "查看发布条件" })).toBeNull();
    fireEvent.click(within(actions).getByRole("button", { name: "重新评估" }));
    expect(onReevaluate).toHaveBeenCalledTimes(1);
  });

  it("disables reevaluation with an accessible reason while it cannot run", () => {
    render(<WebsiteEvaluationWorkspace {...props({
      reevaluateDisabledReason: "当前草稿还没有新修改",
    })} />);

    const reevaluate = screen.getByRole("button", { name: "重新评估" });
    expect(reevaluate.hasAttribute("disabled")).toBe(true);
    const reasonId = reevaluate.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)?.textContent).toBe("当前草稿还没有新修改");
  });

  it("replays the RAG-style 800ms result reveal whenever the completed view enters", () => {
    vi.useFakeTimers();
    const first = render(<WebsiteEvaluationWorkspace {...props({ reportId: "report-reveal" })} />);
    const workspace = first.container.querySelector(".wev-workspace")!;
    expect(workspace.classList.contains("is-revealing")).toBe(true);
    const stableGauge = screen.getByTestId("website-evaluation-score");
    const stableRadar = screen.getByTestId("website-evaluation-radar");
    expect(stableGauge.getAttribute("data-report-reveal-key")).toBe("report-reveal");
    expect(stableRadar.getAttribute("data-report-reveal-key")).toBe("report-reveal");

    first.rerender(<WebsiteEvaluationWorkspace {...props({ reportId: "report-reveal", evidenceUpdatedLabel: "同报告轮询刷新" })} />);
    expect(screen.getByTestId("website-evaluation-score")).toBe(stableGauge);
    expect(screen.getByTestId("website-evaluation-radar")).toBe(stableRadar);

    act(() => vi.advanceTimersByTime(800));
    expect(workspace.classList.contains("is-revealing")).toBe(false);
    first.unmount();

    const second = render(<WebsiteEvaluationWorkspace {...props({ reportId: "report-reveal" })} />);
    expect(second.container.querySelector(".wev-workspace")!.classList.contains("is-revealing")).toBe(true);
    second.unmount();

    const third = render(<WebsiteEvaluationWorkspace {...props({ reportId: "report-reveal-next" })} />);
    expect(third.container.querySelector(".wev-workspace")!.classList.contains("is-revealing")).toBe(true);
    expect(screen.getByTestId("website-evaluation-score").getAttribute("data-report-reveal-key")).toBe("report-reveal-next");
    expect(screen.getByTestId("website-evaluation-radar").getAttribute("data-report-reveal-key")).toBe("report-reveal-next");
  });

  it("skips the timed reveal when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const view = render(<WebsiteEvaluationWorkspace {...props({ reportId: "report-reduced-motion" })} />);
    expect(view.container.querySelector(".wev-workspace")!.classList.contains("is-revealing")).toBe(false);
    expect(screen.getByTestId("website-evaluation-score").getAttribute("data-report-reveal-key")).toBe("report-reduced-motion");
    expect(screen.getByTestId("website-evaluation-radar").getAttribute("data-report-reveal-key")).toBe("report-reduced-motion");
    expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("0");
    expect(screen.getByTestId("website-evaluation-radar-area")).toBeTruthy();
  });

  it("opens a concise history window with the current report first and legacy records last", () => {
    const onLoadMoreHistory = vi.fn();
    render(<WebsiteEvaluationWorkspace {...props({
      reportUrl: "/website-evaluations/reports/report-ui-1",
      legacyReports: [{
        reportId: "legacy-v2-report",
        score: 71,
        createdAt: "2026-10-01T08:00:00.000Z",
        version: "2.0.0",
      }],
      history: [{
        reportId: "server-history-1",
        score: 82,
        createdAt: "2026-11-01T08:00:00.000Z",
        coordinateLabel: "rules-v1 · judge-v1 · evidence-v1",
        comparisonEligible: true,
        scoreDelta: -82,
        reportUrl: "/website-evaluations/reports/server-history-1",
      }, {
        reportId: "server-history-old-coordinate",
        score: 91,
        createdAt: "2026-10-20T08:00:00.000Z",
        coordinateLabel: "rules-v0 · judge-v0 · evidence-v0",
        comparisonEligible: false,
        scoreDelta: null,
      }],
      historyHasMore: true,
      onLoadMoreHistory,
    })} />);

    expect(document.querySelector(".wev-authority-history")).toBeNull();
    expect(document.querySelector(".wev-legacy-records")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "评估历史" }));
    const dialog = screen.getByRole("dialog", { name: "评估历史" });
    const rows = dialog.querySelectorAll(".wev-history-row");
    expect(rows[0].textContent).toContain("2026/11/08 13:30:45");
    expect(rows[0].textContent).toContain("0/100");
    expect(rows[0].textContent).toContain("当前");
    const currentTime = rows[0].querySelector(".wev-history-time");
    expect(currentTime?.querySelector("time")?.textContent).toBe("2026/11/08 13:30:45");
    expect(currentTime?.querySelector(".wev-history-current")?.textContent).toBe("当前");
    expect(rows[0].querySelector(".wev-history-row__action .wev-history-current")).toBeNull();
    const reportLink = within(dialog).getAllByText("查看报告")[0].closest("a");
    expect(reportLink?.getAttribute("target")).toBe("_blank");
    expect(reportLink?.className).toBe("");
    expect(dialog.textContent).not.toContain("server-history-1");
    expect(dialog.textContent).not.toContain("rules-v1");
    expect(dialog.textContent).not.toContain("当前较此报告");
    const legacy = within(dialog).getByLabelText("旧版记录");
    expect(legacy.textContent).toContain("71/100");
    expect(legacy.textContent).not.toContain("legacy-v2-report");
    expect(legacy.textContent).not.toContain("2.0.0");
    fireEvent.click(within(dialog).getByRole("button", { name: "加载更多" }));
    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);
  });

  it("uses the RAG bottom sheet for history on mobile and restores focus", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<WebsiteEvaluationWorkspace {...props()} />);
    const opener = screen.getByRole("button", { name: "评估历史" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "评估历史" });
    expect(dialog.querySelector(".rag-answer-window__sheet-handle")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭评估面板" }));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("reuses the RAG sheet for one repair review and restores focus to its exact trigger", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const second = {
      id: "finding-second",
      title: "第二条修复计划",
      summary: "只评审这一条。",
      severity: "medium" as const,
      target: { kind: "knowledge" as const },
      repairItem: { kind: "finding" as const, id: "finding-second" },
    };
    render(<WebsiteEvaluationWorkspace {...props({ risks: [props().risks[0], second], onManualReview: vi.fn(async () => undefined) })} />);
    const secondRow = screen.getByText("第二条修复计划").closest(".wev-repair-item") as HTMLElement;
    const opener = within(secondRow).getByRole("button", { name: "评审" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "评审反馈" });
    const close = within(dialog).getByRole("button", { name: "关闭评估面板" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).getByText("第二条修复计划")).toBeTruthy();
    const feedback = within(dialog).getByLabelText("评审反馈");
    const maximize = within(dialog).getByRole("button", { name: "放大窗口" });
    feedback.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(maximize);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(feedback);

    expect(dialog.querySelector(".rag-answer-window__sheet-handle")).toBeTruthy();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog", { name: "评审反馈" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(opener);
  });

  it("scopes review history and submissions to one repair item", async () => {
    const onManualReview = vi.fn(async () => undefined);
    render(<WebsiteEvaluationWorkspace {...props({
      reviews: [{
        reviewId: "review-1",
        reviewerLabel: "复核人 #7",
        dispositionLabel: "需要调整",
        disposition: "concerns",
        repairItem: { kind: "critical_risk", id: "risk-1" },
        note: "请复核移动端证据。",
        createdAt: "2026-11-08T01:00:00.000Z",
      }, {
        reviewId: "review-other",
        reviewerLabel: "复核人 #8",
        dispositionLabel: "认可计划",
        disposition: "agree",
        repairItem: { kind: "finding", id: "another-item" },
        note: "不应出现在当前计划。",
        createdAt: "2026-11-08T02:00:00.000Z",
      }, {
        reviewId: "review-legacy",
        reviewerLabel: "复核人 #9",
        dispositionLabel: "存在疑问",
        note: "旧的报告级复核也不应混入。",
        createdAt: "2026-11-08T03:00:00.000Z",
      }],
      onManualReview,
    })} />);

    const riskRow = screen.getByText("核心任务在移动端中断").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(riskRow).getByRole("button", { name: "评审" }));
    const dialog = screen.getByRole("dialog", { name: "评审反馈" });
    expect(within(dialog).getByText("请复核移动端证据。")).toBeTruthy();
    expect(within(dialog).getByText("评审人", { exact: false })).toBeTruthy();
    expect(dialog.textContent).not.toContain("复核人 #7");
    expect(within(dialog).queryByText("不应出现在当前计划。")).toBeNull();
    expect(within(dialog).queryByText("旧的报告级复核也不应混入。")).toBeNull();
    expect((within(dialog).getByLabelText("评审反馈") as HTMLTextAreaElement).maxLength).toBe(4000);
    const save = within(dialog).getByRole("button", { name: "保存反馈" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect((within(dialog).getByRole("radio", { name: "需要调整" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: "不采纳" }));
    fireEvent.change(within(dialog).getByLabelText("评审反馈"), { target: { value: "补充复核说明" } });
    fireEvent.click(save);
    await act(async () => { await Promise.resolve(); });
    expect(onManualReview).toHaveBeenCalledWith({
      repairItem: { kind: "critical_risk", id: "risk-1" },
      disposition: "reject",
      note: "补充复核说明",
    });
    expect(within(dialog).getByText("评审反馈已保存。")).toBeTruthy();
  });

  it("keeps per-item review feedback intact when saving fails", async () => {
    const onManualReview = vi.fn(async () => { throw new Error("暂时保存失败"); });
    render(<WebsiteEvaluationWorkspace {...props({ onManualReview })} />);
    const row = screen.getByText("核心任务在移动端中断").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "评审" }));
    const dialog = screen.getByRole("dialog", { name: "评审反馈" });
    const feedback = within(dialog).getByLabelText("评审反馈") as HTMLTextAreaElement;
    fireEvent.change(feedback, { target: { value: "需要保留的反馈" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存反馈" }));
    await act(async () => { await Promise.resolve(); });
    expect(within(dialog).getByRole("alert").textContent).toBe("暂时保存失败");
    expect(feedback.value).toBe("需要保留的反馈");
    expect(onManualReview).toHaveBeenCalledWith({
      repairItem: { kind: "critical_risk", id: "risk-1" },
      disposition: "concerns",
      note: "需要保留的反馈",
    });
  });

  it("submits one review for rapid duplicate clicks", async () => {
    let resolveReview: (() => void) | undefined;
    const onManualReview = vi.fn(() => new Promise<void>((resolve) => {
      resolveReview = resolve;
    }));
    render(<WebsiteEvaluationWorkspace {...props({ onManualReview })} />);
    const row = screen.getByText("核心任务在移动端中断").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "评审" }));
    const dialog = screen.getByRole("dialog", { name: "评审反馈" });
    fireEvent.change(within(dialog).getByLabelText("评审反馈"), { target: { value: "只保存一次" } });
    const save = within(dialog).getByRole("button", { name: "保存反馈" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onManualReview).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveReview?.();
      await Promise.resolve();
    });
  });

  it("resets an unsaved draft when the same review is closed and reopened", async () => {
    render(<WebsiteEvaluationWorkspace {...props({ onManualReview: vi.fn(async () => undefined) })} />);
    const row = screen.getByText("核心任务在移动端中断").closest(".wev-repair-item") as HTMLElement;
    const opener = within(row).getByRole("button", { name: "评审" });
    fireEvent.click(opener);
    let dialog = screen.getByRole("dialog", { name: "评审反馈" });
    fireEvent.change(within(dialog).getByLabelText("评审反馈"), { target: { value: "未保存草稿" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭评估面板" }));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    fireEvent.click(opener);
    dialog = screen.getByRole("dialog", { name: "评审反馈" });
    expect((within(dialog).getByLabelText("评审反馈") as HTMLTextAreaElement).value).toBe("");
  });

  it("resets form state when switching to another repair item", () => {
    const second = {
      id: "finding-second-desktop",
      title: "另一条修复计划",
      summary: "使用独立评审草稿。",
      severity: "medium" as const,
      target: { kind: "knowledge" as const },
      repairItem: { kind: "finding" as const, id: "finding-second-desktop" },
    };
    render(<WebsiteEvaluationWorkspace {...props({
      risks: [props().risks[0], second],
      onManualReview: vi.fn(async () => undefined),
    })} />);
    const firstRow = screen.getByText("核心任务在移动端中断").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(firstRow).getByRole("button", { name: "评审" }));
    let dialog = screen.getByRole("dialog", { name: "评审反馈" });
    fireEvent.change(within(dialog).getByLabelText("评审反馈"), { target: { value: "第一条草稿" } });
    const secondRow = screen.getByText("另一条修复计划").closest(".wev-repair-item") as HTMLElement;
    fireEvent.click(within(secondRow).getByRole("button", { name: "评审" }));
    dialog = screen.getByRole("dialog", { name: "评审反馈" });
    expect(within(dialog).getByText("另一条修复计划")).toBeTruthy();
    expect((within(dialog).getByLabelText("评审反馈") as HTMLTextAreaElement).value).toBe("");
    expect((within(dialog).getByRole("radio", { name: "需要调整" }) as HTMLInputElement).checked).toBe(true);
  });
});
