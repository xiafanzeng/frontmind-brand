export const conversationDeleteFailureReasons = [
  "active_turn",
  "unanswered_dispatch",
  "pending_followup",
  "protected_resource",
  "sync_failed",
  "network_error",
  "unknown",
] as const;

export type ConversationDeleteFailureReason = typeof conversationDeleteFailureReasons[number];
export type ConversationDeleteResult =
  | { ok: true }
  | { ok: false; reason: ConversationDeleteFailureReason; message: string };

export function isConversationDeleteResult(value: unknown): value is ConversationDeleteResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; reason?: unknown; message?: unknown };
  if (candidate.ok === true) return true;
  return candidate.ok === false &&
    typeof candidate.reason === "string" &&
    conversationDeleteFailureReasons.includes(candidate.reason as ConversationDeleteFailureReason) &&
    typeof candidate.message === "string" && candidate.message.length > 0;
}
