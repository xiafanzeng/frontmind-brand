export type IntentQuestion = {
  id: string;
  question: string;
  category: string;
  subdivision: string;
  tableId: string;
  rowIndex: number;
  sourceRevision: number | null;
};
export type IntentNode = {
  id: string;
  title: string;
  branch: string;
  content: string;
  verified: boolean;
  editable: boolean;
};
export type SupportPoint = {
  title: string;
  terms: string[];
  status: "supported" | "partial" | "missing";
  nodeId: string | null;
  nodeTitle: string | null;
  evidence: string;
  issue: string;
};
export type IntentEvaluation = {
  questionId: string;
  value: number;
  support: number;
  dimensions: Array<{label: string; score: number; reason: string}>;
  points: SupportPoint[];
  findings: string[];
  method: "rules_v1" | "skill_v1";
  provenance?: {operationId: string; inputHash: string; skillHash: string; model: string};
  evaluatedAt: string;
};
export type IntentAction = {
  id: string;
  kind: "question" | "node" | "todo";
  title: string;
  selected: boolean;
  nodeId: string | null;
  before: string;
  after: string;
  source: string;
};
export type IntentPlan = {questionId: string; actions: IntentAction[]; inputHash?: string};
/** Entity preconditions remain stable while unrelated tasks advance the ledger. */
export const intentQuestionSnapshot = (question: IntentQuestion) => ({
  id: question.id, question: question.question, category: question.category, subdivision: question.subdivision,
});
export const intentPlanSnapshot = (plan: IntentPlan) => ({
  questionId: plan.questionId, inputHash: plan.inputHash ?? null,
  actions: knowledgeOnlyIntentPlan(plan).actions.map(({id, selected, after}) => ({id, selected, after})),
});
export type IntentSkillJob = {
  id: string; taskId: string; kind: "evaluate" | "plan"; questionIds: string[];
  status: "queued" | "uploading" | "create_unknown" | "running" | "pausing" | "paused" | "resuming" | "succeeded" | "failed";
  createdAt: string; inputHash: string; knowledgeHash: string; questionsHash: string;
  questionsScope?: "selected";
  draftEditedQuestionIds?: string[];
  credentialId: string; credentialVersion: number; skillHash: string; model: string;
  receiptId?: string; error?: string; lease?: {owner: string; expiresAt: number};
  createClaimedAt?: number;
  autoRetry?: {scheduledAt: number; reason: string};
  terminalObservedAt?: number;
  control?: {
    action: "pause" | "resume"; intentId: string; claimedAt: number;
    dispatchedAt?: number; acknowledgedAt?: number; error?: string;
  };
  continuation?: {baselineEventIds: string[]; resumedAt: number};
  result?: {
    completedAt: string;
    questions: IntentQuestion[];
    evaluations: IntentEvaluation[];
    plans: IntentPlan[];
  };
  progress?: {
    stage: "preparing" | "submitted" | "analyzing" | "validating" | "repairing" | "completed" | "failed";
    updatedAt: string;
    events: Array<{id: string; label: string; at: string}>;
  };
  repair?: {
    intentId: string; claimedAt: number; sentAt?: number;
    baselineEventIds: string[]; reason: string;
  };
};
export type IntentTodo = {
  id: string; questionId: string; title: string;
  status: "pending" | "completed"; source: string;
};
export type IntentChange = {
  action: IntentAction;
  questionId: string;
  status: "pending" | "succeeded" | "failed" | "reverted";
  error?: string;
};
export type IntentReceipt = {
  id: string;
  status: "running" | "completed" | "partial" | "reverted";
  createdAt: string;
  changes: IntentChange[];
  before: IntentEvaluation[];
  after: IntentEvaluation[];
  reEvaluationError?: string;
  lease?: {owner: string; expiresAt: number};
};
export type IntentState = {
  version: 1;
  questions: IntentQuestion[];
  evaluations: IntentEvaluation[];
  plans: IntentPlan[];
  todos: IntentTodo[];
  receipts: IntentReceipt[];
  jobs?: IntentSkillJob[];
  /** Host questions removed from this checklist. Re-checking the question in the host catalog clears the dismissal. */
  dismissedHostQuestionIds?: string[];
};
export type IntentWorkspace = {
  revision: number;
  state: IntentState;
  nodes: IntentNode[];
  preview: boolean;
  /** Current server snapshot, used to distinguish usable drafts from historical plans. */
  knowledgeHash?: string;
  /** Version 2 accepts entity snapshots independently of background ledger progress. */
  commandVersion?: number;
};
export const emptyIntentState = (): IntentState => ({
  version: 1, questions: [], evaluations: [], plans: [], todos: [], receipts: [], jobs: [], dismissedHostQuestionIds: [],
});

