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

function approvedBuildWithDesignPreferences(): SiteOpsObservationV1 {
  const approved = liveBuildObservation("approved");
  const preferences = {
    schemaVersion: 1 as const,
    siteName: "已构建的网站",
    siteGoal: "帮助客户找到答案",
    featuredRouteIds: ["help"],
    siteAccent: "#6f35a5",
    assistant: {
      name: "企业助手",
      welcome: "您好，我会依据企业知识回答问题。",
      accentMode: "follow_site" as const,
      customAccent: "#6f35a5",
    },
    knowledgeSnapshot: KNOWLEDGE_COORDINATE,
    template: TEMPLATE_COORDINATE,
    designRevision: 1,
    draftHash: "a".repeat(64),
  };
  return {
    ...approved,
    brief: { ...approved.brief!, designPreferences: preferences },
    builds: approved.builds.map((build) => ({ ...build, designPreferences: preferences })),
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
  // Mirrors the server recommender: every source-backed route is featured.
  const featuredRouteIds = candidates.map(([id]) => id);
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

function openDomainPublishConfirmation() {
  const evaluationEntry = screen.queryByRole("button", { name: "域名与发布" });
  if (evaluationEntry) fireEvent.click(evaluationEntry);
  const panel = screen.getByTestId("website-domain-publish");
  const summary = panel.querySelector("summary");
  if (summary && !summary.closest("details")?.open) fireEvent.click(summary);
  fireEvent.click(within(panel).getByTestId("website-publish-request"));
}

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

  it("lists only source-backed routes as toggleable columns", async () => {
    const current = recommendableObservation();
    const withSourcelessRoute: SiteOpsObservationV1 = {
      ...current,
      brief: {
        ...current.brief!,
        routes: [
          ...current.brief!.routes,
          {
            id: "news",
            slug: "/news",
            title: "企业动态",
            sourceDocumentIds: [],
          },
        ],
      },
    };
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: withSourcelessRoute, onAction: vi.fn() }}
        storageScope="live:7:sourceless-routes"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("共 4 个栏目，4 个启用")).toBeTruthy(),
    );
    // 无知识来源的占位路由不是可选栏目，否则保存会被契约拒绝。
    expect(screen.queryByLabelText("在网站中显示企业动态")).toBeNull();
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
    });
  });

  it("shows the real-build progress bar with stage and elapsed time while a build runs", () => {
    const running = liveBuildObservation("awaiting_visual_selection");
    const startedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    running.interactionState = "building";
    running.builds = [{
      id: "44444444-4444-4444-8444-444444444444",
      ordinal: 2,
      parentBuildId: null,
      status: "building",
      previewUrl: null,
      sourceUrl: null,
      buildDelivery: null,
      buildPhase: "compiling",
      needsHelp: false,
      createdAt: startedAt,
      updatedAt: startedAt,
    }];
    running.executionSteps = [{
      id: "step-build-2",
      operationKind: "build_revision",
      buildId: "44444444-4444-4444-8444-444444444444",
      stage: "content_building",
      label: "生成内容",
      status: "running",
      startedAt,
      completedAt: null,
    }];

    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: running, onAction: vi.fn() }}
        storageScope="live:7:build-progress"
      />,
    );

    const bar = screen.getByTestId("siteops-build-progress");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThan(100);
    // buildPhase 提供的阶段名优先于粗粒度执行步骤。
    expect(screen.getByText("编译与质检网站")).toBeTruthy();
    expect(screen.getByText(/已进行/)).toBeTruthy();
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

  it("requests source-backed recommendations and enables every column by default", async () => {
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

    // Before any recommendation arrives, a fresh session already selects every
    // real column; no three-column cap applies.
    await waitFor(() =>
      expect(
        ["首页", "产品与服务", "联系我们", "关于我们"].every(
          (name) =>
            (screen.getByLabelText(`在网站中显示${name}`) as HTMLInputElement)
              .checked,
        ),
      ).toBe(true),
    );
    expect(screen.getByText("共 4 个栏目，4 个启用")).toBeTruthy();

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
    expect(screen.getByText("共 4 个栏目，4 个启用")).toBeTruthy();
    expect(screen.getAllByText("首页真实内容").length).toBeGreaterThan(0);
    expect(
      ["首页", "产品与服务", "联系我们", "关于我们"].filter(
        (name) =>
          (screen.getByLabelText(`在网站中显示${name}`) as HTMLInputElement)
            .checked,
      ),
    ).toEqual(["首页", "产品与服务", "联系我们", "关于我们"]);

    // Columns toggle freely in both directions without a replacement notice.
    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(
      (screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement)
        .checked,
    ).toBe(false);
    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(
      (screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement)
        .checked,
    ).toBe(true);
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
    // 表单字段全部保持用户值或 brief 回退值；推荐响应只服务右侧草稿预览。
    expect((screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement).value)
      .toBe("帮助客户找到答案");
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
    // 表单保持 brief 回退值；过期推荐不会改写任何设计字段。
    expect((screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement).value)
      .toBe("帮助客户找到答案");
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
    expect(screen.queryByTestId("website-site-goal-recommend-flag")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "恢复推荐的网站名称" }));
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe("远山企业官网"),
    );
    expect(screen.queryByTestId("website-site-name-recommend-flag")).toBeNull();

    fireEvent.click(screen.getByLabelText("在网站中显示联系我们"));
    fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
    expect(screen.getByTestId("website-routes-recommend-flag").textContent)
      .toContain("主栏目已手动调整");
    fireEvent.click(screen.getByRole("button", { name: "恢复推荐的主栏目" }));
    // 恢复推荐即回到默认全选的推荐导航。
    await waitFor(() => {
      expect(
        (screen.getByLabelText("在网站中显示联系我们") as HTMLInputElement)
          .checked,
      ).toBe(true);
      expect(
        (screen.getByLabelText("在网站中显示关于我们") as HTMLInputElement)
          .checked,
      ).toBe(true);
    });
    expect(screen.queryByTestId("website-routes-recommend-flag")).toBeNull();
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

  it("keeps recommendations in the design fields without mounting an inline website preview", async () => {
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
    expect(screen.queryByTestId("website-design-preview")).toBeNull();
    expect((screen.getByRole("button", { name: "试用 AI 助手" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "查看网站" })).toBeNull();
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

    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
      .toBe("远山企业官网");
    expect(screen.queryByTestId("website-design-preview")).toBeNull();
    expect(screen.getByRole("region", { name: "建站管理" })).toBeTruthy();
    expect(screen.queryByLabelText("在网站助手中提问")).toBeNull();
    // Fixture demo copy must not leak into the live preview.
    expect(screen.queryByText("您好，需要了解什么？")).toBeNull();
    expect(screen.queryByText("企业知识帮助中心")).toBeNull();
  });

  it("shows recommendation loading without mounting a mock website or assistant", async () => {
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

    expect(screen.getByText(/正在按当前发布知识生成网站名称/)).toBeTruthy();
    expect(screen.queryByTestId("website-design-preview")).toBeNull();
    expect(screen.queryByText("您好，需要了解什么？")).toBeNull();
    expect(screen.queryByTestId("website-draft-block")).toBeNull();
  });

  it("opens assessment for a completed site without claiming an unperformed assistant trial", async () => {
    const current = approvedBuildWithDesignPreferences();
    const scope = "live:assessment-without-trial";
    const onAction = vi.fn(async () => undefined);
    const onSubmitRevision = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => current);
    const props = { observation: current, onAction, onSubmitRevision, onSaveDesignPreferences };
    const view = render(<SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={props} storageScope={scope} />);
    await waitFor(() => expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("已构建的网站"));
    expect(screen.getByText("助手试用未完成")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "进入建设评估" }));
    expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();
    const trialCheck = screen.getByText("助手真实试聊").closest("li")!;
    expect(trialCheck.textContent).toContain("待试用");
    expect(trialCheck.classList.contains("is-passed")).toBe(false);
    expect(screen.getByText(/配置完整性用于确认草稿，真实试聊单独记录/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认当前建设草稿" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      const draft = JSON.parse(window.localStorage.getItem(`${WEBSITE_DRAFT_STORAGE_KEY}.${encodeURIComponent(scope)}`) ?? "{}");
      expect(draft.design.assistant.tested).toBe(false);
      expect(draft.completedStepIds).toEqual(["template", "design"]);
      expect(draft.confirmed).toBe(true);
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(onSubmitRevision).not.toHaveBeenCalled();
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();

    view.unmount();
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" siteOps={props} storageScope={scope} />);
    await waitFor(() => expect(screen.getByText("助手真实试聊").closest("li")!.textContent).toContain("待试用"));
    fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /网站设计/ }));
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("已构建的网站");
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
  });

  it.each(["design", "revision"] as const)("keeps unsent %s changes when assessment is opened without rebuilding", async (change) => {
    const current = approvedBuildWithDesignPreferences();
    const onAction = vi.fn(async () => undefined);
    const onSubmitRevision = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => current);
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ observation: current, onAction, onSubmitRevision, onSaveDesignPreferences }} storageScope={`live:assessment-pending-${change}`} />);
    await waitFor(() => expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("已构建的网站"));
    const input = change === "design" ? screen.getByLabelText("网站名称") : screen.getByRole("textbox", { name: "补充修改要求" });
    fireEvent.change(input, { target: { value: "尚未提交的修改内容" } });
    expect(screen.getByRole("button", { name: "提交修改并重新生成" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看建设评估" }));
    expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();
    expect(screen.getByText("真实构建 #1")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(onSubmitRevision).not.toHaveBeenCalled();
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /网站设计/ }));
    expect((change === "design" ? screen.getByLabelText("网站名称") : screen.getByRole("textbox", { name: "补充修改要求" })) as HTMLInputElement).toHaveProperty("value", "尚未提交的修改内容");
  });

  it.each([false, true])("keeps in-flight assessment tied to the current build (older preview: %s)", async (hasOlderPreview) => {
    const previous = approvedBuildWithDesignPreferences();
    const building = {
      ...previous.builds[0]!,
      id: "55555555-5555-4555-8555-555555555555",
      ordinal: 2,
      parentBuildId: previous.builds[0]!.id,
      status: "building" as const,
      previewUrl: null,
      buildDelivery: null,
    };
    const current: SiteOpsObservationV1 = {
      ...previous,
      interactionState: "building",
      builds: [building, ...(hasOlderPreview ? previous.builds : [])],
    };
    const onAction = vi.fn(async () => undefined);
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ observation: current, onAction }} storageScope={`live:assessment-building-${hasOlderPreview}`} />);
    const submit = screen.getByRole("button", { name: "网站生成中…" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查看建设评估" }));
    expect(screen.getByText("真实构建 #2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认当前建设草稿" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("页面结构").closest("li")!.classList.contains("is-passed")).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not mark ungenerated configuration complete when its assessment is inspected", () => {
    const current = liveBuildObservation("awaiting_visual_selection");
    const onAction = vi.fn(async () => undefined);
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ observation: current, onAction }} storageScope="live:assessment-not-built" />);
    expect(screen.queryByRole("button", { name: "查看建设评估" })).toBeNull();
    fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /建设评估/ }));
    expect((screen.getByRole("button", { name: "确认当前建设草稿" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("页面结构").closest("li")!.classList.contains("is-passed")).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each([false, true])("opens the real assistant trial through the owner-only preview endpoint (project scope: %s)", async (scoped) => {
    const buildPath = "/api/site-ops/builds/44444444-4444-4444-8444-444444444444";
    const projectQuery = "enterpriseProjectId=77777777-7777-4777-8777-777777777777";
    const embedSearch = scoped ? `?token=abc.def&${projectQuery}` : "?token=abc.def";
    const previewPath = scoped ? `${buildPath}/preview` : "/api/frontmind/v2/siteops/builds/preview-1";
    const previewUrl = scoped ? `${previewPath}/?${projectQuery}` : previewPath;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        url: `${buildPath}/embed-preview/${embedSearch}`,
        bridgeToken: "bridge-token-1",
        expiresAt: Date.now() + 600_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    const current = recommendableObservation();
    const approved = liveBuildObservation("approved");
    const observationWithBuild: SiteOpsObservationV1 = {
      ...current,
      project: approved.project,
      builds: approved.builds.map((build) => ({
        ...build,
        previewUrl,
        sourceUrl: "/api/site-ops/builds/44444444-4444-4444-8444-444444444444/source.zip",
        knowledgeSnapshot: {
          id: KNOWLEDGE_COORDINATE.id,
          version: KNOWLEDGE_COORDINATE.version,
          archiveHash: KNOWLEDGE_COORDINATE.archiveHash,
        },
      })),
      interactionState: "approved",
    };
    try {
      render(
        <SimplifiedWebsiteBuilderPreview
          initialStep="design"
          siteOps={{ observation: observationWithBuild, onAction: vi.fn() }}
          storageScope="live:7:embed-preview"
        />,
      );

      expect(screen.queryByTitle("真实构建预览")).toBeNull();
      expect(screen.getByRole("link", { name: "查看网站" }).getAttribute("href"))
        .toBe(previewUrl);
      fireEvent.click(screen.getByRole("button", { name: "试用 AI 助手" }));
      await waitFor(() => {
        const frame = screen.getByTitle("真实构建预览") as HTMLIFrameElement;
        expect(frame.getAttribute("src")).toBe(`${buildPath}/embed-preview/${embedSearch}`);
      });
      const toolbar = screen.getByTestId("website-embed-preview-toolbar");
      expect(toolbar.textContent).toContain("真实构建 v1");
      expect(toolbar.textContent).toContain("知识快照 v3");
      expect(within(toolbar).getByRole("link", { name: "下载源码" }).getAttribute("href"))
        .toBe("/api/site-ops/builds/44444444-4444-4444-8444-444444444444/source.zip");
      // The real build replaces the draft; no fixture draft banner remains.
      expect(screen.queryByTestId("website-draft-preview-banner")).toBeNull();

      fireEvent.change(screen.getByLabelText("选择预览页面"), {
        target: {value: "/products"},
      });
      await waitFor(() => {
        const frame = screen.getByTitle("真实构建预览") as HTMLIFrameElement;
        expect(frame.getAttribute("src")).toBe(`${buildPath}/embed-preview/products/${embedSearch}`);
      });

      fireEvent.click(screen.getByRole("button", {name: /新窗口查看/}));
      expect(openMock).toHaveBeenCalledWith(
        `${previewPath}/products/${scoped ? `?${projectQuery}` : ""}`,
        "_blank",
        "noopener",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the last website available but rejects trial credit while edits are pending", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        url: "/api/site-ops/builds/44444444-4444-4444-8444-444444444444/embed-preview/?token=abc.def",
        bridgeToken: "bridge-token-1",
        expiresAt: Date.now() + 600_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const current = recommendableObservation();
    const approved = liveBuildObservation("approved");
    const observationWithBuild: SiteOpsObservationV1 = {
      ...current,
      project: approved.project,
      builds: approved.builds,
      interactionState: "approved",
    };
    try {
      render(
        <SimplifiedWebsiteBuilderPreview
          initialStep="design"
          siteOps={{ observation: observationWithBuild, onAction: vi.fn() }}
          storageScope="live:7:embed-while-editing"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "试用 AI 助手" }));
      await waitFor(() =>
        expect((screen.getByTitle("真实构建预览") as HTMLIFrameElement).src)
          .toContain("embed-preview/?token="),
      );

      // Pending edits retain access to the last real build, but cannot earn
      // trial credit for a design that has not been submitted.
      fireEvent.click(screen.getByLabelText("在网站中显示关于我们"));
      await waitFor(() => {
        expect(screen.getByText(/当前设计生成后再记录结果/)).toBeTruthy();
      });
      expect((screen.getByTitle("真实构建预览") as HTMLIFrameElement).src)
        .toContain("embed-preview/?token=");
      expect(screen.queryByTestId("website-draft-preview-banner")).toBeNull();

      // A trial report against that not-yet-submitted design never counts.
      const frame = screen.getByTitle("真实构建预览") as HTMLIFrameElement;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            schemaVersion: 1,
            kind: "frontmind_site_assistant_answer_rendered",
            token: "bridge-token-1",
          },
          origin: "null",
          source: frame.contentWindow,
        }),
      );
      expect(screen.getByText("助手试用未完成")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates bridge trials and allows another trial after revision instructions are cleared", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        url: "/api/site-ops/builds/44444444-4444-4444-8444-444444444444/embed-preview/?token=abc.def",
        bridgeToken: "bridge-token-1",
        expiresAt: Date.now() + 600_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());
    const current = recommendableObservation();
    const approved = liveBuildObservation("approved");
    const frozenPreferences = {
      schemaVersion: 1 as const,
      siteName: "远山帮助中心",
      siteGoal: "帮助客户自助排障",
      featuredRouteIds: ["home", "products", "contact"],
      siteAccent: "#6f35a5",
      assistant: {
        name: "远山助手",
        welcome: "您好，这里是真实帮助中心。",
        accentMode: "follow_site" as const,
        customAccent: "#6f35a5",
      },
      knowledgeSnapshot: KNOWLEDGE_COORDINATE,
      template: TEMPLATE_COORDINATE,
      designRevision: 4,
      draftHash: "d".repeat(64),
    };
    const observationWithBuild: SiteOpsObservationV1 = {
      ...current,
      project: approved.project,
      brief: {...current.brief!, designPreferences: frozenPreferences},
      builds: approved.builds.map((build) => ({
        ...build,
        designPreferences: frozenPreferences,
        knowledgeSnapshot: {
          id: KNOWLEDGE_COORDINATE.id,
          version: KNOWLEDGE_COORDINATE.version,
          archiveHash: KNOWLEDGE_COORDINATE.archiveHash,
        },
      })),
      interactionState: "approved",
    };
    const onAction = vi.fn(async () => undefined);
    const onSubmitRevision = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => observationWithBuild);
    try {
      const view = render(
        <SimplifiedWebsiteBuilderPreview
          initialStep="design"
          siteOps={{ observation: observationWithBuild, onAction, onSubmitRevision, onSaveDesignPreferences }}
          storageScope="live:7:bridge-trial"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "试用 AI 助手" }));
      await waitFor(() =>
        expect((screen.getByTitle("真实构建预览") as HTMLIFrameElement).src)
          .toContain("embed-preview/?token="),
      );
      // The trial binding echoes the frozen assistant identity, so wait until
      // the form has hydrated it before dispatching bridge reports; slower
      // environments hydrate after the token iframe resolves.
      await waitFor(() =>
        expect((screen.getByLabelText("助手名称") as HTMLInputElement).value)
          .toBe("远山助手"),
      );
      expect(screen.getByText("助手试用未完成")).toBeTruthy();

      const report = (overrides: Record<string, unknown>) => ({
        schemaVersion: 1,
        kind: "frontmind_site_assistant_answer_rendered",
        token: "bridge-token-1",
        buildId: "44444444-4444-4444-8444-444444444444",
        knowledgeSnapshotId: KNOWLEDGE_COORDINATE.id,
        knowledgeArchiveHash: KNOWLEDGE_COORDINATE.archiveHash,
        designRevision: 4,
        draftHash: "d".repeat(64),
        assistantName: "远山助手",
        welcome: "您好，这里是真实帮助中心。",
        ...overrides,
      });
      const frame = screen.getByTitle("真实构建预览") as HTMLIFrameElement;
      const dispatch = (payload: unknown) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: payload,
            origin: "null",
            source: frame.contentWindow,
          }),
        );
      };

      // A forged token or stale assistant identity never completes the trial.
      dispatch(report({token: "forged"}));
      dispatch(report({welcome: "旧的欢迎语"}));
      expect(screen.getByText("助手试用未完成")).toBeTruthy();

      // A message from a foreign window is ignored even with a valid token.
      window.dispatchEvent(
        new MessageEvent("message", {
          data: report({}),
          origin: "null",
          source: window,
        }),
      );
      expect(screen.getByText("助手试用未完成")).toBeTruthy();

      // The genuine report from THIS iframe completes the real trial.
      dispatch(report({}));
      await waitFor(() =>
        expect(screen.getByText("助手试用已完成")).toBeTruthy(),
      );

      // Editing revision requirements suspends credit for this build. Clearing
      // them restores the same iframe binding, which must accept a new trial.
      const revisionInstructions = screen.getByRole("textbox", { name: "补充修改要求" });
      fireEvent.change(revisionInstructions, { target: { value: "请修改首页标题" } });
      expect(screen.getByText("助手试用未完成")).toBeTruthy();
      dispatch(report({}));
      expect(screen.getByText("助手试用未完成")).toBeTruthy();
      fireEvent.change(revisionInstructions, { target: { value: "" } });
      expect(screen.getByText("助手试用未完成")).toBeTruthy();
      expect(screen.getByTitle("真实构建预览")).toBe(frame);
      dispatch(report({}));
      await waitFor(() =>
        expect(screen.getByText("助手试用已完成")).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: "关闭助手试用" }));
      fireEvent.click(screen.getByRole("button", { name: "进入建设评估" }));
      expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
      expect(onSubmitRevision).not.toHaveBeenCalled();
      expect(onSaveDesignPreferences).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /网站设计/ }));

      // An unsent site title changes configuration completeness, while the
      // genuine trial of the frozen site's unchanged assistant remains true.
      fireEvent.change(screen.getByLabelText("网站名称"), {
        target: { value: "尚未提交的网站标题" },
      });
      expect(screen.getByText("助手试用已完成")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "查看建设评估" }));
      const trialCheck = screen.getByText("助手真实试聊").closest("li")!;
      expect(trialCheck.classList.contains("is-passed")).toBe(true);
      expect(trialCheck.textContent).toContain("助手配置有效且已完成一次真实问答");
      expect(trialCheck.textContent).toContain("已确认");
      expect(onAction).not.toHaveBeenCalled();
      expect(onSubmitRevision).not.toHaveBeenCalled();
      expect(onSaveDesignPreferences).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /网站设计/ }));

      // Renaming the assistant invalidates the completed trial again.
      fireEvent.change(screen.getByLabelText("助手名称"), {
        target: {value: "新名字助手"},
      });
      await waitFor(() =>
        expect(screen.getByText("助手试用未完成")).toBeTruthy(),
      );
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps saved design preferences when a recommendation arrives", async () => {
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
    expect(screen.queryByTestId("website-design-preview")).toBeNull();
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
    // 帮助中心默认已加入导航，无需再手动勾选。
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }));
    expect(screen.queryByLabelText("站点语言")).toBeNull();

    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "远山智能助手" },
    });
    fireEvent.change(screen.getByLabelText("欢迎语"), {
      target: { value: "您好，我会依据企业知识为您解答。" },
    });
    expect(screen.queryByTestId("website-design-preview")).toBeNull();
    expect(screen.queryByLabelText(/展示回答来源/)).toBeNull();
    // 首次构建不被试用门禁拦截：真实试聊在构建完成后显式打开。
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
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

  it("rebuilds an approved website from the synced draft without revision requirements", async () => {
    const approved = approvedBuildWithDesignPreferences();
    const onAction = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => approved);
    const onSubmitRevision = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => undefined);
    const onStepChange = vi.fn();
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: approved, onAction, onSaveDesignPreferences, onSubmitRevision }}
        onStepChange={onStepChange}
        storageScope="live:7:rebuild-without-requirements"
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("已构建的网站"),
    );
    expect(screen.getByRole("button", { name: "进入建设评估" })).toBeTruthy();
    const rebuild = screen.getByTestId("website-rebuild-submit") as HTMLButtonElement;
    expect(rebuild.disabled).toBe(false);
    fireEvent.click(rebuild);
    await waitFor(() => expect(onSaveDesignPreferences).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    const revision = onSubmitRevision.mock.calls[0]?.[0];
    expect(revision?.text).toBe(buildLiveSiteOpsRevisionMessage());
    expect(revision?.files).toEqual([]);
    expect(onAction).not.toHaveBeenCalled();
    expect(onStepChange).not.toHaveBeenCalledWith("evaluation");
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
    // 帮助中心默认已加入导航；改版提交无需再改动栏目。
    const assistantName = screen.getByTestId("website-assistant-name") as HTMLInputElement;
    const welcome = screen.getByTestId("website-assistant-welcome") as HTMLTextAreaElement;
    expect(assistantName.disabled).toBe(false);
    expect(welcome.disabled).toBe(false);
    fireEvent.change(assistantName, { target: { value: "远山改版助手" } });
    fireEvent.change(welcome, { target: { value: "您好，这里是改版后的真实帮助中心。" } });
    // 修改名称与欢迎语会清除试用状态；真实试聊在新版本构建完成后进行。
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
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

  it.each(["newer-edit", "revision-failure"] as const)(
    "keeps an approved preview dirty after saving preferences without an accepted revision (%s)",
    async (failureMode) => {
      const approved = approvedBuildWithDesignPreferences();
      const saveRequest = deferred<SiteOpsObservationV1>();
      const onSaveDesignPreferences = vi.fn((
        _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSaveDesignPreferences"]>>[0],
      ) => saveRequest.promise);
      const onSubmitRevision = vi.fn(async () => {
        if (failureMode === "revision-failure") throw new Error("改版服务暂时不可用");
      });
      const onAction = vi.fn(async () => undefined);
      const onStepChange = vi.fn();
      const scope = `live:7:saved-without-revision-${failureMode}`;
      const siteOps = { observation: approved, onAction, onSaveDesignPreferences, onSubmitRevision };
      const view = render(
        <SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={siteOps} onStepChange={onStepChange} storageScope={scope} />,
      );
      await waitFor(() => expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("已构建的网站"));
      expect((screen.getByTestId("website-publish-request") as HTMLButtonElement).disabled).toBe(false);
      fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "保存中的设计 A" } });
      fireEvent.click(screen.getByTestId("website-revision-submit"));
      await waitFor(() => expect(onSaveDesignPreferences).toHaveBeenCalledTimes(1));
      if (failureMode === "newer-edit") {
        fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "保存期间的新设计 B" } });
      }
      const submitted = onSaveDesignPreferences.mock.calls[0]![0];
      const saved: SiteOpsObservationV1 = {
        ...approved,
        project: { ...approved.project, revision: approved.project.revision + 1 },
        brief: {
          ...approved.brief!,
          designPreferences: { ...submitted.draft, designRevision: 2, draftHash: "b".repeat(64) },
        },
      };
      // Saving updates project preferences while the preview still belongs to
      // the older approved build. That echo must not mark the preview synced.
      view.rerender(
        <SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ ...siteOps, observation: saved }} onStepChange={onStepChange} storageScope={scope} />,
      );
      saveRequest.resolve(saved);
      await waitFor(() => expect(screen.getByText(
        failureMode === "newer-edit" ? /保存期间网站设计已更新/ : "改版服务暂时不可用",
      )).toBeTruthy());
      expect((screen.getByLabelText("网站名称") as HTMLInputElement).value)
        .toBe(failureMode === "newer-edit" ? "保存期间的新设计 B" : "保存中的设计 A");
      expect(screen.getByRole("link", { name: "查看网站" }).getAttribute("href")).toBe(approved.builds[0]!.previewUrl);
      expect(screen.getByTestId("website-revision-submit").textContent).toBe("提交修改并重新生成");
      expect((screen.getByTestId("website-publish-request") as HTMLButtonElement).disabled).toBe(true);
      expect(onSubmitRevision).toHaveBeenCalledTimes(failureMode === "newer-edit" ? 0 : 1);
      expect(onAction).not.toHaveBeenCalled();
      expect(onStepChange).not.toHaveBeenCalledWith("evaluation");
      if (failureMode === "revision-failure") {
        view.unmount();
        render(
          <SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ ...siteOps, observation: saved }} storageScope={scope} />,
        );
        await waitFor(() => expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("保存中的设计 A"));
        expect(screen.getByRole("link", { name: "查看网站" }).getAttribute("href")).toBe(approved.builds[0]!.previewUrl);
        expect((screen.getByTestId("website-publish-request") as HTMLButtonElement).disabled).toBe(true);
      }
    },
  );

  it("clears local revision requirements only after the reset is accepted", async () => {
    const approved = approvedBuildWithDesignPreferences();
    const resetRequest = deferred<void>();
    const onAction = vi.fn()
      .mockRejectedValueOnce(new Error("重置服务暂时不可用"))
      .mockImplementationOnce(() => resetRequest.promise);
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: { ...approved, rebuildRequest: { ...approved.rebuildRequest, allowed: true } }, onAction }}
        storageScope="live:7:reset-revision-fields"
      />,
    );
    const instructions = screen.getByRole("textbox", { name: "补充修改要求" }) as HTMLTextAreaElement;
    fireEvent.change(instructions, { target: { value: "重置前的修改要求" } });
    const image = new File(["reference"], "reset-reference.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("添加修改参考图片"), { target: { files: [image] } });
    const references = screen.getByRole("list", { name: "修改参考图片" });
    fireEvent.click(screen.getByText("更多"));
    fireEvent.click(screen.getByRole("button", { name: "重新开始制作" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重新开始" }));
    await waitFor(() => expect(screen.getByText("重置服务暂时不可用")).toBeTruthy());
    expect(instructions.value).toBe("重置前的修改要求");
    expect(references.textContent).toContain("reset-reference.png");
    fireEvent.click(screen.getByRole("button", { name: "确认重新开始" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(instructions.value).toBe("重置前的修改要求");
    resetRequest.resolve(undefined);
      await waitFor(() => expect(screen.getByRole("heading", { name: "选择一个模板版式" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /网站设计/u }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "补充修改要求" }) as HTMLTextAreaElement).value).toBe(""));
    expect(screen.queryByRole("list", { name: "修改参考图片" })).toBeNull();
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
    expect(onAction).toHaveBeenLastCalledWith({ action: "request_rebuild", input: {} });
  });

  it("submits freeform instructions and images from the unified design action", async () => {
    const approved = liveBuildObservation("approved");
    const onAction = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => approved);
    const onSubmitRevision = vi.fn(async (
      input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => { input.onProgress(0, 100); });
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{ observation: approved, onAction, onSaveDesignPreferences, onSubmitRevision }}
        storageScope="live:7:freeform-revision"
      />,
    );

    const image = new File(["reference-image"], "header-reference.png", { type: "image/png" });
    const instructions = "请把首页头图替换为附件，并缩小导航高度。".padEnd(20_000, "参");
    fireEvent.change(screen.getByRole("textbox", { name: "补充修改要求" }), {
      target: { value: instructions },
    });
    fireEvent.change(screen.getByLabelText("添加修改参考图片"), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByTestId("website-revision-submit"));

    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    expect(onSubmitRevision.mock.calls[0]![0]).toMatchObject({
      text: instructions,
      files: [image],
    });
    expect(onAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "补充修改要求" }) as HTMLTextAreaElement).value).toBe(""),
    );
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
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
    // 只有存在未保存的编辑时才会提交改版；真实试聊门禁在生成前不再拦截。
    fireEvent.change(screen.getByLabelText("网站名称"), {
      target: { value: "改版提交前的名称调整" },
    });
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

    // Columns start fully selected; the gate only engages once the owner
    // explicitly turns every column off.
    await waitFor(() =>
      expect((screen.getByLabelText("在网站中显示帮助中心") as HTMLInputElement).checked)
        .toBe(true),
    );
    fireEvent.click(screen.getByLabelText("在网站中显示帮助中心"));
    expect((screen.getByLabelText("在网站中显示帮助中心") as HTMLInputElement).checked)
      .toBe(false);

    // 本地草稿不再提供示意问答：真实试聊只能在真实构建预览中完成。
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
    expect(screen.queryByLabelText("在网站助手中提问")).toBeNull();
    expect((screen.getByTestId("website-build-start") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(onSubmitRevision).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();
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

    expect(screen.getByText("网站已通过构建检查")).toBeTruthy();
    expect(screen.getByText(/真实 SiteOps · 项目版本/)).toBeTruthy();
    expect(screen.queryByTestId("siteops-build-status")).toBeNull();

    openDomainPublishConfirmation();
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

  it("offers domain preparation before the first build and keeps evaluation linked to the same design section", () => {
    const onAction = vi.fn(async () => undefined);
    const page = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: liveBuildObservation("awaiting_visual_selection"),
          onAction,
        }}
        storageScope="live:7:workspace-a"
      />,
    );

    expect(screen.queryByRole("button", { name: "打开域名与发布设置" })).toBeNull();
    expect(screen.getByTestId("website-domain-publish")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返回三步建站" })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();

    page.unmount();
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
    fireEvent.click(screen.getByRole("button", { name: "域名与发布" }));

    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect(screen.getByTestId("website-domain-publish")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "发布确认" })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
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

    openDomainPublishConfirmation();
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

    openDomainPublishConfirmation();
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

  it("freezes the mainland target and its authoritative deployment head for confirmation", async () => {
    const approved = liveBuildObservation("approved");
    const mainlandHead = "88888888-8888-4888-8888-888888888888";
    const globalHead = "99999999-9999-4999-8999-999999999999";
    const onAction = vi.fn(async () => undefined);
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: {
            ...approved,
            project: { ...approved.project, globalLiveDeploymentId: globalHead, mainlandLiveDeploymentId: mainlandHead },
            domainState: { ...approved.domainState!, icpStatus: "approved", icpDomainRevision: 1 },
          },
          onAction,
        }}
        storageScope="live:7:mainland-confirmation"
      />,
    );

    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "mainland_cn" } });
    openDomainPublishConfirmation();
    expect(screen.getByRole("dialog", { name: "发布确认" }).textContent).toContain("中国大陆站点");
    // The confirmation owns its target even if another render changes the form selection.
    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "global_excluding_cn" } });
    fireEvent.click(screen.getByRole("button", { name: /继续发布|确认继续发布/ }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
      action: "publish_mainland",
      input: { buildId: approved.builds[0]!.id, expectedHeadDeploymentId: mainlandHead },
    }));
  });

  it("rejects a mainland confirmation when its live head changes and does not record success", async () => {
    const approved = liveBuildObservation("approved");
    const scope = "live:7:mainland-stale-head";
    const current: SiteOpsObservationV1 = {
      ...approved,
      project: { ...approved.project, mainlandLiveDeploymentId: "88888888-8888-4888-8888-888888888888" },
      domainState: { ...approved.domainState!, icpStatus: "approved", icpDomainRevision: 1 },
    };
    const onAction = vi.fn(async () => undefined);
    const view = render(
      <SimplifiedWebsiteBuilderPreview initialStep="design" siteOps={{ observation: current, onAction }} storageScope={scope} />,
    );
    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "mainland_cn" } });
    openDomainPublishConfirmation();
    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: { ...current, project: { ...current.project, mainlandLiveDeploymentId: "99999999-9999-4999-8999-999999999999" } },
          onAction,
        }}
        storageScope={scope}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /继续发布|确认继续发布/ }));

    await waitFor(() => expect(screen.getByText(/真实发布条件已经变化/)).toBeTruthy());
    expect(onAction).not.toHaveBeenCalled();
    expect(listPublishDecisions(scopedEvaluationStorage(scope))).toEqual([]);
  });

  it("keeps release selection separate from the saved design and requires ICP for the current domain version", async () => {
    const approved = liveBuildObservation("approved");
    const scope = "live:7:release-is-not-design";
    const draftKey = `${WEBSITE_DRAFT_STORAGE_KEY}.${encodeURIComponent(scope)}`;
    const onAction = vi.fn(async () => undefined);
    const onSaveDesignPreferences = vi.fn(async () => approved);
    const onSubmitRevision = vi.fn(async () => undefined);
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
        siteOps={{
          observation: { ...approved, domainState: { ...approved.domainState!, revision: 2, icpStatus: "approved", icpDomainRevision: 1 } },
          onAction,
          onSaveDesignPreferences,
          onSubmitRevision,
        }}
        storageScope={scope}
      />,
    );
    await waitFor(() => expect(window.localStorage.getItem(draftKey)).toBeTruthy());
    const savedDraft = window.localStorage.getItem(draftKey);
    const release = screen.getByTestId("website-publish-request") as HTMLButtonElement;
    expect(release.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "mainland_cn" } });
    expect(release.disabled).toBe(true);
    expect(screen.getByTestId("website-domain-publish").textContent).toContain("当前域名版本");
    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "global_excluding_cn" } });
    expect(release.disabled).toBe(false);
    expect(window.localStorage.getItem(draftKey)).toBe(savedDraft);
    expect(screen.queryByText("真实构建预览 · 有未提交修改")).toBeNull();
    expect(onSaveDesignPreferences).not.toHaveBeenCalled();
    expect(onSubmitRevision).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("requires active DNS, no pending deployment, and a not-yet-live current build", () => {
    const approved = liveBuildObservation("approved");
    const view = render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
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
    let release = screen.getByTestId("website-publish-request") as HTMLButtonElement;
    expect(release.disabled).toBe(true);

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
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
    release = screen.getByTestId("website-publish-request") as HTMLButtonElement;
    expect(release.disabled).toBe(true);

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
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
    release = screen.getByTestId("website-publish-request") as HTMLButtonElement;
    expect(release.disabled).toBe(false);
    expect(screen.getByTestId("website-domain-publish").querySelector('a[href="https://help.example.com"]')).toBeNull();

    view.rerender(
      <SimplifiedWebsiteBuilderPreview
        initialStep="design"
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
    release = screen.getByTestId("website-publish-request") as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    expect(screen.getByTestId("website-domain-publish").querySelector('a[href="https://help.example.com"]')).toBeTruthy();
  });
});
