import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {IntentWorkspace} from "../../contracts/intent-workbench";
import {emptyIntentState} from "../../contracts/intent-workbench";
import type {IntentWorkbenchApi} from "./intent-workbench-api";

vi.mock("../host", () => ({
  useWorkspaceDraftGuard: vi.fn(), projectWorkspaceUrl: (path: string) => path,
  requestWorkspaceNavigation: vi.fn(),
}));
vi.mock("@frontmind/module-ui/components/ui/dialog", () => ({
  Dialog: ({open, children}: any) => open ? children : null,
  DialogContent: ({children}: any) => children, DialogHeader: ({children}: any) => children,
  DialogTitle: ({children}: any) => children, DialogDescription: ({children}: any) => children,
  DialogFooter: ({children}: any) => children,
}));
vi.mock("@frontmind/module-ui/components/MarkdownRenderer", () => ({default: () => null}));
vi.mock("./ManagedKeywordTables", () => ({default: ({onUseQuestions}: any) => <button onClick={() => onUseQuestions([{
  tableId: "table", rowIndex: 0, question: "企业软件如何部署", category: "industry", dashboardRevision: 1,
}])}>交接测试问题</button>}));
vi.mock("./KnowledgeChangeComparison", () => ({default: () => null}));
import IntentWorkbench from "./IntentWorkbench";

const question = {id: "q1", question: "企业软件如何部署", category: "industry", subdivision: "",
  tableId: "table", rowIndex: 0, sourceRevision: 1};
