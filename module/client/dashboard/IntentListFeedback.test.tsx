import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import {IntentTaskTray, IntentListEvaluationStatus} from "./IntentListFeedback";

afterEach(() => {cleanup(); vi.useRealTimers();});
const task = (patch: Partial<IntentSkillJob> = {}): IntentSkillJob => ({
  id: "job-1", taskId: "job-1", kind: "evaluate", questionIds: ["q1"], status: "running",
  createdAt: "2026-11-07T12:00:00Z", inputHash: "", knowledgeHash: "", questionsHash: "",
  credentialId: "", credentialVersion: 1, skillHash: "", model: "", ...patch,
});
describe("评估任务完成状态", () => {
  it.each(["evaluate","plan"] as const)("%s暂停时明确区分查看与继续，恢复中不能重复提交",kind=>{
    const resume=vi.fn(),viewTask=vi.fn();
    const props={uncertain:false,onViewTask:viewTask,onResume:resume};
    const view=render(<IntentListEvaluationStatus {...props} job={task({kind,status:"paused"})}/>);
    const label=kind==="plan"?"继续生成方案":"继续评估";
    fireEvent.click(screen.getByRole("button",{name:"查看暂停详情"}));
    expect(viewTask).toHaveBeenCalledTimes(1);expect(resume).not.toHaveBeenCalled();
    const button=screen.getByRole("button",{name:label});
    expect(button.classList.contains("iw-task-resume")).toBe(true);
    fireEvent.click(button);expect(resume).toHaveBeenCalledTimes(1);
    view.rerender(<IntentListEvaluationStatus {...props} job={task({kind,status:"resuming"})}/>);
    expect(screen.queryByRole("button",{name:label})).toBeNull();
    expect(screen.getByRole("button",{name:/正在恢复/})).toHaveProperty("disabled",true);
  });
  it("只有可关闭的完成提示才启动一次自动收起计时器", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const props = {job: task({status: "succeeded"}), uncertain: false, onViewTask: vi.fn()};
    const view = render(<IntentListEvaluationStatus {...props} onDismiss={onDismiss}/>);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {vi.advanceTimersByTime(7999);});
    expect(onDismiss).not.toHaveBeenCalled();
    view.rerender(<IntentListEvaluationStatus {...props} onDismiss={onDismiss}/>);
    act(() => {vi.advanceTimersByTime(1);});
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("撤销关闭能力或卸载提示时清理自动收起计时器", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const props = {job: task({status: "succeeded"}), uncertain: false, onViewTask: vi.fn()};
    const view = render(<IntentListEvaluationStatus {...props} onDismiss={onDismiss}/>);
    view.rerender(<IntentListEvaluationStatus {...props}/>);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {vi.advanceTimersByTime(8000);});
    expect(onDismiss).not.toHaveBeenCalled();
    view.rerender(<IntentListEvaluationStatus {...props} onDismiss={onDismiss}/>);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("关闭自动收起时仍可手动关闭完成提示", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<IntentListEvaluationStatus job={task({status: "succeeded"})} uncertain={false} onViewTask={vi.fn()} onDismiss={onDismiss} autoDismiss={false}/>);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", {name: "关闭评估完成提示"}));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it("运行中更新耗时，完成后固定为保存结果的完成时间并停止计时器", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T12:00:10Z"));
    const props = {uncertain: false, onViewTask: vi.fn(), onViewResult: vi.fn()};
    const view = render(<IntentListEvaluationStatus {...props} job={task()}/>);
    expect(screen.getByText("已耗时 0分10秒")).toBeTruthy();
    act(() => {vi.advanceTimersByTime(2000);});
    expect(screen.getByText("已耗时 0分12秒")).toBeTruthy();
    const completed = task({status: "succeeded", result: {
      completedAt: "2026-11-07T12:00:11Z", questions: [], evaluations: [], plans: [],
    }});
    view.rerender(<IntentListEvaluationStatus {...props} job={completed}/>);
    expect(screen.getByText("已耗时 0分11秒")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {vi.advanceTimersByTime(120000);});
    view.rerender(<IntentListEvaluationStatus {...props} job={completed}/>);
    expect(screen.getByText("已耗时 0分11秒")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "查看评估结果"}));
    expect(props.onViewResult).toHaveBeenCalledTimes(1);
    expect(props.onViewTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: "查看当前任务"})).toBeNull();
  });
  it.each(["succeeded", "failed"] as const)("无结果完成时间时使用服务端终态时间并保持固定（%s）", status => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T12:05:00Z"));
    render(<IntentListEvaluationStatus uncertain={false} onViewTask={vi.fn()} job={task({
      status, terminalObservedAt: Date.parse("2026-11-07T12:01:05Z"),
      progress: {stage: "validating", updatedAt: "2026-11-07T12:00:50Z", events: []},
    })}/>);
    expect(screen.getByText("已耗时 1分5秒")).toBeTruthy();
    act(() => {vi.advanceTimersByTime(10000);});
    expect(screen.getByText("已耗时 1分5秒")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("缺少终态时间时固定首次观察耗时，重新渲染也不续计时", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T12:01:00Z"));
    const completed = task({status: "succeeded"});
    const view = render(<IntentListEvaluationStatus uncertain={false} onViewTask={vi.fn()} job={completed}/>);
    expect(screen.getByText("已耗时 1分0秒")).toBeTruthy();
    act(() => {vi.advanceTimersByTime(60000);});
    view.rerender(<IntentListEvaluationStatus uncertain onViewTask={vi.fn()} job={completed}/>);
    expect(screen.getByText("已耗时 1分0秒")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("任务区默认折叠，展开状态跨进度更新保留，折叠不触发任务控制",()=>{
  const pause=vi.fn();const jobs=[task(),task({id:"paused",status:"paused"}),task({id:"failed",status:"failed"})];
  const children=<button onClick={pause}>暂停独立任务</button>;
  const view=render(<IntentTaskTray jobs={jobs}>{children}</IntentTaskTray>);
  const tray=view.container.querySelector("details")!,summary=tray.querySelector("summary")!;
  expect(tray.open).toBe(false);
  expect(summary.textContent).toContain("进行中 1");expect(summary.textContent).toContain("已暂停 1");expect(summary.textContent).toContain("需处理 1");
  fireEvent.click(summary);expect(tray.open).toBe(true);
  view.rerender(<IntentTaskTray jobs={[...jobs,task({id:"another"})]}>{children}</IntentTaskTray>);
  expect(tray.open).toBe(true);expect(summary.textContent).toContain("进行中 2");
  fireEvent.click(summary);expect(tray.open).toBe(false);expect(pause).not.toHaveBeenCalled();
});
