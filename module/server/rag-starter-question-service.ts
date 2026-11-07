import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import {
  managedAgentProfileEffort,
  managedAgentProfileModel,
} from "@frontmind/module-contracts/agent-profile";
import {
  generatedRagStarterQuestionsSchema,
  parseGeneratedRagStarterQuestions,
  parseRagStarterQuestionTexts,
  ragStarterCurrentInputSchema,
  ragStarterDiscardInputSchema,
  ragStarterRegenerationInputSchema,
  type RagStarterQuestionEvidence,
  type RagStarterQuestionSetDto,
  type RagStarterQuestionsDto,
} from "../contracts/rag-starter-questions.js";
import type { ModuleHttpCore } from "./http-api.js";
import { intentSkillPorts } from "./intent-skill-runtime.js";
import {
  nextRagStarterWorkspaceRevision,
  ragStarterHash,
  ragStarterKnowledgeContentHash,
  ragStarterOwnerCondition,
  ragStarterSourceCatalog,
  reserveRagStarterQuestionSet,
} from "./rag-starter-question-reservation.js";

const OPERATION_TYPE = "brand_rag_starter_questions";
const CONTRACT_REVISION = 1;
const LEASE_MS = 120_000;
const CREATE_RECONCILE_MS = 120_000;
const MAX_EXECUTION_MS = 30 * 60_000;
const ACTIVE_STATUSES = ["queued", "running", "result_pending"] as const;
const ERROR_MESSAGES: Record<string, string> = {
  MODEL_UNAVAILABLE: "预设问题生成暂不可用，可继续使用当前问题。",
  KNOWLEDGE_UNAVAILABLE: "当前知识版本暂时无法用于生成预设问题。",
  NO_USABLE_KNOWLEDGE: "当前知识库没有可用的公开内容，可继续使用通用问题。",
  CREATE_UNKNOWN: "预设问题任务的创建结果无法确认，系统不会重复创建。",
  PROVIDER_FAILED: "预设问题生成失败，可在页面上选择“换一批”重试。",
  RESULT_INVALID: "预设问题结果未通过知识来源校验，已保留当前问题。",
  GENERATION_TIMEOUT: "预设问题生成超时，已保留当前问题。",
};

type StarterRow = ReturnType<typeof intentSkillPorts>["ragStarterQuestionSets"]["$inferSelect"];
type SnapshotRow = ReturnType<typeof intentSkillPorts>["knowledgeBaseSnapshots"]["$inferSelect"];

export class RagStarterQuestionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = "RagStarterQuestionError";
  }
}

function projectCondition(column: any, enterpriseProjectId: string | null) {
  return sql`${column} <=> ${enterpriseProjectId}`;
}

function iso(value: Date | string | number) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function setDto(row: StarterRow): RagStarterQuestionSetDto | null {
  const questions = row.questions?.map((item) => item.text);
  if (!questions) return null;
  let parsed: [string, string, string];
  try { parsed = parseRagStarterQuestionTexts(questions); }
  catch { return null; }
  return {
    id: row.id,
    questions: parsed,
    source: row.source,
    knowledgeSnapshotId: row.knowledgeSnapshotId,
    createdAt: iso(row.createdAt),
  };
}

async function latestSnapshot(
  db: any,
  model: ReturnType<typeof intentSkillPorts>,
  context: { accountUserId: number; enterpriseProjectId: string | null },
  lock = false,
): Promise<SnapshotRow | undefined> {
  let query = db.select().from(model.knowledgeBaseSnapshots).where(and(
    eq(model.knowledgeBaseSnapshots.userId, context.accountUserId),
    projectCondition(model.knowledgeBaseSnapshots.enterpriseProjectId, context.enterpriseProjectId),
    eq(model.knowledgeBaseSnapshots.status, "active"),
  )).orderBy(desc(model.knowledgeBaseSnapshots.version)).limit(1);
  if (lock && typeof query.for === "function") query = query.for("update");
  return (await query)[0] as SnapshotRow | undefined;
}

async function ownedRows(
  db: any,
  model: ReturnType<typeof intentSkillPorts>,
  context: { accountUserId: number; enterpriseProjectId: string | null },
  lock = false,
): Promise<StarterRow[]> {
  let query = db.select().from(model.ragStarterQuestionSets).where(
    ragStarterOwnerCondition(
      model.ragStarterQuestionSets,
      context.accountUserId,
      context.enterpriseProjectId,
    ),
  ).orderBy(desc(model.ragStarterQuestionSets.workspaceRevision),
    desc(model.ragStarterQuestionSets.createdAt));
  if (lock && typeof query.for === "function") query = query.for("update");
  return await query as StarterRow[];
}

function currentAndDraft(rows: readonly StarterRow[], snapshotId?: string) {
  const current = rows.find((row) => row.status === "confirmed");
  const draft = rows.find((row) =>
    row.status === "draft_ready" && (!snapshotId || row.knowledgeSnapshotId === snapshotId));
  return { current, draft };
}

function assertExpectedSets(
  rows: readonly StarterRow[],
  snapshotId: string | undefined,
  expected: { expectedCurrentSetId: string | null; expectedDraftSetId: string | null },
) {
  const { current, draft } = currentAndDraft(rows, snapshotId);
  if ((current?.id ?? null) !== expected.expectedCurrentSetId ||
      (draft?.id ?? null) !== expected.expectedDraftSetId) {
    throw new RagStarterQuestionError(
      "STARTER_VERSION_CONFLICT",
      "预设问题已在其他页面更新，请刷新后再确认。",
      409,
    );
  }
  return { current, draft };
}

