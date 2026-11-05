import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256WmaKnowledgeFile } from "./wma-knowledge-upload";
import { assertKnowledgeBaseInitialAttachmentSizes, assertChatAttachmentSizes } from "./attachment-files";
import { WMA_KNOWLEDGE_PART_BYTES } from "../../contracts/wma-knowledge-upload";

describe("WMA initial document limits and bounded browser hashing", () => {
  it("permits 1 GiB WMA PDF/ZIP only and preserves XTY/image limits", () => {
    const file = (name: string, type: string, size: number) => ({ name, type, size }) as File;
    expect(() => assertKnowledgeBaseInitialAttachmentSizes([file("input.zip", "application/zip", 1024 ** 3)], true)).not.toThrow();
    expect(() => assertKnowledgeBaseInitialAttachmentSizes([file("input.pdf", "application/pdf", 1024 ** 3 + 1)], true)).toThrow();
    expect(() => assertKnowledgeBaseInitialAttachmentSizes([file("input.png", "image/png", 101 * 1024 ** 2)], true)).toThrow();
    expect(() => assertKnowledgeBaseInitialAttachmentSizes([file("input.pdf", "application/pdf", 101 * 1024 ** 2)], false)).toThrow();
    expect(() => assertChatAttachmentSizes([file("input.zip", "application/zip", 101 * 1024 ** 2)])).toThrow();
    expect(() => assertKnowledgeBaseInitialAttachmentSizes(Array.from({ length: 4 }, () => file("input.pdf", "application/pdf", 1024 ** 3)), true)).toThrow("3 GiB");
  });
  it("hashes a 513 MiB logical file using at most one 16 MiB slice", async () => {
    const size = 513 * 1024 ** 2, expected = createHash("sha256"); let maxSlice = 0, reads = 0;
    const file = { size, arrayBuffer() { throw Error("whole-file buffering forbidden"); }, slice(start: number, end: number) {
      const count = Math.min(size, end) - start; maxSlice = Math.max(maxSlice, count); reads++;
      return { async arrayBuffer() { const bytes = new Uint8Array(count).fill(23); expected.update(bytes); return bytes.buffer; } };
    } } as unknown as Blob;
    expect(await sha256WmaKnowledgeFile(file)).toBe(expected.digest("hex"));
    expect(maxSlice).toBe(WMA_KNOWLEDGE_PART_BYTES); expect(reads).toBe(33);
  }, 20000);
  it("does not read a slice after stop", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sha256WmaKnowledgeFile({ size: 1024, slice() { throw Error("must not read"); } } as unknown as Blob, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
