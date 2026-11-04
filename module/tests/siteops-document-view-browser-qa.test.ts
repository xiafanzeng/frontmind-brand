// @vitest-environment node
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import {
  auditSiteDocumentViewRouteBindings,
  comparableDocumentViewText,
  containsDocumentViewSourceEvidence,
  containsForbiddenDocumentViewUrl,
  documentViewContentEvidence,
  expectedDocumentViewNodeText,
  normalizedDocumentViewText,
} from "../server/siteops/native-react-build-runtime.js";
import type { SiteDocumentViewPlanV1 } from "../server/siteops/site-document-view-plan.js";

const browserInstalled = existsSync(chromium.executablePath());

const plan: SiteDocumentViewPlanV1 = {
  schemaVersion: 1,
  branches: [
    {
      id: "identity",
      title: "企业身份",
      nodes: [
        {
          id: "identity-1",
          path: "identity/1.md",
          title: "公司简介",
          order: 1,
          content: "我们服务企业客户。\n更多资料见 https://www.example.com/help。",
        },
      ],
    },
    {
      id: "services",
      title: "服务能力",
      nodes: [
        {
          id: "services-1",
          path: "services/1.md",
          title: "交付流程",
          order: 1,
          content: "需求澄清。方案确认。上线验收。",
        },
      ],
    },
  ],
  routes: [
    {
      routeId: "home",
      path: "/",
      branchIds: ["identity", "services"],
      sections: [
        { sectionId: "hero", branchIds: ["identity"] },
        { sectionId: "delivery", branchIds: ["services"] },
      ],
    },
  ],
};

