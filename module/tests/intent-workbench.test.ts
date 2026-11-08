import {describe, expect, it} from "vitest";
import {createIntentPlan, evaluateIntent, emptyIntentState, findSavedIntentPlan, type IntentNode, type IntentQuestion} from "../contracts/intent-workbench";
const question: IntentQuestion = {id: "q1", question: "隆鼻材料应该怎么选", category: "产品场景词", subdivision: "场景方案", tableId: "t", rowIndex: 0, sourceRevision: 1};
const nodes: IntentNode[] = [{
  id: "node1", title: "隆鼻材料选型", branch: "诊疗项目", content: "隆鼻材料产品特点不同，材料选择应结合鼻部条件和适用人群，明确选择标准。隆鼻材料风险与禁忌待核验，暂无权威依据。",
  verified: true, editable: true,
}];
describe("intent knowledge evidence", () => {
  it("does not treat missing or pending risk evidence as supported", () => {
    const evaluation = evaluateIntent(question, nodes, [question]);
    expect(evaluation.points.find(point => point.title === "风险与限制")?.status).toBe("missing");
    expect(evaluation.support).toBeLessThan(100);
  });
  it("does not cite unrelated knowledge for an arbitrary question", () => {
    const evaluation = evaluateIntent({...question, question: "工业机器人采购价格是多少"}, nodes, [question]);
    expect(evaluation.support).toBe(0);
    expect(evaluation.points.every(point => point.nodeId === null)).toBe(true);
  });
  it("requires confirmation for sufficient support", () => {
    const evaluation = evaluateIntent(question, nodes.map(node => ({...node, verified: false})), [question]);
    expect(evaluation.points.every(point => point.status !== "supported")).toBe(true);
  });
  it("includes body edits in the confirmed plan without creating source tasks", () => {
    const evaluation = evaluateIntent(question, nodes, [question]);
    const plan = createIntentPlan(question, evaluation, nodes);
    expect(plan.actions.find(action => action.kind === "node")?.selected).toBe(true);
    expect(plan.actions.some(action=>action.kind==="todo")).toBe(false);
    expect(plan.actions.find(action => action.kind === "node")?.before).toBe(nodes[0].content);
  });
  it("does not propose writes to a read-only published snapshot", () => {
    const readonly = nodes.map(node => ({...node, editable: false}));
    expect(createIntentPlan(question, evaluateIntent(question, readonly, [question]), readonly).actions.some(action => action.kind === "node")).toBe(false);
  });
});

it("空方案和旧待办方案不能作为可查看的已生成方案",()=>{
 const state=emptyIntentState();state.questions=[question];
 state.plans=[{questionId:question.id,actions:[]}];
 expect(findSavedIntentPlan(state,question.id)).toBeUndefined();
 state.plans[0].actions=[{id:"old",kind:"todo",selected:true,nodeId:null,title:"旧待办",source:"",before:"",after:"补资料"}];
 expect(findSavedIntentPlan(state,question.id)).toBeUndefined();
});

it("重新评估后不把历史方案当成当前方案，新方案完成后才可查看",()=>{
 const state=emptyIntentState();state.questions=[question];
 const evaluation=evaluateIntent(question,nodes,[question]);
 const plan={...createIntentPlan(question,evaluation,nodes),inputHash:"old-input"};
 state.plans=[plan];
 const result={completedAt:"2026-11-08T00:00:00Z",questions:[question],evaluations:[evaluation],plans:[plan]};
 state.jobs=[{id:"old-plan",kind:"plan",status:"succeeded",inputHash:"old-input",questionIds:[question.id],result},{id:"new-eval",kind:"evaluate",status:"succeeded",inputHash:"eval-input",questionIds:[question.id],result:{...result,plans:[]}}] as any;
 expect(findSavedIntentPlan(state,question.id)).toBeUndefined();
 const newer={...plan,inputHash:"old-input"};state.plans=[newer];
 state.jobs.push({id:"new-plan",kind:"plan",status:"succeeded",inputHash:"old-input",questionIds:[question.id],result:{...result,plans:[newer]}} as any);
 expect(findSavedIntentPlan(state,question.id)?.actions[0].kind).toBe("node");
});
