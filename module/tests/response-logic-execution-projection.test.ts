// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * Regression tests for EXECUTION_PROJECTION_NOT_AVAILABLE_IN_BRAND: the
 * runtime previously bound throwing stubs for the execution projection ports,
 * so GET /response-logic/tasks/:id/status failed with 500 for every running
 * task (the factory's responseLogicPublicExecution calls projectGeneralExecution
 * on every poll). The ports must now be real: vendor-contract helpers plus the
 * verbatim Core pure projection.
 */

import { projectGeneralExecution } from "../server/general-execution-projection.js";
import {
  generalExecutionActivity,
  orderExecutionTimeline,
  projectBusinessExecution,
} from "@frontmind/module-contracts/execution";
import { assembleResponseLogicCore } from "../server/response-logic-runtime.js";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime.js";

registerIntentSkillPorts({} as never);

const turn = (rank: number, extra: Record<string, unknown>) => ({
  taskId: "task-1",
  providerEventId: `1:ev${rank}`,
  providerTimestampMs: 1000 + rank,
  normalizedPayload: {
    kind: "provider_event",
    providerOriginalRank: rank,
    executionTurn: { id: "task-1:1", userSequence: 1 },
    ...extra,
  },
});

describe("projectGeneralExecution (verbatim Core copy)", () => {
  it("returns a pending, empty timeline for no rows", () => {
    const result = projectGeneralExecution("task-1", []);
    expect(result.schemaVersion).toBe(1);
    expect(result.taskId).toBe("task-1");
    expect(result.coverage).toBe("pending");
    expect(result.timeline).toEqual([]);
  });

  it("projects tool call/result pairs and assistant messages with complete coverage", () => {
    const rows = [
      turn(0, { executionActivity: { kind: "tool_use", label: "检索品牌资料", toolKind: "search" } }),
      turn(1, { executionActivity: { kind: "tool_result", callId: "1:ev0", isError: false } }),
      turn(2, { type: "assistant_message", text: "四段结论" }),
      {
        taskId: "task-1",
        providerEventId: "snap",
        providerTimestampMs: 4000,
        normalizedPayload: { kind: "local_projection_snapshot", executionVersion: 1, status: "applied" },
      },
    ];
    const result = projectGeneralExecution("task-1", rows);
    expect(result.coverage).toBe("complete");
    const kinds = result.timeline.map((entry) => entry.kind).sort();
    expect(kinds).toContain("tool");
    expect(kinds).toContain("message");
    const tool = result.timeline.find((entry) => entry.kind === "tool");
    expect(tool && "status" in tool ? tool.status : undefined).toBe("completed");
  });

  it("ignores rows owned by other tasks", () => {
    const rows = [
      { ...turn(0, { type: "assistant_message", text: "他人任务" }), taskId: "other-task" },
    ];
    const result = projectGeneralExecution("task-1", rows);
    expect(result.timeline).toEqual([]);
    expect(result.coverage).toBe("pending");
  });
});

describe("runtime execution ports are real, not stubs", () => {
  it("bound projectGeneralExecution answers instead of throwing", () => {
    const core = assembleResponseLogicCore({ getDb: async () => null });
    expect(() => (core as never as { projectGeneralExecution(t: string, r: unknown[]): unknown })
      .projectGeneralExecution("t", [])).not.toThrow();
    const out = (core as never as { projectGeneralExecution(t: string, r: unknown[]): { schemaVersion: number } })
      .projectGeneralExecution("t", []);
    expect(out.schemaVersion).toBe(1);
  });

  it("vendor contract helpers are functional through the same import Core re-exports", () => {
    expect(typeof generalExecutionActivity).toBe("function");
    expect(orderExecutionTimeline([])).toEqual([]);
    expect(typeof projectBusinessExecution).toBe("function");
  });
});
