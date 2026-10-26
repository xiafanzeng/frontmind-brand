// @vitest-environment node
import { createHash } from "node:crypto";
import type { Request } from "express";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  int,
  json,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import {
  ENTERPRISE_RAG_DIMENSION_IDS,
  ENTERPRISE_RAG_GATE_IDS,
  ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA,
} from "../contracts/enterprise-rag-evaluation-run";
import { enterpriseQaDocumentCatalog } from "../server/enterprise-qa-answer";
import {
  createEnterpriseRagEvaluationService,
  EnterpriseRagEvaluationError,
} from "../server/enterprise-rag-evaluation-service";
import type { BrandKeywordPorts } from "../server/brand-keyword-ports";
import type { ModuleHttpCore } from "../server/http-api";
import {
  intentHash,
  registerIntentSkillPorts,
} from "../server/intent-skill-runtime";

const SOURCE_TASK_ID = "00000000-0000-4000-8000-000000000010";
const SOURCE_OPERATION_ID = "00000000-0000-4000-8000-000000000011";
const TURN_ID = "00000000-0000-4000-8000-000000000012";
const CONVERSATION_ID = "project:conversation";
const USER_MESSAGE_ID = "project:question-message";
const PUBLIC_USER_MESSAGE_ID = "question-message";
const ANSWER_MESSAGE_ID = "answer-message";
const REQUEST_ID = "00000000-0000-4000-8000-000000000020";

