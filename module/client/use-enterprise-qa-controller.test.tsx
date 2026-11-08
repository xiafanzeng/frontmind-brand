import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandConversationContext } from "./host";

const mocks = vi.hoisted(() => ({
  context: null as BrandConversationContext | null,
  fetch: vi.fn(),
  queueFetch: vi.fn(),
}));

vi.mock("./host", () => ({
  useConversation: () => mocks.context,
  brandHost: () => ({
    captureWorkspaceRestOperation: () => ({
      assertActive: vi.fn(),
      fetch: (...args: [string, RequestInit?]) => args[0].includes("/followups") ? mocks.queueFetch(...args) : mocks.fetch(...args),
    }),
  }),
}));

import { useEnterpriseQaController } from "./use-enterprise-qa-controller";

function conversationContext(
  taskId?: string,
  conversationId = "qa-conversation",
): BrandConversationContext {
  const conversation = {
    id: conversationId,
    title: "企业问答",
    purpose: "enterprise_qa" as const,
    workbenchAgentId: "enterprise-qa",
    messages: [],
    taskId,
    previousResponseId: taskId,
    status: "completed" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const context = {
    state: {
      conversations: [conversation],
      activeConversationId: conversation.id,
    },
    activeConversation: conversation,
    loading: false,
    hydrated: true,
    syncError: null,
    createConversation: vi.fn(),
    setActive: vi.fn(),
    updateStatus: vi.fn((_id, _status, extra) => {
      Object.assign(conversation, extra);
    }),
    settleGeneralChatDispatch: vi.fn(),
    deleteConversation: vi.fn(),
    deleteConversationConfirmed: vi.fn(async () => ({ ok: true as const })),
    flushConversation: vi.fn(async () => true),
    rollbackPendingKnowledgeBaseTurn: vi.fn(),
    addMessage: vi.fn((_id, message) => conversation.messages.push(message as never)),
    updateTitle: vi.fn(),
    settleKnowledgeBaseStartFailure: vi.fn(),
    registerKnowledgeBaseConversation: vi.fn(),
    wakeKnowledgeBaseConversation: vi.fn(),
    commitKnowledgeBaseObservation: vi.fn(),
    discardKnowledgeBaseConversationsLocally: vi.fn(() => []),
    refreshConversationsAfterDiscard: vi.fn(async () => undefined),
    refreshConversations: vi.fn(async () => undefined),
    clearSyncError: vi.fn(),
  } satisfies BrandConversationContext;
  return context;
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.queueFetch.mockReset().mockResolvedValue({ok:true,json:async()=>({items:[],paused:false})});
  mocks.context = conversationContext();
});
afterEach(cleanup);

