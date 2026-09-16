import {describe,it,expect,vi} from 'vitest';
import {knowledgeBaseUserMessagePublicId} from '../contracts/knowledge-base-message';
import {mergeServerOwnedKnowledgeBaseMessages,mergeKnowledgeBaseHydration,currentKnowledgeBaseReplySnapshot,applyKnowledgeBaseObservation,type Conversation} from './knowledge-conversation-state';
describe("knowledge-base attachment payload reconciliation", () => {
  function pendingUserMessage(input: {
    id: string;
    serverOwned: boolean;
    attachments?: Conversation["messages"][number]["attachments"];
  }): Conversation["messages"][number] {
    return {
      id: input.id,
      role: "user",
      content: "上传资料",
      timestamp: input.serverOwned ? 2 : 1,
      attachments: input.attachments,
      knowledgeBase: {
        kind: "pending_user",
        clientRequestId: "request-attachment",
        ...(input.serverOwned
          ? { turnId: "turn-attachment", serverOwned: true }
          : { serverOwned: false }),
      },
    };
  }

  it("reattaches browser bytes only for an exact opaque fileId match", () => {
    const localFile = new File(["local"], "same.pdf", {
      type: "application/pdf",
    });
    const [merged] = mergeServerOwnedKnowledgeBaseMessages(
      [
        pendingUserMessage({
          id: "optimistic",
          serverOwned: false,
          attachments: [
            {
              id: "optimistic-attachment",
              type: "file",
              name: "same.pdf",
              fileId: " folder/%2F?# ",
              file: localFile,
              blobUrl: "blob:exact",
            },
          ],
        }),
      ],
      [
        pendingUserMessage({
          id: "canonical",
          serverOwned: true,
          attachments: [
            {
              id: "canonical-attachment",
              type: "file",
              name: "server-name.pdf",
              fileId: " folder/%2F?# ",
            },
          ],
        }),
      ],
    );

    expect(merged.attachments?.[0]).toMatchObject({
      id: "canonical-attachment",
      fileId: " folder/%2F?# ",
      file: localFile,
      blobUrl: "blob:exact",
    });
  });

  it("never copies payloads when the authoritative attachment is absent or has no exact fileId", () => {
    const localFile = new File(["local"], "same.pdf", {
      type: "application/pdf",
    });
    const optimistic = pendingUserMessage({
      id: "optimistic",
      serverOwned: false,
      attachments: [
        {
          id: "same-id",
          type: "file",
          name: "same.pdf",
          fileId: "local-file-id",
          file: localFile,
          blobUrl: "blob:wrong",
        },
      ],
    });

    const [withoutAttachments] = mergeServerOwnedKnowledgeBaseMessages(
      [optimistic],
      [pendingUserMessage({ id: "canonical-empty", serverOwned: true })],
    );
    expect(withoutAttachments.attachments).toBeUndefined();

    const [withoutFileId] = mergeServerOwnedKnowledgeBaseMessages(
      [optimistic],
      [
        pendingUserMessage({
          id: "canonical-no-file-id",
          serverOwned: true,
          attachments: [{ id: "same-id", type: "file", name: "same.pdf" }],
        }),
      ],
    );
    expect(withoutFileId.attachments?.[0]?.file).toBeUndefined();
    expect(withoutFileId.attachments?.[0]?.blobUrl).toBeUndefined();

    const [differentFileId] = mergeServerOwnedKnowledgeBaseMessages(
      [optimistic],
      [
        pendingUserMessage({
          id: "canonical-other-file",
          serverOwned: true,
          attachments: [
            {
              id: "same-id",
              type: "file",
              name: "same.pdf",
              fileId: "different-file-id",
            },
          ],
        }),
      ],
    );
    expect(differentFileId.attachments?.[0]?.file).toBeUndefined();
    expect(differentFileId.attachments?.[0]?.blobUrl).toBeUndefined();
  });
});

function conversation(id: string): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    messages: [],
    status: "idle",
    createdAt: 100,
    updatedAt: 200,
  };
}