async function projectWorkspace(
  core: ModuleHttpCore,
  context: { accountUserId: number; enterpriseProjectId: string | null },
): Promise<RagStarterQuestionsDto> {
  const model = intentSkillPorts();
  const db = await core.database();
  const [snapshot, rows] = await Promise.all([
    latestSnapshot(db, model, context),
    ownedRows(db, model, context),
  ]);
  const { current, draft } = currentAndDraft(rows, snapshot?.id);
  const pending = rows.find((row) =>
    (ACTIVE_STATUSES as readonly string[]).includes(row.status) &&
    (!snapshot || row.knowledgeSnapshotId === snapshot.id));
  const failure = rows.find((row) =>
    (row.status === "failed" || row.status === "attention_required") &&
    (!snapshot || row.knowledgeSnapshotId === snapshot.id) &&
    (!current || row.workspaceRevision > current.workspaceRevision));
  return {
    knowledgeBase: snapshot ? {
      id: snapshot.id,
      version: snapshot.version,
      archiveHash: snapshot.archiveHash,
      documentCount: snapshot.documentCount,
    } : null,
    current: current ? setDto(current) : null,
    draft: draft ? setDto(draft) : null,
    pending: Boolean(pending),
    ...(pending ? { pendingSetId: pending.id } : {}),
    error: failure?.errorCode
      ? ERROR_MESSAGES[failure.errorCode] ?? "预设问题暂时无法更新。"
      : null,
    ...(failure?.errorCode ? { errorCode: failure.errorCode } : {}),
    revision: Math.max(0, ...rows.map((row) => Number(row.workspaceRevision))),
  };
}

