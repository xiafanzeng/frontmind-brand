import { z } from "zod";

export const ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE =
  "brand_rag_answer_evaluation";
export const ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION = 1;
export const ENTERPRISE_RAG_JUDGE_VERSION = "1.0.0";

export const ENTERPRISE_RAG_DIMENSION_IDS = [
  "intent",
  "correctness",
  "completeness",
  "citations",
  "clarity",
  "boundaries",
] as const;

export const ENTERPRISE_RAG_GATE_IDS = [
  "facts",
  "citations",
  "permissions",
  "safety",
  "unknown",
  "injection",
  "availability",
] as const;

export type EnterpriseRagDimensionId =
  (typeof ENTERPRISE_RAG_DIMENSION_IDS)[number];
export type EnterpriseRagGateId = (typeof ENTERPRISE_RAG_GATE_IDS)[number];

export type EnterpriseRagEvaluationSource = {
  id: string;
  title: string;
  kind: "published_knowledge" | "user_attachment";
  /** Whether this source was actually exposed as a reference on the answer. */
  citedByAnswer: boolean;
  /** Customer-visible frozen evidence. Null means the attachment body was not
   * available to this evaluator and must never be treated as verified. */
  content: string | null;
};

export type EnterpriseRagEvaluationFrozenInput = {
  schemaVersion: 1;
  operationToken: string;
  inputHash: string;
  sourceQaTaskId: string;
  sourceTurnId: string;
  conversationId: string;
  questionMessageId: string;
  answerMessageId: string;
  question: string;
  answer: string;
  sources: EnterpriseRagEvaluationSource[];
  allowedEvidenceIds: string[];
  knowledgeBase: {
    snapshotId: string;
    version: number;
    sourceFileName: string;
    documentCount: number;
    contentHash: string;
  };
  evaluator: {
    skillId: "enterprise-rag-evaluation";
    skillVersion: string;
    ruleVersion: string;
    judgeVersion: typeof ENTERPRISE_RAG_JUDGE_VERSION;
  };
};

const identifier = z.string().trim().min(1).max(255);
const explanation = z.string().trim().min(1).max(2_000);
const evidenceIds = z.array(identifier).min(1).max(20);

const judgeOutputSchema = z
  .object({
    operationToken: identifier,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    dimensions: z
      .array(
        z
          .object({
            id: z.enum(ENTERPRISE_RAG_DIMENSION_IDS),
            level: z.number().int().min(0).max(4),
            rationale: explanation,
            evidenceIds,
          })
          .strict(),
      )
      .length(ENTERPRISE_RAG_DIMENSION_IDS.length),
    gates: z
      .array(
        z
          .object({
            id: z.enum(ENTERPRISE_RAG_GATE_IDS),
            status: z.enum(["passed", "failed"]),
            reason: explanation,
            evidenceIds,
          })
          .strict(),
      )
      .length(ENTERPRISE_RAG_GATE_IDS.length),
    claims: z
      .array(
        z
          .object({
            id: identifier,
            /** Exact contiguous answer text, not a paraphrase. */
            statement: z.string().trim().min(1).max(1_000),
            status: z.enum(["supported", "partial", "unsupported"]),
            sourceIds: z.array(identifier).max(20),
            rationale: explanation,
          })
          .strict(),
      )
      .min(1)
      .max(30),
    summary: explanation,
  })
  .strict();

export const ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA = z.toJSONSchema(
  judgeOutputSchema,
  { target: "draft-7" },
);

export type EnterpriseRagJudgeOutput = z.infer<typeof judgeOutputSchema>;

export class EnterpriseRagEvaluationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnterpriseRagEvaluationValidationError";
  }
}

