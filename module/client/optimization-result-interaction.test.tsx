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
    for (const checkbox of screen.getAllByRole("checkbox"))
      fireEvent.click(checkbox);
    expect(
      (
        screen.getByRole("button", {
          name: "采用选中项到草稿",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("采用用户真实关心"));
    fireEvent.change(screen.getByLabelText("编辑用户真实关心"), {
      target: { value: "人工审阅后的关注" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "核心结论与执行口径" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "用户真实关心" }),
    );
    expect(
      (screen.getByLabelText("编辑用户真实关心") as HTMLTextAreaElement).value,
    ).toBe("人工审阅后的关注");
    const adopt = screen.getByRole("button", { name: "采用选中项到草稿" });
    fireEvent.click(adopt);
    fireEvent.click(adopt);
    expect(onAdopt).toHaveBeenCalledOnce();
    expect(onAdopt).toHaveBeenCalledWith({ concern: "人工审阅后的关注" });
  });
  it("displays a summary-only response without inventing reasons", () => {
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
    expect(screen.getByText("服务端原始摘要")).toBeTruthy();
    expect(screen.queryByText("主要优化建议与修改依据")).toBeNull();
  });
});
