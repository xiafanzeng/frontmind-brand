import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ModuleWorkspace, { type ModuleContext } from "./ModuleWorkspace";
import type { IntentCatalogIntegration } from "./dashboard/IntentQuestionCatalog";
import type { IntentQuestion } from "../contracts/intent-workbench";

const selectedQuestion: IntentQuestion = {
  id: "t:3",
  question: "隆鼻材料应该怎么选",
  category: "产品场景词",
  subdivision: "场景方案",
  tableId: "t",
  rowIndex: 3,
  sourceRevision: 1,
};

vi.mock("./BrandResponseLogicEntry", () => ({
  default: ({ question, onBack }: { question: IntentQuestion; onBack: () => void }) => (
    <section aria-label={`response-logic:${question.id}`}>
      <span>{question.question}</span>
      <button type="button" onClick={onBack}>返回问题列表</button>
    </section>
  ),
}));

vi.mock("./dashboard/IntentWorkbench", () => ({
  default: ({ catalogIntegration }: { catalogIntegration?: IntentCatalogIntegration }) => (
    <section aria-label="intent-workbench">
      <button
        type="button"
        disabled={!catalogIntegration?.onOpenAnswer}
        onClick={() => catalogIntegration?.onOpenAnswer?.(selectedQuestion)}
      >
        进入应答逻辑
      </button>
    </section>
  ),
}));

const context: ModuleContext = {
  module: "brand",
  workspace: { id: "workspace-1", ownerUserId: 1 },
  capabilities: ["brand"],
};
const keywordData = { tables: [], revision: null };

afterEach(cleanup);

describe("response-logic entry navigation", () => {
  it("keeps the selected question and enters the workbench across the page switch", () => {
    const onEnterResponseLogic = vi.fn();
    const onResponseLogicBack = vi.fn();
    const view = render(
      <ModuleWorkspace
        context={context}
        page="intent"
        keywordData={keywordData}
        onEnterResponseLogic={onEnterResponseLogic}
        onResponseLogicBack={onResponseLogicBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "进入应答逻辑" }));
    expect(onEnterResponseLogic).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/response-logic:/)).toBeNull();

    // The standalone host answers onEnterResponseLogic by navigating to
    // /?view=response-logic; the same component instance must keep the
    // stored question and render the workbench entry for it.
    view.rerender(
      <ModuleWorkspace
        context={context}
        page="response-logic"
        keywordData={keywordData}
        onEnterResponseLogic={onEnterResponseLogic}
        onResponseLogicBack={onResponseLogicBack}
      />,
    );
    const entry = screen.getByLabelText("response-logic:t:3");
    expect(entry.textContent).toContain("隆鼻材料应该怎么选");

    fireEvent.click(within(entry).getByRole("button", { name: "返回问题列表" }));
    expect(onResponseLogicBack).toHaveBeenCalledTimes(1);
    view.rerender(
      <ModuleWorkspace
        context={context}
        page="intent"
        keywordData={keywordData}
        onEnterResponseLogic={onEnterResponseLogic}
        onResponseLogicBack={onResponseLogicBack}
      />,
    );
    expect(screen.getByRole("button", { name: "进入应答逻辑" })).toBeTruthy();
  });

  it("shows a guarded hint when the workbench is opened without a question", () => {
    const onResponseLogicBack = vi.fn();
    render(
      <ModuleWorkspace
        context={context}
        page="response-logic"
        keywordData={keywordData}
        onResponseLogicBack={onResponseLogicBack}
      />,
    );
    const status = screen.getByRole("status");
    const backButton = screen.getByRole("button", { name: "返回优化问题" });
    expect(status.textContent).toContain("请从「优化问题」列表中选择问题");
    expect(status.classList.contains("fm-brand-empty-state")).toBe(true);
    expect(status.getAttribute("style")).toBeNull();
    expect(backButton.classList.contains("fm-brand-button")).toBe(true);
    expect(backButton.classList.contains("fm-brand-button--secondary")).toBe(true);
    expect(backButton.getAttribute("style")).toBeNull();
    fireEvent.click(backButton);
    expect(onResponseLogicBack).toHaveBeenCalledTimes(1);
  });
});
