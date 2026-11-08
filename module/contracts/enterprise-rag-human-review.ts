import type {
  EnterpriseRagDimensionId,
  EnterpriseRagGateId,
} from "./enterprise-rag-evaluation-run.js";

export type EnterpriseRagHumanVerdict =
  | "excellent"
  | "usable"
  | "improve"
  | "unusable"
  | "pending";

export type EnterpriseRagReviewAlignment =
  | "aligned"
  | "human_more_positive"
  | "human_more_negative"
  | "mixed"
  | "insufficient_information";

export type EnterpriseRagReviewStatus =
  | "aligned"
  | "pending_analysis"
  | "needs_reconciliation"
  | "included_in_proposal"
  | "insufficient_information"
  | "not_adopted"
  | "resolved_by_version";

export type EnterpriseRagHumanDimensionJudgment = {
  id: EnterpriseRagDimensionId;
  level: 0 | 1 | 2 | 3 | 4 | null;
  rationale: string;
  evidenceIds: string[];
  applicable: boolean;
};

export type EnterpriseRagHumanGateJudgment = {
  id: EnterpriseRagGateId;
  status: "passed" | "failed" | "pending";
  reason: string;
};

export type EnterpriseRagReviewDiff = {
  alignment: EnterpriseRagReviewAlignment;
  overall?: {
    aiVerdict: EnterpriseRagHumanVerdict;
    aiScore: number | null;
    humanVerdict: EnterpriseRagHumanVerdict;
    humanScore: number | null;
  };
  dimensions: Array<{
    id: EnterpriseRagDimensionId;
    /** Server-normalized 0-4 bucket; the immutable report keeps its exact score. */
    aiLevel: number | null;
    humanLevel: 0 | 1 | 2 | 3 | 4 | null;
  }>;
  gates: Array<{
    id: EnterpriseRagGateId;
    aiStatus: "passed" | "failed" | "pending";
    humanStatus: "passed" | "failed" | "pending";
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
  snapshot: {
    question: string;
    answer: string;
    need: string;
    knowledgeVersion: string;
  };
  humanVerdict: EnterpriseRagHumanVerdict;
  humanScore: number | null;
  alignment: EnterpriseRagReviewAlignment;
  status: EnterpriseRagReviewStatus;
  dimensions: EnterpriseRagHumanDimensionJudgment[];
  gates: EnterpriseRagHumanGateJudgment[];
  diff: EnterpriseRagReviewDiff;
};

export type EnterpriseRagReviewContextDto = {
  operationId: string;
  reportId: string;
  canReview: boolean;
  reason: string | null;
  reviewer: { userId: number; displayName: string };
  ai: {
    verdict: EnterpriseRagHumanVerdict;
    score: number | null;
    dimensions: Array<{ id: EnterpriseRagDimensionId; level: number | null }>;
    gates: Array<{
      id: EnterpriseRagGateId;
      status: "passed" | "failed" | "pending";
    }>;
  };
  reviews: EnterpriseRagHumanReviewDto[];
};

export type EnterpriseRagHumanReviewCreateInput = {
  clientRequestId: string;
  operationId: string;
  reportId: string;
  dimensions: EnterpriseRagHumanDimensionJudgment[];
  gates: EnterpriseRagHumanGateJudgment[];
  confirmed: true;
  supersedesReviewId?: string;
};

export type EnterpriseRagHumanReviewCreateResult = {
  review: EnterpriseRagHumanReviewDto;
  diff: EnterpriseRagReviewDiff;
};

export type EnterpriseRagHumanReviewListDto = {
  reviews: EnterpriseRagHumanReviewDto[];
};
