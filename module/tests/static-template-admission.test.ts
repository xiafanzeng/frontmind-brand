// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright";
import { expect, it, vi } from "vitest";
import { FROZEN_STATIC_TEMPLATE_CATALOG, STATIC_TEMPLATE_CATALOG_VERSION } from "../server/siteops/static-template-catalog-manifest.js";
import { buildStaticTemplateExecutionAdmission } from "../server/siteops/static-template-execution-admission.js";

const browserInstalled = existsSync(chromium.executablePath());
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
      const result = await buildStaticTemplateExecutionAdmission({ catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, definition, rawSourcePath: target, rawSourceSha256: digest, rawSourceBytes: raw.length, signal: AbortSignal.timeout(120_000) });
      expect(result.status).toBe("admitted");
      if (result.status !== "admitted") throw new Error(result.code);
      const qa = JSON.parse(result.qa.toString());
      expect(qa.passed).toBe(true);
      expect(qa.browser.available).toBe(true);
      const receipt = JSON.parse(result.browserReceipt.toString());
      expect(receipt.binding).toMatchObject({ catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, candidateId: definition.candidateId, rawSourceSha256: digest, runtimeMedia: [] });
      expect(receipt.normalizedSourceSha256).toBe(createHash("sha256").update(result.normalizedSource).digest("hex"));
      if (slug === "helpcenter-search") {
        const cachedPath = path.join(root, "normalized-source.zip");
        await writeFile(cachedPath, result.normalizedSource);
        const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Cached admission must stay offline"));
        try {
          const rebound = await buildStaticTemplateExecutionAdmission({
            catalogVersion: STATIC_TEMPLATE_CATALOG_VERSION, definition,
            rawSourcePath: target, rawSourceSha256: digest, rawSourceBytes: raw.length,
            cachedNormalizedSource: { path: cachedPath, sha256: receipt.normalizedSourceSha256,
              bytes: result.normalizedSource.length, sourceTreeSha256: result.sourceTreeSha256, rawSourceSha256: digest },
            signal: AbortSignal.timeout(120_000),
          });
          expect(rebound.status).toBe("admitted");
          if (rebound.status !== "admitted") throw new Error(rebound.code);
          expect(rebound.normalizedSource).toEqual(result.normalizedSource);
          expect(JSON.parse(rebound.browserReceipt.toString()).binding.runtimeMedia).toEqual([]);
          expect(JSON.parse(rebound.qa.toString()).browser.available).toBe(true);
          expect(network).not.toHaveBeenCalled();
        } finally { network.mockRestore(); }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000,
);
