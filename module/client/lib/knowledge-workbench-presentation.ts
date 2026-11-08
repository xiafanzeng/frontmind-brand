import type { ExecutionTurnState, GeneralExecutionEntry } from "@frontmind/module-contracts/execution";

/** One visibility contract for the trace and its exports.
 * An operation description or a lifecycle event is not a detailed public record. */
export function isKnowledgeDetailedRecord<T extends GeneralExecutionEntry>(entry: T): entry is Extract<T, {kind: "status"}> & {publicSummary: string} {
  return entry.kind === "status" && entry.publicSummaryKind !== "operation" && Boolean(entry.publicSummary?.trim());
}

/** State freshness is business-owned; event arrival order cannot settle a run. */
export function newerKnowledgeAuthority(current: ExecutionTurnState | undefined, incoming: ExecutionTurnState | undefined) {
  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming.buildId !== current.buildId) return incoming;
  if (incoming.generation !== current.generation) return incoming.generation > current.generation ? incoming : current;
  if (incoming.stateEpoch !== current.stateEpoch) return incoming.stateEpoch > current.stateEpoch ? incoming : current;
  return incoming.observedAt >= current.observedAt ? incoming : current;
}

export function knowledgeTurnStateLabel(authority?: ExecutionTurnState) {
  if (!authority || authority.state === "unknown") return "正在同步状态";
  if (authority.state === "completed") return authority.phase === "knowledge_published" ? "已发布" : authority.phase === "awaiting_knowledge_review" ? "待确认" : "已保存";
  return ({ running: "进行中", waiting: "等待处理", failed: "需要处理", cancelled: "已停止" })[authority.state];
}
