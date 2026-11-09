import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../standalone/App";
import {
  WEBSITE_EVALUATION_PREVIEW_COORDINATES,
  WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS,
} from "../../standalone/website-evaluation-preview";

function installMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/?view=website&step=evaluation");
  installMatchMedia(false);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("unexpected network request"))));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("standalone website evaluation preview", () => {
  it("opens the local immutable report route without reading the live API", async () => {
    window.history.replaceState(
      {},
      "",
      `/?view=website&websiteReport=${WEBSITE_EVALUATION_PREVIEW_COORDINATES.reportId}`,
    );

    render(<App preview />);

    expect((await screen.findByTestId("website-report-score")).textContent).toBe("88");
    expect(screen.getAllByTestId("website-report-anchor")).toHaveLength(24);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a complete authority report by default without making a request", async () => {
    render(<App preview />);

    await waitFor(() => expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("88"));
    expect(screen.getByTestId("website-evaluation-radar")).toBeTruthy();
    expect(screen.getAllByTestId("website-evaluation-radar-label")).toHaveLength(6);
    expect(screen.getByText("助手可能泄露内部交付备注")).toBeTruthy();
    expect(screen.getByText(/总分达到建议线/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the disabled local review state as a neutral gauge, status, and radar", () => {
    window.history.replaceState(
      {},
      "",
      "/?view=website&step=evaluation&evaluationStage=disabled",
    );

    render(<App preview />);

    expect(screen.queryByText("建设评估当前未启用或不展示")).toBeNull();
    expect(screen.getByTestId("website-evaluation-score").classList.contains("is-empty")).toBe(true);
    expect(screen.queryByTestId("website-evaluation-gauge-value")).toBeNull();
    expect(within(screen.getByTestId("website-evaluation-conclusion"))
      .getByRole("status").textContent).toBe("暂无评估");
    expect(screen.getByTestId("website-evaluation-radar")).toBeTruthy();
    expect(screen.queryByTestId("website-evaluation-radar-area")).toBeNull();
    expect(screen.getAllByTestId("website-evaluation-radar-marker")
      .every((marker) => marker.classList.contains("is-empty"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps preview review feedback in memory and scoped to the selected repair item", async () => {
    render(<App preview />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "评审" })).toHaveLength(5));
    fireEvent.click(screen.getAllByRole("button", { name: "评审" })[1]);

    const dialog = await screen.findByRole("dialog", { name: "评审反馈" });
    const scoped = within(dialog);
    expect(scoped.getByText("这条计划还没有评审反馈。")).toBeTruthy();
    fireEvent.click(scoped.getByRole("radio", { name: "认可计划" }));
    fireEvent.change(scoped.getByLabelText("评审反馈"), {
      target: { value: "本地预览已确认扩大移动端按钮。" },
    });
    fireEvent.click(scoped.getByRole("button", { name: "保存反馈" }));

    await waitFor(() => expect(
      scoped.getByText("本地预览已确认扩大移动端按钮。"),
    ).toBeTruthy());
    expect(within(scoped.getByRole("region", { name: "评审反馈历史" }))
      .getByText("认可计划")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("can freeze a running stage without numeric or radar placeholders", () => {
    window.history.replaceState(
      {},
      "",
      "/?view=website&step=evaluation&evaluationStage=queued",
    );
    const view = render(<App preview />);

    const waiting = screen.getByTestId("website-evaluation-waiting");
    expect(waiting.getAttribute("role")).toBe("status");
    expect(waiting.textContent).toContain("评估已排队");
    expect(waiting.textContent).not.toContain("—");
    expect(waiting.textContent).not.toContain("0/100");
    expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
    expect(screen.queryByTestId("website-evaluation-radar")).toBeNull();
    expect(view.container.querySelector(".wev-coverage")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("plays the successful authority lifecycle through to the completed report", () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      "/?view=website&step=evaluation&evaluationDemo=flow",
    );
    render(<App preview />);

    expect(screen.getByTestId("website-evaluation-waiting").textContent).toContain("评估已排队");
    act(() => {
      vi.advanceTimersByTime(WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS);
    });
    expect(screen.getByTestId("website-evaluation-waiting").textContent).toContain("正在采集评估证据");
    act(() => {
      vi.advanceTimersByTime(WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS * 3);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("88");
    expect(screen.getByRole("link", { name: "生成报告" }).getAttribute("href")).toContain(
      `websiteReport=${WEBSITE_EVALUATION_PREVIEW_COORDINATES.reportId}`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-evaluates a changed local draft through every stage and keeps the previous report", async () => {
    vi.useFakeTimers();
    render(<App preview />);

    fireEvent.click(screen.getByRole("button", { name: /网站设计$/ }));
    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "FrontMind 新版官网" },
    });
    expect((screen.getByRole("button", { name: /建设评估$/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "FrontMind 可以帮企业做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    fireEvent.click(screen.getByRole("button", { name: "开始评估" }));
    const running = screen.getByRole("button", { name: "正在生成" });
    expect(running.classList.contains("is-running")).toBe(true);
    expect(running.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS * 4);
    });

    const evaluationStep = screen.getByRole("button", { name: /建设评估$/ }) as HTMLButtonElement;
    expect(evaluationStep.disabled).toBe(false);
    fireEvent.click(evaluationStep);
    expect(screen.getByRole("link", { name: "生成报告" }).getAttribute("href"))
      .toContain("websiteReport=report-local-authority-recheck-1");
    fireEvent.click(screen.getByRole("button", { name: "评估历史" }));
    const history = screen.getByRole("dialog", { name: "评估历史" });
    expect(within(history).getAllByRole("cell").some((cell) => cell.textContent === "88/100")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips autoplay timing when Reduced Motion is enabled", () => {
    installMatchMedia(true);
    window.history.replaceState(
      {},
      "",
      "/?view=website&step=evaluation&evaluationDemo=flow",
    );
    render(<App preview />);

    expect(screen.queryByTestId("website-evaluation-waiting")).toBeNull();
    expect(screen.getByTestId("website-evaluation-gauge-value").textContent).toBe("88");
    expect(fetch).not.toHaveBeenCalled();
  });
});
