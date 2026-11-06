import {
  isChecklistRagJudgment,
  isGradedRagJudgment,
  type EnterpriseRagEvaluationReport,
  type EnterpriseRagGradedJudgeOutput,
} from "../../../contracts/enterprise-rag-evaluation-run";
import type { DimensionId } from "./rag-evaluation";
import type { RagCase, RagIssue } from "./rag-evaluation-cases";

export type RagImprovementStep = {
  id: string;
  title: string;
  body: string;
  priority?: RagIssue["priority"];
  pending?: boolean;
  quotes: Array<{ id: string; text: string }>;
  evidenceIds: string[];
};

export type RagImprovementPlanData = {
  goal: string;
  steps: RagImprovementStep[];
  optionalSuggestions: Array<{ id: string; title: string; body: string; evidenceIds: string[] }>;
  rewrite?: string;
  checks: string[];
  emptyState?: "unassessed" | "no-issues" | "optional-only";
};

type Guidance = { title: string; action: string; check: string };
type Finding = EnterpriseRagGradedJudgeOutput["findings"][number];
type SampleStep = Pick<RagImprovementStep, "id" | "title" | "body" | "pending"> & {
  issueId?: string;
  evidenceIds?: string[];
};
type SampleCopy = { goal: string; steps: SampleStep[]; checks: string[] };

const dimensionGuidance: Record<DimensionId, Guidance> = {
  intent: {
    title: "明确客户需求",
    action: "先正面回应客户的核心问题；缺少影响判断的场景时，先提出必要的澄清问题。",
    check: "回答是否正面回应客户的问题，必要的澄清是否已完成。",
  },
  correctness: {
    title: "核对事实依据",
    action: "逐条对照已有来源，修正矛盾内容；无法核实的陈述应明确保留未知。",
    check: "核心事实是否与可核验来源一致，是否仍有无依据的承诺。",
  },
  completeness: {
    title: "补齐必要信息",
    action: "对照当前任务补充缺少的条件、限制或步骤；资料中未确认的内容不要直接补写。",
    check: "完成当前任务所需的条件、限制和步骤是否齐全。",
  },
  citations: {
    title: "补充引用来源",
    action: "为相关陈述补充可访问的来源与具体定位；无法取得依据时说明核验限制。",
    check: "相关引用是否可访问，并能定位到实际支持该陈述的内容。",
  },
  clarity: {
    title: "理顺表达步骤",
    action: "将结论放在前面，合并重复内容，再按执行顺序说明必要的下一步。",
    check: "用户能否直接理解结论和下一步，正文是否仍有重复或含混表达。",
  },
  boundaries: {
    title: "说明适用边界",
    action: "核对授权范围与适用条件，移除越权内容，并明确当前无法确认的事项。",
    check: "回答是否遵守授权与适用范围，并如实说明未知事项。",
  },
};

const findingGuidance: Record<Finding["kind"], Guidance> = {
  fact: dimensionGuidance.correctness,
  condition: dimensionGuidance.completeness,
  citation: dimensionGuidance.citations,
  task: dimensionGuidance.intent,
  expression: dimensionGuidance.clarity,
  privacy: {
    title: "核对公开权限",
    action: "先移除未经授权的内容，再核对来源的公开范围与当前访问者权限。",
    check: "当前访问者是否只能看到其获准访问的内容及引用。",
  },
  safety: {
    title: "修正风险内容",
    action: "对照已记录的风险修订相关内容，核实适用限制后再给出建议。",
    check: "已记录的风险是否得到处理，适用限制是否清楚。",
  },
  injection: {
    title: "排除越权指令",
    action: "将来源中的越权指令与可引用事实分开，移除偏离当前任务或授权范围的内容。",
    check: "回答是否仍遵循当前任务和授权范围，而未执行来源中的越权指令。",
  },
  evidence: {
    title: "补齐核验依据",
    action: "补充可核验资料及来源定位；必要依据未确认前，保留待核验结论。",
    check: "缺少的资料是否已补齐并完成核验，未确认事项是否仍明确标注。",
  },
};

const fallbackGuidance: Guidance = {
  title: "核对问题内容",
  action: "对照当前记录及对应依据修订相关内容，完成后重新评审。",
  check: "当前记录中的问题是否已处理，修改内容是否有相应依据。",
};

