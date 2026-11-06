/** Only terminal result-validation errors permit a new explicit Judge attempt.
 * Transport, access and context errors must never create a replacement task. */
export function isJudgeResultFailure(code?: string) {
  return [
    "JUDGE_STRUCTURED_OUTPUT_MISSING", "JUDGE_PAYLOAD_INVALID_JSON",
    "JUDGE_OUTPUT_SCHEMA_MISMATCH", "JUDGE_SCORE_INCONSISTENT",
    "JUDGE_EVIDENCE_EXCERPT_INVALID", "JUDGE_KNOWLEDGE_EVIDENCE_UNAVAILABLE",
    "JUDGE_KNOWLEDGE_EVIDENCE_INVALID",
  ].includes(code ?? "");
}
export function canRetryJudgeFailure(code?: string) {
  return code === "RESPONSE_LOGIC_JUDGE_TASK_FAILED" || isJudgeResultFailure(code);
}