/** Legacy question/todo records remain readable; optimization executes body changes only. */
export function knowledgeOnlyIntentPlan(plan: IntentPlan): IntentPlan {
  return {...plan, actions: plan.actions.filter(action => action.kind === "node")};
}

/** Resolve a current draft or the latest accepted snapshot without changing either. */
export function findSavedIntentPlan(state: IntentState, questionId: string): IntentPlan | undefined {
  const question = state.questions.find(question => question.id === questionId);
  if (!question) return;
  const jobs = state.jobs ?? [];
  // A new completed evaluation invalidates older plans for this question.
  // Historical records remain available separately, never as the current draft.
  const lastEvaluation = jobs.reduce((last, job, index) => job.kind === "evaluate" && job.status === "succeeded" &&
    job.result?.evaluations.some(item => item.questionId === questionId) ? index : last, -1);
  const current = state.plans.find(plan => plan.questionId === questionId);
  if (current) {
    const sourceIndex = jobs.reduce((last, job, index) => job.kind === "plan" && job.status === "succeeded" &&
      job.questionIds.includes(questionId) && job.inputHash === current.inputHash && Boolean(current.inputHash) ? index : last, -1);
    if (lastEvaluation < 0 || sourceIndex > lastEvaluation) {
      const plan = knowledgeOnlyIntentPlan(current); return plan.actions.length ? plan : undefined;
    }
  }
  for (const job of jobs.slice(lastEvaluation + 1).reverse()) {
    if (job.kind !== "plan" || job.status !== "succeeded" || !job.questionIds.includes(questionId)) continue;
    const original = job.result?.questions.find(item => item.id === questionId);
    if (!original || original.question !== question.question || original.category !== question.category ||
        original.subdivision !== question.subdivision) continue;
    const saved = job.result?.plans.find(plan => plan.questionId === questionId);
    if (saved) {const plan = knowledgeOnlyIntentPlan({...saved, inputHash: saved.inputHash ?? job.inputHash}); if (plan.actions.length) return plan;}
  }
}

/** Keep stale plans in history, but offer generation rather than execution against changed knowledge. */
export function findCurrentIntentPlan(workspace:IntentWorkspace,questionId:string):IntentPlan|undefined {
  const plan=findSavedIntentPlan(workspace.state,questionId);
  if(!plan)return;
  const source=workspace.state.jobs?.find(job=>job.kind==="plan"&&job.inputHash===plan.inputHash&&job.questionIds.includes(questionId));
  if(workspace.knowledgeHash&&source?.knowledgeHash&&workspace.knowledgeHash!==source.knowledgeHash)return;
  if(plan.actions.some(action=>{
    const node=workspace.nodes.find(node=>node.id===action.nodeId);
    return node&&node.content.trim()!==action.before.trim();
  }))return;
  return plan;
}

