import { useResponseLogicTask } from "./use-response-logic-task.js";
import {
  startJudgeEvaluation,
  pollJudgeTask,
  judgeContextKey,
  recoverJudgeEvaluation,
} from "./response-logic-judge-client.js";
import type { JudgeOutput } from "../contracts/response-logic-judge.js";
import {
  createTaskLifecycleReducer,
  initialTaskLifecycleState,
  taskStartBlocked,
  type TaskLifecycleEvent,
  type TaskLifecycleState,
  type TaskPhase,
} from "./task-lifecycle.js";

export type JudgePhase = TaskPhase;

export type JudgeState = Omit<TaskLifecycleState<JudgeOutput>, "activeContext">;

/** JudgeState bound to the context (questionId + revision + fingerprint) it belongs to. */
export type JudgeLifecycleState = TaskLifecycleState<JudgeOutput>;

export type JudgeLifecycleEvent = TaskLifecycleEvent<JudgeOutput>;

export const initialJudgeLifecycleState: JudgeLifecycleState =
  initialTaskLifecycleState<JudgeOutput>();

/** Backwards-compatible alias; the judge start guard is the shared one. */
export const judgeStartBlocked = taskStartBlocked;

/**
 * Pure lifecycle state machine for the judge evaluation — one shared machine
 * (task-lifecycle.ts) for judge and optimizer, instantiated per flow.
 */
export const judgeEvaluationReducer = createTaskLifecycleReducer<JudgeOutput>({
  timeoutCode: "JUDGE_TIMEOUT",
  timeoutMessage:
    "等待 Judge 评估结果超时。任务可能仍在后台运行，请稍后重新查看评估；若重新查看仍长时间无结果，再重试评估。",
});

/**
 * Manages the LLM-as-Judge async task lifecycle with context protection.
 *
 * Context key (questionId + revision + fingerprint) guards against stale
 * results: before applying any poll response, the reducer verifies that the
 * task's context still matches the active one. If it doesn't (question
 * switched or draft edited), the response is silently dropped and polling is
 * aborted.
 *
 * Polling stops on: completion, failure, context change, or max attempts.
 */
export function useJudgeEvaluation(input: {
  questionId: string;
  recordIdentity?: string;
  recordRevision: number;
  sourceFingerprint: string;
  questionBasis?: string;
}) {
  const contextKey =
    judgeContextKey(
      input.questionId,
      input.recordRevision,
      input.sourceFingerprint,
      input.questionBasis,
    ) + (input.recordIdentity ? `:record:${input.recordIdentity}` : "");
  return useResponseLogicTask<JudgeOutput>({
    flow: "judge",
    contextKey,
    enabled: input.recordRevision > 0,
    recover: (signal) =>
      recoverJudgeEvaluation({
        ...input,
        expectedRevision: input.recordRevision,
        signal,
      }),
    start: async (retry, signal) => {
      const result = await startJudgeEvaluation({
        ...input,
        expectedRevision: input.recordRevision,
        retry,
        signal,
      });
      return { taskId: result.taskId, attempt: result.attempt };
    },
    poll: async (taskId, signal) => {
      const result = await pollJudgeTask({
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
        taskId,
        signal,
      });
      return result.status === "completed"
        ? { ...result, result: result.result.judge }
        : result;
    },
  });
}
