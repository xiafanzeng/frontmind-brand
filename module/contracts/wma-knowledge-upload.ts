import { z } from "zod";

export const WMA_KNOWLEDGE_MAX_FILE_BYTES = 1024 ** 3;
// Existing workbench exports use ZIP32; leave room for the generated work package.
export const WMA_KNOWLEDGE_MAX_BATCH_BYTES = 3 * 1024 ** 3;
export const WMA_KNOWLEDGE_PART_BYTES = 16 * 1024 ** 2;
export function isWmaKnowledgeDocument(filename: string, mimeType: string) {
  return (/\.pdf$/i.test(filename) && mimeType === "application/pdf") ||
    (/\.zip$/i.test(filename) && ["application/zip", "application/x-zip-compressed"].includes(mimeType));
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const wmaKnowledgeCosSourceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("wma_cos_input"),
  accountUserId: z.number().int().positive(), enterpriseProjectId: z.string().uuid(),
  taskId: z.string().uuid(), buildId: z.string().uuid(), generation: z.number().int().nonnegative(), turnId: z.string().uuid(),
  credentialId: z.string().regex(/^wma-[a-f0-9]{32}$/), credentialVersion: z.number().int().positive(),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}-[0-9]{5,20}$/), region: z.string().regex(/^ap-[a-z]+(?:-[a-z]+)?$/),
  key: z.string().min(1).max(1024).refine(v => !v.startsWith("/") && !v.includes("..") && !v.includes("\\")),
  fileId: z.string().uuid(), bytes: z.number().int().positive().max(WMA_KNOWLEDGE_MAX_FILE_BYTES),
  sha256: sha, mimeType: z.enum(["application/pdf", "application/zip", "application/x-zip-compressed"]),
  verifiedAt: z.number().int().positive(),
}).strict();
export type WmaKnowledgeCosSource = z.infer<typeof wmaKnowledgeCosSourceSchema>;
export function matchesWmaKnowledgeCosSource(value: unknown, expected: {
  accountUserId: number; buildId: string; generation: number; turnId?: string; taskId?: string;
  fileId?: string; sizeBytes: number; contentSha256: string; mimeType: string;
}) {
  const parsed = wmaKnowledgeCosSourceSchema.safeParse(value);
  if (!parsed.success) return false;
  const s = parsed.data;
  return s.accountUserId === expected.accountUserId && s.buildId === expected.buildId && s.generation === expected.generation &&
    (!expected.turnId || s.turnId === expected.turnId) && (!expected.taskId || s.taskId === expected.taskId) &&
    (!expected.fileId || s.fileId === expected.fileId) && s.bytes === expected.sizeBytes && s.sha256 === expected.contentSha256 && s.mimeType === expected.mimeType &&
    s.key.endsWith(`/${s.accountUserId}/${s.enterpriseProjectId}/${s.taskId}/input/${s.fileId}`);
}
