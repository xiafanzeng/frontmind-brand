import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { createWebsiteEvaluationPreviewReport } from "../../../standalone/website-evaluation-preview";

const scope = vi.hoisted(() => ({
  fetch: vi.fn(),
  assertActive: vi.fn(),
  headers: vi.fn((value: unknown) => value),
}));

vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => scope,
}));

import {
  liveWebsiteEvaluationApi,
  useWebsiteEvaluationAuthority,
  WebsiteEvaluationApiError,
} from "./website-evaluation-api";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_BUILD_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const RETRY_REQUEST_ID = "77777777-7777-4777-8777-777777777777";

function completedRun(
  reportId = "report-client-authority-1",
  buildId = BUILD_ID,
  nextRunId = RUN_ID,
  generation = 0,
) {
  const report = {
    ...createWebsiteEvaluationPreviewReport(generation),
    reportId,
    runId: nextRunId,
    projectId: PROJECT_ID,
    buildId,
  };
  return {
    ...run("completed"),
    runId: nextRunId,
    buildId,
    report,
  };
}

function authorityResponse(completed: ReturnType<typeof completedRun>) {
  return new Response(JSON.stringify({
    latest: completed,
    history: [completed],
    nextCursor: null,
  }));
}

const reviewDraft = {
  disposition: "concerns" as const,
  checkComments: [],
  repairItem: { kind: "finding" as const, id: "finding-mobile-touch-targets" },
  note: "需要复核移动端证据。",
};

function savedReview(
  reportId: string,
  note = reviewDraft.note,
  reviewId = "44444444-4444-4444-8444-444444444444",
) {
  return {
    reviewId,
    reportId,
    reviewerUserId: 7,
    disposition: reviewDraft.disposition,
    checkComments: [],
    repairItem: reviewDraft.repairItem,
    note,
    createdAt: "2026-11-08T00:02:00.000Z",
  };
}

function postedReviewBodies() {
  return scope.fetch.mock.calls.flatMap(([, init]) => {
    const request = init as RequestInit | undefined;
    return request?.method === "POST" && typeof request.body === "string"
      ? [JSON.parse(request.body)]
      : [];
  });
}

function run(status = "queued") {
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    stage: "build_readiness",
    status,
    attemptCount: status === "queued" ? 0 : 1,
    automatic: true,
    evidenceFingerprint: "a".repeat(64),
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:01.000Z",
    report: null,
    error: status === "failed"
      ? { code: "CAPTURE_FAILED", message: "证据采集失败。" }
      : null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  scope.fetch.mockReset();
});

