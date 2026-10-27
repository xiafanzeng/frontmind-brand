import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnterpriseRagPreview,
  enterpriseRagHistoryStorageKey,
} from "./EnterpriseRagPreview";
import {
  EVALUATION_REPORT_STORAGE_KEY,
  findLatestEvaluationReport,
  listEvaluationReports,
} from "./evaluation-report-store";
import { previewRagAnswer } from "./preview-copy";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";
import { liveEnterpriseRagEvaluationApi } from "../enterprise-rag-evaluation-api";
import type { EnterpriseRagEvaluationRunDto } from "../../../contracts/enterprise-rag-evaluation-run";

const historyKey = "frontmind-rag-reviews-v1";
const dimensionLabels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];

function showPage() {
  return render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} />);
}

function liveRuntime(overrides: Partial<NonNullable<Parameters<typeof EnterpriseRagPreview>[0]["live"]>> = {}) {
  return {
    loaded: true,
    failed: false,
    configured: true,
    providerLabel: "XTY Codex",
    knowledgeBase: {
      snapshotId: "snapshot-live",
      version: 7,
      sourceFileName: "企业知识库.zip",
      documentCount: 12,
    },
    currentKnowledgeBase: {
      snapshotId: "snapshot-live",
      version: 7,
      sourceFileName: "企业知识库.zip",
      documentCount: 12,
    },
    knowledgeBinding: "current_publication" as const,
    conversationReady: true,
    question: "",
    answer: "",
    sources: [],
    busy: false,
    running: false,
    onRetryPending: vi.fn(async () => true),
    onAsk: vi.fn(async () => true),
    onStop: vi.fn(async () => true),
    onRetryKnowledge: vi.fn(),
    onStartNewConversation: vi.fn(),
    onOpenKnowledge: vi.fn(),
    ...overrides,
  };
}

function completedAutomaticRun(): EnterpriseRagEvaluationRunDto {
  const dimensionIds = ["intent", "correctness", "completeness", "citations", "clarity", "boundaries"] as const;
  const gateIds = ["facts", "citations", "permissions", "safety", "unknown", "injection", "availability"] as const;
  const levels = [4, 4, 3, 3, 4, 4] as const;
  const scores = [20, 25, 11.25, 11.25, 15, 10];
  const maxScores = [20, 25, 15, 15, 15, 10];
  return {
    operationId: "evaluation-operation-1",
    sourceQaTaskId: "task-1",
    turnId: "turn-1",
    status: "completed",
    createdAt: "2026-10-26T01:00:00.000Z",
    updatedAt: "2026-10-26T01:01:00.000Z",
    error: null,
    report: {
      reportId: "evaluation-report-1",
      sourceQaTaskId: "task-1",
      sourceTurnId: "turn-1",
      conversationId: "conversation-1",
      questionMessageId: "question-1",
      answerMessageId: "answer-1",
      questionHash: "a".repeat(64),
      answerHash: "b".repeat(64),
      knowledgeBase: {
        snapshotId: "snapshot-live",
        version: 7,
        sourceFileName: "企业知识库.zip",
        documentCount: 12,
        contentHash: "c".repeat(64),
      },
      evaluator: {
        skillId: "enterprise-rag-evaluation",
        skillVersion: "1.0.0",
        ruleVersion: "rag-eval-1.2",
        judgeVersion: "1.0.0",
        provider: "xty_codex",
        model: "gpt-5.6-sol",
        effort: "high",
        skillHash: "d".repeat(64),
        outputHash: "e".repeat(64),
      },
      judgments: {
        operationToken: "evaluation-operation-1",
        inputHash: "f".repeat(64),
        dimensions: dimensionIds.map((id, index) => ({
          id,
          level: levels[index],
          rationale: `${id} 已依据冻结资料完成核验。`,
          evidenceIds: ["source-1", "answer-1"],
        })),
        gates: gateIds.map((id) => ({
          id,
          status: "passed" as const,
          reason: `${id} 未发现阻断风险。`,
          evidenceIds: ["source-1", "answer-1"],
        })),
        claims: [{
          id: "claim-1",
          statement: "支持私有化部署",
          status: "supported",
          sourceIds: ["source-1"],
          rationale: "冻结资料直接支持该陈述。",
        }],
        summary: "回答有据、完整且不存在关键风险。",
      },
      result: {
        skillId: "enterprise-rag-evaluation",
        version: "1.0.0",
        status: "completed",
        score: 93,
        coverage: 100,
        recommendation: "recommended",
        summary: "回答有据、完整且不存在关键风险。",
        dimensions: dimensionIds.map((id, index) => ({
          id,
          label: dimensionLabels[index],
          status: levels[index] === 4 ? "passed" as const : "partial" as const,
          score: scores[index],
          maxScore: maxScores[index],
          summary: `${id} 已完成。`,
          evidenceIds: ["source-1", "answer-1"],
        })),
        risks: [],
        relatedReportIds: [],
      },
      createdAt: "2026-10-26T01:00:00.000Z",
      completedAt: "2026-10-26T01:01:00.000Z",
    },
  };
}

