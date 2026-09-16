import type {Request,Response} from 'express';
import type {BrandSchema} from '../schema/index.js';
import type {CoreSqlTable} from '../contracts/sql-table.js';
import type {ConversationTurn,Conversation,Message,UpstreamResource} from '../contracts/core-records.js';
import type {MySql2Database} from 'drizzle-orm/mysql2';
import type {SQL} from 'drizzle-orm';
import type {KnowledgeCredential,KnowledgeAgentClient,KnowledgeRequest} from './knowledge-http-ports.js';
type Port=(...args:any[])=>any;
import {KnowledgeArchiveValidationError,readStoredKnowledgeAssetBytes,removeUncommittedStoredKnowledgeAssets,runCommittedKnowledgeSnapshotSideEffects,readKnowledgeArchive,validateKnowledgeArchiveForDownload,assertKnowledgeArchiveEnterpriseIdentity,dashboardKnowledgePublishErrorForLog,publishKnowledgeBaseBuild} from './dashboard-knowledge-service.js';
import {assertKnowledgeBaseWritable} from './knowledge-base-reset-service.js';
import {KnowledgeSnapshotArchiveError} from './knowledge-snapshot-archive-store.js';
import {KnowledgeBasePackageUpdateError} from './knowledge-base-local-package.js';
import {assertKnowledgeSnapshotArchiveCustomerSafe,KnowledgeSnapshotDownloadBindingError,KnowledgeSnapshotPublicArchiveError,loadKnowledgeSnapshotDownloadValidation,validateDashboardOwnedSnapshotArchiveForDownload} from './knowledge-snapshot-download-validation.js';
type FrontMindRequest=KnowledgeRequest;
export interface DashboardKnowledgeRoutesCore {
 tables:BrandSchema;
enterpriseWorkspaceUserId:Port;
assertWorkspaceAccess:Port;
createKnowledgeSnapshot:Port;
getDashboardWorkspace:Port;
getKnowledgeAsset:Port;
getKnowledgeAssetById:Port;
getLatestKnowledgeSnapshot:Port;
getKnowledgeSnapshotForWorkspace:Port;
assertServiceCapability:Port;
ServiceEntitlementError:new(...args:any[])=>Error&{statusCode:number;code:string};
writeWorkspaceAuditEvent:Port;
knowledgeArchiveContentDisposition:Port;
persistKnowledgeSnapshotArchive:Port;
readKnowledgeSnapshotArchive:Port;
removeKnowledgeSnapshotArchive:Port;
assertRoleScopedWorkspaceExecution:Port;
knowledgeArchiveErrorCode:Port;
withCredentialScope<T>(action:()=>T):T;requestCredentialReference(request:Request):string|undefined;}
let enterpriseWorkspaceUserId:DashboardKnowledgeRoutesCore['enterpriseWorkspaceUserId'];
let assertWorkspaceAccess:DashboardKnowledgeRoutesCore['assertWorkspaceAccess'];
let createKnowledgeSnapshot:DashboardKnowledgeRoutesCore['createKnowledgeSnapshot'];
let getDashboardWorkspace:DashboardKnowledgeRoutesCore['getDashboardWorkspace'];
let getKnowledgeAsset:DashboardKnowledgeRoutesCore['getKnowledgeAsset'];
let getKnowledgeAssetById:DashboardKnowledgeRoutesCore['getKnowledgeAssetById'];
let getLatestKnowledgeSnapshot:DashboardKnowledgeRoutesCore['getLatestKnowledgeSnapshot'];
let getKnowledgeSnapshotForWorkspace:DashboardKnowledgeRoutesCore['getKnowledgeSnapshotForWorkspace'];
let assertServiceCapability:DashboardKnowledgeRoutesCore['assertServiceCapability'];
let ServiceEntitlementError:DashboardKnowledgeRoutesCore['ServiceEntitlementError'];
let writeWorkspaceAuditEvent:DashboardKnowledgeRoutesCore['writeWorkspaceAuditEvent'];
let knowledgeArchiveContentDisposition:DashboardKnowledgeRoutesCore['knowledgeArchiveContentDisposition'];
let persistKnowledgeSnapshotArchive:DashboardKnowledgeRoutesCore['persistKnowledgeSnapshotArchive'];
let readKnowledgeSnapshotArchive:DashboardKnowledgeRoutesCore['readKnowledgeSnapshotArchive'];
let removeKnowledgeSnapshotArchive:DashboardKnowledgeRoutesCore['removeKnowledgeSnapshotArchive'];
let assertRoleScopedWorkspaceExecution:DashboardKnowledgeRoutesCore['assertRoleScopedWorkspaceExecution'];
let knowledgeArchiveErrorCode:DashboardKnowledgeRoutesCore['knowledgeArchiveErrorCode'];
let withCredentialScope:<T>(action:()=>T)=>T;
let requestCredentialReference:(request:Request)=>string|undefined;
export function configureDashboardKnowledgeRoutesCore(core:DashboardKnowledgeRoutesCore) {
({}=core.tables);
({enterpriseWorkspaceUserId,assertWorkspaceAccess,createKnowledgeSnapshot,getDashboardWorkspace,getKnowledgeAsset,getKnowledgeAssetById,getLatestKnowledgeSnapshot,getKnowledgeSnapshotForWorkspace,assertServiceCapability,ServiceEntitlementError,writeWorkspaceAuditEvent,knowledgeArchiveContentDisposition,persistKnowledgeSnapshotArchive,readKnowledgeSnapshotArchive,removeKnowledgeSnapshotArchive,assertRoleScopedWorkspaceExecution,knowledgeArchiveErrorCode, requestCredentialReference,withCredentialScope}=core);
}








