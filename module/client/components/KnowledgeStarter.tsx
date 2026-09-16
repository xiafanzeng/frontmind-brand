
import { useKnowledgeBaseUploadBatch, useKnowledgeBaseUploadField } from "../lib/knowledge-base-upload-manager";
import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { type Attachment, type LocalMessage } from "../conversation";
import { motion } from "framer-motion";
import { FileText, Download, Loader2, Sparkles, X, BookOpen, UploadCloud } from "lucide-react";
import { cn } from "@frontmind/module-ui/lib/utils";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { cancelKnowledgeBaseStartReservation, discardManagedUploadIntent, discardUnboundUpload, sanitizeBrandText, stageKnowledgeBaseTurnAttachment, uploadKnowledgeBaseLocalAsset, type FileUploadRecordEvent, type KnowledgeBaseAttachmentManifestItem, type ManagedUploadHandle, type UploadRecoveryAction, type UploadFileOptions } from "../lib/frontmind-api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@frontmind/module-ui/components/ui/dialog";
import { Button } from "@frontmind/module-ui/components/ui/button";
import { Input } from "@frontmind/module-ui/components/ui/input";
import { Progress } from "@frontmind/module-ui/components/ui/progress";
import { Textarea } from "@frontmind/module-ui/components/ui/textarea";
import { knowledgeBaseObservationFromPayload, type KnowledgeBaseObservationDto } from "../lib/knowledge-progress";
import { chatAttachmentSizeError, normalizedKnowledgeBaseUploadFilename, normalizedKnowledgeBaseUploadMimeType } from "../lib/attachment-files";
import { useWorkspaceDraftGuard } from "../host";
import { WorkflowQuestion } from "@frontmind/module-ui/dashboard/Workflow";

export const KNOWLEDGE_BASE_FOUNDATION_COPY =
  "企业知识库是品牌事实与产品信息的统一底稿，也是构建 AI 专用友好官网、生成内容与准确回答客户问题的基础。";

export const KNOWLEDGE_BASE_TRACE_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export function safeKnowledgeBaseTraceId(value: unknown) {
  const normalized = String(value || "").trim();
  return KNOWLEDGE_BASE_TRACE_ID_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export interface DeepReportStartInput {
  companyName: string;
  companyWebsite?: string;
  operatorNotes?: string;
  agentProfile?: string;
  files: File[];
}

export type KnowledgeBaseStarterUploadStage =
  | "queued"
  | "creating_intent"
  | "uploading_to_dashboard"
  | "sealed"
  | "creating_cloud_record"
  | "uploading_to_cloud"
  | "waiting_cloud_ready"
  | "creating_record"
  | "recovering"
  | "uploading"
  | "server_processing"
  | "uploaded"
  | "failed"
  | "cancelled";

export type KnowledgeBaseStarterBatchPhase =
  | "ready"
  | "uploading"
  | "starting"
  | "recovering"
  | "completed"
  | "failed";

export type KnowledgeBaseStarterUploadReceipt = {
  fileId: string;
  filename: string;
  sizeBytes?: number;
  contentSha256?: string;
  uploadedAt?: number;
  dashboardReadyAt?: number;
  providerReadyAt?: number;
  expiresAt?: number;
  traceId?: string;
};

export type KnowledgeBaseStarterFileUpdate = {
  stage: KnowledgeBaseStarterUploadStage;
  itemId?: string;
  intentId?: string;
  fileId?: string;
  loadedBytes?: number;
  dashboardReceivedBytes?: number;
  totalBytes?: number;
  receipt?: KnowledgeBaseStarterUploadReceipt;
  uploadHandle?: ManagedUploadHandle;
  clearFileRecord?: boolean;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  recoveryAction?: UploadRecoveryAction;
  recreateRequired?: boolean;
  traceId?: string;
  attempt?: number;
};

export type KnowledgeBaseStarterStartOutcome =
  | { status: "accepted" }
  | { status: "recovering" };

export type KnowledgeBaseStarterLifecycle = {
  signal: AbortSignal;
  clientRequestId: string;
  /** Reset epoch frozen when this starter batch begins. */
  expectedResetRevision: number;
  startedAt: number;
  uploadedReceipts: ReadonlyMap<string, KnowledgeBaseStarterUploadReceipt>;
  fileRecordIds: ReadonlyMap<string, string>;
  uploadHandles: ReadonlyMap<string, ManagedUploadHandle>;
  fileAttempts: ReadonlyMap<string, number>;
  transferredBytes: ReadonlyMap<string, number>;
  dashboardReceivedBytes?: ReadonlyMap<string, number>;
  /** Stable row identities aligned with the `files` payload array. */
  fileItemIds?: readonly string[];
  /** Durable start coordinate created before the first browser upload. */
  reservation?: {
    uploadAttemptId?: string;
    conversationId: string;
    turnId: string;
    clientRequestId: string;
    expectedResetRevision: number;
  };
  attachmentManifest?: import("../lib/frontmind-api").KnowledgeBaseAttachmentManifestItem[];
  startPrepared: boolean;
  onStartPrepared: (prepared: boolean) => void;
  onReservation?: (
    reservation: NonNullable<KnowledgeBaseStarterLifecycle["reservation"]>,
  ) => void;
  onBatchPhase: (phase: KnowledgeBaseStarterBatchPhase) => void;
  onFileUpdate: (
    itemId: string,
    file: File,
    update: KnowledgeBaseStarterFileUpdate,
  ) => void;
};

export function uploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    /Dashboard|provider|reservation|upstream|canonical|堆栈|上游/iu.test(
      message,
    )
  ) {
    return "资料暂时无法完成上传，请检查并继续；已保存的文件会保留。";
  }
  return message ? sanitizeBrandText(message) : "文件上传失败，请稍后重试";
}

export function uploadWasCancelled(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error as { cancelled?: unknown } | null)?.cancelled === true ||
    (error as { name?: unknown } | null)?.name === "AbortError"
  );
}

export function uploadFileRecordId(event: FileUploadRecordEvent) {
  return event.fileId;
}

export async function buildKnowledgeBaseStarterAttachmentManifest(
  files: readonly File[],
  itemIds: readonly string[],
  signal: AbortSignal,
): Promise<KnowledgeBaseAttachmentManifestItem[]> {
  if (files.length !== itemIds.length) {
    throw new Error("知识库附件坐标不完整，请重新选择资料");
  }
  const manifest: KnowledgeBaseAttachmentManifestItem[] = [];
  // Reserve from immutable browser metadata only. Dashboard computes the
  // authoritative digest while streaming each upload into managed storage.
  for (const [index, file] of files.entries()) {
    if (signal.aborted) {
      throw new DOMException("上传已停止", "AbortError");
    }
    manifest.push({
      itemId: itemIds[index],
      ordinal: index + 1,
      total: files.length,
      filename: normalizedKnowledgeBaseUploadFilename(file.name),
      sizeBytes: file.size,
      mimeType: normalizedKnowledgeBaseUploadMimeType(file),
      lastModified: Math.max(0, Number(file.lastModified || 0)),
    });
  }
  return manifest;
}

export type KnowledgeBaseStarterUploadImplementation = (
  file: File,
  onProgress?: (percent: number) => void,
  retryConfig?: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
  },
  options?: UploadFileOptions,
) => Promise<{
  fileId: string;
  filename: string;
  sizeBytes?: number;
  contentSha256?: string;
  uploadedAt?: number;
  dashboardReadyAt?: number;
  providerReadyAt?: number;
  expiresAt?: number;
  replayed?: boolean;
  recovered?: boolean;
  traceId?: string;
}>;

