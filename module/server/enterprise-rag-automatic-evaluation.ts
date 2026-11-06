import { createHash } from "node:crypto";

/** Deployment explicitly enables paid execution; development defaults to no calls. */
export function automaticRagEvaluationEnabled(environment: Readonly<Record<string, string | undefined>>) {
  return environment.FRONTMIND_RAG_AUTO_EVALUATION_MODE === "live";
}

export function isAutomaticRagEvaluationEligible(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.intent === "enterprise_rag_once" && marker.eligible === true;
}

/** Stable server identity: refresh, competing workers and rule upgrades reuse it. */
export function automaticRagEvaluationOperationId(input: {
  accountUserId: number;
  enterpriseProjectId: string | null;
  sourceQaTaskId: string;
  turnId: string;
  answerMessageId: string;
  answerHash: string;
}) {
  const bytes = createHash("sha256").update(JSON.stringify([
    "brand-rag-automatic-once-v1", input.accountUserId, input.enterpriseProjectId,
    input.sourceQaTaskId, input.turnId, input.answerMessageId, input.answerHash,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
