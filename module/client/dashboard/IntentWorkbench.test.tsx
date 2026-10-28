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
  it.each(["evaluate", "plan", "receipt"])("中断后重新读取已完成的%s任务，直接打开对应结果", async kind => {
    const initial = workspace("running", kind === "plan" ? "plan" : "evaluate");
    const completed = workspace("succeeded", kind === "plan" ? "plan" : "evaluate");
    if (kind === "plan") completed.state.plans = [{questionId: "q1", actions: [{
      id: "a", kind: "todo", title: "补充资料", nodeId: null, before: "", after: "已保存建议", source: "缺口", selected: true,
    }]}];
    if (kind === "receipt") {
      initial.state.jobs![0].receiptId = "receipt-1";
      completed.state.jobs![0].receiptId = "receipt-1";
      completed.state.receipts = [{id: "receipt-1", status: "completed", createdAt: "2026-10-28T00:00:00Z",
        changes: [], before: [], after: completed.state.evaluations},
      {id: "different-receipt", status: "reverted", createdAt: "2026-10-28T00:01:00Z", changes: [], before: [], after: []}];
    }
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(completed),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn(), waitForJob: vi.fn().mockRejectedValue(new TypeError("Load failed"))};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "重新读取任务状态"}));
    await screen.findByRole("heading", {name: kind === "plan" ? "确认优化方案" : kind === "receipt" ? "优化执行完成" : question.question});
    expect(screen.queryByRole("progressbar", {name: "评估阶段进度"})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("流式状态已完成但读取结果中断时，保留查看结果按钮，点击后打开保存评分", async () => {
    const initial = workspace("running");
    const completed = workspace("succeeded");
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(completed),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn(),
      waitForJob: vi.fn(async (_id: string, update: (value: IntentWorkspace) => void) => {
        update({...initial, state: {...initial.state, jobs: completed.state.jobs}});
        throw new TypeError("Load failed");
      })};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    const button = await screen.findByRole("button", {name: "查看评估结果"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(screen.getByRole("heading", {name: "评估已完成"})).toBeTruthy();
    expect(screen.getByText("结果已校验并保存")).toBeTruthy();
    fireEvent.click(button);
    await screen.findByText("回答要点支撑矩阵");
    expect(screen.queryByRole("progressbar", {name: "评估阶段进度"})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("重新打开工作台后直接查看历史问题、评分和方案，不调用模型或执行动作", async () => {
    const saved = workspace("succeeded", "plan");
    saved.state.questions[0] = {...question, question: "已更新的问题"};
    saved.state.jobs![0].result = {completedAt: "2026-10-28T00:00:00Z", questions: [question],
      evaluations: saved.state.evaluations, plans: [{questionId: "q1", actions: [{
        id: "a", kind: "todo", title: "补充部署资料", nodeId: null, before: "", after: "补充证据", source: "资料缺口", selected: true,
      }]}]};
    const {api} = pendingApi(saved);
    const first = render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "历史记录（1）"}));
    fireEvent.click(screen.getByRole("button", {name: "查看任务结果"}));
    expect(screen.getByRole("heading", {name: question.question})).toBeTruthy();
    expect(screen.getByText("已保存优化方案")).toBeTruthy();
    expect(screen.queryByRole("button", {name: "查看任务结果"})).toBeNull();
    expect(screen.getByRole("heading", {name: "已保存任务结果"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "返回历史记录"}));
    expect(screen.queryByRole("heading", {name: question.question})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "查看任务结果"}));
    expect(screen.queryByRole("button", {name: "确认并执行已选动作"})).toBeNull();
    first.unmount();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "历史记录（1）"}));
    fireEvent.click(screen.getByRole("button", {name: "查看任务结果"}));
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("查看已保存方案直接复用，只有重新生成方案才提交任务", async () => {
    const saved = workspace("succeeded");
    saved.state.plans = [{questionId: "q1", actions: [{id: "a", kind: "todo", title: "部署资料",
      nodeId: null, before: "", after: "保留的方案内容", source: "缺口", selected: true}]}];
    const {api, finish} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("textbox", {name: "部署资料修改后"})).toHaveProperty("value", "保留的方案内容");
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "重新生成方案"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "plan", questionIds: ["q1"]})));
    await act(async () => finish(saved));
  });
  it("点击评分只看已有结果，明确点击生成方案后仅提交方案任务", async () => {
    const {api, finish} = pendingApi(workspace("succeeded"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.waitForJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "生成优化方案"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "plan", questionIds: ["q1"]})));
    expect(api.command).toHaveBeenCalledTimes(1);
    await act(async () => finish(workspace("succeeded")));
  });
  it("优化问题中查看历史已有方案，直接复用原任务，不启动新的评估", async () => {
    const saved = workspace("succeeded", "plan");
    saved.state.jobs![0].result = {completedAt: "2026-10-28T00:00:00Z", questions: [question],
      evaluations: saved.state.evaluations, plans: [{questionId: "q1", actions: [{
        id: "a", kind: "todo", title: "历史部署方案", nodeId: null, before: "", after: "已做好的方案",
        source: "资料缺口", selected: true,
      }]}]};
    const {api} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("heading", {name: "已保存任务结果"})).toBeTruthy();
    expect(screen.getByText("历史部署方案")).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
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
    expect(screen.getByRole("button", {name: "生成优化方案"})).toHaveProperty("disabled", false);
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
    await screen.findByRole("button", {name: "生成优化方案"});
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
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
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
    await screen.findByText("已接收所选 1 条问题");
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
    expect(screen.getByRole("button", {name: "生成优化方案"})).toHaveProperty("disabled", false);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("交接弹窗内可恢复失败读取，重试保留所选新问题", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const api: IntentWorkbenchApi = {observe: vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(initial),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    expect(screen.getByRole("button", {name: "确认选择并交给问题优化（1）"})).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", {name: "重试读取优化清单"}));
    await waitFor(() => expect(screen.getByRole("button", {name: "确认选择并交给问题优化（1）"})).toHaveProperty("disabled", false));
    expect(screen.getByText(question.question)).toBeTruthy();
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("再次交接已评估词条复用来源记录和评分，不创建任务，宿主切页不覆盖结果", async () => {
    const saved = workspace("succeeded");
    // The approved rewrite differs from the original source text.
    saved.state.questions[0].question = "企业软件有哪些部署条件？";
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValue(saved),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    const props = {keywordProps: {} as any, api, onSectionChange: vi.fn()};
    const rendered = render(<IntentWorkbench {...props}/>);
    await waitFor(() => expect(api.observe).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    const confirm = screen.getByRole("button", {name: "确认选择并交给问题优化（1）"});
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
    fireEvent.click(confirm);
    await screen.findByText("回答要点支撑矩阵");
    rendered.rerender(<IntentWorkbench {...props} initialView="list"/>);
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    expect(screen.getByRole("heading", {name: "企业软件有哪些部署条件？"})).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.observe).toHaveBeenCalledTimes(2);
  });
  it("列表隐藏无能力入口，评分只读，详情仍可进入应答逻辑", async () => {
    const saved = workspace("succeeded"), onOpenAnswer = vi.fn();
    saved.state.plans = [{questionId: "q1", actions: [{id: "a", kind: "todo", title: "部署资料",
      nodeId: null, before: "", after: "原方案", source: "缺口", selected: true}]}];
    const {api} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer}}/>);
    await screen.findByRole("button", {name: "查看优化方案"});
    for (const name of ["新增问题", "修改问题", "删除问题", "进入应答逻辑", "返回词条生成与保存", "继续审核已保存方案"]) {
      expect(screen.queryByRole("button", {name})).toBeNull();
    }
    expect(screen.queryByText("从企业信息和参考材料生成问题")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: `查看知识支撑：${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "进入应答逻辑"}));
    expect(onOpenAnswer).toHaveBeenCalledWith(question);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("第二行生成方案只针对该问题，不沿用上一次查看的评分范围", async () => {
    const saved = workspace("succeeded");
    saved.state.questions.push({...question, id: "q2", question: "第二个问题"});
    saved.state.evaluations.push({...saved.state.evaluations[0], questionId: "q2"});
    const {api, finish} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getAllByRole("button", {name: "生成优化方案"})[1]);
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "plan", questionIds: ["q2"]})));
    expect(api.command).toHaveBeenCalledTimes(1);
    await act(async () => finish(saved));
  });
  it("执行记录只在统一历史入口展示，打开原回执不执行或重评", async () => {
    const saved = workspace("succeeded");
    saved.state.receipts = [{id: "receipt-1", status: "completed", createdAt: "2026-10-28T00:00:00Z",
      changes: [], before: [], after: saved.state.evaluations}];
    const {api} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "历史记录（1）"}));
    fireEvent.click(screen.getByRole("button", {name: "查看执行记录"}));
    expect(screen.getByRole("heading", {name: "优化执行完成"})).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
});
