import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { useConversation } from "../conversation";
import { trpc } from "../api-hooks";
import {
  assertChatAttachmentSizes,
  normalizedKnowledgeBaseUploadMimeType,
} from "../lib/attachment-files";
import { uploadKnowledgeBaseLocalAsset } from "../lib/frontmind-api";
import {
  captureWorkspaceRestOperation,
  type WorkspaceRestOperation,
} from "../lib/workspace-rest-scope";
import { useWorkspaceDraftGuard } from "../host";
import type { KnowledgeBaseObservationDto } from "../../contracts/knowledge-base-public-progress";
import { Button } from "@frontmind/module-ui/components/ui/button";
import KnowledgeImageLibraryDialog, {
  KNOWLEDGE_IMAGE_MIME_TYPES,
  type KnowledgeLibraryImage,
} from "./KnowledgeImageLibraryDialog";

export type KnowledgeImageLibraryData = {
  coordinates: {
    conversationId: string;
    expectedGeneration: number;
    expectedRevision: number;
    expectedStateEpoch: number;
    expectedContentVersion: number;
    expectedResetRevision: number;
  };
  images: Array<{
    assetId: string;
    url: string;
    caption: string;
    filename?: string;
    nodes: Array<{ leafId: string; title: string }>;
    removable: boolean;
    pendingPublication?: boolean;
  }>;
  pendingPublication: boolean;
  canManage: boolean;
  reason?: string | null;
};

type PendingImage = { id: string; file: File; previewUrl: string };
type SaveAttempt = {
  clientRequestId: string;
  library: KnowledgeImageLibraryData;
  files: PendingImage[];
  removeAssetIds: string[];
  receipts: Map<string, { fileId: string; filename: string }>;
  sent: boolean;
  definiteRejection: boolean;
};

type Props = {
  conversationId?: string;
  generation?: number;
  resetRevision?: number;
  projectId?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onImagesSaved?: () => void | Promise<unknown>;
};

export default function KnowledgeImageLibrary(props: Props) {
  return (
    <KnowledgeImageLibraryInner
      key={`${props.projectId ?? "current"}:${props.conversationId ?? "latest"}:${props.generation ?? "current"}:${props.resetRevision ?? "current"}`}
      {...props}
    />
  );
}

