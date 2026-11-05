/**
 * Generic async-task lifecycle state machine shared by the LLM judge and the
 * LLM optimizer hooks, so both flows have ONE consistent notion of phase,
 * context protection, duplicate-start rejection and stale-result dropping.
 *
 * Every asynchronous completion carries the context key it was started under;
 * the reducer drops results whose context no longer matches, so stale tasks
 * (switched question, advanced revision, edited draft) never pollute the
 * current view.
 */

import type {GeneralExecutionDto} from "@frontmind/module-contracts/execution";
export type TaskPhase = "idle" | "starting" | "running" | "uncertain" | "completed" | "failed";

/**
 * Shared polling budget for async LLM tasks (judge + optimizer).
 *
 * Real frontmind-pro evaluations observed in production run 7-12 minutes,
 * so the previous 100-attempt (~5 min) cap reported spurious timeouts while
 * the upstream task was still executing. 300 attempts × 3s ≈ 15 minutes
 * covers the observed worst case with headroom. On timeout the task may
 * still run in the background: pause with an uncertain state and resume
 * authenticated queries of the same task instead of creating another task.
 */
export const TASK_POLL_INTERVAL_MS = 3000;
export const MAX_TASK_POLL_ATTEMPTS = 300; // ~15 minutes

export type TaskLifecycleState<T> = {
  phase: TaskPhase;
  result: T | null;
  error: string;
  errorCode: string;
  taskId: string | null;
  activeContext: string;
  execution?: GeneralExecutionDto;
};

export type TaskLifecycleEvent<T> =
  | { type: "context-change"; contextKey: string }
  | { type: "start"; contextKey: string }
  | { type: "start-succeeded"; taskId: string; contextKey: string }
  | { type: "start-failed"; message: string; code: string; contextKey: string }
  | { type: "poll-completed"; result: T; contextKey: string }
  | { type: "poll-failed"; message: string; code: string; contextKey: string }
  | { type: "timeout"; contextKey: string }
  | { type: "restore"; taskId: string; contextKey: string }
  | { type: "progress"; execution?: GeneralExecutionDto; contextKey: string }
  | { type: "uncertain"; message: string; code: string; contextKey: string }
  | { type: "reset" };

export function initialTaskLifecycleState<T>(): TaskLifecycleState<T> {
  return { phase: "idle", result: null, error: "", errorCode: "", taskId: null, activeContext: "" };
}

/** True while a start request must not be issued again (task already in flight). */
export function taskStartBlocked(phase: TaskPhase): boolean {
  return phase === "starting" || phase === "running" || phase === "uncertain";
}

export function createTaskLifecycleReducer<T>(options?: { timeoutCode?: string; timeoutMessage?: string }) {
  const initial = initialTaskLifecycleState<T>();
  return function taskLifecycleReducer(
    state: TaskLifecycleState<T>,
    event: TaskLifecycleEvent<T>,
  ): TaskLifecycleState<T> {
    switch (event.type) {
      case "restore":
        if (event.contextKey !== state.activeContext) return state;
        return {...state, phase:"running", taskId:event.taskId, error:"", errorCode:""};
      case "progress":
        if (event.contextKey !== state.activeContext || state.phase === "completed" || state.phase === "failed") return state;
        return {...state, phase:"running", execution:event.execution ?? state.execution, error:"", errorCode:""};
      case "uncertain":
        if (event.contextKey !== state.activeContext) return state;
        return {...state, phase:"uncertain", error:event.message, errorCode:event.code};
      case "context-change":
        if (event.contextKey === state.activeContext) return state;
        return { ...initial, activeContext: event.contextKey };
      case "start":
        if (taskStartBlocked(state.phase)) return state;
        return { ...initial, phase: "starting", activeContext: event.contextKey };
      case "start-succeeded":
        if (event.contextKey !== state.activeContext || state.phase !== "starting") return state;
        return { ...state, phase: "running", taskId: event.taskId };
      case "start-failed":
        if (event.contextKey !== state.activeContext) return state;
        return { ...state, phase: "failed", error: event.message, errorCode: event.code };
      case "poll-completed":
        if (event.contextKey !== state.activeContext) return state;
        return { ...state, phase: "completed", result: event.result, error: "", errorCode: "" };
      case "poll-failed":
        if (event.contextKey !== state.activeContext) return state;
        return { ...state, phase: "failed", error: event.message, errorCode: event.code };
      case "timeout":
        if (event.contextKey !== state.activeContext) return state;
        return { ...state, phase: "uncertain", error: options?.timeoutMessage ?? "暂时无法确认任务状态，请恢复查询", errorCode: options?.timeoutCode ?? "TASK_TIMEOUT" };
      case "reset":
        return { ...initial, activeContext: state.activeContext };
    }
  };
}