describe("knowledge-base reply snapshots", () => {
  it("returns all reply coordinates from one rendered presentation", () => {
    const value: Conversation = {
      ...conversation("reply-snapshot"),
      status: "awaiting_input",
      messages: [
        {
          id: "presentation",
          role: "assistant",
          content: "## 当前节点\n正文",
          timestamp: 1,
          knowledgeBase: {
            kind: "presentation",
            turnId: "turn-7",
            presentationKey: "presentation-7",
            generation: 3,
            revision: 7,
            leafId: "1.8",
            serverOwned: true,
          },
        },
      ],
      knowledgeBase: {
        initialized: true,
        generation: 3,
        stateEpoch: 9,
        activeTurnId: null,
        activeClientRequestId: null,
        presentationTurnId: "turn-7",
        interactionState: "awaiting_input",
        canReply: true,
        presentationKey: "presentation-7",
        revision: 7,
        leafId: "1.8",
        notice: null,
      },
    };
    expect(currentKnowledgeBaseReplySnapshot(value)).toEqual({
      generation: 3,
      stateEpoch: 9,
      revision: 7,
      contentVersion: 0,
      leafId: "1.8",
      presentationKey: "presentation-7",
      presentationTurnId: "turn-7",
    });
  });

  it("clears stale task pointers when the authoritative id is explicitly null", () => {
    const next = applyKnowledgeBaseObservation(
      {
        ...conversation("released-kb-task"),
        taskId: "stale-task",
        previousResponseId: "stale-task",
      },
      {
        generation: 1,
        stateEpoch: 1,
        authoritativeTaskId: null,
        activeTurn: null,
        completedTurn: null,
        approvedPresentation: null,
        progress: null,
        notice: null,
        interaction: {
          interactionState: "executing",
          canReply: false,
          canPublish: false,
          lockReason: "任务仍在执行",
          progress: null,
        },
      } as any,
    );
    expect(next.taskId).toBeUndefined();
    expect(next.previousResponseId).toBeUndefined();
  });

  it("commits the server-owned pre-create business projection without inferring from the notice", () => {
    const progress = {
      build: { id: "build-precreate", revision: 0, currentLeafId: null },
      contentAvailability: "none",
      operationState: "reset_required",
      resetAllowed: true,
      taskCreationState: "not_attempted",
      failureStage: "provider_file_registration",
      retainedCustomerAttachmentCount: 9,
      generatedSystemAttachmentCount: 2,
      settledAt: 1_787_000_000_000,
    } as any;
    const next = applyKnowledgeBaseObservation(
      conversation("precreate-failure"),
      {
        generation: 1,
        stateEpoch: 2,
        authoritativeTaskId: null,
        activeTurn: null,
        completedTurn: null,
        approvedPresentation: null,
        progress,
        notice: {
          key: "safe-notice",
          code: "RESET_REQUIRED",
          severity: "warning",
          message: "请申请重置",
          retryable: false,
          recoveryAction: "approve_reset",
          attachmentCount: 11,
          turnId: "turn-precreate",
          createdAt: 1,
        },
        interaction: {
          interactionState: "failed",
          canReply: false,
          canPublish: false,
          lockReason: "RESET_REQUIRED",
          progress,
        },
      } as any,
    );

    expect(next.knowledgeBase).toMatchObject({
      contentAvailability: "none",
      operationState: "reset_required",
      resetAllowed: true,
      taskCreationState: "not_attempted",
      failureStage: "provider_file_registration",
      retainedCustomerAttachmentCount: 9,
      generatedSystemAttachmentCount: 2,
      settledAt: 1_787_000_000_000,
    });
    expect(next.knowledgeBase?.notice?.severity).toBe("warning");
    expect(next.knowledgeBase?.notice?.attachmentCount).toBe(11);
  });

  it("applies an equivalent observation to repair optimistic running state", () => {
    const progress = {
      build: {
        id: "build-1",
        revision: 1,
        currentLeafId: "1.2",
      },
    } as any;
    const next = applyKnowledgeBaseObservation(
      {
        ...conversation("equivalent-observation"),
        status: "running",
        messages: [
          {
            id: "optimistic-confirmation",
            role: "user",
            content: "确认",
            timestamp: 1,
            knowledgeBase: {
              kind: "pending_user",
              clientRequestId: "request-confirm",
              serverOwned: false,
            },
          },
        ],
        knowledgeBase: {
          initialized: true,
          generation: 2,
          stateEpoch: 9,
          activeTurnId: null,
          activeClientRequestId: null,
          interactionState: "executing",
          canReply: false,
          presentationKey: "a".repeat(64),
          presentationTurnId: null,
          revision: 1,
          leafId: "1.2",
          notice: null,
        },
      },
      {
        generation: 2,
        stateEpoch: 9,
        authoritativeTaskId: "task-completed",
        activeTurn: null,
        completedTurn: null,
        progress,
        approvedPresentation: {
          turnId: "turn-confirm",
          clientRequestId: "request-confirm",
          presentationKey: "a".repeat(64),
          revision: 1,
          leafId: "1.2",
          visibleMarkdown: "## 当前节点\n已批准正文",
          contentSha256: "a".repeat(64),
          imageState: "attached",
          resources: [],
        },
        notice: null,
        interaction: {
          interactionState: "awaiting_input",
          canReply: true,
          canPublish: false,
          lockReason: null,
          progress,
        },
      } as any,
    );

    expect(next.status).toBe("awaiting_input");
    expect(next.knowledgeBase).toMatchObject({
      generation: 2,
      stateEpoch: 9,
      interactionState: "awaiting_input",
      canReply: true,
    });
    expect(next.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("turn-confirm"),
          knowledgeBase: expect.objectContaining({
            turnId: "turn-confirm",
            serverOwned: true,
          }),
        }),
        expect.objectContaining({
          role: "assistant",
          content: "## 当前节点\n已批准正文",
        }),
      ]),
    );
  });
});
