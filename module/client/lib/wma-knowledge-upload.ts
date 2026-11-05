import { createSHA256, md5 } from "hash-wasm";
import { captureWorkspaceRestOperation } from "./workspace-rest-scope";
import type { KnowledgeBaseTurnAttachmentCoordinate, UploadRetentionReceipt, FileUploadStageEvent } from "./frontmind-api";
import { isWmaKnowledgeDocument, WMA_KNOWLEDGE_MAX_FILE_BYTES, WMA_KNOWLEDGE_PART_BYTES } from "../../contracts/wma-knowledge-upload";

export async function wmaKnowledgeUploadCapability(coordinate?: KnowledgeBaseTurnAttachmentCoordinate, signal?: AbortSignal) {
  const rest = captureWorkspaceRestOperation(signal);
  const response = await rest.fetch(coordinate ? "/api/knowledge-base/wma-upload/capability" : "/api/knowledge-base/upload-capabilities", {
    method: coordinate ? "POST" : "GET", headers: rest.headers({ "Content-Type": "application/json" }), credentials: "include",
    ...(coordinate ? { body: JSON.stringify(coordinate) } : {}), signal: rest.signal,
  });
  rest.assertActive();
  if (!response.ok) return false;
  const payload = await response.json(); rest.assertActive();
  return payload.wmaInitial === true && payload.maxFileBytes === WMA_KNOWLEDGE_MAX_FILE_BYTES;
}

/** Two bounded passes (whole-file SHA then per-part MD5); never arrayBuffer() on
 * the entire file. File objects and progress remain owned by the original batch. */
export async function sha256WmaKnowledgeFile(file: Blob, signal?: AbortSignal, progress?: (bytes: number) => void) {
  const digest = await createSHA256(); digest.init();
  for (let offset = 0; offset < file.size; offset += WMA_KNOWLEDGE_PART_BYTES) {
    signal?.throwIfAborted();
    digest.update(new Uint8Array(await file.slice(offset, offset + WMA_KNOWLEDGE_PART_BYTES).arrayBuffer()));
    progress?.(Math.min(file.size, offset + WMA_KNOWLEDGE_PART_BYTES));
  }
  signal?.throwIfAborted(); return digest.digest("hex");
}
function putPart(channel: { url: string; headers: Record<string, string> }, bytes: Uint8Array, signal: AbortSignal, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted(); const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const end = (error?: Error) => { signal.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
    xhr.open("PUT", channel.url); xhr.timeout = 180_000;
    // Send only the fixed COS capability headers. Account cookies and project headers never cross origins.
    for (const [name, value] of Object.entries(channel.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => progress(event.loaded);
    xhr.onload = () => end(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("分片上传未确认"));
    xhr.onerror = () => end(new Error("分片上传连接中断")); xhr.ontimeout = () => end(new Error("分片上传超时"));
    xhr.onabort = () => end(new DOMException("上传已停止", "AbortError"));
    signal.addEventListener("abort", abort, { once: true }); xhr.send(bytes as XMLHttpRequestBodyInit);
  });
}
export async function uploadWmaKnowledgeDocument(file: File, input: {
  coordinate: KnowledgeBaseTurnAttachmentCoordinate; itemId: string; ordinal: number; filename: string; mimeType: string;
  signal: AbortSignal; onProgress?: (percent: number) => void; onStage?: (event: FileUploadStageEvent) => void;
}): Promise<UploadRetentionReceipt & { filename: string; alreadyStaged: true }> {
  if (!isWmaKnowledgeDocument(input.filename, input.mimeType) || file.size < 1 || file.size > WMA_KNOWLEDGE_MAX_FILE_BYTES)
    throw new Error("WMA 初始资料仅支持不超过 1 GiB 的 PDF 或 ZIP");
  const rest = captureWorkspaceRestOperation(input.signal);
  input.onStage?.({ stage: "server_processing", loadedBytes: 0, totalBytes: file.size });
  const contentSha256 = await sha256WmaKnowledgeFile(file, rest.signal);
  const identity = { ...input.coordinate, itemId: input.itemId, ordinal: input.ordinal, contentSha256 };
  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await rest.fetch(`/api/knowledge-base/wma-upload/${action}`, { method: "POST", credentials: "include",
      headers: rest.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ ...identity, ...extra }), signal: rest.signal });
    const payload = await response.json(); rest.assertActive();
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "资料上传未确认，请重试原文件"), { code: payload?.error?.code, retryable: true });
    return payload;
  };
  let status = await call("init");
  if (status.state !== "verified" && status.state !== "complete_intent") {
    const parts = new Map<number, { bytes: number; etag: string }>((status.parts ?? []).map((p: any) => [p.partNumber, p]));
    for (let offset = 0, partNumber = 1; offset < file.size; offset += WMA_KNOWLEDGE_PART_BYTES, partNumber++) {
      rest.assertActive();
      const bytes = new Uint8Array(await file.slice(offset, offset + WMA_KNOWLEDGE_PART_BYTES).arrayBuffer());
      const hex = await md5(bytes);
      const prior = parts.get(partNumber);
      if (prior && (prior.bytes !== bytes.length || prior.etag.replace(/^"|"$/g, "").toLowerCase() !== hex)) throw new Error("原上传分片与所选文件不一致");
      if (!prior) {
        const contentMd5 = btoa(String.fromCharCode(...hex.match(/../g)!.map(pair => parseInt(pair, 16))));
        for (let attempt = 0; ; attempt++) {
          const channel = await call("part", { partNumber, contentMd5 });
          try {
            await putPart(channel, bytes, rest.signal, loaded => {
              input.onProgress?.((offset + loaded) / file.size * 100);
              input.onStage?.({ stage: "uploading_to_cloud", loadedBytes: offset + loaded, totalBytes: file.size, attempt: attempt + 1 });
            }); break;
          } catch (error) {
            rest.signal.throwIfAborted(); if (attempt >= 1) throw error;
            // A lost PUT response is reconciled against the same UploadId before retry.
            status = await call("status");
            const accepted = (status.parts ?? []).find((p: any) => p.partNumber === partNumber);
            if (accepted) {
              if (accepted.bytes !== bytes.length || accepted.etag.replace(/^"|"$/g, "").toLowerCase() !== hex) throw new Error("分片校验不一致");
              break;
            }
          }
        }
      }
      input.onProgress?.(Math.min(file.size, offset + bytes.length) / file.size * 100);
    }
  }
  input.onStage?.({ stage: "server_processing", loadedBytes: file.size, totalBytes: file.size });
  return await call("finish");
}
