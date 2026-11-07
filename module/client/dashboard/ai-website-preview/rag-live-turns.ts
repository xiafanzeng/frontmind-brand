import type { Conversation } from "../../conversation-types";
import { finalReplyIds } from "../../lib/final-reply";
import type { RagChatTurn } from "./RagChat";

export type RagLiveTurn = RagChatTurn & {
  questionId: string;
  taskId?: string;
  turnId?: string;
};

const PLAUSIBLE_EPOCH_SECONDS_MIN = 1_000_000_000;
const EPOCH_MILLISECONDS_CUTOFF = 100_000_000_000;

/** Read-only compatibility for older website-assistant timestamps stored in seconds. */
export function normalizeRagEpochMilliseconds(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value >= PLAUSIBLE_EPOCH_SECONDS_MIN && value < EPOCH_MILLISECONDS_CUTOFF
    ? value * 1000
    : value;
}

/** Keep the final message's own authority; never borrow the conversation's latest task. */
export function ragLiveTurns(conversation: Conversation | null | undefined, running = false): RagLiveTurn[] {
  if (!conversation) return [];
  const messages = conversation.messages;
  const finalIds = finalReplyIds(messages, conversation.execution, running);
  return messages.flatMap((question, index) => {
    if (question.role !== "user" || !question.content.trim()) return [];
    const next = messages.findIndex((item, position) => position > index && item.role === "user");
    const answer = messages.slice(index + 1, next < 0 ? undefined : next).findLast(item =>
      item.role === "assistant" && finalIds.has(item.id) && !item.isStepsPlaceholder && Boolean(item.content.trim()) &&
      (!item.generalChat?.userMessageId || item.generalChat.userMessageId === question.id) &&
      (!item.enterpriseQaLocalReply?.userMessageId || item.enterpriseQaLocalReply.userMessageId === question.id));
    const taskId = answer?.generalChat?.agentTaskId;
    const turnId = answer?.enterpriseQaLocalReply?.turnId ?? answer?.generalChat?.turnId;
    return [{ id: question.id, questionId: question.id, question: question.content, answer: answer?.content ?? "",
      answerId: answer?.id, answerKey: JSON.stringify([conversation.id, taskId, turnId, answer?.id ?? question.id]),
      evaluation: answer?.enterpriseQaLocalReply?.evaluation,
      knowledgeBase: answer?.enterpriseQaLocalReply?.knowledgeBase,
      taskId, turnId, coordinate: taskId && turnId ? { sourceQaTaskId: taskId, turnId } : undefined,
      sources: answer?.enterpriseQaAnswer?.sources ?? [], completedAt: normalizeRagEpochMilliseconds(answer?.timestamp) }];
  });
}
