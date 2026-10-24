// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { buildSiteOpsSocialWorkflows, SITEOPS_SOCIAL_WORKFLOWS } from "../workflows/build-siteops-social-workflows.mjs";
import { readBuiltSiteOpsSocialWorkflowPackage } from "../server/siteops/social-workflow-runtime.js";

const roots: string[] = [];
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brand-social-workflow-"));
  roots.push(root);
  const sourceRoot = path.join(root, "source");
  for (const definition of Object.values(SITEOPS_SOCIAL_WORKFLOWS) as Array<{ directory: string }>) {
    await fs.cp(path.resolve(import.meta.dirname, "../workflows", definition.directory), path.join(sourceRoot, definition.directory), { recursive: true });
  }
  return { root, sourceRoot, output: path.join(root, "built") };
}

function load(output: string, channel: "wechat" | "xiaohongshu" = "wechat") {
  return readBuiltSiteOpsSocialWorkflowPackage(channel, { manifestCandidates: [path.join(output, "siteops-social-current.json")] });
}

describe("module-owned current social workflows", () => {
  it("packages nested references, scripts and binary resources into the actual runtime package with stable bytes", async () => {
    const { sourceRoot, output, root } = await fixture();
    const originalManifests = new Map<string, Buffer>();
    for (const [channel, definition] of Object.entries(SITEOPS_SOCIAL_WORKFLOWS) as Array<["wechat" | "xiaohongshu", { directory: string }]>) {
      const directory = path.join(sourceRoot, definition.directory);
      originalManifests.set(channel, await fs.readFile(path.join(directory, "MANIFEST.json")));
      await fs.mkdir(path.join(directory, "references/nested"), { recursive: true });
      await fs.mkdir(path.join(directory, "scripts"));
      await fs.mkdir(path.join(directory, "assets"));
      await fs.writeFile(path.join(directory, "references/nested/新规则.md"), `New ${channel} instruction.\n`);
      await fs.writeFile(path.join(directory, "scripts/check.py"), "print('synthetic validation')\n");
      await fs.writeFile(path.join(directory, "scripts/__init__.py"), "");
      await fs.writeFile(path.join(directory, "assets/example.bin"), Buffer.from([0, 128, 255]));
    }
    const built = await buildSiteOpsSocialWorkflows(output, { sourceRoot });
    const repeated = await buildSiteOpsSocialWorkflows(path.join(root, "repeat"), { sourceRoot });
    for (const channel of ["wechat", "xiaohongshu"] as const) {
      const loaded = await load(output, channel);
      expect(loaded).not.toBeNull();
      expect(loaded!.archiveSha256).toBe(built.channels[channel].sha256);
      expect(loaded!.manifestSha256).toBe(built.channels[channel].manifestSha256);
      expect(repeated.channels[channel].sha256).toBe(loaded!.archiveSha256);
      expect((await fs.readFile(path.join(root, "repeat", repeated.channels[channel].filename))).equals(loaded!.bytes)).toBe(true);
      const zip = await JSZip.loadAsync(loaded!.bytes);
      expect(await zip.file("references/nested/新规则.md")!.async("string")).toBe(`New ${channel} instruction.\n`);
      expect(zip.file("scripts/check.py")).not.toBeNull();
      expect(await zip.file("scripts/__init__.py")!.async("string")).toBe("");
      expect(await zip.file("assets/example.bin")!.async("nodebuffer")).toEqual(Buffer.from([0, 128, 255]));
      const manifest = JSON.parse(await zip.file("MANIFEST.json")!.async("string"));
      expect(manifest.files.map((file: { path: string }) => file.path)).toContain("references/nested/新规则.md");
      expect((await fs.readFile(path.join(sourceRoot, SITEOPS_SOCIAL_WORKFLOWS[channel].directory, "MANIFEST.json"))).equals(originalManifests.get(channel)!)).toBe(true);
    }
    expect(sha256(originalManifests.get("wechat")!)).toBe("5eb002ee34132105f8d13e3c4416fe4d08e07fadb1daa8ac660c066404689a6f");
    expect(sha256(originalManifests.get("xiaohongshu")!)).toBe("a359f8bfd6b46ab030fe7a36f8e7caf25fd873c286b533073c2db25661e93b0c");
  });

  it("uses an edited Skill for new packages and preserves the exact earlier content-addressed archive", async () => {
    const { sourceRoot, output } = await fixture();
    const original = await buildSiteOpsSocialWorkflows(output, { sourceRoot });
    const oldPath = path.join(output, original.channels.wechat.filename);
    const oldBytes = await fs.readFile(oldPath);
    await fs.appendFile(path.join(sourceRoot, SITEOPS_SOCIAL_WORKFLOWS.wechat.directory, "SKILL.md"), "\nA new business rule.\n");
    const changed = await buildSiteOpsSocialWorkflows(output, { sourceRoot });
    expect(changed.channels.wechat.sha256).not.toBe(original.channels.wechat.sha256);
    expect(changed.channels.wechat.manifestSha256).not.toBe(original.channels.wechat.manifestSha256);
    expect(changed.channels.xiaohongshu.sha256).toBe(original.channels.xiaohongshu.sha256);
    expect((await fs.readFile(oldPath)).equals(oldBytes)).toBe(true);
    const loaded = await load(output);
    expect(await (await JSZip.loadAsync(loaded!.bytes)).file("SKILL.md")!.async("string")).toContain("A new business rule.");
  });

  it("rejects linked and environment resources while retaining required files and the existing 3/9-image contract", async () => {
    const { sourceRoot, output } = await fixture();
    const directory = path.join(sourceRoot, SITEOPS_SOCIAL_WORKFLOWS.wechat.directory);
    const linked = path.join(directory, "linked-resources");
    await fs.symlink(directory, linked, process.platform === "win32" ? "junction" : "dir");
    await expect(buildSiteOpsSocialWorkflows(output, { sourceRoot })).rejects.toThrow("RESOURCE_INVALID");
    await fs.unlink(linked);
    await fs.writeFile(path.join(directory, ".env.local"), "PLACEHOLDER=value\n");
    await expect(buildSiteOpsSocialWorkflows(output, { sourceRoot })).rejects.toThrow("RESOURCE_INVALID");
    await fs.unlink(path.join(directory, ".env.local"));
    await fs.rm(path.join(directory, "SKILL.md"));
    await expect(buildSiteOpsSocialWorkflows(output, { sourceRoot })).rejects.toThrow("SOURCE_MISSING:SKILL.md");
    expect(SITEOPS_SOCIAL_WORKFLOWS.wechat.imageCount).toBe(3);
    expect(SITEOPS_SOCIAL_WORKFLOWS.xiaohongshu.imageCount).toBe(9);
  });

  it("rejects changed package bytes instead of silently selecting a historical package", async () => {
    const { sourceRoot, output } = await fixture();
    const built = await buildSiteOpsSocialWorkflows(output, { sourceRoot });
    await fs.appendFile(path.join(output, built.channels.wechat.filename), "corrupt");
    await expect(load(output)).rejects.toThrow("BUILD_HASH_MISMATCH");
  });
});
