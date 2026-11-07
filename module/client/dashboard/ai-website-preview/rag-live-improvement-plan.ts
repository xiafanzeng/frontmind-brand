import {
  isChecklistRagJudgment,
  isGradedRagJudgment,
  type EnterpriseRagEvaluationReport,
  type EnterpriseRagGradedJudgeOutput,
} from "../../../contracts/enterprise-rag-evaluation-run";
import type { DimensionId } from "./rag-evaluation";
import type { RagIssue } from "./rag-evaluation-cases";
import type {
  RagImprovementPlanData,
  RagImprovementStep,
} from "./rag-improvement-plan";

type Guidance = { title: string; action: string; check: string };
type Finding = EnterpriseRagGradedJudgeOutput["findings"][number];

const dimensionGuidance: Record<DimensionId, Guidance> = {
  intent: { title: "明确客户需求", action: "先正面回应客户的核心问题；缺少影响判断的场景时，先提出必要的澄清问题。", check: "回答是否正面回应客户的问题，必要的澄清是否已完成。" },
  correctness: { title: "核对事实依据", action: "逐条对照已有来源，修正矛盾内容；无法核实的陈述应明确保留未知。", check: "核心事实是否与可核验来源一致，是否仍有无依据的承诺。" },
  completeness: { title: "补齐必要信息", action: "对照当前任务补充缺少的条件、限制或步骤；资料中未确认的内容不要直接补写。", check: "完成当前任务所需的条件、限制和步骤是否齐全。" },
  citations: { title: "补充引用来源", action: "为相关陈述补充可访问的来源与具体定位；无法取得依据时说明核验限制。", check: "相关引用是否可访问，并能定位到实际支持该陈述的内容。" },
  clarity: { title: "理顺表达步骤", action: "将结论放在前面，合并重复内容，再按执行顺序说明必要的下一步。", check: "用户能否直接理解结论和下一步，正文是否仍有重复或含混表达。" },
  boundaries: { title: "说明适用边界", action: "核对授权范围与适用条件，移除越权内容，并明确当前无法确认的事项。", check: "回答是否遵守授权与适用范围，并如实说明未知事项。" },
};

const findingGuidance: Record<Finding["kind"], Guidance> = {
  fact: dimensionGuidance.correctness,
  condition: dimensionGuidance.completeness,
  citation: dimensionGuidance.citations,
  task: dimensionGuidance.intent,
  expression: dimensionGuidance.clarity,
  privacy: { title: "核对公开权限", action: "先移除未经授权的内容，再核对来源的公开范围与当前访问者权限。", check: "当前访问者是否只能看到其获准访问的内容及引用。" },
  safety: { title: "修正风险内容", action: "对照已记录的风险修订相关内容，核实适用限制后再给出建议。", check: "已记录的风险是否得到处理，适用限制是否清楚。" },
  injection: { title: "排除越权指令", action: "将来源中的越权指令与可引用事实分开，移除偏离当前任务或授权范围的内容。", check: "回答是否仍遵循当前任务和授权范围，而未执行来源中的越权指令。" },
  evidence: { title: "补齐核验依据", action: "补充可核验资料及来源定位；必要依据未确认前，保留待核验结论。", check: "缺少的资料是否已补齐并完成核验，未确认事项是否仍明确标注。" },
};
const fallbackGuidance: Guidance = { title: "核对问题内容", action: "对照当前记录及对应依据修订相关内容，完成后重新评审。", check: "当前记录中的问题是否已处理，修改内容是否有相应依据。" };

const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))];
const sentence = (text: string) => {
  const value = text.trim();
  return !value || /[。！？.!?]$/u.test(value) ? value : `${value}。`;
};
function recordedBody(summary: string, impact: string, action: string) {
  const finding = summary.trim(), detail = impact.trim();
  const diagnosis = !finding || detail.includes(finding) ? detail : !detail || finding.includes(detail) ? finding : `${sentence(finding)}${detail}`;
  return `${sentence(diagnosis)}${sentence(action)}`;
}
function priorityForRisk(severity: string): RagIssue["priority"] {
  return severity === "critical" ? "P0" : severity === "high" || severity === "medium" ? "P1" : "P2";
}
function orderSteps(steps: RagImprovementStep[]) {
  steps.sort((a, b) => {
    const rank = (step: RagImprovementStep) => step.priority === "P0" ? 0 : step.pending ? 1 : step.priority === "P1" ? 2 : 3;
    return rank(a) - rank(b);
  });
}
function goalForSteps(steps: RagImprovementStep[]) {
  if (steps.some(step => step.priority === "P0")) return "先修正本轮回答中已记录的关键风险，再补齐必要信息，并核验修改后的内容。";
  if (steps.some(step => step.pending)) return "先补齐尚未确认的判断依据，再处理已记录的问题，避免在证据不足时作出确定结论。";
  return "针对本轮已记录的问题完善回答，让客户更清楚地理解结论、适用条件和下一步。";
}

/** Formal/live plan builder. It has no dependency on local synthetic fixtures. */
export function buildLiveRagImprovementPlan({ report, issues, complete }: {
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
        return { id: finding.id, title: guidance.title, body: recordedBody(finding.summary, finding.impact, guidance.action), priority: finding.severity === "critical" ? "P0" as const : finding.severity === "improvement" ? "P2" as const : undefined, pending: finding.severity === "undetermined", quotes: finding.claimIds.flatMap(id => { const claim = judgments.claims.find(item => item.id === id); return claim ? [{ id, text: claim.statement }] : []; }), evidenceIds: unique(finding.evidenceIds) };
      });
    }
    for (const risk of report.result.risks) {
      if (representedRiskIds.has(risk.id)) continue;
      representedRiskIds.add(risk.id);
      plan.steps.push({ id: risk.id, title: risk.severity === "critical" ? "修正风险内容" : fallbackGuidance.title, body: recordedBody(risk.title, risk.summary, fallbackGuidance.action), priority: priorityForRisk(risk.severity), quotes: [], evidenceIds: unique(risk.evidenceIds ?? []) });
      plan.checks.push(fallbackGuidance.check);
    }
    if (isChecklistRagJudgment(judgments)) plan.optionalSuggestions = judgments.optionalSuggestions.map(suggestion => ({ id: suggestion.id, title: suggestion.summary, body: suggestion.benefit, evidenceIds: unique(suggestion.evidenceIds) }));
    orderSteps(plan.steps);
  } else {
    plan.steps = issues.map(issue => {
      const guidance = issue.dimensionId ? dimensionGuidance[issue.dimensionId] : issue.priority === "P0" ? findingGuidance.safety : fallbackGuidance;
      plan.checks.push(guidance.check);
      return { id: issue.id, title: guidance.title, body: recordedBody(issue.title, issue.impact, issue.action || guidance.action), priority: issue.priority, quotes: [], evidenceIds: [] };
    });
    orderSteps(plan.steps);
  }
  plan.checks = unique(plan.checks);
  if (!plan.steps.length) {
    plan.checks = [];
    if (plan.optionalSuggestions.length) { plan.emptyState = "optional-only"; plan.goal = "当前记录没有待修复项；以下可选建议不影响当前评分，可按实际需要采用。"; }
    else { plan.emptyState = complete ? "no-issues" : "unassessed"; plan.goal = complete ? "当前记录没有待修复项；继续用更多真实场景验证。" : "先补齐当前回答的判断依据，再确定优化方向。"; }
  } else plan.goal = goalForSteps(plan.steps);
  return plan;
}
