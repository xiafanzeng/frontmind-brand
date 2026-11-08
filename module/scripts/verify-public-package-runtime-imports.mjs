import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

const coreRuntimeImports = [
  {
    specifier: "@frontmind/module-brand/contracts/knowledge-node-prose",
    exports: ["KNOWLEDGE_NODE_PROSE_HASH", "knowledgeProseInstruction", "assertKnowledgeProsePreserved"],
  },
  {
    specifier: "@frontmind/module-brand/contracts/knowledge-prose-recovery",
    exports: ["knowledgeProseSaveRecoveryCandidate"],
  },
  {
    specifier: "@frontmind/module-brand/contracts/knowledge-base-upload-limits",
    exports: ["KIMI_KNOWLEDGE_DOCUMENT_MAX_BYTES"],
  },
];

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_RUNTIME_IMPORT_INVALID: ${message}`);
}

function importTarget(specifier) {
  const subpath = `./${specifier.slice("@frontmind/module-brand/".length)}`;
  const exact = packageJson.exports[subpath];
  if (exact) return typeof exact === "string" ? exact : exact.import;
  for (const [pattern, value] of Object.entries(packageJson.exports)) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0 || !subpath.startsWith(pattern.slice(0, wildcard)) ||
        !subpath.endsWith(pattern.slice(wildcard + 1))) continue;
    const match = subpath.slice(wildcard, subpath.length - (pattern.length - wildcard - 1));
    const target = typeof value === "string" ? value : value.import;
    return target?.replace("*", match);
  }
  return undefined;
}

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
      ? [absolute] : [];
  });
}

for (const { specifier, exports } of coreRuntimeImports) {
  const target = importTarget(specifier);
  const expected = `./dist/${specifier.slice("@frontmind/module-brand/".length)}.js`;
  if (target !== expected) fail(`${specifier} resolves to ${String(target)}, expected ${expected}`);
  const output = path.resolve(packageRoot, target);
  if (!existsSync(output) || !statSync(output).isFile() || statSync(output).size === 0) {
    fail(`${specifier} output is missing or empty: ${output}`);
  }
  const runtime = await import(pathToFileURL(output).href);
  for (const name of exports) {
    if (!Object.hasOwn(runtime, name)) fail(`${specifier} is missing named export ${name}`);
  }
}

for (const directory of ["contracts", "server", "schema", "worker"]) {
  for (const source of sourceFiles(path.join(packageRoot, directory))) {
    const relative = path.relative(packageRoot, source).replace(/\.ts$/u, ".js");
    const output = path.join(packageRoot, "dist", relative);
    if (!existsSync(output) || !statSync(output).isFile() || statSync(output).size === 0) {
      fail(`${relative} is missing or empty in dist`);
    }
  }
}

console.log(`Verified ${coreRuntimeImports.length} Core runtime imports and complete public TypeScript dist output.`);
