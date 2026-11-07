import type { LocalMessage } from "../conversation-types";

function isAuthoritativeFinalAnswer(message: LocalMessage) {
  return message.role === "assistant" &&
    message.generalChat?.schemaVersion === 1 &&
    message.generalChat.kind === "assistant_projection" &&
    message.generalChat.serverOwned === true &&
    // Core historically omitted the scalar on completed final projections.
    // An explicit false remains authoritative for intermediate events.
    message.generalChat.isFinalAnswer !== false &&
    !message.isStepsPlaceholder &&
    Boolean(message.content.trim());
}

/**
 * A browser dispatch marker is only pending until the same user turn has a
 * server-owned final answer. Older website-assistant snapshots kept the
 * marker after completion, so marker presence alone is not a safe retry or
 * deletion fence.
 */
export function unresolvedGeneralChatDispatchMessages(
  messages: readonly LocalMessage[],
): LocalMessage[] {
  return messages.filter((message, index) => {
    const dispatch = message.role === "user" ? message.generalChatDispatch : undefined;
    if (!dispatch) return false;
    // A malformed or cross-message marker is never treated as settled.
    if (dispatch.clientRequestId !== message.id) return true;

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor]!;
      if (candidate.role === "user") break;
      if (!isAuthoritativeFinalAnswer(candidate)) continue;
      const boundUserMessageId = candidate.generalChat?.userMessageId;
      if (typeof boundUserMessageId === "string") {
        if (boundUserMessageId === message.id) return false;
        continue;
      }
      // Legacy assistant projections did not expose userMessageId. Ordered
      // messages still provide a safe same-turn boundary: stop at the next
      // user message and accept only a server-owned final answer inside it.
      return false;
    }
    return true;
  });
}

export function hasUnresolvedGeneralChatDispatch(
  messages: readonly LocalMessage[],
) {
  return unresolvedGeneralChatDispatchMessages(messages).length > 0;
}

/** Worker-owned followups are durable and must not be retried by a browser. */
export function latestBrowserOwnedUnresolvedGeneralChatDispatch(
  messages: readonly LocalMessage[],
) {
  return unresolvedGeneralChatDispatchMessages(messages).findLast(
    message => !message.enterpriseQaFollowup?.serverOwned,
  );
}
