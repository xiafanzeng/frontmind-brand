import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandConversationContext } from "./host";

const mocks = vi.hoisted(() => ({
  context: null as BrandConversationContext | null,
  fetch: vi.fn(),
}));

vi.mock("./host", () => ({
  useConversation: () => mocks.context,
  brandHost: () => ({
    captureWorkspaceRestOperation: () => ({
      assertActive: vi.fn(),
      fetch: mocks.fetch,
    }),
  }),
}));

import { useEnterpriseQaController } from "./use-enterprise-qa-controller";

function conversationContext(taskId?: string): BrandConversationContext {
  const conversation = {
    id: "qa-conversation",
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
  mocks.context = conversationContext();
});
afterEach(cleanup);

describe("enterprise QA controller", () => {
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
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "purpose",
    );
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      "/api/frontmind/v2/tasks/task-existing/stop",
    );
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
});

