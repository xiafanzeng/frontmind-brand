import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));

export const ENTERPRISE_RAG_EVALUATION_WORKFLOW = Object.freeze({
  name: "evaluate-enterprise-rag",
  version: "3.0.0",
  entrypoint: "SKILL.md",
});

export async function buildEnterpriseRagEvaluationWorkflow(options = {}) {
  const sourcePath = options.sourcePath ?? path.join(
    workflowRoot,
    ENTERPRISE_RAG_EVALUATION_WORKFLOW.name,
    ENTERPRISE_RAG_EVALUATION_WORKFLOW.entrypoint,
  );
  const outputRoot = options.outputRoot ?? path.join(
    workflowRoot,
    "../dist/workflows",
    ENTERPRISE_RAG_EVALUATION_WORKFLOW.name,
  );
  const source = await fs.readFile(sourcePath);
  if (source.length === 0) throw new Error("ENTERPRISE_RAG_EVALUATION_SKILL_EMPTY");
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(
    outputRoot,
    ENTERPRISE_RAG_EVALUATION_WORKFLOW.entrypoint,
  );
  await fs.writeFile(outputPath, source);
  return { ...ENTERPRISE_RAG_EVALUATION_WORKFLOW, sourcePath, outputPath };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await buildEnterpriseRagEvaluationWorkflow()));
}
