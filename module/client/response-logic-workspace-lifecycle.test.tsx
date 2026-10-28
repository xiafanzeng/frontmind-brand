import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Real-component lifecycle tests for the response-logic generation state
 * machine (2026-10-28 incident class: task finished upstream, page stuck on
 * "正在生成" with zero status requests). Only the HTTP/host boundary is
 * mocked; the real ResponseLogicWorkspace (persistent mode) is rendered.
 */

const h = vi.hoisted(() => {
  const control = {
    isLoading: true,
    records: undefined as undefined | Array<Record<string, unknown>>,
    restCalls: [] as string[],
    router: async () => new Response("{}", { status: 404 }),
  };
  return control;
});

vi.mock("./response-logic-runtime-host.js", async () => {
  const React = await import("react");
  return {
    trpc: {
      useUtils: () => ({ workspace: { responseLogic: { setData: () => undefined } } }),
      workspace: {
        responseLogic: {
          useQuery: () => ({
            isLoading: h.isLoading,
            isFetching: false,
            isSuccess: !h.isLoading,
            isError: false,
            data: h.records ? { records: h.records } : undefined,
            error: null,
            refetch: async () => ({ data: { records: h.records ?? [] } }),
          }),
        },
        saveResponseLogic: {
          useMutation: () => ({ mutateAsync: async (input: unknown) => input }),
        },
      },
    },
    activeEnterpriseProjectId: () => "scope-1",
    useSearch: () => "",
    captureWorkspaceRestOperation: () => ({
      fetch: async (url: string, init?: RequestInit) => {
        h.restCalls.push(`${(init as { method?: string } | undefined)?.method ?? "GET"} ${String(url)}`);
        return h.router(String(url), init);
      },
      assertActive: () => undefined,
    }),
    Button: (props: { children?: unknown }) => React.createElement("button", props as never),
    FilePreview: () => null,
    ImagePreview: () => null,
    BusinessExecutionActivity: () => null,
    toast: { success: () => undefined, error: () => undefined },
    loadPreviewAdapter: async () => null,
  };
});

vi.mock("./use-judge-evaluation", () => ({
  useJudgeEvaluation: () => ({ start: () => undefined, reset: () => undefined, state: { phase: "idle" } }),
}));
vi.mock("./use-optimization-generation", () => ({
  useOptimizationGeneration: () => ({ start: () => undefined, reset: () => undefined, state: { phase: "idle" } }),
}));
vi.mock("./use-question-freshness", () => ({
  useQuestionFreshness: () => ({ basis: "basis", checkNow: async () => true, unverified: false }),
}));
vi.mock("./response-logic-question-context-client", () => ({
  fetchResponseLogicQuestionContext: async () => null,
}));
vi.mock("./response-logic/evaluation-panel", () => ({
  ResponseLogicEvaluationPanel: () => null,
}));
vi.mock("./response-logic/optimization-workflow", () => ({
  ResponseLogicOptimizationWorkflow: () => null,
}));

import ResponseLogicWorkspace from "./ResponseLogicWorkspace";
import type { IntentQuestionGroup } from "./ResponseLogicWorkspace";

const emptyDraft = {
  concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "",
  images: [], attachments: [],
};
const record = (over: Record<string, unknown> = {}) => ({
  id: "rec-1", questionId: "q-1", groupId: "g", groupTitle: "t", question: "Q1",
  intent: "", summary: "", conversationId: "conv-1", lastTaskId: "task-1",
  draft: { ...emptyDraft }, revision: 2, version: 0, createdAt: 0, updatedAt: 0,
  ...over,
});
const groups = (qid: string, text: string): IntentQuestionGroup[] => [{
  id: "g", title: "品牌意图优化", subtitle: "测试", tone: "plum",
  questions: [{ id: qid, question: text, intent: "", summary: "" }],
}];

const completedEnvelope = {
  status: "completed", taskId: "task-1", operationRevision: 2, model: "frontmind-pro",
  resultId: "res-1", source: "structured_output",
  structuredDraft: { concern: "c1", conclusion: "c2", facts: "c3", boundaries: "c4" },
  execution: { schemaVersion: 1, taskId: "task-1", coverage: "partial", runId: "task-1", timeline: [] },
};
const runningEnvelope = {
  status: "running", taskId: "task-1", operationRevision: 2, model: "frontmind-pro",
  execution: { schemaVersion: 1, taskId: "task-1", coverage: "partial", runId: "task-1", timeline: [] },
};
const adoptedRecord = () =>
  record({
    revision: 3,
    draft: { ...emptyDraft, concern: "c1", conclusion: "c2", facts: "c3", boundaries: "c4" },
    appliedModelResult: { taskId: "task-1", resultId: "res-1", source: "structured_output", adoptedAt: 1 },
  });

function respondJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  h.isLoading = true;
  h.records = undefined;
  h.restCalls = [];
  h.router = async () => respondJson({}, 404);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("mount recovery from the authoritative record", () => {
  it("recovers a bound, unadopted task once records load late, and immediately queries status", async () => {
    h.router = async () => respondJson(runningEnvelope, 202);
    const props = { preview: false as const, questionGroups: groups("q-t1", "Q1"), initialQuestionId: "q-t1" };
    const view = render(<ResponseLogicWorkspace {...props} />);
    // Records not loaded yet: no recovery, no status call.
    await act(async () => { await Promise.resolve(); });
    expect(h.restCalls.filter((c) => c.includes("/tasks/task-1/status"))).toHaveLength(0);
    await act(async () => {
      h.records = [record({ questionId: "q-t1" })];
      h.isLoading = false;
      view.rerender(<ResponseLogicWorkspace {...props} />);
    });
    await waitFor(() => {
      expect(h.restCalls.filter((c) => c.includes("/tasks/task-1/status")).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("正在生成应答逻辑…")).toBeTruthy();
    view.unmount();
  });

  it("does not recover an already-adopted result (no status call at all)", async () => {
    h.router = async () => {
      throw new Error("must not be called");
    };
    render(
      <ResponseLogicWorkspace preview={false} questionGroups={groups("q-t2", "Q1")} initialQuestionId="q-t2" />,
    );
    await act(async () => {
      h.records = [adoptedRecord()];
      h.isLoading = false;
      await Promise.resolve();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(h.restCalls.filter((c) => c.includes("/tasks/"))).toHaveLength(0);
    expect(screen.queryByText("正在生成应答逻辑…")).toBeNull();
  });
});

describe("completed terminal path", () => {
  it("queries status, adopts once, exits loading and shows the saved sections", async () => {
    let adoptCalls = 0;
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) return respondJson(completedEnvelope, 200);
      if (url.includes("/adopt-result")) {
        adoptCalls += 1;
        return respondJson({ status: "adopted", adopted: true, resultId: "res-1", record: adoptedRecord() });
      }
      return respondJson({}, 404);
    };
    const props = { preview: false as const, questionGroups: groups("q-t3", "Q1"), initialQuestionId: "q-t3" };
    const view = render(<ResponseLogicWorkspace {...props} />);
    await act(async () => {
      h.records = [record({ questionId: "q-t3" })];
      h.isLoading = false;
      view.rerender(<ResponseLogicWorkspace {...props} />);
    });
    await waitFor(() => expect(adoptCalls).toBe(1));
    await waitFor(() => expect(screen.queryByText("正在生成应答逻辑…")).toBeNull());
    // The adopted four sections are rendered in the editor.
    await waitFor(() => expect(screen.getByDisplayValue("c1")).toBeTruthy());
    expect(h.restCalls.filter((c) => c.includes("POST") && c.includes("/adopt-result"))).toHaveLength(1);
  });

  it("coalesces concurrent completed observations into a single adopt request", async () => {
    let adoptCalls = 0;
    let releaseAdopt: (() => void) | null = null;
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) return respondJson(completedEnvelope, 200);
      if (url.includes("/adopt-result")) {
        adoptCalls += 1;
        await new Promise<void>((resolve) => { releaseAdopt = resolve; });
        return respondJson({ status: "adopted", adopted: true, resultId: "res-1", record: adoptedRecord() });
      }
      return respondJson({}, 404);
    };
    const props = { preview: false as const, questionGroups: groups("q-t4", "Q1"), initialQuestionId: "q-t4" };
    const view = render(<ResponseLogicWorkspace {...props} />);
    await act(async () => {
      h.records = [record({ questionId: "q-t4" })];
      h.isLoading = false;
      view.rerender(<ResponseLogicWorkspace {...props} />);
    });
    await waitFor(() => expect(adoptCalls).toBe(1));
    // While adopt is pending, a lifecycle poke re-queries and sees completed again.
    await act(async () => {
      fireEvent(window, new Event("focus"));
      await Promise.resolve();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(adoptCalls).toBe(1);
    releaseAdopt?.();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(adoptCalls).toBe(1);
  });
});

describe("lifecycle wake-up", () => {
  it("focus and visibilitychange trigger an immediate extra status query; bursts coalesce", async () => {
    h.router = async () => respondJson(runningEnvelope, 202);
    const props = { preview: false as const, questionGroups: groups("q-t5", "Q1"), initialQuestionId: "q-t5" };
    const view = render(<ResponseLogicWorkspace {...props} />);
    await act(async () => {
      h.records = [record({ questionId: "q-t5" })];
      h.isLoading = false;
      view.rerender(<ResponseLogicWorkspace {...props} />);
    });
    await waitFor(() => {
      expect(h.restCalls.filter((c) => c.includes("/tasks/task-1/status")).length).toBeGreaterThanOrEqual(1);
    });
    const before = h.restCalls.length;
    await act(async () => {
      fireEvent(window, new Event("focus"));
      fireEvent(window, new Event("pageshow"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      fireEvent(document, new Event("visibilitychange"));
      await Promise.resolve();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const added = h.restCalls.slice(before).filter((c) => c.includes("/tasks/task-1/status"));
    // One burst → exactly one immediate query (throttled coalescing works).
    expect(added).toHaveLength(1);
    expect(screen.getByText("正在生成应答逻辑…")).toBeTruthy();
  });
});

describe("question switch and unmount isolation", () => {
  it("switching questions stops observing the old task and recovers the new question's task", async () => {
    h.records = [
      record({ questionId: "q-t6", lastTaskId: "task-1", conversationId: "conv-1" }),
      record({ id: "rec-2", questionId: "q-t6b", lastTaskId: "task-2", conversationId: "conv-2", draft: { ...emptyDraft } }),
    ];
    h.isLoading = false;
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) return respondJson(runningEnvelope, 202);
      if (url.includes("/tasks/task-2/status")) {
        return respondJson({ ...runningEnvelope, taskId: "task-2" }, 202);
      }
      return respondJson({}, 404);
    };
    const all = groups("q-t6", "Q1")[0]!;
    const both: IntentQuestionGroup[] = [{
      ...all,
      questions: [...all.questions, { id: "q-t6b", question: "Q2", intent: "", summary: "" }],
    }];
    const view = render(
      <ResponseLogicWorkspace preview={false} questionGroups={both} initialQuestionId="q-t6" />,
    );
    await waitFor(() => {
      expect(h.restCalls.some((c) => c.includes("/tasks/task-1/status"))).toBe(true);
    });
    view.rerender(
      <ResponseLogicWorkspace preview={false} questionGroups={both} initialQuestionId="q-t6b" />,
    );
    await waitFor(() => {
      expect(h.restCalls.some((c) => c.includes("/tasks/task-2/status"))).toBe(true);
    });
    // Old task must not be polled anymore after the switch settles.
    const task1Calls = h.restCalls.filter((c) => c.includes("/tasks/task-1/status")).length;
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(h.restCalls.filter((c) => c.includes("/tasks/task-1/status"))).toHaveLength(task1Calls);
    view.unmount();
  });

  it("stops polling after unmount", async () => {
    h.isLoading = false;
    h.records = [record({ questionId: "q-t7" })];
    h.router = async () => respondJson(runningEnvelope, 202);
    const view = render(
      <ResponseLogicWorkspace preview={false} questionGroups={groups("q-t7", "Q1")} initialQuestionId="q-t7" />,
    );
    await waitFor(() => {
      expect(h.restCalls.filter((c) => c.includes("/tasks/task-1/status")).length).toBeGreaterThanOrEqual(1);
    });
    view.unmount();
    const after = h.restCalls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(h.restCalls).toHaveLength(after);
  });
});

describe("terminal failures", () => {
  it("a failed task exits loading with an error state", async () => {
    h.isLoading = false;
    h.records = [record({ questionId: "q-t8" })];
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) {
        return respondJson({ error: { code: "RESPONSE_LOGIC_TASK_FAILED", message: "任务失败" } }, 422);
      }
      return respondJson({}, 404);
    };
    render(
      <ResponseLogicWorkspace preview={false} questionGroups={groups("q-t8", "Q1")} initialQuestionId="q-t8" />,
    );
    await waitFor(() => expect(screen.getByText("生成未完成")).toBeTruthy());
    expect(screen.queryByText("正在生成应答逻辑…")).toBeNull();
  });

  it("an adopt failure shows a save-failed state (not infinite loading) and does not re-create tasks", async () => {
    h.isLoading = false;
    h.records = [record({ questionId: "q-t9" })];
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) return respondJson(completedEnvelope, 200);
      if (url.includes("/adopt-result")) {
        return respondJson({ error: { code: "RESPONSE_LOGIC_REVISION_CONFLICT", message: "版本冲突" } }, 409);
      }
      return respondJson({}, 404);
    };
    render(
      <ResponseLogicWorkspace preview={false} questionGroups={groups("q-t9", "Q1")} initialQuestionId="q-t9" />,
    );
    await waitFor(() => expect(screen.getByText("生成未完成")).toBeTruthy());
    expect(screen.queryByText("正在生成应答逻辑…")).toBeNull();
    // No generation task was (re)created: no start request was ever issued.
    expect(h.restCalls.some((c) => c.includes("POST") && c.includes("/start"))).toBe(false);
  });

  it("repeated transient network failures surface the degraded hint without a fake terminal state", async () => {
    vi.useFakeTimers();
    h.isLoading = false;
    h.records = [record({ questionId: "q-t10" })];
    let misses = 0;
    h.router = async (url: string) => {
      if (url.includes("/tasks/task-1/status")) {
        misses += 1;
        return respondJson({}, 503);
      }
      return respondJson({}, 404);
    };
    render(
      <ResponseLogicWorkspace preview={false} questionGroups={groups("q-t10", "Q1")} initialQuestionId="q-t10" />,
    );
    // Let the recovery chain (records → recovery effect → poll) flush first.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    }
    // Drive several poll cycles (initial + backoff retries).
    for (let i = 0; i < 8; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    }
    expect(misses).toBeGreaterThanOrEqual(5);
    // Fake timers freeze waitFor's clock — assert the flushed state directly.
    expect(screen.getByText(/暂时无法确认任务状态/)).toBeTruthy();
    // Still loading (task may still be running) — never a fake success/failure.
    expect(screen.getByText("正在生成应答逻辑…")).toBeTruthy();
    expect(screen.queryByText("生成未完成")).toBeNull();
  });
});