describe("website evaluation authority API", () => {
  it("restores cursor history without exposing an ordinary start endpoint", async () => {
    scope.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ latest: run(), history: [run()], nextCursor: "next-1" }),
      ),
    );

    const result = await liveWebsiteEvaluationApi.latest({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
      cursor: "cursor-1",
    });

    expect(result.latest?.runId).toBe(RUN_ID);
    expect(result.history).toHaveLength(1);
    expect(scope.fetch).toHaveBeenCalledWith(
      `/api/modules/brand/website-evaluations?projectId=${PROJECT_ID}&buildId=${BUILD_ID}&cursor=cursor-1`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(scope.fetch.mock.calls[0]?.[0]).not.toContain("start");
  });

  it("uses the run retry endpoint with an explicit idempotency key", async () => {
    scope.fetch.mockResolvedValue(new Response(JSON.stringify(run("queued"))));
    await liveWebsiteEvaluationApi.retry(RUN_ID, RETRY_REQUEST_ID);
    expect(scope.fetch).toHaveBeenCalledWith(
      `/api/modules/brand/website-evaluations/runs/${RUN_ID}/retry`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clientRequestId: RETRY_REQUEST_ID }),
      }),
    );
  });

  it("reads and appends supplementary reviews without changing a report", async () => {
    const review = {
      reviewId: "44444444-4444-4444-8444-444444444444",
      reportId: "report-1",
      reviewerUserId: 7,
      disposition: "reject",
      checkComments: [],
      repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
      note: "需要复核移动端证据。",
      createdAt: "2026-11-08T00:02:00.000Z",
    };
    const legacyReview = {
      ...review,
      reviewId: "55555555-5555-4555-8555-555555555555",
      repairItem: undefined,
    };
    scope.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviews: [legacyReview, review] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(review)));

    expect(await liveWebsiteEvaluationApi.reviews("report-1")).toEqual([
      expect.not.objectContaining({ repairItem: expect.anything() }),
      review,
    ]);
    expect(
      await liveWebsiteEvaluationApi.appendReview("report-1", {
        clientRequestId: "review-request-123",
        disposition: "reject",
        checkComments: [],
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
        note: "需要复核移动端证据。",
      }),
    ).toEqual(review);
    expect(scope.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/modules/brand/website-evaluations/reports/report-1/reviews",
      "/api/modules/brand/website-evaluations/reports/report-1/reviews",
    ]);
    expect(scope.fetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        clientRequestId: "review-request-123",
        disposition: "reject",
        checkComments: [],
        repairItem: { kind: "finding", id: "finding-mobile-touch-targets" },
        note: "需要复核移动端证据。",
      }),
    }));
  });

  it("preserves server ownership failures instead of accepting partial data", async () => {
    scope.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "EVALUATION_NOT_FOUND", message: "未找到此网站评估。" } }),
        { status: 404 },
      ),
    );
    await expect(
      liveWebsiteEvaluationApi.observe(RUN_ID),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WebsiteEvaluationApiError>>({
        code: "EVALUATION_NOT_FOUND",
        status: 404,
        message: "未找到此网站评估。",
      }),
    );
  });

  it("keeps polling an active run after one transient read failure", async () => {
    vi.useFakeTimers();
    scope.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: run("running"),
        history: [run("running")],
        nextCursor: null,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "TEMPORARY", message: "临时读取失败。" },
      }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: { ...run("completed"), updatedAt: "2026-11-08T00:00:05.000Z" },
        history: [{ ...run("completed"), updatedAt: "2026-11-08T00:00:05.000Z" }],
        nextCursor: null,
      })));

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scope.fetch).toHaveBeenCalledTimes(1);
    expect(view.result.current.run?.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(scope.fetch).toHaveBeenCalledTimes(2);
    expect(view.result.current.error?.message).toBe("临时读取失败。");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(scope.fetch).toHaveBeenCalledTimes(3);
    expect(view.result.current.run?.status).toBe("completed");
    expect(view.result.current.error).toBeNull();
    view.unmount();
  });

  it("automatically retries when the very first authority read fails", async () => {
    vi.useFakeTimers();
    scope.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "TEMPORARY", message: "首次读取失败。" },
      }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: run("queued"),
        history: [run("queued")],
        nextCursor: null,
      })));

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.run).toBeNull();
    expect(view.result.current.error?.message).toBe("首次读取失败。");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(scope.fetch).toHaveBeenCalledTimes(2);
    expect(view.result.current.run?.status).toBe("queued");
    expect(view.result.current.error).toBeNull();
    view.unmount();
  });

  it("loads the next cursor page without replacing restored history", async () => {
    const olderRun = {
      ...run("completed"),
      runId: "55555555-5555-4555-8555-555555555555",
      updatedAt: "2026-11-07T00:00:01.000Z",
    };
    scope.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: run("completed"),
        history: [run("completed")],
        nextCursor: "next-1",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: run("completed"),
        history: [olderRun],
        nextCursor: null,
      })));

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await view.result.current.loadMore();
    });

    expect(scope.fetch.mock.calls[1]?.[0]).toContain("cursor=next-1");
    expect(view.result.current.history?.history.map(({ runId }) => runId)).toEqual([
      RUN_ID,
      olderRun.runId,
    ]);
    expect(view.result.current.history?.nextCursor).toBeNull();
    view.unmount();
  });

  it("enters restoring state immediately when the build coordinate changes", async () => {
    let resolveNext: ((response: Response) => void) | null = null;
    scope.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        latest: run("completed"),
        history: [run("completed")],
        nextCursor: null,
      })))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveNext = resolve;
      }));

    const view = renderHook(({ buildId }) => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId,
    }), { initialProps: { buildId: BUILD_ID } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.run?.buildId).toBe(BUILD_ID);

    view.rerender({ buildId: NEXT_BUILD_ID });
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.run).toBeNull();

    await act(async () => {
      resolveNext?.(new Response(JSON.stringify({
        latest: null,
        history: [],
        nextCursor: null,
      })));
      await Promise.resolve();
    });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.run).toBeNull();
    view.unmount();
  });

  it("coalesces concurrent saves for the same review intent", async () => {
    const completed = completedRun();
    let resolvePost: ((response: Response) => void) | null = null;
    scope.fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("?projectId=")) return Promise.resolve(authorityResponse(completed));
      if (init?.method === "GET" && url.endsWith("/reviews")) {
        return Promise.resolve(new Response(JSON.stringify({ reviews: [] })));
      }
      if (init?.method === "POST" && url.endsWith("/reviews")) {
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await waitFor(() => expect(view.result.current.run?.report?.reportId)
      .toBe(completed.report.reportId));
    await waitFor(() => expect(scope.fetch.mock.calls.some(([url, init]) =>
      (init as RequestInit | undefined)?.method === "GET"
      && String(url).endsWith("/reviews"))).toBe(true));
    await waitFor(() => expect(view.result.current.reviewsLoading).toBe(false));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = view.result.current.appendReview(reviewDraft);
      second = view.result.current.appendReview(reviewDraft);
    });
    expect(postedReviewBodies()).toHaveLength(1);

    await act(async () => {
      resolvePost?.(new Response(JSON.stringify(savedReview(completed.report.reportId))));
      await Promise.all([first, second]);
    });
    expect(view.result.current.reviews).toEqual([
      expect.objectContaining({ note: reviewDraft.note }),
    ]);
    view.unmount();
  });

  it("reuses the idempotency key after an uncertain save failure", async () => {
    const completed = completedRun();
    let postCount = 0;
    scope.fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("?projectId=")) return Promise.resolve(authorityResponse(completed));
      if (init?.method === "GET" && url.endsWith("/reviews")) {
        return Promise.resolve(new Response(JSON.stringify({ reviews: [] })));
      }
      if (init?.method === "POST" && url.endsWith("/reviews")) {
        postCount += 1;
        return Promise.resolve(postCount === 1
          ? new Response(JSON.stringify({
              error: { code: "RESPONSE_LOST", message: "响应丢失。" },
            }), { status: 503 })
          : new Response(JSON.stringify(savedReview(completed.report.reportId))));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await waitFor(() => expect(view.result.current.run?.report?.reportId)
      .toBe(completed.report.reportId));
    await waitFor(() => expect(scope.fetch.mock.calls.some(([url, init]) =>
      (init as RequestInit | undefined)?.method === "GET"
      && String(url).endsWith("/reviews"))).toBe(true));
    await waitFor(() => expect(view.result.current.reviewsLoading).toBe(false));

    let firstError: unknown;
    await act(async () => {
      try {
        await view.result.current.appendReview(reviewDraft);
      } catch (cause) {
        firstError = cause;
      }
    });
    expect(firstError).toEqual(expect.objectContaining({ code: "RESPONSE_LOST" }));
    await act(async () => {
      await view.result.current.appendReview(reviewDraft);
    });

    const bodies = postedReviewBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].clientRequestId).toBe(bodies[0].clientRequestId);
    expect(view.result.current.reviews).toHaveLength(1);
    view.unmount();
  });

  it("creates a new review intent when the payload changes after failure", async () => {
    const completed = completedRun();
    let postCount = 0;
    scope.fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("?projectId=")) return Promise.resolve(authorityResponse(completed));
      if (init?.method === "GET" && url.endsWith("/reviews")) {
        return Promise.resolve(new Response(JSON.stringify({ reviews: [] })));
      }
      if (init?.method === "POST" && url.endsWith("/reviews")) {
        postCount += 1;
        const note = postCount === 1 ? reviewDraft.note : "改成另一条意见。";
        return Promise.resolve(postCount === 1
          ? new Response(JSON.stringify({
              error: { code: "TEMPORARY", message: "暂时失败。" },
            }), { status: 503 })
          : new Response(JSON.stringify(savedReview(completed.report.reportId, note))));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    const view = renderHook(() => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
    }));
    await waitFor(() => expect(view.result.current.run?.report?.reportId)
      .toBe(completed.report.reportId));
    await waitFor(() => expect(scope.fetch.mock.calls.some(([url, init]) =>
      (init as RequestInit | undefined)?.method === "GET"
      && String(url).endsWith("/reviews"))).toBe(true));
    await waitFor(() => expect(view.result.current.reviewsLoading).toBe(false));

    await act(async () => {
      await view.result.current.appendReview(reviewDraft).catch(() => undefined);
    });
    await act(async () => {
      await view.result.current.appendReview({
        ...reviewDraft,
        note: "改成另一条意见。",
      });
    });

    const bodies = postedReviewBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].clientRequestId).not.toBe(bodies[0].clientRequestId);
    view.unmount();
  });

  it("ignores a late review response after switching reports", async () => {
    const first = completedRun();
    const second = completedRun(
      "report-client-authority-2",
      NEXT_BUILD_ID,
      "88888888-8888-4888-8888-888888888888",
      1,
    );
    let resolveOldPost: ((response: Response) => void) | null = null;
    scope.fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`buildId=${BUILD_ID}`)) return Promise.resolve(authorityResponse(first));
      if (url.includes(`buildId=${NEXT_BUILD_ID}`)) return Promise.resolve(authorityResponse(second));
      if (init?.method === "GET" && url.endsWith("/reviews")) {
        return Promise.resolve(new Response(JSON.stringify({ reviews: [] })));
      }
      if (init?.method === "POST" && url.includes(first.report.reportId)) {
        return new Promise<Response>((resolve) => { resolveOldPost = resolve; });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    const view = renderHook(({ buildId }) => useWebsiteEvaluationAuthority({
      projectId: PROJECT_ID,
      buildId,
    }), { initialProps: { buildId: BUILD_ID } });
    await waitFor(() => expect(view.result.current.run?.report?.reportId)
      .toBe(first.report.reportId));
    await waitFor(() => expect(scope.fetch.mock.calls.some(([url, init]) =>
      (init as RequestInit | undefined)?.method === "GET"
      && String(url).includes(first.report.reportId)
      && String(url).endsWith("/reviews"))).toBe(true));
    await waitFor(() => expect(view.result.current.reviewsLoading).toBe(false));

    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.appendReview(reviewDraft);
    });
    view.rerender({ buildId: NEXT_BUILD_ID });
    await waitFor(() => expect(view.result.current.run?.buildId).toBe(NEXT_BUILD_ID));
    await waitFor(() => expect(view.result.current.reviewsLoading).toBe(false));

    await act(async () => {
      resolveOldPost?.(new Response(JSON.stringify(savedReview(first.report.reportId))));
      await pending;
    });
    expect(view.result.current.reviews).toEqual([]);
    view.unmount();
  });
});
