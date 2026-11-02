import type { IntentQuestion, IntentState } from "../contracts/intent-workbench.js";

/** A projection of the host's selected questions, never a second editable source. */
export const HOST_QUESTION_TABLE = "dashboard:confirmed";

export function isHostIntentQuestion(question: IntentQuestion | undefined) {
  return question?.tableId === HOST_QUESTION_TABLE;
}

function sameQuestion(left: IntentQuestion, right: IntentQuestion) {
  // MySQL JSON can reorder object keys when persisting the ledger. Compare
  // the question contract, not serialized insertion order, or every GET
  // advances the revision and the following command immediately conflicts.
  return left.id === right.id && left.question === right.question &&
    left.category === right.category && left.subdivision === right.subdivision &&
    left.tableId === right.tableId && left.rowIndex === right.rowIndex &&
    left.sourceRevision === right.sourceRevision;
}

export function reconcileHostIntentQuestions(state: IntentState, questions: IntentQuestion[]) {
  const current = new Map(questions.map(question => [question.id, question]));
  const invalidated = new Set<string>();
  let changed = false;
  const next = state.questions.flatMap(question => {
    const replacement = current.get(question.id);
    if (replacement) {
      current.delete(question.id);
      if (!sameQuestion(question, replacement)) {
        changed = true;
        if (question.question !== replacement.question || question.category !== replacement.category || question.subdivision !== replacement.subdivision)
          invalidated.add(question.id);
      }
      return [replacement];
    }
    if (isHostIntentQuestion(question)) {
      changed = true;
      invalidated.add(question.id);
      return [];
    }
    return [question];
  });
  if (current.size) changed = true;
  if (!changed) return false;
  state.questions = [...next, ...current.values()];
  state.evaluations = state.evaluations.filter(item => !invalidated.has(item.questionId));
  state.plans = state.plans.filter(item => !invalidated.has(item.questionId));
  // Completed jobs/receipts retain the immutable question and score snapshots.
  return true;
}