describe("enterprise QA controller", () => {
  it("freezes the RAG evaluation opt-in on both new and continued user turns", async () => {
    for (const taskId of [undefined, "task-existing"]) {
      mocks.context = conversationContext(taskId);
      mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: taskId ?? "task-new", purpose: "enterprise_qa", status: "running" }) });
      const view = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
      await act(async () => expect(await view.result.current.send("本轮需要自动评估")).toBe(true));
      const pending = mocks.context.activeConversation!.messages.at(-1)!;
      expect(pending.generalChatDispatch).toMatchObject({ evaluationIntent: "enterprise_rag_once" });
      const [path, init] = mocks.fetch.mock.calls[0];
      expect(path).toBe(taskId ? `/api/frontmind/v2/tasks/${taskId}/messages` : "/api/frontmind/v2/tasks");
      expect(JSON.parse(init.body)).toMatchObject({ evaluationIntent: "enterprise_rag_once", clientRequestId: pending.id });
      view.unmount();
    }
  });

  it("the shared controller leaves paid evaluation absent by default", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "task-new", purpose: "enterprise_qa", status: "running" }) });
    const { result } = renderHook(() => useEnterpriseQaController());
    await act(async () => expect(await result.current.send("普通企业问答")).toBe(true));
    expect(mocks.context!.activeConversation!.messages.at(-1)!.generalChatDispatch).not.toHaveProperty("evaluationIntent");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty("evaluationIntent");
  });

  it("replays the saved opt-in and request identity after unknown delivery even if the current caller stops opting in", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "task-recovered", purpose: "enterprise_qa", status: "running" }) });
    const view = renderHook(({ intent }: { intent?: "enterprise_rag_once" }) => useEnterpriseQaController({ evaluationIntent: intent }), { initialProps: { intent: "enterprise_rag_once" as "enterprise_rag_once" | undefined } });
    await act(async () => expect(await view.result.current.send("保存后重试")).toBe(false));
    const original = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    view.rerender({ intent: undefined });
    await act(async () => expect(await view.result.current.retryPending()).toBe(true));
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual(original);
    expect(original.evaluationIntent).toBe("enterprise_rag_once");
    expect(mocks.context!.addMessage).toHaveBeenCalledTimes(1);
  });

  it("does not add a paid opt-in when retrying an older pending message with no such field", async () => {
    const context = conversationContext();
    context.activeConversation!.messages.push({
      id: "legacy-pending", role: "user", content: "旧的未确认提交", timestamp: 1,
      generalChatDispatch: { schemaVersion: 1, kind: "pending_user", clientRequestId: "legacy-pending", providerPrompt: "旧的未确认提交", localAssetIds: [], localTaskId: null, modelProfile: "frontmind-base", purpose: "enterprise_qa" },
    });
    mocks.context = context;
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "task-legacy", purpose: "enterprise_qa", status: "running" }) });
    const { result } = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
    await act(async () => expect(await result.current.retryPending()).toBe(true));
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty("evaluationIntent");
    expect(context.activeConversation!.messages[0].generalChatDispatch).not.toHaveProperty("evaluationIntent");
    expect(context.addMessage).not.toHaveBeenCalled();
  });

  it("submits a newly persisted draft by its explicit identity before React selects it", async () => {
    const context = conversationContext(undefined, "old-conversation");
    const actualDraft = { ...context.activeConversation!, id: "new-conversation", messages: [] as NonNullable<BrandConversationContext["activeConversation"]>["messages"] };
    context.state.conversations.push(actualDraft);
    const newDraftArgument = { ...actualDraft, messages: [] };
    vi.mocked(context.addMessage).mockImplementation((id, message) => { context.state.conversations.find(item => item.id === id)!.messages.push(message); });
    vi.mocked(context.flushConversation).mockImplementation(async id => {
      expect(id).toBe("new-conversation");
      expect(actualDraft.messages[0]?.generalChatDispatch).toMatchObject({ providerPrompt: "新草稿的第一个问题", evaluationIntent: "enterprise_rag_once" });
      return true;
    });
    mocks.context = context;
    mocks.fetch.mockImplementation(async (_path, init) => {
      expect(context.flushConversation).toHaveBeenCalled();
      expect(JSON.parse(init.body)).toMatchObject({ conversationId: "new-conversation", evaluationIntent: "enterprise_rag_once" });
      return { ok: true, json: async () => ({ id: "task-draft", purpose: "enterprise_qa", status: "running" }) };
    });
    const { result } = renderHook(() => useEnterpriseQaController({ activeConversationId: null, evaluationIntent: "enterprise_rag_once" }));
    expect(result.current.active).toBeNull();
    await act(async () => expect(await result.current.send("新草稿的第一个问题", [], newDraftArgument)).toBe(true));
    expect(context.activeConversation!.id).toBe("old-conversation");
    expect(context.activeConversation!.messages).toHaveLength(0);
    expect(actualDraft.messages).toHaveLength(1);
    expect(context.updateStatus).toHaveBeenCalledWith("new-conversation", "running", expect.objectContaining({ taskId: "task-draft" }));
  });

  it("retains the exact pending question after a server preflight rejection and retries the same dispatch", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok:false,json:async()=>({error:{code:"ENTERPRISE_QA_KNOWLEDGE_REQUIRED",message:"请先发布企业知识库。"}}) })
      .mockResolvedValueOnce({ok:true,json:async()=>({id:"task-after-publish",purpose:"enterprise_qa",status:"running"})});
    const {result}=renderHook(()=>useEnterpriseQaController({evaluationIntent:"enterprise_rag_once"}));
    await act(async()=>expect(await result.current.send("知识检查失败仍需保留的问题")).toBe(false));
    expect(mocks.context!.activeConversation!.messages).toHaveLength(1);
    expect(mocks.context!.activeConversation!.messages[0].generalChatDispatch).toMatchObject({providerPrompt:"知识检查失败仍需保留的问题",evaluationIntent:"enterprise_rag_once"});
    expect(mocks.context!.settleGeneralChatDispatch).not.toHaveBeenCalled();
    expect(mocks.context!.updateStatus).not.toHaveBeenCalled();
    const first=JSON.parse(mocks.fetch.mock.calls[0][1].body);
    await act(async()=>expect(await result.current.retryPending()).toBe(true));
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual(first);
    expect(mocks.context!.addMessage).toHaveBeenCalledTimes(1);
  });

  it("creates the first durable enterprise-QA task through the existing contract", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "task-live-1",
        purpose: "enterprise_qa",
        status: "running",
        knowledgeBase: {
          snapshotId: "snapshot-live-1",
          version: 5,
          sourceFileName: "enterprise.zip",
          documentCount: 8,
          contentHash: "content-hash",
        },
      }),
    });
    const { result } = renderHook(() => useEnterpriseQaController());

    await act(async () => {
      expect(await result.current.send("企业支持哪些部署方式？")).toBe(true);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.fetch.mock.calls[0];
    expect(path).toBe("/api/frontmind/v2/tasks");
    expect(JSON.parse(init.body)).toMatchObject({
      conversationId: "qa-conversation",
      prompt: "企业支持哪些部署方式？",
      purpose: "enterprise_qa",
      modelProfile: "frontmind-base",
      localAssetIds: [],
    });
    expect(mocks.context?.updateStatus).toHaveBeenCalledWith(
      "qa-conversation",
      "running",
      expect.objectContaining({
        taskId: "task-live-1",
        executionKind: "general_chat_v2",
      }),
    );
    expect(mocks.context?.settleGeneralChatDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.context?.refreshConversations).toHaveBeenCalledTimes(1);
    expect(result.current.responseKnowledgeBase).toMatchObject({
      snapshotId: "snapshot-live-1",
      version: 5,
    });
  });

  it("continues and stops an existing task without creating a parallel protocol", async () => {
    mocks.context = conversationContext("task-existing");
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "task-existing",
          purpose: "enterprise_qa",
          status: "running",
          canStop: true,
          stopCapabilityReason: null,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "cancelled" }) });
    const { result } = renderHook(() => useEnterpriseQaController());

    await act(async () => {
      expect(await result.current.send("请补充实施条件。")).toBe(true);
      expect(await result.current.stop()).toBe(true);
    });

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "/api/frontmind/v2/tasks/task-existing/messages",
    );
    expect(
      mocks.context?.activeConversation?.messages.at(-1)?.generalChatDispatch,
    ).toMatchObject({ localTaskId: "task-existing" });
    expect(
      mocks.context?.activeConversation?.messages.at(-1)?.generalChatDispatch,
    ).not.toHaveProperty("purpose");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "purpose",
    );
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      "/api/frontmind/v2/tasks/task-existing/stop",
    );
  });

  it("fails closed without a server-confirmed stop capability", async () => {
    mocks.context = conversationContext("task-existing");
    mocks.context.activeConversation!.status = "running";
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "task-existing",
        purpose: "enterprise_qa",
        status: "running",
        canStop: false,
        stopCapabilityReason: "当前任务供应商不支持停止。",
      }),
    });
    const { result } = renderHook(() => useEnterpriseQaController());
    await waitFor(() => expect(result.current.stopCapabilityReason).toBe("当前任务供应商不支持停止。"));
    expect(result.current.canStop).toBe(false);
    await act(async () => expect(await result.current.stop()).toBe(false));
    expect(mocks.fetch.mock.calls.some(([path]) => String(path).endsWith("/stop"))).toBe(false);
  });

  it("exposes and retries the retained pending dispatch without duplicating the message", async () => {
    const context = conversationContext();
    context.activeConversation!.messages.push({
      id: "request-pending",
      role: "user",
      content: "重试这个问题",
      timestamp: 10,
      generalChatDispatch: {
        schemaVersion: 1,
        kind: "pending_user",
        clientRequestId: "request-pending",
        providerPrompt: "重试这个问题",
        localAssetIds: [],
        localTaskId: null,
        modelProfile: "frontmind-base",
        purpose: "enterprise_qa",
      },
    });
    mocks.context = context;
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "task-retried",
        purpose: "enterprise_qa",
        status: "running",
      }),
    });
    const { result } = renderHook(() => useEnterpriseQaController());

    expect(result.current.pendingDispatch).toEqual({
      messageId: "request-pending",
      question: "重试这个问题",
    });
    await act(async () => {
      expect(await result.current.retryPending()).toBe(true);
    });

    expect(context.addMessage).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      clientRequestId: "request-pending",
      prompt: "重试这个问题",
    });
  });

  it("does not retry a legacy marker that already has a server-owned final answer", async () => {
    const context = conversationContext("task-finished");
    context.activeConversation!.messages.push({
      id: "request-finished",
      role: "user",
      content: "已经回答的问题",
      timestamp: 10,
      generalChatDispatch: {
        schemaVersion: 1,
        kind: "pending_user",
        clientRequestId: "request-finished",
        providerPrompt: "已经回答的问题",
        localAssetIds: [],
        localTaskId: null,
        modelProfile: "frontmind-base",
        purpose: "enterprise_qa",
      },
    }, {
      id: "answer-finished",
      role: "assistant",
      content: "已经完成的回答",
      timestamp: 11,
      generalChat: {
        schemaVersion: 1,
        kind: "assistant_projection",
        isFinalAnswer: true,
        turnId: "turn-finished",
        agentTaskId: "task-finished",
        providerEventId: "event-finished",
        userMessageId: "request-finished",
        serverOwned: true,
      },
    });
    mocks.context = context;
    const { result } = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
    expect(result.current.pendingDispatch).toBeNull();
    await act(async () => expect(await result.current.retryPending()).toBe(false));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("clears an old conversation error after switching to a new conversation", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "旧会话提交失败" } }),
    });
    const { result, rerender } = renderHook(() =>
      useEnterpriseQaController(),
    );

    await act(async () => {
      expect(await result.current.send("旧问题")).toBe(false);
    });
    expect(result.current.notice).toBe("旧会话提交失败");

    mocks.context = conversationContext(undefined, "qa-conversation-next");
    rerender();
    await waitFor(() => expect(result.current.notice).toBe(""));
  });
});


