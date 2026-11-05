import {
  generalExecutionActivity,
  orderExecutionTimeline,
  type GeneralExecutionDto,
} from "@frontmind/module-contracts/execution";
import { projectGeneralExecution } from "./general-execution-projection.js";
import type {
  ManusV2MessageEvent,
  ResponseLogicApiPorts,
} from "./response-logic-core-ports.js";

/** One current-turn, public projection for all three response-logic flows.
 * No model prose, private reasoning, tool arguments or result payloads cross it.
 * A task with partial evidence must never claim full stage coverage. */
export function responseLogicPublicExecution(
  taskId: string,
  events: readonly ManusV2MessageEvent[],
  order?: ResponseLogicApiPorts["orderManusV2EventsByProviderRank"],
): GeneralExecutionDto {
  const ordered = order
    ? order(events, "oldest_first")
    : [...events].sort((a, b) => a.timestamp - b.timestamp);
  let lastUser = -1;
  ordered.forEach((event, index) => {
    if (event.type === "user_message") lastUser = index;
  });
  const seen = new Set<string>();
  const current = (lastUser < 0 ? ordered : ordered.slice(lastUser)).filter(
    (event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    },
  );
  const turnId = `${taskId}:${lastUser < 0 ? "unbound" : ordered[lastUser]!.id}`;
  const userSequence = new Set(
    ordered
      .filter((event) => event.type === "user_message")
      .map((event) => event.id),
  ).size;
  const rows = current.map((event, rank) => {
    const raw = generalExecutionActivity(event.executionActivity);
    // Even provider-designated public prose is unnecessary for stage display.
    const activity =
      raw?.kind === "status"
        ? { kind: raw.kind, status: raw.status }
        : raw?.kind === "tool_use"
          ? { ...raw, label: "处理任务资料" }
          : raw?.kind === "tool_result" && raw.callId
            ? { ...raw, callId: `${turnId}:${raw.callId}` }
            : raw;
    return {
      taskId,
      providerEventId: `${turnId}:${event.id}`,
      providerTimestampMs: event.timestamp,
      normalizedPayload: {
        kind: "provider_event",
        providerOriginalRank: rank,
        executionTurn: { id: turnId, userSequence },
        executionActivity: activity,
      },
    };
  });
  const execution = projectGeneralExecution(taskId, rows);
  return {
    ...execution,
    coverage: current.length ? "partial" : "unavailable",
    timeline: orderExecutionTimeline(execution.timeline),
  };
}
