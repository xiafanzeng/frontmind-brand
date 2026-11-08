import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const deleteConversation = vi.fn();
  const knowledgeBase = (prefix: string, version: number) => ({
    snapshotId: `${prefix}-snapshot`,
    version,
    sourceFileName: `${prefix}.zip`,
    documentCount: version,
  });
  return {
    active: null as Record<string, unknown> | null,
    currentSource: {
      loaded: true,
      failed: false,
      failureCode: undefined as string | undefined,
      refreshFailed: undefined as boolean | undefined,
      configured: true as boolean | null,
      provider: "xty_codex" as string | null,
      knowledgeBase: knowledgeBase("current", 9) as ReturnType<typeof knowledgeBase> | null,
    },
    taskSource: {
      loaded: true,
      failed: false,
      failureCode: undefined as string | undefined,
      refreshFailed: undefined as boolean | undefined,
      configured: true as boolean | null,
      provider: "xty_codex" as string | null,
      knowledgeBase: knowledgeBase("frozen", 4) as ReturnType<typeof knowledgeBase> | null,
    },
    taskSources: {} as Record<string, any>,
    hydrated: true,
    loading: false,
    responseKnowledgeBase: null as ReturnType<typeof knowledgeBase> | null,
    steering: null as null | { supported: boolean; turnId: string; revision: number; effectiveQuestion: string; supplements: Array<{clientRequestId: string; text: string; revision: number}> },
    sourceCalls: [] as Array<[string | null | undefined, boolean | undefined]>,
    send: vi.fn(async () => true),
    stop: vi.fn(async () => true),
    retryPending: vi.fn(async () => true),
    retryCurrent: vi.fn(),
    retryTask: vi.fn(),
    createConversation: vi.fn(),
    setActive: vi.fn(),
    deleteConversation,
    deleteConversationConfirmed: vi.fn(async (id: string) => await deleteConversation(id) === false
      ? { ok: false as const, reason: "unknown" as "unknown" | "network_error", message: "删除失败" }
      : { ok: true as const }),
    refreshConversations: vi.fn(async () => {}),
    clearSyncError: vi.fn(),
    conversations: [] as Array<Record<string, unknown>>,
    syncError: "",
    busy: false,
    pendingDispatch: null as null | { question: string },
    setWorkbenchTaskQuery: vi.fn(),
    received: null as null | Record<string, unknown>,
    workbenchProps: null as null | Record<string, unknown>,
  };
});

function activeConversation() {
  return {
    id: "conversation-1",
    purpose: "enterprise_qa",
    status: "completed",
    taskId: "task-frozen",
    previousResponseId: "task-frozen",
    messages: [
      { id: "question-1", role: "user", content: "真实问题", timestamp: 1793893498000 },
      {
        id: "answer-1",
        role: "assistant",
        content: "真实回答",
        timestamp: 1793893500000,
        generalChat: {
          schemaVersion: 1,
          kind: "assistant_projection",
          isFinalAnswer: true,
          turnId: "turn-1",
          agentTaskId: "task-frozen",
          providerEventId: "provider-event-1",
          serverOwned: true,
        },
        enterpriseQaAnswer: {
          sources: [
            {
              id: "source-1",
              title: "任务实际引用资料",
              kind: "published_knowledge",
            },
          ],
        },
      },
    ],
  };
}

vi.mock("../lib/final-reply", () => ({
  finalReplyIds: (messages: Array<{ id: string; role: string; generalChat?: { isFinalAnswer?: boolean }; enterpriseQaLocalReply?: { serverOwned?: boolean } }>) => new Set(messages.filter(message => message.role === "assistant" && (message.id === "answer-1" || message.generalChat?.isFinalAnswer || message.enterpriseQaLocalReply?.serverOwned)).map(message => message.id)),
}));

vi.mock("../host", () => ({
  ConversationPurposeProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  brandHost: () => ({ requestWorkspaceNavigation: vi.fn() }),
  projectWorkspaceUrl: (path: string) => path,
  setWorkbenchTaskQuery: mocks.setWorkbenchTaskQuery,
  useConversation: () => ({
    hydrated: mocks.hydrated,
    loading: mocks.loading,
    state: { conversations: mocks.conversations },
    activeConversation: mocks.active,
    createConversation: mocks.createConversation,
    setActive: mocks.setActive,
    deleteConversation: mocks.deleteConversation,
    deleteConversationConfirmed: mocks.deleteConversationConfirmed,
    refreshConversations: mocks.refreshConversations,
    clearSyncError: mocks.clearSyncError,
    syncError: mocks.syncError,
    workbenchScopeKey: "brand:workspace-1:enterprise_qa",
  }),
}));

