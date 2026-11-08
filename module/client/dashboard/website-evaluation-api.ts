import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  websiteBuildEvaluationHistoryDtoSchema,
  websiteBuildEvaluationReportSchema,
  websiteBuildEvaluationReviewInputSchema,
  websiteBuildEvaluationReviewSchema,
  websiteBuildEvaluationRunDtoSchema,
  type WebsiteBuildEvaluationHistoryDto,
  type WebsiteBuildEvaluationReview,
  type WebsiteBuildEvaluationReviewInput,
  type WebsiteBuildEvaluationRunDto,
} from "../../contracts/website-build-evaluation-run";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";

const ENDPOINT = "/api/modules/brand/website-evaluations";
const ACTIVE_STATUSES = new Set(["queued", "capturing", "running", "result_pending"]);
const POLL_INTERVAL_MS = 3_000;

export class WebsiteEvaluationApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WebsiteEvaluationApiError";
  }
}

function shouldRetryRead(error: Error | null) {
  if (!error) return false;
  return !(error instanceof WebsiteEvaluationApiError)
    || error.status >= 500
    || error.status === 408
    || error.status === 429;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function request(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) {
  const operation = captureWorkspaceRestOperation();
  operation.assertActive();
  const response = await operation.fetch(`${ENDPOINT}${path}`, {
    method,
    credentials: "same-origin",
    headers: operation.headers(
      body === undefined ? {} : { "Content-Type": "application/json" },
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  operation.assertActive();
  let value: unknown;
  try {
    value = JSON.parse((await response.text()) || "null");
  } catch {
    throw new WebsiteEvaluationApiError(
      "建设评估接口返回的数据无法解析。",
      "INVALID_RESPONSE",
      response.status,
    );
  }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new WebsiteEvaluationApiError(
      typeof error?.message === "string"
        ? error.message
        : "建设评估暂时无法读取，请稍后重试。",
      typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
      response.status,
    );
  }
  return value;
}

export const liveWebsiteEvaluationApi = {
  async latest(input: {
    projectId: string;
    buildId: string;
    cursor?: string;
  }): Promise<WebsiteBuildEvaluationHistoryDto> {
    const query = new URLSearchParams({
      projectId: input.projectId,
      buildId: input.buildId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    return websiteBuildEvaluationHistoryDtoSchema.parse(
      await request("GET", `?${query.toString()}`),
    );
  },

  async observe(runId: string) {
    return websiteBuildEvaluationRunDtoSchema.parse(
      await request("GET", `/runs/${encodeURIComponent(runId)}`),
    );
  },

  async retry(runId: string, clientRequestId = globalThis.crypto.randomUUID()) {
    return websiteBuildEvaluationRunDtoSchema.parse(
      await request("POST", `/runs/${encodeURIComponent(runId)}/retry`, {
        clientRequestId,
      }),
    );
  },

  async report(reportId: string) {
    return websiteBuildEvaluationReportSchema.parse(
      await request("GET", `/reports/${encodeURIComponent(reportId)}`),
    );
  },

  async reviews(reportId: string) {
    const value = z
      .object({ reviews: z.array(websiteBuildEvaluationReviewSchema) })
      .strict()
      .parse(
        await request(
          "GET",
          `/reports/${encodeURIComponent(reportId)}/reviews`,
        ),
      );
    return value.reviews;
  },

  async appendReview(reportId: string, input: WebsiteBuildEvaluationReviewInput) {
    const review = websiteBuildEvaluationReviewInputSchema.parse(input);
    return websiteBuildEvaluationReviewSchema.parse(
      await request(
        "POST",
        `/reports/${encodeURIComponent(reportId)}/reviews`,
        review,
      ),
    );
  },
};

export type WebsiteEvaluationAuthorityState = {
  history: WebsiteBuildEvaluationHistoryDto | null;
  run: WebsiteBuildEvaluationRunDto | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: Error | null;
  reviews: WebsiteBuildEvaluationReview[];
  reviewsLoading: boolean;
  reviewsError: Error | null;
  reload(): Promise<WebsiteBuildEvaluationHistoryDto | null>;
  loadMore(): Promise<WebsiteBuildEvaluationHistoryDto | null>;
  retry(): Promise<WebsiteBuildEvaluationRunDto | null>;
  appendReview(input: Omit<WebsiteBuildEvaluationReviewInput, "clientRequestId">): Promise<void>;
};

type WebsiteEvaluationReviewDraft = Omit<
  WebsiteBuildEvaluationReviewInput,
  "clientRequestId"
>;

type WebsiteEvaluationReviewSubmissionIntent = {
  clientRequestId: string;
  fingerprint: string;
  promise: Promise<void> | null;
};

function normalizeReviewDraft(
  review: WebsiteEvaluationReviewDraft,
): WebsiteEvaluationReviewDraft {
  const { clientRequestId: _clientRequestId, ...normalized } =
    websiteBuildEvaluationReviewInputSchema.parse({
      ...review,
      clientRequestId: "review-intent",
    });
  return normalized;
}

function reviewSubmissionBucket(
  reportId: string,
  review: WebsiteEvaluationReviewDraft,
) {
  return JSON.stringify([
    reportId,
    review.repairItem?.kind ?? "report",
    review.repairItem?.id ?? "",
  ]);
}

function reviewSubmissionFingerprint(review: WebsiteEvaluationReviewDraft) {
  return JSON.stringify(review);
}

/** Read-only recovery for the server-authoritative website evaluation. */
export function useWebsiteEvaluationAuthority(input: {
  projectId?: string | null;
  buildId?: string | null;
  enabled?: boolean;
}): WebsiteEvaluationAuthorityState {
  const enabled = input.enabled !== false && Boolean(input.projectId && input.buildId);
  const [history, setHistory] = useState<WebsiteBuildEvaluationHistoryDto | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [resolvedCoordinateKey, setResolvedCoordinateKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reviews, setReviews] = useState<WebsiteBuildEvaluationReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<Error | null>(null);
  const generation = useRef(0);
  const reviewGeneration = useRef(0);
  const reviewSubmissionIntents = useRef(
    new Map<string, WebsiteEvaluationReviewSubmissionIntent>(),
  );
  const historyRef = useRef<WebsiteBuildEvaluationHistoryDto | null>(null);
  const coordinateKey = enabled
    ? `${input.projectId ?? ""}:${input.buildId ?? ""}`
    : "disabled";
  const coordinateRef = useRef(coordinateKey);
  coordinateRef.current = coordinateKey;

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const reload = useCallback(async () => {
    if (!enabled || !input.projectId || !input.buildId) {
      setHistory(null);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setError(null);
      setResolvedCoordinateKey(null);
      return null;
    }
    const current = ++generation.current;
    setRefreshing(Boolean(historyRef.current));
    setLoading(!historyRef.current);
    try {
      const next = await liveWebsiteEvaluationApi.latest({
        projectId: input.projectId,
        buildId: input.buildId,
      });
      if (generation.current === current) {
        setHistory(next);
        setError(null);
        setResolvedCoordinateKey(coordinateKey);
      }
      return next;
    } catch (cause) {
      const next = cause instanceof Error
        ? cause
        : new Error("建设评估读取失败。");
      if (generation.current === current) {
        setError(next);
        setResolvedCoordinateKey(coordinateKey);
      }
      throw next;
    } finally {
      if (generation.current === current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [coordinateKey, enabled, input.buildId, input.projectId]);

  useEffect(() => {
    historyRef.current = null;
    setHistory(null);
    setLoading(enabled);
    setRefreshing(false);
    setError(null);
    void reload().catch(() => undefined);
    return () => {
      generation.current += 1;
    };
    // `history` must not restart the first read after every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, input.projectId, input.buildId]);

  useEffect(() => {
    const status = history?.latest?.status;
    const active = Boolean(status && ACTIVE_STATUSES.has(status));
    if (!enabled || (!active && !shouldRetryRead(error))) return;
    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => {
      timer = window.setTimeout(() => {
        void reload()
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) schedule();
          });
      }, POLL_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, error, history?.latest?.runId, history?.latest?.status, reload]);

  const loadMore = useCallback(async () => {
    if (
      !enabled
      || !input.projectId
      || !input.buildId
      || !history?.nextCursor
      || loadingMore
    ) return null;
    const expectedCoordinate = coordinateKey;
    setLoadingMore(true);
    try {
      const next = await liveWebsiteEvaluationApi.latest({
        projectId: input.projectId,
        buildId: input.buildId,
        cursor: history.nextCursor,
      });
      if (coordinateRef.current !== expectedCoordinate) return null;
      setHistory((current) => {
        if (!current) return next;
        const observed = new Set(current.history.map(({ runId }) => runId));
        return {
          latest: next.latest ?? current.latest,
          history: [
            ...current.history,
            ...next.history.filter(({ runId }) => !observed.has(runId)),
          ],
          nextCursor: next.nextCursor,
        };
      });
      setError(null);
      return next;
    } catch (cause) {
      const next = cause instanceof Error
        ? cause
        : new Error("建设评估历史读取失败。");
      if (coordinateRef.current === expectedCoordinate) setError(next);
      throw next;
    } finally {
      if (coordinateRef.current === expectedCoordinate) setLoadingMore(false);
    }
  }, [coordinateKey, enabled, history?.nextCursor, input.buildId, input.projectId, loadingMore]);

  const retry = useCallback(async () => {
    const run = history?.latest;
    if (!run || run.status !== "failed") return null;
    try {
      const next = await liveWebsiteEvaluationApi.retry(run.runId);
      setHistory((current) =>
        current
          ? {
              ...current,
              latest: next,
              history: current.history.map((item) =>
                item.runId === next.runId ? next : item,
              ),
            }
          : current,
      );
      setError(null);
      return next;
    } catch (cause) {
      const next = cause instanceof Error
        ? cause
        : new Error("建设评估重试请求失败。");
      setError(next);
      throw next;
    }
  }, [history?.latest]);

  const reportId = history?.latest?.report?.reportId ?? null;
  const activeReviewReportId = resolvedCoordinateKey === coordinateKey
    ? reportId
    : null;
  const reportIdRef = useRef<string | null>(activeReviewReportId);
  reportIdRef.current = activeReviewReportId;
  useEffect(() => {
    const current = ++reviewGeneration.current;
    reviewSubmissionIntents.current.clear();
    if (!enabled || !activeReviewReportId) {
      setReviews([]);
      setReviewsLoading(false);
      setReviewsError(null);
      return;
    }
    setReviews([]);
    setReviewsLoading(true);
    setReviewsError(null);
    void liveWebsiteEvaluationApi.reviews(activeReviewReportId).then(
      (next) => {
        if (reviewGeneration.current === current) setReviews(next);
      },
      (cause: unknown) => {
        const next = cause instanceof Error
          ? cause
          : new Error("人工复核记录读取失败。");
        if (reviewGeneration.current === current) setReviewsError(next);
      },
    ).finally(() => {
      if (reviewGeneration.current === current) setReviewsLoading(false);
    });
    return () => {
      reviewGeneration.current += 1;
    };
  }, [activeReviewReportId, enabled]);

  const appendReview = useCallback(
    async (review: WebsiteEvaluationReviewDraft) => {
      const currentReportId = reportIdRef.current;
      if (!currentReportId) {
        throw new WebsiteEvaluationApiError(
          "当前没有可复核的权威报告。",
          "REPORT_NOT_READY",
          409,
        );
      }
      const normalized = normalizeReviewDraft(review);
      const bucket = reviewSubmissionBucket(currentReportId, normalized);
      const fingerprint = reviewSubmissionFingerprint(normalized);
      let intent = reviewSubmissionIntents.current.get(bucket);
      if (!intent || intent.fingerprint !== fingerprint) {
        intent = {
          clientRequestId: globalThis.crypto.randomUUID(),
          fingerprint,
          promise: null,
        };
        reviewSubmissionIntents.current.set(bucket, intent);
      }
      if (intent.promise) return intent.promise;

      const capturedIntent = intent;
      const capturedGeneration = reviewGeneration.current;
      const submission = liveWebsiteEvaluationApi.appendReview(currentReportId, {
        ...normalized,
        clientRequestId: capturedIntent.clientRequestId,
      }).then((saved) => {
        if (
          reportIdRef.current === currentReportId
          && reviewGeneration.current === capturedGeneration
        ) {
          setReviews((current) => current.some(({ reviewId }) => reviewId === saved.reviewId)
            ? current
            : [...current, saved]);
          setReviewsError(null);
        }
        if (reviewSubmissionIntents.current.get(bucket) === capturedIntent) {
          reviewSubmissionIntents.current.delete(bucket);
        }
      }).finally(() => {
        if (reviewSubmissionIntents.current.get(bucket) === capturedIntent) {
          capturedIntent.promise = null;
        }
      });
      capturedIntent.promise = submission;
      return submission;
    },
    [],
  );

  return {
    history,
    run: history?.latest ?? null,
    loading: loading || (enabled && resolvedCoordinateKey !== coordinateKey),
    refreshing,
    loadingMore,
    error,
    reviews,
    reviewsLoading,
    reviewsError,
    reload,
    loadMore,
    retry,
    appendReview,
  };
}
