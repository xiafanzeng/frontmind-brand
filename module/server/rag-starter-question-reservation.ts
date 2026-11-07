import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BrandSchema, KnowledgeDocumentRecord } from "../schema/index.js";
import { RAG_STARTER_PROMPT_VERSION } from "../contracts/rag-starter-questions.js";
import type { BrandKeywordPorts } from "./brand-keyword-ports.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function ragStarterHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

export function ragStarterKnowledgeContentHash(documents: readonly KnowledgeDocumentRecord[]) {
  return ragStarterHash(documents.map((document) => ({
    id: document.id ?? null,
    path: document.path,
    title: document.title,
    content: document.content,
    customerVisible: document.customerVisible !== false,
    evidenceStatus: document.evidenceStatus ?? null,
  })));
}

export function ragStarterSourceCatalog(documents: readonly KnowledgeDocumentRecord[]) {
  return documents
    .filter((document) => document.customerVisible !== false && document.content.trim())
    .sort((left, right) => `${left.path}\u0000${left.title}`.localeCompare(`${right.path}\u0000${right.title}`))
    .slice(0, 120)
    .map((document, index) => ({
      alias: `KB-${String(index + 1).padStart(3, "0")}`,
      path: document.path,
      title: document.title,
      // A bounded frozen input prevents a large knowledge base from exceeding
      // provider request limits while aliases remain deterministic.
      content: document.content.trim().slice(0, 12_000),
    }));
}

function ownerCondition(
  table: BrandSchema["ragStarterQuestionSets"],
  userId: number,
  enterpriseProjectId: string | null,
) {
  return and(
    eq(table.userId, userId),
    sql`${table.enterpriseProjectId} <=> ${enterpriseProjectId}`,
  );
}

export async function nextRagStarterWorkspaceRevision(
  tx: any,
  table: BrandSchema["ragStarterQuestionSets"],
  userId: number,
  enterpriseProjectId: string | null,
) {
  const [latest] = await tx.select({ revision: table.workspaceRevision })
    .from(table)
    .where(ownerCondition(table, userId, enterpriseProjectId))
    .orderBy(desc(table.workspaceRevision))
    .limit(1);
  return Number(latest?.revision ?? 0) + 1;
}

export type RagStarterReservationInput = {
  tx: any;
  table: BrandSchema["ragStarterQuestionSets"];
  agentOperations: BrandKeywordPorts["agentOperations"];
  agentTasks: BrandKeywordPorts["agentTasks"];
  enterpriseProjectId: string | null;
  userId: number;
  snapshot: {
    id: string;
    version: number;
    archiveHash: string | null;
    documents: KnowledgeDocumentRecord[];
  };
  source: "automatic" | "regenerate";
  clientRequestId?: string | null;
};