/** A transparent lexical assessment, not an AI or search-volume measurement. */
function tokens(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) result.add(normalized.slice(i, i + 2));
  return [...result].filter(token => !["如何", "怎么", "哪些", "应该", "哪家", "什么", "选择", "是否", "专业"].includes(token));
}
export function matchIntentNode(question: string, nodes: IntentNode[]) {
  const terms = tokens(question);
  return nodes.map(node => {
    const title = `${node.branch}${node.title}`.toLowerCase();
    const content = node.content.toLowerCase();
    const hits = terms.filter(term => title.includes(term) || content.includes(term));
    const score = hits.reduce((sum, term) => sum + (title.includes(term) ? 3 : 1), 0);
    return {node, score, hits: hits.length};
  }).filter(item => item.hits >= 2 || (item.hits >= 1 && item.score >= 3))
    .sort((a, b) => b.score - a.score)[0]?.node ?? null;
}
function answerPoints(question: string): Array<{title: string; terms: string[]}> {
  if (/医院|机构|哪家|品牌|资质|执业/.test(question)) return [
    {title: "主体资质与核验方式", terms: ["资质", "许可证", "执业", "证书"]},
    {title: "团队与专业能力", terms: ["医生", "团队", "经验", "技术"]},
    {title: "客观筛选与对比标准", terms: ["标准", "对比", "核验", "判断"]},
    {title: "风险与适用边界", terms: ["风险", "禁忌", "边界", "限制"]},
  ];
  if (/价格|费用|报价|收费/.test(question)) return [
    {title: "价格组成", terms: ["费用", "价格", "报价", "收费"]},
    {title: "影响价格的条件", terms: ["条件", "规格", "范围", "因素"]},
    {title: "服务与交付范围", terms: ["服务", "交付", "包含", "验收"]},
    {title: "合同与风险边界", terms: ["合同", "风险", "限制", "退款"]},
  ];
  return [
    {title: "产品或方案特点", terms: ["材料", "特点", "产品", "功能"]},
    {title: "适用人群与选择标准", terms: ["人群", "适用", "标准", "选择"]},
    {title: "风险与限制", terms: ["风险", "禁忌", "限制", "边界"]},
    {title: "维护与后续服务", terms: ["护理", "维护", "售后", "服务"]},
  ];
}
export function evaluateIntent(question: IntentQuestion, nodes: IntentNode[], candidates: IntentQuestion[], now = new Date().toISOString()): IntentEvaluation {
  const related = nodes.filter(node => matchIntentNode(question.question, [node]));
  const points: SupportPoint[] = answerPoints(question.question).map(point => {
    const ranked = related.map(node => {
      const sentences = node.content.split(/(?<=[。！？\n])/u).filter(line =>
        point.terms.some(term => line.includes(term)) && !/待补|待核|待确认|尚未|缺少|暂无/.test(line));
      return {node, sentences, count: point.terms.filter(term => node.content.includes(term)).length};
    }).filter(item => item.sentences.length).sort((a, b) => b.count - a.count);
    const best = ranked[0];
    const status = !best ? "missing" : best.node.verified && best.count >= 2 && best.sentences.join("").length >= 35 ? "supported" : "partial";
    return {...point, status, nodeId: best?.node.id ?? null, nodeTitle: best ? `${best.node.branch} / ${best.node.title}` : null,
      evidence: best?.sentences.slice(0, 2).join("").trim().slice(0, 220) ?? "",
      issue: status === "missing" ? "缺少可引用的相关内容" : status === "partial" ? "内容覆盖不足或尚未确认" : "已找到相关已确认内容"};
  });
  const support = Math.round(points.reduce((sum, point) => sum + ({supported: 100, partial: 50, missing: 0}[point.status]), 0) / points.length);
  const vague = /哪家好|哪家专业|最好|排名|应该怎么/.test(question.question);
  const duplicates = candidates.filter(item => item.id !== question.id && tokens(item.question).filter(token => tokens(question.question).includes(token)).length / Math.max(1, tokens(question.question).length) > .8).length;
  const dimensions = [
    {label: "意图明确度", score: /如何|怎么|哪些|哪家|是否|价格|材料|服务/.test(question.question) ? 85 : 55, reason: "依据问题是否表达明确咨询意图；未接入真实搜索热度"},
    {label: "品牌关联度", score: related.length ? Math.min(95, 65 + related.length * 5) : 30, reason: `匹配到 ${related.length} 个相关知识节点`},
    {label: "决策相关度", score: /选择|怎么选|对比|价格|哪家|修复|采购/.test(question.question) ? 85 : 60, reason: "依据选择、比较与采购等决策词"},
    {label: "问题清晰度", score: vague ? 60 : question.question.length >= 8 ? 90 : 50, reason: vague ? "评价标准或问题范围尚未明确" : "问题对象及表达较明确"},
    {label: "内容独特度", score: Math.max(30, 95 - duplicates * 20), reason: `当前清单中有 ${duplicates} 条高重合问题`},
    {label: "知识支撑初评", score: support, reason: `${points.filter(point => point.status === "supported").length} / ${points.length} 项充分支撑`},
  ];
  return {questionId: question.id, value: Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length), support,
    dimensions, points, findings: [...(vague ? ["建议明确选择标准，避免绝对排名或效果承诺"] : []), ...points.filter(point => point.status !== "supported").map(point => `${point.title}：${point.issue}`)],
    method: "rules_v1", evaluatedAt: now};
}
export function createIntentPlan(question: IntentQuestion, evaluation: IntentEvaluation, nodes: IntentNode[]): IntentPlan {
  const target = matchIntentNode(question.question, nodes.filter(node => node.editable));
  const actions: IntentAction[] = [];
  if (target) actions.push({id: `${question.id}:node`, kind: "node", title: "补充知识节点正文", selected: true,
    nodeId: target.id, before: target.content,
    after: `${target.content.trim()}\n\n## 回答口径与选择边界\n\n针对“${question.question}”，回答应引用本节点已经确认的事实，说明适用条件与判断依据。尚未确认的资料不得作为确定结论；涉及风险和专业决策时，应说明限制并建议进一步核验。\n`,
    source: `${target.branch} / ${target.title}；仅新增回答边界，不生成未经证实的产品或医疗事实`});
  return {questionId: question.id, actions};
}
