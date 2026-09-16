import { createHash } from "node:crypto";
import path from "node:path";
import type { ConversationTurn } from "@frontmind/module-brand/contracts/core-records";

import { KNOWLEDGE_BASE_WORKING_SET_POLICY } from "./knowledge-base-working-set-policy.js";
import {
  prepareKnowledgeBaseInitialUploadImage,
  readVerifiedKnowledgeBaseCustomerUploadImageBytes,
  verifiedKnowledgeBaseInitialUploadImagesFromTurn,
} from "@frontmind/module-brand/server/knowledge-base-customer-upload";
import {
  canonicalWorkingSetArchive,
  validateKnowledgeBaseWorkingSetArchive,
  type KnowledgeBaseWorkingSetAsset,
  type ValidatedKnowledgeBaseWorkingSet,
} from "../contracts/knowledge-base-materialized-contract.js";

type InitialUploadTurn = Parameters<
  typeof verifiedKnowledgeBaseInitialUploadImagesFromTurn
>[0];
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

/** Only immutable attachment bindings are compared when activation takes its lock. */
export function knowledgeBaseInitialUploadLedgerFingerprint(
  turn: Pick<ConversationTurn, "attachmentFileIds" | "metadata">,
) {
  const metadata = record(turn.metadata);
  return hash(
    stableJson({
      attachmentFileIds: turn.attachmentFileIds,
      attachmentsFrozen: metadata.attachmentsFrozen,
      userAttachmentCount: metadata.userAttachmentCount,
      recovery: metadata.recovery,
      preparedDispatch: metadata.preparedDispatch,
      manusV2AttachmentMappings: metadata.manusV2AttachmentMappings,
    }),
  );
}

/** Add this start turn's unused uploads without revising any initial node. */
export async function retainInitialKnowledgeBaseImages(input: {
  workingSet: ValidatedKnowledgeBaseWorkingSet;
  turn: InitialUploadTurn;
}): Promise<ValidatedKnowledgeBaseWorkingSet> {
  const { workingSet, turn } = input;
  if (
    turn.buildId !== workingSet.manifest.buildId ||
    turn.buildGeneration !== workingSet.manifest.generation ||
    workingSet.manifest.contentVersion !== 1
  )
    throw new Error("初始图片与知识库构建坐标不一致");
  const images = await verifiedKnowledgeBaseInitialUploadImagesFromTurn(turn);
  const manifest = structuredClone(workingSet.manifest);
  const files = new Map(workingSet.files);
  for (const image of images) {
    if (manifest.assets.some((asset) => asset.sha256 === image.sourceSha256))
      continue;
    const bytes = await readVerifiedKnowledgeBaseCustomerUploadImageBytes({
      image,
      sourceScope: {
        userId: turn.userId!,
        buildId: turn.buildId!,
        generation: turn.buildGeneration!,
      },
    });
    const prepared = await prepareKnowledgeBaseInitialUploadImage({
      ...image,
      bytes,
    });
    if (
      prepared.bytes.length >
      KNOWLEDGE_BASE_WORKING_SET_POLICY.archive.maxAssetBytes
    )
      throw new Error(`初始上传图片超过知识库图片大小上限：${image.filename}`);
    const digest = hash(prepared.bytes);
    if (manifest.assets.some((asset) => asset.sha256 === digest)) continue;
    const extension =
      prepared.mimeType === "image/jpeg" ? "jpg" : prepared.mimeType.slice(6);
    const asset: KnowledgeBaseWorkingSetAsset = {
      assetId: `initial-upload-${image.sourceSha256.slice(0, 32)}`,
      path: `assets/initial-uploads/${image.sourceSha256}.${extension}`,
      sha256: digest,
      mimeType: prepared.mimeType,
      bytes: prepared.bytes.length,
      width: prepared.width,
      height: prepared.height,
      provenance: {
        ownership: "first_party",
        sourceKind: "user_upload",
        originalUploadSha256: image.sourceSha256,
      },
      documentIds: [],
      assetType: "customer_supplied",
      displayRole: "inline",
      caption: path.basename(image.filename).slice(0, 255),
    };
    if (
      manifest.assets.some(
        (item) => item.assetId === asset.assetId || item.path === asset.path,
      )
    )
      throw new Error("初始图片标识与知识库已有图片冲突");
    manifest.assets.push(asset);
    files.set(asset.path, prepared.bytes);
  }
  if (manifest.assets.length === workingSet.manifest.assets.length)
    return workingSet;
  const archive = await canonicalWorkingSetArchive({ manifest, files });
  const result = await validateKnowledgeBaseWorkingSetArchive(
    archive.archiveBytes,
    {
      operationId: manifest.operationId,
      buildId: manifest.buildId,
      generation: manifest.generation,
      contentVersion: 1,
      skillContentHash: manifest.skill.contentHash,
      companyName: manifest.company.name,
      companyWebsite: manifest.company.website,
    },
  );
  if (
    result.droppedOptionalCount ||
    result.manifest.assets.length !== manifest.assets.length
  )
    throw new Error("初始上传图片未完整保留，知识库尚未激活");
  if (
    JSON.stringify(result.manifest.leaves) !==
    JSON.stringify(workingSet.manifest.leaves)
  )
    throw new Error("保留初始图片不能改写知识节点");
  return {
    ...result,
    warnings: [...workingSet.warnings, ...result.warnings],
    droppedOptionalCount: workingSet.droppedOptionalCount,
  };
}
