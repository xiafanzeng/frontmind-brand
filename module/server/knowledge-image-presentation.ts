import { z } from "zod";
import type { ConversationTurn } from "@frontmind/module-brand/contracts/core-records";
import type { KnowledgeBaseBuild, KnowledgeBaseBuildNode } from "@frontmind/module-brand/schema";
import {
  canonicalKnowledgeBaseMarkdown,
  knowledgeBaseMarkdownSha256,
} from "./knowledge-base-package-validation.js";
import { normalizeKnowledgeBaseCustomerMarkdownImages } from "./knowledge-base-markdown-normalization.js";
import type {createKnowledgeBaseAuthoritativeMessages} from "./knowledge-base-authoritative-message.js";

export type KnowledgeImagePresentationDependencies = Pick<ReturnType<typeof createKnowledgeBaseAuthoritativeMessages>,"knowledgeBasePresentationKey">;
export function createKnowledgeImagePresentation(core: KnowledgeImagePresentationDependencies) {
const { knowledgeBasePresentationKey } = core;


const proofSchema = z
  .object({
    schemaVersion: z.literal(1),
    buildId: z.string(),
    generation: z.number().int(),
    revision: z.number().int(),
    contentVersion: z.number().int(),
    workingSetId: z.string(),
    leafId: z.string(),
    contentSha256: z.string(),
    presentationKey: z.string(),
  })
  .strict();

function createKnowledgeImagePresentationProof(input: {
  buildId: string;
  generation: number;
  revision: number;
  contentVersion: number;
  workingSetId: string;
  leafId: string;
  markdown: string;
}) {
  const { markdown, ...coordinates } = input;
  const visibleMarkdown = canonicalKnowledgeBaseMarkdown(
    normalizeKnowledgeBaseCustomerMarkdownImages(markdown).markdown,
  );
  return {
    schemaVersion: 1 as const,
    ...coordinates,
    contentSha256: knowledgeBaseMarkdownSha256(visibleMarkdown),
    presentationKey: knowledgeBasePresentationKey({
      ...coordinates,
      content: visibleMarkdown,
    }),
  };
}

/** The exact completed local mutation owns current display coordinates, without
 * adding a user/assistant message or reinterpreting an old provider response. */
function projectKnowledgeImagePresentation(input: {
  build: KnowledgeBaseBuild;
  node: KnowledgeBaseBuildNode | null;
  turn: Pick<
    ConversationTurn,
    "id" | "clientRequestId" | "metadata" | "status"
  > | null;
}) {
  const { build, node, turn } = input;
  if (
    !node ||
    !turn ||
    build.activeTurnId ||
    turn.status !== "completed" ||
    node.sourceTurnId !== turn.id
  )
    return null;
  const metadata = turn.metadata as Record<string, unknown> | null;
  if (metadata?.execution !== "local" || metadata.providerRequestCount !== 0)
    return null;
  const library = metadata.imageLibrary as Record<string, unknown> | undefined;
  const parsed = proofSchema.safeParse(library?.currentPresentation);
  if (!parsed.success) return null;
  const proof = parsed.data;
  const expected = createKnowledgeImagePresentationProof({
    buildId: build.id,
    generation: build.generation,
    revision: build.revision,
    contentVersion: build.contentVersion!,
    workingSetId: build.activeWorkingSetId!,
    leafId: node.leafId,
    markdown: node.contentMarkdown ?? "",
  });
  if (
    Object.entries(expected).some(
      ([key, value]) => proof[key as keyof typeof proof] !== value,
    ) ||
    build.currentLeafId !== node.leafId ||
    build.currentPresentationKey !== proof.presentationKey ||
    node.presentationKey !== proof.presentationKey ||
    node.contentVersion !== proof.contentVersion
  )
    return null;
  return {
    turnId: turn.id,
    clientRequestId: turn.clientRequestId,
    generation: proof.generation,
    revision: proof.revision,
    leafId: proof.leafId,
    presentationKey: proof.presentationKey,
    contentSha256: proof.contentSha256,
    visibleMarkdown: canonicalKnowledgeBaseMarkdown(
      normalizeKnowledgeBaseCustomerMarkdownImages(node.contentMarkdown ?? "")
        .markdown,
    ),
    acceptedAt: (node.lastResponseAt || node.updatedAt).getTime(),
  };
}
return { createKnowledgeImagePresentationProof, projectKnowledgeImagePresentation };
}
