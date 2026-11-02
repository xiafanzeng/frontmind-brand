import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ starting: false, batchStartedAt: null as number | null, knowledge: { initialized: true } as Record<string, unknown>,
  recover: vi.fn(), observe: vi.fn(), register: vi.fn(), wake: vi.fn(), reconcile: vi.fn() }));
vi.mock("../lib/knowledge-progress", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/knowledge-progress")>(),
  reconcileKnowledgeBaseObservation: mocks.reconcile,
}));
vi.mock("../host", () => ({
  ChatInput: () => <div data-testid="shared-knowledge-composer" />,
  useConversation: () => ({ hydrated: true, activeConversation: {
    id: "existing", status: "completed", knowledgeBase: mocks.knowledge,
    messages: [
      { id: "user", role: "user", content: "确认", timestamp: 1 },
      { id: "assistant", role: "assistant", content: "## 企业概况", timestamp: 2 },
    ],
  }, commitKnowledgeBaseObservation: mocks.observe, registerKnowledgeBaseConversation: mocks.register, wakeKnowledgeBaseConversation: mocks.wake }),
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
it("subscribes to the restored build before reservation fields arrive", () => {
  mocks.knowledge = { initialized: false };
  const progress = { build: { id: "existing-build", status: "researching" }, branches: [] } as any;
  const view = render(<KnowledgeConversation knowledgeBaseProgress={progress} />);
  expect(mocks.register).toHaveBeenCalledWith("existing");
  expect(mocks.wake).toHaveBeenCalledWith("existing");
  expect(screen.queryByTestId("knowledge-upload-recovery")).toBeNull();
  // The existing coordinator supplies the authoritative observation after wake.
  mocks.knowledge = { initialized: true, activeTurnOperationType: "start", activeTurnAwaitingClientAttachments: true,
    activeTurnId: "same-turn", activeClientRequestId: "same-request" };
  view.rerender(<KnowledgeConversation knowledgeBaseProgress={progress} />);
  expect(screen.getByTestId("knowledge-upload-recovery")).toBeDefined();
  expect(mocks.wake).toHaveBeenCalledTimes(1);
});

it("registers an empty conversation without polling a nonexistent build", () => {
  mocks.knowledge = { initialized: false };
  render(<KnowledgeConversation />);
  expect(mocks.register).toHaveBeenCalledWith("existing");
  expect(mocks.wake).not.toHaveBeenCalled();
});

it("shows business failure and rereads the same task without creating a model request", async () => {
  mocks.knowledge = { initialized: true, retainedCustomerAttachmentCount: 2,
    notice: { message: "任务连接暂时中断", severity: "warning", recoveryAction: "reconcile" } };
  const observation = { generation: 1, stateEpoch: 2 };
  mocks.reconcile.mockResolvedValueOnce(observation);
  render(<KnowledgeConversation />);
  expect(screen.getByText("任务连接暂时中断")).toBeDefined();
  expect(screen.getByText("2 个客户附件已保留")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "检查当前任务状态" }));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledWith("existing", observation));
  expect(mocks.reconcile).toHaveBeenCalledWith({ conversationId: "existing" });
});

it("opens the existing reset confirmation when recovery requires a new build", () => {
  mocks.knowledge = { initialized: true,
    notice: { message: "当前资料需要重新上传", severity: "error", recoveryAction: "approve_reset" } };
  const reset = vi.fn();
  window.addEventListener("frontmind:request-knowledge-reset", reset);
  render(<KnowledgeConversation />);
  fireEvent.click(screen.getByRole("button", { name: "重置后重新上传" }));
  expect(reset).toHaveBeenCalledTimes(1);
  expect(mocks.reconcile).not.toHaveBeenCalled();
  window.removeEventListener("frontmind:request-knowledge-reset", reset);
});

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
