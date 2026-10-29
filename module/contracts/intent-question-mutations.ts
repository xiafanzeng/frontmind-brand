import {z} from "zod";
import type {IntentState} from "./intent-workbench.js";

const base = {
  expectedRevision: z.number().int().nonnegative(),
  questionId: z.string().min(1).max(191),
};
export const updateIntentQuestionSchema = z.object({
  ...base, kind: z.literal("update-question"),
  question: z.string().trim().min(2).max(500),
  category: z.string().trim().min(1).max(80),
  subdivision: z.string().trim().max(80),
}).strict();
export const deleteIntentQuestionSchema = z.object({
  ...base, kind: z.literal("delete-question"),
}).strict();
export type IntentQuestionMutation = z.infer<typeof updateIntentQuestionSchema> | z.infer<typeof deleteIntentQuestionSchema>;
export class IntentQuestionMutationError extends Error {
  constructor(readonly code: string, message: string) {super(message);}
}

/** Changes the current catalog only; completed task snapshots and receipts stay readable. */
export function mutateIntentQuestion(state: IntentState, input: IntentQuestionMutation) {
  const question = state.questions.find(item => item.id === input.questionId);
  if (!question) throw new IntentQuestionMutationError("QUESTION_MISSING", "问题已不存在，请重新读取清单");
  if (input.kind === "update-question") {
    if (state.questions.some(item => item.id !== question.id && item.question === input.question))
      throw new IntentQuestionMutationError("QUESTION_DUPLICATE", "清单中已有相同问题，请调整后保存");
    if (question.question === input.question && question.category === input.category && question.subdivision === input.subdivision) return;
    Object.assign(question, {question: input.question, category: input.category, subdivision: input.subdivision});
  } else {
    state.questions = state.questions.filter(item => item.id !== question.id);
    state.todos = state.todos.filter(item => item.questionId !== question.id);
  }
  // Old scores/plans describe the old text; retain them in history rather than treating them as current.
  state.evaluations = state.evaluations.filter(item => item.questionId !== question.id);
  state.plans = state.plans.filter(item => item.questionId !== question.id);
}
