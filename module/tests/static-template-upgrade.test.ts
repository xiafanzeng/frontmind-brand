// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import {
  visualSelectionBundleV7Schema,
  type VisualSelectionBundleV7,
} from "../contracts/siteops.js";
import * as manifest from "../server/siteops/static-template-catalog-manifest.js";
import { NATIVE_RUNTIME_CONTRACT_V1_SHA256, NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256 } from "../server/siteops/native-react-source.js";
import {
  PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION,
} from "../contracts/static-template-pagination.js";
import { staticTemplateRuntimeMedia } from "../server/siteops/static-template-admission-policy.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const v4Version = "frontmind-curated-20261025-v4";
const v5Version = "frontmind-curated-20261025-v5";
const v6Version = PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION;

function selectionBundleForCatalog(
  catalog: Awaited<
    ReturnType<
      typeof import("../server/siteops/static-template-catalog.js").seedStaticTemplateCatalog
    >
  >["catalog"],
  selectedCandidateId: string,
): VisualSelectionBundleV7 {
  const selected = catalog.entries.find(
    entry => entry.candidateId === selectedCandidateId,
  );
  if (!selected) throw new Error("Missing selected fixture candidate");
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
  const candidates = catalog.entries
    .filter(entry => entry.page === selected.page)
    .map(entry => {
      const admission = entry.executionAdmission;
      return {
        id: entry.candidateId,
        sampleId: entry.candidateId,
        label: labels[entry.pageIndex]!,
        title: entry.providerName,
        description: entry.providerDescription,
        catalogVersion: catalog.catalogVersion,
        catalogPosition: entry.order,
        catalogCandidateId: entry.candidateId,
        providerTemplateId: entry.providerTemplateId,
        providerSlug: entry.providerSlug,
        providerVersion: entry.providerVersion,
        sourceOwner: entry.sourceOwner,
        sourceRepo: entry.sourceRepo,
        sourceCommitSha: entry.sourceCommitSha,
        sourceSubdirectory: entry.sourceSubdirectory,
        sourceLicense: entry.sourceLicense,
        sourceAssetId: entry.sourceAssetId,
        sourceArchiveSha256: entry.sourceSha256,
        sourceArchiveBytes: entry.sourceBytes,
        previewAssetId: entry.previewAssetId,
        previewSha256: entry.previewSha256,
        previewMimeType: entry.previewMimeType,
        previewWidth: entry.previewWidth,
        previewHeight: entry.previewHeight,
        executionAdmission: admission.status === "admitted"
          ? {
              status: "admitted" as const,
              rawSourceSha256: admission.binding.rawSourceSha256,
              normalizedSourceSha256: admission.normalizedSourceSha256,
              sourceTreeSha256: admission.sourceTreeSha256,
              runtimeContractSha256: admission.runtimeContractSha256,
              executionShellSha256: admission.executionShellSha256,
              deliveryContractSha256: admission.deliveryContractSha256,
              distSha256: admission.distSha256,
              qaSha256: admission.qaSha256,
              browserReceiptSha256: admission.browserReceiptSha256,
              qaStatus: admission.qaStatus,
              admissionEvidenceSha256: admission.admissionEvidenceSha256,
              ...(admission.admissionMode !== undefined
                ? { admissionMode: admission.admissionMode }
                : {}),
              ...(admission.referencePreviewSha256 !== undefined
                ? {
                    referencePreviewSha256:
                      admission.referencePreviewSha256,
                  }
                : {}),
              ...(admission.fallbackReasonCode !== undefined
                ? { fallbackReasonCode: admission.fallbackReasonCode }
                : {}),
            }
          : {
              status: "unavailable" as const,
              rawSourceSha256: admission.binding.rawSourceSha256,
              code: admission.code,
              reason: admission.reason,
            },
      };
    });
  return visualSelectionBundleV7Schema.parse({
    schemaVersion: 7,
    renderer: "frontmind_static_template_catalog_v1",
    workflowVersion: "2.8.0",
    catalogVersion: catalog.catalogVersion,
    pageNumber: selected.page,
    pageSize: catalog.pageSize,
    pageCount: catalog.pageCount,
    displayTarget: candidates.length,
    candidates,
    selectedCandidateId,
    delegated: false,
    degradedReasons: [],
  });
}

