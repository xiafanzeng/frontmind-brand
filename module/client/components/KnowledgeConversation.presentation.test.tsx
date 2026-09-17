import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../host", () => ({
  useConversation: () => ({ hydrated: true, activeConversation: {
    id: "existing", status: "completed", knowledgeBase: { initialized: true },
    messages: [
      { id: "user", role: "user", content: "确认", timestamp: 1 },
      { id: "assistant", role: "assistant", content: "## 企业概况", timestamp: 2 },
    ],
  } }),
  useRuntimeContext: () => ({ workspaceId: "test", accountId: 1 }),
  useWorkspaceDraftGuard: () => {},
  captureWorkspaceRestOperation: vi.fn(),
}));
vi.mock("../lib/knowledge-base-upload-manager", () => ({
  useKnowledgeBaseUploadBatch: () => ({ ref: () => ({ current: null }) }),
  useKnowledgeBaseUploadField: (_batch: unknown, _field: unknown, value: unknown) => [value, vi.fn()],
}));
vi.mock("../lib/useKnowledgeBaseStarter", () => ({ useKnowledgeBaseStarter: () => vi.fn() }));
vi.mock("./KnowledgeStarter", () => ({ EmptyConversationHint: () => null, buildKnowledgeBaseStarterAttachmentManifest: vi.fn() }));
import KnowledgeConversation from "./KnowledgeConversation";

afterEach(cleanup);
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
  expect(container.querySelectorAll(".execution-divider")).toHaveLength(1);
  expect(container.querySelector(".brand-knowledge-message--assistant .execution-divider")).toBeNull();
});
