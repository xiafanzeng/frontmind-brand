import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import type {
  SiteDesignRecommendationInput,
  SiteDesignRecommendationOutput,
} from "../../../contracts/site-design-preferences";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import { siteOpsRevisionAttempt } from "../siteops/ConnectedSiteOpsConversationPanel";
import {
  buildLiveSiteOpsRevisionMessage,
  SimplifiedWebsiteBuilderPreview,
  WEBSITE_DRAFT_STORAGE_KEY,
} from "./SimplifiedWebsiteBuilderPreview";
import {
  listEvaluationReports,
  listPublishDecisions,
  saveEvaluationReport,
} from "./evaluation-report-store";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";

const KNOWLEDGE_COORDINATE = {
  id: "22222222-2222-4222-8222-222222222222",
  version: 3,
  archiveHash: "a".repeat(64),
} as const;

const TEMPLATE_COORDINATE = {
  id: "frontmind-help-center",
  version: "frontmind-curated-20261025-v6",
} as const;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function seedLiveDesignDraft(input: {
  scope: string;
  selectedTemplateId: string;
  featuredRouteIds: string[];
}) {
  window.localStorage.setItem(
    `${WEBSITE_DRAFT_STORAGE_KEY}.${encodeURIComponent(input.scope)}`,
    JSON.stringify({
      version: 2,
      updatedAt: 123,
      confirmed: false,
      completedStepIds: ["template"],
      selectedTemplateId: input.selectedTemplateId,
      templateSourceUrl: "",
      design: {
        siteName: "本地未提交网站名称",
        siteGoal: "本地未提交建站目标",
        featuredPageIds: input.featuredRouteIds,
        siteAccent: "#6f35a5",
        assistant: {
          name: "本地助手",
          welcome: "您好，我会依据企业知识回答问题。",
          accent: "#6f35a5",
          followSiteAccent: true,
          tested: true,
        },
      },
    }),
  );
}

function observation(
  interactionState: "select_snapshot" | "collecting_brief" | "visual_searching",
): SiteOpsObservationV1 {
  return {
    schemaVersion: 1,
    executionKind: "site_ops",
    serviceReadiness: {
      visuals: { status: "configured" },
      website: { status: "configured" },
      publishing: { status: "configured" },
      domain: { status: "not_configured" },
    },
    aliyunConnection: {
      configured: false,
      status: "not_connected",
      verifiedAt: null,
      canDisconnect: true,
    },
    domainState: null,
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      conversationId: "siteops:1",
      revision: 3,
      status: interactionState === "select_snapshot" ? "draft" : "collecting_brief",
      currentKnowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
      primaryLanguage: "zh-CN",
      canonicalHostname: null,
      updatedAt: "2026-10-23T00:00:00.000Z",
    },
    brief: null,
    knowledgeSnapshots: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "知识库 ZIP · 第 3 版",
        sourceProfile: "dashboard-core-v1",
        createdAt: "2026-10-23T00:00:00.000Z",
        active: true,
        coordinate: KNOWLEDGE_COORDINATE,
      },
    ],
    messages: [],
    visualCandidates: [],
    visualCandidatePages: [],
    visualGeneration: {
      status: "idle",
      targetPage: null,
      generatedPages: 0,
      availablePages: 4,
      reservedPages: 0,
      maxPages: 4,
      canGenerateMore: false,
      canSelectExisting: false,
    },
    executionSteps: [],
    builds: [],
    deployments: [],
    socialPackages: [],
    rebuildRequest: {
      allowed: false,
      resetApplied: false,
      resetSourceBuildId: null,
    },
    interactionState,
    latestSequence: 1,
  };
}

function liveSiteOps(
  interactionState: "select_snapshot" | "collecting_brief",
) {
  const onAction = vi.fn(async () => undefined);
  return {
    onAction,
    props: {
      observation: observation(interactionState),
      loading: false,
      refreshing: false,
      interactionPending: false,
      onAction,
    } as unknown as SiteOpsConversationPanelProps,
  };
}

function liveBuildObservation(
  interactionState: "awaiting_visual_selection" | "approved",
): SiteOpsObservationV1 {
  const base = observation("collecting_brief");
  const candidate = {
    id: "33333333-3333-4333-8333-333333333333",
    label: "A" as const,
    title: "真实帮助中心模板",
    previewUrl: "/api/frontmind/v2/siteops/templates/preview-a",
    note: "真实模板目录中的可执行候选",
    visualFamily: "editorial" as const,
    selected: interactionState === "approved",
    executionAdmitted: true,
    executionAdmissionMode: "provider_source" as const,
    executionUnavailableReason: null,
    templateCoordinate: TEMPLATE_COORDINATE,
  };
  return {
    ...base,
    project: {
      ...base.project,
      status: interactionState,
      revision: interactionState === "approved" ? 9 : 5,
    },
    domainState: interactionState === "approved"
      ? {
          domain: "help.example.com",
          displayDomain: "help.example.com",
          revision: 1,
          ownershipStatus: "verified",
          dnsStatus: "active",
          icpStatus: "not_required",
          icpDomainRevision: null,
          icpVerifiedAt: null,
        }
      : base.domainState,
    brief: {
      companyName: "测试企业",
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: ["企业服务"],
      audience: ["客户"],
      conversionGoal: "帮助客户找到答案",
      contentInventory: {
        schemaVersion: 1,
        source: "frozen_knowledge_snapshot",
        entries: [],
      },
      routes: [
        {
          id: "help",
          slug: "/help",
          title: "帮助中心",
          sourceDocumentIds: ["document-1"],
        },
      ],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    },
    visualCandidates: [candidate],
    visualGeneration: {
      ...base.visualGeneration,
      status: "idle",
      generatedPages: 4,
      availablePages: 4,
      canSelectExisting: true,
    },
    builds: interactionState === "approved"
      ? [{
          id: "44444444-4444-4444-8444-444444444444",
          ordinal: 1,
          parentBuildId: null,
          status: "approved",
          previewUrl: "/api/frontmind/v2/siteops/builds/preview-1",
          sourceUrl: null,
          buildDelivery: {
            renderMode: "twenty_first_native",
            qaStatus: "passed",
            warningCodes: [],
          },
          needsHelp: false,
          createdAt: "2026-10-23T01:00:00.000Z",
          updatedAt: "2026-10-23T01:10:00.000Z",
        }]
      : [],
    interactionState,
  };
}