function hash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function harness() {
  const operations = mysqlTable("operations_test", {
    id: varchar("id", { length: 36 }).primaryKey(),
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    provider: varchar("provider", { length: 16 }),
    scope: varchar("scope", { length: 32 }),
    accountUserId: int("account_user_id"),
    presalesProjectId: varchar("presales_project_id", { length: 80 }),
    operationType: varchar("operation_type", { length: 96 }),
    idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }),
    requestHash: varchar("request_hash", { length: 64 }),
    contractName: varchar("contract_name", { length: 128 }),
    contractRevision: int("contract_revision"),
    schemaHash: varchar("schema_hash", { length: 64 }),
    apiCredentialId: varchar("api_credential_id", { length: 36 }),
    credentialVersion: int("credential_version"),
    publicProfile: varchar("public_profile", { length: 32 }),
    upstreamModel: varchar("upstream_model", { length: 64 }),
    status: varchar("status", { length: 32 }),
    errorCode: varchar("error_code", { length: 128 }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  });
  const tasks = mysqlTable("tasks_test", {
    id: varchar("id", { length: 36 }).primaryKey(),
    providerRuntime: json("provider_runtime"),
    operationId: varchar("operation_id", { length: 36 }),
    providerTaskId: varchar("provider_task_id", { length: 255 }),
    providerRequestId: varchar("provider_request_id", { length: 512 }),
    createMarker: varchar("create_marker", { length: 128 }),
    title: varchar("title", { length: 255 }),
    providerState: varchar("provider_state", { length: 32 }),
    lastMessageSyncAt: timestamp("last_message_sync_at"),
    resultDeadlineAt: timestamp("result_deadline_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  });
  const eventsTable = mysqlTable("events_test", {
    id: varchar("id", { length: 36 }).primaryKey(),
    taskId: varchar("task_id", { length: 36 }),
    providerEventId: varchar("provider_event_id", { length: 512 }),
    eventType: varchar("event_type", { length: 64 }),
    providerTimestampMs: int("provider_timestamp_ms"),
    normalizedPayload: json("normalized_payload"),
    receivedAt: timestamp("received_at"),
    updatedAt: timestamp("updated_at"),
  });

  const knowledgeText = JSON.stringify({
    documents: [{
      title: "门诊时间信息",
      path: "service/hours.md",
      content: "门诊挂号时间为 7:30，就诊时间为 8:00。",
    }, {
      title: "医院地址",
      path: "contact/address.md",
      content: "医院位于东莞市中心区。",
    }],
  });
  const purpose = {
    revision: 1,
    accountUserId: 42,
    enterpriseProjectId: "project",
    purpose: "enterprise_qa",
    answerContractVersion: 1,
    knowledgeBase: {
      snapshotId: "snapshot-v2",
      version: 2,
      sourceFileName: "knowledge.zip",
      documentCount: 2,
      contentHash: hash(knowledgeText),
    },
    knowledgeText,
  };
  const [document] = enterpriseQaDocumentCatalog(purpose);
  const operationRows: any[] = [{
    id: SOURCE_OPERATION_ID,
    enterpriseProjectId: "project",
    provider: "xty_codex",
    scope: "managed_user",
    accountUserId: 42,
    operationType: "dashboard.general-chat",
    contractName: "dashboard.general-chat",
    contractRevision: 2,
    status: "succeeded",
    upstreamModel: "gpt-5.6-sol",
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    updatedAt: new Date("2026-10-26T00:01:00.000Z"),
  }];
  const taskRows: any[] = [{
    id: SOURCE_TASK_ID,
    operationId: SOURCE_OPERATION_ID,
    providerRuntime: { generalPurpose: purpose },
    // XTY commonly preserves this successful raw terminal spelling while the
    // owning operation and exact conversation turn are normalized completed.
    providerState: "stopped",
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    updatedAt: new Date("2026-10-26T00:01:00.000Z"),
  }];
  const persistedEvents: any[] = [];
  const turnRows = [{
    id: TURN_ID,
    conversationId: CONVERSATION_ID,
    upstreamTaskId: SOURCE_TASK_ID,
    operationType: "general_chat_v2",
    status: "completed",
  }];
  const messageRows = [{
    id: USER_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    role: "user",
    content: "挂号时间和就诊时间是什么？",
    sequence: 0,
    metadata: {},
  }, {
    id: ANSWER_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    role: "assistant",
    content: "门诊挂号时间为 7:30，就诊时间为 8:00。",
    sequence: 1,
    metadata: {
      generalChat: {
        schemaVersion: 1,
        kind: "assistant_projection",
        serverOwned: true,
        isFinalAnswer: true,
        turnId: TURN_ID,
        agentTaskId: SOURCE_TASK_ID,
        userMessageId: PUBLIC_USER_MESSAGE_ID,
        userSequence: 0,
      },
      enterpriseQaAnswer: {
        schemaVersion: 1,
        sources: [{
          id: document.documentId,
          kind: "published_knowledge",
          title: document.title,
        }],
      },
    },
  }];
  const dialect = new MySqlDialect();

  const params = (predicate: any) => predicate
    ? dialect.sqlToQuery(predicate).params
    : [];
  const project = (fields: any, row: any) => {
    if (!fields) return row;
    if ("operation" in fields && "task" in fields) return row;
    return Object.fromEntries(Object.keys(fields).map((key) => [
      key,
      key === "payload" ? row.normalizedPayload : row[key],
    ]));
  };

  class Query implements PromiseLike<any[]> {
    private fromTable: any;
    private joined = false;
    private predicate: any;
    private maximum = Number.POSITIVE_INFINITY;
    constructor(private readonly fields?: any) {}
    from(table: any) { this.fromTable = table; return this; }
    innerJoin() { this.joined = true; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    orderBy() { return this; }
    limit(value: number) { this.maximum = value; return this; }
    for() { return this; }
    private run() {
      const values = params(this.predicate);
      if (this.fromTable === tasks && !this.joined) {
        const rows = taskRows.filter((row) => values.length === 0 || values.includes(row.id));
        return rows.slice(0, this.maximum).map((row) => project(this.fields, row));
      }
      if (this.fromTable === eventsTable) {
        const rows = persistedEvents
          .filter((row) =>
            (!values.some((value) => taskRows.some((task) => task.id === value)) || values.includes(row.taskId)) &&
            (!values.includes("enterprise_rag_evaluation_report") || row.eventType === "enterprise_rag_evaluation_report"))
          .sort((a, b) => b.providerTimestampMs - a.providerTimestampMs);
        return rows.slice(0, this.maximum).map((row) => project(this.fields, row));
      }
      let joined = operationRows.flatMap((operation) => {
        const task = taskRows.find((candidate) => candidate.operationId === operation.id);
        return task ? [{ operation, task }] : [];
      });
      if (values.includes("dashboard.general-chat")) {
        joined = joined.filter(({ operation }) => operation.operationType === "dashboard.general-chat");
      }
      if (values.includes("brand_rag_answer_evaluation")) {
        joined = joined.filter(({ operation }) => operation.operationType === "brand_rag_answer_evaluation");
      }
      const explicitOperation = operationRows.find((operation) => values.includes(operation.id));
      if (explicitOperation && this.fromTable === operations) {
        joined = joined.filter(({ operation }) => operation.id === explicitOperation.id);
      } else if (this.fromTable === operations && values.length === 1) {
        joined = [];
      }
      const explicitTask = taskRows.find((task) => values.includes(task.id));
      if (explicitTask && this.fromTable === tasks) {
        joined = joined.filter(({ task }) => task.id === explicitTask.id);
      }
      if (values.includes(SOURCE_TASK_ID) && values.includes(TURN_ID) && this.fromTable === operations) {
        joined = joined.filter(({ task }) => {
          const runtime = task.providerRuntime?.enterpriseRagEvaluation;
          return runtime?.sourceQaTaskId === SOURCE_TASK_ID && runtime?.sourceTurnId === TURN_ID;
        });
      }
      joined.sort((a, b) => Number(b.operation.createdAt) - Number(a.operation.createdAt));
      return joined.slice(0, this.maximum).map((row) => project(this.fields, row));
    }
    then<TResult1 = any[], TResult2 = never>(
      onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  const db: any = {
    select(fields?: any) { return new Query(fields); },
    async execute(query: any) {
      const statement = dialect.sqlToQuery(query);
      if (statement.sql.includes("FROM conversation_turns")) {
        return [statement.params.includes(TURN_ID) && statement.params.includes(SOURCE_TASK_ID) ? turnRows : []];
      }
      if (statement.sql.includes("FROM messages")) {
        return [statement.params.includes(TURN_ID) ? messageRows : []];
      }
      return [[]];
    },
    async transaction(work: (tx: any) => Promise<any>) { return work(db); },
    insert(table: any) {
      return { values: async (value: any) => {
        const row = {
          ...structuredClone(value),
          createdAt: value.createdAt ?? new Date(),
          updatedAt: value.updatedAt ?? new Date(),
        };
        if (table === operations) operationRows.push(row);
        if (table === tasks) taskRows.push(row);
        if (table === eventsTable) persistedEvents.push(row);
      } };
    },
    update(table: any) {
      return { set: (value: any) => ({ where: async (predicate: any) => {
        const values = params(predicate);
        const rows = table === operations ? operationRows : table === tasks ? taskRows : persistedEvents;
        const row = rows.find((candidate) => values.includes(candidate.id));
        if (row) Object.assign(row, structuredClone(value));
      } }) };
    },
  };

  const credential = {
    id: "credential",
    userId: 42,
    version: 1,
    credentialRef: "ref",
    fingerprint: "fingerprint",
    verifiedAt: new Date(),
    status: "active",
    provider: "xty_codex",
    agentProfile: "frontmind-pro",
    upstreamModel: "gpt-5.6-sol",
    upstreamEffort: "high",
  };
  let providerEvents: any[] = [];
  let providerState = "running";
  const client = {
    uploadFile: vi.fn(async () => ({ fileId: "uploaded-skill" })),
    createTask: vi.fn(async () => ({ taskId: "provider-evaluation", requestId: "request" })),
    findCreatedTask: vi.fn(async () => ({ matches: [], unique: null })),
    taskDetail: vi.fn(async () => ({ status: "running" })),
    sendMessage: vi.fn(async () => ({ taskId: "provider-evaluation" })),
    listAllMessages: vi.fn(async () => providerEvents),
  };
  registerIntentSkillPorts({
    agentOperations: operations,
    agentTasks: tasks,
    agentEvents: eventsTable,
    assertActorAllowed: () => {},
    lockAccountRecord: async () => {},
    lockCustomerProjectBusinessWrite: async () => {},
    assertServiceCapability: async () => ({}),
    getApiCredentialStatus: async () => credential,
    getDecryptedCredentialForUser: async () => credential,
    getDecryptedCredentialForAccountById: async () => credential,
    createCredentialAgentClient: () => client,
    recordUpstreamResource: async () => {},
    orderManusV2EventsByProviderRank: (values: any[]) => [...values].reverse(),
    classifyManusV2StructuredResultEnvelope: (value: any) => value.success
      ? { kind: "accepted", value: value.value }
      : { kind: "rejected" },
    latestManusV2TaskState: () => providerState,
  } as unknown as BrandKeywordPorts);
  const core: ModuleHttpCore = {
    context: () => ({
      accountUserId: 42,
      actorUserId: 42,
      enterpriseProjectId: "project",
      businessOwnerId: "42",
      businessActorId: "42",
    }),
    database: async () => db,
    environment: {},
  };
  const service = createEnterpriseRagEvaluationService(core, {
    frontmindUser: { id: 42, role: "user" },
  } as unknown as Request);
  const startInput = {
    clientRequestId: REQUEST_ID,
    sourceQaTaskId: SOURCE_TASK_ID,
    turnId: TURN_ID,
  };
  function acceptedOutput() {
    const evaluatorTask = taskRows.find((task) => task.operationId === REQUEST_ID);
    const input = evaluatorTask.providerRuntime.enterpriseRagEvaluation.input;
    return {
      operationToken: input.operationToken,
      inputHash: input.inputHash,
      dimensions: ENTERPRISE_RAG_DIMENSION_IDS.map((id) => ({
        id,
        level: 4,
        rationale: "问题、回答与冻结来源一致。",
        evidenceIds: ["claim-1", document.documentId],
      })),
      gates: ENTERPRISE_RAG_GATE_IDS.map((id) => ({
        id,
        status: "passed",
        reason: "冻结证据支持且未发现风险。",
        evidenceIds: ["claim-1", document.documentId],
      })),
      claims: [{
        id: "claim-1",
        statement: "门诊挂号时间为 7:30，就诊时间为 8:00。",
        status: "supported",
        sourceIds: [document.documentId],
        rationale: "冻结来源直接包含相同时间信息。",
      }],
      summary: "回答完整且有冻结来源支持。",
    };
  }
  function pushProviderOutput(
    value = acceptedOutput(),
    id = `provider-result-${providerEvents.length + 1}`,
  ) {
    providerState = "finished";
    providerEvents.push({
      id,
      type: "structured_output_result",
      timestamp: Date.now(),
      structured_output_result: { success: true, value },
    });
  }
  function pushProviderAssistant(
    value: ReturnType<typeof acceptedOutput>,
    id = `provider-assistant-${providerEvents.length + 1}`,
  ) {
    providerState = "finished";
    providerEvents.push({
      id,
      type: "assistant_message",
      timestamp: Date.now(),
      assistant_message: { content: JSON.stringify(value) },
    });
  }
  function completeProvider() {
    pushProviderOutput();
  }
  return {
    service,
    client,
    startInput,
    acceptedOutput,
    pushProviderAssistant,
    pushProviderOutput,
    completeProvider,
    operationRows,
    taskRows,
    persistedEvents,
  };
}

describe("企业 RAG 自动评估持久化服务", () => {
  it("绑定指定完成 turn，幂等创建一次，并由现有评分 Skill 生成不可变报告", async () => {
    const h = harness();
    const running = await h.service.start(h.startInput);
    expect(running).toMatchObject({
      operationId: REQUEST_ID,
      sourceQaTaskId: SOURCE_TASK_ID,
      turnId: TURN_ID,
      status: "running",
      report: null,
    });
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    const createSchema = h.client.createTask.mock.calls[0]![0]
      .structuredOutputSchema as any;
    const evaluatorTask = h.taskRows.find((row) => row.operationId === REQUEST_ID);
    const frozenInput = evaluatorTask.providerRuntime.enterpriseRagEvaluation.input;
    expect(createSchema.properties.operationToken.enum).toEqual([
      frozenInput.operationToken,
    ]);
    expect(
      createSchema.properties.dimensions.items.properties.evidenceIds.items.enum,
    ).toEqual(expect.arrayContaining([
      `answer:${ANSWER_MESSAGE_ID}`,
      frozenInput.sources[0].id,
      "claim-1",
    ]));
    expect(
      createSchema.properties.dimensions.items.properties.evidenceIds.items.enum,
    ).not.toContain(`answer:${ANSWER_MESSAGE_ID}-recalculated`);
    const frozenSources = h.taskRows.find((row) =>
      row.operationId === REQUEST_ID).providerRuntime.enterpriseRagEvaluation.input.sources;
    expect(frozenSources).toHaveLength(2);
    expect(frozenSources.map((source: any) => source.citedByAnswer)).toEqual([true, false]);
    expect(
      createSchema.properties.claims.items.properties.sourceIds.items.enum,
    ).toEqual(frozenSources.map((source: any) => source.id));
    expect(h.client.createTask.mock.calls[0]![0].prompt).toContain(
      "claims[].sourceIds 是更窄的来源集合",
    );

    const lostResponseRetry = await h.service.start({
      ...h.startInput,
      clientRequestId: "00000000-0000-4000-8000-000000000022",
    });
    expect(lostResponseRetry.operationId).toBe(REQUEST_ID);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.operationRows.filter((row) =>
      row.operationType === "brand_rag_answer_evaluation")).toHaveLength(1);

    h.completeProvider();
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result).toMatchObject({
      skillId: "enterprise-rag-evaluation",
      status: "completed",
      score: 100,
      coverage: 100,
      recommendation: "recommended",
    });
    expect(completed.report?.sourceTurnId).toBe(TURN_ID);
    expect(completed.report?.judgments.dimensions).toHaveLength(6);
    expect(completed.report?.judgments.gates).toHaveLength(7);
    expect(h.persistedEvents).toHaveLength(1);

    const replay = await h.service.start(h.startInput);
    expect(replay.report?.reportId).toBe(completed.report?.reportId);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    const history = await h.service.latest(SOURCE_TASK_ID, TURN_ID);
    expect(history.latest?.report?.reportId).toBe(completed.report?.reportId);
    expect(history.history).toHaveLength(1);
  });

  it("首次证据 ID 被改写时只修复一次，并用同一绑定 schema 写入唯一报告", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    for (const item of [...invalid.dimensions, ...invalid.gates]) {
      item.evidenceIds = [`answer:${ANSWER_MESSAGE_ID}-recalculated`];
    }
    h.pushProviderOutput(invalid, "provider-invalid-result");

    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(pending.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    const repairRequest = h.client.sendMessage.mock.calls[0]![0];
    expect(repairRequest.prompt).toContain(`answer:${ANSWER_MESSAGE_ID}`);
    expect(repairRequest.prompt).toContain("禁止重算、缩写或改写");
    expect(repairRequest.structuredOutputSchema).toEqual(
      h.client.createTask.mock.calls[0]![0].structuredOutputSchema,
    );

    h.pushProviderOutput(h.acceptedOutput(), "provider-repaired-result");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.persistedEvents).toHaveLength(1);
  });

  it("assistant fallback 改写来源尾字符时给出精确候选并在唯一 repair 后完成", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    const allowedSourceId = invalid.claims[0].sourceIds[0]!;
    const rewrittenSourceId = `${allowedSourceId}6`;
    invalid.claims[0].sourceIds = [rewrittenSourceId];
    h.pushProviderAssistant(invalid, "provider-invalid-source-assistant");

    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(pending.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    const repairRequest = h.client.sendMessage.mock.calls[0]![0];
    expect(repairRequest.prompt).toContain(
      "claims[0].sourceIds[0] 不在冻结白名单中",
    );
    expect(repairRequest.prompt).toContain(
      `唯一一处字符编辑可达的合法 ID 是 \"${allowedSourceId}\"`,
    );
    expect(repairRequest.prompt).not.toContain(rewrittenSourceId);
    expect(repairRequest.prompt).toContain(
      "不要从上一轮错误 JSON 复制任何 ID",
    );
    expect(repairRequest.structuredOutputSchema).toEqual(
      h.client.createTask.mock.calls[0]![0].structuredOutputSchema,
    );
    expect(h.persistedEvents).toHaveLength(0);

    h.pushProviderAssistant(h.acceptedOutput(), "provider-repaired-source-assistant");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.persistedEvents).toHaveLength(1);
  });

  it("assistant fallback 的来源尾字符在 repair 后仍错误时严格失败且不写报告", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    const rewrittenSourceId = `${invalid.claims[0].sourceIds[0]!}6`;
    invalid.claims[0].sourceIds = [rewrittenSourceId];
    h.pushProviderAssistant(invalid, "provider-invalid-source-assistant");
    await h.service.observe(REQUEST_ID);

    const invalidRepair = h.acceptedOutput();
    invalidRepair.claims[0].sourceIds = [rewrittenSourceId];
    invalidRepair.dimensions.find(({ id }) => id === "correctness")!
      .evidenceIds.push(rewrittenSourceId);
    invalidRepair.gates.find(({ id }) => id === "facts")!
      .evidenceIds.push(rewrittenSourceId);
    h.pushProviderAssistant(invalidRepair, "provider-invalid-source-repair-assistant");

    const failed = await h.service.observe(REQUEST_ID);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("EVALUATION_REPAIR_FAILED");
    expect(failed.error?.message).toContain("陈述引用了未授权来源");
    expect(failed.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.persistedEvents).toHaveLength(0);
  });

  it("自动修复后仍引用未知证据时失败且不写入报告", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    invalid.gates[0].evidenceIds = ["claim-30"];
    h.pushProviderOutput(invalid, "provider-invalid-result");
    await h.service.observe(REQUEST_ID);

    h.pushProviderOutput(invalid, "provider-invalid-repair");
    const failed = await h.service.observe(REQUEST_ID);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("EVALUATION_REPAIR_FAILED");
    expect(failed.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.persistedEvents).toHaveLength(0);
  });

  it("assistant-message fallback 也拒绝 bound schema 范围外的 claim", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    invalid.claims[0].id = "claim-31";
    for (const item of [...invalid.dimensions, ...invalid.gates]) {
      item.evidenceIds = ["claim-31"];
    }
    h.pushProviderAssistant(invalid, "provider-invalid-assistant");

    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(pending.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.persistedEvents).toHaveLength(0);
  });

  it("继续接受使用 legacy schemaHash 启动的在途评估", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const operation = h.operationRows.find((row) => row.id === REQUEST_ID);
    operation.schemaHash = intentHash(ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA);
    const invalid = h.acceptedOutput();
    invalid.gates[0].evidenceIds = ["legacy-invented-evidence"];
    h.pushProviderOutput(invalid, "legacy-invalid-result");
    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(
      h.client.sendMessage.mock.calls[0]![0].structuredOutputSchema,
    ).toEqual(ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA);
    expect(h.client.sendMessage.mock.calls[0]![0].prompt).toContain(
      "维度和门禁的 evidenceIds 只能逐字引用冻结证据 ID，不得引用 claim ID",
    );
    expect(h.client.sendMessage.mock.calls[0]![0].prompt).not.toContain(
      "还可以引用本次 JSON 中实际存在",
    );

    const legacyValid = h.acceptedOutput();
    const frozenSourceId = legacyValid.claims[0]!.sourceIds[0]!;
    for (const item of [...legacyValid.dimensions, ...legacyValid.gates]) {
      item.evidenceIds = [frozenSourceId];
    }
    h.pushProviderOutput(legacyValid, "legacy-repaired-result");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
  });

  it("拒绝不属于源 QA 任务的 turn，且不会创建付费模型任务", async () => {
    const h = harness();
    await expect(h.service.start({
      ...h.startInput,
      clientRequestId: "00000000-0000-4000-8000-000000000021",
      turnId: "00000000-0000-4000-8000-000000000099",
    })).rejects.toMatchObject({ code: "SOURCE_TURN_NOT_FOUND" });
    expect(h.client.createTask).not.toHaveBeenCalled();
  });

  it("未知创建进入 attention_required 后继续阻止同坐标重复付费创建", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const operation = h.operationRows.find((row) => row.id === REQUEST_ID);
    const task = h.taskRows.find((row) => row.operationId === REQUEST_ID);
    operation.status = "attention_required";
    task.providerRuntime.enterpriseRagEvaluation.phase = "failed";
    task.providerRuntime.enterpriseRagEvaluation.error = {
      code: "EVALUATION_CREATE_UNKNOWN",
      message: "评估任务创建结果无法确认；系统不会重复创建。",
    };
    const retry = await h.service.start({
      ...h.startInput,
      clientRequestId: "00000000-0000-4000-8000-000000000023",
    });
    expect(retry.operationId).toBe(REQUEST_ID);
    expect(retry.status).toBe("failed");
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.operationRows.filter((row) =>
      row.operationType === "brand_rag_answer_evaluation")).toHaveLength(1);
  });

  it("读取时重算评分并拒绝被篡改的持久化报告", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    h.completeProvider();
    await h.service.observe(REQUEST_ID);
    h.persistedEvents[0].normalizedPayload.report.result.score = 0;
    await expect(h.service.observe(REQUEST_ID)).rejects.toEqual(
      expect.objectContaining<Partial<EnterpriseRagEvaluationError>>({
        code: "EVALUATION_REPORT_MISSING",
      }),
    );
  });
});
