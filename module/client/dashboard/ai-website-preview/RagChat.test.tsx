import { createRef, useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@frontmind/module-ui/lib/utils";
import { DEFAULT_RAG_STARTER_QUESTIONS, RagChat } from "./RagChat";
const ragChatStyles = readFileSync("client/dashboard/ai-website-preview/rag-chat.css", "utf8");
vi.mock("@frontmind/module-ui/lib/utils", async original => ({ ...await original<object>(), copyToClipboard: vi.fn(async () => true) }));
const base = () => ({ scopeKey:"task-a", live:true, assistantName:"企业助手", question:"支持部署吗？", answer:"", answerKey:"", sources:[], busy:false, running:false, canStop:true, canEdit:true, canSubmit:true, input:"部署问题", inputRef:createRef<HTMLTextAreaElement>(), onInput:vi.fn(), onSubmit:vi.fn(async () => {}), onStop:vi.fn(async () => true), onEvidence:vi.fn(), starterQuestions:{ current:{ id:"server-current", questions:[...DEFAULT_RAG_STARTER_QUESTIONS] }, revision:1 } });
const phase = () => document.querySelector(".rag-chat-response")?.getAttribute("data-phase");
const deferred = <T,>() => { let resolve!: (value:T) => void; const promise = new Promise<T>(r => {resolve=r;}); return {promise,resolve}; };
// The immutable image builder is deliberately resource-bounded; animation
// and act() flushes there run several times slower than a developer machine.
// The immutable image builder is deliberately resource-bounded; animation
// and act() flushes there run several times slower than a developer machine.
// Staying above the worker RPC default also extends that timeout window.
vi.setConfig({ testTimeout: 90000, hookTimeout: 30000 });
beforeEach(() => { vi.mocked(copyToClipboard).mockReset(); vi.mocked(copyToClipboard).mockResolvedValue(true); localStorage.clear(); vi.stubGlobal("matchMedia",vi.fn(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function ControlledChat(props: Parameters<typeof RagChat>[0]) {
  const [input, setInput] = useState(props.input);
  useEffect(() => setInput(props.input), [props.scopeKey, props.input]);
  return <RagChat {...props} input={input} onInput={value => { setInput(value); props.onInput(value); }} />;
}
function SendingChat({ starter = false, changeScope = false, historySwitch = false }: { starter?: boolean; changeScope?: boolean; historySwitch?: boolean }) {
  const [scopeKey, setScopeKey] = useState("draft:new");
  const [question, setQuestion] = useState("");
  const [input, setInput] = useState(starter ? "" : "新的业务问题");
  const [inputRef] = useState(() => createRef<HTMLTextAreaElement>());
  return <>
    {historySwitch && <button type="button" onClick={() => { setScopeKey("history:other"); setQuestion("历史业务问题"); }}>查看其他历史对话</button>}
    <RagChat {...base()} scopeKey={scopeKey} inputRef={inputRef} question={question} input={input} onInput={setInput} onSubmit={async override => {
      if (changeScope) setScopeKey("conversation:created");
      setQuestion((override ?? input).trim());
      setInput("");
      return true;
    }} />
  </>;
}
function RunningStarterChat({ onFollowup }: { onFollowup: (text: string) => Promise<boolean> }) {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [inputRef] = useState(() => createRef<HTMLTextAreaElement>());
  return <RagChat {...base()} scopeKey="starter-session" inputRef={inputRef} question={question} answer={running ? "正在补充企业介绍。" : ""} answerKey={running ? "answer-1" : ""} input="" onInput={() => {}} running={running} busy={running} onFollowup={onFollowup} onSubmit={async override => {
    setQuestion(override?.trim() ?? "");
    setRunning(true);
    return true;
  }} />;
}
describe("RAG chat presentation", () => {
  describe("starter basics", () => {
  it("greets a blank live conversation and sends a fallback starter only once", async () => {
    const request = deferred<void>();
    const props = { ...base(), question: "", input: "", onSubmit: vi.fn(() => request.promise) };
    const view = render(<RagChat {...props} />);
    expect(screen.getByText(/你好！我是企业助手/)).toBeTruthy();
    const welcome = screen.getByRole("article", { name: "企业助手欢迎" });
    const tools = screen.getByRole("group", { name: "回答操作" });
    expect([...tools.querySelectorAll(":scope > button, :scope > .rag-chat-feedback > button")].map(item => item.getAttribute("aria-label"))).toEqual(["复制回答", "评价回答", "朗读"]);
    expect(tools.querySelector("time")).toBeTruthy();
    expect(within(welcome).getByText(/你好！我是企业助手/).classList.contains("is-entrance")).toBe(true);
    expect(document.querySelector(".rag-chat-starters__questions")?.classList.contains("is-entrance")).toBe(true);
    expect(ragChatStyles).toContain("from { opacity:0; transform:translateX(-8px); }");
    expect(ragChatStyles).toContain("button:nth-child(1) { animation-delay:80ms; }");
    expect(ragChatStyles).toContain("button:nth-child(3) { animation-delay:240ms; }");
    expect(ragChatStyles).toContain(".rag-chat-welcome-copy.is-entrance,");
    expect(ragChatStyles).toContain("animation:none;");
    const starter = screen.getByRole("button", { name: "可以简单介绍一下你们吗？" });
    fireEvent.click(starter); fireEvent.click(starter);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith("可以简单介绍一下你们吗？");
    await act(async () => request.resolve());
    expect(screen.queryByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeNull();
    expect(screen.getByRole("button", { name: "你们主要提供哪些产品或服务？" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "我可以先了解哪些核心信息？" })).toBeTruthy();
    view.rerender(<RagChat {...props} scopeKey="task-a:conversation-1:task-1" question="可以简单介绍一下你们吗？" answer="这里是企业介绍。" answerKey="answer-1" />);
    const answerWelcome = screen.getByRole("article", { name: "企业助手欢迎" });
    expect(answerWelcome).not.toBe(welcome);
    expect(within(answerWelcome).getByText(/你好！我是企业助手/)).toBeTruthy();
    expect(within(answerWelcome).getByText(/你好！我是企业助手/).classList.contains("is-entrance")).toBe(false);
    const remaining = within(answerWelcome).getByRole("group", { name: "当前预设问题" });
    expect(within(remaining).getAllByRole("button")).toHaveLength(2);
    expect(remaining.classList.contains("is-entrance")).toBe(false);
    expect(screen.getByText("可以简单介绍一下你们吗？", { selector: ".erag-user-message" })).toBeTruthy();
    expect(screen.getByText("这里是企业介绍。")).toBeTruthy();
    view.rerender(<RagChat {...props} scopeKey="task-b" />);
    expect(screen.getByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeTruthy();
  });

  it("uses a welcome skeleton while starter identity loads, then exposes the first server draft", () => {
    const manage = vi.fn(async () => true);
    const props = { ...base(), question: "", input: "", onConfirmStarterQuestions: manage, onRegenerateStarterQuestions: manage };
    const view = render(<RagChat {...props} welcomeLoading starterQuestions={{ current: null, phase: "initial_loading", loading: true, revision: 0 }} />);
    expect(screen.getByRole("article", { name: "正在加载企业助手" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("article", { name: "企业助手欢迎" })).toBeNull();
    expect(screen.queryByText(/你好！我是/)).toBeNull();
    expect(screen.queryByRole("button", { name: DEFAULT_RAG_STARTER_QUESTIONS[0] })).toBeNull();
    expect(screen.queryByRole("button", { name: "设置预设问题" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "输入企业 RAG 问题" })).toBeTruthy();
    expect(ragChatStyles).toContain("@keyframes rag-chat-skeleton-sweep { from { transform:translateX(-110%); } to { transform:translateX(110%); } }");
    expect(ragChatStyles).toContain(".rag-chat-welcome-skeleton__line::after { display:none; animation:none; }");

    const firstDraft = ["草稿问题一？", "草稿问题二？", "草稿问题三？"];
    view.rerender(<RagChat {...props} assistantName="东莞台心医院 AI 助手" starterQuestions={{
      current: null,
      draft: { id: "first-draft", questions: firstDraft },
      phase: "activating_initial",
      revision: 1,
    }} />);
    expect(screen.queryByRole("article", { name: "正在加载企业助手" })).toBeNull();
    expect(screen.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(screen.getByRole("button", { name: firstDraft[0] })).toBeTruthy();
    expect(screen.getByRole("button", { name: "设置预设问题" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "设置预设问题" }));
    const settings = screen.getByRole("dialog", { name: "设置预设问题" });
    expect(within(settings).getByText("首次问题已生成，正在自动启用。")).toBeTruthy();
    expect((within(settings).getByRole("button", { name: "编辑问题" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(settings, { key: "Escape" });

    const serverQuestions = ["服务端问题一？", "服务端问题二？", "服务端问题三？"];
    view.rerender(<RagChat {...props} starterQuestions={{ current: { id: "server-2", questions: serverQuestions }, phase: "ready", revision: 2 }} />);
    expect(screen.getByRole("button", { name: serverQuestions[0] })).toBeTruthy();
    expect(screen.queryByRole("button", { name: DEFAULT_RAG_STARTER_QUESTIONS[0] })).toBeNull();
    expect(screen.getByRole("button", { name: "设置预设问题" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps starter failures inside the still-openable settings popover", () => {
    const manage = vi.fn(async () => true);
    render(<RagChat {...base()} question="" input="" starterQuestions={{ current: null, phase: "error", error: "预设问题生成失败。", revision: 0 }} onRegenerateStarterQuestions={manage} />);
    expect(screen.queryByText("暂无可用的预设问题。")).toBeNull();
    const trigger = screen.getByRole("button", { name: "设置预设问题" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);
    const settings = screen.getByRole("dialog", { name: "设置预设问题" });
    expect(within(settings).getByRole("alert").textContent).toBe("预设问题生成失败。");
    expect((within(settings).getByRole("button", { name: "换一批" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("remounts the welcome entrance when switching between blank conversation scopes", () => {
    const props = { ...base(), question: "", input: "" };
    const view = render(<RagChat {...props} scopeKey="blank-a" />);
    const firstWelcome = screen.getByRole("article", { name: "企业助手欢迎" });
    const firstCopy = within(firstWelcome).getByText(/你好！我是企业助手/);
    expect(firstCopy.classList.contains("is-entrance")).toBe(true);
    view.rerender(<RagChat {...props} scopeKey="blank-b" />);
    const secondWelcome = screen.getByRole("article", { name: "企业助手欢迎" });
    expect(secondWelcome).not.toBe(firstWelcome);
    expect(within(secondWelcome).getByText(/你好！我是企业助手/).classList.contains("is-entrance")).toBe(true);
    expect(within(secondWelcome).getByRole("group", { name: "当前预设问题" }).classList.contains("is-entrance")).toBe(true);
  });

  it("keeps the default starter fixture limited to preview mode", () => {
    render(<RagChat {...base()} live={false} question="" input="" starterQuestions={undefined} />);
    expect(screen.getByRole("button", { name: DEFAULT_RAG_STARTER_QUESTIONS[0] })).toBeTruthy();
  });

  it("animates only a newly submitted composer question", async () => {
    const view = render(<SendingChat />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "发送问题" })));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("新的业务问题", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(true);
    view.unmount();
    render(<RagChat {...base()} question="新的业务问题" input="" />);
    expect(screen.getByText("新的业务问题", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(false);
  });

  it("pins the complete guide across draft-to-conversation creation without leaking it into history", async () => {
    render(<SendingChat changeScope historySwitch />);
    const welcome = screen.getByRole("article", { name: "企业助手欢迎" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "发送问题" })));
    const submittedWelcome = screen.getByRole("article", { name: "企业助手欢迎" });
    expect(submittedWelcome).not.toBe(welcome);
    expect(within(submittedWelcome).getByText(/你好！我是企业助手/).classList.contains("is-entrance")).toBe(false);
    expect(within(submittedWelcome).getAllByRole("button", { name: /^(可以简单介绍一下你们吗？|你们主要提供哪些产品或服务？|我可以先了解哪些核心信息？)$/ })).toHaveLength(3);
    expect(within(submittedWelcome).getByRole("group", { name: "回答操作" })).toBeTruthy();
    expect(screen.getByText("新的业务问题", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查看其他历史对话" }));
    expect(screen.queryByRole("article", { name: "企业助手欢迎" })).toBeNull();
    expect(screen.getByText("历史业务问题", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(false);
  });

  it("uses the same send entrance for a starter question", async () => {
    render(<SendingChat starter />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "可以简单介绍一下你们吗？" })));
    expect(screen.getByText("可以简单介绍一下你们吗？", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(true);
  });

  it("does not synthesize a guide or send animation when a starter-named history is restored", () => {
    render(<RagChat {...base()} scopeKey="history:restored" question="可以简单介绍一下你们吗？" answer="历史回答" answerKey="history-answer" input="" />);
    expect(screen.queryByRole("article", { name: "企业助手欢迎" })).toBeNull();
    expect(screen.getByText("可以简单介绍一下你们吗？", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(false);
  });

  it("keeps a starter available when submission is not accepted", async () => {
    const onSubmit = vi.fn(async () => false);
    const view = render(<RagChat {...base()} question="" input="" onSubmit={onSubmit} />);
    const starter = screen.getByRole("button", { name: "可以简单介绍一下你们吗？" });
    await act(async () => fireEvent.click(starter));
    expect(onSubmit).toHaveBeenCalledWith("可以简单介绍一下你们吗？");
    expect(screen.getByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    view.rerender(<RagChat {...base()} question="可以简单介绍一下你们吗？" input="" onSubmit={onSubmit} />);
    expect(screen.getByText("可以简单介绍一下你们吗？", { selector: "p.erag-user-message" }).classList.contains("rag-chat-user-message--sent")).toBe(false);
  });

  it("queues a remaining starter as the next question while the current answer is running", async () => {
    const onFollowup = vi.fn(async () => true);
    render(<RunningStarterChat onFollowup={onFollowup} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "可以简单介绍一下你们吗？" })));
    const welcome = screen.getByRole("article", { name: "企业助手欢迎" });
    expect(within(welcome).queryByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeNull();
    const next = within(welcome).getByRole("button", { name: "你们主要提供哪些产品或服务？" });
    await act(async () => fireEvent.click(next));
    expect(onFollowup).toHaveBeenCalledWith("你们主要提供哪些产品或服务？");
    expect(within(welcome).queryByRole("button", { name: "你们主要提供哪些产品或服务？" })).toBeNull();
    expect(within(welcome).getByRole("button", { name: "我可以先了解哪些核心信息？" })).toBeTruthy();
  });

  });

  describe("starter draft editor", () => {

  it("uses the standard answer toolbar for the preview welcome instead of a separate entry button", async () => {
    vi.useFakeTimers();
    const edit = vi.fn();
    render(<RagChat {...base()} live={false} question="" input="" onEditAnswer={edit} />);
    const tools = screen.getByRole("group", { name: "回答操作" });
    expect([...tools.querySelectorAll(":scope > button, :scope > .rag-chat-feedback > button")].map(item => item.getAttribute("aria-label"))).toEqual(["复制回答", "评价回答", "朗读", "编辑回答"]);
    expect(screen.queryByRole("button", { name: "录入回答" })).toBeNull();
    expect(tools.querySelector("time")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制回答" })));
    expect(copyToClipboard).toHaveBeenCalledWith("你好！我是企业助手，很高兴为你服务。");
    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it("keeps confirmed starters usable while editing and confirming a generated draft", async () => {
    const confirm = vi.fn(async () => true);
    const regenerate = vi.fn(async () => true);
    const onSubmit = vi.fn(async () => {});
    render(<RagChat {...base()} question="" input="" onSubmit={onSubmit} starterQuestions={{
      current: { id: "current-1", questions: ["当前问题一？", "当前问题二？", "当前问题三？"] },
      draft: { id: "draft-2", questions: ["草稿问题一？", "草稿问题二？", "草稿问题三？"] },
      revision: 2,
    }} onConfirmStarterQuestions={confirm} onRegenerateStarterQuestions={regenerate} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "当前问题一？" })));
    expect(onSubmit).toHaveBeenCalledWith("当前问题一？");
    fireEvent.click(screen.getByRole("button", { name: "设置预设问题" }));
    const settings = screen.getByRole("dialog", { name: "设置预设问题" });
    const draft = within(settings).getByRole("list", { name: "待确认的预设问题" });
    expect(within(draft).getByText("草稿问题一？")).toBeTruthy();
    expect(within(draft).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "草稿问题一？" })).toBeNull();
    fireEvent.click(within(settings).getByRole("button", { name: "编辑问题" }));
    const first = within(settings).getByRole("textbox", { name: "问题 1" });
    fireEvent.change(first, { target: { value: "人工修改问题一？" } });
    fireEvent.click(within(settings).getByRole("button", { name: "确认使用" }));
    expect(confirm).toHaveBeenCalledWith(["人工修改问题一？", "草稿问题二？", "草稿问题三？"]);
  });

  it("keeps the popover open and reports a generated-draft cancellation failure inside it", () => {
    vi.useFakeTimers();
    const discard = vi.fn(() => { throw new Error("取消失败"); });
    render(<RagChat {...base()} question="" input="" starterQuestions={{
      current: { id: "current-1", questions: ["当前问题一？", "当前问题二？", "当前问题三？"] },
      draft: { id: "draft-2", questions: ["草稿问题一？", "草稿问题二？", "草稿问题三？"] },
      revision: 2,
    }} onDiscardStarterDraft={discard} />);
    fireEvent.click(screen.getByRole("button", { name: "设置预设问题" }));
    const settings = screen.getByRole("dialog", { name: "设置预设问题" });
    const cancel = within(settings).getByText("取消", { selector: "button" });
    fireEvent.click(cancel);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(document.body.contains(settings)).toBe(true);
    expect(settings.querySelector('[role="alert"]')?.textContent).toBe("草稿未能取消，请重试。");
  });

  it("discards a stale starter edit when a newer draft revision arrives", () => {
    const confirm = vi.fn(async () => true);
    const original = {
      current: { id: "current-1", questions: ["当前问题一？", "当前问题二？", "当前问题三？"] },
      draft: { id: "draft-1", questions: ["草稿问题一？", "草稿问题二？", "草稿问题三？"] },
      revision: 1,
    };
    const view = render(<RagChat {...base()} question="" input="" starterQuestions={original} onConfirmStarterQuestions={confirm} />);
    fireEvent.click(screen.getByRole("button", { name: "设置预设问题" }));
    const settings = screen.getByRole("dialog", { name: "设置预设问题" });
    fireEvent.click(within(settings).getByRole("button", { name: "编辑问题" }));
    fireEvent.change(within(settings).getByRole("textbox", { name: "问题 1" }), { target: { value: "我正在编辑的问题？" } });
    view.rerender(<RagChat {...base()} question="" input="" starterQuestions={{
      ...original,
      draft: { id: "draft-late", questions: ["迟到草稿一？", "迟到草稿二？", "迟到草稿三？"] },
      pending: true,
      revision: 2,
    }} onConfirmStarterQuestions={confirm} />);
    expect(within(settings).queryByRole("textbox", { name: "问题 1" })).toBeNull();
    expect(within(settings).getByText("迟到草稿一？")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  });

  describe("answer identity history", () => {

  it("keeps every historical answer's frozen assistant identity independent", () => {
    const view = render(<RagChat {...base()} assistantName="当前企业 AI 助手" answer="当前回答" answerKey="current" previousTurns={[
      { id: "hospital", question: "医院问题", answer: "医院回答", knowledgeBase: { snapshotId: "hospital", version: 7, sourceFileName: "hospital.zip", documentCount: 2, companyName: "东莞台心医院" } },
      { id: "legacy", question: "旧问题", answer: "旧回答" },
    ]} />);
    expect(screen.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(screen.getByText("企业知识助手")).toBeTruthy();
    expect(screen.getByText("当前企业 AI 助手")).toBeTruthy();
    view.rerender(<RagChat {...base()} assistantName="另一个选中回答 AI 助手" answer="当前回答" answerKey="current" previousTurns={[
      { id: "hospital", question: "医院问题", answer: "医院回答", knowledgeBase: { snapshotId: "hospital", version: 7, sourceFileName: "hospital.zip", documentCount: 2, companyName: "东莞台心医院" } },
      { id: "legacy", question: "旧问题", answer: "旧回答" },
    ]} />);
    expect(screen.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(screen.getByText("企业知识助手")).toBeTruthy();
  });

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
  });

  describe("answer interactions", () => {
  it("renders safe Markdown and copies the original complete response with two-second feedback", async () => {
    vi.useFakeTimers();
    const answer = '**部署说明**\n\n- 支持私有化\n- 请先确认环境\n\n[资料](https://example.com)\n\n```js\nconst value = 1;\n```\n\n|条件|说明|\n|---|---|\n|网络|内网|\n\n<script>alert(1)</script>';
    const view=render(<RagChat {...base()} answer={answer} answerKey="a1" />);
    expect(screen.getByText("部署说明").tagName).toBe("STRONG"); expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link",{name:"资料"}).getAttribute("href")).toBe("https://example.com"); expect(screen.getByRole("table")).toBeTruthy(); expect(view.container.querySelector("script")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"复制回答"})));
    expect(copyToClipboard).toHaveBeenCalledWith(answer); expect(screen.getByRole("button",{name:"已复制"})).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000)); expect(screen.getByRole("button",{name:"复制回答"})).toBeTruthy();
  });
  it("animates only a new response after waiting and keeps references functional", () => {
    vi.useFakeTimers();
    const props=base(); const view=render(<RagChat {...props} answer="历史回答" answerKey="old" />); expect(phase()).toBe("ready");
    view.rerender(<RagChat {...props} busy running />); expect(screen.getByTestId("rag-chat-wait").textContent).toBe("正在处理…");
    view.rerender(<RagChat {...props} answer="新回答" answerKey="new" sources={[{id:"s1",title:"企业资料"}]} />); expect(phase()).toBe("leaving");
    act(() => vi.advanceTimersByTime(120)); expect(phase()).toBe("revealing"); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"[1] 企业资料"})); expect(props.onEvidence).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(240)); expect(phase()).toBe("ready");
    view.rerender(<RagChat {...props} answer="新回答" answerKey="new" input="下一条草稿" />); expect(phase()).toBe("ready");
  });
  it("cancels animations on a conversation switch and does not animate restored answers", () => {
    vi.useFakeTimers();
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
  it("clears the waiting animation after submission failure without adding an error row", async () => {
    render(<RagChat {...base()} onSubmit={async () => {throw new Error("提交失败");}} />);
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"发送问题"})));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByTestId("rag-chat-wait")).toBeNull(); expect(screen.getByRole("button",{name:"发送问题"}).hasAttribute("disabled")).toBe(false);
  });
  it("uses one action slot and locks stop requests while allowing retries after failure", async () => {
    const stopping=deferred<boolean>(); const props={...base(),busy:true,running:true,input:"",onStop:vi.fn(() => stopping.promise)}; const view=render(<RagChat {...props} />);
    expect(document.querySelectorAll(".rag-chat-send")).toHaveLength(1); expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:"停止回答"})); fireEvent.submit(screen.getByRole("textbox").closest("form")!); expect(props.onStop).toHaveBeenCalledTimes(1); expect(props.onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole("button",{name:"正在停止回答"}).hasAttribute("disabled")).toBe(true);
    await act(async () => stopping.resolve(false)); expect(screen.getByRole("alert").textContent).toContain("未能停止");
    const retry=vi.fn(async () => true); view.rerender(<RagChat {...props} onStop={retry} />); await act(async () => fireEvent.click(screen.getByRole("button",{name:"停止回答"})));
    view.rerender(<RagChat {...props} busy={false} running={false} onStop={retry} />); expect(screen.getByText("已停止回答。")).toBeTruthy(); expect(screen.queryByTestId("rag-chat-wait")).toBeNull();
  });
  it("fails closed when the running task has no confirmed stop capability", () => {
    const onStop=vi.fn(async () => true);
    const view=render(<RagChat {...base()} busy running input="" canStop={false} stopCapabilityReason="当前模型服务不支持停止回答。" onStop={onStop} />);
    const unavailable=screen.getByRole("button",{name:"当前模型服务不支持停止回答。"});
    expect(unavailable.hasAttribute("disabled")).toBe(true);
    fireEvent.click(unavailable);
    expect(onStop).not.toHaveBeenCalled();
    view.rerender(<RagChat {...base()} busy running input="" canStop={undefined} onStop={onStop} />);
    expect(screen.getByRole("button",{name:"正在确认当前回答是否支持停止。"}).hasAttribute("disabled")).toBe(true);
    expect(onStop).not.toHaveBeenCalled();
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

  it("keeps headers free of elapsed timers while retaining persisted completion times", () => {
    vi.useFakeTimers();
    const props={...base(),busy:true,running:true,startedAt:Date.now()}; const view=render(<RagChat {...props} />);
    act(() => vi.advanceTimersByTime(1500)); expect(screen.queryByLabelText(/本轮回答耗时/)).toBeNull();
    view.rerender(<RagChat {...props} busy={false} running={false} answer="回答" answerKey="a1" durationMs={1900} />);
    expect(document.querySelector(".rag-chat-elapsed")).toBeNull();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // Only the answer entrance has timers.
  });

  it("selects current and historical answers by click or keyboard without hijacking links, tools or copied text", () => {
    const onSelectAnswer=vi.fn(),onEvidence=vi.fn();
    const props={...base(),answer:"当前回答 [资料](https://example.com)",answerKey:"current",selectedAnswerKey:"old-answer",onSelectAnswer,onEvidence,
      previousTurns:[{id:"old-question",answerId:"old-answer",question:"先前问题",answer:"先前回答",sources:[{id:"s1",title:"历史资料"}],completedAt:new Date(2026,10,6,12,7).getTime()}]};
    const view=render(<RagChat {...props} />);
    const history=screen.getByRole("article",{name:"历史回答"});
    const current=screen.getByRole("article",{name:"企业助手回复"});
    expect(history.getAttribute("data-selected")).toBe("true");
    expect(history.getAttribute("tabindex")).toBe("0");
    fireEvent.click(within(history).getByText("先前回答"));
    fireEvent.keyDown(current,{key:"Enter"});
    fireEvent.keyDown(history,{key:" "});
    expect(onSelectAnswer.mock.calls).toEqual([["old-answer"],["current"],["old-answer"]]);
    onSelectAnswer.mockClear();
    fireEvent.click(within(current).getByRole("link",{name:"资料"}));
    fireEvent.click(screen.getByRole("button",{name:"评价回答"}));
    fireEvent.keyDown(screen.getByRole("button",{name:"评价回答"}),{key:"Enter"});
    const range=document.createRange(); range.selectNodeContents(within(history).getByText("先前回答"));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(window.getSelection()!.toString()).toBe("先前回答");
    fireEvent.click(history);
    expect(onSelectAnswer).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
    fireEvent.click(screen.getByRole("button",{name:"[1] 历史资料"}));
    expect(onEvidence).toHaveBeenCalledWith("old-answer");
    expect(onSelectAnswer).not.toHaveBeenCalled();
    expect(within(history).getByText("12:07")).toBeTruthy();
    view.rerender(<RagChat {...props} selectedAnswerKey="current" />);
    expect(current.getAttribute("data-selected")).toBe("true");
    expect(history.hasAttribute("data-selected")).toBe(false);
  });

  });

  describe("queue reliability", () => {

  it("keeps example conversations readable and disables all composer submission paths", async () => {
    const props={...base(),live:false,answer:"示例回答",answerKey:"sample",readOnly:true};
    render(<RagChat {...props} />);
    const input=screen.getByRole("textbox");
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button",{name:"试用问题"}).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("示例仅供查看，新建问答后可提问。")).toBeNull();
    await act(async () => { fireEvent.submit(input.closest("form")!); fireEvent.keyDown(input,{key:"Enter"}); });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("示例回答")).toBeTruthy();
  });

  it("uses one slot to enqueue immediately, return to stop, and send again when edited", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,onFollowup:vi.fn(() => request.promise)};
    render(<ControlledChat {...props} />);
    expect(document.querySelectorAll(".rag-chat-composer button")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    expect(props.onFollowup).toHaveBeenCalledWith("部署问题");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button",{name:"停止回答"})).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"新的草稿"}});
    expect(screen.queryByRole("button",{name:"停止回答"})).toBeNull();
    expect(screen.getByRole("button",{name:"正在加入待发送"}).hasAttribute("disabled")).toBe(true);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(props.onFollowup).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(true));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("新的草稿");
    expect(screen.getByRole("button",{name:"发送问题"}).hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByRole("textbox"),{target:{value:""}});
    expect(screen.getByRole("button",{name:"停止回答"})).toBeTruthy();
  });

  it("blocks stopping until the cleared followup has been acknowledged", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,onFollowup:vi.fn(() => request.promise)};
    render(<ControlledChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"发送问题"}));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    const stop=screen.getByRole("button",{name:"停止回答"});
    expect(document.querySelectorAll(".rag-chat-composer button")).toHaveLength(1);
    expect(stop.hasAttribute("disabled")).toBe(true);
    fireEvent.click(stop);
    expect(props.onStop).not.toHaveBeenCalled();
    await act(async () => request.resolve(true));
    expect(stop.hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(stop));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("restores a failed queued question only when the draft remains untouched", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,onFollowup:vi.fn(() => request.promise)};
    render(<ControlledChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"发送问题"}));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    await act(async () => request.resolve(false));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("部署问题");
    expect(screen.getByRole("alert").textContent).toContain("未能加入待发送");
  });

  it("never overwrites a newer draft after an enqueue failure", async () => {
    const request=deferred<boolean>();
    render(<ControlledChat {...base()} busy running onFollowup={() => request.promise} />);
    fireEvent.click(screen.getByRole("button",{name:"发送问题"}));
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"新草稿"}});
    await act(async () => request.resolve(false));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("新草稿");
  });

  it("ignores late queue acknowledgements after switching conversations", async () => {
    const request=deferred<boolean>();
    const props={...base(),busy:true,running:true,onFollowup:vi.fn(() => request.promise)};
    const view=render(<ControlledChat {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"发送问题"}));
    view.rerender(<ControlledChat {...props} scopeKey="task-b" input="另一会话草稿" />);
    await act(async () => request.resolve(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("另一会话草稿");
  });

  it("queues through the server even without steering support and guards Chinese composition", async () => {
    const onFollowup=vi.fn(async () => true),onSteer=vi.fn(async () => true);
    render(<ControlledChat {...base()} busy running steeringSupported={false} onSteer={onSteer} onFollowup={onFollowup} />);
    expect(screen.queryByText(/当前模型暂不支持/)).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter",shiftKey:true});
    fireEvent.compositionStart(screen.getByRole("textbox"));
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    fireEvent.compositionEnd(screen.getByRole("textbox"));
    expect(onFollowup).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"}));
    expect(onFollowup).toHaveBeenCalledTimes(1);
    expect(onSteer).not.toHaveBeenCalled();
  });

  it("keeps greetings selectable as text and copyable without opening an evaluation", async () => {
    const onSelectAnswer=vi.fn();
    render(<RagChat {...base()} answer="你好，有什么可以帮你？" answerKey="greet" selectedAnswerKey="greet" evaluationNotRequired onSelectAnswer={onSelectAnswer} previousTurns={[{id:"old",question:"你好",answer:"你好",evaluation:"not_required"}]} />);
    const current=screen.getByRole("article",{name:"企业助手回复"});
    const old=screen.getByRole("article",{name:"历史回答"});
    for (const bubble of [current,old]) {
      expect(bubble.hasAttribute("tabindex")).toBe(false);
      expect(bubble.hasAttribute("data-selected")).toBe(false);
      fireEvent.click(bubble);fireEvent.keyDown(bubble,{key:"Enter"});
    }
    expect(onSelectAnswer).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"复制回答"})));
    expect(copyToClipboard).toHaveBeenCalledWith("你好，有什么可以帮你？");
    expect(screen.getByRole("button",{name:"朗读"})).toBeTruthy();
  });

  it("offers queue cancellation, retry and resume with isolated requests", async () => {
    const onCancelFollowup=vi.fn(async () => true),onRetryFollowup=vi.fn(async () => true),onResumeFollowups=vi.fn(async () => true);
    render(<RagChat {...base()} followups={[{id:"q1",text:"排队问题",status:"queued"},{id:"q2",text:"失败问题",status:"failed"}]} followupsPaused onCancelFollowup={onCancelFollowup} onRetryFollowup={onRetryFollowup} onResumeFollowups={onResumeFollowups} />);
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"取消发送排队问题"})));
    expect(onCancelFollowup).toHaveBeenCalledWith("q1");
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"重试"})));
    expect(onRetryFollowup).toHaveBeenCalledWith("q2");
    await act(async () => fireEvent.click(screen.getByRole("button",{name:"继续发送"})));
    expect(onResumeFollowups).toHaveBeenCalledTimes(1);
  });

  it("shows only real public activity while waiting and removes it after the answer transition", () => {
    vi.useFakeTimers();
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
});