export async function reserveRagStarterQuestionSet(input: RagStarterReservationInput) {
  const contentHash = ragStarterKnowledgeContentHash(input.snapshot.documents);
  const generationCoordinate = input.source === "automatic"
    ? [input.userId, input.enterpriseProjectId, input.snapshot.id,
        input.snapshot.version, input.snapshot.archiveHash, contentHash,
        RAG_STARTER_PROMPT_VERSION, "automatic"]
    : [input.userId, input.enterpriseProjectId, input.snapshot.id,
        input.snapshot.version, input.snapshot.archiveHash, contentHash,
        RAG_STARTER_PROMPT_VERSION, "regenerate", input.clientRequestId];
  const generationKeyHash = ragStarterHash(generationCoordinate);
  const [existing] = await input.tx.select().from(input.table)
    .where(eq(input.table.generationKeyHash, generationKeyHash)).limit(1);
  if (existing) return { row: existing, acquired: false as const };

  const [latestOrdinal] = await input.tx.select({ ordinal: input.table.ordinal })
    .from(input.table)
    .where(ownerCondition(input.table, input.userId, input.enterpriseProjectId))
    .orderBy(desc(input.table.ordinal))
    .limit(1);
  const workspaceRevision = await nextRagStarterWorkspaceRevision(
    input.tx,
    input.table,
    input.userId,
    input.enterpriseProjectId,
  );
  const now = new Date();
  // A new snapshot/regeneration invalidates only unconfirmed work that has not
  // entered provider execution. Running work remains readable so its original
  // task can be reconciled rather than silently abandoned or duplicated.
  const replaceable = await input.tx.select({
    id: input.table.id,
    operationId: input.table.operationId,
    taskId: input.table.taskId,
    status: input.table.status,
    errorCode: input.table.errorCode,
  }).from(input.table).where(and(
    ownerCondition(input.table, input.userId, input.enterpriseProjectId),
    inArray(input.table.status, ["queued", "draft_ready", "failed", "attention_required"]),
  )).for("update");
  const safeToSupersede: string[] = [];
  for (const row of replaceable) {
    const [task] = await input.tx.select({
      providerState: input.agentTasks.providerState,
      providerTaskId: input.agentTasks.providerTaskId,
      providerRuntime: input.agentTasks.providerRuntime,
    }).from(input.agentTasks).where(and(
      eq(input.agentTasks.id, row.taskId),
      eq(input.agentTasks.operationId, row.operationId),
    )).limit(1).for("update");
    const createClaimedAt = (task?.providerRuntime as {
      ragStarterQuestions?: { createClaimedAt?: unknown };
    } | null | undefined)?.ragStarterQuestions?.createClaimedAt;
    const createMayHaveRun = Boolean(task && (
      task.providerTaskId ||
      typeof createClaimedAt === "number" ||
      ["create_unknown", "running", "result_pending"].includes(task.providerState)
    ));
    const requiresOriginalTaskReconciliation = createMayHaveRun && (
      row.status === "queued" ||
      (row.status === "attention_required" &&
        ["CREATE_UNKNOWN", "GENERATION_TIMEOUT"].includes(row.errorCode ?? ""))
    );
    if (requiresOriginalTaskReconciliation) {
      // Keep every claimed/unknown task sweepable. The old result will be
      // discarded by the active-snapshot disposition, but no newer snapshot
      // may strand it and race a second paid create.
      await input.tx.update(input.table).set({
        status: "running",
        errorCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        updatedAt: now,
      }).where(eq(input.table.id, row.id));
      continue;
    }
    // This is the only safe cancellation point: no paid create intent has
    // been claimed and no upstream task can exist.
    if (task?.providerState === "queued" && !task.providerTaskId) {
      await input.tx.update(input.agentTasks).set({
        providerState: "cancelled",
        updatedAt: now,
      }).where(and(
        eq(input.agentTasks.id, row.taskId),
        eq(input.agentTasks.operationId, row.operationId),
        eq(input.agentTasks.providerState, "queued"),
      ));
      await input.tx.update(input.agentOperations).set({
        status: "cancelled",
        errorCode: "STARTER_SUPERSEDED_BEFORE_CREATE",
        updatedAt: now,
      }).where(eq(input.agentOperations.id, row.operationId));
    }
    safeToSupersede.push(row.id);
  }
  if (safeToSupersede.length) {
    await input.tx.update(input.table).set({
      status: "superseded",
      workspaceRevision,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      updatedAt: now,
    }).where(inArray(input.table.id, safeToSupersede));
  }

  const id = randomUUID();
  const operationId = randomUUID();
  const taskId = randomUUID();
  const requestHash = ragStarterHash({
    snapshotId: input.snapshot.id,
    snapshotVersion: input.snapshot.version,
    archiveHash: input.snapshot.archiveHash,
    contentHash,
    promptVersion: RAG_STARTER_PROMPT_VERSION,
  });
  const row = {
    id,
    enterpriseProjectId: input.enterpriseProjectId,
    userId: input.userId,
    knowledgeSnapshotId: input.snapshot.id,
    knowledgeSnapshotVersion: input.snapshot.version,
    knowledgeArchiveHash: input.snapshot.archiveHash,
    knowledgeContentHash: contentHash,
    ordinal: Number(latestOrdinal?.ordinal ?? 0) + 1,
    source: input.source,
    status: "queued" as const,
    generationKeyHash,
    clientRequestId: input.clientRequestId ?? null,
    requestHash,
    promptVersion: RAG_STARTER_PROMPT_VERSION,
    operationId,
    taskId,
    questions: null,
    errorCode: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: now,
    attemptCount: 0,
    workspaceRevision,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await input.tx.insert(input.table).values(row);
  return { row, acquired: true as const };
}

export { ownerCondition as ragStarterOwnerCondition };