const steeringBase = { supported: true, turnId: "turn-current", revision: 0, effectiveQuestion: "原问题", supplements: [] as Array<{clientRequestId: string; text: string; revision: number}> };
function runningSteeringContext() {
  const context = conversationContext("task-running");
  Object.assign(context.activeConversation!, { status: "running", messages: [{ id: "q-running", role: "user", content: "原问题", timestamp: 1 }] });
  mocks.context = context;
  return context;
}
const jsonReply = (value: unknown, ok = true) => ({ ok, json: async () => value });

describe("same-turn enterprise QA supplements", () => {
  it("does not let an older poll replace a newer acknowledged supplement", async () => {
    vi.useFakeTimers();
    let view: ReturnType<typeof renderHook<ReturnType<typeof useEnterpriseQaController>, unknown>> | undefined;
    try {
      runningSteeringContext();
      let reads = 0;
      let releaseOldRead!: (value: ReturnType<typeof jsonReply>) => void;
      mocks.fetch.mockImplementation(async (_path, init) => {
        if (!init.method) {
          if (++reads === 2) return new Promise<ReturnType<typeof jsonReply>>(resolve => { releaseOldRead = resolve; });
          return jsonReply({ id: "task-running", status: "running", steering: steeringBase });
        }
        const body = JSON.parse(init.body);
        return jsonReply({ ...steeringBase, revision: 1, effectiveQuestion: "原问题\n\n补充：请简短", supplements: [{ clientRequestId: body.clientRequestId, text: body.text, revision: 1 }] });
      });
      view = renderHook(() => useEnterpriseQaController());
      await act(async () => {});
      expect(view.result.current.steering?.revision).toBe(0);
      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(reads).toBe(2);
      await act(async () => expect(await view!.result.current.steer("请简短")).toBe(true));
      expect(view.result.current.steering?.revision).toBe(1);
      await act(async () => { releaseOldRead(jsonReply({ id: "task-running", status: "running", steering: steeringBase })); });
      expect(view.result.current.steering).toMatchObject({ revision: 1, effectiveQuestion: "原问题\n\n补充：请简短" });
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it("uses a separate acknowledged request without creating a second user message", async () => {
    const context = runningSteeringContext();
    mocks.fetch.mockImplementation(async (_path, init) => {
      if (!init.method) return jsonReply({ id: "task-running", status: "running", purpose: "enterprise_qa", steering: steeringBase });
      const body = JSON.parse(init.body);
      return jsonReply({ ...steeringBase, revision: 1, effectiveQuestion: "原问题\n\n补充：请简短", supplements: [{ clientRequestId: body.clientRequestId, text: body.text, revision: 1 }] });
    });
    const { result } = renderHook(() => useEnterpriseQaController());
    await waitFor(() => expect(result.current.steering?.supported).toBe(true));
    await act(async () => expect(await result.current.steer("请简短")).toBe(true));
    const [path, init] = mocks.fetch.mock.calls.find(([path]) => String(path).endsWith("/steer"))!;
    expect(path).toBe("/api/frontmind/v2/tasks/task-running/steer");
    expect(JSON.parse(init.body)).toMatchObject({ conversationId: "qa-conversation", expectedTurnId: "turn-current", text: "请简短" });
    expect(result.current.steering?.effectiveQuestion).toContain("补充：请简短");
    expect(context.addMessage).not.toHaveBeenCalled();
    expect(context.activeConversation?.messages).toHaveLength(1);
  });
  it("retries the same request identity after an unknown delivery result", async () => {
    runningSteeringContext();
    let attempts = 0;
    mocks.fetch.mockImplementation(async (_path, init) => {
      if (!init.method) return jsonReply({ id: "task-running", status: "running", steering: steeringBase });
      if (++attempts === 1) throw new Error("network lost");
      const body = JSON.parse(init.body);
      return jsonReply({ ...steeringBase, revision: 1, supplements: [{ clientRequestId: body.clientRequestId, text: body.text, revision: 1 }] });
    });
    const { result } = renderHook(() => useEnterpriseQaController());
    await waitFor(() => expect(result.current.steering).toBeTruthy());
    await act(async () => { await expect(result.current.steer("补充内容")).rejects.toThrow("network lost"); });
    await act(async () => expect(await result.current.steer("补充内容")).toBe(true));
    const sent = mocks.fetch.mock.calls.filter(([path]) => String(path).endsWith("/steer")).map(([, init]) => JSON.parse(init.body));
    expect(sent[0].clientRequestId).toBe(sent[1].clientRequestId);
  });
  it("ignores a late receipt after switching conversations", async () => {
    runningSteeringContext();
    let accept!: () => void;
    mocks.fetch.mockImplementation(async (_path, init) => {
      if (!init.method) return jsonReply({ id: "task-running", status: "running", steering: steeringBase });
      await new Promise<void>(resolve => { accept = resolve; });
      const body = JSON.parse(init.body);
      return jsonReply({ ...steeringBase, revision: 1, supplements: [{ clientRequestId: body.clientRequestId, text: body.text, revision: 1 }] });
    });
    const { result, rerender } = renderHook(() => useEnterpriseQaController());
    await waitFor(() => expect(result.current.steering).toBeTruthy());
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.steer("迟到补充"); });
    mocks.context = conversationContext("other-task", "other-conversation");
    rerender();
    await act(async () => { accept(); expect(await pending).toBe(false); });
    expect(result.current.steering).toBeNull();
  });
  it("does not submit to an unsupported provider", async () => {
    runningSteeringContext();
    mocks.fetch.mockResolvedValue(jsonReply({ id: "task-running", status: "running", steering: { ...steeringBase, supported: false } }));
    const { result } = renderHook(() => useEnterpriseQaController());
    await waitFor(() => expect(result.current.steering?.supported).toBe(false));
    await act(async () => { await expect(result.current.steer("草稿")).resolves.toBe(false); });
    expect(mocks.fetch.mock.calls.some(([path]) => String(path).endsWith("/steer"))).toBe(false);
  });
});


describe("enterprise RAG durable followups and local replies", () => {
  it("retries the original browser dispatch while its task and later FIFO questions are pending", async () => {
    const context = conversationContext("original-task");
    Object.assign(context.activeConversation!, { status: "running" });
    context.activeConversation!.messages.push({
      id: "original-request", role: "user", content: "原请求尚未确认", timestamp: 1,
      generalChatDispatch: { schemaVersion: 1, kind: "pending_user", clientRequestId: "original-request",
        providerPrompt: "原请求尚未确认", localAssetIds: [], localTaskId: null, modelProfile: "frontmind-base",
        purpose: "enterprise_qa", evaluationIntent: "enterprise_rag_once" },
    });
    mocks.context = context;
    mocks.queueFetch.mockResolvedValue(jsonReply({ items: [{ id: "later-question", text: "下一问", status: "queued", paused: false, canCancel: true, canRetry: false }], paused: false }));
    mocks.fetch.mockResolvedValue(jsonReply({ id: "original-task", purpose: "enterprise_qa", status: "running" }));
    const view = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
    await waitFor(() => expect(view.result.current.followups).toHaveLength(1));
    await act(async () => expect(await view.result.current.retryPending()).toBe(true));
    const submissions = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(submissions).toHaveLength(1);
    expect(submissions[0][0]).toBe("/api/frontmind/v2/tasks");
    expect(JSON.parse(submissions[0][1].body)).toMatchObject({ clientRequestId: "original-request", prompt: "原请求尚未确认", evaluationIntent: "enterprise_rag_once" });
    expect(mocks.queueFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(context.addMessage).not.toHaveBeenCalled();
  });

  it("refreshes a drained queue and discovers the worker's newly running task", async () => {
    vi.useFakeTimers();
    let view: ReturnType<typeof renderHook<ReturnType<typeof useEnterpriseQaController>, unknown>> | undefined;
    try {
      const context = conversationContext("completed-task"); mocks.context = context;
      const queued = { id: "queued-question", text: "后台接着回答", status: "queued", paused: false, canCancel: true, canRetry: false };
      mocks.queueFetch.mockResolvedValueOnce(jsonReply({ items: [queued], paused: false })).mockResolvedValue(jsonReply({ items: [], paused: false }));
      let refreshes = 0;
      vi.mocked(context.refreshConversations).mockImplementation(async () => {
        if (++refreshes === 2) Object.assign(context.activeConversation!, { status: "running", taskId: "worker-task", previousResponseId: "worker-task" });
      });
      mocks.fetch.mockResolvedValue(jsonReply({ id: "worker-task", purpose: "enterprise_qa", status: "running" }));
      view = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
      await act(async () => {});
      expect(view.result.current.followups).toHaveLength(1);
      expect(context.refreshConversations).toHaveBeenCalledTimes(1);
      expect(mocks.fetch).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(view.result.current.followups).toHaveLength(0);
      expect(vi.mocked(context.refreshConversations).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mocks.fetch.mock.calls.some(([path]) => path === "/api/frontmind/v2/tasks/worker-task")).toBe(true);
    } finally { view?.unmount(); vi.useRealTimers(); }
  });

  it("leaves a worker-owned unknown dispatch to the durable worker instead of browser retry", async () => {
    const context = conversationContext("worker-task"); mocks.context = context;
    context.activeConversation!.messages.push({
      id: "worker-request", role: "user", content: "后台提交的问题", timestamp: 1,
      enterpriseQaFollowup: { schemaVersion: 1, queueId: "11111111-1111-4111-8111-111111111111", serverOwned: true },
      generalChatDispatch: { schemaVersion: 1, kind: "pending_user", clientRequestId: "worker-request",
        providerPrompt: "后台提交的问题", localAssetIds: [], localTaskId: null, modelProfile: "frontmind-base", purpose: "enterprise_qa" },
    });
    const view = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
    expect(view.result.current.pendingDispatch).toBeNull();
    await act(async () => expect(await view.result.current.retryPending()).toBe(false));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.queueFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(context.settleGeneralChatDispatch).not.toHaveBeenCalled();
    expect(context.addMessage).not.toHaveBeenCalled();
  });

  it("settles a rule greeting without replacing an existing model task pointer", async () => {
    const context = conversationContext("existing-task"); mocks.context = context;
    mocks.fetch.mockImplementation(async (_path, init) => {
      const userMessageId = JSON.parse(init.body).clientRequestId;
      return jsonReply({ object: "frontmind.local_reply", conversationId: "qa-conversation", turnId: "11111111-1111-4111-8111-111111111111",
        userMessageId, answerMessageId: "greeting-answer", content: "你好，有什么可以帮你？", status: "completed", completedAt: 1793980800000,
        reason: "greeting", evaluation: "not_required", enterpriseQaLocalReply: { schemaVersion: 1, kind: "local_reply", source: "rule", reason: "greeting",
          turnId: "11111111-1111-4111-8111-111111111111", userMessageId, answerMessageId: "greeting-answer", serverOwned: true, evaluation: "not_required",
          knowledgeBase: { snapshotId: "hospital-snapshot", version: 7, sourceFileName: "东莞台心医院-knowledge-base.zip", documentCount: 12, companyName: "东莞台心医院" } } });
    });
    const view = renderHook(() => useEnterpriseQaController({evaluationIntent:"enterprise_rag_once"}));
    await act(async () => expect(await view.result.current.send("你好")).toBe(true));
    expect(context.updateStatus).toHaveBeenCalledWith("qa-conversation", "completed");
    expect(context.activeConversation?.taskId).toBe("existing-task");
    expect(context.addMessage).toHaveBeenLastCalledWith("qa-conversation",expect.objectContaining({id:"greeting-answer",enterpriseQaLocalReply:expect.objectContaining({evaluation:"not_required",turnId:"11111111-1111-4111-8111-111111111111",knowledgeBase:expect.objectContaining({snapshotId:"hospital-snapshot",companyName:"东莞台心医院"})})}));
    expect(context.settleGeneralChatDispatch).toHaveBeenCalledOnce();
  });

  it("does not settle the pending question when a same-conversation greeting receipt names another question", async () => {
    const context = conversationContext("existing-task"); mocks.context = context;
    mocks.fetch.mockResolvedValue(jsonReply({ object: "frontmind.local_reply", conversationId: "qa-conversation",
      turnId: "11111111-1111-4111-8111-111111111111", userMessageId: "another-question", answerMessageId: "another-answer",
      content: "另一轮问候回复", status: "completed", completedAt: 1793980800000, reason: "greeting", evaluation: "not_required",
      enterpriseQaLocalReply: { schemaVersion: 1, kind: "local_reply", source: "rule", reason: "greeting",
        turnId: "11111111-1111-4111-8111-111111111111", userMessageId: "another-question", answerMessageId: "another-answer", serverOwned: true, evaluation: "not_required" } }));
    const view = renderHook(() => useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once" }));
    await act(async () => expect(await view.result.current.send("你好")).toBe(false));
    expect(context.settleGeneralChatDispatch).not.toHaveBeenCalled();
    expect(context.updateStatus).not.toHaveBeenCalled();
    expect(context.activeConversation?.messages).toHaveLength(1);
    expect(context.activeConversation?.messages[0]).toMatchObject({ role: "user", content: "你好", generalChatDispatch: expect.any(Object) });
  });

  it("keeps an unknown queue submission's identity on explicit retry and never adds a premature chat message", async () => {
    const context=conversationContext("task"); mocks.context=context;
    mocks.queueFetch.mockImplementation(async (_path,init) => {
      if (!init?.method) return {ok:true,json:async()=>({items:[],paused:false})};
      throw new Error("response lost");
    });
    const view=renderHook(()=>useEnterpriseQaController({evaluationIntent:"enterprise_rag_once"}));
    await act(async()=>expect(await view.result.current.enqueueFollowup("请简短一些")).toBe(false));
    const first=mocks.queueFetch.mock.calls.find(call=>call[1]?.method==="POST")!;
    mocks.queueFetch.mockImplementation(async (_path,init)=>({ok:true,json:async()=>init?.method?{item:{id:"queue-1",text:"请简短一些",status:"queued",paused:false,canCancel:true,canRetry:false}}:{items:[],paused:false}}));
    await act(async()=>expect(await view.result.current.enqueueFollowup("请简短一些")).toBe(true));
    const posts=mocks.queueFetch.mock.calls.filter(call=>call[1]?.method==="POST");
    expect(posts[1][1].body).toBe(first[1].body);
    expect(context.addMessage).not.toHaveBeenCalled();
  });

  it("allows a different conversation to submit before the first acknowledgement and keeps its errors isolated", async () => {
    const context=conversationContext(undefined,"a"); mocks.context=context; const a=context.activeConversation!;
    const b={...a,id:"b",messages:[]}; context.state.conversations.push(b);
    vi.mocked(context.addMessage).mockImplementation((id,message)=>context.state.conversations.find(item=>item.id===id)!.messages.push(message));
    vi.mocked(context.updateStatus).mockImplementation((id,status,extra)=>Object.assign(context.state.conversations.find(item=>item.id===id)!,{status,...extra}));
    let rejectA!:(error:Error)=>void;
    mocks.fetch.mockImplementation(async (_path,init)=>!init?.body?{ok:true,json:async()=>({id:"b-task",purpose:"enterprise_qa",status:"running"})}:JSON.parse(init.body).conversationId==="a"?new Promise((_resolve,reject)=>{rejectA=reject;}):{ok:true,json:async()=>({id:"b-task",purpose:"enterprise_qa",status:"running"})});
    const view=renderHook(()=>useEnterpriseQaController()); let requestA!:Promise<boolean>;
    act(()=>{requestA=view.result.current.send("A的问题");});
    await waitFor(()=>expect(rejectA).toBeTypeOf("function"));
    context.activeConversation=b; view.rerender();
    await act(async()=>expect(await view.result.current.send("B的问题")).toBe(true));
    await act(async()=>{rejectA(new Error("A断开"));expect(await requestA).toBe(false);});
    expect(view.result.current.notice).toBe("");
    expect(context.updateStatus).toHaveBeenCalledWith("b","running",expect.objectContaining({taskId:"b-task"}));
  });
});

it("accepts an atomic cross-tab FIFO conversion without re-enqueueing or retaining the premature question", async () => {
  const context=conversationContext();mocks.context=context;
  context.settleQueuedGeneralChatDispatch=vi.fn((_id,requestId)=>{
    context.activeConversation!.messages=context.activeConversation!.messages.filter(message=>message.generalChatDispatch?.clientRequestId!==requestId);
  });
  mocks.fetch.mockImplementation(async (_path,init)=>({ok:true,json:async()=>({object:"frontmind.queued_followup",conversationId:"qa-conversation",userMessageId:JSON.parse(init.body).clientRequestId,item:{id:"queue-race",text:"稍后再回答",status:"queued",paused:false,canCancel:true,canRetry:false}})}));
  const view=renderHook(()=>useEnterpriseQaController({evaluationIntent:"enterprise_rag_once"}));
  await act(async()=>expect(await view.result.current.send("稍后再回答")).toBe(true));
  expect(context.settleQueuedGeneralChatDispatch).toHaveBeenCalledOnce();
  expect(context.activeConversation!.messages).toHaveLength(0);
  expect(context.updateStatus).not.toHaveBeenCalled();
  expect(mocks.queueFetch.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(0);
});
