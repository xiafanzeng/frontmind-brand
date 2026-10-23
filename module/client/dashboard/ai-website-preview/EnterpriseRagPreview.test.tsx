import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseRagPreview } from "./EnterpriseRagPreview";
import {
  EVALUATION_REPORT_STORAGE_KEY,
  listEvaluationReports,
} from "./evaluation-report-store";
import { previewRagAnswer } from "./preview-copy";

const historyKey = "frontmind-rag-reviews-v1";
const dimensionLabels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];

function showPage() {
  return render(<EnterpriseRagPreview onOpenWebsite={vi.fn()} onOpenWebsiteAssistant={vi.fn()} />);
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

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("enterprise RAG evidence-based review UI", () => {
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

  it("separates representative and challenge statistics and opens a high-score failing case", () => {
    showPage();
    fireEvent.click(screen.getByRole("tab", { name: "测试集演示" }));
    expect(screen.getByRole("tab", { name: "测试集演示" }).getAttribute("aria-selected")).toBe("true");
    const representativeSection = screen.getByRole("heading", { name: "代表集 · 常规任务" }).closest("section")!;
    const challengeSection = screen.getByRole("heading", { name: "挑战集 · 风险与边界" }).closest("section")!;
    expect(within(representativeSection).getAllByRole("button")).toHaveLength(2);
    expect(within(challengeSection).getAllByRole("button")).toHaveLength(5);
    expect(within(representativeSection).getByText(/场景加权分/)).toBeTruthy();
    expect(within(challengeSection).getByText("可用 3/5 · 关键风险 2")).toBeTruthy();
    expect(screen.getByText(/不构成企业 RAG 系统分或发布授权/)).toBeTruthy();

    fireEvent.click(within(challengeSection).getByRole("button", { name: /高分仍不能抵消越权/ }));
    expect(screen.getByRole("tab", { name: "单次问答" }).getAttribute("aria-selected")).toBe("true");
    expect(evaluation().getByLabelText("综合评分").textContent).toContain("90");
    expect(evaluation().getByText("不可用，优先修复")).toBeTruthy();
    expect(evaluation().getByText("关键风险已发现")).toBeTruthy();
  });
});
