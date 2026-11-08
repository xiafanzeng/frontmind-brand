/** Decimal MB follows the upstream documented 500 MB file boundary. */
export const ZHIPU_KNOWLEDGE_DOCUMENT_MAX_BYTES = 500_000_000;
export const KIMI_KNOWLEDGE_DOCUMENT_MAX_BYTES = 100 * 1024 ** 2;
export const KNOWLEDGE_ORDINARY_UPLOAD_MAX_BYTES = 100 * 1024 ** 2;
export function isKnowledgeBaseInitialDocument(filename: string, mimeType: string) {
  return (/\.pdf$/i.test(filename) && mimeType === "application/pdf") ||
    (/\.zip$/i.test(filename) && ["application/zip", "application/x-zip-compressed"].includes(mimeType));
}
export function knowledgeBaseDocumentMaxBytes(filename: string, mimeType: string, provider: "zhipu" | "kimi" = "zhipu") {
  if (provider === "kimi") return KIMI_KNOWLEDGE_DOCUMENT_MAX_BYTES;
  return isKnowledgeBaseInitialDocument(filename, mimeType) ? ZHIPU_KNOWLEDGE_DOCUMENT_MAX_BYTES : KNOWLEDGE_ORDINARY_UPLOAD_MAX_BYTES;
}
