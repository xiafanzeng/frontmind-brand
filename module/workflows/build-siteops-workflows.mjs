import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const workflows = [
  "react-static-company-site-workflow-v2.6.0",
  "siteops-wechat-package-v1.0.0",
  "siteops-xiaohongshu-package-v1.0.0",
];

/** Package the source whose immutable manifest the runtime already verifies.
 * Changing a workflow requires a new version/manifest; existing tasks retain
 * their stored workflow coordinates. Current host code is separately identified
 * by module SHA and the source hashes below, never by rewriting an old manifest.
 */
export async function buildSiteOpsWorkflows(output = path.join(root, "../dist/workflows")) {
  await fs.mkdir(output, { recursive: true });
  const artifacts = [];
  for (const directory of workflows) {
    const source = path.join(root, directory);
    const manifestBytes = await fs.readFile(path.join(source, "MANIFEST.json"));
    const manifest = JSON.parse(manifestBytes);
    const zip = new JSZip();
    zip.file("MANIFEST.json", manifestBytes, { date: new Date("2000-01-01Z"), createFolders: false });
    for (const file of [...manifest.files].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
      if (file.path.startsWith("/") || file.path.split(/[\\/]/).includes("..")) throw new Error("SITEOPS_WORKFLOW_PATH_INVALID");
      const fullPath = path.join(source, file.path);
      if (!(await fs.lstat(fullPath)).isFile()) throw new Error("SITEOPS_WORKFLOW_FILE_INVALID");
      const bytes = await fs.readFile(fullPath);
      if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`SITEOPS_WORKFLOW_VERSION_REQUIRED:${file.path}`);
      zip.file(file.path, bytes, { date: new Date("2000-01-01Z"), createFolders: false });
    }
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
    const sha256 = hash(bytes);
    const filename = `${directory}-${sha256}.zip`;
    const destination = path.join(output, filename);
    try { await fs.writeFile(destination, bytes, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !(await fs.readFile(destination)).equals(bytes)) throw error; }
    artifacts.push({ name: manifest.name, version: manifest.version, filename, sha256, manifestSha256: hash(manifestBytes) });
  }
  // 2.9 uses module-owned prompt/schema and materialization source. These are
  // source inputs, not customer runs or downloaded site/template artifacts.
  const sourceFiles = ["contracts/siteops.ts", "server/siteops/site-content-plan.ts", "server/siteops/native-react-source.ts", "server/siteops/manus-provider.ts"];
  const source = [];
  for (const file of sourceFiles) source.push({ file, sha256: hash(await fs.readFile(path.resolve(root, "..", file))) });
  const result = { formatVersion: 1, artifacts, nativeWorkflow: { version: "2.9.0", source } };
  await fs.writeFile(path.join(output, "siteops-manifest.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildSiteOpsWorkflows(), null, 2));
}
