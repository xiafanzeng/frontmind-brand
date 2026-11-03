import { DIAGNOSTIC_CATEGORIES, latestDiagnosticJobs, type DiagnosticJob, type DiagnosticRun } from "../contracts/diagnostics.js";

export const terminalDiagnosticJobOperationStatus = (job: DiagnosticJob) =>
  job.status === "completed" ? "succeeded" : job.status === "failed" ? "failed" : job.status === "cancelled" ? "cancelled" : null;

/** Operation status drives background scheduling, not the customer-facing run result. */
export function diagnosticOperationStatus(run: DiagnosticRun) {
  if (run.phase === "stopped") return "cancelled";
  if (run.jobs.some(job => ["queued", "submitting", "running"].includes(job.status))) return "running";
  const auditPending = DIAGNOSTIC_CATEGORIES.some(category =>
    (run.requiredAuditVersion || run.requestedAudits?.includes(category)) && run.results[category] && !run.audits?.[category] &&
    !run.jobs.some(job => job.kind === "audit" && job.category === category));
  if (auditPending) return "running";
  if (run.attempts.some(attempt => ["queued", "submitting", "submitted"].includes(attempt.status))) return "running";
  if (latestDiagnosticJobs(run.jobs).some(job => job.status === "failed")) return run.phase === "draft" ? "failed" : "attention_required";
  if (run.phase === "partial") return "attention_required";
  if (run.phase === "completed" || run.phase === "draft") return "succeeded";
  return "running";
}
