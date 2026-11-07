import {describe, expect, it} from "vitest";
import {emptyIntentState, type IntentQuestion} from "../contracts/intent-workbench";
import {HOST_QUESTION_TABLE, reconcileHostIntentQuestions} from "../server/intent-question-catalog";

const question: IntentQuestion = {id: "stable-question", question: "已有正式问题？", category: "industry", subdivision: "",
  tableId: HOST_QUESTION_TABLE, rowIndex: 0, sourceRevision: 3};
describe("host formal question projection", () => {
  it("ignores JSON object key order after a persistence round trip", () => {
    const state = emptyIntentState();
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(question).reverse()))) as IntentQuestion;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(question));
    state.questions = [reordered];
    state.evaluations = [{questionId: question.id, value: 80}] as never;
    state.plans = [{questionId: question.id, actions: []}];
    expect(reconcileHostIntentQuestions(state, [question])).toBe(false);
    expect(state.questions[0].sourceRevision).toBe(3);
    expect(state.evaluations).toEqual([{questionId: question.id, value: 80}]);
    expect(state.plans).toHaveLength(1);
  });
  it("refreshes ordering and source revision without deleting unchanged semantic scores", () => {
    const state = emptyIntentState();
    state.questions = [question];
    state.evaluations = [{questionId: question.id, value: 80}] as never;
    state.plans = [{questionId: question.id, actions: []}];
    expect(reconcileHostIntentQuestions(state, [{...question, rowIndex: 4, sourceRevision: 5}])).toBe(true);
    expect(state.evaluations).toEqual([{questionId: question.id, value: 80}]);
    expect(state.plans).toHaveLength(1);
  });
  it("invalidates only current results when the authority changes and retains immutable history", () => {
    const state = emptyIntentState();
    state.questions = [question, {...question, id: "native", tableId: "keyword-table"}];
    state.evaluations = [{questionId: question.id}, {questionId: "native"}] as never;
    state.plans = [{questionId: question.id}, {questionId: "native"}] as never;
    state.jobs = [{id: "paid-task", result: {questions: [question]}}] as never;
    state.receipts = [{id: "saved-receipt"}] as never;
    const history = structuredClone({jobs: state.jobs, receipts: state.receipts});
    const updated = {...question, question: "正式来源改后的问题？", sourceRevision: 4};
    expect(reconcileHostIntentQuestions(state, [updated])).toBe(true);
    expect(state.questions).toEqual([updated, expect.objectContaining({id: "native"})]);
    expect(state.evaluations).toEqual([{questionId: "native"}]);
    expect(state.plans).toEqual([{questionId: "native"}]);
    expect({jobs: state.jobs, receipts: state.receipts}).toEqual(history);
    expect(reconcileHostIntentQuestions(state, [updated])).toBe(false);
    expect(reconcileHostIntentQuestions(state, [])).toBe(true);
    expect(state.questions.map(q => q.id)).toEqual(["native"]);
  });
  it("hides dismissed host questions until the host unchecks and re-checks them", () => {
    const state = emptyIntentState();
    state.dismissedHostQuestionIds = [question.id];
    // Still offered by the host: no re-injection and a stable no-change result.
    expect(reconcileHostIntentQuestions(state, [question])).toBe(false);
    expect(state.questions).toEqual([]);
    // A ledger copy left behind by a legacy path is dropped and invalidated.
    state.questions = [question];
    state.evaluations = [{questionId: question.id}] as never;
    expect(reconcileHostIntentQuestions(state, [question])).toBe(true);
    expect(state.questions).toEqual([]);
    expect(state.evaluations).toEqual([]);
    // Host unchecked: the stale dismissal is pruned (persisted change), then a
    // later re-check re-enters the checklist.
    state.questions = [];
    state.dismissedHostQuestionIds = [question.id];
    expect(reconcileHostIntentQuestions(state, [])).toBe(true);
    expect(state.dismissedHostQuestionIds).toEqual([]);
    expect(reconcileHostIntentQuestions(state, [question])).toBe(true);
    expect(state.questions).toEqual([question]);
  });
});
