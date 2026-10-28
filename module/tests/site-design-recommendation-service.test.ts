// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  finalizeSiteDesignPreferencesDraft,
  requireCurrentSiteDesignRecommendationSnapshot,
  projectSiteDesignRecommendationSources,
  requireSiteDesignTemplateCoordinateMatchesSelection,
  requireSiteDesignTemplateMatchesSelection,
  requireSiteDesignRecommendationTemplate,
  siteBriefForRevision,
  SiteOpsServiceError,
} from "../server/siteops/service.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function staticSelectionMetadata(input?: {
  candidateId?: string;
  catalogVersion?: string;
}) {
  return {
    schemaVersion: 7 as const,
    renderer: "frontmind_static_template_catalog_v1" as const,
    workflowVersion: "2.9.0" as const,
    catalogVersion:
      input?.catalogVersion ?? "frontmind-curated-20261025-v7",
    catalogPosition: 1,
    catalogCandidateId:
      input?.candidateId ?? "static-template-35-frontmind-help",
    providerTemplateId: "provider-template-1",
    providerSlug: "provider-template-1",
    providerVersion: null,
    sourceOwner: "frontmind",
    sourceRepo: "templates",
    sourceCommitSha: "a".repeat(40),
    sourceSubdirectory: null,
    sourceLicense: "MIT" as const,
    sourceAssetId: "source-asset-1",
    sourceArchiveSha256: HASH_A,
    sourceArchiveBytes: 1,
    previewAssetId: "preview-asset-1",
    previewSha256: HASH_B,
    previewMimeType: "image/png" as const,
    previewWidth: 1200,
    previewHeight: 900,
  };
}

function snapshot(input: {
  id: string;
  version: number;
  archiveHash: string | null;
  status?: "active" | "archived";
  createdAt?: Date;
}) {
  return {
    id: input.id,
    version: input.version,
    archiveHash: input.archiveHash,
    status: input.status ?? "active",
    createdAt: input.createdAt ?? new Date("2026-10-28T00:00:00.000Z"),
  };
}

