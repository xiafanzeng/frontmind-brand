import { describe, expect, it } from "vitest";
import { responseLogicPublicExecution } from "../server/response-logic-public-execution";
import { taskStagePresentation } from "../client/response-logic/task-stage-model";

const event = (
  id: string,
  type: string,
  timestamp: number,
  extra: object = {},
) => ({ id, type, timestamp, ...extra });
describe("public response-logic progress evidence", () => {
  it("redacts tool labels and pairs out-of-order tool results inside the current turn", () => {
    const events = [
      event("u", "user_message", 100),
      event("result", "tool_result", 101, {
        executionActivity: {
          kind: "tool_result",
          callId: "call",
          isError: false,
        },
      }),
      event("call", "tool_use", 102, {
        executionActivity: {
          kind: "tool_use",
          label: "PRIVATE credential",
          toolKind: "custom",
          arguments: { token: "SECRET" },
        },
      }),
    ];
    const value = responseLogicPublicExecution("task", events as never);
    expect(value.timeline).toHaveLength(1);
    expect(value.timeline[0]).toMatchObject({
      kind: "tool",
      status: "completed",
      label: "调用工具",
    });
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SECRET|credential/);
  });
  it("retains reused provider event IDs in the current turn", () => {
    const rows = [
      event("u1", "user_message", 1),
      event("same", "status_update", 2, {
        executionActivity: { kind: "status", status: "ended" },
      }),
      event("u2", "user_message", 3),
      event("same", "status_update", 4, {
        executionActivity: { kind: "status", status: "running" },
      }),
    ];
    const result = responseLogicPublicExecution("task", rows as never);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({
      kind: "status",
      status: "running",
      turnId: "task:u2",
    });
  });
  it("isolates the latest turn, deduplicates events and never exposes private text", () => {
    const events = [
      event("u1", "user_message", 1000),
      event("old", "status_update", 1001, {
        executionActivity: { kind: "status", status: "ended" },
      }),
      event("u2", "user_message", 1002),
      event("run", "status_update", 1003, {
        executionActivity: {
          kind: "status",
          status: "running",
          thinkingText: "PRIVATE",
          publicSummary: "not user copy",
          secret: "KEY",
        },
      }),
    ];
    const value = responseLogicPublicExecution("task", [
      ...events,
      events[3],
    ] as never);
    expect(new Set(value.timeline.map((e) => e.id)).size).toBe(
      value.timeline.length,
    );
    expect(
      value.timeline.some((e) => e.kind === "status" && e.status === "ended"),
    ).toBe(false);
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE|KEY|not user copy/);
    expect(value.coverage).toBe("partial");
    expect(
      taskStagePresentation({
        flow: "judge",
        phase: "running",
        taskId: "task",
        execution: value,
      }).current,
    ).toBe(2);
  });
  it("does not invent intermediate completion or reuse another task", () => {
    const model = taskStagePresentation({
      flow: "optimizer",
      phase: "running",
      taskId: "new",
      execution: {
        schemaVersion: 1,
        taskId: "old",
        coverage: "complete",
        timeline: [],
      },
    });
    expect(model.current).toBe(1);
    expect(model.stages[2].status).toBe("pending");
    expect(model.description).toContain("详细阶段暂不可用");
  });
  it("distinguishes returned result, saving and persisted completion", () => {
    const saving = taskStagePresentation({
      flow: "generation",
      phase: "running",
      taskId: "task",
      adopting: true,
    });
    expect(saving.current).toBe(3);
    expect(saving.stages[3].status).toBe("running");
    const done = taskStagePresentation({
      flow: "generation",
      phase: "completed",
      taskId: "task",
    });
    expect(done.stages.every((s) => s.status === "completed")).toBe(true);
  });
  it("shows unavailable status rather than a failed task after a transport error", () => {
    const model = taskStagePresentation({
      flow: "judge",
      phase: "uncertain",
      taskId: "task",
    });
    expect(model.stages.some((s) => s.status === "failed")).toBe(false);
    expect(model.description).toContain("暂时无法确认");
  });
});