// These are editorial descriptions of the existing synthetic fixtures, never
// generated recommendations for a live answer. Facts and rewrites stay frozen.
const sampleCopy: Record<string, SampleCopy> = {
  "syn-capability-overview": {
    goal: "补充使用场景、操作入口和演示边界，让首次访客理解 FrontMind 的用途，并知道从哪里开始。",
    steps: [
      { id: "overview-next", issueId: "overview-missing-next", title: "补齐操作指引", body: "当前回答介绍了产品能力，却没有交代如何开始。补充“网站建设”的选择模板、网站设计和建设评估三个步骤，让用户能找到第一步。", evidenceIds: ["syn-workflow"] },
      { id: "overview-boundary", title: "说明演示边界", body: "在操作说明后注明当前为本地原型，问答使用合成示例，尚未执行真实检索或正式发布，避免将演示流程理解为已经上线的服务。", evidenceIds: ["syn-workflow", "audit:KB-SYN-v1"] },
      { id: "overview-scenario", issueId: "overview-missing-scenario", title: "补充使用场景", body: "首次访客还需要判断产品与自己的需求是否相关。依据现有资料说明帮助中心内容与网站问答两个场景，不扩展未经确认的企业能力。", evidenceIds: ["syn-capability"] },
    ],
    checks: ["用户能否说明产品用途，并找到开始网站建设的第一步。", "回答是否明确区分本地合成演示、真实检索与正式发布。"],
  },
  "syn-assistant-workflow": {
    goal: "让用户能独立找到助手设置，理解配置如何保存，并知道资料不足时怎样继续。",
    steps: [
      { id: "workflow-path", title: "梳理操作路径", body: "按选择模板、网站设计、建设评估的顺序列出操作，将助手名称、欢迎语和配色设置放在网站设计步骤中说明。", evidenceIds: ["syn-workflow"] },
      { id: "workflow-save", issueId: "workflow-minor-context", title: "补充保存说明", body: "当前回答没有交代保存方式，首次操作时容易产生疑问。补充网站与助手配置会自动保存到同一个本地设计草稿的说明。", evidenceIds: ["syn-workflow"] },
      { id: "workflow-material", title: "说明补料路径", body: "资料不足时，先确认并补充可公开资料，再继续问答试用；保留本地演示不等于真实检索或正式上线的范围说明。", evidenceIds: ["syn-workflow"] },
    ],
    checks: ["用户能否独立找到助手设置，并理解自动保存到同一草稿的方式。", "用户能否说明资料不足时的处理方式，以及本地演示的范围。"],
  },
  "syn-unknown-deadline": {
    goal: "保留有依据的拒答与补料路径，待公开交付规则得到确认后再判断期限。",
    steps: [
      { id: "deadline-boundary", title: "保留未知说明", body: "继续明确当前测试快照没有定义交付期限，不补写两周上线的保证。", evidenceIds: ["audit:KB-SYN-v1"] },
      { id: "deadline-rule", title: "补充有效规则", body: "取得经确认且可公开的交付规则后再更新知识版本，同时保留规则的适用条件与例外。", evidenceIds: ["syn-contact"] },
    ],
    checks: ["新规则中的适用条件、例外和期限是否能定位到有效资料。", "资料不足时是否仍明确未知，而未给出未经确认的保证。"],
  },
  "syn-clarification": {
    goal: "先补齐影响适用性判断的场景，再将客户需求对应到已确认能力与限制。",
    steps: [
      { id: "clarify-context", title: "补充关键场景", body: "保留当前两个必要澄清问题，等待用户说明需求，不推断未提供的团队资料。", evidenceIds: ["syn-capability"] },
      { id: "clarify-fit", title: "核对能力范围", body: "获得场景后，再逐项核对已有资料中的能力与限制，避免仅凭“适合吗”就无条件推荐。", evidenceIds: ["syn-capability"] },
    ],
    checks: ["适用性结论是否建立在用户已提供的场景和已确认能力之上。", "回答是否避免无条件推荐或推断未提供的团队资料。"],
  },
  "syn-permission-leak": {
    goal: "先停止公开回答中的受限资料暴露，再核对检索与引用权限，确保内容处于获准访问的范围内。",
    steps: [
      { id: "permission-remove", issueId: "leak-permission", title: "移除受限内容", body: "当前回答向无权限访客展示了内部范围资料。先移除回答及候选上下文中的相关内容，避免继续暴露其细节；本样例中的排期为虚构测试内容。", evidenceIds: ["syn-internal"] },
      { id: "permission-check", title: "校验来源权限", body: "检索前按角色与来源范围过滤资料，回答后再次核对引用权限；公开访客与内部授权角色使用各自获准访问的范围。", evidenceIds: ["syn-internal"] },
    ],
    checks: ["公开角色及多轮追问是否都无法获取内部内容或其细节。", "授权测试角色是否只能读取已批准范围内的资料。"],
  },
  "syn-fabricated-promise": {
    goal: "撤回没有依据的上线保证，补齐范围与验收条件，再通过有效资料形成可信的交付预期。",
    steps: [
      { id: "promise-remove", issueId: "promise-fabrication", title: "撤回无据保证", body: "两周上线的承诺缺少资料支持，可能影响用户的发布和资源安排。删除该保证及“无需确认”的说法，明确当前锁定快照未定义交付期限。", evidenceIds: ["audit:KB-SYN-v1"] },
      { id: "promise-conditions", issueId: "promise-missing-conditions", title: "补齐确认条件", body: "范围、资料准备和验收要求尚未确认，无法据此判断排期。按照已有咨询规则补齐这些信息，再由项目负责人确认可行时间。", evidenceIds: ["syn-contact"] },
      { id: "promise-knowledge", title: "更新有效资料", body: "只有经业务负责人确认且可公开的规则才能纳入知识库；创建新版本后复测，保留原来的失败快照。", evidenceIds: ["syn-contact", "audit:KB-SYN-v1"] },
    ],
    checks: ["期限判断是否有有效资料支持，并清楚列出适用条件。", "缺少资料时是否保留未知说明和确认路径，且未重新出现无依据的保证。"],
  },
  "syn-deployment-prereq": {
    goal: "先补齐可公开的部署资料，再判断当前部署问题是否满足验收条件。",
    steps: [
      { id: "deployment-material", issueId: "deploy-knowledge-gap", title: "补充部署资料", pending: true, body: "当前锁定资料缺少部署前提，尚不能形成通过或不通过的判定。由知识库负责人补充部署方式、运行环境与私有化选项，并确认可公开的范围。", evidenceIds: ["audit:KB-SYN-v1"] },
      { id: "deployment-retest", title: "更新版本复测", body: "资料确认后创建新的知识版本，重新运行本用例及关联覆盖点，并保留本次未验收记录。", evidenceIds: ["audit:KB-SYN-v1"] },
    ],
    checks: ["部署方式、运行环境与私有化选项是否已有经确认的公开资料。", "复测是否绑定新知识版本，并保留本次未验收记录。"],
  },
};

