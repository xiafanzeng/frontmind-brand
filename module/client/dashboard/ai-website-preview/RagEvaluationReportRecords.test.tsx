import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseRagEvaluationHistoryDto, EnterpriseRagEvaluationRunDto } from "../../../contracts/enterprise-rag-evaluation-run";
import { liveEnterpriseRagEvaluationApi } from "../enterprise-rag-evaluation-api";
import { liveEnterpriseRagHumanReviewApi } from "../enterprise-rag-human-review-api";
import type { EnterpriseRagHumanReviewDto } from "../../../contracts/enterprise-rag-human-review";
import { RagEvaluationReportRecords } from "./RagEvaluationReportRecords";
import { RAG_DIMENSIONS, RAG_GATES } from "./rag-evaluation";
import { enterpriseRagHistoryStorageKey, type RagReviewRecord } from "./rag-review-history";

const coordinate = { sourceQaTaskId: "task-1", turnId: "turn-1" };
function manual(id: string, version = "rag-eval-1.3", time = "2026-11-06T01:00:00.000Z"): RagReviewRecord {
  return { id, question: `问题${id}`, answer: `完整原文${id}`, need: `任务${id}`, reviewer: "评审人", time, ruleVersion: version, knowledgeVersion: "KB-v1", dimensions: RAG_DIMENSIONS.map(({ id }) => ({ id, level: 3, rationale: "记录的判断理由", applicable: true, evidenceIds: ["原文段落1"] })), gates: RAG_GATES.map(({ id }) => ({ id, status: "passed", reason: "已核验" })) };
}
function run(id = "operation-1", task = "task-1"): EnterpriseRagEvaluationRunDto {
  return { operationId: id, sourceQaTaskId: task, turnId: "turn-1", status: "completed", createdAt: "2026-11-06T01:00:00.000Z", updatedAt: "2026-11-06T01:01:00.000Z", error: null, report: {
    reportId: `report-${id}`, sourceQaTaskId: task, sourceTurnId: "turn-1", conversationId: "conversation-1", questionMessageId: "question-1", answerMessageId: "answer-1", questionHash: "q-hash", answerHash: "a-hash", knowledgeBase: { snapshotId: "snapshot-1", version: 1, sourceFileName: "知识资料.zip", documentCount: 1, contentHash: "kb-hash" }, evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "2.0.0", ruleVersion: "rag-eval-1.3", judgeVersion: "2.0.0", provider: "test", model: "mock", effort: null, skillHash: "skill-hash", outputHash: "output-hash" }, createdAt: "2026-11-06T01:00:00.000Z", completedAt: "2026-11-06T01:01:00.000Z",
    judgments: { operationToken: "token", inputHash: "input", dimensions: RAG_DIMENSIONS.map(({ id }) => ({ id, level: 4, rationale: "冻结理由", evidenceIds: ["source-1"] })), gates: RAG_GATES.map(({ id }) => ({ id, status: "passed", reason: "已核验", evidenceIds: ["source-1"] })), claims: [{ id: "claim-1", statement: "报告记录的陈述", status: "supported", sourceIds: ["source-1"], rationale: "来源支持" }], summary: "冻结评估摘要" },
    result: { skillId: "enterprise-rag-evaluation", version: "2.0.0", status: "completed", score: 100, coverage: 100, answerVerdict: "usable", recommendation: "recommended", summary: "冻结评估摘要", dimensions: RAG_DIMENSIONS.map(({ id, label, weight }) => ({ id, label, score: weight, maxScore: weight, status: "passed", summary: "记录的理由", evidenceIds: ["source-1"] })), risks: [], relatedReportIds: [] },
  } };
}