vi.mock("../use-enterprise-qa-controller", () => ({
  useEnterpriseQaController: (options?: { activeConversationId?: string | null }) => ({
    active: options?.activeConversationId === undefined ? mocks.active : mocks.conversations.find(item => item.id === options.activeConversationId) ?? null,
    busy: mocks.busy,
    running: false,
    notice: "",
    pendingDispatch: mocks.pendingDispatch,
    responseKnowledgeBase: mocks.responseKnowledgeBase,
    steering: mocks.steering,
    retryPending: mocks.retryPending,
    send: mocks.send,
    stop: mocks.stop,
  }),
}));

vi.mock("./EnterpriseQaWorkspace", () => ({
  EnterpriseQaSourceNote: () => <div data-testid="source-note" />,
  enterpriseQaProviderLabel: (provider: string | null) =>
    provider === "xty_codex" ? "XTY Codex" : provider || "未配置",
  useEnterpriseQaKnowledgeSource: (
    taskId?: string | null,
    enabled?: boolean,
  ) => {
    mocks.sourceCalls.push([taskId, enabled]);
    return taskId
      ? { source: mocks.taskSources[taskId] ?? mocks.taskSource, retry: mocks.retryTask }
      : { source: mocks.currentSource, retry: mocks.retryCurrent };
  },
}));

vi.mock("./ProjectAgentWorkbench", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.workbenchProps = props;
    return <div data-testid="project-workbench">{props.main as ReactNode}{props.children as ReactNode}</div>;
  },
}));

vi.mock("./ai-website-preview/EnterpriseRagPreview", () => ({
  EnterpriseRagPreview: (props: Record<string, unknown>) => {
    mocks.received = props;
    return <div data-testid="designed-enterprise-rag" />;
  },
}));

import EnterpriseRagWorkspace from "./EnterpriseRagWorkspace";

function renderHistory() {
  const view = render(<EnterpriseRagWorkspace />);
  const id = String(mocks.active?.id ?? "");
  if (id) act(() => { (mocks.received?.live as {conversationHistory:{onSelect:(id:string)=>void}}).conversationHistory.onSelect(id); });
  mocks.setActive.mockClear(); mocks.setWorkbenchTaskQuery.mockClear();
  return view;
}


beforeEach(() => {
  mocks.active = activeConversation();
  mocks.conversations = [mocks.active];
  mocks.syncError = "";
  mocks.busy = false;
  mocks.hydrated = true;
  mocks.loading = false;
  mocks.taskSources = {};
  mocks.pendingDispatch = null;
  mocks.currentSource = {
    loaded: true,
    failed: false,
    failureCode: undefined,
    refreshFailed: undefined,
    configured: true,
    provider: "xty_codex",
    knowledgeBase: {
      snapshotId: "current-snapshot",
      version: 9,
      sourceFileName: "current.zip",
      documentCount: 9,
    },
  };
  mocks.taskSource = {
    loaded: true,
    failed: false,
    failureCode: undefined,
    refreshFailed: undefined,
    configured: true,
    provider: "xty_codex",
    knowledgeBase: {
      snapshotId: "frozen-snapshot",
      version: 4,
      sourceFileName: "frozen.zip",
      documentCount: 4,
    },
  };
  mocks.responseKnowledgeBase = null;
  mocks.steering = null;
  mocks.sourceCalls = [];
  mocks.received = null;
  mocks.workbenchProps = null;
  vi.clearAllMocks();
  mocks.createConversation.mockReturnValue("new-conversation");
  mocks.deleteConversation.mockReset();
  mocks.deleteConversationConfirmed.mockClear();
});

afterEach(cleanup);

