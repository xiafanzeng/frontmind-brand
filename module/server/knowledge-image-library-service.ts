import type { BrandSchema } from "../schema/index.js";
import type { CoreSqlTable } from "../contracts/sql-table.js";
import type { ConversationTurn, LocalAsset } from "../contracts/core-records.js";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
export interface KnowledgeImageLibraryServiceCore {
  createKnowledgeImagePresentationProof: ReturnType<typeof import("./knowledge-image-presentation.js").createKnowledgeImagePresentation>["createKnowledgeImagePresentationProof"];
  conversationTurns: CoreSqlTable<ConversationTurn>;
  knowledgeBaseBuilds: BrandSchema["knowledgeBaseBuilds"];
  knowledgeBaseBuildNodes: BrandSchema["knowledgeBaseBuildNodes"];
  knowledgeBaseWorkingSets: BrandSchema["knowledgeBaseWorkingSets"];
  localAssets: CoreSqlTable<LocalAsset>;
  getDb: () => Promise<MySql2Database<any> | null>;
  lockCustomerProjectBusinessWrite: (tx:any,userId:number) => Promise<unknown>;
  enterpriseOwnerPredicate: (table:any,userId:number) => SQL;
  enterpriseAccountOwnerPredicate: (table:any,userId:number) => SQL;
  enterpriseProjectUrl: (path:string) => string;
  enterpriseResetStateTable: () => BrandSchema["knowledgeBaseResetStates"];
  enterpriseResetStateOwnerPredicate: (userId:number) => SQL;
  assertKnowledgeWorkbenchCoordinates: typeof import("./knowledge-workbench-service.js").assertKnowledgeWorkbenchCoordinates;
  loadKnowledgeWorkbenchSnapshot: typeof import("./knowledge-workbench-service.js").loadKnowledgeWorkbenchSnapshot;
  validateKnowledgeWorkbenchNodes: typeof import("./knowledge-workbench-service.js").validateKnowledgeWorkbenchNodes;
  knowledgeWorkbenchEditingAllowed: ReturnType<typeof import("./knowledge-workbench-stage.js").createKnowledgeWorkbenchStages>["knowledgeWorkbenchEditingAllowed"];
  knowledgeNodeEditCapability: typeof import("./knowledge-node-workspace-service.js").knowledgeNodeEditCapability;
  readValidatedActiveKnowledgeBaseWorkingSet: ReturnType<typeof import("./knowledge-base-materialized-assets.js").createKnowledgeBaseMaterializedAssets>["readValidatedActiveKnowledgeBaseWorkingSet"];
  knowledgeBaseWorkingSetLeafLocalUrls: ReturnType<typeof import("./knowledge-base-materialized-assets.js").createKnowledgeBaseMaterializedAssets>["knowledgeBaseWorkingSetLeafLocalUrls"];
  knowledgeBaseWorkingSetLibraryAssetInternalIdentity: ReturnType<typeof import("./knowledge-base-materialized-assets.js").createKnowledgeBaseMaterializedAssets>["knowledgeBaseWorkingSetLibraryAssetInternalIdentity"];
  knowledgeBaseWorkingSetAssetInternalIdentity: ReturnType<typeof import("./knowledge-base-materialized-assets.js").createKnowledgeBaseMaterializedAssets>["knowledgeBaseWorkingSetAssetInternalIdentity"];
  knowledgeBasePublicResource: ReturnType<typeof import("./knowledge-base-public-resource.js").createKnowledgeBasePublicResources>["knowledgeBasePublicResource"];
  knowledgeBaseOfficialLogoInternalIdentity: ReturnType<typeof import("./knowledge-base-public-resource.js").createKnowledgeBasePublicResources>["knowledgeBaseOfficialLogoInternalIdentity"];
  knowledgeBaseObservationConversationStorageId: typeof import("./knowledge-base-progress-service.js").knowledgeBaseObservationConversationStorageId;
  knowledgeBasePresentationKey: ReturnType<typeof import("./knowledge-base-authoritative-message.js").createKnowledgeBaseAuthoritativeMessages>["knowledgeBasePresentationKey"];
  knowledgeBaseMarkdownSha256: typeof import("./knowledge-base-package-validation.js").knowledgeBaseMarkdownSha256;
  persistKnowledgeBaseBuildSource: ReturnType<typeof import("./knowledge-base-local-source-store.js").createKnowledgeBaseLocalSourceStore>["persistKnowledgeBaseBuildSource"];
  findRetainedKnowledgeBaseLocalAsset: typeof import("./knowledge-base-deferred-upload-recovery.js").findRetainedKnowledgeBaseLocalAsset;
  composeKnowledgeImageLibrary: typeof import("./knowledge-image-library-contract.js").composeKnowledgeImageLibrary;
}
let createKnowledgeImagePresentationProof: KnowledgeImageLibraryServiceCore["createKnowledgeImagePresentationProof"];
let conversationTurns: KnowledgeImageLibraryServiceCore["conversationTurns"];
let knowledgeBaseBuilds: KnowledgeImageLibraryServiceCore["knowledgeBaseBuilds"];
let knowledgeBaseBuildNodes: KnowledgeImageLibraryServiceCore["knowledgeBaseBuildNodes"];
let knowledgeBaseWorkingSets: KnowledgeImageLibraryServiceCore["knowledgeBaseWorkingSets"];
let localAssets: KnowledgeImageLibraryServiceCore["localAssets"];
let getDb: KnowledgeImageLibraryServiceCore["getDb"];
let lockCustomerProjectBusinessWrite: KnowledgeImageLibraryServiceCore["lockCustomerProjectBusinessWrite"];
let enterpriseOwnerPredicate: KnowledgeImageLibraryServiceCore["enterpriseOwnerPredicate"];
let enterpriseAccountOwnerPredicate: KnowledgeImageLibraryServiceCore["enterpriseAccountOwnerPredicate"];
let enterpriseProjectUrl: KnowledgeImageLibraryServiceCore["enterpriseProjectUrl"];
let enterpriseResetStateTable: KnowledgeImageLibraryServiceCore["enterpriseResetStateTable"];
let enterpriseResetStateOwnerPredicate: KnowledgeImageLibraryServiceCore["enterpriseResetStateOwnerPredicate"];
let assertKnowledgeWorkbenchCoordinates: KnowledgeImageLibraryServiceCore["assertKnowledgeWorkbenchCoordinates"];
let loadKnowledgeWorkbenchSnapshot: KnowledgeImageLibraryServiceCore["loadKnowledgeWorkbenchSnapshot"];
let validateKnowledgeWorkbenchNodes: KnowledgeImageLibraryServiceCore["validateKnowledgeWorkbenchNodes"];
let knowledgeWorkbenchEditingAllowed: KnowledgeImageLibraryServiceCore["knowledgeWorkbenchEditingAllowed"];
let knowledgeNodeEditCapability: KnowledgeImageLibraryServiceCore["knowledgeNodeEditCapability"];
let readValidatedActiveKnowledgeBaseWorkingSet: KnowledgeImageLibraryServiceCore["readValidatedActiveKnowledgeBaseWorkingSet"];
let knowledgeBaseWorkingSetLeafLocalUrls: KnowledgeImageLibraryServiceCore["knowledgeBaseWorkingSetLeafLocalUrls"];
let knowledgeBaseWorkingSetLibraryAssetInternalIdentity: KnowledgeImageLibraryServiceCore["knowledgeBaseWorkingSetLibraryAssetInternalIdentity"];
let knowledgeBaseWorkingSetAssetInternalIdentity: KnowledgeImageLibraryServiceCore["knowledgeBaseWorkingSetAssetInternalIdentity"];
let knowledgeBasePublicResource: KnowledgeImageLibraryServiceCore["knowledgeBasePublicResource"];
let knowledgeBaseOfficialLogoInternalIdentity: KnowledgeImageLibraryServiceCore["knowledgeBaseOfficialLogoInternalIdentity"];
let knowledgeBaseObservationConversationStorageId: KnowledgeImageLibraryServiceCore["knowledgeBaseObservationConversationStorageId"];
let knowledgeBasePresentationKey: KnowledgeImageLibraryServiceCore["knowledgeBasePresentationKey"];
let knowledgeBaseMarkdownSha256: KnowledgeImageLibraryServiceCore["knowledgeBaseMarkdownSha256"];
let persistKnowledgeBaseBuildSource: KnowledgeImageLibraryServiceCore["persistKnowledgeBaseBuildSource"];
let findRetainedKnowledgeBaseLocalAsset: KnowledgeImageLibraryServiceCore["findRetainedKnowledgeBaseLocalAsset"];
let composeKnowledgeImageLibrary: KnowledgeImageLibraryServiceCore["composeKnowledgeImageLibrary"];
export function configureKnowledgeImageLibraryService(core:KnowledgeImageLibraryServiceCore) { ({createKnowledgeImagePresentationProof,conversationTurns,knowledgeBaseBuilds,knowledgeBaseBuildNodes,knowledgeBaseWorkingSets,localAssets,getDb,lockCustomerProjectBusinessWrite,enterpriseOwnerPredicate,enterpriseAccountOwnerPredicate,enterpriseProjectUrl,enterpriseResetStateTable,enterpriseResetStateOwnerPredicate,assertKnowledgeWorkbenchCoordinates,loadKnowledgeWorkbenchSnapshot,validateKnowledgeWorkbenchNodes,knowledgeWorkbenchEditingAllowed,knowledgeNodeEditCapability,readValidatedActiveKnowledgeBaseWorkingSet,knowledgeBaseWorkingSetLeafLocalUrls,knowledgeBaseWorkingSetLibraryAssetInternalIdentity,knowledgeBaseWorkingSetAssetInternalIdentity,knowledgeBasePublicResource,knowledgeBaseOfficialLogoInternalIdentity,knowledgeBaseObservationConversationStorageId,knowledgeBasePresentationKey,knowledgeBaseMarkdownSha256,persistKnowledgeBaseBuildSource,findRetainedKnowledgeBaseLocalAsset,composeKnowledgeImageLibrary}=core); }

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type {KnowledgeBaseBuild,KnowledgeBaseBuildNode} from "../schema/index.js";




