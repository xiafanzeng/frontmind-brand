import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(moduleRoot, "workflows/socratic-kb-builder/references/working-set-policy.json");
const outputPath = path.join(moduleRoot, "server/knowledge-base-working-set-policy.generated.ts");

export function renderKnowledgeBaseWorkingSetPolicyModule(policy) {
  if (
    policy?.schemaVersion !== 1 ||
    !Number.isSafeInteger(policy?.archive?.maxCompressedBytes) ||
    !Number.isSafeInteger(policy?.archive?.maxUncompressedBytes) ||
    !Number.isSafeInteger(policy?.archive?.maxEntryCount) ||
    !Number.isFinite(policy?.archive?.maxCompressionRatio) ||
    !Array.isArray(policy?.evidence?.textExtensions) ||
    !Array.isArray(policy?.evidence?.textMimeTypes)
  ) {
    throw new Error("Invalid knowledge-base working-set policy");
  }
  return [
    "// Generated from workflows/socratic-kb-builder/references/working-set-policy.json.",
    "// Run `node workflows/generate-knowledge-base-working-set-policy.mjs` after changing the source.",
    "// prettier-ignore",
    `export const GENERATED_KNOWLEDGE_BASE_WORKING_SET_POLICY = ${JSON.stringify(policy, null, 2)} as const;`,
    "",
  ].join("\n");
}

export async function generateKnowledgeBaseWorkingSetPolicy(options = {}) {
  const selectedSourcePath = options.sourcePath || sourcePath;
  const selectedOutputPath = options.outputPath || outputPath;
  const policy = JSON.parse(await fs.readFile(selectedSourcePath, "utf8"));
  const rendered = renderKnowledgeBaseWorkingSetPolicyModule(policy);
  if (options.check) {
    if (await fs.readFile(selectedOutputPath, "utf8") !== rendered) {
      throw new Error("Generated knowledge-base working-set policy is stale");
    }
    return { outputPath: selectedOutputPath, changed: false };
  }
  let existing;
  try { existing = await fs.readFile(selectedOutputPath, "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (existing !== rendered) await fs.writeFile(selectedOutputPath, rendered);
  return { outputPath: selectedOutputPath, changed: existing !== rendered };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateKnowledgeBaseWorkingSetPolicy({ check: process.argv.includes("--check") });
}