function fullCatalogObservation(): SiteOpsObservationV1 {
  const base = liveBuildObservation("awaiting_visual_selection");
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
  const templates = [
    [33, "蔚蓝帮助中心"],
    [34, "藏青文档站"],
    [35, "松绿极简帮助页"],
    [15, "NexaCore"],
    [21, "Mindloop"],
    [22, "Agency Landing"],
  ] as const;
  const candidates = templates.map(([catalogPosition, title], index) => {
    const order = index + 1;
    return {
      id: `33333333-3333-4333-8333-${String(order).padStart(12, "0")}`,
      label: labels[index % 8]!,
      title,
      previewUrl: `/api/frontmind/v2/siteops/templates/preview-${order}`,
      note: `真实模板目录中的第 ${order} 个可执行候选`,
      visualFamily: "editorial" as const,
      selected: false,
      executionAdmitted: true,
      executionAdmissionMode: catalogPosition === 15 || catalogPosition === 21
        ? "preview_reference_fallback" as const
        : catalogPosition === 22
          ? "verified_normalized_cache" as const
          : "provider_source" as const,
      executionUnavailableReason: null,
      templateCoordinate: {
        id: `catalog-template-${catalogPosition}`,
        version: "frontmind-curated-20261025-v6",
      },
    };
  });
  return {
    ...base,
    visualCandidates: [],
    visualCandidatePages: [{
      batchId: "44444444-4444-4444-8444-000000000001",
      page: 1,
      candidates,
    }],
    visualGeneration: {
      ...base.visualGeneration,
      generatedPages: 1,
      availablePages: 1,
      maxPages: 1,
      canSelectExisting: true,
      workflowVersion: "2.9.0",
      catalogVersion: "frontmind-curated-20261025-v6",
      pageSize: 8,
      pageCount: 1,
    },
  };
}

function recommendableObservation(): SiteOpsObservationV1 {
  const base = liveBuildObservation("awaiting_visual_selection");
  const routes = [
    ["home", "/", "首页"],
    ["products", "/products", "产品与服务"],
    ["contact", "/contact", "联系我们"],
    ["about", "/about", "关于我们"],
  ] as const;
  return {
    ...base,
    brief: {
      ...base.brief!,
      routes: routes.map(([id, slug, title]) => ({
        id,
        slug,
        title,
        sourceDocumentIds: [`source_${id}`],
      })),
    },
  };
}