import {KnowledgeBaseMaterializedError} from "./knowledge-base-materialized-service.js";
import {knowledgeWorkbenchCoordinates} from "./knowledge-workbench-service.js";










import type { KnowledgeBaseWorkingSetManifest } from "../contracts/knowledge-base-materialized-contract.js";

const identifier = z.string().trim().min(1).max(128);
export const knowledgeImageLibrarySaveSchema = knowledgeWorkbenchCoordinates
  .extend({
    clientRequestId: identifier,
    leafId: identifier.optional(),
    attachments: z
      .array(
        z
          .object({
            fileId: identifier,
            filename: z.string().trim().min(1).max(512),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    removeAssetIds: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/u))
      .max(500)
      .default([]),
  })
  .strict()
  .refine(
    (input) => input.attachments.length > 0 || input.removeAssetIds.length > 0,
  );
const querySchema = z.object({ conversationId: identifier }).strict();
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
function standaloneLogoId(
  build: KnowledgeBaseBuild,
  manifest: KnowledgeBaseWorkingSetManifest,
) {
  return manifest.assets.some((asset) => asset.assetId === "official-logo")
    ? `official-logo-source-${build.logoSha256?.slice(0, 12)}`
    : "official-logo";
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function fail(
  code: KnowledgeBaseMaterializedError["code"],
  message: string,
): never {
  throw new KnowledgeBaseMaterializedError(code, message);
}
async function requireDb() {
  const db = await getDb();
  if (!db) fail("DATABASE_UNAVAILABLE", "数据库暂不可用");
  return db;
}

async function capability(tx: any, build: KnowledgeBaseBuild) {
  const edit = knowledgeNodeEditCapability(
    build,
    await knowledgeWorkbenchEditingAllowed(tx, build),
  );
  return ["preparing", "retrying"].includes(build.packageStatus)
    ? { allowed: false, reason: "知识库正在更新，请等待更新完成后管理图片" }
    : edit;
}

export function projectKnowledgeImageLibrary(
  build: KnowledgeBaseBuild,
  manifest: KnowledgeBaseWorkingSetManifest,
  resetRevision: number,
  management: { allowed: boolean; reason: string | null },
) {
  const images = manifest.assets.map((asset) => ({
    assetId: asset.assetId,
    url: enterpriseProjectUrl(
      knowledgeBasePublicResource({
        buildId: build.id,
        kind: "working_set_asset",
        internalIdentity:
          knowledgeBaseWorkingSetLibraryAssetInternalIdentity(asset),
        contentSha256: asset.sha256,
        mimeType: asset.mimeType,
        sizeBytes: asset.bytes,
        caption: asset.caption,
      }).sameOriginUrl,
    ),
    caption:
      asset.caption ||
      (manifest.logo.assetId === asset.assetId
        ? "企业官方主 Logo"
        : "知识库配图"),
    nodes: manifest.leaves
      .filter((leaf) => leaf.assetIds.includes(asset.assetId))
      .map((leaf) => ({ leafId: leaf.leafId, title: leaf.title })),
    removable: true,
  }));
  // The official logo also has a separately retained package source. Surface
  // that source when it is absent from the working set, and delete both bindings.
  if (
    build.logoStorageKey &&
    build.logoSha256 &&
    build.logoMimeType &&
    !manifest.assets.some((asset) => asset.sha256 === build.logoSha256)
  ) {
    images.push({
      assetId: standaloneLogoId(build, manifest),
      url: enterpriseProjectUrl(
        knowledgeBasePublicResource({
          buildId: build.id,
          kind: "logo",
          internalIdentity: knowledgeBaseOfficialLogoInternalIdentity({
            generation: build.generation,
            sha256: build.logoSha256,
          }),
          contentSha256: build.logoSha256,
          mimeType: build.logoMimeType,
          sizeBytes: build.logoBytes ?? undefined,
        }).sameOriginUrl,
      ),
      caption: "企业官方主 Logo",
      nodes: [],
      removable: true,
    });
  }
  return {
    coordinates: {
      conversationId: build.conversationId,
      expectedGeneration: build.generation,
      expectedRevision: build.revision,
      expectedStateEpoch: build.stateEpoch,
      expectedContentVersion: build.contentVersion!,
      expectedResetRevision: resetRevision,
    },
    images,
    pendingPublication:
      build.status !== "published" || build.packageRevision !== build.revision,
    canManage: management.allowed,
    ...(management.reason ? { reason: management.reason } : {}),
  };
}

export async function getKnowledgeImageLibrary(userId: number, value: unknown) {
  const { conversationId } = querySchema.parse(value);
  const db = await requireDb();
  return db.transaction(async (tx: any) => {
    const [reset] = await tx
      .select()
      .from(enterpriseResetStateTable())
      .where(enterpriseResetStateOwnerPredicate(userId))
      .limit(1);
    const [build] = (await tx
      .select()
      .from(knowledgeBaseBuilds)
      .where(
        and(
          enterpriseOwnerPredicate(knowledgeBaseBuilds, userId),
          eq(knowledgeBaseBuilds.conversationId, conversationId),
        ),
      )
      .limit(1)) as KnowledgeBaseBuild[];
    if (!build) fail("BUILD_NOT_FOUND", "知识库构建不存在");
    const active = await readValidatedActiveKnowledgeBaseWorkingSet({
      db: tx,
      build,
    });
    return projectKnowledgeImageLibrary(
      build,
      active.validated.manifest,
      reset?.revision ?? 0,
      await capability(tx, build),
    );
  });
}

type SaveInput = z.infer<typeof knowledgeImageLibrarySaveSchema>;
async function previousReceipt(
  tx: any,
  userId: number,
  input: SaveInput,
  build: KnowledgeBaseBuild,
  requestHash: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(conversationTurns)
    .where(
      and(
        enterpriseOwnerPredicate(conversationTurns, userId),
        eq(
          conversationTurns.conversationId,
          knowledgeBaseObservationConversationStorageId(
            userId,
            input.conversationId,
          ),
        ),
        eq(conversationTurns.clientRequestId, input.clientRequestId),
      ),
    )
    .limit(1);
  const [previous] = await (lock ? query.for("update") : query);
  if (!previous) return null;
  if (
    previous.operationType !== "local_images" ||
    previous.requestHash !== requestHash ||
    previous.buildId !== build.id ||
    previous.buildGeneration !== input.expectedGeneration ||
    previous.status !== "completed"
  )
    fail("IDEMPOTENCY_CONFLICT", "本次保存标识已用于其他操作，请重新提交");
  return { accepted: true as const, unchanged: true };
}

export async function saveKnowledgeImageLibrary(
  userId: number,
  value: unknown,
) {
  const input = knowledgeImageLibrarySaveSchema.parse(value);
  const requestHash = hash(JSON.stringify(input));
  const db = await requireDb();
  // Preparation does no writes and makes no provider requests. The second
  // transaction compares these exact coordinates before activating any bytes.
  const prepared = await db.transaction(async (tx: any) => {
    const { build } = await loadKnowledgeWorkbenchSnapshot(tx, userId, input);
    const replay = await previousReceipt(tx, userId, input, build, requestHash);
    if (replay) return { replay };
    assertKnowledgeWorkbenchCoordinates(build, input);
    const management = await capability(tx, build);
    if (!management.allowed) fail("INVALID_BUILD_STATE", management.reason!);
    const active = await readValidatedActiveKnowledgeBaseWorkingSet({
      db: tx,
      build,
    });
    if (
      input.leafId &&
      !active.validated.manifest.leaves.some(
        (leaf) => leaf.leafId === input.leafId,
      )
    )
      fail("INVALID_BUILD_STATE", "知识节点不存在");
    const library = projectKnowledgeImageLibrary(
      build,
      active.validated.manifest,
      input.expectedResetRevision,
      management,
    );
    if (
      input.removeAssetIds.some(
        (id) =>
          !library.images.some(
            (image) =>
              image.assetId === id &&
              image.removable &&
              (!input.leafId ||
                image.nodes.some((node) => node.leafId === input.leafId)),
          ),
      )
    )
      fail("STALE_COORDINATES", "图片列表已变化，请重新读取后删除");
    return { build, active };
  });
  if (prepared.replay) return prepared.replay;
  const { build: original, active } = prepared;
  const rows = input.attachments.length
    ? await db
        .select()
        .from(localAssets)
        .where(
          and(
            inArray(
              localAssets.id,
              input.attachments.map((item) => item.fileId),
            ),
            eq(localAssets.scope, "managed_user"),
            enterpriseAccountOwnerPredicate(localAssets, userId),
            isNull(localAssets.presalesProjectId),
          ),
        )
    : [];
  const images: Array<{
    bytes: Buffer;
    sha256: string;
    mimeType: string;
    caption: string;
  }> = [];
  for (const attachment of input.attachments) {
    const row = rows.find((candidate) => candidate.id === attachment.fileId);
    if (
      !row ||
      !IMAGE_MIMES.has(row.mimeType) ||
      row.sizeBytes > 20 * 1024 * 1024
    )
      fail("INVALID_BUILD_STATE", "请上传有效且不超过 20 MB 的图片");
    const local = await findRetainedKnowledgeBaseLocalAsset({
      userId,
      localAssetId: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.contentSha256,
      includeBytes: true,
    });
    if (!local?.bytes)
      fail("INVALID_BUILD_STATE", "图片上传已过期，请重新上传后保存");
    images.push({
      bytes: local.bytes,
      sha256: local.contentSha256,
      mimeType: row.mimeType,
      caption: row.filename,
    });
  }
  const operationId = `images-${hash(`${original.id}:${input.clientRequestId}`)}`;
  const removeAssetIds = input.removeAssetIds.filter((id) =>
    active.validated.manifest.assets.some((asset) => asset.assetId === id),
  );
  const removeLogo = Boolean(
    !input.leafId &&
      original.logoSha256 &&
      input.removeAssetIds.some(
        (id) =>
          (id === standaloneLogoId(original, active.validated.manifest) &&
            !active.validated.manifest.assets.some(
              (asset) => asset.assetId === id,
            )) ||
          active.validated.manifest.assets.some(
            (asset) =>
              asset.assetId === id && asset.sha256 === original.logoSha256,
          ),
      ),
  );
  const removedResourceUrls: string[] = [];
  for (const asset of active.validated.manifest.assets.filter((asset) =>
    removeAssetIds.includes(asset.assetId),
  )) {
    for (const internalIdentity of [
      knowledgeBaseWorkingSetLibraryAssetInternalIdentity(asset),
      ...asset.documentIds.map((leafId) =>
        knowledgeBaseWorkingSetAssetInternalIdentity({ leafId, asset }),
      ),
    ])
      removedResourceUrls.push(
        knowledgeBasePublicResource({
          buildId: original.id,
          kind: "working_set_asset",
          internalIdentity,
          contentSha256: asset.sha256,
          mimeType: asset.mimeType,
        }).sameOriginUrl,
      );
  }
  if (removeLogo)
    removedResourceUrls.push(
      `/api/knowledge-base/artifacts/${original.id}/logo`,
    );
  if (removeLogo && original.logoSha256 && original.logoMimeType)
    removedResourceUrls.push(
      knowledgeBasePublicResource({
        buildId: original.id,
        kind: "logo",
        internalIdentity: knowledgeBaseOfficialLogoInternalIdentity({
          generation: original.generation,
          sha256: original.logoSha256,
        }),
        contentSha256: original.logoSha256,
        mimeType: original.logoMimeType,
      }).sameOriginUrl,
    );
  const composed = await composeKnowledgeImageLibrary({
    base: active.validated,
    operationId,
    images,
    removeAssetIds,
    removedResourceUrls,
    forceRevision: removeLogo,
    leafId: input.leafId,
  });
  const unchanged =
    composed.packageSha256 === active.validated.packageSha256 && !removeLogo;
  const retained = await persistKnowledgeBaseBuildSource({
    userId,
    buildId: original.id,
    generation: original.generation,
    bytes: composed.archiveBytes,
  });
  return db.transaction(async (tx: any) => {
    await lockCustomerProjectBusinessWrite(tx, userId);
    const { build } = await loadKnowledgeWorkbenchSnapshot(
      tx,
      userId,
      input,
      true,
    );
    const replay = await previousReceipt(
      tx,
      userId,
      input,
      build,
      requestHash,
      true,
    );
    if (replay) return replay;
    assertKnowledgeWorkbenchCoordinates(build, input);
    if (build.activeWorkingSetId !== active.row.id)
      fail("STALE_COORDINATES", "知识库工作稿已更新，请重新读取");
    const management = await capability(tx, build);
    if (!management.allowed) fail("INVALID_BUILD_STATE", management.reason!);
    const [base] = await tx
      .select()
      .from(knowledgeBaseWorkingSets)
      .where(eq(knowledgeBaseWorkingSets.id, active.row.id))
      .limit(1)
      .for("update");
    if (
      !base ||
      base.status !== "active" ||
      base.packageSha256 !== active.row.packageSha256
    )
      fail("STALE_COORDINATES", "知识库工作稿已更新，请重新读取");
    const nodes = (await tx
      .select()
      .from(knowledgeBaseBuildNodes)
      .where(eq(knowledgeBaseBuildNodes.buildId, build.id))
      .orderBy(asc(knowledgeBaseBuildNodes.ordinal))
      .for("update")) as KnowledgeBaseBuildNode[];
    validateKnowledgeWorkbenchNodes(build, nodes, active.validated.manifest);
    const now = new Date(),
      nextVersion = input.expectedContentVersion + 1,
      nextRevision = build.revision + 1,
      workingSetId = randomUUID(),
      turnId = randomUUID();
    const currentLeaf = composed.manifest.leaves.find(
      (leaf) => leaf.leafId === build.currentLeafId,
    );
    const currentPresentation =
      !unchanged && currentLeaf
        ? createKnowledgeImagePresentationProof({
            buildId: build.id,
            generation: build.generation,
            revision: nextRevision,
            contentVersion: nextVersion,
            workingSetId,
            leafId: currentLeaf.leafId,
            markdown: composed.files
              .get(currentLeaf.contentPath)!
              .toString("utf8"),
          })
        : undefined;
    await tx.insert(conversationTurns).values({
      id: turnId,
      userId,
      conversationId: knowledgeBaseObservationConversationStorageId(
        userId,
        input.conversationId,
      ),
      apiCredentialId: null,
      clientRequestId: input.clientRequestId,
      buildId: build.id,
      buildGeneration: build.generation,
      operationKey: operationId,
      operationType: "local_images",
      expectedRevision: build.revision,
      expectedLeafId: input.leafId ?? build.currentLeafId ?? "image-library",
      requestHash,
      attachmentFileIds: input.attachments.map((item) => item.fileId),
      metadata: {
        execution: "local",
        providerRequestCount: 0,
        imageLibrary: {
          schemaVersion: 1,
          workingSetId: unchanged ? base.id : workingSetId,
          contentVersion: unchanged ? build.contentVersion : nextVersion,
          removedAssetIds: input.removeAssetIds,
          ...(input.leafId ? { leafId: input.leafId } : {}),
          ...(currentPresentation ? { currentPresentation } : {}),
          unchanged,
        },
      },
      status: "completed",
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (unchanged) return { accepted: true as const, unchanged: true };
    if (composed.manifest.contentVersion !== nextVersion)
      fail("PATCH_CONFLICT", "图片库版本未正确递增");
    await tx.insert(knowledgeBaseWorkingSets).values({
      id: workingSetId,
      buildId: build.id,
      generation: build.generation,
      contentVersion: nextVersion,
      sourceExecutionId: null,
      storageKey: retained.storageKey,
      sizeBytes: retained.sizeBytes,
      packageSha256: composed.packageSha256,
      manifestSha256: composed.manifestSha256,
      manifest: composed.manifest,
      status: "active",
      activatedAt: now,
      createdAt: now,
    });
    await tx
      .update(knowledgeBaseWorkingSets)
      .set({ status: "superseded" })
      .where(eq(knowledgeBaseWorkingSets.id, base.id));
    let currentPresentationKey = build.currentPresentationKey;
    for (const node of nodes) {
      const leaf = composed.manifest.leaves.find(
        (item) => item.leafId === node.leafId,
      )!;
      const markdown = composed.files.get(leaf.contentPath)!.toString("utf8");
      const changed =
        markdown !== node.contentMarkdown ||
        JSON.stringify(leaf.assetIds) !== JSON.stringify(node.assetRefs);
      const presentationKey =
        node.leafId === currentPresentation?.leafId
          ? currentPresentation.presentationKey
          : changed
            ? knowledgeBasePresentationKey({
                buildId: build.id,
                generation: build.generation,
                revision: nextRevision,
                leafId: leaf.leafId,
                content: markdown,
              })
            : node.presentationKey;
      if (node.leafId === build.currentLeafId)
        currentPresentationKey = presentationKey;
      await tx
        .update(knowledgeBaseBuildNodes)
        .set({
          contentVersion: nextVersion,
          imageUrls: knowledgeBaseWorkingSetLeafLocalUrls({
            buildId: build.id,
            leafId: leaf.leafId,
            workingSet: composed,
          }).imageUrls,
          ...(node.leafId === currentPresentation?.leafId
            ? {
                sourceTurnId: turnId,
                presentationKey,
                lastResponseAt: now,
              }
            : {}),
          ...(changed
            ? {
                contentMarkdown: markdown,
                contentSha256: knowledgeBaseMarkdownSha256(markdown),
                assetRefs: leaf.assetIds,
                presentationKey,
                sourceTurnId: turnId,
                transitionReason: "local_image_library",
                lastResponseAt: now,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(knowledgeBaseBuildNodes.id, node.id));
    }

    // Keep the published snapshot and its package tuple intact. Their revision
    // becomes stale; only an explicit knowledge-base update replaces them.
    await tx
      .update(knowledgeBaseBuilds)
      .set({
        activeWorkingSetId: workingSetId,
        contentVersion: nextVersion,
        revision: nextRevision,
        stateEpoch: build.stateEpoch + 1,
        status:
          build.status === "published" ? "ready_to_publish" : build.status,
        currentPresentationKey,
        lastAppliedOperationKey: operationId,
        packageStatus: "not_started",
        packageNextRetryAt: null,
        packageLastErrorCode: null,
        ...(removeLogo
          ? {
              logoStorageKey: null,
              logoSha256: null,
              logoBytes: null,
              logoFilename: null,
              logoMimeType: null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(knowledgeBaseBuilds.id, build.id));
    return { accepted: true as const, unchanged: false };
  });
}