describe("document-view browser binding audit", () => {
  it("accepts complete route and section bindings", () => {
    expect(
      auditSiteDocumentViewRouteBindings({
        plan,
        routePath: "/",
        triggers: [
          {
            branchIds: ["identity"],
            sectionId: "hero",
            isAnchor: true,
            href: "/",
          },
          {
            branchIds: ["services"],
            sectionId: "delivery",
            isAnchor: false,
            href: null,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("reports unknown, missing-section, and anchor-href coordinates", () => {
    const diagnostics = auditSiteDocumentViewRouteBindings({
      plan,
      routePath: "/",
      triggers: [
        {
          branchIds: ["identity", "unknown"],
          sectionId: "hero",
          isAnchor: true,
          href: null,
        },
        {
          branchIds: ["services"],
          sectionId: null,
          isAnchor: false,
          href: null,
        },
      ],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "DOCUMENT_VIEW_ANCHOR_HREF_REQUIRED",
      "DOCUMENT_VIEW_SECTION_BINDING_MISMATCH",
      "DOCUMENT_VIEW_UNKNOWN_BRANCH",
      "DOCUMENT_VIEW_SECTION_BINDING_MISSING",
    ]);
  });

  it("requires every section trigger to carry its exact branch set", () => {
    const diagnostics = auditSiteDocumentViewRouteBindings({
      plan,
      routePath: "/",
      triggers: [
        {
          branchIds: ["identity"],
          sectionId: "delivery",
          isAnchor: false,
          href: null,
        },
      ],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "DOCUMENT_VIEW_SECTION_BINDING_MISMATCH",
    );

    const emptySectionPlan: SiteDocumentViewPlanV1 = {
      ...plan,
      routes: [
        {
          ...plan.routes[0]!,
          sections: [
            ...plan.routes[0]!.sections,
            { sectionId: "revision-only", branchIds: [] },
          ],
        },
      ],
    };
    expect(
      auditSiteDocumentViewRouteBindings({
        plan: emptySectionPlan,
        routePath: "/",
        triggers: [
          {
            branchIds: ["identity"],
            sectionId: "revision-only",
            isAnchor: false,
            href: null,
          },
        ],
      }).map((diagnostic) => diagnostic.code),
    ).toContain("DOCUMENT_VIEW_SECTION_BINDING_UNEXPECTED");
  });

  it("reports a route that is absent from the immutable plan", () => {
    expect(
      auditSiteDocumentViewRouteBindings({
        plan,
        routePath: "/missing/",
        triggers: [],
      }),
    ).toEqual([
      {
        code: "DOCUMENT_VIEW_PLAN_ROUTE_MISSING",
        file: "/missing/",
        line: null,
        column: null,
      },
    ]);
  });
});

describe("document-view source evidence", () => {
  it("normalizes markdown punctuation and URL schemes consistently", () => {
    const rendered = normalizedDocumentViewText(
      "更多资料见 www.example.com/help；**保持完整**",
    );
    expect(rendered).toContain("www example com help");
    expect(rendered).toContain("保持完整");
    expect(normalizedDocumentViewText("https://www.example.com/help")).toBe(
      "www example com help",
    );
  });

  it("rejects rendered absolute and protocol-relative URL schemes", () => {
    expect(containsForbiddenDocumentViewUrl("https://www.example.com/help")).toBe(
      true,
    );
    expect(containsForbiddenDocumentViewUrl("查看 //www.example.com/help")).toBe(
      true,
    );
    expect(containsForbiddenDocumentViewUrl("查看 www.example.com/help")).toBe(
      false,
    );
  });

  it("covers every paragraph in order so omitted middle content cannot pass", () => {
    expect(
      documentViewContentEvidence(
        "第一段提供身份信息。\n第二段提供服务范围。\n第三段提供交付方式。\n第四段提供联系说明。",
      ),
    ).toEqual([
      "第一段提供身份信息",
      "第二段提供服务范围",
      "第三段提供交付方式",
      "第四段提供联系说明",
    ]);
  });

  it("chunks every part of a long paragraph instead of sampling its edges", () => {
    const source = `${"甲".repeat(96)}${"乙".repeat(96)}${"丙".repeat(17)}`;
    expect(documentViewContentEvidence(source)).toEqual([
      "甲".repeat(96),
      "乙".repeat(96),
      "丙".repeat(17),
    ]);
  });

  it("retains short facts and requires exact title plus visible markdown text", () => {
    expect(documentViewContentEvidence("深圳\n暂无")).toEqual(["深圳", "暂无"]);
    const expected =
      expectedDocumentViewNodeText({
        title: "公司简介",
        content:
          "总部：深圳。访问[帮助中心](https://www.example.com/help)。<strong>仅企业客户</strong>",
      });
    expect(expected).toBe("公司简介总部深圳访问帮助中心仅企业客户");
    expect(comparableDocumentViewText(`${expected} 追加虚构事实`)).not.toBe(
      expected,
    );
    expect(
      expectedDocumentViewNodeText({
        title: "交付步骤",
        content: "1. 需求确认\n2. 上线验收",
      }),
    ).toBe("交付步骤需求确认上线验收");
  });

  it.runIf(browserInstalled)(
    "matches a real DOM node with block elements and an ordered list",
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`
          <article data-frontmind-document-node="delivery">
            <h3>交付步骤</h3>
            <p>总部在深圳</p>
            <ol><li>需求确认</li><li>上线验收</li></ol>
          </article>
        `);
        const visibleText = await page
          .locator('[data-frontmind-document-node="delivery"]')
          .innerText();
        expect(comparableDocumentViewText(visibleText)).toBe(
          expectedDocumentViewNodeText({
            title: "交付步骤",
            content: "总部在深圳\n1. 需求确认\n2. 上线验收",
          }),
        );
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it("detects internal revision instructions appended anywhere in a dialog", () => {
    const revision = "不要公开：旧合同报价为 100 元。按钮改为红色。";
    expect(
      containsDocumentViewSourceEvidence(
        `企业身份 公司简介 公开正文 ${revision} 关闭`,
        revision,
      ),
    ).toBe(true);
    expect(
      containsDocumentViewSourceEvidence(
        "企业身份 不要公开 旧合同报价为 100 元 关闭",
        revision,
      ),
    ).toBe(true);
    expect(
      containsDocumentViewSourceEvidence(
        "企业身份 公司简介 公开正文 关闭",
        revision,
      ),
    ).toBe(false);
    expect(
      containsDocumentViewSourceEvidence(
        "企业身份 我们服务企业客户 关闭",
        "文案改为：我们服务企业客户。",
        ["我们服务企业客户"],
      ),
    ).toBe(false);
    expect(
      containsDocumentViewSourceEvidence(
        "企业身份 我们服务企业客户 旧合同报价为 100 元 关闭",
        "文案改为：我们服务企业客户。不要公开：旧合同报价为 100 元。",
        ["我们服务企业客户"],
      ),
    ).toBe(true);
  });
});
