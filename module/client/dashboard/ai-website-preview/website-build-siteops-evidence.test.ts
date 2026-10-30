import { describe, expect, it } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import { websiteBuildEvaluationSkill } from "./website-build-evaluation-skill";
import {
  buildWebsiteEvaluationJudgmentsFromSiteOps,
  siteOpsWebsiteEvaluationObservedAt,
  siteOpsWebsiteEvaluationVersion,
} from "./website-build-siteops-evidence";

function approvedObservation(): SiteOpsObservationV1 {
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const buildId = "44444444-4444-4444-8444-444444444444";
  const frozenBrief: NonNullable<SiteOpsObservationV1["brief"]> = {
    companyName: "测试企业",
    primaryLanguage: "zh-CN",
    contacts: [{
      kind: "email",
      value: "hello@example.com",
      sourceDocumentIds: ["document-1"],
    }],
    offerings: ["企业服务"],
    audience: ["客户"],
    conversionGoal: "帮助客户找到答案",
    contentInventory: {
      schemaVersion: 1,
      source: "frozen_knowledge_snapshot",
      entries: [{ kind: "product", sourceDocumentIds: ["document-1"] }],
    },
    routes: [{
      id: "help",
      slug: "/help",
      title: "帮助中心",
      sourceDocumentIds: ["document-1"],
    }],
    verifiedFacts: [{
      statement: "测试企业提供企业服务。",
      sourceDocumentIds: ["document-1"],
    }],
    publicAssetIds: [],
    unknowns: [],
  };
  return {
    schemaVersion: 1,
    executionKind: "site_ops",
    serviceReadiness: {
      visuals: { status: "configured" },
      website: { status: "configured" },
      publishing: { status: "configured" },
      domain: { status: "configured" },
    },
    aliyunConnection: {
      configured: true,
      status: "active",
      verifiedAt: "2026-10-23T01:05:00.000Z",
      canDisconnect: true,
    },
    domainState: null,
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      conversationId: "siteops:1",
      revision: 9,
      status: "approved",
      currentKnowledgeSnapshotId: snapshotId,
      globalLiveDeploymentId: null,
      mainlandLiveDeploymentId: null,
      primaryLanguage: "zh-CN",
      canonicalHostname: null,
      updatedAt: "2026-10-23T01:10:00.000Z",
    },
    brief: frozenBrief,
    knowledgeSnapshots: [{
      id: snapshotId,
      label: "知识库 ZIP · 第 3 版",
      sourceProfile: "dashboard-core-v1",
      createdAt: "2026-10-23T00:00:00.000Z",
      active: true,
    }],
    messages: [],
    visualCandidates: [],
    visualCandidatePages: [],
    visualGeneration: {
      status: "idle",
      targetPage: null,
      generatedPages: 1,
      availablePages: 1,
      reservedPages: 0,
      maxPages: 1,
      canGenerateMore: false,
      canSelectExisting: true,
    },
    executionSteps: [{
      id: "operation-1:completed",
      operationKind: "site_build",
      buildId,
      stage: "completed",
      label: "构建完成",
      status: "succeeded",
      startedAt: "2026-10-23T01:00:00.000Z",
      completedAt: "2026-10-23T01:10:00.000Z",
    }],
    builds: [{
      id: buildId,
      ordinal: 1,
      parentBuildId: null,
      knowledgeSnapshotId: snapshotId,
      knowledgeSnapshot: null,
      status: "approved",
      previewUrl: "/api/frontmind/v2/siteops/builds/preview-1",
      sourceUrl: null,
      designPreferences: null,
      brief: frozenBrief,
      contentPlan: { status: "ready", sha256: "a".repeat(64) },
      buildDelivery: {
        renderMode: "twenty_first_native",
        qaStatus: "passed",
        warningCodes: [],
      },
      needsHelp: false,
      createdAt: "2026-10-23T01:00:00.000Z",
      updatedAt: "2026-10-23T01:10:00.000Z",
    }],
    deployments: [],
    socialPackages: [],
    rebuildRequest: {
      allowed: true,
      resetApplied: false,
      resetSourceBuildId: null,
    },
    interactionState: "approved",
    latestSequence: 10,
  };
}