export function createRagStarterQuestionService(core: ModuleHttpCore, request: Request) {
  const model = intentSkillPorts();
  const context = core.context(request);
  const actor = (request as Request & { frontmindUser?: { id: number; role: string } }).frontmindUser;
  function assertActor() {
    if (!actor || actor.id !== context.actorUserId) {
      throw new RagStarterQuestionError("ACTOR_INVALID", "当前账号无权修改预设问题。", 403);
    }
    model.assertActorAllowed(actor);
  }
  async function read() {
    return projectWorkspace(core, context);
  }
  async function regenerate(raw: unknown) {
    assertActor();
    const input = ragStarterRegenerationInputSchema.parse(raw);
    const db = await core.database();
    await db.transaction(async (tx: any) => {
      await model.lockCustomerProjectBusinessWrite(tx, context.accountUserId, actor);
      await model.lockAccountRecord(tx, context.accountUserId);
      const snapshot = await latestSnapshot(tx, model, context, true);
      if (!snapshot) throw new RagStarterQuestionError(
        "KNOWLEDGE_REQUIRED", "请先发布企业知识库后再生成预设问题。", 412);
      const rows = await ownedRows(tx, model, context, true);
      assertExpectedSets(rows, snapshot.id, input);
      const replay = rows.find((row) =>
        row.knowledgeSnapshotId === snapshot.id &&
        row.clientRequestId === input.clientRequestId);
      if (replay) return;
      const uncertainCreate = rows.find((row) =>
        row.knowledgeSnapshotId === snapshot.id &&
        row.status === "attention_required" &&
        (row.errorCode === "CREATE_UNKNOWN" || row.errorCode === "GENERATION_TIMEOUT"));
      if (uncertainCreate) {
        // An explicit retry of an uncertain outcome only reopens the original
        // durable reservation. CREATE_UNKNOWN remains a token lookup. A task
        // that reached the total execution cap receives exactly one read-only
        // observation; neither path may allocate or send a second task.
        const revision = await nextRagStarterWorkspaceRevision(
          tx, model.ragStarterQuestionSets, context.accountUserId, context.enterpriseProjectId);
        const now = new Date();
        const uncertainErrorCode = uncertainCreate.errorCode;
        const [task] = await tx.select().from(model.agentTasks)
          .where(eq(model.agentTasks.id, uncertainCreate.taskId)).limit(1).for("update");
        if (!task) throw new RagStarterQuestionError(
          "STARTER_LEDGER_MISSING", "预设问题任务记录不完整，请稍后重试。", 409);
        await tx.update(model.ragStarterQuestionSets).set({
          status: "running", errorCode: null, workspaceRevision: revision,
          clientRequestId: input.clientRequestId,
          leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, updatedAt: now,
        }).where(eq(model.ragStarterQuestionSets.id, uncertainCreate.id));
        await tx.update(model.agentOperations).set({
          status: "running", errorCode: null, updatedAt: now,
        }).where(eq(model.agentOperations.id, uncertainCreate.operationId));
        await tx.update(model.agentTasks).set({
          // failSet marks the ledger task failed when reconciliation times
          // out. Reopening keeps its original providerRuntime (including the
          // operation token and createClaimedAt) and only restores a lookup or
          // observation state; the worker must not enter the create branch.
          providerState: task.providerTaskId ? "result_pending" : "create_unknown",
          ...(uncertainErrorCode === "GENERATION_TIMEOUT" ? (() => {
            const runtime = runtimeFromTask(task);
            runtime.reconcileOnce = true;
            return { providerRuntime: runtimeContainer(task, runtime) };
          })() : {}),
          updatedAt: now,
        }).where(eq(model.agentTasks.id, uncertainCreate.taskId));
        return;
      }
      if (rows.some((row) => (ACTIVE_STATUSES as readonly string[]).includes(row.status))) {
        throw new RagStarterQuestionError(
          "STARTER_GENERATION_ACTIVE", "预设问题正在生成，请等待本次结果。");
      }
      await reserveRagStarterQuestionSet({
        tx,
        table: model.ragStarterQuestionSets,
        agentOperations: model.agentOperations,
        agentTasks: model.agentTasks,
        enterpriseProjectId: context.enterpriseProjectId,
        userId: context.accountUserId,
        snapshot: {
          id: snapshot.id,
          version: snapshot.version,
          archiveHash: snapshot.archiveHash,
          documents: snapshot.documents,
        },
        source: "regenerate",
        clientRequestId: input.clientRequestId,
      });
    });
    return read();
  }
  async function confirm(raw: unknown) {
    assertActor();
    const input = ragStarterCurrentInputSchema.parse(raw);
    const questions = parseRagStarterQuestionTexts(input.questions);
    const db = await core.database();
    await db.transaction(async (tx: any) => {
      await model.lockCustomerProjectBusinessWrite(tx, context.accountUserId, actor);
      await model.lockAccountRecord(tx, context.accountUserId);
      const snapshot = await latestSnapshot(tx, model, context, true);
      if (!snapshot) throw new RagStarterQuestionError(
        "KNOWLEDGE_REQUIRED", "请先发布企业知识库后再保存预设问题。", 412);
      const rows = await ownedRows(tx, model, context, true);
      const { current, draft } = assertExpectedSets(rows, snapshot.id, input);
      const revision = await nextRagStarterWorkspaceRevision(
        tx, model.ragStarterQuestionSets, context.accountUserId, context.enterpriseProjectId);
      const now = new Date();
      // A successful human decision is authoritative for definite failures.
      // Outcome-unknown creates and timed-out provider tasks are deliberately
      // retained as durable no-duplicate fences. A later explicit retry may
      // only reconcile the original ledger task.
      await tx.update(model.ragStarterQuestionSets).set({
        status: "superseded", workspaceRevision: revision, updatedAt: now,
      }).where(and(
        ragStarterOwnerCondition(model.ragStarterQuestionSets,
          context.accountUserId, context.enterpriseProjectId),
        eq(model.ragStarterQuestionSets.knowledgeSnapshotId, snapshot.id),
        or(
          eq(model.ragStarterQuestionSets.status, "failed"),
          and(
            eq(model.ragStarterQuestionSets.status, "attention_required"),
            ne(model.ragStarterQuestionSets.errorCode, "CREATE_UNKNOWN"),
            ne(model.ragStarterQuestionSets.errorCode, "GENERATION_TIMEOUT"),
          ),
        ),
      ));
      if (current) await tx.update(model.ragStarterQuestionSets).set({
        status: "superseded", workspaceRevision: revision, updatedAt: now,
      }).where(eq(model.ragStarterQuestionSets.id, current.id));
      const draftQuestions = draft?.questions?.map((item) => item.text.trim());
      const confirmsDraft = Boolean(draft && draftQuestions &&
        draftQuestions.every((value, index) => value === questions[index]));
      if (confirmsDraft && draft) {
        await tx.update(model.ragStarterQuestionSets).set({
          status: "confirmed", workspaceRevision: revision, confirmedAt: now,
          errorCode: null, updatedAt: now,
        }).where(eq(model.ragStarterQuestionSets.id, draft.id));
      } else {
        if (draft) await tx.update(model.ragStarterQuestionSets).set({
          status: "superseded", workspaceRevision: revision, updatedAt: now,
        }).where(eq(model.ragStarterQuestionSets.id, draft.id));
        const [latestOrdinal] = await tx.select({ ordinal: model.ragStarterQuestionSets.ordinal })
          .from(model.ragStarterQuestionSets)
          .where(ragStarterOwnerCondition(model.ragStarterQuestionSets,
            context.accountUserId, context.enterpriseProjectId))
          .orderBy(desc(model.ragStarterQuestionSets.ordinal)).limit(1);
        const id = randomUUID();
        await tx.insert(model.ragStarterQuestionSets).values({
          id,
          enterpriseProjectId: context.enterpriseProjectId,
          userId: context.accountUserId,
          knowledgeSnapshotId: snapshot.id,
          knowledgeSnapshotVersion: snapshot.version,
          knowledgeArchiveHash: snapshot.archiveHash,
          knowledgeContentHash: ragStarterKnowledgeContentHash(snapshot.documents),
          ordinal: Number(latestOrdinal?.ordinal ?? 0) + 1,
          source: "manual",
          status: "confirmed",
          generationKeyHash: ragStarterHash(["manual", id]),
          clientRequestId: null,
          requestHash: ragStarterHash({ snapshotId: snapshot.id, questions }),
          promptVersion: "manual-v1",
          operationId: randomUUID(),
          taskId: randomUUID(),
          questions: questions.map((text) => ({ text, sourceAliases: [] })),
          errorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          attemptCount: 0,
          workspaceRevision: revision,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    return read();
  }
  async function discard(raw: unknown) {
    assertActor();
    const input = ragStarterDiscardInputSchema.parse(raw);
    const db = await core.database();
    await db.transaction(async (tx: any) => {
      await model.lockCustomerProjectBusinessWrite(tx, context.accountUserId, actor);
      await model.lockAccountRecord(tx, context.accountUserId);
      const snapshot = await latestSnapshot(tx, model, context, true);
      const rows = await ownedRows(tx, model, context, true);
      const { draft } = assertExpectedSets(rows, snapshot?.id, input);
      if (!draft) throw new RagStarterQuestionError(
        "STARTER_DRAFT_NOT_FOUND", "待确认的预设问题已不存在。", 404);
      const revision = await nextRagStarterWorkspaceRevision(
        tx, model.ragStarterQuestionSets, context.accountUserId, context.enterpriseProjectId);
      await tx.update(model.ragStarterQuestionSets).set({
        status: "superseded", workspaceRevision: revision, updatedAt: new Date(),
      }).where(eq(model.ragStarterQuestionSets.id, draft.id));
    });
    return read();
  }
  return { read, regenerate, confirm, discard };
}

/**
 * Explicit one-project bootstrap for a snapshot published before starter
 * questions existed. The caller must establish that exact project scope.
 * This function only reserves local work; provider execution remains in the
 * leased worker and is never triggered by a read or by importing the module.
 */
export async function bootstrapCurrentProjectRagStarterQuestions(input: {
  accountUserId: number;
  enterpriseProjectId: string;
}) {
  const model = intentSkillPorts();
  if (model.currentEnterpriseProjectId() !== input.enterpriseProjectId) {
    throw new RagStarterQuestionError(
      "STARTER_BOOTSTRAP_SCOPE_MISMATCH",
      "预设问题初始化必须在指定的当前项目范围内执行。",
      400,
    );
  }
  const db = await model.getDb();
  if (!db) throw new RagStarterQuestionError(
    "DATABASE_UNAVAILABLE", "数据库暂不可用。", 503);
  return db.transaction(async (tx: any) => {
    await model.lockCustomerProjectBusinessWrite(tx, input.accountUserId);
    await model.lockAccountRecord(tx, input.accountUserId);
    const context = {
      accountUserId: input.accountUserId,
      enterpriseProjectId: input.enterpriseProjectId,
    };
    const snapshot = await latestSnapshot(tx, model, context, true);
    if (!snapshot) throw new RagStarterQuestionError(
      "KNOWLEDGE_REQUIRED", "当前项目没有已发布的企业知识库。", 412);
    const existing = (await ownedRows(tx, model, context, true))
      .find((row) => row.knowledgeSnapshotId === snapshot.id);
    if (existing) return { reserved: false, setId: existing.id };
    const reservation = await reserveRagStarterQuestionSet({
      tx,
      table: model.ragStarterQuestionSets,
      agentOperations: model.agentOperations,
      agentTasks: model.agentTasks,
      enterpriseProjectId: input.enterpriseProjectId,
      userId: input.accountUserId,
      snapshot: {
        id: snapshot.id,
        version: snapshot.version,
        archiveHash: snapshot.archiveHash,
        documents: snapshot.documents,
      },
      source: "automatic",
    });
    return { reserved: reservation.acquired, setId: reservation.row.id };
  });
}

type WorkerRuntime = {
  schemaVersion: 1;
  setId: string;
  operationToken: string;
  inputHash: string;
  snapshotId: string;
  snapshotVersion: number;
  archiveHash: string | null;
  contentHash: string;
  credentialId: string;
  credentialVersion: number;
  createdAt: string;
  createClaimedAt?: number;
  resultPendingAt?: number;
  reconcileOnce?: boolean;
};

export function ragStarterProviderDispatchAction(task: {
  providerState: string;
  providerTaskId?: string | null;
}): "create" | "reconcile_create" | "observe" {
  if (task.providerState === "queued") return "create";
  if (task.providerState === "create_unknown" && !task.providerTaskId) {
    return "reconcile_create";
  }
  return "observe";
}

export function ragStarterCredentialUnavailableCode(
  task: { providerState: string; providerTaskId?: string | null },
  runtime: { createClaimedAt?: number },
): "MODEL_UNAVAILABLE" | "CREATE_UNKNOWN" | "GENERATION_TIMEOUT" {
  if (task.providerTaskId) return "GENERATION_TIMEOUT";
  if (task.providerState !== "queued" || runtime.createClaimedAt !== undefined) {
    return "CREATE_UNKNOWN";
  }
  return "MODEL_UNAVAILABLE";
}

export function ragStarterLateResultDisposition(
  activeSnapshotId: string | null | undefined,
  resultSnapshotId: string,
): "draft_ready" | "superseded" {
  return activeSnapshotId === resultSnapshotId ? "draft_ready" : "superseded";
}

function runtimeFromTask(task: any): WorkerRuntime {
  const value = task?.providerRuntime?.ragStarterQuestions;
  if (!value || value.schemaVersion !== 1 || typeof value.setId !== "string" ||
      typeof value.operationToken !== "string" || typeof value.inputHash !== "string" ||
      typeof value.snapshotId !== "string" || !Number.isSafeInteger(value.snapshotVersion) ||
      typeof value.contentHash !== "string" || typeof value.credentialId !== "string" ||
      !Number.isSafeInteger(value.credentialVersion) || typeof value.createdAt !== "string") {
    throw new Error("RAG_STARTER_CONTEXT_INVALID");
  }
  return structuredClone(value) as WorkerRuntime;
}

function runtimeContainer(task: any, runtime: WorkerRuntime) {
  return { ...(task?.providerRuntime ?? {}), ragStarterQuestions: runtime };
}

export function ragStarterManagedBaseRuntime(provider: "manus" | "zhipu" | "xty_codex") {
  const publicProfile = "frontmind-base" as const;
  return {
    publicProfile,
    model: managedAgentProfileModel(publicProfile, provider),
    effort: managedAgentProfileEffort(publicProfile),
  };
}

async function failSet(
  model: ReturnType<typeof intentSkillPorts>,
  row: StarterRow,
  code: string,
  attentionRequired = false,
) {
  const db = await model.getDb();
  if (!db || !row.leaseOwner) return false;
  const now = new Date();
  return db.transaction(async (tx: any) => {
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== row.leaseOwner) return false;
    await tx.update(model.ragStarterQuestionSets).set({
      status: attentionRequired ? "attention_required" : "failed",
      errorCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      updatedAt: now,
    }).where(eq(model.ragStarterQuestionSets.id, row.id));
    await tx.update(model.agentOperations).set({
      status: attentionRequired ? "attention_required" : "failed",
      errorCode: code,
      updatedAt: now,
    }).where(eq(model.agentOperations.id, row.operationId));
    await tx.update(model.agentTasks).set({
      providerState: "failed",
      lastMessageSyncAt: now,
      updatedAt: now,
    }).where(eq(model.agentTasks.id, row.taskId));
    return true;
  });
}

async function retrySet(model: ReturnType<typeof intentSkillPorts>, row: StarterRow) {
  const db = await model.getDb();
  const leaseOwner = row.leaseOwner;
  if (!db || !leaseOwner) return false;
  const attempts = Number(row.attemptCount ?? 0) + 1;
  const backoff = Math.min(60_000, 2_000 * (2 ** Math.min(attempts, 5)));
  return db.transaction(async (tx: any) => {
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== leaseOwner) return false;
    await tx.update(model.ragStarterQuestionSets).set({
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + backoff),
      attemptCount: attempts,
      updatedAt: new Date(),
    }).where(and(
      eq(model.ragStarterQuestionSets.id, row.id),
      eq(model.ragStarterQuestionSets.leaseOwner, leaseOwner),
    ));
    return true;
  });
}

async function acquireSet(model: ReturnType<typeof intentSkillPorts>, id: string) {
  const db = await model.getDb();
  if (!db) return null;
  return db.transaction(async (tx: any) => {
    let query = tx.select().from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, id)).limit(1);
    if (typeof query.for === "function") query = query.for("update");
    const row = (await query)[0] as StarterRow | undefined;
    if (!row || !(ACTIVE_STATUSES as readonly string[]).includes(row.status) ||
        (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now())) return null;
    const leaseOwner = randomUUID();
    await tx.update(model.ragStarterQuestionSets).set({
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      updatedAt: new Date(),
    }).where(eq(model.ragStarterQuestionSets.id, row.id));
    return { ...row, leaseOwner } as StarterRow;
  });
}

