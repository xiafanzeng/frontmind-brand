// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import {
  FROZEN_STATIC_TEMPLATE_CATALOG,
  STATIC_TEMPLATE_CATALOG_VERSION,
  STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS,
} from "../server/siteops/static-template-catalog-manifest.js";
import {
  buildStaticTemplateExecutionAdmission,
  staticTemplatePreviewFallbackReasonCode,
} from "../server/siteops/static-template-execution-admission.js";
import { NativeVisualSourceError } from "../server/siteops/native-visual-source.js";

it("requires execution admission for every frozen catalog template", () => {
  expect(STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS).toEqual(
    FROZEN_STATIC_TEMPLATE_CATALOG.map(entry => entry.candidateId),
  );
});

it.each([
  "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED",
  "NATIVE_TEMPLATE_SOURCE_UNSAFE",
  "NATIVE_TEMPLATE_ARCHIVE_INVALID",
  "NATIVE_SOURCE_EXECUTION_UNSAFE",
  "NATIVE_SOURCE_STATIC_MEDIA_INTEGRITY_MISMATCH",
])("allows preview fallback only for deterministic source error %s", code => {
  expect(
    staticTemplatePreviewFallbackReasonCode(new NativeVisualSourceError(code)),
  ).toBe(code);
});

it("does not downgrade ordinary, aborted, network, or browser environment errors", () => {
  expect(staticTemplatePreviewFallbackReasonCode(new Error("compile failed"))).toBeNull();
  expect(
    staticTemplatePreviewFallbackReasonCode(
      new NativeVisualSourceError("NATIVE_SOURCE_STATIC_MEDIA_UNAVAILABLE"),
    ),
  ).toBeNull();
  expect(
    staticTemplatePreviewFallbackReasonCode(
      new NativeVisualSourceError("NATIVE_PREVIEW_RENDER_FAILED"),
    ),
  ).toBeNull();
  const controller = new AbortController();
  controller.abort();
  expect(
    staticTemplatePreviewFallbackReasonCode(
      new NativeVisualSourceError("NATIVE_TEMPLATE_SOURCE_UNSAFE"),
      controller.signal,
    ),
  ).toBeNull();
});

