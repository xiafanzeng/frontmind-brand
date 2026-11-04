import { useEffect, useState } from "react";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { projectResourceUrl } from "../host";
type OriginalFile = { fileId: string; filename: string; url: string; expiresAt?: number; expired?: boolean };
export default function KnowledgeOriginalDownloads({ buildId, generation }: { buildId: string; generation: number }) {
  const [files, setFiles] = useState<OriginalFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(), rest = captureWorkspaceRestOperation(abort.signal);
    setFiles([]); setError(null);
    void rest.fetch(`/api/knowledge-base/originals/${encodeURIComponent(buildId)}?generation=${generation}`, {
      credentials: "include", headers: rest.headers(), signal: rest.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("原始资料列表暂不可读取");
      const data = await response.json(); rest.assertActive();
      if (Array.isArray(data.files)) setFiles(data.files.filter((file: any) => typeof file.filename === "string" && typeof file.fileId === "string" &&
        typeof file.url === "string" && file.url.startsWith(`/api/knowledge-base/originals/${buildId}/`)));
    }).catch(() => { if (!rest.signal.aborted) setError("原始资料列表暂不可读取"); });
    return () => abort.abort();
  }, [buildId, generation, retry]);
  if (error) return <div role="status" className="text-sm">{error} <button type="button" className="text-primary underline" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!files.length) return null;
  return <details className="text-sm"><summary className="cursor-pointer">下载原始资料（{files.length}）</summary>
    <ul className="mt-2 space-y-2">{files.map(file => <li key={file.fileId}>{file.expired
      ? <span className="text-muted-foreground break-all">{file.filename} · 文件已超过 30 天，请重新上传</span>
      : <a className="text-primary underline break-all" href={projectResourceUrl(file.url)} download>{file.filename}</a>}</li>)}</ul>
  </details>;
}
