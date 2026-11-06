import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseLogicOptimizationWorkflow } from "./response-logic/optimization-workflow";
import type { OptimizationOutput } from "../contracts/response-logic-optimization";
const original = {
  concern: "原关注",
  conclusion: "原结论",
  facts: "原依据",
  boundaries: "原边界",
};
const candidate: OptimizationOutput = {
  kind: "judge-optimization",
  summary: "服务端原始摘要",
  optimizedDraft: {
    concern: "新关注",
    conclusion: "新结论",
    facts: "新依据",
    boundaries: "新边界",
  },
  changes: [
    { field: "concern", summary: "服务端给出的修改原因", evidence: [] },
    { field: "facts", summary: "仅补充可核验的来源", evidence: [{source:"draft",excerpt:"原依据",supports:"绑定来源"}] },
  ],
};
afterEach(cleanup);
describe("candidate review uses the existing adoption callback", () => {
  it("does not adopt on completion, supports keeping originals and submits only selected edited text once", () => {
    const onAdopt = vi.fn();
    render(
      <ResponseLogicOptimizationWorkflow
        question="问题"
        intent=""
        logic={original}
        judgeTaskId="judge"
        optimization={{
          state: {
            phase: "completed",
            taskId: "optimizer",
            result: candidate,
            error: "",
            errorCode: "",
          },
          start: vi.fn(),
          reset: vi.fn(),
        }}
        onAdopt={onAdopt}
        onBack={vi.fn()}
      />,
    );
    expect(onAdopt).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("tab",{name:"用户真实关心"}),{key:"ArrowRight"});
    expect(screen.getByRole("tab",{name:"核心结论与执行口径"})).toHaveProperty("tabIndex",0);
    fireEvent.keyDown(screen.getByRole("tab",{name:"核心结论与执行口径"}),{key:"ArrowRight"});
    expect(screen.getByRole("tabpanel",{name:"企业材料与官方依据"})).toBeTruthy();
    expect(screen.getByText("仅补充可核验的来源")).toBeTruthy();
    expect(screen.getByText("仅补充可核验的来源").closest("details")).toHaveProperty("open",false);
    expect(screen.queryByText("服务端给出的修改原因")).toBeNull();
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      fireEvent.click(screen.getByRole("button", {name:"保持原文"}));
    }
    expect(screen.getByRole("button", {name:"采用选中项到草稿"})).toHaveProperty("disabled",true);
    fireEvent.click(screen.getByRole("tab", {name:"用户真实关心"}));
    fireEvent.click(screen.getByRole("button", {name:"采用候选"}));
    fireEvent.change(screen.getByLabelText("编辑用户真实关心"), {
      target: { value: "人工审阅后的关注" },
    });
    fireEvent.click(
      screen.getByRole("tab", { name: "核心结论与执行口径" }),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: "用户真实关心" }),
    );
    expect(
      (screen.getByLabelText("编辑用户真实关心") as HTMLTextAreaElement).value,
    ).toBe("人工审阅后的关注");
    const adopt = screen.getByRole("button", { name: "采用选中项到草稿" });
    fireEvent.click(adopt);
    expect(onAdopt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"取消"}));
    expect(onAdopt).not.toHaveBeenCalled();
    fireEvent.click(adopt);
    const confirm=screen.getByRole("button",{name:"确认采用"});
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onAdopt).toHaveBeenCalledOnce();
    expect(onAdopt).toHaveBeenCalledWith({ concern: "人工审阅后的关注" });
  });
  it("hides summary without changing a summary-only server response", () => {
    render(
      <ResponseLogicOptimizationWorkflow
        question="问题"
        intent=""
        logic={original}
        judgeTaskId="judge"
        optimization={{
          state: {
            phase: "completed",
            taskId: "optimizer",
            result: { ...candidate, changes: [] },
            error: "",
            errorCode: "",
          },
          start: vi.fn(),
          reset: vi.fn(),
        }}
        onAdopt={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText("服务端原始摘要")).toBeNull();
    expect(screen.queryByRole("heading", {name:"优化摘要"})).toBeNull();
    expect(screen.getAllByRole("tab").map(tab=>tab.textContent)).toEqual(["用户真实关心","核心结论与执行口径","企业材料与官方依据","回答边界与禁止表达"]);
    expect(screen.getAllByRole("tab").every(tab=>tab.querySelector("svg")===null)).toBe(true);
    expect(screen.queryByText("主要优化建议与修改依据")).toBeNull();
  });
});