const browserInstalled = existsSync(chromium.executablePath());
it.runIf(browserInstalled)(
  "builds an unsupported provider source as a preview-bound fallback through real Chromium QA",
  async () => {
    const definition = FROZEN_STATIC_TEMPLATE_CATALOG[0]!;
    const zip = new JSZip();
    zip.file(
      "fixture-main/package.json",
      JSON.stringify({
        private: true,
        dependencies: {
          "definitely-not-installed": "1.0.0",
          react: "19.2.1",
          "react-dom": "19.2.1",
        },
      }),
    );
    zip.file(
      "fixture-main/index.html",
      '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    );
    zip.file(
      "fixture-main/src/main.tsx",
      'import React from "react";import{createRoot}from"react-dom/client";import App from"./App";createRoot(document.getElementById("root")!).render(<App/>);',
    );
    zip.file(
      "fixture-main/src/App.tsx",
      'import "definitely-not-installed";export default function App(){return <main>Provider source</main>}',
    );
    const raw = await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
    const preview = await sharp({
      create: {
        width: 48,
        height: 32,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    }).png().toBuffer();
    const root = await mkdtemp(path.join(os.tmpdir(), "frontmind-preview-fallback-"));
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Preview fallback must stay offline"));
    try {
      const rawPath = path.join(root, "raw.zip");
      const previewPath = path.join(root, "preview.png");
      await writeFile(rawPath, raw);
      await writeFile(previewPath, preview);
      const rawSha256 = createHash("sha256").update(raw).digest("hex");
      const previewSha256 = createHash("sha256").update(preview).digest("hex");
      const result = await buildStaticTemplateExecutionAdmission({
        catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION,
        definition,
        rawSourcePath: rawPath,
        rawSourceSha256: rawSha256,
        rawSourceBytes: raw.length,
        previewPath,
        previewSha256,
        previewBytes: preview.length,
        previewMimeType: "image/png",
        signal: AbortSignal.timeout(120_000),
      });

      expect(result.status).toBe("admitted");
      if (result.status !== "admitted") throw new Error(result.code);
      expect(result).toMatchObject({
        admissionMode: "preview_reference_fallback",
        referencePreviewSha256: previewSha256,
        fallbackReasonCode: "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED",
      });
      expect(JSON.parse(result.qa.toString())).toMatchObject({
        passed: true,
        browser: { available: true },
      });
      expect(JSON.parse(result.browserReceipt.toString()).binding).toMatchObject({
        rawSourceSha256: rawSha256,
        admissionMode: "preview_reference_fallback",
        referencePreviewSha256: previewSha256,
        fallbackReasonCode: "NATIVE_TEMPLATE_DEPENDENCY_UNSUPPORTED",
      });
      const normalized = await JSZip.loadAsync(result.normalizedSource);
      const frozenPreview = Object.values(normalized.files).find(
        entry => !entry.dir && entry.name.endsWith("/public/template-preview.png"),
      );
      expect(frozenPreview).toBeTruthy();
      expect(await frozenPreview!.async("nodebuffer")).toEqual(preview);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);

it.runIf(browserInstalled).each(["helpcenter-search", "helpcenter-docs", "helpcenter-minimal"])(
  "admits %s through the real controlled compiler and Chromium QA without provider APIs",
  async slug => {
    const definition = FROZEN_STATIC_TEMPLATE_CATALOG.find(entry => entry.providerSlug === slug)!;
    const zip = new JSZip();
    const sourceRoot = new URL(`../server/siteops/local-templates/${slug}/`, import.meta.url);
    async function add(directory: URL, relative = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = relative + entry.name;
        const location = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) await add(location, name + "/");
        else zip.file(`frozen/${definition.sourceSubdirectory}/${name}`, await readFile(location));
      }
    }
    await add(sourceRoot);
    const raw = await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
    const root = await mkdtemp(path.join(os.tmpdir(), "frontmind-helpcenter-admission-"));
    try {
      const target = path.join(root, "raw.zip");
      await writeFile(target, raw);
      const digest = createHash("sha256").update(raw).digest("hex");
      const result = await buildStaticTemplateExecutionAdmission({ catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, definition, rawSourcePath: target, rawSourceSha256: digest, rawSourceBytes: raw.length, previewPath: target, previewSha256: digest, previewBytes: raw.length, previewMimeType: "image/png", signal: AbortSignal.timeout(120_000) });
      expect(result.status).toBe("admitted");
      if (result.status !== "admitted") throw new Error(result.code);
      const qa = JSON.parse(result.qa.toString());
      expect(qa.passed).toBe(true);
      expect(qa.browser.available).toBe(true);
      const receipt = JSON.parse(result.browserReceipt.toString());
      expect(result).toMatchObject({ admissionMode: "provider_source", referencePreviewSha256: null, fallbackReasonCode: null });
      expect(receipt.binding).toMatchObject({ catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, candidateId: definition.candidateId, rawSourceSha256: digest, runtimeMedia: [], admissionMode: "provider_source", referencePreviewSha256: null, fallbackReasonCode: null });
      expect(receipt.normalizedSourceSha256).toBe(createHash("sha256").update(result.normalizedSource).digest("hex"));
      if (slug === "helpcenter-search") {
        const cachedPath = path.join(root, "normalized-source.zip");
        await writeFile(cachedPath, result.normalizedSource);
        const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Cached admission must stay offline"));
        try {
          const rebound = await buildStaticTemplateExecutionAdmission({
            catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, definition,
            rawSourcePath: target, rawSourceSha256: digest, rawSourceBytes: raw.length,
            previewPath: target, previewSha256: digest, previewBytes: raw.length, previewMimeType: "image/png",
            cachedNormalizedSource: { path: cachedPath, sha256: receipt.normalizedSourceSha256,
              bytes: result.normalizedSource.length, sourceTreeSha256: result.sourceTreeSha256, rawSourceSha256: digest },
            signal: AbortSignal.timeout(120_000),
          });
          expect(rebound.status).toBe("admitted");
          if (rebound.status !== "admitted") throw new Error(rebound.code);
          expect(rebound.normalizedSource).toEqual(result.normalizedSource);
          expect(rebound).toMatchObject({ admissionMode: "verified_normalized_cache", referencePreviewSha256: null, fallbackReasonCode: null });
          expect(JSON.parse(rebound.browserReceipt.toString()).binding).toMatchObject({ runtimeMedia: [], admissionMode: "verified_normalized_cache", referencePreviewSha256: null, fallbackReasonCode: null });
          expect(JSON.parse(rebound.qa.toString()).browser.available).toBe(true);
          expect(network).not.toHaveBeenCalled();
        } finally { network.mockRestore(); }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000,
);
