import { z } from "zod";

export const DIAGNOSTIC_CATEGORIES = [
  "industry_ranking",
  "competitor_comparison",
  "reputation",
  "product_scenario",
] as const;
export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];
export const DIAGNOSTIC_LABELS: Record<DiagnosticCategory, string> = {
  industry_ranking: "行业排名",
  competitor_comparison: "竞品对比",
  reputation: "美誉舆情",
  product_scenario: "产品场景",
};
export const DIAGNOSTIC_PLATFORMS = [
  { id: "doubao", label: "豆包" },
  { id: "yuanbao", label: "腾讯元宝" },
  { id: "qianwen", label: "千问" },
] as const;
export const DIAGNOSTIC_MODEL_POLICY = "brand_diagnostics_v1" as const;
export const categorySchema = z.enum(DIAGNOSTIC_CATEGORIES);
const short = z.string().trim().min(1).max(1000);
export const questionSchema = z
  .object({
    category: categorySchema,
    text: z.string().trim().min(4).max(500),
    source: z.enum(["recommended", "custom"]),
  })
  .strict();
export type DiagnosticQuestion = z.infer<typeof questionSchema> & {
  validation?: { accepted: boolean; reason: string; inputHash: string };
};
export type KnowledgeBasis = {
  snapshotId: string;
  version: number;
  buildId: string;
  conversationId: string;
  companyName: string;
  contentHash: string;
  documents: Array<{
    path: string;
    title: string;
    content: string;
    evidenceStatus?: string;
  }>;
};
export type KnowledgeReadiness = {
  ready: boolean;
  status: "missing" | "confirming" | "publishing" | "ready";
  message: string;
  confirmed: number;
  total: number;
  companyName: string;
  snapshotId: string | null;
  version: number | null;
  conversationId: string | null;
};
export const recommendationSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            category: categorySchema,
            text: z.string().trim().min(4).max(500),
            rationale: short,
            evidenceRefs: z.array(short).min(1).max(8),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const validationSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            category: categorySchema,
            text: z.string().trim().min(4).max(500),
            accepted: z.boolean(),
            reason: short,
            evidenceRefs: z.array(short).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
const ref = z
  .object({ sampleId: short, excerpt: z.string().min(1).max(1800) })
  .strict();
const topic = z
  .object({
    topic: short,
    verdict: z.enum(["supported", "contradicted", "omitted", "unverifiable"]),
    docPath: z.string().max(500).nullable(),
    kbExcerpt: z.string().max(1800).nullable(),
    answerRefs: z.array(ref).max(30),
    explanation: short,
  })
  .strict();
