import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {useState} from "react";
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
  DialogContent: ({children, className, style, ref}: any) => <div role="dialog" className={className} style={style} ref={ref}>{children}</div>, DialogHeader: ({children}: any) => children,
  DialogTitle: ({children}: any) => children, DialogDescription: ({children}: any) => children,
  DialogFooter: ({children}: any) => children,
}));
vi.mock("@frontmind/module-ui/components/MarkdownRenderer", () => ({default: () => null}));
vi.mock("./ManagedKeywordTables", () => ({default: ({onUseQuestions, onEvaluateQuestion, onViewEvaluationTask, optimizationState, evaluationPending, evaluationPendingKeyword}: any) => {
  const [checked, setChecked] = useState(false);
  const task = optimizationState?.jobs?.find((job: any) => !["succeeded", "failed"].includes(job.status));
  return <>
  <input type="checkbox" aria-label="测试词条选择" checked={checked} onChange={event => setChecked(event.target.checked)}/>
  <button onClick={() => onUseQuestions([{
    tableId: "table", rowIndex: 0, question: "企业软件如何部署", category: "industry", dashboardRevision: 1,
  }])}>交接测试问题</button>
  <button disabled={evaluationPending} onClick={() => onEvaluateQuestion({
    tableId: "table", rowIndex: 0, question: "企业软件如何部署", category: "industry", dashboardRevision: 1,
  })}>词条直接评估</button>
  {task && <button onClick={() => onViewEvaluationTask(task.id)}>查看词条当前评估详情</button>}
  <output aria-label="词条评估状态">{optimizationState?.evaluations[0]?.value ?? "尚无评分"}</output>
  <output aria-label="词条提交目标">{evaluationPendingKeyword ? `${evaluationPendingKeyword.tableId}:${evaluationPendingKeyword.rowIndex}` : "无"}</output>
</>;
}}));
vi.mock("./KnowledgeChangeComparison", () => ({default: () => null}));
import IntentWorkbench from "./IntentWorkbench";
import IntentTaskProgress from "./IntentTaskProgress";
import {IntentListEvaluationStatus} from "./IntentListFeedback";

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
async function openCurrentTask() {
  fireEvent.click(await screen.findByRole("button", {name: "查看当前任务"}));
}
describe("优化工作台任务入口", () => {
  it("服务器没有提供阶段时使用不定进度，不推算完成比例", () => {
    render(<IntentTaskProgress job={workspace("running").state.jobs![0]} kind="evaluate" error="" pending={false}
      onBack={vi.fn()} onViewResult={vi.fn()}/>);
    expect(screen.getByRole("progressbar", {name: "评估阶段进度"}).hasAttribute("value")).toBe(false);
    expect(screen.getByText("任务执行中，详细阶段暂不可用")).toBeTruthy();
    expect(screen.queryByText("持续更新")).toBeNull();
  });
  it("已暂停任务保留实际阶段，只有服务器确认成功后进度填满", () => {
    const job = workspace("paused").state.jobs![0];
    job.progress = {stage: "validating", updatedAt: "2026-11-07T00:00:00Z", events: []};
    const props = {kind: "evaluate" as const, error: "", pending: false, onBack: vi.fn(), onViewResult: vi.fn()};
    const {rerender} = render(<IntentTaskProgress {...props} job={job}/>);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("3");
    expect(screen.getByRole("status", {name: "任务状态"}).textContent).toBe("已暂停");
    rerender(<IntentTaskProgress {...props} job={{...job, status: "succeeded"}}/>);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("4");
    expect(screen.getByRole("button", {name: "查看评估结果"})).toBeTruthy();
  });
  it("词条开始评估后可反复查看同一任务并返回，完成后显示结果且保留来源选择", async () => {
    const initial = workspace(), running = workspace("running");
    running.state.jobs![0].progress = {stage: "analyzing", updatedAt: "2026-11-07T00:00:00Z",
      events: [{id: "event-1", at: "2026-11-07T00:00:00Z", label: "当前词条任务已返回工具状态"}]};
    const {api, finish} = pendingApi(initial);
    vi.mocked(api.command).mockResolvedValue(running);
    const onSectionChange = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} api={api} onSectionChange={onSectionChange}/>);
    await waitFor(() => expect(screen.getByRole("button", {name: "词条直接评估"})).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("checkbox", {name: "测试词条选择"}));
    fireEvent.click(screen.getByRole("button", {name: "词条直接评估"}));
    fireEvent.click(await screen.findByRole("button", {name: "查看词条当前评估详情"}));
    expect(screen.getByRole("heading", {name: "实时任务动态"})).toBeTruthy();
    expect(screen.getByText("当前词条任务已返回工具状态")).toBeTruthy();
    expect(screen.queryByText("回答要点支撑矩阵")).toBeNull();
    expect(api.waitForJob).toHaveBeenCalledTimes(1);
    expect(api.waitForJob).toHaveBeenCalledWith("job-1", expect.any(Function), expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", {name: "返回已保存词条"}));
    expect(screen.getByRole("checkbox", {name: "测试词条选择"})).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", {name: "查看词条当前评估详情"}));
    await act(async () => finish(workspace("succeeded")));
    await screen.findByText("回答要点支撑矩阵");
    fireEvent.click(screen.getByRole("button", {name: "返回已保存词条"}));
    expect(screen.getByRole("checkbox", {name: "测试词条选择"})).toHaveProperty("checked", true);
    expect(screen.getByLabelText("词条评估状态").textContent).toBe("80");
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.waitForJob).toHaveBeenCalledTimes(1);
    expect(onSectionChange).not.toHaveBeenCalled();
  });
  it("来源词条可查看已暂停的原任务，不派发评估或启动新监听", async () => {
    const {api} = pendingApi(workspace("paused"));
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看词条当前评估详情"}));
    expect(screen.getByRole("status", {name: "任务状态"}).textContent).toBe("已暂停");
    fireEvent.click(screen.getByRole("button", {name: "返回已保存词条"}));
    expect(screen.getByRole("button", {name: "查看词条当前评估详情"})).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.waitForJob).not.toHaveBeenCalled();
  });
  it("词条直接评估按最新版本保存并派发一次，完成后留在来源页显示分数", async () => {
    const initial = {...workspace(), revision: 7};
    initial.state.questions = [];
    const saved = {...initial, revision: 8, state: {...initial.state, questions: [{...question, id: "table:0"}]}};
    const running = {...workspace("running"), revision: 9};
    running.state.questions = saved.state.questions;
    running.state.jobs![0].questionIds = ["table:0"];
    let release!: (value: IntentWorkspace) => void;
    let complete!: (value: IntentWorkspace) => void;
    const read = new Promise<IntentWorkspace>(resolve => {release = resolve;});
    const result = new Promise<IntentWorkspace>(resolve => {complete = resolve;});
    const api: IntentWorkbenchApi = {
      observe: vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(read),
      command: vi.fn().mockResolvedValueOnce(saved).mockResolvedValueOnce(running),
      execute: vi.fn(), rollback: vi.fn(), waitForJob: vi.fn(() => result),
    };
    const onSectionChange = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} api={api} onSectionChange={onSectionChange}/>);
    const button = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByLabelText("词条提交目标").textContent).toBe("table:0");
    expect(api.command).not.toHaveBeenCalled();
    await act(async () => release(initial));
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("词条提交目标").textContent).toBe("无"));
    expect(api.command).toHaveBeenNthCalledWith(1, expect.objectContaining({kind: "intake", expectedRevision: 7,
      questions: [expect.objectContaining({id: "table:0", question: question.question, sourceRevision: 1})]}));
    expect(api.command).toHaveBeenNthCalledWith(2, expect.objectContaining({kind: "evaluate", expectedRevision: 8,
      questionIds: ["table:0"], clientRequestId: expect.any(String)}));
    expect(screen.queryByRole("heading", {name: "优化问题"})).toBeNull();
    expect(onSectionChange).not.toHaveBeenCalled();
    const completed = {...running, revision: 10, state: {...running.state, jobs: [{...running.state.jobs![0], status: "succeeded" as const}],
      evaluations: [{...workspace("succeeded").state.evaluations[0], questionId: "table:0"}]}};
    await act(async () => complete(completed));
    expect(screen.getByLabelText("词条评估状态").textContent).toBe("80");
    expect(screen.getByRole("button", {name: "词条直接评估"})).toBeTruthy();
    expect(api.command).toHaveBeenCalledTimes(2);
    expect(onSectionChange).not.toHaveBeenCalled();
  });
  it("单条提交失败后清理目标，可重试且不派发其他问题", async () => {
    const initial = workspace();
    initial.state.questions.push({...question, id: "other", question: "另一条问题", rowIndex: 1});
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue(initial),
      command: vi.fn().mockResolvedValue(workspace("running")), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    const button = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await screen.findByText("读取失败");
    expect(screen.getByLabelText("词条提交目标").textContent).toBe("无");
    expect(button).toHaveProperty("disabled", false);
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "evaluate", questionIds: ["q1"]}));
    expect(initial.state.questions.map(item => item.question)).toEqual([question.question, "另一条问题"]);
  });
  it("已有词条按来源坐标复用稳定问题编号，使用最新清单版本评估", async () => {
    const initial = workspace();
    const latest = {...initial, revision: 12};
    latest.state.questions = [{...question, question: "修改后的原问题"}];
    const running = {...workspace("running"), revision: 13};
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(latest),
      command: vi.fn().mockResolvedValue(running), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    const button = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "evaluate", expectedRevision: 12, questionIds: ["q1"]}));
  });
  it("新读到已有评分或运行任务时不会重复提交评估", async () => {
    const initial = workspace(), latest = workspace("succeeded");
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(latest),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    const button = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByLabelText("词条评估状态").textContent).toBe("80"));
    expect(api.command).not.toHaveBeenCalled();
    cleanup();
    const busyApi: IntentWorkbenchApi = {...api, observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(workspace("running"))};
    render(<IntentWorkbench keywordProps={{} as any} api={busyApi}/>);
    const busyButton = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(busyButton).toHaveProperty("disabled", false));
    fireEvent.click(busyButton);
    await screen.findByText(/已有评估任务，请等待完成/);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("词条保存失败时不继续派发评估，来源页保留重试入口", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValue(initial),
      command: vi.fn().mockRejectedValue(new Error("保存失败")), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    const button = await screen.findByRole("button", {name: "词条直接评估"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await screen.findByText("保存失败");
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "intake"}));
    expect(button).toHaveProperty("disabled", false);
  });
  it("默认最新加入优先，手动按两种分数升序，全量排序后分页并将未评估排在末尾", async () => {
    const initial = workspace("succeeded");
    initial.state.questions = Array.from({length: 12}, (_, index) => ({...question, id: `q${index}`, question: `排序问题${index}`}));
    const evaluation = initial.state.evaluations[0];
    initial.state.evaluations = initial.state.questions.slice(1).map((item, position) => {
      const index = position + 1;
      return {...evaluation, questionId: item.id, value: index === 1 ? 0 : index <= 3 ? 20 : index * 3,
        support: index === 1 ? 0 : index <= 3 ? 10 : index * 5};
    });
    const {api} = pendingApi(initial), onCatalogExit = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}
      catalogIntegration={{onOpenAnswer: vi.fn()}} onCatalogExit={onCatalogExit}/>);
    await screen.findByText("排序问题11");
    const ids = () => Array.from(document.querySelectorAll(".iw-catalog-table tbody tr")).map(row => row.getAttribute("data-question-id"));
    expect(ids()).toEqual(["q11", "q10", "q9", "q8", "q7", "q6", "q5", "q4", "q3", "q2"]);
    fireEvent.click(screen.getByRole("checkbox", {name: "选择排序问题11"}));
    fireEvent.click(screen.getByRole("button", {name: "下一页"}));
    expect(ids()).toEqual(["q1", "q0"]);
    const supportSort = screen.getByRole("button", {name: "按知识支撑从低到高排列"});
    fireEvent.click(supportSort);
    expect(ids()).toEqual(["q1", "q3", "q2", "q4", "q5", "q6", "q7", "q8", "q9", "q10"]);
    expect(supportSort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.queryByText("部分支撑")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "下一页"}));
    expect(ids()).toEqual(["q11", "q0"]);
    const valueSort = screen.getByRole("button", {name: "按问题价值从低到高排列"});
    fireEvent.click(valueSort);
    expect(ids()).toEqual(["q1", "q4", "q5", "q6", "q3", "q2", "q7", "q8", "q9", "q10"]);
    expect(supportSort.closest("th")?.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(document.querySelector(".iw-catalog-table tbody tr") as HTMLElement).getByRole("button", {name: "进入应答逻辑"}));
    expect(onCatalogExit).toHaveBeenCalledWith(expect.objectContaining({sort: "value", selected: ["q11"]}));
    fireEvent.click(valueSort);
    expect(ids()[0]).toBe("q11");
    expect(screen.getByRole("checkbox", {name: "选择排序问题11"})).toHaveProperty("checked", true);
    expect(initial.state.questions.map(item => item.id)).toEqual(Array.from({length: 12}, (_, index) => `q${index}`));
    expect(api.command).not.toHaveBeenCalled();
  });
  it("从应答返回时恢复用户手动选择的分数排序", async () => {
    const initial = workspace("succeeded");
    initial.state.questions.push({...question, id: "q2", question: "新加入问题"});
    initial.state.evaluations.push({...initial.state.evaluations[0], questionId: "q2", support: 90});
    const {api} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}
      initialCatalogState={{search: "", category: "all", status: "all", sort: "support", page: 0, selected: [], expandedGaps: [], questionId: "q1"}}/>);
    await screen.findByText(question.question);
    expect(document.querySelector(".iw-catalog-table tbody tr")?.getAttribute("data-question-id")).toBe("q1");
    expect(screen.getByRole("button", {name: "按知识支撑从低到高排列"}).getAttribute("aria-pressed")).toBe("true");
  });
  it("移除状态与类别筛选后忽略旧筛选值，应答返回状态保持全部", async () => {
    const initial = workspace("succeeded");
    const {api} = pendingApi(initial);
    const onCatalogExit = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}
      initialCatalogState={{search: "", category: "product_scenario", status: "missing", page: 0, selected: [], expandedGaps: [], questionId: "q1"}}
      catalogIntegration={{onOpenAnswer: vi.fn()}} onCatalogExit={onCatalogExit}/>);
    await screen.findByText(question.question);
    expect(screen.queryByRole("combobox", {name: "问题状态"})).toBeNull();
    expect(screen.queryByRole("combobox", {name: "问题分类"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "进入应答逻辑"}));
    expect(onCatalogExit).toHaveBeenCalledWith(expect.objectContaining({category: "all", status: "all", questionId: "q1"}));
    expect(api.command).not.toHaveBeenCalled();
  });
  it("后台评估不锁住历史、应答和其他问题，完成不抢走正在编辑的方案", async () => {
    const initial = workspace("running");
    initial.state.jobs![0].questionsScope = "selected";
    initial.state.questions.push({...question, id: "q2", question: "其他部署问题"});
    initial.state.evaluations.push({...workspace("succeeded").state.evaluations[0], questionId: "q2"});
    initial.state.plans.push({questionId: "q2", actions: [{id: "a2", kind: "node", title: "其他方案",
      nodeId: "fixture-node", before: "", after: "原方案草稿", source: "证据", selected: true}]});
    const {api, finish} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer: vi.fn()}}/>);
    await screen.findByRole("region", {name: "问题评估任务"});
    const currentRow = screen.getByText(question.question).closest("tr")!;
    const otherRow = screen.getByText("其他部署问题").closest("tr")!;
    expect(within(currentRow).getByRole("button", {name: "修改问题"})).toHaveProperty("disabled", false);
    expect(within(otherRow).getByRole("button", {name: "修改问题"})).toHaveProperty("disabled", false);
    expect(within(otherRow).getByRole("button", {name: "进入应答逻辑"})).toHaveProperty("disabled", false);
    fireEvent.click(within(otherRow).getByRole("button", {name: "查看优化方案"}));
    fireEvent.change(screen.getByRole("textbox", {name: "其他方案修改后"}), {target: {value: "正在编辑的草稿"}});
    const completed = {...initial, revision: 2, state: {...initial.state, jobs: [{...initial.state.jobs![0], status: "succeeded" as const}]}};
    await act(async () => finish(completed));
    expect(screen.getByRole("heading", {name: "确认优化方案"})).toBeTruthy();
    expect(screen.getByRole("textbox", {name: "其他方案修改后"})).toHaveProperty("value", "正在编辑的草稿");
    expect(api.command).not.toHaveBeenCalled();
  });
  it("暂停与继续调用真实控制接口，暂停后保持列表和勾选", async () => {
    const initial = workspace("running");
    const {api} = pendingApi(initial);
    api.control = vi.fn(async ({action}): Promise<IntentWorkspace> => ({...initial, revision: action === "pause" ? 2 : 3,
      state: {...initial.state, jobs: [{...initial.state.jobs![0], status: action === "pause" ? "paused" : "running"}]}}));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("checkbox", {name: `选择${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "暂停评估"}));
    const resume = await screen.findByRole("button", {name: "继续评估"});
    expect(api.control).toHaveBeenCalledWith({jobId: "job-1", action: "pause"});
    expect(screen.getByRole("checkbox", {name: `选择${question.question}`})).toHaveProperty("checked", true);
    fireEvent.click(resume);
    await waitFor(() => expect(api.control).toHaveBeenLastCalledWith({jobId: "job-1", action: "resume"}));
    expect(screen.getByRole("heading", {name: "优化问题"})).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
  });
  it.each(["submit", "pause", "resume"] as const)("%s请求未返回时四个入口可操作，独立保存使用最新版本，迟到响应不恢复旧问题", async phase => {
    const initial = workspace(phase === "submit" ? undefined : phase === "pause" ? "running" : "paused");
    if (initial.state.jobs?.[0]) initial.state.jobs[0].questionsScope = "selected";
    const other = {...question, id: "q2", question: "其他部署问题", rowIndex: 1};
    const unevaluated = {...question, id: "q3", question: "尚未评估的问题", rowIndex: 2};
    initial.state.questions.push(other, unevaluated);
    initial.state.evaluations.push({...workspace("succeeded").state.evaluations[0], questionId: "q2"});
    initial.state.plans.push({questionId: "q2", actions: [{id: "a2", kind: "node", title: "其他方案",
      nodeId: "fixture-node", before: "", after: "原方案草稿", source: "证据", selected: true}]});
    let ledger = structuredClone(initial);
    let release!: (data: IntentWorkspace) => void;
    const delayed = new Promise<IntentWorkspace>(resolve => {release = resolve;});
    const {api} = pendingApi(initial);
    api.observe = vi.fn(async () => structuredClone(ledger));
    api.command = vi.fn(async (value: any) => {
      if (value.kind === "evaluate") {
        ledger.revision = 10;
        ledger.state.jobs = [{...workspace("running").state.jobs![0], questionsScope: "selected"}];
        return delayed;
      }
      expect(value.expectedRevision).toBe(ledger.revision);
      ledger = structuredClone(ledger); ledger.revision++;
      if (value.kind === "edit") ledger.state.plans[0].actions[0].after = value.actions[0].after;
      if (value.kind === "update-question") ledger.state.questions.find(item => item.id === value.questionId)!.question = value.question;
      if (value.kind === "delete-question") ledger.state.questions = ledger.state.questions.filter(item => item.id !== value.questionId);
      return structuredClone(ledger);
    });
    api.control = vi.fn(() => {
      ledger.revision = 10;
      ledger.state.jobs![0].status = phase === "pause" ? "paused" : "running";
      return delayed;
    });
    const onOpenAnswer = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer}}/>);
    const row = () => screen.getByText(other.question).closest("tr")!;
    await screen.findByText(other.question);
    if (phase !== "submit")
      await waitFor(() => expect(screen.getByRole("button", {name: phase === "resume" ? "继续评估" : "暂停评估"})).toHaveProperty("disabled", false));
    if (phase === "submit") {
      fireEvent.click(within(screen.getByText(question.question).closest("tr")!).getByRole("button", {name: "评估问题"}));
      fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    } else fireEvent.click(screen.getByRole("button", {name: phase === "pause" ? "暂停评估" : "继续评估"}));
    const staleAcknowledgement = structuredClone(ledger);
    for (const name of ["进入应答逻辑", "查看优化方案", "修改问题", "删除问题"])
      expect(within(row()).getByRole("button", {name})).toHaveProperty("disabled", false);
    expect(within(screen.getByText(question.question).closest("tr")!).getByRole("button", {name: "修改问题"})).toHaveProperty("disabled", false);
    fireEvent.click(within(row()).getByRole("button", {name: "进入应答逻辑"}));
    expect(onOpenAnswer).toHaveBeenCalledWith(other);
    fireEvent.click(within(row()).getByRole("button", {name: `查看评估：${other.question}`}));
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(within(row()).getByRole("button", {name: "查看优化方案"}));
    fireEvent.change(screen.getByRole("textbox", {name: "其他方案修改后"}), {target: {value: "并发保存的方案"}});
    const save = screen.getByRole("button", {name: "保存方案草稿"});
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("button", {name: "保存方案草稿"})).toBeNull());
    expect(ledger.state.plans[0].actions[0].after).toBe("并发保存的方案");
    fireEvent.click(screen.getByRole("button", {name: "返回评估详情"}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(within(row()).getByRole("button", {name: "修改问题"}));
    fireEvent.change(screen.getByRole("textbox", {name: "问题内容"}), {target: {value: "修改后的其他问题"}});
    expect(screen.getByRole("button", {name: "保存修改"})).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", {name: "保存修改"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const editedRow = screen.getByText("修改后的其他问题").closest("tr")!;
    fireEvent.click(within(editedRow).getByRole("button", {name: "删除问题"}));
    await screen.findByRole("button", {name: "撤销删除"});
    expect(screen.queryByRole("row", {name: /修改后的其他问题/})).toBeNull();
    await act(async () => release(staleAcknowledgement));
    expect(screen.getByRole("heading", {name: "优化问题"})).toBeTruthy();
    expect(screen.queryByText(other.question)).toBeNull();
    expect(screen.queryByRole("row", {name: /修改后的其他问题/})).toBeNull();
    expect(ledger.state.questions.find(item => item.id === "q1")?.question).toBe(question.question);
    expect(vi.mocked(api.command).mock.calls.filter(([value]: any) => value.kind === "evaluate")).toHaveLength(phase === "submit" ? 1 : 0);
    if (phase !== "submit") {
      expect(api.control).toHaveBeenCalledTimes(1);
      expect(api.control).toHaveBeenCalledWith({jobId: "job-1", action: phase});
    }
  });
  it("迟到的评估提交确认与任务完成均不抢走其他问题的未保存方案", async () => {
    const initial = workspace();
    initial.state.questions.push({...question, id: "q2", question: "其他部署问题", rowIndex: 1});
    initial.state.evaluations.push({...workspace("succeeded").state.evaluations[0], questionId: "q2"});
    initial.state.plans.push({questionId: "q2", actions: [{id: "a2", kind: "node", title: "其他方案",
      nodeId: "fixture-node", before: "", after: "原方案草稿", source: "证据", selected: true}]});
    const running = {...structuredClone(initial), revision: 2};
    running.state.jobs = [{...workspace("running").state.jobs![0], questionsScope: "selected"}];
    let release!: (data: IntentWorkspace) => void;
    const delayed = new Promise<IntentWorkspace>(resolve => {release = resolve;});
    const {api, finish} = pendingApi(initial);
    api.command = vi.fn(() => delayed);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByText("其他部署问题");
    await waitFor(() => expect(within(screen.getByText(question.question).closest("tr")!).getByRole("button", {name: "评估问题"})).toHaveProperty("disabled", false));
    fireEvent.click(within(screen.getByText(question.question).closest("tr")!).getByRole("button", {name: "评估问题"}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getByRole("button", {name: "查看优化方案"}));
    fireEvent.change(screen.getByRole("textbox", {name: "其他方案修改后"}), {target: {value: "未保存的新草稿"}});
    await act(async () => release(running));
    expect(screen.getByRole("heading", {name: "确认优化方案"})).toBeTruthy();
    expect(screen.getByRole("textbox", {name: "其他方案修改后"})).toHaveProperty("value", "未保存的新草稿");
    await act(async () => finish({...running, revision: 3, state: {...running.state,
      jobs: [{...running.state.jobs![0], status: "succeeded"}]}}));
    expect(screen.getByRole("textbox", {name: "其他方案修改后"})).toHaveProperty("value", "未保存的新草稿");
    expect(api.command).toHaveBeenCalledTimes(1);
  });
  it.each(["running", "paused"])("%s评估只禁用评估问题，生成方案独立派发且重复点击复用原方案任务", async status => {
    const initial = workspace(status);
    initial.state.jobs![0].questionsScope = "selected";
    initial.state.questions.push({...question, id: "q2", question: "其他部署问题", rowIndex: 1},
      {...question, id: "q3", question: "尚未评估的问题", rowIndex: 2});
    initial.state.evaluations.push({...workspace("succeeded").state.evaluations[0], questionId: "q2"});
    const {api} = pendingApi(initial);
    const planned = {...initial, revision: 2, state: {...initial.state, jobs: [...initial.state.jobs!, {
      ...initial.state.jobs![0], id: "plan-2", kind: "plan" as const, status: "running" as const, questionIds: ["q2"],
    }]}};
    vi.mocked(api.command).mockResolvedValue(planned);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByText("其他部署问题");
    const row = screen.getByText("尚未评估的问题").closest("tr")!;
    expect(within(row).getByRole("button", {name: "评估问题"})).toHaveProperty("disabled", true);
    fireEvent.click(within(row).getByRole("button", {name: "评估问题"}));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "生成优化方案"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "plan", questionIds: ["q2"]})));
    await waitFor(() => expect(api.waitForJob).toHaveBeenCalledWith("plan-2", expect.any(Function), expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getByRole("button", {name: "生成优化方案"}));
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(initial.state.jobs![0].status).toBe(status);
  });
  it.each(["running", "paused"])("%s时当前评估题的四入口独立，修改与删除真正保存，旧结果只按原题查看", async status => {
    const initial = workspace(status);
    initial.state.evaluations = workspace("succeeded").state.evaluations;
    initial.state.plans = [{questionId: "q1", actions: [{id: "a1", kind: "node", title: "原题方案",
      nodeId: "fixture-node", before: "", after: "核验资料", source: "资料", selected: true}]}];
    const {api, finish} = pendingApi(initial);
    let ledger = structuredClone(initial);
    api.observe = vi.fn(async () => structuredClone(ledger));
    api.command = vi.fn(async (value: any) => {
      expect(value.expectedRevision).toBe(ledger.revision);
      ledger = structuredClone(ledger); ledger.revision++;
      if (value.kind === "update-question") ledger.state.questions[0].question = value.question;
      if (value.kind === "delete-question") ledger.state.questions = [];
      ledger.state.evaluations = []; ledger.state.plans = [];
      return structuredClone(ledger);
    });
    const onOpenAnswer = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer}}/>);
    await screen.findByText(question.question);
    for (const name of ["进入应答逻辑", "查看优化方案", "修改问题", "删除问题"])
      expect(screen.getByRole("button", {name})).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", {name: "进入应答逻辑"}));
    expect(onOpenAnswer).toHaveBeenCalledWith(question);
    fireEvent.click(screen.getByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("textbox", {name: "原题方案修改后"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "返回评估详情"}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getByRole("button", {name: "修改问题"}));
    fireEvent.change(screen.getByRole("textbox", {name: "问题内容"}), {target: {value: "修改后的当前评估题"}});
    fireEvent.click(screen.getByRole("button", {name: "保存修改"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("修改后的当前评估题")).toBeTruthy();
    expect(screen.getByRole("button", {name: "评估问题"})).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", {name: "删除问题"}));
    await screen.findByRole("button", {name: "撤销删除"});
    expect(screen.queryByRole("row", {name: /修改后的当前评估题/})).toBeNull();
    const completed = {...ledger, revision: 10, state: {...ledger.state, jobs: [{...ledger.state.jobs![0],
      status: "succeeded" as const, result: {completedAt: "2026-11-07T00:00:00Z", questions: [question],
        evaluations: workspace("succeeded").state.evaluations, plans: []}}]}};
    if (status === "running") {
      await act(async () => finish(completed));
      fireEvent.click(screen.getByRole("button", {name: "查看评估结果"}));
      expect(screen.getByRole("heading", {name: "已保存任务结果"})).toBeTruthy();
      expect(screen.getByRole("heading", {name: question.question})).toBeTruthy();
    }
    expect(api.command).toHaveBeenCalledTimes(2);
  });
  it.each(["执行被拒绝", "没有本次回执"])("%s时保留全选草稿，不把旧回执当成本次结果，重试成功后只展示匹配回执", async failure => {
    const saved = workspace("succeeded");
    const actions = [
      {id: "question", kind: "question" as const, title: "修改当前问题", nodeId: null, before: "原问题", after: "建议问题", source: "问题证据", selected: true},
      {id: "node", kind: "node" as const, title: "修改知识节点正文", nodeId: "1.01", before: "原正文", after: "建议正文", source: "节点证据", selected: true},
      {id: "todo", kind: "node" as const, title: "补充当前资料", nodeId: "fixture-node", before: "", after: "待核验资料", source: "资料缺口", selected: true},
    ];
    saved.state.plans = [{questionId: "q1", actions}];
    saved.state.receipts = [{id: "old-receipt", status: "completed", createdAt: "2026-10-28T00:00:00Z",
      changes: [{questionId: "q1", action: {...actions[0], title: "旧记录里的问题操作"}, status: "succeeded"}],
      before: [], after: saved.state.evaluations}];
    const acknowledged = {...saved, revision: 2};
    const api: IntentWorkbenchApi = {
      observe: vi.fn().mockResolvedValue(saved),
      command: vi.fn().mockResolvedValue(acknowledged),
      execute: vi.fn().mockImplementationOnce(async () => {
        if (failure === "执行被拒绝") throw new Error("方案依据的知识或问题已变化，请重新生成方案（HTTP 409）");
        return acknowledged;
      }).mockImplementation(async (input: any) => ({
        ...acknowledged, revision: 3, state: {...saved.state, receipts: [
          {id: input.clientRequestId, status: "completed", createdAt: "2026-11-06T00:00:00Z",
            changes: actions.map(action => ({questionId: "q1", action, status: "succeeded"})),
            before: [], after: saved.state.evaluations},
          ...saved.state.receipts,
        ]},
      })),
      rollback: vi.fn(),
    };
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看优化方案"}));
    fireEvent.change(screen.getByRole("textbox", {name: "修改知识节点正文修改后"}), {target: {value: "审核后的正文"}});
    fireEvent.click(screen.getByRole("button", {name: "确认并执行已选动作"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", {name: "确认优化方案"})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: "优化执行完成"})).toBeNull();
    expect(screen.queryByText("旧记录里的问题操作")).toBeNull();
    expect(screen.queryByRole("button", {name: "查看知识库变更"})).toBeNull();
    expect(screen.getByRole("textbox", {name: "修改知识节点正文修改后"})).toHaveProperty("value", "审核后的正文");
    expect(screen.queryByRole("checkbox", {name: "采纳：修改当前问题"})).toBeNull();
    for (const action of actions.filter(action => action.kind !== "question")) expect(screen.getByRole("checkbox", {name: `采纳：${action.title}`})).toHaveProperty("checked", true);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "edit", actions: [
      {id: "node", selected: true, after: "审核后的正文"},
      {id: "todo", selected: true, after: "待核验资料"},
    ]}));
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", {name: "重新生成方案"})).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", {name: "确认并执行已选动作"}));
    await screen.findByRole("heading", {name: "优化执行完成"});
    expect(vi.mocked(api.command).mock.calls[1][0]).toMatchObject({expectedRevision: 2});
    expect(vi.mocked(api.execute).mock.calls[1][0]).toMatchObject({
      clientRequestId: (vi.mocked(api.execute).mock.calls[0][0] as any).clientRequestId,
    });
    expect(screen.queryByText("旧记录里的问题操作")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "查看知识库变更"}));
    expect(screen.getByRole("heading", {name: /历史节点 · 1\.01/})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: "本次未修改知识库正文"})).toBeNull();
  });
  it("正文动作只用勾选控制采纳，取消再勾选保留编辑内容且不创建待办", async () => {
    const saved=workspace("succeeded");
    saved.state.plans=[{questionId:"q1",actions:[
      {id:"node",kind:"node",title:"补充节点正文",nodeId:"1.01",before:"原节点内容",after:"建议节点内容",source:"节点来源说明",selected:true},
      {id:"legacy-todo",kind:"todo",title:"旧资料待办",nodeId:null,before:"",after:"待办内容",source:"旧记录",selected:true},
    ]}];
    const {api}=pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button",{name:"查看优化方案"}));
    const editor=screen.getByRole("textbox",{name:"补充节点正文修改后"});
    fireEvent.change(editor,{target:{value:"人工编辑的节点草稿"}});
    const checkbox=screen.getByRole("checkbox",{name:"采纳：补充节点正文"});
    fireEvent.click(checkbox);expect(checkbox).toHaveProperty("checked",false);
    fireEvent.click(checkbox);expect(checkbox).toHaveProperty("checked",true);
    expect(editor).toHaveProperty("value","人工编辑的节点草稿");
    expect(screen.queryByText("旧资料待办")).toBeNull();
    expect(screen.queryByRole("button",{name:"不采纳"})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();expect(api.execute).not.toHaveBeenCalled();
  });
  it("列表内只展示评估标题，位于页面标题之后并保留原任务详情和阶段", async () => {
    const initial = workspace("running");
    initial.state.jobs![0].progress = {stage: "analyzing", updatedAt: new Date().toISOString(), events: []};
    const {api, finish} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("region", {name: "问题评估任务"});
    const feedback = screen.getByRole("region", {name: "问题评估任务"});
    expect(within(feedback).getByRole("heading", {name: "正在评估 1 条问题"})).toBeTruthy();
    expect(within(feedback).queryByText("正在分析知识与评分")).toBeNull();
    expect(within(feedback).queryByText("任务在后台处理，可继续查看和处理其他问题。")).toBeNull();
    expect(feedback.querySelector(".iw-list-task-icon")).toBeNull();
    expect(within(feedback).queryByText(/已耗时/)).toBeNull();
    expect(screen.getByRole("heading", {name: "优化问题"}).compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("正在读取优化工作台…")).toBeNull();
    fireEvent.click(within(feedback).getByRole("button", {name: "查看当前任务"}));
    expect(screen.getByRole("log", {name: "实时任务动态"})).toBeTruthy();
    const progress = screen.getByRole("progressbar", {name: "评估阶段进度"});
    expect(progress.getAttribute("value")).toBe("2");
    expect(progress.compareDocumentPosition(screen.getByRole("log", {name: "实时任务动态"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("持续更新")).toBeNull();
    expect(screen.queryByRole("button", {name: "重新读取任务状态"})).toBeNull();
    expect(screen.queryByText(/可以返回列表等待/)).toBeNull();
    await act(async () => finish(workspace("succeeded")));
    expect(screen.queryByRole("region", {name: "问题评估任务"})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("列表任务完成后右侧按钮直接打开已保存评估，返回保留选择且不再查询或评估", async () => {
    const {api, finish} = pendingApi(workspace("running"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("region", {name: "问题评估任务"});
    fireEvent.click(screen.getByRole("checkbox", {name: `选择${question.question}`}));
    await act(async () => finish(workspace("succeeded")));
    const feedback = screen.getByRole("region", {name: "问题评估任务"});
    expect(within(feedback).getByText("评估已完成")).toBeTruthy();
    expect(within(feedback).queryByRole("button", {name: "查看当前任务"})).toBeNull();
    fireEvent.click(within(feedback).getByRole("button", {name: "查看评估结果"}));
    expect(screen.getByRole("heading", {name: question.question})).toBeTruthy();
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    expect(screen.queryByRole("log", {name: "实时任务动态"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    expect(screen.getByRole("checkbox", {name: `选择${question.question}`})).toHaveProperty("checked", true);
    expect(api.observe).toHaveBeenCalledTimes(1);
    expect(api.command).not.toHaveBeenCalled();
    expect(api.waitForJob).toHaveBeenCalledTimes(1);
  });
  it("已有列表重新读取时仅显示轻提示，保留列表和筛选，结束后收起", async () => {
    const initial = workspace("failed");
    initial.state.jobs![0].error = "测试读取恢复";
    let finish!: (value: IntentWorkspace) => void;
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise<IntentWorkspace>(resolve => {finish = resolve;})), command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.change(await screen.findByRole("textbox", {name: "搜索优化问题"}), {target: {value: "企业"}});
    fireEvent.click(screen.getByRole("button", {name: "重新读取"}));
    expect(screen.getByRole("status", {name: "列表更新状态"}).textContent).toContain("正在更新");
    expect(screen.getByText(question.question)).toBeTruthy();
    expect(screen.queryByText("正在读取优化工作台…")).toBeNull();
    await act(async () => finish(workspace()));
    expect(screen.queryByRole("status", {name: "列表更新状态"})).toBeNull();
    expect(screen.getByRole("textbox", {name: "搜索优化问题"})).toHaveProperty("value", "企业");
    expect(api.command).not.toHaveBeenCalled();
  });
  it.each([
    ["running", undefined, "正在评估 1 条问题"],
    ["queued", undefined, "正在评估 1 条问题"],
    ["create_unknown", "analyzing", "评估任务待确认 · 1 条问题"],
    ["running", "validating", "正在评估 1 条问题"],
    ["running", "repairing", "正在评估 1 条问题"],
  ] as const)("列表提示按 %s / %s 保留单行任务标题，省略阶段说明", async (status, stage, label) => {
    const initial = workspace(status);
    initial.state.jobs![0].createdAt = new Date(Date.now() - 84_000).toISOString();
    if (stage) initial.state.jobs![0].progress = {stage, updatedAt: new Date().toISOString(), events: []};
    const {api} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("region", {name: "问题评估任务"});
    const feedback = screen.getByRole("region", {name: "问题评估任务"});
    expect(within(feedback).getByRole("heading", {name: label})).toBeTruthy();
    expect(feedback.querySelector("p")).toBeNull();
    expect(within(feedback).getByText(/已耗时 1分/)).toBeTruthy();
    expect(within(feedback).queryByRole("progressbar")).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("首次读取显示单一列表骨架，返回数据后切换为原列表", async () => {
    const {api} = pendingApi(workspace());
    let finish!: (value: IntentWorkspace) => void;
    api.observe = vi.fn(() => new Promise<IntentWorkspace>(resolve => {finish = resolve;}));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    expect(screen.getByRole("heading", {name: "优化问题"})).toBeTruthy();
    expect(screen.getByRole("status", {name: "问题列表加载状态"}).textContent).toBe("正在加载已保存的问题…");
    expect(screen.queryByText("正在读取优化工作台…")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", {name: "评估问题"})).toBeNull();
    expect(screen.queryByRole("status", {name: "列表更新状态"})).toBeNull();
    expect(screen.queryByRole("region", {name: "问题评估任务"})).toBeNull();
    await act(async () => finish(workspace()));
    expect(screen.queryByRole("status", {name: "问题列表加载状态"})).toBeNull();
    expect(screen.getByText(question.question)).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("首次读取失败保留原重试入口且不创建评估任务", async () => {
    const {api} = pendingApi(workspace());
    api.observe = vi.fn().mockRejectedValueOnce(new Error("读取暂时失败")).mockResolvedValueOnce(workspace());
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByRole("alert");
    expect(screen.queryByRole("status", {name: "问题列表加载状态"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "重新读取"}));
    await screen.findByText(question.question);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("词条页首次读取不额外显示通用提示框或问题列表骨架", () => {
    const {api} = pendingApi(workspace());
    api.observe = vi.fn(() => new Promise<IntentWorkspace>(() => {}));
    render(<IntentWorkbench keywordProps={{} as any} initialView="universe" api={api}/>);
    expect(screen.getByRole("heading", {name: "词条生成"})).toBeTruthy();
    expect(screen.queryByText("正在读取优化工作台…")).toBeNull();
    expect(screen.queryByRole("status", {name: "问题列表加载状态"})).toBeNull();
  });
  it.each(["evaluate", "plan", "receipt"])("中断后重新读取已完成的%s任务，直接打开对应结果", async kind => {
    const initial = workspace("running", kind === "plan" ? "plan" : "evaluate");
    const completed = workspace("succeeded", kind === "plan" ? "plan" : "evaluate");
    if (kind === "plan") completed.state.plans = [{questionId: "q1", actions: [{
      id: "a", kind: "node", title: "补充资料", nodeId: "fixture-node", before: "", after: "已保存建议", source: "缺口", selected: true,
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
    await openCurrentTask();
    fireEvent.click(await screen.findByRole("button", {name: "重新读取"}));
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
    const feedback = await screen.findByRole("region", {name: "问题评估任务"});
    const button = within(feedback).getByRole("button", {name: "查看评估结果"});
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(within(feedback).getByRole("heading", {name: "评估已完成"})).toBeTruthy();
    fireEvent.click(button);
    await screen.findByText("回答要点支撑矩阵");
    expect(screen.queryByRole("progressbar", {name: "评估阶段进度"})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("完成事件保留旧评分时先补读本次结果，不把旧评分当作完成结果", async () => {
    const initial = workspace("running");
    initial.state.evaluations = [{...workspace("succeeded").state.evaluations[0], value: 30,
      provenance: {operationId: "older-job"} as any}];
    const completed = workspace("succeeded");
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(completed),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn(),
      waitForJob: vi.fn(async (_id, update) => {
        update({...initial, state: {...initial.state, jobs: completed.state.jobs}});
        throw new TypeError("Load failed");
      })};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看评估结果"}));
    await screen.findByText("回答要点支撑矩阵");
    expect(document.querySelector(".iw-score-card strong")?.textContent).toContain("80");
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(api.command).not.toHaveBeenCalled();
  });
  it("移除历史入口后重新打开仍能查看已保存评分和方案，不调用模型", async () => {
    const saved = workspace("succeeded", "plan");
    saved.state.plans = [{questionId: "q1", actions: [{
      id: "a", kind: "node", title: "补充部署资料", nodeId: "fixture-node", before: "", after: "补充证据", source: "资料缺口", selected: true,
    }]}];
    const {api} = pendingApi(saved);
    const first = render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("textbox", {name: "补充部署资料修改后"})).toHaveProperty("value", "补充证据");
    first.unmount();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    expect(screen.getByText("回答要点支撑矩阵")).toBeTruthy();
    expect(screen.queryByRole("button", {name: /历史记录/})).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("查看已保存方案直接复用，只有重新生成方案才提交任务", async () => {
    const saved = workspace("succeeded");
    saved.state.plans = [{questionId: "q1", actions: [{id: "a", kind: "node", title: "部署资料",
      nodeId: "fixture-node", before: "", after: "保留的方案内容", source: "缺口", selected: true}]}];
    const {api, finish} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("textbox", {name: "部署资料修改后"})).toHaveProperty("value", "保留的方案内容");
    expect(screen.queryByText(/方案已保存/)).toBeNull();
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
  it("历史方案也进入可编辑确认页，展示知识变更，保存草稿时才提交且不修改历史快照", async () => {
    const saved = workspace("succeeded", "plan");
    saved.state.jobs![0].inputHash = "archived-input";
    saved.state.jobs![0].result = {completedAt: "2026-10-28T00:00:00Z", questions: [question],
      evaluations: saved.state.evaluations, plans: [{questionId: "q1", actions: [{
        id: "a", kind: "node", title: "历史部署方案", nodeId: "1.01", before: "原知识正文", after: "已做好的方案",
        source: "资料缺口", selected: true,
      }]}]};
    const snapshot = structuredClone(saved.state.jobs![0].result);
    const {api} = pendingApi(saved);
    vi.mocked(api.command).mockResolvedValue({...saved, revision: 2, state: {...saved.state, plans: [{
      ...snapshot.plans[0], inputHash: "archived-input", actions: [{...snapshot.plans[0].actions[0], after: "审核后的知识正文"}],
    }]}});
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("heading", {name: "确认优化方案"})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: "已保存任务结果"})).toBeNull();
    expect(screen.getByText("历史部署方案")).toBeTruthy();
    expect(screen.getByRole("heading", {name: /知识节点变更预览/})).toBeTruthy();
    expect(screen.getByText("原知识正文")).toBeTruthy();
    expect(screen.getByRole("textbox", {name: "历史部署方案修改后"})).toHaveProperty("value", "已做好的方案");
    expect(screen.getByRole("button", {name: "确认并执行已选动作"})).toHaveProperty("disabled", false);
    expect(screen.queryByText(/方案已保存/)).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", {name: "历史部署方案修改后"}), {target: {value: "审核后的知识正文"}});
    expect(saved.state.jobs![0].result).toEqual(snapshot);
    fireEvent.click(screen.getByRole("button", {name: "保存方案草稿"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith({
      kind: "edit", expectedRevision: 1, questionId: "q1", actions: [{id: "a", selected: true, after: "审核后的知识正文"}],
    }));
    await waitFor(() => expect(screen.queryByRole("button", {name: "保存方案草稿"})).toBeNull());
    expect(screen.queryByText(/方案已保存/)).toBeNull();
    expect(api.execute).not.toHaveBeenCalled();
    expect(api.waitForJob).not.toHaveBeenCalled();
  });
  it("批量历史方案按点击问题展示，返回列表切换问题后不会串题", async () => {
    const saved = workspace("succeeded", "plan");
    const second = {...question, id: "q2", question: "第二个问题的渠道核验"};
    saved.state.questions.push(second);
    saved.state.jobs![0].questionIds = [question.id, second.id];
    const secondEvaluation = {...saved.state.evaluations[0], questionId: second.id, value: 63};
    saved.state.evaluations.push(secondEvaluation);
    saved.state.jobs![0].result = {
      completedAt: "2026-10-28T00:00:00Z", questions: [question, second],
      evaluations: saved.state.evaluations,
      plans: [question, second].map((item, index) => ({questionId: item.id, actions: [{
        id: `a-${index}`, kind: "node", title: `方案-${item.question}`,
        nodeId: "fixture-node", before: "", after: `建议-${item.question}`, source: "资料缺口", selected: true,
      }]})),
    };
    const {api} = pendingApi(saved), onOpenAnswer = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer}}/>);
    const secondRow = (await screen.findByText(second.question)).closest("tr")!;
    fireEvent.click(within(secondRow).getByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("heading", {name: second.question})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: question.question})).toBeNull();
    expect(screen.getByRole("region", {name: `优化动作：方案-${second.question}`})).toBeTruthy();
    expect(screen.queryByRole("region", {name: `优化动作：方案-${question.question}`})).toBeNull();
    expect(screen.queryByRole("button", {name: "进入应答逻辑"})).toBeNull();
    expect(screen.queryByText("1 个问题")).toBeNull();
    expect(onOpenAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "返回评估详情"}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(within(screen.getByText(question.question).closest("tr")!).getByRole("button", {name: "查看优化方案"}));
    expect(screen.getByRole("heading", {name: question.question})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: second.question})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "返回评估详情"}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    expect(screen.queryByRole("button", {name: /历史记录/})).toBeNull();
    expect(saved.state.jobs?.[0].result?.questions).toHaveLength(2);
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("刷新后恢复正在运行的评估，展示进度并进入完成详情，不重复派发", async () => {
    const {api, finish} = pendingApi(workspace("running"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await openCurrentTask();
    await screen.findByRole("heading", {name: "实时任务动态"});
    expect(api.waitForJob).toHaveBeenCalledWith("job-1", expect.any(Function), expect.any(AbortSignal));
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByRole("log", {name: "实时任务动态"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(screen.getByRole("checkbox", {name: `选择${question.question}`}));
    expect(screen.getByRole("button", {name: "批量评估并优化（1）"})).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", {name: "查看当前任务"}));
    expect(screen.getByRole("heading", {name: "实时任务动态"})).toBeTruthy();
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
    await screen.findByRole("heading", {name: "实时任务动态"});
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "evaluate", questionIds: ["q1"]}));
    await act(async () => finish(workspace("succeeded")));
    await screen.findByRole("button", {name: "生成优化方案"});
  });
  it("刷新后恢复方案生成并在完成时打开已保存的方案", async () => {
    const {api, finish} = pendingApi(workspace("running", "plan"));
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await openCurrentTask();
    await screen.findByRole("heading", {name: "实时任务动态"});
    const completed = workspace("succeeded", "plan");
    completed.state.plans = [{questionId: "q1", inputHash: "hash", actions: [{
      id: "action", kind: "node", nodeId: "fixture-node", title: "补充部署资料",
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
  it("词条直接加入清单并保持勾选，未评估显示待评估，不弹窗或自动创建模型任务", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const received = workspace();
    received.revision = 7;
    received.state.questions = [{...question, id: "table:0"}];
    const {api} = pendingApi(initial);
    vi.mocked(api.command).mockResolvedValueOnce(received);
    const onSectionChange = vi.fn();
    render(<IntentWorkbench keywordProps={{} as any} api={api} onSectionChange={onSectionChange}/>);
    await waitFor(() => expect(api.observe).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    await screen.findByRole("status", {name: "已加入优化清单"});
    expect(screen.queryByText(/已接收所选/)).toBeNull();
    expect(document.querySelector(".iw-handoff-banner")).toBeNull();
    expect(document.querySelector('.iw-catalog-table tr[data-question-id="table:0"]')?.classList.contains("iw-new-row")).toBe(true);
    expect(screen.queryByText("新加入")).toBeNull();
    expect(screen.getByRole("checkbox", {name: `选择${question.question}`})).toHaveProperty("checked", true);
    expect(screen.getByRole("columnheader", {name: "主要缺口"})).toBeTruthy();
    expect(onSectionChange).toHaveBeenCalledWith("list");
    expect(screen.queryByText("确认选择并交给问题优化（1）")).toBeNull();
    expect(screen.queryByText("回答要点支撑矩阵")).toBeNull();
    expect(screen.getAllByText("待评估").length).toBeGreaterThan(0);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "intake", expectedRevision: 1,
      questions: [expect.objectContaining({id: "table:0", question: question.question})]}));
    expect(api.waitForJob).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", {name: "优化问题"})).toBeTruthy();
    expect(screen.getByRole("button", {name: "批量评估并优化（1）"})).toHaveProperty("disabled", false);
    await waitFor(() => expect(screen.queryByRole("status", {name: "已加入优化清单"})).toBeNull(), {timeout: 1800});
  });
  it("流式更新任务动态时不显示未经校验评分", async () => {
    const initial = workspace("running");
    const {api, finish} = pendingApi(initial);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await openCurrentTask();
    await screen.findByRole("log", {name: "实时任务动态"});
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
  it("初次读取失败后直接加入可恢复读取并保存，不要求先评估", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const api: IntentWorkbenchApi = {observe: vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(initial),
      command: vi.fn().mockResolvedValue({...initial, revision: 2, state: {...initial.state, questions: [{...question, id: "table:0"}]}}),
      execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    await screen.findByRole("heading", {name: "优化问题"});
    expect(screen.getByText(question.question)).toBeTruthy();
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "intake"}));
  });
  it("再次加入已评估词条在清单复用来源记录和评分，不创建任务，宿主切页保持列表", async () => {
    const saved = workspace("succeeded");
    // The approved rewrite differs from the original source text.
    saved.state.questions[0].question = "企业软件有哪些部署条件？";
    const api: IntentWorkbenchApi = {observe: vi.fn().mockResolvedValue(saved),
      command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    const props = {keywordProps: {} as any, api, onSectionChange: vi.fn()};
    const rendered = render(<IntentWorkbench {...props}/>);
    await waitFor(() => expect(api.observe).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    await screen.findByRole("heading", {name: "优化问题"});
    rendered.rerender(<IntentWorkbench {...props} initialView="list"/>);
    expect(screen.queryByText("回答要点支撑矩阵")).toBeNull();
    expect(screen.getByText("企业软件有哪些部署条件？")).toBeTruthy();
    expect(screen.getByRole("checkbox", {name: "选择企业软件有哪些部署条件？"})).toHaveProperty("checked", true);
    expect(screen.getByRole("button", {name: "查看评估：企业软件有哪些部署条件？"}).textContent).toContain("80");
    expect(screen.getByRole("button", {name: "查看知识支撑：企业软件有哪些部署条件？"}).textContent).toContain("50");
    expect(api.command).not.toHaveBeenCalled();
    expect(api.observe).toHaveBeenCalledTimes(2);
  });
  it("加入中忽略重复点击，响应丢失后重试读取已保存记录，不重复入库或评估", async () => {
    const initial = workspace();
    initial.state.questions = [];
    const saved = workspace();
    saved.state.questions = [{...question, id: "table:0"}];
    let reject!: (cause: Error) => void;
    const api: IntentWorkbenchApi = {
      observe: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue(saved),
      command: vi.fn(() => new Promise<IntentWorkspace>((_, fail) => {reject = fail;})),
      execute: vi.fn(), rollback: vi.fn(),
    };
    render(<IntentWorkbench keywordProps={{} as any} api={api}/>);
    await waitFor(() => expect(document.querySelector(".iw-workbench")?.getAttribute("aria-busy")).toBe("false"));
    const add = screen.getByRole("button", {name: "交接测试问题"});
    fireEvent.click(add); fireEvent.click(add);
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status", {name: "正在加入优化清单"})).toBeTruthy();
    expect(screen.queryByRole("status", {name: "已加入优化清单"})).toBeNull();
    await act(async () => reject(new Error("保存响应丢失")));
    await screen.findByRole("alert");
    expect(screen.queryByRole("status", {name: /加入优化清单/})).toBeNull();
    expect(screen.getByRole("button", {name: "交接测试问题"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "交接测试问题"}));
    await screen.findByRole("heading", {name: "优化问题"});
    expect(screen.getByRole("status", {name: "已加入优化清单"})).toBeTruthy();
    expect(screen.getByRole("checkbox", {name: `选择${question.question}`})).toHaveProperty("checked", true);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.observe).toHaveBeenCalledTimes(3);
  });
  it("列表直接进入应答逻辑，保留修改删除及只读评分", async () => {
    const saved = workspace("succeeded"), onOpenAnswer = vi.fn();
    saved.state.plans = [{questionId: "q1", actions: [{id: "a", kind: "node", title: "部署资料",
      nodeId: "fixture-node", before: "", after: "原方案", source: "缺口", selected: true}]}];
    const {api} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api} catalogIntegration={{onOpenAnswer}}/>);
    await screen.findByRole("button", {name: "查看优化方案"});
    for (const name of ["新增问题", "返回词条生成与保存", "继续审核已保存方案"]) {
      expect(screen.queryByRole("button", {name})).toBeNull();
    }
    expect(screen.queryByText("从企业信息和参考材料生成问题")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "进入应答逻辑"}));
    expect(onOpenAnswer).toHaveBeenCalledWith(question);
    expect(screen.getByRole("button", {name: "修改问题"})).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", {name: "删除问题"})).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", {name: `查看知识支撑：${question.question}`}));
    expect(api.command).not.toHaveBeenCalled();
  });
  it("修改只提交所选问题，失败保留输入，成功显示最新内容而不发起评估", async () => {
    const initial = workspace("succeeded");
    initial.state.questions[0].subdivision = "场景方案";
    const updated = structuredClone(initial);
    updated.revision++; updated.state.questions[0].question = "企业软件的部署条件有哪些？";
    updated.state.evaluations = [];
    const api: IntentWorkbenchApi = {observe: vi.fn(async () => initial),
      command: vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValue(updated), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: "修改问题"}));
    expect(screen.queryByRole("combobox", {name: "修改问题分类"})).toBeNull();
    expect(screen.queryByRole("textbox", {name: "问题细分"})).toBeNull();
    fireEvent.change(screen.getByRole("textbox", {name: "问题内容"}), {target: {value: updated.state.questions[0].question}});
    fireEvent.click(screen.getByRole("button", {name: "保存修改"}));
    await waitFor(() => expect(screen.getByRole("textbox", {name: "问题内容"})).toHaveProperty("disabled", false));
    expect(screen.getByRole("textbox", {name: "问题内容"})).toHaveProperty("value", updated.state.questions[0].question);
    fireEvent.click(screen.getByRole("button", {name: "保存修改"}));
    await waitFor(() => expect(screen.queryByRole("textbox", {name: "问题内容"})).toBeNull());
    expect(api.command).toHaveBeenLastCalledWith({kind: "update-question", expectedRevision: 1, questionId: "q1",
      question: updated.state.questions[0].question, category: "industry", subdivision: "场景方案"});
    expect(screen.getByText(updated.state.questions[0].question)).toBeTruthy();
    expect(screen.getByRole("button", {name: "评估问题"})).toBeTruthy();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("评分详情弹窗展示全部维度与说明，关闭后可以重新查看且不创建评估任务", async () => {
    const initial = workspace("succeeded");
    initial.state.evaluations[0].dimensions = ["意图明确度", "品牌关联度", "决策价值", "表达清晰度", "问题独特度", "知识支撑度"]
      .map((label, index) => ({label, score: 60 + index * 5, reason: `评分说明${index + 1}`}));
    const api: IntentWorkbenchApi = {observe: vi.fn(async () => initial), command: vi.fn(), execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    const trigger = await screen.findByRole("button", {name: "查看 6 项评分维度"});
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    for (const dimension of initial.state.evaluations[0].dimensions) {
      expect(within(dialog).getByRole("heading", {name: dimension.label})).toBeTruthy();
      expect(within(dialog).getByText(dimension.reason)).toBeTruthy();
      expect(within(dialog).getByText(String(dimension.score))).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByRole("button", {name: "关闭评分详情"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByRole("button", {name: "关闭"})).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "关闭评分详情"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("删除直接执行并支持撤销，不再弹出确认框", async () => {
    const initial = workspace("succeeded"), removed = structuredClone(initial);
    removed.state.questions = []; removed.state.evaluations = [];
    const restored = structuredClone(initial);
    const api: IntentWorkbenchApi = {observe: vi.fn(async () => initial),
      command: vi.fn(async (value: any) => value.kind === "intake" ? structuredClone(restored) : structuredClone(removed)),
      execute: vi.fn(), rollback: vi.fn()};
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("checkbox", {name: `选择${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "删除问题"}));
    // 已确认的交互：无确认弹窗，命令立即发出。
    expect(screen.queryByRole("button", {name: "确认删除"})).toBeNull();
    await waitFor(() => expect(api.command).toHaveBeenCalledWith({kind: "delete-question", questionId: "q1", expectedRevision: 1}));
    await waitFor(() => expect(screen.queryByRole("button", {name: "删除问题"})).toBeNull());
    expect(screen.queryByRole("button", {name: "批量评估并优化（1）"})).toBeNull();
    expect(screen.queryByRole("button", {name: /历史记录/})).toBeNull();
    // 撤销条出现；手工加入的问题通过 intake 恢复。
    fireEvent.click(await screen.findByRole("button", {name: "撤销删除"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "intake", questions: [question]})));
    await screen.findByRole("button", {name: "删除问题"});
  });
  it("另一问题生成方案只针对该问题，不沿用上一次查看的评分范围", async () => {
    const saved = workspace("succeeded");
    saved.state.questions.push({...question, id: "q2", question: "第二个问题"});
    saved.state.evaluations.push({...saved.state.evaluations[0], questionId: "q2"});
    const {api, finish} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    fireEvent.click(await screen.findByRole("button", {name: `查看评估：${question.question}`}));
    fireEvent.click(screen.getByRole("button", {name: "返回问题列表"}));
    fireEvent.click(within(screen.getByText("第二个问题").closest("tr")!).getByRole("button", {name: "生成优化方案"}));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({kind: "plan", questionIds: ["q2"]})));
    expect(api.command).toHaveBeenCalledTimes(1);
    await act(async () => finish(saved));
  });
  it("移除列表历史入口不触发命令，也不删除服务器历史回执", async () => {
    const saved = workspace("succeeded");
    saved.state.receipts = [{id: "receipt-1", status: "completed", createdAt: "2026-10-28T00:00:00Z",
      changes: [], before: [], after: saved.state.evaluations}];
    const {api} = pendingApi(saved);
    render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
    await screen.findByText(question.question);
    expect(screen.queryByRole("button", {name: /历史记录/})).toBeNull();
    expect(saved.state.receipts[0].id).toBe("receipt-1");
    expect(api.command).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
});

 it("关闭完成提示后重新进入列表也不再占据顶部，已有评分仍可查看", async () => {
  const {api, finish} = pendingApi(workspace("running"));
  render(<IntentWorkbench keywordProps={{} as any} initialView="list" api={api}/>);
  await screen.findByRole("region", {name:"问题评估任务"});
  await act(async () => finish(workspace("succeeded")));
  fireEvent.click(screen.getByRole("button", {name:"关闭评估完成提示"}));
  expect(screen.queryByRole("region", {name:"问题评估任务"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:`查看评估：${question.question}`}));
  fireEvent.click(screen.getByRole("button", {name:"返回问题列表"}));
  expect(screen.queryByRole("region", {name:"问题评估任务"})).toBeNull();
  expect(api.command).not.toHaveBeenCalled();
 });

 it("完成提示八秒自动收起，父组件更新不会重置倒计时", () => {
  vi.useFakeTimers();
  try {
    const first=vi.fn(), latest=vi.fn();
    const job=workspace("succeeded").state.jobs![0];
    const result=render(<IntentListEvaluationStatus job={job} uncertain={false} onViewTask={vi.fn()} onDismiss={first}/>);
    act(()=>{vi.advanceTimersByTime(4000);});
    result.rerender(<IntentListEvaluationStatus job={{...job}} uncertain={false} onViewTask={vi.fn()} onDismiss={latest}/>);
    act(()=>{vi.advanceTimersByTime(4000);});
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
 });
