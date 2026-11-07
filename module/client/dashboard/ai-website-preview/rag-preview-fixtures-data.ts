import {
  findRagSample,
  RAG_SAMPLE_CASES,
} from "./rag-evaluation-cases";
import { buildRagImprovementPlan } from "./rag-improvement-plan";
import type { RagPreviewFixtures } from "./rag-preview-fixture-loader";

/**
 * Synthetic records used only by the local preview build. Keep all fixture
 * values behind the preview-only dynamic import boundary.
 */
export const ragPreviewFixtures: RagPreviewFixtures = {
  cases: RAG_SAMPLE_CASES,
  findSample: findRagSample,
  knowledgeVersion: "KB-SYN-v1",
  exampleLabel: "合成示例",
  assistantName: "FrontMind 企业助手",
  buildImprovementPlan: buildRagImprovementPlan,
};
