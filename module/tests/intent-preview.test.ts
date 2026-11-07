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
  it("问题修改保留身份和来源，删除后刷新不再显示，其他问题不受影响", async () => {
    const api = createIntentPreviewApi("question-edit");
    let data = await prepare(api);
    data = await api.command({kind: "update-question", expectedRevision: data.revision, questionId: "q2",
      question: "双眼皮修复有哪些选择标准？", category: "industry", subdivision: "选型"});
    expect(data.state.questions[1]).toMatchObject({id: "q2", tableId: "t1", rowIndex: 2, sourceRevision: 1});
    expect(data.state.evaluations.some(item => item.questionId === "q2")).toBe(false);
    expect(data.state.plans.some(item => item.questionId === "q2")).toBe(false);
    const reopened = createIntentPreviewApi("question-edit");
    expect((await reopened.observe()).state.questions[1].question).toBe("双眼皮修复有哪些选择标准？");
    data = await reopened.command({kind: "delete-question", expectedRevision: data.revision, questionId: "q2"});
    expect((await createIntentPreviewApi("question-edit").observe()).state.questions).toEqual([questions[0]]);
    expect(data.state.evaluations.map(item => item.questionId)).toEqual(["q1"]);
  });
  it("executes only the selected non-first question and chosen action, survives refresh, then restores it", async () => {
    const api = createIntentPreviewApi("selective");
    let data = await prepare(api);
    const beforeNodes = structuredClone(data.nodes);
    data = await editPlan(api, data, "q2", ["node"]);
    const action = data.state.plans.find(item => item.questionId === "q2")!.actions.find(item => item.kind === "node")!;
    const request = {expectedRevision: data.revision, clientRequestId: crypto.randomUUID(), questionIds: ["q2"]};
    data = await api.execute(request);
    expect(data.state.receipts[0].changes).toHaveLength(1);
    expect(data.state.receipts[0].changes[0]).toMatchObject({questionId: "q2", action: {kind: "node", nodeId: action.nodeId}, status: "succeeded"});
    expect(data.state.questions).toEqual(questions);
    expect(data.nodes.map(node => node.content)).toEqual(beforeNodes.map(node => node.id === action.nodeId ? action.after : node.content));
    expect(data.state.todos).toHaveLength(0);
    expect((await api.execute(request)).revision).toBe(data.revision);
    const refreshed = createIntentPreviewApi("selective");
    expect((await refreshed.observe()).state).toEqual(data.state);
    data = await refreshed.rollback({expectedRevision: data.revision, receiptId: request.clientRequestId});
    expect(data.state.questions).toEqual(questions);
    expect(data.nodes.map(node => node.content)).toEqual(beforeNodes.map(node => node.content));
    expect(data.state.receipts[0].status).toBe("reverted");
  });
  it("确认方案只修改正文，缺失资料不创建任何待办", async () => {
    const api=createIntentPreviewApi("body-only");const data=await prepare(api);
    expect(data.state.plans.every(plan=>plan.actions.every(action=>action.kind==="node"))).toBe(true);
    const executed=await api.execute({expectedRevision:data.revision,clientRequestId:crypto.randomUUID(),questionIds:["q1"]});
    expect(executed.state.todos).toEqual([]);
    expect(executed.state.receipts[0].changes.every(change=>change.action.kind==="node")).toBe(true);
  });
  it("rejects an undo after another execution modifies the same knowledge node", async () => {
    const api = createIntentPreviewApi("conflict");
    let data = await prepare(api);
    data = await editPlan(api, data, "q1", ["node"]);
    const original = crypto.randomUUID();
    data = await api.execute({expectedRevision: data.revision, clientRequestId: original, questionIds: ["q1"]});
    const firstChange = data.state.receipts[0].changes[0];
    data = await api.command({kind: "plan", expectedRevision: data.revision, questionIds: ["q1"]});
    data = await editPlan(api, data, "q1", ["node"]);
    data = await api.execute({expectedRevision: data.revision, clientRequestId: crypto.randomUUID(), questionIds: ["q1"]});
    expect(data.state.receipts[1].changes[0].action.nodeId).toBe(firstChange.action.nodeId);
    expect(data.state.receipts[1].changes[0].action.after).not.toBe(firstChange.action.after);
    expect(data.state.questions).toEqual(questions);
    await expect(api.rollback({expectedRevision: data.revision, receiptId: original})).rejects.toThrow("后续修改");
  });
});