describe("read-only site-design recommendation service boundary", () => {
  it("finalizes a canonical server-authoritative draft hash and freezes it into revisions", () => {
    const draft = {
      schemaVersion: 1 as const,
      siteName: "远山科技",
      siteGoal: "展示真实产品与服务",
      featuredRouteIds: ["home"] as string[],
      siteAccent: "#6d28d9",
      assistant: {
        name: "知识助手",
        welcome: "您好",
        accentMode: "follow_site" as const,
        customAccent: null,
      },
      knowledgeSnapshot: {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        archiveHash: HASH_A,
      },
      template: {
        id: "static-template-35-frontmind-help",
        version: "frontmind-curated-20261025-v7",
      },
    };
    const first = finalizeSiteDesignPreferencesDraft(draft, 1);
    const repeated = finalizeSiteDesignPreferencesDraft(draft, 1);
    const changed = finalizeSiteDesignPreferencesDraft(
      { ...draft, siteGoal: "展示真实解决方案" },
      1,
    );
    expect(first).toEqual(repeated);
    expect(first.draftHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.draftHash).not.toBe(first.draftHash);

    const parentBrief = {
      companyName: "旧名称",
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: ["服务"],
      audience: ["访客"],
      conversionGoal: "旧目标",
      contentInventory: {
        schemaVersion: 1 as const,
        source: "frozen_knowledge_snapshot" as const,
        entries: [],
      },
      routes: [
        {
          id: "home",
          slug: "/",
          title: "首页",
          sourceDocumentIds: ["doc-home"],
        },
      ],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    };
    const revisionBrief = siteBriefForRevision(parentBrief, {
      ...parentBrief,
      companyName: first.siteName,
      conversionGoal: first.siteGoal,
      designPreferences: first,
    });
    expect(revisionBrief.companyName).toBe(first.siteName);
    expect(revisionBrief.conversionGoal).toBe(first.siteGoal);
    expect(revisionBrief.designPreferences).toEqual(first);
    expect(revisionBrief.routes).toEqual(parentBrief.routes);
    expect(() =>
      requireSiteDesignTemplateMatchesSelection(revisionBrief, {}),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "REVISION_CONFLICT",
        statusCode: 409,
      }),
    );
    expect(requireSiteDesignTemplateMatchesSelection(parentBrief, {})).toBeNull();
  });

  it("selects only the latest published snapshot when the full coordinate matches", () => {
    const latest = snapshot({
      id: "22222222-2222-4222-8222-222222222222",
      version: 2,
      archiveHash: HASH_B,
      createdAt: new Date("2026-10-28T02:00:00.000Z"),
    });
    const older = snapshot({
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      archiveHash: HASH_A,
      createdAt: new Date("2026-10-28T01:00:00.000Z"),
    });

    expect(
      requireCurrentSiteDesignRecommendationSnapshot([older, latest], {
        id: latest.id,
        version: latest.version,
        archiveHash: HASH_B,
      }),
    ).toBe(latest);
  });

  it("rejects a stale snapshot coordinate instead of returning stale advice", () => {
    const latest = snapshot({
      id: "22222222-2222-4222-8222-222222222222",
      version: 2,
      archiveHash: HASH_B,
    });
    const older = snapshot({
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      archiveHash: HASH_A,
    });

    expect(() =>
      requireCurrentSiteDesignRecommendationSnapshot([older, latest], {
        id: older.id,
        version: older.version,
        archiveHash: HASH_A,
      }),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "REVISION_CONFLICT",
        statusCode: 409,
      }),
    );
  });

  it("does not treat archived or unhashed knowledge as published input", () => {
    expect(() =>
      requireCurrentSiteDesignRecommendationSnapshot(
        [
          snapshot({
            id: "11111111-1111-4111-8111-111111111111",
            version: 1,
            archiveHash: HASH_A,
            status: "archived",
          }),
          snapshot({
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            archiveHash: null,
          }),
        ],
        {
          id: "22222222-2222-4222-8222-222222222222",
          version: 2,
          archiveHash: HASH_B,
        },
      ),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "NOT_FOUND",
        statusCode: 404,
      }),
    );
  });

  it("binds recommendations to a real candidate in the current template catalog", () => {
    const template = {
      candidateId: "static-template-35-frontmind-help",
      executionAdmission: { status: "admitted" as const },
    };
    const catalog = {
      catalogVersion: "frontmind-curated-20261025-v7",
      entries: [template],
    };
    expect(
      requireSiteDesignRecommendationTemplate(catalog, {
        id: template.candidateId,
        version: catalog.catalogVersion,
      }),
    ).toBe(template);
    expect(() =>
      requireSiteDesignRecommendationTemplate(catalog, {
        id: template.candidateId,
        version: "frontmind-curated-20261025-v6",
      }),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "REVISION_CONFLICT",
        statusCode: 409,
      }),
    );
    expect(() =>
      requireSiteDesignRecommendationTemplate(catalog, {
        id: "static-template-99-missing",
        version: catalog.catalogVersion,
      }),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "INVALID_INPUT",
        statusCode: 400,
      }),
    );
    expect(() =>
      requireSiteDesignRecommendationTemplate(
        {
          ...catalog,
          entries: [
            {
              ...template,
              executionAdmission: { status: "unavailable" as const },
            },
          ],
        },
        {
          id: template.candidateId,
          version: catalog.catalogVersion,
        },
      ),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "STATE_CONFLICT",
        statusCode: 409,
      }),
    );
  });

  it("rejects saving a template coordinate that differs from a frozen selection", () => {
    const metadata = staticSelectionMetadata();
    expect(
      requireSiteDesignTemplateCoordinateMatchesSelection(
        {
          id: metadata.catalogCandidateId,
          version: metadata.catalogVersion,
        },
        metadata,
      ),
    ).toMatchObject({
      catalogCandidateId: metadata.catalogCandidateId,
      catalogVersion: metadata.catalogVersion,
    });
    expect(() =>
      requireSiteDesignTemplateCoordinateMatchesSelection(
        {
          id: "static-template-other",
          version: metadata.catalogVersion,
        },
        metadata,
      ),
    ).toThrow(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "REVISION_CONFLICT",
        statusCode: 409,
      }),
    );
  });

  it("projects storage IDs to stable opaque coordinates and rejects fake core evidence", () => {
    const storageId = "archive/internal/company-overview.md";
    const brief = {
      companyName: "企业简介",
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: ["企业简介"],
      audience: ["访客"],
      conversionGoal: "介绍企业",
      contentInventory: {
        schemaVersion: 1 as const,
        source: "frozen_knowledge_snapshot" as const,
        entries: [],
      },
      routes: [
        { id: "home", slug: "/", title: "首页", sourceDocumentIds: [storageId] },
        { id: "about", slug: "/about", title: "关于", sourceDocumentIds: [storageId] },
        {
          id: "offerings",
          slug: "/offerings",
          title: "产品与服务",
          sourceDocumentIds: [storageId],
        },
      ],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    };
    const knowledgeSnapshot = {
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      archiveHash: HASH_A,
    };
    const first = projectSiteDesignRecommendationSources({
      brief,
      knowledgeSnapshot,
      documents: [
        { id: storageId, title: "企业简介", content: "这是一篇普通概览。" },
      ],
    });
    const second = projectSiteDesignRecommendationSources({
      brief,
      knowledgeSnapshot,
      documents: [
        { id: storageId, title: "企业简介", content: "这是一篇普通概览。" },
      ],
    });

    expect(first).toEqual(second);
    expect(first.documents[0]?.id).toMatch(/^source_[a-f0-9]{48}$/u);
    expect(JSON.stringify(first)).not.toContain(storageId);
    expect(
      first.brief.routes.find((route) => route.id === "offerings")
        ?.sourceDocumentIds,
    ).toEqual([]);
  });

  it("keeps the public API implementation read-only and provider-free", () => {
    const source = readFileSync(
      new URL("../server/siteops/service.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/gu, "\n");
    const start = source.indexOf("export async function recommendSiteDesign");
    const end = source.indexOf(
      "export function finalizeSiteDesignPreferencesDraft",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const implementation = source.slice(start, end);
    expect(implementation).toContain(
      "requireSiteOpsReadOnlyEntitlement(ownerUserId)",
    );
    expect(implementation).not.toContain(
      "requireSiteOpsEntitlement(ownerUserId)",
    );
    expect(implementation).toContain(".select()");
    expect(implementation).not.toMatch(
      /\.(?:insert|update|delete|transaction)\s*\(|reserveSiteOpsQuota|reserveOperation|appendMessage|siteProjects|providerTask/gu,
    );

    const entitlementStart = source.indexOf(
      "async function requireSiteOpsReadOnlyEntitlement",
    );
    const entitlementEnd = source.indexOf(
      "async function reserveSiteOpsDeliveryQuota",
      entitlementStart,
    );
    const entitlementImplementation = source.slice(
      entitlementStart,
      entitlementEnd,
    );
    expect(entitlementImplementation).toContain("getServicePortalReadOnly");
    expect(entitlementImplementation).not.toMatch(/getServicePortal\s*\(/u);
  });

  it("checks an existing build selection inside the save transaction", () => {
    const source = readFileSync(
      new URL("../server/siteops/service.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/gu, "\n");
    const start = source.indexOf("export async function saveSiteDesignPreferences");
    const end = source.indexOf("export async function openSiteOps", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const implementation = source.slice(start, end);
    expect(implementation).toContain("await db.transaction(async (tx: any) =>");
    expect(implementation).toContain("if (project.currentBuildId)");
    expect(implementation).toContain(".innerJoin(\n          websiteStyleSamples,");
    expect(implementation).toContain(
      "requireSiteDesignTemplateCoordinateMatchesSelection(\n        input.draft.template,",
    );
  });
});
