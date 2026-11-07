import { z } from "zod";

export const RAG_STARTER_QUESTION_COUNT = 3;
export const RAG_STARTER_PROMPT_VERSION = "rag-starter-questions-v1";

export const DEFAULT_RAG_STARTER_QUESTIONS = [
  "可以简单介绍一下你们吗？",
  "你们主要提供哪些产品或服务？",
  "我可以先了解哪些核心信息？",
] as const;

export const ragStarterQuestionTextSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((value) => !/[\r\n\u0000-\u001f\u007f]/u.test(value), {
    message: "预设问题必须是单行可见文本",
  });

export function normalizeRagStarterQuestion(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function parseRagStarterQuestionTexts(value: unknown): [string, string, string] {
  const questions = z
    .array(ragStarterQuestionTextSchema)
    .length(RAG_STARTER_QUESTION_COUNT)
    .parse(value)
    .map((item) => item.trim()) as [string, string, string];
  if (new Set(questions.map(normalizeRagStarterQuestion)).size !== RAG_STARTER_QUESTION_COUNT) {
    throw new z.ZodError([{
      code: "custom",
      message: "三个预设问题不得重复",
      path: ["questions"],
    }]);
  }
  return questions;
}

export type RagStarterQuestionEvidence = {
  text: string;
  sourceAliases: string[];
};

export const generatedRagStarterQuestionsSchema = z
  .object({
    operationToken: z.string().min(16).max(160),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    questions: z
      .array(z.object({
        text: ragStarterQuestionTextSchema,
        sourceAliases: z
          .array(z.string().regex(/^KB-[0-9]{3}$/u))
          .min(1)
          .max(5),
      }).strict())
      .length(RAG_STARTER_QUESTION_COUNT),
  })
  .strict();

export function parseGeneratedRagStarterQuestions(
  value: unknown,
  expected: {
    operationToken: string;
    inputHash: string;
    allowedSourceAliases: ReadonlySet<string>;
  },
): [RagStarterQuestionEvidence, RagStarterQuestionEvidence, RagStarterQuestionEvidence] {
  const result = generatedRagStarterQuestionsSchema.parse(value);
  if (result.operationToken !== expected.operationToken || result.inputHash !== expected.inputHash) {
    throw new Error("RAG_STARTER_RESULT_IDENTITY_MISMATCH");
  }
  parseRagStarterQuestionTexts(result.questions.map((item) => item.text));
  for (const question of result.questions) {
    if (new Set(question.sourceAliases).size !== question.sourceAliases.length ||
        question.sourceAliases.some((alias) => !expected.allowedSourceAliases.has(alias))) {
      throw new Error("RAG_STARTER_RESULT_SOURCE_INVALID");
    }
  }
  return result.questions as [
    RagStarterQuestionEvidence,
    RagStarterQuestionEvidence,
    RagStarterQuestionEvidence,
  ];
}

export const ragStarterRegenerationInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  expectedCurrentSetId: z.string().uuid().nullable(),
  expectedDraftSetId: z.string().uuid().nullable(),
}).strict();

export const ragStarterCurrentInputSchema = z.object({
  expectedCurrentSetId: z.string().uuid().nullable(),
  expectedDraftSetId: z.string().uuid().nullable(),
  questions: z.array(ragStarterQuestionTextSchema).length(RAG_STARTER_QUESTION_COUNT),
}).strict();

export const ragStarterDiscardInputSchema = z.object({
  expectedCurrentSetId: z.string().uuid().nullable(),
  expectedDraftSetId: z.string().uuid(),
}).strict();

export type RagStarterQuestionSetDto = {
  id: string;
  questions: [string, string, string];
  source: "automatic" | "regenerate" | "manual";
  knowledgeSnapshotId: string;
  createdAt: string;
};

export type RagStarterQuestionsDto = {
  knowledgeBase: {
    id: string;
    version: number;
    archiveHash: string | null;
    documentCount: number;
  } | null;
  current: RagStarterQuestionSetDto | null;
  draft: RagStarterQuestionSetDto | null;
  pending: boolean;
  pendingSetId?: string;
  error: string | null;
  errorCode?: string;
  revision: number;
};
