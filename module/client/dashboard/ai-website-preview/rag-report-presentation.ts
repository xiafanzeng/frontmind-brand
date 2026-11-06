import type { EnterpriseRagEvaluationReport } from "../../../contracts/enterprise-rag-evaluation-run.js";
import type { EvaluationResult } from "./rag-evaluation.js";

export const ragVerdictLabels = { excellent: "优秀", usable: "可用", improve: "可用·待改进", unusable: "不可用·需修复", pending: "待核验" };
export const enterpriseRagQualityVerdictLabels = { excellent: "优秀", usable: "良好", improve: "待改进", unusable: "需修复", pending: "待核验" };
export const legacyRagVerdictLabels = { excellent: "优秀", usable: "可用，仍有优化空间", improve: "需要改进", unusable: "不可用，优先修复", pending: "待完成评审" };

/** Hide generated implementation annotations without altering the frozen report. */
export function presentRagSummary(summary: string): string {
  return summary.replace(/[（(]\s*规则\s+rag-eval-\d+(?:\.\d+)+(?:\s*[；;]\s*([^（）()]*?))?\s*[）)]\s*$/u,
    (_annotation, explanation: string | undefined) => explanation?.trim() ? `（${explanation.trim()}）` : "");
}

export function presentEvaluationScore(score: number | null | undefined, unavailable: boolean) {
  if (unavailable) return { value: "N/A", text: "N/A", showScale: false, ariaLabel: "重大问题，数值分不适用" };
  if (typeof score !== "number" || !Number.isFinite(score)) return { value: "N/A", text: "N/A", showScale: false, ariaLabel: "六维诊断评分待核验" };
  return { value: score, text: `${score}/100`, showScale: true, ariaLabel: `六维诊断评分 ${score}，满分 100` };
}

/** Display the persisted server conclusion; never reinterpret its score using today's rule. */
export function reportVerdict(report: EnterpriseRagEvaluationReport): EvaluationResult["verdict"] {
  switch (report.result.answerVerdict) {
    case "usable": return "usable";
    case "usable_with_improvements": return "improve";
    case "unusable": return "unusable";
    case "pending": return "pending";
  }
  if (report.result.status !== "completed") return "pending";
  return report.result.recommendation === "recommended" ? (report.result.score ?? 0) >= 90 ? "excellent" : "usable" : report.result.recommendation === "publish_with_risk" ? "improve" : "unusable";
}