import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import axios, { type AxiosResponse } from "axios";
import { and, eq, inArray, isNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import express from "express";
import JSZip from "jszip";
import { z } from "zod";









































const router:express.Router=express.Router();
router.use((_req,_res,next)=>withCredentialScope(next));
router.post("/knowledge/publish", async (req: FrontMindRequest, res) => {
  const actor = req.frontmindUser!;
  const body = (req.body || {}) as {
    conversationId?: string;
    userId?: number;
    expectedBuildId?: string;
    expectedGeneration?: number;
    expectedRevision?: number;
    expectedContentVersion?: number;
    background?: boolean;
  };
  const targetUserId =
    body.userId === undefined ? enterpriseWorkspaceUserId(actor.id) : Number(body.userId);
  const conversationId = String(body.conversationId || "").trim();
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({
      error: { message: "用户 ID 无效", code: "BAD_REQUEST" },
    });
    return;
  }
  if (!conversationId) {
    res.status(400).json({
      error: { message: "缺少知识库对话标识", code: "BAD_REQUEST" },
    });
    return;
  }
  if (
    (body.expectedBuildId !== undefined &&
      !z.string().uuid().safeParse(body.expectedBuildId).success) ||
    [body.expectedGeneration, body.expectedRevision, body.expectedContentVersion].some(
      (value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0),
    )
  ) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "知识库版本标识无效" } });
    return;
  }
  try {
    await assertRoleScopedWorkspaceExecution({
      req,
      targetUserId,
      expectedRoleType: "ai_operations_engineer",
      allowCustomerSelf: true,
    });
    const result = await publishKnowledgeBaseBuild({
      userId: targetUserId,
      actorUserId: actor.id,
      conversationId,
      expectedBuildId: body.expectedBuildId,
      expectedGeneration: body.expectedGeneration,
      expectedRevision: body.expectedRevision,
      expectedContentVersion: body.expectedContentVersion,
      onClaimed: (coordinates) => {
        if (body.background === true && !res.headersSent) {
          res.status(202).json({ kind: "knowledge_update", ...coordinates });
        }
      },
    });
    if (!res.headersSent) res.json(result);
  } catch (error) {
    console.error("[Dashboard] Knowledge publish failed",
      dashboardKnowledgePublishErrorForLog(error, [requestCredentialReference(req)]));
    if (res.headersSent) return;
    res.status(error instanceof ServiceEntitlementError ? error.statusCode : 400).json({
      error: {
        message: error instanceof Error ? error.message : "无法发布知识库",
        code: error instanceof ServiceEntitlementError ? error.code
          : error instanceof KnowledgeBasePackageUpdateError ? error.code
          : knowledgeArchiveErrorCode(error) || "KNOWLEDGE_PUBLISH_FAILED",
      },
    });
  }
});
router.get(
  "/knowledge/snapshots/:snapshotId/archive",
  async (req: FrontMindRequest, res) => {
    try {
      const snapshotId = z.string().uuid().parse(req.params.snapshotId);
      const snapshot = await getKnowledgeSnapshotForWorkspace({
        actor: req.frontmindUser!,
        snapshotId,
      });
      if (
        !snapshot ||
        !snapshot.sourceFileName.toLowerCase().endsWith(".zip") ||
        !snapshot.archiveHash ||
        !/^[a-f0-9]{64}$/i.test(snapshot.archiveHash)
      ) {
        throw new KnowledgeSnapshotArchiveError(
          "ARCHIVE_NOT_FOUND",
          "该知识库版本尚无可下载的 ZIP 归档",
        );
      }
      const bytes = await readKnowledgeSnapshotArchive({
        userId: snapshot.userId,
        snapshotId,
        expectedSha256: snapshot.archiveHash,
        expectedBytes: snapshot.totalBytes,
      });
      const validation =
        await loadKnowledgeSnapshotDownloadValidation(snapshot);
      if (validation.kind === "dashboard_owned") {
        await validateDashboardOwnedSnapshotArchiveForDownload({
          buffer: bytes,
          validation,
        });
      } else {
        await validateKnowledgeArchiveForDownload({
          buffer: bytes,
          sourceFileName: snapshot.sourceFileName,
          expectedSha256: snapshot.archiveHash,
          expectedBytes: snapshot.totalBytes,
          // Historical is the compatibility superset for snapshots created
          // before profile/version metadata was persisted. It still executes
          // the shared CRC, path traversal, symlink, entry-count, expansion and
          // required-root structure checks before any bytes leave the server.
          validationProfile: "historical",
        });
      }
      await assertKnowledgeSnapshotArchiveCustomerSafe({
        buffer: bytes,
        sourceFileName: snapshot.sourceFileName,
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader(
        "Content-Disposition",
        knowledgeArchiveContentDisposition(snapshot.sourceFileName),
      );
      res.send(bytes);
    } catch (error) {
      const archiveError =
        error instanceof KnowledgeSnapshotArchiveError ? error : null;
      const validationError =
        error instanceof KnowledgeArchiveValidationError ? error : null;
      const bindingError =
        error instanceof KnowledgeSnapshotDownloadBindingError ? error : null;
      const publicArchiveError =
        error instanceof KnowledgeSnapshotPublicArchiveError ? error : null;
      res
        .status(
          validationError ||
            bindingError ||
            publicArchiveError ||
            (archiveError && archiveError.code !== "ARCHIVE_NOT_FOUND")
            ? 409
            : 404,
        )
        .json({
          error: {
            message:
              validationError?.message ||
              bindingError?.message ||
              publicArchiveError?.message ||
              archiveError?.message ||
              "知识库 ZIP 不存在",
            code:
              knowledgeArchiveErrorCode(validationError) ||
              (bindingError ? "KNOWLEDGE_ARCHIVE_BINDING_INVALID" : null) ||
              (publicArchiveError
                ? "KNOWLEDGE_ARCHIVE_PUBLIC_CONTENT_UNAVAILABLE"
                : null) ||
              archiveError?.code ||
              "NOT_FOUND",
          },
        });
    }
  },
);
router.get(
  "/knowledge/assets/:snapshotId/by-id/:assetId",
  async (req: FrontMindRequest, res) => {
    try {
      const assetId = z
        .string()
        .trim()
        .min(1)
        .max(191)
        .parse(req.params.assetId);
      const result = await getKnowledgeAssetById({
        snapshotId: req.params.snapshotId,
        assetId,
      });
      if (!result) throw new Error("资源不存在");
      await assertWorkspaceAccess(req.frontmindUser!, result.snapshot.userId);
      const bytes = await readStoredKnowledgeAssetBytes(result.asset.key);
      res.setHeader("Content-Type", result.asset.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Disposition", "inline");
      res.send(bytes);
    } catch {
      res
        .status(404)
        .json({ error: { message: "资源不存在", code: "NOT_FOUND" } });
    }
  },
);
router.get(
  "/knowledge/assets/:snapshotId/:assetIndex",
  async (req: FrontMindRequest, res) => {
    try {
      const assetIndex = Number(req.params.assetIndex);
      if (!Number.isInteger(assetIndex) || assetIndex < 0)
        throw new Error("资源不存在");
      const result = await getKnowledgeAsset({
        snapshotId: req.params.snapshotId,
        assetIndex,
      });
      if (!result) throw new Error("资源不存在");
      await assertWorkspaceAccess(req.frontmindUser!, result.snapshot.userId);
      const bytes = await readStoredKnowledgeAssetBytes(result.asset.key);
      res.setHeader("Content-Type", result.asset.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Disposition", "inline");
      res.send(bytes);
    } catch {
      res
        .status(404)
        .json({ error: { message: "资源不存在", code: "NOT_FOUND" } });
    }
  },
);
export async function handleKnowledgeArchiveImport(input:{req:FrontMindRequest;res:express.Response;targetUserId:number;buffer:Buffer;sourceFileName:string;sourceConversationId?:string;extension:string}) {
const {req,res,targetUserId,buffer,sourceFileName,sourceConversationId,extension}=input;const actor=req.frontmindUser!;
      await assertRoleScopedWorkspaceExecution({
        req,
        targetUserId,
        expectedRoleType: "ai_operations_engineer",
      });
      await assertKnowledgeBaseWritable(targetUserId);
      await assertServiceCapability(targetUserId, "knowledgeDisplay");
      const existingSnapshot = await getLatestKnowledgeSnapshot(targetUserId);

      let sourceBuildId: string | undefined;

      const snapshotId = randomUUID();
      const parsed = await readKnowledgeArchive(
        buffer,
        sourceFileName,
        snapshotId,
        existingSnapshot
          ? {
              validationProfile: "dashboard-enterprise-v1",
              archiveContractVersions: [2, 3],
            }
          : { validationProfile: "historical" },
      );
      let snapshotCommitted = false;
      let storedArchive = false;
      try {
        const workspace = await getDashboardWorkspace(targetUserId);
        assertKnowledgeArchiveEnterpriseIdentity({
          enterpriseIdentityConfirmed: Boolean(
            workspace.enterpriseIdentityBoundAt,
          ),
          brandName: workspace.payload.brandName,
          documents: parsed.documents,
        });
        const archiveHash =
          extension === ".zip"
            ? createHash("sha256").update(buffer).digest("hex")
            : undefined;
        if (archiveHash) {
          await persistKnowledgeSnapshotArchive({
            userId: targetUserId,
            snapshotId,
            buffer,
            expectedSha256: archiveHash,
          });
          storedArchive = true;
        }
        const snapshot = await createKnowledgeSnapshot({
          businessSubmission: true,
          snapshotId,
          userId: targetUserId,
          actorUserId: actor.id,
          sourceFileName,
          sourceConversationId,
          sourceBuildId,
          archiveHash,
          documents: parsed.documents,
          assets: parsed.assets,
          totalBytes: buffer.length,
        });
        snapshotCommitted = true;
        await runCommittedKnowledgeSnapshotSideEffects([
          {
            name: "publication audit",
            run: () =>
              writeWorkspaceAuditEvent({
                actor,
                action: "workspace.knowledge.published",
                targetType: "knowledge_snapshot",
                targetId: snapshot?.id ?? snapshotId,
                workspaceUserId: targetUserId,
                metadata: {
                  sourceName: sourceFileName,
                  sourceConversationId,
                  sourceBuildId,
                  documentCount:
                    snapshot?.documentCount ?? parsed.documents.length,
                  imageCount: snapshot?.imageCount ?? parsed.assets.length,
                  totalBytes: snapshot?.totalBytes ?? buffer.length,
                },
              }),
          },
        ]);
        res.json({ kind: "knowledge", snapshot });
      } catch (error) {
        await removeUncommittedStoredKnowledgeAssets({
          snapshotCommitted,
          storedAssetKeys: parsed.storedAssetKeys,
        });
        if (!snapshotCommitted && storedArchive) {
          await removeKnowledgeSnapshotArchive({
            userId: targetUserId,
            snapshotId,
          }).catch(() => undefined);
        }
        throw error;
      }

}
export default router;
