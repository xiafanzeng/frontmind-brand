import {
  isGradedRagJudgment,
  type EnterpriseRagEvaluationReport,
} from "../../../contracts/enterprise-rag-evaluation-run";

export type RagTaskPresentation = {
  status: "pass" | "fail" | "pending" | "unverified";
  label: string;
  reason: string;
  qualityConclusion: boolean;
};

/** Keep task conclusions separate from evaluation lifecycle states. */
export function presentRagReportTask(
  report: EnterpriseRagEvaluationReport,
): RagTaskPresentation {
  if (!isGradedRagJudgment(report.judgments)) {
    return {
      status: "unverified",
      label: "暂无任务分析",
      reason: "该历史评估版本未包含客户任务结论。",
      qualityConclusion: false,
    };
  }

  const task = report.judgments.task;
  if (task.status === "completed") {
    return {
      status: "pass",
      label: "已完成",
      reason: task.rationale,
      qualityConclusion: true,
    };
  }
  if (task.status === "failed") {
    return {
      status: "fail",
      label: "未完成",
      reason: task.rationale,
      qualityConclusion: true,
    };
  }
  return {
    status: "pending",
    label: "待核验",
    reason: task.rationale,
    qualityConclusion: true,
  };
}