function designRecommendation(
  request: SiteDesignRecommendationInput,
): SiteDesignRecommendationOutput {
  const candidates = [
    ["home", "/", "首页", "homepage_entry"],
    ["products", "/products", "产品与服务", "core_business_coverage"],
    ["contact", "/contact", "联系我们", "verified_contact_conversion"],
    ["about", "/about", "关于我们", "secondary_knowledge_coverage"],
  ] as const;
  const featuredRouteIds = ["home", "products", "contact"];
  return {
    schemaVersion: 1,
    requestContext: request.requestContext,
    knowledgeSnapshot: request.knowledgeSnapshot,
    template: request.template,
    siteName: {
      value: "远山企业官网",
      status: "trusted",
      sourceType: "company_name",
      sourceDocumentIds: ["source_company"],
    },
    siteGoal: {
      value: "让客户快速了解产品、服务与联系渠道",
      status: "recommended",
      sourceDocumentIds: ["source_products", "source_contact"],
    },
    candidates: candidates.map(([id, slug, title, reason], index) => ({
      id,
      slug,
      title,
      sourceDocumentIds: [`source_${id}`],
      evidenceDocumentCount: 1,
      importanceRank: index + 1,
      featured: featuredRouteIds.includes(id),
      recommendationReason: reason,
    })),
    featuredRouteIds,
    previewBlocks: candidates.map(([id, , title]) => ({
      id: `block_${id}`,
      routeId: id,
      kind: id === "home"
        ? "hero"
        : id === "products"
          ? "offerings"
          : id === "contact"
            ? "contact"
            : "summary",
      title: `${title}真实内容`,
      body: `${title}的知识投影`,
      items: [],
      sourceDocumentIds: [`source_${id}`],
    })),
    unresolved: [],
    recommendationHash: "b".repeat(64),
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("redesigned live website builder setup", () => {
  it("starts a fresh idempotency attempt when the same revision text targets a newer project revision", async () => {
    const first = await siteOpsRevisionAttempt(null, {
      text: "相同改版要求",
      files: [],
      expectedProjectRevision: 4,
    });
    const retry = await siteOpsRevisionAttempt(first, {
      text: "相同改版要求",
      files: [],
      expectedProjectRevision: 5,
    });

    expect(retry.expectedProjectRevision).toBe(5);
    expect(retry.clientRequestId).not.toBe(first.clientRequestId);
  });

  it("keeps structured settings out of the legacy revision message", () => {
    const message = buildLiveSiteOpsRevisionMessage();

    expect(message).toBe("请按已保存的网站设计配置生成新版本。");
    expect(message).not.toContain("站点语言");
    expect(message).not.toContain("网站主题色");
    expect(message).not.toContain("AI 助手");
  });

  it("advances from the current published snapshot through the real action", async () => {
    const siteOps = liveSiteOps("select_snapshot");
    render(<SimplifiedWebsiteBuilderPreview siteOps={siteOps.props} />);

    expect(screen.getByTestId("website-builder-live-root")).toBeTruthy();
    fireEvent.click(screen.getByTestId("siteops-advance"));

    await waitFor(() =>
      expect(siteOps.onAction).toHaveBeenCalledWith({
        action: "select_snapshot",
        input: {},
      }),
    );
  });

  it("loads the real template catalog after the knowledge scope is linked", async () => {
    const siteOps = liveSiteOps("collecting_brief");
    render(<SimplifiedWebsiteBuilderPreview siteOps={siteOps.props} />);

    fireEvent.click(screen.getByTestId("siteops-advance"));

    await waitFor(() =>
      expect(siteOps.onAction).toHaveBeenCalledWith({
        action: "start_visual_search",
        input: {},
      }),
    );
  });

  it("restarts the initial visual search after a retryable first-load failure", async () => {
    const siteOps = liveSiteOps("collecting_brief");
    const failed = {
      ...siteOps.props.observation!,
      project: {
        ...siteOps.props.observation!.project,
        status: "failed" as const,
      },
      interactionState: "failed" as const,
      visualGeneration: {
        ...siteOps.props.observation!.visualGeneration,
        status: "retryable_error" as const,
        retryAction: "start" as const,
        failureCategory: "render_failed" as const,
      },
    };
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{ ...siteOps.props, observation: failed }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新载入真实模板" }));

    await waitFor(() =>
      expect(siteOps.onAction).toHaveBeenCalledWith({
        action: "start_visual_search",
        input: {},
      }),
    );
  });

  it("reselects the next visual page after a retryable supplemental failure", async () => {
    const siteOps = liveSiteOps("collecting_brief");
    const failed = {
      ...siteOps.props.observation!,
      project: {
        ...siteOps.props.observation!.project,
        status: "awaiting_visual_selection" as const,
      },
      interactionState: "awaiting_visual_selection" as const,
      visualGeneration: {
        ...siteOps.props.observation!.visualGeneration,
        status: "retryable_error" as const,
        generatedPages: 1,
        canSelectExisting: true,
        retryAction: "supplemental" as const,
        failureCategory: "render_failed" as const,
      },
    };
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{ ...siteOps.props, observation: failed }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "继续载入下一页" }));

    await waitFor(() =>
      expect(siteOps.onAction).toHaveBeenCalledWith({
        action: "reselect_visual",
        input: {},
      }),
    );
  });

  it("shows the six admitted v6 templates without hiding the three custom templates", () => {
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{ observation: fullCatalogObservation(), onAction: vi.fn() }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.getAllByTestId("website-template-card")).toHaveLength(6);
    for (const title of ["蔚蓝帮助中心", "藏青文档站", "松绿极简帮助页", "NexaCore", "Mindloop", "Agency Landing"]) {
      expect(screen.getByText(title)).toBeTruthy();
      expect((screen.getByRole("radio", { name: new RegExp(title) }) as HTMLInputElement).disabled).toBe(false);
    }
    expect(screen.getAllByText("安全视觉参考")).toHaveLength(2);
    expect(screen.getAllByText("真实可执行模板")).toHaveLength(4);
    expect(screen.getAllByText(/基于冻结预览图重建/)).toHaveLength(4);
    expect((screen.getByDisplayValue(
      "33333333-3333-4333-8333-000000000001",
    ) as HTMLInputElement).disabled).toBe(false);
  });

  it("hydrates unsaved live route and template IDs, then lets persisted server design preferences win", async () => {
    const scope = "live:7:opaque-draft-hydration";
    const base = recommendableObservation();
    const firstCandidate = { ...base.visualCandidates[0]!, selected: false };
    const draftCandidate = {
      ...firstCandidate,
      id: "33333333-3333-4333-8333-000000000002",
      title: "本地草稿模板",
      previewUrl: "/api/frontmind/v2/siteops/templates/preview-draft",
      templateCoordinate: {
        id: "draft-template-coordinate",
        version: TEMPLATE_COORDINATE.version,
      },
    };
    const withDraftCandidate: SiteOpsObservationV1 = {
      ...base,
      visualCandidates: [firstCandidate, draftCandidate],
    };
    seedLiveDesignDraft({
      scope,
      selectedTemplateId: draftCandidate.id,
      featuredRouteIds: ["about"],
    });
    const baseProps: SiteOpsConversationPanelProps = {
      observation: withDraftCandidate,
      onAction: vi.fn(),
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope={scope}
      />,
    );

    await waitFor(() => {
      expect((screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText(/本地草稿模板 · 1 个主栏目/)).toBeTruthy();
    });

    const withServerDesign: SiteOpsObservationV1 = {
      ...withDraftCandidate,
      brief: {
        ...withDraftCandidate.brief!,
        designPreferences: {
          schemaVersion: 1,
          siteName: "服务端已保存网站",
          siteGoal: "服务端已保存目标",
          featuredRouteIds: ["home"],
          siteAccent: "#315b8a",
          assistant: {
            name: "服务端助手",
            welcome: "您好，这是服务端已保存的欢迎语。",
            accentMode: "follow_site",
            customAccent: "#315b8a",
          },
          knowledgeSnapshot: KNOWLEDGE_COORDINATE,
          template: TEMPLATE_COORDINATE,
          designRevision: 2,
          draftHash: "c".repeat(64),
        },
      },
    };
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ ...baseProps, observation: withServerDesign }}
        storageScope={scope}
      />,
    );

    await waitFor(() => {
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("服务端已保存网站");
      expect((screen.getByLabelText("在网站中显示首页") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement).checked).toBe(false);
      expect(screen.getByText(/真实帮助中心模板 · 1 个主栏目/)).toBeTruthy();
    });
  });

  it("does not invent demo routes for an opaque live draft before the real brief arrives", () => {
    const scope = "live:7:opaque-draft-before-brief";
    seedLiveDesignDraft({
      scope,
      selectedTemplateId: "33333333-3333-4333-8333-000000000009",
      featuredRouteIds: ["home", "products:cloud"],
    });

    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: observation("select_snapshot"), onAction: vi.fn() }}
        storageScope={scope}
      />,
    );

    expect(screen.getByText("共 0 个栏目，0 个启用")).toBeTruthy();
    expect(screen.queryByLabelText("在网站中显示快速开始")).toBeNull();
    expect(screen.queryByLabelText("在网站中显示首页")).toBeNull();
  });

  it("identifies a preview fallback without presenting it as the original repository build", () => {
    const approved = liveBuildObservation("approved");
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="template"
        siteOps={{
          observation: {
            ...approved,
            visualCandidates: approved.visualCandidates.map((candidate) => ({
              ...candidate,
              previewUrl: `/api/site-ops/style-previews/${candidate.id}`,
              executionAdmissionMode: "preview_reference_fallback" as const,
            })),
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.getByText("安全视觉参考")).toBeTruthy();
    expect(screen.getByText(/基于冻结预览图重建，不代表原仓源码的实际构建/)).toBeTruthy();
    expect(screen.queryByText(/已准入模板的实际构建/)).toBeNull();
    expect(
      screen.getByTestId("website-template-card").querySelector("img")?.getAttribute("src"),
    ).toBe("/api/site-ops/style-previews/33333333-3333-4333-8333-333333333333");
  });

  it("requests source-backed recommendations and allows replacing at most three featured routes", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:recommendation"
      />,
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]?.[0] as
      | SiteDesignRecommendationInput
      | undefined;
    expect(request).toMatchObject({
      knowledgeSnapshot: KNOWLEDGE_COORDINATE,
      template: TEMPLATE_COORDINATE,
      requestContext: {
        baseDesignRevision: 0,
        baseDraftHash: "0".repeat(64),
      },
    });
    expect(request).toBeTruthy();
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request: request!,
            data: designRecommendation(request!),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:recommendation"
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );
    expect(screen.getByText("共 4 个栏目，3 个启用")).toBeTruthy();
    expect(screen.getAllByText("首页真实内容").length).toBeGreaterThan(0);
    expect(
      ["首页", "产品与服务", "联系我们", "关于我们"].filter(
        (name) =>
          (screen.getByLabelText(`在网站中显示${name}`) as HTMLInputElement)
            .checked,
      ),
    ).toEqual(["首页", "产品与服务", "联系我们"]);

    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(screen.getByText("主栏目最多选择 3 个；请先取消一个已选栏目再替换。")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("在网站中显示联系我们"));
    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(
      (screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("在网站中显示联系我们") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("does not treat a frozen build design snapshot as the editable project OCC state", async () => {
    const current = recommendableObservation();
    const frozenBuild = liveBuildObservation("approved").builds[0]!;
    const frozenOnly: SiteOpsObservationV1 = {
      ...current,
      builds: [{
        ...frozenBuild,
        designPreferences: {
          schemaVersion: 1,
          siteName: "历史构建名称",
          siteGoal: "历史构建目标",
          featuredRouteIds: ["home"],
          siteAccent: "#315b8a",
          assistant: {
            name: "历史助手",
            welcome: "这是冻结构建中的历史欢迎语。",
            accentMode: "follow_site",
            customAccent: "#315b8a",
          },
          knowledgeSnapshot: KNOWLEDGE_COORDINATE,
          template: TEMPLATE_COORDINATE,
          designRevision: 9,
          draftHash: "d".repeat(64),
        },
      }],
    };
    const onRequestDesignRecommendation = vi.fn();
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: frozenOnly,
          onAction: vi.fn(),
          onRequestDesignRecommendation,
        }}
        storageScope="live:7:frozen-build-occ"
      />,
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    expect(onRequestDesignRecommendation.mock.calls[0]?.[0]).toMatchObject({
      requestContext: {
        baseDesignRevision: 0,
        baseDraftHash: "0".repeat(64),
      },
    });
  });

  it("does not let a late recommendation overwrite manual edits", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:dirty-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "用户手填网站名称" },
    });

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: designRecommendation(request),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:dirty-recommendation"
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("用户手填网站名称"),
    );
    expect(screen.queryByText("首页真实内容")).toBeNull();
  });

  it("rejects a recommendation whose knowledge coordinate is no longer current", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:coordinate-stale-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const staleRequest = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    const movedObservation: SiteOpsObservationV1 = {
      ...current,
      knowledgeSnapshots: current.knowledgeSnapshots.map((snapshot) => snapshot.coordinate
        ? {
            ...snapshot,
            coordinate: {
              ...snapshot.coordinate,
              version: snapshot.coordinate.version + 1,
              archiveHash: "c".repeat(64),
            },
          }
        : snapshot),
    };

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          observation: movedObservation,
          designRecommendation: {
            request: staleRequest,
            data: designRecommendation(staleRequest),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:coordinate-stale-recommendation"
      />,
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(2),
    );
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("测试企业");
    expect(screen.queryByText("首页真实内容")).toBeNull();
  });

  it("keeps manual fields usable when recommendation fails", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const onRetryDesignRecommendation = vi.fn(async () => undefined);
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
      onRetryDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:failed-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), {
      target: { value: "用户手填建站目标" },
    });
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: null,
            loading: false,
            error: "推荐服务暂时不可用",
          },
        }}
        storageScope="live:7:failed-recommendation"
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "手动填写的内容不会丢失",
    );
    expect(
      (screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement)
        .value,
    ).toBe("用户手填建站目标");
    fireEvent.click(screen.getByRole("button", { name: "重试推荐" }));
    expect(onRetryDesignRecommendation).toHaveBeenCalledTimes(1);
  });

  it("refreshes recommendations while keeping manually edited fields", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:refresh-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const firstRequest = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request: firstRequest,
            data: designRecommendation(firstRequest),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:refresh-recommendation"
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );
    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), {
      target: { value: "用户手填建站目标" },
    });

    fireEvent.click(
      within(screen.getByTestId("website-recommendation-refresh")).getByRole(
        "button",
        { name: "刷新推荐" },
      ),
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(2),
    );
    const secondRequest = onRequestDesignRecommendation.mock.calls[1]![0] as
      SiteDesignRecommendationInput;
    expect(secondRequest.requestContext.requestId).not.toBe(
      firstRequest.requestContext.requestId,
    );
    expect(secondRequest.knowledgeSnapshot).toEqual(firstRequest.knowledgeSnapshot);
    expect(secondRequest.template).toEqual(firstRequest.template);

    const refreshed = designRecommendation(secondRequest);
    refreshed.siteName = { ...refreshed.siteName, value: "刷新后的企业名称" };
    refreshed.siteGoal = { ...refreshed.siteGoal, value: "刷新后的建站目标" };
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request: secondRequest,
            data: refreshed,
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:refresh-recommendation"
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("刷新后的企业名称"),
    );
    expect(
      (screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement)
        .value,
    ).toBe("用户手填建站目标");
  });

  it("marks an applied recommendation stale after a knowledge change instead of refetching", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:stale-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    const appliedData = designRecommendation(request);
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: appliedData,
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:stale-recommendation"
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );

    const movedObservation: SiteOpsObservationV1 = {
      ...current,
      knowledgeSnapshots: current.knowledgeSnapshots.map((snapshot) =>
        snapshot.coordinate
          ? {
              ...snapshot,
              coordinate: {
                ...snapshot.coordinate,
                version: snapshot.coordinate.version + 1,
                archiveHash: "c".repeat(64),
              },
            }
          : snapshot),
    };
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          observation: movedObservation,
          designRecommendation: {
            request,
            data: appliedData,
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:stale-recommendation"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("website-recommendation-stale")).toBeTruthy(),
    );
    expect(screen.getByTestId("website-recommendation-stale").textContent)
      .toContain("新建议可用");
    expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("远山企业官网");
    expect(screen.queryByTestId("website-recommendation-refresh")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("website-recommendation-stale")).getByRole(
        "button",
        { name: "刷新推荐" },
      ),
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(2),
    );
    expect(onRequestDesignRecommendation.mock.calls[1]![0]).toMatchObject({
      knowledgeSnapshot: {
        id: KNOWLEDGE_COORDINATE.id,
        version: KNOWLEDGE_COORDINATE.version + 1,
        archiveHash: "c".repeat(64),
      },
      template: TEMPLATE_COORDINATE,
    });
  });

  it("restores recommended values per edited field", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:restore-recommendation"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: designRecommendation(request),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:restore-recommendation"
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );

    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "自定义名称" },
    });
    expect(screen.getByTestId("website-site-name-recommend-flag").textContent)
      .toContain("已修改");
    expect(screen.getByTestId("website-site-goal-recommend-flag").textContent)
      .toContain("根据企业资料推荐");

    fireEvent.click(screen.getByRole("button", { name: "恢复推荐的网站名称" }));
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );
    expect(screen.getByTestId("website-site-name-recommend-flag").textContent)
      .toContain("根据企业资料推荐");

    fireEvent.click(screen.getByLabelText("在网站中显示联系我们"));
    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(screen.getByTestId("website-routes-recommend-flag").textContent)
      .toContain("主栏目已手动调整");
    fireEvent.click(screen.getByRole("button", { name: "恢复推荐的主栏目" }));
    await waitFor(() => {
      expect(
        (screen.getByLabelText("在网站中显示联系我们") as HTMLInputElement)
          .checked,
      ).toBe(true);
      expect(
        (screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement)
          .checked,
      ).toBe(false);
    });
    expect(screen.getByTestId("website-routes-recommend-flag").textContent)
      .toContain("主栏目根据企业资料推荐");
  });

  it("prefers saved user-edited draft fields over the live brief and recommendations", async () => {
    const scope = "live:7:saved-edit-priority";
    window.localStorage.setItem(
      `${WEBSITE_DRAFT_STORAGE_KEY}.${encodeURIComponent(scope)}`,
      JSON.stringify({
        version: 2,
        updatedAt: 123,
        confirmed: false,
        completedStepIds: ["template"],
        selectedTemplateId: "33333333-3333-4333-8333-333333333333",
        templateSourceUrl: "",
        design: {
          siteName: "我的企业网站",
          siteGoal: "本地未提交建站目标",
          featuredPageIds: ["home"],
          siteAccent: "#6f35a5",
          assistant: {
            name: "本地助手",
            welcome: "您好，我会依据企业知识回答问题。",
            accent: "#6f35a5",
            followSiteAccent: true,
            tested: true,
          },
          recommendationEditedFields: ["siteName"],
        },
      }),
    );
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope={scope}
      />,
    );

    // The unflagged goal hydrates from the real brief, proving hydration ran
    // while the flagged name keeps its saved user value.
    await waitFor(() =>
      expect(
        (screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement)
          .value,
      ).toBe("帮助客户找到答案"),
    );
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("我的企业网站");
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: designRecommendation(request),
            loading: false,
            error: null,
          },
        }}
        storageScope={scope}
      />,
    );

    await waitFor(() =>
      expect(
        (screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement)
          .value,
      ).toBe("让客户快速了解产品、服务与联系渠道"),
    );
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("我的企业网站");
    expect(screen.getByTestId("website-site-name-recommend-flag").textContent)
      .toContain("已修改");
    expect(
      screen.getByRole("button", { name: "恢复推荐的网站名称" }),
    ).toBeTruthy();
  });

  it("renders the real-data draft preview from the server projection", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:draft-preview"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    // Before the projection arrives the preview stays honest: a waiting
    // state, never a fixture website.
    expect(screen.getByTestId("website-draft-preview-state").textContent)
      .toContain("尚未生成真实数据草稿");
    expect(screen.queryByText("您好，需要了解什么？")).toBeNull();
    expect(screen.queryByText("搜索文档，或直接询问 AI 助手")).toBeNull();

    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: designRecommendation(request),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:draft-preview"
      />,
    );

    const banner = screen.getByTestId("website-draft-preview-banner");
    expect(banner.textContent).toContain("真实数据草稿");
    expect(banner.textContent).toContain("知识库 v3");
    expect(banner.textContent).toContain("构建完成后以真实构建预览为准");
    const blocks = screen
      .getAllByTestId("website-draft-block")
      .map((block) => block.textContent);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("首页 Hero");
    expect(blocks[0]).toContain("首页真实内容");
    expect(blocks[0]).toContain("首页的知识投影");
    expect(blocks[1]).toContain("产品与服务");
    expect(blocks[2]).toContain("联系方式");
    expect(screen.getAllByText(/个知识来源/).length).toBeGreaterThanOrEqual(3);
    // The unified preview keeps the assistant on the same screen.
    expect(screen.getByLabelText("在网站助手中提问")).toBeTruthy();
    // Fixture demo copy must not leak into the live preview.
    expect(screen.queryByText("您好，需要了解什么？")).toBeNull();
    expect(screen.queryByText("企业知识帮助中心")).toBeNull();
  });

  it("shows an in-progress draft state instead of mock pages while projecting", async () => {
    const current = recommendableObservation();
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: current,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:draft-loading"
      />,
    );
    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: null,
            loading: true,
            error: null,
          },
        }}
        storageScope="live:7:draft-loading"
      />,
    );

    expect(screen.getByTestId("website-draft-preview-state").textContent)
      .toContain("正在按当前发布知识生成真实数据草稿");
    expect(screen.queryByText("您好，需要了解什么？")).toBeNull();
    expect(screen.queryByTestId("website-draft-block")).toBeNull();
  });

  it("feeds the draft preview without rewriting saved design preferences", async () => {
    const withPreferences = recommendableObservation();
    withPreferences.brief = {
      ...withPreferences.brief!,
      designPreferences: {
        schemaVersion: 1,
        siteName: "已保存网站名称",
        siteGoal: "已保存建站目标",
        featuredRouteIds: ["home", "products", "contact"],
        siteAccent: "#6f35a5",
        assistant: {
          name: "已保存助手",
          welcome: "这是已保存的欢迎语。",
          accentMode: "follow_site",
          customAccent: "#6f35a5",
        },
        knowledgeSnapshot: KNOWLEDGE_COORDINATE,
        template: TEMPLATE_COORDINATE,
        designRevision: 2,
        draftHash: "e".repeat(64),
      },
    };
    const onRequestDesignRecommendation = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: withPreferences,
      onAction: vi.fn(),
      onRequestDesignRecommendation,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={baseProps}
        storageScope="live:7:draft-preview-only"
      />,
    );

    await waitFor(() =>
      expect(onRequestDesignRecommendation).toHaveBeenCalledTimes(1),
    );
    const request = onRequestDesignRecommendation.mock.calls[0]![0] as
      SiteDesignRecommendationInput;
    expect(request.requestContext.baseDesignRevision).toBe(2);
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          ...baseProps,
          designRecommendation: {
            request,
            data: designRecommendation(request),
            loading: false,
            error: null,
          },
        }}
        storageScope="live:7:draft-preview-only"
      />,
    );

    // The saved preferences still own the form.
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("已保存网站名称");
    expect(
      (screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement).value,
    ).toBe("已保存建站目标");
    // The real-data draft preview still renders from the projection.
    expect(screen.getByTestId("website-draft-preview-banner").textContent)
      .toContain("真实数据草稿");
    expect(screen.getAllByTestId("website-draft-block").length).toBe(3);
  });

  it("saves the real brief configuration before selecting the admitted template", async () => {
    const events: string[] = [];
    const waiting = liveBuildObservation("awaiting_visual_selection");
    const onAction = vi.fn(async () => { events.push("select"); });
    const onSaveDesignPreferences = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSaveDesignPreferences"]>>[0],
    ) => {
      events.push("save");
      return {
        ...waiting,
        project: { ...waiting.project, revision: waiting.project.revision + 1 },
      };
    });
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{
          observation: waiting,
          onAction,
          onSaveDesignPreferences,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.getAllByTestId("website-template-card")).toHaveLength(1);
    expect(screen.getByText("真实帮助中心模板")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /真实帮助中心模板/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续配置真实 brief" }));

    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "远山客户帮助中心" },
    });
    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), {
      target: { value: "帮助客户自助解决产品问题" },
    });
    fireEvent.click(screen.getByLabelText("在网站中显示帮助中心"));
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }));
    expect(screen.queryByLabelText("站点语言")).toBeNull();

    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "远山智能助手" },
    });
    fireEvent.change(screen.getByLabelText("欢迎语"), {
      target: { value: "您好，我会依据企业知识为您解答。" },
    });
    expect(screen.getByTestId("website-design-preview")).toBeTruthy();
    expect(screen.queryByLabelText(/展示回答来源/)).toBeNull();
    // 统一的网站设计步骤必须先完成一次真实问答试用，才能保存配置并开始生成。
    fireEvent.click(screen.getByTestId("website-build-start"));
    expect(screen.getByText(/完成助手试用后再继续/)).toBeTruthy();
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "如何配置网站 AI 助手？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(screen.getByText("助手试用已完成")).toBeTruthy());
    fireEvent.click(screen.getByTestId("website-build-start"));

    await waitFor(() => expect(onSaveDesignPreferences).toHaveBeenCalledTimes(1));
    const saved = onSaveDesignPreferences.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      conversationId: "siteops:1",
      expectedProjectRevision: 5,
      expectedDesignRevision: 0,
      draft: {
        schemaVersion: 1,
        siteName: "远山客户帮助中心",
        siteGoal: "帮助客户自助解决产品问题",
        featuredRouteIds: ["help"],
        siteAccent: "#315b8a",
        assistant: {
          name: "远山智能助手",
          welcome: "您好，我会依据企业知识为您解答。",
          accentMode: "follow_site",
        },
        knowledgeSnapshot: KNOWLEDGE_COORDINATE,
        template: TEMPLATE_COORDINATE,
      },
    });
    expect(saved?.draft).not.toHaveProperty("siteLanguage");
    expect(saved?.draft).not.toHaveProperty("officialUrl");
    expect(saved?.draft).not.toHaveProperty("brandMark");
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
        action: "select_visual",
        input: { sampleId: "33333333-3333-4333-8333-333333333333" },
      }));
    expect(events).toEqual(["save", "select"]);
  });

  it("keeps edits made during a pending save and does not build or advance an older design", async () => {
    const scope = "live:7:pending-save-race";
    const waiting = liveBuildObservation("awaiting_visual_selection");
    seedLiveDesignDraft({
      scope,
      selectedTemplateId: waiting.visualCandidates[0]!.id,
      featuredRouteIds: ["help"],
    });
    const saveRequest = deferred<SiteOpsObservationV1>();
    const onSaveDesignPreferences = vi.fn((
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSaveDesignPreferences"]>>[0],
    ) => saveRequest.promise);
    const onAction = vi.fn(async () => undefined);
    const onStepChange = vi.fn();
    const baseProps: SiteOpsConversationPanelProps = {
      observation: waiting,
      onAction,
      onSaveDesignPreferences,
    };
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        onStepChange={onStepChange}
        siteOps={baseProps}
        storageScope={scope}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("在网站中显示帮助中心") as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.click(screen.getByTestId("website-build-start"));
    await waitFor(() => expect(onSaveDesignPreferences).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "保存期间继续编辑的网站名称" },
    });
    const submitted = onSaveDesignPreferences.mock.calls[0]![0];
    const echoedObservation: SiteOpsObservationV1 = {
      ...waiting,
      project: { ...waiting.project, revision: waiting.project.revision + 1 },
      brief: {
        ...waiting.brief!,
        designPreferences: {
          ...submitted.draft,
          designRevision: 1,
          draftHash: "d".repeat(64),
        },
      },
    };
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        onStepChange={onStepChange}
        siteOps={{ ...baseProps, observation: echoedObservation }}
        storageScope={scope}
      />,
    );
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("保存期间继续编辑的网站名称");

    saveRequest.resolve(echoedObservation);
    await waitFor(() =>
      expect(screen.getByText(/保存期间网站设计已更新/)).toBeTruthy(),
    );
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("保存期间继续编辑的网站名称");
    expect(onAction).not.toHaveBeenCalled();
    expect(onStepChange).not.toHaveBeenCalledWith("evaluation");
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
  });

  it("submits an existing real build revision without selecting or publishing again", async () => {
    const approved = liveBuildObservation("approved");
    const events: string[] = [];
    const onAction = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSaveDesignPreferences"]>>[0],
    ) => {
      events.push("save");
      return {
        ...approved,
        project: { ...approved.project, revision: approved.project.revision + 1 },
      };
    });
    const onSubmitRevision = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => { events.push("revision"); });
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: approved,
          onAction,
          onSaveDesignPreferences,
          onSubmitRevision,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    const siteName = screen.getByTestId("website-site-name") as HTMLInputElement;
    const siteGoal = screen.getByTestId("website-site-goal") as HTMLTextAreaElement;
    expect(siteName.disabled).toBe(false);
    expect(siteGoal.disabled).toBe(false);
    fireEvent.change(siteName, { target: { value: "远山帮助中心改版" } });
    fireEvent.change(siteGoal, { target: { value: "让客户更快完成真实自助排障" } });
    fireEvent.click(screen.getByLabelText("在网站中显示帮助中心"));
    const assistantName = screen.getByTestId("website-assistant-name") as HTMLInputElement;
    const welcome = screen.getByTestId("website-assistant-welcome") as HTMLTextAreaElement;
    expect(assistantName.disabled).toBe(false);
    expect(welcome.disabled).toBe(false);
    fireEvent.change(assistantName, { target: { value: "远山改版助手" } });
    fireEvent.change(welcome, { target: { value: "您好，这里是改版后的真实帮助中心。" } });
    // 修改名称与欢迎语后需要重新完成一次问答试用。
    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "FrontMind 可以帮企业做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(screen.getByText("助手试用已完成")).toBeTruthy());
    fireEvent.click(screen.getByTestId("website-revision-submit"));

    await waitFor(() => expect(onSaveDesignPreferences).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    const saved = onSaveDesignPreferences.mock.calls[0]?.[0];
    expect(saved?.draft).toMatchObject({
      siteName: "远山帮助中心改版",
      siteGoal: "让客户更快完成真实自助排障",
      featuredRouteIds: ["help"],
      assistant: {
        name: "远山改版助手",
        welcome: "您好，这里是改版后的真实帮助中心。",
      },
    });
    const revision = onSubmitRevision.mock.calls[0]?.[0];
    expect(revision?.text).toBe(buildLiveSiteOpsRevisionMessage());
    expect(revision?.text).not.toContain("远山");
    expect(events).toEqual(["save", "revision"]);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not advance or complete an older revision when the design changes while submission is pending", async () => {
    const scope = "live:7:pending-revision-race";
    const approved = liveBuildObservation("approved");
    seedLiveDesignDraft({
      scope,
      selectedTemplateId: approved.visualCandidates[0]!.id,
      featuredRouteIds: ["help"],
    });
    const revisionRequest = deferred<void>();
    const onSaveDesignPreferences = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSaveDesignPreferences"]>>[0],
    ) => approved);
    const onSubmitRevision = vi.fn((
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => revisionRequest.promise);
    const onStepChange = vi.fn();
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        onStepChange={onStepChange}
        siteOps={{
          observation: approved,
          onAction: vi.fn(),
          onSaveDesignPreferences,
          onSubmitRevision,
        }}
        storageScope={scope}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("在网站中显示帮助中心") as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.click(screen.getByTestId("website-revision-submit"));
    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), {
      target: { value: "改版提交期间继续编辑的新目标" },
    });
    revisionRequest.resolve(undefined);

    await waitFor(() =>
      expect(screen.getByText(/改版任务提交期间网站设计已更新/)).toBeTruthy(),
    );
    expect((screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement).value)
      .toBe("改版提交期间继续编辑的新目标");
    expect(onStepChange).not.toHaveBeenCalledWith("evaluation");
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(1);
  });

  it("blocks direct design navigation when no real featured route exists", async () => {
    const onAction = vi.fn(async () => undefined);
    const onSubmitRevision = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () =>
      liveBuildObservation("awaiting_visual_selection"));
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: liveBuildObservation("awaiting_visual_selection"),
          onAction,
          onSubmitRevision,
          onSaveDesignPreferences,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.getByText("助手试用未完成")).toBeTruthy();
    expect((screen.getByTestId("website-build-start") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(onSubmitRevision).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "能保证两周内上线吗？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(screen.getByText("助手试用已完成")).toBeTruthy());
    expect((screen.getByTestId("website-build-start") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(0);
  });

  it("keeps the color pickers and the follow toggle usable in every live state", () => {
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: observation("visual_searching") }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(
      (screen.getByRole("button", { name: "选择助手主题色 #a44f25" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByLabelText(/跟随网站主题色/) as HTMLInputElement).disabled).toBe(false);

    expect(
      (screen.getByRole("button", { name: "选择网站主题色 #3e6b57" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    // 默认跟随：网站色与助手色保留在同一个设计草稿与同一页面。
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #3e6b57" }));
    expect(
      screen.getByRole("button", { name: "选择网站主题色 #3e6b57" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("group", { name: "助手主题色（跟随网站）" })).toBeTruthy();
    const followToggle = screen.getByLabelText(/跟随网站主题色/) as HTMLInputElement;
    expect(followToggle.checked).toBe(true);
    fireEvent.click(followToggle);
    fireEvent.click(screen.getByRole("button", { name: "选择助手主题色 #a44f25" }));
    expect(
      screen.getByRole("button", { name: "选择助手主题色 #a44f25" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("uses the server-selected template after submission and locks local reselection", () => {
    const current = liveBuildObservation("approved");
    const alternative = {
      ...current.visualCandidates[0],
      id: "55555555-5555-4555-8555-555555555555",
      label: "B" as const,
      title: "本地旧选择",
      selected: false,
    };
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{
          observation: {
            ...current,
            visualCandidates: [...current.visualCandidates, alternative],
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    const serverSelection = screen.getByRole("radio", { name: /真实帮助中心模板/ }) as HTMLInputElement;
    const alternativeSelection = screen.getByRole("radio", { name: /本地旧选择/ }) as HTMLInputElement;
    expect(serverSelection.checked).toBe(true);
    expect(serverSelection.disabled).toBe(true);
    expect(alternativeSelection.checked).toBe(false);
    expect(alternativeSelection.disabled).toBe(true);
    expect(screen.getByText("服务端已绑定此模板")).toBeTruthy();
  });

  it("isolates live drafts and RAG report provenance from preview storage", () => {
    window.localStorage.setItem(WEBSITE_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      confirmed: false,
      completedStepIds: [],
      selectedTemplateId: "help-center",
      templateSourceUrl: "",
      disabledPageIds: [],
      brand: {
        siteName: "预览环境站名",
        siteGoal: "预览环境目标",
        siteLanguage: "zh-CN",
        brandMark: "PV",
        officialUrl: "",
        recognized: false,
        siteAccent: "#6f35a5",
      },
      assistant: {
        name: "预览助手",
        welcome: "预览欢迎语",
        accent: "#6f35a5",
        showSources: true,
      },
    }));
    expect(saveEvaluationReport({
      reportId: "preview-rag-report",
      createdAt: "2026-10-23T08:00:00.000Z",
      subject: { kind: "rag-answer", id: "preview-answer", version: "1" },
      result: {
        skillId: "enterprise-rag-evaluation",
        version: "1.0.0",
        status: "completed",
        score: 90,
        coverage: 100,
        recommendation: "recommended",
        summary: "preview only",
        dimensions: [],
        risks: [],
        relatedReportIds: [],
      },
    })).toBe(true);

    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: observation("select_snapshot") }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("FrontMind 帮助中心");
    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "查找 RAG 评估" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查找 RAG 评估" }));
    expect(screen.getByText(/尚无可关联的企业 RAG 评估快照/)).toBeTruthy();
  });

  it("shows the true approved build and records publish audit only after the server accepts it", async () => {
    let acceptPublish: (() => void) | undefined;
    const onAction = vi.fn(() => new Promise<void>((resolve) => { acceptPublish = resolve; }));
    const auditStorage = scopedEvaluationStorage("live:7:workspace-a");
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: liveBuildObservation("approved"),
          onAction,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.getByTestId("siteops-build-status").textContent).toContain("网站已通过构建检查");
    expect(screen.getByTestId("siteops-preview-link").getAttribute("href")).toBe(
      "/api/frontmind/v2/siteops/builds/preview-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "进入发布确认" }));
    fireEvent.click(screen.getByRole("button", { name: /继续发布|确认继续发布/ }));

    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        action: "publish_global",
        input: {
          buildId: "44444444-4444-4444-8444-444444444444",
          expectedHeadDeploymentId: undefined,
        },
      }),
    );
    expect(listPublishDecisions(auditStorage)).toEqual([]);
    acceptPublish?.();
    await waitFor(() => expect(listPublishDecisions(auditStorage)).toHaveLength(1));
    expect(screen.getByText(/服务端已受理发布/).textContent).toContain("尚不表示已经上线");
  });

  it("evaluates real SiteOps evidence and restores the same immutable report after reload", async () => {
    const storageScope = "live:7:website-evaluation-recovery";
    const auditStorage = scopedEvaluationStorage(storageScope);
    const siteOps = { observation: liveBuildObservation("approved") };
    const first = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={siteOps}
        storageScope={storageScope}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("真实证据评估已完成并保存")).toBeTruthy();
      expect(listEvaluationReports(auditStorage)).toHaveLength(1);
    });
    expect(screen.getByLabelText(/当前加权评估分/).textContent).not.toContain("—");
    expect(screen.getAllByText("部分通过").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("评估摘要").textContent).toContain("完全通过率29%");
    const report = listEvaluationReports(auditStorage)[0]!;
    expect(screen.getByText(new RegExp(report.reportId))).toBeTruthy();

    first.unmount();
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={siteOps}
        storageScope={storageScope}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(new RegExp(report.reportId))).toBeTruthy(),
    );
    expect(listEvaluationReports(auditStorage).map(({ reportId }) => reportId))
      .toEqual([report.reportId]);
  });

  it("keeps a completed evaluation session-only when audit storage rejects the report", async () => {
    const storageScope = "live:7:website-evaluation-storage-failure";
    const auditStorage = scopedEvaluationStorage(storageScope);
    const setItem = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage quota exceeded");
    });

    try {
      render(
        <SimplifiedWebsiteBuilderPreview
          initialStep="evaluation"
          siteOps={{ observation: liveBuildObservation("approved") }}
          storageScope={storageScope}
        />,
      );

      await waitFor(() =>
        expect(screen.getByTestId("website-evaluation-status").textContent)
          .toContain("仅本次会话，未持久化"),
      );
      expect(screen.getByTestId("website-evaluation-report-id").textContent)
        .toContain("本次会话评估未持久化");
      expect(screen.getByTestId("website-evaluation-report-id").textContent)
        .not.toContain("website-report-");
      expect(screen.queryByText("真实证据评估已完成并保存")).toBeNull();
      expect(listEvaluationReports(auditStorage)).toEqual([]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("offers the established domain and release settings only after build approval", () => {
    const onOpenSiteOpsRelease = vi.fn();
    const onAction = vi.fn(async () => undefined);
    const page = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        onOpenSiteOpsRelease={onOpenSiteOpsRelease}
        siteOps={{
          observation: liveBuildObservation("awaiting_visual_selection"),
          onAction,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.queryByRole("button", { name: "打开域名与发布设置" })).toBeNull();

    page.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        onOpenSiteOpsRelease={onOpenSiteOpsRelease}
        siteOps={{
          observation: liveBuildObservation("approved"),
          onAction,
        }}
        storageScope="live:7:workspace-a"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开域名与发布设置" }));

    expect(onOpenSiteOpsRelease).toHaveBeenCalledTimes(1);
  });

  it("uses the authoritative live head after a task reset hides the old deployment row", async () => {
    const headId = "88888888-8888-4888-8888-888888888888";
    const approved = liveBuildObservation("approved");
    const onAction = vi.fn(async () => undefined);
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: {
            ...approved,
            project: {
              ...approved.project,
              globalLiveDeploymentId: headId,
            },
            deployments: [],
          },
          onAction,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入发布确认" }));
    fireEvent.click(screen.getByRole("button", { name: /继续发布|确认继续发布/ }));

    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        action: "publish_global",
        input: {
          buildId: "44444444-4444-4444-8444-444444444444",
          expectedHeadDeploymentId: headId,
        },
      }),
    );
  });

  it("requires a new confirmation when the approved build changes while the dialog is open", async () => {
    const onAction = vi.fn(async () => undefined);
    const first = liveBuildObservation("approved");
    const page = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{ observation: first, onAction }}
        storageScope="live:7:workspace-a"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入发布确认" }));
    const next = {
      ...first,
      project: { ...first.project, revision: first.project.revision + 1 },
      builds: [{
        ...first.builds[0]!,
        id: "77777777-7777-4777-8777-777777777777",
        ordinal: first.builds[0]!.ordinal + 1,
      }],
    } satisfies SiteOpsObservationV1;
    page.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{ observation: next, onAction }}
        storageScope="live:7:workspace-a"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /继续发布|确认继续发布/ }));

    await waitFor(() =>
      expect(screen.getByText(/真实发布条件已经变化/)).toBeTruthy(),
    );
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires active DNS, no pending deployment, and a not-yet-live current build", () => {
    const approved = liveBuildObservation("approved");
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: {
            ...approved,
            domainState: approved.domainState
              ? { ...approved.domainState, dnsStatus: "pending" }
              : null,
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );
    let release = screen.getByRole("button", { name: "等待域名 DNS 生效" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: {
            ...approved,
            deployments: [{
              id: "66666666-6666-4666-8666-666666666666",
              buildId: approved.builds[0]!.id,
              target: "global_excluding_cn",
              status: "deploying",
              publicUrl: null,
              createdAt: "2026-10-23T01:15:00.000Z",
            }],
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );
    release = screen.getByRole("button", { name: "海外站点发布中" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: {
            ...approved,
            project: {
              ...approved.project,
              globalLiveDeploymentId: "88888888-8888-4888-8888-888888888888",
            },
            deployments: [{
              id: "77777777-7777-4777-8777-777777777777",
              buildId: approved.builds[0]!.id,
              target: "global_excluding_cn",
              status: "active",
              publicUrl: "https://help.example.com",
              createdAt: "2026-10-23T01:15:00.000Z",
            }],
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );
    release = screen.getByRole("button", { name: "进入发布确认" }) as HTMLButtonElement;
    expect(release.disabled).toBe(false);
    expect(screen.queryByText("已公开 · https://help.example.com")).toBeNull();

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="evaluation"
        siteOps={{
          observation: {
            ...approved,
            project: {
              ...approved.project,
              globalLiveDeploymentId: "77777777-7777-4777-8777-777777777777",
            },
            deployments: [{
              id: "77777777-7777-4777-8777-777777777777",
              buildId: approved.builds[0]!.id,
              target: "global_excluding_cn",
              status: "active",
              publicUrl: "https://help.example.com",
              createdAt: "2026-10-23T01:15:00.000Z",
            }],
          },
          onAction: vi.fn(),
        }}
        storageScope="live:7:workspace-a"
      />,
    );
    release = screen.getByRole("button", { name: "当前构建已在线" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    expect(screen.getByText("已公开 · https://help.example.com")).toBeTruthy();
  });
});
