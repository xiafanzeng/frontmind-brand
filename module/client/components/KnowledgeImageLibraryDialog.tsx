import { useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Expand,
  ImageIcon,
  Loader2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@frontmind/module-ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontmind/module-ui/components/ui/dialog";
import "./KnowledgeImageLibrary.css";

export const KNOWLEDGE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];

export type KnowledgeLibraryImage = {
  id: string;
  url: string;
  caption: string;
  nodes: Array<{ leafId: string; title: string }>;
  removable: boolean;
  pending?: "add" | "remove";
  pendingPublication?: boolean;
};

const theme = {
  "--module-accent": "#16794f",
  "--module-color": "#16794f",
} as CSSProperties;

export default function KnowledgeImageLibraryDialog({
  open,
  onClose,
  title = "知识库图片库",
  description = "查看知识库全部图片。在此上传的图片不关联节点；保存后更新知识库，下载的 ZIP 会包含这些修改。",
  uploadLabel = "上传知识库图片",
  items,
  loading = false,
  busy = false,
  dirty = false,
  controlsDisabled = false,
  saveDisabled = false,
  discardDisabled = false,
  pendingPublication = false,
  reason,
  progress,
  error,
  saveLabel = "保存图片",
  removeLabel = "移除图片",
  onAddFiles,
  onRemove,
  onSave,
  onDiscard,
  onReload,
  onCloseAutoFocus,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  uploadLabel?: string;
  items: KnowledgeLibraryImage[];
  loading?: boolean;
  busy?: boolean;
  dirty?: boolean;
  controlsDisabled?: boolean;
  saveDisabled?: boolean;
  discardDisabled?: boolean;
  pendingPublication?: boolean;
  reason?: string | null;
  progress?: string | null;
  error?: string | null;
  saveLabel?: string;
  removeLabel?: string;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = items.find((item) => item.id === previewId);
  const added = items.filter((item) => item.pending === "add").length;
  const removed = items.filter((item) => item.pending === "remove").length;
  const close = () => {
    if (busy || dirty) return;
    setPreviewId(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="knowledge-image-library-dialog"
        style={theme}
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (busy || dirty) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy || dirty) event.preventDefault();
        }}
      >
        <DialogHeader className="knowledge-image-library-header">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭图片库"
            disabled={busy || dirty}
            onClick={close}
          >
            <X />
          </Button>
        </DialogHeader>
        <div className="knowledge-image-library-body">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={KNOWLEDGE_IMAGE_MIME_TYPES.join(",")}
            className="sr-only"
            aria-label={uploadLabel}
            disabled={controlsDisabled || loading || busy}
            onChange={(event) => {
              onAddFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <div className="knowledge-image-library-toolbar">
            <p>
              共 {items.length - added} 张{added ? ` · 新增 ${added} 张` : ""}
              {removed ? ` · 移除 ${removed} 张` : ""}
            </p>
            <Button
              variant="operatorOutline"
              disabled={controlsDisabled || loading || busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-4 w-4" />
              上传图片
            </Button>
          </div>
          {(pendingPublication || dirty) && (
            <p className="knowledge-image-library-notice" role="status">
              {dirty
                ? "图片修改尚未保存。保存后还需更新知识库，正式图片与 ZIP 才会更新。"
                : "图片有待更新的修改。更新知识库后，正式图片与 ZIP 会一起更新。"}
            </p>
          )}
          {reason && <p className="knowledge-image-library-note">{reason}</p>}
          {loading ? (
            <p className="knowledge-image-library-empty" role="status">
              <Loader2 className="animate-spin" />
              正在读取图片库…
            </p>
          ) : preview ? (
            <section
              className="knowledge-image-library-preview"
              aria-label="图片预览"
            >
              <Button variant="ghost" onClick={() => setPreviewId(null)}>
                <ArrowLeft className="h-4 w-4" />
                返回图片列表
              </Button>
              <img src={preview.url} alt={preview.caption} />
              <p>{preview.caption}</p>
              <NodeLabels nodes={preview.nodes} />
            </section>
          ) : items.length ? (
            <div className="knowledge-image-library-grid">
              {items.map((item) => (
                <figure
                  key={item.id}
                  className={`knowledge-image-library-card${item.pending ? ` is-${item.pending}` : ""}`}
                >
                  <button
                    type="button"
                    className="knowledge-image-library-thumbnail"
                    aria-label={`预览 ${item.caption}`}
                    onClick={() => setPreviewId(item.id)}
                  >
                    <img src={item.url} alt={item.caption} />
                    <Expand className="h-4 w-4" />
                  </button>
                  <figcaption>{item.caption}</figcaption>
                  <NodeLabels nodes={item.nodes} />
                  {(item.pending || item.pendingPublication) && (
                    <span className="knowledge-image-library-state">
                      {item.pending === "add"
                        ? "待新增"
                        : item.pending === "remove"
                          ? "待移除"
                          : "待更新知识库"}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={controlsDisabled || busy || !item.removable}
                    title={
                      !item.removable
                        ? "此图片由知识库统一维护，暂不可单独移除"
                        : undefined
                    }
                    aria-label={`${item.pending === "remove" ? "撤销移除" : removeLabel === "移除图片" ? "移除" : removeLabel} ${item.caption}`}
                    onClick={() => onRemove(item.id)}
                  >
                    {item.pending === "remove" ? (
                      <Undo2 className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    {item.pending === "remove" ? "撤销移除" : removeLabel}
                  </Button>
                </figure>
              ))}
            </div>
          ) : (
            <div className="knowledge-image-library-empty">
              <ImageIcon />
              <p>暂无图片，点击“上传图片”添加。</p>
            </div>
          )}
          {progress && (
            <p role="status" className="knowledge-image-library-progress">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress}
            </p>
          )}
          {error && (
            <div role="alert" className="knowledge-image-library-error">
              <p>{error}</p>
              {onReload && !dirty && !busy && (
                <Button variant="operatorOutline" onClick={onReload}>
                  重新读取图片库
                </Button>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="knowledge-image-library-footer">
          <Button
            variant="operatorOutline"
            disabled={busy || discardDisabled}
            onClick={() => {
              setPreviewId(null);
              onDiscard();
            }}
          >
            {dirty ? "放弃修改" : "关闭"}
          </Button>
          <Button
            variant="operator"
            disabled={busy || loading || !dirty || saveDisabled}
            onClick={onSave}
          >
            {loading ? "正在读取…" : busy ? "正在保存…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NodeLabels({ nodes }: { nodes: KnowledgeLibraryImage["nodes"] }) {
  return (
    <div className="knowledge-image-library-nodes">
      {nodes.length ? (
        nodes.map((node) => (
          <span key={node.leafId} title={`${node.leafId} ${node.title}`}>
            关联节点：{node.leafId}
            {node.title && node.title !== node.leafId ? ` ${node.title}` : ""}
          </span>
        ))
      ) : (
        <span className="is-unlinked">未关联节点</span>
      )}
    </div>
  );
}
