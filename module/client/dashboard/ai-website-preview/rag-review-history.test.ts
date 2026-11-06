import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterpriseRagHistoryStorageKey, loadRagReviewHistory, readRagReviewHistory, type RagReviewRecord } from "./rag-review-history";

function record(id: string): RagReviewRecord {
  return { id, question: "问题", answer: "原回答", need: "任务", reviewer: "评审人", time: "2026-11-06T01:00:00Z", ruleVersion: "rag-eval-1.2", knowledgeVersion: "v1", dimensions: [], gates: [] };
}

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("shared RAG review history", () => {
  it("retains original scoped keys and never falls back to another scope", () => {
    expect(enterpriseRagHistoryStorageKey()).toBe("frontmind-rag-reviews-v1");
    expect(enterpriseRagHistoryStorageKey(" live:1:项目 ")).toBe("frontmind-rag-reviews-v1.live%3A1%3A%E9%A1%B9%E7%9B%AE");
    localStorage.setItem(enterpriseRagHistoryStorageKey("a"), JSON.stringify([record("a")]));
    expect(loadRagReviewHistory(enterpriseRagHistoryStorageKey("b"))).toEqual([]);
  });

  it("preserves legacy and unknown rule records and the 30-record limit", () => {
    const data = Array.from({ length: 35 }, (_, index) => ({ ...record(String(index)), ruleVersion: index === 0 ? "rag-eval-9.9" : "rag-eval-1.2" }));
    localStorage.setItem("history", JSON.stringify(data));
    expect(loadRagReviewHistory("history")).toEqual(data.slice(0, 30));
  });

  it("keeps valid records and reports malformed storage without rewriting it", () => {
    const raw = JSON.stringify([record("kept"), { id: "broken" }]);
    localStorage.setItem("history", raw);
    expect(readRagReviewHistory("history")).toEqual({ records: [record("kept")], status: "invalid", discarded: 1 });
    expect(localStorage.getItem("history")).toBe(raw);
    localStorage.setItem("history", "{");
    expect(readRagReviewHistory("history").status).toBe("invalid");
    expect(loadRagReviewHistory("history")).toEqual([]);
  });

  it("distinguishes unavailable storage from empty history", () => {
    expect(readRagReviewHistory("history").status).toBe("ready");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(readRagReviewHistory("history")).toEqual({ records: [], status: "unavailable", discarded: 0 });
  });
});
