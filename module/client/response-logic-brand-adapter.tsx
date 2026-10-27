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

export function createBrandResponseLogicHost(input: BrandResponseLogicAdapterInput): IntentWorkspaceHost {
  const rest = input.captureRestOperation;

  // ── Reactive records store ──
  // The workspace's PersistentResponseLogicWorkspace calls
  // trpc.workspace.responseLogic.useQuery() during its render; this store
  // notifies subscribed components when records change so React re-renders.
  type RecordsData = { records: unknown[] };
  let storeData: RecordsData | undefined;
  let storeError: string | undefined;
  let storeLoading = false;
  let storeVersion = 0;
  const storeListeners = new Set<() => void>();

  const notifyStore = () => {
    storeVersion++;
    storeListeners.forEach(fn => fn());
  };

  const fetchRecords = async (): Promise<void> => {
    if (storeLoading) return;
    storeLoading = true;
    storeError = undefined;
    notifyStore();
    try {
      const response = await rest().fetch(RL_API_BASE, { method: "GET", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`加载应答逻辑失败（${response.status}）`);
      storeData = await response.json();
    } catch (error) {
      storeError = error instanceof Error ? error.message : "加载应答逻辑失败";
    } finally {
      storeLoading = false;
      notifyStore();
    }
  };

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
    const response = await rest(signal).fetch(`${RL_API_BASE}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: taskInput.questionId, groupId: taskInput.groupId, groupTitle: taskInput.groupTitle,
        question: taskInput.question, intent: taskInput.intent, summary: taskInput.summary,
        draft: taskInput.draft, operationRevision: taskInput.operationRevision,
        conversationId: taskInput.conversationId, taskId: taskInput.taskId, messages,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body as { error?: { message?: string } })?.error?.message ?? `生成任务创建失败（${response.status}）`);
    }
    return body as { id: string; operationRevision?: number };
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
