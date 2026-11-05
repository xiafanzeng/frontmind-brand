import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import "./website-revision-tools.css";

export type WebsiteRevisionFieldsProps = {
  text: string;
  files: File[];
  progress: number[];
  disabled?: boolean;
  onChange: (text: string, files: File[]) => void;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MIB = 1024 * 1024;

/** Controlled fields share the design step's single save/rebuild action. */
export function WebsiteRevisionFields({
  text, files, progress, disabled = false, onChange,
}: WebsiteRevisionFieldsProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
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
    if (next.length > 8) failure = "一次最多添加 8 张图片。";
    else if (next.some((file) => !IMAGE_TYPES.has(file.type))) failure = "仅支持 PNG、JPEG 或 WebP 图片。";
    else if (next.some((file) => file.size < 1 || file.size > 8 * MIB)) failure = "每张图片须大于 0 字节且不超过 8 MiB。";
    else if (next.reduce((total, file) => total + file.size, 0) > 32 * MIB) failure = "本次图片总大小不能超过 32 MiB。";
    setError(failure);
    if (!failure) onChange(text, next);
  }

  return (
    <section className="sfp-design-section sfp-revision-fields" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>补充修改要求</h3>
      <p className="sfp-revision-hint">描述希望调整的内容，也可添加参考图片；与网站设计一起提交生成。</p>
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
          accept="image/png,image/jpeg,image/webp"
          aria-label="添加修改参考图片"
          disabled={disabled}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button type="button" className="sfp-revision-add" disabled={disabled} onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} aria-hidden="true" /> 添加参考图片
        </button>
        <p id={`${id}-limits`}>支持粘贴或拖入；最多 8 张，每张 8 MiB，总计 32 MiB。</p>
      </div>
      {error && <p role="alert" className="sfp-revision-error">{error}</p>}
      {files.length > 0 && (
        <ul className="sfp-revision-files" aria-label="修改参考图片">
          {files.map((file, index) => (
            <li key={`${file.name}:${file.lastModified}:${file.size}:${index}`}>
              {previews[index] && <img src={previews[index]} alt={`参考图片 ${index + 1}：${file.name}`} />}
              <div className="sfp-revision-file-info">
                <span title={file.name}>{file.name}</span>
                <small>{(file.size / MIB).toFixed(2)} MiB</small>
                {typeof progress[index] === "number" && (
                  <progress aria-label={`${file.name} 上传进度`} max={100} value={Math.max(0, Math.min(100, progress[index]))} />
                )}
              </div>
              <button
                type="button"
                aria-label={`移除参考图片 ${file.name}`}
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
