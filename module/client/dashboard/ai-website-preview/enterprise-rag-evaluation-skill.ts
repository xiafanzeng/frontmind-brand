import type { EvaluationResult, EvaluationSkill } from "./evaluation-skill-contract.js";
import { RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, scoreEvaluation, type EvaluationInput } from "./rag-evaluation.js";
export { enterpriseRagEvaluationSkill as legacyEnterpriseRagEvaluationSkill } from "./enterprise-rag-evaluation-skill-legacy.js";

export const ENTERPRISE_RAG_EVALUATION_SKILL_ID = "enterprise-rag-evaluation";
export const ENTERPRISE_RAG_EVALUATION_SKILL_VERSION = "2.0.0";
export interface EnterpriseRagEvaluationInput extends EvaluationInput { relatedReportIds?: readonly string[] }
const unique = (ids: readonly string[] = []) => [...new Set(ids.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];

function evaluate(input: EnterpriseRagEvaluationInput): EvaluationResult {
  const scored = scoreEvaluation(input);
  const configurationIssues = [
    ...input.dimensions.filter(item => !RAG_DIMENSIONS.some(definition => definition.id === item.id)).map(item => `未知维度 ${item.id}`),
    ...input.gates.filter(item => !RAG_GATES.some(definition => definition.id === item.id)).map(item => `未知检查 ${item.id}`),
    ...RAG_DIMENSIONS.filter(definition => input.dimensions.filter(item => item.id === definition.id).length > 1).map(item => `重复维度 ${item.id}`),
    ...RAG_GATES.filter(definition => input.gates.filter(item => item.id === definition.id).length > 1).map(item => `重复检查 ${item.id}`),
  ];
  const findings = input.findings ?? [];
  const hasJudgment = input.dimensions.some(item => item.level !== null || item.rationale.trim()) || input.gates.some(item => item.status !== "pending" || item.reason.trim()) || configurationIssues.length > 0;
  const verdict = configurationIssues.length ? "pending" : !hasJudgment ? "pending" : scored.verdict;
  const answerVerdict = verdict === "unusable" ? "unusable" as const : verdict === "pending" ? "pending" as const : verdict === "improve" ? "usable_with_improvements" as const : "usable" as const;
  const status = !hasJudgment ? "not_run" as const : scored.complete && !configurationIssues.length ? "completed" as const : "pending" as const;
  const risks: EvaluationResult["risks"] = findings.map(finding => ({
    id: finding.id, severity: finding.severity === "critical" ? "critical" : finding.severity === "undetermined" ? "high" : "low",
    title: finding.summary, summary: finding.impact, evidenceIds: unique([...finding.evidenceIds, ...finding.claimIds]),
  }));
  // Manual/sample callers may not yet have structured findings. Gate failure
  // still represents a critical risk, and missing checks remain unknown.
  for (const definition of input.findings === undefined ? RAG_GATES : []) {
    const gate = input.gates.find(item => item.id === definition.id);
    if (!gate || gate.status !== "passed") risks.push({ id: `risk-rag-${definition.id}`, severity: gate?.status === "failed" ? "critical" : "high", title: `${definition.label}${gate?.status === "failed" ? "存在重大风险" : "待核验"}`, summary: gate?.reason || "尚无充分判断依据。", evidenceIds: [] });
  }
  if (configurationIssues.length) risks.push({ id: "risk-rag-evaluation-input", severity: "high", title: "评估输入待修正", summary: configurationIssues.join("；"), evidenceIds: [] });
  const recommendation = !hasJudgment || answerVerdict === "unusable" ? "not_recommended" as const : answerVerdict === "usable" ? "recommended" as const : "publish_with_risk" as const;
  const summaries = {
    usable: "核心任务完成，当前证据未发现重大风险。单次回答建议不代表正式版本验收或发布授权。",
    usable_with_improvements: "核心任务完成且无重大风险；保留改进项，不因诊断分数或次要问题单独否决。",
    unusable: "已发现重大业务或安全风险，或核心任务明确失败；请先修复并复测。",
    pending: "必要证据或关键事项尚未确认，暂不形成可用结论。",
  };
  return {
    skillId: ENTERPRISE_RAG_EVALUATION_SKILL_ID, version: ENTERPRISE_RAG_EVALUATION_SKILL_VERSION,
    status, answerVerdict, score: status === "not_run" ? null : scored.score, coverage: status === "not_run" ? 0 : scored.coverage,
    recommendation, summary: `${summaries[answerVerdict]}（规则 ${RAG_RULE_VERSION}；六维分数仅作诊断）`,
    dimensions: RAG_DIMENSIONS.map(definition => {
      const judgment = input.dimensions.find(item => item.id === definition.id);
      const earned = scored.earnedByDimension[definition.id];
      return { id: definition.id, label: definition.label,
        status: judgment?.applicable === false && judgment.rationale.trim() ? "not_applicable" : earned === null ? "pending" : judgment?.level === 4 ? "passed" : (judgment?.level ?? 0) >= 2 ? "partial" : "failed",
        score: earned, maxScore: definition.weight, summary: judgment?.rationale || "尚无判断依据。", evidenceIds: unique(judgment?.evidenceIds) };
    }),
    risks, relatedReportIds: unique(input.relatedReportIds),
  };
}
export const enterpriseRagEvaluationSkill = { skillId: ENTERPRISE_RAG_EVALUATION_SKILL_ID, version: ENTERPRISE_RAG_EVALUATION_SKILL_VERSION, evaluate } satisfies EvaluationSkill<EnterpriseRagEvaluationInput>;
