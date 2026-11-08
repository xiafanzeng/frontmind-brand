import { useCallback, useEffect, useRef, useState } from "react";
import type { RagStarterQuestionsDto } from "../../contracts/rag-starter-questions";
import { parseRagStarterQuestionTexts } from "../../contracts/rag-starter-questions";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";

const ENDPOINT = "/api/modules/brand/rag-starter-questions";

export class RagStarterQuestionsApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RagStarterQuestionsApiError";
  }
}

export type RagStarterQuestionsPhase =
  | "initial_loading"
  | "generating"
  | "activating_initial"
  | "ready"
  | "error";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseDto(value: unknown): RagStarterQuestionsDto {
  const dto = record(value);
  if (!dto || typeof dto.pending !== "boolean" || typeof dto.revision !== "number" ||
      !(dto.error === null || typeof dto.error === "string")) {
    throw new Error("预设问题接口返回的数据结构不正确。");
  }
  for (const key of ["current", "draft"] as const) {
    if (dto[key] === null) continue;
    const item = record(dto[key]);
    if (!item || typeof item.id !== "string" || typeof item.source !== "string" ||
        typeof item.knowledgeSnapshotId !== "string" || typeof item.createdAt !== "string" ||
        !Array.isArray(item.questions)) {
      throw new Error("预设问题接口返回的版本结构不正确。");
    }
    parseRagStarterQuestionTexts(item.questions);
  }
  return value as RagStarterQuestionsDto;
}

