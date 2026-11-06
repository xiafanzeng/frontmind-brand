// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { ragPreviewHistoryStorageKey, useRagPreviewHistory, type RagPreviewConversationSnapshot } from "./useRagPreviewHistory";

const sample = (question: string): RagPreviewConversationSnapshot => ({
  previousTurns: [{ id: "turn-previous", question: "之前的问题", answer: "之前的回答" }],
  question, answer: `回答${question}`, need: "了解产品", input: "草稿", caseId: null,
  dimensions: [], gates: [], mode: "manual", previewAnswerIdentity: `authored:${question}`, completedAt: 123,
});
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear();
  for (const scope of ["a", "b", "project-a"]) localStorage.setItem(ragPreviewHistoryStorageKey(scope), JSON.stringify({ seeded: true, conversations: [] }));
});
afterEach(cleanup);

describe("local synthetic conversation history", () => {
  it("saves explicit snapshots, restores complete conversation after reload and preserves drafts", () => {
    const { result, unmount } = renderHook(() => useRagPreviewHistory("project-a"));
    const first = result.current.activeId;
    act(() => { result.current.save(sample("一")); });
    act(() => { result.current.create(); result.current.save(sample("二")); });
    expect(result.current.conversations.map(item => item.question)).toEqual(["二", "一"]);
    act(() => { expect(result.current.select(first)?.previousTurns[0].question).toBe("之前的问题"); });
    unmount();
    const restored = renderHook(() => useRagPreviewHistory("project-a"));
    expect(restored.result.current.activeId).toBe(first);
    expect(restored.result.current.activeSnapshot).toMatchObject({ question: "一", input: "草稿", previousTurns: [{ question: "之前的问题", answer: "之前的回答" }] });
  });

  it("keeps empty sessions out of history and rejects delayed saves for another conversation", () => {
    const { result } = renderHook(() => useRagPreviewHistory("project-a"));
    const first = result.current.activeId;
    const empty = { ...sample(""), question: "", answer: "", input: "" };
    act(() => { expect(result.current.save(empty)).toBe(false); });
    expect(result.current.conversations).toHaveLength(0);
    act(() => { result.current.save(sample("一")); });
    act(() => { result.current.create(); });
    act(() => { expect(result.current.save(sample("迟到数据"), first)).toBe(false); });
    expect(result.current.conversations.map(item => item.question)).toEqual(["一"]);
  });

  it("removes inactive and active conversations and switches to the newest remaining entry", () => {
    const { result } = renderHook(() => useRagPreviewHistory("project-a"));
    const first = result.current.activeId;
    act(() => { result.current.save(sample("一")); result.current.create(); result.current.save(sample("二")); });
    const second = result.current.activeId;
    act(() => { expect(result.current.remove(first)).toEqual({ wasActive: false, next: null }); });
    act(() => { result.current.create(); result.current.save(sample("三")); });
    const third = result.current.activeId;
    act(() => { expect(result.current.remove(third)).toMatchObject({ wasActive: true, next: { id: second, question: "二" } }); });
    expect(result.current.activeId).toBe(second);
    act(() => { expect(result.current.remove(second)).toEqual({ wasActive: true, next: null }); });
    expect(result.current.activeSnapshot).toBeNull();
    expect(result.current.activeId).not.toBe(second);
  });

  it("isolates workspaces and never reads or writes local storage when disabled", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const { result, rerender } = renderHook(({ scope, enabled }) => useRagPreviewHistory(scope, enabled), { initialProps: { scope: "a", enabled: true } });
    act(() => { result.current.save(sample("a私有")); });
    rerender({ scope: "b", enabled: true });
    expect(result.current.conversations).toEqual([]);
    act(() => { result.current.save(sample("b私有")); });
    rerender({ scope: "a", enabled: true });
    expect(result.current.conversations.map(item => item.question)).toEqual(["a私有"]);
    get.mockClear(); set.mockClear();
    rerender({ scope: "a", enabled: false });
    act(() => { result.current.save(sample("ignored")); result.current.create(); });
    expect(result.current.conversations).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("reads older snapshots without prior turns and ignores corrupt entries", () => {
    const { previousTurns: _turns, ...oldSnapshot } = sample("旧记录");
    localStorage.setItem(ragPreviewHistoryStorageKey("a"), JSON.stringify({ activeId: "old", conversations: [{ ...oldSnapshot, id: "old", updatedAt: 100 }, { id: "broken" }] }));
    const { result } = renderHook(() => useRagPreviewHistory("a"));
    expect(result.current.conversations).toHaveLength(1 + RAG_SAMPLE_CASES.length);
    expect(result.current.activeSnapshot?.previousTurns).toEqual([]);
  });

  it("seeds the sample cases once per scope and never recreates deleted cases", () => {
    const first = renderHook(() => useRagPreviewHistory("fresh"));
    expect(first.result.current.conversations.map(item => item.caseId)).toEqual(RAG_SAMPLE_CASES.map(item => item.id));
    expect(first.result.current.activeSnapshot?.question).toBe(RAG_SAMPLE_CASES[0].question);
    expect(JSON.parse(localStorage.getItem(ragPreviewHistoryStorageKey("fresh"))!).seeded).toBe(true);
    for (const item of [...first.result.current.conversations]) act(() => { first.result.current.remove(item.id); });
    expect(first.result.current.conversations).toEqual([]);
    first.unmount();
    const restored = renderHook(() => useRagPreviewHistory("fresh"));
    expect(restored.result.current.conversations).toEqual([]);
  });

  it("migrates old histories once while preserving the user's session and selection", () => {
    const current = { ...sample("自己的问题"), id: "own", updatedAt: 99 };
    const existingCase = RAG_SAMPLE_CASES[0];
    const previousSample = { ...sample(existingCase.question), id: "old-sample", caseId: existingCase.id, mode: "sample" };
    localStorage.setItem(ragPreviewHistoryStorageKey("migrated"), JSON.stringify({ activeId: "own", conversations: [current, { ...previousSample, updatedAt: 98 }] }));
    const { result, unmount } = renderHook(() => useRagPreviewHistory("migrated"));
    expect(result.current.activeId).toBe("own");
    expect(result.current.conversations).toHaveLength(1 + RAG_SAMPLE_CASES.length);
    expect(result.current.conversations.filter(item => item.caseId === existingCase.id)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(ragPreviewHistoryStorageKey("migrated"))!).seeded).toBe(true);
    unmount();
    expect(renderHook(() => useRagPreviewHistory("migrated")).result.current.conversations).toHaveLength(1 + RAG_SAMPLE_CASES.length);
  });

  it("keeps history available in memory if storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    const { result } = renderHook(() => useRagPreviewHistory("a"));
    expect(result.current.storageAvailable).toBe(false);
    act(() => { result.current.save(sample("内存")); result.current.create(); });
    expect(result.current.conversations.some(item => item.question === "内存")).toBe(true);
    expect(result.current.storageAvailable).toBe(false);
    act(() => { expect(result.current.select(result.current.conversations.find(item => item.question === "内存")!.id)?.question).toBe("内存"); });
  });
});


it("starts fresh on every mount and scope change while preserving stored conversations", () => {
  const first=renderHook(({scope})=>useRagPreviewHistory(scope,true,true),{initialProps:{scope:"project-a"}});
  expect(first.result.current.activeSnapshot).toBeNull();
  act(()=>{first.result.current.save(sample("已保存"));});
  const savedId=first.result.current.activeId;
  first.unmount();
  const reopened=renderHook(({scope})=>useRagPreviewHistory(scope,true,true),{initialProps:{scope:"project-a"}});
  expect(reopened.result.current.activeId).not.toBe(savedId);
  expect(reopened.result.current.activeSnapshot).toBeNull();
  expect(reopened.result.current.conversations.find(item=>item.id===savedId)?.question).toBe("已保存");
  act(()=>{reopened.result.current.select(savedId);});
  expect(reopened.result.current.activeSnapshot?.question).toBe("已保存");
  reopened.rerender({scope:"b"}); reopened.rerender({scope:"project-a"});
  expect(reopened.result.current.activeSnapshot).toBeNull();
  expect(reopened.result.current.conversations.find(item=>item.id===savedId)?.question).toBe("已保存");
});
