import type {Request,Response} from 'express';
import type {BrandSchema} from '../schema/index.js';
import type {CoreSqlTable} from '../contracts/sql-table.js';
import type {ConversationTurn,Conversation,Message,UpstreamResource} from '../contracts/core-records.js';
import type {MySql2Database} from 'drizzle-orm/mysql2';
import type {SQL} from 'drizzle-orm';
import type {KnowledgeCredential,KnowledgeAgentClient,KnowledgeRequest} from './knowledge-http-ports.js';
type Port=(...args:any[])=>any;
import {knowledgeBasePackageWriterTaskId,knowledgeBasePublicationBindingHash} from './knowledge-base-publication-binding.js';
import {isMaterializedBuildPublishable} from './knowledge-base-materialized-quality.js';
import {effectiveKnowledgeArchiveCharacterCount,knowledgeArchiveFormalText,markedKnowledgeArchiveFormalContent} from './knowledge-archive-text-utils.js';
import {customerSafeKnowledgeFilename,toCustomerSafeKnowledgeAsset,toCustomerSafeKnowledgeDocument} from './knowledge-base-public-artifacts.js';
type AuthenticatedUser={id:number};
export interface KnowledgeSnapshotServiceCore {
 tables:BrandSchema;
lockCustomerProjectBusinessWrite:Port;
enterpriseProjectUrl:(url:string)=>string;
enterpriseProjectPredicate:(...args:any[])=>SQL;
enterpriseOwnerPredicate:(...args:any[])=>SQL;
lockActiveWebsiteProjectLifecycle:Port;
isKnowledgeSnapshotArchiveAvailable:(...args:any[])=>Promise<boolean>;
requireDb:()=>Promise<MySql2Database<any>>;
assertWorkspaceAccess:Port;
lockKnowledgeOwnerIdentity(tx:any,userId:number):Promise<void>;}
let knowledgeBaseBuilds:BrandSchema['knowledgeBaseBuilds'];
let knowledgeImportReceipts:BrandSchema['knowledgeImportReceipts'];
let knowledgeBaseSnapshots:BrandSchema['knowledgeBaseSnapshots'];
let lockCustomerProjectBusinessWrite:KnowledgeSnapshotServiceCore['lockCustomerProjectBusinessWrite'];
let enterpriseProjectUrl:KnowledgeSnapshotServiceCore['enterpriseProjectUrl'];
let enterpriseProjectPredicate:KnowledgeSnapshotServiceCore['enterpriseProjectPredicate'];
let enterpriseOwnerPredicate:KnowledgeSnapshotServiceCore['enterpriseOwnerPredicate'];
let lockActiveWebsiteProjectLifecycle:KnowledgeSnapshotServiceCore['lockActiveWebsiteProjectLifecycle'];
let isKnowledgeSnapshotArchiveAvailable:KnowledgeSnapshotServiceCore['isKnowledgeSnapshotArchiveAvailable'];
let requireDb:KnowledgeSnapshotServiceCore['requireDb'];
let assertWorkspaceAccess:KnowledgeSnapshotServiceCore['assertWorkspaceAccess'];
let lockKnowledgeOwnerIdentity:(tx:any,userId:number)=>Promise<void>;
export function configureKnowledgeSnapshotServiceCore(core:KnowledgeSnapshotServiceCore) {
({knowledgeBaseBuilds,knowledgeImportReceipts,knowledgeBaseSnapshots}=core.tables);
({lockCustomerProjectBusinessWrite,enterpriseProjectUrl,enterpriseProjectPredicate,enterpriseOwnerPredicate,lockActiveWebsiteProjectLifecycle,isKnowledgeSnapshotArchiveAvailable,requireDb,assertWorkspaceAccess, lockKnowledgeOwnerIdentity}=core);
}






import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
















import type {KnowledgeAssetRecord,KnowledgeDocumentRecord} from '@frontmind/module-brand/schema';