export async function uploadKnowledgeBaseStarterFiles(
  files: File[],
  incomingLifecycle: KnowledgeBaseStarterLifecycle,
  responseStartedAt: number,
  uploadImplementation: KnowledgeBaseStarterUploadImplementation = uploadKnowledgeBaseLocalAsset,
) {
  const operation = captureWorkspaceRestOperation(
    incomingLifecycle.signal,
    undefined,
    { detached: true },
  );
  const lifecycle = { ...incomingLifecycle, signal: operation.signal };
  operation.assertActive();
  const receipts = new Map(lifecycle.uploadedReceipts);
  const uploadedAttachments: Array<{
    file_id: string;
    filename: string;
  }> = [];
  const messageAttachments: Attachment[] = [];

  for (const [fileIndex, file] of files.entries()) {
    if (lifecycle.signal.aborted) {
      throw new DOMException("上传已停止", "AbortError");
    }
    const itemId =
      lifecycle.fileItemIds?.[fileIndex] ||
      `${lifecycle.clientRequestId}:${fileIndex + 1}`;
    let receipt = receipts.get(itemId);
    if (!receipt) {
      if (lifecycle.signal.aborted) {
        throw new DOMException("上传已停止", "AbortError");
      }

      const existingFileId = lifecycle.fileRecordIds.get(itemId);
      const existingUploadHandle = lifecycle.uploadHandles.get(itemId);
      const recoveryFileId = existingUploadHandle?.fileId || existingFileId;
      let currentFileId = recoveryFileId;
      let currentUploadHandle = existingUploadHandle;
      const attempt = (lifecycle.fileAttempts.get(itemId) ?? 0) + 1;
      let transferredBytes = 0;
      let transferCompleted = false;
      lifecycle.onFileUpdate(itemId, file, {
        stage:
          existingUploadHandle || recoveryFileId
            ? "recovering"
            : "creating_intent",
        ...(existingUploadHandle?.itemId
          ? { itemId: existingUploadHandle.itemId }
          : {}),
        ...(existingUploadHandle?.intentId
          ? { intentId: existingUploadHandle.intentId }
          : {}),
        ...(recoveryFileId ? { fileId: recoveryFileId } : {}),
        ...(existingUploadHandle ? { uploadHandle: existingUploadHandle } : {}),
        loadedBytes: transferredBytes,
        totalBytes: file.size,
        attempt,
      });

      try {
        const uploadOptions: UploadFileOptions = {
          captureLocalCopy: true,
          captureFilename: normalizedKnowledgeBaseUploadFilename(file.name),
          batchId: lifecycle.clientRequestId,
          batchOrdinal: fileIndex + 1,
          batchTotal: files.length,
          itemId,
          ...(lifecycle.attachmentManifest?.[fileIndex]?.sha256
            ? {
                contentSha256: lifecycle.attachmentManifest[fileIndex]!.sha256,
              }
            : {}),
          ...(lifecycle.reservation
            ? {
                resumeScope: {
                  kind: "knowledge_base" as const,
                  conversationId: lifecycle.reservation.conversationId,
                  turnId: lifecycle.reservation.turnId,
                  clientRequestId: lifecycle.reservation.clientRequestId,
                  expectedResetRevision:
                    lifecycle.reservation.expectedResetRevision,
                  uploadAttemptId: lifecycle.reservation.uploadAttemptId,
                },
              }
            : {}),
          signal: lifecycle.signal,
          ...(existingUploadHandle
            ? { existingUploadHandle }
            : existingFileId
              ? { existingFileId }
              : {}),
          onFileRecord: (event) => {
            if (lifecycle.signal.aborted) return;
            const fileId = uploadFileRecordId(event);
            if (fileId) currentFileId = fileId;
            if (event.uploadHandle) currentUploadHandle = event.uploadHandle;
            lifecycle.onFileUpdate(itemId, file, {
              stage: event.intentId ? "creating_intent" : "creating_record",
              ...(event.itemId ? { itemId: event.itemId } : {}),
              ...(event.intentId ? { intentId: event.intentId } : {}),
              ...(fileId ? { fileId } : {}),
              ...(event.uploadHandle
                ? { uploadHandle: event.uploadHandle }
                : {}),
              loadedBytes: transferredBytes,
              totalBytes: file.size,
              attempt,
            });
          },
          onFileRecordDiscarded: () => {
            if (lifecycle.signal.aborted) return;
            currentFileId = undefined;
            lifecycle.onFileUpdate(itemId, file, {
              stage: "creating_record",
              clearFileRecord: true,
              loadedBytes: transferredBytes,
              totalBytes: file.size,
              attempt,
            });
          },
          onStage: (event) => {
            if (lifecycle.signal.aborted || transferCompleted) return;
            if (typeof event.loadedBytes === "number") {
              transferredBytes = Math.min(
                file.size,
                Math.max(0, event.loadedBytes),
              );
            }
            const traceId = safeKnowledgeBaseTraceId(event.traceId);
            lifecycle.onFileUpdate(itemId, file, {
              stage: event.stage,
              ...(event.itemId ? { itemId: event.itemId } : {}),
              ...(event.intentId ? { intentId: event.intentId } : {}),
              ...(event.fileId ? { fileId: event.fileId } : {}),
              loadedBytes: transferredBytes,
              ...(typeof event.dashboardReceivedBytes === "number"
                ? {
                    dashboardReceivedBytes: Math.min(
                      file.size,
                      Math.max(0, event.dashboardReceivedBytes),
                    ),
                  }
                : {}),
              totalBytes:
                typeof event.totalBytes === "number"
                  ? event.totalBytes
                  : file.size,
              ...(traceId ? { traceId } : {}),
              attempt: attempt + (event.attempt ?? 1) - 1,
            });
          },
        };
        let uploaded: Awaited<
          ReturnType<KnowledgeBaseStarterUploadImplementation>
        >;
        try {
          uploaded = await uploadImplementation(
            file,
            undefined,
            undefined,
            uploadOptions,
          );
        } catch (firstError) {
          const code = String(
            (firstError as { code?: unknown } | null)?.code || "",
          );
          const frozen = lifecycle.attachmentManifest?.[fileIndex];
          const retryHandle = currentUploadHandle;
          const sameFile = Boolean(
            frozen &&
              frozen.filename ===
                normalizedKnowledgeBaseUploadFilename(file.name) &&
              frozen.sizeBytes === file.size &&
              frozen.mimeType === normalizedKnowledgeBaseUploadMimeType(file) &&
              frozen.lastModified ===
                Math.max(0, Number(file.lastModified || 0)),
          );
          const canRetrySameIntent = Boolean(
            [
              "UPLOAD_BROWSER_BODY_INCOMPLETE",
              "UPLOAD_BROWSER_BODY_REQUIRED",
            ].includes(code) &&
              sameFile &&
              retryHandle?.intentId &&
              retryHandle.ticket &&
              retryHandle.expiresAt > Date.now() &&
              lifecycle.reservation &&
              lifecycle.expectedResetRevision ===
                lifecycle.reservation.expectedResetRevision &&
              !lifecycle.signal.aborted,
          );
          if (!canRetrySameIntent) throw firstError;
          lifecycle.onFileUpdate(itemId, file, {
            stage: "recovering",
            itemId: retryHandle!.itemId,
            intentId: retryHandle!.intentId,
            uploadHandle: retryHandle,
            loadedBytes: transferredBytes,
            totalBytes: file.size,
            attempt,
          });
          uploaded = await uploadImplementation(file, undefined, undefined, {
            ...uploadOptions,
            existingFileId: undefined,
            existingUploadHandle: retryHandle,
          });
        }
        if (lifecycle.signal.aborted) {
          throw new DOMException("上传已停止", "AbortError");
        }
        transferCompleted = true;
        receipt = {
          fileId: uploaded.fileId,
          filename: uploaded.filename,
          sizeBytes: uploaded.sizeBytes,
          contentSha256: uploaded.contentSha256,
          uploadedAt: uploaded.uploadedAt,
          dashboardReadyAt: uploaded.dashboardReadyAt,
          providerReadyAt: uploaded.providerReadyAt,
          expiresAt: uploaded.expiresAt,
          traceId: safeKnowledgeBaseTraceId(uploaded.traceId),
        };
        receipts.set(itemId, receipt);
        if (!lifecycle.signal.aborted) {
          lifecycle.onFileUpdate(itemId, file, {
            stage: "server_processing",
            fileId: receipt.fileId,
            loadedBytes: file.size,
            dashboardReceivedBytes: file.size,
            totalBytes: file.size,
            receipt,
            traceId: receipt.traceId,
            attempt,
          });
        }
      } catch (error) {
        const rawStructuredFileId = (error as { fileId?: unknown } | null)
          ?.fileId;
        const structuredFileId = currentUploadHandle?.intentId
          ? undefined
          : typeof rawStructuredFileId === "string" &&
              rawStructuredFileId.trim()
            ? rawStructuredFileId
            : undefined;
        const structuredRetryable = (error as { retryable?: unknown } | null)
          ?.retryable;
        const structuredRecoveryAction = (
          error as { recoveryAction?: UploadRecoveryAction } | null
        )?.recoveryAction;
        const structuredRecreateRequired =
          (error as { recreateRequired?: unknown } | null)?.recreateRequired ===
          true;
        const recoveryAction =
          structuredRecreateRequired &&
          structuredRecoveryAction !== "discard_and_recreate"
            ? "check_status"
            : structuredRecoveryAction;
        if (!lifecycle.signal.aborted) {
          lifecycle.onFileUpdate(itemId, file, {
            stage: uploadWasCancelled(error, lifecycle.signal)
              ? "cancelled"
              : "failed",
            ...(structuredFileId !== undefined
              ? { fileId: structuredFileId }
              : currentFileId
                ? { fileId: currentFileId }
                : {}),
            loadedBytes: transferredBytes,
            totalBytes: file.size,
            error: uploadErrorMessage(error),
            errorCode:
              String((error as { code?: unknown } | null)?.code || "").trim() ||
              undefined,
            retryable:
              typeof structuredRetryable === "boolean"
                ? structuredRetryable
                : undefined,
            recoveryAction,
            recreateRequired:
              structuredRecreateRequired &&
              structuredRecoveryAction === "discard_and_recreate",
            traceId: safeKnowledgeBaseTraceId(
              (error as { traceId?: unknown } | null)?.traceId,
            ),
            attempt,
          });
        }
        throw error;
      }
    }

    if (lifecycle.reservation && lifecycle.attachmentManifest) {
      if (lifecycle.signal.aborted) {
        throw new DOMException("上传已停止", "AbortError");
      }
      await stageKnowledgeBaseTurnAttachment({
        ...lifecycle.reservation,
        attachmentManifest: lifecycle.attachmentManifest,
        index: fileIndex,
        signal: lifecycle.signal,
        attachment: {
          file_id: receipt.fileId,
          filename: receipt.filename,
        },
      });
      if (lifecycle.signal.aborted) {
        throw new DOMException("上传已停止", "AbortError");
      }
    }

    lifecycle.onFileUpdate(itemId, file, {
      stage: "uploaded",
      fileId: receipt.fileId,
      loadedBytes: file.size,
      dashboardReceivedBytes: file.size,
      totalBytes: file.size,
      receipt,
    });

    uploadedAttachments.push({
      file_id: receipt.fileId,
      filename: receipt.filename,
    });
    messageAttachments.push({
      id: `att-${responseStartedAt}-${messageAttachments.length + 1}`,
      type: "file",
      name: file.name,
      fileId: receipt.fileId,
      file,
      expiresAt: receipt.expiresAt,
      expired: false,
    });
  }

  return { uploadedAttachments, messageAttachments };
}

