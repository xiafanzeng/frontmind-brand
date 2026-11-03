import type { LocalMessage } from "../knowledge-conversation-state";
import type { ExecutionDisplayEntry } from "@frontmind/module-ui/lib/general-execution-display";

/** Local confirmations are identified by the server-owned turn operation. */
export function isLocalKnowledgeConfirmation(message: LocalMessage) {
  return (
    message.role === "user" &&
    message.knowledgeBase?.serverOwned === true &&
    message.knowledgeBase.operationType === "local_confirm"
  );
}

export function knowledgeExecutionItems(
  items: ExecutionDisplayEntry[] | undefined,
  localTurns: ReadonlySet<string>,
) {
  let previousSummary: string | undefined;
  return items
    ?.filter((item) => !localTurns.has(item.turnId))
    .filter((item) => {
      if (item.kind !== "status" || item.status !== "thinking" || !item.publicSummary) return true;
      const key = `${item.turnId}:${item.publicSummaryTitle ?? ""}:${item.publicSummary.trim()}`;
      if (previousSummary === key) return false;
      previousSummary = key;
      return true;
    })
    .map((item) => {
      if (
        item.kind === "status" &&
        item.publicSummary &&
        !/[\u4e00-\u9fff]/u.test(item.publicSummary)
      ) {
        // The execution-side Chinese projection arrives asynchronously. Keep
        // truthful phase/count feedback while that projection is unavailable.
        return { ...item, publicSummary: undefined };
      }
      return item;
    });
}