function evaluation() {
  return within(screen.getByRole("region", { name: "回答质量评估" }));
}

function openReview() {
  fireEvent.click(screen.getByRole("button", { name: "人工评审与计算" }));
  return within(screen.getByRole("dialog", { name: "人工评审与计算" }));
}

function confirmReview() {
  const dialog = within(screen.getByRole("dialog", { name: "人工评审与计算" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "评审人" }), { target: { value: "reviewer-A" } });
  fireEvent.click(dialog.getByRole("checkbox", { name: /已对照当前回答与证据进行核验/ }));
  fireEvent.click(dialog.getByRole("button", { name: "保存评审并计算" }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("enterprise RAG evidence-based review UI", () => {
  it("submits a live question without falling back to a synthetic answer", async () => {
    const runtime = liveRuntime();
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={runtime}
      />,
    );

    expect(screen.getByTestId("enterprise-rag-live-root")).toBeTruthy();
    expect(screen.getByText("企业知识库.zip")).toBeTruthy();
    expect(screen.getByText(/知识版本 v7/)).toBeTruthy();
    fireEvent.change(screen.getByTestId("rag-question-input"), {
      target: { value: "你们支持哪些部署方式？" },
    });
    fireEvent.click(screen.getByTestId("rag-submit"));

    await waitFor(() =>
      expect(runtime.onAsk).toHaveBeenCalledWith("你们支持哪些部署方式？"),
    );
    expect(screen.queryByText(previewRagAnswer)).toBeNull();
    expect(screen.getByTestId("rag-answer").textContent).toContain(
      "尚无待评估回答",
    );
  });

  it("renders the persisted live answer and only server-resolved source metadata", async () => {
    const runtime = liveRuntime({
      question: "你们支持哪些部署方式？",
      questionId: "question-1",
      answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
      answerId: "answer-1",
      sources: [
        {
          id: "doc-live-1",
          title: "部署说明",
          kind: "published_knowledge",
        },
      ],
    });
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={runtime}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("rag-answer").textContent).toContain(
        "支持私有化部署",
      ),
    );
    expect(screen.getAllByTestId("rag-source")[0].textContent).toContain(
      "部署说明",
    );
    fireEvent.click(screen.getAllByTestId("rag-source")[0]);
    const evidence = within(
      screen.getByRole("dialog", { name: "回答依据与陈述核验" }),
    );
    expect(evidence.getByText(/只公开服务端解析后的资料标识与标题/)).toBeTruthy();
    expect(evidence.getByText(/知识版本：v7/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑回答" })).toBeNull();
    expect(screen.getByText("服务端原始回答")).toBeTruthy();
  });

  it("only starts a paid automatic evaluation after the explicit button click", async () => {
    const run = completedAutomaticRun();
    const latest = vi
      .spyOn(liveEnterpriseRagEvaluationApi, "latest")
      .mockResolvedValue({ latest: null, history: [] });
    const start = vi
      .spyOn(liveEnterpriseRagEvaluationApi, "start")
      .mockResolvedValue(run);
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
          answerId: "answer-1",
          sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
        })}
      />,
    );

    await waitFor(() => expect(latest).toHaveBeenCalledWith({
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
    }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain(
      "页面加载只读取已有记录",
    );

    fireEvent.click(screen.getByTestId("rag-auto-evaluate"));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
      clientRequestId: expect.any(String),
    }));
    await waitFor(() =>
      expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain(
        "自动评估已完成",
      ),
    );
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93");
    expect(screen.getAllByTestId("rag-evaluation-dimension")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "查看回答依据" }));
    expect(screen.getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
    expect(screen.getByTestId("rag-auto-evaluation-report").textContent).toContain(
      "evaluation-report-1",
    );
  });

  it("recovers the immutable latest automatic report on refresh without posting again", async () => {
    const run = completedAutomaticRun();
    const latest = vi
      .spyOn(liveEnterpriseRagEvaluationApi, "latest")
      .mockResolvedValue({ latest: run, history: [run] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
          answerId: "answer-1",
          sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
        })}
      />,
    );

    await waitFor(() => expect(latest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"),
    );
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText("真实回答 · 服务端自动评估")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText("服务端自动评估记录")).toBeTruthy();
    expect(records.getByText(/报告：evaluation-report-1/)).toBeTruthy();
    expect(records.getByText(/人工复核不改变服务端自动报告/)).toBeTruthy();
  });

  it("mirrors a completed server report into the scoped audit for explicit website linking", async () => {
    const run = completedAutomaticRun();
    const latest = vi
      .spyOn(liveEnterpriseRagEvaluationApi, "latest")
      .mockResolvedValue({ latest: run, history: [run] });
    const scope = "live:7:workspace-a";
    render(
      <EnterpriseRagPreview
        storageScopeKey={scope}
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
          answerId: "answer-1",
          sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
        })}
      />,
    );

    await waitFor(() => expect(latest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"),
    );
    const scopedStorage = scopedEvaluationStorage(scope);
    // The website builder links through exactly this query, so it must find the
    // server report without requiring a separate manual review.
    const mirrored = findLatestEvaluationReport(
      { skillId: "enterprise-rag-evaluation" },
      scopedStorage,
    );
    expect(mirrored?.reportId).toBe("evaluation-report-1");
    expect(mirrored?.subject).toEqual({
      kind: "rag-answer",
      id: "turn-1",
      version: "rag-eval-1.2",
    });
    expect(mirrored?.result.score).toBe(93);
    expect(listEvaluationReports()).toEqual([]);
  });

  it("keeps polling when the provider remains running before it completes", async () => {
    vi.useFakeTimers();
    try {
      const completed = completedAutomaticRun();
      const running: EnterpriseRagEvaluationRunDto = {
        ...completed,
        status: "running",
        report: null,
        updatedAt: "2026-10-26T01:00:10.000Z",
      };
      vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({
        latest: running,
        history: [],
      });
      const observe = vi
        .spyOn(liveEnterpriseRagEvaluationApi, "observe")
        .mockResolvedValueOnce({
          ...running,
          updatedAt: "2026-10-26T01:00:20.000Z",
        })
        .mockResolvedValueOnce(completed);
      render(
        <EnterpriseRagPreview
          onOpenWebsite={vi.fn()}
          onOpenWebsiteAssistant={vi.fn()}
          live={liveRuntime({
            taskId: "task-1",
            turnId: "turn-1",
            question: "你们支持哪些部署方式？",
            questionId: "question-1",
            answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
            answerId: "answer-1",
          })}
        />,
      );

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain("自动评估中");

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain("自动评估已完成");
      expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the same client request id after an unknown POST outcome", async () => {
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({
      latest: null,
      history: [],
    });
    const start = vi
      .spyOn(liveEnterpriseRagEvaluationApi, "start")
      .mockRejectedValueOnce(new Error("网络结果未知，请重试确认。"))
      .mockResolvedValueOnce(completedAutomaticRun());
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
          answerId: "answer-1",
        })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("rag-auto-evaluate").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByTestId("rag-auto-evaluate"));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/网络结果未知/)).toBeTruthy());
    const firstId = start.mock.calls[0][0].clientRequestId;

    fireEvent.click(screen.getByTestId("rag-auto-evaluate"));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0].clientRequestId).toBe(firstId);
    await waitFor(() =>
      expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain("自动评估已完成"),
    );
  });

  it("shows the durable server failure instead of a generic submitted notice", async () => {
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({
      latest: null,
      history: [],
    });
    const completed = completedAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue({
      ...completed,
      status: "failed",
      report: null,
      error: {
        code: "EVALUATION_ATTENTION_REQUIRED",
        message: "上游任务创建结果不确定，需要管理员确认后再继续。",
      },
    });
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "支持私有化部署。",
          answerId: "answer-1",
        })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("rag-auto-evaluate").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByTestId("rag-auto-evaluate"));
    await waitFor(() =>
      expect(screen.getByTestId("rag-auto-evaluation-status").textContent).toContain(
        "上游任务创建结果不确定",
      ),
    );
    expect(screen.getByRole("alert").textContent).toContain("需要管理员确认");
    expect(screen.queryByText(/自动评估已提交/)).toBeNull();
  });

  it("replaces the submitted notice when polling observes a server failure", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({
        latest: null,
        history: [],
      });
      const completed = completedAutomaticRun();
      const running: EnterpriseRagEvaluationRunDto = {
        ...completed,
        status: "running",
        report: null,
      };
      const failed: EnterpriseRagEvaluationRunDto = {
        ...running,
        status: "failed",
        error: {
          code: "EVALUATION_ATTENTION_REQUIRED",
          message: "上游任务创建结果不确定，需要管理员确认后再继续。",
        },
      };
      vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(running);
      vi.spyOn(liveEnterpriseRagEvaluationApi, "observe").mockResolvedValue(failed);
      render(
        <EnterpriseRagPreview
          onOpenWebsite={vi.fn()}
          onOpenWebsiteAssistant={vi.fn()}
          live={liveRuntime({
            taskId: "task-1",
            turnId: "turn-1",
            question: "你们支持哪些部署方式？",
            questionId: "question-1",
            answer: "支持私有化部署。",
            answerId: "answer-1",
          })}
        />,
      );

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      fireEvent.click(screen.getByTestId("rag-auto-evaluate"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText(/自动评估已提交/)).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("alert").textContent).toContain("需要管理员确认");
      expect(screen.queryByText(/自动评估已提交/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the previous answer notice when a new empty conversation becomes active", async () => {
    const page = render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          question: "旧问题",
          questionId: "old-question",
          answer: "旧回答",
          answerId: "old-answer",
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/已载入真实企业问答结果/)).toBeTruthy(),
    );

    page.rerender(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({ question: "", answer: "" })}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText(/已载入真实企业问答结果/)).toBeNull(),
    );
  });

  it("shows the frozen task version and never substitutes a newer publication", () => {
    const startNewConversation = vi.fn();
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          knowledgeBinding: "frozen_task",
          taskId: "task-old",
          knowledgeBase: {
            snapshotId: "snapshot-old",
            version: 3,
            sourceFileName: "历史资料.zip",
            documentCount: 5,
          },
          currentKnowledgeBase: {
            snapshotId: "snapshot-current",
            version: 9,
            sourceFileName: "当前资料.zip",
            documentCount: 20,
          },
          onStartNewConversation: startNewConversation,
        })}
      />,
    );

    expect(screen.getByText("本任务冻结知识快照")).toBeTruthy();
    expect(screen.getByText(/知识版本 v3/)).toBeTruthy();
    expect(screen.getByText(/项目已发布 v9；本会话仍使用冻结的 v3/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "使用 v9 新建问答" }),
    );
    expect(startNewConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByText("历史资料.zip")).toBeTruthy();
    expect(screen.queryByText("当前资料.zip")).toBeNull();
  });

  it("labels an unavailable historical binding unknown instead of claiming the current version", () => {
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          loaded: true,
          failed: true,
          failureCode: "TASK_SOURCE_UNAVAILABLE",
          knowledgeBinding: "historical_unknown",
          taskId: "task-old",
          knowledgeBase: null,
          currentKnowledgeBase: {
            snapshotId: "snapshot-current",
            version: 9,
            sourceFileName: "当前资料.zip",
            documentCount: 20,
          },
        })}
      />,
    );

    expect(screen.getAllByText(/历史任务知识版本未知/).length).toBeGreaterThan(0);
    expect(screen.getByText(/未使用当前发布版本替代/)).toBeTruthy();
    expect(screen.queryByText(/知识版本 v9/)).toBeNull();
    expect(screen.queryByRole("button", { name: "前往智能知识库" })).toBeNull();
  });

  it("offers an explicit retry for a retained pending dispatch", async () => {
    const runtime = liveRuntime({
      pendingDispatchQuestion: "尚未确认的问题",
    });
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={runtime}
      />,
    );

    expect(screen.getByText(/尚未确认的问题/)).toBeTruthy();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重试上次问题" }));
    await waitFor(() => expect(runtime.onRetryPending).toHaveBeenCalledTimes(1));
  });

  it("isolates live reviews by owner/workspace while sharing the scoped audit with website flow", () => {
    const scope = "live:7:workspace-a";
    const page = render(
      <EnterpriseRagPreview
        storageScopeKey={scope}
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({ question: "真实问题", answer: "真实回答" })}
      />,
    );
    openReview();
    confirmReview();

    expect(window.localStorage.getItem(historyKey)).toBeNull();
    expect(
      window.localStorage.getItem(enterpriseRagHistoryStorageKey(scope)),
    ).not.toBeNull();
    expect(listEvaluationReports()).toEqual([]);
    expect(listEvaluationReports(scopedEvaluationStorage(scope))).toHaveLength(1);

    page.unmount();
    render(
      <EnterpriseRagPreview
        storageScopeKey="live:8:workspace-b"
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({ question: "另一问题", answer: "另一回答" })}
      />,
    );
    expect(screen.getByRole("button", { name: "评估记录" })).toBeTruthy();
  });

  it("keeps the designed surface visible while a real knowledge publication is missing", () => {
    const openKnowledge = vi.fn();
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          knowledgeBase: null,
          onOpenKnowledge: openKnowledge,
        })}
      />,
    );

    expect(screen.getByTestId("enterprise-rag-live-root")).toBeTruthy();
    expect(screen.getByText(/请先完成并发布企业知识库/)).toBeTruthy();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "前往智能知识库" }));
    expect(openKnowledge).toHaveBeenCalledTimes(1);
  });

  it("fails closed while the model configuration status is unknown", () => {
    const runtime = liveRuntime({ configured: null });
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={runtime}
      />,
    );

    expect(screen.getByText(/模型状态尚未确认/)).toBeTruthy();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTestId("rag-submit"));
    expect(runtime.onAsk).not.toHaveBeenCalled();
  });

  it("does not reuse the default answer or an old score for a custom question", () => {
    showPage();
    expect(screen.getByText(previewRagAnswer)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "输入企业 RAG 示例问题" }), {
      target: { value: "我们的产品支持离线安装吗？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "试用问题" }));

    expect(screen.queryByText(previewRagAnswer)).toBeNull();
    expect(screen.getByText(/尚无待评估回答/)).toBeTruthy();
    expect(screen.getByText(/此问题不在示例库/).textContent).toContain("未连接真实问答服务");
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("—");
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(evaluation().getByText("可能分数 0–100")).toBeTruthy();
    expect(screen.getByRole("button", { name: "人工评审与计算" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "录入回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "现有公开资料未说明离线安装能力，请向产品负责人确认。" } });
    expect(editor.getByRole("button", { name: "保存回答，重新评审" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(editor.getByRole("textbox", { name: "用户任务" }), { target: { value: "确认能否在无网络的环境部署" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));

    expect(screen.getByText("现有公开资料未说明离线安装能力，请向产品负责人确认。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "人工评审与计算" }).hasAttribute("disabled")).toBe(false);
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("—");
  });

  it("preserves unknown weight and a pending score when a saved rating lacks evidence", () => {
    showPage();
    const review = openReview();
    for (const label of dimensionLabels) {
      fireEvent.change(review.getByRole("combobox", { name: `${label}等级` }), { target: { value: "4" } });
    }
    fireEvent.change(review.getByRole("textbox", { name: "需求满足证据" }), { target: { value: "   " } });
    expect(review.getByRole("button", { name: "保存评审并计算" }).hasAttribute("disabled")).toBe(true);
    confirmReview();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("—");
    expect(evaluation().getByText("评审覆盖 80%")).toBeTruthy();
    expect(evaluation().getByText("可能分数 80–100")).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].dimensions.find((item: { id: string }) => item.id === "intent").evidenceIds).toEqual([]);
  });

  it("lets a failed gate override a manually saved perfect numeric score", () => {
    showPage();
    const review = openReview();
    for (const label of dimensionLabels) {
      fireEvent.change(review.getByRole("combobox", { name: `${label}等级` }), { target: { value: "4" } });
    }
    fireEvent.change(review.getByRole("combobox", { name: "权限与隐私风险核验" }), { target: { value: "failed" } });
    fireEvent.change(review.getByRole("textbox", { name: "权限与隐私风险核验依据" }), {
      target: { value: "当前角色无权访问回答所引用的内部原文。" },
    });
    confirmReview();

    expect(evaluation().getByLabelText("综合评分").textContent).toContain("100");
    expect(evaluation().getByText("不可用，优先修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
    expect(evaluation().getByText(/高分不能把该回答判为可用，但不会取消网站发布选择/)).toBeTruthy();
  });

  it("invalidates the current score after editing while retaining the original reviewed snapshot", () => {
    showPage();
    openReview();
    confirmReview();
    const original = JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0];
    expect(original.answer).toBe(previewRagAnswer);

    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "这是已经修订、尚待重新核验的回答。" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));

    expect(evaluation().getByLabelText("综合评分").textContent).toContain("—");
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/历史快照，不适用于当前回答/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0]).toEqual(original);
  });

  it("treats an adopted suggested rewrite as a new unreviewed answer", () => {
    showPage();
    fireEvent.click(screen.getByRole("button", { name: /查看优化方案/ }));
    const improvement = within(screen.getByRole("dialog", { name: "优化方案" }));
    const suggestedAnswer = improvement.getByText(/FrontMind 的演示能力包括：/).textContent;
    fireEvent.click(improvement.getByRole("button", { name: "采用改写并重新评审" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(suggestedAnswer!)).toBeTruthy();
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("—");
    expect(evaluation().getByText("关键风险待核验")).toBeTruthy();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(window.localStorage.getItem(historyKey)).toBeNull();
  });

  it("persists rule 1.2 review evidence and an independent evaluation report across remounts", () => {
    const page = showPage();
    openReview();
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0]).toMatchObject({ reviewer: "reviewer-A", answer: previewRagAnswer, ruleVersion: "rag-eval-1.2", knowledgeVersion: "KB-SYN-v1" });
    expect(saved[0].dimensions).toHaveLength(6);
    expect(saved[0].gates).toHaveLength(7);
    expect(saved[0].dimensions.every((item: { rationale: string; evidenceIds: string[] }) => item.rationale && item.evidenceIds.length)).toBe(true);

    const reports = listEvaluationReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reportId: `report-${saved[0].id}`,
      createdAt: saved[0].time,
      subject: { kind: "rag-answer", id: saved[0].id, version: "rag-eval-1.2" },
      result: {
        skillId: "enterprise-rag-evaluation",
        version: "1.0.0",
        status: "completed",
      },
    });
    expect("canPublish" in reports[0].result).toBe(false);
    expect("canConfirm" in reports[0].result).toBe(false);
    expect(window.localStorage.getItem(EVALUATION_REPORT_STORAGE_KEY)).not.toBeNull();

    page.unmount();
    showPage();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/reviewer-A/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(records.getByText(/与当前回答相同/)).toBeTruthy();
  });

  it("keeps older rule-version review snapshots visible without recalculating them", () => {
    const page = showPage();
    openReview();
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    saved[0].ruleVersion = "rag-eval-1.1";
    window.localStorage.setItem(historyKey, JSON.stringify(saved));

    page.unmount();
    showPage();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/rag-eval-1\.1/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
  });

  it("exposes claim-level evidence and restores focus after Escape", () => {
    showPage();
    const opener = screen.getByRole("button", { name: "查看回答依据" });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole("dialog", { name: "回答依据与陈述核验" });
    const details = within(panel);
    expect(details.getByRole("heading", { name: "陈述与证据" })).toBeTruthy();
    expect(details.getByRole("heading", { name: "来源原文" })).toBeTruthy();
    expect(details.getByRole("heading", { name: "本次判断记录" })).toBeTruthy();
    expect(details.getByText("overview-1")).toBeTruthy();
    expect(details.getByText(/合成资料 · 产品能力说明/)).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(details.getByRole("button", { name: "关闭评估面板" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("removes the test-set demo while preserving single-answer sample review", () => {
    showPage();
    expect(screen.getByText("单次问答")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "测试集演示" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "测试集与验收口径演示" })).toBeNull();
    expect(screen.queryByLabelText("核心统计指标")).toBeNull();
    expect(screen.getByRole("region", { name: "回答质量评估" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评分规则" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评估记录" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-permission-leak" },
    });
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("90");
    expect(evaluation().getByText("不可用，优先修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
  });
});