const workspace = (status?: string, kind = "evaluate"): IntentWorkspace => ({
  revision: 1, preview: false, nodes: [],
  state: {...emptyIntentState(), questions: [question], jobs: status ? [{
    id: "job-1", kind, status, questionIds: ["q1"],
  } as any] : [], evaluations: status === "succeeded" ? [{
    questionId: "q1", value: 80, support: 50, method: "skill_v1",
    evaluatedAt: "2026-10-25T00:00:00Z", dimensions: [], points: [], findings: [],
  }] : []},
});
beforeEach(() => {Element.prototype.scrollIntoView = vi.fn();});
afterEach(cleanup);
function pendingApi(initial: IntentWorkspace) {
  let finish!: (value: IntentWorkspace) => void;
  const promise = new Promise<IntentWorkspace>(resolve => {finish = resolve;});
  const api: IntentWorkbenchApi = {
    observe: vi.fn(async () => initial), command: vi.fn(async () => workspace("running")),
    execute: vi.fn(), rollback: vi.fn(), waitForJob: vi.fn(() => promise),
  };
  return {api, finish};
}
describe("优化工作台任务入口", () => {
  it("刷新后恢复正在运行的评估，展示进度并进入完成详情，不重复派发", async () => {
    const {api, finish} = pendingApi(workspace("running"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("heading", {name: "正在评估 1 条问题"});
    expect(api.waitForJob).toHaveBeenCalledWith("job-1", expect.any(Function));
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar", {name: "评估阶段进度"})).toHaveProperty("max", 4);
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getByRole("checkbox", {name: `选择${question.question}`}));
    expect(screen.getByRole("button", {name: "批量评估并优化（1）"})).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", {name: "查看当前任务"}));
    expect(screen.getByRole("heading", {name: "正在评估 1 条问题"})).toBeTruthy();
    await act(async () => finish(workspace("succeeded")));
    await screen.findByText("回答要点支撑矩阵");
    expect(screen.getByRole("button", {name: /生成优化方案/})).toHaveProperty("disabled", false);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("批量评估提交一次后立即显示等待页，完成后有下一步入口", async () => {
    const {api, finish} = pendingApi(workspace());
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("checkbox", {name: `选择${question.question}`}));
    const button = screen.getByRole("button", {name: "批量评估并优化（1）"});
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    await screen.findByRole("heading", {name: "正在评估 1 条问题"});
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "evaluate", questionIds: ["q1"]}));
    await act(async () => finish(workspace("succeeded")));
    await screen.findByRole("button", {name: /生成优化方案/});
  });
  it("刷新后恢复方案生成并在完成时打开已保存的方案", async () => {
    const {api, finish} = pendingApi(workspace("running", "plan"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("heading", {name: "正在生成优化方案"});
    const completed = workspace("succeeded", "plan");
    completed.state.plans = [{questionId: "q1", inputHash: "hash", actions: [{
      id: "action", kind: "todo", nodeId: null, title: "补充部署资料",
      before: "", after: "补充部署证据", source: "资料缺口", selected: true,
    }]}];
    await act(async () => finish(completed));
    await waitFor(() => expect(screen.getByRole("heading", {name: "确认优化方案"})).toBeTruthy());
    expect(screen.getByRole("textbox", {name: "补充部署资料修改后"})).toHaveProperty("value", "补充部署证据");
    expect(api.command).not.toHaveBeenCalled();
  });
  it("已有评估直接打开，下一条沿用已保存结果；重新评估才派发模型", async () => {
    const initial = workspace("succeeded");
    initial.state.questions.push({...question, id: "q2", question: "部署需要哪些条件"});
    initial.state.evaluations.push({...initial.state.evaluations[0], questionId: "q2"});
    const {api, finish} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click((await screen.findAllByRole("button", {name: "查看评估"}))[0]);
    await screen.findByText("回答要点支撑矩阵");
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "下一条"}));
    expect(screen.getByRole("heading", {name: "部署需要哪些条件"})).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "重新评估"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "evaluate", questionIds: ["q2"]})));
    await act(async () => finish(initial));
  });
  it("确认交接后进入进度页，返回列表保留选择，失败保留重试入口", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const received = workspace();
    received.revision = 7;
    received.state.questions = [{...question, id: "table:0"}];
    const running = {...received, state: {...received.state, jobs: [{id: "job-1", kind: "evaluate", status: "running", questionIds: ["table:0"]} as any]}};
    const {api, finish} = pendingApi(initial);
    vi.mocked(api.command).mockResolvedValueOnce(received).mockResolvedValueOnce(running);
    const onSectionChange = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} api={api} onSectionChange={onSectionChange}/>);
    await waitFor(() => expect(api.observe).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    const confirm = await screen.findByRole("button", {name: "确认选择并交给问题优化（1）"});
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
    fireEvent.click(confirm);
    await screen.findByRole("heading", {name: "正在评估 1 条问题"});
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    await screen.findByText("已从品牌全域词库接收 1 条问题");
    expect(screen.getByText("新加入")).toBeTruthy();
    expect(screen.getByRole("checkbox", {name: `选择${question.question}`})).toHaveProperty("checked", true);
    expect(screen.getByRole("columnheader", {name: "主要缺口"})).toBeTruthy();
    expect(onSectionChange).toHaveBeenCalledWith("list");
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2));
    expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({kind: "evaluate", expectedRevision: 7, questionIds: ["table:0"]}));
    const failed = {...running, state: {...running.state, jobs: [{...running.state.jobs[0], status: "failed", error: "模型账户不可用"}]}};
    await act(async () => finish(failed));
    expect(screen.getByRole("heading", {name: "优化问题"})).toBeTruthy();
    expect(screen.getByRole("button", {name: "批量评估并优化（1）"})).toHaveProperty("disabled", false);
    expect(api.command).toHaveBeenCalledTimes(2);
  });
  it("流式更新任务动态时不显示未经校验评分", async () => {
    const initial = workspace("running");
    const {api, finish} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("progressbar");
    const update = vi.mocked(api.waitForJob!).mock.calls[0][1];
    const next = workspace("running");
    next.state.jobs![0].progress = {stage: "analyzing", updatedAt: "2026-10-27T00:00:00Z",
      events: [{id: "public-1", label: "工具处理已返回", at: "2026-10-27T00:00:00Z"}]};
    await act(async () => update(next));
    expect(screen.getByText("工具处理已返回")).toBeTruthy();
    expect(screen.queryByText("回答要点支撑矩阵")).toBeNull();
    await act(async () => finish(workspace("succeeded")));
    await screen.findByText("回答要点支撑矩阵");
  });
  it("批量摘要由真实评估计算，不使用原型里的固定分数", async () => {
    const initial = workspace("succeeded");
    initial.state.questions.push({...question, id: "q2", question: "部署需要哪些条件"});
    initial.state.evaluations.push({...initial.state.evaluations[0], questionId: "q2", value: 60});
    const {api} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("checkbox", {name: "选择当前页问题"}));
    fireEvent.click(screen.getByRole("button", {name: "批量评估并优化（2）"}));
    await screen.findByRole("heading", {name: "批量评估结果"});
    expect(screen.getByText("70 / 100")).toBeTruthy();
    expect(screen.getByRole("button", {name: "批量生成优化方案（2）"})).toHaveProperty("disabled", false);
    expect(api.command).not.toHaveBeenCalled();
  });
});
