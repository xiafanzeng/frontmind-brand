import { createHash } from "node:crypto";
import type { ConversationTurn } from "../contracts/core-records.js";
import type { KnowledgeBaseBuild } from "../schema/index.js";
import type { KnowledgeBaseDraftLeafDto, KnowledgeBaseDraftPreviewDto } from "../contracts/knowledge-base-public-progress.js";
import { projectKnowledgeBaseCustomerMarkdown, validateKnowledgeBaseWorkingSetArchive } from "../contracts/knowledge-base-materialized-contract.js";
import { assertKnowledgeProsePreserved } from "../contracts/knowledge-node-prose.js";
import { knowledgeProseSaveRecoveryCandidate } from "../contracts/knowledge-prose-recovery.js";
import type { createKnowledgeBaseLocalSourceStore } from "./knowledge-base-local-source-store.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Source = { storageKey: string; contentSha256: string; sizeBytes: number };
type DraftTurn = Pick<ConversationTurn, "id" | "userId" | "buildId" | "buildGeneration" | "operationType" | "operationKey" | "status" | "metadata" | "expectedRevision" | "errorCode" | "upstreamTaskId">;
type SourceLeaf = KnowledgeBaseDraftLeafDto & { originalSha256: string };
type Core = Pick<ReturnType<typeof createKnowledgeBaseLocalSourceStore>, "readKnowledgeBaseLocalSource">;

/** The source is selected from the owned turn, never from a browser path.
 * Keep draft output separate from formal nodes, versioning and publishability. */
