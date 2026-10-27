import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import { siteOpsRevisionAttempt } from "../siteops/ConnectedSiteOpsConversationPanel";
import {
  buildLiveSiteOpsConfigurationMessage,
  SimplifiedWebsiteBuilderPreview,
  WEBSITE_DRAFT_STORAGE_KEY,
} from "./SimplifiedWebsiteBuilderPreview";
import {
  listEvaluationReports,
  listPublishDecisions,
  saveEvaluationReport,
} from "./evaluation-report-store";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";

function observation(
  interactionState: "select_snapshot" | "collecting_brief",
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

  it("keeps every supported generation preference within the server brief limit", () => {
    const message = buildLiveSiteOpsConfigurationMessage({
      siteName: "站".repeat(80),
      siteLanguage: "zh-CN",
      siteGoal: "目".repeat(260),
      siteAccent: "#315b8a",
      assistantName: "助".repeat(80),
      welcome: "欢".repeat(240),
      assistantAccent: "#6f35a5",
    });
    const goal = message.split("建站目标: ")[1] ?? "";

    expect(goal.length).toBeLessThanOrEqual(500);
    expect(goal).toContain("AI 助手名称");
    expect(goal).toContain("AI 助手欢迎语");
    expect(goal).toContain("AI 助手主题色 #6f35a5");
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

  it("identifies a preview fallback without presenting it as the original repository build", () => {
    const approved = liveBuildObservation("approved");
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="structure"
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
    expect(screen.getByText(/基于冻结预览图重建；并非原仓实际构建/)).toBeTruthy();
    expect(screen.queryByText(/已准入模板的实际构建/)).toBeNull();
    expect(screen.getByTitle("真实帮助中心模板 安全视觉参考预览")).toBeTruthy();
  });

  it("saves the real brief configuration before selecting the admitted template", async () => {
    const events: string[] = [];
    const onAction = vi.fn(async () => { events.push("select"); });
    const onSubmitRevision = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => { events.push("submit"); });
    render(
      <SimplifiedWebsiteBuilderPreview
        siteOps={{
          observation: liveBuildObservation("awaiting_visual_selection"),
          onAction,
          onSubmitRevision,
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
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }));
    expect(screen.getByText("仅本地示意，不进入真实生成协议")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "远山智能助手" },
    });
    fireEvent.change(screen.getByLabelText("欢迎语"), {
      target: { value: "您好，我会依据企业知识为您解答。" },
    });
    expect(screen.getByText("真实网站的助手回答始终展示知识来源；此开关仅影响本地示意预览")).toBeTruthy();
    fireEvent.click(screen.getByTestId("website-build-start"));

    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    const revision = onSubmitRevision.mock.calls[0]?.[0];
    expect(revision?.files).toEqual([]);
    expect(revision?.text).toContain("网站名称: 远山客户帮助中心");
    expect(revision?.text).toContain("站点语言: zh-CN");
    expect(revision?.text).toContain("建站目标: 帮助客户自助解决产品问题");
    expect(revision?.text).toContain("网站主题色 #315b8a");
    expect(revision?.text).toContain("AI 助手名称 远山智能助手");
    expect(revision?.text).toContain("AI 助手欢迎语 您好，我会依据企业知识为您解答。");
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
        action: "select_visual",
        input: { sampleId: "33333333-3333-4333-8333-333333333333" },
      }));
    expect(events).toEqual(["submit", "select"]);
  });

  it("submits an existing real build revision without selecting or publishing again", async () => {
    const onAction = vi.fn(async () => undefined);
    const onSubmitRevision = vi.fn(async (
      _input: Parameters<NonNullable<SiteOpsConversationPanelProps["onSubmitRevision"]>>[0],
    ) => undefined);
    render(
      <SimplifiedWebsiteBuilderPreview
        initialStep="structure"
        siteOps={{
          observation: liveBuildObservation("approved"),
          onAction,
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
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    const assistantName = screen.getByTestId("website-assistant-name") as HTMLInputElement;
    const welcome = screen.getByTestId("website-assistant-welcome") as HTMLTextAreaElement;
    expect(assistantName.disabled).toBe(false);
    expect(welcome.disabled).toBe(false);
    fireEvent.change(assistantName, { target: { value: "远山改版助手" } });
    fireEvent.change(welcome, { target: { value: "您好，这里是改版后的真实帮助中心。" } });
    fireEvent.click(screen.getByTestId("website-revision-submit"));

    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    const revision = onSubmitRevision.mock.calls[0]?.[0];
    expect(revision?.text).toContain("网站名称: 远山帮助中心改版");
    expect(revision?.text).toContain("建站目标: 让客户更快完成真实自助排障");
    expect(revision?.text).toContain("AI 助手名称 远山改版助手");
    expect(revision?.text).toContain("AI 助手欢迎语 您好，这里是改版后的真实帮助中心。");
    expect(onAction).not.toHaveBeenCalled();
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
        initialStep="structure"
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
