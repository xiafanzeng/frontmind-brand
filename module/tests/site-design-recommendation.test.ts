import { describe, expect, it } from "vitest";

import type { SiteBrief } from "../contracts/siteops";
import {
  createSiteDesignRecommendation,
  type CreateSiteDesignRecommendationInput,
} from "../server/siteops/site-design-recommendation";

const SNAPSHOT = {
  id: "13f45c95-8345-4f4e-ac55-86be8d4f3236",
  version: 7,
  archiveHash: "a".repeat(64),
} as const;

const TEMPLATE = {
  id: "business-clear-v3",
  version: "catalog-2026-10-28",
} as const;

const DOCUMENTS = [
  {
    id: "doc-about",
    title: "企业简介",
    content: "远山科技专注于可信企业知识服务，并坚持所有公开内容可追溯。",
  },
  {
    id: "doc-brand",
    title: "远山科技品牌说明",
    content: "品牌名称：远山科技。远山科技是一家企业知识服务公司。",
  },
  {
    id: "doc-contact",
    title: "联系方式",
    content: "联系邮箱：hello@example.com。",
  },
  {
    id: "doc-faq",
    title: "常见问题",
    content: "知识快照发布后，网站只展示已经确认的企业事实。",
  },
  {
    id: "doc-product-a",
    title: "知识问答产品",
    content: "知识问答产品基于企业已经发布的知识快照回答问题。",
  },
  {
    id: "doc-product-b",
    title: "官网生成产品",
    content: "官网生成产品把知识库中的真实内容映射为可验证页面。",
  },
  {
    id: "doc-service",
    title: "实施服务",
    content: "实施服务覆盖知识整理、验证和上线支持。",
  },
] as const;

function fullBrief(): SiteBrief {
  return {
    companyName: "远山科技",
    primaryLanguage: "zh-CN",
    contacts: [
      {
        kind: "email",
        value: "hello@example.com",
        sourceDocumentIds: ["doc-contact"],
      },
    ],
    offerings: ["知识问答产品", "官网生成产品", "实施服务"],
    audience: ["希望构建可信企业官网的团队"],
    conversionGoal: "帮助访客理解真实产品能力并通过已验证方式咨询",
    contentInventory: {
      schemaVersion: 1,
      source: "frozen_knowledge_snapshot",
      entries: [],
    },
    routes: [
      {
        id: "home",
        slug: "/",
        title: "首页",
        sourceDocumentIds: ["doc-brand", "doc-about"],
      },
      {
        id: "about",
        slug: "/about",
        title: "关于",
        sourceDocumentIds: ["doc-about"],
      },
      {
        id: "offerings",
        slug: "/offerings",
        title: "业务",
        sourceDocumentIds: ["doc-service"],
      },
      {
        id: "products",
        slug: "/products",
        title: "产品",
        sourceDocumentIds: ["doc-product-a", "doc-product-b"],
      },
      {
        id: "services",
        slug: "/services",
        title: "服务",
        sourceDocumentIds: ["doc-service"],
      },
      {
        id: "faq",
        slug: "/faq",
        title: "问答",
        sourceDocumentIds: ["doc-faq"],
      },
      {
        id: "contact",
        slug: "/contact",
        title: "联系",
        sourceDocumentIds: ["doc-contact"],
      },
      {
        id: "news",
        slug: "/news",
        title: "动态",
        sourceDocumentIds: [],
      },
    ],
    verifiedFacts: [
      {
        statement: "远山科技专注于可信企业知识服务。",
        sourceDocumentIds: ["doc-about"],
      },
      {
        statement: "官网生成产品只使用知识库中的真实内容。",
        sourceDocumentIds: ["doc-product-b"],
      },
    ],
    publicAssetIds: [],
    unknowns: [],
  };
}

function input(brief = fullBrief()): CreateSiteDesignRecommendationInput {
  return {
    brief,
    requestContext: {
      requestId: "request-20261028-0001",
      baseDesignRevision: 1,
      baseDraftHash: "b".repeat(64),
    },
    knowledgeSnapshot: SNAPSHOT,
    template: TEMPLATE,
    documents: DOCUMENTS,
  };
}

