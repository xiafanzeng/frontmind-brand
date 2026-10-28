import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import type {
  SiteDesignPreferencesSaveInput,
  SiteDesignRecommendationInput,
} from "../../../contracts/site-design-preferences";
import type { SiteOpsConversationPanelProps } from "./SiteOpsConversationPanel";

const mocks = vi.hoisted(() => ({
  recommendationInput: null as SiteDesignRecommendationInput | null,
  saveDesignPreferences: vi.fn(),
  openObservation: null as SiteOpsObservationV1 | null,
  actFast: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../../api-hooks", () => ({
  trpc: {
    workspace: {
      siteOps: {
        open: {
          useMutation: (options?: {
            onSuccess?: (observation: SiteOpsObservationV1) => void;
          }) => ({
            mutate: vi.fn(() => {
              if (mocks.openObservation) {
                options?.onSuccess?.(mocks.openObservation);
              }
            }),
            mutateAsync: vi.fn(async () => mocks.openObservation),
            isPending: false,
            error: null,
          }),
        },
        observe: {
          useQuery: () => ({
            data: undefined,
            error: null,
            isFetching: false,
            refetch: vi.fn(async () => ({ data: undefined })),
          }),
        },
        recommendDesign: {
          useQuery: (input: SiteDesignRecommendationInput) => {
            mocks.recommendationInput = input;
            return {
              data: undefined,
              error: null,
              isLoading: false,
              isFetching: false,
              refetch: vi.fn(async () => ({ data: undefined })),
            };
          },
        },
        saveDesignPreferences: {
          useMutation: () => ({
            mutateAsync: mocks.saveDesignPreferences,
            reset: vi.fn(),
            isPending: false,
            error: null,
          }),
        },
        actFast: {
          useMutation: () => ({
            mutateAsync: mocks.actFast,
            reset: vi.fn(),
            error: null,
          }),
        },
        sendMessage: {
          useMutation: () => ({
            mutateAsync: mocks.sendMessage,
            reset: vi.fn(),
            isPending: false,
            error: null,
          }),
        },
        aliyunConnection: {
          beginOAuth: {
            useMutation: () => ({ mutateAsync: vi.fn(), error: null }),
          },
          listDomains: {
            useQuery: () => ({
              data: { domains: [] },
              isLoading: false,
              error: null,
              refetch: vi.fn(),
            }),
          },
          disconnect: {
            useMutation: () => ({ mutateAsync: vi.fn(), error: null }),
          },
        },
      },
    },
  },
}));

import ConnectedSiteOpsConversationPanel from "./ConnectedSiteOpsConversationPanel";

const request: SiteDesignRecommendationInput = {
  schemaVersion: 1,
  requestContext: {
    requestId: "site-design-test-request",
    baseDesignRevision: 0,
    baseDraftHash: "0".repeat(64),
  },
  knowledgeSnapshot: {
    id: "22222222-2222-4222-8222-222222222222",
    version: 3,
    archiveHash: "a".repeat(64),
  },
  template: {
    id: "frontmind-help-center",
    version: "frontmind-curated-20261025-v6",
  },
};

const saveInput: SiteDesignPreferencesSaveInput = {
  conversationId: "siteops:test",
  expectedProjectRevision: 5,
  expectedDesignRevision: 0,
  draft: {
    schemaVersion: 1,
    siteName: "测试企业官网",
    siteGoal: "帮助客户了解产品与服务",
    featuredRouteIds: ["home"],
    siteAccent: "#6f35a5",
    assistant: {
      name: "测试企业助手",
      welcome: "您好，我会依据企业知识回答问题。",
      accentMode: "follow_site",
      customAccent: "#315b8a",
    },
    knowledgeSnapshot: request.knowledgeSnapshot,
    template: request.template,
  },
};

