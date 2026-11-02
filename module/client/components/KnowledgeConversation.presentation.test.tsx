import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ starting: false, batchStartedAt: null as number | null, knowledge: { initialized: true } as Record<string, unknown>,
  recover: vi.fn(), observe: vi.fn(), wake: vi.fn() }));
vi.mock("../host", () => ({
  ChatInput: () => <div data-testid="shared-knowledge-composer" />,
  useConversation: () => ({ hydrated: true, activeConversation: {
    id: "existing", status: "completed", knowledgeBase: mocks.knowledge,
    messages: [
      { id: "user", role: "user", content: "确认", timestamp: 1 },
      { id: "assistant", role: "assistant", content: "## 企业概况", timestamp: 2 },
    ],
  }, commitKnowledgeBaseObservation: mocks.observe, wakeKnowledgeBaseConversation: mocks.wake }),
  useRuntimeContext: () => ({ workspaceId: "test", accountId: 1 }),
  useWorkspaceDraftGuard: () => {},
  captureWorkspaceRestOperation: vi.fn(),
}));
vi.mock("../lib/knowledge-base-upload-manager", () => ({
  useKnowledgeBaseUploadBatch: () => ({ ref: () => ({ current: null }) }),
  useKnowledgeBaseUploadField: (_batch: unknown, field: unknown, value: unknown) => [field === "isStarting" ? mocks.starting : field === "batchStartedAt" ? mocks.batchStartedAt : value, vi.fn()],
}));
vi.mock("../lib/useKnowledgeBaseStarter", () => ({ useKnowledgeBaseStarter: () => vi.fn() }));
vi.mock("./KnowledgeComposer", () => ({ default: () => null }));
vi.mock("./KnowledgeStarter", () => ({ EmptyConversationHint: () => <div data-testid="knowledge-starter" />, buildKnowledgeBaseStarterAttachmentManifest: vi.fn() }));
vi.mock("./KnowledgeBaseManagedUploadRecovery", () => ({ default: (props: unknown) => {
  mocks.recover(props); return <div data-testid="knowledge-upload-recovery" />;
} }));
import KnowledgeConversation from "./KnowledgeConversation";

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.starting = false; mocks.batchStartedAt = null; mocks.knowledge = { initialized: true }; });
it("preserves projected text, result blocks on both sides and user-only execution dividers", () => {
  const { container } = render(<KnowledgeConversation
    messageProjection={message => message.id === "assistant" ? { ...message, content: "## 已采用的企业概况" } : message}
    inlineBlocks={[
      { id: "before", anchor: { kind: "message", messageId: "assistant" }, placement: "before", content: <span>处理前提示</span> },
      { id: "after", anchor: { kind: "message", messageId: "assistant" }, placement: "after", content: <button>查看已保存的节点</button> },
    ]}
    conversationFooter={<span>现有知识库成果</span>}
  />);
  expect(screen.getByRole("heading", { name: "已采用的企业概况" })).toBeDefined();
  expect(screen.getByText("处理前提示")).toBeDefined();
  expect(screen.getByRole("button", { name: "查看已保存的节点" })).toBeDefined();
  expect(screen.getByText("现有知识库成果")).toBeDefined();
  expect(screen.getByTestId("shared-knowledge-composer")).toBeDefined();
  expect(container.querySelectorAll(".execution-divider")).toHaveLength(1);
  expect(container.querySelector(".brand-knowledge-message--assistant .execution-divider")).toBeNull();
});

it("restores the original zero-file start reservation after refresh", () => {
  mocks.knowledge = { initialized: true, activeTurnOperationType: "start", activeTurnAwaitingClientAttachments: true,
    activeTurnId: "same-turn", activeClientRequestId: "same-request", activeTurnResetRevision: 3,
    activeTurnExpectedAttachmentCount: 2, activeTurnStagedAttachmentCount: 0 };
  render(<KnowledgeConversation />);
  expect(screen.getByTestId("knowledge-upload-recovery")).toBeDefined();
  expect(screen.queryByTestId("shared-knowledge-composer")).toBeNull();
  const recovery = mocks.recover.mock.calls.at(-1)![0];
  expect(recovery).toMatchObject({ operationType: "start", conversationId: "existing", turnId: "same-turn",
    clientRequestId: "same-request", expectedResetRevision: 3 });
  recovery.onObservation({ generation: 1 }); recovery.onRecovered();
  expect(mocks.observe).toHaveBeenCalledWith("existing", { generation: 1 });
  expect(mocks.wake).toHaveBeenCalledWith("existing");
});

it("keeps the local starter mounted while its accepted reservation is still being dispatched", () => {
  mocks.starting = true;
  mocks.knowledge = { initialized: true, activeTurnOperationType: "start", activeTurnAwaitingClientAttachments: true,
    activeTurnId: "same-turn", activeClientRequestId: "same-request" };
  render(<KnowledgeConversation />);
  expect(screen.getByTestId("knowledge-starter")).toBeDefined();
  expect(mocks.recover).not.toHaveBeenCalled();
});

it("retains the local starter's stopped uploads and files until refresh needs server recovery", () => {
  mocks.batchStartedAt = 1000;
  mocks.knowledge = { initialized: true, activeTurnOperationType: "start", activeTurnAwaitingClientAttachments: true,
    activeTurnId: "same-turn", activeClientRequestId: "same-request" };
  render(<KnowledgeConversation />);
  expect(screen.getByTestId("knowledge-starter")).toBeDefined();
  expect(mocks.recover).not.toHaveBeenCalled();
});
