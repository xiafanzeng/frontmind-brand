import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import ts from "typescript";
import { packageSocraticKnowledgeBaseSkill, socraticKnowledgeBaseSkillEntries } from "../workflows/build-knowledge-base-workflow.mjs";
import { buildKeywordWorkflow } from "../workflows/build-keyword-workflow.mjs";
import { generateKnowledgeBaseWorkingSetPolicy } from "../workflows/generate-knowledge-base-working-set-policy.mjs";
import { canonicalKnowledgeBaseSkillArchiveHash } from "../dist/contracts/knowledge-base-skill-archive-hash.js";

const source = fileURLToPath(new URL("../workflows/socratic-kb-builder", import.meta.url));
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brand-workflow-source-"));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("knowledge Skill packages new resources deterministically and retains the old eight-file archive", async () => fixture(async root => {
  const sourceRoot = path.join(root, "source");
  await fs.cp(source, sourceRoot, { recursive: true });
  await fs.mkdir(path.join(sourceRoot, "references/nested"));
  await fs.writeFile(path.join(sourceRoot, "references/nested/new-guide.md"), "Synthetic new reference.\n");
  await fs.mkdir(path.join(sourceRoot, "assets"));
  await fs.writeFile(path.join(sourceRoot, "assets/example.bin"), Buffer.from([0, 128, 255]));
  await fs.mkdir(path.join(sourceRoot, "scripts/__pycache__"));
  await fs.writeFile(path.join(sourceRoot, "scripts/__pycache__/ignored.pyc"), "cache");

  const old = new JSZip();
  for (const entry of socraticKnowledgeBaseSkillEntries) old.file(entry, await fs.readFile(path.join(sourceRoot, entry)));
  const oldBytes = await old.generateAsync({ type: "nodebuffer" });
  const oldHash = await canonicalKnowledgeBaseSkillArchiveHash(oldBytes);
  const outputPath = path.join(root, "runtime/socratic-kb-builder-v5.skill");
  await fs.mkdir(path.dirname(outputPath));
  await fs.writeFile(outputPath, oldBytes);
  const first = await packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath });
  const built = await fs.readFile(outputPath);
  const archive = await JSZip.loadAsync(built);
  assert.equal(await archive.file("references/nested/new-guide.md").async("string"), "Synthetic new reference.\n");
  assert.deepEqual(await archive.file("assets/example.bin").async("nodebuffer"), Buffer.from([0, 128, 255]));
  assert.ok(archive.file("scripts/validate_archive.py"));
  assert.ok(Object.keys(archive.files).every(name => !name.includes("__pycache__")));
  assert.notEqual(first.contentHash, oldHash);
  assert.deepEqual(await fs.readFile(path.join(root, "runtime", `socratic-kb-builder-v5-${oldHash}.skill`)), oldBytes);

  const secondOutput = path.join(root, "repeat/socratic-kb-builder-v5.skill");
  const repeat = await packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath: secondOutput });
  assert.equal(repeat.contentHash, first.contentHash);
  assert.deepEqual(await fs.readFile(secondOutput), built);
  await fs.appendFile(path.join(sourceRoot, "references/nested/new-guide.md"), "A changed instruction.\n");
  const changed = await packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath });
  assert.notEqual(changed.contentHash, first.contentHash);
}));

test("knowledge Skill rejects missing required files, linked resources, and environment files", async () => fixture(async root => {
  const sourceRoot = path.join(root, "source");
  await fs.cp(source, sourceRoot, { recursive: true });
  const outputPath = path.join(root, "runtime/skill");
  const required = path.join(sourceRoot, "SKILL.md");
  const original = await fs.readFile(required);
  await fs.unlink(required);
  await assert.rejects(packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath }), /required source is missing/u);
  await fs.writeFile(required, original);
  await fs.symlink(path.join(sourceRoot, "references"), path.join(sourceRoot, "linked-resources"));
  await assert.rejects(packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath }), /symlink/u);
  await fs.unlink(path.join(sourceRoot, "linked-resources"));
  for (const filename of [".env", "references/.env.local"]) {
    const environment = path.join(sourceRoot, filename);
    await fs.writeFile(environment, "PLACEHOLDER=value\n");
    await assert.rejects(packageSocraticKnowledgeBaseSkill({ sourceRoot, outputPath }), /environment file/u);
    await fs.unlink(environment);
  }
}));