async function renewSetLease(model: ReturnType<typeof intentSkillPorts>, row: StarterRow) {
  const db = await model.getDb();
  const leaseOwner = row.leaseOwner;
  if (!db || !leaseOwner) return false;
  return db.transaction(async (tx: any) => {
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
      status: model.ragStarterQuestionSets.status,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== leaseOwner ||
        !(ACTIVE_STATUSES as readonly string[]).includes(owned.status)) return false;
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    await tx.update(model.ragStarterQuestionSets).set({
      leaseExpiresAt,
      updatedAt: new Date(),
    }).where(and(
      eq(model.ragStarterQuestionSets.id, row.id),
      eq(model.ragStarterQuestionSets.leaseOwner, leaseOwner),
    ));
    row.leaseExpiresAt = leaseExpiresAt;
    return true;
  });
}

async function mutateOwnedActiveSet(
  model: ReturnType<typeof intentSkillPorts>,
  row: StarterRow,
  mutation: (tx: any) => Promise<void>,
) {
  const db = await model.getDb();
  const leaseOwner = row.leaseOwner;
  if (!db || !leaseOwner) return false;
  return db.transaction(async (tx: any) => {
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
      status: model.ragStarterQuestionSets.status,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== leaseOwner ||
        !(ACTIVE_STATUSES as readonly string[]).includes(owned.status)) return false;
    await mutation(tx);
    return true;
  });
}

