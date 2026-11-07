import type { RagCase } from "./rag-evaluation-cases";
import type { buildRagImprovementPlan } from "./rag-improvement-plan";

export type RagPreviewFixtures = {
  cases: readonly RagCase[];
  findSample: (question: string) => RagCase | undefined;
  knowledgeVersion: string;
  exampleLabel: string;
  assistantName: string;
  buildImprovementPlan: typeof buildRagImprovementPlan;
};

let cachedFixtures: RagPreviewFixtures | null = null;
let pendingFixtures: Promise<RagPreviewFixtures> | null = null;

/** Vite replaces these values at build time, pruning preview-only chunks. */
export const ragPreviewFixturesEnabled =
  import.meta.env.DEV ||
  import.meta.env.MODE === "preview" ||
  import.meta.env.MODE === "test";

export function peekRagPreviewFixtures() {
  return cachedFixtures;
}

/** Used by the lazy preview entry and by unit tests that intentionally load fixtures. */
export function installRagPreviewFixtures(fixtures: RagPreviewFixtures) {
  cachedFixtures = fixtures;
  return fixtures;
}

/**
 * This is the only runtime import edge to the synthetic cases. Calling code
 * must first prove it is on an interactive local-preview path.
 */
export function loadRagPreviewFixtures() {
  if (cachedFixtures) return Promise.resolve(cachedFixtures);
  if (!ragPreviewFixturesEnabled) {
    return Promise.reject(new Error("本地预览数据在当前构建中不可用。"));
  }
  if (!pendingFixtures) {
    pendingFixtures = import("./rag-preview-fixtures-data").then((module) =>
      installRagPreviewFixtures(module.ragPreviewFixtures),
    );
  }
  return pendingFixtures;
}