function controllerObservation(revision = 5): SiteOpsObservationV1 {
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
      conversationId: saveInput.conversationId,
      revision,
      status: "awaiting_visual_selection",
      currentKnowledgeSnapshotId: request.knowledgeSnapshot.id,
      primaryLanguage: "zh-CN",
      canonicalHostname: null,
      updatedAt: `2026-10-29T00:00:0${revision}.000Z`,
    },
    brief: {
      companyName: "测试企业",
      primaryLanguage: "zh-CN",
      contacts: [],
      offerings: ["企业服务"],
      audience: ["客户"],
      conversionGoal: "帮助客户了解产品与服务",
      contentInventory: {
        schemaVersion: 1,
        source: "frozen_knowledge_snapshot",
        entries: [],
      },
      routes: [{
        id: "home",
        slug: "/",
        title: "首页",
        sourceDocumentIds: ["source_home"],
      }],
      verifiedFacts: [],
      publicAssetIds: [],
      unknowns: [],
    },
    knowledgeSnapshots: [{
      id: request.knowledgeSnapshot.id,
      label: "知识库 ZIP · 第 3 版",
      sourceProfile: "dashboard-core-v1",
      createdAt: "2026-10-29T00:00:00.000Z",
      active: true,
      coordinate: request.knowledgeSnapshot,
    }],
    messages: [],
    visualCandidates: [{
      id: "33333333-3333-4333-8333-333333333333",
      label: "A",
      title: "真实帮助中心模板",
      previewUrl: "/api/frontmind/v2/siteops/templates/preview-a",
      note: "真实模板目录中的可执行候选",
      visualFamily: "editorial",
      selected: false,
      executionAdmitted: true,
      executionAdmissionMode: "provider_source",
      executionUnavailableReason: null,
      templateCoordinate: request.template,
    }],
    visualCandidatePages: [],
    visualGeneration: {
      status: "idle",
      targetPage: null,
      generatedPages: 4,
      availablePages: 4,
      reservedPages: 0,
      maxPages: 4,
      canGenerateMore: false,
      canSelectExisting: true,
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
    interactionState: "awaiting_visual_selection",
    latestSequence: revision,
  } as SiteOpsObservationV1;
}

describe("connected SiteOps design transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recommendationInput = null;
    mocks.openObservation = null;
  });

  it("binds recommendation queries and structured saves through the controller", async () => {
    mocks.saveDesignPreferences.mockRejectedValueOnce(
      new Error("save boundary reached"),
    );
    let props: SiteOpsConversationPanelProps | null = null;
    render(
      <ConnectedSiteOpsConversationPanel
        render={(value) => {
          props = value;
          return <div data-testid="connected-design-transport" />;
        }}
      />,
    );

    await act(async () => {
      props?.onRequestDesignRecommendation?.(request);
    });
    await waitFor(() =>
      expect(mocks.recommendationInput).toEqual(request),
    );
    expect(props?.designRecommendation?.request).toEqual(request);

    await expect(props?.onSaveDesignPreferences?.(saveInput)).rejects.toThrow(
      "save boundary reached",
    );
    expect(mocks.saveDesignPreferences).toHaveBeenCalledWith(saveInput);
  });

  it("uses the observation returned by save for the immediately following action and revision", async () => {
    const initial = controllerObservation(5);
    const saved: SiteOpsObservationV1 = {
      ...controllerObservation(6),
      brief: {
        ...controllerObservation(6).brief!,
        designPreferences: {
          ...saveInput.draft,
          designRevision: 1,
          draftHash: "d".repeat(64),
        },
      },
    };
    mocks.openObservation = initial;
    mocks.saveDesignPreferences.mockResolvedValueOnce(saved);
    mocks.actFast.mockImplementationOnce(async (input: {
      clientRequestId: string;
    }) => ({
      clientRequestId: input.clientRequestId,
      projectRevision: 7,
      latestSequence: 7,
    }));
    mocks.sendMessage.mockResolvedValueOnce(controllerObservation(7));
    let props: SiteOpsConversationPanelProps | null = null;
    render(
      <ConnectedSiteOpsConversationPanel
        render={(value) => {
          props = value;
          return <div data-testid="connected-design-occ" />;
        }}
      />,
    );
    await waitFor(() =>
      expect(props?.observation?.project.revision).toBe(5),
    );

    await act(async () => {
      await props?.onSaveDesignPreferences?.(saveInput);
    });
    expect(props?.observation?.project.revision).toBe(6);

    await act(async () => {
      await props?.onAction?.({ action: "approve_build", input: {} });
    });
    expect(mocks.actFast).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: saveInput.conversationId,
      expectedRevision: 6,
      action: "approve_build",
    }));

    await act(async () => {
      await props?.onSubmitRevision?.({
        text: "请按已保存的网站设计配置生成新版本。",
        files: [],
        onProgress: vi.fn(),
      });
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: saveInput.conversationId,
      expectedProjectRevision: 6,
    }));
  });
});
