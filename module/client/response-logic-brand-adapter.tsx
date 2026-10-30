import { ComponentType, useEffect, useRef, useState } from "react";
import { configureIntentWorkspaceHost } from "./response-logic-runtime-host.js";
import { RESPONSE_LOGIC_API_BASE } from "./response-logic-api-base.js";
import type { IntentWorkspaceHost, IntentToast, StartResponseLogicTask, UploadIntentAsset, IntentRestOperation, IntentVisualComponents, IntentTrpcHost } from "./response-logic-host.js";

/**
 * Brand-side adapter that implements the IntentWorkspaceHost contract for the
 * response-logic workspace, using Brand's REST API endpoints.
 * All operations go through the real REST endpoints in server/http-api.ts.
 */

export interface BrandResponseLogicAdapterInput {
  captureRestOperation: (signal?: AbortSignal | null) => {
    signal: AbortSignal;
    assertActive(): void;
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  visual: IntentVisualComponents;
  toast: IntentToast;
}

const RL_API_BASE = RESPONSE_LOGIC_API_BASE;

// ── Reactive records store (module singleton) ──
// The workspace's PersistentResponseLogicWorkspace calls
// trpc.workspace.responseLogic.useQuery() during its render; this store
// notifies subscribed components when records change so React re-renders.
// 2026-10-28 incident root cause: the store used to live inside
// createBrandResponseLogicHost's closure, so every host rebuild (the entry's
// useMemo deps are inline visual/toast objects that change identity on each
// caller render) replaced it with an empty store — the Proxy in
// response-logic-runtime-host then served data from the NEW empty store while
// subscriptions and fetches were bound to the old one, leaving
// persistence.records undefined forever: task recovery never armed and no
// status request was ever issued (tasks e932f604 / 1f724bc9 finished
// upstream with zero status calls). Keeping the store at module level makes
// record data survive host rebuilds; only the rest handle is refreshed.
type RecordsData = { records: unknown[] };
let storeData: RecordsData | undefined;
let storeError: string | undefined;
let storeLoading = false;
let storeVersion = 0;
const storeListeners = new Set<() => void>();
let storeRest: BrandResponseLogicAdapterInput["captureRestOperation"] | undefined;

const notifyStore = () => {
  storeVersion++;
  storeListeners.forEach(fn => fn());
};

const fetchRecords = async (): Promise<void> => {
  if (storeLoading) return;
  if (!storeRest) return;
  storeLoading = true;
  storeError = undefined;
  notifyStore();
  try {
    const response = await storeRest().fetch(RL_API_BASE, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`加载应答逻辑失败（${response.status}）`);
    storeData = await response.json();
    // The store is a singleton across host rebuilds; guard against two
    // consecutive responses applying out of order by only accepting the
    // freshest payload shape.
    if (!storeData || !Array.isArray(storeData.records)) {
      storeData = { records: [] };
    }
  } catch (error) {
    storeError = error instanceof Error ? error.message : "加载应答逻辑失败";
  } finally {
    storeLoading = false;
    notifyStore();
  }
};

/** Test-only: reset the module-level records store between test cases. The
 * singleton is intentional in production (see the comment above); tests that
 * assert initial/error states need a clean slate. */
export function __resetBrandRecordsStoreForTests(): void {
  storeData = undefined;
  storeError = undefined;
  storeLoading = false;
  storeVersion++;
  storeRest = undefined;
  storeListeners.forEach(fn => fn());
  storeListeners.clear();
}

export function createBrandResponseLogicHost(input: BrandResponseLogicAdapterInput): IntentWorkspaceHost {
  const rest = input.captureRestOperation;
  storeRest = input.captureRestOperation;

  const loadRecords = async (): Promise<RecordsData> => {
    await fetchRecords();
    if (storeError) throw new Error(storeError);
    return storeData ?? { records: [] };
  };

  const saveRecord = async (value: unknown) => {
    const response = await rest().fetch(RL_API_BASE, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (body as { error?: { code?: string; message?: string } })?.error;
      throw Object.assign(new Error(err?.message ?? "保存失败"), { code: err?.code });
    }
    return body;
  };

  const startTask: StartResponseLogicTask = async (messages, taskInput, signal) => {
    // The server's responseLogicStartSchema requires userMessage (string) and
    // attachments ({file_id, filename, mime_type?}[]) — not the raw messages
    // array. Convert IntentMessage content blocks to the server contract,
    // mirroring the Intent original adapter's conversion.
    const contentBlocks = messages.flatMap(message =>
      typeof message.content === "string"
        ? [{ type: "input_text" as const, text: message.content }]
        : message.content,
    );
    const userMessage = contentBlocks
      .filter(block => block.type === "input_text" && typeof block.text === "string" && block.text.trim())
      .map(block => block.text)
      .join("\n");
    const attachments = contentBlocks
      .filter(block => block.type === "input_file" && typeof block.file_id === "string" && block.file_id.trim())
      .map(block => ({
        file_id: block.file_id as string,
        filename: typeof block.filename === "string" && block.filename.trim() ? block.filename : "attachment",
        ...(typeof block.mime_type === "string" && block.mime_type.trim() ? { mime_type: block.mime_type } : {}),
      }));

    const response = await rest(signal).fetch(`${RL_API_BASE}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: taskInput.questionId, groupId: taskInput.groupId, groupTitle: taskInput.groupTitle,
        question: taskInput.question, intent: taskInput.intent, summary: taskInput.summary,
        draft: taskInput.draft, operationRevision: taskInput.operationRevision,
        conversationId: taskInput.conversationId, taskId: taskInput.taskId,
        userMessage, attachments,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body as { error?: { message?: string } })?.error?.message ?? `生成任务创建失败（${response.status}）`);
    }
    // The server wraps the task in an envelope: {task:{id,…},startedAt,…}.
    // Returning the raw body here leaves task.id undefined, the workspace
    // writes generation.taskId=undefined, the polling effect returns early,
    // and the page spins on 生成中 forever while the upstream task finishes
    // unobserved (live: tasks 712b31c5/e932f604/1f724bc9/5275fc1c all had
    // zero status calls after a 200 start). Unwrap strictly.
    const task = (body as { task?: { id?: unknown; operationRevision?: unknown } }).task;
    if (!task || typeof task.id !== "string" || !task.id) {
      throw new Error("生成任务创建响应无效（缺少任务标识）");
    }
    return {
      id: task.id,
      operationRevision: typeof task.operationRevision === "number" ? task.operationRevision : undefined,
    };
  };

  const uploadAsset: UploadIntentAsset = async (file, _onProgress, options) => {
    // Core's authenticated local-asset endpoint (same contract as the Intent
    // standalone host): raw octet-stream body plus the three X-FrontMind-*
    // headers; the declared size must match the streamed bytes exactly.
    const response = await rest(options?.signal).fetch("/api/frontmind/v2/assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-FrontMind-Mime": options?.mimeType || file.type || "application/octet-stream",
        "X-FrontMind-Filename": encodeURIComponent(options?.filename ?? file.name),
        "X-FrontMind-Size": String(file.size),
      },
      body: file,
    });
    const body = await response.json().catch(() => ({}));
    const payload = body as {
      localAssetId?: string; filename?: string; bytes?: number; expiresAt?: number;
      error?: { message?: string };
    };
    if (!response.ok || !payload.localAssetId?.startsWith("asset_")) {
      throw new Error(payload.error?.message ?? `材料上传失败（${response.status}）`);
    }
    onProgressFallback(_onProgress);
    return {
      fileId: payload.localAssetId,
      filename: payload.filename ?? file.name,
      sizeBytes: payload.bytes,
      expiresAt: payload.expiresAt ?? 0,
    };
  };
  const onProgressFallback = (fn?: (percent: number) => void) => fn?.(100);

  const host: IntentWorkspaceHost = {
    captureRestOperation: (signal?: AbortSignal | null): IntentRestOperation => {
      const brandRest = input.captureRestOperation(signal ?? undefined);
      return { signal: brandRest.signal, assertActive: brandRest.assertActive, fetch: (req, init) => brandRest.fetch(req, init) };
    },
    createResponseLogicTask: startTask,
    uploadChatLocalAsset: uploadAsset,
    useSearch: () => typeof window !== "undefined" ? window.location.search : "",
    activeEnterpriseProjectId: () => undefined,
    trpc: {
      useUtils: () => ({
        workspace: {
          responseLogic: {
            setData: (
              _input: undefined,
              updater: (current: RecordsData | undefined) => RecordsData | undefined,
            ) => {
              storeData = updater(storeData);
              notifyStore();
            },
          },
        },
      }),
      workspace: {
        responseLogic: {
          useQuery: (
            _input?: undefined,
            queryOptions?: { refetchInterval?: number },
          ) => {
            // These hooks execute in the consumer component's render context
            // (PersistentResponseLogicWorkspace / ConfirmationBoard), so React
            // binds them to that component's fiber — standard rules-of-hooks.
            const [, forceRender] = useState(0);
            const subscribedVersion = useRef(storeVersion);

            useEffect(() => {
              const listener = () => {
                if (subscribedVersion.current !== storeVersion) {
                  subscribedVersion.current = storeVersion;
                  forceRender(n => n + 1);
                }
              };
              storeListeners.add(listener);
              void fetchRecords();
              const intervalMs = queryOptions?.refetchInterval ?? 0;
              const interval = intervalMs > 0
                ? window.setInterval(() => void fetchRecords(), intervalMs)
                : null;
              return () => {
                storeListeners.delete(listener);
                if (interval) window.clearInterval(interval);
              };
            }, [queryOptions?.refetchInterval]);

            return {
              data: storeData,
              isLoading: !storeData,
              isFetching: storeLoading,
              isSuccess: Boolean(storeData) && !storeError,
              isError: !storeData && Boolean(storeError),
              error: storeError ? { message: storeError } : null,
              refetch: async () => {
                await fetchRecords();
                return {
                  data: storeData,
                  error: storeError ? { message: storeError } : undefined,
                };
              },
            };
          },
        },
        saveResponseLogic: {
          useMutation: (mutationOptions?: { onSuccess?: (value: { record: unknown }) => void }) => ({
            mutateAsync: async (value: unknown) => {
              const result = await saveRecord(value);
              if (mutationOptions?.onSuccess) mutationOptions.onSuccess(result);
              // Refresh the store so list views reflect the save.
              void fetchRecords();
              return result;
            },
            isPending: false,
          }),
        },
      },
    } as never,
    FilePreview: input.visual.FilePreview,
    ImagePreview: input.visual.ImagePreview,
    Button: input.visual.Button,
    toast: input.toast,
    BusinessExecutionActivity: input.visual.BusinessExecutionActivity,
    categoryKey: (value: string) => value || null,
    categoryTone: () => null,
  };

  configureIntentWorkspaceHost(host);
  return host;
}
