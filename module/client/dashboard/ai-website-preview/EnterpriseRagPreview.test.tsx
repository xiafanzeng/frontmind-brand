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
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";
import { liveEnterpriseRagEvaluationApi } from "../enterprise-rag-evaluation-api";
import {
  isGradedRagJudgment,
  type EnterpriseRagEvaluationRunDto,
} from "../../../contracts/enterprise-rag-evaluation-run";
import { createRagChecklist, scoreRagChecklist } from "../../../contracts/enterprise-rag-checklist";

const historyKey = "frontmind-rag-reviews-v1";
const nativeElementMatches = Element.prototype.matches;
const dimensionLabels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];
const riskLabels = ["核心事实", "关键引用", "权限与隐私", "高风险误导", "未知与澄清", "提示注入", "关键可用性"];
installRagPreviewFixtures(ragPreviewFixtures);

async function selectFirstPreviewConversation(waitForFrame = true) {
  fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
  const dialog = screen.getByRole("dialog", { name: "历史问答" });
  fireEvent.click(dialog.querySelector(".rag-conversation-popover__choice")!);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
  if (waitForFrame) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
async function showPage(waitForFrame = true) {
  const view = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} />);
  await selectFirstPreviewConversation(waitForFrame);
  return view;
}

function expectEmptyGauge() {
  const gauge = screen.getByTestId("rag-evaluation-score");
  expect(gauge.classList.contains("is-empty")).toBe(true);
  expect(within(gauge).queryByTestId("rag-gauge-pending")).toBeNull();
  expect(within(gauge).queryByTestId("rag-gauge-value")).toBeNull();
  const marker = within(gauge).getByTestId("rag-gauge-marker");
  expect(marker.classList.contains("is-pending")).toBe(true);
  expect(marker.getAttribute("fill")).toBe("#aeaeb2");
  expect(within(gauge).queryByRole("button")).toBeNull();
  expect(within(gauge).getByRole("img").getAttribute("aria-label")).toContain("待评估");
  expect(screen.getAllByTestId("rag-radar-point-marker")).toHaveLength(6);
  expect(screen.getAllByTestId("rag-radar-point-marker").every(item => item.classList.contains("is-empty"))).toBe(true);
  expect(screen.getByTestId("rag-task-panel")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /查看(?:评估状态|本轮评分)/ })).toBeNull();
}

function expectUnavailableGauge() {
  const gauge = screen.getByTestId("rag-evaluation-score");
  expect(gauge.classList.contains("is-danger")).toBe(true);
  expect(within(gauge).queryByTestId("rag-gauge-pending")).toBeNull();
  expect(within(gauge).queryByTestId("rag-gauge-value")).toBeNull();
  const marker = within(gauge).getByTestId("rag-gauge-marker");
  expect(marker.classList.contains("is-unavailable")).toBe(true);
  expect(marker.getAttribute("fill")).toBe("#aeaeb2");
  const control = within(gauge).getByRole("button", { name: "评分不适用" });
  fireEvent.focus(control);
  expect(within(gauge).getByRole("tooltip").textContent).toBe("评分不适用");
  fireEvent.blur(control);
}

async function chooseSample(id: string) {
  const sample = RAG_SAMPLE_CASES.find(item => item.id === id);
  if (!sample) throw new Error(`Unknown sample ${id}`);
  // Settle any pending focus return from a previously opened detail window.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
  const dialog = await screen.findByRole("dialog", { name: "历史问答" });
  fireEvent.click(within(dialog).getByRole("button", { name: name => name.startsWith(sample.question) }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull();
    expect(screen.getByLabelText("企业助手问答").querySelectorAll(".erag-user-message").item(0)?.textContent).toBe(sample.question);
  });
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
        model: "gpt-6.1-sol",
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

function expectTaskStatus(label: string, status: "pass" | "fail" | "pending" | "unverified", risk = false) {
  const indicator = screen.getByTestId("rag-task-status");
  expect(indicator.getAttribute("aria-label")).toBe(label);
  for (const value of ["pass", "fail", "pending", "unverified"]) {
    expect(indicator.classList.contains(`is-${value}`)).toBe(value === status);
  }
  expect(indicator.classList.contains("is-risk")).toBe(risk);
  const orb = indicator.querySelector(".rag-evaluation-status-orb");
  expect(orb?.getAttribute("aria-hidden")).toBe("true");
  expect(orb?.textContent).toBe("");
}

function openQualityDetails() {
  fireEvent.click(evaluation().getByRole("button", { name: "优化方案" }));
  return within(screen.getByRole("dialog", { name: "优化方案" }));
}

function retryAutomaticEvaluationButton() {
  return evaluation().getByRole("button", { name: /^(?:重新读取状态|重新发起评估|继续确认本次评估)$/ });
}

function failedAutomaticRun(taskId = "task-1", turnId = "turn-1"): EnterpriseRagEvaluationRunDto {
  return { ...completedAutomaticRun(), sourceQaTaskId: taskId, turnId, status: "failed", report: null, error: { code: "EVALUATION_FAILED", message: "本次评估尚未完成，请重试。" } };
}

function escapeFocusedDialog() {
  const focused = document.activeElement?.closest<HTMLElement>('[role="dialog"]');
  const dialog = focused ?? screen.queryAllByRole("dialog").at(-1);
  if (dialog) fireEvent.keyDown(dialog, { key: "Escape" });
}

function expandReviewDimensions(review: ReturnType<typeof within>) {
  for (const label of dimensionLabels) {
    const trigger = review.getByRole("button", { name: label });
    if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger);
  }
}

function openReview(expand = true) {
  fireEvent.click(evaluation().getByRole("button", { name: "人工评审" }));
  const review = within(screen.getByRole("dialog", { name: "人工评审与计算" }));
  if (expand) expandReviewDimensions(review);
  return review;
}

function openIntentReview() {
  const review = openReview(false);
  fireEvent.click(review.getByRole("button", { name: "需求满足" }));
  return review;
}

async function chooseReviewOption(review: ReturnType<typeof within>, label: string, option: string) {
  const trigger = review.getByRole("combobox", { name: label });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = review.getByRole("listbox");
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  fireEvent.click(review.getByRole("option", { name: option }));
  await waitFor(() => expect(document.activeElement === trigger).toBe(true));
}

function reviewEvidenceValues(review: ReturnType<typeof within>, label = "需求满足证据") {
  const list = review.queryByRole("list", { name: `${label}：已选证据` });
  return [...list?.querySelectorAll("[data-evidence-value]") ?? []]
    .map(item => item.getAttribute("data-evidence-value"));
}

function confirmReview() {
  const dialog = within(screen.getByRole("dialog", { name: "人工评审与计算" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "评审人" }), { target: { value: "reviewer-A" } });
  fireEvent.click(dialog.getByRole("checkbox", { name: /已对照当前回答与证据进行核验/ }));
  fireEvent.click(dialog.getByRole("button", { name: "保存评审并计算" }));
}