describe("site design recommendation", () => {
  it("ranks home, the best-covered core page and verified contact first", () => {
    const recommendation = createSiteDesignRecommendation(input());

    // Every source-backed route joins the default navigation; the priority
    // picks only fix the head of the ranking.
    expect(recommendation.featuredRouteIds).toEqual(
      recommendation.candidates.map((candidate) => candidate.id),
    );
    expect(
      recommendation.candidates.every((candidate) => candidate.featured),
    ).toBe(true);
    expect(
      recommendation.candidates.slice(0, 3).map((candidate) => ({
        id: candidate.id,
        rank: candidate.importanceRank,
        reason: candidate.recommendationReason,
      })),
    ).toEqual([
      { id: "home", rank: 1, reason: "homepage_entry" },
      { id: "products", rank: 2, reason: "core_business_coverage" },
      { id: "contact", rank: 3, reason: "verified_contact_conversion" },
    ]);
    expect(recommendation.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(["about", "offerings", "services", "faq"]),
    );
    expect(
      recommendation.candidates.every(
        (candidate) =>
          candidate.sourceDocumentIds.length > 0 &&
          candidate.evidenceDocumentCount ===
            candidate.sourceDocumentIds.length,
      ),
    ).toBe(true);
    expect(recommendation.candidates.some((candidate) => candidate.id === "news")).toBe(
      false,
    );
    expect(recommendation.siteGoal).toEqual({
      value:
        "帮助访客了解知识问答产品、官网生成产品，并通过已验证的联系方式进一步咨询",
      status: "recommended",
      sourceDocumentIds: ["doc-contact", "doc-product-a", "doc-product-b"],
    });
  });

  it("returns deterministic output and hashes independent of source array order", () => {
    const original = input();
    const reversed: CreateSiteDesignRecommendationInput = {
      ...original,
      brief: {
        ...original.brief,
        routes: [...original.brief.routes].reverse(),
        verifiedFacts: [...original.brief.verifiedFacts].reverse(),
      },
      documents: [...original.documents].reverse(),
    };

    const first = createSiteDesignRecommendation(original);
    const second = createSiteDesignRecommendation(reversed);

    expect(second).toEqual(first);
    expect(first.recommendationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      createSiteDesignRecommendation({
        ...original,
        requestContext: {
          ...original.requestContext,
          requestId: "request-20261028-retry",
        },
      }).recommendationHash,
    ).toBe(first.recommendationHash);
    expect(
      createSiteDesignRecommendation({
        ...original,
        template: { ...original.template, version: "catalog-2026-10-29" },
      }).recommendationHash,
    ).not.toBe(first.recommendationHash);
  });

  it("deduplicates stable route coordinates without discarding their evidence", () => {
    const brief = fullBrief();
    brief.routes.push(
      {
        id: "products",
        slug: "/products/",
        title: "产品中心",
        sourceDocumentIds: ["doc-service"],
      },
      {
        id: "product-catalog",
        slug: "/products/",
        title: "全部产品",
        sourceDocumentIds: ["doc-product-a"],
      },
    );

    const recommendation = createSiteDesignRecommendation(input(brief));
    const productRoutes = recommendation.candidates.filter(
      (candidate) => candidate.slug.toLowerCase() === "/products",
    );

    expect(productRoutes).toHaveLength(1);
    expect(productRoutes[0].sourceDocumentIds).toEqual([
      "doc-product-a",
      "doc-product-b",
      "doc-service",
    ]);
    expect(new Set(recommendation.candidates.map((candidate) => candidate.id)).size).toBe(
      recommendation.candidates.length,
    );
  });

  it("uses the best-evidenced fallback when there is no verified contact", () => {
    const brief = fullBrief();
    brief.contacts = [];
    brief.routes = brief.routes
      .filter((route) => route.id !== "contact")
      .map((route) =>
        route.id === "about"
          ? {
              ...route,
              sourceDocumentIds: ["doc-about", "doc-brand"],
            }
          : route,
      );

    const recommendation = createSiteDesignRecommendation(input(brief));

    expect(recommendation.featuredRouteIds).toEqual(
      recommendation.candidates.map((candidate) => candidate.id),
    );
    expect(recommendation.candidates[2].recommendationReason).toBe(
      "fallback_knowledge_coverage",
    );
  });

  it("keeps sourced secondary pages in the default navigation after the priority picks", () => {
    const brief = fullBrief();
    brief.contacts = [];
    brief.routes = brief.routes
      .filter((route) =>
        ["home", "products", "news"].includes(route.id),
      )
      .map((route) =>
        route.id === "news"
          ? { ...route, sourceDocumentIds: ["doc-faq"] }
          : route,
      );

    const recommendation = createSiteDesignRecommendation(input(brief));

    expect(recommendation.candidates.map((candidate) => candidate.id)).toEqual([
      "home",
      "products",
      "news",
    ]);
    expect(recommendation.featuredRouteIds).toEqual([
      "home",
      "products",
      "news",
    ]);
  });

  it("does not invent missing routes or recommend an untrusted placeholder name", () => {
    const brief = fullBrief();
    brief.companyName = "待确认企业名称";
    brief.contacts = [];
    brief.routes = [
      brief.routes.find((route) => route.id === "home")!,
      brief.routes.find((route) => route.id === "about")!,
      {
        id: "news",
        slug: "/news",
        title: "动态",
        sourceDocumentIds: [],
      },
    ];

    const recommendation = createSiteDesignRecommendation(input(brief));

    expect(recommendation.featuredRouteIds).toEqual(["home", "about"]);
    expect(recommendation.siteName).toEqual({
      value: null,
      status: "needs_confirmation",
      sourceType: "unavailable",
      sourceDocumentIds: [],
    });
    expect(recommendation.unresolved).toContain(
      "fewer_than_three_featured_routes",
    );
    expect(recommendation.unresolved).toContain(
      "site_name_needs_confirmation",
    );
  });

  it("does not trust a generic document title as the enterprise name", () => {
    const brief = fullBrief();
    brief.companyName = "2026产品手册";
    const recommendation = createSiteDesignRecommendation({
      ...input(brief),
      documents: [
        ...DOCUMENTS,
        {
          id: "doc-generic-title",
          title: "2026产品手册",
          content: "本文仅介绍产品功能，没有声明企业名称或品牌名称。",
        },
      ],
    });

    expect(recommendation.siteName).toEqual({
      value: null,
      status: "needs_confirmation",
      sourceType: "unavailable",
      sourceDocumentIds: [],
    });
  });

  it("bounds generated name and goal recommendations to the public contract", () => {
    const brief = fullBrief();
    const longName = `远山${"科".repeat(90)}`;
    const longSubject = "企业产品与解决方案".repeat(30);
    brief.companyName = longName;
    brief.routes = brief.routes.map((route) =>
      ["offerings", "products", "services"].includes(route.id)
        ? { ...route, sourceDocumentIds: ["doc-long-subject"] }
        : route,
    );

    const recommendation = createSiteDesignRecommendation({
      ...input(brief),
      documents: [
        ...DOCUMENTS,
        {
          id: "doc-long-name",
          title: longName,
          content: `品牌名称：${longName}。`,
        },
        {
          id: "doc-long-subject",
          title: longSubject,
          content: "该产品说明来自当前已发布知识快照。",
        },
      ],
    });

    expect(recommendation.siteName.value).toHaveLength(80);
    expect(recommendation.siteGoal.value).toHaveLength(200);
  });

  it("projects preview copy only from source-backed facts, documents and contacts", () => {
    const recommendation = createSiteDesignRecommendation(input());
    const sourceIds = new Set(DOCUMENTS.map((document) => document.id));
    const contact = recommendation.previewBlocks.find(
      (block) => block.routeId === "contact",
    );

    expect(contact).toMatchObject({
      kind: "contact",
      body: null,
      sourceDocumentIds: ["doc-contact"],
    });
    expect(contact?.items).toContainEqual({
      title: "邮箱",
      body: "hello@example.com",
      sourceDocumentIds: ["doc-contact"],
    });
    expect(
      recommendation.previewBlocks.every(
        (block) =>
          block.sourceDocumentIds.length > 0 &&
          block.sourceDocumentIds.every((sourceId) => sourceIds.has(sourceId)) &&
          block.items.every((item) =>
            item.sourceDocumentIds.every((sourceId) => sourceIds.has(sourceId)),
          ),
      ),
    ).toBe(true);
    expect(
      recommendation.previewBlocks.some(
        (block) =>
          block.body === "官网生成产品只使用知识库中的真实内容。" ||
          block.items.some(
            (item) =>
              item.body === "官网生成产品只使用知识库中的真实内容。",
          ),
      ),
    ).toBe(true);
  });
});
