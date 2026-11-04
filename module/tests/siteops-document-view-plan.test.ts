// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SiteContentPlanV2 } from "../contracts/siteops-content-plan.js";
import {
  deriveSiteDocumentViewPlanV1,
  SITE_DOCUMENT_VIEW_DOM,
  SITE_DOCUMENT_VIEW_PLAN_V1_FILENAME,
  SiteDocumentViewPlanError,
  siteDocumentViewPlanAttachment,
} from "../server/siteops/site-document-view-plan.js";

function plan(
  sectionSources: Array<{ id: string; sources: string[] }>,
): SiteContentPlanV2 {
  const sourceDocumentIds = [
    ...new Set(sectionSources.flatMap((section) => section.sources)),
  ];
  return {
    schemaVersion: 2,
    inventorySha256: "a".repeat(64),
    routes: [
      {
        id: "home",
        path: "/",
        title: "首页",
        navigation: "primary",
        parentPath: null,
        detailOfPath: null,
        purpose: "介绍",
        userQuestions: [],
        h1: "首页",
        summary: "首页摘要",
        cta: null,
        sections: sectionSources.map((section) => ({
          id: section.id,
          blockKind: "prose" as const,
          heading: section.id,
          purpose: section.id,
          body: section.id,
          sourceBindings: section.sources.map((sourceDocumentId) => ({
            sourceDocumentId,
            evidenceExcerpt: `evidence:${sourceDocumentId}`,
          })),
          mediaIds: [],
          entityIds: [],
          faqIds: [],
        })),
      },
    ],
    navigation: [{ label: "首页", targetPath: "/" }],
    coverage: sourceDocumentIds.map((sourceDocumentId) => ({
      sourceDocumentId,
      status: "used" as const,
      routeIds: ["home"],
      omissionReason: null,
    })),
  };
}

const documents = [
  {
    id: "identity-2",
    path: "nodes/identity-2.md",
    title: "第二节",
    content: "第二节原文",
    branchId: "identity",
    branchTitle: "企业身份",
    order: 20,
  },
  {
    id: "services-1",
    path: "nodes/services-1.md",
    title: "服务一",
    content: "服务原文",
    branchId: "services",
    branchTitle: "服务能力",
    order: 1,
  },
  {
    id: "identity-1",
    path: "nodes/identity-1.md",
    title: "第一节",
    content: "第一节原文",
    branchId: "identity",
    branchTitle: "企业身份",
    order: 10,
  },
] as const;

