// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SiteBrief } from "../contracts/siteops.js";
import {
  qaDist,
  SiteOpsMaterializationError,
  type SourceFile,
} from "../server/siteops/build-runtime.js";
import {
  projectSiteDesignRuntime,
  siteAssistantBootConfig,
} from "../server/siteops/site-design-runtime.js";
import {
  siteAssistantApiOrigin,
  TRUSTED_SITE_ASSISTANT_HEAD_MARKUP,
  TRUSTED_SITE_ASSISTANT_WIDGET_CSS,
  TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE,
  trustedSiteAssistantConfigSource,
} from "../server/siteops/site-assistant-widget.js";

function designBrief(): SiteBrief {
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
      { id: "products", slug: "/products/", title: "产品", sourceDocumentIds: ["doc-product"] },
      { id: "about", slug: "/about/", title: "关于", sourceDocumentIds: ["doc-about"] },
      { id: "faq", slug: "/faq/", title: "常见问题", sourceDocumentIds: ["doc-faq"] },
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

function trustedPreviewDist(input: {
  brief: SiteBrief;
  stylesCss: string;
}): SourceFile[] {
  const routeDocument = (title: string, routeSlug: string) =>
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg">${TRUSTED_SITE_ASSISTANT_HEAD_MARKUP}</head><body><header><h1>${title}</h1><p>本页面展示真实的企业知识服务、产品与解决方案介绍，帮助访客快速了解我们的业务。</p><nav><a href="/">返回首页</a></nav></header></body></html>`
      .replace("返回首页", routeSlug === "/" ? title : "返回首页");
  const runtimeDesign = projectSiteDesignRuntime(input.brief);
  const assistantConfig = trustedSiteAssistantConfigSource(
    siteAssistantBootConfig(siteAssistantApiOrigin(), runtimeDesign),
  );
  const files: SourceFile[] = input.brief.routes.map((route) => ({
    path: route.slug === "/" ? "index.html" : `${route.slug.slice(1)}index.html`,
    bytes: Buffer.from(routeDocument(route.title, route.slug), "utf8"),
  }));
  const emptyIcon = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"/>";
  return [
    ...files,
    { path: "404.html", bytes: Buffer.from(routeDocument("页面不存在", "/404"), "utf8") },
    { path: "styles.css", bytes: Buffer.from(input.stylesCss, "utf8") },
    { path: "robots.txt", bytes: Buffer.from("User-agent: *\nDisallow: /\n", "utf8") },
    { path: "favicon.svg", bytes: Buffer.from(emptyIcon, "utf8") },
    { path: "social-card.svg", bytes: Buffer.from(emptyIcon, "utf8") },
    { path: "assistant-config.js", bytes: Buffer.from(assistantConfig, "utf8") },
    { path: "assistant.js", bytes: Buffer.from(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE, "utf8") },
    { path: "assistant.css", bytes: Buffer.from(`${TRUSTED_SITE_ASSISTANT_WIDGET_CSS}\n`, "utf8") },
  ];
}

function qaInput(input: { brief: SiteBrief; files: SourceFile[] }) {
  return {
    files: input.files,
    brief: input.brief,
    mode: "preview" as const,
    canonicalOrigin: null,
    assetDecisions: [],
    brandAsset: null,
    qaPolicyVersion: "siteops-qa-v5",
    sourceDocumentIds: ["doc-home", "doc-product", "doc-about", "doc-faq"],
  };
}

describe("site design consumption in the shipped build", () => {
  it("accepts a dist whose CSS declares the frozen site accent", () => {
    const brief = designBrief();
    const files = trustedPreviewDist({
      brief,
      stylesCss: ":root{--accent:#2457a7;--frontmind-site-accent:#2457a7}",
    });

    const report = qaDist(qaInput({ brief, files }));

    expect(report.passed).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: "site-design-accent", passed: true }),
    );
    const assistantConfig = files
      .find((file) => file.path === "assistant-config.js")!
      .bytes.toString("utf8");
    expect(assistantConfig).toContain("知识助手");
    expect(assistantConfig).toContain("你好，我可以基于本站知识回答问题。");
    expect(assistantConfig).toContain("#8a2be2");
    expect(assistantConfig).toContain("#2457a7");
  });

  it("rejects a dist that ships without the frozen site accent tokens", () => {
    const brief = designBrief();
    const files = trustedPreviewDist({
      brief,
      stylesCss: ":root{--accent:#0f766e}",
    });

    expect(() => qaDist(qaInput({ brief, files }))).toThrow(
      SiteOpsMaterializationError,
    );
  });

  it("skips the accent gate for legacy briefs without saved preferences", () => {
    const brief = designBrief();
    const legacyBrief: SiteBrief = { ...brief, designPreferences: undefined };
    const files = trustedPreviewDist({
      brief: legacyBrief,
      stylesCss: ":root{--accent:#0f766e}",
    });

    const report = qaDist(qaInput({ brief: legacyBrief, files }));

    expect(report.passed).toBe(true);
    expect(
      report.checks.filter((check) => check.id === "site-design-accent"),
    ).toEqual([]);
  });
});
