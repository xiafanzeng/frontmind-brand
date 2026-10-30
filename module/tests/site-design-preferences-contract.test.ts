import { describe, expect, it } from "vitest";
import {
  UnknownSiteDesignFeaturedRouteError,
  UnsupportedSiteDesignPreferencesVersionError,
  deserializeSiteDesignPreferences,
  migrateSiteDesignPreferences,
  parseSiteDesignPreferencesForRoutes,
  serializeSiteDesignPreferences,
  siteDesignPreferencesV1Schema,
  siteDesignRecommendationInputSchema,
  siteDesignRecommendationMatchesRequest,
  siteDesignRecommendationOutputSchema,
  type SiteDesignPreferences,
  type SiteDesignRecommendationInput,
  type SiteDesignRecommendationOutput,
} from "../contracts/site-design-preferences";
import {
  applySiteDesignPreferencesToBrief,
  readSiteDesignPreferencesFromBrief,
  siteBriefSchema,
} from "../contracts/siteops";

const knowledgeSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 7,
  archiveHash: "a".repeat(64),
};

const template = {
  id: "static-template-candidate-12",
  version: "catalog-2026-10-28",
};

function preferences(): SiteDesignPreferences {
  return {
    schemaVersion: 1,
    siteName: "FrontMind 企业智能",
    siteGoal: "展示经知识库验证的企业能力，并为访客提供可核验的咨询入口。",
    featuredRouteIds: ["home", "services", "contact"],
    siteAccent: "#6D28D9",
    assistant: {
      name: "企业知识助手",
      welcome: "您好，我会依据已发布的企业资料回答问题。",
      accentMode: "follow_site",
      customAccent: "#2563EB",
    },
    knowledgeSnapshot,
    template,
    designRevision: 1,
    draftHash: "b".repeat(64),
  };
}

function recommendationInput(): SiteDesignRecommendationInput {
  return {
    schemaVersion: 1,
    requestContext: {
      requestId: "request-20261028-0001",
      baseDesignRevision: 1,
      baseDraftHash: "b".repeat(64),
    },
    knowledgeSnapshot,
    template,
  };
}

function recommendationOutput(): SiteDesignRecommendationOutput {
  return {
    schemaVersion: 1,
    requestContext: {
      requestId: "request-20261028-0001",
      baseDesignRevision: 1,
      baseDraftHash: "b".repeat(64),
    },
    knowledgeSnapshot,
    template,
    siteName: {
      value: "FrontMind 企业智能",
      status: "trusted",
      sourceType: "brand_name",
      sourceDocumentIds: ["doc-company"],
    },
    siteGoal: {
      value: "展示真实产品与服务，并提供已验证的联系入口。",
      status: "recommended",
      sourceDocumentIds: ["doc-services", "doc-contact"],
    },
    candidates: [
      {
        id: "home",
        slug: "/",
        title: "首页",
        sourceDocumentIds: ["doc-company"],
        evidenceDocumentCount: 1,
        importanceRank: 1,
        featured: true,
        recommendationReason: "homepage_entry",
      },
      {
        id: "services",
        slug: "/services",
        title: "产品与服务",
        sourceDocumentIds: ["doc-services"],
        evidenceDocumentCount: 1,
        importanceRank: 2,
        featured: true,
        recommendationReason: "core_business_coverage",
      },
      {
        id: "contact",
        slug: "/contact",
        title: "联系我们",
        sourceDocumentIds: ["doc-contact"],
        evidenceDocumentCount: 1,
        importanceRank: 3,
        featured: true,
        recommendationReason: "verified_contact_conversion",
      },
      {
        id: "about",
        slug: "/about",
        title: "关于我们",
        sourceDocumentIds: ["doc-company"],
        evidenceDocumentCount: 1,
        importanceRank: 4,
        featured: false,
        recommendationReason: "secondary_knowledge_coverage",
      },
    ],
    featuredRouteIds: ["home", "services", "contact"],
    previewBlocks: [
      {
        id: "home:hero",
        routeId: "home",
        kind: "hero",
        title: "FrontMind 企业智能",
        body: "展示经知识库验证的企业能力。",
        items: [],
        sourceDocumentIds: ["doc-company"],
      },
      {
        id: "contact:contact",
        routeId: "contact",
        kind: "contact",
        title: "联系我们",
        body: null,
        items: [
          {
            title: "邮箱",
            body: "hello@example.com",
            sourceDocumentIds: ["doc-contact"],
          },
        ],
        sourceDocumentIds: ["doc-contact"],
      },
    ],
    unresolved: [],
    recommendationHash: "c".repeat(64),
  };
}