describe("website SiteOps evaluation evidence", () => {
  it("evaluates the build-owned design contract instead of a later project draft", () => {
    const observation = approvedObservation();
    const frozenPreferences = {
      schemaVersion: 1 as const,
      siteName: "冻结站点",
      siteGoal: "冻结目标",
      featuredRouteIds: ["help"],
      siteAccent: "#2457a7",
      assistant: {
        name: "冻结助手",
        welcome: "欢迎查看冻结版本",
        accentMode: "custom" as const,
        customAccent: "#8a2be2",
      },
      knowledgeSnapshot: {
        id: observation.builds[0]!.knowledgeSnapshotId!,
        version: 3,
        archiveHash: "a".repeat(64),
      },
      template: { id: "template-a", version: "catalog-v1" },
      designRevision: 4,
      draftHash: "b".repeat(64),
    };
    const frozenBrief = {
      ...observation.builds[0]!.brief!,
      companyName: frozenPreferences.siteName,
      conversionGoal: frozenPreferences.siteGoal,
      designPreferences: frozenPreferences,
    };
    const frozen = {
      ...observation,
      builds: [{
        ...observation.builds[0]!,
        brief: frozenBrief,
        designPreferences: frozenPreferences,
      }],
    } satisfies SiteOpsObservationV1;
    const laterProjectDraft = {
      ...frozen,
      project: {
        ...frozen.project,
        revision: frozen.project.revision + 1,
        currentKnowledgeSnapshotId: "33333333-3333-4333-8333-333333333333",
        updatedAt: "2026-10-23T02:00:00.000Z",
      },
      brief: {
        ...frozenBrief,
        companyName: "后来修改的项目",
        routes: [{
          id: "later",
          slug: "/later",
          title: "后来栏目",
          sourceDocumentIds: [],
        }],
        designPreferences: undefined,
      },
      knowledgeSnapshots: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          label: "后来发布的知识库",
          sourceProfile: "dashboard-core-v1",
          createdAt: "2026-10-23T02:00:00.000Z",
          active: true,
        },
      ],
    } satisfies SiteOpsObservationV1;

    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(laterProjectDraft);
    const navigation = judgments.find(
      ({ checkId }) => checkId === "website-navigation-contact",
    )!;
    expect(navigation.summary).toContain("冻结设计中的 1 个主栏目");
    expect(navigation.evidenceIds).toContain(
      `siteops:build:${observation.builds[0]!.id}:design:r4:${"b".repeat(64)}`,
    );
    expect(navigation.evidenceIds.some((id) => id.includes("later"))).toBe(false);
    expect(siteOpsWebsiteEvaluationVersion(laterProjectDraft)).toBe(
      siteOpsWebsiteEvaluationVersion(frozen),
    );
    expect(siteOpsWebsiteEvaluationObservedAt(laterProjectDraft)).toBe(
      siteOpsWebsiteEvaluationObservedAt(frozen),
    );
  });

  it("keeps a legacy build stable after its frozen snapshot leaves the selectable list", () => {
    const observation = approvedObservation();
    const knowledgeSnapshot = {
      id: observation.builds[0]!.knowledgeSnapshotId!,
      version: 3,
      archiveHash: "a".repeat(64),
    };
    const frozen = {
      ...observation,
      builds: [{
        ...observation.builds[0]!,
        knowledgeSnapshot,
        designPreferences: null,
      }],
    } satisfies SiteOpsObservationV1;
    const afterNewPublication = {
      ...frozen,
      project: {
        ...frozen.project,
        currentKnowledgeSnapshotId: "33333333-3333-4333-8333-333333333333",
        revision: frozen.project.revision + 1,
        updatedAt: "2026-10-23T02:00:00.000Z",
      },
      knowledgeSnapshots: [{
        id: "33333333-3333-4333-8333-333333333333",
        label: "知识库 ZIP · 第 4 版",
        sourceProfile: "dashboard-core-v1",
        createdAt: "2026-10-23T02:00:00.000Z",
        active: true,
      }],
    } satisfies SiteOpsObservationV1;

    expect(siteOpsWebsiteEvaluationVersion(afterNewPublication)).toBe(
      siteOpsWebsiteEvaluationVersion(frozen),
    );
    expect(siteOpsWebsiteEvaluationObservedAt(afterNewPublication)).toBe(
      siteOpsWebsiteEvaluationObservedAt(frozen),
    );
    expect(
      buildWebsiteEvaluationJudgmentsFromSiteOps(afterNewPublication).find(
        ({ checkId }) => checkId === "website-content-structure",
      ),
    ).toMatchObject({ status: "passed" });
  });

  it("treats source-free company news as a legal empty state when inventory has no company news", () => {
    const observation = approvedObservation();
    const frozenBrief = {
      ...observation.builds[0]!.brief!,
      routes: [
        ...observation.builds[0]!.brief!.routes,
        {
          id: "news",
          slug: "/news",
          title: "企业动态",
          sourceDocumentIds: [],
        },
      ],
    } satisfies NonNullable<SiteOpsObservationV1["brief"]>;
    const withEmptyNews = {
      ...observation,
      brief: frozenBrief,
      builds: [{ ...observation.builds[0]!, brief: frozenBrief }],
    } satisfies SiteOpsObservationV1;

    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(withEmptyNews);
    const content = judgments.find(
      ({ checkId }) => checkId === "website-content-structure",
    )!;
    const navigation = judgments.find(
      ({ checkId }) => checkId === "website-navigation-contact",
    )!;
    const facts = judgments.find(
      ({ checkId }) => checkId === "website-facts-evidence",
    )!;

    expect(content).toMatchObject({ status: "passed" });
    expect(content.summary).toContain("1 个需来源栏目");
    expect(content.summary).toContain("1 个栏目使用有据可审计的企业新闻空态");
    expect(content.evidenceIds).toContain(
      `siteops:build:${observation.builds[0]!.id}:brief:route:news:empty:company_news_unavailable`,
    );
    expect(navigation).toMatchObject({ status: "passed" });
    expect(facts).toMatchObject({ status: "passed" });
  });

  it("still fails every other source-free route", () => {
    const observation = approvedObservation();
    const frozenBrief = {
      ...observation.builds[0]!.brief!,
      routes: [
        ...observation.builds[0]!.brief!.routes,
        {
          id: "about",
          slug: "/about",
          title: "关于我们",
          sourceDocumentIds: [],
        },
      ],
    } satisfies NonNullable<SiteOpsObservationV1["brief"]>;
    const withUnsourcedRoute = {
      ...observation,
      brief: frozenBrief,
      builds: [{ ...observation.builds[0]!, brief: frozenBrief }],
    } satisfies SiteOpsObservationV1;

    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(withUnsourcedRoute);
    const content = judgments.find(
      ({ checkId }) => checkId === "website-content-structure",
    )!;
    const navigation = judgments.find(
      ({ checkId }) => checkId === "website-navigation-contact",
    )!;
    const facts = judgments.find(
      ({ checkId }) => checkId === "website-facts-evidence",
    )!;

    expect(content).toMatchObject({ status: "failed" });
    expect(content.summary).toContain("1/2 个需来源栏目已绑定来源");
    expect(navigation).toMatchObject({ status: "partial" });
    expect(facts).toMatchObject({ status: "failed" });
    expect(facts.summary).toContain("1/2 个需来源栏目有来源");
  });

  it("turns an approved real build into seven evidence-backed judgments", () => {
    const observation = approvedObservation();
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(observation);
    const result = websiteBuildEvaluationSkill.evaluate({ judgments });

    expect(judgments).toHaveLength(7);
    expect(judgments.every(({ evidenceIds }) =>
      evidenceIds.every((id) => id.startsWith("siteops:")),
    )).toBe(true);
    expect(judgments.find(({ checkId }) => checkId === "website-public-boundary"))
      .toMatchObject({ status: "partial" });
    expect(result).toMatchObject({
      status: "completed",
      score: 90,
      coverage: 100,
      recommendation: "publish_with_risk",
    });
  });

  it("only passes the public boundary after active DNS and a public deployment agree", () => {
    const observation = approvedObservation();
    const deploymentId = "55555555-5555-4555-8555-555555555555";
    const live = {
      ...observation,
      project: {
        ...observation.project,
        status: "live" as const,
        canonicalHostname: "help.example.com",
        globalLiveDeploymentId: deploymentId,
      },
      domainState: {
        domain: "help.example.com",
        displayDomain: "help.example.com",
        revision: 2,
        ownershipStatus: "verified",
        dnsStatus: "active",
        icpStatus: "not_required" as const,
        icpDomainRevision: null,
        icpVerifiedAt: null,
      },
      deployments: [{
        id: deploymentId,
        buildId: observation.builds[0]!.id,
        target: "global_excluding_cn" as const,
        status: "active" as const,
        publicUrl: "https://help.example.com",
        createdAt: "2026-10-23T01:15:00.000Z",
      }],
      interactionState: "live" as const,
    } satisfies SiteOpsObservationV1;
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(live);
    const result = websiteBuildEvaluationSkill.evaluate({ judgments });

    expect(judgments.find(({ checkId }) => checkId === "website-public-boundary"))
      .toMatchObject({ status: "passed" });
    expect(judgments.find(({ checkId }) => checkId === "website-draft-release-state"))
      .toMatchObject({ status: "passed" });
    expect(result).toMatchObject({
      status: "completed",
      score: 100,
      coverage: 100,
      recommendation: "recommended",
    });
    expect(siteOpsWebsiteEvaluationObservedAt(live)).toBe("2026-10-23T01:15:00.000Z");
    expect(siteOpsWebsiteEvaluationVersion(live)).not.toBe(
      siteOpsWebsiteEvaluationVersion(observation),
    );
  });

  it("does not claim the current approved build is live when the project head belongs to an older build", () => {
    const observation = approvedObservation();
    const oldBuildId = "66666666-6666-4666-8666-666666666666";
    const oldDeploymentId = "77777777-7777-4777-8777-777777777777";
    const liveWithOlderHead = {
      ...observation,
      project: {
        ...observation.project,
        status: "live" as const,
        canonicalHostname: "help.example.com",
        globalLiveDeploymentId: oldDeploymentId,
      },
      deployments: [{
        id: oldDeploymentId,
        buildId: oldBuildId,
        target: "global_excluding_cn" as const,
        status: "active" as const,
        publicUrl: "https://help.example.com",
        createdAt: "2026-10-23T01:15:00.000Z",
      }],
      interactionState: "live" as const,
    } satisfies SiteOpsObservationV1;
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(liveWithOlderHead);
    const release = judgments.find(
      ({ checkId }) => checkId === "website-draft-release-state",
    )!;

    expect(release).toMatchObject({ status: "passed" });
    expect(release.summary).toContain("已有版本在线");
    expect(release.summary).toContain("当前已批准版本仍未部署");
    expect(release.summary).not.toContain("进入真实 live 部署");
    expect(judgments.find(({ checkId }) => checkId === "website-public-boundary"))
      .toMatchObject({ status: "partial" });
  });

  it("does not pass a mainland deployment whose authoritative head points elsewhere", () => {
    const observation = approvedObservation();
    const deploymentId = "88888888-8888-4888-8888-888888888888";
    const mismatchedHeadId = "99999999-9999-4999-8999-999999999999";
    const mismatch = {
      ...observation,
      project: {
        ...observation.project,
        status: "live" as const,
        canonicalHostname: "help.example.cn",
        mainlandLiveDeploymentId: mismatchedHeadId,
      },
      domainState: {
        domain: "help.example.cn",
        displayDomain: "help.example.cn",
        revision: 2,
        ownershipStatus: "verified",
        dnsStatus: "active",
        icpStatus: "approved" as const,
        icpDomainRevision: 2,
        icpVerifiedAt: "2026-10-23T01:12:00.000Z",
      },
      deployments: [{
        id: deploymentId,
        buildId: observation.builds[0]!.id,
        target: "mainland_cn" as const,
        status: "active" as const,
        publicUrl: "https://help.example.cn",
        createdAt: "2026-10-23T01:15:00.000Z",
      }],
      interactionState: "live" as const,
    } satisfies SiteOpsObservationV1;
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(mismatch);

    expect(judgments.find(({ checkId }) => checkId === "website-public-boundary"))
      .toMatchObject({
        status: "partial",
        summary: expect.stringContaining("权威 head 未精确指向该部署"),
      });
    expect(judgments.find(({ checkId }) => checkId === "website-draft-release-state"))
      .toMatchObject({
        status: "partial",
        summary: expect.stringContaining("当前版本未确认上线"),
      });
  });

  it("passes a mainland deployment only when its own authoritative head matches", () => {
    const observation = approvedObservation();
    const deploymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const live = {
      ...observation,
      project: {
        ...observation.project,
        status: "live" as const,
        canonicalHostname: "help.example.cn",
        mainlandLiveDeploymentId: deploymentId,
      },
      domainState: {
        domain: "help.example.cn",
        displayDomain: "help.example.cn",
        revision: 2,
        ownershipStatus: "verified",
        dnsStatus: "active",
        icpStatus: "approved" as const,
        icpDomainRevision: 2,
        icpVerifiedAt: "2026-10-23T01:12:00.000Z",
      },
      deployments: [{
        id: deploymentId,
        buildId: observation.builds[0]!.id,
        target: "mainland_cn" as const,
        status: "active" as const,
        publicUrl: "https://help.example.cn",
        createdAt: "2026-10-23T01:15:00.000Z",
      }],
      interactionState: "live" as const,
    } satisfies SiteOpsObservationV1;
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(live);

    expect(judgments.find(({ checkId }) => checkId === "website-public-boundary"))
      .toMatchObject({ status: "passed" });
    expect(judgments.find(({ checkId }) => checkId === "website-draft-release-state"))
      .toMatchObject({ status: "passed" });
    expect(websiteBuildEvaluationSkill.evaluate({ judgments }))
      .toMatchObject({ score: 100, recommendation: "recommended" });
  });

  it("does not invent a score before a real build exists", () => {
    const observation = approvedObservation();
    const empty = {
      ...observation,
      builds: [],
      executionSteps: [],
      project: { ...observation.project, status: "collecting_brief" as const },
      interactionState: "collecting_brief" as const,
    } satisfies SiteOpsObservationV1;
    const judgments = buildWebsiteEvaluationJudgmentsFromSiteOps(empty);
    const result = websiteBuildEvaluationSkill.evaluate({ judgments });

    expect(judgments.every(({ status }) => status === "pending")).toBe(true);
    expect(result).toMatchObject({
      status: "not_run",
      score: null,
      coverage: 0,
    });
  });
});
