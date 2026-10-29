import {createIntentPlan, emptyIntentState, evaluateIntent, type IntentWorkspace, type IntentState, type IntentNode, type IntentQuestion} from "../module/contracts/intent-workbench";
import type {IntentWorkbenchApi} from "../module/client/dashboard/intent-workbench-api";
import {updateIntentQuestionSchema, deleteIntentQuestionSchema, mutateIntentQuestion} from "../module/contracts/intent-question-mutations";
const demoNodes: IntentNode[] = [
  {id: "materials", title: "材料介绍", branch: "诊疗项目 / 隆鼻", verified: true, editable: true, content: "# 材料介绍\n\n不同材料的产品特点、支撑力和稳定性存在差异。材料选择应根据鼻部基础、皮肤厚度、适用人群与面诊结果综合判断。\n\n## 术后护理\n术后护理与维护应遵从医生指导，出现异常时应联系医疗机构复诊。"},
  {id: "guide", title: "材料选型指南", branch: "诊疗项目 / 隆鼻", verified: true, editable: true, content: "# 材料选型指南\n\n选择隆鼻材料时，可根据个人需求进行判断。\n\n## 适用人群\n适用人群需要结合鼻部基础、皮肤厚度和期望效果，由医生面诊评估。"},
  {id: "hospital", title: "机构资质与医生团队", branch: "品牌信息", verified: true, editable: true, content: "# 机构资质与医生团队\n\n选择医院或医疗机构应核验执业许可证、诊疗科目和医生执业资质。团队经验与专业技术需依据公开执业信息及实际面诊核实。\n\n## 医疗风险\n风险、禁忌与案例适用边界尚未核验，待补充公开资料。"},
  {id: "repair", title: "双眼皮修复项目", branch: "眼部项目", verified: false, editable: true, content: "# 双眼皮修复项目\n\n双眼皮修复需评估医生经验、瘢痕和组织条件。适用人群与选择标准应以面诊为准。修复风险与案例限制资料待核验。"},
];
export function createIntentPreviewApi(scope: string): IntentWorkbenchApi {
  const key = `frontmind:intent-preview:v1:${scope}`;
  let memory: IntentWorkspace = {revision: 0, state: emptyIntentState(), nodes: structuredClone(demoNodes), preview: true};
  try {const stored = localStorage.getItem(key); if (stored) {const data = JSON.parse(stored); if (data.state?.version === 1 && data.preview === true) memory = data;}} catch {}
  const snapshot = () => structuredClone(memory);
  const persist = () => {memory.revision++; localStorage.setItem(key, JSON.stringify(memory)); return snapshot();};
  const check = (revision: number) => {if (revision !== memory.revision) throw new Error("清单已更新，请重新读取");};
  return {
    async observe() {return snapshot();},
    async command(value) {
      const input = value as any; check(input.expectedRevision);
      if (input.kind === "update-question" || input.kind === "delete-question") {
        mutateIntentQuestion(memory.state, input.kind === "update-question"
          ? updateIntentQuestionSchema.parse(input) : deleteIntentQuestionSchema.parse(input));
      }
      if (input.kind === "intake") for (const question of input.questions as IntentQuestion[]) {
        if (!memory.state.questions.some(item => item.id === question.id || item.question === question.question)) memory.state.questions.push(structuredClone(question));
      }
      if (input.kind === "evaluate" || input.kind === "plan") for (const id of input.questionIds as string[]) {
        const question = memory.state.questions.find(item => item.id === id)!;
        const evaluation = evaluateIntent(question, memory.nodes, memory.state.questions);
        memory.state.evaluations = [...memory.state.evaluations.filter(item => item.questionId !== id), evaluation];
        if (input.kind === "plan") memory.state.plans = [...memory.state.plans.filter(item => item.questionId !== id), createIntentPlan(question, evaluation, memory.nodes)];
      }
      if (input.kind === "edit") {
        const plan = memory.state.plans.find(item => item.questionId === input.questionId)!;
        for (const edit of input.actions) Object.assign(plan.actions.find(item => item.id === edit.id)!, edit);
      }
      if (input.kind === "todo") Object.assign(memory.state.todos.find(todo => todo.id === input.todoId)!, {status: "completed", source: input.source});
      return persist();
    },
    async execute(value) {
      const input = value as any;
      if (memory.state.receipts.some(receipt => receipt.id === input.clientRequestId)) return snapshot();
      check(input.expectedRevision);
      const plans = memory.state.plans.filter(plan => input.questionIds.includes(plan.questionId));
      const changes = plans.flatMap(plan => plan.actions.filter(action => action.selected).map(action => ({action: structuredClone(action), questionId: plan.questionId, status: "pending" as const})));
      if (!changes.length) throw new Error("请至少选择一项动作");
      const nodeIds = changes.filter(change => change.action.kind === "node").map(change => change.action.nodeId);
      if (new Set(nodeIds).size !== nodeIds.length) throw new Error("多个方案修改同一节点，请分别执行");
      const receipt: IntentState["receipts"][number] = {id: input.clientRequestId, status: "running", createdAt: new Date().toISOString(), before: structuredClone(memory.state.evaluations.filter(item => input.questionIds.includes(item.questionId))), after: [], changes};
      for (const change of receipt.changes) {
        const action = change.action;
        if (action.kind === "question") memory.state.questions.find(item => item.id === change.questionId)!.question = action.after;
        else if (action.kind === "node") {
          const node = memory.nodes.find(item => item.id === action.nodeId)!;
          if (node.content !== action.before) {change.status = "failed"; change.error = "节点已有后续修改"; continue;}
          node.content = action.after; node.verified = false;
        } else memory.state.todos.push({id: `${receipt.id}:${action.id}`, questionId: change.questionId, title: action.after, source: "", status: "pending"});
        change.status = "succeeded";
      }
      receipt.after = memory.state.questions.filter(question => input.questionIds.includes(question.id)).map(question => evaluateIntent(question, memory.nodes, memory.state.questions));
      receipt.status = receipt.changes.some(change => change.status === "failed") ? "partial" : "completed";
      memory.state.receipts.push(receipt);
      memory.state.evaluations = [...memory.state.evaluations.filter(item => !input.questionIds.includes(item.questionId)), ...receipt.after];
      return persist();
    },
    async rollback(value) {
      const input = value as any; check(input.expectedRevision);
      const receipt = memory.state.receipts.find(item => item.id === input.receiptId)!;
      if (receipt.status === "reverted") return snapshot();
      const successful = receipt.changes.filter(change => change.status === "succeeded");
      for (const change of successful) {
        const actual = change.action.kind === "node" ? memory.nodes.find(node => node.id === change.action.nodeId)?.content :
          change.action.kind === "question" ? memory.state.questions.find(item => item.id === change.questionId)?.question : change.action.after;
        if (actual !== change.action.after) throw new Error("内容已有后续修改，无法直接撤销");
      }
      for (const change of successful) {
        if (change.action.kind === "node") memory.nodes.find(node => node.id === change.action.nodeId)!.content = change.action.before;
        if (change.action.kind === "question") memory.state.questions.find(item => item.id === change.questionId)!.question = change.action.before;
        if (change.action.kind === "todo") memory.state.todos = memory.state.todos.filter(todo => todo.id !== `${receipt.id}:${change.action.id}`);
        change.status = "reverted";
      }
      receipt.status = "reverted";
      for (const questionId of new Set(receipt.changes.map(change => change.questionId))) {
        const question = memory.state.questions.find(item => item.id === questionId);
        if (question) memory.state.evaluations = [...memory.state.evaluations.filter(item => item.questionId !== questionId), evaluateIntent(question, memory.nodes, memory.state.questions)];
      }
      return persist();
    },
  };
}