const common = { sampleId: short };
const attribution = z.enum(["subject", "parent_only", "uncertain", "none"]);
const rankingAnswer = z
  .object({
    ...common,
    mentioned: z.boolean(),
    attribution,
    mentionEvidence: z.string().max(1600),
    recommended: z.boolean(),
    rank: z.number().int().positive().max(100).nullable(),
    recommendationEvidence: z.string().max(1600),
    competitors: z
      .array(
        z
          .object({
            name: short,
            rank: z.number().int().positive().max(100).nullable(),
            excerpt: short,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
const comparisonAnswer = z
  .object({
    ...common,
    preference: z.enum(["subject", "competitor", "balanced", "unspecified"]),
    preferenceEvidence: z.string().max(1600),
    dimensions: z
      .array(
        z
          .object({
            name: short,
            subjectClaim: z.string().max(1600),
            competitorClaim: z.string().max(1600),
            excerpt: short,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const reputationAnswer = z
  .object({
    ...common,
    sentiment: z.enum(["positive", "neutral", "negative", "mixed", "unknown"]),
    sentimentEvidence: z.string().max(1600),
    risks: z.array(z.object({ theme: short, excerpt: short }).strict()).max(12),
  })
  .strict();
const productAnswer = z
  .object({
    ...common,
    claims: z
      .array(
        z
          .object({
            claim: short,
            excerpt: short,
            verdict: z.enum(["supported", "contradicted", "unverifiable"]),
            docPath: z.string().max(500).nullable(),
            kbExcerpt: z.string().max(1600).nullable(),
          })
          .strict(),
      )
      .max(15),
  })
  .strict();
const assessmentBase = {
  summary: z.string().trim().min(8).max(500),
  topics: z.array(topic).min(1).max(10),
};
export const assessmentSchema = z.discriminatedUnion("category", [
  z
    .object({
      category: z.literal("industry_ranking"),
      ...assessmentBase,
      answers: z.array(rankingAnswer).min(1).max(30),
    })
    .strict(),
  z
    .object({
      category: z.literal("competitor_comparison"),
      ...assessmentBase,
      answers: z.array(comparisonAnswer).min(1).max(30),
    })
    .strict(),
  z
    .object({
      category: z.literal("reputation"),
      ...assessmentBase,
      answers: z.array(reputationAnswer).min(1).max(30),
    })
    .strict(),
  z
    .object({
      category: z.literal("product_scenario"),
      ...assessmentBase,
      knowledgeCoverage: z
        .array(
          z
            .object({
              point: short,
              docPath: short,
              kbExcerpt: z.string().min(1).max(1600),
              answers: z
                .array(
                  z
                    .object({
                      sampleId: short,
                      covered: z.boolean(),
                      excerpt: z.string().max(1600),
                    })
                    .strict(),
                )
                .min(1)
                .max(30),
            })
            .strict(),
        )
        .max(8),
      answers: z.array(productAnswer).min(1).max(30),
    })
    .strict(),
]);
export type DiagnosticAssessment = z.infer<typeof assessmentSchema>;
export type DiagnosticRecommendation = z.infer<
  typeof recommendationSchema
>["questions"][number];
export type DiagnosticSample = {
  id: string;
  category: DiagnosticCategory;
  platform: string;
  run: number;
  question: string;
  answer: string;
  citations: Array<{ title: string; url: string; site?: string }>;
  references?: Array<{ title: string; url: string; site?: string }>;
  collectedAt?: string;
};
export type DiagnosticMetric = {
  id: string;
  label: string;
  value: number | null;
  denominator?: number;
  unit: "%" | "位" | "份" | "项";
  sampleIds: string[];
};
export type DiagnosticResult = {
  assessment: DiagnosticAssessment;
  metrics: DiagnosticMetric[];
  generatedAt: string;
  model: string;
  fallback: boolean;
  algorithm: "brand_diagnostics_v1" | "brand_diagnostics_v2";
  samples: number;
  breakdown: DiagnosticBreakdown;
};
export type DiagnosticBreakdown = {
  platforms: Array<{
    id: string;
    label: string;
    samples: number;
    metrics: DiagnosticMetric[];
  }>;
  ranks: Array<{
    id: string;
    name: string;
    mentions: number;
    averageRank: number | null;
    rankedSamples: number;
    barPercent: number;
    sampleIds: string[];
  }>;
  risks: Array<{
    id: string;
    theme: string;
    count: number;
    denominator: number;
    sampleIds: string[];
  }>;
  coverage: Array<{
    id: string;
    topic: string;
    verdict: "covered" | "omitted";
    missingId: string;
    missingSampleIds: string[];
    platforms: Array<{ platform: string; count: number; denominator: number }>;
    sampleIds: string[];
  }>;
  sources: Array<{
    id: string;
    url: string;
    title: string;
    kind: "citation" | "reference";
    count: number;
    sampleIds: string[];
  }>;
  drilldowns: Array<{ id: string; label: string; sampleIds: string[] }>;
};
export type DiagnosticJob = {
  id: string;
  taskId: string;
  kind: "recommend" | "validate" | "assess";
  category?: DiagnosticCategory;
  inputHash: string;
  status:
    | "queued"
    | "submitting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  providerTaskId?: string;
  error?: string;
  model: string;
  fallback: boolean;
  repairCount: number;
  repairPending?: boolean;
  repairPrompt?: string;
  modelFallbacks?: Array<{ model: string; effort: string; at: number }>;
  baselineEventIds?: string[];
  input: unknown;
  lease?: { owner: string; until: number };
};
export type DiagnosticAttempt = {
  id: string;
  category: DiagnosticCategory;
  question: string;
  platform: string;
  run: number;
  status:
    | "queued"
    | "submitting"
    | "submitted"
    | "completed"
    | "failed"
    | "submission_unknown";
  taskId?: string;
  submittedAt?: string;
  nextPollAt?: number;
  error?: string;
  sample?: DiagnosticSample;
};
export type DiagnosticRun = {
  id: string;
  version: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  phase:
    | "draft"
    | "collecting"
    | "analyzing"
    | "completed"
    | "partial"
    | "stopped";
  subject: string;
  subjectScope: string;
  basis: KnowledgeBasis;
  questions: DiagnosticQuestion[];
  platforms: string[];
  recommendations: DiagnosticRecommendation[];
  jobs: DiagnosticJob[];
  attempts: DiagnosticAttempt[];
  results: Partial<Record<DiagnosticCategory, DiagnosticResult>>;
  confirmedAt?: string;
  events: Array<{
    id: string;
    at: string;
    message: string;
    category?: DiagnosticCategory;
  }>;
  lease?: { owner: string; until: number };
};
export type DiagnosticRunView = Omit<
  DiagnosticRun,
  "basis" | "attempts" | "jobs" | "lease"
> & {
  basis: Omit<KnowledgeBasis, "documents">;
  attempts: Array<
    Omit<DiagnosticAttempt, "sample" | "taskId"> & { hasAnswer: boolean }
  >;
  jobs: Array<
    Omit<
      DiagnosticJob,
      | "input"
      | "lease"
      | "providerTaskId"
      | "baselineEventIds"
      | "repairPending"
      | "repairPrompt"
    >
  >;
  expectedSamples: number;
  completedSamples: number;
};
export type DiagnosticWorkspace = {
  knowledge: KnowledgeReadiness;
  platforms: typeof DIAGNOSTIC_PLATFORMS;
  repeatPerPlatform: 5;
  model: "gpt-6.1-sol";
  fallbackModel: "gpt-5.6-sol";
  runs: Array<{
    id: string;
    subject: string;
    createdAt: string;
    phase: DiagnosticRun["phase"];
  }>;
};

/** Keep history for auditing, but use only the latest attempt for each model step. */
export function latestDiagnosticJobs<
  T extends Pick<DiagnosticJob, "kind" | "category">,
>(jobs: readonly T[]): T[] {
  const steps = new Map<string, T>();
  for (const job of jobs) steps.set(`${job.kind}:${job.category ?? ""}`, job);
  return [...steps.values()];
}
