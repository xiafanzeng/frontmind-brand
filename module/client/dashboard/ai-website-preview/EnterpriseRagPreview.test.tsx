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
import { createRagChecklist, scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";

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
  return within(screen.getByRole("region", { name: "本轮回答质量" }));
}

function openQualityDetails() {
  const trigger = evaluation().getByRole("button", { name: "查看优化方案" });
  if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger);
  return evaluation();
}

function openJudgmentDetails() {
  const trigger = evaluation().getByRole("button", { name: "理解本次判断" });
  if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger);
  return evaluation();
}

function openReview() {
  openJudgmentDetails();
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
  vi.unstubAllGlobals();
});

describe("enterprise RAG evidence-based review UI", () => {
  it("renders the approved side-by-side evaluation overview without obsolete copy", () => {
    showPage();

    const qualityPanel = screen.getByRole("region", { name: "本轮回答质量" });
    const taskPanel = screen.getByRole("region", { name: "客户任务完成情况" });
    const panel = within(qualityPanel);
    expect(qualityPanel.parentElement).toBe(taskPanel.parentElement);
    expect(qualityPanel.contains(taskPanel)).toBe(false);
    expect(Array.from(qualityPanel.parentElement!.children).indexOf(qualityPanel)).toBeLessThan(
      Array.from(taskPanel.parentElement!.children).indexOf(taskPanel),
    );
    expect(panel.getByRole("heading", { name: "本轮回答质量" })).toBeTruthy();
    expect(panel.getByTestId("rag-evaluation-header-icon").getAttribute("aria-hidden")).toBe("true");
    const overview = panel.getByTestId("rag-evaluation-overview");
    const gauge = panel.getByLabelText("六维诊断评分");
    const summary = panel.getByRole("region", { name: "当前评估摘要" });
    expect(overview.firstElementChild).toBe(gauge);
    expect(overview.lastElementChild).toBe(summary);
    const statusTitle = panel.getByRole("heading", { name: "待改进" });
    const summaryFlow = panel.getByTestId("rag-evaluation-summary-flow");
    const summaryCopy = panel.getByTestId("rag-evaluation-summary-copy");
    const metrics = panel.getByTestId("rag-evaluation-metrics");
    expect(summaryFlow.firstElementChild).toBe(statusTitle);
    expect(statusTitle.nextElementSibling).toBe(summaryCopy);
    expect(summaryFlow.lastElementChild).toBe(metrics);
    expect(summaryFlow.contains(metrics)).toBe(true);
    expect(summaryCopy.textContent).toMatch(/核心能力有依据/);
    expect(metrics.textContent).toContain("关键风险已核验");
    expect(metrics.textContent).toContain("评审覆盖 100%");
    expect(within(metrics).getByText("关键风险已核验")).toBeTruthy();
    expect(within(metrics).getByText("评审覆盖 100%")).toBeTruthy();
    const metricShields = within(metrics).getAllByTestId("rag-evaluation-metric-shield");
    expect(metricShields).toHaveLength(1);
    expect(metricShields.every((shield) => shield.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(panel.getByTestId("rag-evaluation-status-orb").getAttribute("aria-hidden")).toBe("true");
    expect(summary).toBeTruthy();
    expect(gauge).toBeTruthy();
    expect(panel.getByRole("region", { name: "六维加权评分" })).toBeTruthy();
    const judgmentDisclosure = panel.getByRole("button", { name: "理解本次判断" });
    const qualityDisclosure = panel.getByRole("button", { name: "查看优化方案" });
    expect(judgmentDisclosure.getAttribute("aria-expanded")).toBe("false");
    expect(qualityDisclosure.getAttribute("aria-expanded")).toBe("false");
    expect(judgmentDisclosure.compareDocumentPosition(qualityDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.queryByText("用户真正想确认")).toBeNull();
    expect(panel.queryByText("优先优化")).toBeNull();
    expect(panel.queryByText("进入网站建设的 AI 助手")).toBeNull();
    const task = within(taskPanel);
    expect(task.getByTestId("rag-task-status").textContent).toContain("缺下一步");
    expect(task.getByText("能说明产品能力与知识来源")).toBeTruthy();
    expect(task.getByText("获得下一步行动入口")).toBeTruthy();
    expect(task.queryByRole("button", { name: "判定依据与测试信息" })).toBeNull();
    expect(task.getByText(/^必要完成点未全部满足/)).toBeTruthy();
    expect(task.getByText("正常问答")).toBeTruthy();
    expect(task.getByText("稳定基准集")).toBeTruthy();
    const metadataCards = task.getAllByTestId("rag-conversation-meta-card");
    expect(metadataCards).toHaveLength(4);
    expect(metadataCards.every(card => card.tagName === "LI")).toBe(true);
    expect(panel.queryByText("缺下一步")).toBeNull();
    expect(screen.queryByRole("region", { name: "完整对话判定" })).toBeNull();
    expect(panel.queryByText("合成样例 · 预设评审")).toBeNull();
    expect(panel.queryByText(/检查完成程度/)).toBeNull();
  });

  it("keeps judgment and optimization in ordered disclosures that can remain open together", () => {
    showPage();

    const qualityPanel = screen.getByRole("region", { name: "本轮回答质量" });
    const quality = within(qualityPanel);
    const judgmentDisclosure = quality.getByRole("button", { name: "理解本次判断" });
    const qualityDisclosure = quality.getByRole("button", { name: "查看优化方案" });

    fireEvent.click(judgmentDisclosure);
    expect(judgmentDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(qualityDisclosure.getAttribute("aria-expanded")).toBe("false");
    const judgmentRegion = quality.getByRole("region", { name: "理解本次判断内容" });
    const judgment = within(judgmentRegion);
    expect(judgment.queryByRole("heading", { name: "用户要解决的问题" })).toBeNull();
    expect(judgment.queryByText(/用户要解决的问题/)).toBeNull();
    const taskCopy = judgmentRegion.querySelector(".rag-judgment-copy");
    expect(taskCopy?.textContent).toContain("快速理解产品能解决哪些问题，以及自己下一步可以从哪里开始。");
    expect(taskCopy?.textContent).toContain("“人工评审与计算”用于查看评分如何形成");
    expect(taskCopy?.textContent).toContain("“查看回答依据”用于核对支撑本次结论的事实与记录");
    expect(taskCopy).toBeTruthy();
    if (!taskCopy) throw new Error("Expected judgment copy");
    expect(taskCopy.tagName).toBe("P");
    expect(taskCopy.classList.contains("rag-judgment-copy")).toBe(true);
    expect(qualityPanel.querySelector(".rag-judgment-context")).toBeNull();
    const reviewAction = judgment.getByRole("button", { name: "人工评审与计算" });
    const evidenceAction = judgment.getByRole("button", { name: "查看回答依据" });
    expect(reviewAction.classList.contains("rag-detail-action")).toBe(true);
    expect(evidenceAction.classList.contains("rag-detail-action")).toBe(true);

    fireEvent.click(qualityDisclosure);
    expect(judgmentDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(qualityDisclosure.getAttribute("aria-expanded")).toBe("true");
    const optimization = within(quality.getByRole("region", { name: "查看优化方案内容" }));
    expect(optimization.queryByText("优先优化")).toBeNull();
    expect(optimization.queryByText("用户真正想确认")).toBeNull();
    const priorityLabel = optimization.getByText("优先处理");
    const issueTitle = optimization.getByText("下一步操作指引缺失");
    const issueStatement = issueTitle.closest(".rag-priority-copy__statement");
    expect(priorityLabel.classList.contains("is-attention")).toBe(true);
    expect(issueTitle.compareDocumentPosition(priorityLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(issueTitle.closest(".rag-priority-copy__heading")).toBe(priorityLabel.closest(".rag-priority-copy__heading"));
    expect(issueStatement?.firstElementChild?.textContent).toBe("问题：");
    expect(issueStatement?.firstElementChild?.tagName).toBe("STRONG");
    expect(issueTitle.closest("strong")).toBeNull();
    expect(optimization.queryByText("用户不知道下一步怎么开始")).toBeNull();
    expect(optimization.queryByText("建议做法")).toBeNull();
    const issueAction = optimization.getByText("增加“网站建设”三步及当前本地演示边界，再复测用户是否能找到入口。");
    expect(issueAction.closest(".rag-priority-copy__statement")?.firstElementChild?.textContent).toBe("方案：");
    expect(issueAction.closest("strong")).toBeNull();
    expect(issueTitle.closest(".rag-priority-copy")).toBeTruthy();
    expect(qualityPanel.querySelector(".rag-priority-card")).toBeNull();
    const completeAction = optimization.getByRole("button", { name: "查看完整方案" });
    expect(completeAction.classList.contains("rag-detail-action")).toBe(true);
    const radar = quality.getByRole("region", { name: "六维加权评分" });
    expect(radar.compareDocumentPosition(judgmentDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(judgmentDisclosure.compareDocumentPosition(qualityDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quality.queryByText("进入网站建设的 AI 助手")).toBeNull();

    const task = within(screen.getByRole("region", { name: "客户任务完成情况" }));
    expect(task.getByText(/^必要完成点未全部满足/)).toBeTruthy();
    expect(task.getByText("正常问答")).toBeTruthy();
    expect(task.getByText("稳定基准集")).toBeTruthy();
    expect(task.getByText("规定运行 1 次")).toBeTruthy();
    expect(task.getByText("归因：生成未遵循依据")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-assistant-workflow" },
    });

    expect(judgmentDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(qualityDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(quality.getByRole("region", { name: "六维加权评分" })).toBeTruthy();
    expect(task.getByText("通过")).toBeTruthy();
  });

  it("translates P0, P1, and P2 into user-facing priority labels", () => {
    showPage();
    openQualityDetails();
    expect(evaluation().getByText("优先处理").classList.contains("is-attention")).toBe(true);
    expect(evaluation().queryByText(/^P[012]$/)).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-assistant-workflow" },
    });
    expect(evaluation().getByText("建议完善").classList.contains("is-suggestion")).toBe(true);
    expect(evaluation().getByText("保存与资料不足提示缺失")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-permission-leak" },
    });
    expect(evaluation().getByText("立即修复").classList.contains("is-danger")).toBe(true);
    expect(evaluation().getByText("内部范围资料暴露风险")).toBeTruthy();
    fireEvent.click(evaluation().getByRole("button", { name: "查看完整方案" }));
    const improvement = within(screen.getByRole("dialog", { name: "优化方案" }));
    expect(improvement.getByText("立即修复")).toBeTruthy();
    expect(improvement.queryByText(/^P[012]$/)).toBeNull();
  });

  it("keeps answer quality and task completion as separate conclusions", () => {
    showPage();

    expect(evaluation().getByRole("heading", { name: "待改进" })).toBeTruthy();
    expect(screen.getByTestId("rag-task-status").textContent).toContain("缺下一步");

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-assistant-workflow" },
    });

    expect(evaluation().getByRole("heading", { name: "待改进" })).toBeTruthy();
    expect(screen.getByTestId("rag-task-status").textContent).toContain("通过");
  });

  it("keeps the gauge card dimensions synchronized without compact-width feedback", () => {
    let resize: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    showPage();

    const overview = screen.getByTestId("rag-evaluation-overview");
    const summary = screen.getByRole("region", { name: "当前评估摘要" });
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({
      bottom: 148,
      height: 148,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => resize?.([], {} as ResizeObserver));
    expect(overview.style.getPropertyValue("--rag-evaluation-card-width")).toBe("148px");
    expect(overview.style.getPropertyValue("--rag-evaluation-card-height")).toBe("148px");

    vi.mocked(summary.getBoundingClientRect).mockReturnValue({
      bottom: 260,
      height: 260,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => resize?.([], {} as ResizeObserver));
    expect(overview.style.getPropertyValue("--rag-evaluation-card-width")).toBe("120px");
    expect(overview.style.getPropertyValue("--rag-evaluation-card-height")).toBe("260px");
  });

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
    expect(screen.getByTestId("rag-task-status").textContent).toContain("待确认");
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
    openJudgmentDetails();
    expect(screen.getAllByTestId("rag-evaluation-dimension")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "查看回答依据" }));
    expect(screen.getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
    expect(screen.getByTestId("rag-auto-evaluation-report").textContent).toContain(
      "evaluation-report-1",
    );
  });

  it("disables the full improvement plan when the current report has no repair items", async () => {
    const run = completedAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
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

    await waitFor(() => expect(evaluation().getByText(/报告 evaluation-report-1/)).toBeTruthy());
    const quality = openQualityDetails();
    expect(quality.getByText("当前记录没有待修复项；继续用更多真实场景验证。")).toBeTruthy();
    const fullPlan = quality.getByRole("button", { name: "查看完整方案" });
    expect(fullPlan.hasAttribute("disabled")).toBe(true);
    fireEvent.click(fullPlan);
    expect(screen.queryByRole("dialog", { name: "优化方案" })).toBeNull();
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
    expect(screen.getByText("报告 evaluation-report-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText("服务端自动评估记录")).toBeTruthy();
    expect(records.getByLabelText("六维诊断评分 93，满分 100").textContent).toBe("93/100");
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
      expect(screen.getByText(/自动评估已提交/).classList.contains("rag-muted")).toBe(true);
      expect(screen.getByText(/自动评估已提交/).classList.contains("sfp-notice")).toBe(false);

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
    expect(evaluation().getByLabelText("六维诊断评分").textContent).toContain("—");
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(evaluation().getByText("可能分数 0–100")).toBeTruthy();
    openJudgmentDetails();
    expect(screen.getByRole("button", { name: "人工评审与计算" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "录入回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "现有公开资料未说明离线安装能力，请向产品负责人确认。" } });
    expect(editor.getByRole("button", { name: "保存回答，重新评审" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(editor.getByRole("textbox", { name: "用户任务" }), { target: { value: "确认能否在无网络的环境部署" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));

    expect(screen.getByText("现有公开资料未说明离线安装能力，请向产品负责人确认。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "人工评审与计算" }).hasAttribute("disabled")).toBe(false);
    expect(within(evaluation().getByLabelText("六维诊断评分")).getByTestId("rag-gauge-value").textContent).toBe("—");
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
    expect(evaluation().getByLabelText("六维诊断评分").textContent).toContain("—");
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

    expect(evaluation().getByLabelText("六维诊断评分").textContent).toContain("100");
    expect(evaluation().getByText("需修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
    expect(evaluation().queryByText(/可能分数/)).toBeNull();
    expect(evaluation().getByText(/高分不能把该回答判为可用，但不会取消网站发布选择/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByLabelText("重大问题，数值分不适用").textContent).toBe("!");
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0].dimensions).toHaveLength(6);
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

    expect(evaluation().getByLabelText("六维诊断评分").textContent).toContain("—");
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/历史快照，不适用于当前回答/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0]).toEqual(original);
  });

  it("treats an adopted suggested rewrite as a new unreviewed answer", () => {
    showPage();
    openQualityDetails();
    fireEvent.click(screen.getByRole("button", { name: "查看完整方案" }));
    const improvement = within(screen.getByRole("dialog", { name: "优化方案" }));
    const suggestedAnswer = improvement.getByText(/FrontMind 的演示能力包括：/).textContent;
    fireEvent.click(improvement.getByRole("button", { name: "采用改写并重新评审" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(suggestedAnswer!)).toBeTruthy();
    expect(within(evaluation().getByLabelText("六维诊断评分")).getByTestId("rag-gauge-value").textContent).toBe("—");
    expect(evaluation().getByText("关键风险待核验")).toBeTruthy();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(window.localStorage.getItem(historyKey)).toBeNull();
  });

  it("persists rule 1.3 review evidence and an independent evaluation report across remounts", () => {
    const page = showPage();
    openReview();
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0]).toMatchObject({ reviewer: "reviewer-A", answer: previewRagAnswer, ruleVersion: "rag-eval-1.3", knowledgeVersion: "KB-SYN-v1" });
    expect(saved[0].dimensions).toHaveLength(6);
    expect(saved[0].gates).toHaveLength(7);
    expect(saved[0].dimensions.every((item: { rationale: string; evidenceIds: string[] }) => item.rationale && item.evidenceIds.length)).toBe(true);

    const reports = listEvaluationReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reportId: `report-${saved[0].id}`,
      createdAt: saved[0].time,
      subject: { kind: "rag-answer", id: saved[0].id, version: "rag-eval-1.3" },
      result: {
        skillId: "enterprise-rag-evaluation",
        version: "2.0.0",
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
    openJudgmentDetails();
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
    expect(panel.classList.contains("rag-drawer--evidence")).toBe(true);
    const evidenceRadar = details.getByTestId("rag-evidence-radar");
    expect(within(evidenceRadar).getAllByTestId("rag-evaluation-dimension")).toHaveLength(6);
    fireEvent.click(within(evidenceRadar).getByRole("button", { name: /需求满足 75%/ }));
    expect(within(evidenceRadar).getByRole("region", { name: "需求满足详情" })).toBeTruthy();
    expect(within(evidenceRadar).getByText(/直接介绍知识库/)).toBeTruthy();
    const gateGrid = details.getByTestId("rag-evaluation-gate-grid");
    expect(within(gateGrid).getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
    expect(within(gateGrid).getAllByTestId("rag-gate-status-orb")).toHaveLength(7);
    expect(within(gateGrid).getByRole("img", { name: "核心事实：通过" })).toBeTruthy();
    expect(details.getAllByTestId("rag-evidence-claim-status").every((tag) => tag.classList.contains("is-positive"))).toBe(true);
    expect(details.getAllByTestId("rag-evidence-source-scope").every((tag) => tag.classList.contains("is-info"))).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(details.getByRole("button", { name: "关闭评估面板" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("uses danger semantics for failed risk gates and restricted claims", () => {
    showPage();
    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-permission-leak" },
    });
    openJudgmentDetails();
    fireEvent.click(screen.getByRole("button", { name: "查看回答依据" }));

    const details = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    expect(details.getAllByTestId("rag-gate-status-orb").some((orb) => orb.getAttribute("aria-label")?.includes("发现风险"))).toBe(true);
    expect(details.getAllByTestId("rag-gate-status-orb").some((orb) => orb.classList.contains("is-failed"))).toBe(true);
    expect(details.getAllByTestId("rag-evidence-claim-status").some((tag) => tag.classList.contains("is-danger"))).toBe(true);
  });

  it("removes the test-set demo while preserving single-answer sample review", () => {
    showPage();
    expect(screen.getByText("单次问答")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "测试集演示" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "测试集与验收口径演示" })).toBeNull();
    expect(screen.queryByLabelText("核心统计指标")).toBeNull();
    expect(screen.getByRole("region", { name: "本轮回答质量" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评分规则" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评估记录" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "选择评估示例" }), {
      target: { value: "syn-permission-leak" },
    });
    expect(within(evaluation().getByLabelText("六维诊断评分")).getByTestId("rag-gauge-value").textContent).toBe("!");
    expect(evaluation().getByText("需修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
  });
});

function gradedAutomaticRun(pending = false): EnterpriseRagEvaluationRunDto {
  const run = completedAutomaticRun(), report = run.report!;
  report.evaluator = { ...report.evaluator, skillVersion: "2.0.0", judgeVersion: "2.0.0", ruleVersion: "rag-eval-1.3" };
  const original = report.judgments;
  const finding = { id: "finding-1", kind: pending ? "task" as const : "citation" as const, severity: pending ? "undetermined" as const : "improvement" as const,
    summary: pending ? "核心任务待补证" : "引用定位可更清晰", impact: pending ? "必要前提尚未确认。" : "事实有依据，不改变核心任务。", claimIds: ["claim-1"], evidenceIds: ["source-1"], dimensionIds: [pending ? "intent" as const : "citations" as const] };
  report.judgments = { ...original, schemaVersion: 2,
    claims: original.claims.map(claim => ({...claim,kind:"fact" as const,relevance:"core" as const})),
    task: {status:pending ? "undetermined" : "completed",rationale:pending ? "待补证。" : "本轮任务完成。",evidenceIds:["claim-1"]},findings:[finding],
  };
  if (pending) {
    report.judgments.gates.find(gate => gate.id === "availability")!.status = "pending";
    report.judgments.dimensions[0].level = null;
    report.result.dimensions[0] = { ...report.result.dimensions[0],status:"pending",score:null };
  }
  report.result = { ...report.result,version:"2.0.0",status: pending ? "pending" : "completed",answerVerdict:pending ? "pending" : "usable_with_improvements",score:pending ? null : 83,coverage:pending ? 80 : 100,recommendation:"publish_with_risk",
    summary:pending ? "必要证据尚未确认。" : "核心任务完成，保留引用改进项。",
    risks:[{id:finding.id,severity:pending ? "high" : "low",title:finding.summary,summary:finding.impact,evidenceIds:["source-1","claim-1"]}] };
  return run;
}

function checklistAutomaticRun(excludeCitations = false): EnterpriseRagEvaluationRunDto {
  const run = completedAutomaticRun(), report = run.report!;
  const checklist = createRagChecklist("支持私有化部署吗？", "query");
  if (excludeCitations) checklist.checks.filter((check) => check.dimensionId === "citations").forEach((check) => {
    check.applicable = false;
    check.exclusionReason = "合成用例在评估前批准此维度不适用。";
  });
  const checks = checklist.checks.map((check) => ({ id: check.id,
    status: !check.applicable ? "not_applicable" as const : check.id === "clarity_concise" ? "partial" as const : "met" as const,
    rationale: !check.applicable ? check.exclusionReason : check.id === "clarity_concise" ? "同一句说明重复一次，但不影响用户完成任务。" : "合成固定判断：本项满足。",
    evidenceIds: check.applicable ? ["claim-1", "source-1"] : [],
  }));
  const scored = scoreRagChecklist(checklist, checks);
  report.evaluator = { ...report.evaluator, skillVersion: "3.0.0", judgeVersion: "3.0.0", ruleVersion: "rag-eval-1.4" };
  report.judgments = {
    schemaVersion: 3, operationToken: "evaluation-operation-1", inputHash: "f".repeat(64), checklist, checks,
    dimensions: scored.dimensions.map((dimension) => ({ id: dimension.id,
      level: dimension.score === null ? null : 4 * dimension.score / dimension.maxScore,
      rationale: dimension.summary, evidenceIds: dimension.evidenceIds,
    })),
    gates: report.judgments.gates,
    claims: report.judgments.claims.map((claim) => ({ ...claim, kind: "fact" as const, relevance: "core" as const })),
    task: { status: "completed", rationale: "本轮任务完成。", evidenceIds: ["claim-1"] },
    findings: [{ id: "finding-1", rootCauseId: "root-cause-1", checkId: "clarity_concise", kind: "expression", severity: "improvement", summary: "有一处明确重复", impact: "不影响完成任务，但增加少量阅读负担。", claimIds: [], evidenceIds: ["source-1"], dimensionIds: ["clarity"] }],
    optionalSuggestions: [{ id: "suggestion-1", dimensionId: "clarity", summary: "可附示意图", benefit: "方便扫读，不影响当前答案质量。", evidenceIds: ["source-1"] }],
    summary: "合成 v3 报告。",
  };
  report.result = { ...report.result, version: "3.0.0", status: "completed", answerVerdict: "usable_with_improvements",
    score: scored.score, coverage: scored.coverage, recommendation: "publish_with_risk", summary: "核心任务完成，存在一处轻微重复。",
    dimensions: scored.dimensions.map(({ checks: _checks, ...dimension }) => dimension),
    risks: [{ id: "finding-1", severity: "low", title: "有一处明确重复", summary: "增加少量阅读负担。", evidenceIds: ["source-1"] }],
  };
  return run;
}

describe("rag-eval-1.3 server conclusions", () => {
  const runtime = () => liveRuntime({ taskId:"task-1",turnId:"turn-1",question:"支持私有化部署吗？",questionId:"question-1",answer:"支持私有化部署",answerId:"answer-1",sources:[{id:"source-1",title:"部署资料",kind:"published_knowledge"}] });
  it("shows 83 as usable with improvements and separates the finding with its quote", async () => {
    const run = gradedAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("待改进")).toBeTruthy());
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("83");
    openQualityDetails();
    fireEvent.click(screen.getByRole("button",{name:"查看完整方案"}));
    const dialog = within(screen.getByRole("dialog",{name:"优化方案"}));
    for (const heading of ["必须修复","建议改进","待补证"]) expect(dialog.getByRole("heading",{name:heading})).toBeTruthy();
    expect(dialog.getByText("支持私有化部署")).toBeTruthy();
    expect(dialog.getByText(/事实有依据，不改变核心任务/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button",{name:"完成"}));
    fireEvent.click(screen.getByRole("button",{name:"评分规则"}));
    expect(within(screen.getByRole("dialog",{name:"评分规则"})).getByText("rag-eval-1.3")).toBeTruthy();
  });
  it("renders a completed evaluation with an unknown quality conclusion as pending", async () => {
    const run = gradedAutomaticRun(true);
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getAllByText("待核验").length).toBeGreaterThan(0));
    expect(evaluation().queryByText(/可用\s*·?\s*待改进/)).toBeNull();
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("—");
  });
  it("keeps a historical report's actual rule in its explanation", async () => {
    const run = completedAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("优秀")).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"评分规则"}));
    const dialog = within(screen.getByRole("dialog",{name:"评分规则"}));
    expect(dialog.getByText("rag-eval-1.2")).toBeTruthy();
    expect(dialog.getByText(/历史结论仍按原冻结规则解释/)).toBeTruthy();
  });
  it("keeps the legacy warning without a current-rule banner or a paid task", async () => {
    const run = completedAutomaticRun(), report = run.report!;
    report.result.score = 83; report.result.recommendation = "not_recommended";
    report.result.summary = "旧规则引用门禁未通过。";
    report.judgments.gates.find(gate => gate.id === "citations")!.status = "failed";
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi,"start").mockRejectedValue(new Error("Must not start a paid evaluation"));
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(screen.getByTestId("rag-legacy-rule-notice").textContent).toContain("rag-eval-1.2"));
    expect(screen.queryByTestId("rag-current-rule")).toBeNull();
    expect(within(screen.getByTestId("rag-evaluation-score")).getByTestId("rag-gauge-value").textContent).toBe("!");
    expect(evaluation().getByText("不可用，优先修复")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByLabelText("重大问题，数值分不适用").textContent).toBe("!");
    expect(run.report?.result.score).toBe(83);
    expect(start).not.toHaveBeenCalled();
  });

});

describe("rag-eval-1.4 checklist and radar presentation", () => {
  const runtime = () => liveRuntime({ taskId:"task-1",turnId:"turn-1",question:"支持私有化部署吗？",questionId:"question-1",answer:"支持私有化部署",answerId:"answer-1",sources:[{id:"source-1",title:"部署资料",kind:"published_knowledge"}] });
  it("renders a current v3 report, expands check evidence, and keeps optional suggestions non-deducting", async () => {
    const run = checklistAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("待改进")).toBeTruthy());
    expect(screen.queryByTestId("rag-legacy-rule-notice")).toBeNull();
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("98.5");
    openQualityDetails();
    fireEvent.click(screen.getByRole("button", { name: /清晰可行动 90%/ }));
    expect(screen.getByText(/同一句说明重复一次/)).toBeTruthy();
    expect(screen.getAllByText(/可选建议 · 不扣分/).length).toBeGreaterThan(0);
    expect(screen.getByText(/可附示意图/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "评分规则" }));
    const rules = within(screen.getByRole("dialog", { name: "评分规则" }));
    expect(rules.getByText("rag-eval-1.4")).toBeTruthy();
    expect(rules.getByText(/满足100%／部分满足50%／不满足0%/)).toBeTruthy();
  });
  it("keeps a pre-frozen N/A dimension distinct from pending in both chart and evidence", async () => {
    const run = checklistAutomaticRun(true);
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("待改进")).toBeTruthy());
    openJudgmentDetails();
    expect(screen.getByRole("button", { name: /引用与时效 不适用/ })).toBeTruthy();
    expect(screen.queryByTestId("rag-radar-area")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看回答依据" }));
    const evidence = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    const evidenceRadar = within(evidence.getByTestId("rag-evidence-radar"));
    fireEvent.click(evidenceRadar.getByRole("button", { name: /引用与时效 不适用/ }));
    const citationDetail = within(evidenceRadar.getByRole("region", { name: "引用与时效详情" }));
    expect(citationDetail.getByText("不适用")).toBeTruthy();
    expect(citationDetail.queryByText("待判定")).toBeNull();
  });
});
