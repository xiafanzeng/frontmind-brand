// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { buildDirectorySkillArchive } from "../server/directory-skill-archive.js";
import { judgeSkillDirectoryCandidates } from "../server/response-logic-judge-api.js";
import { optimizerSkillDirectoryCandidates } from "../server/response-logic-optimization-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS = [
  { name: "response-logic-builder", dir: "response-logic-builder.skill" },
  { name: "response-logic-evaluator", dir: "response-logic-evaluator.skill" },
  { name: "response-logic-optimizer", dir: "response-logic-optimizer.skill" },
] as const;

const SKILL_FILES = ["SKILL.md", "references/output-contract.md"] as const;

/**
 * The production Docker image compiles TypeScript to module/dist/server/ while
 * Skill directories stay at module/workflows/. These tests verify the path
 * candidates resolve in both layouts and that the actual loader finds the
 * Skills.
 */

describe("response-logic Skill loading in production directory layouts", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "rl-skill-test-"));

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("source layout: ../workflows/ from module/server/ resolves to module/workflows/", () => {
    // The test runner executes from the source tree, so import.meta.dirname
    // in the real modules points to module/server/. The ../workflows/ candidate
    // must resolve to module/workflows/ where the Skills actually live.
    for (const skill of SKILLS) {
      const skillDir = resolve(__dirname, "../workflows", skill.dir);
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    }
  });

  it("compiled layout: ../../workflows/ from module/dist/server/ resolves to module/workflows/", () => {
    // Simulate the compiled layout: create dist/server/ and verify the
    // ../../workflows/ path form reaches the real Skills.
    const compiledDir = resolve(tempRoot, "module", "dist", "server");
    mkdirSync(compiledDir, { recursive: true });
    const moduleDir = resolve(tempRoot, "module");
    const workflowsDir = resolve(moduleDir, "workflows");

    // The actual Skills in the repo — resolve from the source tree
    const realWorkflows = resolve(__dirname, "../workflows");

    for (const skill of SKILLS) {
      // Simulate: if the compiled code were at compiledDir, then
      // resolve(compiledDir, "../../workflows/<skill>") should point to
      // module/workflows/<skill>. Verify the path math:
      const fromCompiled = resolve(compiledDir, "../../workflows", skill.dir);
      const expected = resolve(moduleDir, "workflows", skill.dir);
      expect(fromCompiled).toBe(expected);
      // And the real Skill (using the source tree equivalent) exists:
      const realPath = resolve(realWorkflows, skill.dir);
      expect(existsSync(realPath)).toBe(true);
      expect(existsSync(join(realPath, "SKILL.md"))).toBe(true);
    }
  });

  it("actual loader finds the builder Skill from the source tree", async () => {
    const candidates = [
      resolve(__dirname, "../workflows/response-logic-builder.skill"),
    ];
    const archive = await buildDirectorySkillArchive({
      name: "response-logic-builder",
      version: "1",
      directoryCandidates: candidates,
      files: SKILL_FILES,
    });
    expect(archive).toBeDefined();
    expect(archive.contentHash).toBeTruthy();
    expect(archive.bytes.length).toBeGreaterThan(0);
  });

  it("judge candidate list has ≥5 entries including brand module path", () => {
    const candidates = judgeSkillDirectoryCandidates(undefined);
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    // Platform-independent: normalize separators before pattern matching
    const normalized = candidates.map(c => c.replace(/\\/g, "/"));
    expect(normalized.some(c => c.includes("modules/brand/workflows"))).toBe(true);
    expect(normalized.some(c => c.includes("response-logic-evaluator"))).toBe(true);
  });

  it("optimizer candidate list has ≥5 entries including brand module path", () => {
    const candidates = optimizerSkillDirectoryCandidates(undefined);
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    const normalized = candidates.map(c => c.replace(/\\/g, "/"));
    expect(normalized.some(c => c.includes("modules/brand/workflows"))).toBe(true);
    expect(normalized.some(c => c.includes("response-logic-optimizer"))).toBe(true);
  });

  it("missing Skill produces a clear error listing tried paths", async () => {
    const badCandidates = [
      resolve(tempRoot, "nonexistent-1"),
      resolve(tempRoot, "nonexistent-2"),
    ];
    await expect(buildDirectorySkillArchive({
      name: "response-logic-builder",
      version: "1",
      directoryCandidates: badCandidates,
      files: SKILL_FILES,
    })).rejects.toThrow(/Could not load Skill response-logic-builder/);
  });

  it("all three Skills are distinct and load correct SKILL.md content", async () => {
    for (const skill of SKILLS) {
      const skillDir = resolve(__dirname, "../workflows", skill.dir);
      const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain(skill.name);
    }
    // Verify they are distinct files
    const builder = readFileSync(resolve(__dirname, "../workflows/response-logic-builder.skill/SKILL.md"), "utf8");
    const evaluator = readFileSync(resolve(__dirname, "../workflows/response-logic-evaluator.skill/SKILL.md"), "utf8");
    const optimizer = readFileSync(resolve(__dirname, "../workflows/response-logic-optimizer.skill/SKILL.md"), "utf8");
    expect(builder).not.toBe(evaluator);
    expect(evaluator).not.toBe(optimizer);
    expect(builder).not.toBe(optimizer);
  });
});