export function toKnowledgeSnapshotPublicJson<
  T extends {
    id: string;
    version: number;
    sourceFileName: string;
    archiveHash: string | null;
    documents: KnowledgeDocumentRecord[];
    documentCount: number;
    imageCount: number;
    characterCount: number;
    totalBytes: number;
    assets: KnowledgeAssetRecord[];
    status: "active" | "archived";
    createdAt: Date;
  },
>(snapshot: T, archiveAvailable: boolean) {
  const publicAssetIds = new Map<string, string>();
  snapshot.assets.forEach((asset, index) => {
    const internalId = String(asset.id || "").trim();
    if (internalId && !publicAssetIds.has(internalId)) {
      publicAssetIds.set(internalId, `public-asset-${index + 1}`);
    }
  });
  return {
    id: snapshot.id,
    version: snapshot.version,
    sourceFileName: customerSafeKnowledgeFilename(snapshot.sourceFileName),
    archiveHash: snapshot.archiveHash,
    documents: snapshot.documents.map((document) => {
      const projected = toCustomerSafeKnowledgeDocument(
        document as unknown as Record<string, unknown>,
      ) as unknown as KnowledgeDocumentRecord;
      return {
        ...projected,
        ...(Array.isArray(document.assetIds)
          ? {
              assetIds: document.assetIds
                .map((assetId) => publicAssetIds.get(String(assetId).trim()))
                .filter((assetId): assetId is string => Boolean(assetId)),
            }
          : {}),
      };
    }) as KnowledgeDocumentRecord[],
    documentCount: snapshot.documentCount,
    imageCount: snapshot.imageCount,
    characterCount: snapshot.characterCount,
    totalBytes: snapshot.totalBytes,
    status: snapshot.status,
    createdAt: snapshot.createdAt,
    archiveAvailable,
    assets: snapshot.assets.map((asset, index) => {
      const projected = toCustomerSafeKnowledgeAsset(
        asset as unknown as Record<string, unknown>,
        index,
      ) as unknown as KnowledgeAssetRecord;
      return {
        ...projected,
        // The public URL never embeds a raw provider-owned asset identifier.
        url: enterpriseProjectUrl(`/api/dashboard/knowledge/assets/${snapshot.id}/${index}`),
      };
    }),
  };
}

export async function publicKnowledgeSnapshot<
  T extends {
    id: string;
    userId: number;
    version: number;
    sourceFileName: string;
    archiveHash: string | null;
    documents: KnowledgeDocumentRecord[];
    documentCount: number;
    imageCount: number;
    characterCount: number;
    totalBytes: number;
    assets: KnowledgeAssetRecord[];
    status: "active" | "archived";
    createdAt: Date;
  },
>(snapshot: T) {
  const archiveAvailable =
    snapshot.sourceFileName.toLowerCase().endsWith(".zip") &&
    /^[a-f0-9]{64}$/i.test(snapshot.archiveHash || "") &&
    (await isKnowledgeSnapshotArchiveAvailable({
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      expectedBytes: snapshot.totalBytes,
    }));
  return toKnowledgeSnapshotPublicJson(snapshot, archiveAvailable);
}

export async function getLatestKnowledgeSnapshot(userId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(knowledgeBaseSnapshots)
    .where(
      and(
        enterpriseOwnerPredicate(knowledgeBaseSnapshots, userId),
        eq(knowledgeBaseSnapshots.status, "active"),
      ),
    )
    .orderBy(desc(knowledgeBaseSnapshots.version))
    .limit(1);
  return rows[0] ? publicKnowledgeSnapshot(rows[0]) : null;
}

export async function getKnowledgeSnapshotById(input: {
  userId: number;
  snapshotId: string;
}) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(knowledgeBaseSnapshots)
    .where(
      and(
        eq(knowledgeBaseSnapshots.id, input.snapshotId),
        enterpriseOwnerPredicate(knowledgeBaseSnapshots, input.userId),
      ),
    )
    .limit(1);
  return rows[0] ? publicKnowledgeSnapshot(rows[0]) : null;
}

