import { z } from "zod";
import {
  RAG_DIMENSIONS,
  RAG_GATES,
  type DimensionJudgment,
  type GateJudgment,
} from "../client/dashboard/ai-website-preview/rag-evaluation.js";

export const enterpriseRagReviewAlignmentSchema = z.enum([
  "aligned",
  "human_more_positive",
  "human_more_negative",
  "mixed",
  "insufficient_information",
]);
export type EnterpriseRagReviewAlignment = z.infer<typeof enterpriseRagReviewAlignmentSchema>;

export const enterpriseRagReviewCaseStatusSchema = z.enum([
  "aligned",
  "pending_analysis",
  "needs_reconciliation",
  "included_in_proposal",
  "insufficient_information",
  "not_adopted",
  "resolved_by_version",
]);
export type EnterpriseRagReviewCaseStatus = z.infer<typeof enterpriseRagReviewCaseStatusSchema>;
/** Backward-compatible UI name retained for the existing review panel. */
export type EnterpriseRagReviewStatus = EnterpriseRagReviewCaseStatus;

const dimensionIdSchema = z.enum(RAG_DIMENSIONS.map(({ id }) => id) as [
  DimensionJudgment["id"],
  ...DimensionJudgment["id"][],
]);
const gateIdSchema = z.enum(RAG_GATES.map(({ id }) => id) as [
  GateJudgment["id"],
  ...GateJudgment["id"][],
]);
const evidenceIdSchema = z.string().trim().min(1).max(255);

export const enterpriseRagHumanDimensionSchema = z.object({
  id: dimensionIdSchema,
  level: z.number().int().min(0).max(4).nullable(),
  rationale: z.string().trim().max(4_000),
  evidenceIds: z.array(evidenceIdSchema).max(20),
  applicable: z.boolean(),
}).strict();

export const enterpriseRagHumanGateSchema = z.object({
  id: gateIdSchema,
  status: z.enum(["passed", "failed", "pending"]),
  reason: z.string().trim().max(4_000),
}).strict();

export const enterpriseRagHumanReviewCreateSchema = z.object({
  clientRequestId: z.string().uuid(),
  operationId: z.string().uuid(),
  reportId: z.string().uuid(),
  dimensions: z.array(enterpriseRagHumanDimensionSchema).length(RAG_DIMENSIONS.length),
  gates: z.array(enterpriseRagHumanGateSchema).length(RAG_GATES.length),
  confirmed: z.literal(true),
  supersedesReviewId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.dimensions.some((item, index) => item.id !== RAG_DIMENSIONS[index]?.id)) {
    context.addIssue({ code: "custom", path: ["dimensions"], message: "人工评审维度缺失、重复或顺序不正确" });
  }
  if (value.gates.some((item, index) => item.id !== RAG_GATES[index]?.id)) {
    context.addIssue({ code: "custom", path: ["gates"], message: "人工评审风险项缺失、重复或顺序不正确" });
  }
}) as z.ZodType<EnterpriseRagHumanReviewCreateInput>;
export type EnterpriseRagHumanReviewCreateInput = {
  clientRequestId: string;
  operationId: string;
  reportId: string;
  dimensions: EnterpriseRagHumanDimensionJudgment[];
  gates: EnterpriseRagHumanGateJudgment[];
  confirmed: true;
  supersedesReviewId?: string;
};

export type EnterpriseRagReviewVerdict = "excellent" | "usable" | "improve" | "unusable" | "pending";
/** Backward-compatible UI name retained for the existing review panel. */
export type EnterpriseRagHumanVerdict = EnterpriseRagReviewVerdict;
export type EnterpriseRagHumanDimensionJudgment = DimensionJudgment;
export type EnterpriseRagHumanGateJudgment = GateJudgment;
export type EnterpriseRagReviewDiff = {
  alignment: EnterpriseRagReviewAlignment;
  overall?: {
    aiVerdict: EnterpriseRagReviewVerdict;
    aiScore: number | null;
    humanVerdict: EnterpriseRagReviewVerdict;
    humanScore: number | null;
  };
  dimensions: Array<{
    id: DimensionJudgment["id"];
    /** Server-normalized 0-4 bucket; the immutable report keeps its exact score. */
    aiLevel: number | null;
    humanLevel: DimensionJudgment["level"];
  }>;
  gates: Array<{
    id: GateJudgment["id"];
    aiStatus: GateJudgment["status"];
    humanStatus: GateJudgment["status"];
  }>;
};

export type EnterpriseRagHumanReviewDto = {
  id: string;
  clientRequestId: string;
  operationId: string;
  reportId: string;
  reviewer: { userId: number; displayName: string };
  createdAt: string;
  supersedesReviewId: string | null;
  humanVerdict: EnterpriseRagReviewVerdict;
  humanScore: number | null;
  alignment: EnterpriseRagReviewAlignment;
  status: EnterpriseRagReviewCaseStatus;
  snapshot: {
    question: string;
    answer: string;
    need: string;
    knowledgeVersion: string;
  };
  dimensions: DimensionJudgment[];
  gates: GateJudgment[];
  diff: EnterpriseRagReviewDiff;
};

export type EnterpriseRagReviewContextDto = {
  operationId: string;
  reportId: string;
  canReview: boolean;
  reason: string | null;
  reviewer: { userId: number; displayName: string };
  ai: {
    verdict: EnterpriseRagReviewVerdict;
    score: number | null;
    dimensions: Array<{ id: DimensionJudgment["id"]; level: number | null }>;
    gates: Array<{ id: GateJudgment["id"]; status: GateJudgment["status"] }>;
  };
  reviews: EnterpriseRagHumanReviewDto[];
};

export type EnterpriseRagHumanReviewCreateResult = {
  review: EnterpriseRagHumanReviewDto;
  diff: EnterpriseRagReviewDiff;
};

export type EnterpriseRagHumanReviewListDto = {
  reviews: EnterpriseRagHumanReviewDto[];
};
