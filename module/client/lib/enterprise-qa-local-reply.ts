import { enterpriseQaLocalReplyMetadataSchema } from "@frontmind/module-contracts/enterprise-qa-experience";
import type { EnterpriseQaLocalReply } from "@frontmind/module-contracts/enterprise-qa-experience";
import { z } from "zod";

/**
 * The Core contract is authoritative and may be newer than the immutable
 * Module vendor snapshot during a paired rollout. Extend the compatible v1
 * marker locally so the browser never strips a greeting's frozen knowledge
 * identity while still accepting older markers that predate the field.
 */
export const enterpriseQaKnowledgeReferenceSchema = z.object({
  snapshotId: z.string().min(1).max(128),
  version: z.number().int().nonnegative(),
  sourceFileName: z.string().min(1).max(512),
  documentCount: z.number().int().nonnegative(),
  companyName: z.string().min(1).max(255).optional(),
});

export const enterpriseQaLocalReplyWithKnowledgeSchema =
  enterpriseQaLocalReplyMetadataSchema
    .extend({ knowledgeBase: enterpriseQaKnowledgeReferenceSchema.optional() })
    .passthrough();

export type EnterpriseQaKnowledgeReference = z.infer<
  typeof enterpriseQaKnowledgeReferenceSchema
>;
export type EnterpriseQaLocalReplyMetadataWithKnowledge = z.infer<
  typeof enterpriseQaLocalReplyWithKnowledgeSchema
>;
export type EnterpriseQaLocalReplyWithKnowledge = Omit<
  EnterpriseQaLocalReply,
  "enterpriseQaLocalReply"
> & {
  enterpriseQaLocalReply: EnterpriseQaLocalReplyMetadataWithKnowledge;
};
