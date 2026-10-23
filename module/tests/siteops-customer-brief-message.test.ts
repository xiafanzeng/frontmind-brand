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
  it("merges the builder's structured configuration into frozen brief fields", () => {
    const result = mergeSiteOpsCustomerBriefMessage(
      brief(),
      [
        "网站名称: 远山帮助中心",
        "站点语言: en-US",
        "建站目标: 帮助访客自助解决问题；网站主题色 #315b8a；AI 助手名称 远山助手；AI 助手欢迎语 您好，请问需要什么帮助？",
      ].join("\n"),
    );

    expect(result.companyName).toBe("远山帮助中心");
    expect(result.primaryLanguage).toBe("en-US");
    expect(result.conversionGoal).toContain("帮助访客自助解决问题");
    // Markdown heading markers are stripped by the established brief sanitizer,
    // while the full six-digit palette coordinate remains frozen.
    expect(result.conversionGoal).toContain("网站主题色 315b8a");
    expect(result.conversionGoal).toContain("AI 助手欢迎语 您好，请问需要什么帮助？");
    expect(result.routes).toEqual(brief().routes);
    expect(result.unknowns).not.toContain("企业名称待确认");
    expect(result.unknowns).not.toContain("主要语言待确认");
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
