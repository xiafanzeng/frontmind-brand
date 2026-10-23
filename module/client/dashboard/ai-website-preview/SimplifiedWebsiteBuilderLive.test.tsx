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
    expect(screen.getByText("仅本地示意；当前 SiteOps 生成协议不支持此开关")).toBeTruthy();
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
    expect(screen.getByText(/尚无已保存的企业 RAG 评估快照/)).toBeTruthy();
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
  });
});
