import React from "react";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  scope: "brand-composer-test",
  conversation: {
    id: "knowledge-1", title: "知识库", status: "awaiting_input",
    messages: [{id: "node", role: "assistant", content: "企业概况", knowledgeBase: {kind: "presentation", generation: 1, revision: 2, leafId: "identity", presentationKey: "presentation", turnId: "turn"}}],
    knowledgeBase: {generation: 1, stateEpoch: 2, contentVersion: 3, initialized: true, canReply: true, revision: 2, leafId: "identity", presentationKey: "presentation", presentationTurnId: "turn"},
  },
}));
vi.mock("../host", () => ({
  useConversation: () => ({activeConversation: mocks.conversation, workbenchScopeKey: mocks.scope}),
  useWorkspaceDraftGuard: () => {}, captureWorkspaceRestOperation: vi.fn(),
}));
vi.mock("../lib/useKnowledgeComposerSender", () => ({
  useKnowledgeComposerSender: () => ({sendMessage: mocks.send, uploadProgress: null, knowledgeBaseAttachmentAttempt: null}),
}));
import KnowledgeComposer from "./KnowledgeComposer";
beforeEach(() => {mocks.send.mockClear();mocks.scope = crypto.randomUUID();});
afterEach(cleanup);

it("uses the original composer shell, guards IME Enter and sends the same frozen knowledge coordinates", async () => {
  const {container} = render(<KnowledgeComposer knowledgeBaseResetRevision={4} />);
  expect(container.querySelector(".knowledge-composer .agent-composer-textarea")).not.toBeNull();
  expect(container.querySelector(".brand-knowledge-composer")).toBeNull();
  const input = screen.getByRole("textbox");
  fireEvent.change(input, {target: {value: "修改企业概况"}});
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, {key: "Enter", code: "Enter", keyCode: 229, isComposing: true});
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.click(screen.getByRole("button", {name: "发送消息"}));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("修改企业概况", [], expect.objectContaining({syncKnowledgeBaseSnapshot: true, knowledgeBaseExpectedResetRevision: 4, knowledgeBaseExpectedRevision: 2, knowledgeBaseExpectedLeafId: "identity", knowledgeBaseExpectedPresentationKey: "presentation"})));
});

it("retains task drafts and dropped attachments across remounts instead of resetting a raw file input", async () => {
  const first = render(<KnowledgeComposer composerScope="node-identity" />);
  fireEvent.change(screen.getByRole("textbox"), {target: {value: "补充说明"}});
  const file = new File(["image"], "企业图片.png", {type: "image/png"});
  fireEvent.drop(first.container.querySelector(".knowledge-composer")!, {dataTransfer: {files: [file]}});
  await waitFor(() => expect(screen.getByText("企业图片.png")).toBeDefined());
  first.unmount();
  render(<KnowledgeComposer composerScope="node-identity" />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("补充说明");
  expect(screen.getByText("企业图片.png")).toBeDefined();
  fireEvent.click(screen.getByRole("button", {name: "发送消息"}));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("补充说明", [file], expect.any(Object)));
});
