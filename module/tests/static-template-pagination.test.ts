// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { visualSelectionBundleV7Schema } from "../contracts/siteops.js";
import { siteOpsObservationV1Schema } from "../contracts/siteops-contract.js";
import { CURATED_STATIC_TEMPLATE_CATALOG_VERSION, PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION, staticTemplatePageLength, staticTemplatePagination } from "../contracts/static-template-pagination.js";
import { completePublishedVisualPageCount, projectSiteOpsVisualGeneration, projectStaticTemplateCatalogVisualReadiness, resolveVisualCatalogObservationCoordinates } from "../server/siteops/service.js";
import { FROZEN_STATIC_TEMPLATE_CATALOG, STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS } from "../server/siteops/static-template-catalog-manifest.js";

const oldVersion = "21st-included-recommended-20260828-v2";
function bundle(version: string, page: number) {
  const pagination = staticTemplatePagination(version);
  const candidates = Array.from({ length: staticTemplatePageLength(version, page) }, (_, index) => {
    const order = (page - 1) * 8 + index + 1;
    const digest = createHash("sha256").update(String(order)).digest("hex");
    return {
      id: `candidate-${order}`, sampleId: `candidate-${order}`, label: String.fromCharCode(65 + index),
      title: "Template", description: null, catalogVersion: version, catalogPosition: order,
      catalogCandidateId: `static-template-${String(order).padStart(2, "0")}-test`,
      providerTemplateId: String(order), providerSlug: `template-${order}`, providerVersion: "a".repeat(40),
      sourceOwner: "test", sourceRepo: "test", sourceCommitSha: "a".repeat(40), sourceSubdirectory: null, sourceLicense: "MIT",
      sourceAssetId: `source-${order}`, sourceArchiveSha256: digest, sourceArchiveBytes: 100,
      previewAssetId: `preview-${order}`, previewSha256: digest, previewMimeType: "image/png", previewWidth: 32, previewHeight: 32,
      executionAdmission: { status: "unavailable", rawSourceSha256: digest, code: "TEST_UNAVAILABLE", reason: "Not admitted" },
    };
  });
  return { schemaVersion: 7, renderer: "frontmind_static_template_catalog_v1", workflowVersion: "2.9.0", catalogVersion: version,
    pageNumber: page, pageSize: 8, pageCount: pagination.pageCount, displayTarget: candidates.length,
    candidates, selectedCandidateId: null, delegated: false, degradedReasons: [] };
}

function observation(version: string) {
  const pagination = staticTemplatePagination(version);
  // The service omits its private recovery flag from the public observation.
  const { recoveredSelection: _recoveredSelection, ...visualGeneration } = projectSiteOpsVisualGeneration({
    projectStatus: "awaiting_visual_selection", generatedPages: pagination.pageCount,
    availablePages: pagination.pageCount, reservedPages: 0,
    hasActiveVisualOperation: false, hasActiveBuild: false, hasBuildAttempt: false,
    workflowVersion: "2.9.0", catalogVersion: version, pageSize: 8, pageCount: pagination.pageCount,
  });
  const visualCandidatePages = Array.from({ length: pagination.pageCount }, (_, index) => ({
    batchId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    page: index + 1,
    candidates: bundle(version, index + 1).candidates.map(candidate => ({
      id: candidate.id, label: candidate.label, title: candidate.title,
      previewUrl: `https://example.test/${candidate.id}.png`,
    })),
  }));
  return {
    schemaVersion: 1, executionKind: "site_ops",
    serviceReadiness: {
      visuals: { status: "configured" }, website: { status: "configured" },
      publishing: { status: "configured" }, domain: { status: "not_configured" },
    },
    aliyunConnection: { configured: false, status: "not_connected", verifiedAt: null, canDisconnect: true },
    domainState: null,
    project: {
      id: "11111111-1111-4111-8111-111111111111", conversationId: "catalog-test", revision: 1,
      status: "awaiting_visual_selection", currentKnowledgeSnapshotId: null,
      primaryLanguage: "zh-CN", canonicalHostname: null, updatedAt: "2026-10-24T00:00:00.000Z",
    },
    brief: null, messages: [], visualCandidatePages,
    visualGeneration,
    rebuildRequest: { allowed: false, resetApplied: false, resetSourceBuildId: null },
    interactionState: "awaiting_visual_selection", latestSequence: 1,
  };
}