test("edited policy JSON changes the actual compiled server policy", async () => fixture(async root => {
  const policy = JSON.parse(await fs.readFile(path.join(source, "references/working-set-policy.json"), "utf8"));
  policy.archive.maxEntryCount = 1;
  policy.evidence.textExtensions = [".audit"];
  const sourcePath = path.join(root, "policy.json");
  const outputPath = path.join(root, "knowledge-base-working-set-policy.generated.ts");
  await fs.writeFile(sourcePath, JSON.stringify(policy));
  assert.equal((await generateKnowledgeBaseWorkingSetPolicy({ sourcePath, outputPath })).changed, true);
  assert.equal((await generateKnowledgeBaseWorkingSetPolicy({ sourcePath, outputPath, check: true })).changed, false);
  const runtime = await fs.readFile(fileURLToPath(new URL("../server/knowledge-base-working-set-policy.ts", import.meta.url)), "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  for (const [filename, text] of [
    ["knowledge-base-working-set-policy.generated.js", await fs.readFile(outputPath, "utf8")],
    ["runtime.js", runtime],
  ]) await fs.writeFile(path.join(root, filename), ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const actual = await import(pathToFileURL(path.join(root, "runtime.js")).href);
  assert.equal(actual.isKnowledgeBaseTextEvidencePath("new.audit"), true);
  assert.equal(actual.isKnowledgeBaseTextEvidencePath("old.md"), false);
  const entry = { compressedBytes: 1, uncompressedBytes: 1 };
  assert.equal(actual.evaluateKnowledgeBaseArchivePolicy({ compressedBytes: 1, entries: [entry] }), true);
  assert.equal(actual.evaluateKnowledgeBaseArchivePolicy({ compressedBytes: 1, entries: [entry, entry] }), false);
  policy.archive.maxEntryCount = 2;
  await fs.writeFile(sourcePath, JSON.stringify(policy));
  await assert.rejects(generateKnowledgeBaseWorkingSetPolicy({ sourcePath, outputPath, check: true }), /stale/u);
}));

test("keyword adapter includes new references and scripts without rebuilding unchanged upstream bytes", async () => fixture(async root => {
  const sourceRoot = path.join(root, "source");
  await fs.cp(fileURLToPath(new URL("../workflows/generate-brand-question-universe", import.meta.url)), sourceRoot, { recursive: true });
  const initial = await buildKeywordWorkflow(path.join(root, "initial"), { sourceRoot });
  const adapter = path.join(sourceRoot, "frontmind-adapter-v1.0.0");
  await fs.mkdir(path.join(adapter, "references"));
  await fs.writeFile(path.join(adapter, "references/new-guide.md"), "Additional adapter instruction.\n");
  await fs.mkdir(path.join(adapter, "scripts"));
  await fs.writeFile(path.join(adapter, "scripts/check.py"), "print('synthetic validation')\n");
  const output = path.join(root, "next");
  const changed = await buildKeywordWorkflow(output, { sourceRoot });
  assert.equal(changed.upstream.sha256, initial.upstream.sha256);
  assert.deepEqual(await fs.readFile(path.join(output, "archives", changed.upstream.filename)), await fs.readFile(path.join(root, "initial/archives", initial.upstream.filename)));
  assert.notEqual(changed.adapter.sha256, initial.adapter.sha256);
  const bytes = await fs.readFile(path.join(output, "archives", changed.adapter.filename));
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file("references/new-guide.md").async("string"), "Additional adapter instruction.\n");
  assert.ok(zip.file("scripts/check.py"));
  const manifest = JSON.parse(await zip.file("MANIFEST.json").async("string"));
  assert.ok(manifest.files.some(file => file.path === "references/new-guide.md"));
  const repeat = await buildKeywordWorkflow(path.join(root, "repeat"), { sourceRoot });
  assert.equal(repeat.adapter.sha256, changed.adapter.sha256);
  for (const filename of ["source/.env", "frontmind-adapter-v1.0.0/references/.env.local"]) {
    const environment = path.join(sourceRoot, filename);
    await fs.writeFile(environment, "PLACEHOLDER=value\n");
    const rejectedOutput = path.join(root, "rejected");
    await assert.rejects(buildKeywordWorkflow(rejectedOutput, { sourceRoot }), /ENVIRONMENT_FILE/u);
    await assert.rejects(fs.access(path.join(rejectedOutput, filename)), { code: "ENOENT" });
    await fs.unlink(environment);
  }
}));
