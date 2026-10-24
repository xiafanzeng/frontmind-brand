import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const fixedDate = new Date("2000-01-01T00:00:00.000Z");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ignoredDirectories = new Set([".git", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

// These values describe the current social wire/materializer contract. Keep
// changes to that contract with the module's schema and rendering code.
export const SITEOPS_SOCIAL_WORKFLOWS = {
  wechat: { channel: "wechat", version: "1.0.0", directory: "siteops-wechat-package-v1.0.0", imageCount: 3, width: 1410, height: 600 },
  xiaohongshu: { channel: "xiaohongshu", version: "1.0.0", directory: "siteops-xiaohongshu-package-v1.0.0", imageCount: 9, width: 1080, height: 1440 },
};

async function resources(root, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (!prefix && entry.name === "MANIFEST.json") continue;
    if (ignoredDirectories.has(entry.name) || entry.name === ".DS_Store" || /\.py[co]$/u.test(entry.name)) continue;
    if (/^\.env(?:\.|$)/u.test(entry.name) || /[\\\x00-\x1f\x7f]/u.test(relative) || entry.isSymbolicLink()
      || (!entry.isFile() && !entry.isDirectory())) throw new Error(`SITEOPS_SOCIAL_RESOURCE_INVALID:${relative}`);
    if (entry.isDirectory()) files.push(...await resources(root, relative));
    else {
      const source = path.join(root, relative);
      const bytes = await fs.readFile(source);
      files.push({ path: relative, content: bytes, executable: Boolean((await fs.stat(source)).mode & 0o111) });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function prepareWorkflow(channel, options = {}) {
  const definition = SITEOPS_SOCIAL_WORKFLOWS[channel];
  if (!definition) throw new Error(`Unknown SiteOps social channel: ${channel}`);
  const files = await resources(path.join(options.sourceRoot ?? workflowRoot, definition.directory));
  for (const required of ["SKILL.md", "runtime-contract.json"]) {
    if (!files.some((file) => file.path === required && file.content.length)) throw new Error(`SITEOPS_SOCIAL_SOURCE_MISSING:${required}`);
  }
  const contract = JSON.parse(files.find((file) => file.path === "runtime-contract.json").content.toString("utf8"));
  if (contract.channel !== definition.channel || contract.version !== definition.version
    || contract.hostOwnsArchive !== true || contract.automatedPublishing !== false
    || contract.accountCredentialsAllowed !== false || contract.brandSource !== "customer-company-name"
    || contract.sourceMappingRequired !== true || contract.images?.count !== definition.imageCount
    || contract.images?.width !== definition.width || contract.images?.height !== definition.height
    || contract.images?.mimeType !== "image/png") throw new Error(`SiteOps ${channel} runtime contract is invalid`);
  const text = files.map((file) => file.content.toString("utf8")).join("\n");
  if (new RegExp(`GEO${"学术"}${"追踪"}`, "u").test(text)
    || /(?:access[_ -]?token|api[_ -]?key|session[_ -]?cookie)\s*[:=]/iu.test(text)) {
    throw new Error(`SiteOps ${channel} workflow contains a brand or credential`);
  }
  const manifest = {
    schema: "frontmind-runtime-workflow-manifest/v1", name: `frontmind-siteops-${channel}-package`,
    channel, version: definition.version, entrypoint: "SKILL.md", hashScope: "all regular files except MANIFEST.json",
    files: files.map((file) => ({ path: file.path, bytes: file.content.length, sha256: hash(file.content) })),
  };
  return { definition, files, manifest, manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
}

export async function createSiteOpsSocialWorkflowManifest(channel, options = {}) {
  return (await prepareWorkflow(channel, options)).manifest;
}

export async function verifySiteOpsSocialWorkflow(channel, options = {}) {
  const prepared = await prepareWorkflow(channel, options);
  return { ...prepared.manifest, manifestSha256: hash(prepared.manifestBytes) };
}

export async function verifyAllSiteOpsSocialWorkflows(options = {}) {
  return Promise.all(Object.keys(SITEOPS_SOCIAL_WORKFLOWS).map((channel) => verifySiteOpsSocialWorkflow(channel, options)));
}

// Source MANIFEST.json files are historical pins. Generate the current
// manifest into each content-addressed build archive without rewriting them.
export async function buildSiteOpsSocialWorkflows(outputRoot = path.join(workflowRoot, "../dist/workflows"), options = {}) {
  await fs.mkdir(outputRoot, { recursive: true });
  const channels = {};
  for (const channel of Object.keys(SITEOPS_SOCIAL_WORKFLOWS)) {
    const { definition, files, manifest, manifestBytes } = await prepareWorkflow(channel, options);
    const zip = new JSZip();
    zip.file("MANIFEST.json", manifestBytes, { date: fixedDate, unixPermissions: 0o100644, createFolders: false });
    for (const file of files) zip.file(file.path, file.content, {
      date: fixedDate, unixPermissions: file.executable ? 0o100755 : 0o100644, createFolders: false,
    });
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
    const sha256 = hash(bytes);
    const filename = `${definition.directory}-${sha256}.zip`;
    const destination = path.join(outputRoot, filename);
    try { await fs.writeFile(destination, bytes, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !(await fs.readFile(destination)).equals(bytes)) throw error; }
    channels[channel] = { name: manifest.name, channel, version: definition.version, filename, sha256, manifestSha256: hash(manifestBytes) };
  }
  const current = { formatVersion: 1, channels };
  await fs.writeFile(path.join(outputRoot, "siteops-social-current.json"), `${JSON.stringify(current, null, 2)}\n`);
  return current;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildSiteOpsSocialWorkflows()));
}
