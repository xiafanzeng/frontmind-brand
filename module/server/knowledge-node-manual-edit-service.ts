import type { BrandSchema } from "../schema/index.js";
import type { CoreSqlTable } from "../contracts/sql-table.js";
import type { ConversationTurn, LocalAsset } from "../contracts/core-records.js";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
export interface KnowledgeNodeManualEditServiceCore {
  createKnowledgeNodeEditPatch:typeof import("../contracts/knowledge-node-edit-contract.js").createKnowledgeNodeEditPatch;
  validateKnowledgeBaseWorkingSetArchive:typeof import("../contracts/knowledge-base-materialized-contract.js").validateKnowledgeBaseWorkingSetArchive;
  applyKnowledgeBaseRevisionWorkingSet: typeof import("./knowledge-base-materialized-service.js").applyKnowledgeBaseRevisionWorkingSet;
  readActiveKnowledgeBaseWorkingSet: typeof import("./knowledge-base-materialized-service.js").readActiveKnowledgeBaseWorkingSet;
  failKnowledgeNodeEdit: typeof import("./knowledge-base-turn-service.js").failKnowledgeNodeEdit;
  recordKnowledgeNodeEditPatch: typeof import("./knowledge-base-turn-service.js").recordKnowledgeNodeEditPatch;
}
let applyKnowledgeBaseRevisionWorkingSet: KnowledgeNodeManualEditServiceCore["applyKnowledgeBaseRevisionWorkingSet"];
let readActiveKnowledgeBaseWorkingSet: KnowledgeNodeManualEditServiceCore["readActiveKnowledgeBaseWorkingSet"];
let failKnowledgeNodeEdit: KnowledgeNodeManualEditServiceCore["failKnowledgeNodeEdit"];
let recordKnowledgeNodeEditPatch: KnowledgeNodeManualEditServiceCore["recordKnowledgeNodeEditPatch"];
let validateKnowledgeBaseWorkingSetArchive:KnowledgeNodeManualEditServiceCore["validateKnowledgeBaseWorkingSetArchive"];
let createKnowledgeNodeEditPatch:KnowledgeNodeManualEditServiceCore["createKnowledgeNodeEditPatch"];
export function configureKnowledgeNodeManualEditService(core:KnowledgeNodeManualEditServiceCore) { ({createKnowledgeNodeEditPatch,validateKnowledgeBaseWorkingSetArchive,applyKnowledgeBaseRevisionWorkingSet,readActiveKnowledgeBaseWorkingSet,failKnowledgeNodeEdit,recordKnowledgeNodeEditPatch}=core); }

import {projectKnowledgeBaseCustomerMarkdown} from "../contracts/knowledge-base-materialized-contract.js";
import {type KnowledgeBaseRecoveryClaim} from "./knowledge-base-turn-service.js";
import {nodeEditSha256} from "../contracts/knowledge-node-edit-contract.js";

/** The manual lane accepts one frozen body. Neither dispatch nor recovery has
 * a credential/provider parameter; its only output is an application patch. */
export async function dispatchManualKnowledgeNodeEdit(
  claim: KnowledgeBaseRecoveryClaim,
) {
  const identity = {
    userId: claim.turn.userId,
    turnId: claim.turn.id,
    leaseToken: claim.leaseToken,
  };
  try {
    const recovery = claim.recoveryMetadata;
    if (
      recovery.nodeEditMode !== "manual_v1" ||
      claim.turn.operationType !== "revise" ||
      claim.turn.apiCredentialId !== null ||
      claim.turn.upstreamTaskId !== null ||
      claim.turn.attachmentFileIds.length !== 0 ||
      typeof recovery.contentMarkdown !== "string" ||
      !recovery.contentMarkdown.trim() ||
      recovery.contentMarkdown.length > 300_000 ||
      nodeEditSha256(recovery.contentMarkdown) !== recovery.contentSha256
    ) {
      throw new Error("KNOWLEDGE_NODE_MANUAL_AUTHORITY_INVALID");
    }
    const active = await readActiveKnowledgeBaseWorkingSet({
      userId: claim.turn.userId,
      buildId: claim.turn.buildId,
      generation: claim.turn.buildGeneration,
    });
    if (
      active.build.activeTurnId !== claim.turn.id ||
      active.build.currentLeafId !== claim.turn.expectedLeafId ||
      active.build.contentVersion !== recovery.baseContentVersion ||
      active.workingSet.id !== recovery.baseWorkingSetId
    ) {
      throw new Error("KNOWLEDGE_NODE_MANUAL_BASE_CHANGED");
    }
    const base = await validateKnowledgeBaseWorkingSetArchive(active.bytes, {
      buildId: active.build.id,
      generation: active.build.generation,
      contentVersion: active.build.contentVersion,
      skillContentHash: active.build.skillContentHash ?? undefined,
      companyName: active.build.companyName,
      companyWebsite: active.build.companyWebsite,
    });
    const leaf = base.manifest.leaves.find(
      (item) => item.leafId === claim.turn.expectedLeafId,
    );
    if (!leaf) throw new Error("KNOWLEDGE_NODE_MANUAL_TARGET_MISSING");
    const contentMarkdown = projectKnowledgeBaseCustomerMarkdown({
      leafTitle: leaf.title,
      markdown: recovery.contentMarkdown,
    });
    if (contentMarkdown !== recovery.contentMarkdown) {
      throw new Error("KNOWLEDGE_NODE_MANUAL_BODY_CHANGED");
    }
    const archiveBytes = await createKnowledgeNodeEditPatch({
      base,
      operationId: claim.turn.operationKey,
      targetLeafId: leaf.leafId,
      contentMarkdown,
      images: [],
    });
    await recordKnowledgeNodeEditPatch({
      ...identity,
      patchSha256: nodeEditSha256(archiveBytes),
      providerTaskId: null,
      attachmentSourceProofs: [],
    });
    const result = await applyKnowledgeBaseRevisionWorkingSet({
      userId: claim.turn.userId,
      buildId: claim.turn.buildId,
      generation: claim.turn.buildGeneration,
      turnId: claim.turn.id,
      operationId: claim.turn.operationKey,
      providerTaskId: null,
      resultSource: "local_node_edit",
      targetLeafId: leaf.leafId,
      archiveBytes,
    });
    return {
      taskId: null,
      rebound: false,
      reconciled: true,
      unchanged: "unchanged" in result && result.unchanged === true,
    };
  } catch (error) {
    // A completed CAS is atomic. A transient failure after that commit cannot
    // turn its receipt back into failed: the lease check rejects settlement.
    await failKnowledgeNodeEdit({
      ...identity,
      message: "本次正文未能保存，原节点内容已保留。请重新读取后提交修改。",
    }).catch(() => undefined);
    throw error;
  }
}