describe("connected redesigned enterprise RAG workspace", () => {
  it("lists conversations by recency and selects them without submitting a question", () => {
    mocks.conversations = [
      { ...activeConversation(), title: "企业问答", updatedAt: 100 },
      { ...activeConversation(), id: "older", title: "已命名会话", updatedAt: 10 },
    ];
    render(<EnterpriseRagWorkspace />);
    const history = (mocks.received?.live as { conversationHistory: { items: Array<{id:string;title:string}>; onOpen: () => void; onSelect: (id:string) => void; onDelete:(id:string)=>void } }).conversationHistory;
    expect(history.items.map(item => [item.id, item.title])).toEqual([["conversation-1", "真实问题"], ["older", "已命名会话"]]);
    act(() => { history.onOpen(); history.onSelect("older"); history.onDelete("older"); });
    expect(mocks.refreshConversations).toHaveBeenCalledOnce();
    expect(mocks.setActive).toHaveBeenCalledWith("older");
    expect(mocks.setWorkbenchTaskQuery).toHaveBeenCalledWith("older");
    expect(mocks.deleteConversation).toHaveBeenCalledWith("older");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("normalizes legacy epoch seconds for history order, subtitles and answer completion time without rewriting data", () => {
    const legacySeconds = 1_793_893_500;
    const legacy = { ...activeConversation(), id: "legacy-seconds", updatedAt: legacySeconds };
    (legacy.messages[1] as { timestamp: number }).timestamp = legacySeconds;
    const olderMilliseconds = { ...activeConversation(), id: "older-milliseconds", title: "旧毫秒会话", updatedAt: 1_700_000_000_000 };
    mocks.active = legacy;
    mocks.conversations = [olderMilliseconds, legacy];
    renderHistory();
    const live = mocks.received?.live as {
      answerCompletedAt?: number;
      chat: { completedAt?: number };
      conversationHistory: { items: Array<{ id: string; subtitle?: string }> };
    };
    expect(live.conversationHistory.items.map(item => item.id)).toEqual(["legacy-seconds", "older-milliseconds"]);
    expect(live.conversationHistory.items[0]?.subtitle).toBe(new Date(legacySeconds * 1000).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }));
    expect(live.conversationHistory.items[0]?.subtitle).not.toContain("1970");
    expect(live.answerCompletedAt).toBe(legacySeconds * 1000);
    expect(live.chat.completedAt).toBe(legacySeconds * 1000);
    expect(mocks.active.updatedAt).toBe(legacySeconds);
    expect((mocks.active.messages as Array<{ timestamp: number }>)[1]?.timestamp).toBe(legacySeconds);
  });

  it("keeps a fresh blank draft when the host falls back to a neighboring conversation after confirmed deletion", async () => {
    mocks.conversations = [
      { ...activeConversation(), title: "企业问答", updatedAt: 100 },
      { ...activeConversation(), id: "survivor", title: "另一会话", updatedAt: 10 },
    ];
    const view = renderHistory();
    const history = (mocks.received?.live as { conversationHistory: { onDelete:(id:string)=>Promise<{ok:boolean}> } }).conversationHistory;
    await act(async () => { expect(await history.onDelete("conversation-1")).toEqual({ok:true}); });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.deleteConversation).toHaveBeenCalledWith("conversation-1");
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "", conversationHistory: { activeId: null } });
    mocks.active = mocks.conversations[1];
    mocks.conversations = [mocks.active];
    view.rerender(<EnterpriseRagWorkspace />);
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.setWorkbenchTaskQuery).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "", conversationHistory: { activeId: null } });
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it("atomically opens a usable blank draft after deleting the only conversation", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 100 }];
    const view = renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}> };
    let pending!: Promise<{ok:boolean}>;
    act(() => { pending = (mocks.received?.live as {conversationHistory:History}).conversationHistory.onDelete("conversation-1"); });
    mocks.active = null;
    mocks.conversations = [];
    act(() => { view.rerender(<EnterpriseRagWorkspace />); });
    await act(async () => { expect(await pending).toEqual({ok:true}); });
    expect(mocks.received?.live).toMatchObject({
      conversationReady: true,
      canCompose: true,
      canSend: true,
      answer: "",
      conversationHistory: { activeId: null },
    });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it("keeps a failed deletion visible and blocks duplicate clicks while awaiting it", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    let settle!: (value:boolean) => void;
    mocks.deleteConversation.mockReturnValue(new Promise<boolean>(resolve => { settle = resolve; }));
    renderHistory();
    type History = { deletingIds?:string[]; onDelete:(id:string)=>Promise<{ok:boolean}> };
    let pending!: Promise<{ok:boolean}>;
    act(() => { pending = (mocks.received?.live as {conversationHistory:History}).conversationHistory.onDelete("conversation-1"); });
    const history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    expect(history.deletingIds).toEqual(["conversation-1"]);
    act(() => { history.onDelete("conversation-1"); });
    expect(mocks.deleteConversation).toHaveBeenCalledOnce();
    await act(async () => { settle(false); await pending; });
    expect((mocks.received?.live as {conversationHistory:History}).conversationHistory.deletingIds).toEqual([]);
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("allows independent confirmed deletions to run concurrently", async () => {
    mocks.conversations = [
      { ...activeConversation(), id: "conversation-1", updatedAt: 3 },
      { ...activeConversation(), id: "second", updatedAt: 2 },
      { ...activeConversation(), id: "third", updatedAt: 1 },
    ];
    const resolvers: Array<(value:boolean)=>void> = [];
    mocks.deleteConversation.mockImplementation(() => new Promise<boolean>(resolve => { resolvers.push(resolve); }));
    renderHistory();
    const history = (mocks.received?.live as {conversationHistory:{deletingIds:string[];onDelete:(id:string)=>Promise<{ok:boolean}>;onSelect:(id:string)=>boolean}}).conversationHistory;
    let first!: Promise<{ok:boolean}>; let second!: Promise<{ok:boolean}>;
    act(() => { first = history.onDelete("conversation-1"); second = history.onDelete("second"); });
    expect(mocks.deleteConversation).toHaveBeenNthCalledWith(1, "conversation-1");
    expect(mocks.deleteConversation).toHaveBeenNthCalledWith(2, "second");
    expect((mocks.received?.live as {conversationHistory:{deletingIds:string[]}}).conversationHistory.deletingIds).toEqual(expect.arrayContaining(["conversation-1","second"]));
    await act(async () => { resolvers.forEach(resolve => resolve(true)); expect(await first).toEqual({ok:true}); expect(await second).toEqual({ok:true}); });
  });

  it("keeps a new blank draft selected when the previously active conversation finishes deleting", async () => {
    mocks.conversations = [
      { ...activeConversation(), id: "conversation-1", updatedAt: 2 },
      { ...activeConversation(), id: "survivor", updatedAt: 1 },
    ];
    const view = renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}> };
    let pending!: Promise<{ok:boolean}>;
    act(() => { pending = (mocks.received?.live as {conversationHistory:History}).conversationHistory.onDelete("conversation-1"); });
    act(() => { (mocks.received?.live as {onStartNewConversation:()=>void}).onStartNewConversation(); });
    mocks.active = null;
    mocks.conversations = mocks.conversations.filter(item => item.id !== "conversation-1");
    act(() => { view.rerender(<EnterpriseRagWorkspace />); });
    await act(async () => { expect(await pending).toEqual({ok:true}); });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "" });
  });

  it("allows deletion when an old website marker already has a matching final answer", () => {
    const resolved = activeConversation();
    (resolved.messages[0] as any).generalChatDispatch = {
      schemaVersion: 1, kind: "pending_user", clientRequestId: "question-1",
      providerPrompt: "真实问题", localAssetIds: [], localTaskId: null,
      modelProfile: "frontmind-base", purpose: "enterprise_qa",
    };
    (resolved.messages[1] as any).generalChat.userMessageId = "question-1";
    mocks.active = { ...resolved, status: "running", updatedAt: 1 };
    mocks.conversations = [mocks.active];
    renderHistory();
    const history = (mocks.received?.live as {conversationHistory:{items:Array<{id:string;deletingDisabled:boolean}>;onDelete:(id:string)=>Promise<boolean>}}).conversationHistory;
    expect(history.items[0]).toMatchObject({ id: "conversation-1", deletingDisabled: false });
    act(() => { void history.onDelete("conversation-1"); });
    expect(mocks.deleteConversation).toHaveBeenCalledWith("conversation-1");
  });

  it("continues protecting a genuinely running unanswered conversation without a dispatch marker", () => {
    const running = activeConversation();
    running.messages = [running.messages[0]];
    mocks.active = { ...running, status: "running", updatedAt: 1 };
    mocks.conversations = [mocks.active];
    renderHistory();
    const history = (mocks.received?.live as {conversationHistory:{items:Array<{deletingDisabled:boolean}>;onDelete:(id:string)=>Promise<boolean>}}).conversationHistory;
    expect(history.items[0].deletingDisabled).toBe(true);
    act(() => { void history.onDelete("conversation-1"); });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });

  it("continues protecting a genuinely unresolved dispatch from deletion", () => {
    const unresolved = activeConversation();
    unresolved.messages = [unresolved.messages[0]];
    (unresolved.messages[0] as any).generalChatDispatch = {
      schemaVersion: 1, kind: "pending_user", clientRequestId: "question-1",
      providerPrompt: "真实问题", localAssetIds: [], localTaskId: null,
      modelProfile: "frontmind-base", purpose: "enterprise_qa",
    };
    mocks.active = { ...unresolved, updatedAt: 1 };
    mocks.conversations = [mocks.active];
    renderHistory();
    const history = (mocks.received?.live as {conversationHistory:{items:Array<{deletingDisabled:boolean}>;onDelete:(id:string)=>Promise<boolean>}}).conversationHistory;
    expect(history.items[0].deletingDisabled).toBe(true);
    act(() => { void history.onDelete("conversation-1"); });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });

  it("preserves a row when confirmed deletion reports failure", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    mocks.deleteConversation.mockResolvedValue(false);
    renderHistory();
    const history = (mocks.received?.live as {conversationHistory:{onDelete:(id:string)=>Promise<{ok:boolean;message?:string}>}}).conversationHistory;
    let pending!: Promise<{ok:boolean;message?:string}>;
    act(() => { pending = history.onDelete("conversation-1"); });
    await act(async () => { expect(await pending).toMatchObject({ok:false,message:"删除失败"}); });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect((mocks.received?.live as {conversationHistory:{deletingIds:string[]}}).conversationHistory.deletingIds).toEqual([]);
  });

  it("reconciles an uncertain active deletion to a blank draft despite host neighbor fallback", async () => {
    const survivor = { ...activeConversation(), id: "survivor", title: "另一会话", updatedAt: 1 };
    mocks.conversations = [{ ...activeConversation(), updatedAt: 2 }, survivor];
    mocks.deleteConversationConfirmed.mockResolvedValueOnce({ ok: false, reason: "network_error", message: "删除结果尚未确认" });
    const view = renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}>;onOpen:()=>void };
    const history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    await act(async () => { expect(await history.onDelete("conversation-1")).toMatchObject({ ok: false }); });
    mocks.refreshConversations.mockImplementationOnce(async () => {
      mocks.conversations = [survivor];
      mocks.active = survivor;
      view.rerender(<EnterpriseRagWorkspace />);
    });
    await act(async () => { history.onOpen(); await Promise.resolve(); });
    expect(mocks.active).toBe(survivor);
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "", conversationHistory: { activeId: null } });
    expect(mocks.setActive).not.toHaveBeenCalledWith("survivor");
  });

  it("keeps the original active conversation when uncertain deletion reconciliation finds it", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    mocks.deleteConversationConfirmed.mockResolvedValueOnce({ ok: false, reason: "unknown", message: "需要重新核对" });
    renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}>;onOpen:()=>void };
    const history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    await act(async () => { expect(await history.onDelete("conversation-1")).toMatchObject({ ok: false }); });
    await act(async () => { history.onOpen(); await Promise.resolve(); });
    expect(mocks.received?.live).toMatchObject({ answer: "真实回答", conversationHistory: { activeId: "conversation-1" } });
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("retains uncertain reconciliation across a failed GET and blanks after a later authoritative absence", async () => {
    const survivor = { ...activeConversation(), id: "survivor", title: "另一会话", updatedAt: 1 };
    mocks.conversations = [{ ...activeConversation(), updatedAt: 2 }, survivor];
    mocks.deleteConversationConfirmed.mockResolvedValueOnce({ ok: false, reason: "network_error", message: "需要重新核对" });
    const view = renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}>;onOpen:()=>void };
    let history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    await act(async () => { await history.onDelete("conversation-1"); });
    mocks.refreshConversations.mockImplementationOnce(async () => {
      mocks.syncError = "历史记录读取失败";
      view.rerender(<EnterpriseRagWorkspace />);
    });
    await act(async () => { history.onOpen(); await Promise.resolve(); });
    expect(mocks.received?.live).toMatchObject({ answer: "真实回答", conversationHistory: { activeId: "conversation-1" } });
    history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    mocks.refreshConversations.mockImplementationOnce(async () => {
      mocks.syncError = "";
      mocks.conversations = [survivor];
      mocks.active = survivor;
      view.rerender(<EnterpriseRagWorkspace />);
    });
    await act(async () => { history.onOpen(); await Promise.resolve(); });
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "", conversationHistory: { activeId: null } });
  });

  it("cancels uncertain-delete reconciliation after an explicit history selection", async () => {
    const survivor = { ...activeConversation(), id: "survivor", title: "另一会话", updatedAt: 1 };
    mocks.conversations = [{ ...activeConversation(), updatedAt: 2 }, survivor];
    mocks.deleteConversationConfirmed.mockResolvedValueOnce({ ok: false, reason: "network_error", message: "需要重新核对" });
    const view = renderHistory();
    type History = { onDelete:(id:string)=>Promise<{ok:boolean}>;onOpen:()=>void;onSelect:(id:string)=>boolean };
    let history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    await act(async () => { await history.onDelete("conversation-1"); });
    act(() => { expect(history.onSelect("survivor")).toBe(true); });
    mocks.active = survivor;
    mocks.conversations = [survivor];
    view.rerender(<EnterpriseRagWorkspace />);
    history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    await act(async () => { history.onOpen(); await Promise.resolve(); });
    expect(mocks.received?.live).toMatchObject({ answer: "真实回答", conversationHistory: { activeId: "survivor" } });
  });

  it("allows selection while preserving pending-message deletion protection", () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    mocks.pendingDispatch = { question: "未完成的问题" };
    renderHistory();
    const history = (mocks.received?.live as { conversationHistory: { busy:boolean; onSelect:(id:string)=>void; onDelete:(id:string)=>void } }).conversationHistory;
    expect(history.busy).toBe(false);
    act(() => { history.onSelect("conversation-1"); history.onDelete("conversation-1"); });
    expect(mocks.setActive).toHaveBeenCalledWith("conversation-1");
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });

  it("projects earlier questions in order without inventing unfinished answers", () => {
    const conversation = activeConversation();
    const final = conversation.messages[1];
    mocks.active = { ...conversation, messages: [
      { id: "q0", role: "user", content: "先前问题", timestamp: 1 },
      { id: "step", role: "assistant", content: "处理中", timestamp: 2, isStepsPlaceholder: true },
      { ...final, id: "a0", content: "先前回答", generalChat: { ...final.generalChat!, userMessageId: "q0" } },
      { id: "q1", role: "user", content: "未完成问题", timestamp: 3 },
      { id: "step2", role: "assistant", content: "尚未完成", timestamp: 4, isStepsPlaceholder: true },
      ...conversation.messages,
    ] };
    mocks.conversations = [mocks.active];
    renderHistory();
    expect((mocks.received?.live as {previousTurns:unknown[]}).previousTurns).toMatchObject([{id:"q0", question:"先前问题", answer:"先前回答", answerId:"a0", coordinate:{sourceQaTaskId:"task-frozen",turnId:"turn-1"}}, {id:"q1", question:"未完成问题", answer:"", coordinate:undefined}]);
  });

  it("keeps the newer persisted complete question when another device added a supplement", () => {
    const acknowledged = "真实问题\n\n补充：请简短";
    const persisted = `${acknowledged}\n\n补充：保留部署要求`;
    mocks.active = activeConversation();
    (mocks.active.messages as Array<{content: string}>)[0].content = persisted;
    mocks.steering = { supported: true, turnId: "turn-1", revision: 1, effectiveQuestion: acknowledged,
      supplements: [{ clientRequestId: "supplement-1", text: "请简短", revision: 1 }] };
    renderHistory();
    expect(mocks.received?.live).toMatchObject({ question: persisted, questionId: "question-1", answer: "真实回答", answerId: "answer-1", turnId: "turn-1" });
  });

  it("shows a newly acknowledged supplement before the persisted question refresh finishes", () => {
    const acknowledged = "真实问题\n\n补充：请简短";
    mocks.steering = { supported: true, turnId: "turn-1", revision: 1, effectiveQuestion: acknowledged,
      supplements: [{ clientRequestId: "supplement-1", text: "请简短", revision: 1 }] };
    renderHistory();
    expect(mocks.received?.live).toMatchObject({ question: "真实问题", questionId: "question-1", answer: "真实回答", turnId: "turn-1", chat:{question:acknowledged} });
  });

  it("attributes a historical answer to its frozen task snapshot, never the current publication", () => {
    renderHistory();

    expect(screen.getByTestId("designed-enterprise-rag")).toBeTruthy();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.sourceCalls).toContainEqual(["task-frozen", true]);
    expect(mocks.received?.live).toMatchObject({
      configured: true,
      providerLabel: "XTY Codex",
      knowledgeBinding: "frozen_task",
      taskId: "task-frozen",
      turnId: "turn-1",
      conversationReady: true,
      question: "真实问题",
      answer: "真实回答",
      answerCompletedAt: 1793893500000,
      knowledgeBase: { snapshotId: "frozen-snapshot", version: 4 },
      currentKnowledgeBase: { snapshotId: "current-snapshot", version: 9 },
      sources: [{ id: "source-1", title: "任务实际引用资料" }],
      onRetryPending: mocks.retryPending,
    });
    expect(mocks.received?.live).not.toHaveProperty("questionStartedAt");
    expect(mocks.received?.live).not.toHaveProperty("answerDurationMs");
  });

  it("opens a local new draft and persists a new conversation only when its first question is submitted", async () => {
    render(<EnterpriseRagWorkspace />);

    act(() => {
      (
        mocks.received?.live as {
          onStartNewConversation: () => void;
        }
      ).onStartNewConversation();
    });

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, answer: "", knowledgeBinding: "current_publication" });
    await act(async () => { expect(await (mocks.received?.live as {onAsk:(question:string)=>Promise<boolean>}).onAsk("新会话首问")).toBe(true); });
    expect(mocks.createConversation).toHaveBeenCalledWith({
      title: "企业问答",
      reuseEmpty: false,
      purpose: "enterprise_qa",
      workbenchAgentId: "enterprise-qa",
    });
    expect(mocks.setWorkbenchTaskQuery).toHaveBeenCalledWith(
      "new-conversation",
    );
  });

  it("prefers the task response snapshot while the task runtime source is loading", () => {
    mocks.responseKnowledgeBase = {
      snapshotId: "response-snapshot",
      version: 6,
      sourceFileName: "response.zip",
      documentCount: 6,
    };
    mocks.taskSource = {
      ...mocks.taskSource,
      loaded: false,
      knowledgeBase: null,
    };

    renderHistory();

    expect(mocks.received?.live).toMatchObject({
      loaded: true,
      failed: false,
      knowledgeBinding: "frozen_task",
      knowledgeBase: { snapshotId: "response-snapshot", version: 6 },
    });
  });

  it("marks an unreadable historical snapshot unknown instead of substituting the current publication", () => {
    mocks.taskSource = {
      ...mocks.taskSource,
      loaded: true,
      failed: true,
      failureCode: "TASK_SOURCE_UNAVAILABLE",
      knowledgeBase: null,
    };

    renderHistory();

    expect(mocks.received?.live).toMatchObject({
      failed: true,
      knowledgeBinding: "historical_unknown",
      knowledgeBase: null,
      currentKnowledgeBase: { version: 9 },
    });
  });

  it("forwards a stale-source warning without discarding the frozen snapshot", () => {
    mocks.taskSource = { ...mocks.taskSource, refreshFailed: true };

    renderHistory();

    expect(mocks.received?.live).toMatchObject({
      refreshFailed: true,
      knowledgeBinding: "frozen_task",
      knowledgeBase: { version: 4 },
    });
  });

  it("keeps the project workbench and makes the later design its main surface", () => {
    render(
      <EnterpriseRagWorkspace
        workbench
        projectId="workspace-1"
        storageScopeKey="21:workspace-1"
      />,
    );

    expect(screen.getByTestId("project-workbench")).toBeTruthy();
    expect(screen.getByTestId("designed-enterprise-rag")).toBeTruthy();
    expect(screen.getByTestId("source-note")).toBeTruthy();
    expect(mocks.workbenchProps).toMatchObject({
      projectId: "workspace-1",
      purpose: "enterprise_qa",
      autoCreate: false,
      canCreateConversation: true,
    });
    expect(mocks.received?.storageScopeKey).toBe("21:workspace-1");
  });

  it("keeps the draft visible but blocks sending until publication metadata is ready", () => {
    mocks.active = null;
    mocks.conversations = [];
    mocks.currentSource = {
      ...mocks.currentSource,
      loaded: false,
      knowledgeBase: null,
    };
    const page = render(<EnterpriseRagWorkspace />);
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({conversationReady:true,canCompose:false,canSend:false});

    mocks.currentSource = {
      loaded: true,
      failed: false,
      failureCode: undefined,
      refreshFailed: undefined,
      configured: true,
      provider: "xty_codex",
      knowledgeBase: {
        snapshotId: "current-snapshot",
        version: 9,
        sourceFileName: "current.zip",
        documentCount: 9,
      },
    };
    page.rerender(<EnterpriseRagWorkspace />);

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, canCompose: true, canSend: true, knowledgeBinding: "current_publication" });
  });

  it("does not submit a first draft while history and publication metadata remain unresolved", async () => {
    mocks.hydrated=false;mocks.loading=true;mocks.active=null;mocks.conversations=[];
    mocks.currentSource={...mocks.currentSource,loaded:false,failed:false,configured:null,provider:null,knowledgeBase:null};
    render(<EnterpriseRagWorkspace/>);
    type Live={canCompose:boolean;canSend:boolean;conversationReady:boolean;onAsk:(question:string)=>Promise<boolean>;conversationHistory:{loading:boolean}};
    const live=mocks.received?.live as Live;
    expect(live).toMatchObject({canCompose:false,canSend:false,conversationReady:true,conversationHistory:{loading:true}});
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await act(async()=>expect(await live.onAsk("知识库未就绪时不能发送")).toBe(false));
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.setWorkbenchTaskQuery).not.toHaveBeenCalled();
  });

  it("keeps the new draft editable and selected while historical conversations are still loading", async () => {
    mocks.hydrated = false; mocks.loading = true; mocks.active = null; mocks.conversations = [];
    const view = render(<EnterpriseRagWorkspace />);
    const initial = mocks.received?.live as {conversationId:string;conversationReady:boolean;canSend:boolean;onDraftInput:()=>void;onAsk:(question:string)=>Promise<boolean>;conversationHistory:{loading:boolean}};
    expect(initial).toMatchObject({conversationReady:true,canSend:true,conversationHistory:{loading:true}});
    const draftId = initial.conversationId;
    act(()=>initial.onDraftInput());
    mocks.active = activeConversation(); mocks.conversations = [mocks.active]; mocks.hydrated = true; mocks.loading = false;
    view.rerender(<EnterpriseRagWorkspace />);
    expect(mocks.received?.live).toMatchObject({conversationId:draftId,answer:"",canSend:true});
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await act(async()=>expect(await (mocks.received?.live as typeof initial).onAsk("加载期间的新问题")).toBe(true));
    expect(mocks.send).toHaveBeenCalledWith("加载期间的新问题",[],expect.objectContaining({id:"new-conversation",purpose:"enterprise_qa",messages:[]}));
  });

  it("selects each answer's own task, turn, sources and frozen knowledge while preserving the latest chat",()=>{
    const conversation=activeConversation(); const olderAnswer=conversation.messages[1];
    mocks.active={...conversation,messages:[
      {id:"question-old",role:"user",content:"旧问题",timestamp:1},
      {...olderAnswer,id:"answer-old",content:"旧回答",generalChat:{...olderAnswer.generalChat!,agentTaskId:"task-older",turnId:"turn-older",userMessageId:"question-old"},enterpriseQaAnswer:{sources:[{id:"source-old",title:"旧任务来源",kind:"published_knowledge"}]}},
      ...conversation.messages,
    ]};mocks.conversations=[mocks.active];
    mocks.taskSources["task-older"]={...mocks.taskSource,knowledgeBase:{snapshotId:"older-snapshot",version:2,sourceFileName:"older.zip",documentCount:2}};
    const view=renderHistory();
    type Live={previousTurns:Array<{answerKey:string}>;onSelectAnswer:(key:string)=>void};
    const prior=(mocks.received?.live as Live).previousTurns[0];
    act(()=>(mocks.received?.live as Live).onSelectAnswer(prior.answerKey));
    expect(mocks.received?.live).toMatchObject({taskId:"task-older",turnId:"turn-older",question:"旧问题",answer:"旧回答",answerId:"answer-old",knowledgeBinding:"frozen_task",knowledgeBase:{snapshotId:"older-snapshot",version:2},sources:[{id:"source-old",title:"旧任务来源"}],chat:{question:"真实问题",answer:"真实回答"}});
    expect(mocks.sourceCalls).toContainEqual(["task-older",true]);
    mocks.active={...mocks.active,status:"running"};view.rerender(<EnterpriseRagWorkspace/>);
    expect(mocks.received?.live).toMatchObject({taskId:"task-older",turnId:"turn-older",answerId:"answer-old"});
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("never borrows the latest task or knowledge binding for an older answer without server coordinates",()=>{
    const conversation=activeConversation();
    mocks.active={...conversation,messages:[
      {id:"legacy-question",role:"user",content:"无服务端坐标的旧问题",timestamp:1},
      {id:"legacy-answer",role:"assistant",content:"无服务端坐标的旧回答",timestamp:2,generalChat:{isFinalAnswer:true}},
      ...conversation.messages,
    ]};mocks.conversations=[mocks.active];
    renderHistory();
    type Live={previousTurns:Array<{answerKey:string}>;onSelectAnswer:(key:string)=>void};
    const prior=(mocks.received?.live as Live).previousTurns[0];
    act(()=>(mocks.received?.live as Live).onSelectAnswer(prior.answerKey));
    expect(mocks.received?.live).toMatchObject({taskId:undefined,turnId:undefined,answerId:"legacy-answer",knowledgeBase:null,knowledgeBinding:"historical_unknown"});
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("uses a historical greeting's frozen knowledge identity without a model task pointer",()=>{
    mocks.active={
      id:"greeting-conversation",purpose:"enterprise_qa",status:"completed",createdAt:1,updatedAt:2,messages:[
        {id:"greeting-question",role:"user",content:"你好",timestamp:1},
        {id:"greeting-answer",role:"assistant",content:"你好，有什么可以帮你？",timestamp:2,enterpriseQaLocalReply:{
          schemaVersion:1,kind:"local_reply",source:"rule",reason:"greeting",evaluation:"not_required",serverOwned:true,
          turnId:"11111111-1111-4111-8111-111111111111",userMessageId:"greeting-question",answerMessageId:"greeting-answer",
          knowledgeBase:{snapshotId:"hospital-snapshot",version:7,sourceFileName:"东莞台心医院-knowledge-base.zip",documentCount:12,companyName:"东莞台心医院"},
        }},
      ],
    };
    mocks.conversations=[mocks.active];
    mocks.currentSource={...mocks.currentSource,loaded:true,failed:true,knowledgeBase:null};
    renderHistory();
    expect(mocks.received?.live).toMatchObject({
      taskId:undefined,turnId:"11111111-1111-4111-8111-111111111111",answerId:"greeting-answer",
      loaded:true,failed:false,knowledgeBinding:"frozen_task",evaluationNotRequired:true,
      knowledgeBase:{snapshotId:"hospital-snapshot",version:7,companyName:"东莞台心医院"},
    });
  });

  it("does not create a conversation when the model status or provider is unknown", () => {
    mocks.active = null;
    mocks.conversations = [];
    mocks.currentSource = {
      ...mocks.currentSource,
      configured: null,
      provider: null,
    };

    render(<EnterpriseRagWorkspace workbench projectId="workspace-1" />);

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.workbenchProps).toMatchObject({
      autoCreate: false,
      canCreateConversation: false,
    });
  });
});


it("always opens a blank draft and never restores old history after hydration or remount", () => {
  window.history.replaceState({},"","/?view=enterprise-qa&workbenchTask=conversation-1");
  mocks.hydrated=false; mocks.loading=true;
  const view=render(<EnterpriseRagWorkspace/>);
  expect(mocks.received?.live).toMatchObject({question:"",answer:"",canSend:true});
  expect(new URL(location.href).searchParams.has("workbenchTask")).toBe(false);
  mocks.hydrated=true; mocks.loading=false; view.rerender(<EnterpriseRagWorkspace/>);
  expect(mocks.received?.live).toMatchObject({question:"",answer:""});
  act(()=>{(mocks.received?.live as {conversationHistory:{onSelect:(id:string)=>void}}).conversationHistory.onSelect("conversation-1");});
  expect(mocks.received?.live).toMatchObject({question:"真实问题",answer:"真实回答"});
  view.unmount(); render(<EnterpriseRagWorkspace/>);
  expect(mocks.received?.live).toMatchObject({question:"",answer:""});
  expect(mocks.conversations).toHaveLength(1);
});
