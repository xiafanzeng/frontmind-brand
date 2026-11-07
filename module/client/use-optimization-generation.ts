import { useResponseLogicTask } from "./use-response-logic-task.js";
import {
  startOptimizationGeneration,
  pollOptimizationTask,
  optimizationContextKey,
  recoverOptimizationGeneration,
} from "./response-logic-optimization-client.js";
import type { ReviewedOptimization } from "../contracts/response-logic-change-review.js";
import {
  initialTaskLifecycleState,
  type TaskLifecycleState,
  type TaskPhase,
} from "./task-lifecycle.js";
export type OptimizationPhase = TaskPhase;
export type OptimizationState = Omit<
  TaskLifecycleState<ReviewedOptimization>,
  "activeContext"
>;
export const initialOptimizationLifecycleState =
  initialTaskLifecycleState<ReviewedOptimization>();
export function useOptimizationGeneration(input: {
  questionId: string;
  recordIdentity?: string;
  recordRevision: number;
  sourceFingerprint: string;
  judgeTaskId: string;
  questionBasis?: string;
}) {
  const contextKey =
    optimizationContextKey(
      input.questionId,
      input.recordRevision,
      input.sourceFingerprint,
      input.judgeTaskId,
      input.questionBasis,
    ) + (input.recordIdentity ? `:record:${input.recordIdentity}` : "");
  return useResponseLogicTask<ReviewedOptimization>({
    flow: "optimizer",
    contextKey,
    enabled: !!input.judgeTaskId && input.recordRevision > 0,
    recover: (signal) =>
      recoverOptimizationGeneration({
        ...input,
        expectedRevision: input.recordRevision,
        signal,
      }),
    start: async (_retry, signal) => {
      const result = await startOptimizationGeneration({
        ...input,
        expectedRevision: input.recordRevision,
        signal,
      });
      return { taskId: result.taskId, attempt: 0 };
    },
    poll: async (taskId, signal) => {
      const result = await pollOptimizationTask({
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
        judgeTaskId: input.judgeTaskId,
        taskId,
        signal,
      });
      return result.status === "completed"
        ? { ...result, result: {...result.result.optimization,...(result.result.review?{review:result.result.review}:{})} }
        : result;
    },
  });
}
