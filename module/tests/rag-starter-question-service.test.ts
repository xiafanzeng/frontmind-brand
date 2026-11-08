// @vitest-environment node
import type { Request } from "express";
import { MySqlDialect, int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandKeywordPorts } from "../server/brand-keyword-ports";
import type { ModuleHttpCore } from "../server/http-api";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime";
import { reserveRagStarterQuestionSet } from "../server/rag-starter-question-reservation";
import {
  bootstrapCurrentProjectRagStarterQuestions,
  createRagStarterQuestionService,
  RAG_STARTER_PROVIDER_INSTRUCTION,
  ragStarterCredentialUnavailableCode,
  ragStarterLateResultDisposition,
  ragStarterManagedBaseRuntime,
  ragStarterProviderCreatePrompt,
  ragStarterProviderDispatchAction,
  runRagStarterQuestionWorkerSweep,
} from "../server/rag-starter-question-service";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000002";
const CURRENT_ID = "00000000-0000-4000-8000-000000000003";
const FAILED_ID = "00000000-0000-4000-8000-000000000004";
const OPERATION_ID = "00000000-0000-4000-8000-000000000005";
const TASK_ID = "00000000-0000-4000-8000-000000000006";

const snapshots = mysqlTable("starter_snapshot_test", {
  enterpriseProjectId: varchar("enterprise_project_id", { length: 36 }),
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  version: int("version").notNull(),
  archiveHash: varchar("archive_hash", { length: 64 }),
  documents: json("documents").notNull(),
  documentCount: int("document_count").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

const sets = mysqlTable("starter_set_test", {
  enterpriseProjectId: varchar("enterprise_project_id", { length: 36 }),
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  knowledgeSnapshotId: varchar("snapshot_id", { length: 36 }).notNull(),
  knowledgeSnapshotVersion: int("snapshot_version").notNull(),
  knowledgeArchiveHash: varchar("archive_hash", { length: 64 }),
  knowledgeContentHash: varchar("content_hash", { length: 64 }).notNull(),
  ordinal: int("ordinal").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  generationKeyHash: varchar("generation_key_hash", { length: 64 }).notNull(),
  clientRequestId: varchar("client_request_id", { length: 36 }),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
  operationId: varchar("operation_id", { length: 36 }).notNull(),
  taskId: varchar("task_id", { length: 36 }).notNull(),
  questions: json("questions"),
  errorCode: varchar("error_code", { length: 128 }),
  leaseOwner: varchar("lease_owner", { length: 36 }),
  leaseExpiresAt: timestamp("lease_expires_at"),
  nextAttemptAt: timestamp("next_attempt_at"),
  attemptCount: int("attempt_count").notNull(),
  workspaceRevision: int("workspace_revision").notNull(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

const operations = mysqlTable("starter_operation_test", {
  id: varchar("id", { length: 36 }).primaryKey(),
  status: varchar("status", { length: 32 }).notNull(),
  errorCode: varchar("error_code", { length: 128 }),
  updatedAt: timestamp("updated_at").notNull(),
});

const tasks = mysqlTable("starter_task_test", {
  id: varchar("id", { length: 36 }).primaryKey(),
  operationId: varchar("operation_id", { length: 36 }).notNull(),
  providerTaskId: varchar("provider_task_id", { length: 128 }),
  providerRequestId: varchar("provider_request_id", { length: 128 }),
  createMarker: varchar("create_marker", { length: 160 }),
  title: varchar("title", { length: 255 }),
  providerState: varchar("provider_state", { length: 32 }).notNull(),
  providerRuntime: json("provider_runtime"),
  lastMessageSyncAt: timestamp("last_message_sync_at"),
  updatedAt: timestamp("updated_at").notNull(),
});

type Row = Record<string, any>;

function baseSnapshot() {
  return {
    enterpriseProjectId: PROJECT_ID,
    id: SNAPSHOT_ID,
    userId: 42,
    version: 7,
    archiveHash: "a".repeat(64),
    documents: [{
      id: "doc-1",
      path: "company/services.md",
      title: "企业服务",
      content: "我们为企业提供咨询和交付服务。",
      customerVisible: true,
    }],
    documentCount: 1,
    status: "active",
    createdAt: new Date("2026-11-07T10:00:00.000Z"),
  };
}

function setRow(overrides: Row = {}) {
  return {
    enterpriseProjectId: PROJECT_ID,
    id: CURRENT_ID,
    userId: 42,
    knowledgeSnapshotId: SNAPSHOT_ID,
    knowledgeSnapshotVersion: 7,
    knowledgeArchiveHash: "a".repeat(64),
    knowledgeContentHash: "b".repeat(64),
    ordinal: 1,
    source: "manual",
    status: "confirmed",
    generationKeyHash: "c".repeat(64),
    clientRequestId: null,
    requestHash: "d".repeat(64),
    promptVersion: "manual-v1",
    operationId: OPERATION_ID,
    taskId: TASK_ID,
    questions: [
      { text: "你们提供哪些服务？", sourceAliases: [] },
      { text: "如何联系你们？", sourceAliases: [] },
      { text: "有哪些核心优势？", sourceAliases: [] },
    ],
    errorCode: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    attemptCount: 0,
    workspaceRevision: 1,
    confirmedAt: new Date("2026-11-07T10:01:00.000Z"),
    createdAt: new Date("2026-11-07T10:01:00.000Z"),
    updatedAt: new Date("2026-11-07T10:01:00.000Z"),
    ...overrides,
  };
}

function harness(initialSets: Row[] = []) {
  const snapshotRows: Row[] = [baseSnapshot()];
  const setRows = initialSets.map((row) => ({ ...row }));
  const operationRows: Row[] = [];
  const taskRows: Row[] = [];
  const dialect = new MySqlDialect();
  class TestManusV2ApiError extends Error {
    status = null;
    providerRequestId = null;
    code = "TEST_PROVIDER_ERROR";
    retryable = true;
    constructor(readonly outcomeUnknown: boolean) {
      super("TEST_PROVIDER_ERROR");
    }
  }
  let draftPublishFailures = 0;
  const providerClient = {
    uploadFile: vi.fn(async () => ({ fileId: "provider-file-1" })),
    createTask: vi.fn(async () => ({ taskId: "provider-task-1", requestId: "provider-request-1" })),
    findCreatedTask: vi.fn(async () => ({ matches: [], unique: null })),
    listAllMessages: vi.fn(async () => [] as Row[]),
    taskDetail: vi.fn(async () => ({ status: "running" })),
    sendMessage: vi.fn(),
  };
  const provider = {
    getCredential: vi.fn(),
    getStatus: vi.fn(async () => ({ status: "active", verifiedAt: new Date(), version: 1 })),
    createClient: vi.fn(() => providerClient),
    capability: vi.fn(async () => undefined),
    recordResource: vi.fn(async () => undefined),
    client: providerClient,
    enableCredential() {
      this.getCredential.mockResolvedValue({
        id: "credential-1",
        userId: 42,
        version: 1,
        credentialRef: "test",
        fingerprint: "test",
        status: "active",
        verifiedAt: new Date(),
        agentProfile: "frontmind-base",
        provider: "manus",
        upstreamModel: "manus-1.6",
        upstreamEffort: "high",
      });
    },
    failNextDraftPublish() { draftPublishFailures += 1; },
    unknownCreateError() { return new TestManusV2ApiError(true); },
  };

  function values(predicate: any): unknown[] {
    return predicate ? dialect.sqlToQuery(predicate).params : [];
  }
  function rowsFor(table: any) {
    if (table === snapshots) return snapshotRows;
    if (table === sets) return setRows;
    if (table === operations) return operationRows;
    if (table === tasks) return taskRows;
    return [];
  }
  function matches(row: Row, predicate: any, table: any) {
    const params = values(predicate);
    const statement = predicate ? dialect.sqlToQuery(predicate).sql : "";
    const id = params.find((value) => typeof value === "string" &&
      rowsFor(table).some((candidate) => candidate.id === value));
    if (id && row.id !== id) return false;
    const hash = params.find((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
    if (table === sets && statement.includes("generation_key_hash") && row.generationKeyHash !== hash) return false;
    const snapshotId = params.find((value) => snapshotRows.some((snapshot) => snapshot.id === value));
    if (table === sets && snapshotId && row.knowledgeSnapshotId !== snapshotId) return false;
    const statuses = params.filter((value) => typeof value === "string" && [
      "queued", "running", "result_pending", "draft_ready", "confirmed",
      "failed", "attention_required", "superseded",
    ].includes(value));
    if (statuses.length && row.status && !statuses.includes(row.status)) return false;
    if (table === sets && statement.includes("error_code") && statement.includes("<>") &&
        typeof row.errorCode === "string" && params.includes(row.errorCode)) return false;
    return true;
  }
  function project(fields: Row | undefined, row: Row) {
    if (!fields) return row;
    return Object.fromEntries(Object.keys(fields).map((key) => [key,
      key === "revision" ? row.workspaceRevision : row[key],
    ]));
  }

  class Query implements PromiseLike<Row[]> {
    private table: any;
    private joinedTable: any;
    private predicate: any;
    private maximum = Number.POSITIVE_INFINITY;
    constructor(private readonly fields?: Row) {}
    from(table: any) { this.table = table; return this; }
    innerJoin(table: any) { this.joinedTable = table; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    orderBy() { return this; }
    limit(maximum: number) { this.maximum = maximum; return this; }
    for() { return this; }
    private run() {
      if (this.table === operations && this.joinedTable === tasks) {
        const params = values(this.predicate);
        const knownIds = new Set([
          ...operationRows.map((row) => row.id),
          ...taskRows.map((row) => row.id),
        ]);
        return operationRows.flatMap((operation) => taskRows
          .filter((task) => task.operationId === operation.id)
          .filter((task) => params
            .filter((value) => knownIds.has(value))
            .every((value) => value === operation.id || value === task.id))
          .map((task) => this.fields?.operation === operations && this.fields?.task === tasks
            ? { operation, task }
            : project(this.fields, operation)))
          .slice(0, this.maximum);
      }
      return rowsFor(this.table)
        .filter((row) => matches(row, this.predicate, this.table))
        .slice()
        .sort((left, right) => Number(right.workspaceRevision ?? right.version ?? 0) -
          Number(left.workspaceRevision ?? left.version ?? 0))
        .slice(0, this.maximum)
        .map((row) => project(this.fields, row));
    }
    then<TResult1 = Row[], TResult2 = never>(onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  const db: any = {
    select: (fields?: Row) => new Query(fields),
    insert: (table: any) => ({ values: async (input: Row | Row[]) => {
      rowsFor(table).push(...(Array.isArray(input) ? input : [input]).map((row) => ({ ...row })));
    } }),
    update: (table: any) => ({ set: (patch: Row) => ({ where: async (predicate: any) => {
      if (table === sets && patch.status === "draft_ready" && draftPublishFailures > 0) {
        draftPublishFailures -= 1;
        throw new Error("TEST_TRANSIENT_DRAFT_WRITE");
      }
      for (const row of rowsFor(table)) if (matches(row, predicate, table)) Object.assign(row, patch);
    } }) }),
    transaction: async (run: (tx: any) => unknown) => run(db),
  };

  const ports = {
    ragStarterQuestionSets: sets,
    knowledgeBaseSnapshots: snapshots,
    agentOperations: operations,
    agentTasks: tasks,
    getDb: async () => db,
    currentEnterpriseProjectId: () => PROJECT_ID,
    lockCustomerProjectBusinessWrite: vi.fn(async () => undefined),
    lockAccountRecord: vi.fn(async () => undefined),
    assertActorAllowed: vi.fn(),
    getDecryptedCredentialForUser: provider.getCredential,
    getDecryptedCredentialForAccountById: provider.getCredential,
    createCredentialAgentClient: provider.createClient,
    assertServiceCapability: provider.capability,
    getApiCredentialStatus: provider.getStatus,
    recordUpstreamResource: provider.recordResource,
    classifyManusV2StructuredResultEnvelope: (value: unknown) => ({ kind: "accepted", value }),
    latestManusV2TaskState: () => null,
    orderManusV2EventsByProviderRank: (events: Row[]) => events,
    ManusV2ApiError: TestManusV2ApiError,
    runWithStoredEnterpriseProjectScope: async (_userId: number, _projectId: string | null, action: () => unknown) => action(),
  } as unknown as BrandKeywordPorts;
  registerIntentSkillPorts(ports);
  const core = {
    database: async () => db,
    context: () => ({ actorUserId: 42, accountUserId: 42, enterpriseProjectId: PROJECT_ID }),
  } as unknown as ModuleHttpCore;
  const request = { frontmindUser: { id: 42, role: "user" } } as unknown as Request;
  return {
    db, setRows, operationRows, taskRows, provider, ports,
    service: createRagStarterQuestionService(core, request),
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("RAG starter-question service", () => {
  it("makes the automatic publication reservation idempotent for one snapshot", async () => {
    const h = harness();
    const input = {
      tx: h.db,
      table: sets as never,
      agentOperations: operations as never,
      agentTasks: tasks as never,
      enterpriseProjectId: PROJECT_ID,
      userId: 42,
      snapshot: {
        id: SNAPSHOT_ID,
        version: 7,
        archiveHash: "a".repeat(64),
        documents: baseSnapshot().documents,
      },
      source: "automatic" as const,
    };
    await expect(reserveRagStarterQuestionSet(input)).resolves.toMatchObject({ acquired: true });
    await expect(reserveRagStarterQuestionSet(input)).resolves.toMatchObject({ acquired: false });
    expect(h.setRows).toHaveLength(1);
  });

  it("terminalizes only an unclaimed local ledger when a newer snapshot supersedes it", async () => {
    const h = harness([setRow({
      status: "queued",
      source: "automatic",
      leaseOwner: "lease-before-create",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })]);
    h.operationRows.push({
      id: OPERATION_ID,
      status: "queued",
      errorCode: null,
      updatedAt: new Date(),
    });
    h.taskRows.push({
      id: TASK_ID,
      operationId: OPERATION_ID,
      providerTaskId: null,
      providerState: "queued",
      updatedAt: new Date(),
    });

    await reserveRagStarterQuestionSet({
      tx: h.db,
      table: sets as never,
      agentOperations: operations as never,
      agentTasks: tasks as never,
      enterpriseProjectId: PROJECT_ID,
      userId: 42,
      snapshot: {
        id: "00000000-0000-4000-8000-000000000099",
        version: 8,
        archiveHash: "f".repeat(64),
        documents: baseSnapshot().documents,
      },
      source: "automatic",
    });

    expect(h.setRows.find((row) => row.id === CURRENT_ID)).toMatchObject({
      status: "superseded",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(h.operationRows[0]).toMatchObject({
      status: "cancelled",
      errorCode: "STARTER_SUPERSEDED_BEFORE_CREATE",
    });
    expect(h.taskRows[0]).toMatchObject({
      providerState: "cancelled",
      providerTaskId: null,
    });
  });

  it("never cancels a create-unknown ledger while superseding its old snapshot", async () => {
    const h = harness([setRow({
      status: "attention_required",
      source: "automatic",
      errorCode: "CREATE_UNKNOWN",
    })]);
    h.operationRows.push({
      id: OPERATION_ID,
      status: "attention_required",
      errorCode: "CREATE_UNKNOWN",
      updatedAt: new Date(),
    });
    h.taskRows.push({
      id: TASK_ID,
      operationId: OPERATION_ID,
      providerTaskId: null,
      providerState: "create_unknown",
      updatedAt: new Date(),
    });

    await reserveRagStarterQuestionSet({
      tx: h.db,
      table: sets as never,
      agentOperations: operations as never,
      agentTasks: tasks as never,
      enterpriseProjectId: PROJECT_ID,
      userId: 42,
      snapshot: {
        id: "00000000-0000-4000-8000-000000000098",
        version: 8,
        archiveHash: "e".repeat(64),
        documents: baseSnapshot().documents,
      },
      source: "automatic",
    });

    expect(h.operationRows[0]).toMatchObject({
      status: "attention_required",
      errorCode: "CREATE_UNKNOWN",
    });
    expect(h.taskRows[0]).toMatchObject({
      providerState: "create_unknown",
      providerTaskId: null,
    });
    expect(h.setRows.find((row) => row.id === CURRENT_ID)).toMatchObject({
      status: "running",
      errorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });

  it("supersedes an already materialized draft without rescheduling its completed task", async () => {
    const h = harness([setRow({ status: "draft_ready", source: "automatic" })]);
    h.operationRows.push({
      id: OPERATION_ID, status: "succeeded", errorCode: null, updatedAt: new Date(),
    });
    h.taskRows.push({
      id: TASK_ID, operationId: OPERATION_ID,
      providerTaskId: "provider-completed-task", providerState: "completed",
      updatedAt: new Date(),
    });

    await reserveRagStarterQuestionSet({
      tx: h.db, table: sets as never,
      agentOperations: operations as never, agentTasks: tasks as never,
      enterpriseProjectId: PROJECT_ID, userId: 42,
      snapshot: {
        id: "00000000-0000-4000-8000-000000000097", version: 8,
        archiveHash: "d".repeat(64), documents: baseSnapshot().documents,
      },
      source: "automatic",
    });

    expect(h.setRows.find((row) => row.id === CURRENT_ID)).toMatchObject({
      status: "superseded",
    });
    expect(h.operationRows[0]).toMatchObject({ status: "succeeded" });
    expect(h.taskRows[0]).toMatchObject({
      providerState: "completed", providerTaskId: "provider-completed-task",
    });
  });

  it("supersedes a definite invalid-result failure instead of observing it again", async () => {
    const h = harness([setRow({
      status: "attention_required", source: "automatic", errorCode: "RESULT_INVALID",
    })]);
    h.operationRows.push({
      id: OPERATION_ID, status: "attention_required",
      errorCode: "RESULT_INVALID", updatedAt: new Date(),
    });
    h.taskRows.push({
      id: TASK_ID, operationId: OPERATION_ID,
      providerTaskId: "provider-invalid-result", providerState: "failed",
      updatedAt: new Date(),
    });

    await reserveRagStarterQuestionSet({
      tx: h.db, table: sets as never,
      agentOperations: operations as never, agentTasks: tasks as never,
      enterpriseProjectId: PROJECT_ID, userId: 42,
      snapshot: {
        id: "00000000-0000-4000-8000-000000000096", version: 8,
        archiveHash: "c".repeat(64), documents: baseSnapshot().documents,
      },
      source: "automatic",
    });

    expect(h.setRows.find((row) => row.id === CURRENT_ID)).toMatchObject({
      status: "superseded",
    });
    expect(h.taskRows[0]).toMatchObject({
      providerState: "failed", providerTaskId: "provider-invalid-result",
    });
  });

  it("keeps GET database-only with zero credential or provider side effects", async () => {
    const h = harness([setRow()]);
    await expect(h.service.read()).resolves.toMatchObject({
      current: { id: CURRENT_ID },
      pending: false,
      error: null,
    });
    expect(h.provider.capability).not.toHaveBeenCalled();
    expect(h.provider.getCredential).not.toHaveBeenCalled();
    expect(h.provider.createClient).not.toHaveBeenCalled();
  });

  it("rejects a stale tab before any write", async () => {
    const h = harness([setRow()]);
    await expect(h.service.confirm({
      expectedCurrentSetId: "00000000-0000-4000-8000-000000000099",
      expectedDraftSetId: null,
      questions: ["编辑问题一", "编辑问题二", "编辑问题三"],
    })).rejects.toMatchObject({ code: "STARTER_VERSION_CONFLICT", status: 409 });
    expect(h.setRows).toHaveLength(1);
    expect(h.setRows[0]!.status).toBe("confirmed");
  });

  it("reopens CREATE_UNKNOWN on the same task and never allocates a second provider create", async () => {
    const runtime = { ragStarterQuestions: {
      schemaVersion: 1,
      operationToken: `rag-starter:${FAILED_ID}`,
      createClaimedAt: 12345,
    } };
    const h = harness([setRow({
      id: FAILED_ID,
      status: "attention_required",
      errorCode: "CREATE_UNKNOWN",
      source: "regenerate",
      operationId: OPERATION_ID,
      taskId: TASK_ID,
      questions: null,
    })]);
    h.operationRows.push({ id: OPERATION_ID, status: "attention_required", errorCode: "CREATE_UNKNOWN" });
    h.taskRows.push({ id: TASK_ID, providerState: "failed", providerRuntime: runtime });
    const result = await h.service.regenerate({
      clientRequestId: "00000000-0000-4000-8000-000000000010",
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    });
    expect(result).toMatchObject({ pending: true, pendingSetId: FAILED_ID });
    expect(h.setRows).toHaveLength(1);
    expect(h.taskRows[0]).toMatchObject({ providerState: "create_unknown", providerRuntime: runtime });
    expect(h.operationRows[0]).toMatchObject({ status: "running", errorCode: null });
    expect(h.provider.createClient).not.toHaveBeenCalled();
  });

  it("replays the same regeneration request without allocating another set", async () => {
    const clientRequestId = "00000000-0000-4000-8000-000000000013";
    const h = harness([setRow({
      id: FAILED_ID,
      status: "queued",
      source: "regenerate",
      clientRequestId,
      questions: null,
    })]);
    const result = await h.service.regenerate({
      clientRequestId,
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    });
    expect(result).toMatchObject({ pending: true, pendingSetId: FAILED_ID });
    expect(h.setRows).toHaveLength(1);
    expect(h.provider.createClient).not.toHaveBeenCalled();
  });

  it("reopens a timed-out task for one read-only observation on the same ledger", async () => {
    const runtime = { ragStarterQuestions: {
      schemaVersion: 1,
      setId: FAILED_ID,
      operationToken: `rag-starter:${FAILED_ID}`,
      inputHash: "e".repeat(64),
      snapshotId: SNAPSHOT_ID,
      snapshotVersion: 7,
      archiveHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      credentialId: "credential-1",
      credentialVersion: 1,
      createdAt: "2026-11-07T10:00:00.000Z",
      resultPendingAt: Date.parse("2026-11-07T10:01:00.000Z"),
    } };
    const h = harness([setRow({
      id: FAILED_ID,
      status: "attention_required",
      errorCode: "GENERATION_TIMEOUT",
      source: "automatic",
      operationId: OPERATION_ID,
      taskId: TASK_ID,
      questions: null,
    })]);
    h.operationRows.push({ id: OPERATION_ID, status: "attention_required", errorCode: "GENERATION_TIMEOUT" });
    h.taskRows.push({
      id: TASK_ID,
      providerTaskId: "provider-task-1",
      providerState: "failed",
      providerRuntime: runtime,
    });
    const clientRequestId = "00000000-0000-4000-8000-000000000014";
    const result = await h.service.regenerate({
      clientRequestId,
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    });
    expect(result).toMatchObject({ pending: true, pendingSetId: FAILED_ID });
    expect(h.setRows).toHaveLength(1);
    expect(h.taskRows[0]).toMatchObject({
      id: TASK_ID,
      providerTaskId: "provider-task-1",
      providerState: "result_pending",
      providerRuntime: {
        ragStarterQuestions: expect.objectContaining({ reconcileOnce: true }),
      },
    });
    expect(h.operationRows[0]).toMatchObject({ status: "running", errorCode: null });
    expect(h.provider.createClient).not.toHaveBeenCalled();
    await expect(h.service.regenerate({
      clientRequestId,
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    })).resolves.toMatchObject({ pending: true, pendingSetId: FAILED_ID });
    expect(h.setRows).toHaveLength(1);
  });

  it("uses a new reservation only after an explicit retry of a definite failure", async () => {
    const h = harness([setRow({ id: FAILED_ID, status: "failed", errorCode: "PROVIDER_FAILED", questions: null })]);
    const result = await h.service.regenerate({
      clientRequestId: "00000000-0000-4000-8000-000000000011",
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    });
    expect(result.pending).toBe(true);
    expect(h.setRows).toHaveLength(2);
    expect(h.setRows.find((row) => row.id === FAILED_ID)?.status).toBe("superseded");
    expect(h.setRows.find((row) => row.id !== FAILED_ID)).toMatchObject({ source: "regenerate", status: "queued" });
  });

  it("makes a human edit authoritative and hides older failures for the same snapshot", async () => {
    const h = harness([
      setRow(),
      setRow({ id: FAILED_ID, ordinal: 2, status: "failed", errorCode: "RESULT_INVALID", questions: null, workspaceRevision: 2 }),
    ]);
    const result = await h.service.confirm({
      expectedCurrentSetId: CURRENT_ID,
      expectedDraftSetId: null,
      questions: ["编辑后的问题一", "编辑后的问题二", "编辑后的问题三"],
    });
    expect(result.error).toBeNull();
    expect(result.current?.questions).toEqual(["编辑后的问题一", "编辑后的问题二", "编辑后的问题三"]);
    expect(h.setRows.find((row) => row.id === FAILED_ID)?.status).toBe("superseded");
    expect(h.setRows.filter((row) => row.status === "confirmed")).toHaveLength(1);
  });

  it("preserves a case-only human edit instead of treating it as the original draft", async () => {
    const draft = setRow({
      status: "draft_ready",
      source: "automatic",
      questions: [
        { text: "Frontmind 可以帮企业做什么？", sourceAliases: ["KB-001"] },
        { text: "你们提供哪些服务？", sourceAliases: ["KB-001"] },
        { text: "如何联系你们？", sourceAliases: ["KB-001"] },
      ],
    });
    const h = harness([draft]);
    const result = await h.service.confirm({
      expectedCurrentSetId: null,
      expectedDraftSetId: CURRENT_ID,
      questions: ["FrontMind 可以帮企业做什么？", "你们提供哪些服务？", "如何联系你们？"],
    });
    expect(result.current).toMatchObject({
      source: "manual",
      questions: ["FrontMind 可以帮企业做什么？", "你们提供哪些服务？", "如何联系你们？"],
    });
    expect(h.setRows.find((row) => row.id === CURRENT_ID)?.status).toBe("superseded");
  });

  it("keeps the CREATE_UNKNOWN fence through a human confirm and reopens only its original task", async () => {
    const runtime = { ragStarterQuestions: {
      schemaVersion: 1,
      operationToken: `rag-starter:${FAILED_ID}`,
      createClaimedAt: 12345,
    } };
    const h = harness([setRow({
      id: FAILED_ID,
      status: "attention_required",
      errorCode: "CREATE_UNKNOWN",
      source: "automatic",
      operationId: OPERATION_ID,
      taskId: TASK_ID,
      questions: null,
      workspaceRevision: 2,
    })]);
    h.operationRows.push({ id: OPERATION_ID, status: "attention_required", errorCode: "CREATE_UNKNOWN" });
    h.taskRows.push({ id: TASK_ID, providerState: "failed", providerRuntime: runtime });

    const confirmed = await h.service.confirm({
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
      questions: ["人工问题一", "人工问题二", "人工问题三"],
    });
    expect(confirmed.error).toBeNull();
    expect(h.setRows.find((row) => row.id === FAILED_ID)).toMatchObject({
      status: "attention_required",
      errorCode: "CREATE_UNKNOWN",
      taskId: TASK_ID,
    });

    const retried = await h.service.regenerate({
      clientRequestId: "00000000-0000-4000-8000-000000000012",
      expectedCurrentSetId: confirmed.current!.id,
      expectedDraftSetId: null,
    });
    expect(retried).toMatchObject({ pending: true, pendingSetId: FAILED_ID });
    expect(h.setRows).toHaveLength(2);
    expect(h.taskRows).toEqual([expect.objectContaining({
      id: TASK_ID,
      providerState: "create_unknown",
      providerRuntime: runtime,
    })]);
  });

  it("keeps a timed-out provider task fenced through a human confirm", async () => {
    const h = harness([setRow({
      id: FAILED_ID,
      status: "attention_required",
      errorCode: "GENERATION_TIMEOUT",
      source: "automatic",
      questions: null,
      workspaceRevision: 2,
    })]);
    const confirmed = await h.service.confirm({
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
      questions: ["人工问题一", "人工问题二", "人工问题三"],
    });
    expect(confirmed.current?.source).toBe("manual");
    expect(h.setRows.find((row) => row.id === FAILED_ID)).toMatchObject({
      status: "attention_required",
      errorCode: "GENERATION_TIMEOUT",
    });
  });

  it("reserves the current project's published snapshot exactly once", async () => {
    const h = harness();
    await expect(bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    })).resolves.toMatchObject({ reserved: true });
    await expect(bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    })).resolves.toMatchObject({ reserved: false });
    expect(h.setRows).toHaveLength(1);
    expect(h.setRows[0]).toMatchObject({ source: "automatic", status: "queued", knowledgeSnapshotId: SNAPSHOT_ID });
  });

  it.each([
    ["manual", "confirmed"],
    ["regenerate", "running"],
    ["automatic", "attention_required"],
  ])("does not bootstrap over an existing %s row for the current snapshot", async (source, status) => {
    const h = harness([setRow({
      id: FAILED_ID,
      source,
      status,
      questions: status === "confirmed" ? setRow().questions : null,
      errorCode: status === "attention_required" ? "CREATE_UNKNOWN" : null,
    })]);
    await expect(bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    })).resolves.toEqual({ reserved: false, setId: FAILED_ID });
    expect(h.setRows).toHaveLength(1);
  });
});

describe("RAG starter-question worker fences", () => {
  it("retries a valid late result after a transient draft write without creating another provider task", async () => {
    const h = harness();
    h.provider.enableCredential();
    await bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    });

    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.setRows[0]).toMatchObject({ status: "running" });
    const uploadedInput = JSON.parse(Buffer.from(
      h.provider.client.uploadFile.mock.calls[0]![0].bytes,
    ).toString("utf8"));
    expect(uploadedInput.instruction).toBe(RAG_STARTER_PROVIDER_INSTRUCTION);
    expect(uploadedInput.instruction).toContain("第一次接触该企业");
    expect(uploadedInput.instruction).toContain("三题至少覆盖两类客户意图");
    expect(uploadedInput.instruction).toContain("哪些信息仍需核验");
    expect(ragStarterProviderCreatePrompt(
      h.taskRows[0]!.providerRuntime.ragStarterQuestions.operationToken,
    )).toContain("真实访客");
    const runtime = h.taskRows[0]!.providerRuntime.ragStarterQuestions;
    h.provider.client.listAllMessages.mockResolvedValue([{
      type: "structured_output_result",
      structured_output_result: {
        operationToken: runtime.operationToken,
        inputHash: runtime.inputHash,
        questions: [
          { text: "你们提供哪些服务？", sourceAliases: ["KB-001"] },
          { text: "如何联系你们？", sourceAliases: ["KB-001"] },
          { text: "有哪些核心优势？", sourceAliases: ["KB-001"] },
        ],
      },
    }]);
    h.provider.failNextDraftPublish();

    await runRagStarterQuestionWorkerSweep();
    expect(h.setRows[0]).toMatchObject({ status: "running", attemptCount: 1 });
    expect(h.taskRows[0]).toMatchObject({ providerState: "running" });
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);

    await runRagStarterQuestionWorkerSweep();
    expect(h.setRows[0]).toMatchObject({ status: "draft_ready", errorCode: null });
    expect(h.taskRows[0]).toMatchObject({ providerState: "completed" });
    expect(h.provider.client.listAllMessages).toHaveBeenCalledTimes(2);
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
  });

  it("rejects internal-governance wording without publishing or creating a second task", async () => {
    const h = harness();
    h.provider.enableCredential();
    await bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    });

    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    const runtime = h.taskRows[0]!.providerRuntime.ragStarterQuestions;
    h.provider.client.listAllMessages.mockResolvedValue([{
      type: "structured_output_result",
      structured_output_result: {
        operationToken: runtime.operationToken,
        inputHash: runtime.inputHash,
        questions: [
          { text: "医学美容科公开介绍了哪些服务，哪些信息仍需核验？", sourceAliases: ["KB-001"] },
          { text: "你们可以帮助我解决哪些问题？", sourceAliases: ["KB-001"] },
          { text: "如何预约咨询？", sourceAliases: ["KB-001"] },
        ],
      },
    }]);

    await runRagStarterQuestionWorkerSweep();
    expect(h.setRows[0]).toMatchObject({
      status: "attention_required",
      questions: null,
      errorCode: "RESULT_INVALID",
    });
    expect(h.taskRows[0]).toMatchObject({ providerState: "failed" });
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.provider.client.uploadFile).toHaveBeenCalledTimes(1);

    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.provider.client.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("reconciles an outcome-unknown create by operation token without a second create call", async () => {
    const h = harness();
    h.provider.enableCredential();
    h.provider.client.createTask.mockRejectedValueOnce(h.provider.unknownCreateError());
    await bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    });

    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.taskRows[0]).toMatchObject({ providerState: "create_unknown", providerTaskId: null });
    const operationToken = h.taskRows[0]!.providerRuntime.ragStarterQuestions.operationToken;
    h.provider.client.findCreatedTask.mockResolvedValue({
      matches: [{ id: "reconciled-provider-task" }],
      unique: { id: "reconciled-provider-task" },
    });

    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.findCreatedTask).toHaveBeenCalledWith(expect.objectContaining({
      operationToken,
    }));
    expect(h.taskRows[0]).toMatchObject({
      providerState: "running",
      providerTaskId: "reconciled-provider-task",
    });
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
  });

  it("enforces the total cap and reopens only one read-only observation of the original task", async () => {
    const h = harness();
    h.provider.enableCredential();
    await bootstrapCurrentProjectRagStarterQuestions({
      accountUserId: 42,
      enterpriseProjectId: PROJECT_ID,
    });
    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
    h.taskRows[0]!.providerRuntime.ragStarterQuestions.createdAt =
      new Date(Date.now() - 31 * 60_000).toISOString();

    await runRagStarterQuestionWorkerSweep();
    expect(h.setRows[0]).toMatchObject({
      status: "attention_required",
      errorCode: "GENERATION_TIMEOUT",
    });
    expect(h.provider.client.listAllMessages).not.toHaveBeenCalled();

    await h.service.regenerate({
      clientRequestId: "00000000-0000-4000-8000-000000000015",
      expectedCurrentSetId: null,
      expectedDraftSetId: null,
    });
    await runRagStarterQuestionWorkerSweep();
    expect(h.provider.client.listAllMessages).toHaveBeenCalledTimes(1);
    expect(h.setRows[0]).toMatchObject({
      status: "attention_required",
      errorCode: "GENERATION_TIMEOUT",
    });
    expect(h.taskRows[0]!.providerRuntime.ragStarterQuestions.reconcileOnce).toBeUndefined();
    expect(h.provider.client.createTask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["manus", "manus-1.6"],
    ["zhipu", "glm-5.3"],
    ["xty_codex", "gpt-5.6-sol"],
  ] as const)("freezes the shared managed Base runtime for %s", (provider, model) => {
    expect(ragStarterManagedBaseRuntime(provider)).toEqual({
      publicProfile: "frontmind-base",
      model,
      effort: "high",
    });
  });

  it("supersedes a late result from an old knowledge snapshot", () => {
    expect(ragStarterLateResultDisposition("new-snapshot", "old-snapshot")).toBe("superseded");
    expect(ragStarterLateResultDisposition("same-snapshot", "same-snapshot")).toBe("draft_ready");
  });

  it("routes create_unknown to lookup and never back to create", () => {
    expect(ragStarterProviderDispatchAction({ providerState: "queued", providerTaskId: null })).toBe("create");
    expect(ragStarterProviderDispatchAction({ providerState: "create_unknown", providerTaskId: null })).toBe("reconcile_create");
    expect(ragStarterProviderDispatchAction({ providerState: "running", providerTaskId: "upstream-1" })).toBe("observe");
  });

  it("treats missing credentials as definite only before any paid create claim", () => {
    expect(ragStarterCredentialUnavailableCode(
      { providerState: "queued", providerTaskId: null },
      {},
    )).toBe("MODEL_UNAVAILABLE");
    expect(ragStarterCredentialUnavailableCode(
      { providerState: "create_unknown", providerTaskId: null },
      { createClaimedAt: 1 },
    )).toBe("CREATE_UNKNOWN");
    expect(ragStarterCredentialUnavailableCode(
      { providerState: "running", providerTaskId: "provider-1" },
      { createClaimedAt: 1 },
    )).toBe("GENERATION_TIMEOUT");
  });

  it("puts the operation token in the provider-searchable create prompt", () => {
    const operationToken = `rag-starter:${CURRENT_ID}`;
    expect(ragStarterProviderCreatePrompt(operationToken)).toContain(
      `FRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({ operationToken })}`,
    );
  });
});
