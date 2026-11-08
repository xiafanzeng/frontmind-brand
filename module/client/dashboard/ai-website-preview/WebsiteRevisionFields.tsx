import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImagePlus, X } from "lucide-react";
import {
  SITEOPS_REVISION_DOCUMENT_MAX_BYTES,
  SITEOPS_REVISION_DOCUMENT_MIME_TYPES,
  SITEOPS_REVISION_IMAGE_MAX_BYTES,
  SITEOPS_REVISION_IMAGE_MIME_TYPES,
  siteOpsRevisionInputDescriptor,
} from "../../../contracts/siteops-revision-input.js";
import "./website-revision-tools.css";

export type WebsiteRevisionFieldsProps = {
  text: string;
  files: File[];
  progress: number[];
  disabled?: boolean;
  onChange: (text: string, files: File[]) => void;
};

const IMAGE_TYPES = new Set<string>(SITEOPS_REVISION_IMAGE_MIME_TYPES);
const DOCUMENT_TYPES = new Set<string>(SITEOPS_REVISION_DOCUMENT_MIME_TYPES);
const ACCEPT_ATTRIBUTE = [
  ...IMAGE_TYPES,
  ...DOCUMENT_TYPES,
  ".pdf",
  ".docx",
  ".txt",
  ".md",
].join(",");
const MIB = 1024 * 1024;
const TOTAL_MAX_BYTES = 32 * MIB;

function isImage(file: File) {
  return siteOpsRevisionInputDescriptor(file.name, file.type)?.kind === "image";
}

/** Controlled fields share the design step's single save/rebuild action. */
export function WebsiteRevisionFields({
  text, files, progress, disabled = false, onChange,
}: WebsiteRevisionFieldsProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") {
      setPreviews(files.map(() => null));
      return;
    }
    const urls = files.map((file) =>
      isImage(file) ? URL.createObjectURL(file) : null);
    setPreviews(urls);
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [files]);

  function addFiles(additions: File[]) {
    if (disabled || additions.length === 0) return;
    const next = [...files];
    for (const file of additions) {
      if (!next.some((current) => current.name === file.name
        && current.size === file.size && current.type === file.type
        && current.lastModified === file.lastModified)) next.push(file);
    }
    let failure: string | null = null;
    if (next.length > 8) failure = "一次最多添加 8 个附件。";
    else if (next.some((file) => !siteOpsRevisionInputDescriptor(file.name, file.type))) {
      failure = "仅支持 PNG、JPEG、WebP 图片，或 PDF、DOCX、TXT、Markdown 文档。";
    } else if (next.some((file) => isImage(file)
      ? file.size < 1 || file.size > SITEOPS_REVISION_IMAGE_MAX_BYTES
      : file.size < 1 || file.size > SITEOPS_REVISION_DOCUMENT_MAX_BYTES)) {
      failure = "单张图片不超过 8 MiB，单个文档不超过 10 MiB。";
    } else if (next.reduce((total, file) => total + file.size, 0) > TOTAL_MAX_BYTES) {
      failure = "本次附件总大小不能超过 32 MiB。";
    }
    setError(failure);
    if (!failure) onChange(text, next);
  }

  return (
    <section className="sfp-design-section sfp-revision-fields" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>补充修改要求</h3>
      <textarea
        id={`${id}-text`}
        aria-label="补充修改要求"
        aria-describedby={`${id}-limits`}
        value={text}
        maxLength={20_000}
        rows={4}
        disabled={disabled}
        placeholder="例如：简化首页介绍，将预约入口放在更显眼的位置。"
        onChange={(event) => {
          if (!disabled) onChange(event.target.value.slice(0, 20_000), files);
        }}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files);
          if (!pasted.length) return;
          event.preventDefault();
          addFiles(pasted);
        }}
      />
      <div className="sfp-revision-meta"><span>{text.length.toLocaleString()} / 20,000</span></div>
      <div
        className="sfp-revision-drop"
        onDragOver={(event) => { event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}
      >
        <input
          ref={fileInput}
          className="sfp-revision-file-input"
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label="添加修改参考图片或文档"
          disabled={disabled}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button type="button" className="sfp-revision-add" disabled={disabled} onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} aria-hidden="true" /> 添加图片或文档
        </button>
        <p id={`${id}-limits`}>可粘贴或拖入；最多 8 个，图片 ≤ 8 MiB、文档 ≤ 10 MiB、总计 ≤ 32 MiB。文档内容会作为建站资料，原件放入网站供下载。</p>
      </div>
      {error && <p role="alert" className="sfp-revision-error">{error}</p>}
      {files.length > 0 && (
        <ul className="sfp-revision-files" aria-label="修改参考附件">
          {files.map((file, index) => (
            <li key={`${file.name}:${file.lastModified}:${file.size}:${index}`}>
              {previews[index]
                ? <img src={previews[index]!} alt={`参考图片 ${index + 1}：${file.name}`} />
                : <span className="sfp-revision-doc-icon" aria-hidden="true"><FileText size={28} /></span>}
              <div className="sfp-revision-file-info">
                <span title={file.name}>{file.name}</span>
                <small>{(file.size / MIB).toFixed(2)} MiB</small>
                {typeof progress[index] === "number" && (
                  <progress aria-label={`${file.name} 上传进度`} max={100} value={Math.max(0, Math.min(100, progress[index]))} />
                )}
              </div>
              <button
                type="button"
                aria-label={`移除参考附件 ${file.name}`}
                disabled={disabled}
                onClick={() => {
                  setError(null);
                  onChange(text, files.filter((_, fileIndex) => fileIndex !== index));
                }}
              ><X size={15} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
