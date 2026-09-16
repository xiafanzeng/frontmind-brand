import { useEffect, useRef, useState } from "react";
import { ImageIcon, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  captureWorkspaceRestOperation,
  type WorkspaceRestOperation,
} from "../lib/workspace-rest-scope";
import { useConversation } from "../conversation";
import { useWorkspaceDraftGuard } from "../host";
import {
  assertChatAttachmentSizes,
  normalizedKnowledgeBaseUploadMimeType,
} from "../lib/attachment-files";
import { uploadKnowledgeBaseLocalAsset } from "../lib/frontmind-api";
import KnowledgeImageLibraryDialog, {
  KNOWLEDGE_IMAGE_MIME_TYPES,
} from "./KnowledgeImageLibraryDialog";
import { Button } from "@frontmind/module-ui/components/ui/button";
import type { KnowledgeBaseObservationDto } from "../../contracts/knowledge-base-public-progress";
import type { KnowledgeNodeDetailsDto } from "../../contracts/knowledge-node-workspace";

type Library = {
  coordinates: {
    conversationId: string;
    expectedGeneration: number;
    expectedRevision: number;
    expectedStateEpoch: number;
    expectedContentVersion: number;
    expectedLeafId: string;
  };
  images: Array<{
    assetId: string;
    url: string;
    caption: string;
    attached: boolean;
    removable: boolean;
    selectable: boolean;
  }>;
};
type PendingImage = { id: string; file: File; previewUrl: string };
type ImageAttempt = {
  requestId: string;
  library: Library;
  resetRevision: number;
  files: PendingImage[];
  removeAssetIds: string[];
  receipts: Map<
    number,
    Awaited<ReturnType<typeof uploadKnowledgeBaseLocalAsset>>
  >;
  dispatchSent?: boolean;
  definiteRejection?: boolean;
};
const imageMimeTypes = KNOWLEDGE_IMAGE_MIME_TYPES;
async function localRequest(
  rest: WorkspaceRestOperation,
  path: string,
  body?: unknown,
) {
  const response = await rest.fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  rest.assertActive();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error?.message ?? "节点状态已变化，请刷新后重试"),
      {
        status: response.status,
        code: result.error?.code,
        knowledgeObservation: result.observation,
      },
    );
  return result;
}