async function claimProviderCreate(
  model: ReturnType<typeof intentSkillPorts>,
  row: StarterRow,
  task: any,
  runtime: WorkerRuntime,
) {
  const db = await model.getDb();
  const leaseOwner = row.leaseOwner;
  if (!db || !leaseOwner) return { claimed: false, task };
  return db.transaction(async (tx: any) => {
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
      status: model.ragStarterQuestionSets.status,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== leaseOwner ||
        !(ACTIVE_STATUSES as readonly string[]).includes(owned.status)) {
      return { claimed: false, task };
    }
    const [lockedTask] = await tx.select().from(model.agentTasks)
      .where(eq(model.agentTasks.id, row.taskId)).limit(1).for("update");
    if (!lockedTask || lockedTask.providerState !== "queued") {
      return { claimed: false, task: lockedTask ?? task };
    }
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    runtime.createClaimedAt = now.getTime();
    const claimedTask = {
      ...lockedTask,
      providerState: "create_unknown",
      providerRuntime: runtimeContainer(lockedTask, runtime),
      updatedAt: now,
    };
    // Persist the paid-create intent before calling the provider create API.
    // Any later lease owner can only reconcile this exact operation token.
    await tx.update(model.agentTasks).set({
      providerState: claimedTask.providerState,
      providerRuntime: claimedTask.providerRuntime,
      updatedAt: now,
    }).where(eq(model.agentTasks.id, row.taskId));
    await tx.update(model.agentOperations).set({
      status: "running", errorCode: null, updatedAt: now,
    }).where(eq(model.agentOperations.id, row.operationId));
    await tx.update(model.ragStarterQuestionSets).set({
      status: "running", errorCode: null, leaseExpiresAt, updatedAt: now,
    }).where(and(
      eq(model.ragStarterQuestionSets.id, row.id),
      eq(model.ragStarterQuestionSets.leaseOwner, leaseOwner),
    ));
    row.leaseExpiresAt = leaseExpiresAt;
    return { claimed: true, task: claimedTask };
  });
}

async function frozenSnapshot(model: ReturnType<typeof intentSkillPorts>, row: StarterRow) {
  const db = await model.getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [snapshot] = await db.select().from(model.knowledgeBaseSnapshots).where(and(
    eq(model.knowledgeBaseSnapshots.id, row.knowledgeSnapshotId),
    eq(model.knowledgeBaseSnapshots.userId, row.userId),
    projectCondition(model.knowledgeBaseSnapshots.enterpriseProjectId, row.enterpriseProjectId),
  )).limit(1);
  if (!snapshot || snapshot.version !== row.knowledgeSnapshotVersion ||
      snapshot.archiveHash !== row.knowledgeArchiveHash ||
      ragStarterKnowledgeContentHash(snapshot.documents) !== row.knowledgeContentHash) {
    throw Object.assign(new Error("KNOWLEDGE_UNAVAILABLE"), { terminal: true });
  }
  const sources = ragStarterSourceCatalog(snapshot.documents);
  if (!sources.length) throw Object.assign(new Error("NO_USABLE_KNOWLEDGE"), { terminal: true });
  return { snapshot, sources };
}

