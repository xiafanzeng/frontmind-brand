import type {Conversation,LocalMessage} from "../conversation";
import type {ChatSubmission} from "./chat-submission";
import {executionTimelineTiming,type ExecutionTiming} from "@frontmind/module-ui/lib/execution-duration";
export {executionTimelineTiming,type ExecutionTiming} from "@frontmind/module-ui/lib/execution-duration";
const validTime = (value: number | undefined): value is number =>
  value !== undefined &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 8.64e15;

/** Each user turn owns its own duration, including turns without provider events yet. */
export function conversationExecutionTimings(
  conversation: Conversation,
  messages: readonly LocalMessage[],
  submission?: ChatSubmission,
) {
  const result = new Map<string, ExecutionTiming>();
  // A new upload can be temporarily hidden from the transcript. It still owns
  // the active run; the last visible historical request must remain stopped.
  const latestUser = conversation.messages.findLast((message) => message.role === "user");
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user") continue;
    const current = message.id === (submission?.messageId ?? latestUser?.id);
    const submitting = message.id === submission?.messageId ? submission : undefined;
    const active =
      current && (submitting ? submitting.phase !== "failed" : ["running", "pending"].includes(conversation.status));
    const turnId = message.knowledgeBase?.turnId ?? message.generalChat?.turnId;
    const entries = (conversation.execution?.timeline ?? []).filter(
      (entry) =>
        entry.userMessageId === message.id ||
        (message.serverSequence !== undefined &&
          entry.userSequence === message.serverSequence) ||
        (turnId !== undefined && entry.turnId === turnId),
    );
    const timing = executionTimelineTiming(entries, active);
    if (timing) {
      result.set(message.id, {
        ...timing,
        startedAt: validTime(message.responseStartedAt) ? Math.min(message.responseStartedAt, timing.startedAt) : timing.startedAt,
        ...(submitting?.completedAt !== undefined ? { completedAt: submitting.completedAt } : {}),
      });
      continue;
    }
    const following = messages.slice(index + 1);
    const nextUser = following.findIndex((item) => item.role === "user");
    const replies = nextUser < 0 ? following : following.slice(0, nextUser);
    const reply = replies.findLast(
      (item) => item.role === "assistant" && !item.isStepsPlaceholder,
    );
    const startedAt =
      submitting?.startedAt ?? (validTime(message.responseStartedAt) ? message.responseStartedAt : current &&
      validTime(conversation.startedAt) &&
      conversation.startedAt >= message.timestamp
        ? conversation.startedAt
        : message.timestamp);
    const completedAt =
      submitting?.completedAt ?? (reply?.elapsedTime !== undefined
        ? (reply.responseStartedAt ?? startedAt) + reply.elapsedTime * 1000
        : current
          ? conversation.completedAt
          : undefined);
    if (validTime(startedAt) && (active || validTime(completedAt)))
      result.set(message.id, { startedAt, completedAt, active });
  }
  return result;
}
