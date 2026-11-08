// @vitest-environment node
import { describe, expect, it } from "vitest";

import { siteDesignPreferencesSaveInputSchema } from "../contracts/site-design-preferences.js";
import { siteWebsiteEvaluationInputsDraftSchema } from "../contracts/website-build-inputs.js";
import {
  freezeWebsiteEvaluationInputs,
  requireWebsiteBrandKitLogoCoordinate,
  siteBriefForRevision,
} from "../server/siteops/service.js";

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";

function brief() {
  return {
    companyName: "FrontMind",
    primaryLanguage: "zh-CN",
    contacts: [],
    offerings: [],
    audience: [],
    conversionGoal: "预约咨询",
    routes: [
      { id: "home", slug: "/", title: "首页", sourceDocumentIds: [] },
      {
        id: "contact",
        slug: "/contact",
        title: "联系我们",
        sourceDocumentIds: [],
      },
    ],
    verifiedFacts: [],
    publicAssetIds: [],
    unknowns: [],
  };
}

function evaluationInputs() {
  return siteWebsiteEvaluationInputsDraftSchema.parse({
    brandKitV1: {
      schemaVersion: 1,
      primaryColor: "#6D28D9",
      fontPreferences: ["Inter"],
      toneKeywords: ["可信", "克制"],
      forbiddenPhrases: ["绝对领先"],
    },
    visitorTaskV1: {
      schemaVersion: 1,
      goal: "从首页完成咨询",
      entryRouteId: "home",
      successCriteria: ["访客能打开已验证的联系入口"],
      requiredRouteIds: ["home", "contact"],
      assistantRequired: false,
    },
  });
}

describe("website build frozen inputs", () => {
  it("accepts browser drafts without trusting browser confirmation metadata", () => {
    expect(
      siteDesignPreferencesSaveInputSchema.safeParse({
        conversationId: "siteops:7",
        expectedProjectRevision: 2,
        expectedDesignRevision: 0,
        draft: {
          schemaVersion: 1,
          siteName: "FrontMind",
          siteGoal: "预约咨询",
          featuredRouteIds: ["home"],
          siteAccent: "#6D28D9",
          assistant: {
            name: "FrontMind 助手",
            welcome: "你好",
            accentMode: "follow_site",
            customAccent: null,
          },
          knowledgeSnapshot: {
            id: SNAPSHOT_ID,
            version: 1,
            archiveHash: "a".repeat(64),
          },
          template: { id: "template-1", version: "catalog-1" },
        },
        websiteEvaluationInputs: evaluationInputs(),
      }).success,
    ).toBe(true);
  });

  it("mints confirmation time, actor and brief hash on the server", () => {
    const frozen = freezeWebsiteEvaluationInputs({
      brief: brief(),
      draft: evaluationInputs(),
      actorUserId: 42,
      now: new Date("2026-11-08T04:00:00.000Z"),
    });
    expect(frozen.brandKitV1).toMatchObject({ primaryColor: "#6D28D9" });
    expect(frozen.visitorTaskV1).toMatchObject({
      goal: "从首页完成咨询",
      confirmedByUserId: 42,
      confirmedAt: "2026-11-08T04:00:00.000Z",
    });
    expect(frozen.visitorTaskV1?.generatedFromBriefHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("uses the latest draft inputs for a revision while leaving the parent immutable", () => {
    const parent = freezeWebsiteEvaluationInputs({
      brief: brief(),
      draft: evaluationInputs(),
      actorUserId: 42,
      now: new Date("2026-11-08T04:00:00.000Z"),
    });
    const current = freezeWebsiteEvaluationInputs({
      brief: brief(),
      draft: {
        ...evaluationInputs(),
        brandKitV1: null,
        visitorTaskV1: {
          ...evaluationInputs().visitorTaskV1,
          goal: "从首页阅读服务后完成咨询",
        },
      },
      actorUserId: 42,
      now: new Date("2026-11-08T05:00:00.000Z"),
    });
    const revision = siteBriefForRevision(parent, current);
    expect(revision.brandKitV1).toBeUndefined();
    expect(revision.visitorTaskV1?.goal).toBe("从首页阅读服务后完成咨询");
    expect(parent.brandKitV1?.primaryColor).toBe("#6D28D9");
    expect(parent.visitorTaskV1?.goal).toBe("从首页完成咨询");
  });

  it("binds an optional logo to the current public asset hash", () => {
    const logo = { assetId: "asset-logo", sha256: "a".repeat(64) };
    expect(
      requireWebsiteBrandKitLogoCoordinate({
        brandKit: { logo },
        publicAssetIds: [logo.assetId],
        assets: [{ id: logo.assetId, sha256: logo.sha256 }],
      }),
    ).toEqual(logo);
    expect(() =>
      requireWebsiteBrandKitLogoCoordinate({
        brandKit: { logo },
        publicAssetIds: [logo.assetId],
        assets: [{ id: logo.assetId, sha256: "b".repeat(64) }],
      }),
    ).toThrow("Brand Kit Logo 与当前公开知识资产不一致");
  });
});