export async function getKnowledgeSnapshotForWorkspace(input: {
  actor: AuthenticatedUser;
  snapshotId: string;
}) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(knowledgeBaseSnapshots)
    .where(and(eq(knowledgeBaseSnapshots.id, input.snapshotId), enterpriseProjectPredicate(knowledgeBaseSnapshots.enterpriseProjectId)))
    .limit(1);
  const snapshot = rows[0];
  if (!snapshot) return null;
  await assertWorkspaceAccess(input.actor, snapshot.userId);
  // This record is consumed only by the authenticated archive endpoint, which
  // needs immutable publication coordinates to validate the stored bytes. It
  // is never serialized as snapshot JSON.
  return snapshot;
}

export async function getKnowledgeAsset(input: {
  snapshotId: string;
  assetIndex: number;
}) {
  const db = await requireDb();
  const rows = await db
    .select({
      id: knowledgeBaseSnapshots.id,
      userId: knowledgeBaseSnapshots.userId,
      assets: knowledgeBaseSnapshots.assets,
    })
    .from(knowledgeBaseSnapshots)
    .where(and(eq(knowledgeBaseSnapshots.id, input.snapshotId), enterpriseProjectPredicate(knowledgeBaseSnapshots.enterpriseProjectId)))
    .limit(1);
  const snapshot = rows[0];
  const asset = snapshot?.assets[input.assetIndex];
  return snapshot && asset ? { snapshot, asset } : null;
}

export async function getKnowledgeAssetById(input: {
  snapshotId: string;
  assetId: string;
}) {
  const db = await requireDb();
  const rows = await db
    .select({
      id: knowledgeBaseSnapshots.id,
      userId: knowledgeBaseSnapshots.userId,
      assets: knowledgeBaseSnapshots.assets,
    })
    .from(knowledgeBaseSnapshots)
    .where(and(eq(knowledgeBaseSnapshots.id, input.snapshotId), enterpriseProjectPredicate(knowledgeBaseSnapshots.enterpriseProjectId)))
    .limit(1);
  const snapshot = rows[0];
  const asset = snapshot?.assets.find(
    (candidate) => candidate.id === input.assetId,
  );
  return snapshot && asset ? { snapshot, asset } : null;
}

export function knowledgeSnapshotFormalCharacterCount(
  documents: readonly Pick<
    KnowledgeDocumentRecord,
    "content" | "customerVisible"
  >[],
) {
  return documents.reduce(
    (total, document) =>
      total +
      (document.customerVisible === false
        ? 0
        : effectiveKnowledgeArchiveCharacterCount(
            knowledgeArchiveFormalText(
              markedKnowledgeArchiveFormalContent(document.content) ??
                document.content,
            ),
          )),
    0,
  );
}