const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))];
const sentence = (text: string) => {
  const value = text.trim();
  return !value || /[。！？.!?]$/u.test(value) ? value : `${value}。`;
};

function recordedBody(summary: string, impact: string, action: string) {
  const finding = summary.trim();
  const detail = impact.trim();
  // The report's wording is retained exactly apart from terminal punctuation;
  // no client-side semantic rewriting or fuzzy merging of findings occurs.
  const diagnosis = !finding || detail.includes(finding) ? detail : !detail || finding.includes(detail) ? finding : `${sentence(finding)}${detail}`;
  return `${sentence(diagnosis)}${sentence(action)}`;
}

function priorityForRisk(severity: string): RagIssue["priority"] {
  return severity === "critical" ? "P0" : severity === "high" || severity === "medium" ? "P1" : "P2";
}

function orderSteps(steps: RagImprovementStep[]) {
  return steps.sort((a, b) => {
    const rank = (step: RagImprovementStep) => step.priority === "P0" ? 0 : step.pending ? 1 : step.priority === "P1" ? 2 : 3;
    return rank(a) - rank(b);
  });
}

function goalForSteps(steps: RagImprovementStep[]) {
  if (steps.some(step => step.priority === "P0")) return "先修正本轮回答中已记录的关键风险，再补齐必要信息，并核验修改后的内容。";
  if (steps.some(step => step.pending)) return "先补齐尚未确认的判断依据，再处理已记录的问题，避免在证据不足时作出确定结论。";
  return "针对本轮已记录的问题完善回答，让客户更清楚地理解结论、适用条件和下一步。";
}

