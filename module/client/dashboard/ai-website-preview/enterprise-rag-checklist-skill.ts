import { RAG_CHECKLIST_VERSION, scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist.js";
import type { EnterpriseRagChecklistJudgeOutput } from "../../../contracts/enterprise-rag-evaluation-run.js";
import type { EvaluationResult, EvaluationSkill } from "./evaluation-skill-contract.js";

export const checklistEnterpriseRagEvaluationSkill: EvaluationSkill<EnterpriseRagChecklistJudgeOutput> = {
  skillId: "enterprise-rag-evaluation", version: RAG_CHECKLIST_VERSION,
  evaluate(judgments): EvaluationResult {
    const scored = scoreRagChecklist(judgments.checklist, judgments.checks);
    const critical = judgments.task.status === "failed" || judgments.findings.some(f => f.severity === "critical") || judgments.gates.some(g => g.status === "failed");
    const pending = !scored.complete || judgments.task.status === "undetermined" || judgments.findings.some(f => f.severity === "undetermined") || judgments.gates.some(g => g.status === "pending");
    const improvements = judgments.findings.some(f => f.severity === "improvement");
    const answerVerdict = critical ? "unusable" : pending ? "pending" : improvements ? "usable_with_improvements" : "usable";
    const summaries = {
      usable: "核心任务完成，当前证据未发现实际缺陷。",
      usable_with_improvements: "核心任务完成，存在非关键缺陷，可按具体检查项改进。",
      unusable: "已发现重大风险或核心任务未完成，请先修复并复测。",
      pending: "必要证据或关键事项尚未确认，暂不形成可用结论。",
    };
    return {
      skillId: "enterprise-rag-evaluation", version: RAG_CHECKLIST_VERSION,
      status: pending ? "pending" : "completed", answerVerdict,
      score: scored.score, coverage: scored.coverage,
      recommendation: critical ? "not_recommended" : pending || improvements ? "publish_with_risk" : "recommended",
      summary: summaries[answerVerdict],
      dimensions: scored.dimensions.map(({ checks: _checks, ...dimension }) => dimension),
      risks: judgments.findings.map(f => ({ id: f.id,
        severity: f.severity === "critical" ? "critical" : f.severity === "undetermined" ? "high" : "low",
        title: f.summary, summary: f.impact, evidenceIds: [...new Set([...f.evidenceIds, ...f.claimIds])],
      })), relatedReportIds: [],
    };
  },
};
