import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  assertActive: vi.fn(),
  headers: vi.fn((extra: Record<string, string> = {}) => ({
    "X-Workspace": "workspace-1",
    ...extra,
  })),
}));

vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => mocks,
}));

import { liveEnterpriseRagEvaluationApi } from "./enterprise-rag-evaluation-api";

function run(status = "running") {
  return {
    operationId: "operation-1",
    sourceQaTaskId: "task-1",
    turnId: "turn-1",
    status,
    createdAt: "2026-10-26T01:00:00.000Z",
    updatedAt: "2026-10-26T01:00:01.000Z",
    report: null,
    error: null,
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
});

describe("enterprise RAG evaluation API", () => {
  it("loads server history with GET only and both immutable answer coordinates", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ latest: run(), history: [run("completed")] }),
    );

    const result = await liveEnterpriseRagEvaluationApi.latest({
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
    });

    expect(result.latest?.operationId).toBe("operation-1");
    expect(result.history).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-evaluations?sourceQaTaskId=task-1&turnId=turn-1",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("starts evaluation only through an explicit POST with the idempotency id", async () => {
    mocks.fetch.mockResolvedValueOnce(json(run("queued")));

    await liveEnterpriseRagEvaluationApi.start({
      clientRequestId: "5b68c3e8-6c46-4a0f-9a95-214c987be14e",
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-evaluations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          clientRequestId: "5b68c3e8-6c46-4a0f-9a95-214c987be14e",
          sourceQaTaskId: "task-1",
          turnId: "turn-1",
        }),
      }),
    );
  });

  it("rejects a structurally invalid run instead of displaying it", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ status: "completed" }));

    await expect(
      liveEnterpriseRagEvaluationApi.observe("operation-1"),
    ).rejects.toThrow(/数据结构不正确/);
  });
});
