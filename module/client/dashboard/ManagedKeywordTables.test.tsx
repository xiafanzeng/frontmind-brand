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
  it("推荐保存单独显示两条，历史保留160条并分页，选择交接实际推荐坐标", () => {
    const onUseQuestions = vi.fn();
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={onUseQuestions}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    fireEvent.change(screen.getByRole("combobox", {name: "词条来源"}), {target: {value: "recommended"}});
    expect(screen.getByText("新推荐问题")).toBeTruthy();
    expect(screen.queryByText("历史问题0")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", {name: "选择新推荐问题"}));
    fireEvent.click(screen.getByRole("button", {name: "批量加入优化清单（1）"}));
    expect(onUseQuestions).toHaveBeenCalledWith([{question: "新推荐问题", category: "industry", tableId: "question-template-api:v1", rowIndex: 0}]);
    fireEvent.change(screen.getByRole("combobox", {name: "词条来源"}), {target: {value: "history"}});
    expect(screen.getByText("历史问题0")).toBeTruthy();
    expect(screen.queryByText("历史问题20")).toBeNull();
    expect(screen.getByText("1 / 8 页")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "下一页"}));
    expect(screen.getByText("历史问题20")).toBeTruthy();
    expect(screen.queryByText("历史问题0")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", {name: "词条来源"}), {target: {value: "recommended"}});
    expect(screen.getByRole("checkbox", {name: "选择新推荐问题"})).toHaveProperty("checked", true);
  });
  it("来源词条被优化改写后仍能找到已有评分并直接查看", () => {
    const state = emptyIntentState(), onViewEvaluation = vi.fn();
    state.questions.push({id: "saved-1", question: "改写后的推荐问题", tableId: "question-template-api:v1", rowIndex: 0,
      category: "industry", subdivision: "", sourceRevision: 6});
    state.evaluations.push({questionId: "saved-1", value: 70, support: 64, method: "skill_v1", dimensions: [], points: [], findings: [], evaluatedAt: "2026-10-28T00:00:00Z"});
    render(<ManagedKeywordTables tables={tables} generationEnabled onUseQuestions={vi.fn()} optimizationState={state} onViewEvaluation={onViewEvaluation}/>);
    fireEvent.click(screen.getByRole("button", {name: /已保存词条 162/}));
    expect(screen.getByText("价值 70 · 支撑 64")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "查看评估：新推荐问题"}));
    expect(onViewEvaluation).toHaveBeenCalledWith("saved-1");
  });
});
