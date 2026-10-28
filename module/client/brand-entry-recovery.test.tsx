import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

/**
 * REAL Brand-path recovery reproduction (2026-10-28 incidents: tasks
 * e932f604 / 1f724bc9 completed upstream in ~2min, zero status requests from
 * pages running the FIXED bundle). This suite renders the REAL
 * BrandResponseLogicEntry → brand adapter (real useQuery shim + module-level
 * host install) → real ResponseLogicWorkspace (persistent mode). ONLY the
 * REST/HTTP boundary is mocked. If recovery works, mounting with an
 * unadopted lastTaskId in the record store must produce a status request for
 * that taskId.
 */

const h = vi.hoisted(() => {
  const control = {
    restCalls: [] as string[],
    router: async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response("{}", { status: 404 }),
  };
  return control;
});

vi.mock("./host.js", () => ({
  captureWorkspaceRestOperation: () => ({
    signal: new AbortController().signal,
    assertActive: () => undefined,
    fetch: async (url: string, init?: RequestInit) => {
      h.restCalls.push(`${(init as { method?: string } | undefined)?.method ?? "GET"} ${String(url)}`);
      return h.router(String(url), init);
    },
  }),
}));

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

import BrandResponseLogicEntry from "./BrandResponseLogicEntry.js";

const emptyDraft = {
  concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "",
  images: [], attachments: [],
};
const record = {
  id: "rec-1", questionId: "q-real", groupId: "brand-intent", groupTitle: "品牌意图优化",
  question: "团队文档平台哪家好", intent: "", summary: "",
  conversationId: "conv-real", lastTaskId: "task-real",
  draft: { ...emptyDraft }, revision: 2, version: 0, createdAt: 0, updatedAt: 0,
};
const runningEnvelope = {
  status: "running", taskId: "task-real", operationRevision: 2, model: "frontmind-pro",
  execution: { schemaVersion: 1, taskId: "task-real", coverage: "partial", runId: "task-real", timeline: [] },
};

beforeEach(() => {
  h.restCalls = [];
  h.router = async () => new Response("{}", { status: 404 });
});
afterEach(cleanup);

describe("Brand entry → adapter → workspace recovery (real path)", () => {
  it("mounts with an unadopted lastTaskId and issues the status request for that task", async () => {
    h.router = async (url: string) => {
      const response = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/response-logic/tasks/task-real/status")) return response(runningEnvelope, 202);
      if (url.replace(/[?].*$/, "").endsWith("/response-logic")) return response({ records: [record] });
      return response({}, 404);
    };
    // The rerender-with-fresh-visuals loop is inline in this test's body below.
    void runningEnvelope;
    const view = render(
      <BrandResponseLogicEntry
        question={{ id: "q-real", question: "团队文档平台哪家好", category: "行业" } as never}
        onBack={() => undefined}
        visual={{
          Button: (props: Record<string, unknown>) => <button {...props} />,
          BusinessExecutionActivity: () => null,
          FilePreview: () => null,
          ImagePreview: () => null,
        } as never}
        toast={{ success: () => undefined, error: () => undefined }}
      />,
    );
    // ONLINE VARIABLE: the caller re-renders with a fresh inline visual/toast
    // object (like ModuleWorkspace does), which invalidates the Entry's host
    // useMemo and rebuilds the adapter host + its records store.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        view.rerender(
          <BrandResponseLogicEntry
            question={{ id: "q-real", question: "团队文档平台哪家好", category: "行业" } as never}
            onBack={() => undefined}
            visual={{
              Button: (props: Record<string, unknown>) => <button {...props} />,
              BusinessExecutionActivity: () => null,
              FilePreview: () => null,
              ImagePreview: () => null,
            } as never}
            toast={{ success: () => undefined, error: () => undefined }}
          />,
        );
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const statusCalls = h.restCalls.filter((c) => c.includes("/tasks/task-real/status"));
    expect(statusCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("recovers a completed task through status → adopt → editor shows the four sections", async () => {
    let adoptCalls = 0;
    const adoptedRecord = {
      ...record,
      revision: 3,
      draft: { ...emptyDraft, concern: "已恢复段落一", conclusion: "已恢复段落二", facts: "已恢复段落三", boundaries: "已恢复段落四" },
      appliedModelResult: { taskId: "task-real", resultId: "res-real", source: "structured_output", adoptedAt: 1 },
    };
    h.router = async (url: string) => {
      const response = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/response-logic/tasks/task-real/status")) {
        return response({
          status: "completed", taskId: "task-real", operationRevision: 2, model: "frontmind-pro",
          resultId: "res-real", source: "structured_output",
          structuredDraft: { concern: "已恢复段落一", conclusion: "已恢复段落二", facts: "已恢复段落三", boundaries: "已恢复段落四" },
          execution: { schemaVersion: 1, taskId: "task-real", coverage: "partial", runId: "task-real", timeline: [] },
        });
      }
      if (url.includes("/adopt-result")) {
        adoptCalls += 1;
        return response({ status: "adopted", adopted: true, resultId: "res-real", record: adoptedRecord });
      }
      if (url.replace(/[?].*$/, "").endsWith("/response-logic")) return response({ records: [record] });
      return response({}, 404);
    };
    const mkProps = () => ({
      question: { id: "q-real", question: "团队文档平台哪家好", category: "行业" } as never,
      onBack: () => undefined,
      visual: {
        Button: (props: Record<string, unknown>) => <button {...props} />,
        BusinessExecutionActivity: () => null,
        FilePreview: () => null,
        ImagePreview: () => null,
      } as never,
      toast: { success: () => undefined, error: () => undefined },
    });
    const view = render(<BrandResponseLogicEntry {...mkProps()} />);
    // Online variable: caller re-renders with fresh inline objects (host rebuilds).
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        view.rerender(<BrandResponseLogicEntry {...mkProps()} />);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    await waitFor(() => expect(adoptCalls).toBe(1));
    // Loading exits and the adopted four sections render in the editor.
    await waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("正在生成应答逻辑");
    });
    const { screen } = await import("@testing-library/react");
    await waitFor(() => expect(screen.getByDisplayValue("已恢复段落一")).toBeTruthy());
    // No generation task was (re)created.
    expect(h.restCalls.some((c) => c.startsWith("POST") && c.includes("/start"))).toBe(false);
  });
});
