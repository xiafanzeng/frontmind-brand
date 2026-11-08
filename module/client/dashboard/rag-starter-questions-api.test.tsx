import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  assertActive: vi.fn(),
  capture: vi.fn(),
  headers: vi.fn((extra: Record<string, string> = {}) => ({
    "X-Workspace": "workspace-1",
    ...extra,
  })),
}));

vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => mocks.capture(),
}));

import {
  liveRagStarterQuestionsApi,
  RagStarterQuestionsApiError,
  useRagStarterQuestions,
} from "./rag-starter-questions-api";

function item(id: string) {
  return {
    id,
    questions: ["你们提供哪些服务？", "如何联系你们？", "有哪些核心优势？"],
    source: "manual",
    knowledgeSnapshotId: "00000000-0000-4000-8000-000000000020",
    createdAt: "2026-11-07T12:00:00.000Z",
  };
}

function dto(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeBase: {
      id: "00000000-0000-4000-8000-000000000020",
      version: 2,
      archiveHash: "a".repeat(64),
      documentCount: 3,
    },
    current: item("00000000-0000-4000-8000-000000000021"),
    draft: null,
    pending: false,
    error: null,
    revision: 2,
    ...overrides,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockReturnValue(mocks);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RAG starter-question client API", () => {
  it("uses a side-effect-free GET for observation", async () => {
    mocks.fetch.mockResolvedValue(json(dto()));
    await expect(liveRagStarterQuestionsApi.read()).resolves.toMatchObject({ revision: 2 });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-starter-questions",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("activates the first generated draft without creating another provider task", async () => {
    const firstDraft = item("00000000-0000-4000-8000-000000000022");
    mocks.fetch.mockResolvedValueOnce(json(dto({
      current: null,
      draft: firstDraft,
      revision: 4,
    }))).mockResolvedValueOnce(json(dto({
      current: firstDraft,
      draft: null,
      revision: 5,
    })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.data?.current?.id).toBe(firstDraft.id));
    expect(hook.result.current.phase).toBe("ready");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({
      expectedCurrentSetId: null,
      expectedDraftSetId: firstDraft.id,
      questions: firstDraft.questions,
    });
  });

  it("reconciles a lost first-draft activation response before reporting a failure", async () => {
    const firstDraft = item("00000000-0000-4000-8000-000000000023");
    mocks.fetch.mockResolvedValueOnce(json(dto({ current: null, draft: firstDraft, revision: 4 })))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(json(dto({ current: firstDraft, draft: null, revision: 5 })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.data?.current?.id).toBe(firstDraft.id));
    expect(hook.result.current.error).toBeNull();
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "PUT", "GET"]);
  });

  it("adopts the winning current set when another tab activates the first draft", async () => {
    const firstDraft = item("00000000-0000-4000-8000-000000000025");
    mocks.fetch.mockResolvedValueOnce(json(dto({ current: null, draft: firstDraft, revision: 4 })))
      .mockResolvedValueOnce(json({
        error: { code: "STARTER_VERSION_CONFLICT", message: "预设问题已在其他页面更新。" },
      }, 409))
      .mockResolvedValueOnce(json(dto({ current: firstDraft, draft: null, revision: 5 })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.data?.current?.id).toBe(firstDraft.id));
    expect(hook.result.current.error).toBeNull();
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "PUT", "GET"]);
  });

  it("keeps a failed first activation visible without retrying it in a render loop", async () => {
    const firstDraft = item("00000000-0000-4000-8000-000000000026");
    const draftDto = dto({ current: null, draft: firstDraft, revision: 4 });
    mocks.fetch.mockResolvedValueOnce(json(draftDto))
      .mockResolvedValueOnce(json({
        error: { code: "REQUEST_FAILED", message: "预设问题启用失败。" },
      }, 500))
      .mockResolvedValueOnce(json(draftDto));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.phase).toBe("error"));
    expect(hook.result.current.data?.draft?.id).toBe(firstDraft.id);
    hook.rerender();
    hook.rerender();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "PUT", "GET"]);
  });

  it("starts one idempotent generation only when the published knowledge has no starter state", async () => {
    const empty = dto({ current: null, draft: null, pending: false, revision: 0 });
    const pending = dto({ current: null, draft: null, pending: true, pendingSetId: "set-1", revision: 1 });
    mocks.fetch.mockResolvedValueOnce(json(empty)).mockResolvedValueOnce(json(pending));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.data?.pending).toBe(true));
    hook.rerender();
    hook.rerender();
    expect(hook.result.current.phase).toBe("generating");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "POST"]);
    const request = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(request).toMatchObject({ expectedCurrentSetId: null, expectedDraftSetId: null });
    expect(request.clientRequestId).toEqual(expect.any(String));
  });

  it("does not generate or auto-confirm when a current set already exists", async () => {
    mocks.fetch.mockResolvedValue(json(dto({
      draft: item("00000000-0000-4000-8000-000000000024"),
      revision: 4,
    })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].method).toBe("GET");
  });

  it("observes an existing pending generation without starting another one", async () => {
    mocks.fetch.mockResolvedValue(json(dto({
      current: null,
      draft: null,
      pending: true,
      pendingSetId: "set-1",
      revision: 1,
    })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await waitFor(() => expect(hook.result.current.phase).toBe("generating"));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].method).toBe("GET");
  });

  it("activates the first draft returned by pending polling without another generation request", async () => {
    vi.useFakeTimers();
    const firstDraft = item("00000000-0000-4000-8000-000000000027");
    mocks.fetch.mockResolvedValueOnce(json(dto({
      current: null,
      draft: null,
      pending: true,
      pendingSetId: "set-1",
      revision: 1,
    }))).mockResolvedValueOnce(json(dto({
      current: null,
      draft: firstDraft,
      pending: false,
      pendingSetId: null,
      revision: 2,
    }))).mockResolvedValueOnce(json(dto({
      current: firstDraft,
      draft: null,
      pending: false,
      pendingSetId: null,
      revision: 3,
    })));
    const hook = renderHook(() => useRagStarterQuestions(true, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.phase).toBe("generating");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data?.current?.id).toBe(firstDraft.id);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "GET", "PUT"]);
  });

  it("refreshes the winning server version after HTTP 409 so an edit can be retried", async () => {
    mocks.fetch.mockResolvedValueOnce(json(dto())).mockResolvedValueOnce(json({
      error: { code: "STARTER_VERSION_CONFLICT", message: "预设问题已在其他页面更新。" },
    }, 409)).mockResolvedValueOnce(json(dto({
      current: item("00000000-0000-4000-8000-000000000031"),
      revision: 3,
    })));
    const hook = renderHook(() => useRagStarterQuestions());
    await waitFor(() => expect(hook.result.current.data?.revision).toBe(2));
    await act(async () => {
      await hook.result.current.confirm(["保留的编辑一", "保留的编辑二", "保留的编辑三"]).catch(() => undefined);
    });
    expect(hook.result.current.data).toMatchObject({
      revision: 3,
      current: { id: "00000000-0000-4000-8000-000000000031" },
    });
    expect(hook.result.current.error).toBeNull();
    mocks.fetch.mockResolvedValueOnce(json(dto({ revision: 4 })));
    await act(async () => {
      await hook.result.current.confirm(["保留的编辑一", "保留的编辑二", "保留的编辑三"]);
    });
    const retry = JSON.parse(mocks.fetch.mock.calls[3][1].body);
    expect(retry.expectedCurrentSetId).toBe("00000000-0000-4000-8000-000000000031");
  });

  it("reuses the regeneration request id after a lost receipt and clears it after success", async () => {
    mocks.fetch.mockResolvedValueOnce(json(dto()))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(json(dto({ pending: true, pendingSetId: "00000000-0000-4000-8000-000000000041" })))
      .mockResolvedValueOnce(json(dto()))
      .mockResolvedValueOnce(json(dto({ pending: true, pendingSetId: "00000000-0000-4000-8000-000000000042" })));
    const hook = renderHook(() => useRagStarterQuestions());
    await waitFor(() => expect(hook.result.current.data?.revision).toBe(2));
    await act(async () => { await hook.result.current.regenerate().catch(() => undefined); });
    await act(async () => { await hook.result.current.regenerate(); });
    const first = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    const replay = JSON.parse(mocks.fetch.mock.calls[2][1].body);
    expect(replay.clientRequestId).toBe(first.clientRequestId);
    await act(async () => { await hook.result.current.reload(); });
    await act(async () => { await hook.result.current.regenerate(); });
    const next = JSON.parse(mocks.fetch.mock.calls[4][1].body);
    expect(next.clientRequestId).not.toBe(first.clientRequestId);
  });

  it("polls with GET only while generation is pending and stops at the draft", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(json(dto({ pending: true, pendingSetId: "set-1" })))
      .mockResolvedValueOnce(json(dto({
        pending: false,
        draft: item("00000000-0000-4000-8000-000000000022"),
        revision: 3,
      })));
    const hook = renderHook(() => useRagStarterQuestions());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.data?.pending).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(hook.result.current.data?.draft?.id).toBe("00000000-0000-4000-8000-000000000022");
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });
});
