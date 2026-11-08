import { KNOWLEDGE_NODE_PROSE_HASH } from "./knowledge-node-prose.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export type KnowledgeProseSourceReference = {
  storageKey: string;
  contentSha256: string;
  sizeBytes: number;
};
export type CompleteKnowledgeProseCheckpoint = RecordValue & {
  sourceArchive: KnowledgeProseSourceReference;
  outputArchive?: KnowledgeProseSourceReference;
  nodes: Record<string, RecordValue & { state: "ready"; inputSha256: string; output: KnowledgeProseSourceReference }>;
};
type RecoveryBuild = {
  id: string; userId: number; generation: number; activeTurnId: string | null;
  status: string; executionMode: string | null; contentVersion: number | null;
  revision: number; activeWorkingSetId: string | null; protocolErrorCode: string | null;
};
type RecoveryTurn = {
  id: string; userId: number; buildId: string | null; buildGeneration: number | null;
  status: string; errorCode?: string | null; operationType: string | null;
  expectedRevision: number | null; upstreamTaskId: string | null; metadata: RecordValue | null;
};

/** This is display/admission eligibility, never permission to activate bytes.
 * The retry transaction rechecks reset/owner/version fences and every retained
 * source hash before restoring the original turn's writer fence. */
export function knowledgeProseSaveRecoveryCandidate(input: { build: RecoveryBuild; turn: RecoveryTurn }): {
  checkpoint: CompleteKnowledgeProseCheckpoint;
  terminal: boolean;
} | null {
  const { build, turn } = input;
  const metadata = record(turn.metadata);
  const prose = record(metadata?.proseEditing);
  if (!metadata || !prose || metadata.proseEditingPolicy !== KNOWLEDGE_NODE_PROSE_HASH ||
      prose.policyHash !== KNOWLEDGE_NODE_PROSE_HASH || prose.schemaVersion !== 1 ||
      build.executionMode !== "materialized_bundle_v1" || build.id !== turn.buildId ||
      build.userId !== turn.userId || build.generation !== turn.buildGeneration ||
      build.revision !== turn.expectedRevision || !turn.upstreamTaskId ||
      !["start", "revise"].includes(turn.operationType ?? "")) return null;
  const prefix = `knowledge-base/build-sources/${build.userId}/${build.id.toLowerCase()}/g${build.generation}/`;
  const source = (value: unknown): value is KnowledgeProseSourceReference => {
    const ref = record(value);
    return Boolean(ref && sha(ref.contentSha256) && Number.isSafeInteger(ref.sizeBytes) &&
      Number(ref.sizeBytes) > 0 && ref.storageKey === `${prefix}${ref.contentSha256}.bin`);
  };
  const nodes = record(prose.nodes);
  if (!source(prose.sourceArchive) || !nodes || !Object.keys(nodes).length || Object.keys(nodes).length > 115) return null;
  for (const node of Object.values(nodes)) {
    const item = record(node);
    if (!item || item.state !== "ready" || !sha(item.inputSha256) || !source(item.output)) return null;
  }
  if (prose.outputArchive !== undefined && !source(prose.outputArchive)) return null;
  const terminal = turn.status === "failed";
  if (terminal) {
    // The old writer marked its own malformed reconstructed ZIP as a provider
    // contract failure. Only an untouched initial build can recover that case.
    if (turn.errorCode !== "KNOWLEDGE_BASE_MATERIALIZED_CONTRACT_INVALID" ||
        build.protocolErrorCode !== turn.errorCode || build.status !== "protocol_error" ||
        build.activeTurnId !== null || turn.operationType !== "start" ||
        build.contentVersion !== 0 || build.revision !== 0 || build.activeWorkingSetId !== null ||
        prose.state !== "ready" || !source(prose.outputArchive)) return null;
  } else if (!(["queued", "running"].includes(turn.status) &&
      ["researching", "confirming"].includes(build.status) && build.activeTurnId === turn.id &&
      prose.state === "failed" && record(prose.finalizationFailure))) return null;
  return { checkpoint: prose as CompleteKnowledgeProseCheckpoint, terminal };
}
