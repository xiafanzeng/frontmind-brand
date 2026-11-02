// @vitest-environment node
import { describe, expect, it } from "vitest";

import { nativeSourceSystemPromptForWorkflow } from "../server/siteops/manus-provider.js";
import { normalizeRoutePages } from "../server/siteops/native-react-build-runtime.js";
import type { OutputFile } from "../server/siteops/build-runtime.js";

const BASE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>template</title><meta name="description" content="old"></head><body><div id="root">x</div></body></html>`;

function files(): OutputFile[] {
  return [
    { path: "index.html", bytes: Buffer.from(BASE_HTML) },
    { path: "about/index.html", bytes: Buffer.from(BASE_HTML) },
  ];
}

describe("native source system prompt (v2.9)", () => {
  const prompt = nativeSourceSystemPromptForWorkflow("2.9.0");

  it("requires site-wide search across every planned route", () => {
    expect(prompt).toContain("站内搜索必须覆盖全站");
    expect(prompt).toContain("不得只过滤当前页面");
    expect(prompt).toContain("userQuestions");
  });

  it("requires a verbatim document view per content section", () => {
    expect(prompt).toContain("查看文档原文");
    expect(prompt).toContain("禁止新增 route manifest 路由");
    expect(prompt).toContain("不得摘要化");
  });
});

describe("normalizeRoutePages SEO head injection", () => {
  const routeMetadata = new Map([
    ["/", { title: "首页", description: "医院概况与就医入口" }],
    ["/about/", { title: "医院能力", description: "科室与团队介绍" }],
  ]);

  it("injects per-route title and description from the frozen plan", () => {
    const out = normalizeRoutePages({
      files: files(),
      routes: ["/", "/about/"],
      mode: "production",
      canonicalOrigin: "https://example.com",
      assistantApiOrigin: "https://assistant.example.com",
      design: { siteAccent: null } as never,
      build: null,
      routeMetadata,
      siteName: "台心医院",
    });
    const home = out.find((file) => file.path === "index.html")!.bytes.toString("utf8");
    expect(home).toContain("<title>台心医院</title>");
    expect(home).toContain('meta name="description" content="医院概况与就医入口"');
    expect(home).toContain('property="og:title"');
    expect(home).toContain('property="og:url" content="https://example.com/"');
    expect(home).not.toContain('name="robots" content="noindex');
    const about = out.find((file) => file.path === "about/index.html")!.bytes.toString("utf8");
    expect(about).toContain("<title>医院能力 · 台心医院</title>");
    expect(about).toContain('property="og:site_name" content="台心医院"');
  });

  it("escapes SEO copy and keeps preview pages noindex without OG tags", () => {
    const out = normalizeRoutePages({
      files: files(),
      routes: ["/", "/about/"],
      mode: "preview",
      canonicalOrigin: null,
      assistantApiOrigin: "https://assistant.example.com",
      design: { siteAccent: null } as never,
      build: null,
      routeMetadata: new Map([
        ["/", { title: `首页"<script>`, description: "a<b>&c" }],
      ]),
      siteName: null,
    });
    const home = out.find((file) => file.path === "index.html")!.bytes.toString("utf8");
    expect(home).toContain('noindex,nofollow');
    expect(home).not.toContain('property="og:');
    expect(home).toContain("&lt;script&gt;");
    expect(home).toContain("a&lt;b&gt;&amp;c");
  });

  it("replaces provider-supplied SEO tags instead of duplicating them", () => {
    const out = normalizeRoutePages({
      files: files(),
      routes: ["/"],
      mode: "production",
      canonicalOrigin: "https://example.com",
      assistantApiOrigin: "https://assistant.example.com",
      design: { siteAccent: null } as never,
      build: null,
      routeMetadata: new Map([["/", { title: "首页", description: "新描述" }]]),
      siteName: "站点",
    });
    const home = out.find((file) => file.path === "index.html")!.bytes.toString("utf8");
    expect(home.match(/<title>/gu)).toHaveLength(1);
    expect(home.match(/name="description"/gu)).toHaveLength(1);
    expect(home).not.toContain("old");
  });
});
