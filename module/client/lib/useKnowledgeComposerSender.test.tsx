import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  refs: new Map<string, {current: unknown}>(),
  submit: vi.fn(), create: vi.fn(), cancel: vi.fn(), resume: vi.fn(async () => {}),
  flush: vi.fn(async () => true), add: vi.fn(), observe: vi.fn(), wake: vi.fn(), rollback: vi.fn(),
  conversation: {id: "knowledge", messages: [] as Array<{knowledgeBase?: {clientRequestId?: string}}>},
  snapshot: {generation: 2, stateEpoch: 3, contentVersion: 4, revision: 5, leafId: "identity", presentationKey: "presentation", presentationTurnId: "turn-original"},
}));
vi.mock("../host", () => ({
  useConversation: () => ({activeConversation: state.conversation, workbenchScopeKey: "workspace", flushConversation: state.flush, registerKnowledgeBaseConversation: vi.fn(), addMessage: state.add, commitKnowledgeBaseObservation: state.observe, wakeKnowledgeBaseConversation: state.wake, rollbackPendingKnowledgeBaseTurn: state.rollback}),
  useRuntimeContext: () => ({workspaceId: "workspace", accountId: 1}),
  captureWorkspaceRestOperation: () => ({signal: new AbortController().signal, assertActive() {}}),
}));
vi.mock("../knowledge-conversation-state", () => ({currentKnowledgeBaseReplySnapshot: () => state.snapshot}));
vi.mock("../components/KnowledgeStarter", () => ({buildKnowledgeBaseStarterAttachmentManifest: async (files: File[], ids: string[]) => files.map((file,index) => ({itemId: ids[index], ordinal: index+1, total: files.length, filename: file.name, sizeBytes: file.size, mimeType: file.type, lastModified: file.lastModified}))}));
vi.mock("./frontmind-api", () => ({createKnowledgeBaseTurnTask: state.create, cancelKnowledgeBaseTurnAttachments: state.cancel}));
vi.mock("./knowledge-base-upload-manager", async () => {
  const { useState } = await import("react");
  const batch = {
    ref(key: string, value: unknown) {if (!state.refs.has(key)) state.refs.set(key,{current: value});return state.refs.get(key);},
    beginAttempt() {const controller = new AbortController();return {controller, operation: {signal: controller.signal, assertActive() {}}};},
    finishAttempt: vi.fn(), submit: state.submit, resume: state.resume, stop: vi.fn(),
  };
  return {useKnowledgeBaseUploadBatch: () => batch, useKnowledgeBaseUploadField: (_batch: unknown,_key: string,value: unknown) => useState(value)};
});
import { useKnowledgeComposerSender } from "./useKnowledgeComposerSender";
beforeEach(() => {
  vi.clearAllMocks();state.refs.clear();state.conversation.messages = [];state.flush.mockResolvedValue(true);
  state.add.mockImplementation((_id,message) => state.conversation.messages.push(message));
});
afterEach(cleanup);

it("retries uncertain text acceptance with one request id and the original revision coordinates", async () => {
  state.create.mockRejectedValueOnce(new Error("response interrupted")).mockResolvedValueOnce({status: "running", id: "task", knowledgeObservation: {source: "accepted"}});
  const hook = renderHook(() => useKnowledgeComposerSender(6));
  let accepted: boolean | undefined;
  await act(async () => {accepted = await hook.result.current.sendMessage("确认", [], {syncKnowledgeBaseSnapshot: true});});
  expect(accepted).toBe(false);
  await act(async () => {accepted = await hook.result.current.sendMessage("确认", [], {syncKnowledgeBaseSnapshot: true});});
  expect(accepted).toBe(true);
  const first = state.create.mock.calls[0][1], second = state.create.mock.calls[1][1];
  expect(second).toEqual(first);
  expect(first).toMatchObject({conversationId: "knowledge", expectedResetRevision: 6, expectedGeneration: 2, expectedRevision: 5, expectedStateEpoch: 3, expectedContentVersion: 4, expectedLeafId: "identity", expectedPresentationKey: "presentation"});
  expect(state.add).toHaveBeenCalledTimes(1);
  expect(state.observe).toHaveBeenCalledWith("knowledge", {source: "accepted"});
});

it("resumes the same retained files, manifest and turn after an upload interruption", async () => {
  state.submit.mockImplementationOnce(async command => {command.onReservation({reservation: {turnId: "turn-upload"}});throw new Error("upload interrupted");}).mockResolvedValueOnce({response: {status: "running", id: "task"}});
  const hook = renderHook(() => useKnowledgeComposerSender(6));
  const file = new File(["image"], "image.png", {type: "image/png"});
  await act(async () => {await hook.result.current.sendMessage("补充图片", [file], {syncKnowledgeBaseSnapshot: true});});
  expect(hook.result.current.knowledgeBaseAttachmentAttempt?.phase).toBe("failed_retryable");
  await act(async () => {await hook.result.current.continueKnowledgeBaseAttachmentAttempt();});
  expect(state.resume).toHaveBeenCalledOnce();
  expect(state.submit.mock.calls[1][0]).toMatchObject({clientRequestId: state.submit.mock.calls[0][0].clientRequestId, turnId: "turn-upload", manifest: state.submit.mock.calls[0][0].manifest, files: state.submit.mock.calls[0][0].files});
  expect(hook.result.current.knowledgeBaseAttachmentAttempt).toBeNull();
});

it("does not dispatch before the original task has been persisted", async () => {
  state.flush.mockResolvedValue(false);
  const hook = renderHook(() => useKnowledgeComposerSender(6));
  await act(async () => {expect(await hook.result.current.sendMessage("确认", [], {syncKnowledgeBaseSnapshot: true})).toBe(false);});
  expect(state.create).not.toHaveBeenCalled();expect(state.submit).not.toHaveBeenCalled();
});
