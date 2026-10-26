import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflows = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(workflows, "report-workflow");
const destination = path.join(workflows, "..", "dist", "workflows", "report-workflow");
const manifest = JSON.parse(await readFile(path.join(source, "SOURCE_MANIFEST.json"), "utf8"));
for (const entry of manifest.files) {
  if (typeof entry.path !== "string" || !entry.path.startsWith("source/") || path.isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes("..")) throw new Error("Invalid report workflow asset path");
  const filename = path.join(source, entry.path);
  if (!(await stat(filename)).isFile()) throw new Error(`Missing report workflow asset: ${entry.path}`);
  const bytes = await readFile(filename);
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`Report workflow asset hash mismatch: ${entry.path}`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of manifest.files) {
  const target = path.join(destination, entry.path);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(source, entry.path), target, { dereference: false });
}
for (const name of ["SOURCE_MANIFEST.json", "README.md"]) await cp(path.join(source, name), path.join(destination, name));
console.log(`Report workflow: verified and copied ${manifest.files.length} source assets.`);
