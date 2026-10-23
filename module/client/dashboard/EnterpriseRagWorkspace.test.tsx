import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const knowledgeBase = (prefix: string, version: number) => ({
    snapshotId: `${prefix}-snapshot`,
    version,
    sourceFileName: `${prefix}.zip`,
    documentCount: version,
  });
  return {
    active: null as Record<string, unknown> | null,
    currentSource: {
      loaded: true,
      failed: false,
      failureCode: undefined as string | undefined,
      refreshFailed: undefined as boolean | undefined,
      configured: true as boolean | null,
      provider: "xty_codex" as string | null,
      knowledgeBase: knowledgeBase("current", 9) as ReturnType<typeof knowledgeBase> | null,
    },
    taskSource: {
      loaded: true,
      failed: false,
      failureCode: undefined as string | undefined,
      refreshFailed: undefined as boolean | undefined,
      configured: true as boolean | null,
      provider: "xty_codex" as string | null,
      knowledgeBase: knowledgeBase("frozen", 4) as ReturnType<typeof knowledgeBase> | null,
    },
    responseKnowledgeBase: null as ReturnType<typeof knowledgeBase> | null,
    sourceCalls: [] as Array<[string | null | undefined, boolean | undefined]>,
    send: vi.fn(async () => true),
    stop: vi.fn(async () => true),
    retryPending: vi.fn(async () => true),
    retryCurrent: vi.fn(),
    retryTask: vi.fn(),
    createConversation: vi.fn(),
    received: null as null | Record<string, unknown>,
    workbenchProps: null as null | Record<string, unknown>,
  };
});

function activeConversation() {
  return {
    id: "conversation-1",
    purpose: "enterprise_qa",
    status: "completed",
    taskId: "task-frozen",
    previousResponseId: "task-frozen",
    messages: [
      { id: "question-1", role: "user", content: "真实问题" },
      {
        id: "answer-1",
        role: "assistant",
        content: "真实回答",
        enterpriseQaAnswer: {
          sources: [
            {
              id: "source-1",
              title: "任务实际引用资料",
              kind: "published_knowledge",
            },
          ],
        },
      },
    ],
  };
}

vi.mock("../lib/final-reply", () => ({
  finalReplyIds: () => new Set(["answer-1"]),
}));

vi.mock("../host", () => ({
  ConversationPurposeProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  brandHost: () => ({ requestWorkspaceNavigation: vi.fn() }),
  projectWorkspaceUrl: (path: string) => path,
  useConversation: () => ({
    hydrated: true,
    activeConversation: mocks.active,
    createConversation: mocks.createConversation,
    syncError: "",
    workbenchScopeKey: "brand:workspace-1:enterprise_qa",
  }),
}));

vi.mock("../use-enterprise-qa-controller", () => ({
  useEnterpriseQaController: () => ({
    active: mocks.active,
    busy: false,
    running: false,
    notice: "",
    pendingDispatch: null,
    responseKnowledgeBase: mocks.responseKnowledgeBase,
    retryPending: mocks.retryPending,
    send: mocks.send,
    stop: mocks.stop,
  }),
}));

vi.mock("./EnterpriseQaWorkspace", () => ({
  EnterpriseQaSourceNote: () => <div data-testid="source-note" />,
  enterpriseQaProviderLabel: (provider: string | null) =>
    provider === "xty_codex" ? "XTY Codex" : provider || "未配置",
  useEnterpriseQaKnowledgeSource: (
    taskId?: string | null,
    enabled?: boolean,
  ) => {
    mocks.sourceCalls.push([taskId, enabled]);
    return taskId
      ? { source: mocks.taskSource, retry: mocks.retryTask }
      : { source: mocks.currentSource, retry: mocks.retryCurrent };
  },
}));

vi.mock("./ProjectAgentWorkbench", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.workbenchProps = props;
    return <div data-testid="project-workbench">{props.main as ReactNode}{props.children as ReactNode}</div>;
  },
}));

vi.mock("./ai-website-preview/EnterpriseRagPreview", () => ({
  EnterpriseRagPreview: (props: Record<string, unknown>) => {
    mocks.received = props;
    return <div data-testid="designed-enterprise-rag" />;
  },
}));

import EnterpriseRagWorkspace from "./EnterpriseRagWorkspace";

