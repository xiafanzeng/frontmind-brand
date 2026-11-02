import type { LocalMessage } from "../knowledge-conversation-state";
import type { ExecutionDisplayEntry } from "@frontmind/module-ui/lib/general-execution-display";

/** This prefix is the server's durable local-confirm operation contract. */
export function isLocalKnowledgeConfirmation(message: LocalMessage) {
  return (
    message.role === "user" &&
    message.knowledgeBase?.serverOwned === true &&
    message.knowledgeBase.operationKey?.startsWith("kb:confirm:") === true
  );
}

export function knowledgeExecutionItems(
  items: ExecutionDisplayEntry[] | undefined,
  localTurns: ReadonlySet<string>,
) {
  return items
    ?.filter((item) => !localTurns.has(item.turnId))
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