export function projectKnowledgeBaseStarterRequest(input: {
  lifecycle: KnowledgeBaseStarterLifecycle;
  conversationId: string;
  responseStartedAt: number;
  messageAttachments: Attachment[];
  registerConversation: (conversationId: string) => void;
  addConversationMessage: (
    conversationId: string,
    message: LocalMessage,
  ) => void;
  updateConversationTitle: (conversationId: string, title: string) => void;
}) {
  if (input.lifecycle.startPrepared) return false;

  input.registerConversation(input.conversationId);
  input.addConversationMessage(input.conversationId, {
    id: `msg-kb-start-${input.responseStartedAt}`,
    role: "user",
    content: "开始构建企业知识库",
    ...(input.messageAttachments.length > 0
      ? { attachments: input.messageAttachments }
      : {}),
    timestamp: input.responseStartedAt,
    knowledgeBase: {
      kind: "pending_user",
      clientRequestId: input.lifecycle.clientRequestId,
    },
  });
  input.updateConversationTitle(input.conversationId, "企业知识库构建");
  input.lifecycle.onStartPrepared(true);
  return true;
}

export type KnowledgeBaseStartRequestError = Error & {
  status?: number;
  code?: string;
  traceId?: string;
  attachmentCount?: number;
  reservationCreated?: boolean;
  observation?: KnowledgeBaseObservationDto;
};

export const KNOWLEDGE_BASE_START_TIMEOUT_MS = 120_000;

export function knowledgeBaseStartTimeoutError(): KnowledgeBaseStartRequestError {
  const error = new Error(
    "启动请求等待超时，系统将继续确认服务端是否已受理",
  ) as KnowledgeBaseStartRequestError;
  error.status = 408;
  error.code = "KNOWLEDGE_BASE_START_TIMEOUT";
  return error;
}

export async function fetchKnowledgeBaseStartRequest(
  init: RequestInit,
  options: {
    signal: AbortSignal;
    timeoutMs?: number;
    fetchImplementation?: typeof fetch;
    endpoint?: string;
    onRequestStarted?: () => void;
  },
) {
  const operation = captureWorkspaceRestOperation(options.signal, undefined, {
    detached: true,
  });
  const signal = operation.signal;
  if (signal.aborted) {
    throw new DOMException("上传已停止", "AbortError");
  }

  const controller = new AbortController();
  const abortFromLifecycle = () => controller.abort();
  signal.addEventListener("abort", abortFromLifecycle, { once: true });
  if (signal.aborted) controller.abort();
  if (controller.signal.aborted) {
    signal.removeEventListener("abort", abortFromLifecycle);
    throw new DOMException("上传已停止", "AbortError");
  }
  const timeoutMs = options.timeoutMs ?? KNOWLEDGE_BASE_START_TIMEOUT_MS;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(knowledgeBaseStartTimeoutError());
    }, timeoutMs);
  });

  try {
    if (controller.signal.aborted) {
      throw new DOMException("上传已停止", "AbortError");
    }
    options.onRequestStarted?.();
    const response = await Promise.race([
      (options.fetchImplementation ?? fetch)(
        options.endpoint ?? "/api/knowledge-base/start/reserve",
        {
          ...init,
          headers: operation.headers(
            Object.fromEntries(new Headers(init.headers).entries()),
          ),
          signal: controller.signal,
        },
      ),
      timeout,
    ]);
    operation.assertActive();
    return response;
  } catch (error) {
    if (timedOut) throw knowledgeBaseStartTimeoutError();
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortFromLifecycle);
  }
}

export async function readKnowledgeBaseStartRequestError(
  response: Response,
): Promise<KnowledgeBaseStartRequestError> {
  try {
    const data = await response.json();
    const errorNode =
      data?.error && typeof data.error === "object" ? data.error : null;
    const message =
      (typeof data.error === "string" ? data.error : data.error?.message) ||
      data.message ||
      `请求失败 (${response.status})`;
    const error = new Error(message) as KnowledgeBaseStartRequestError;
    error.status = response.status;
    const code = String(errorNode?.code || data?.code || "").trim();
    const traceId = String(errorNode?.traceId || data?.traceId || "").trim();
    error.code = /^[A-Z0-9_:-]{1,128}$/u.test(code) ? code : undefined;
    error.traceId = safeKnowledgeBaseTraceId(traceId);
    const attachmentCount = Number(
      errorNode?.attachmentCount ?? data?.attachmentCount,
    );
    if (
      Number.isSafeInteger(attachmentCount) &&
      attachmentCount >= 0 &&
      attachmentCount <= 1_000
    ) {
      error.attachmentCount = attachmentCount;
    }
    if (typeof data?.reservationCreated === "boolean") {
      error.reservationCreated = data.reservationCreated;
    }
    if (data?.observation) {
      try {
        error.observation = knowledgeBaseObservationFromPayload(data);
      } catch {
        // The HTTP error remains actionable even if an optional observation is malformed.
      }
    }
    return error;
  } catch {
    const error = new Error(
      `请求失败 (${response.status})`,
    ) as KnowledgeBaseStartRequestError;
    error.status = response.status;
    return error;
  }
}