beforeEach(() => {
  // jsdom 26's selector engine recursively evaluates unsupported top-layer
  // pseudo-classes used by Floating UI. This suite has no native modal/fullscreen.
  vi.spyOn(Element.prototype, "matches").mockImplementation(function(this: Element, selector) {
    if (selector === ":modal" || selector === ":fullscreen") return false;
    return nativeElementMatches.call(this, selector);
  });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("enterprise RAG evidence-based review UI", () => {
  it("uses a fixed knowledge-number loading state and reveals the loaded counts", () => {
    const openKnowledge = vi.fn();
    const retryKnowledge = vi.fn();
    const loading = liveRuntime({
      loaded: false,
      failed: false,
      knowledgeBase: null,
      currentKnowledgeBase: null,
      sources: [],
      onOpenKnowledge: openKnowledge,
      onRetryKnowledge: retryKnowledge,
    });
    const page = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={loading} />);
    const stats = page.container.querySelector(".erag-stats")!;
    const knowledge = within(page.container.querySelector(".erag-knowledge-card") as HTMLElement);
    expect(stats.getAttribute("data-loading")).toBe("true");
    expect([...stats.querySelectorAll("strong")].map(item => item.textContent)).toEqual(["—", "—", "—"]);
    expect(page.container.querySelectorAll(".rag-knowledge-status-row")).toHaveLength(1);
    expect(knowledge.getByText("正在确认知识库、模型与服务状态。")).toBeTruthy();
    expect(knowledge.queryByText(/知识版本|尚未发布/)).toBeNull();
    expect(knowledge.queryByRole("button", { name: "查看知识与依据" })).toBeNull();
    fireEvent.click(knowledge.getByRole("button", { name: "前往知识库" }));
    fireEvent.click(knowledge.getByRole("button", { name: "重试加载" }));
    expect(openKnowledge).toHaveBeenCalledOnce();
    expect(retryKnowledge).toHaveBeenCalledOnce();
    page.rerender(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime()} />);
    expect(stats.hasAttribute("data-loading")).toBe(false);
    expect([...stats.querySelectorAll("strong")].map(item => item.textContent)).toEqual(["1", "12", "0"]);
    expect(knowledge.queryByText("正在确认知识库、模型与服务状态。")).toBeNull();
    expect(knowledge.getByText("企业知识库.zip · 当前发布 v7")).toBeTruthy();
    expect(knowledge.getByRole("button", { name: "查看知识与依据" })).toBeTruthy();
  });

  it("presents a knowledge refresh failure as one exclusive main status", () => {
    const page = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({ refreshFailed: true })} />);
    const knowledge = within(page.container.querySelector(".erag-knowledge-card") as HTMLElement);
    const message = "知识库状态暂时刷新失败，当前继续使用已确认的知识版本。";
    expect(knowledge.getByText(message)).toBeTruthy();
    expect(knowledge.getAllByRole("alert")).toHaveLength(1);
    expect(knowledge.queryByText(/企业知识库\.zip.*当前发布 v7/)).toBeNull();
    expect(page.container.querySelector(".rag-knowledge-refresh-note")).toBeNull();
  });

  it("keeps formal live free of synthetic examples and uses the frozen company identity", () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    const buildReportUrl = vi.fn((section: string, _coordinate?: unknown, exampleId?: string) => `/?report=1&example=${exampleId ?? ""}#${section}`);
    const runtime = liveRuntime({
      knowledgeBase: {
        snapshotId: "snapshot-live", version: 7, sourceFileName: "东莞台心医院-knowledge-base.zip",
        documentCount: 12, companyName: "东莞台心医院",
      },
      currentKnowledgeBase: {
        snapshotId: "snapshot-live", version: 7, sourceFileName: "东莞台心医院-knowledge-base.zip",
        documentCount: 12, companyName: "东莞台心医院",
      },
      conversationId: "conversation-real",
      conversationHistory: { items: [{ id: "conversation-real", title: "真实对话" }], activeId: "conversation-real", onSelect: vi.fn(), onDelete: vi.fn(), loading: true },
    });
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} buildReportUrl={buildReportUrl} live={runtime} />);
    expect(screen.getByText("企业知识问答")).toBeTruthy();
    expect(screen.queryByText("回答示例试用")).toBeNull();
    expect(screen.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(screen.getAllByText(/东莞台心医院-knowledge-base\.zip/)).toHaveLength(1);
    expect(screen.getByText(/东莞台心医院-knowledge-base\.zip.*当前发布 v7/)).toBeTruthy();
    expect(screen.getByText("你好！我是东莞台心医院 AI 助手，很高兴为你服务。")).toBeTruthy();
    expect(screen.queryByText(/当前基于/)).toBeNull();
    expect(screen.queryByText(/FrontMind 企业助手/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
    const history = within(screen.getByRole("dialog", { name: "历史问答" }));
    expect(history.getByRole("button", { name: "真实对话" })).toBeTruthy();
    for (const example of RAG_SAMPLE_CASES) {
      expect(history.queryByRole("button", { name: `${example.title} 示例` })).toBeNull();
      expect(screen.queryByText(example.question)).toBeNull();
    }
    expect(buildReportUrl.mock.calls.every(call => call[2] === undefined)).toBe(true);
    expect(start).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
  });

  it("shows a historical greeting's frozen company identity without an unavailable-history warning", () => {
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      conversationId: "greeting-conversation", loaded: true, failed: false,
      knowledgeBinding: "frozen_task", taskId: undefined,
      knowledgeBase: { snapshotId: "hospital-snapshot", version: 7, sourceFileName: "东莞台心医院-knowledge-base.zip", documentCount: 12, companyName: "东莞台心医院" },
      question: "你好", answer: "你好，有什么可以帮你？", evaluationNotRequired: true,
      chat: {
        question: "你好", answer: "你好，有什么可以帮你？", answerKey: "greeting-answer", sources: [], evaluation: "not_required",
        knowledgeBase: { snapshotId: "hospital-snapshot", version: 7, sourceFileName: "东莞台心医院-knowledge-base.zip", documentCount: 12, companyName: "东莞台心医院" },
      },
    })} />);
    expect(screen.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(screen.queryByText(/历史任务知识版本未知/)).toBeNull();
    expect(screen.queryByText(/历史回答的知识版本暂时无法读取/)).toBeNull();
  });

  it("never leaks the preview starter fixture into a formal live runtime", () => {
    const page = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime()} />);
    expect(screen.queryByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeNull();
    expect(screen.queryByText("暂无可用的预设问题。")).toBeNull();

    page.rerender(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      loaded: false,
      knowledgeBase: null,
      currentKnowledgeBase: null,
      starterQuestions: { current: null, phase: "initial_loading", loading: true, revision: 0 },
      onConfirmStarterQuestions: vi.fn(async () => true),
      onRegenerateStarterQuestions: vi.fn(async () => true),
    })} />);
    expect(screen.queryByRole("button", { name: "可以简单介绍一下你们吗？" })).toBeNull();
    const chat = within(screen.getByLabelText("企业助手问答"));
    expect(chat.getByRole("article", { name: "正在加载企业助手" })).toBeTruthy();
    expect(chat.queryByRole("article", { name: "企业助手欢迎" })).toBeNull();
    expect(chat.queryByRole("button", { name: "设置预设问题" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "输入企业 RAG 问题" })).toBeTruthy();

    const hospitalKnowledge = {
      snapshotId: "hospital-snapshot",
      version: 3,
      sourceFileName: "东莞台心医院-knowledge-base.zip",
      documentCount: 49,
      companyName: "东莞台心医院",
    };
    const firstDraft = ["医院地址在哪里？", "门诊时间如何安排？", "如何查询医生排班？"];
    const readyRuntime = liveRuntime({
      conversationId: "existing-conversation",
      loaded: true,
      knowledgeBase: hospitalKnowledge,
      currentKnowledgeBase: hospitalKnowledge,
      starterQuestions: { current: null, draft: { id: "first-draft", questions: firstDraft }, phase: "activating_initial", revision: 4 },
      onConfirmStarterQuestions: vi.fn(async () => true),
      onRegenerateStarterQuestions: vi.fn(async () => true),
    });
    page.rerender(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={readyRuntime} />);
    expect(chat.queryByRole("article", { name: "正在加载企业助手" })).toBeNull();
    expect(chat.getByText("东莞台心医院 AI 助手")).toBeTruthy();
    expect(chat.getByRole("button", { name: firstDraft[0] })).toBeTruthy();
    expect((chat.getByRole("button", { name: "设置预设问题" }) as HTMLButtonElement).disabled).toBe(false);

    page.rerender(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={{ ...readyRuntime, conversationId: undefined }} />);
    expect(chat.getByRole("button", { name: firstDraft[0] })).toBeTruthy();
    expect((chat.getByRole("button", { name: "设置预设问题" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks formal input and starter actions until the real knowledge gate is ready", () => {
    const openKnowledge = vi.fn();
    const retryKnowledge = vi.fn();
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      loaded: true, failed: false, knowledgeBase: null, currentKnowledgeBase: null,
      canCompose: false, canSend: false, onOpenKnowledge: openKnowledge, onRetryKnowledge: retryKnowledge,
      starterQuestions: {
        current: { id: "server-current", questions: ["可以简单介绍一下你们吗？", "你们主要提供哪些产品或服务？", "我可以先了解哪些核心信息？"] },
        revision: 1,
      },
    })} />);
    expect(screen.getByText("尚未发布可用知识库")).toBeTruthy();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "可以简单介绍一下你们吗？" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "前往知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(openKnowledge).toHaveBeenCalledOnce();
    expect(retryKnowledge).toHaveBeenCalledOnce();
  });

  it("falls back to the generic knowledge assistant for an old task without trusted company identity", () => {
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      conversationId: "legacy-task", question: "历史问题", answer: "历史回答",
      taskId: undefined, turnId: undefined, knowledgeBinding: "historical_unknown",
      knowledgeBase: null, canCompose: false, canSend: false,
    })} />);
    expect(screen.getByText("企业知识助手")).toBeTruthy();
    expect(screen.queryByText(/FrontMind 企业助手/)).toBeNull();
  });

  it("binds evaluation and report links to the selected historical answer while keeping the latest chat visible", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [] });
    const onSelectAnswer = vi.fn();
    const buildReportUrl = vi.fn((section: string) => `/#${section}`);
    const current = liveRuntime({ conversationId: "conversation", taskId: "task-new", turnId: "turn-new", questionId: "question-new", answerId: "answer-new", question: "新问题", answer: "最新回答", selectedAnswerKey: "new",
      onSelectAnswer, chat: { question: "新问题", answer: "最新回答", answerKey: "new", sources: [] },
      previousTurns: [{ id: "question-old", answerKey: "old", question: "旧问题", answer: "历史回答" }],
    });
    const page = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} buildReportUrl={buildReportUrl} live={current} />);
    await waitFor(() => expect(latest).toHaveBeenCalledWith({ sourceQaTaskId: "task-new", turnId: "turn-new" }));
    fireEvent.keyDown(screen.getByRole("article", { name: "历史回答" }), { key: "Enter" });
    expect(onSelectAnswer).toHaveBeenCalledWith("old");
    page.rerender(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} buildReportUrl={buildReportUrl} live={{ ...current, taskId: "task-old", turnId: "turn-old", questionId: "question-old", answerId: "answer-old", question: "旧问题", answer: "历史回答", selectedAnswerKey: "old" }} />);
    await waitFor(() => expect(latest).toHaveBeenCalledWith({ sourceQaTaskId: "task-old", turnId: "turn-old" }));
    expect(within(screen.getByRole("article", { name: "企业助手回复" })).getByText("最新回答")).toBeTruthy();
    expect(screen.getByRole("article", { name: "历史回答" }).getAttribute("data-selected")).toBe("true");
    expect(buildReportUrl).toHaveBeenCalledWith("records", { sourceQaTaskId: "task-old", turnId: "turn-old" }, undefined);
  });
  it("opens report chapters as new-tab links without changing the answer or opening a drawer", async () => {
    const buildReportUrl = vi.fn((section: string) => `/?view=enterprise-qa&report=1#${section}`);
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} buildReportUrl={buildReportUrl} />);
    expect(screen.getByText("让回答真正满足用户需求")).toBeTruthy();
    expect(screen.getByText("用企业资料回答客户问题，核对回答依据，找到改进方向。")).toBeTruthy();
    const resources = screen.getByRole("group", { name: "评估资料" });
    const qualityPanel = screen.getByRole("region", { name: "本轮回答质量" });
    expect(qualityPanel.contains(resources)).toBe(false);
    expect(within(qualityPanel).getByRole("heading", { name: "本轮回答质量" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /查看(?:评估状态|本轮评分)/ })).toBeNull();
    const question = screen.getByRole("textbox", { name: "输入企业 RAG 预览问题" });
    fireEvent.change(question, { target: { value: "保留这份草稿" } });
    for (const [name, anchor] of [["评分规则（在新标签页打开）", "rules"], ["评估记录（在新标签页打开）", "records"]]) {
      const link = within(resources).getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(`/?view=enterprise-qa&report=1#${anchor}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    expect((question as HTMLTextAreaElement).value).toBe("保留这份草稿");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("starts the title, summary and risk text together while revealing each in reading order", async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    await showPage(false);
    const tick = (time: number) => act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    });
    tick(1000);
    tick(1080);
    const summary = screen.getByRole("region", { name: "当前评估摘要" });
    const title = summary.querySelector(".rag-evaluation-status-title-text")!;
    const copy = screen.getByTestId("rag-evaluation-summary-copy");
    const risk = summary.querySelector(".rag-evaluation-metric-copy > span:first-child")!;
    for (const region of [title, copy, risk]) {
      const glyphs = region.querySelector('[aria-hidden="true"]')!.children;
      const opacity = Array.from(glyphs, glyph => Number((glyph as HTMLElement).style.opacity));
      expect(opacity[0]).toBeGreaterThan(0);
      expect(opacity[opacity.length - 1]).toBeLessThan(opacity[0]);
      expect(opacity.every((value, index) => index === 0 || value <= opacity[index - 1])).toBe(true);
    }
    expect(within(summary).getByRole("heading", { name: "待改进" })).toBeTruthy();
    expect(within(summary).getByText("关键风险已核验")).toBeTruthy();
    expect(within(summary).getByText("评审覆盖 100%")).toBeTruthy();
  });

  it("renders the approved side-by-side evaluation overview without obsolete copy", async () => {
    await showPage();

    const qualityPanel = screen.getByRole("region", { name: "本轮回答质量" });
    const taskPanel = screen.getByRole("region", { name: "客户任务结果" });
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
    expect(overview.children.item(1)).toBe(summary);
    const statusTitle = panel.getByRole("heading", { name: "待改进" });
    const summaryFlow = panel.getByTestId("rag-evaluation-summary-flow");
    const summaryCopy = panel.getByTestId("rag-evaluation-summary-copy");
    const supportingMeta = panel.getByTestId("rag-evaluation-supporting-meta");
    const metrics = panel.getByTestId("rag-evaluation-metrics");
    expect(overview.lastElementChild).toBe(summary);
    expect(overview.children).toHaveLength(2);
    expect(summary.lastElementChild).toBe(supportingMeta);
    expect(summaryFlow.firstElementChild).toBe(statusTitle);
    expect(statusTitle.nextElementSibling).toBe(summaryCopy);
    expect(summaryFlow.lastElementChild).toBe(summaryCopy);
    expect(supportingMeta.lastElementChild).toBe(metrics);
    expect(summaryFlow.contains(metrics)).toBe(false);
    expect(overview.contains(metrics)).toBe(true);
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
    expect(panel.getByRole("group", { name: "回答评估详情" })).toBeTruthy();
    expect(panel.queryByRole("button", { name: "理解本次判断" })).toBeNull();
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

  it("opens three direct detail panels in evidence, optimization, review order", async () => {
    await showPage();
    const quality = evaluation();
    const group = quality.getByRole("group", { name: "回答评估详情" });
    const actions = within(group).getAllByRole("button");
    expect(actions.map(action => action.textContent)).toEqual(["回答依据", "优化方案", "人工评审"]);
    expect(quality.queryByRole("button", { name: "理解本次判断" })).toBeNull();
    expect(quality.queryByRole("button", { name: "查看优化方案" })).toBeNull();
    expect(quality.queryByText(/网站建设.*三步/)).toBeNull();
    const radar = quality.getByRole("region", { name: "六维加权评分" });
    expect(radar.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const [index, title] of ["回答依据与陈述核验", "优化方案", "人工评审与计算"].entries()) {
      actions[index].focus();
      fireEvent.click(actions[index]);
      const panel = screen.getByRole("dialog", { name: title });
      expect(panel.contains(document.activeElement)).toBe(true);
      escapeFocusedDialog();
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(document.activeElement === actions[index]).toBe(true));
    }
    const task = within(screen.getByRole("region", { name: "客户任务结果" }));
    expect(task.getByText(/^必要完成点未全部满足/)).toBeTruthy();
    expect(task.getByText("正常问答")).toBeTruthy();
  });

  it("starts six review dimensions collapsed and preserves edits when independently folding them", async () => {
    await showPage();
    const review = openReview(false);
    const dimensions = review.getByRole("region", { name: "六维人工判断" });
    expect(dimensions.querySelector(".rag-review-card")).toBeNull();
    for (const label of dimensionLabels) {
      const trigger = review.getByRole("button", { name: label });
      expect(trigger.textContent).toBe(label);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(review.queryByRole("combobox", { name: `${label}等级` })).toBeNull();
      expect(review.queryByRole("textbox", { name: `${label}理由` })).toBeNull();
    }
    const intent = review.getByRole("button", { name: "需求满足" });
    const correctness = review.getByRole("button", { name: "正确与有据" });
    fireEvent.click(intent);
    const reason = review.getByRole("textbox", { name: "需求满足理由" });
    const initialEvidence = reviewEvidenceValues(review);
    await chooseReviewOption(review, "需求满足等级", "2 · 部分满足");
    fireEvent.change(reason, { target: { value: "折叠后仍应保留的人工判断。" } });
    fireEvent.click(correctness);
    expect(intent.getAttribute("aria-expanded")).toBe("true");
    expect(correctness.getAttribute("aria-expanded")).toBe("true");
    reason.focus();
    fireEvent.click(intent);
    expect(document.activeElement === intent).toBe(true);
    expect(review.queryByRole("textbox", { name: "需求满足理由" })).toBeNull();
    expect(review.getByRole("textbox", { name: "正确与有据理由" })).toBeTruthy();
    fireEvent.click(intent);
    expect(review.getByRole("combobox", { name: "需求满足等级" }).textContent).toContain("2 · 部分满足");
    expect((review.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("折叠后仍应保留的人工判断。");
    expect(reviewEvidenceValues(review)).toEqual(initialEvidence);
    fireEvent.click(review.getByRole("button", { name: "关闭评估面板" }));
    const reopened = openReview(false);
    expect(reopened.getByRole("button", { name: "需求满足" }).getAttribute("aria-expanded")).toBe("false");
    expect(reopened.queryByRole("textbox", { name: "需求满足理由" })).toBeNull();
    fireEvent.click(reopened.getByRole("button", { name: "需求满足" }));
    expect((reopened.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("折叠后仍应保留的人工判断。");
    fireEvent.click(reopened.getByRole("button", { name: "需求满足" }));
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0].dimensions.find((dimension: { id: string }) => dimension.id === "intent")).toMatchObject({
      level: 2, rationale: "折叠后仍应保留的人工判断。",
    });
  });

  it("opens evidence directly on its ordered topics without the removed context overview", async () => {
    await showPage();
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    const dialog = screen.getByRole("dialog", { name: "回答依据与陈述核验" });
    const evidence = within(dialog);
    expect([...dialog.querySelectorAll(".rag-evidence-topic > h3")].map(heading => heading.textContent)).toEqual([
      "陈述与证据", "来源原文", "本次判断记录", "关键风险核验",
    ]);
    expect(evidence.queryByText("核对本次回答的来源、陈述与风险记录，了解评估结论的依据。")).toBeNull();
    expect(evidence.queryByText("FrontMind 可以帮企业做什么？")).toBeNull();
    expect(evidence.queryByText("知识版本：KB-SYN-v1")).toBeNull();
    expect(dialog.querySelector(".rag-evidence-evaluation")).toBeNull();
    expect(evidence.getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
  });

  it("starts every risk theme collapsed and preserves its draft when folding, reopening and saving", async () => {
    await showPage();
    const review = openReview(false);
    for (const label of riskLabels) {
      const trigger = review.getByRole("button", { name: label });
      expect(trigger.textContent).toBe(label);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(review.queryByRole("combobox", { name: `${label}风险核验` })).toBeNull();
      expect(review.queryByRole("textbox", { name: `${label}风险核验依据` })).toBeNull();
    }
    const privacy = review.getByRole("button", { name: "权限与隐私" });
    const facts = review.getByRole("button", { name: "核心事实" });
    fireEvent.click(privacy);
    fireEvent.click(facts);
    expect(privacy.getAttribute("aria-expanded")).toBe("true");
    expect(facts.getAttribute("aria-expanded")).toBe("true");
    const reason = review.getByRole("textbox", { name: "权限与隐私风险核验依据" });
    fireEvent.keyDown(review.getByRole("combobox", { name: "权限与隐私风险核验" }), { key: "ArrowDown" });
    const riskMenu = review.getByRole("listbox");
    await waitFor(() => expect(riskMenu.contains(document.activeElement)).toBe(true));
    expect(within(riskMenu).getAllByRole("option").map(option => option.textContent)).toEqual(["通过", "待核验", "发现风险"]);
    fireEvent.keyDown(riskMenu, { key: "Escape" });
    await waitFor(() => expect(document.activeElement === review.getByRole("combobox", { name: "权限与隐私风险核验" })).toBe(true));
    await chooseReviewOption(review, "权限与隐私风险核验", "发现风险");
    fireEvent.change(reason, { target: { value: "折叠后保留的风险核验依据。" } });
    reason.focus();
    fireEvent.click(privacy);
    expect(document.activeElement === privacy).toBe(true);
    expect(review.queryByRole("textbox", { name: "权限与隐私风险核验依据" })).toBeNull();
    expect(review.getByRole("combobox", { name: "核心事实风险核验" })).toBeTruthy();
    fireEvent.click(privacy);
    expect(review.getByRole("combobox", { name: "权限与隐私风险核验" }).textContent).toContain("发现风险");
    expect((review.getByRole("textbox", { name: "权限与隐私风险核验依据" }) as HTMLTextAreaElement).value).toBe("折叠后保留的风险核验依据。");
    fireEvent.click(review.getByRole("button", { name: "关闭评估面板" }));
    const reopened = openReview(false);
    expect(reopened.getByRole("button", { name: "权限与隐私" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(reopened.getByRole("button", { name: "权限与隐私" }));
    expect((reopened.getByRole("textbox", { name: "权限与隐私风险核验依据" }) as HTMLTextAreaElement).value).toBe("折叠后保留的风险核验依据。");
    fireEvent.click(reopened.getByRole("button", { name: "权限与隐私" }));
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0].gates.find((gate: { id: string }) => gate.id === "permissions")).toMatchObject({
      status: "failed", reason: "折叠后保留的风险核验依据。",
    });
  });

  it("toggles evidence choices and preserves the exact selected values across folding, reopening and saving", async () => {
    await showPage();
    let review = openIntentReview();
    const original = reviewEvidenceValues(review);
    const intent = review.getByRole("button", { name: "需求满足" });
    fireEvent.click(review.getByRole("button", { name: "需求满足证据" }));
    const paragraph = review.getByRole("option", { name: /回答原文 · 第 1 段/ });
    fireEvent.click(paragraph);
    expect(reviewEvidenceValues(review)).toEqual([...original, previewRagAnswer]);
    fireEvent.click(paragraph);
    expect(reviewEvidenceValues(review)).toEqual(original);
    fireEvent.click(paragraph);
    fireEvent.keyDown(paragraph, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "人工评审与计算" })).toBeTruthy();
    const list = review.getByRole("list", { name: "需求满足证据：已选证据" });
    const firstRemove = within(list).getAllByRole("button", { name: /^移除/ })[0];
    fireEvent.click(firstRemove);
    const expected = [...original.slice(1), previewRagAnswer];
    expect(reviewEvidenceValues(review)).toEqual(expected);
    fireEvent.click(intent);
    fireEvent.click(intent);
    expect(reviewEvidenceValues(review)).toEqual(expected);
    fireEvent.click(review.getByRole("button", { name: "关闭评估面板" }));
    review = openIntentReview();
    expect(reviewEvidenceValues(review)).toEqual(expected);
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0].dimensions.find((item: { id: string }) => item.id === "intent").evidenceIds).toEqual(expected);
  });

  it("allows selecting actual answer paragraphs without a source or automatic report", async () => {
    await showPage();
    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    const paragraph = "当前公开资料未说明离线安装能力。";
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: `${paragraph}\n\n请向产品负责人确认部署条件。` } });
    fireEvent.change(editor.getByRole("textbox", { name: "用户任务" }), { target: { value: "确认离线部署要求" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));
    const review = openIntentReview();
    expect(reviewEvidenceValues(review)).toEqual([]);
    fireEvent.click(review.getByRole("button", { name: "需求满足证据" }));
    expect(review.queryByText("参考资料", { exact: true })).toBeNull();
    fireEvent.click(review.getByRole("option", { name: /回答原文 · 第 1 段/ }));
    expect(reviewEvidenceValues(review)).toEqual([paragraph]);
    expect(review.queryByText(/已核验来源/)).toBeNull();
  });

  it("keeps legacy locators and freezes claim descriptions while a failed server evaluation is retried", async () => {
    const original = completedAutomaticRun();
    const originalClaim = "支持私有化部署";
    const legacyLocator = "旧手填定位，保留标点及完整原文";
    original.report!.judgments.dimensions[0].evidenceIds = ["claim-1", legacyLocator];
    const refreshed = structuredClone(original);
    refreshed.operationId = "evaluation-operation-2";
    refreshed.report!.reportId = "evaluation-report-2";
    refreshed.report!.judgments.claims[0].statement = "新报告里同编号的另一条陈述";
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: failedAutomaticRun(), history: [original] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(refreshed);
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      taskId: "task-1", turnId: "turn-1", question: "你们支持哪些部署方式？", questionId: "question-1",
      answer: "支持私有化部署，具体环境要求请联系项目团队确认。", answerId: "answer-1",
      sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
    })} />);
    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"));
    let review = openIntentReview();
    expect(reviewEvidenceValues(review)).toEqual(["claim-1", legacyLocator]);
    expect(within(review.getByRole("list", { name: "需求满足证据：已选证据" })).getByText(originalClaim, { exact: true })).toBeTruthy();
    const reevaluate = retryAutomaticEvaluationButton();
    await act(async () => {
      fireEvent.click(reevaluate);
      await Promise.resolve();
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(evaluation().queryByText(/正在评估本次回答/)).toBeNull();
    fireEvent.click(review.getByRole("button", { name: "需求满足证据" }));
    expect(within(review.getByRole("group", { name: "陈述" })).getByRole("option", { name: new RegExp(originalClaim) })).toBeTruthy();
    expect(review.queryByText("新报告里同编号的另一条陈述", { exact: true })).toBeNull();
    fireEvent.keyDown(within(review.getByRole("group", { name: "陈述" })).getByRole("option", { name: new RegExp(originalClaim) }), { key: "Escape" });
    fireEvent.click(review.getByRole("button", { name: "关闭评估面板" }));
    review = openIntentReview();
    expect(reviewEvidenceValues(review)).toEqual(["claim-1", legacyLocator]);
    const selected = within(review.getByRole("list", { name: "需求满足证据：已选证据" }));
    expect(selected.getByText(originalClaim, { exact: true })).toBeTruthy();
    expect(selected.getByText(legacyLocator, { exact: true })).toBeTruthy();
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0].dimensions.find((item: { id: string }) => item.id === "intent").evidenceIds).toEqual(["claim-1", legacyLocator]);
  });

  it("keeps three desktop windows open and activates an existing review without replacing its draft", async () => {
    await showPage();
    for (const name of ["回答依据", "优化方案", "人工评审"]) {
      fireEvent.click(evaluation().getByRole("button", { name }));
    }
    expect(screen.getAllByRole("dialog")).toHaveLength(3);
    const titles = screen.getAllByRole("dialog").map(dialog => dialog.getAttribute("aria-labelledby"));
    expect(new Set(titles).size).toBe(3);
    expect(screen.getAllByRole("dialog").every(dialog => !dialog.hasAttribute("aria-modal"))).toBe(true);
    const review = within(screen.getByRole("dialog", { name: "人工评审与计算" }));
    fireEvent.click(review.getByRole("button", { name: "需求满足" }));
    fireEvent.change(review.getByRole("textbox", { name: "需求满足理由" }), { target: { value: "保留正在填写的对照判断。" } });
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    expect(screen.getByRole("dialog", { name: "回答依据与陈述核验" }).classList.contains("is-active")).toBe(true);
    fireEvent.click(evaluation().getByRole("button", { name: "人工评审" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(3);
    expect((review.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("保留正在填写的对照判断。");
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the detail headers clean and reserves the bottom action bar for manual review", async () => {
    await showPage();
    for (const [action, title] of [["回答依据", "回答依据与陈述核验"], ["优化方案", "优化方案"], ["人工评审", "人工评审与计算"]]) {
      fireEvent.click(evaluation().getByRole("button", { name: action }));
      const dialog = screen.getByRole("dialog", { name: title });
      const header = dialog.querySelector(":scope > header");
      expect(header?.textContent).not.toMatch(/rag-eval-[\d.]+/);
      const footer = dialog.querySelector(":scope > footer");
      if (action === "人工评审") {
        expect(footer).not.toBeNull();
        expect(within(footer as HTMLElement).getByRole("button", { name: "保存评审并计算" })).toBeTruthy();
      } else {
        expect(footer).toBeNull();
        expect(within(dialog).queryByRole("button", { name: "完成" })).toBeNull();
      }
    }
  });

  it("restores the same answer's review draft after closing and after visiting another sample", async () => {
    await showPage();
    const original = "syn-capability-overview";
    let review = openReview();
    fireEvent.change(review.getByRole("textbox", { name: "需求满足理由" }), { target: { value: "这份草稿属于原来的回答。" } });
    fireEvent.change(review.getByRole("textbox", { name: "评审人" }), { target: { value: "draft-reviewer" } });
    fireEvent.click(review.getByRole("checkbox", { name: /已对照当前回答与证据进行核验/ }));
    fireEvent.click(review.getByRole("button", { name: "关闭评估面板" }));
    review = openReview();
    expect((review.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("这份草稿属于原来的回答。");
    expect((review.getByRole("textbox", { name: "评审人" }) as HTMLInputElement).value).toBe("draft-reviewer");
    expect((review.getByRole("checkbox", { name: /已对照当前回答与证据进行核验/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    await chooseSample("syn-assistant-workflow");
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    const other = openReview();
    expect((other.getByRole("textbox", { name: "评审人" }) as HTMLInputElement).value).toBe("");
    expect((other.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).not.toBe("这份草稿属于原来的回答。");
    await chooseSample(original);
    review = openReview();
    expect((review.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("这份草稿属于原来的回答。");
    expect((review.getByRole("textbox", { name: "评审人" }) as HTMLInputElement).value).toBe("draft-reviewer");
    expect(window.localStorage.getItem(historyKey)).toBeNull();
  });

  it("saves only the review window while keeping evidence and optimization available", async () => {
    await showPage();
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    fireEvent.click(evaluation().getByRole("button", { name: "优化方案" }));
    openReview();
    confirmReview();
    expect(screen.queryByRole("dialog", { name: "人工评审与计算" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "回答依据与陈述核验" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "优化方案" })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")).toHaveLength(1);
  });

  it("clears in-memory drafts when the workspace changes", async () => {
    const runtime = liveRuntime({ conversationId: "conversation-a", question: "原问题", questionId: "q-a", answer: "原回答", answerId: "a-a" });
    const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn(), live: runtime };
    const page = render(<EnterpriseRagPreview {...props} storageScopeKey="workspace-a" />);
    const review = openReview();
    fireEvent.change(review.getByRole("textbox", { name: "评审人" }), { target: { value: "private-draft" } });
    page.rerender(<EnterpriseRagPreview {...props} storageScopeKey="workspace-b" />);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    page.rerender(<EnterpriseRagPreview {...props} storageScopeKey="workspace-a" />);
    const reopened = openReview();
    expect((reopened.getByRole("textbox", { name: "评审人" }) as HTMLInputElement).value).toBe("");
  });

  it("keeps the review draft while switching between desktop windows and a single mobile sheet", async () => {
    const width = window.innerWidth;
    const setWidth = (value: number) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value });
      fireEvent(window, new Event("resize"));
    };
    try {
      await showPage();
      const desktop = openReview();
      fireEvent.change(desktop.getByRole("textbox", { name: "需求满足理由" }), { target: { value: "跨显示方式保留的草稿。" } });
      setWidth(390);
      const sheet = screen.getByRole("dialog", { name: "人工评审与计算" });
      expect(sheet.getAttribute("aria-modal")).toBe("true");
      expect(document.body.style.overflow).toBe("hidden");
      const tabs = within(sheet).getByRole("navigation", { name: "回答评估详情切换" });
      fireEvent.click(within(tabs).getByRole("button", { name: "回答依据" }));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      const evidence = screen.getByRole("dialog", { name: "回答依据与陈述核验" });
      fireEvent.click(within(within(evidence).getByRole("navigation", { name: "回答评估详情切换" })).getByRole("button", { name: "人工评审" }));
      const restored = within(screen.getByRole("dialog", { name: "人工评审与计算" }));
      expect(restored.getByRole("button", { name: "需求满足" }).getAttribute("aria-expanded")).toBe("true");
      expect((restored.getByRole("textbox", { name: "需求满足理由" }) as HTMLTextAreaElement).value).toBe("跨显示方式保留的草稿。");
      setWidth(width);
      expect(screen.getAllByRole("dialog")).toHaveLength(2);
      expect(document.body.style.overflow).toBe("");
    } finally {
      setWidth(width);
    }
  });

  it("disables optimization at full marks and restores it when the answer changes", async () => {
    await showPage();
    await chooseSample("syn-unknown-deadline");
    const optimize = evaluation().getByRole("button", { name: "优化方案" });
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("100");
    expect(optimize.hasAttribute("disabled")).toBe(true);
    fireEvent.click(optimize);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(evaluation().getByRole("button", { name: "回答依据" }).hasAttribute("disabled")).toBe(false);
    expect(evaluation().getByRole("button", { name: "人工评审" }).hasAttribute("disabled")).toBe(false);
    await chooseSample("syn-capability-overview");
    expect(evaluation().getByRole("button", { name: "优化方案" }).hasAttribute("disabled")).toBe(false);
  });

  it("leads with a goal and presents the strategy in a consistent reading order", async () => {
    await showPage();
    const cases = [["syn-capability", "优先处理"], ["syn-assistant-workflow", "建议完善"], ["syn-permission-leak", "立即修复"]];
    for (const [id, label] of cases) {
      if (id !== "syn-capability") await chooseSample(id);
      const plan = openQualityDetails();
      const summary = plan.getByTestId("rag-improvement-summary");
      expect(summary.textContent?.length).toBeGreaterThan(20);
      expect(summary.querySelector('.rag-priority-label')).toBeNull();
      expect(plan.getAllByText(label).length).toBeGreaterThan(0);
      expect(plan.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual([
        "优化目标", "调整步骤", "改写示例", "检查要点",
      ]);
      expect(plan.queryByRole("heading", { name: "下一步操作指引缺失" })).toBeNull();
      expect(plan.queryByRole("heading", { name: /高优先级风险|一般记录项/ })).toBeNull();
      expect(plan.queryByText(/^P[012]$/)).toBeNull();
      expect(plan.queryByText("问题：")).toBeNull();
      expect(plan.queryByText("方案：")).toBeNull();
      expect(plan.queryByText(/^当前没有已确认的高优先级风险/)).toBeNull();
      expect(plan.queryByText(/^当前没有一般记录项/)).toBeNull();
      fireEvent.click(plan.getByRole("button", { name: "关闭评估面板" }));
    }
  });

  it("keeps answer quality and task completion as separate conclusions", async () => {
    await showPage();

    expect(evaluation().getByRole("heading", { name: "待改进" })).toBeTruthy();
    expect(screen.getByTestId("rag-task-status").textContent).toContain("缺下一步");

    await chooseSample("syn-assistant-workflow");

    expect(evaluation().getByRole("heading", { name: "待改进" })).toBeTruthy();
    expect(screen.getByTestId("rag-task-status").textContent).toContain("通过");
  });

  it("distinguishes missing task steps from confirmed risks and resets manual tasks without automatic evaluation", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(completedAutomaticRun());
    const observe = vi.spyOn(liveEnterpriseRagEvaluationApi, "observe").mockResolvedValue(completedAutomaticRun());
    await showPage();

    expectTaskStatus("缺下一步", "fail");
    await chooseSample("syn-permission-leak");
    expectTaskStatus("发现风险", "fail", true);
    await chooseSample("syn-assistant-workflow");
    expectTaskStatus("通过", "pass");
    await chooseSample("syn-deployment-prereq");
    expectTaskStatus("待确认", "unverified");

    await chooseSample("syn-permission-leak");
    expectTaskStatus("发现风险", "fail", true);
    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "用户任务" }), { target: { value: "确认可公开提供的部署说明" } });
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "请联系项目团队核对可公开提供的部署资料。" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));
    expectTaskStatus("待确认", "unverified");

    expect(latest).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("shows the legacy task-analysis state when a v1 high-scoring report is loaded without starting evaluation", async () => {
    const run = completedAutomaticRun();
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(run);
    const observe = vi.spyOn(liveEnterpriseRagEvaluationApi, "observe").mockResolvedValue(run);
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      taskId: "task-1", turnId: "turn-1", questionId: "question-1", answerId: "answer-1",
      question: "你们支持哪些部署方式？", answer: "支持私有化部署，具体环境要求请联系项目团队确认。",
    })} />);

    expect(evaluation().getByText("正在评估本次回答")).toBeTruthy();
    expectTaskStatus("正在评估本次回答", "unverified");
    await waitFor(() => expect(screen.getByTestId("rag-gauge-value").textContent).toBe("93"));
    expectTaskStatus("暂无任务分析", "unverified");
    expect(screen.getByText("该历史评估版本未包含客户任务结论。")).toBeTruthy();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("observes the overview and visible summary without dynamically rewriting gauge dimensions", async () => {
    const observers: TestResizeObserver[] = [];
    class TestResizeObserver {
      constructor() { observers.push(this); }
      observe = vi.fn();
      unobserve() {}
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const page = await showPage();

    const overview = screen.getByTestId("rag-evaluation-overview");
    const overviewObserver = observers.find(observer => observer.observe.mock.calls.some(([target]) => target === overview));
    expect(overviewObserver).toBeDefined();
    expect(overviewObserver!.observe).toHaveBeenCalledWith(screen.getByTestId("rag-evaluation-summary-copy"));
    expect(overviewObserver!.observe).toHaveBeenCalledTimes(2);
    expect(overview.style.getPropertyValue("--rag-evaluation-card-width")).toBe("");
    expect(overview.style.getPropertyValue("--rag-evaluation-card-height")).toBe("");
    page.unmount();
    expect(overviewObserver!.disconnect).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId("rag-task-status").textContent).toContain("待评估");
    expect(evaluation().getByText("待评估")).toBeTruthy();
    expect(screen.getByText(/企业知识库\.zip.*当前发布 v7/)).toBeTruthy();
    expect(screen.queryByText(/知识版本 v7/)).toBeNull();
    fireEvent.change(screen.getByTestId("rag-question-input"), {
      target: { value: "你们支持哪些部署方式？" },
    });
    fireEvent.click(screen.getByTestId("rag-submit"));

    await waitFor(() =>
      expect(runtime.onAsk).toHaveBeenCalledWith("你们支持哪些部署方式？"),
    );
    expect(screen.queryByText(previewRagAnswer)).toBeNull();
    expect(screen.getByTestId("rag-answer").textContent).toContain(
      "你可以直接输入问题",
    );
  });

  it("waits 900ms for a synthetic submission, keeps drafts, and cancels an old preview", async () => {
    await showPage();
    vi.useFakeTimers();
    try {
      const question = screen.getByRole("textbox", { name: "输入企业 RAG 预览问题" });
      const originalQuestion = document.querySelector(".erag-user-message")!.textContent!;
      fireEvent.change(question, { target: { value: originalQuestion } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "试用问题" })));
      expect(screen.getByTestId("rag-chat-wait").textContent).toBe("正在读取文件…");
      fireEvent.change(question, { target: { value: "下一条草稿" } });
      await act(async () => vi.advanceTimersByTime(899));
      expect(screen.queryByTestId("rag-preview-answer")).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.getByTestId("rag-preview-answer").textContent).toContain(previewRagAnswer);
      expect((question as HTMLTextAreaElement).value).toBe("下一条草稿");
      await act(async () => vi.advanceTimersByTime(360));
      fireEvent.change(question, { target: { value: originalQuestion } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "试用问题" })));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "停止回答" })));
      await act(async () => vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId("rag-preview-answer")).toBeNull();
      expect(screen.getByText("已停止回答。")).toBeTruthy();
    } finally { vi.useRealTimers(); }
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
    expect(evidence.queryByText(/知识版本：v7/)).toBeNull();
    expect(evidence.getAllByTestId("rag-source")[0].textContent).toContain("v7");
    expect(screen.queryByRole("button", { name: "编辑回答" })).toBeNull();
    expect(screen.queryByText("服务端原始回答")).toBeNull();
  });

  it("distinguishes an evaluated report with no claims from an unevaluated answer", async () => {
    const run = completedAutomaticRun();
    run.report!.judgments.claims = [];
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(run);
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={liveRuntime({
          taskId: "task-1",
          turnId: "turn-1",
          question: "你们支持哪些部署方式？",
          questionId: "question-1",
          answer: "具体环境要求请联系项目团队确认。",
          answerId: "answer-1",
          sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
        })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"));
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    const evidence = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    expect(evidence.getByText("本次报告没有陈述级核验记录。")).toBeTruthy();
    expect(evidence.queryByText(/^尚无服务端陈述级自动评估/)).toBeNull();
    expect(evidence.getByText("部署说明")).toBeTruthy();
    expect(evidence.getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
    const dialog = screen.getByRole("dialog", { name: "回答依据与陈述核验" });
    expect([...dialog.querySelectorAll(".rag-evidence-topic > h3")].map(heading => heading.textContent)).toEqual([
      "陈述与证据", "参考资料", "自动评估六维判断", "关键风险核验", "不可变报告溯源",
    ]);
    expect(evidence.getByTestId("rag-auto-evaluation-report").textContent).toContain("v7");
    expect(start).not.toHaveBeenCalled();
  });

  it("reads a completed server report and never starts another paid evaluation when details open", async () => {
    const run = completedAutomaticRun();
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      taskId: "task-1", turnId: "turn-1", question: "你们支持哪些部署方式？", questionId: "question-1",
      answer: "支持私有化部署，具体环境要求请联系项目团队确认。", answerId: "answer-1",
      sources: [{ id: "source-1", title: "部署说明", kind: "published_knowledge" }],
    })} />);
    await waitFor(() => expect(latest).toHaveBeenCalledWith({ sourceQaTaskId: "task-1", turnId: "turn-1" }));
    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"));
    for (const action of ["回答依据", "优化方案", "人工评审"]) {
      fireEvent.click(evaluation().getByRole("button", { name: action }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.queryByTestId("rag-auto-evaluate")).toBeNull();
      expect(start).not.toHaveBeenCalled();
      escapeFocusedDialog();
    }
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    expect(screen.getAllByTestId("rag-evaluation-gate")).toHaveLength(7);
    expect(screen.getByTestId("rag-auto-evaluation-report").textContent).toContain("evaluation-report-1");
    expect(screen.queryByText(/gpt-6\.1-sol|XTY Codex/)).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)("ignores an old answer's late POST %s while a new answer is submitting", async (outcome) => {
    let resolveFirst!: (run: EnterpriseRagEvaluationRunDto) => void;
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (run: EnterpriseRagEvaluationRunDto) => void;
    const firstRequest = new Promise<EnterpriseRagEvaluationRunDto>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    const secondRequest = new Promise<EnterpriseRagEvaluationRunDto>(resolve => { resolveSecond = resolve; });
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockImplementation(async coordinate => ({ latest: failedAutomaticRun(coordinate.sourceQaTaskId, coordinate.turnId), history: [] }));
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockImplementation(input => input.sourceQaTaskId === "task-1" ? firstRequest : secondRequest);
    const first = liveRuntime({ conversationId: "conversation-1", taskId: "task-1", turnId: "turn-1", question: "第一个问题", questionId: "question-1", answer: "第一个回答", answerId: "answer-1" });
    const second = liveRuntime({ conversationId: "conversation-2", taskId: "task-2", turnId: "turn-2", question: "第二个问题", questionId: "question-2", answer: "第二个回答", answerId: "answer-2" });
    const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn(), storageScopeKey: "late-post-workspace" };
    const page = render(<EnterpriseRagPreview {...props} live={first} />);
    await waitFor(() => expect(retryAutomaticEvaluationButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(retryAutomaticEvaluationButton());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    page.rerender(<EnterpriseRagPreview {...props} live={second} />);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    await waitFor(() => expect(retryAutomaticEvaluationButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(retryAutomaticEvaluationButton());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    const evidence = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    await act(async () => {
      if (outcome === "success") resolveFirst(completedAutomaticRun());
      else rejectFirst(new Error("旧回答提交迟到的错误"));
      await Promise.resolve();
    });
    expect(evaluation().getByText("正在评估本次回答")).toBeTruthy();
    expect(evaluation().queryByRole("button", { name: "重试" })).toBeNull();
    expect(screen.queryByText("旧回答提交迟到的错误")).toBeNull();
    expect(screen.queryByTestId("rag-auto-evaluation-report")).toBeNull();
    expect(listEvaluationReports(scopedEvaluationStorage(props.storageScopeKey))).toHaveLength(0);

    const secondRun = completedAutomaticRun();
    secondRun.operationId = "evaluation-operation-2";
    secondRun.sourceQaTaskId = "task-2";
    secondRun.turnId = "turn-2";
    Object.assign(secondRun.report!, { reportId: "evaluation-report-2", sourceQaTaskId: "task-2", sourceTurnId: "turn-2", conversationId: "conversation-2", questionMessageId: "question-2", answerMessageId: "answer-2" });
    secondRun.report!.result.score = 81;
    await act(async () => { resolveSecond(secondRun); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("81"));
    expect(evaluation().queryByRole("button", { name: "重试" })).toBeNull();
    expect(evidence.getByTestId("rag-auto-evaluation-report").textContent).toContain("evaluation-report-2");
    expect(evidence.getByTestId("rag-auto-evaluation-report").textContent).not.toContain("evaluation-report-1");
  });

  it("opens an empty improvement plan when the current report has no repair items", async () => {
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

    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"));
    const quality = openQualityDetails();
    expect(quality.getByText("当前记录没有待修复项；继续用更多真实场景验证。")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "优化方案" })).toBeTruthy();
    expect(quality.queryByRole("heading", { name: "调整步骤" })).toBeNull();
    expect(quality.queryByRole("heading", { name: "改写示例" })).toBeNull();
    expect(quality.queryByRole("button", { name: "查看完整方案" })).toBeNull();
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
    expect(screen.queryByText("报告 evaluation-report-1")).toBeNull();
    expect(screen.queryByText(/服务器留痕|gpt-6\.1-sol|XTY Codex/)).toBeNull();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText("服务端自动评估记录")).toBeTruthy();
    expect(records.getByLabelText("六维诊断评分 93，满分 100").textContent).toBe("93/100");
    expect(records.getByText(/报告：evaluation-report-1/)).toBeTruthy();
    expect(records.queryByText(/gpt-6\.1-sol|XTY Codex/)).toBeNull();
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
      expect(evaluation().getByText("正在评估本次回答").classList.contains("rag-waiting-text")).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(evaluation().queryByText("正在评估本次回答")).toBeNull();
      expect(screen.getByTestId("rag-evaluation-overview").hasAttribute("data-waiting")).toBe(false);
      expect(screen.getByTestId("rag-task-panel").hasAttribute("data-waiting")).toBe(false);
      expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the same retry request id after an unknown POST outcome", async () => {
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: failedAutomaticRun(), history: [] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start")
      .mockRejectedValueOnce(new Error("网络结果未知，请重试确认。"))
      .mockResolvedValueOnce(completedAutomaticRun());
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      taskId: "task-1", turnId: "turn-1", question: "你们支持哪些部署方式？", questionId: "question-1",
      answer: "支持私有化部署，具体环境要求请联系项目团队确认。", answerId: "answer-1",
    })} />);
    await waitFor(() => expect(retryAutomaticEvaluationButton().hasAttribute("disabled")).toBe(false));
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(retryAutomaticEvaluationButton());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(retryAutomaticEvaluationButton()).toBeTruthy());
    expect(evaluation().getByText("评估未完成")).toBeTruthy();
    expect(evaluation().queryByText("正在读取评分…")).toBeNull();
    const firstId = start.mock.calls[0][0].clientRequestId;
    fireEvent.click(retryAutomaticEvaluationButton());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0].clientRequestId).toBe(firstId);
    await waitFor(() => expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("93"));
    expect(evaluation().queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("offers a local retry for a durable server failure without starting a task on page open", async () => {
    const failed = failedAutomaticRun();
    failed.error = { code: "EVALUATION_ATTENTION_REQUIRED", message: "上游任务创建结果不确定，需要管理员确认后再继续。" };
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: failed, history: [] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
      taskId: "task-1", turnId: "turn-1", question: "你们支持哪些部署方式？", questionId: "question-1", answer: "支持私有化部署。", answerId: "answer-1",
    })} />);
    await waitFor(() => expect(retryAutomaticEvaluationButton().hasAttribute("disabled")).toBe(false));
    expect(evaluation().getByText("评估未完成")).toBeTruthy();
    expect(evaluation().queryByText("正在读取评分…")).toBeNull();
    expect(screen.queryByTestId("rag-auto-evaluate")).toBeNull();
    expect(screen.queryByText(/自动评估已提交/)).toBeNull();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    expect(within(screen.getByRole("dialog", { name: "评估记录" })).getByText(/需要管理员确认/)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it("changes server-owned running feedback to a local retry after a polled failure", async () => {
    vi.useFakeTimers();
    try {
      const running: EnterpriseRagEvaluationRunDto = { ...completedAutomaticRun(), status: "running", report: null };
      const failed = failedAutomaticRun();
      vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: running, history: [] });
      const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
      const observe = vi.spyOn(liveEnterpriseRagEvaluationApi, "observe").mockResolvedValue(failed);
      render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={liveRuntime({
        taskId: "task-1", turnId: "turn-1", question: "你们支持哪些部署方式？", questionId: "question-1", answer: "支持私有化部署。", answerId: "answer-1",
      })} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(evaluation().getByText("正在评估本次回答").classList.contains("rag-waiting-text")).toBe(true);
      expect(evaluation().queryByRole("button", { name: "重试" })).toBeNull();
      await act(async () => { vi.advanceTimersByTime(2_500); await Promise.resolve(); await Promise.resolve(); });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(evaluation().getByText("评估未完成")).toBeTruthy();
      expect(retryAutomaticEvaluationButton().hasAttribute("disabled")).toBe(false);
      expect(screen.queryByText(/自动评估已提交/)).toBeNull();
      expect(start).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
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
      expect(screen.getByTestId("rag-answer").textContent).toContain("旧回答"),
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

  it("shows the frozen task version and never substitutes a newer publication", async () => {
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

    expect(screen.getByText(/历史资料\.zip.*本回答冻结 v3/)).toBeTruthy();
    expect(screen.getByText(/项目当前已发布 v9；本回答仍使用冻结 v3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "使用新版新建问答" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建问答" }));
    expect(startNewConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/历史资料\.zip.*本回答冻结 v3/)).toBeTruthy();
    expect(screen.queryByText("当前资料.zip")).toBeNull();
  });

  it("labels an unavailable historical binding unknown instead of claiming the current version", async () => {
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

    expect(screen.getAllByText("知识版本：历史任务知识版本未知")).toHaveLength(1);
    expect(screen.queryByText("正在确认知识库、模型与服务状态。")).toBeNull();
    expect(screen.queryByText(/未使用当前发布版本替代/)).toBeNull();
    expect(screen.getByTestId("rag-submit").hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/知识版本 v9/)).toBeNull();
    expect(screen.queryByRole("button", { name: "前往智能知识库" })).toBeNull();
  });

  it("keeps a retained pending dispatch out of the chatbot footer", () => {
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

    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("暂时无法完成本次提交，内容已保留。")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(runtime.onRetryPending).not.toHaveBeenCalled();
  });

  it("starts a new live conversation while another answer is running", async () => {
    const runtime = liveRuntime({ taskId: "task-existing" });
    const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn() };
    const page = render(<EnterpriseRagPreview {...props} live={runtime} />);

    fireEvent.click(screen.getByRole("button", { name: "新建问答" }));
    expect(runtime.onStartNewConversation).toHaveBeenCalledTimes(1);

    page.rerender(<EnterpriseRagPreview {...props} live={{ ...runtime, busy: true }} />);
    const busyButton = screen.getByRole("button", { name: "新建问答" });
    expect(busyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(busyButton);
    expect(runtime.onStartNewConversation).toHaveBeenCalledTimes(2);

    page.rerender(<EnterpriseRagPreview {...props} live={{ ...runtime, taskId: undefined }} />);
    expect(screen.getByRole("button", { name: "新建问答" })).toBeTruthy();
  });

  it("isolates live reviews by owner/workspace while sharing the scoped audit with website flow", async () => {
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

  it("keeps the designed surface visible while a real knowledge publication is missing", async () => {
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
    expect(screen.queryByText(/请先完成并发布企业知识库/)).toBeNull();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("rag-submit").hasAttribute("disabled")).toBe(true);
    expect(openKnowledge).not.toHaveBeenCalled();
  });

  it("fails closed while the model configuration status is unknown", async () => {
    const runtime = liveRuntime({ configured: null });
    render(
      <EnterpriseRagPreview
        onOpenWebsite={vi.fn()}
        onOpenWebsiteAssistant={vi.fn()}
        live={runtime}
      />,
    );

    expect(screen.queryByText(/模型状态尚未确认/)).toBeNull();
    expect(screen.getByTestId("rag-question-input").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("rag-submit").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTestId("rag-submit"));
    expect(runtime.onAsk).not.toHaveBeenCalled();
  });

  it("does not reuse the default answer or an old score for a custom question", async () => {
    await showPage();
    expect(screen.getByText(previewRagAnswer)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "输入企业 RAG 预览问题" }), {
      target: { value: "我们的产品支持离线安装吗？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "试用问题" }));

    expect(within(screen.getByRole("article", { name: "历史回答" })).getByText(previewRagAnswer)).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "企业助手回复" })).queryByText(previewRagAnswer)).toBeNull();
    await waitFor(() => expect(screen.getByText("你好！有什么可以帮你？")).toBeTruthy());
    const previewNotice = screen.getByText(/此问题不在示例库/);
    expect(previewNotice.textContent).toContain("未连接真实问答服务");
    expect(previewNotice.classList.contains("rag-inline-feedback")).toBe(true);
    expectEmptyGauge();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(evaluation().queryByText(/可能分数/)).toBeNull();
    expect(screen.getByRole("button", { name: "人工评审" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "现有公开资料未说明离线安装能力，请向产品负责人确认。" } });
    expect(editor.getByRole("button", { name: "保存回答，重新评审" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(editor.getByRole("textbox", { name: "用户任务" }), { target: { value: "确认能否在无网络的环境部署" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));

    expect(screen.getByText("现有公开资料未说明离线安装能力，请向产品负责人确认。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "人工评审" }).hasAttribute("disabled")).toBe(false);
    expectEmptyGauge();
  });

  it("validates an edited question and invalidates the old answer score", async () => {
    await showPage();
    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    const question = editor.getByRole("textbox", { name: "问题" }) as HTMLTextAreaElement;
    const save = editor.getByRole("button", { name: "保存回答，重新评审" });
    expect(question.value).toBe(RAG_SAMPLE_CASES[0].question);
    fireEvent.change(question, { target: { value: "  " } });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(question, { target: { value: "产品是否适合对外服务？" } });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    expect(screen.getByText("产品是否适合对外服务？")).toBeTruthy();
    expectEmptyGauge();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
  });

  it("uses the blank welcome pencil for preset questions instead of answer editing", async () => {
    await showPage();
    fireEvent.click(screen.getByRole("button", { name: "新建问答" }));
    expect(screen.queryByRole("button", { name: "编辑回答" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "设置预设问题" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置预设问题" });
    const settings = within(settingsDialog);
    expect(settings.getByText("新问题草稿已生成，确认后才会替换当前问题。")).toBeTruthy();
    expect(settings.getByRole("button", { name: "编辑问题" })).toBeTruthy();
    expect(settings.getByRole("button", { name: "换一批" })).toBeTruthy();
    expect(settings.getByRole("button", { name: "确认使用" })).toBeTruthy();
    fireEvent.click(settings.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(settings.getByText("编辑并确认后，才会替换当前问题。")).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "设置预设问题" })).toBe(settingsDialog);
    expect(settings.queryByText("新问题草稿已生成，确认后才会替换当前问题。")).toBeNull();
  });

  it("preserves unknown weight and a pending score when a saved rating lacks evidence", async () => {
    await showPage();
    const review = openReview();
    for (const label of dimensionLabels) {
      await chooseReviewOption(review, `${label}等级`, "4 · 充分满足");
    }
    for (const remove of within(review.getByRole("list", { name: "需求满足证据：已选证据" })).getAllByRole("button", { name: /^移除/ })) {
      fireEvent.click(remove);
    }
    expect(review.getByRole("button", { name: "保存评审并计算" }).hasAttribute("disabled")).toBe(true);
    confirmReview();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("rag-evaluation-score")).toBeTruthy();
    expect(evaluation().getByText("评审覆盖 80%")).toBeTruthy();
    expect(evaluation().queryByText(/可能分数/)).toBeNull();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].dimensions.find((item: { id: string }) => item.id === "intent").evidenceIds).toEqual([]);
  });

  it("lets a failed gate override a manually saved perfect numeric score", async () => {
    await showPage();
    const review = openReview();
    for (const label of dimensionLabels) {
      await chooseReviewOption(review, `${label}等级`, "4 · 充分满足");
    }
    fireEvent.click(review.getByRole("button", { name: "权限与隐私" }));
    await chooseReviewOption(review, "权限与隐私风险核验", "发现风险");
    fireEvent.change(review.getByRole("textbox", { name: "权限与隐私风险核验依据" }), {
      target: { value: "当前角色无权访问回答所引用的内部原文。" },
    });
    confirmReview();

    expectUnavailableGauge();
    expect(evaluation().getByText("需修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
    expect(evaluation().queryByText(/可能分数/)).toBeNull();
    expect(evaluation().getByText(/高分不能把该回答判为可用，但不会取消网站发布选择/)).toBeTruthy();
    openQualityDetails();
    const manualPlan = within(screen.getByRole("dialog", { name: "优化方案" }));
    const manualSummary = manualPlan.getByTestId("rag-improvement-summary");
    expect(manualSummary.textContent).toMatch(/风险|修正/);
    expect(manualPlan.getAllByText(/当前角色无权访问回答所引用的内部原文/)).toHaveLength(1);
    expect(manualPlan.getByRole("heading", { name: "调整步骤" })).toBeTruthy();
    expect(manualPlan.queryByRole("heading", { name: "改写示例" })).toBeNull();
    expect(within(manualSummary).queryByText("立即修复")).toBeNull();

    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByLabelText("重大问题，数值分不适用").textContent).toBe("N/A");
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0].dimensions).toHaveLength(6);
  });

  it("invalidates the current score after editing while retaining the original reviewed snapshot", async () => {
    await showPage();
    openReview();
    confirmReview();
    const original = JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0];
    expect(original.answer).toBe(previewRagAnswer);

    fireEvent.click(screen.getByRole("button", { name: "编辑回答" }));
    const editor = within(screen.getByRole("dialog", { name: "录入待评估回答" }));
    fireEvent.change(editor.getByRole("textbox", { name: "实际回答" }), { target: { value: "这是已经修订、尚待重新核验的回答。" } });
    fireEvent.click(editor.getByRole("button", { name: "保存回答，重新评审" }));

    expectEmptyGauge();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/历史快照，不适用于当前回答/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(historyKey) || "[]")[0]).toEqual(original);
  });

  it("clears a new preview conversation while retaining saved reviews and manual entry without automatic evaluation", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [] });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockResolvedValue(completedAutomaticRun());
    const observe = vi.spyOn(liveEnterpriseRagEvaluationApi, "observe").mockResolvedValue(completedAutomaticRun());
    await showPage();
    expect(screen.getAllByRole("button", { name: /^\[\d+\] / }).length).toBeGreaterThan(0);
    openReview();
    confirmReview();
    const savedHistory = window.localStorage.getItem(historyKey);
    const savedReports = window.localStorage.getItem(EVALUATION_REPORT_STORAGE_KEY);
    const original = JSON.parse(savedHistory || "[]")[0];
    expect(original.answer).toBe(previewRagAnswer);
    expect(evaluation().getByText("评审覆盖 100%")).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "输入企业 RAG 预览问题" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "尚未发送的新问题" } });

    fireEvent.click(screen.getByRole("button", { name: "新建问答" }));

    expect(input.value).toBe("");
    expect(document.activeElement === input).toBe(true);
    const chat = within(input.closest(".erag-test-card") as HTMLElement);
    expect(chat.queryByText(original.question)).toBeNull();
    expect(chat.queryByText(previewRagAnswer)).toBeNull();
    expect(screen.getByText(/你好！我是 FrontMind 企业助手/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^\[\d+\] / })).toHaveLength(0);
    expectEmptyGauge();
    expect(evaluation().getByRole("heading", { name: "待评估" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "当前评估摘要" }).classList.contains("is-neutral")).toBe(true);
    expect(evaluation().getByTestId("rag-evaluation-supporting-meta").getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: "编辑回答" })).toBeNull();
    expect(screen.getByRole("button", { name: "设置预设问题" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "录入回答" })).toBeNull();
    expect(screen.getByRole("button", { name: "人工评审" }).hasAttribute("disabled")).toBe(true);
    expect(evaluation().getByRole("button", { name: "优化方案" }).hasAttribute("disabled")).toBe(true);
    expect(evaluation().getByRole("button", { name: "回答依据" }).hasAttribute("disabled")).toBe(false);
    expect(window.localStorage.getItem(historyKey)).toBe(savedHistory);
    expect(window.localStorage.getItem(EVALUATION_REPORT_STORAGE_KEY)).toBe(savedReports);

    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(original.question)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(records.getByText(/历史快照，不适用于当前回答/)).toBeTruthy();
    expect(latest).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("treats an adopted suggested rewrite as a new unreviewed answer", async () => {
    await showPage();
    openQualityDetails();
    const improvement = within(screen.getByRole("dialog", { name: "优化方案" }));
    const suggestedAnswer = improvement.getByText(/FrontMind 的演示能力包括：/).textContent;
    fireEvent.click(improvement.getByRole("button", { name: "采用改写并重新评审" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(suggestedAnswer!)).toBeTruthy();
    expectEmptyGauge();
    expect(evaluation().getByText("关键风险待核验")).toBeTruthy();
    expect(evaluation().getByText("评审覆盖 0%")).toBeTruthy();
    expect(window.localStorage.getItem(historyKey)).toBeNull();
  });

  it("preserves multiline risk evidence when saving a manual review", async () => {
    await showPage();
    const review = openReview();
    const reason = "已核对当前访客的资料访问权限。\n依据：部署说明第 2 节，不涉及内部受限内容。";
    fireEvent.click(review.getByRole("button", { name: "权限与隐私" }));
    fireEvent.change(review.getByRole("textbox", { name: "权限与隐私风险核验依据" }), {
      target: { value: reason },
    });
    confirmReview();

    expect(screen.queryByRole("dialog")).toBeNull();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    expect(saved[0].gates.find((gate: { id: string }) => gate.id === "permissions").reason).toBe(reason);
  });

  it("persists rule 1.3 review evidence and an independent evaluation report across remounts", async () => {
    const page = await showPage();
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
    await showPage();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByText(/reviewer-A/)).toBeTruthy();
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
    expect(records.getByText(/与当前回答相同/)).toBeTruthy();
  });

  it("keeps older rule-version review snapshots visible without recalculating them", async () => {
    const page = await showPage();
    openReview();
    confirmReview();
    const saved = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
    saved[0].ruleVersion = "rag-eval-1.1";
    window.localStorage.setItem(historyKey, JSON.stringify(saved));

    page.unmount();
    await showPage();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.queryByText(/rag-eval-1\.1/)).toBeNull();
    expect(records.getByText(/历史规则暂不支持重新计算/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(historyKey)!)[0].ruleVersion).toBe("rag-eval-1.1");
    expect(records.getByText(previewRagAnswer)).toBeTruthy();
  });

  it("exposes claim-level evidence without locking the desktop and restores focus after Escape", async () => {
    await showPage();
    const opener = screen.getByRole("button", { name: "回答依据" });
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
    expect(document.body.style.overflow).toBe("");
    expect(panel.getAttribute("aria-modal")).toBeNull();
    expect(document.querySelector<HTMLElement>(".rag-eval-root > div")?.inert).toBe(false);
    expect(document.activeElement === details.getByRole("button", { name: "关闭评估面板" })).toBe(true);

    escapeFocusedDialog();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.body.style.overflow).toBe("");
  });

  it("uses danger semantics for failed risk gates and restricted claims", async () => {
    await showPage();
    await chooseSample("syn-permission-leak");
    fireEvent.click(screen.getByRole("button", { name: "回答依据" }));

    const details = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    expect(details.getAllByTestId("rag-gate-status-orb").some((orb) => orb.getAttribute("aria-label")?.includes("发现风险"))).toBe(true);
    expect(details.getAllByTestId("rag-gate-status-orb").some((orb) => orb.classList.contains("is-failed"))).toBe(true);
    expect(details.getAllByTestId("rag-evidence-claim-status").some((tag) => tag.classList.contains("is-danger"))).toBe(true);
  });

  it("removes the test-set demo while preserving single-answer sample review", async () => {
    await showPage();
    expect(screen.queryByText("单次问答")).toBeNull();
    expect(screen.queryByRole("tab", { name: "测试集演示" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "测试集与验收口径演示" })).toBeNull();
    expect(screen.queryByLabelText("核心统计指标")).toBeNull();
    expect(screen.getByRole("region", { name: "本轮回答质量" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评分规则" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "评估记录" })).toBeTruthy();

    await chooseSample("syn-permission-leak");
    expectUnavailableGauge();
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

function checklistAutomaticRun(excludeCitations = false, optionalOnly = false): EnterpriseRagEvaluationRunDto {
  const run = completedAutomaticRun(), report = run.report!;
  const checklist = createRagChecklist("支持私有化部署吗？", "query");
  if (excludeCitations) checklist.checks.filter((check) => check.dimensionId === "citations").forEach((check) => {
    check.applicable = false;
    check.exclusionReason = "合成用例在评估前批准此维度不适用。";
  });
  const checks = checklist.checks.map((check) => ({ id: check.id,
    status: !check.applicable ? "not_applicable" as const : !optionalOnly && check.id === "clarity_concise" ? "partial" as const : "met" as const,
    rationale: !check.applicable ? check.exclusionReason : !optionalOnly && check.id === "clarity_concise" ? "同一句说明重复一次，但不影响用户完成任务。" : "合成固定判断：本项满足。",
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
    findings: optionalOnly ? [] : [{ id: "finding-1", rootCauseId: "root-cause-1", checkId: "clarity_concise", kind: "expression", severity: "improvement", summary: "有一处明确重复", impact: "不影响完成任务，但增加少量阅读负担。", claimIds: [], evidenceIds: ["source-1"], dimensionIds: ["clarity"] }],
    optionalSuggestions: [{ id: "suggestion-1", dimensionId: "clarity", summary: "可附示意图", benefit: "方便扫读，不影响当前答案质量。", evidenceIds: ["source-1"] }],
    summary: "合成 v3 报告。",
  };
  report.result = { ...report.result, version: "3.0.0", status: "completed", answerVerdict: optionalOnly ? "usable" : "usable_with_improvements",
    score: scored.score, coverage: scored.coverage, recommendation: optionalOnly ? "recommended" : "publish_with_risk", summary: optionalOnly ? "核心任务完成，没有待修复项。" : "核心任务完成，存在一处轻微重复。",
    dimensions: scored.dimensions.map(({ checks: _checks, ...dimension }) => dimension),
    risks: optionalOnly ? [] : [{ id: "finding-1", severity: "low", title: "有一处明确重复", summary: "增加少量阅读负担。", evidenceIds: ["source-1"] }],
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
    expectTaskStatus("已完成", "pass");
    expect(screen.getByText("本轮任务完成。")).toBeTruthy();
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("83");
    openQualityDetails();
    const reportSummary = screen.getByTestId("rag-improvement-summary");
    expect(reportSummary.textContent?.length).toBeGreaterThan(20);
    expect(reportSummary.textContent).not.toContain("引用定位可更清晰");
    expect(within(reportSummary).queryByText("建议完善")).toBeNull();
    const dialog = within(screen.getByRole("dialog",{name:"优化方案"}));
    expect(dialog.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual([
      "优化目标", "调整步骤", "检查要点",
    ]);
    expect(dialog.queryByRole("heading", { name: "建议改进" })).toBeNull();
    expect(dialog.queryByRole("heading", { name: "必须修复" })).toBeNull();
    expect(dialog.queryByRole("heading", { name: "待补证" })).toBeNull();
    expect(dialog.queryByRole("heading", { name: "改写示例" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "采用改写并重新评审" })).toBeNull();
    expect(dialog.getByText("支持私有化部署")).toBeTruthy();
    expect(dialog.getAllByText(/事实有依据，不改变核心任务/)).toHaveLength(1);
    fireEvent.click(dialog.getByRole("button",{name:"关闭评估面板"}));
    fireEvent.click(screen.getByRole("button",{name:"评分规则"}));
    expect(within(screen.getByRole("dialog",{name:"评分规则"})).queryByText(/rag-eval-\d/)).toBeNull();
  });
  it("renders a completed evaluation with an unknown quality conclusion as pending", async () => {
    const run = gradedAutomaticRun(true);
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getAllByText("待核验").length).toBeGreaterThan(0));
    expectTaskStatus("待核验", "pending");
    expect(screen.getByText("待补证。")).toBeTruthy();
    expect(evaluation().queryByText(/可用\s*·?\s*待改进/)).toBeNull();
    expect(screen.getByTestId("rag-evaluation-score")).toBeTruthy();
  });
  it("keeps a historical report's actual rule in its explanation", async () => {
    const run = completedAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("优秀")).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"评分规则"}));
    const dialog = within(screen.getByRole("dialog",{name:"评分规则"}));
    expect(dialog.queryByText(/rag-eval-\d/)).toBeNull();
    expect(run.report!.evaluator.ruleVersion).toBe("rag-eval-1.2");
    expect(dialog.getByText(/历史结论仍按原冻结规则解释/)).toBeTruthy();
  });
  it("preserves the frozen historical result without banners or a paid task", async () => {
    const run = completedAutomaticRun(), report = run.report!;
    report.result.score = 83; report.result.recommendation = "not_recommended";
    report.result.summary = "旧规则引用门禁未通过。";
    report.judgments.gates.find(gate => gate.id === "citations")!.status = "failed";
    const frozenReport = JSON.stringify(report);
    vi.spyOn(liveEnterpriseRagEvaluationApi,"latest").mockResolvedValue({latest:run,history:[run]});
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi,"start").mockRejectedValue(new Error("Must not start a paid evaluation"));
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("不可用，优先修复")).toBeTruthy());
    expect(screen.queryByTestId("rag-legacy-rule-notice")).toBeNull();
    expect(screen.queryByTestId("rag-current-rule")).toBeNull();
    expectUnavailableGauge();
    expect(evaluation().getByText("不可用，优先修复")).toBeTruthy();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评估记录 (1)" }));
    const records = within(screen.getByRole("dialog", { name: "评估记录" }));
    expect(records.getByLabelText("重大问题，数值分不适用").textContent).toBe("N/A");
    expect(run.report?.result.score).toBe(83);
    expect(run.report?.evaluator.ruleVersion).toBe("rag-eval-1.2");
    expect(JSON.stringify(report)).toBe(frozenReport);
    expect(start).not.toHaveBeenCalled();
  });

});

describe("rag-eval-1.4 checklist and radar presentation", () => {
  const runtime = () => liveRuntime({ taskId:"task-1",turnId:"turn-1",question:"支持私有化部署吗？",questionId:"question-1",answer:"支持私有化部署",answerId:"answer-1",sources:[{id:"source-1",title:"部署资料",kind:"published_knowledge"}] });
  it("keeps same-report polling renders stable and synchronizes every reveal to a new report id", async () => {
    const first = checklistAutomaticRun();
    const second = structuredClone(first);
    second.operationId = "evaluation-operation-2";
    second.sourceQaTaskId = "task-2";
    second.turnId = "turn-2";
    Object.assign(second.report!, {
      reportId: "evaluation-report-2",
      sourceQaTaskId: "task-2",
      sourceTurnId: "turn-2",
      conversationId: "conversation-2",
      questionMessageId: "question-2",
      answerMessageId: "answer-2",
    });
    if (!isGradedRagJudgment(second.report!.judgments)) {
      throw new Error("graded report required");
    }
    second.report!.judgments.task.rationale = "第二份报告确认任务完成。";
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockImplementation(async coordinate => {
      const run = coordinate.sourceQaTaskId === "task-2" ? second : first;
      return { latest: run, history: [run] };
    });
    const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn() };
    const firstRuntime = runtime();
    const page = render(<EnterpriseRagPreview {...props} live={firstRuntime} />);
    await waitFor(() => expect(page.container.querySelectorAll('[data-report-reveal-key="evaluation-report-1"]')).toHaveLength(4));
    const stableNodes = [
      screen.getByTestId("rag-evaluation-overview"),
      screen.getByTestId("rag-evaluation-score"),
      screen.getByRole("region", { name: "六维加权评分" }),
      screen.getByTestId("rag-task-panel"),
    ];
    const focusedRadarPoint = screen.getByRole("button", { name: /正确与有据/ });
    focusedRadarPoint.focus();

    page.rerender(<EnterpriseRagPreview {...props} live={{ ...firstRuntime, providerLabel: "同报告轮询刷新" }} />);
    expect(stableNodes).toEqual([
      screen.getByTestId("rag-evaluation-overview"),
      screen.getByTestId("rag-evaluation-score"),
      screen.getByRole("region", { name: "六维加权评分" }),
      screen.getByTestId("rag-task-panel"),
    ]);
    expect(document.activeElement).toBe(focusedRadarPoint);
    expect(page.container.querySelectorAll('[data-report-reveal-key="evaluation-report-1"]')).toHaveLength(4);

    page.rerender(<EnterpriseRagPreview {...props} live={liveRuntime({
      conversationId: "conversation-2", taskId: "task-2", turnId: "turn-2",
      question: "第二个问题", questionId: "question-2", answer: "第二个回答", answerId: "answer-2",
      sources: [{ id: "source-1", title: "部署资料", kind: "published_knowledge" }],
    })} />);
    await waitFor(() => expect(page.container.querySelectorAll('[data-report-reveal-key="evaluation-report-2"]')).toHaveLength(4));
    expect(stableNodes).toEqual([
      screen.getByTestId("rag-evaluation-overview"),
      screen.getByTestId("rag-evaluation-score"),
      screen.getByRole("region", { name: "六维加权评分" }),
      screen.getByTestId("rag-task-panel"),
    ]);
    expect(screen.getByText("第二份报告确认任务完成。")).toBeTruthy();
  });

  it("shows the complete report statically when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    })));
    const run = checklistAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    const page = render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(page.container.querySelectorAll('[data-report-reveal-key="evaluation-report-1"]')).toHaveLength(4));
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("98");
    expect(evaluation().getByRole("heading", { name: "待改进" })).toBeTruthy();
    expectTaskStatus("已完成", "pass");
    expect(screen.getByText("本轮任务完成。")).toBeTruthy();
    const animatedGlyphs = page.container.querySelectorAll<HTMLElement>(
      ".rag-evaluation-summary-flow [aria-hidden='true'] > span, .rag-task-panel [aria-hidden='true'] > span",
    );
    expect(animatedGlyphs.length).toBeGreaterThan(0);
    expect([...animatedGlyphs].every(glyph => glyph.style.opacity === "1")).toBe(true);
  });

  it("renders a current v3 report, expands check evidence, and keeps optional suggestions non-deducting", async () => {
    const run = checklistAutomaticRun();
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("待改进")).toBeTruthy());
    expectTaskStatus("已完成", "pass");
    expect(screen.getByText("本轮任务完成。")).toBeTruthy();
    expect(screen.queryByTestId("rag-legacy-rule-notice")).toBeNull();
    expect(screen.getByTestId("rag-evaluation-score").textContent).toContain("98");
    expect(screen.getByTestId("rag-evaluation-score").textContent).not.toContain("98.5");
    fireEvent.click(screen.getByRole("button", { name: /清晰可行动 90%/ }));
    expect(screen.getByText(/同一句说明重复一次/)).toBeTruthy();
    const plan = openQualityDetails();
    expect(plan.getByRole("heading", { name: "可选建议" })).toBeTruthy();
    expect(plan.getByText(/不扣分/)).toBeTruthy();
    expect(plan.getByText(/可附示意图/)).toBeTruthy();
    expect(plan.getAllByText(/有一处明确重复/)).toHaveLength(1);
    expect(plan.queryByRole("heading", { name: "改写示例" })).toBeNull();
    if (screen.queryAllByRole("dialog").length) escapeFocusedDialog();
    fireEvent.click(screen.getByRole("button", { name: "评分规则" }));
    const rules = within(screen.getByRole("dialog", { name: "评分规则" }));
    expect(rules.queryByText(/rag-eval-\d/)).toBeNull();
    expect(rules.getByText(/满足100%／部分满足50%／不满足0%/)).toBeTruthy();
  });
  it("keeps optional suggestions separate when a loaded report has no required adjustments", async () => {
    const run = checklistAutomaticRun(false, true);
    let resolveLatest!: (value: { latest: EnterpriseRagEvaluationRunDto; history: EnterpriseRagEvaluationRunDto[] }) => void;
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockReturnValue(new Promise(resolve => { resolveLatest = resolve; }));
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    const plan = openQualityDetails();
    expect(plan.getByTestId("rag-improvement-summary").textContent).toBe("先补齐当前回答的判断依据，再确定优化方向。");
    await act(async () => { resolveLatest({ latest: run, history: [run] }); });
    expect(plan.getByTestId("rag-improvement-summary").textContent).toContain("当前记录没有待修复项");
    expect(plan.getByRole("heading", { name: "可选建议" })).toBeTruthy();
    expect(plan.getByText(/不扣分/)).toBeTruthy();
    expect(plan.getByText(/可附示意图/)).toBeTruthy();
    expect(plan.queryByRole("list", { name: "调整步骤" })).toBeNull();
    expect(plan.queryByRole("heading", { name: "改写示例" })).toBeNull();
    expect(evaluation().getByRole("button", { name: "优化方案" }).hasAttribute("disabled")).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
  it("keeps a pre-frozen N/A dimension distinct from pending in both chart and evidence", async () => {
    const run = checklistAutomaticRun(true);
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [run] });
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} live={runtime()} />);
    await waitFor(() => expect(evaluation().getByText("待改进")).toBeTruthy());
    expect(screen.getByRole("button", { name: /引用与时效 不适用/ })).toBeTruthy();
    expect(screen.queryByTestId("rag-radar-area")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "回答依据" }));
    const evidence = within(screen.getByRole("dialog", { name: "回答依据与陈述核验" }));
    const evidenceRadar = within(evidence.getByTestId("rag-evidence-radar"));
    fireEvent.click(evidenceRadar.getByRole("button", { name: /引用与时效 不适用/ }));
    const citationDetail = within(evidenceRadar.getByRole("region", { name: "引用与时效详情" }));
    expect(citationDetail.getByText("不适用")).toBeTruthy();
    expect(citationDetail.queryByText("待判定")).toBeNull();
  });
});


describe("RAG evaluation lifecycle and immediate composer", () => {
  const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn() };
  const answerRuntime = () => liveRuntime({ conversationId: "conversation-1", taskId: "task-1", turnId: "turn-1", question: "企业服务有哪些？", answer: "提供企业知识服务。", answerId: "answer-1" });
  const expectNeutral = (title: string) => {
    expect(evaluation().getByText(title)).toBeTruthy();
    expect(screen.getByTestId("rag-evaluation-status-orb").closest(".rag-verdict")?.classList.contains("is-neutral")).toBe(true);
    expectEmptyGauge();
    expect(evaluation().getAllByTestId("rag-radar-point-marker").every(marker => marker.classList.contains("is-empty"))).toBe(true);
    expect(evaluation().queryByText("正在读取评分…")).toBeNull();
  };

  it("keeps both radars neutral while evaluating and uses one stable waiting title", async () => {
    const run = { ...completedAutomaticRun(), status: "running" as const, report: null };
    vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: run, history: [] });
    render(<EnterpriseRagPreview {...props} live={answerRuntime()} />);
    await waitFor(() => expectNeutral("正在评估本次回答"));
    expect(evaluation().getByText("正在评估本次回答").classList.contains("rag-waiting-text")).toBe(true);
    expect(screen.getByTestId("rag-evaluation-overview").getAttribute("data-waiting")).toBe("true");
    expect(screen.getByTestId("rag-task-panel").getAttribute("data-waiting")).toBe("true");
    expect(screen.getByTestId("rag-task-panel").textContent).toContain("正在评估客户任务与必要完成点，请耐心等待。");
    fireEvent.click(evaluation().getByRole("button", { name: "回答依据" }));
    expect(within(screen.getByTestId("rag-evidence-radar")).getAllByTestId("rag-radar-point-marker").every(marker => marker.classList.contains("is-empty"))).toBe(true);
  });

  it("continues readonly waiting beyond sixty seconds without creating an evaluation", async () => {
    vi.useFakeTimers();
    try {
      const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [], automaticExpected: true });
      const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
      const page = render(<EnterpriseRagPreview {...props} live={answerRuntime()} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
      expect(latest.mock.calls.length).toBeGreaterThan(1);
      const reads = latest.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(latest.mock.calls.length).toBeGreaterThan(reads);
      expectNeutral("正在评估本次回答");
      expect(start).not.toHaveBeenCalled();
      page.unmount();
    } finally { vi.useRealTimers(); }
  });

  it("distinguishes no record and blocked admission from a pending quality report", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [], automaticState: "not_enrolled" });
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    const page = render(<EnterpriseRagPreview {...props} live={answerRuntime()} />);
    await waitFor(() => expectNeutral("未进入自动评估"));
    expectTaskStatus("未进入自动评估", "unverified");
    latest.mockResolvedValue({ latest: null, history: [], automaticState: "blocked", automaticExpected: false, automaticAdmission: { status: "blocked", code: "SOURCE_MISSING", message: "准备未完成", updatedAt: new Date().toISOString() } });
    page.rerender(<EnterpriseRagPreview {...props} live={{ ...answerRuntime(), turnId: "turn-2", answerId: "answer-2" }} />);
    await waitFor(() => expectNeutral("评估暂未开始"));
    expectTaskStatus("评估暂未开始", "unverified");
    await act(async () => fireEvent.click(evaluation().getByRole("button", { name: "重新读取状态" })));
    expect(latest).toHaveBeenCalledTimes(3);
    expect(start).not.toHaveBeenCalled();
  });

  it("uses one not-enrolled state when a completed historical answer has no evaluation coordinate", () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest");
    render(<EnterpriseRagPreview {...props} live={liveRuntime({
      conversationId: "legacy-conversation", question: "历史问题", answer: "历史回答", answerId: "legacy-answer",
      taskId: undefined, turnId: undefined,
    })} />);
    expectNeutral("未进入自动评估");
    expectTaskStatus("未进入自动评估", "unverified");
    expect(screen.getByTestId("rag-task-panel").textContent).toContain("该历史回答未进入自动评估流程。");
    expect(evaluation().getByTestId("rag-evaluation-summary-copy").textContent).toContain("该历史回答未进入自动评估流程。");
    expect(latest).not.toHaveBeenCalled();
  });

  it("shows greeting as not requiring evaluation without reading or starting evaluation", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest"), start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    render(<EnterpriseRagPreview {...props} live={{ ...answerRuntime(), question: "你好", answer: "你好！", evaluationNotRequired: true }} />);
    expectNeutral("无需评估");
    expect(evaluation().getByRole("button", { name: "人工评审" }).hasAttribute("disabled")).toBe(true);
    expect(latest).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });

  it.each([true, false])("clears a submitted draft before acknowledgement and preserves newer text (%s)", async accepted => {
    let finish!: (value: boolean) => void;
    const onAsk = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<EnterpriseRagPreview {...props} live={liveRuntime({ conversationId: "draft-1", onAsk })} />);
    const input = screen.getByRole("textbox", { name: "输入企业 RAG 问题" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "先发的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(onAsk).toHaveBeenCalledWith("先发的问题");
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "更新的草稿" } });
    await act(async () => finish(accepted));
    expect(input.value).toBe("更新的草稿");
  });

  it("silently restores an unsuccessful send without adding a chatbot-footer retry", async () => {
    let finish!: (value: boolean) => void;
    const onAsk = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<EnterpriseRagPreview {...props} live={liveRuntime({ conversationId: "draft-restore", onAsk })} />);
    const input = screen.getByRole("textbox", { name: "输入企业 RAG 问题" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "需要恢复的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(input.value).toBe("");
    await act(async () => finish(false));
    expect(input.value).toBe("需要恢复的问题");
    expect(screen.queryByText("暂时无法完成本次提交，内容已保留。")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("does not restore an unsuccessful send into another conversation", async () => {
    let finish!: (value: boolean) => void;
    const runtime = liveRuntime({ conversationId: "conversation-a", onAsk: () => new Promise<boolean>(resolve => { finish = resolve; }) });
    const page = render(<EnterpriseRagPreview {...props} live={runtime} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A 问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    page.rerender(<EnterpriseRagPreview {...props} live={liveRuntime({ conversationId: "conversation-b" })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "B 草稿" } });
    await act(async () => finish(false));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("B 草稿");
    page.rerender(<EnterpriseRagPreview {...props} live={runtime} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A 问题");
  });

  it.each(RAG_SAMPLE_CASES.map(item => [item.id, item.title]))("keeps padded review topics for preview sample %s", async (id, title) => {
    render(<EnterpriseRagPreview {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "历史问答" })).getByRole("button", { name: `${title} 示例` }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
    fireEvent.click(evaluation().getByRole("button", { name: "人工评审" }));
    const review = screen.getByRole("dialog", { name: "人工评审与计算" });
    expect(review.querySelectorAll(".rag-review-topic")).toHaveLength(2);
    expect(review.querySelector(".rag-review-dimensions")).toBeTruthy();
    expect(within(review).queryByText("示例 · 预设评审，仅供查看。")).toBeNull();
    expect(within(review).getByRole("button", { name: "保存评审并计算" })).toBeTruthy();
  });
});

it("keeps the current preview when deleting another item and opens a blank draft after deleting the active item", async () => {
  render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} storageScopeKey="preview-delete-selection" />);
  await selectFirstPreviewConversation(false);
  const activeQuestion = document.querySelector(".erag-user-message")?.textContent ?? "";
  expect(activeQuestion).not.toBe("");

  fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
  let dialog = screen.getByRole("dialog", { name: "历史问答" });
  const inactiveDelete = within(dialog).getAllByRole("button", { name: /^删除/ })
    .find(button => button.getAttribute("aria-label") !== `删除${activeQuestion}`);
  expect(inactiveDelete).toBeTruthy();
  fireEvent.click(inactiveDelete!);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
  expect(screen.getByText(activeQuestion, { selector: ".erag-user-message" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
  dialog = screen.getByRole("dialog", { name: "历史问答" });
  fireEvent.click(within(dialog).getByRole("button", { name: `删除${activeQuestion}` }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
  await waitFor(() => expect(document.querySelectorAll(".erag-user-message")).toHaveLength(0));
  expect(screen.getByText(/你好！我是 FrontMind 企业助手，很高兴为你服务。/)).toBeTruthy();
});


it("opens and reopens preview on a blank draft without removing saved history", async () => {
  const props = { onOpenWebsite: vi.fn(), onOpenWebsiteAssistant: vi.fn(), storageScopeKey: "fresh-reopen" };
  const page = render(<EnterpriseRagPreview {...props} />);
  expectEmptyGauge();
  expect(evaluation().getByText("待评估")).toBeTruthy();
  expect(document.querySelectorAll(".erag-user-message")).toHaveLength(0);
  await chooseSample(RAG_SAMPLE_CASES[0].id);
  expect(screen.getByText(RAG_SAMPLE_CASES[0].question)).toBeTruthy();
  page.unmount();
  render(<EnterpriseRagPreview {...props} />);
  expectEmptyGauge();
  expect(evaluation().getByText("待评估")).toBeTruthy();
  expect(document.querySelectorAll(".erag-user-message")).toHaveLength(0);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText(RAG_SAMPLE_CASES[0].question)).toBeNull();
  await chooseSample(RAG_SAMPLE_CASES[0].id);
  expect(screen.getByText(RAG_SAMPLE_CASES[0].question)).toBeTruthy();
});

it("queues synthetic followups as later turns instead of changing the running question", async () => {
  vi.useFakeTimers();
  try {
    render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} storageScopeKey="preview-fifo" />);
    const first=RAG_SAMPLE_CASES[0],second=RAG_SAMPLE_CASES[1];
    const input=screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:first.question}});
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"试用问题"})));
    fireEvent.change(input,{target:{value:second.question}});
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"试用问题"})));
    expect(input.value).toBe("");
    expect(document.querySelector(".erag-user-message")?.textContent).toBe(first.question);
    expect(screen.getByRole("region",{name:"待发送问题"}).textContent).toContain(second.question);
    await act(async()=>{await vi.advanceTimersByTimeAsync(900);});
    expect([...document.querySelectorAll(".erag-user-message")].at(-1)?.textContent).toBe(second.question);
    await act(async()=>{await vi.advanceTimersByTimeAsync(900);});
    expect(screen.queryByRole("region",{name:"待发送问题"})).toBeNull();
    expect(document.querySelectorAll(".erag-user-message")).toHaveLength(2);
  } finally { vi.useRealTimers(); }
});