async function request(method: "GET" | "POST" | "PUT" | "DELETE", path = "", body?: unknown) {
  const operation = captureWorkspaceRestOperation();
  operation.assertActive();
  const response = await operation.fetch(`${ENDPOINT}${path}`, {
    method,
    credentials: "same-origin",
    headers: operation.headers(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  operation.assertActive();
  let value: unknown;
  try { value = JSON.parse(await response.text() || "null"); }
  catch { throw new RagStarterQuestionsApiError("暂时无法读取预设问题。", "INVALID_RESPONSE", response.status); }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new RagStarterQuestionsApiError(
      typeof error?.message === "string" ? error.message : "预设问题更新失败。",
      typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
      response.status,
    );
  }
  return parseDto(value);
}

export const liveRagStarterQuestionsApi = {
  read: () => request("GET"),
  regenerate(input: Pick<RagStarterQuestionsDto, "current" | "draft"> & { clientRequestId?: string }) {
    return request("POST", "/regenerations", {
      clientRequestId: input.clientRequestId ?? globalThis.crypto.randomUUID(),
      expectedCurrentSetId: input.current?.id ?? null,
      expectedDraftSetId: input.draft?.id ?? null,
    });
  },
  confirm(input: Pick<RagStarterQuestionsDto, "current" | "draft"> & { questions: string[] }) {
    return request("PUT", "/current", {
      expectedCurrentSetId: input.current?.id ?? null,
      expectedDraftSetId: input.draft?.id ?? null,
      questions: parseRagStarterQuestionTexts(input.questions),
    });
  },
  discard(input: Pick<RagStarterQuestionsDto, "current" | "draft">) {
    if (!input.draft) throw new RagStarterQuestionsApiError(
      "没有可放弃的预设问题草稿。", "STARTER_DRAFT_NOT_FOUND", 404);
    return request("DELETE", "/draft", {
      expectedCurrentSetId: input.current?.id ?? null,
      expectedDraftSetId: input.draft.id,
    });
  },
};

function regenerationOutcomeMayBeUnknown(cause: unknown) {
  return !(cause instanceof RagStarterQuestionsApiError) ||
    cause.code === "INVALID_RESPONSE" || cause.status === 408 || cause.status === 429 || cause.status >= 500;
}

async function replayUnknownRegeneration(clientRequestId: string, cause: unknown) {
  if (!regenerationOutcomeMayBeUnknown(cause)) throw cause;
  const latest = await liveRagStarterQuestionsApi.read();
  return liveRagStarterQuestionsApi.regenerate({ ...latest, clientRequestId });
}

/** Optional state wrapper; callers may also use liveRagStarterQuestionsApi directly. */
export function useRagStarterQuestions(enabled = true, autoInitialize = false) {
  const [data, setData] = useState<RagStarterQuestionsDto | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initialLoading, setInitialLoading] = useState(enabled);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoActivating, setAutoActivating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const observed = useRef(false);
  const conflicted = useRef(false);
  const mutating = useRef(false);
  const mutationOwner = useRef(0);
  const automaticGenerationAttempt = useRef<string | null>(null);
  const automaticActivationAttempt = useRef<string | null>(null);
  const regenerationRequest = useRef<{ id: string } | null>(null);
  const readLatest = useCallback(async (clearConflict: boolean) => {
    if (clearConflict) conflicted.current = false;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await liveRagStarterQuestionsApi.read();
      if (current === generation.current) {
        observed.current = true;
        setInitialLoading(false);
        setData(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error("预设问题读取失败。");
      if (current === generation.current) {
        observed.current = true;
        setInitialLoading(false);
        setError(next);
      }
      throw next;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => readLatest(true), [readLatest]);
  useEffect(() => {
    if (!enabled) { setLoading(false); setInitialLoading(false); return; }
    if (!observed.current) setInitialLoading(true);
    void reload().catch(() => undefined);
    return () => { generation.current += 1; };
  }, [enabled, reload]);
  useEffect(() => {
    if (!enabled || !data?.pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (conflicted.current || mutating.current) {
          if (!stopped && !conflicted.current) schedule();
          return;
        }
        try { await readLatest(false); }
        catch { /* The last readable version stays visible while polling retries. */ }
        finally { if (!stopped && !conflicted.current) schedule(); }
      }, 3_000);
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, data?.pending, readLatest]);
  const mutate = useCallback(async (
    run: (current: RagStarterQuestionsDto) => Promise<RagStarterQuestionsDto>,
    acceptsLatest?: (latest: RagStarterQuestionsDto, before: RagStarterQuestionsDto) => boolean,
  ) => {
    if (!data) throw new RagStarterQuestionsApiError("预设问题尚未读取完成。", "STARTER_NOT_READY", 409);
    const current = ++generation.current;
    mutationOwner.current = current;
    mutating.current = true;
    setAutoGenerating(false);
    setAutoActivating(false);
    setLoading(true);
    try {
      const next = await run(data);
      conflicted.current = false;
      if (current === generation.current) { setData(next); setError(null); }
      return next;
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error("预设问题更新失败。");
      const conflict = next instanceof RagStarterQuestionsApiError && next.status === 409;
      if (conflict) conflicted.current = true;
      let latest: RagStarterQuestionsDto | null = null;
      if (conflict || acceptsLatest) {
        try {
          latest = await liveRagStarterQuestionsApi.read();
          if (current === generation.current) {
            setData(latest);
            conflicted.current = false;
            if (acceptsLatest?.(latest, data)) {
              setError(null);
              return latest;
            }
            if (conflict) setError(null);
          }
        } catch { /* Keep the last readable DTO and the original mutation error. */ }
      }
      if (current === generation.current && !conflict) setError(next);
      throw next;
    } finally {
      if (mutationOwner.current === current) mutating.current = false;
      if (current === generation.current) setLoading(false);
    }
  }, [data]);
  useEffect(() => {
    const draft = data?.draft;
    if (!enabled || !autoInitialize || !draft || data?.current || automaticActivationAttempt.current === draft.id || mutating.current) return;
    automaticActivationAttempt.current = draft.id;
    const snapshot = data;
    const current = ++generation.current;
    mutationOwner.current = current;
    mutating.current = true;
    setLoading(true);
    setAutoActivating(true);
    setError(null);
    void liveRagStarterQuestionsApi.confirm({ ...snapshot, questions: draft.questions }).then(next => {
      if (current !== generation.current) return;
      conflicted.current = false;
      setData(next);
      setError(null);
    }).catch(async cause => {
      if (current !== generation.current) return;
      const next = cause instanceof Error ? cause : new Error("预设问题启用失败。");
      try {
        const latest = await liveRagStarterQuestionsApi.read();
        if (current !== generation.current) return;
        setData(latest);
        const activated = latest.current?.id === draft.id && !latest.draft;
        setError(activated ? null : next);
        conflicted.current = false;
      } catch {
        if (current === generation.current) setError(next);
      }
    }).finally(() => {
      if (mutationOwner.current !== current) return;
      mutating.current = false;
      setAutoActivating(false);
      if (current === generation.current) setLoading(false);
    });
  }, [autoInitialize, data, enabled]);
  useEffect(() => {
    if (!enabled || !autoInitialize || initialLoading || !data?.knowledgeBase || data.current || data.draft ||
        data.pending || data.error || error || mutating.current) return;
    const attemptKey = data.knowledgeBase.id;
    if (automaticGenerationAttempt.current === attemptKey) return;
    automaticGenerationAttempt.current = attemptKey;
    const request = regenerationRequest.current ?? {
      id: globalThis.crypto.randomUUID(),
    };
    regenerationRequest.current = request;
    const snapshot = data;
    const current = ++generation.current;
    mutationOwner.current = current;
    mutating.current = true;
    setLoading(true);
    setAutoGenerating(true);
    setError(null);
    void liveRagStarterQuestionsApi.regenerate({ ...snapshot, clientRequestId: request.id }).catch(cause =>
      replayUnknownRegeneration(request.id, cause)
    ).then(next => {
      if (current !== generation.current) return;
      regenerationRequest.current = null;
      conflicted.current = false;
      setData(next);
      setError(null);
    }).catch(async cause => {
      if (current !== generation.current) return;
      const next = cause instanceof Error ? cause : new Error("预设问题生成失败。");
      if (next instanceof RagStarterQuestionsApiError && next.status === 409) {
        try {
          const latest = await liveRagStarterQuestionsApi.read();
          if (current !== generation.current) return;
          setData(latest);
          const accepted = Boolean(latest.current || latest.draft || latest.pending || latest.error);
          if (accepted) {
            regenerationRequest.current = null;
            setError(null);
          } else setError(next);
          conflicted.current = false;
        } catch {
          if (current === generation.current) setError(next);
        }
        return;
      }
      setError(next);
    }).finally(() => {
      if (mutationOwner.current !== current) return;
      mutating.current = false;
      setAutoGenerating(false);
      if (current === generation.current) setLoading(false);
    });
  }, [autoInitialize, data, enabled, error, initialLoading]);
  const automaticGenerationRequired = Boolean(
    autoInitialize && data?.knowledgeBase && !data.current && !data.draft &&
    !data.pending && !data.error && !error,
  );
  const phase: RagStarterQuestionsPhase = initialLoading
    ? "initial_loading"
    : autoActivating
      ? "activating_initial"
      : autoGenerating || data?.pending || automaticGenerationRequired
        ? "generating"
        : error || data?.error
          ? "error"
          : "ready";
  return {
    data,
    loading,
    initialLoading,
    phase,
    error,
    reload,
    confirm: (questions: string[]) => {
      const parsed = parseRagStarterQuestionTexts(questions);
      return mutate(
        (current) => liveRagStarterQuestionsApi.confirm({ ...current, questions: parsed }),
        (latest) => Boolean(latest.current && !latest.draft && latest.current.questions.every((question, index) => question === parsed[index])),
      );
    },
    regenerate: async () => {
      const next = await mutate(async (current) => {
        const request = regenerationRequest.current ?? {
          id: globalThis.crypto.randomUUID(),
        };
        regenerationRequest.current = request;
        const saved = await liveRagStarterQuestionsApi.regenerate({
          ...current,
          clientRequestId: request.id,
        }).catch(cause => replayUnknownRegeneration(request.id, cause));
        regenerationRequest.current = null;
        return saved;
      });
      regenerationRequest.current = null;
      return next;
    },
    discard: () => mutate(
      (current) => liveRagStarterQuestionsApi.discard(current),
      (latest) => latest.draft === null,
    ),
  };
}
