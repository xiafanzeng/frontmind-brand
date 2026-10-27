import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  questionBasisOf,
  useQuestionFreshness,
} from "./use-question-freshness";
import type { ResponseLogicQuestionContext } from "./response-logic-question-context-client.js";

const Q1 = questionBasisOf("Q1 原问题", "intent-a");
const Q2_CONTEXT: ResponseLogicQuestionContext = {
  questionId: "t:1",
  question: "Q2 新问题",
  intent: "intent-a",
  workspaceRevision: 6,
};

function createFetcher() {
  const state = { next: "q1" as "q1" | "q2" | "missing" | "error", calls: 0 };
  const fetchContext = vi.fn(async (): Promise<ResponseLogicQuestionContext | null> => {
    state.calls += 1;
    if (state.next === "error") throw new Error("读取最新问题失败，请检查网络后重试");
    if (state.next === "missing") return null;
    if (state.next === "q2") return Q2_CONTEXT;
    return { questionId: "t:1", question: "Q1 原问题", intent: "intent-a", workspaceRevision: 5 };
  });
  return { state, fetchContext };
}

function renderFreshness(fetchContext: ReturnType<typeof createFetcher>["fetchContext"], currentBasis = Q1) {
  return renderHook(() =>
    useQuestionFreshness({ questionId: "t:1", currentBasis, fetchContext }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useQuestionFreshness", () => {
  it("marks the context stale when the server question changed (Q1→Q2)", async () => {
    const { state, fetchContext } = createFetcher();
    const view = renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(view.result.current.stale).toBe(false);

    state.next = "q2";
    await act(async () => { await view.result.current.checkNow(); });
    expect(view.result.current.stale).toBe(true);
    expect(view.result.current.latest?.question).toBe("Q2 新问题");
  });

  it("adopts the latest question and restores a working basis", async () => {
    const { state, fetchContext } = createFetcher();
    const view = renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    state.next = "q2";
    await act(async () => { await view.result.current.checkNow(); });
    expect(view.result.current.stale).toBe(true);

    await act(async () => { view.result.current.applyLatest(); });
    expect(view.result.current.basis).toBe(questionBasisOf("Q2 新问题", "intent-a"));
    expect(view.result.current.stale).toBe(false);

    // A further check against the same server question stays fresh — the
    // recovery path leaves the user able to evaluate and optimize again.
    await act(async () => { await view.result.current.checkNow(); });
    expect(view.result.current.stale).toBe(false);
  });

  it("does not invalidate anything while the question is unchanged", async () => {
    const { fetchContext } = createFetcher();
    const view = renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const callsAfterMount = fetchContext.mock.calls.length;
    await act(async () => { await view.result.current.checkNow(); });
    await act(async () => { view.rerender(); });
    expect(view.result.current.stale).toBe(false);
    expect(view.result.current.deleted).toBe(false);
    expect(view.result.current.checkError).toBeNull();
    expect(fetchContext.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("treats a deleted or inaccessible question as stale with a distinct flag", async () => {
    const { state, fetchContext } = createFetcher();
    const view = renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    state.next = "missing";
    await act(async () => { await view.result.current.checkNow(); });
    expect(view.result.current.deleted).toBe(true);
    expect(view.result.current.stale).toBe(true);
    expect(view.result.current.latest).toBeNull();
    // A deleted question has no recovery inside the workbench: applyLatest
    // must not fabricate a fresh basis.
    act(() => { view.result.current.applyLatest(); });
    expect(view.result.current.deleted).toBe(true);
  });

  it("never treats an unverified read failure as confirmed-fresh", async () => {
    const { state, fetchContext } = createFetcher();
    const view = renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    state.next = "error";
    let verified = true;
    await act(async () => { verified = await view.result.current.checkNow(); });
    expect(verified).toBe(false);
    expect(view.result.current.checkError).toContain("读取最新问题失败");
    // The pre-start guard refuses dispatch while unverified: basis unchanged
    // but checkNow reports false, which the workspace treats as blocked.
  });

  it("re-checks when the page regains focus", async () => {
    const { state, fetchContext } = createFetcher();
    renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const callsAfterMount = fetchContext.mock.calls.length;

    state.next = "q2";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchContext.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("polls at a low frequency while the page stays visible", async () => {
    const { fetchContext } = createFetcher();
    renderFreshness(fetchContext);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const callsAfterMount = fetchContext.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchContext.mock.calls.length).toBe(callsAfterMount + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchContext.mock.calls.length).toBe(callsAfterMount + 2);
  });
});

describe("questionBasisOf", () => {
  it("separates text edits and intent edits from the unchanged basis", async () => {
    expect(questionBasisOf("Q1", "i1")).toBe(questionBasisOf("Q1", "i1"));
    expect(questionBasisOf("Q1", "i1")).not.toBe(questionBasisOf("Q2", "i1"));
    expect(questionBasisOf("Q1", "i1")).not.toBe(questionBasisOf("Q1", "i2"));
    expect(questionBasisOf("Q1", null)).toBe(questionBasisOf("Q1", ""));
  });
});