export async function createKnowledgeSnapshot(input: {
  snapshotId?: string;
  businessSubmission?: boolean;
  userId: number;
  actorUserId: number;
  sourceFileName: string;
  sourceConversationId?: string;
  sourceBuildId?: string;
  sourceBuildRevision?: number;
  sourceBuildContentVersion?: number;
  sourceTaskId?: string;
  sourceArtifactHash?: string;
  archiveHash?: string;
  documents: KnowledgeDocumentRecord[];
  assets: KnowledgeAssetRecord[];
  totalBytes: number;
  importReceiptClaim?: {
    receiptId: string;
    claimRevision: number;
  };
}) {
  const db = await requireDb();
  const id = input.snapshotId ?? randomUUID();
  const characterCount = knowledgeSnapshotFormalCharacterCount(input.documents);
  const importProjectBindings = input.importReceiptClaim
    ? await db
        .select({ projectId: knowledgeImportReceipts.projectId })
        .from(knowledgeImportReceipts)
        .where(
          eq(knowledgeImportReceipts.id, input.importReceiptClaim.receiptId),
        )
        .limit(1)
    : [];
  await db.transaction(async (tx) => {
    if (input.businessSubmission) await lockCustomerProjectBusinessWrite(tx, input.userId);
    if (importProjectBindings[0]?.projectId) {
      await lockActiveWebsiteProjectLifecycle(
        tx,
        importProjectBindings[0].projectId,
      );
    }
    let publicationUsesArchiveHash = false;
    let publicationStateEpoch: number | null = null;
    await lockKnowledgeOwnerIdentity(tx,input.userId);
    if (input.importReceiptClaim) {
      const receiptRows = await tx
        .select({
          id: knowledgeImportReceipts.id,
          userId: knowledgeImportReceipts.userId,
          status: knowledgeImportReceipts.status,
          revision: knowledgeImportReceipts.revision,
        })
        .from(knowledgeImportReceipts)
        .where(
          eq(knowledgeImportReceipts.id, input.importReceiptClaim.receiptId),
        )
        .limit(1)
        .for("update");
      const receipt = receiptRows[0];
      if (
        !receipt ||
        receipt.userId !== input.userId ||
        receipt.status !== "processing" ||
        receipt.revision !== input.importReceiptClaim.claimRevision
      ) {
        throw new Error("知识库导入回执已由其他请求接管");
      }
    }
    if (input.sourceBuildId) {
      const builds = await tx
        .select({
          id: knowledgeBaseBuilds.id,
          generation: knowledgeBaseBuilds.generation,
          executionMode: knowledgeBaseBuilds.executionMode,
          providerProtocol: knowledgeBaseBuilds.providerProtocol,
          skillVersion: knowledgeBaseBuilds.skillVersion,
          skillContentHash: knowledgeBaseBuilds.skillContentHash,
          activeWorkingSetId: knowledgeBaseBuilds.activeWorkingSetId,
          contentVersion: knowledgeBaseBuilds.contentVersion,
          treePolicyVersion: knowledgeBaseBuilds.treePolicyVersion,
          totalNodeCount: knowledgeBaseBuilds.totalNodeCount,
          initialResearchCoverage: knowledgeBaseBuilds.initialResearchCoverage,
          handoffProvenance: knowledgeBaseBuilds.handoffProvenance,
          status: knowledgeBaseBuilds.status,
          revision: knowledgeBaseBuilds.revision,
          upstreamTaskId: knowledgeBaseBuilds.upstreamTaskId,
          canonicalTaskId: knowledgeBaseBuilds.canonicalTaskId,
          packageRevision: knowledgeBaseBuilds.packageRevision,
          packageTaskId: knowledgeBaseBuilds.packageTaskId,
          packageDescriptorHash: knowledgeBaseBuilds.packageDescriptorHash,
          packageArchiveSha256: knowledgeBaseBuilds.packageArchiveSha256,
          stateEpoch: knowledgeBaseBuilds.stateEpoch,
        })
        .from(knowledgeBaseBuilds)
        .where(
          and(
            eq(knowledgeBaseBuilds.id, input.sourceBuildId),
            enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
          ),
        )
        .limit(1)
        .for("update");
      if (builds[0]?.status !== "ready_to_publish") {
        throw new Error(
          builds[0]?.status === "published"
            ? "当前知识库已同步，请先在构建流程中补充内容"
            : "知识库尚未完成全部节点确认",
        );
      }
      if (
        builds[0].executionMode === "materialized_bundle_v1" &&
        !isMaterializedBuildPublishable(builds[0])
      ) {
        throw new Error(
          "知识库内容或研究覆盖不完整；当前内容可以查看，但不能发布，请重置后重跑",
        );
      }
      if (
        input.sourceBuildRevision === undefined ||
        input.sourceTaskId === undefined ||
        input.sourceArtifactHash === undefined ||
        input.archiveHash === undefined ||
        builds[0].revision !== input.sourceBuildRevision ||
        (input.sourceBuildContentVersion !== undefined &&
          builds[0].contentVersion !== input.sourceBuildContentVersion) ||
        builds[0].packageRevision !== input.sourceBuildRevision ||
        knowledgeBasePackageWriterTaskId(builds[0]) !== input.sourceTaskId ||
        builds[0].packageTaskId !== input.sourceTaskId ||
        knowledgeBasePublicationBindingHash(builds[0]) !==
          input.sourceArtifactHash
      ) {
        throw new Error("知识库完成版本已变化，请刷新后重新更新");
      }
      publicationUsesArchiveHash = Boolean(builds[0].packageArchiveSha256);
      publicationStateEpoch = builds[0].stateEpoch;
    }
    const latest = await tx
      .select({ version: knowledgeBaseSnapshots.version })
      .from(knowledgeBaseSnapshots)
      .where(enterpriseOwnerPredicate(knowledgeBaseSnapshots, input.userId))
      .orderBy(desc(knowledgeBaseSnapshots.version))
      .limit(1);
    const version = (latest[0]?.version ?? 0) + 1;
    await tx
      .update(knowledgeBaseSnapshots)
      .set({ status: "archived" })
      .where(
        and(
          enterpriseOwnerPredicate(knowledgeBaseSnapshots, input.userId),
          eq(knowledgeBaseSnapshots.status, "active"),
        ),
      );
    await tx.insert(knowledgeBaseSnapshots).values({
      id,
      userId: input.userId,
      version,
      sourceFileName: input.sourceFileName,
      sourceConversationId: input.sourceConversationId,
      sourceBuildId: input.sourceBuildId,
      sourceBuildRevision: input.sourceBuildRevision,
      sourceTaskId: input.sourceTaskId,
      siteOpsKnowledgeInputEpochId: null,
      sourceArtifactHash: input.sourceArtifactHash,
      archiveHash: input.archiveHash,
      documents: input.documents,
      assets: input.assets,
      documentCount: input.documents.length,
      imageCount: input.assets.length,
      characterCount,
      totalBytes: input.totalBytes,
      status: "active",
      createdByUserId: input.actorUserId,
    });
    if (input.importReceiptClaim) {
      const completedAt = new Date();
      const result = await tx
        .update(knowledgeImportReceipts)
        .set({
          status: "completed",
          snapshotId: id,
          sourceFileName: input.sourceFileName,
          completedAt,
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(knowledgeImportReceipts.id, input.importReceiptClaim.receiptId),
            enterpriseOwnerPredicate(knowledgeImportReceipts, input.userId),
            eq(knowledgeImportReceipts.status, "processing"),
            eq(
              knowledgeImportReceipts.revision,
              input.importReceiptClaim.claimRevision,
            ),
          ),
        );
      if (!result[0]?.affectedRows) {
        throw new Error("知识库导入回执已由其他请求接管");
      }
    }
    if (input.sourceBuildId) {
      const publicationHashColumn = publicationUsesArchiveHash
        ? eq(
            knowledgeBaseBuilds.packageArchiveSha256,
            input.sourceArtifactHash!,
          )
        : eq(
            knowledgeBaseBuilds.packageDescriptorHash,
            input.sourceArtifactHash!,
          );
      const result = await tx
        .update(knowledgeBaseBuilds)
        .set({
          status: "published",
          stateEpoch: publicationStateEpoch! + 1,
          publishedSnapshotId: id,
          publishedAt: new Date(),
          protocolError: null,
          protocolErrorCode: null,
        })
        .where(
          and(
            eq(knowledgeBaseBuilds.id, input.sourceBuildId),
            enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
            eq(knowledgeBaseBuilds.status, "ready_to_publish"),
            eq(knowledgeBaseBuilds.revision, input.sourceBuildRevision!),
            eq(knowledgeBaseBuilds.stateEpoch, publicationStateEpoch!),
            eq(knowledgeBaseBuilds.packageTaskId, input.sourceTaskId!),
            publicationHashColumn,
          ),
        );
      if (!result[0]?.affectedRows) {
        throw new Error("知识库完成版本已变化，请刷新后重新更新");
      }
    }
  });
  const snapshot = await getKnowledgeSnapshotById({
    userId: input.userId,
    snapshotId: id,
  });
  if (!snapshot) {
    throw new Error("知识库快照已写入但无法按标识读取");
  }
  return snapshot;
}
