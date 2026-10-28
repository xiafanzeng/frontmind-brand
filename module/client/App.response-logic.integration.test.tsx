import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  default: ({ initialQuestionId, questionGroups }: {
    initialQuestionId?: string | null;
    questionGroups?: Array<{ questions: Array<{ id: string; question: string }> }>;
  }) => (
    <section aria-label={`rl-workspace:${initialQuestionId ?? "none"}`}>
      工作台问题：{questionGroups?.[0]?.questions?.[0]?.question ?? "无"}
    </section>
  ),
}));

const seedQuestion: IntentQuestion = {
  id: "t:9",
  question: "隆鼻材料应该怎么选",
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
  it("enters the workbench from the question list and returns via the sidebar", async () => {
    window.history.replaceState({}, "", "/?view=intent");
    render(<App preview />);

    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${seedQuestion.question}`}));
    const enter = screen.getByRole("button", { name: "进入应答逻辑" });
    expect((enter as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enter);

    await waitFor(() => expect(window.location.search).toBe("?view=response-logic"));
    const workspace = screen.getByLabelText("rl-workspace:t:9");
    expect(workspace.textContent).toContain("隆鼻材料应该怎么选");

    // The workbench itself has no back button (Brand shell pages navigate via
    // the sidebar); returning re-opens the question list.
    fireEvent.click(screen.getByRole("button", { name: "优化问题" }));
    await waitFor(() => expect(window.location.search).toBe("?view=intent"));
    expect(await screen.findByRole("button", { name: `查看评估：${seedQuestion.question}` })).toBeTruthy();
  });

  it("guards a direct /?view=response-logic visit without question context", () => {
    window.history.replaceState({}, "", "/?view=response-logic");
    render(<App preview />);
    expect(screen.getByText(/请从「优化问题」列表中选择问题/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回优化问题" }));
    expect(window.location.search).toBe("?view=intent");
  });
});
