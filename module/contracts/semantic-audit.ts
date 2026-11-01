import { z } from "zod";
import { categorySchema } from "./diagnostics.js";

export const SEMANTIC_AUDIT_VERSION = "brand_question_semantic_audit_v1" as const;
export const SEMANTIC_AUDIT_DIMENSIONS = [
  { id: "visibility", label: "语义可见度", maximum: 30 },
  { id: "consistency", label: "语义一致性", maximum: 20 },
  { id: "depth", label: "语义多样性与深度", maximum: 20 },
  { id: "authority", label: "语义权威性", maximum: 15 },
  { id: "competition", label: "竞争表现", maximum: 15 },
] as const;
export const SEMANTIC_AUDIT_METRICS = [
  { id: "accurate_recognition", label: "准确认知覆盖", dimension: "visibility", weight: 15 },
  { id: "brand_evidence", label: "品牌证据覆盖", dimension: "visibility", weight: 10 },
  { id: "sample_coverage", label: "有效样本覆盖", dimension: "visibility", weight: 5 },
  { id: "core_claims", label: "核心主张表达", dimension: "consistency", weight: 12 },
  { id: "tone", label: "语调一致性", dimension: "consistency", weight: 8 },
  { id: "key_aspects", label: "关键方面覆盖", dimension: "depth", weight: 10 },
  { id: "supported_entities", label: "受支持实体覆盖", dimension: "depth", weight: 6 },
  { id: "answer_depth", label: "回答层次完整", dimension: "depth", weight: 4 },
  { id: "authoritative_support", label: "权威来源支持", dimension: "authority", weight: 8 },
  { id: "claim_traceability", label: "重要主张可追溯", dimension: "authority", weight: 4 },
  { id: "independent_support", label: "独立证据支持", dimension: "authority", weight: 3 },
  { id: "verified_differences", label: "已验证差异点覆盖", dimension: "competition", weight: 8 },
  { id: "difference_accuracy", label: "差异化表达准确度", dimension: "competition", weight: 7 },
] as const;
export type SemanticDimensionId = (typeof SEMANTIC_AUDIT_DIMENSIONS)[number]["id"];
export type SemanticMetricId = (typeof SEMANTIC_AUDIT_METRICS)[number]["id"];
const text = z.string().trim().min(1).max(1600);
const modelMetricIds = SEMANTIC_AUDIT_METRICS.filter((m) => m.id !== "sample_coverage").map((m) => m.id);
export const semanticAuditOutputSchema = z.object({
  category: categorySchema,
  checkedSampleIds: z.array(text).min(1).max(30),
  metrics: z.array(z.object({
    id: z.enum(modelMetricIds),
    status: z.enum(["scored", "insufficient", "not_applicable"]),
    value: z.union([z.literal(0), z.literal(0.5), z.literal(1), z.null()]),
    explanation: text,
    satisfied: z.string().max(1600),
    limitations: z.string().max(1600),
    knowledgeRefs: z.array(z.object({ docPath: text, excerpt: text }).strict()).max(10),
    answerRefs: z.array(z.object({ sampleId: text, excerpt: text }).strict()).max(30),
  }).strict()).length(12),
  findings: z.array(z.object({
    dimension: z.enum(SEMANTIC_AUDIT_DIMENSIONS.map((d) => d.id)),
    text: z.string().trim().min(1).max(500),
  }).strict()).length(5),
}).strict();
export type SemanticAuditOutput = z.infer<typeof semanticAuditOutputSchema>;
export type SemanticAuditMetric = Omit<SemanticAuditOutput["metrics"][number], "id" | "value"> & {
  id: SemanticMetricId;
  value: number | null;
  label: string;
  dimension: SemanticDimensionId;
  weight: number;
  score: number | null;
  method: "model" | "calculated";
};
export type SemanticAuditResult = {
  category: z.infer<typeof categorySchema>;
  schemaVersion: 1;
  scoringVersion: typeof SEMANTIC_AUDIT_VERSION;
  skillVersion: string;
  inputHash: string;
  generatedAt: string;
  model: string;
  fallback: boolean;
  samples: number;
  plannedSamples: number;
  metrics: SemanticAuditMetric[];
  dimensions: Array<{
    id: SemanticDimensionId;
    label: string;
    maximum: number;
    score: number | null;
    status: "scored" | "insufficient" | "not_applicable";
    assessed: number;
    total: number;
    finding: string;
  }>;
};
