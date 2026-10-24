// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import * as manifest from "../server/siteops/static-template-catalog-manifest.js";
import { NATIVE_RUNTIME_CONTRACT_V1_SHA256, NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256 } from "../server/siteops/native-react-source.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
it("upgrades verified v2 assets, preserves #22 bytes, and makes ensure-ready an offline noop", async () => {
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
    return { status: "admitted" as const, framework: "vite_react" as const, normalizedSource: normalized,
      sourceTreeSha256: digest(normalized), runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256, contract: Buffer.from("contract"),
      dist: Buffer.from("dist"), qa: Buffer.from("qa"), browserReceipt: Buffer.from("browser"), qaStatus: "passed" as const };
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
    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js");
    vi.resetModules();
    const current = await import("../server/siteops/static-template-catalog.js");
    builder.mockClear();
    const fetchNewOnly = vi.fn(async (input: any) => {
      const url = String(input);
      if (!url.includes("/xiafanzeng/frontmind-brand/") && !definitions.slice(32).some(entry => entry.previewUrl === url)) throw new Error("Old template must use verified local cache");
      return fetchFixture(input);
    });
    const upgraded = await current.seedStaticTemplateCatalog({ rootDir: root, concurrency: 1, fetchImpl: fetchNewOnly as typeof fetch, executionAdmissionBuilder: builder });
    expect(upgraded.catalog.entries).toHaveLength(35);
    expect(upgraded.catalog.entries.filter(entry => entry.executionAdmission.status === "admitted")).toHaveLength(4);
    expect(upgraded.catalog.entries[21]?.sourceSha256).toBe(previous22.sourceSha256);
    expect(builder.mock.calls.find(([input]) => input.definition.order === 22)?.[0].cachedNormalizedSource).toMatchObject({ sha256: previous22.sourceSha256 });
    expect(fetchNewOnly).toHaveBeenCalledTimes(4);
    expect((await current.loadStaticTemplateCatalogVersion(previous.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(32);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Healthy ensure-ready must remain offline"); }));
    const { runStaticTemplateCatalogCli } = await import("../server/siteops/static-template-catalog-cli.js");
    await runStaticTemplateCatalogCli(["--ensure-ready", "--root", root]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ ok: true, reused: true, entryCount: 35, admittedCount: 4 });
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js"); vi.resetModules();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