function exactOrderedIds(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/** Validate the model's semantic coordinates before the existing deterministic
 * enterprise-rag-evaluation Skill is allowed to calculate a score. */
export function validateEnterpriseRagJudgeOutput(
  value: unknown,
  input: EnterpriseRagEvaluationFrozenInput,
): EnterpriseRagJudgeOutput {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 512 * 1024) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型结果超过大小限制",
    );
  }
  const parsed = judgeOutputSchema.parse(value);
  if (
    parsed.operationToken !== input.operationToken ||
    parsed.inputHash !== input.inputHash
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型结果不属于本次任务",
    );
  }
  if (
    !exactOrderedIds(
      parsed.dimensions.map(({ id }) => id),
      ENTERPRISE_RAG_DIMENSION_IDS,
    ) ||
    !exactOrderedIds(
      parsed.gates.map(({ id }) => id),
      ENTERPRISE_RAG_GATE_IDS,
    )
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型没有按锁定顺序完整返回评分项",
    );
  }
  const allowedEvidence = new Set(input.allowedEvidenceIds);
  for (const item of [...parsed.dimensions, ...parsed.gates]) {
    if (item.evidenceIds.some((id) => !allowedEvidence.has(id))) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估模型引用了未授权证据",
      );
    }
  }
  const allowedSources = new Map(input.sources.map((source) => [source.id, source]));
  const claimIds = new Set<string>();
  for (const claim of parsed.claims) {
    if (claimIds.has(claim.id)) {
      throw new EnterpriseRagEvaluationValidationError("评估陈述标识重复");
    }
    claimIds.add(claim.id);
    if (!input.answer.includes(claim.statement)) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估陈述不是回答中的连续原文",
      );
    }
    if (claim.sourceIds.some((id) => !allowedSources.has(id))) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估陈述引用了未授权来源",
      );
    }
    if (
      claim.status === "supported" &&
      (!claim.sourceIds.length ||
        claim.sourceIds.some((id) => !allowedSources.get(id)?.content))
    ) {
      throw new EnterpriseRagEvaluationValidationError(
        "充分支持的陈述缺少可读取的冻结来源",
      );
    }
    if (claim.status === "unsupported" && claim.sourceIds.length) {
      throw new EnterpriseRagEvaluationValidationError(
        "无支持陈述不得附带来源",
      );
    }
  }
  const dimensions = new Map(parsed.dimensions.map((item) => [item.id, item]));
  const gates = new Map(parsed.gates.map((item) => [item.id, item]));
  const hasUnsupportedClaim = parsed.claims.some(
    ({ status }) => status === "unsupported",
  );
  const hasPartialClaim = parsed.claims.some(({ status }) => status === "partial");
  const hasUncitedClaimEvidence = parsed.claims.some((claim) =>
    claim.sourceIds.some((id) => allowedSources.get(id)?.citedByAnswer !== true),
  );
  if (
    hasUnsupportedClaim &&
    (gates.get("facts")?.status !== "failed" ||
      gates.get("citations")?.status !== "failed" ||
      (dimensions.get("correctness")?.level ?? 4) > 2 ||
      (dimensions.get("citations")?.level ?? 4) > 2)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "无支持陈述与事实、引用门禁或评分不一致",
    );
  }
  if (
    hasPartialClaim &&
    (gates.get("citations")?.status !== "failed" ||
      (dimensions.get("correctness")?.level ?? 4) >= 4 ||
      (dimensions.get("citations")?.level ?? 4) >= 4)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "部分支持陈述与引用门禁或评分不一致",
    );
  }
  if (
    hasUncitedClaimEvidence &&
    (gates.get("citations")?.status !== "failed" ||
      (dimensions.get("citations")?.level ?? 4) > 2)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "陈述依据未被回答引用，但引用门禁或评分仍标记为通过",
    );
  }
  return parsed;
}

export type EnterpriseRagEvaluationResultPayload = {
  skillId: string;
  version: string;
  status: "not_run" | "pending" | "completed" | "failed";
  score: number | null;
  coverage: number;
  recommendation:
    | "recommended"
    | "publish_with_risk"
    | "not_recommended";
  summary: string;
  dimensions: Array<{
    id: string;
    label: string;
    status: "passed" | "partial" | "failed" | "pending" | "not_applicable";
    score: number | null;
    maxScore: number;
    summary: string;
    evidenceIds: string[];
  }>;
  risks: Array<{
    id: string;
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    summary: string;
    evidenceIds: string[];
  }>;
  relatedReportIds: string[];
};

export type EnterpriseRagEvaluationReport = {
  reportId: string;
  sourceQaTaskId: string;
  sourceTurnId: string;
  conversationId: string;
  questionMessageId: string;
  answerMessageId: string;
  questionHash: string;
  answerHash: string;
  knowledgeBase: EnterpriseRagEvaluationFrozenInput["knowledgeBase"];
  evaluator: EnterpriseRagEvaluationFrozenInput["evaluator"] & {
    provider: string;
    model: string;
    effort: string | null;
    skillHash: string;
    outputHash: string;
  };
  judgments: EnterpriseRagJudgeOutput;
  result: EnterpriseRagEvaluationResultPayload;
  createdAt: string;
  completedAt: string;
};

export type EnterpriseRagEvaluationRunDto = {
  operationId: string;
  sourceQaTaskId: string;
  turnId: string;
  status:
    | "queued"
    | "uploading"
    | "create_unknown"
    | "running"
    | "result_pending"
    | "completed"
    | "failed";
  createdAt: string;
  updatedAt: string;
  report: EnterpriseRagEvaluationReport | null;
  error: { code: string; message: string } | null;
};

export type EnterpriseRagEvaluationStartInput = {
  clientRequestId: string;
  sourceQaTaskId: string;
  turnId: string;
};

export type EnterpriseRagEvaluationHistoryDto = {
  latest: EnterpriseRagEvaluationRunDto | null;
  history: EnterpriseRagEvaluationRunDto[];
};
