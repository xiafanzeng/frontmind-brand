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
export type IntentSkillJob = {
  id: string; taskId: string; kind: "evaluate" | "plan"; questionIds: string[];
  status: "queued" | "uploading" | "create_unknown" | "running" | "succeeded" | "failed";
  createdAt: string; inputHash: string; knowledgeHash: string; questionsHash: string;
  credentialId: string; credentialVersion: number; skillHash: string; model: string;
  receiptId?: string; error?: string; lease?: {owner: string; expiresAt: number};
  createClaimedAt?: number;
  terminalObservedAt?: number;
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
};
export type IntentWorkspace = {
  revision: number;
  state: IntentState;
  nodes: IntentNode[];
  preview: boolean;
};
export const emptyIntentState = (): IntentState => ({
  version: 1, questions: [], evaluations: [], plans: [], todos: [], receipts: [], jobs: [],
});

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
  const rewritten = /哪家好|哪家专业/.test(question.question)
    ? `${question.question.replace(/哪家好|哪家专业/g, "")}应从哪些资质、经验与风险标准进行选择？`
    : /怎么选|如何选择|应该怎么/.test(question.question)
      ? `${question.question.replace(/应该怎么选|怎么选|如何选择/g, "")}有哪些适用条件、选择标准与风险限制？`
      : `${question.question.replace(/[？?]$/, "")}，有哪些适用条件与判断依据？`;
  const actions: IntentAction[] = [{id: `${question.id}:question`, kind: "question", title: "优化问题表述", selected: true,
    nodeId: null, before: question.question, after: rewritten, source: "原问题与当前诊断；可编辑后确认"}];
  if (target) actions.push({id: `${question.id}:node`, kind: "node", title: "补充知识节点正文", selected: false,
    nodeId: target.id, before: target.content,
    after: `${target.content.trim()}\n\n## 回答口径与选择边界\n\n针对“${rewritten}”，回答应引用本节点已经确认的事实，说明适用条件与判断依据。尚未确认的资料不得作为确定结论；涉及风险和专业决策时，应说明限制并建议进一步核验。\n`,
    source: `${target.branch} / ${target.title}；仅新增回答边界，不生成未经证实的产品或医疗事实`});
  const gaps = evaluation.points.filter(point => point.status !== "supported");
  if (gaps.length) actions.push({id: `${question.id}:todo`, kind: "todo", title: "创建资料待办", selected: true, nodeId: null, before: "",
    after: `请补充并核验：${gaps.map(point => point.title).join("、")}。记录原始来源、核验日期和适用范围后，再更新对应知识节点。`,
    source: "待办完成前不计入知识支撑分"});
  return {questionId: question.id, actions};
}
