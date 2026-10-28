// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SiteBrief } from "../contracts/siteops.js";
import {
  projectSiteDesignRuntime,
  siteAssistantBootConfig,
  siteDesignAccentCss,
} from "../server/siteops/site-design-runtime.js";

function brief(): SiteBrief {
  return {
    companyName: "FrontMind",
    primaryLanguage: "zh-CN",
    contacts: [],
    offerings: ["企业知识服务"],
    audience: ["企业客户"],
    conversionGoal: "展示企业知识服务",
    contentInventory: {
      schemaVersion: 1,
      source: "frozen_knowledge_snapshot",
      entries: [],
    },
    routes: [
      { id: "home", slug: "/", title: "首页", sourceDocumentIds: ["doc-home"] },
      { id: "products", slug: "/products", title: "产品", sourceDocumentIds: ["doc-product"] },
      { id: "about", slug: "/about", title: "关于", sourceDocumentIds: ["doc-about"] },
      { id: "faq", slug: "/faq", title: "常见问题", sourceDocumentIds: ["doc-faq"] },
    ],
    verifiedFacts: [],
    publicAssetIds: [],
    unknowns: [],
    designPreferences: {
      schemaVersion: 1,
      siteName: "FrontMind",
      siteGoal: "展示企业知识服务",
      featuredRouteIds: ["home", "products", "faq"],
      siteAccent: "#2457a7",
      assistant: {
        name: "知识助手",
        welcome: "你好，我可以基于本站知识回答问题。",
        accentMode: "custom",
        customAccent: "#8a2be2",
      },
      knowledgeSnapshot: {
        id: "22222222-2222-4222-8222-222222222222",
        version: 3,
        archiveHash: "a".repeat(64),
      },
      template: { id: "template-a", version: "catalog-v1" },
      designRevision: 7,
      draftHash: "b".repeat(64),
    },
  };
}

describe("frozen SiteDesignPreferences build projection", () => {
  it("keeps all pages but exposes only featured routes in contract order", () => {
    const projection = projectSiteDesignRuntime(brief());
    expect(projection.allRoutePaths).toEqual(["/", "/products/", "/about/", "/faq/"]);
    expect(projection.navigation).toEqual([
      { id: "home", href: "/", title: "首页" },
      { id: "products", href: "/products/", title: "产品" },
      { id: "faq", href: "/faq/", title: "常见问题" },
    ]);
  });

  it("projects the exact site and custom assistant colors into host output", () => {
    const projection = projectSiteDesignRuntime(brief());
    expect(siteDesignAccentCss(projection)).toContain("--accent:#2457a7!important");
    expect(siteAssistantBootConfig("https://brand.frontmind.cn", projection)).toMatchObject({
      apiBase: "https://brand.frontmind.cn",
      name: "知识助手",
      welcome: "你好，我可以基于本站知识回答问题。",
      accent: "#8a2be2",
      design: {
        siteAccent: "#2457a7",
        designRevision: 7,
        draftHash: "b".repeat(64),
      },
    });
  });

  it("uses the site accent when the assistant follows the website theme", () => {
    const value = brief();
    value.designPreferences = {
      ...value.designPreferences!,
      assistant: {
        ...value.designPreferences!.assistant,
        accentMode: "follow_site",
      },
    };
    expect(projectSiteDesignRuntime(value).assistant?.accent).toBe("#2457a7");
  });

  it("preserves legacy all-route navigation without inventing design values", () => {
    const value = brief();
    delete value.designPreferences;
    expect(projectSiteDesignRuntime(value)).toMatchObject({
      navigation: [
        { id: "home" },
        { id: "products" },
        { id: "about" },
        { id: "faq" },
      ],
      siteAccent: null,
      assistant: null,
      designRevision: null,
      draftHash: null,
    });
  });
});
