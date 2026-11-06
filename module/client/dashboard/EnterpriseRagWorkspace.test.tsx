import type { ReactNode } from "react";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
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
    deleteConversation: vi.fn(),
    refreshConversations: vi.fn(async () => {}),
    clearSyncError: vi.fn(),
    conversations: [] as Array<Record<string, unknown>>,
    syncError: "",
    busy: false,
    running: false,
    execution: undefined as GeneralExecutionDto | undefined,
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
  finalReplyIds: (messages: Array<{ id: string; role: string; generalChat?: { isFinalAnswer?: boolean } }>) => new Set(messages.filter(message => message.role === "assistant" && (message.id === "answer-1" || message.generalChat?.isFinalAnswer)).map(message => message.id)),
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
    running: mocks.running,
    execution: mocks.execution,
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

beforeEach(() => {
  mocks.active = activeConversation();
  mocks.conversations = [mocks.active];
  mocks.syncError = "";
  mocks.busy = false;
  mocks.hydrated = true;
  mocks.loading = false;
  mocks.taskSources = {};
  mocks.running = false;
  mocks.execution = undefined;
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
});

afterEach(cleanup);

describe("connected redesigned enterprise RAG workspace", () => {
  it("projects immediate task-poll progress ahead of the hydrated conversation", () => {
    mocks.running = true;
    mocks.busy = true;
    mocks.active = {
      ...activeConversation(), status: "running", messages: [activeConversation().messages[0]],
      execution: {
        schemaVersion: 1, taskId: "task-frozen", coverage: "complete",
        timeline: [{
          id: "older-hydrated-progress", turnId: "turn-hydrated", userMessageId: "question-1", userSequence: 1,
          kind: "tool", label: "读取文件", status: "running", timestamp: 5, rank: 1,
        }],
      },
    };
    mocks.execution = {
      schemaVersion: 1, taskId: "task-frozen", coverage: "complete",
      timeline: [{
        id: "poll-progress", turnId: "turn-live", userMessageId: "question-1", userSequence: 1,
        kind: "tool", label: "检索文本", status: "running", timestamp: 10, rank: 1,
      }],
    };
    mocks.conversations = [mocks.active];
    render(<EnterpriseRagWorkspace />);
    expect(mocks.received?.live).toMatchObject({
      running: true,
      runningTurnId: "turn-live",
      activity: [expect.objectContaining({ label: "检索文本", status: "running" })],
    });
  });

  it("retains hydrated execution as a fallback until a task snapshot arrives", () => {
    mocks.running = true;
    mocks.busy = true;
    mocks.active = {
      ...activeConversation(), status: "running", messages: [activeConversation().messages[0]],
      execution: {
        schemaVersion: 1, taskId: "task-frozen", coverage: "complete",
        timeline: [{
          id: "hydrated-progress", turnId: "turn-hydrated", userMessageId: "question-1", userSequence: 1,
          kind: "tool", label: "读取文件", status: "running", timestamp: 10, rank: 1,
        }],
      },
    };
    mocks.conversations = [mocks.active];
    render(<EnterpriseRagWorkspace />);
    expect(mocks.received?.live).toMatchObject({
      runningTurnId: "turn-hydrated",
      activity: [expect.objectContaining({ label: "读取文件", status: "running" })],
    });
  });

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

  it("waits for deletion to succeed before selecting the next conversation", () => {
    mocks.conversations = [
      { ...activeConversation(), title: "企业问答", updatedAt: 100 },
      { ...activeConversation(), id: "survivor", title: "另一会话", updatedAt: 10 },
    ];
    const view = render(<EnterpriseRagWorkspace />);
    const history = (mocks.received?.live as { conversationHistory: { onDelete:(id:string)=>void } }).conversationHistory;
    act(() => { void history.onDelete("conversation-1"); });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.deleteConversation).toHaveBeenCalledWith("conversation-1");
    mocks.active = null;
    mocks.conversations = [mocks.conversations[1]];
    view.rerender(<EnterpriseRagWorkspace />);
    expect(mocks.setActive).toHaveBeenCalledWith("survivor");
    expect(mocks.setWorkbenchTaskQuery).toHaveBeenCalledWith("survivor");
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it("keeps a failed deletion visible and blocks duplicate clicks while awaiting it", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    let settle!: (value:boolean) => void;
    mocks.deleteConversation.mockReturnValue(new Promise<boolean>(resolve => { settle = resolve; }));
    render(<EnterpriseRagWorkspace />);
    type History = { deletingId?:string|null; onDelete:(id:string)=>void|Promise<boolean> };
    let pending: void | Promise<boolean>;
    act(() => { pending = (mocks.received?.live as {conversationHistory:History}).conversationHistory.onDelete("conversation-1"); });
    const history = (mocks.received?.live as {conversationHistory:History}).conversationHistory;
    expect(history.deletingId).toBe("conversation-1");
    act(() => { history.onDelete("conversation-1"); });
    expect(mocks.deleteConversation).toHaveBeenCalledOnce();
    await act(async () => { settle(false); await pending; });
    expect((mocks.received?.live as {conversationHistory:History}).conversationHistory.deletingId).toBeNull();
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("serializes staged deletions until each removal is observed, including void-return hosts", async () => {
    mocks.conversations = [
      { ...activeConversation(), id: "conversation-1", updatedAt: 3 },
      { ...activeConversation(), id: "second", updatedAt: 2 },
      { ...activeConversation(), id: "third", updatedAt: 1 },
    ];
    const view = render(<EnterpriseRagWorkspace />);
    const history = (mocks.received?.live as {conversationHistory:{onDelete:(id:string)=>Promise<boolean>;onSelect:(id:string)=>boolean}}).conversationHistory;
    act(() => { expect(history.onSelect("third")).toBe(true); });
    let first!: Promise<boolean>;
    act(() => { first = history.onDelete("conversation-1"); });
    let settled = false; void first.then(() => { settled = true; });
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(false);
    mocks.active = { ...activeConversation(), id: "third" };
    mocks.conversations = mocks.conversations.filter(item => item.id !== "conversation-1");
    act(() => { view.rerender(<EnterpriseRagWorkspace />); });
    await act(async () => { expect(await first).toBe(true); });
    let second!: Promise<boolean>;
    act(() => { second = history.onDelete("second"); });
    expect(mocks.deleteConversation).toHaveBeenNthCalledWith(2, "second");
    mocks.conversations = mocks.conversations.filter(item => item.id !== "second");
    act(() => { view.rerender(<EnterpriseRagWorkspace />); });
    await act(async () => { expect(await second).toBe(true); });
    expect(mocks.setWorkbenchTaskQuery).toHaveBeenLastCalledWith("third");
  });

  it("resolves a void-host deletion as failed when synchronization reports an error", async () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    const view = render(<EnterpriseRagWorkspace />);
    const history = (mocks.received?.live as {conversationHistory:{onDelete:(id:string)=>Promise<boolean>}}).conversationHistory;
    let pending!: Promise<boolean>;
    act(() => { pending = history.onDelete("conversation-1"); });
    mocks.syncError = "网络异常，未删除";
    act(() => { view.rerender(<EnterpriseRagWorkspace />); });
    await act(async () => { expect(await pending).toBe(false); });
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect((mocks.received?.live as {conversationHistory:{deletingId:string|null}}).conversationHistory.deletingId).toBeNull();
  });

  it("does not switch or delete while the current request is pending", () => {
    mocks.conversations = [{ ...activeConversation(), updatedAt: 1 }];
    mocks.pendingDispatch = { question: "未完成的问题" };
    render(<EnterpriseRagWorkspace />);
    const history = (mocks.received?.live as { conversationHistory: { busy:boolean; onSelect:(id:string)=>void; onDelete:(id:string)=>void } }).conversationHistory;
    expect(history.busy).toBe(true);
    act(() => { history.onSelect("conversation-1"); history.onDelete("conversation-1"); });
    expect(mocks.setActive).not.toHaveBeenCalled();
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
    render(<EnterpriseRagWorkspace />);
    expect((mocks.received?.live as {previousTurns:unknown[]}).previousTurns).toMatchObject([{id:"q0", question:"先前问题", answer:"先前回答", answerId:"a0", coordinate:{sourceQaTaskId:"task-frozen",turnId:"turn-1"}}, {id:"q1", question:"未完成问题", answer:"", coordinate:undefined}]);
  });

  it("keeps the newer persisted complete question when another device added a supplement", () => {
    const acknowledged = "真实问题\n\n补充：请简短";
    const persisted = `${acknowledged}\n\n补充：保留部署要求`;
    mocks.active = activeConversation();
    (mocks.active.messages as Array<{content: string}>)[0].content = persisted;
    mocks.steering = { supported: true, turnId: "turn-1", revision: 1, effectiveQuestion: acknowledged,
      supplements: [{ clientRequestId: "supplement-1", text: "请简短", revision: 1 }] };
    render(<EnterpriseRagWorkspace />);
    expect(mocks.received?.live).toMatchObject({ question: persisted, questionId: "question-1", answer: "真实回答", answerId: "answer-1", turnId: "turn-1" });
  });

  it("shows a newly acknowledged supplement before the persisted question refresh finishes", () => {
    const acknowledged = "真实问题\n\n补充：请简短";
    mocks.steering = { supported: true, turnId: "turn-1", revision: 1, effectiveQuestion: acknowledged,
      supplements: [{ clientRequestId: "supplement-1", text: "请简短", revision: 1 }] };
    render(<EnterpriseRagWorkspace />);
    expect(mocks.received?.live).toMatchObject({ question: "真实问题", questionId: "question-1", answer: "真实回答", turnId: "turn-1", chat:{question:acknowledged} });
  });

  it("attributes a historical answer to its frozen task snapshot, never the current publication", () => {
    render(<EnterpriseRagWorkspace />);

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

    render(<EnterpriseRagWorkspace />);

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

    render(<EnterpriseRagWorkspace />);

    expect(mocks.received?.live).toMatchObject({
      failed: true,
      knowledgeBinding: "historical_unknown",
      knowledgeBase: null,
      currentKnowledgeBase: { version: 9 },
    });
  });

  it("forwards a stale-source warning without discarding the frozen snapshot", () => {
    mocks.taskSource = { ...mocks.taskSource, refreshFailed: true };

    render(<EnterpriseRagWorkspace />);

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

  it("keeps sending available while publication metadata loads without eagerly creating a conversation", () => {
    mocks.active = null;
    mocks.conversations = [];
    mocks.currentSource = {
      ...mocks.currentSource,
      loaded: false,
      knowledgeBase: null,
    };
    const page = render(<EnterpriseRagWorkspace />);
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.received?.live).toMatchObject({conversationReady:true,canSend:true});

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
    expect(mocks.received?.live).toMatchObject({ conversationReady: true, canSend: true, knowledgeBinding: "current_publication" });
  });

  it("submits the first draft question while both history and publication metadata remain unresolved", async () => {
    mocks.hydrated=false;mocks.loading=true;mocks.active=null;mocks.conversations=[];
    mocks.currentSource={...mocks.currentSource,loaded:false,failed:false,configured:null,provider:null,knowledgeBase:null};
    render(<EnterpriseRagWorkspace/>);
    type Live={canSend:boolean;conversationReady:boolean;onAsk:(question:string)=>Promise<boolean>;conversationHistory:{loading:boolean}};
    const live=mocks.received?.live as Live;
    expect(live).toMatchObject({canSend:true,conversationReady:true,conversationHistory:{loading:true}});
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await act(async()=>expect(await live.onAsk("发送时由服务端核验资料与凭据")).toBe(true));
    expect(mocks.createConversation).toHaveBeenCalledWith({title:"企业问答",reuseEmpty:false,purpose:"enterprise_qa",workbenchAgentId:"enterprise-qa"});
    expect(mocks.send).toHaveBeenCalledWith("发送时由服务端核验资料与凭据",[],expect.objectContaining({id:"new-conversation",purpose:"enterprise_qa",messages:[]}));
    expect(mocks.setWorkbenchTaskQuery).toHaveBeenCalledWith("new-conversation");
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
    const view=render(<EnterpriseRagWorkspace/>);
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
    render(<EnterpriseRagWorkspace/>);
    type Live={previousTurns:Array<{answerKey:string}>;onSelectAnswer:(key:string)=>void};
    const prior=(mocks.received?.live as Live).previousTurns[0];
    act(()=>(mocks.received?.live as Live).onSelectAnswer(prior.answerKey));
    expect(mocks.received?.live).toMatchObject({taskId:undefined,turnId:undefined,answerId:"legacy-answer",knowledgeBase:null,knowledgeBinding:"historical_unknown"});
    expect(mocks.send).not.toHaveBeenCalled();
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