describe("site document view plan v1", () => {
  it("expands a referenced node to the complete, ordered branch", () => {
    const result = deriveSiteDocumentViewPlanV1({
      contentPlan: plan([
        { id: "hero", sources: ["identity-2", "services-1"] },
        { id: "details", sources: ["services-1"] },
      ]),
      documents,
    });

    expect(result.routes[0]).toEqual({
      routeId: "home",
      path: "/",
      branchIds: ["identity", "services"],
      sections: [
        { sectionId: "hero", branchIds: ["identity", "services"] },
        { sectionId: "details", branchIds: ["services"] },
      ],
    });
    expect(result.branches.map((branch) => branch.id)).toEqual([
      "identity",
      "services",
    ]);
    expect(result.branches[0]).toMatchObject({
      id: "identity",
      title: "企业身份",
      nodes: [
        { id: "identity-1", order: 10, content: "第一节原文" },
        { id: "identity-2", order: 20, content: "第二节原文" },
      ],
    });
  });

  it("uses a stable one-document branch when historical metadata is absent", () => {
    const result = deriveSiteDocumentViewPlanV1({
      contentPlan: plan([{ id: "legacy", sources: ["legacy-1"] }]),
      documents: [
        {
          id: "legacy-1",
          path: "legacy.md",
          title: "历史文档",
          content: "历史原文",
        },
      ],
    });

    expect(result.branches).toEqual([
      {
        id: "document:legacy-1",
        title: "历史文档",
        nodes: [
          {
            id: "legacy-1",
            path: "legacy.md",
            title: "历史文档",
            order: 0,
            content: "历史原文",
          },
        ],
      },
    ]);
  });

  it("does not expose explicitly ignored generation-only sources", () => {
    const internalRevision = {
      id: "customer-revision:operation-1",
      path: "customer-revision/operation-1.md",
      title: "本轮客户明确修订要求",
      content: "不得公开的内部修订指令",
    };
    const result = deriveSiteDocumentViewPlanV1({
      contentPlan: plan([
        {
          id: "mixed",
          sources: [internalRevision.id, "identity-1"],
        },
        { id: "internal-only", sources: [internalRevision.id] },
      ]),
      documents: [...documents, internalRevision],
      ignoredSourceDocumentIds: [internalRevision.id],
    });

    expect(result.routes[0]).toMatchObject({
      branchIds: ["identity"],
      sections: [
        { sectionId: "mixed", branchIds: ["identity"] },
        { sectionId: "internal-only", branchIds: [] },
      ],
    });
    expect(result.branches).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("不得公开的内部修订指令");
  });

  it("rejects duplicate document ids and unknown source bindings", () => {
    expect(() =>
      deriveSiteDocumentViewPlanV1({
        contentPlan: plan([{ id: "hero", sources: ["identity-1"] }]),
        documents: [documents[2], { ...documents[2] }],
      }),
    ).toThrowError(
      new SiteDocumentViewPlanError(
        "SITE_DOCUMENT_VIEW_DUPLICATE_DOCUMENT_ID",
        "identity-1",
      ),
    );

    expect(() =>
      deriveSiteDocumentViewPlanV1({
        contentPlan: plan([{ id: "hero", sources: ["missing"] }]),
        documents,
      }),
    ).toThrowError(
      new SiteDocumentViewPlanError(
        "SITE_DOCUMENT_VIEW_SOURCE_DOCUMENT_MISSING",
        "missing",
      ),
    );
  });

  it("exports stable coordinates without duplicating dossier bodies", () => {
    const result = deriveSiteDocumentViewPlanV1({
      contentPlan: plan([{ id: "hero", sources: ["identity-1"] }]),
      documents,
    });
    const attachment = siteDocumentViewPlanAttachment(result);
    const decoded = Buffer.from(
      attachment.file_data.split(",", 2)[1]!,
      "base64",
    ).toString("utf8");
    const providerPlan = JSON.parse(decoded);

    expect(attachment.filename).toBe(SITE_DOCUMENT_VIEW_PLAN_V1_FILENAME);
    expect(providerPlan).toMatchObject({
      schemaVersion: 1,
      sourceDossierFilename: "frontmind-siteops-source-dossier-v1.json",
      nodeContentSource: "match_node_id_in_single_dossier_or_manifest_parts",
      splitDossierRule: "read_manifest_parts_and_join_contentPartIndex",
      routes: result.routes,
      branches: [
        {
          id: "identity",
          title: "企业身份",
          nodes: [
            {
              id: "identity-1",
              path: "nodes/identity-1.md",
              title: "第一节",
              order: 10,
            },
            {
              id: "identity-2",
              path: "nodes/identity-2.md",
              title: "第二节",
              order: 20,
            },
          ],
        },
      ],
    });
    expect(providerPlan.branches[0].nodes[0]).not.toHaveProperty("content");
    expect(decoded).not.toContain("第一节原文");
    expect(decoded).not.toContain("第二节原文");
    expect(SITE_DOCUMENT_VIEW_DOM).toEqual({
      triggerBranchesAttribute: "data-frontmind-document-branches",
      dialogAttribute: "data-frontmind-document-dialog",
      branchAttribute: "data-frontmind-document-branch",
      nodeAttribute: "data-frontmind-document-node",
      closeAttribute: "data-frontmind-document-close",
    });
  });
});