export function createKnowledgeBaseDraftPreview(core: Core) {
  // Only immutable, validated source bodies are cached. Per-node state/output is
  // projected from the current transaction on every read, including after reset.
  const cache = new Map<string, { expiresAt: number; bytes: number; leaves: SourceLeaf[] }>();
  const MAX_CACHE_BYTES = 16 * 1024 * 1024;
  const MAX_BODY_BYTES = 2 * 1024 * 1024;

  function scopedSource(value: unknown, build: KnowledgeBaseBuild): Source {
    const source = record(value);
    const sha = String(source.contentSha256 ?? "");
    const storageKey = `knowledge-base/build-sources/${build.userId}/${build.id.toLowerCase()}/g${build.generation}/${sha}.bin`;
    if (!/^[a-f0-9]{64}$/.test(sha) || source.storageKey !== storageKey ||
        !Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) < 1)
      throw new Error("DRAFT_SOURCE_SCOPE_INVALID");
    return { storageKey, contentSha256: sha, sizeBytes: Number(source.sizeBytes) };
  }

  return async function loadKnowledgeBaseDraftPreview(input: {
    build: KnowledgeBaseBuild;
    turn?: DraftTurn | null;
    hasFormalNodes: boolean;
  }): Promise<KnowledgeBaseDraftPreviewDto | undefined> {
    const { build, turn } = input;
    if (input.hasFormalNodes || build.contentVersion !== 0 || build.activeWorkingSetId ||
        build.executionMode !== "materialized_bundle_v1" || !turn || turn.operationType !== "start" ||
        turn.userId !== build.userId || turn.buildId !== build.id || turn.buildGeneration !== build.generation ||
        !turn.operationKey || turn.status === "cancelled" ||
        (build.activeTurnId !== turn.id && !knowledgeProseSaveRecoveryCandidate({build, turn}))) return;
    const metadata = record(turn.metadata);
    const prose = record(metadata.proseEditing);
    if (!prose.sourceArchive || typeof prose.policyHash !== "string" || prose.policyHash !== metadata.proseEditingPolicy) return;
    const nodes = record(prose.nodes);
    const base = {
      turnId: turn.id,
      updatedAt: Number.isFinite(prose.updatedAt) ? Number(prose.updatedAt) : build.updatedAt.getTime(),
      totalNodes: Object.keys(nodes).length,
      processedNodes: Object.values(nodes).filter(value => record(value).state === "ready").length,
    };
    try {
      const source = scopedSource(prose.sourceArchive, build);
      const cacheKey = JSON.stringify([build.userId, build.id, build.generation, turn.id, turn.operationKey,
        build.skillContentHash, build.skillVersion, build.treePolicyVersion, build.companyName, source.contentSha256]);
      const cached = cache.get(cacheKey);
      let leaves = cached && cached.expiresAt > Date.now() ? cached.leaves : undefined;
      if (!leaves) {
        const bytes = await core.readKnowledgeBaseLocalSource(source);
        const validated = await validateKnowledgeBaseWorkingSetArchive(bytes);
        const manifest = validated.manifest;
        // Do not normalize a different operation/build into this preview.
        if (manifest.buildId !== build.id || manifest.generation !== build.generation ||
            manifest.operationId !== turn.operationKey || manifest.contentVersion !== 1 ||
            manifest.skill.contentHash !== build.skillContentHash || manifest.skill.version !== build.skillVersion ||
            manifest.treePolicyVersion !== build.treePolicyVersion || manifest.company.name !== build.companyName)
          throw new Error("DRAFT_COORDINATES_CHANGED");
        leaves = [...manifest.leaves].sort((a, b) => a.ordinal - b.ordinal).map(leaf => ({
          id: leaf.leafId, title: leaf.title, branchId: leaf.branchId, branchTitle: leaf.branchTitle, ordinal: leaf.ordinal,
          originalSha256: hash(validated.files.get(leaf.contentPath)!),
          contentMarkdown: projectKnowledgeBaseCustomerMarkdown({leafTitle: leaf.title, markdown: validated.files.get(leaf.contentPath)!.toString("utf8")}),
          contentSource: "original" as const, editingState: "pending" as const,
        }));
        const bodyBytes = leaves.reduce((total, leaf) => total + Buffer.byteLength(leaf.contentMarkdown), 0);
        if (bodyBytes > MAX_BODY_BYTES) throw new Error("DRAFT_PREVIEW_TOO_LARGE");
        for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
        while (cache.size >= 8 || [...cache.values()].reduce((total, entry) => total + entry.bytes, 0) + bodyBytes > MAX_CACHE_BYTES)
          cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, {expiresAt: Date.now() + 60_000, bytes: bodyBytes, leaves});
      }
      const projected = await Promise.all(leaves.map(async sourceLeaf => {
        const { originalSha256, ...original } = sourceLeaf;
        const node = record(nodes[original.id]);
        const editingState: KnowledgeBaseDraftLeafDto["editingState"] = node.state === "ready" ? "ready" :
          node.state === "failed" ? "needs_retry" : node.state === "submitted" ? node.errorCode ? "awaiting_confirmation" : "processing" : "pending";
        const leaf: KnowledgeBaseDraftLeafDto = {...original, editingState};
        if (node.state === "ready" && node.output) {
          try {
            if (node.inputSha256 !== originalSha256) throw new Error("DRAFT_INPUT_CHANGED");
            const outputSource = scopedSource(node.output, build);
            if (outputSource.sizeBytes > MAX_BODY_BYTES) throw new Error("DRAFT_OUTPUT_TOO_LARGE");
            const output = await core.readKnowledgeBaseLocalSource(outputSource);
            const markdown = projectKnowledgeBaseCustomerMarkdown({leafTitle: original.title, markdown: output.toString("utf8")});
            assertKnowledgeProsePreserved(original.contentMarkdown, markdown);
            leaf.contentMarkdown = markdown;
            leaf.contentSource = "edited";
          } catch {
            // The original validated body stays readable if an edited artifact
            // is temporarily unavailable. Never pass through an unchecked edit.
            leaf.contentSource = "original";
          }
        }
        return leaf;
      }));
      if (projected.reduce((total, leaf) => total + Buffer.byteLength(leaf.contentMarkdown), 0) > MAX_BODY_BYTES) {
        for (const leaf of projected) {
          leaf.contentMarkdown = leaves.find(original => original.id === leaf.id)!.contentMarkdown;
          leaf.contentSource = "original";
        }
      }
      const branches = new Map<string, KnowledgeBaseDraftPreviewDto["branches"][number]>();
      for (const leaf of projected) {
        if (!branches.has(leaf.branchId)) branches.set(leaf.branchId, {id: leaf.branchId, title: leaf.branchTitle, leaves: []});
        branches.get(leaf.branchId)!.leaves.push(leaf);
      }
      return {...base, status: "available", totalNodes: projected.length, processedNodes: projected.filter(leaf => leaf.editingState === "ready").length, branches: [...branches.values()]};
    } catch {
      // File access must not take down the authoritative progress response or
      // make retained output look like an empty, never-generated knowledge base.
      return {...base, status: "unavailable", branches: []};
    }
  };
}