describe("frozen catalog pagination", () => {
  it("keeps v2 page four readable after catalog upgrades", () => {
    expect(visualSelectionBundleV7Schema.parse(bundle(oldVersion, 4)).candidates).toHaveLength(8);
    const coordinates = resolveVisualCatalogObservationCoordinates({ frozenVisualInput: { workflowVersion: "2.9.0", catalogVersion: oldVersion }, hasAnyVisualOperation: true, visibleBatchCount: 4 });
    expect(coordinates.pageCount).toBe(4);
    expect(coordinates.catalogVersion).toBe(oldVersion);
  });
  it("accepts all 35 positions with a three-candidate fifth page", () => {
    const pages = Array.from({ length: 5 }, (_, index) => visualSelectionBundleV7Schema.parse(bundle(CURATED_STATIC_TEMPLATE_CATALOG_VERSION, index + 1)));
    expect(pages.map(page => page.candidates.length)).toEqual([8, 8, 8, 8, 3]);
    expect(pages.flatMap(page => page.candidates).at(-1)?.catalogPosition).toBe(35);
  });
  it("serializes all five current pages through the public observation contract", () => {
    const current = siteOpsObservationV1Schema.parse(observation(CURATED_STATIC_TEMPLATE_CATALOG_VERSION));
    expect(current.visualCandidatePages.map(page => page.candidates.length)).toEqual([8, 8, 8, 8, 3]);
    expect(current.visualGeneration).toMatchObject({ maxPages: 5, generatedPages: 5, canSelectExisting: true });
    expect(siteOpsObservationV1Schema.parse(observation(oldVersion)).visualGeneration.maxPages).toBe(4);
    expect(siteOpsObservationV1Schema.safeParse({
      ...observation(oldVersion), visualCandidatePages: current.visualCandidatePages,
    }).success).toBe(false);
  });
  it("keeps frozen v3 bundles and public observations at 35 entries and five pages", () => {
    const version = PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION;
    expect(visualSelectionBundleV7Schema.parse(bundle(version, 5)).candidates).toHaveLength(3);
    const historical = siteOpsObservationV1Schema.parse(observation(version));
    expect(historical.visualGeneration).toMatchObject({ maxPages: 5, generatedPages: 5 });
    expect(historical.visualCandidatePages.map(page => page.candidates.length)).toEqual([8, 8, 8, 8, 3]);
  });
  it("rejects mixed versions, incomplete full pages and extra legacy pages", () => {
    expect(visualSelectionBundleV7Schema.safeParse({ ...bundle(oldVersion, 4), pageCount: 5 }).success).toBe(false);
    expect(visualSelectionBundleV7Schema.safeParse({ ...bundle(oldVersion, 4), pageNumber: 5 }).success).toBe(false);
    const page = bundle(CURATED_STATIC_TEMPLATE_CATALOG_VERSION, 1);
    expect(visualSelectionBundleV7Schema.safeParse({ ...page, candidates: page.candidates.slice(0, 3), displayTarget: 3 }).success).toBe(false);
  });
  it("counts the short final page as a complete selectable page", () => {
    const batches = Array.from({ length: 5 }, (_, index) => ({ id: String(index), status: "published" }));
    const candidates = batches.flatMap((batch, index) => Array.from({ length: staticTemplatePageLength(CURATED_STATIC_TEMPLATE_CATALOG_VERSION, index + 1) }, () => ({ batchId: batch.id })));
    expect(completePublishedVisualPageCount({ batches, candidates, pageSize: 8, catalogVersion: CURATED_STATIC_TEMPLATE_CATALOG_VERSION })).toBe(5);
    expect(completePublishedVisualPageCount({ batches: batches.slice(0, 4), candidates, pageSize: 8, catalogVersion: oldVersion })).toBe(4);
  });
  it("requires every supported template admission before advertising readiness", () => {
    const catalog = {
      workflowVersion: "2.8.0", catalogVersion: CURATED_STATIC_TEMPLATE_CATALOG_VERSION,
      pageSize: 8, pageCount: 5,
      entries: FROZEN_STATIC_TEMPLATE_CATALOG.map(entry => ({
        candidateId: entry.candidateId,
        executionAdmission: { status: STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS.includes(entry.candidateId) ? "admitted" as const : "unavailable" as const },
      })),
    };
    expect(projectStaticTemplateCatalogVisualReadiness(catalog).status).toBe("configured");
    catalog.entries[34]!.executionAdmission.status = "unavailable";
    expect(projectStaticTemplateCatalogVisualReadiness(catalog).status).toBe("not_configured");
  });
});