it("serves exact v6 during rollout, upgrades from historical caches to the single v7 admission, and rejects receipt tampering", { timeout: 180000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontmind-catalog-upgrade-"));
  const payloads = new Map<string, Buffer>();
  const definitions = manifest.HISTORICAL_FROZEN_STATIC_TEMPLATE_CATALOG;
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
  const v2AdmissionIds = ["static-template-22-hirael-agency-landing"];
  const v4AdmissionIds = [
    ...v2AdmissionIds,
    "static-template-33-helpcenter-search",
    "static-template-34-helpcenter-docs",
    "static-template-35-helpcenter-minimal",
  ];
  const previewFallbackIds = [
    "static-template-15-hirael-nexacore",
    "static-template-21-hirael-mindloop",
  ];
  // This fixture replaces the compiler transport only; the separate admission
  // suite runs the three repository-local templates through real Vite and Chromium.
  const builder = vi.fn(async (input: any) => {
    const admittedIds = input.catalogVersion === "21st-included-recommended-20260828-v2"
      ? v2AdmissionIds
      : input.catalogVersion === v4Version
        ? v4AdmissionIds
        : input.catalogVersion === v5Version
          ? definitions.map((entry) => entry.candidateId)
          : input.catalogVersion === v6Version
            ? manifest.ROLLING_STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS
            : manifest.STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS;
    if (!admittedIds.includes(input.definition.candidateId)) return { status: "unavailable" as const, code: "TEST_NOT_ADMITTED", reason: "Transport fixture" };
    const normalized = input.cachedNormalizedSource ? await readFile(input.cachedNormalizedSource.path)
      : await new JSZip().file("source/binding.txt", input.rawSourceSha256).generateAsync({ type: "nodebuffer", platform: "UNIX" });
    const contract = Buffer.from("contract");
    const dist = Buffer.from("dist");
    const qa = Buffer.from(JSON.stringify({ passed: true, browser: { available: true } }));
    const runtimeMedia = staticTemplateRuntimeMedia(input.definition.candidateId);
    const bindsProvenance =
      input.catalogVersion === manifest.STATIC_TEMPLATE_CATALOG_VERSION ||
      input.catalogVersion === v5Version ||
      input.catalogVersion === v6Version;
    const admissionMode = input.cachedNormalizedSource
      ? "verified_normalized_cache"
      : previewFallbackIds.includes(input.definition.candidateId) ||
          input.definition.order === 1
        ? "preview_reference_fallback"
        : "provider_source";
    const provenance = bindsProvenance ? {
      admissionMode,
      referencePreviewSha256: admissionMode === "preview_reference_fallback" ? input.previewSha256 : null,
      fallbackReasonCode: admissionMode === "preview_reference_fallback" ? "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED" : null,
    } : {};
    const browserReceipt = Buffer.from(JSON.stringify({
      schemaVersion: 1, receiptKind: "frontmind_static_template_browser_admission",
      binding: { catalogVersion: input.catalogVersion, candidateId: input.definition.candidateId,
        rawSourceSha256: input.rawSourceSha256, runtimeMedia, ...provenance },
      normalizedSourceSha256: digest(normalized), sourceTreeSha256: digest(normalized),
      runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      deliveryContractSha256: digest(contract), distSha256: digest(dist), qaSha256: digest(qa),
      browser: { available: true }, buildDelivery: { qaStatus: "passed" },
    }));
    return { status: "admitted" as const, framework: "vite_react" as const, normalizedSource: normalized,
      sourceTreeSha256: digest(normalized), runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      contract, dist, qa, browserReceipt, qaStatus: "passed" as const, ...provenance };
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
      STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS: v2AdmissionIds,
    }));
    const oldRuntime = await import("../server/siteops/static-template-catalog.js");
    const previous = await oldRuntime.seedStaticTemplateCatalog({ rootDir: root, fetchImpl: fetchFixture as typeof fetch, executionAdmissionBuilder: builder });
    expect(previous.catalog.entryCount).toBe(32);
    vi.doMock("../server/siteops/static-template-catalog-manifest.js", () => ({ ...manifest,
      STATIC_TEMPLATE_CATALOG_VERSION: v4Version,
      STATIC_TEMPLATE_CATALOG_PAGE_COUNT: 5,
      STATIC_TEMPLATE_CATALOG_ENTRY_COUNT: 35,
      FROZEN_STATIC_TEMPLATE_CATALOG: definitions,
      STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS: v4AdmissionIds,
    }));
    vi.resetModules();
    const v4Runtime = await import("../server/siteops/static-template-catalog.js");
    const fetchNewOnly = vi.fn(async (input: any) => {
      const url = String(input);
      if (!url.includes("/xiafanzeng/frontmind-brand/") && !definitions.slice(32).some(entry => entry.previewUrl === url)) throw new Error("Old template must use verified local cache");
      return fetchFixture(input);
    });
    const v4 = await v4Runtime.seedStaticTemplateCatalog({ rootDir: root, concurrency: 1, fetchImpl: fetchNewOnly as typeof fetch, executionAdmissionBuilder: builder });
    expect(fetchNewOnly).toHaveBeenCalledTimes(4);
    expect(v4.catalog.entries.filter(entry => entry.executionAdmission.status === "admitted")).toHaveLength(4);
    const manifestPath = (version: string) => path.join(root, "siteops/static-template-catalog/catalogs", version, "manifest.json");
    const v2Manifest = await readFile(manifestPath(previous.catalog.catalogVersion));
    const v4Manifest = await readFile(manifestPath(v4.catalog.catalogVersion));
    for (const entry of JSON.parse(v4Manifest.toString()).entries.filter((candidate: any) => candidate.executionAdmission.status === "admitted")) {
      expect(entry.executionAdmission).not.toHaveProperty("admissionMode");
      expect(entry.executionAdmission).not.toHaveProperty("referencePreviewSha256");
      expect(entry.executionAdmission).not.toHaveProperty("fallbackReasonCode");
    }
    const v4Active = await readFile(path.join(root, "siteops/static-template-catalog/active.json"));
    vi.doMock("../server/siteops/static-template-catalog-manifest.js", () => ({ ...manifest,
      STATIC_TEMPLATE_CATALOG_VERSION: v5Version,
      STATIC_TEMPLATE_CATALOG_PAGE_COUNT: 5,
      STATIC_TEMPLATE_CATALOG_ENTRY_COUNT: 35,
      FROZEN_STATIC_TEMPLATE_CATALOG: definitions,
      STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS: definitions.map((entry) => entry.candidateId),
    }));
    vi.resetModules();
    const v5Runtime = await import("../server/siteops/static-template-catalog.js");
    const v5 = await v5Runtime.seedStaticTemplateCatalog({
      rootDir: root,
      concurrency: 1,
      fetchImpl: fetchNewOnly as typeof fetch,
      executionAdmissionBuilder: builder,
    });
    expect(v5.catalog.entries).toHaveLength(35);
    expect(v5.catalog.entries.every((entry) => entry.executionAdmission.status === "admitted")).toBe(true);
    const v5Manifest = await readFile(manifestPath(v5.catalog.catalogVersion));
    const v5Active = await readFile(path.join(root, "siteops/static-template-catalog/active.json"));
    await writeFile(path.join(root, "siteops/static-template-catalog/active.json"), v4Active);

    // Seed the v6 rolling catalog from the v5 historical cache: four verified
    // normalized caches plus two preview-reference fallbacks, no downloads.
    const definitionsById = new Map(definitions.map((definition) => [definition.candidateId, definition]));
    const v6Selection = manifest.ROLLING_STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS.map(
      (candidateId, index) => ({ ...definitionsById.get(candidateId)!, order: index + 1 }),
    );
    vi.doMock("../server/siteops/static-template-catalog-manifest.js", () => ({ ...manifest,
      STATIC_TEMPLATE_CATALOG_VERSION: v6Version,
      STATIC_TEMPLATE_CATALOG_PAGE_COUNT: 1,
      STATIC_TEMPLATE_CATALOG_ENTRY_COUNT: 6,
      FROZEN_STATIC_TEMPLATE_CATALOG: v6Selection,
      STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS: manifest.ROLLING_STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS,
    }));
    vi.resetModules();
    const v6Runtime = await import("../server/siteops/static-template-catalog.js");
    const v6OfflineFetch = vi.fn(async () => { throw new Error("Verified v5 caches must need no downloads"); });
    const v6 = await v6Runtime.seedStaticTemplateCatalog({
      rootDir: root,
      concurrency: 1,
      fetchImpl: v6OfflineFetch as typeof fetch,
      executionAdmissionBuilder: builder,
    });
    expect(v6.catalog.entries).toHaveLength(6);
    expect(v6.catalog.entries.filter(entry => entry.executionAdmission.status === "admitted")).toHaveLength(6);
    expect(v6OfflineFetch).not.toHaveBeenCalled();
    const v6Manifest = await readFile(manifestPath(v6.catalog.catalogVersion));
    const v6Active = await readFile(path.join(root, "siteops/static-template-catalog/active.json"));

    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js");
    vi.resetModules();
    const current = await import("../server/siteops/static-template-catalog.js");
    expect(await current.getStaticTemplateCatalogReadiness({ rootDir: root })).toMatchObject({
      ready: true,
      activeCatalogVersion: v6Version,
      upgradePending: true,
      entryCount: 6,
      admittedCount: 6,
      unavailableCount: 0,
      requiredAdmissionReady: true,
    });
    await writeFile(path.join(root, "siteops/static-template-catalog/active.json"), v5Active);
    await expect(current.loadActiveStaticTemplateCatalog({ rootDir: root })).rejects.toMatchObject({
      code: "STATIC_TEMPLATE_CATALOG_VERSION_MISMATCH",
    });
    await writeFile(path.join(root, "siteops/static-template-catalog/active.json"), v6Active);
    const v5ManifestPath = manifestPath(v5.catalog.catalogVersion);
    const unavailableV5 = JSON.parse(v5Manifest.toString());
    const unavailableEntry = unavailableV5.entries[32];
    unavailableEntry.executionAdmission = {
      status: "unavailable",
      binding: {
        catalogVersion: unavailableV5.catalogVersion,
        candidateId: unavailableEntry.candidateId,
        rawSourceSha256: unavailableEntry.rawSourceSha256,
      },
      code: "TEST_UNAVAILABLE",
      reason: "Strict v5 history must remain fully admitted",
    };
    Object.assign(unavailableEntry, {
      sourceAssetId: `${unavailableV5.catalogVersion}/source/${unavailableEntry.candidateId}`,
      sourcePath: unavailableEntry.rawSourcePath,
      sourceSha256: unavailableEntry.rawSourceSha256,
      sourceBytes: unavailableEntry.rawSourceBytes,
      sourceFileCount: unavailableEntry.rawSourceFileCount,
      sourceExpandedBytes: unavailableEntry.rawSourceExpandedBytes,
    });
    await writeFile(v5ManifestPath, `${JSON.stringify(unavailableV5)}\n`);
    await expect(
      current.loadStaticTemplateCatalogVersion(v5.catalog.catalogVersion, {
        rootDir: root,
      }),
    ).rejects.toMatchObject({
      // v5 is no longer the strict predecessor; its immutable integrity
      // receipt is what rejects a rewritten manifest.
      code: "STATIC_TEMPLATE_CATALOG_INTEGRITY_INVALID",
    });
    await writeFile(v5ManifestPath, v5Manifest);

    const missingProvenanceV5 = JSON.parse(v5Manifest.toString());
    delete missingProvenanceV5.entries[0].executionAdmission.admissionMode;
    await writeFile(v5ManifestPath, `${JSON.stringify(missingProvenanceV5)}\n`);
    await expect(
      current.loadStaticTemplateCatalogVersion(v5.catalog.catalogVersion, {
        rootDir: root,
      }),
    ).rejects.toMatchObject({
      code: "STATIC_TEMPLATE_CATALOG_MANIFEST_INVALID",
    });
    await writeFile(v5ManifestPath, v5Manifest);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { runStaticTemplateCatalogCli } = await import("../server/siteops/static-template-catalog-cli.js");
    await runStaticTemplateCatalogCli(["--check-active", "--root", root]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: true,
      reused: false,
      activeCatalogVersion: v6Version,
      upgradePending: true,
      admittedCount: 6,
      unavailableCount: 0,
    });
    builder.mockClear();
    const offlineFetch = vi.fn(async () => { throw new Error("Verified historical caches must need no downloads"); });
    vi.stubGlobal("fetch", offlineFetch);
    vi.doMock("../server/siteops/static-template-execution-admission.js", () => ({
      buildStaticTemplateExecutionAdmission: builder,
    }));
    await runStaticTemplateCatalogCli(["--ensure-ready", "--root", root]);
    const upgraded = { catalog: await current.requireActiveStaticTemplateCatalog({ rootDir: root }) };
    expect(upgraded.catalog.entries).toHaveLength(1);
    expect(upgraded.catalog.entries.filter(entry => entry.executionAdmission.status === "admitted")).toHaveLength(1);
    expect(upgraded.catalog.entries.map((entry) => entry.candidateId)).toEqual([
      "static-template-33-helpcenter-search",
    ]);
    expect(builder.mock.calls.filter(([input]) => input.cachedNormalizedSource)).toHaveLength(1);
    expect(offlineFetch).not.toHaveBeenCalled();
    expect((await current.loadStaticTemplateCatalogVersion(previous.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(32);
    expect((await current.loadStaticTemplateCatalogVersion(v4.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(35);
    expect((await current.loadStaticTemplateCatalogVersion(v5.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(35);
    expect((await current.loadStaticTemplateCatalogVersion(v6.catalog.catalogVersion, { rootDir: root, verifyAssetHashes: true }))?.entryCount).toBe(6);
    expect(await readFile(manifestPath(previous.catalog.catalogVersion))).toEqual(v2Manifest);
    expect(await readFile(manifestPath(v4.catalog.catalogVersion))).toEqual(v4Manifest);
    expect(await readFile(manifestPath(v5.catalog.catalogVersion))).toEqual(v5Manifest);
    expect(await readFile(manifestPath(v6.catalog.catalogVersion))).toEqual(v6Manifest);
    for (const entry of upgraded.catalog.entries) {
      expect(entry.executionAdmission.status).toBe("admitted");
      if (entry.executionAdmission.status !== "admitted") throw new Error("Missing required admission");
      const receipt = JSON.parse(await readFile(path.join(root, entry.executionAdmission.browserReceiptPath), "utf8"));
      const expectedMode = previewFallbackIds.includes(entry.candidateId)
        ? "preview_reference_fallback"
        : "verified_normalized_cache";
      const expectedReference = expectedMode === "preview_reference_fallback"
        ? entry.previewSha256
        : null;
      const expectedReason = expectedMode === "preview_reference_fallback"
        ? "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED"
        : null;
      expect(entry.executionAdmission).toMatchObject({
        admissionMode: expectedMode,
        referencePreviewSha256: expectedReference,
        fallbackReasonCode: expectedReason,
      });
      expect(receipt.binding).toMatchObject({
        catalogVersion: manifest.STATIC_TEMPLATE_CATALOG_VERSION,
        candidateId: entry.candidateId,
        runtimeMedia: staticTemplateRuntimeMedia(entry.candidateId),
        admissionMode: expectedMode,
        referencePreviewSha256: expectedReference,
        fallbackReasonCode: expectedReason,
      });
      expect(entry.executionAdmission.admissionEvidenceSha256).toBe(
        current.staticTemplateAdmissionEvidenceSha256({
          ...entry.executionAdmission,
          ...entry.executionAdmission.binding,
        }),
      );
    }
    await runStaticTemplateCatalogCli(["--ensure-ready", "--root", root]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ ok: true, reused: true, upgradePending: false, entryCount: 1, admittedCount: 1, unavailableCount: 0 });

    const serviceActivePath = path.join(
      root,
      "siteops/static-template-catalog/active.json",
    );
    const serviceIntegrityPath = path.join(
      path.dirname(manifestPath(upgraded.catalog.catalogVersion)),
      "integrity.json",
    );
    const stableActiveBytes = await readFile(serviceActivePath);
    const stableIntegrityBytes = await readFile(serviceIntegrityPath);
    const invalidIntegrity = JSON.parse(stableIntegrityBytes.toString());
    invalidIntegrity.assets[0].inode =
      invalidIntegrity.assets[0].inode === "0" ? "1" : "0";
    const invalidIntegrityBytes = Buffer.from(
      `${JSON.stringify(invalidIntegrity)}\n`,
    );
    const invalidActive = JSON.parse(stableActiveBytes.toString());
    invalidActive.integritySha256 = digest(invalidIntegrityBytes);
    await writeFile(serviceIntegrityPath, invalidIntegrityBytes);
    await writeFile(
      serviceActivePath,
      `${JSON.stringify(invalidActive)}\n`,
    );
    const { loadStaticTemplateCatalogForServiceReadiness } = await import(
      "../server/siteops/service.js"
    );
    expect(
      await loadStaticTemplateCatalogForServiceReadiness({ rootDir: root }),
    ).toBeNull();
    await writeFile(serviceIntegrityPath, stableIntegrityBytes);
    await writeFile(serviceActivePath, stableActiveBytes);
    expect(
      await loadStaticTemplateCatalogForServiceReadiness({ rootDir: root }),
    ).toMatchObject({ catalogVersion: manifest.STATIC_TEMPLATE_CATALOG_VERSION });

    const previousAssetRoot = process.env.FRONTMIND_DASHBOARD_ASSET_DIR;
    process.env.FRONTMIND_DASHBOARD_ASSET_DIR = root;
    try {
      const { selectedStaticNativeSourceArchive } = await import(
        "../server/siteops/manus-provider.js"
      );
      const v5Bundle = selectionBundleForCatalog(
        upgraded.catalog,
        upgraded.catalog.entries[0]!.candidateId,
      );
      const v5Selection = await selectedStaticNativeSourceArchive({
        bundle: v5Bundle,
        selectedCandidateId: v5Bundle.selectedCandidateId!,
      });
      expect(v5Selection.archiveSha256).toBe(
        upgraded.catalog.entries[0]!.sourceSha256,
      );

      const v4Selected = v4.catalog.entries.find(
        entry => entry.executionAdmission.status === "admitted",
      )!;
      const v4Bundle = selectionBundleForCatalog(
        v4.catalog,
        v4Selected.candidateId,
      );
      const v4Selection = await selectedStaticNativeSourceArchive({
        bundle: v4Bundle,
        selectedCandidateId: v4Bundle.selectedCandidateId!,
      });
      expect(v4Selection.archiveSha256).toBe(v4Selected.sourceSha256);

      const removedV5Entry = v5.catalog.entries[0]!;
      const removedV5Bundle = selectionBundleForCatalog(
        v5.catalog,
        removedV5Entry.candidateId,
      );
      const removedV5Candidate = removedV5Bundle.candidates.find(
        (candidate) => candidate.catalogCandidateId === removedV5Entry.candidateId,
      )!;
      const { openFrozenStaticTemplatePreviewDist } = await import(
        "../server/siteops/artifact-api.js"
      );
      const historicalPreview = await openFrozenStaticTemplatePreviewDist(
        {
          schemaVersion: 7,
          renderer: "frontmind_static_template_catalog_v1",
          workflowVersion: "2.9.0",
          ...removedV5Candidate,
        },
        { rootDir: root },
      );
      historicalPreview.stream.destroy();
      expect(historicalPreview.entry.candidateId).toBe(
        removedV5Entry.candidateId,
      );
      await expect(
        current.openStaticTemplateCatalogDist(removedV5Entry.candidateId, {
          rootDir: root,
        }),
      ).rejects.toMatchObject({
        code: "STATIC_TEMPLATE_CATALOG_CANDIDATE_NOT_FOUND",
      });
      await expect(
        openFrozenStaticTemplatePreviewDist(
          {
            schemaVersion: 7,
            renderer: "frontmind_static_template_catalog_v1",
            workflowVersion: "2.9.0",
            ...removedV5Candidate,
            sourceArchiveSha256: "0".repeat(64),
          },
          { rootDir: root },
        ),
      ).rejects.toThrow("NOT_FOUND");
    } finally {
      if (previousAssetRoot === undefined) {
        delete process.env.FRONTMIND_DASHBOARD_ASSET_DIR;
      } else {
        process.env.FRONTMIND_DASHBOARD_ASSET_DIR = previousAssetRoot;
      }
    }

    // The strict v6 predecessor remains an immutable cache source. Even when an
    // attacker rewrites all outer hashes, the browser receipt must still bind
    // the exact provenance frozen in the admission manifest.
    const tamperedV6ManifestPath = manifestPath(v6.catalog.catalogVersion);
    const tamperedV6Manifest = JSON.parse(v6Manifest.toString());
    const tamperedV6Entry = tamperedV6Manifest.entries[0];
    const tamperedV6Admission = tamperedV6Entry.executionAdmission;
    const tamperedV6ReceiptPath = path.join(
      root,
      tamperedV6Admission.browserReceiptPath,
    );
    const tamperedV6Receipt = JSON.parse(
      await readFile(tamperedV6ReceiptPath, "utf8"),
    );
    tamperedV6Receipt.binding.fallbackReasonCode =
      tamperedV6Admission.fallbackReasonCode ===
        "NATIVE_TEMPLATE_SOURCE_UNSAFE"
        ? "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED"
        : "NATIVE_TEMPLATE_SOURCE_UNSAFE";
    const tamperedV6ReceiptBytes = Buffer.from(
      `${JSON.stringify(tamperedV6Receipt)}\n`,
    );
    await writeFile(tamperedV6ReceiptPath, tamperedV6ReceiptBytes);
    tamperedV6Admission.browserReceiptSha256 = digest(
      tamperedV6ReceiptBytes,
    );
    tamperedV6Admission.browserReceiptBytes = tamperedV6ReceiptBytes.length;
    tamperedV6Admission.admissionEvidenceSha256 =
      current.staticTemplateAdmissionEvidenceSha256({
        ...tamperedV6Admission,
        ...tamperedV6Admission.binding,
      });
    const tamperedV6ManifestBytes = Buffer.from(
      `${JSON.stringify(tamperedV6Manifest)}\n`,
    );
    await writeFile(tamperedV6ManifestPath, tamperedV6ManifestBytes);
    const tamperedV6IntegrityPath = path.join(
      path.dirname(tamperedV6ManifestPath),
      "integrity.json",
    );
    const tamperedV6Integrity = JSON.parse(
      await readFile(tamperedV6IntegrityPath, "utf8"),
    );
    tamperedV6Integrity.manifestSha256 = digest(tamperedV6ManifestBytes);
    const tamperedV6ReceiptStat = await stat(tamperedV6ReceiptPath, { bigint: true });
    Object.assign(tamperedV6Integrity.assets.find((asset: any) => asset.path === tamperedV6Admission.browserReceiptPath), {
      sha256: digest(tamperedV6ReceiptBytes), bytes: tamperedV6ReceiptBytes.length, inode: tamperedV6ReceiptStat.ino.toString(),
      modifiedNs: tamperedV6ReceiptStat.mtimeNs.toString(), changedNs: tamperedV6ReceiptStat.ctimeNs.toString(),
    });
    await writeFile(
      tamperedV6IntegrityPath,
      `${JSON.stringify(tamperedV6Integrity)}\n`,
    );
    await expect(
      current.loadStaticTemplateCatalogVersion(v6.catalog.catalogVersion, {
        rootDir: root,
      }),
    ).rejects.toMatchObject({
      code: "STATIC_TEMPLATE_CATALOG_ADMISSION_BINDING_INVALID",
    });

    // A buggy producer can rewrite the fallback receipt and every outer
    // file/hash/stat consistently. The manifest provenance must still bind the
    // exact deterministic reason recorded by the browser admission receipt.
    const admission = upgraded.catalog.entries[0]!.executionAdmission;
    if (admission.status !== "admitted") throw new Error("Missing required admission");
    const receiptPath = path.join(root, admission.browserReceiptPath);
    const badReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    badReceipt.binding.fallbackReasonCode = "NATIVE_TEMPLATE_SOURCE_UNSAFE";
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
    expect(await readFile(manifestPath(v4.catalog.catalogVersion))).toEqual(v4Manifest);
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    vi.doUnmock("../server/siteops/static-template-execution-admission.js");
    vi.doUnmock("../server/siteops/static-template-catalog-manifest.js"); vi.resetModules();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
