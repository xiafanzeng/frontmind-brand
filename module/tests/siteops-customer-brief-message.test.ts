import { describe, expect, it } from "vitest";
import type { SiteBrief } from "../contracts/siteops";
import { mergeSiteOpsCustomerBriefMessage } from "../server/siteops/customer-brief-message";

function brief(): SiteBrief {
  return {
    companyName: "原企业",
    primaryLanguage: "zh-CN",
    contacts: [],
    offerings: ["企业服务"],
    audience: ["现有客户"],
    conversionGoal: "帮助客户找到答案",
    contentInventory: {
      schemaVersion: 1,
      source: "frozen_knowledge_snapshot",
      entries: [],
    },
    routes: [{
      id: "help",
      slug: "/help",
      title: "帮助中心",
      sourceDocumentIds: ["document-1"],
    }],
    verifiedFacts: [],
    publicAssetIds: [],
    unknowns: ["企业名称待确认", "主要语言待确认", "目标受众待确认"],
  };
}

describe("SiteOps customer brief messages", () => {
  it("keeps language server-owned and excludes design widgets from the legacy goal", () => {
    const result = mergeSiteOpsCustomerBriefMessage(
      brief(),
      [
        "网站名称: 远山帮助中心",
        "站点语言: en-US",
        "建站目标: 帮助访客自助解决问题；网站主题色 #315b8a；AI 助手名称 远山助手；AI 助手欢迎语 您好，请问需要什么帮助？",
      ].join("\n"),
    );

    expect(result.companyName).toBe("远山帮助中心");
    expect(result.primaryLanguage).toBe("zh-CN");
    expect(result.conversionGoal).toBe("帮助访客自助解决问题");
    expect(result.conversionGoal).not.toContain("网站主题色");
    expect(result.conversionGoal).not.toContain("助手");
    expect(result.routes).toEqual(brief().routes);
    expect(result.unknowns).not.toContain("企业名称待确认");
    expect(result.unknowns).toContain("主要语言待确认");
  });

  it("does not let legacy chat text diverge an existing structured design", () => {
    const original: SiteBrief = {
      ...brief(),
      designPreferences: {
        schemaVersion: 1,
        siteName: "冻结名称",
        siteGoal: "冻结目标",
        featuredRouteIds: ["help"],
        siteAccent: "#315b8a",
        assistant: {
          name: "知识助手",
          welcome: "您好，请问需要什么帮助？",
          accentMode: "follow_site",
          customAccent: null,
        },
        knowledgeSnapshot: {
          id: "11111111-1111-4111-8111-111111111111",
          version: 1,
          archiveHash: "a".repeat(64),
        },
        template: { id: "template-1", version: "catalog-1" },
        designRevision: 1,
        draftHash: "b".repeat(64),
      },
    };
    original.companyName = original.designPreferences!.siteName;
    original.conversionGoal = original.designPreferences!.siteGoal;

    const result = mergeSiteOpsCustomerBriefMessage(
      original,
      "网站名称: 被覆盖名称\n建站目标: 被覆盖目标\n站点语言: en-US",
    );

    expect(result.companyName).toBe("冻结名称");
    expect(result.conversionGoal).toBe("冻结目标");
    expect(result.primaryLanguage).toBe("zh-CN");
    expect(result.designPreferences).toEqual(original.designPreferences);
  });

  it("does not let invalid structured values replace trusted brief fields", () => {
    const original = brief();
    const result = mergeSiteOpsCustomerBriefMessage(
      original,
      [
        "网站名称: <script>alert(1)</script>",
        "站点语言: javascript:alert(1)",
        "建站目标: <img src=x onerror=alert(1)>",
      ].join("\n"),
    );

    expect(result.companyName).toBe(original.companyName);
    expect(result.primaryLanguage).toBe(original.primaryLanguage);
    expect(result.conversionGoal).toBe(original.conversionGoal);
    expect(result.routes).toEqual(original.routes);
    expect(result.verifiedFacts).toEqual(original.verifiedFacts);
  });

  it("keeps ordinary customer text and contact extraction backward compatible", () => {
    const result = mergeSiteOpsCustomerBriefMessage(
      brief(),
      "主要面向合作伙伴，联系电话 13800138000，希望首页突出售后支持。",
    );

    expect(result.conversionGoal).toBe(
      "主要面向合作伙伴，联系电话 13800138000，希望首页突出售后支持。",
    );
    expect(result.contacts).toContainEqual({
      kind: "phone",
      value: "13800138000",
      sourceDocumentIds: [],
    });
    expect(result.companyName).toBe("原企业");
    expect(result.primaryLanguage).toBe("zh-CN");
  });

  it("keeps the trusted audience when a structured value sanitizes to empty", () => {
    const result = mergeSiteOpsCustomerBriefMessage(
      brief(),
      "目标受众: ### `[]()`",
    );

    expect(result.audience).toEqual(["现有客户"]);
  });
});
