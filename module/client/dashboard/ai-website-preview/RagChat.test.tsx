import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@frontmind/module-ui/lib/utils";
import { RagChat } from "./RagChat";
vi.mock("@frontmind/module-ui/lib/utils", async original => ({ ...await original<object>(), copyToClipboard: vi.fn(async () => true) }));
const base = () => ({ scopeKey:"task-a", live:true, assistantName:"企业助手", question:"支持部署吗？", answer:"", answerKey:"", sources:[], busy:false, running:false, canEdit:true, canSubmit:true, input:"部署问题", inputRef:createRef<HTMLTextAreaElement>(), onInput:vi.fn(), onSubmit:vi.fn(async () => {}), onStop:vi.fn(async () => true), onEvidence:vi.fn() });
const phase = () => document.querySelector(".rag-chat-response")?.getAttribute("data-phase");
const deferred = <T,>() => { let resolve!: (value:T) => void; const promise = new Promise<T>(r => {resolve=r;}); return {promise,resolve}; };
beforeEach(() => { vi.useFakeTimers(); vi.mocked(copyToClipboard).mockReset(); vi.mocked(copyToClipboard).mockResolvedValue(true); localStorage.clear(); vi.stubGlobal("matchMedia",vi.fn(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("RAG chat presentation", () => {
  it("shows earlier turns and keeps the preview-only editor after the speech action", () => {
    const edit = vi.fn();
    const props = { ...base(), live: false, answer: "当前回答", answerKey: "current", onEditAnswer: edit,
      previousTurns: [{ id: "a", question: "先前问题", answer: "**先前回答**" }, { id: "b", question: "未回答的问题", answer: "" }] };
    const view = render(<RagChat {...props} />);
    expect(screen.getByText("先前问题")).toBeTruthy();
    expect(screen.getByText("先前回答").tagName).toBe("STRONG");
    expect(screen.getByText("未回答的问题")).toBeTruthy();
    const tools = screen.getByRole("group", { name: "回答操作" });
    expect([...tools.querySelectorAll(":scope > button, :scope > .rag-chat-feedback > button")].map(item => item.getAttribute("aria-label"))).toEqual(["复制回答", "评价回答", "朗读", "编辑回答"]);
    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    expect(edit).toHaveBeenCalledOnce();
    view.rerender(<RagChat {...base()} answer="当前回答" answerKey="current" />);
    expect(screen.queryByRole("button", { name: "编辑回答" })).toBeNull();
  });
  it("renders safe Markdown and copies the original complete response with two-second feedback", async () => {
    const answer = '**部署说明**\n\n- 支持私有化\n- 请先确认环境\n\n[资料](https://example.com)\n\n```js\nconst value = 1;\n```\n\n|条件|说明|\n|---|---|\n|网络|内网|\n\n<script>alert(1)</script>';
    const view=render(<RagChat {...base()} answer={answer} answerKey="a1" />);
    expect(screen.getByText("部署说明").tagName).toBe("STRONG"); expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link",{name:"资料"}).getAttribute("href")).toBe("https://example.com"); expect(screen.getByRole("table")).toBeTruthy(); expect(view.container.querySelector("script")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"复制回答"})));
    expect(copyToClipboard).toHaveBeenCalledWith(answer); expect(screen.getByRole("button",{name:"已复制"})).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000)); expect(screen.getByRole("button",{name:"复制回答"})).toBeTruthy();
  });
  it("animates only a new response after waiting and keeps references functional", () => {
    const props=base(); const view=render(<RagChat {...props} answer="历史回答" answerKey="old" />); expect(phase()).toBe("ready");
    view.rerender(<RagChat {...props} busy running />); expect(screen.getByTestId("rag-chat-wait").textContent).toBe("正在处理…");
    view.rerender(<RagChat {...props} answer="新回答" answerKey="new" sources={[{id:"s1",title:"企业资料"}]} />); expect(phase()).toBe("leaving");
    act(() => vi.advanceTimersByTime(120)); expect(phase()).toBe("revealing"); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"[1] 企业资料"})); expect(props.onEvidence).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(240)); expect(phase()).toBe("ready");
    view.rerender(<RagChat {...props} answer="新回答" answerKey="new" input="下一条草稿" />); expect(phase()).toBe("ready");
  });
  it("cancels animations on a conversation switch and does not animate restored answers", () => {
    const props=base(); const view=render(<RagChat {...props} busy running />);
    view.rerender(<RagChat {...props} answer="新回答" answerKey="a1" />); expect(phase()).toBe("leaving");
    view.rerender(<RagChat {...props} scopeKey="task-b" question="另一个问题" answer="历史回答" answerKey="b1" />);
    act(() => vi.runAllTimers()); expect(phase()).toBe("ready"); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });
  it("shows completed answers immediately under reduced motion", () => {
    vi.stubGlobal("matchMedia",vi.fn(() => ({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
    const props=base(); const view=render(<RagChat {...props} busy running />);
    view.rerender(<RagChat {...props} answer="新回答" answerKey="a1" />); expect(phase()).toBe("ready"); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });
  it("handles Enter, Shift+Enter and IME while preventing duplicate submissions and allowing drafts", async () => {
    const request=deferred<void>(); const props={...base(),onSubmit:vi.fn(() => request.promise)}; render(<RagChat {...props} />);
    const input=screen.getByRole("textbox"); fireEvent.keyDown(input,{key:"Enter",shiftKey:true}); fireEvent.compositionStart(input); fireEvent.keyDown(input,{key:"Enter"}); fireEvent.compositionEnd(input); fireEvent.keyDown(input,{key:"Enter",isComposing:true}); expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input,{key:"Enter"}); fireEvent.submit(input.closest("form")!); expect(props.onSubmit).toHaveBeenCalledTimes(1); expect(input.hasAttribute("disabled")).toBe(false);
    fireEvent.change(input,{target:{value:"下一条草稿"}}); expect(props.onInput).toHaveBeenCalledWith("下一条草稿"); await act(async () => request.resolve());
  });
  it("clears the waiting animation after submission failure", async () => {
    render(<RagChat {...base()} onSubmit={async () => {throw new Error("提交失败");}} />);
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"发送问题"})));
    expect(screen.getByRole("alert").textContent).toBe("提交失败"); expect(screen.queryByTestId("rag-chat-wait")).toBeNull(); expect(screen.getByRole("button",{name:"发送问题"}).hasAttribute("disabled")).toBe(false);
  });
  it("uses one action slot and locks stop requests while allowing retries after failure", async () => {
    const stopping=deferred<boolean>(); const props={...base(),busy:true,running:true,onStop:vi.fn(() => stopping.promise)}; const view=render(<RagChat {...props} />);
    expect(document.querySelectorAll(".rag-chat-send")).toHaveLength(1); expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:"停止回答"})); fireEvent.submit(screen.getByRole("textbox").closest("form")!); expect(props.onStop).toHaveBeenCalledTimes(1); expect(props.onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole("button",{name:"正在停止回答"}).hasAttribute("disabled")).toBe(true);
    await act(async () => stopping.resolve(false)); expect(screen.getByRole("alert").textContent).toContain("未能停止");
    const retry=vi.fn(async () => true); view.rerender(<RagChat {...props} onStop={retry} />); await act(async () => fireEvent.click(screen.getByRole("button",{name:"停止回答"})));
    view.rerender(<RagChat {...props} busy={false} running={false} onStop={retry} />); expect(screen.getByText("已停止回答。")).toBeTruthy(); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });
  it("ignores stale asynchronous completion after switching conversations", async () => {
    const request=deferred<void>(); const props={...base(),onSubmit:vi.fn(() => request.promise)}; const view=render(<RagChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"发送问题"})); view.rerender(<RagChat {...props} scopeKey="task-b" answer="另一会话" answerKey="b1" />);
    await act(async () => request.resolve()); expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });
  it("keeps feedback exclusive, reversible, and isolated by scope and answer", () => {
    const props={...base(),answer:"回答",answerKey:"answer-a"}; const view=render(<RagChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"评价回答"})); fireEvent.click(screen.getByRole("menuitemradio",{name:"有帮助"}));
    expect(screen.getByRole("button",{name:"已赞，修改评价"}).getAttribute("data-rating")).toBe("up");
    expect(screen.getByRole("button",{name:"已赞，修改评价"}).querySelector(`[data-gesture="up"]`)?.getAttribute("fill")).toBe("currentColor");
    fireEvent.click(screen.getByRole("button",{name:"已赞，修改评价"})); fireEvent.click(screen.getByRole("menuitemradio",{name:"没有帮助"}));
    expect(screen.getByRole("button",{name:"已踩，修改评价"}).getAttribute("data-rating")).toBe("down");
    view.rerender(<RagChat {...props} scopeKey="task-b" />); expect(screen.getByRole("button",{name:"评价回答"})).toBeTruthy();
    view.rerender(<RagChat {...props} />); fireEvent.click(screen.getByRole("button",{name:"已踩，修改评价"})); fireEvent.click(screen.getByRole("menuitemradio",{name:"没有帮助"}));
    expect(screen.getByRole("button",{name:"评价回答"})).toBeTruthy();
  });
  it("reads rendered text, supports stopping and cleans up speech when the answer changes", () => {
    const speak=vi.fn(); const cancel=vi.fn();
    class Utterance { constructor(public text:string) {} lang=""; voice=null; onend=null; onerror=null; }
    vi.stubGlobal("SpeechSynthesisUtterance",Utterance);
    vi.stubGlobal("speechSynthesis",{speak,cancel,getVoices:()=>[]});
    const props={...base(),answer:"**部署说明**",answerKey:"a1"}; const view=render(<RagChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"朗读"})); expect(speak.mock.calls[0][0].text).toBe("部署说明"); expect(speak.mock.calls[0][0].lang).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button",{name:"停止朗读"})); expect(cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button",{name:"朗读"})); view.rerender(<RagChat {...props} answer="另一回答" answerKey="a2" />); expect(cancel).toHaveBeenCalledTimes(2); expect(screen.getByRole("button",{name:"朗读"})).toBeTruthy();
  });
  it("keeps unsupported speech accessible and reports copy failure", async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    render(<RagChat {...base()} answer="回答" answerKey="a1" />);
    expect(screen.getByRole("button",{name:"朗读"}).getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"复制回答"})));
    expect(screen.getByRole("alert").textContent).toContain("复制失败");
  });

  it("supports keyboard dismissal of feedback and shows the persisted completion time", () => {
    const completedAt=new Date("2026-11-05T15:45:00Z").getTime();
    const props={...base(),answer:"回答",answerKey:"a1",completedAt}; const view=render(<RagChat {...props} />);
    const trigger=screen.getByRole("button",{name:"评价回答"}); fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio",{name:"有帮助"})).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!,{key:"ArrowRight"}); expect(screen.getByRole("menuitemradio",{name:"没有帮助"})).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!,{key:"Escape"}); expect(trigger).toBe(document.activeElement); expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-05T15:45:00.000Z");
    const text=view.container.querySelector("time")?.textContent; view.rerender(<RagChat {...props} input="草稿" />); expect(view.container.querySelector("time")?.textContent).toBe(text);
    view.rerender(<RagChat {...props} completedAt={new Date(2026,10,6,0,7).getTime()} />); expect(view.container.querySelector("time")?.textContent).toBe("12:07 AM");
    view.rerender(<RagChat {...props} completedAt={new Date(2026,10,6,12,7).getTime()} />); expect(view.container.querySelector("time")?.textContent).toBe("12:07 PM");
  });

  it("shows measured elapsed time in the header and never invents it for restored fixtures", () => {
    const props={...base(),busy:true,running:true,startedAt:Date.now()}; const view=render(<RagChat {...props} />);
    act(() => vi.advanceTimersByTime(1500)); expect(screen.getByLabelText("本轮回答耗时 1.5 秒")).toBeTruthy();
    view.rerender(<RagChat {...props} busy={false} running={false} answer="回答" answerKey="a1" durationMs={1900} />);
    expect(screen.getByLabelText("本轮回答耗时 1.9 秒")).toBeTruthy();
    view.rerender(<RagChat {...props} scopeKey="restored" busy={false} running={false} answer="预置回答" answerKey="b1" />);
    expect(document.querySelector(".rag-chat-elapsed")).toBeNull();
  });

  it("submits a supplement once while keeping stop available, and clears only the accepted draft", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,turnKey:"turn-a",steeringSupported:true,onSteer:vi.fn(() => request.promise)};
    render(<RagChat {...props} />);
    const supplement=screen.getByRole("button",{name:"补充当前回答"});
    expect(supplement.querySelector("svg")?.getAttribute("width")).toBe("18");
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(props.onSteer).toHaveBeenCalledTimes(1);
    expect(props.onSteer).toHaveBeenCalledWith("部署问题");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"正在补充当前回答"}).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button",{name:"停止回答"}).hasAttribute("disabled")).toBe(false);
    await act(async () => request.resolve(true));
    expect(props.onInput).toHaveBeenCalledWith("");
  });

  it("preserves characters typed while a supplement is being acknowledged", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,turnKey:"turn-a",steeringSupported:true,onSteer:vi.fn(() => request.promise)};
    const view=render(<RagChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"补充当前回答"}));
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"新的补充草稿"}});
    view.rerender(<RagChat {...props} input="新的补充草稿" />);
    props.onInput.mockClear();
    await act(async () => request.resolve(true));
    expect(props.onInput).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("新的补充草稿");
  });

  it("retains a rejected supplement and permits an explicit retry", async () => {
    const onSteer=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const props={...base(),busy:true,running:true,turnKey:"turn-a",steeringSupported:true,onSteer};
    render(<RagChat {...props} />);
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"补充当前回答"})));
    expect(screen.getByRole("alert").textContent).toContain("输入已保留");
    expect(props.onInput).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"停止回答"}).hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"补充当前回答"})));
    expect(onSteer).toHaveBeenCalledTimes(2);
    expect(props.onInput).toHaveBeenCalledWith("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a late supplement receipt after changing turns within the same conversation", async () => {
    const first=deferred<boolean>(),second=deferred<boolean>();
    const props={...base(),busy:true,running:true,steeringSupported:true,onSteer:vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)};
    const view=render(<RagChat {...props} turnKey="turn-a" />);
    fireEvent.click(screen.getByRole("button",{name:"补充当前回答"}));
    view.rerender(<RagChat {...props} turnKey="turn-b" input="另一轮草稿" />);
    fireEvent.click(screen.getByRole("button",{name:"补充当前回答"}));
    await act(async () => first.resolve(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(props.onInput).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"正在补充当前回答"}).hasAttribute("disabled")).toBe(true);
    await act(async () => second.resolve(true));
    expect(props.onInput).toHaveBeenCalledWith("");
  });

  it("keeps unsupported supplements as drafts and guards Enter during Chinese composition", async () => {
    const onSteer=vi.fn(async () => true);
    const props={...base(),busy:true,running:true,turnKey:"turn-a",steeringSupported:false,onSteer};
    const view=render(<RagChat {...props} />);
    expect(screen.getByRole("button",{name:"补充当前回答"}).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("当前模型暂不支持本轮补充，输入会保留为草稿。")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    expect(onSteer).not.toHaveBeenCalled();
    expect(props.onInput).not.toHaveBeenCalled();
    view.rerender(<RagChat {...props} steeringSupported />);
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter",shiftKey:true});
    fireEvent.compositionStart(screen.getByRole("textbox"));
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    fireEvent.compositionEnd(screen.getByRole("textbox"));
    expect(onSteer).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"}));
    expect(onSteer).toHaveBeenCalledTimes(1);
  });

  it("shows only real public activity while waiting and removes it after the answer transition", () => {
    const props={...base(),busy:true,running:true,turnKey:"turn-a"};
    const view=render(<RagChat {...props} activity={[
      {id:"read-1",label:"读取文件",status:"completed"},
      {id:"read-2",label:"读取文件",status:"completed"},
      {id:"edit",label:"编辑文件",status:"running"},
    ]} />);
    expect(screen.getByText("已读取文件（2 次）").closest("[data-activity-status]")?.getAttribute("data-activity-status")).toBe("completed");
    expect(screen.getByText("正在编辑文件…").closest("[data-activity-status]")?.getAttribute("data-activity-status")).toBe("running");
    expect(screen.queryByText("正在处理…")).toBeNull();
    view.rerender(<RagChat {...props} busy={false} running={false} answer="最终回答" answerKey="a1" activity={[]} />);
    expect(phase()).toBe("leaving");
    expect(screen.getByText("正在编辑文件…")).toBeTruthy();
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
    expect(screen.queryByText("正在编辑文件…")).toBeNull();
    view.rerender(<RagChat {...props} scopeKey="other" busy={false} running={false} answer="恢复的回答" answerKey="b1" />);
    expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });

});
