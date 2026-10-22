import {beforeEach, describe, expect, it} from "vitest";
import {createIntentPreviewApi} from "../../standalone/intent-preview";
import type {IntentWorkbenchApi} from "../client/dashboard/intent-workbench-api";
import type {IntentWorkspace} from "../contracts/intent-workbench";
const questions = [
  {id: "q1", question: "隆鼻材料应该怎么选", category: "产品场景词", subdivision: "场景方案", tableId: "t1", rowIndex: 0, sourceRevision: 1},
  {id: "q2", question: "东莞双眼皮修复医院哪家专业", category: "行业排名词", subdivision: "采购决策", tableId: "t1", rowIndex: 2, sourceRevision: 1},
];
async function prepare(api: IntentWorkbenchApi) {
  let data = await api.observe();
  data = await api.command({kind: "intake", expectedRevision: data.revision, questions});
  return api.command({kind: "plan", expectedRevision: data.revision, questionIds: questions.map(question => question.id)});
}
async function editPlan(api: IntentWorkbenchApi, data: IntentWorkspace, questionId: string, kinds: string[]) {
  const plan = data.state.plans.find(item => item.questionId === questionId)!;
  return api.command({kind: "edit", expectedRevision: data.revision, questionId, actions: plan.actions.map(action => ({
    id: action.id, selected: kinds.includes(action.kind), after: action.after,
  }))});
}
describe("standalone intent interaction adapter", () => {
  beforeEach(() => localStorage.clear());
  it("executes only the selected non-first question and chosen action, survives refresh, then restores it", async () => {
    const api = createIntentPreviewApi("selective");
    let data = await prepare(api);
    data = await editPlan(api, data, "q2", ["question"]);
    const request = {expectedRevision: data.revision, clientRequestId: crypto.randomUUID(), questionIds: ["q2"]};
    data = await api.execute(request);
    expect(data.state.receipts[0].changes).toHaveLength(1);
    expect(data.state.receipts[0].changes[0].questionId).toBe("q2");
    expect(data.state.questions[0].question).toBe(questions[0].question);
    expect(data.state.todos).toHaveLength(0);
    expect((await api.execute(request)).revision).toBe(data.revision);
    const refreshed = createIntentPreviewApi("selective");
    expect((await refreshed.observe()).state).toEqual(data.state);
    data = await refreshed.rollback({expectedRevision: data.revision, receiptId: request.clientRequestId});
    expect(data.state.questions[1].question).toBe(questions[1].question);
    expect(data.state.receipts[0].status).toBe("reverted");
  });
  it("keeps missing knowledge unresolved when only a source task is created", async () => {
    const api = createIntentPreviewApi("todo");
    let data = await prepare(api);
    const before = data.state.evaluations.find(item => item.questionId === "q1")!.support;
    data = await editPlan(api, data, "q1", ["todo"]);
    data = await api.execute({expectedRevision: data.revision, clientRequestId: crypto.randomUUID(), questionIds: ["q1"]});
    expect(data.state.todos).toHaveLength(1);
    expect(data.state.todos[0].status).toBe("pending");
    expect(data.state.evaluations.find(item => item.questionId === "q1")!.support).toBe(before);
  });
  it("rejects an undo after another execution modifies the same question", async () => {
    const api = createIntentPreviewApi("conflict");
    let data = await prepare(api);
    data = await editPlan(api, data, "q1", ["question"]);
    const original = crypto.randomUUID();
    data = await api.execute({expectedRevision: data.revision, clientRequestId: original, questionIds: ["q1"]});
    data = await api.command({kind: "plan", expectedRevision: data.revision, questionIds: ["q1"]});
    data = await editPlan(api, data, "q1", ["question"]);
    data = await api.execute({expectedRevision: data.revision, clientRequestId: crypto.randomUUID(), questionIds: ["q1"]});
    await expect(api.rollback({expectedRevision: data.revision, receiptId: original})).rejects.toThrow("后续修改");
  });
});
