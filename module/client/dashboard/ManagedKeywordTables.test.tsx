import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {useState} from "react";
import {emptyIntentState} from "../../contracts/intent-workbench";
vi.mock("./BusinessWorkspaceContext", () => ({
  useBusinessWorkspace: () => ({isWorkbench: false}), useBusinessWorkspaceSummary: vi.fn(),
}));
vi.mock("./useBusinessFlowState", () => ({
  useBusinessFlowState: (_key: string, value: string) => useState(value), readFlowString: vi.fn(),
}));
vi.mock("../api-hooks", () => ({trpc: {useUtils: () => ({workspace: {dashboard: {invalidate: vi.fn()}}})}}));
vi.mock("./QuestionTemplateApiFlow", () => ({default: () => <div>推荐生成入口</div>}));
import ManagedKeywordTables from "./ManagedKeywordTables";

afterEach(cleanup);
const tables = [
  {id: "legacy", title: "品牌全域词库", columns: ["问题", "核心词分类"], rows: Array.from({length: 160}, (_, i) => [`历史问题${i}`, "行业排名词"])},
  {id: "question-template-api:v1", title: "已保存的推荐问题", columns: ["问题", "核心词分类"], rows: [["新推荐问题", "行业排名词"], ["第二条推荐问题", "美誉舆情词"]]},
];
describe("推荐保存与历史词库", () => {
  it("已保存词条合并展示来源，历史保留160条并分页，选择交接实际推荐坐标", () => {
    const onUseQuestions = vi.fn();
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={onUseQuestions}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    expect(screen.queryByRole("combobox", {name: "词条来源"})).toBeNull();
    expect(screen.getByText("新推荐问题")).toBeTruthy();
    expect(screen.getByText("历史问题0")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", {name: "选择新推荐问题"}));
    fireEvent.click(screen.getByRole("button", {name: "批量加入优化清单（1）"}));
    expect(onUseQuestions).toHaveBeenCalledWith([{question: "新推荐问题", category: "industry", tableId: "question-template-api:v1", rowIndex: 0}]);
    expect(screen.getByText("历史问题0")).toBeTruthy();
    expect(screen.queryByText("历史问题20")).toBeNull();
    expect(screen.getByText("1 / 8 页")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", {name: "下一页"})[0]);
    expect(screen.getByText("历史问题20")).toBeTruthy();
    expect(screen.queryByText("历史问题0")).toBeNull();
    expect(screen.getByRole("checkbox", {name: "选择新推荐问题"})).toHaveProperty("checked", true);
  });
  it("来源词条被优化改写后仍能找到已有评分并直接查看", () => {
    const state = emptyIntentState(), onViewEvaluation = vi.fn();
    state.questions.push({id: "saved-1", question: "改写后的推荐问题", tableId: "question-template-api:v1", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    state.evaluations.push({questionId: "saved-1", value: 70, support: 64, method: "skill_v1", dimensions: [], points: [], findings: [], evaluatedAt: "2026-10-28T00:00:00Z"});
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={vi.fn()} optimizationState={state} onViewEvaluation={onViewEvaluation}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    const score = screen.getByRole("button", {name: "查看评估：新推荐问题"});
    expect(score.textContent).toBe("价值70支撑64");
    expect(screen.getByRole("checkbox", {name: "选择新推荐问题"})).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("button", {name: "查看评估：新推荐问题"}));
    expect(onViewEvaluation).toHaveBeenCalledWith("saved-1");
    expect(screen.getByRole("checkbox", {name: "选择新推荐问题"})).toHaveProperty("checked", false);
  });
  it.each([false, true])("未加入或已加入但未评估的词条都可直接评估，且不切换行选择（已加入：%s）", linked => {
    const state = emptyIntentState(), onEvaluateQuestion = vi.fn(), onUseQuestions = vi.fn();
    if (linked) state.questions.push({id: "saved-1", question: "新推荐问题", tableId: "question-template-api:v1", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    render(<ManagedKeywordTables tables={tables} generationEnabled dashboardRevision={6} onUseQuestions={onUseQuestions}
      optimizationState={state} onEvaluateQuestion={onEvaluateQuestion}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    const checkbox = screen.getByRole("checkbox", {name: "选择新推荐问题"});
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", {name: "评估问题：新推荐问题"}));
    expect(onEvaluateQuestion).toHaveBeenCalledWith({question: "新推荐问题", category: "industry", tableId: "question-template-api:v1", rowIndex: 0, dashboardRevision: 6});
    expect(checkbox).toHaveProperty("checked", true);
    expect(onUseQuestions).not.toHaveBeenCalled();
  });
  it("同一问题正在评估时显示任务状态，阻止重复点击评估", () => {
    const state = emptyIntentState(), onEvaluateQuestion = vi.fn();
    state.questions.push({id: "saved-1", question: "新推荐问题", tableId: "question-template-api:v1", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    state.jobs = [{id: "job-1", kind: "evaluate", status: "running", questionIds: ["saved-1"]} as any];
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={vi.fn()} optimizationState={state}
      onEvaluateQuestion={onEvaluateQuestion}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    const button = screen.getByRole("button", {name: "评估问题：新推荐问题"});
    expect(button.textContent).toBe("评估中…");
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onEvaluateQuestion).not.toHaveBeenCalled();
  });
  it("慢速提交只标记目标行，其他未评分行保持评估按钮，历史分数仍可查看", () => {
    const state = emptyIntentState(), onViewEvaluation = vi.fn();
    state.questions.push({id: "old-score", question: "历史问题0", tableId: "legacy", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    state.evaluations.push({questionId: "old-score", value: 70, support: 64, method: "skill_v1",
      dimensions: [], points: [], findings: [], evaluatedAt: "2026-10-28T00:00:00Z"});
    const props = {tables, generationEnabled: true, onUseQuestions: vi.fn(), optimizationState: state,
      onEvaluateQuestion: vi.fn(), onViewEvaluation};
    const {rerender} = render(<ManagedKeywordTables {...props} evaluationPending
      evaluationPendingKeyword={{tableId: "question-template-api:v1", rowIndex: 0}}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    fireEvent.click(screen.getByRole("checkbox", {name: "选择第二条推荐问题"}));
    expect(screen.getByRole("button", {name: "评估问题：新推荐问题"}).textContent).toBe("正在处理…");
    const other = screen.getByRole("button", {name: "评估问题：第二条推荐问题"});
    expect(other.textContent).toBe("评估问题");
    expect(other).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", {name: "评估问题：历史问题1"}).textContent).toBe("评估问题");
    // The same row index in a different table must retain its saved score.
    const score = screen.getByRole("button", {name: "查看评估：历史问题0"});
    expect(score.textContent).toBe("价值70支撑64");
    expect(score).toHaveProperty("disabled", false);
    fireEvent.click(score);
    expect(onViewEvaluation).toHaveBeenCalledWith("old-score");
    expect(screen.getByRole("checkbox", {name: "选择第二条推荐问题"})).toHaveProperty("checked", true);
    rerender(<ManagedKeywordTables {...props} evaluationPending/>);
    expect(screen.getByRole("button", {name: "评估问题：新推荐问题"}).textContent).toBe("评估问题");
    rerender(<ManagedKeywordTables {...props}/>);
    expect(screen.getByRole("button", {name: "评估问题：新推荐问题"})).toHaveProperty("disabled", false);
  });
  it.each(["queued", "running", "paused", "pausing", "resuming"])("评估任务可查看详情且不触发评估或行选择（%s）", status => {
    const state = emptyIntentState(), onEvaluateQuestion = vi.fn(), onViewEvaluationTask = vi.fn();
    state.questions.push({id: "saved-1", question: "新推荐问题", tableId: "question-template-api:v1", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    state.jobs = [{id: "job-1", kind: "evaluate", status, questionIds: ["saved-1"]} as any];
    // A re-evaluation must expose the current task even with an older score.
    state.evaluations.push({questionId: "saved-1", value: 70, support: 64, method: "skill_v1", dimensions: [], points: [], findings: [], evaluatedAt: "2026-10-28T00:00:00Z"});
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={vi.fn()} optimizationState={state}
      onEvaluateQuestion={onEvaluateQuestion} onViewEvaluation={vi.fn()} onViewEvaluationTask={onViewEvaluationTask}
      evaluationPending quotaAvailability={{industry: {available: false}}}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    const details = screen.getByRole("button", {name: "查看评估详情：新推荐问题"});
    expect(details).toHaveProperty("disabled", false);
    expect(details.textContent).toContain("查看详情");
    fireEvent.click(details);
    expect(onViewEvaluationTask).toHaveBeenCalledWith("job-1");
    expect(onEvaluateQuestion).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", {name: "选择新推荐问题"})).toHaveProperty("checked", false);
    expect(screen.getByRole("button", {name: "评估问题：第二条推荐问题"})).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", {name: "评估问题：第二条推荐问题"}).textContent).toBe("评估问题");
  });
});