/** The design preview uses the same dialog and only keeps changes in memory. */
export function PreviewKnowledgeImageLibrary({
  images = [],
}: {
  images?: KnowledgeLibraryImage[];
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(images);
  const [pending, setPending] = useState<KnowledgeLibraryImage[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pendingPublication, setPendingPublication] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const dirty = pending.length > 0 || removed.size > 0;
  const discard = () => {
    for (const item of pending) {
      URL.revokeObjectURL(item.url);
      urls.current.delete(item.url);
    }
    setPending([]);
    setRemoved(new Set());
    setError(null);
    setOpen(false);
  };
  return (
    <>
      <Button variant="operatorOutline" onClick={() => setOpen(true)}>
        <ImageIcon className="h-4 w-4" />
        查看图片库
      </Button>
      <KnowledgeImageLibraryDialog
        open={open}
        onClose={() => setOpen(false)}
        items={[
          ...saved.map((item) => ({
            ...item,
            ...(removed.has(item.id) ? { pending: "remove" as const } : {}),
          })),
          ...pending,
        ]}
        dirty={dirty}
        pendingPublication={pendingPublication}
        error={error}
      onAddFiles={(files) => {
        try {
          if (pending.length + files.length > 20)
            throw new Error("每次最多添加 20 张图片，请先保存后再继续添加");
          assertChatAttachmentSizes(files);
            if (
              files.some(
                (file) =>
                  !KNOWLEDGE_IMAGE_MIME_TYPES.includes(
                    normalizedKnowledgeBaseUploadMimeType(file),
                  ),
              )
            )
              throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片");
            setPending((current) => [
              ...current,
              ...files.map((file) => {
                const url = URL.createObjectURL(file);
                urls.current.add(url);
                return {
                  id: crypto.randomUUID(),
                  url,
                  caption: file.name,
                  nodes: [],
                  removable: true,
                  pending: "add" as const,
                };
              }),
            ]);
            setError(null);
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "图片无法读取",
            );
          }
        }}
        onRemove={(id) => {
          const addition = pending.find((item) => item.id === id);
          if (addition) {
            URL.revokeObjectURL(addition.url);
            urls.current.delete(addition.url);
            setPending((current) => current.filter((item) => item.id !== id));
          } else
            setRemoved((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
        }}
        onSave={() => {
          setSaved([
            ...saved.filter((item) => !removed.has(item.id)),
            ...pending.map(({ pending: _pending, ...item }) => ({
              ...item,
              pendingPublication: true,
            })),
          ]);
          setPending([]);
          setRemoved(new Set());
          setPendingPublication(true);
        }}
        onDiscard={discard}
      />
    </>
  );
}

async function imageRequest<T>(
  rest: WorkspaceRestOperation,
  path: string,
  body?: unknown,
): Promise<T> {
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
      new Error(result.error?.message ?? "图片库状态已变化，请重新读取"),
      {
        status: response.status,
        code: result.error?.code,
        observation: result.observation,
      },
    );
  return result as T;
}

function KnowledgeImageLibraryInner({
  conversationId,
  generation,
  resetRevision,
  projectId,
  disabled = false,
  onBusyChange,
  onDirtyChange,
  onImagesSaved,
}: Props) {
  const utils = trpc.useUtils();
  const { commitKnowledgeBaseObservation, refreshConversations } =
    useConversation();
  const lifetime = useRef(new AbortController());
  const scope = useRef<WorkspaceRestOperation | null>(null);
  const callbacks = useRef({ onBusyChange, onDirtyChange, onImagesSaved });
  callbacks.current = { onBusyChange, onDirtyChange, onImagesSaved };
  const button = useRef<HTMLButtonElement>(null);
  const previews = useRef(new Set<string>());
  const attempt = useRef<SaveAttempt | null>(null);
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<KnowledgeImageLibraryData | null>(
    null,
  );
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = pending.length > 0 || removed.size > 0;
  useEffect(() => {
    if (lifetime.current.signal.aborted)
      lifetime.current = new AbortController();
    const mounted = lifetime.current;
    return () => {
      mounted.abort();
      for (const url of previews.current) URL.revokeObjectURL(url);
      previews.current.clear();
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onDirtyChange?.(false);
    };
  }, []);
  useEffect(() => {
    callbacks.current.onDirtyChange?.(dirty);
  }, [dirty]);
  const setPendingState = (value: boolean) => {
    lock.current = value;
    setBusy(value);
    callbacks.current.onBusyChange?.(value);
  };
  const clearChanges = () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
    setPending([]);
    setRemoved(new Set());
    attempt.current = null;
    setStarted(false);
    setProgress(null);
  };
  const readLibrary = async (rest: WorkspaceRestOperation, id: string) => {
    const result = await imageRequest<KnowledgeImageLibraryData>(
      rest,
      `/api/knowledge-base/images?${new URLSearchParams({ conversationId: id })}`,
    );
    rest.assertActive();
    if (
      result.coordinates.conversationId !== id ||
      (generation !== undefined &&
        result.coordinates.expectedGeneration !== generation) ||
      (resetRevision !== undefined &&
        result.coordinates.expectedResetRevision !== resetRevision)
    )
      throw new Error("知识库已重置或切换，请重新打开图片库");
    return result;
  };
  const load = async () => {
    if (lock.current) return;
    setPendingState(true);
    setOpen(true);
    setLoading(true);
    setError(null);
    const rest = captureWorkspaceRestOperation(
      lifetime.current.signal,
      projectId ? { enterpriseProjectId: projectId } : undefined,
    );
    scope.current = rest;
    try {
      let id = conversationId ?? library?.coordinates.conversationId;
      if (!id) {
        const result = await utils.workspace.knowledgeProgress.fetch(undefined);
        rest.assertActive();
        id = result.progress?.build.conversationId;
      }
      if (!id) throw new Error("当前知识库尚未建立，请先完成创建");
      const result = await readLibrary(rest, id);
      setLibrary(result);
    } catch (failure) {
      if (!rest.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "图片库读取失败，请重试",
        );
    } finally {
      if (!rest.signal.aborted) {
        setLoading(false);
        setPendingState(false);
      }
    }
  };
  const addFiles = (files: File[]) => {
    if (
      lock.current ||
      started ||
      !library?.canManage ||
      disabled ||
      !files.length
    )
      return;
    try {
      if (pending.length + files.length > 20)
        throw new Error("每次最多添加 20 张图片，请先保存后再继续添加");
      assertChatAttachmentSizes([
        ...pending.map((item) => item.file),
        ...files,
      ]);
      if (
        files.some(
          (file) =>
            !KNOWLEDGE_IMAGE_MIME_TYPES.includes(
              normalizedKnowledgeBaseUploadMimeType(file),
            ),
        )
      )
        throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片");
      setPending((current) => [
        ...current,
        ...files.map((file) => {
          const previewUrl = URL.createObjectURL(file);
          previews.current.add(previewUrl);
          return { id: crypto.randomUUID(), file, previewUrl };
        }),
      ]);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "图片无法读取");
    }
  };
  const remove = (id: string) => {
    if (lock.current || started || !library?.canManage || disabled) return;
    const draft = pending.find((item) => item.id === id);
    if (draft) {
      URL.revokeObjectURL(draft.previewUrl);
      previews.current.delete(draft.previewUrl);
      setPending((current) => current.filter((item) => item.id !== id));
    } else if (
      library.images.some((item) => item.assetId === id && item.removable)
    ) {
      setRemoved((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };
  const save = async (): Promise<boolean> => {
    if (
      lock.current ||
      !library ||
      !scope.current ||
      (!attempt.current && (disabled || !library.canManage))
    )
      return false;
    if (!dirty) return true;
    const rest = captureWorkspaceRestOperation(scope.current.signal);
    if (rest.signal.aborted) return false;
    setPendingState(true);
    setError(null);
    try {
      if (!attempt.current) {
        attempt.current = {
          clientRequestId: crypto.randomUUID(),
          library,
          files: [...pending],
          removeAssetIds: [...removed],
          receipts: new Map(),
          sent: false,
          definiteRejection: false,
        };
        setStarted(true);
      }
      const current = attempt.current;
      for (const [index, item] of current.files.entries()) {
        if (current.receipts.has(item.id)) continue;
        const receipt = await uploadKnowledgeBaseLocalAsset(
          item.file,
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
        current.receipts.set(item.id, {
          fileId: receipt.fileId,
          filename: receipt.filename,
        });
      }
      setProgress("正在保存图片修改…");
      current.sent = true;
      current.definiteRejection = false;
      const result = await imageRequest<{
        accepted: true;
        observation?: KnowledgeBaseObservationDto;
        library?: KnowledgeImageLibraryData;
      }>(rest, "/api/knowledge-base/images/save", {
        ...current.library.coordinates,
        clientRequestId: current.clientRequestId,
        attachments: current.files.map(
          (item) => current.receipts.get(item.id)!,
        ),
        removeAssetIds: current.removeAssetIds,
      });
      rest.assertActive();
      if (!result.accepted)
        throw new Error("尚未收到图片保存结果，请重试同一次保存");
      if (
        result.observation &&
        result.observation.generation !==
          current.library.coordinates.expectedGeneration
      )
        throw new Error("知识库版本已变化，请重新打开图片库");
      if (result.observation)
        commitKnowledgeBaseObservation(
          current.library.coordinates.conversationId,
          result.observation,
        );
      const savedConversationId = current.library.coordinates.conversationId;
      clearChanges();
      setLibrary(result.library ?? null);
      window.dispatchEvent(
        new CustomEvent("frontmind:knowledge-progress-updated"),
      );
      await Promise.allSettled([
        refreshConversations(),
        Promise.resolve().then(() => callbacks.current.onImagesSaved?.()),
      ]);
      rest.assertActive();
      if (!result.library) {
        try {
          setLibrary(await readLibrary(rest, savedConversationId));
        } catch (failure) {
          rest.assertActive();
          setError(
            `图片修改已保存，更新知识库后会同步到 ZIP。图片列表暂未刷新：${failure instanceof Error ? failure.message : "请重新读取"}`,
          );
        }
      }
      return true;
    } catch (failure) {
      if (!rest.signal.aborted) {
        const detail = failure as {
          status?: number;
          code?: string;
          observation?: KnowledgeBaseObservationDto;
        };
        if (
          attempt.current &&
          [400, 401, 403, 404, 409, 410, 422].includes(detail.status ?? 0) &&
          !/IDEMPOTENCY_PENDING|OUTCOME_UNKNOWN/.test(detail.code ?? "")
        )
          attempt.current.definiteRejection = true;
        if (
          detail.observation?.generation ===
          library.coordinates.expectedGeneration
        )
          commitKnowledgeBaseObservation(
            library.coordinates.conversationId,
            detail.observation,
          );
        setError(
          `${failure instanceof Error ? failure.message : "图片保存失败"}。所选图片已保留，可重试同一次保存。`,
        );
        setProgress(null);
      }
      return false;
    } finally {
      if (!rest.signal.aborted) setPendingState(false);
    }
  };
  const discard = async () => {
    if (
      lock.current ||
      (attempt.current?.sent && !attempt.current.definiteRejection)
    )
      return false;
    clearChanges();
    setError(null);
    setOpen(false);
    setLibrary(null);
    scope.current = null;
    return true;
  };
  useWorkspaceDraftGuard({ dirty, label: "知识库图片库", save, discard });
  return (
    <>
      <Button
        ref={button}
        variant="operatorOutline"
        disabled={disabled || busy}
        onClick={() => void load()}
      >
        <ImageIcon className="h-4 w-4" />
        查看图片库
      </Button>
      <KnowledgeImageLibraryDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setLibrary(null);
          scope.current = null;
        }}
        items={[
          ...(library?.images ?? []).map((item) => ({
            id: item.assetId,
            url: item.url,
            caption: item.caption || item.filename || "知识库图片",
            nodes: item.nodes,
            removable: item.removable,
            pendingPublication: item.pendingPublication,
            ...(removed.has(item.assetId)
              ? { pending: "remove" as const }
              : {}),
          })),
          ...pending.map((item) => ({
            id: item.id,
            url: item.previewUrl,
            caption: item.file.name,
            nodes: [],
            removable: true,
            pending: "add" as const,
          })),
        ]}
        loading={loading}
        busy={busy}
        dirty={dirty}
        controlsDisabled={disabled || started || !library?.canManage}
        saveDisabled={!started && (disabled || !library?.canManage)}
        discardDisabled={Boolean(
          attempt.current?.sent && !attempt.current.definiteRejection,
        )}
        pendingPublication={library?.pendingPublication}
        reason={library?.reason}
        progress={progress}
        error={error}
        saveLabel={started ? "重试保存" : "保存图片"}
        onAddFiles={addFiles}
        onRemove={remove}
        onSave={() => void save()}
        onDiscard={discard}
        onReload={() => void load()}
        onCloseAutoFocus={(event) => {
          if (button.current && !button.current.disabled) {
            event.preventDefault();
            button.current.focus();
          }
        }}
      />
    </>
  );
}
