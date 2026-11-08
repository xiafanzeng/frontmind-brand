import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  assertActive: vi.fn(),
  capture: vi.fn(),
  headers: vi.fn((extra: Record<string, string> = {}) => ({ "X-Workspace": "workspace-1", ...extra })),
}));

vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => mocks.capture(),
}));

import { liveEnterpriseRagHumanReviewApi } from "./enterprise-rag-human-review-api";
import type { EnterpriseRagHumanReviewCreateInput } from "../../contracts/enterprise-rag-human-review";

const dimensionIds = ["intent", "correctness", "completeness", "citations", "clarity", "boundaries"] as const;
const gateIds = ["facts", "citations", "permissions", "safety", "unknown", "injection", "availability"] as const;

function review(overrides: Record<string, unknown> = {}) {
  const dimensions = dimensionIds.map(id => ({ id, level: 4 as const, rationale: `${id} 已核验`, evidenceIds: ["answer-1"], applicable: true }));
  const gates = gateIds.map(id => ({ id, status: "passed" as const, reason: `${id} 已核验` }));
  return {
    id: "00000000-0000-4000-8000-000000000100",
    clientRequestId: "00000000-0000-4000-8000-000000000101",
    operationId: "00000000-0000-4000-8000-000000000102",
    reportId: "00000000-0000-4000-8000-000000000103",
    reviewer: { userId: 7, displayName: "评审人甲" },
    createdAt: "2026-11-08T08:00:00.000Z",
    supersedesReviewId: null,
    snapshot: { question: "问题", answer: "回答", need: "", knowledgeVersion: "企业知识库.zip · v7" },
    humanVerdict: "excellent",
    humanScore: 100,
    humanScoring: { version: "human-review-1.0.0", hash: "a".repeat(64) },
    alignment: "aligned",
    status: "aligned",
    dimensions,
    gates,
    diff: { alignment: "aligned", dimensions: [], gates: [] },
    ...overrides,
  };
}

function context() {
  return {
    operationId: "00000000-0000-4000-8000-000000000102",
    reportId: "00000000-0000-4000-8000-000000000103",
    canReview: true,
    reason: null,
    reviewer: { userId: 7, displayName: "评审人甲" },
    ai: {
      verdict: "excellent",
      score: 100,
      dimensions: dimensionIds.map(id => ({ id, level: 4 })),
      gates: gateIds.map(id => ({ id, status: "passed" })),
    },
    reviews: [review()],
  };
}

function input(): EnterpriseRagHumanReviewCreateInput {
  const row = review();
  return {
    clientRequestId: row.clientRequestId,
    operationId: row.operationId,
    reportId: row.reportId,
    dimensions: row.dimensions,
    gates: row.gates,
    confirmed: true,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockReturnValue(mocks);
});

afterEach(() => vi.useRealTimers());

describe("enterprise RAG human-review API", () => {
  it("reads the authorized frozen review context through a GET", async () => {
    mocks.fetch.mockResolvedValue(json(context()));
    const result = await liveEnterpriseRagHumanReviewApi.context(context().operationId);
    expect(result.reviewer.displayName).toBe("评审人甲");
    expect(result.reviews[0].humanScoring).toEqual({ version: "human-review-1.0.0", hash: "a".repeat(64) });
    expect(result.reviews).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/modules/brand/rag-evaluations/${context().operationId}/review-context`,
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("requires the server-normalized integer comparison bucket", async () => {
    const value = context();
    value.ai.dimensions[0].level = 3.25;
    mocks.fetch.mockResolvedValue(json(value));
    await expect(liveEnterpriseRagHumanReviewApi.context(value.operationId)).rejects.toThrow(/数据结构不正确/);
  });

  it("rejects an unversioned or malformed human-scoring provenance", async () => {
    const value = context();
    value.reviews[0].humanScoring = { version: "human-review-1.0.0", hash: "not-a-hash" };
    mocks.fetch.mockResolvedValue(json(value));
    await expect(liveEnterpriseRagHumanReviewApi.context(value.operationId)).rejects.toThrow(/数据结构不正确/);
  });

  it("rejects duplicate comparison ids and reviews bound to another operation or report", async () => {
    const duplicate = context();
    duplicate.ai.dimensions[1].id = duplicate.ai.dimensions[0].id;
    mocks.fetch.mockResolvedValueOnce(json(duplicate));
    await expect(liveEnterpriseRagHumanReviewApi.context(duplicate.operationId)).rejects.toThrow(/不匹配/);

    mocks.fetch.mockResolvedValueOnce(json({ reviews: [review({ operationId: "another-operation" })] }));
    await expect(liveEnterpriseRagHumanReviewApi.list(context().operationId)).rejects.toThrow(/不匹配/);

    const mismatchedContext = context();
    mismatchedContext.reviews = [review({ reportId: "another-report" })];
    mocks.fetch.mockResolvedValueOnce(json(mismatchedContext));
    await expect(liveEnterpriseRagHumanReviewApi.context(mismatchedContext.operationId)).rejects.toThrow(/不匹配/);
  });

  it("submits once with the stable request id and parses the authoritative diff", async () => {
    const saved = review({
      alignment: "human_more_negative",
      status: "pending_analysis",
      diff: {
        alignment: "human_more_negative",
        overall: { aiVerdict: "excellent", aiScore: 100, humanVerdict: "unusable", humanScore: 50 },
        dimensions: [{ id: "correctness", aiLevel: 4, humanLevel: 1 }],
        gates: [{ id: "safety", aiStatus: "passed", humanStatus: "failed" }],
      },
    });
    mocks.fetch.mockResolvedValue(json({ review: saved, diff: saved.diff }));
    const payload = input();
    const result = await liveEnterpriseRagHumanReviewApi.submit(payload);
    expect(result.diff.alignment).toBe("human_more_negative");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-evaluation-reviews",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
  });

  it("does not retry an unknown POST outcome and marks it for GET reconciliation", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockRejectedValue(new TypeError("response lost"));
    await expect(liveEnterpriseRagHumanReviewApi.submit(input())).rejects.toMatchObject({ outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries transient GET failures within one captured workspace only", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(json({ error: { message: "暂时不可用" } }, 503))
      .mockResolvedValueOnce(json({ reviews: [review()] }));
    const pending = liveEnterpriseRagHumanReviewApi.list(context().operationId);
    await vi.advanceTimersByTimeAsync(400);
    expect((await pending)[0].clientRequestId).toBe(review().clientRequestId);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
