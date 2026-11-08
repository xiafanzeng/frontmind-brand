/** Server-owned policy selection. An archive cannot authorize relaxed length checks. */
export type KnowledgeContentPolicyManifest = {
  buildId: string; generation: number; skill: { contentHash: string };
  leaves: Array<{ leafId: string; contentSha256: string }>;
};
let currentSkillHash: string | undefined;
let loadGrants: ((manifest: KnowledgeContentPolicyManifest) => Promise<Record<string, string[]>>) | undefined;
export function configureKnowledgeContentPolicy(input: {
  currentSkillHash: string;
  loadGrants(manifest: KnowledgeContentPolicyManifest): Promise<Record<string, string[]>>;
}) { currentSkillHash = input.currentSkillHash; loadGrants = input.loadGrants; }
export async function factAdaptiveKnowledgeLeaves(manifest: KnowledgeContentPolicyManifest) {
  if (manifest.skill.contentHash === currentSkillHash) return new Set(manifest.leaves.map(leaf => leaf.leafId));
  const grants = await loadGrants?.(manifest) ?? {};
  return new Set(manifest.leaves.filter(leaf => grants[leaf.leafId]?.includes(leaf.contentSha256)).map(leaf => leaf.leafId));
}
