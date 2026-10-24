import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

import { canonicalKnowledgeBaseSkillArchiveHash } from "@frontmind/module-brand/contracts/knowledge-base-skill-archive-hash";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(
  projectRoot,
  "workflows",
  "socratic-kb-builder",
);
const outputPath = path.join(
  projectRoot,
  "dist/workflows/knowledge-base",
  "socratic-kb-builder-v5.skill",
);
const fixedDate = new Date("2000-01-01T00:00:00.000Z");

export const socraticKnowledgeBaseSkillEntries = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/knowledge-tree.md",
  "references/materialized-working-set.md",
  "references/output-format.md",
  "references/questioning-strategy.md",
  "references/working-set-policy.json",
  "scripts/validate_working_set.py",
];

const ignoredDirectories = new Set([
  ".git", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
]);

async function skillSourceFiles(root, prefix = "") {
  const directory = path.join(root, prefix);
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Skill source must be a regular directory: ${prefix || "."}`);
  }
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (/^\.env(?:\.|$)/u.test(entry.name)) throw new Error(`Skill source environment file: ${relative}`);
    if (entry.isSymbolicLink()) throw new Error(`Skill source symlink: ${relative}`);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await skillSourceFiles(root, relative));
    } else if (entry.isFile()) {
      if (entry.name !== ".DS_Store" && !/\.py[co]$/u.test(entry.name)) files.push(relative);
    } else {
      throw new Error(`Skill source must be a regular file: ${relative}`);
    }
  }
  return files.sort();
}

async function writeHistoricalArchiveNoClobber(targetPath, archive) {
  try {
    await fs.writeFile(targetPath, archive, { flag: "wx" });
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = await fs.readFile(targetPath);
  if (!existing.equals(archive)) {
    throw new Error(
      `Refusing to overwrite immutable historical Skill archive: ${targetPath}`,
    );
  }
}

async function historicalArchiveExists(targetPath, archive) {
  try {
    const existing = await fs.readFile(targetPath);
    if (!existing.equals(archive)) {
      throw new Error(
        `Immutable historical Skill archive has conflicting bytes: ${targetPath}`,
      );
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function preserveExistingSkillArchive(
  selectedOutputPath,
  archive,
  contentHash,
) {
  const canonicalPath = path.join(
    path.dirname(selectedOutputPath),
    `socratic-kb-builder-v5-${contentHash}.skill`,
  );
  const alreadyCanonical = await historicalArchiveExists(
    canonicalPath,
    archive,
  );
  if (alreadyCanonical) return;

  await writeHistoricalArchiveNoClobber(canonicalPath, archive);
}

export async function packageSocraticKnowledgeBaseSkill(options = {}) {
  const selectedSourceRoot = options.sourceRoot || sourceRoot;
  const selectedOutputPath = options.outputPath || outputPath;
  await fs.mkdir(path.dirname(selectedOutputPath), { recursive: true });
  const files = await skillSourceFiles(selectedSourceRoot);
  for (const required of socraticKnowledgeBaseSkillEntries) {
    if (!files.includes(required)) throw new Error(`Skill required source is missing: ${required}`);
  }
  const zip = new JSZip();
  for (const relativePath of files) {
    const sourcePath = path.join(selectedSourceRoot, relativePath);
    const content = await fs.readFile(sourcePath);
    if (socraticKnowledgeBaseSkillEntries.includes(relativePath) && content.length === 0) {
      throw new Error(`Skill source is empty: ${relativePath}`);
    }
    const executable = relativePath.endsWith(".py") || (await fs.stat(sourcePath)).mode & 0o111;
    zip.file(
      relativePath,
      content,
      {
        binary: true,
        createFolders: false,
        date: fixedDate,
        unixPermissions: executable ? 0o100755 : 0o100644,
      },
    );
  }
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
    streamFiles: false,
  });
  const contentHash = await canonicalKnowledgeBaseSkillArchiveHash(archive);
  let existing = null;
  try {
    existing = await fs.readFile(selectedOutputPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let deployedArchive = archive;
  if (!existing) {
    await fs.writeFile(selectedOutputPath, archive);
  } else {
    const existingContentHash =
      await canonicalKnowledgeBaseSkillArchiveHash(existing);
    if (existingContentHash === contentHash) {
      // A ZIP implementation or metadata change may alter container bytes
      // while preserving every logical entry. Keep the deployed bytes and
      // migrate their old SKILL-only alias exactly once.
      deployedArchive = existing;
      await preserveExistingSkillArchive(
        selectedOutputPath,
        existing,
        existingContentHash,
      );
    } else {
      await preserveExistingSkillArchive(
        selectedOutputPath,
        existing,
        existingContentHash,
      );
      await fs.writeFile(selectedOutputPath, archive);
    }
  }
  await writeHistoricalArchiveNoClobber(
    path.join(
      path.dirname(selectedOutputPath),
      `socratic-kb-builder-v5-${contentHash}.skill`,
    ),
    deployedArchive,
  );
  await fs.writeFile(path.join(path.dirname(selectedOutputPath), "manifest.json"), JSON.stringify({formatVersion:1,version:"5",contentHash,filename:`socratic-kb-builder-v5-${contentHash}.skill`,archiveSha256:createHash("sha256").update(deployedArchive).digest("hex")},null,2)+"\n");
  return {
    outputPath: selectedOutputPath,
    bytes: deployedArchive.length,
    sha256: contentHash,
    contentHash,
    archiveSha256: createHash("sha256").update(deployedArchive).digest("hex"),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await packageSocraticKnowledgeBaseSkill();
  console.log(
    `Packaged deterministic Skill: ${path.relative(projectRoot, result.outputPath)} ` +
      `(${result.bytes} bytes, sha256=${result.sha256})`,
  );
}