beforeEach(() => {
  mocks.active = activeConversation();
  mocks.currentSource = {
    loaded: true,
    failed: false,
    failureCode: undefined,
    refreshFailed: undefined,
    configured: true,
    provider: "xty_codex",
    knowledgeBase: {
      snapshotId: "current-snapshot",
      version: 9,
      sourceFileName: "current.zip",
      documentCount: 9,
    },
  };
  mocks.taskSource = {
    loaded: true,
    failed: false,
    failureCode: undefined,
    refreshFailed: undefined,
    configured: true,
    provider: "xty_codex",
    knowledgeBase: {
      snapshotId: "frozen-snapshot",
      version: 4,
      sourceFileName: "frozen.zip",
      documentCount: 4,
    },
  };
  mocks.responseKnowledgeBase = null;
  mocks.sourceCalls = [];
  mocks.received = null;
  mocks.workbenchProps = null;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("connected redesigned enterprise RAG workspace", () => {
  it("attributes a historical answer to its frozen task snapshot, never the current publication", () => {
    render(<EnterpriseRagWorkspace />);

    expect(screen.getByTestId("designed-enterprise-rag")).toBeTruthy();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.sourceCalls).toContainEqual(["task-frozen", true]);
    expect(mocks.received?.live).toMatchObject({
      configured: true,
      providerLabel: "XTY Codex",
      knowledgeBinding: "frozen_task",
      taskId: "task-frozen",
      conversationReady: true,
      question: "真实问题",
      answer: "真实回答",
      knowledgeBase: { snapshotId: "frozen-snapshot", version: 4 },
      currentKnowledgeBase: { snapshotId: "current-snapshot", version: 9 },
      sources: [{ id: "source-1", title: "任务实际引用资料" }],
      onRetryPending: mocks.retryPending,
    });
  });

  it("prefers the task response snapshot while the task runtime source is loading", () => {
    mocks.responseKnowledgeBase = {
      snapshotId: "response-snapshot",
      version: 6,
      sourceFileName: "response.zip",
      documentCount: 6,
    };
    mocks.taskSource = {
      ...mocks.taskSource,
      loaded: false,
      knowledgeBase: null,
    };

    render(<EnterpriseRagWorkspace />);

    expect(mocks.received?.live).toMatchObject({
      loaded: true,
      failed: false,
      knowledgeBinding: "frozen_task",
      knowledgeBase: { snapshotId: "response-snapshot", version: 6 },
    });
  });

  it("marks an unreadable historical snapshot unknown instead of substituting the current publication", () => {
    mocks.taskSource = {
      ...mocks.taskSource,
      loaded: true,
      failed: true,
      failureCode: "TASK_SOURCE_UNAVAILABLE",
      knowledgeBase: null,
    };

    render(<EnterpriseRagWorkspace />);

    expect(mocks.received?.live).toMatchObject({
      failed: true,
      knowledgeBinding: "historical_unknown",
      knowledgeBase: null,
      currentKnowledgeBase: { version: 9 },
    });
  });

  it("forwards a stale-source warning without discarding the frozen snapshot", () => {
    mocks.taskSource = { ...mocks.taskSource, refreshFailed: true };

    render(<EnterpriseRagWorkspace />);

    expect(mocks.received?.live).toMatchObject({
      refreshFailed: true,
      knowledgeBinding: "frozen_task",
      knowledgeBase: { version: 4 },
    });
  });

  it("keeps the project workbench and makes the later design its main surface", () => {
    render(
      <EnterpriseRagWorkspace
        workbench
        projectId="workspace-1"
        storageScopeKey="21:workspace-1"
      />,
    );

    expect(screen.getByTestId("project-workbench")).toBeTruthy();
    expect(screen.getByTestId("designed-enterprise-rag")).toBeTruthy();
    expect(screen.getByTestId("source-note")).toBeTruthy();
    expect(mocks.workbenchProps).toMatchObject({
      projectId: "workspace-1",
      purpose: "enterprise_qa",
      autoCreate: false,
      canCreateConversation: true,
    });
    expect(mocks.received?.storageScopeKey).toBe("21:workspace-1");
  });

  it("waits for knowledge and model readiness before creating a conversation", () => {
    mocks.active = null;
    mocks.currentSource = {
      ...mocks.currentSource,
      loaded: false,
      knowledgeBase: null,
    };
    const page = render(<EnterpriseRagWorkspace />);
    expect(mocks.createConversation).not.toHaveBeenCalled();

    mocks.currentSource = {
      loaded: true,
      failed: false,
      failureCode: undefined,
      refreshFailed: undefined,
      configured: true,
      provider: "xty_codex",
      knowledgeBase: {
        snapshotId: "current-snapshot",
        version: 9,
        sourceFileName: "current.zip",
        documentCount: 9,
      },
    };
    page.rerender(<EnterpriseRagWorkspace />);

    expect(mocks.createConversation).toHaveBeenCalledWith({
      title: "企业问答",
      reuseEmpty: false,
      purpose: "enterprise_qa",
      workbenchAgentId: "enterprise-qa",
    });
  });

  it("does not create a conversation when the model status or provider is unknown", () => {
    mocks.active = null;
    mocks.currentSource = {
      ...mocks.currentSource,
      configured: null,
      provider: null,
    };

    render(<EnterpriseRagWorkspace workbench projectId="workspace-1" />);

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.workbenchProps).toMatchObject({
      autoCreate: false,
      canCreateConversation: false,
    });
  });
});