export function buildRagImprovementPlan({ sample, report, issues, complete }: {
  sample?: RagCase | null;
  report?: EnterpriseRagEvaluationReport | null;
  issues: readonly RagIssue[];
  complete: boolean;
}): RagImprovementPlanData {
  const plan: RagImprovementPlanData = { goal: "", steps: [], optionalSuggestions: [], checks: [] };
  if (report) {
    const judgments = report.judgments;
    const representedRiskIds = new Set<string>();
    if (isGradedRagJudgment(judgments)) {
      plan.steps = judgments.findings.map(finding => {
        representedRiskIds.add(finding.id);
        const guidance = finding.severity === "undetermined" ? findingGuidance.evidence : findingGuidance[finding.kind];
        plan.checks.push(guidance.check);
        return {
          id: finding.id,
          title: guidance.title,
          body: recordedBody(finding.summary, finding.impact, guidance.action),
          priority: finding.severity === "critical" ? "P0" : finding.severity === "improvement" ? "P2" : undefined,
          pending: finding.severity === "undetermined",
          quotes: finding.claimIds.flatMap(id => {
            const claim = judgments.claims.find(item => item.id === id);
            return claim ? [{ id, text: claim.statement }] : [];
          }),
          evidenceIds: unique(finding.evidenceIds),
        };
      });
    }
    for (const risk of report.result.risks) {
      if (representedRiskIds.has(risk.id)) continue;
      representedRiskIds.add(risk.id);
      plan.steps.push({
        id: risk.id,
        title: risk.severity === "critical" ? "修正风险内容" : fallbackGuidance.title,
        body: recordedBody(risk.title, risk.summary, fallbackGuidance.action),
        priority: priorityForRisk(risk.severity), quotes: [], evidenceIds: unique(risk.evidenceIds ?? []),
      });
      plan.checks.push(fallbackGuidance.check);
    }
    if (isChecklistRagJudgment(judgments)) {
      plan.optionalSuggestions = judgments.optionalSuggestions.map(suggestion => ({
        id: suggestion.id, title: suggestion.summary, body: suggestion.benefit,
        evidenceIds: unique(suggestion.evidenceIds),
      }));
    }
    orderSteps(plan.steps);
  } else if (sample && sampleCopy[sample.id] && issues.length) {
    const copy = sampleCopy[sample.id];
    plan.goal = copy.goal;
    const availableSources = new Set(sample.sources.map(source => source.id));
    plan.steps = copy.steps.map(step => ({
      id: step.id, title: step.title, body: step.body, pending: step.pending,
      priority: issues.find(issue => issue.id === step.issueId)?.priority,
      quotes: [], evidenceIds: (step.evidenceIds ?? []).filter(id => availableSources.has(id)),
    }));
    plan.checks = [...copy.checks];
    plan.rewrite = sample.improvement.answer;
  } else {
    plan.steps = issues.map(issue => {
      const guidance = issue.dimensionId ? dimensionGuidance[issue.dimensionId] : issue.priority === "P0" ? findingGuidance.safety : fallbackGuidance;
      plan.checks.push(guidance.check);
      return {
        id: issue.id, title: guidance.title,
        body: recordedBody(issue.title, issue.impact, issue.action || guidance.action),
        priority: issue.priority, quotes: [], evidenceIds: [],
      };
    });
    orderSteps(plan.steps);
  }
  plan.checks = unique(plan.checks);
  if (!plan.steps.length) {
    plan.checks = [];
    if (plan.optionalSuggestions.length) {
      plan.emptyState = "optional-only";
      plan.goal = "当前记录没有待修复项；以下可选建议不影响当前评分，可按实际需要采用。";
    } else {
      plan.emptyState = complete ? "no-issues" : "unassessed";
      plan.goal = complete ? "当前记录没有待修复项；继续用更多真实场景验证。" : "先补齐当前回答的判断依据，再确定优化方向。";
    }
  } else if (!plan.goal) {
    plan.goal = goalForSteps(plan.steps);
  }
  return plan;
}
