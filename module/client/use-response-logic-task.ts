import { useCallback, useEffect, useReducer, useRef } from "react";
import { canRetryJudgeFailure } from "../contracts/response-logic-judge-failure.js";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import {
  createTaskLifecycleReducer,
  initialTaskLifecycleState,
  taskStartBlocked,
  MAX_TASK_POLL_ATTEMPTS,
  TASK_POLL_INTERVAL_MS,
} from "./task-lifecycle.js";

type Pointer = { taskId: string; attempt: number };
type RecoveryHint = Pointer | { creationUnconfirmed: true };
type RecoveryResult =
  | ({ status: "found" } & Pointer)
  | { status: "none" }
  | { status: "unavailable"; reason: string };
/** Opaque lookup hint, never an authorization token; no draft or question text is stored. */
export function responseLogicRecoveryKey(flow: string, context: string) {
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < context.length; i++) {
    a = Math.imul(a ^ context.charCodeAt(i), 16777619);
    b = Math.imul(b ^ context.charCodeAt(i), 2246822519);
  }
  return `frontmind:response-logic:${flow}:${context.length}:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
function readPointer(key: string): RecoveryHint | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (x?.creationUnconfirmed === true) return { creationUnconfirmed: true };
    return x &&
      typeof x.taskId === "string" &&
      x.taskId.length > 0 &&
      x.taskId.length <= 255 &&
      Number.isSafeInteger(x.attempt) &&
      x.attempt >= 0
      ? { taskId: x.taskId, attempt: x.attempt }
      : null;
  } catch {
    return null;
  }
}
function savePointer(key: string, pointer: RecoveryHint | null) {
  try {
    if (pointer) sessionStorage.setItem(key, JSON.stringify(pointer));
    else sessionStorage.removeItem(key);
  } catch {
    /* Recovery hints are optional; live polling still works. */
  }
}
export function uncertainTaskError(error: unknown) {
  const e = error as { status?: number; code?: string };
  return (
    e?.status === 0 ||
    e?.status === 408 ||
    e?.status === 429 ||
    (e?.status ?? 0) >= 500 ||
    /TRANSPORT|TIMEOUT|RESPONSE_INVALID|OUTCOME_UNKNOWN/.test(e?.code ?? "") ||
    !(typeof e?.status === "number")
  );
}
const delay = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, TASK_POLL_INTERVAL_MS);
    signal.addEventListener("abort", done, { once: true });
  });

/** Uses the existing task lifecycle. Recovery only GETs an authenticated task;
 * completion is never trusted from browser storage. Focus/online resumes queries. */
export function useResponseLogicTask<T>(options: {
  flow: "judge" | "optimizer" | "regeneration";
  contextKey: string;
  enabled?: boolean;
  canRetryFailure?: (code?: string) => boolean;
  allowRestartCompleted?: boolean;
  recover?: (signal: AbortSignal) => Promise<RecoveryResult>;
  start: (retry?: Pointer, signal?: AbortSignal) => Promise<Pointer>;
  poll: (
    taskId: string,
    signal: AbortSignal,
    attempt?: number,
  ) => Promise<
    | { status: "running"; execution?: GeneralExecutionDto }
    | { status: "completed"; result: T; execution?: GeneralExecutionDto }
  >;
}) {
  const [state, dispatch] = useReducer(
    createTaskLifecycleReducer<T>({
      timeoutCode:
        options.flow === "judge" ? "JUDGE_TIMEOUT" : options.flow === "regeneration" ? "REGENERATION_TIMEOUT" : "OPTIMIZATION_TIMEOUT",
      timeoutMessage:
        "等待查询超时，任务可能仍在后台运行。请恢复查询，不会重新创建任务。",
    }),
    initialTaskLifecycleState<T>(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<AbortController | null>(null);
  const pointerRef = useRef<Pointer | null>(null);
  const contextRef = useRef(options.contextKey);
  contextRef.current = options.contextKey;
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  const serial = useRef(0);
  const recoveryRef = useRef<Promise<void> | null>(null);
  const cacheKey = responseLogicRecoveryKey(options.flow, options.contextKey);
  const query = useCallback((pointer: Pointer, immediate = true) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = optionsRef.current,
      context = current.contextKey;
    dispatch({ type: "restore", taskId: pointer.taskId, contextKey: context });
    phaseRef.current = "running";
    void (async () => {
      for (let count = 0; count < MAX_TASK_POLL_ATTEMPTS; count++) {
        if (!immediate || count > 0) await delay(controller.signal);
        if (controller.signal.aborted || contextRef.current !== context) return;
        try {
          const result = await (current.flow === "regeneration"
            ? current.poll(pointer.taskId, controller.signal, pointer.attempt)
            : current.poll(pointer.taskId, controller.signal));
          if (controller.signal.aborted || contextRef.current !== context)
            return;
          dispatch({
            type: "progress",
            execution: result.execution,
            contextKey: context,
          });
          if (result.status === "completed") {
            phaseRef.current = "completed";
            dispatch({
              type: "poll-completed",
              result: result.result,
              contextKey: context,
            });
            return;
          }
        } catch (error) {
          if (controller.signal.aborted || contextRef.current !== context)
            return;
          const e = error as {
            message?: string;
            code?: string;
            status?: number;
          };
          if (uncertainTaskError(error)) {
            phaseRef.current = "uncertain";
            dispatch({
              type: "uncertain",
              message: "暂时无法确认任务状态，正在重试查询；不会重新创建任务。",
              code: e.code ?? "TASK_STATUS_UNAVAILABLE",
              contextKey: context,
            });
            continue;
          }
          phaseRef.current = "failed";
          // A forbidden/stale pointer must never be automatically restored again.
          if (
            [401, 403, 404, 409, 422].includes(e.status ?? 0) &&
            !/_TASK_FAILED$/.test(e.code ?? "") &&
            !(current.flow === "judge" && canRetryJudgeFailure(e.code)) && !current.canRetryFailure?.(e.code)
          )
            savePointer(responseLogicRecoveryKey(current.flow, context), null);
          dispatch({
            type: "poll-failed",
            message: e.message ?? "任务未完成",
            code: e.code ?? "TASK_FAILED",
            contextKey: context,
          });
          return;
        }
      }
      if (!controller.signal.aborted) {
        phaseRef.current = "uncertain";
        dispatch({ type: "timeout", contextKey: context });
      }
    })();
  }, []);
  const discover = useCallback(() => {
    if (recoveryRef.current) return recoveryRef.current;
    const current = optionsRef.current;
    if (!current.recover || current.enabled === false) return Promise.resolve();
    const context = current.contextKey,
      key = responseLogicRecoveryKey(current.flow, context);
    const saved = readPointer(key),
      unconfirmed = !!saved && "creationUnconfirmed" in saved;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    phaseRef.current = "uncertain";
    dispatch({
      type: "uncertain",
      message: "正在查询已有任务，不会创建新任务。",
      code: "TASK_RECOVERING",
      contextKey: context,
    });
    const pending = (async () => {
      try {
        const result = await current.recover!(controller.signal);
        if (controller.signal.aborted || contextRef.current !== context) return;
        if (result.status === "found") {
          const pointer = { taskId: result.taskId, attempt: result.attempt };
          pointerRef.current = pointer;
          savePointer(key, pointer);
          query(pointer);
          return;
        }
        if (
          unconfirmed ||
          (result.status === "unavailable" &&
            result.reason === "binding_pending")
        ) {
          savePointer(key, { creationUnconfirmed: true });
          dispatch({
            type: "uncertain",
            message: "尚未查到可确认的任务，请稍后恢复查询；不会自动重新提交。",
            code: "TASK_START_OUTCOME_UNKNOWN",
            contextKey: context,
          });
          return;
        }
        phaseRef.current = "idle";
        dispatch({ type: "reset" });
      } catch (error) {
        if (controller.signal.aborted || contextRef.current !== context) return;
        const e = error as { message?: string; code?: string };
        const uncertain = uncertainTaskError(error);
        phaseRef.current = uncertain ? "uncertain" : "failed";
        dispatch({
          type: uncertain ? "uncertain" : "poll-failed",
          message: uncertain
            ? "暂时无法查询已有任务，请恢复查询。"
            : (e.message ?? "任务恢复失败"),
          code: e.code ?? "TASK_RECOVERY_FAILED",
          contextKey: context,
        });
      }
    })();
    recoveryRef.current = pending;
    void pending.finally(() => {
      if (recoveryRef.current === pending) recoveryRef.current = null;
    });
    return pending;
  }, [query]);
  const resume = useCallback(() => {
    if (pointerRef.current) query(pointerRef.current);
    else void discover();
  }, [query, discover]);
  useEffect(() => {
    serial.current++;
    controllerRef.current?.abort();
    recoveryRef.current = null;
    pointerRef.current = null;
    phaseRef.current = "idle";
    dispatch({ type: "context-change", contextKey: options.contextKey });
    if (options.enabled !== false) {
      const saved = readPointer(cacheKey);
      if (saved && !("creationUnconfirmed" in saved)) {
        pointerRef.current = saved;
        query(saved);
      } else if (optionsRef.current.recover) {
        void discover();
      } else if (saved) {
        phaseRef.current = "uncertain";
        dispatch({
          type: "uncertain",
          message: "上次任务创建结果尚未确认，请先核查任务状态，避免重复提交。",
          code: "TASK_START_OUTCOME_UNKNOWN",
          contextKey: options.contextKey,
        });
      }
    }
    return () => {
      serial.current++;
      controllerRef.current?.abort();
    };
  }, [cacheKey, options.contextKey, options.enabled, query, discover]);
  useEffect(() => {
    let last = 0;
    const wake = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < 2000)
        return;
      if (!["running", "uncertain"].includes(phaseRef.current)) return;
      last = Date.now();
      resume();
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [resume]);
  const start = useCallback(
    async (input?: { retry?: boolean }) => {
      const requestedContext = optionsRef.current.contextKey;
      if (recoveryRef.current) await recoveryRef.current;
      if (contextRef.current !== requestedContext) return;
      if (optionsRef.current.enabled === false) return;
      if (phaseRef.current === "uncertain") {
        resume();
        return;
      }
      if (taskStartBlocked(phaseRef.current)) return;
      if (stateRef.current.phase === "completed" && !(input?.retry && optionsRef.current.allowRestartCompleted)) {
        return;
      }
      if (pointerRef.current && !input?.retry) {
        resume();
        return;
      }
      const current = optionsRef.current,
        context = current.contextKey,
        epoch = ++serial.current;
      const retry =
        input?.retry &&
        ((stateRef.current.phase === "failed" &&
          ((current.flow === "judge" && canRetryJudgeFailure(stateRef.current.errorCode)) || current.canRetryFailure?.(stateRef.current.errorCode))) ||
          (stateRef.current.phase === "completed" && current.allowRestartCompleted))
          ? (pointerRef.current ?? undefined)
          : undefined;
      const previousPointer = pointerRef.current;
      pointerRef.current = null;
      // A refresh during POST must not silently become permission to create again.
      savePointer(responseLogicRecoveryKey(current.flow, context), {
        creationUnconfirmed: true,
      });
      phaseRef.current = "starting";
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      dispatch({ type: "start", contextKey: context });
      try {
        const started = await current.start(retry, controller.signal);
        if (
          controller.signal.aborted ||
          epoch !== serial.current ||
          contextRef.current !== context
        )
          return;
        pointerRef.current = started;
        savePointer(responseLogicRecoveryKey(current.flow, context), started);
        dispatch({
          type: "start-succeeded",
          taskId: started.taskId,
          contextKey: context,
        });
        query(started, false);
      } catch (error) {
        if (
          controller.signal.aborted ||
          epoch !== serial.current ||
          contextRef.current !== context
        )
          return;
        const e = error as { message?: string; code?: string };
        const uncertain = uncertainTaskError(error);
        phaseRef.current = uncertain ? "uncertain" : "failed";
        if (!uncertain) {
          pointerRef.current = previousPointer;
          savePointer(
            responseLogicRecoveryKey(current.flow, context),
            previousPointer,
          );
        }
        dispatch({
          type: uncertain ? "uncertain" : "start-failed",
          message: uncertain
            ? "无法确认任务是否创建，请先核查任务状态，避免重复提交。"
            : (e.message ?? "任务启动失败"),
          code: e.code ?? "TASK_START_FAILED",
          contextKey: context,
        });
      }
    },
    [query, resume],
  );
  const reset = useCallback(() => {
    serial.current++;
    controllerRef.current?.abort();
    recoveryRef.current = null;
    pointerRef.current = null;
    savePointer(cacheKey, null);
    phaseRef.current = "idle";
    dispatch({ type: "reset" });
  }, [cacheKey]);
  return { state, start, reset, resume };
}
