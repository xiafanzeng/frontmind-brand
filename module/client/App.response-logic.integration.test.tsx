import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../../standalone/App";
import { createIntentPreviewApi } from "../../standalone/intent-preview";
import type { IntentQuestion } from "../contracts/intent-workbench";

/**
 * Full production navigation chain with only the 2,700-line workbench leaf
 * replaced by a probe: App → Runtime → ModuleWorkspace → IntentWorkbench →
 * IntentQuestionCatalog (click) → wouter navigation → ModuleWorkspace
 * (response-logic page) → BrandResponseLogicEntry → ResponseLogicWorkspace.
 * The standalone shell runs in preview mode so the question ledger is the
 * real localStorage-backed preview api instead of network mocks.
 */
vi.mock("./ResponseLogicWorkspace", () => ({
  default: ({ initialQuestionId, questionGroups, onReturnToCatalog }: {
    initialQuestionId?: string | null;
    onReturnToCatalog?: () => void;
    questionGroups?: Array<{ questions: Array<{ id: string; question: string }> }>;
  }) => (
    <section aria-label={`rl-workspace:${initialQuestionId ?? "none"}`}>
      <button onClick={onReturnToCatalog}>返回候选问题</button>
      工作台问题：{questionGroups?.[0]?.questions?.[0]?.question ?? "无"}
    </section>
  ),
}));

const seedQuestion: IntentQuestion = {
  id: "t:9",
  question: "导航测试：隆鼻材料应该怎么选",
  category: "产品场景词",
  subdivision: "场景方案",
  tableId: "t",
  rowIndex: 9,
  sourceRevision: 1,
};

// jsdom does not implement matchMedia; the vendor shell probes it on mount.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
if (typeof Element !== "undefined") {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
}

beforeEach(async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  // Seed the question ledger through the same preview api the app will use
  // (createIntentPreviewApi persists to localStorage under the workspace id).
  const api = createIntentPreviewApi("brand-local-preview");
  const seeded = await api.command({
    kind: "intake",
    expectedRevision: 0,
    questions: [seedQuestion],
  });
  await api.command({kind: "evaluate", expectedRevision: seeded.revision, questionIds: [seedQuestion.id]});
});

afterEach(cleanup);

describe("standalone response-logic navigation (integration)", () => {
  it("uses the same spaced AI website label as the formal dashboard", async () => {
    window.history.replaceState({}, "", "/?view=enterprise-qa");
    render(<App preview />);

    expect((await screen.findByRole("button", { name: "AI 专用官网" })).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "AI专用官网" })).toBeNull();
  });

  it("returns from the workbench to the same filtered catalog selection", async () => {
    window.history.replaceState({}, "", "/?view=intent");
    render(<App preview />);

    const search = await screen.findByRole("textbox", {name:"搜索优化问题"});
    fireEvent.change(search,{target:{value:"隆鼻"}});
    expect(screen.queryByRole("combobox", {name:"问题分类"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name:"按知识支撑从低到高排列"}));
    const selected = screen.getByRole("checkbox",{name:`选择${seedQuestion.question}`});
    fireEvent.click(selected);
    const enter = within(selected.closest("tr")!).getByRole("button", { name: "进入应答逻辑" });
    expect((enter as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enter);

    await waitFor(() => expect(window.location.search).toBe("?view=response-logic"));
    const workspace = await screen.findByLabelText("rl-workspace:t:9");
    expect(workspace.textContent).toContain("隆鼻材料应该怎么选");

    fireEvent.click(screen.getByRole("button", { name: "返回候选问题" }));
    await waitFor(() => expect(window.location.search).toBe("?view=intent"));
    expect(await screen.findByRole("checkbox", {name:`选择${seedQuestion.question}`})).toHaveProperty("checked",true);
    expect(screen.getByRole("textbox", {name:"搜索优化问题"})).toHaveProperty("value","隆鼻");
    expect(screen.queryByRole("combobox", {name:"问题分类"})).toBeNull();
    expect(screen.getByRole("button", {name:"按知识支撑从低到高排列"}).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("checkbox", {name:`选择${seedQuestion.question}`})).toHaveProperty("checked",true);
  });

  it("opens the catalog directly after an orphan answer route, including a reload", async () => {
    window.history.replaceState({}, "", "/?view=response-logic");
    const view = render(<App preview />);
    await waitFor(() => expect(window.location.search).toBe("?view=intent"));
    expect(await screen.findByRole("textbox", {name:"搜索优化问题"})).toBeTruthy();
    expect(screen.queryByText(/请从「优化问题」列表中选择问题/)).toBeNull();
    view.unmount();
    render(<App preview />);
    expect(await screen.findByRole("checkbox", {name:`选择${seedQuestion.question}`})).toBeTruthy();
    expect(window.location.search).toBe("?view=intent");
  });

  it.each(["keywords", "intent"] as const)("opens and remounts %s without going through the other page", async page => {
    window.history.replaceState({}, "", `/?view=${page}`);
    const view = render(<App preview />);
    const findPage = () => page === "keywords"
      ? screen.findByRole("textbox", {name:"企业名称"})
      : screen.findByRole("textbox", {name:"搜索优化问题"});
    expect(await findPage()).toBeTruthy();
    expect(window.location.search).toBe(`?view=${page}`);
    view.unmount();
    render(<App preview />);
    expect(await findPage()).toBeTruthy();
    expect(window.location.search).toBe(`?view=${page}`);
    expect(screen.queryByText(/请从「优化问题」列表中选择问题/)).toBeNull();
  });
});