async function ensureLedger(
  model: ReturnType<typeof intentSkillPorts>,
  row: StarterRow,
  sources: ReturnType<typeof ragStarterSourceCatalog>,
) {
  const db = await model.getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [existing] = await db.select({ operation: model.agentOperations, task: model.agentTasks })
    .from(model.agentOperations)
    .innerJoin(model.agentTasks, eq(model.agentTasks.operationId, model.agentOperations.id))
    .where(and(eq(model.agentOperations.id, row.operationId),
      eq(model.agentTasks.id, row.taskId))).limit(1);
  if (existing) return existing;
  await model.assertServiceCapability(row.userId, "knowledgeBuild");
  const [status, credential] = await Promise.all([
    model.getApiCredentialStatus(row.userId),
    model.getDecryptedCredentialForUser(row.userId),
  ]);
  if (!credential || credential.status !== "active" || !credential.verifiedAt ||
      status.status !== "active" || !status.verifiedAt || status.version !== credential.version) {
    throw Object.assign(new Error("MODEL_UNAVAILABLE"), { terminal: true });
  }
  const operationToken = `rag-starter:${row.id}`;
  const runtime: WorkerRuntime = {
    schemaVersion: 1,
    setId: row.id,
    operationToken,
    inputHash: row.requestHash,
    snapshotId: row.knowledgeSnapshotId,
    snapshotVersion: row.knowledgeSnapshotVersion,
    archiveHash: row.knowledgeArchiveHash,
    contentHash: row.knowledgeContentHash,
    credentialId: credential.id,
    credentialVersion: credential.version,
    createdAt: new Date().toISOString(),
  };
  const runtimeModel = ragStarterManagedBaseRuntime(credential.provider);
  const reserved = await db.transaction(async (tx: any) => {
    const [activeSet] = await tx.select({
      status: model.ragStarterQuestionSets.status,
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (activeSet?.leaseOwner !== row.leaseOwner ||
        !(ACTIVE_STATUSES as readonly string[]).includes(activeSet.status)) {
      return false;
    }
    const [replay] = await tx.select({ operation: model.agentOperations, task: model.agentTasks })
      .from(model.agentOperations)
      .innerJoin(model.agentTasks, eq(model.agentTasks.operationId, model.agentOperations.id))
      .where(and(eq(model.agentOperations.id, row.operationId),
        eq(model.agentTasks.id, row.taskId))).limit(1);
    if (replay) return true;
    await tx.insert(model.agentOperations).values({
      id: row.operationId,
      enterpriseProjectId: row.enterpriseProjectId,
      provider: credential.provider,
      scope: "managed_user",
      accountUserId: row.userId,
      presalesProjectId: null,
      operationType: OPERATION_TYPE,
      idempotencyKeyHash: row.generationKeyHash,
      requestHash: row.requestHash,
      contractName: OPERATION_TYPE,
      contractRevision: CONTRACT_REVISION,
      schemaHash: ragStarterHash(z.toJSONSchema(generatedRagStarterQuestionsSchema, { target: "draft-7" })),
      apiCredentialId: credential.id,
      credentialVersion: credential.version,
      publicProfile: runtimeModel.publicProfile,
      upstreamModel: runtimeModel.model,
      status: "queued",
    });
    await tx.insert(model.agentTasks).values({
      id: row.taskId,
      operationId: row.operationId,
      providerTaskId: null,
      providerRequestId: null,
      createMarker: operationToken,
      title: `FrontMind RAG starter ${row.id}`,
      providerState: "queued",
      providerRuntime: { ragStarterQuestions: runtime, sourceAliases: sources.map((item) => item.alias) },
    });
    return true;
  });
  if (!reserved) return null;
  const [created] = await db.select({ operation: model.agentOperations, task: model.agentTasks })
    .from(model.agentOperations)
    .innerJoin(model.agentTasks, eq(model.agentTasks.operationId, model.agentOperations.id))
    .where(and(eq(model.agentOperations.id, row.operationId),
      eq(model.agentTasks.id, row.taskId))).limit(1);
  if (!created) throw new Error("STARTER_LEDGER_RESERVATION_LOST");
  return created;
}

async function publishDraft(
  model: ReturnType<typeof intentSkillPorts>,
  row: StarterRow,
  questions: [RagStarterQuestionEvidence, RagStarterQuestionEvidence, RagStarterQuestionEvidence],
) {
  const db = await model.getDb();
  if (!db || !row.leaseOwner) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async (tx: any) => {
    await model.lockCustomerProjectBusinessWrite(tx, row.userId);
    await model.lockAccountRecord(tx, row.userId);
    const [owned] = await tx.select({
      leaseOwner: model.ragStarterQuestionSets.leaseOwner,
    }).from(model.ragStarterQuestionSets)
      .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
    if (owned?.leaseOwner !== row.leaseOwner) return false;
    const [activeSnapshot] = await tx.select({ id: model.knowledgeBaseSnapshots.id })
      .from(model.knowledgeBaseSnapshots).where(and(
        eq(model.knowledgeBaseSnapshots.userId, row.userId),
        projectCondition(model.knowledgeBaseSnapshots.enterpriseProjectId, row.enterpriseProjectId),
        eq(model.knowledgeBaseSnapshots.status, "active"),
      )).orderBy(desc(model.knowledgeBaseSnapshots.version)).limit(1).for("update");
    const revision = await nextRagStarterWorkspaceRevision(
      tx, model.ragStarterQuestionSets, row.userId, row.enterpriseProjectId);
    const now = new Date();
    if (ragStarterLateResultDisposition(activeSnapshot?.id, row.knowledgeSnapshotId) === "superseded") {
      await tx.update(model.ragStarterQuestionSets).set({
        status: "superseded", workspaceRevision: revision,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
      }).where(eq(model.ragStarterQuestionSets.id, row.id));
    } else {
      await tx.update(model.ragStarterQuestionSets).set({
        status: "superseded", workspaceRevision: revision, updatedAt: now,
      }).where(and(
        ragStarterOwnerCondition(model.ragStarterQuestionSets, row.userId, row.enterpriseProjectId),
        eq(model.ragStarterQuestionSets.status, "draft_ready"),
      ));
      await tx.update(model.ragStarterQuestionSets).set({
        status: "draft_ready", questions, errorCode: null,
        workspaceRevision: revision, leaseOwner: null, leaseExpiresAt: null,
        nextAttemptAt: null, updatedAt: now,
      }).where(eq(model.ragStarterQuestionSets.id, row.id));
    }
    await tx.update(model.agentOperations).set({
      status: "succeeded", errorCode: null, updatedAt: now,
    }).where(eq(model.agentOperations.id, row.operationId));
    await tx.update(model.agentTasks).set({
      providerState: "completed", lastMessageSyncAt: now, updatedAt: now,
    }).where(eq(model.agentTasks.id, row.taskId));
    return true;
  });
}

export function ragStarterProviderCreatePrompt(operationToken: string) {
  return "完整读取附件，只返回符合结构化 schema 的 JSON。问题中不得夹带答案。" +
    "来源别名必须从附件白名单逐字复制。\n" +
    `FRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({ operationToken })}`;
}

async function processSet(model: ReturnType<typeof intentSkillPorts>, candidate: StarterRow) {
  const row = await acquireSet(model, candidate.id);
  if (!row) return false;
  try {
    const { sources } = await frozenSnapshot(model, row);
    let owned = await ensureLedger(model, row, sources);
    if (!owned) return true;
    let task = owned.task;
    const runtime = runtimeFromTask(task);
    const oneShotReconcile = runtime.reconcileOnce === true;
    if (Date.now() - Date.parse(runtime.createdAt) > MAX_EXECUTION_MS && !oneShotReconcile) {
      await failSet(model, row, "GENERATION_TIMEOUT", true);
      return true;
    }
    const credential = await model.getDecryptedCredentialForAccountById(row.userId, runtime.credentialId);
    if (!credential || credential.version !== runtime.credentialVersion) {
      // Once create has been claimed or an upstream id exists, a credential
      // read failure cannot prove that the paid task did not run. Preserve an
      // uncertainty fence so no explicit retry allocates a replacement.
      await failSet(model, row, ragStarterCredentialUnavailableCode(task, runtime), true);
      return true;
    }
    const selected = ragStarterManagedBaseRuntime(credential.provider);
    const client = model.createCredentialAgentClient(credential, {
      accountUserId: row.userId,
      operationId: row.operationId,
      localTaskId: row.taskId,
      intentId: row.operationId,
      model: selected.model,
      effort: selected.effort,
    });
    const db = await model.getDb();
    if (!db) throw new Error("DATABASE_UNAVAILABLE");
    if (oneShotReconcile) {
      delete runtime.reconcileOnce;
      const cleared = await mutateOwnedActiveSet(model, row, async tx => {
        await tx.update(model.agentTasks).set({
          providerRuntime: runtimeContainer(task, runtime),
          updatedAt: new Date(),
        }).where(eq(model.agentTasks.id, row.taskId));
      });
      if (!cleared) return true;
      task = { ...task, providerRuntime: runtimeContainer(task, runtime) };
    }
    let dispatchAction = ragStarterProviderDispatchAction(task);
    if (dispatchAction === "create") {
      if (!await renewSetLease(model, row)) return true;
      const input = {
        operationToken: runtime.operationToken,
        inputHash: runtime.inputHash,
        instruction: "基于附件中的企业知识生成三个简洁、不重复、可直接向企业助手提问的入口问题。不得输出答案、营销结论或无依据事实。每个问题必须引用至少一个来源别名。",
        sources,
      };
      const uploaded = await client.uploadFile({
        filename: "frontmind-rag-starter-input.json",
        bytes: Buffer.from(JSON.stringify(input), "utf8"),
        contentType: "application/json",
        observer: { onCandidateCreated: async ({ fileId }: { fileId: string }) =>
          model.recordUpstreamResource({ userId: row.userId, apiCredentialId: runtime.credentialId,
            kind: "file", upstreamId: fileId }) },
      });
      if (!await renewSetLease(model, row)) return true;
      const claim = await claimProviderCreate(model, row, task, runtime);
      task = claim.task;
      if (!claim.claimed) {
        dispatchAction = ragStarterProviderDispatchAction(task);
        if (dispatchAction === "create") return true;
      } else {
        try {
          const created = await client.createTask({
            title: task.title,
            prompt: ragStarterProviderCreatePrompt(runtime.operationToken),
            attachments: [{ file_id: uploaded.fileId, filename: "frontmind-rag-starter-input.json" }],
            agentProfile: selected.model,
            locale: "zh-CN",
            interactiveMode: false,
            structuredOutputSchema: z.toJSONSchema(generatedRagStarterQuestionsSchema, { target: "draft-7" }),
          });
          await model.recordUpstreamResource({ userId: row.userId, apiCredentialId: runtime.credentialId,
            kind: "task", upstreamId: created.taskId });
          if (await renewSetLease(model, row)) {
            await db.transaction(async (tx: any) => {
              const [owned] = await tx.select({
                leaseOwner: model.ragStarterQuestionSets.leaseOwner,
              }).from(model.ragStarterQuestionSets)
                .where(eq(model.ragStarterQuestionSets.id, row.id)).limit(1).for("update");
              if (owned?.leaseOwner !== row.leaseOwner) return;
              await tx.update(model.agentTasks).set({
                providerTaskId: created.taskId,
                providerRequestId: created.requestId ?? null,
                providerState: "running",
                updatedAt: new Date(),
              }).where(eq(model.agentTasks.id, row.taskId));
              await tx.update(model.ragStarterQuestionSets).set({
                status: "running", updatedAt: new Date(),
              }).where(and(
                eq(model.ragStarterQuestionSets.id, row.id),
                eq(model.ragStarterQuestionSets.leaseOwner, row.leaseOwner!),
              ));
            });
          }
          return true;
        } catch (error) {
          if (error instanceof model.ManusV2ApiError && !error.outcomeUnknown) {
            await failSet(model, row, "PROVIDER_FAILED");
          }
          // Unknown create remains create_unknown. A later pass only looks up
          // this exact operation token and never sends another create request.
          return true;
        }
      }
    }
    let providerTaskId = task.providerTaskId as string | null;
    if (dispatchAction === "reconcile_create") {
      if (!await renewSetLease(model, row)) return true;
      const found = await client.findCreatedTask({
        title: task.title,
        operationToken: runtime.operationToken,
        createdAfterSeconds: Math.floor(Date.parse(runtime.createdAt) / 1000) - 60,
        createdBeforeSeconds: Math.floor(Date.now() / 1000) + 60,
      });
      if (found.matches.length > 1) {
        await failSet(model, row, "CREATE_UNKNOWN", true);
        return true;
      }
      if (!found.unique) {
        if (oneShotReconcile) {
          await failSet(model, row, "GENERATION_TIMEOUT", true);
          return true;
        }
        if (Date.now() - (runtime.createClaimedAt ?? Date.parse(runtime.createdAt)) > CREATE_RECONCILE_MS) {
          await failSet(model, row, "CREATE_UNKNOWN", true);
        }
        return true;
      }
      providerTaskId = String(found.unique.id);
      if (!await renewSetLease(model, row)) return true;
      const reconciled = await mutateOwnedActiveSet(model, row, async tx => {
        await tx.update(model.agentTasks).set({
          providerTaskId, providerState: "running", updatedAt: new Date(),
        }).where(eq(model.agentTasks.id, row.taskId));
      });
      if (!reconciled) return true;
      await model.recordUpstreamResource({ userId: row.userId, apiCredentialId: runtime.credentialId,
        kind: "task", upstreamId: providerTaskId });
    }
    if (!providerTaskId) return true;
    if (!await renewSetLease(model, row)) return true;
    const events = await client.listAllMessages({ taskId: providerTaskId, order: "asc" });
    const resultEvent = model.orderManusV2EventsByProviderRank(events, "newest_first")
      .find((event: any) => event.type === "structured_output_result") as any;
    if (resultEvent) {
      let questions: [RagStarterQuestionEvidence, RagStarterQuestionEvidence, RagStarterQuestionEvidence];
      try {
        const classified = model.classifyManusV2StructuredResultEnvelope(
          resultEvent.structured_output_result);
        if (classified.kind !== "accepted") throw new Error("RESULT_INVALID");
        questions = parseGeneratedRagStarterQuestions(classified.value, {
          operationToken: runtime.operationToken,
          inputHash: runtime.inputHash,
          allowedSourceAliases: new Set(sources.map((source) => source.alias)),
        });
      } catch {
        await failSet(model, row, "RESULT_INVALID", true);
        return true;
      }
      // A valid provider result is immutable. Database/lease failures while
      // publishing are transient and must keep observing this same task.
      await publishDraft(model, row, questions);
      return true;
    }
    let state = model.latestManusV2TaskState(events);
    if (!state) {
      if (!await renewSetLease(model, row)) return true;
      state = (await client.taskDetail(providerTaskId)).status;
    }
    if (["error", "failed", "cancelled"].includes(String(state))) {
      await failSet(model, row, "PROVIDER_FAILED");
      return true;
    }
    if (["finished", "completed", "stopped"].includes(String(state))) {
      if (!runtime.resultPendingAt) {
        runtime.resultPendingAt = Date.now();
        await mutateOwnedActiveSet(model, row, async tx => {
          const now = new Date();
          await tx.update(model.agentTasks).set({
            providerState: "result_pending",
            providerRuntime: runtimeContainer(task, runtime),
            lastMessageSyncAt: now,
            updatedAt: now,
          }).where(eq(model.agentTasks.id, row.taskId));
          await tx.update(model.agentOperations).set({
            status: "result_pending", updatedAt: now,
          }).where(eq(model.agentOperations.id, row.operationId));
          await tx.update(model.ragStarterQuestionSets).set({
            status: "result_pending", updatedAt: now,
          }).where(and(
            eq(model.ragStarterQuestionSets.id, row.id),
            eq(model.ragStarterQuestionSets.leaseOwner, row.leaseOwner!),
            inArray(model.ragStarterQuestionSets.status, [...ACTIVE_STATUSES]),
          ));
        });
      }
    }
    if (oneShotReconcile) await failSet(model, row, "GENERATION_TIMEOUT", true);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message : "STARTER_TRANSIENT_FAILURE";
    if (error && typeof error === "object" && "terminal" in error) {
      await failSet(model, row, code, true);
    } else {
      await retrySet(model, row);
    }
    return false;
  } finally {
    const db = await model.getDb();
    if (db) await db.update(model.ragStarterQuestionSets).set({
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(and(eq(model.ragStarterQuestionSets.id, row.id),
      eq(model.ragStarterQuestionSets.leaseOwner, row.leaseOwner!)));
  }
}

/** Durable provider progression. Reads are never routed through this function. */
export async function runRagStarterQuestionWorkerSweep(options: { max?: number } = {}) {
  const model = intentSkillPorts();
  const db = await model.getDb();
  if (!db) return { advanced: 0, deferred: 0 };
  const limit = Math.max(1, Math.min(options.max ?? 20, 40));
  const now = new Date();
  const rows = await db.select().from(model.ragStarterQuestionSets).where(and(
    inArray(model.ragStarterQuestionSets.status, [...ACTIVE_STATUSES]),
    or(isNull(model.ragStarterQuestionSets.nextAttemptAt),
      lte(model.ragStarterQuestionSets.nextAttemptAt, now)),
    or(isNull(model.ragStarterQuestionSets.leaseExpiresAt),
      lte(model.ragStarterQuestionSets.leaseExpiresAt, now)),
  )).orderBy(asc(model.ragStarterQuestionSets.createdAt),
    asc(model.ragStarterQuestionSets.id)).limit(limit) as StarterRow[];
  let advanced = 0;
  let deferred = 0;
  const activeProjects = new Set<string>();
  for (const row of rows) {
    const projectKey = `${row.userId}:${row.enterpriseProjectId ?? "legacy"}`;
    if (activeProjects.has(projectKey)) { deferred += 1; continue; }
    activeProjects.add(projectKey);
    try {
      await model.runWithStoredEnterpriseProjectScope(
        row.userId,
        row.enterpriseProjectId,
        () => processSet(model, row),
      );
      advanced += 1;
    } catch {
      deferred += 1;
    }
  }
  return { advanced, deferred };
}

export const ragStarterWorkerConstants = {
  OPERATION_TYPE,
  CONTRACT_REVISION,
  LEASE_MS,
  CREATE_RECONCILE_MS,
  MAX_EXECUTION_MS,
};