export function shouldRecoverKnowledgeBaseStartFailure(
  dispatchAttempted: boolean,
  error: Pick<
    KnowledgeBaseStartRequestError,
    "status" | "code" | "reservationCreated"
  >,
) {
  if (!dispatchAttempted) return false;
  // A reset epoch mismatch is a definitive rejection of these browser bytes.
  // It must never enter the network-unknown recovery branch or project an old
  // pending start into the freshly reset conversation.
  if (error.code === "KNOWLEDGE_BASE_RESET_REVISION_CHANGED") return false;
  if (error.reservationCreated === false) return false;
  if (error.code === "KNOWLEDGE_BASE_ROLLOUT_PENDING") return false;
  const status = Number(error.status || 0);
  // A reserve receipt embedded in an explicit 4xx does not acknowledge the
  // final dispatch. Only a sent request with a transport/timeout/transient
  // response can have an unknown dispatch outcome.
  return !status || status === 408 || status === 429 || status >= 500;
}

export type KnowledgeBaseStarterFileState = {
  stage: KnowledgeBaseStarterUploadStage;
  itemId?: string;
  intentId?: string;
  fileId?: string;
  loadedBytes: number;
  dashboardReceivedBytes?: number;
  totalBytes: number;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  recoveryAction?: UploadRecoveryAction;
  recreateRequired?: boolean;
  traceId?: string;
  attempt?: number;
  startedAt?: number;
  elapsedMs?: number;
};

export function createKnowledgeBaseStarterClientRequestId(startedAt: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `kb-start-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createKnowledgeBaseStarterItemId(file: File) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `kb-file-${suffix}-${file.size}`.slice(0, 255);
}

export function formatKnowledgeBaseStarterElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}分${String(seconds).padStart(2, "0")}秒`
    : `${seconds}秒`;
}

export function knowledgeBaseStarterStageCopy(state: KnowledgeBaseStarterFileState) {
  switch (state.stage) {
    case "creating_intent":
      return "正在准备资料上传";
    case "uploading_to_dashboard": {
      const percent = state.totalBytes
        ? Math.min(
            100,
            Math.round((state.loadedBytes / state.totalBytes) * 100),
          )
        : 0;
      return `正在上传资料 ${percent}%`;
    }
    case "sealed":
      return "资料已收到，正在继续处理";
    case "creating_cloud_record":
      return "正在登记资料";
    case "uploading_to_cloud":
      return "正在同步资料";
    case "waiting_cloud_ready":
      return "资料已收到，正在准备";
    case "creating_record":
      return "正在准备资料接收";
    case "recovering":
      return "正在确认资料状态";
    case "uploading": {
      const percent = state.totalBytes
        ? Math.min(
            100,
            Math.round((state.loadedBytes / state.totalBytes) * 100),
          )
        : 0;
      return `正在上传 ${percent}%`;
    }
    case "server_processing":
      return "资料已收到，正在准备";
    case "uploaded":
      return "资料已确认，等待其余文件";
    case "failed":
      return state.error || "上传失败";
    case "cancelled":
      return "已停止，可继续上传";
    default:
      return "等待上传";
  }
}

export function knowledgeBaseStarterBatchCopy(phase: KnowledgeBaseStarterBatchPhase) {
  switch (phase) {
    case "uploading":
      return "正在上传资料，完成后将自动开始调研";
    case "starting":
      return "全部资料已确认，正在创建知识库任务";
    case "recovering":
      return "请求结果暂时未知，正在确认是否已启动";
    case "completed":
      return "资料已上传完成，正在启动知识库调研";
    case "failed":
      return "本批次尚未完成，可安全重试";
    default:
      return "准备上传企业资料";
  }
}

export function knowledgeBaseStarterRecoveryCopy(
  state: KnowledgeBaseStarterFileState,
) {
  if (state.recoveryAction === "discard_and_recreate") {
    return "继续时将核对已保存资料，再重新上传未完成文件。";
  }
  if (state.recreateRequired) {
    return "继续时将核对已保存资料，再重新上传未完成文件。";
  }
  if (
    state.recoveryAction === "retry_same_file" ||
    state.recoveryAction === "check_status"
  ) {
    return "可以检查并继续上传该文件。";
  }
  if (state.recoveryAction === "refresh_page") {
    return "当前上传凭证无效，请刷新页面后重新选择。";
  }
  if (state.recoveryAction === "contact_admin") {
    return "该文件需要管理员协助处理。";
  }
  if (state.retryable === false) {
    return "无法直接重试；请移除该文件后继续，或取消本批次重新选择。";
  }
  return null;
}