describe("SiteDesignPreferences v1", () => {
  it("validates and round-trips the complete structured contract", () => {
    const value = preferences();
    expect(siteDesignPreferencesV1Schema.parse(value)).toEqual(value);
    expect(deserializeSiteDesignPreferences(serializeSiteDesignPreferences(value)))
      .toEqual(value);
  });

  it("accepts a fully selected navigation with more than three routes", () => {
    const value = preferences();
    value.featuredRouteIds = [
      "home",
      "services",
      "contact",
      "about",
      "faq",
      "news",
    ];
    expect(siteDesignPreferencesV1Schema.parse(value)).toEqual(value);
  });

  it("retains a valid custom assistant color while follow mode is active", () => {
    const value = preferences();
    value.assistant.accentMode = "follow_site";
    value.assistant.customAccent = "#123ABC";
    expect(siteDesignPreferencesV1Schema.parse(value).assistant.customAccent)
      .toBe("#123ABC");
  });

  it.each([
    ["invalid site color", (value: SiteDesignPreferences) => {
      value.siteAccent = "#fff";
    }],
    ["missing custom assistant color", (value: SiteDesignPreferences) => {
      value.assistant.accentMode = "custom";
      value.assistant.customAccent = null;
    }],
    ["duplicate featured route", (value: SiteDesignPreferences) => {
      value.featuredRouteIds = ["home", "home"];
    }],
    ["empty featured routes", (value: SiteDesignPreferences) => {
      value.featuredRouteIds = [];
    }],
    ["invalid featured route ID", (value: SiteDesignPreferences) => {
      value.featuredRouteIds = ["../admin"];
    }],
    ["too long site name", (value: SiteDesignPreferences) => {
      value.siteName = "名".repeat(81);
    }],
    ["too long site goal", (value: SiteDesignPreferences) => {
      value.siteGoal = "目标".repeat(101);
    }],
  ])("rejects %s", (_label, mutate) => {
    const value = preferences();
    mutate(value);
    expect(siteDesignPreferencesV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects deprecated UI fields and conversionGoal smuggling", () => {
    for (const field of [
      "language",
      "logo",
      "websiteUrl",
      "brandMark",
      "conversionGoal",
    ]) {
      const value = { ...preferences(), [field]: "must-not-enter-v1" };
      expect(siteDesignPreferencesV1Schema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects featured routes outside the source-backed frozen route set", () => {
    expect(() =>
      parseSiteDesignPreferencesForRoutes(preferences(), ["home", "services"]),
    ).toThrow(UnknownSiteDesignFeaturedRouteError);
    expect(
      parseSiteDesignPreferencesForRoutes(preferences(), [
        "home",
        "services",
        "contact",
        "about",
      ]),
    ).toEqual(preferences());
  });

  it("rejects an existing but source-free placeholder route at persistence", () => {
    const value = { ...preferences(), featuredRouteIds: ["news"] };
    const brief = {
      companyName: value.siteName,
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: [],
      audience: [],
      conversionGoal: value.siteGoal,
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
          sourceDocumentIds: ["doc-company"],
        },
        {
          id: "news",
          slug: "/news",
          title: "新闻",
          sourceDocumentIds: [],
        },
      ],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    };

    expect(() => applySiteDesignPreferencesToBrief(brief, value)).toThrow(
      UnknownSiteDesignFeaturedRouteError,
    );
  });

  it("routes every persisted version through an explicit migration case", () => {
    expect(migrateSiteDesignPreferences(preferences())).toEqual(preferences());
    expect(() => migrateSiteDesignPreferences({ ...preferences(), schemaVersion: 2 }))
      .toThrow(UnsupportedSiteDesignPreferencesVersionError);
    expect(() => migrateSiteDesignPreferences({ siteName: "missing version" }))
      .toThrow(UnsupportedSiteDesignPreferencesVersionError);
  });

  it("runs the migration boundary before parsing persisted SiteBrief preferences", () => {
    const value = preferences();
    const brief = {
      companyName: value.siteName,
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: [],
      audience: [],
      conversionGoal: value.siteGoal,
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
          sourceDocumentIds: ["doc-company"],
        },
        {
          id: "services",
          slug: "/services",
          title: "服务",
          sourceDocumentIds: ["doc-services"],
        },
        {
          id: "contact",
          slug: "/contact",
          title: "联系我们",
          sourceDocumentIds: ["doc-contact"],
        },
      ],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
      designPreferences: value,
    };

    expect(readSiteDesignPreferencesFromBrief(brief)).toEqual(value);
    const unsupported = siteBriefSchema.safeParse({
      ...brief,
      designPreferences: { ...value, schemaVersion: 2 },
    });
    expect(unsupported.success).toBe(false);
    if (!unsupported.success) {
      expect(unsupported.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["designPreferences"],
          message: "Unsupported SiteDesignPreferences schemaVersion: 2",
        }),
      );
    }
  });
});

