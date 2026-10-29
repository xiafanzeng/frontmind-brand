// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SiteBrief } from "../contracts/siteops.js";
import {
  projectSiteDesignRuntime,
  siteAssistantBootConfig,
} from "../server/siteops/site-design-runtime.js";
import {
  signSiteAssistantBuildBinding,
  siteAssistantBuildBindingPayloadSchema,
  siteAssistantBindingSecret,
  SITE_ASSISTANT_BINDING_SECRET_ENV,
  verifySiteAssistantBuildBinding,
} from "../server/siteops/site-assistant-binding.js";

const SECRET = "binding-secret-with-enough-length";

function payload(overrides: Record<string, unknown> = {}) {
  return siteAssistantBuildBindingPayloadSchema.parse({
    schemaVersion: 1,
    buildId: "44444444-4444-4444-8444-444444444444",
    knowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
    knowledgeArchiveHash: "a".repeat(64),
    designRevision: 7,
    draftHash: "b".repeat(64),
    assistantName: "知识助手",
    welcome: "你好，我可以基于本站知识回答问题。",
    assistantAccent: "#8a2be2",
    ...overrides,
  });
}

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
    ],
    verifiedFacts: [],
    publicAssetIds: [],
    unknowns: [],
    designPreferences: {
      schemaVersion: 1,
      siteName: "FrontMind",
      siteGoal: "展示企业知识服务",
      featuredRouteIds: ["home", "products"],
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

describe("assistant build binding tokens", () => {
  it("signs and verifies a round trip and stays deterministic", () => {
    const signed = signSiteAssistantBuildBinding(payload(), SECRET);
    expect(signed).toBe(signSiteAssistantBuildBinding(payload(), SECRET));
    expect(verifySiteAssistantBuildBinding({...payload(), signature: signed}, SECRET))
      .toMatchObject({buildId: payload().buildId});
  });

  it("rejects tampered payloads, wrong secrets and malformed input", () => {
    const signed = signSiteAssistantBuildBinding(payload(), SECRET);
    expect(verifySiteAssistantBuildBinding(
      {...payload(), assistantName: "伪造名称", signature: signed},
      SECRET,
    )).toBeNull();
    expect(verifySiteAssistantBuildBinding({...payload(), signature: signed}, "other-secret"))
      .toBeNull();
    expect(verifySiteAssistantBuildBinding({foo: 1}, SECRET)).toBeNull();
    expect(verifySiteAssistantBuildBinding("junk", SECRET)).toBeNull();
  });

  it("reads the secret only when configured with a usable length", () => {
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, SECRET);
    expect(siteAssistantBindingSecret()).toBe(SECRET);
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, "short");
    expect(siteAssistantBindingSecret()).toBeNull();
    vi.unstubAllEnvs();
    expect(siteAssistantBindingSecret()).toBeNull();
  });
});

describe("assistant boot config build binding", () => {
  const build = {
    id: "44444444-4444-4444-8444-444444444444",
    knowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
    knowledgeArchiveHash: "a".repeat(64),
  };

  it("freezes a verifiable binding into the boot config when a secret exists", () => {
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, SECRET);
    try {
      const projection = projectSiteDesignRuntime(designBrief());
      const config = siteAssistantBootConfig(
        "https://brand.frontmind.cn",
        projection,
        build,
      );

      expect(config.binding).toBeTruthy();
      expect(verifySiteAssistantBuildBinding(config.binding, SECRET))
        .toMatchObject({
          designRevision: 7,
          knowledgeSnapshotId: build.knowledgeSnapshotId,
          knowledgeArchiveHash: build.knowledgeArchiveHash,
          assistantName: "知识助手",
        });
      // Deterministic: the build-time QA byte-check re-derives the same bytes.
      expect(
        siteAssistantBootConfig("https://brand.frontmind.cn", projection, build).binding,
      ).toEqual(config.binding);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("omits the binding without a secret or build coordinate", () => {
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, SECRET);
    const projection = projectSiteDesignRuntime(designBrief());
    expect(siteAssistantBootConfig("https://brand.frontmind.cn", projection, null).binding)
      .toBeUndefined();
    vi.unstubAllEnvs();
    expect(siteAssistantBootConfig("https://brand.frontmind.cn", projection, build).binding)
      .toBeUndefined();
  });
});