export function formatKnowledgeBaseUploadBytes(bytes: number) {
  if (bytes < 1_000) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function EmptyConversationHint({
  uploadScopeKey = "knowledge-starter",
  onStartKnowledgeBase,
  onBatchCancelled,
  eligible = true,
  companyName,
  companyConfigured,
  companyLoading,
  resetRevision = 0,
  inline = false,
  onDirtyChange,
}: {
  uploadScopeKey?: string;
  onStartKnowledgeBase: (
    input: DeepReportStartInput,
    lifecycle: KnowledgeBaseStarterLifecycle,
  ) => Promise<KnowledgeBaseStarterStartOutcome>;
  onBatchCancelled?: (resetRevision: number) => void | Promise<void>;
  eligible?: boolean;
  companyName: string;
  companyConfigured: boolean;
  companyLoading: boolean;
  resetRevision?: number;
  inline?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const uploadBatch = useKnowledgeBaseUploadBatch(
    `${uploadScopeKey}:${resetRevision}`,
    `${uploadScopeKey}:`,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const starterEntryRef = useRef<HTMLDivElement>(null);
  const starterTriggerRef = useRef<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useKnowledgeBaseUploadField(
    uploadBatch,
    "dialogOpen",
    false,
  );
  const [companyNameDraft, setCompanyNameDraft] = useKnowledgeBaseUploadField(
    uploadBatch,
    "companyNameDraft",
    "",
  );
  const [companyNameTouched, setCompanyNameTouched] =
    useKnowledgeBaseUploadField(uploadBatch, "companyNameTouched", false);
  // The server-configured name only seeds the draft; typed edits win.
  useEffect(() => {
    if (!companyNameTouched) setCompanyNameDraft(companyName);
  }, [companyName, companyNameTouched, setCompanyNameDraft]);
  const effectiveCompanyName = companyNameDraft.trim();
  const [companyWebsite, setCompanyWebsite] = useKnowledgeBaseUploadField(
    uploadBatch,
    "companyWebsite",
    "",
  );
  const [operatorNotes, setOperatorNotes] = useKnowledgeBaseUploadField(
    uploadBatch,
    "operatorNotes",
    "",
  );
  const [fileItems, setFileItems] = useKnowledgeBaseUploadField<
    Array<{ itemId: string; file: File }>
  >(uploadBatch, "fileItems", []);
  const files = useMemo(() => fileItems.map((item) => item.file), [fileItems]);
  const starterDirty =
    eligible &&
    !uploadBatch.read<number | null>("batchStartedAt", null) &&
    Boolean(
      effectiveCompanyName !== companyName.trim() ||
        companyWebsite.trim() ||
        operatorNotes.trim() ||
        files.length,
    );
  useWorkspaceDraftGuard({
    dirty: inline && starterDirty && !uploadBatch.read("batchStartedAt", null),
    label: "知识库资料和补充说明",
  });
  useEffect(() => {
    if (inline) onDirtyChange?.(starterDirty);
  }, [inline, starterDirty, onDirtyChange]);
  useEffect(
    () => () => {
      if (inline) onDirtyChange?.(false);
    },
    [inline, onDirtyChange],
  );
  const [isDragging, setIsDragging] = useKnowledgeBaseUploadField(
    uploadBatch,
    "isDragging",
    false,
  );
  const [isStarting, setIsStarting] = useKnowledgeBaseUploadField(
    uploadBatch,
    "isStarting",
    false,
  );
  const [isDiscarding, setIsDiscarding] = useKnowledgeBaseUploadField(
    uploadBatch,
    "isDiscarding",
    false,
  );
  const [fileStates, setFileStates] = useKnowledgeBaseUploadField<
    Map<string, KnowledgeBaseStarterFileState>
  >(uploadBatch, "fileStates", () => new Map());
  const [uploadedReceipts, setUploadedReceipts] = useKnowledgeBaseUploadField<
    Map<string, KnowledgeBaseStarterUploadReceipt>
  >(uploadBatch, "uploadedReceipts", () => new Map());
  const [fileRecordIds, setFileRecordIds] = useKnowledgeBaseUploadField<
    Map<string, string>
  >(uploadBatch, "fileRecordIds", () => new Map());
  const [uploadHandles, setUploadHandles] = useKnowledgeBaseUploadField<
    Map<string, ManagedUploadHandle>
  >(uploadBatch, "uploadHandles", () => new Map());
  const [batchStartedAt, setBatchStartedAt] = useKnowledgeBaseUploadField<
    number | null
  >(uploadBatch, "batchStartedAt", null);
  const [elapsedAt, setElapsedAt] = useKnowledgeBaseUploadField(
    uploadBatch,
    "elapsedAt",
    () => Date.now(),
  );
  const [batchError, setBatchError] = useKnowledgeBaseUploadField<
    string | null
  >(uploadBatch, "batchError", null);
  const [batchPhase, setBatchPhase] =
    useKnowledgeBaseUploadField<KnowledgeBaseStarterBatchPhase>(
      uploadBatch,
      "batchPhase",
      "ready",
    );
  const [startPrepared, setStartPrepared] = useKnowledgeBaseUploadField(
    uploadBatch,
    "startPrepared",
    false,
  );
  const [startReservation, setStartReservation] =
    useKnowledgeBaseUploadField<NonNullable<
    KnowledgeBaseStarterLifecycle["reservation"]
  > | null>(uploadBatch, "startReservation", null);
  const abortControllerRef = uploadBatch.ref<AbortController | null>(
    "controller",
    null,
  );
  const clientRequestIdRef = uploadBatch.ref<string | null>(
    "clientRequestId",
    null,
  );
  const batchLocked = batchStartedAt !== null;
  const openStarterDialog = useCallback(() => {
    starterTriggerRef.current =
      starterEntryRef.current?.querySelector<HTMLElement>("button") ?? null;
    setDialogOpen(true);
  }, [setDialogOpen]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((file) => {
      const sizeError = chatAttachmentSizeError(file);
      if (!sizeError) return true;
      toast.error("文件过大", { description: sizeError });
      return false;
    });
    const candidates = incoming.map((file) => ({
      itemId: createKnowledgeBaseStarterItemId(file),
      file,
    }));
    setFileItems((current) => {
      const seen = new Set(
        current.map(
          ({ file }) => `${file.name}:${file.size}:${file.lastModified}`,
        ),
      );
      const next = [...current];
      for (const candidate of candidates) {
        const { file } = candidate;
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(candidate);
        }
      }
      return next;
    });
    setFileStates((current) => {
      const next = new Map(current);
      for (const { itemId, file } of candidates) {
        if (!next.has(itemId)) {
          next.set(itemId, {
            stage: "queued",
            loadedBytes: 0,
            totalBytes: file.size,
          });
        }
      }
      return next;
    });
  }, []);

  const resetDialog = useCallback(() => {
    setCompanyWebsite("");
    setOperatorNotes("");
    setFileItems([]);
    setIsDragging(false);
    setIsStarting(false);
    setIsDiscarding(false);
    setFileStates(new Map());
    setUploadedReceipts(new Map());
    setFileRecordIds(new Map());
    setUploadHandles(new Map());
    setBatchStartedAt(null);
    setElapsedAt(Date.now());
    setBatchError(null);
    setBatchPhase("ready");
    setStartPrepared(false);
    setStartReservation(null);
    abortControllerRef.current = null;
    clientRequestIdRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeFile = useCallback(
    async (index: number) => {
      const removed = files[index];
      const removedItem = fileItems[index];
      // Once the server freezes a start manifest, removing one local row would
      // leave the operation waiting forever for that exact ordinal. Release
      // the whole reservation before choosing a different file set instead.
      if (
        !removed ||
        !removedItem ||
        isStarting ||
        isDiscarding ||
        startPrepared ||
        startReservation
      )
        return;
      const { itemId } = removedItem;
      const fileId = fileRecordIds.get(itemId);
      const uploadHandle = uploadHandles.get(itemId);
      if (fileId || uploadHandle) {
        setIsDiscarding(true);
        try {
          if (uploadHandle) await discardManagedUploadIntent(uploadHandle);
          else await discardUnboundUpload(fileId!);
        } catch (error) {
          const code = String((error as { code?: unknown } | null)?.code || "");
          toast.warning(
            code === "UPLOAD_IN_PROGRESS"
              ? "文件仍在处理中"
              : "文件暂时无法移除",
            {
              description:
                code === "UPLOAD_IN_PROGRESS"
                  ? "云端仍在登记该文件，请稍后再试。"
                  : uploadErrorMessage(error),
            },
          );
          return;
        } finally {
          setIsDiscarding(false);
        }
      }

      setFileItems((current) =>
        current.filter((item) => item.itemId !== itemId),
      );
      setFileStates((states) => {
        const next = new Map(states);
        next.delete(itemId);
        return next;
      });
      setUploadedReceipts((receipts) => {
        const next = new Map(receipts);
        next.delete(itemId);
        return next;
      });
      setFileRecordIds((records) => {
        const next = new Map(records);
        next.delete(itemId);
        return next;
      });
      setUploadHandles((handles) => {
        const next = new Map(handles);
        next.delete(itemId);
        return next;
      });
    },
    [
      fileItems,
      fileRecordIds,
      files,
      isDiscarding,
      isStarting,
      startPrepared,
      startReservation,
      uploadHandles,
    ],
  );

  const discardBatchAndClose = useCallback(async () => {
    if (isStarting || isDiscarding) return;
    const targets = new Map<
      string,
      { fileId?: string; handle?: ManagedUploadHandle }
    >();
    for (const [itemId, fileId] of fileRecordIds) {
      targets.set(itemId, { fileId });
    }
    // A sealed/processing intent intentionally has no provider fileId yet.
    // Include it independently so closing the dialog cannot orphan local
    // bytes or bypass the intent DELETE contract.
    for (const [itemId, handle] of uploadHandles) {
      targets.set(itemId, { ...targets.get(itemId), handle });
    }
    const records = Array.from(targets.entries());
    setIsDiscarding(true);
    if (startReservation) {
      try {
        const cancelled =
          await cancelKnowledgeBaseStartReservation(startReservation);
        setStartReservation(null);
        await onBatchCancelled?.(cancelled.resetRevision);
        void Promise.allSettled(
          records.map(([, target]) => {
            if (target.handle) {
              return discardManagedUploadIntent(target.handle, {
                deferProviderCleanup: true,
              });
            }
            return discardUnboundUpload(target.fileId!);
          }),
        );
        if (!onBatchCancelled) {
          setIsDiscarding(false);
          setDialogOpen(false);
          resetDialog();
        }
        return;
      } catch (error) {
        const code = String((error as { code?: unknown } | null)?.code || "");
        // A reset or retention tombstone already revoked the old reservation;
        // treating it as released is safe and prevents an old tab from
        // keeping the freshly reset starter UI blocked.
        if (
          ![
            "KNOWLEDGE_BASE_RESET_REVISION_CHANGED",
            "CONVERSATION_RESET",
            "TURN_NOT_FOUND",
            "BUILD_NOT_FOUND",
            "RESERVATION_NOT_FOUND",
          ].includes(code)
        ) {
          toast.warning("本批次暂时无法取消", {
            description: uploadErrorMessage(error),
          });
          setIsDiscarding(false);
          return;
        }
      }
    }

    const results = await Promise.allSettled(
      records.map(([, target]) => {
        if (target.handle) return discardManagedUploadIntent(target.handle);
        return discardUnboundUpload(target.fileId!);
      }),
    );
    const failed: Array<{ itemId: string; error: unknown }> = [];
    const discardedItemIds: string[] = [];
    results.forEach((result, index) => {
      const itemId = records[index][0];
      if (result.status === "fulfilled") discardedItemIds.push(itemId);
      else failed.push({ itemId, error: result.reason });
    });

    if (failed.length > 0) {
      const discarded = new Set(discardedItemIds);
      setFileRecordIds((current) => {
        const next = new Map(current);
        for (const itemId of discarded) next.delete(itemId);
        return next;
      });
      setUploadHandles((current) => {
        const next = new Map(current);
        for (const itemId of discarded) next.delete(itemId);
        return next;
      });
      setUploadedReceipts((current) => {
        const next = new Map(current);
        for (const itemId of discarded) next.delete(itemId);
        return next;
      });
      setFileStates((current) => {
        const next = new Map(current);
        for (const itemId of discarded) {
          const file = fileItems.find((item) => item.itemId === itemId)?.file;
          if (!file) continue;
          next.set(itemId, {
            stage: "queued",
            loadedBytes: 0,
            totalBytes: file.size,
          });
        }
        return next;
      });
      const firstError = failed[0].error;
      const code = String(
        (firstError as { code?: unknown } | null)?.code || "",
      );
      toast.warning(
        code === "UPLOAD_IN_PROGRESS"
          ? "仍有文件正在云端处理"
          : "部分文件暂时无法取消",
        {
          description:
            code === "UPLOAD_IN_PROGRESS"
              ? "请稍后再次点击取消；未清理的上传记录已保留。"
              : uploadErrorMessage(firstError),
        },
      );
      setIsDiscarding(false);
      return;
    }

    setIsDiscarding(false);
    setDialogOpen(false);
    resetDialog();
  }, [
    fileItems,
    fileRecordIds,
    isDiscarding,
    isStarting,
    resetDialog,
    onBatchCancelled,
    startReservation,
    uploadHandles,
  ]);

  useEffect(() => {
    if (!isStarting || batchStartedAt === null) return;
    setElapsedAt(Date.now());
    const timer = setInterval(() => setElapsedAt(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [batchStartedAt, isStarting]);

  const updateFileState = useCallback(
    (itemId: string, file: File, update: KnowledgeBaseStarterFileUpdate) => {
      if (update.clearFileRecord) {
        setFileRecordIds((current) => {
          const next = new Map(current);
          next.delete(itemId);
          return next;
        });
        setUploadHandles((current) => {
          const next = new Map(current);
          next.delete(itemId);
          return next;
        });
      }
      if (update.fileId) {
        setFileRecordIds((current) => {
          const next = new Map(current);
          next.set(itemId, update.fileId!);
          return next;
        });
      }
      if (update.uploadHandle) {
        setUploadHandles((current) => {
          const next = new Map(current);
          next.set(itemId, update.uploadHandle!);
          return next;
        });
      }
      if (update.receipt) {
        setUploadedReceipts((current) => {
          const next = new Map(current);
          next.set(itemId, update.receipt!);
          return next;
        });
      }
      setFileStates((current) => {
        const previous = current.get(itemId) || {
          stage: "queued" as const,
          loadedBytes: 0,
          totalBytes: file.size,
        };
        if (previous.stage === "uploaded" && update.stage !== "uploaded")
          return current;
        const now = Date.now();
        const isActive = [
          "creating_intent",
          "uploading_to_dashboard",
          "sealed",
          "creating_cloud_record",
          "uploading_to_cloud",
          "waiting_cloud_ready",
          "creating_record",
          "recovering",
          "uploading",
          "server_processing",
        ].includes(update.stage);
        const isTerminal = ["uploaded", "failed", "cancelled"].includes(
          update.stage,
        );
        if (typeof update.loadedBytes === "number")
          uploadBatch.noteTransfer(
            itemId,
            update.loadedBytes,
            update.attempt ?? previous.attempt ?? 1,
          );
        const startedAt =
          previous.startedAt ?? (isActive || isTerminal ? now : undefined);
        const next = new Map(current);
        next.set(itemId, {
          ...previous,
          ...update,
          ...(update.clearFileRecord ? { fileId: undefined } : {}),
          loadedBytes:
            typeof update.loadedBytes === "number"
              ? Math.max(0, update.loadedBytes)
              : previous.loadedBytes,
          dashboardReceivedBytes:
            typeof update.dashboardReceivedBytes === "number"
              ? Math.max(
                  previous.dashboardReceivedBytes ?? 0,
                  update.dashboardReceivedBytes,
                )
              : previous.dashboardReceivedBytes,
          totalBytes:
            typeof update.totalBytes === "number" && update.totalBytes > 0
              ? update.totalBytes
              : previous.totalBytes || file.size,
          startedAt,
          elapsedMs:
            isTerminal && startedAt !== undefined
              ? Math.max(0, now - startedAt)
              : previous.elapsedMs,
        });
        return next;
      });
    },
    [],
  );

  const uploadSummary = useMemo(() => {
    const totalBytes = fileItems.reduce(
      (total, { file }) => total + file.size,
      0,
    );
    let transferredBytes = 0;
    let dashboardReceivedBytes = 0;
    let confirmedBytes = 0;
    let confirmedCount = 0;
    for (const { itemId, file } of fileItems) {
      const state = fileStates.get(itemId);
      // Browser transfer and even a provider PUT success are not a confirmed
      // attachment until the managed upload returns its final receipt.
      if (uploadedReceipts.has(itemId) && state?.stage === "uploaded") {
        confirmedCount += 1;
        confirmedBytes += file.size;
      }
      transferredBytes += Math.min(
        file.size,
        uploadedReceipts.has(itemId)
          ? file.size
          : Math.max(0, state?.loadedBytes ?? 0),
      );
      dashboardReceivedBytes += Math.min(
        file.size,
        Math.max(0, state?.dashboardReceivedBytes ?? 0),
      );
    }
    const rawPercent = totalBytes
      ? Math.round((transferredBytes / totalBytes) * 100)
      : 0;
    return {
      totalBytes,
      transferredBytes,
      dashboardReceivedBytes,
      confirmedBytes,
      uploadedCount: confirmedCount,
      percent:
        confirmedCount === files.length && files.length > 0
          ? 100
          : Math.min(100, rawPercent),
    };
  }, [fileItems, fileStates, files.length, uploadedReceipts]);

  const nonRetryableFailedFile = useMemo(
    () =>
      fileItems.find(({ itemId }) => {
        const state = fileStates.get(itemId);
        return (
          state?.stage === "failed" &&
          state.retryable === false &&
          !state.recreateRequired &&
          !["retry_same_file", "check_status", "discard_and_recreate"].includes(
            String(state.recoveryAction),
          )
        );
      })?.file,
    [fileItems, fileStates],
  );
  const hasCloudStatusCheckFailure = useMemo(
    () =>
      fileItems.some(({ itemId }) => {
        const state = fileStates.get(itemId);
        return (
          state?.stage === "failed" && state.recoveryAction === "check_status"
        );
      }),
    [fileItems, fileStates],
  );

  const handleStart = useCallback(async () => {
    if (uploadBatch.disposed || uploadBatch.controller) return;
    const normalizedCompanyName = effectiveCompanyName;
    if (!normalizedCompanyName) {
      toast.error("请先填写本次构建使用的企业名称");
      return;
    }

    const startedAt = batchStartedAt ?? Date.now();
    const clientRequestId =
      clientRequestIdRef.current ||
      createKnowledgeBaseStarterClientRequestId(startedAt);
    clientRequestIdRef.current = clientRequestId;
    setBatchStartedAt(startedAt);
    uploadBatch.write("lastProgressAt", Date.now());
    setElapsedAt(Date.now());
    setBatchError(null);
    setBatchPhase(
      uploadedReceipts.size === files.length ? "starting" : "uploading",
    );
    setFileStates((current) => {
      const next = new Map(current);
      for (const { itemId, file } of fileItems) {
        const state = next.get(itemId);
        if (!state) {
          next.set(itemId, {
            stage: "queued",
            loadedBytes: 0,
            totalBytes: file.size,
          });
        } else if (state.stage === "failed" || state.stage === "cancelled") {
          next.set(itemId, {
            ...state,
            stage: "queued",
            error: undefined,
            errorCode: undefined,
            retryable: undefined,
            recoveryAction: undefined,
            recreateRequired: undefined,
            traceId: undefined,
            startedAt: undefined,
            elapsedMs: undefined,
          });
        }
      }
      return next;
    });

    const { controller, operation } = uploadBatch.beginAttempt();
    abortControllerRef.current = controller;
    setIsStarting(true);
    try {
      if (
        ["stopped", "stopping", "unknown"].includes(
          uploadBatch.read("stopState", "active"),
        )
      ) {
        const resumed = await uploadBatch.resume();
        if (resumed)
          setStartReservation((current) =>
            current
              ? {
                  ...current,
                  uploadAttemptId: resumed.uploadAttemptId ?? undefined,
                }
              : current,
          );
      }
      const payload = {
        companyName: normalizedCompanyName,
        companyWebsite: companyWebsite.trim(),
        agentProfile: "frontmind-pro",
        operatorNotes: operatorNotes.trim(),
        files,
      };
      const outcome = await onStartKnowledgeBase(payload, {
        signal: operation.signal,
        clientRequestId,
        expectedResetRevision: resetRevision,
        startedAt,
        uploadedReceipts: new Map(uploadedReceipts),
        fileRecordIds: new Map(fileRecordIds),
        uploadHandles: new Map(uploadHandles),
        fileAttempts: new Map(
          fileItems.map(({ itemId }) => [
            itemId,
            fileStates.get(itemId)?.attempt ?? 0,
          ]),
        ),
        transferredBytes: new Map(
          fileItems.map(({ itemId }) => [
            itemId,
            fileStates.get(itemId)?.loadedBytes ?? 0,
          ]),
        ),
        dashboardReceivedBytes: new Map(
          fileItems.map(({ itemId }) => [
            itemId,
            fileStates.get(itemId)?.dashboardReceivedBytes ?? 0,
          ]),
        ),
        fileItemIds: fileItems.map(({ itemId }) => itemId),
        startPrepared,
        onStartPrepared: setStartPrepared,
        onReservation: (reservation) => {
          setStartReservation(reservation);
          uploadBatch.startHeartbeat(reservation);
        },
        onBatchPhase: setBatchPhase,
        onFileUpdate: updateFileState,
      });
      if (outcome.status === "accepted" || outcome.status === "recovering") {
        setBatchPhase(
          outcome.status === "accepted" ? "completed" : "recovering",
        );
        setDialogOpen(false);
        resetDialog();
      }
    } catch (error) {
      setElapsedAt(Date.now());
      setBatchPhase("failed");
      setBatchError(
        uploadWasCancelled(error, controller.signal)
          ? uploadBatch.read<string>("stopState", "active") === "stopped"
            ? "上传已停止。已完成的文件会保留，继续时只处理未完成资料。"
            : "已暂停本地传输，正在确认服务端停止状态。"
          : uploadErrorMessage(error),
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      uploadBatch.finishAttempt(controller);
      setIsStarting(false);
    }
  }, [
    batchStartedAt,
    effectiveCompanyName,
    companyWebsite,
    fileRecordIds,
    fileItems,
    fileStates,
    files,
    onStartKnowledgeBase,
    operatorNotes,
    resetRevision,
    resetDialog,
    startPrepared,
    updateFileState,
    uploadedReceipts,
    uploadHandles,
  ]);

  const stopUpload = useCallback(() => {
    void uploadBatch.stop();
  }, [uploadBatch]);
  const [checking] = useKnowledgeBaseUploadField(
    uploadBatch,
    "checking",
    false,
  );
  const [checkMessage] = useKnowledgeBaseUploadField<string | null>(
    uploadBatch,
    "checkMessage",
    null,
  );
  const [stopState] = useKnowledgeBaseUploadField(
    uploadBatch,
    "stopState",
    "active",
  );
  const lastProgressAt = uploadBatch.read<number>("lastProgressAt", Date.now());
  const stalled =
    isStarting &&
    batchPhase === "uploading" &&
    elapsedAt - lastProgressAt >= 90_000;

  if (!eligible && batchStartedAt === null && !dialogOpen) return null;

  return (
    <>
      {inline ? (
        <div ref={starterEntryRef} hidden={dialogOpen}>
          <WorkflowQuestion
            variant="entry"
            module="brand"
            question="先用哪些资料了解你的企业？"
            description="提供企业官网、宣传册或补充说明，构建后可以逐项审阅知识内容。"
            choices={[
              {
                id: "materials",
                label: "构建企业知识库",
                description: "填写官网与说明，上传企业资料",
              },
            ]}
            onSelect={openStarterDialog}
          />
        </div>
      ) : (
        <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex min-h-[420px] flex-col items-center justify-center px-4 py-10 text-center"
      >
        <div className="mx-auto flex max-w-xl flex-col items-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </span>
          <p className="mt-5 text-base leading-7 text-foreground/75">
            {KNOWLEDGE_BASE_FOUNDATION_COPY}
          </p>
          <div className="mt-6">
            <Button
              type="button"
                onClick={openStarterDialog}
              className="h-11 rounded-xl px-5 gap-2 shadow-sm"
            >
              <BookOpen className="w-4 h-4" />
              构建企业知识库
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <FeatureBadge
              icon={<FileText className="w-3.5 h-3.5" />}
              text="资料输入"
            />
            <FeatureBadge
              icon={<Sparkles className="w-3.5 h-3.5" />}
              text="智能分析"
            />
            <FeatureBadge
              icon={<Download className="w-3.5 h-3.5" />}
              text="报告交付"
            />
          </div>
        </div>
        </motion.div>
      )}

      <KnowledgeStarterSurface
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) {
            openStarterDialog();
            return;
          }
          if (isStarting || isDiscarding) return;
          // Closing the V2.3 dialog is a reversible presentation action. Keep
          // the current fields, selected files and upload handles; explicit
          // cancellation below owns discard semantics.
          setDialogOpen(false);
        }}
        onCloseAutoFocus={(event) => {
          const trigger = starterTriggerRef.current;
          if (trigger?.isConnected) {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              if (trigger.isConnected) trigger.focus();
            });
          }
          starterTriggerRef.current = null;
        }}
        footer={
          <>
            <div className="workflow-actions">
              <Button
                type="button"
                variant="operatorOutline"
                onClick={() => {
                  if (isStarting) {
                    stopUpload();
                  } else {
                    void discardBatchAndClose();
                  }
                }}
                disabled={
                  isDiscarding ||
                  (isStarting && uploadSummary.uploadedCount === files.length)
                }
              >
                {isDiscarding
                  ? "正在取消"
                  : isStarting
                    ? uploadSummary.uploadedCount === files.length
                      ? "正在启动"
                      : "停止上传"
                    : startReservation
                      ? "取消本批次并重新选择"
                      : "取消"}
              </Button>
              <Button
                type="button"
                variant="operator"
                onClick={() => void handleStart()}
                disabled={
                  isStarting ||
                  isDiscarding ||
                  !effectiveCompanyName ||
                  Boolean(nonRetryableFailedFile)
                }
                className="gap-2"
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BookOpen className="h-4 w-4" />
                )}
                {isStarting
                  ? uploadSummary.uploadedCount === files.length
                    ? "正在启动构建"
                    : "正在上传资料"
                  : batchStartedAt !== null
                    ? nonRetryableFailedFile
                      ? "请先移除失败文件"
                      : hasCloudStatusCheckFailure
                        ? "重新检查云端状态"
                        : uploadSummary.uploadedCount === files.length
                          ? "重试启动"
                          : "重试并继续"
                    : "开始构建"}
              </Button>
            </div>
          </>
        }
      >
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                当前企业项目
              </label>
              <Input
                value={companyNameDraft}
                maxLength={160}
                onChange={(event) => {
                  setCompanyNameTouched(true);
                  setCompanyNameDraft(event.target.value);
                }}
              placeholder={
                companyLoading
                  ? "正在读取企业信息…"
                  : "输入本次构建使用的企业名称"
              }
                disabled={isStarting || isDiscarding}
              />
              {!companyLoading && !effectiveCompanyName && (
                <p className="text-xs leading-5 text-amber-700">
                  请填写本次知识库构建使用的企业名称。
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                企业官网入口
              </label>
              <Textarea
                value={companyWebsite}
                onChange={(event) => setCompanyWebsite(event.target.value)}
                placeholder="填写一个或多个企业官网，每行一个，例如 https://www.example.com"
                disabled={isStarting || isDiscarding || batchLocked}
                className="min-h-20 resize-none"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                官网用于全站采集；系统还会自动检索全网公开信息，无需逐个填写外部来源。
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                备注
              </label>
              <Textarea
                value={operatorNotes}
                onChange={(event) => setOperatorNotes(event.target.value)}
                placeholder="填写知识库范围、重点产品、目标用途或需要避开的内容"
                disabled={isStarting || isDiscarding || batchLocked}
                className="min-h-24 resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                企业宣传册
              </label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isStarting && !isDiscarding && !batchLocked) {
                    fileInputRef.current?.click();
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    !isStarting &&
                    !isDiscarding &&
                    !batchLocked &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!isStarting && !isDiscarding && !batchLocked) {
                    setIsDragging(true);
                  }
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  if (
                    !isStarting &&
                    !isDiscarding &&
                    !batchLocked &&
                    event.dataTransfer.files.length > 0
                  ) {
                    addFiles(event.dataTransfer.files);
                  }
                }}
                className={cn(
                  "flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  isDragging
                    ? "border-primary/70 bg-primary/5"
                    : "border-[#C8CDD5] bg-[#F0F1F3] hover:border-primary/40 hover:bg-[#E8EAED]",
                  (isStarting || isDiscarding || batchLocked) &&
                    "cursor-not-allowed opacity-60",
                )}
              >
                <UploadCloud className="mb-3 h-6 w-6 text-primary" />
                <div className="text-sm font-medium text-foreground/80">
                  拖入企业宣传册，或点击选择文件
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  支持宣传册、产品目录、PPT、图片、PDF、Word 等企业资料
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  disabled={isStarting || isDiscarding || batchLocked}
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files);
                  }}
                />
              </div>

              {files.length > 0 && (
              <details
                open={batchStartedAt === null}
                className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3"
              >
                <summary className="cursor-pointer text-sm">
                  文件进度 · 已完成 {uploadSummary.uploadedCount}/{files.length}
                </summary>
                  {fileItems.map(({ itemId, file }, index) => (
                    <div
                      key={itemId}
                      className="flex items-center justify-between gap-3 rounded-lg bg-background/80 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground/80">
                          {file.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatKnowledgeBaseUploadBytes(file.size)}
                        </div>
                        {batchStartedAt !== null &&
                          (() => {
                            const state = fileStates.get(itemId) || {
                              stage: "queued" as const,
                              loadedBytes: 0,
                              totalBytes: file.size,
                            };
                            const fileElapsedMs = state.startedAt
                              ? (state.elapsedMs ?? elapsedAt - state.startedAt)
                              : null;
                            return (
                              <>
                                <div
                                  className={cn(
                                    "mt-1 text-xs",
                                    state.stage === "failed"
                                      ? "text-destructive"
                                      : state.stage === "uploaded"
                                        ? "text-emerald-700"
                                        : "text-muted-foreground",
                                  )}
                                >
                                  {knowledgeBaseStarterStageCopy(state)}
                                </div>
                                {state.attempt !== undefined && (
                                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                    第 {state.attempt} 次尝试
                                  </div>
                                )}
                                {state.stage === "failed" &&
                                  knowledgeBaseStarterRecoveryCopy(state) && (
                                    <div className="mt-0.5 text-[11px] leading-4 text-destructive">
                                      {knowledgeBaseStarterRecoveryCopy(state)}
                                    </div>
                                  )}
                                {fileElapsedMs !== null && (
                                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                    本次耗时{" "}
                                    {formatKnowledgeBaseStarterElapsed(
                                      fileElapsedMs,
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除 ${file.name}`}
                        className="h-7 w-7 shrink-0"
                        disabled={
                          isStarting ||
                          isDiscarding ||
                          startPrepared ||
                          Boolean(startReservation)
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeFile(index);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </details>
              )}

              {batchStartedAt !== null && files.length > 0 && (
                <div
                  aria-label="资料上传进度"
                  className="space-y-3 rounded-xl border border-border/70 bg-background/90 p-4"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-foreground/80">
                      资料上传进度
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {uploadSummary.percent}%
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                  {uploadSummary.percent === 100 &&
                  uploadSummary.uploadedCount < files.length
                    ? "传输完成，等待确认"
                    : knowledgeBaseStarterBatchCopy(batchPhase)}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  上传完成后将自动开始调研与整理，整个过程可能需要 30
                  分钟左右。可以切换到其他页面，上传会在后台继续。
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  已上传{" "}
                  {formatKnowledgeBaseUploadBytes(
                    uploadSummary.transferredBytes,
                  )}{" "}
                  / {formatKnowledgeBaseUploadBytes(uploadSummary.totalBytes)} ·
                  已完成 {uploadSummary.uploadedCount}/{files.length} 个文件
                  </p>
                  <Progress
                    aria-label="总体上传进度"
                    value={uploadSummary.percent}
                  />
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      已用时{" "}
                      {formatKnowledgeBaseStarterElapsed(
                        elapsedAt - batchStartedAt,
                      )}
                    </span>
                  </div>
                {(checking || checkMessage || stalled) && (
                  <p role="status" className="text-xs text-amber-700">
                    {checking
                      ? "正在读取服务端状态…"
                      : checkMessage ||
                        "暂时没有新的服务端进度，已完成文件会保留。"}
                  </p>
                )}
                {(stalled || stopState === "unknown") && !checking && (
                  <Button
                    type="button"
                    variant="operatorOutline"
                    onClick={() =>
                      void uploadBatch.checkStatus().catch(() => undefined)
                    }
                  >
                    重新读取状态
                  </Button>
                )}
                  {batchError && (
                    <div
                      role="alert"
                      className="rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                    >
                      {batchError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
      </KnowledgeStarterSurface>
    </>
  );
}

export function KnowledgeStarterSurface({
  open,
  onOpenChange,
  onCloseAutoFocus,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const description =
    "系统会采集官网与公开资料，并结合上传内容构建可审阅的知识库初稿。";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        style={
          {
            "--module-accent": "#16794f",
            "--module-color": "#16794f",
          } as React.CSSProperties
        }
        className="knowledge-starter-dialog w-[calc(100vw-1rem)] sm:max-w-[600px]"
      >
        <DialogHeader className="border-b border-border/70 px-5 py-4 sm:px-6">
          <DialogTitle>构建企业知识库</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="knowledge-starter-dialog__body">
          <div className="px-5 py-4 sm:px-6">{children}</div>
        </div>
        <DialogFooter className="knowledge-starter-dialog__footer">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FeatureBadge({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-card/80 border border-border/70 text-xs text-muted-foreground shadow-sm">
      {icon}
      {text}
    </div>
  );
}
