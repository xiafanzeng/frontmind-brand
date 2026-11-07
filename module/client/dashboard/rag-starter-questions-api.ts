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

/** Optional state wrapper; callers may also use liveRagStarterQuestionsApi directly. */
export function useRagStarterQuestions(enabled = true) {
  const [data, setData] = useState<RagStarterQuestionsDto | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const conflicted = useRef(false);
  const mutating = useRef(false);
  const regenerationRequest = useRef<{
    id: string;
    revision: number;
    currentId: string | null;
    draftId: string | null;
    pendingSetId: string | null;
  } | null>(null);
  const readLatest = useCallback(async (clearConflict: boolean) => {
    if (clearConflict) conflicted.current = false;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await liveRagStarterQuestionsApi.read();
      if (current === generation.current) { setData(next); setError(null); }
      return next;
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error("预设问题读取失败。");
      if (current === generation.current) setError(next);
      throw next;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => readLatest(true), [readLatest]);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
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
  useEffect(() => {
    const request = regenerationRequest.current;
    if (!request || !data) return;
    if (
      data.revision !== request.revision ||
      (data.current?.id ?? null) !== request.currentId ||
      (data.draft?.id ?? null) !== request.draftId ||
      (data.pendingSetId ?? null) !== request.pendingSetId
    ) regenerationRequest.current = null;
  }, [data]);
  const mutate = useCallback(async (run: (current: RagStarterQuestionsDto) => Promise<RagStarterQuestionsDto>) => {
    if (!data) throw new RagStarterQuestionsApiError("预设问题尚未读取完成。", "STARTER_NOT_READY", 409);
    const current = ++generation.current;
    mutating.current = true;
    setLoading(true);
    try {
      const next = await run(data);
      conflicted.current = false;
      if (current === generation.current) { setData(next); setError(null); }
      return next;
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error("预设问题更新失败。");
      if (next instanceof RagStarterQuestionsApiError && next.status === 409) {
        conflicted.current = true;
        try {
          const latest = await liveRagStarterQuestionsApi.read();
          if (current === generation.current) {
            setData(latest);
            conflicted.current = false;
          }
        } catch { /* Keep the last readable DTO and the original conflict. */ }
      }
      if (current === generation.current) setError(next);
      throw next;
    } finally {
      mutating.current = false;
      if (current === generation.current) setLoading(false);
    }
  }, [data]);
  return {
    data,
    loading,
    error,
    reload,
    confirm: (questions: string[]) => mutate((current) =>
      liveRagStarterQuestionsApi.confirm({ ...current, questions })),
    regenerate: () => mutate(async (current) => {
      const request = regenerationRequest.current ?? {
        id: globalThis.crypto.randomUUID(),
        revision: current.revision,
        currentId: current.current?.id ?? null,
        draftId: current.draft?.id ?? null,
        pendingSetId: current.pendingSetId ?? null,
      };
      regenerationRequest.current = request;
      const next = await liveRagStarterQuestionsApi.regenerate({
        ...current,
        clientRequestId: request.id,
      });
      regenerationRequest.current = null;
      return next;
    }),
    discard: () => mutate((current) => liveRagStarterQuestionsApi.discard(current)),
  };
}
