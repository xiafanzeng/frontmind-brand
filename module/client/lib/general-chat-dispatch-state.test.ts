import { describe, expect, it } from "vitest";
import type { LocalMessage } from "../conversation-types";
import {
  hasUnresolvedGeneralChatDispatch,
  latestBrowserOwnedUnresolvedGeneralChatDispatch,
  unresolvedGeneralChatDispatchMessages,
} from "./general-chat-dispatch-state";

const pending = (id = "question-1", extra: Partial<LocalMessage> = {}): LocalMessage => ({
  id,
  role: "user",
  content: "问题",
  timestamp: 1,
  generalChatDispatch: {
    schemaVersion: 1,
    kind: "pending_user",
    clientRequestId: id,
    providerPrompt: "问题",
    localAssetIds: [],
    localTaskId: null,
    modelProfile: "frontmind-base",
    purpose: "enterprise_qa",
  },
  ...extra,
});

const final = (userMessageId?: string): LocalMessage => ({
  id: "answer-1",
  role: "assistant",
  content: "回答",
  timestamp: 2,
  generalChat: {
    schemaVersion: 1,
    kind: "assistant_projection",
    isFinalAnswer: true,
    turnId: "turn-1",
    agentTaskId: "task-1",
    providerEventId: "event-1",
    ...(userMessageId ? { userMessageId } : {}),
    serverOwned: true,
  },
});

describe("general chat dispatch state", () => {
  it("treats a matching authoritative final answer as settled", () => {
    expect(unresolvedGeneralChatDispatchMessages([pending(), final("question-1")])).toEqual([]);
    expect(hasUnresolvedGeneralChatDispatch([pending(), final("question-1")])).toBe(false);
  });

  it("supports legacy same-turn projections but not a mismatched bound answer", () => {
    expect(hasUnresolvedGeneralChatDispatch([pending(), final()])).toBe(false);
    expect(hasUnresolvedGeneralChatDispatch([pending(), final("other-question")])).toBe(true);
    expect(hasUnresolvedGeneralChatDispatch([
      pending(),
      { id: "question-2", role: "user", content: "下一问", timestamp: 2 },
      final(),
    ])).toBe(true);
  });

  it("accepts a completed authoritative legacy final when isFinalAnswer was omitted", () => {
    const legacy = final("question-1");
    legacy.generalChat = { ...legacy.generalChat!, isFinalAnswer: undefined };
    expect(hasUnresolvedGeneralChatDispatch([pending(), legacy])).toBe(false);
    legacy.isStepsPlaceholder = true;
    expect(hasUnresolvedGeneralChatDispatch([pending(), legacy])).toBe(true);
  });

  it("keeps malformed and partial turns unresolved", () => {
    const malformed = pending("question-1");
    malformed.generalChatDispatch = { ...malformed.generalChatDispatch!, clientRequestId: "other" };
    const partial = final("question-1");
    partial.generalChat = { ...partial.generalChat!, isFinalAnswer: false };
    expect(unresolvedGeneralChatDispatchMessages([malformed, partial])).toEqual([malformed]);
  });

  it("protects worker-owned queue entries without exposing them to browser retry", () => {
    const worker = pending("worker-question", {
      enterpriseQaFollowup: {
        schemaVersion: 1,
        queueId: "11111111-1111-4111-8111-111111111111",
        serverOwned: true,
      },
    });
    expect(hasUnresolvedGeneralChatDispatch([worker])).toBe(true);
    expect(latestBrowserOwnedUnresolvedGeneralChatDispatch([worker])).toBeUndefined();
    expect(latestBrowserOwnedUnresolvedGeneralChatDispatch([worker, pending("browser-question")])?.id)
      .toBe("browser-question");
  });
});
