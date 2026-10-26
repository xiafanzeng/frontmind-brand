import type { ComponentType, ReactNode } from "react";
import { configureIntentWorkspaceHost } from "./response-logic-runtime-host.js";
import type { IntentWorkspaceHost, IntentToast, StartResponseLogicTask, UploadIntentAsset, IntentRestOperation, IntentVisualComponents } from "./response-logic-host.js";

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

const RL_API_BASE = "/api/modules/brand/response-logic";

export function createBrandResponseLogicHost(input: BrandResponseLogicAdapterInput): IntentWorkspaceHost {
  const rest = input.captureRestOperation;

  const loadRecords = async () => {
    const response = await rest().fetch(RL_API_BASE, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`加载应答逻辑失败（${response.status}）`);
    return response.json();
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
    const formData = new FormData();
    formData.append("file", file, options?.filename ?? file.name);
    const response = await rest(options?.signal).fetch(`${RL_API_BASE}/materials/upload`, {
      method: "POST", body: formData,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body as { error?: { message?: string } })?.error?.message ?? `材料上传失败（${response.status}）`);
    }
    return body as { fileId: string; filename: string; sizeBytes?: number; expiresAt: number };
  };

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
      workspace: {
        responseLogic: {
          useQuery: () => {
            let data: { records: unknown[] } | undefined;
            let isLoading = true;
            loadRecords().then(r => { data = r; isLoading = false; }).catch(() => { isLoading = false; });
            return { data, isLoading, isFetching: isLoading, isSuccess: !isLoading && !!data, isError: !isLoading && !data, refetch: async () => { data = await loadRecords(); return { data }; } };
          },
        },
        saveResponseLogic: {
          useMutation: () => ({ mutateAsync: async (value: unknown) => saveRecord(value), isPending: false }),
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