export interface KnowledgeNodeLocalActionsProps {
  conversationId: string;
  leafId: string;
  leafTitle?: string;
  resetRevision?: number;
  disabled?: boolean;
  editDisabled?: boolean;
  imagesDisabled?: boolean;
  editLabel?: string;
  onEditTargetSelected?: () => void;
  onImagesSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
export default function KnowledgeNodeLocalActions(
  props: KnowledgeNodeLocalActionsProps,
) {
  return (
    <KnowledgeNodeLocalActionsInner
      key={`${props.conversationId}:${props.leafId}:${props.resetRevision ?? "legacy"}`}
      {...props}
    />
  );
}
function KnowledgeNodeLocalActionsInner({
  conversationId,
  leafId,
  leafTitle,
  resetRevision,
  disabled = false,
  editDisabled = false,
  imagesDisabled = false,
  editLabel = "AI 修改",
  onEditTargetSelected,
  onImagesSaved,
  onBusyChange,
  onDirtyChange,
}: KnowledgeNodeLocalActionsProps) {
  const { commitKnowledgeBaseObservation, refreshConversations } =
    useConversation();
  const lifetime = useRef(new AbortController());
  const busyRef = useRef(false);
  const callbacks = useRef({ onBusyChange, onDirtyChange, onImagesSaved });
  callbacks.current = { onBusyChange, onDirtyChange, onImagesSaved };
  const imageButton = useRef<HTMLButtonElement>(null);
  const previewUrls = useRef(new Set<string>());
  const attempt = useRef<ImageAttempt | null>(null);
  const imageScope = useRef<WorkspaceRestOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryResetRevision, setLibraryResetRevision] = useState<
    number | null
  >(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const imageDirty = pendingImages.length > 0 || removed.size > 0;
  useEffect(() => {
    if (lifetime.current.signal.aborted)
      lifetime.current = new AbortController();
    const mountedLifetime = lifetime.current;
    return () => {
      mountedLifetime.abort();
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onDirtyChange?.(false);
    };
  }, []);
  useEffect(() => {
    callbacks.current.onDirtyChange?.(imageDirty);
  }, [imageDirty]);
  const beginOperation = (resume = false, imageOperation = false) => {
    if (busyRef.current || (disabled && !resume)) return null;
    const signal = imageOperation
      ? (imageScope.current?.signal ?? lifetime.current.signal)
      : lifetime.current.signal;
    if (signal.aborted) return null;
    const rest = captureWorkspaceRestOperation(signal);
    if (rest.signal.aborted) return null;
    busyRef.current = true;
    setBusy(true);
    callbacks.current.onBusyChange?.(true);
    return rest;
  };
  const finishOperation = (rest: WorkspaceRestOperation) => {
    if (rest.signal.aborted) return;
    busyRef.current = false;
    setBusy(false);
    callbacks.current.onBusyChange?.(false);
  };
  const readLibrary = async (rest: WorkspaceRestOperation) =>
    localRequest(
      rest,
      `/api/knowledge-base/node/images?${new URLSearchParams({ conversationId, leafId })}`,
    ) as Promise<Library>;
  const commit = async (
    rest: WorkspaceRestOperation,
    observation?: KnowledgeBaseObservationDto,
  ) => {
    rest.assertActive();
    if (observation)
      commitKnowledgeBaseObservation(conversationId, observation);
    await refreshConversations();
    rest.assertActive();
    window.dispatchEvent(
      new CustomEvent("frontmind:knowledge-progress-updated"),
    );
  };
  const selectNode = async (
    rest: WorkspaceRestOperation,
    data: Library,
    clientRequestId: string,
  ) => {
    const result = await localRequest(rest, "/api/knowledge-base/node/select", {
      ...data.coordinates,
      leafId,
      clientRequestId,
    });
    rest.assertActive();
    if (
      !result.observation ||
      result.observation.generation !== data.coordinates.expectedGeneration
    )
      throw new Error("节点版本已变化，请重新读取后再修改");
    return result.observation as KnowledgeBaseObservationDto;
  };
  const edit = async () => {
    if (editDisabled) return;
    const rest = beginOperation();
    if (!rest) return;
    try {
      await commit(
        rest,
        await selectNode(rest, await readLibrary(rest), crypto.randomUUID()),
      );
      onEditTargetSelected?.();
      toast.success("已选择该节点，请填写本次修改要求");
    } catch (error) {
      if (!rest.signal.aborted)
        toast.error(error instanceof Error ? error.message : "无法选择节点");
    } finally {
      finishOperation(rest);
    }
  };
  const clearDraft = () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    setPendingImages([]);
    setRemoved(new Set());
    attempt.current = null;
    imageScope.current = null;
    setAttemptStarted(false);
    setError(null);
    setProgress(null);
    setLibrary(null);
  };
  const openLibrary = async () => {
    if (imagesDisabled) return;
    const rest = beginOperation();
    if (!rest) return;
    try {
      const data = await readLibrary(rest);
      let currentResetRevision = resetRevision;
      if (currentResetRevision === undefined) {
        const details = (await localRequest(
          rest,
          `/api/knowledge-base/node/content?${new URLSearchParams({
            conversationId,
            leafId,
            expectedGeneration: String(data.coordinates.expectedGeneration),
            expectedContentVersion: String(
              data.coordinates.expectedContentVersion,
            ),
          })}`,
        )) as KnowledgeNodeDetailsDto;
        currentResetRevision = details.coordinates.resetRevision;
      }
      if (
        !Number.isSafeInteger(currentResetRevision) ||
        currentResetRevision! < 0
      )
        throw new Error("知识库状态已变化，请刷新后重试");
      setLibraryResetRevision(currentResetRevision!);
      imageScope.current = rest;
      setLibrary({
        ...data,
        images: data.images.filter((image) => image.attached),
      });
      setError(null);
    } catch (error) {
      if (!rest.signal.aborted)
        toast.error(error instanceof Error ? error.message : "图片加载失败");
    } finally {
      finishOperation(rest);
    }
  };
  const addFiles = (files: File[]) => {
    if (busy || attemptStarted || disabled || imagesDisabled || !files.length)
      return;
    try {
      assertChatAttachmentSizes(files);
      if (
        files.some(
          (file) =>
            !imageMimeTypes.includes(
              normalizedKnowledgeBaseUploadMimeType(file),
            ),
        )
      )
        throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片");
      const additions = files.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return { id: crypto.randomUUID(), file, previewUrl };
      });
      setPendingImages((current) => [...current, ...additions]);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "图片无法读取");
    }
  };
  const saveImages = async (): Promise<boolean> => {
    if (
      !library ||
      libraryResetRevision === null ||
      (!attempt.current && (imagesDisabled || disabled))
    )
      return false;
    if (!imageDirty) {
      clearDraft();
      return true;
    }
    const rest = beginOperation(Boolean(attempt.current), true);
    if (!rest) return false;
    try {
      setError(null);
      if (!attempt.current) {
        const requestId = crypto.randomUUID();
        attempt.current = {
          requestId,
          library,
          resetRevision: libraryResetRevision,
          files: [...pendingImages],
          removeAssetIds: [...removed],
          receipts: new Map(),
        };
        setAttemptStarted(true);
      }
      const current = attempt.current;
      for (let index = 0; index < current.files.length; index++) {
        if (current.receipts.has(index)) continue;
        const receipt = await uploadKnowledgeBaseLocalAsset(
          current.files[index]!.file,
          (percent) => {
            if (!rest.signal.aborted)
              setProgress(
                `正在上传图片 ${index + 1}/${current.files.length} · ${percent}%`,
              );
          },
          { maxRetries: 2, initialDelay: 1000, maxDelay: 3000 },
          { signal: rest.signal },
        );
        rest.assertActive();
        current.receipts.set(index, receipt);
      }
      setProgress("正在保存图片…");
      current.dispatchSent = true;
      current.definiteRejection = false;
      const { expectedLeafId: _leaf, ...coordinates } =
        current.library.coordinates;
      const result = await localRequest(
        rest,
        "/api/knowledge-base/images/save",
        {
          ...coordinates,
          expectedResetRevision: current.resetRevision,
          leafId,
          clientRequestId: current.requestId,
          attachments: current.files.map((_, index) => {
            const receipt = current.receipts.get(index)!;
            return { fileId: receipt.fileId, filename: receipt.filename };
          }),
          removeAssetIds: current.removeAssetIds,
        },
      );
      rest.assertActive();
      if (!result.accepted)
        throw new Error("尚未收到图片保存结果，请重试同一次保存");
      // A successful local save is final even when the following UI refresh
      // fails. Do not retain a draft that could upload the same files again.
      clearDraft();
      const observation = result.knowledgeObservation ?? result.observation;
      if (observation)
        commitKnowledgeBaseObservation(conversationId, observation);
      window.dispatchEvent(
        new CustomEvent("frontmind:knowledge-progress-updated"),
      );
      await Promise.allSettled([
        refreshConversations(),
        Promise.resolve().then(() => callbacks.current.onImagesSaved?.()),
      ]);
      rest.assertActive();
      toast.success("节点图片已保存，更新知识库后会同步到正式版本和 ZIP");
      return true;
    } catch (error) {
      if (!rest.signal.aborted) {
        const failure = error as {
          status?: number;
          code?: string;
          knowledgeObservation?: KnowledgeBaseObservationDto;
        };
        if (
          attempt.current &&
          [400, 401, 403, 404, 409, 410, 422].includes(failure.status ?? 0) &&
          !/IDEMPOTENCY_PENDING|OUTCOME_UNKNOWN/.test(failure.code ?? "")
        ) {
          attempt.current.definiteRejection = true;
          attempt.current.dispatchSent = false;
        }
        if (failure.knowledgeObservation)
          commitKnowledgeBaseObservation(
            conversationId,
            failure.knowledgeObservation,
          );
        const message =
          error instanceof Error ? error.message : "图片保存失败，请重试";
        setError(message);
        setProgress(null);
        toast.error(message);
      }
      return false;
    } finally {
      finishOperation(rest);
    }
  };
  const discard = async (): Promise<boolean> => {
    if (busyRef.current || attempt.current?.dispatchSent) return false;
    clearDraft();
    return true;
  };
  useWorkspaceDraftGuard({
    dirty: imageDirty,
    label: "知识节点图片",
    save: saveImages,
    discard,
  });
  const controlsDisabled = busy || disabled || imagesDisabled || attemptStarted;
  const attached = library?.images ?? [];
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void edit()}
          disabled={disabled || editDisabled || busy}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {editLabel}
        </Button>
        <Button
          ref={imageButton}
          size="sm"
          variant="outline"
          onClick={() => void openLibrary()}
          disabled={disabled || imagesDisabled || busy}
        >
          <ImageIcon className="mr-1 h-3.5 w-3.5" />
          图片管理
        </Button>
      </div>
      <KnowledgeImageLibraryDialog
        open={Boolean(library)}
        title="当前节点的图片"
        description="在此上传的图片会关联当前节点；移除只解除当前节点的关联，图片仍保留在图片库中。保存后更新知识库即可同步 ZIP。"
        uploadLabel="上传当前节点图片"
        removeLabel="从节点移除"
        onClose={clearDraft}
        items={[
          ...attached.map((item) => ({
            id: item.assetId,
            url: item.url,
            caption: item.caption,
            nodes: [{ leafId, title: leafTitle ?? leafId }],
            removable: item.removable,
            ...(removed.has(item.assetId)
              ? { pending: "remove" as const }
              : {}),
          })),
          ...pendingImages.map((item) => ({
            id: item.id,
            url: item.previewUrl,
            caption: item.file.name,
            nodes: [{ leafId, title: leafTitle ?? leafId }],
            removable: true,
            pending: "add" as const,
          })),
        ]}
        busy={busy}
        dirty={imageDirty}
        controlsDisabled={controlsDisabled}
        saveDisabled={!attemptStarted && (disabled || imagesDisabled)}
        discardDisabled={Boolean(attempt.current?.dispatchSent)}
        progress={progress}
        error={
          error
            ? `${error}${imageDirty ? " 所选图片和修改已保留，可重试同一次保存。" : ""}`
            : null
        }
        saveLabel={attemptStarted ? "重试保存" : "保存图片"}
        onAddFiles={addFiles}
        onRemove={(id) => {
          const pending = pendingImages.find((item) => item.id === id);
          if (pending) {
            URL.revokeObjectURL(pending.previewUrl);
            previewUrls.current.delete(pending.previewUrl);
            setPendingImages((old) => old.filter((item) => item.id !== id));
          } else {
            setRemoved((old) => {
              const next = new Set(old);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
        }}
        onSave={() => void saveImages()}
        onDiscard={() => void discard()}
        onCloseAutoFocus={(event) => {
          if (imageButton.current && !imageButton.current.disabled) {
            event.preventDefault();
            imageButton.current.focus();
          }
        }}
      />
    </>
  );
}