function formalReview(id = "review-1"): EnterpriseRagHumanReviewDto {
  const record = manual(id);
  return {
    id,
    clientRequestId: `request-${id}`,
    operationId: "operation-1",
    reportId: "report-operation-1",
    reviewer: { userId: 7, displayName: record.reviewer },
    createdAt: record.time,
    supersedesReviewId: null,
    snapshot: { question: record.question, answer: record.answer, need: record.need, knowledgeVersion: record.knowledgeVersion },
    humanVerdict: "improve",
    humanScore: 75,
    humanScoring: { version: "human-review-1.0.0", hash: "a".repeat(64) },
    alignment: "human_more_negative",
    status: "pending_analysis",
    dimensions: record.dimensions,
    gates: record.gates,
    diff: { alignment: "human_more_negative", dimensions: [{ id: "intent", aiLevel: 4, humanLevel: 3 }], gates: [] },
  };
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.spyOn(liveEnterpriseRagEvaluationApi, "start").mockRejectedValue(new Error("must never start")); vi.spyOn(liveEnterpriseRagEvaluationApi, "latest").mockResolvedValue({ latest: null, history: [] }); vi.spyOn(liveEnterpriseRagHumanReviewApi, "list").mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("report records", () => {
  it("keeps preview and missing-answer reads offline", async () => {
    const view = render(<RagEvaluationReportRecords preview storageScopeKey="preview" coordinate={coordinate} />);
    expect(screen.getByText("暂无评估记录。")).toBeTruthy();
    view.rerender(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" />);
    expect(screen.getByText(/未选择回答/)).toBeTruthy();
    expect(liveEnterpriseRagEvaluationApi.latest).not.toHaveBeenCalled();
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("shows original local snapshots by time and keeps old scoring semantics", () => {
    localStorage.setItem(enterpriseRagHistoryStorageKey("preview"), JSON.stringify([manual("old", "rag-eval-1.2"), manual("new", "rag-eval-1.3", "2026-11-06T02:00:00.000Z"), manual("unknown", "rag-eval-9.9", "2026-11-06T03:00:00.000Z")]));
    render(<RagEvaluationReportRecords preview storageScopeKey="preview" />);
    const records = screen.getAllByTestId("rag-report-manual-record");
    expect(records.map(item => item.querySelector("summary")!.textContent)).toEqual([expect.stringContaining("问题unknown"), expect.stringContaining("问题new"), expect.stringContaining("问题old")]);
    expect(records[1].textContent).toContain("待改进");
    expect(records[2].textContent).toContain("需要改进");
    expect(records[0].textContent).toContain("历史规则暂不支持重新计算");
    expect(records[2].textContent).toContain("完整原文old");
    expect(records[2].textContent).toContain("原文段落1");
  });

  it("updates local records only for the bound workspace and clears old content on a scope switch", () => {
    const key = enterpriseRagHistoryStorageKey("a");
    const view = render(<RagEvaluationReportRecords preview storageScopeKey="a" />);
    localStorage.setItem(key, JSON.stringify([manual("a")]));
    fireEvent(window, new StorageEvent("storage", { key: enterpriseRagHistoryStorageKey("b") }));
    expect(screen.queryByText("问题a")).toBeNull();
    fireEvent(window, new StorageEvent("storage", { key }));
    expect(screen.getByTestId("rag-report-manual-record").textContent).toContain("问题a");
    view.rerender(<RagEvaluationReportRecords preview storageScopeKey="b" />);
    expect(screen.queryByText("问题a")).toBeNull();
    localStorage.setItem(enterpriseRagHistoryStorageKey("b"), JSON.stringify([manual("b")]));
    fireEvent.focus(window);
    expect(screen.getByTestId("rag-report-manual-record").textContent).toContain("问题b");
  });

  it("loads server records read-only, deduplicates them and exposes recorded evidence", async () => {
    const migratedDuplicate = manual("review-1");
    migratedDuplicate.id = "legacy-migrated-copy";
    localStorage.setItem(enterpriseRagHistoryStorageKey("live:a"), JSON.stringify([
      migratedDuplicate,
      manual("legacy-only", "rag-eval-1.3", "2026-11-05T01:00:00.000Z"),
    ]));
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: run(), history: [run()] });
    vi.mocked(liveEnterpriseRagHumanReviewApi.list).mockResolvedValue([formalReview()]);
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getAllByTestId("rag-report-automatic-record")).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByTestId("rag-report-manual-record")).toHaveLength(2));
    expect(screen.getByText("报告记录的陈述")).toBeTruthy();
    expect(screen.getByText("q-hash")).toBeTruthy();
    const manualRecords = screen.getAllByTestId("rag-report-manual-record");
    expect(manualRecords[0].textContent).toContain("完整原文review-1");
    expect(manualRecords[1].textContent).toContain("完整原文legacy-only");
    expect(screen.queryByText(/来自当前浏览器/)).toBeNull();
    expect(liveEnterpriseRagEvaluationApi.latest).toHaveBeenCalledWith(coordinate);
    expect(liveEnterpriseRagHumanReviewApi.list).toHaveBeenCalledWith("operation-1");
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("shows the server-frozen human score and verdict without replacing them with a client recalculation", async () => {
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: run(), history: [] });
    const saved = { ...formalReview(), humanScore: 12, humanVerdict: "usable" as const };
    vi.mocked(liveEnterpriseRagHumanReviewApi.list).mockResolvedValue([saved]);
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByTestId("rag-report-manual-record")).toBeTruthy());
    const summary = screen.getByTestId("rag-report-manual-record").querySelector("summary")!;
    expect(summary.textContent).toContain("12 / 100");
    expect(summary.textContent).toContain("良好");
    expect(summary.textContent).not.toContain("待改进");
  });

  it("rejects records from another answer", async () => {
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: run("foreign", "task-other"), history: [] });
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("与当前回答不匹配"));
    expect(screen.queryByTestId("rag-report-automatic-record")).toBeNull();
  });

  it("preserves the frozen server score and conclusion instead of rescoring dimensions", async () => {
    const frozen = run();
    frozen.report!.result.score = 12;
    frozen.report!.result.answerVerdict = "usable";
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: frozen, history: [] });
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByTestId("rag-report-automatic-record")).toBeTruthy());
    const summary = screen.getByTestId("rag-report-automatic-record").querySelector("summary")!;
    expect(summary.textContent).toContain("12 / 100");
    expect(summary.textContent).toContain("良好");
    expect(summary.textContent).not.toContain("需修复");
  });

  it("hides generated versions in record summaries and details without rewriting saved data", async () => {
    const frozen = run();
    frozen.report!.result.summary = "保留原有结论。（规则 rag-eval-1.3；六维分数仅作诊断）";
    const serialized = JSON.stringify(frozen);
    const storageKey = enterpriseRagHistoryStorageKey("live:a");
    const manualData = JSON.stringify([manual("old", "rag-eval-1.2")]);
    localStorage.setItem(storageKey, manualData);
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: frozen, history: [] });
    const view = render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByTestId("rag-report-automatic-record")).toBeTruthy());
    expect(view.container.textContent).not.toMatch(/rag-eval-\d/);
    expect(view.container.textContent).not.toContain("评估器版本");
    expect(view.container.textContent).not.toContain("判断器版本");
    expect(screen.getAllByText("保留原有结论。（六维分数仅作诊断）")).toHaveLength(2);
    expect(JSON.stringify(frozen)).toBe(serialized);
    expect(localStorage.getItem(storageKey)).toBe(manualData);
  });

  it("ignores a late request after the bound answer changes", async () => {
    let resolveOld!: (value: EnterpriseRagEvaluationHistoryDto) => void;
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockImplementation(({ sourceQaTaskId }) => sourceQaTaskId === "task-1" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ latest: run("new", "task-2"), history: [] }));
    const view = render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    view.rerender(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={{ sourceQaTaskId: "task-2", turnId: "turn-1" }} />);
    await waitFor(() => expect(screen.getByText("report-new")).toBeTruthy());
    await act(async () => { resolveOld({ latest: run("old"), history: [] }); });
    expect(screen.queryByText("report-old")).toBeNull();
    expect(screen.getByText("report-new")).toBeTruthy();
  });

  it("reports failed reads, allows retry and does not manufacture an empty success", async () => {
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockRejectedValueOnce(new Error("读取失败"));
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("读取失败"));
    expect(screen.queryByText("当前回答暂无自动评估记录。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(screen.getByText("当前回答暂无自动评估记录。")).toBeTruthy());
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("keeps admission waiting beyond sixty seconds with read-only polling", async () => {
    vi.useFakeTimers();
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: null, history: [], automaticExpected: true });
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("status").textContent).toBe("正在评估本次回答");
    expect(screen.queryByText("当前回答暂无自动评估记录。")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(vi.mocked(liveEnterpriseRagEvaluationApi.latest).mock.calls.length).toBeGreaterThan(12);
    expect(screen.getByRole("status").textContent).toBe("正在评估本次回答");
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("shows blocked admission and retries only its read without hiding a later report", async () => {
    const admission = { status: "blocked" as const, code: "PREPARE_FAILED", message: "准备失败", updatedAt: "2026-11-06T02:00:00.000Z" };
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValueOnce({ latest: null, history: [], automaticExpected: false, automaticAdmission: admission });
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("评估未完成"));
    expect(screen.queryByText("当前回答暂无自动评估记录。")).toBeNull();
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: run(), history: [], automaticAdmission: admission });
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(screen.getByTestId("rag-report-automatic-record")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(liveEnterpriseRagEvaluationApi.latest).toHaveBeenCalledTimes(2);
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("retains a completed report during refresh and after a failed read", async () => {
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockResolvedValue({ latest: run(), history: [] });
    render(<RagEvaluationReportRecords preview={false} storageScopeKey="live:a" coordinate={coordinate} />);
    await waitFor(() => expect(screen.getByTestId("rag-report-automatic-record")).toBeTruthy());
    let rejectRead!: (error: Error) => void;
    vi.mocked(liveEnterpriseRagEvaluationApi.latest).mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    fireEvent.focus(window);
    expect(screen.getByTestId("rag-report-automatic-record").textContent).toContain("100 / 100");
    await act(async () => { rejectRead(new Error("读取失败")); });
    expect(screen.getByTestId("rag-report-automatic-record").textContent).toContain("100 / 100");
    expect(screen.getByRole("alert").textContent).toContain("保留上次成功读取");
    expect(liveEnterpriseRagEvaluationApi.start).not.toHaveBeenCalled();
  });

  it("reports unavailable browser storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    render(<RagEvaluationReportRecords preview storageScopeKey="preview" />);
    expect(screen.getByRole("alert").textContent).toContain("浏览器存储不可用");
  });
});
