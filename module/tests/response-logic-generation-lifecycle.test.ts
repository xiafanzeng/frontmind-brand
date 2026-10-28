// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * Regression tests for the 2026-10-28 incident (task 712b31c5): the task
 * finished upstream in ~2 minutes but the page kept showing 生成中 for 10+
 * minutes with ZERO status requests reaching the gateway. Root pattern: the
 * polling observer disappears (background-tab timer freeze, stale mount) with
 * no lifecycle hook to re-arm it, and one adopt-path early return could leave
 * the running phase forever. These tests pin the two pure helpers behind the
 * fix; the effect wiring is exercised by the workspace regression suites.
 */

import {
  shouldPokePolling,
  incompleteGenerationContextFailure,
  type ResponseLogicGenerationState,
} from "../client/ResponseLogicWorkspace.js";

const running: ResponseLogicGenerationState = {
  questionId: "q-1",
  scope: "account",
  phase: "running",
  taskId: "task-1",
  conversationId: "conv-1",
  operationRevision: 2,
  startedAt: 1_000,
};

describe("shouldPokePolling (lifecycle event throttle)", () => {
  it("pokes on the first event (page just came alive)", () => {
    expect(shouldPokePolling(0, 5_000)).toBe(true);
  });

  it("coalesces back-to-back events within the window (no duplicate polls)", () => {
    const first = 10_000;
    expect(shouldPokePolling(first, first + 500)).toBe(false);
    expect(shouldPokePolling(first, first + 1_999)).toBe(false);
  });

  it("pokes again after the throttle window (tab returned from background)", () => {
    const first = 10_000;
    expect(shouldPokePolling(first, first + 2_000)).toBe(true);
    expect(shouldPokePolling(first, first + 60_000)).toBe(true);
  });
});

describe("incompleteGenerationContextFailure (terminal fallback)", () => {
  it("ends a running generation with an adoption-only retry instead of an eternal spinner", () => {
    const failure = incompleteGenerationContextFailure(running);
    expect(failure).not.toBeNull();
    expect(failure!.phase).toBe("failed");
    expect(failure!.failure?.retryable).toBe(true);
    expect(failure!.failure?.retryAdoptionOnly).toBe(true);
    expect(failure!.failure?.message).toContain("任务已完成");
    // Identity of the task is preserved so adoption retry targets the same task.
    expect(failure!.taskId).toBe("task-1");
    expect(failure!.operationRevision).toBe(2);
  });

  it("returns null when there is no local generation state to end", () => {
    expect(incompleteGenerationContextFailure(null)).toBeNull();
  });
});
