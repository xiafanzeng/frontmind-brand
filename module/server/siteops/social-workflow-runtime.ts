import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

type SocialChannel = "wechat" | "xiaohongshu";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const safeResourcePath = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && !/[\\\x00-\x1f\x7f]/u.test(value)
  && value.split("/").every((part) => part && part !== "." && part !== ".." && !/^\.env(?:\.|$)/u.test(part));

/** Read only the module's current build. The original fixed manifests remain
 * available through the legacy loader; running tasks retain their attachment. */
export async function readBuiltSiteOpsSocialWorkflowPackage(channel: SocialChannel, options: { manifestCandidates?: readonly string[] } = {}) {
  const candidates = options.manifestCandidates ?? [
    path.resolve(import.meta.dirname, "../../workflows/siteops-social-current.json"),
    path.resolve(import.meta.dirname, "../../../dist/workflows/siteops-social-current.json"),
  ];
  for (const candidate of candidates) {
    let current;
    try { current = JSON.parse(await fs.readFile(candidate, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const descriptor = current.channels?.[channel];
    if (current.formatVersion !== 1 || descriptor?.channel !== channel
      || typeof descriptor.version !== "string" || !/^[a-f0-9]{64}$/u.test(descriptor.sha256)
      || !/^[a-f0-9]{64}$/u.test(descriptor.manifestSha256)
      || !new RegExp(`^siteops-${channel}-package-v[0-9]+\\.[0-9]+\\.[0-9]+-[a-f0-9]{64}\\.zip$`, "u").test(descriptor.filename)) {
      throw new Error("SITEOPS_SOCIAL_BUILD_MANIFEST_INVALID");
    }
    const bytes = await fs.readFile(path.join(path.dirname(candidate), descriptor.filename));
    if (hash(bytes) !== descriptor.sha256) throw new Error("SITEOPS_SOCIAL_BUILD_HASH_MISMATCH");
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const manifestBytes = await zip.file("MANIFEST.json")?.async("nodebuffer");
    if (!manifestBytes || hash(manifestBytes) !== descriptor.manifestSha256) throw new Error("SITEOPS_SOCIAL_MANIFEST_HASH_MISMATCH");
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.channel !== channel || manifest.version !== descriptor.version || manifest.entrypoint !== "SKILL.md"
      || !Array.isArray(manifest.files) || manifest.files.length < 2) throw new Error("SITEOPS_SOCIAL_MANIFEST_INVALID");
    const expected = new Set<string>(["MANIFEST.json"]);
    for (const file of manifest.files) {
      if (!safeResourcePath(file.path) || expected.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
        || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error("SITEOPS_SOCIAL_RESOURCE_INVALID");
      expected.add(file.path);
      const content = await zip.file(file.path)?.async("nodebuffer");
      if (!content || content.length !== file.bytes || hash(content) !== file.sha256) throw new Error("SITEOPS_SOCIAL_RESOURCE_HASH_MISMATCH");
    }
    for (const [name, entry] of Object.entries(zip.files)) {
      const kind = Number(entry.unixPermissions ?? 0) & 0o170000;
      if (!safeResourcePath(name.replace(/\/$/u, "")) || !safeResourcePath((entry.unsafeOriginalName ?? name).replace(/\/$/u, ""))
        || ![0, 0o100000, 0o040000].includes(kind) || (!entry.dir && !expected.has(name))) throw new Error("SITEOPS_SOCIAL_RESOURCE_INVALID");
    }
    if (!expected.has("SKILL.md") || !expected.has("runtime-contract.json")) throw new Error("SITEOPS_SOCIAL_SOURCE_MISSING");
    return { bytes, version: String(descriptor.version), manifestSha256: String(descriptor.manifestSha256), archiveSha256: String(descriptor.sha256) };
  }
  return null;
}
