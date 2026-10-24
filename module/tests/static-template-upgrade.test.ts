// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import * as manifest from "../server/siteops/static-template-catalog-manifest.js";
import { NATIVE_RUNTIME_CONTRACT_V1_SHA256, NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256 } from "../server/siteops/native-react-source.js";
import { PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION } from "../contracts/static-template-pagination.js";
import { REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA, staticTemplateRuntimeMedia } from "../server/siteops/static-template-admission-policy.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
it("preserves v2/v3 caches, rebinds v4 offline, and rejects self-consistent wrong admission evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontmind-catalog-upgrade-"));
  const payloads = new Map<string, Buffer>();
  const definitions = manifest.FROZEN_STATIC_TEMPLATE_CATALOG;
  const groups = new Map<string, typeof definitions[number][]>();
  for (const definition of definitions) {
    const url = `https://codeload.github.com/${definition.sourceOwner}/${definition.sourceRepo}/zip/${definition.sourceCommitSha}`;
    groups.set(url, [...(groups.get(url) ?? []), definition]);
    payloads.set(definition.previewUrl, await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: definition.order, g: 50, b: 100 } } }).png().toBuffer());
  }
  for (const [url, entries] of groups) {
    const zip = new JSZip();
    zip.file("frozen/README.md", "Template fixture");
    if (entries[0]!.sourceRepo === "hirael") {
      for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "components.json", "registry.json", "LICENSE", "lib/utils.ts"]) zip.file(`frozen/${name}`, name);
    }
    for (const entry of entries) zip.file(`frozen/${entry.sourceSubdirectory ?? "src"}/${entry.candidateId}.tsx`, `export const id = ${JSON.stringify(entry.candidateId)};`);
    payloads.set(url, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
  }
  // This fixture replaces the compiler transport only; the separate admission
  // suite runs all three curated templates through real Vite and Chromium.
  const builder = vi.fn(async (input: any) => {
    if (!manifest.STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS.includes(input.definition.candidateId)) return { status: "unavailable" as const, code: "TEST_NOT_ADMITTED", reason: "Transport fixture" };
    const normalized = input.cachedNormalizedSource ? await readFile(input.cachedNormalizedSource.path)
      : await new JSZip().file("source/binding.txt", input.rawSourceSha256).generateAsync({ type: "nodebuffer", platform: "UNIX" });
    const contract = Buffer.from("contract");
    const dist = Buffer.from("dist");
    const qa = Buffer.from(JSON.stringify({ passed: true, browser: { available: true } }));
    // Reproduce the deployed v3 builder's incorrect #22 media binding while
    // keeping its real artifact hashes internally consistent.
    const runtimeMedia = input.catalogVersion === PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION
      ? REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA : staticTemplateRuntimeMedia(input.definition.candidateId);
    const browserReceipt = Buffer.from(JSON.stringify({
      schemaVersion: 1, receiptKind: "frontmind_static_template_browser_admission",
      binding: { catalogVersion: input.catalogVersion, candidateId: input.definition.candidateId,
        rawSourceSha256: input.rawSourceSha256, runtimeMedia },
      normalizedSourceSha256: digest(normalized), sourceTreeSha256: digest(normalized),
      runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      deliveryContractSha256: digest(contract), distSha256: digest(dist), qaSha256: digest(qa),
      browser: { available: true }, buildDelivery: { qaStatus: "passed" },
    }));
    return { status: "admitted" as const, framework: "vite_react" as const, normalizedSource: normalized,
      sourceTreeSha256: digest(normalized), runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      contract, dist, qa, browserReceipt, qaStatus: "passed" as const };
  });
  const fetchFixture = async (input: any) => {
    const bytes = payloads.get(String(input));
    if (!bytes) throw new Error("Unexpected fixture URL");
    return new Response(new Uint8Array(bytes));
  };
  try {
    vi.resetModules();
    vi.doMock("../server/siteops/static-template-catalog-manifest.js", () => ({ ...manifest,
      STATIC_TEMPLATE_CATALOG_VERSION: "21st-included-recommended-20260828-v2", STATIC_TEMPLATE_CATALOG_PAGE_COUNT: 4,
      STATIC_TEMPLATE_CATALOG_ENTRY_COUNT: 32, FROZEN_STATIC_TEMPLATE_CATALOG: definitions.slice(0, 32),
      STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS: ["static-template-22-hirael-agency-landing"],
    }));
    const oldRuntime = await import("../server/siteops/static-template-catalog.js");
    const previous = await oldRuntime.seedStaticTemplateCatalog({ rootDir: root, fetchImpl: fetchFixture as typeof fetch, executionAdmissionBuilder: builder });
    expect(previous.catalog.entryCount).toBe(32);
    const previous22 = previous.catalog.entries[21]!;
    vi.doMock("../server/siteops/static-template-catalog-manifest.js", () => ({ ...manifest,
      STATIC_TEMPLATE_CATALOG_VERSION: PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION,
    }));
    vi.resetModules();
    const v3Runtime = await import("../server/siteops/static-template-catalog.js");
    const fetchNewOnly = vi.fn(async (input: any) => {
      const url = String(input);
      if (!url.includes("/xiafanzeng/frontmind-brand/") && !definitions.slice(32).some(entry => entry.previewUrl === url)) throw new Error("Old template must use verified local cache");
      return fetchFixture(input);
    });
    const v3 = await v3Runtime.seedStaticTemplateCatalog({ rootDir: root, concurrency: 1, fetchImpl: fetchNewOnly as typeof fetch, executionAdmissionBuilder: builder });
    expect(fetchNewOnly).toHaveBeenCalledTimes(4);
    const manifestPath = (version: string) => path.join(root, "siteops/static-template-catalog/catalogs", version, "manifest.json");
    const v2Manifest = await readFile(manifestPath(previous.catalog.catalogVersion));
    const v3Manifest = await readFile(manifestPath(v3.catalog.catalogVersion));
    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js");
    vi.resetModules();
    const current = await import("../server/siteops/static-template-catalog.js");
    builder.mockClear();
    const offlineFetch = vi.fn(async () => { throw new Error("Verified cached v3 must need no downloads"); });
    const upgraded = await current.seedStaticTemplateCatalog({ rootDir: root, concurrency: 1, fetchImpl: offlineFetch as typeof fetch, executionAdmissionBuilder: builder });
    expect(upgraded.catalog.entries).toHaveLength(35);
    expect(upgraded.catalog.entries.filter(entry => entry.executionAdmission.status === "admitted")).toHaveLength(4);
    expect(upgraded.catalog.entries[21]?.sourceSha256).toBe(previous22.sourceSha256);
    expect(builder.mock.calls.find(([input]) => input.definition.order === 22)?.[0].cachedNormalizedSource).toMatchObject({ sha256: previous22.sourceSha256 });
    expect(builder.mock.calls.filter(([input]) => input.cachedNormalizedSource)).toHaveLength(4);
    expect(offlineFetch).not.toHaveBeenCalled();
    expect((await current.loadStaticTemplateCatalogVersion(previous.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(32);
    expect((await current.loadStaticTemplateCatalogVersion(v3.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(35);
    expect(await readFile(manifestPath(previous.catalog.catalogVersion))).toEqual(v2Manifest);
    expect(await readFile(manifestPath(v3.catalog.catalogVersion))).toEqual(v3Manifest);
    for (const entry of upgraded.catalog.entries.slice(32)) {
      expect(entry.executionAdmission.status).toBe("admitted");
      if (entry.executionAdmission.status !== "admitted") throw new Error("Missing required admission");
      const receipt = JSON.parse(await readFile(path.join(root, entry.executionAdmission.browserReceiptPath), "utf8"));
      expect(receipt.binding).toMatchObject({ catalogVersion: manifest.STATIC_TEMPLATE_CATALOG_VERSION, candidateId: entry.candidateId, runtimeMedia: [] });
    }
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Healthy ensure-ready must remain offline"); }));
    const { runStaticTemplateCatalogCli } = await import("../server/siteops/static-template-catalog-cli.js");
    await runStaticTemplateCatalogCli(["--ensure-ready", "--root", root]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ ok: true, reused: true, entryCount: 35, admittedCount: 4 });

    // A buggy producer can make every file/hash/stat self-consistent while
    // claiming the wrong candidate's media. Counts and integrity alone cannot
    // establish that this evidence belongs to the required template.
    const admission = upgraded.catalog.entries[32]!.executionAdmission;
    if (admission.status !== "admitted") throw new Error("Missing required admission");
    const receiptPath = path.join(root, admission.browserReceiptPath);
    const badReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    badReceipt.binding.runtimeMedia = REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA;
    const badBytes = Buffer.from(JSON.stringify(badReceipt) + "\n");
    await writeFile(receiptPath, badBytes);
    admission.browserReceiptSha256 = digest(badBytes);
    admission.browserReceiptBytes = badBytes.length;
    admission.admissionEvidenceSha256 = current.staticTemplateAdmissionEvidenceSha256({ ...admission, ...admission.binding });
    const newManifest = Buffer.from(JSON.stringify(upgraded.catalog) + "\n");
    await writeFile(manifestPath(upgraded.catalog.catalogVersion), newManifest);
    const integrityPath = path.join(path.dirname(manifestPath(upgraded.catalog.catalogVersion)), "integrity.json");
    const integrity = JSON.parse(await readFile(integrityPath, "utf8"));
    integrity.manifestSha256 = digest(newManifest);
    const receiptStat = await stat(receiptPath, { bigint: true });
    Object.assign(integrity.assets.find((asset: any) => asset.path === admission.browserReceiptPath), {
      sha256: digest(badBytes), bytes: badBytes.length, inode: receiptStat.ino.toString(),
      modifiedNs: receiptStat.mtimeNs.toString(), changedNs: receiptStat.ctimeNs.toString(),
    });
    const integrityBytes = Buffer.from(JSON.stringify(integrity) + "\n");
    await writeFile(integrityPath, integrityBytes);
    const activePath = path.join(root, "siteops/static-template-catalog/active.json");
    const active = JSON.parse(await readFile(activePath, "utf8"));
    Object.assign(active, { manifestSha256: digest(newManifest), integritySha256: digest(integrityBytes) });
    await writeFile(activePath, JSON.stringify(active) + "\n");
    expect(await current.getStaticTemplateCatalogReadiness({ rootDir: root })).toMatchObject({
      ready: false, code: "STATIC_TEMPLATE_CATALOG_ADMISSION_BINDING_INVALID",
    });
    await expect(runStaticTemplateCatalogCli(["--ensure-ready", "--root", root])).rejects.toThrow("STATIC_TEMPLATE_CATALOG_VERSION_CONFLICT");
    expect(await readFile(receiptPath)).toEqual(badBytes);
    expect(await readFile(manifestPath(v3.catalog.catalogVersion))).toEqual(v3Manifest);
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js"); vi.resetModules();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
