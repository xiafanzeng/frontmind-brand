import {describe, expect, it} from "vitest";
import {createIntentPlan, evaluateIntent, type IntentNode, type IntentQuestion} from "../contracts/intent-workbench";
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
  it("creates a pending source task without fabricating facts or auto-selecting node edits", () => {
    const evaluation = evaluateIntent(question, nodes, [question]);
    const plan = createIntentPlan(question, evaluation, nodes);
    expect(plan.actions.find(action => action.kind === "node")?.selected).toBe(false);
    expect(plan.actions.find(action => action.kind === "todo")?.source).toContain("不计入");
    expect(plan.actions.find(action => action.kind === "node")?.before).toBe(nodes[0].content);
  });
  it("does not propose writes to a read-only published snapshot", () => {
    const readonly = nodes.map(node => ({...node, editable: false}));
    expect(createIntentPlan(question, evaluateIntent(question, readonly, [question]), readonly).actions.some(action => action.kind === "node")).toBe(false);
  });
});