describe("read-only site design recommendation contract", () => {
  it("accepts a fully source-bound response with deterministic ranks", () => {
    expect(siteDesignRecommendationInputSchema.parse(recommendationInput()))
      .toEqual(recommendationInput());
    expect(siteDesignRecommendationOutputSchema.parse(recommendationOutput()))
      .toEqual(recommendationOutput());
  });

  it("allows an honest empty recommendation when knowledge is insufficient", () => {
    const value = recommendationOutput();
    value.siteName = {
      value: null,
      status: "needs_confirmation",
      sourceType: "unavailable",
      sourceDocumentIds: [],
    };
    value.siteGoal = {
      value: null,
      status: "needs_confirmation",
      sourceDocumentIds: [],
    };
    value.candidates = [];
    value.featuredRouteIds = [];
    value.previewBlocks = [];
    value.unresolved = ["site_name", "site_goal", "routes"];
    expect(siteDesignRecommendationOutputSchema.safeParse(value).success)
      .toBe(true);
  });

  it.each([
    ["candidate without real sources", (value: SiteDesignRecommendationOutput) => {
      value.candidates[0]!.sourceDocumentIds = [];
      value.candidates[0]!.evidenceDocumentCount = 0;
    }],
    ["featured route outside candidates", (value: SiteDesignRecommendationOutput) => {
      value.featuredRouteIds = ["missing"];
    }],
    ["featured flag mismatch", (value: SiteDesignRecommendationOutput) => {
      value.candidates[0]!.featured = false;
    }],
    ["duplicate rank", (value: SiteDesignRecommendationOutput) => {
      value.candidates[1]!.importanceRank = 1;
    }],
    ["preview block without candidate route", (value: SiteDesignRecommendationOutput) => {
      value.previewBlocks[0]!.routeId = "missing";
    }],
    ["unknown response field", (value: SiteDesignRecommendationOutput) => {
      Object.assign(value, { generatedAt: "2026-10-28T00:00:00.000Z" });
    }],
  ])("rejects %s", (_label, mutate) => {
    const value = recommendationOutput();
    mutate(value);
    expect(siteDesignRecommendationOutputSchema.safeParse(value).success)
      .toBe(false);
  });

  it("guards against late responses with any stale coordinate", () => {
    const request = recommendationInput();
    const response = recommendationOutput();
    const currentDraft = preferences();
    expect(siteDesignRecommendationMatchesRequest(request, response, currentDraft))
      .toBe(true);

    for (const stale of [
      {
        ...response,
        knowledgeSnapshot: {
          ...response.knowledgeSnapshot,
          id: "00000000-0000-4000-8000-000000000002",
        },
      },
      {
        ...response,
        knowledgeSnapshot: { ...response.knowledgeSnapshot, version: 8 },
      },
      {
        ...response,
        knowledgeSnapshot: {
          ...response.knowledgeSnapshot,
          archiveHash: "d".repeat(64),
        },
      },
      {
        ...response,
        template: { ...response.template, id: "other-candidate" },
      },
      {
        ...response,
        template: { ...response.template, version: "other-catalog" },
      },
      {
        ...response,
        requestContext: {
          ...response.requestContext,
          requestId: "request-20261028-0002",
        },
      },
      {
        ...response,
        requestContext: {
          ...response.requestContext,
          baseDesignRevision: 2,
        },
      },
      {
        ...response,
        requestContext: {
          ...response.requestContext,
          baseDraftHash: "e".repeat(64),
        },
      },
    ]) {
      expect(siteDesignRecommendationMatchesRequest(request, stale, currentDraft))
        .toBe(false);
    }
    expect(
      siteDesignRecommendationMatchesRequest(request, response, {
        ...currentDraft,
        designRevision: 2,
        draftHash: "f".repeat(64),
      }),
    ).toBe(false);
  });
});
