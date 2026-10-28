// @vitest-environment node
import { createHash } from "node:crypto";
import type { Request } from "express";
import JSZip from "jszip";
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
  enterpriseRagJudgeWireSchema,
  enterpriseRagAliasedJudgeWireSchema,
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

function harness(documentCount = 2) {
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
    documents: Array.from({length: documentCount}, (_, index) => index === 0
      ? {
          title: "门诊时间信息",
          path: "service/hours.md",
          content: "门诊挂号时间为 7:30，就诊时间为 8:00。",
        }
      : {
          title: `冻结知识 ${index + 1}`,
          path: `knowledge/document-${index + 1}.md`,
          content: `这是第 ${index + 1} 份冻结知识。`,
        }),
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
      documentCount,
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
  function acceptedOutput(canonicalIds = false) {
    const evaluatorTask = taskRows.find((task) => task.operationId === REQUEST_ID);
    const runtime = evaluatorTask.providerRuntime.enterpriseRagEvaluation;
    const input = runtime.input;
    const alias = (canonicalId: string) => canonicalIds
      ? canonicalId
      : runtime.wireContract.bindings.find(
          (binding: any) => binding.canonicalId === canonicalId,
        ).alias;
    const answerEvidenceId = alias(`answer:${ANSWER_MESSAGE_ID}`);
    const sourceId = alias(document.documentId);
    return {
      ...(input.schemaVersion === 2 ? {
        schemaVersion: 2,
        task: { status: "completed", rationale: "当前问题已完成。", evidenceIds: [answerEvidenceId, sourceId] },
        findings: [],
      } : {}),
      operationToken: input.operationToken,
      inputHash: input.inputHash,
      dimensions: ENTERPRISE_RAG_DIMENSION_IDS.map((id) => ({
        id,
        level: 4,
        rationale: "问题、回答与冻结来源一致。",
        evidenceIds: ["claim-1", answerEvidenceId, sourceId],
      })),
      gates: ENTERPRISE_RAG_GATE_IDS.map((id) => ({
        id,
        status: "passed",
        reason: "冻结证据支持且未发现风险。",
        evidenceIds: ["claim-1", answerEvidenceId, sourceId],
      })),
      claims: [{
        id: "claim-1",
        statement: "门诊挂号时间为 7:30，就诊时间为 8:00。",
        status: "supported",
        ...(input.schemaVersion === 2 ? { kind: "fact", relevance: "core" } : {}),
        sourceIds: [sourceId],
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
  function freezeLegacy() {
    const operation = operationRows.find(row => row.id === REQUEST_ID);
    const runtime = taskRows.find(row => row.operationId === REQUEST_ID).providerRuntime.enterpriseRagEvaluation;
    operation.contractRevision = 1;
    runtime.schemaVersion = 1;
    runtime.input.schemaVersion = 1;
    delete runtime.input.taskScope;
    runtime.input.evaluator = { skillId: "enterprise-rag-evaluation", skillVersion: "1.0.0", ruleVersion: "rag-eval-1.2", judgeVersion: "1.0.0" };
    const { operationToken: _token, inputHash: _hash, ...base } = runtime.input;
    runtime.input.inputHash = intentHash(base);
    operation.requestHash = runtime.input.inputHash;
    runtime.skill = "Frozen legacy evaluator Skill v1.0.0";
    runtime.skillHash = intentHash(runtime.skill);
    if (runtime.wireContract) operation.schemaHash = intentHash({ wireSchema: enterpriseRagAliasedJudgeWireSchema(runtime.input, runtime.wireContract), wireContract: runtime.wireContract });
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
    freezeLegacy,
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
      "rag-AAA-000-000-111",
      "rag-SSS-000-000-222",
      "claim-1",
    ]));
    expect(
      createSchema.properties.dimensions.items.properties.evidenceIds.items.enum,
    ).not.toContain(`answer:${ANSWER_MESSAGE_ID}`);
    const frozenSources = h.taskRows.find((row) =>
      row.operationId === REQUEST_ID).providerRuntime.enterpriseRagEvaluation.input.sources;
    expect(frozenSources).toHaveLength(2);
    expect(frozenSources.map((source: any) => source.citedByAnswer)).toEqual([true, false]);
    expect(
      createSchema.properties.claims.items.properties.sourceIds.items.enum,
    ).toEqual(["rag-SSS-000-000-222", "rag-SSS-000-000-333"]);
    expect(h.client.createTask.mock.calls[0]![0].prompt).toContain(
      "claims[].sourceIds 只能逐字复制冻结来源白名单",
    );
    expect(h.client.createTask.mock.calls[0]![0].prompt).toContain(
      "rag-QQQ=问题、rag-AAA=回答、rag-SSS=来源、rag-EEE=其他证据",
    );
    expect(h.client.createTask.mock.calls[0]![0].prompt).not.toContain(
      frozenSources[0].id,
    );
    const upload = h.client.uploadFile.mock.calls[0]![0];
    const archive = await JSZip.loadAsync(upload.bytes);
    const wireInput = JSON.parse(await archive.file("input.json")!.async("string"));
    expect(wireInput.allowedEvidenceIds).toEqual([
      "rag-QQQ-000-000-000",
      "rag-AAA-000-000-111",
      "rag-SSS-000-000-222",
      "rag-SSS-000-000-333",
    ]);
    expect(wireInput.sources.map((source: any) => source.id)).toEqual([
      "rag-SSS-000-000-222",
      "rag-SSS-000-000-333",
    ]);
    expect(JSON.stringify(wireInput)).not.toContain(frozenSources[0].id);
    const providerProjection = JSON.stringify({
      schema: createSchema,
      prompt: h.client.createTask.mock.calls[0]![0].prompt,
      wireInput,
    });
    for (const canonicalId of frozenInput.allowedEvidenceIds) {
      expect(providerProjection).not.toContain(canonicalId);
    }

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
    expect(completed.report?.judgments.claims[0].sourceIds).toEqual([
      frozenSources[0].id,
    ]);
    expect(completed.report?.evaluator.outputHash).toBe(
      intentHash(completed.report?.judgments),
    );
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
    const allowedAnswerId = invalid.dimensions[0].evidenceIds[1]!;
    for (const item of [...invalid.dimensions, ...invalid.gates]) {
      item.evidenceIds = [`${allowedAnswerId}-recalculated`];
    }
    h.pushProviderOutput(invalid, "provider-invalid-result");

    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(pending.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    const repairRequest = h.client.sendMessage.mock.calls[0]![0];
    expect(repairRequest.prompt).toContain(allowedAnswerId);
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

  it("语义修复允许对相关合法来源做最小必要增删", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    const invalid = h.acceptedOutput();
    invalid.claims[0].status = "unsupported";
    h.pushProviderOutput(invalid, "provider-unsupported-with-source");

    const pending = await h.service.observe(REQUEST_ID);
    expect(pending.status).toBe("result_pending");
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    const prompt = h.client.sendMessage.mock.calls[0]![0].prompt;
    expect(prompt).toContain("无支持陈述不得附带来源");
    expect(prompt).toContain("可按语义需要添加、删除或从对应白名单重选 ID");
    expect(prompt).toContain("不得无关重抄");

    h.pushProviderOutput(h.acceptedOutput(), "provider-semantic-repaired");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
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
      "claims[0].sourceIds[0] 不在冻结传输白名单中",
    );
    expect(repairRequest.prompt).toContain(
      `唯一一处字符编辑可达的合法 ID 是 \"${allowedSourceId}\"`,
    );
    expect(repairRequest.prompt).not.toContain(rewrittenSourceId);
    expect(repairRequest.prompt).toContain(
      "保留与本次校验失败无关的合法 ID",
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

  it("第二次且最终的来源别名 repair 仍错误时严格失败且不写报告", async () => {
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

    const secondPending = await h.service.observe(REQUEST_ID);
    expect(secondPending.status).toBe("result_pending");
    expect(secondPending.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(2);

    h.pushProviderAssistant(invalidRepair, "provider-invalid-source-final-assistant");

    const failed = await h.service.observe(REQUEST_ID);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("EVALUATION_REPAIR_FAILED");
    expect(failed.error?.message).toContain("未授权证据别名");
    expect(failed.report).toBeNull();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.persistedEvents).toHaveLength(0);
  });

  it("语义 repair 新生来源别名 typo 时只追加一次最终 repair 并完成", async () => {
    const h = harness(49);
    await h.service.start(h.startInput);
    const initial = h.acceptedOutput();
    const evaluatorTask = h.taskRows.find((row) => row.operationId === REQUEST_ID);
    const bindings = evaluatorTask.providerRuntime.enterpriseRagEvaluation
      .wireContract.bindings;
    const citedSourceAlias = bindings.find((binding: any) =>
      binding.canonicalId === evaluatorTask.providerRuntime
        .enterpriseRagEvaluation.input.sources[0].id).alias;
    const uncitedSourceAlias = bindings.find((binding: any) =>
      binding.canonicalId === evaluatorTask.providerRuntime
        .enterpriseRagEvaluation.input.sources[1].id).alias;
    initial.claims[0].sourceIds = [uncitedSourceAlias];
    h.pushProviderOutput(initial, "provider-semantic-invalid-result");

    const firstPending = await h.service.observe(REQUEST_ID);
    expect(firstPending.status).toBe("result_pending");
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.client.sendMessage.mock.calls[0]![0].prompt).toContain(
      "依据未展示为引用时须保留引用改进或风险项",
    );
    expect(h.client.sendMessage.mock.calls[0]![0].prompt).toContain(
      "保留与本次校验失败无关的合法 ID",
    );
    delete evaluatorTask.providerRuntime.enterpriseRagEvaluation.repair.attempt;

    const repairedWithTypo = h.acceptedOutput();
    const rewrittenSourceAlias = `${citedSourceAlias}4`;
    repairedWithTypo.claims[0].sourceIds = [rewrittenSourceAlias];
    repairedWithTypo.dimensions.find(({id}) => id === "correctness")!
      .evidenceIds.push(rewrittenSourceAlias);
    repairedWithTypo.gates.find(({id}) => id === "facts")!
      .evidenceIds.push(rewrittenSourceAlias);
    repairedWithTypo.dimensions.find(({id}) => id === "citations")!.level = 2;
    repairedWithTypo.gates.find(({id}) => id === "citations")!.status = "failed";
    h.pushProviderAssistant(repairedWithTypo, "provider-repair-new-typo");

    const secondPending = await h.service.observe(REQUEST_ID);
    expect(secondPending.status).toBe("result_pending");
    expect(h.client.sendMessage).toHaveBeenCalledTimes(2);
    const finalRepair = h.client.sendMessage.mock.calls[1]![0];
    expect(finalRepair.prompt).toContain(
      "claims[0].sourceIds[0] 不在冻结传输白名单中",
    );
    expect(finalRepair.prompt).toContain("dimensions[1].evidenceIds[3]");
    expect(finalRepair.prompt).toContain("gates[0].evidenceIds[3]");
    expect(finalRepair.prompt).toContain(
      `唯一一处字符编辑可达的合法 ID 是 "${citedSourceAlias}"`,
    );
    expect(finalRepair.prompt).not.toContain(rewrittenSourceAlias);
    expect(finalRepair.prompt).toContain("修复轮次=2/2");
    expect(finalRepair.structuredOutputSchema).toEqual(
      h.client.createTask.mock.calls[0]![0].structuredOutputSchema,
    );

    h.pushProviderOutput(h.acceptedOutput(), "provider-final-repaired-result");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
    expect(h.client.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.persistedEvents).toHaveLength(1);
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

  it("旧别名任务继续使用冻结规则，且新请求不重复创建付费任务", async () => {
    const h = harness(); await h.service.start(h.startInput); h.freezeLegacy();
    const resumed = await h.service.start({ ...h.startInput, clientRequestId: "00000000-0000-4000-8000-000000000099" });
    expect(resumed.operationId).toBe(REQUEST_ID); expect(h.client.createTask).toHaveBeenCalledTimes(1);
    h.completeProvider();
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.report?.evaluator.ruleVersion).toBe("rag-eval-1.2");
    expect(completed.report?.result.version).toBe("1.0.0");
    expect(completed.report?.result.answerVerdict).toBeUndefined();
    const original = structuredClone(completed.report);
    expect((await h.service.observe(REQUEST_ID)).report).toEqual(original);
  });

  it("已执行的模型评估可以保存待核验质量结论，不触发无意义修复重试", async () => {
    const h = harness(); await h.service.start(h.startInput);
    const output = h.acceptedOutput();
    Object.assign(output, { schemaVersion: 2,
      task: { status: "undetermined", rationale: "必要前提待确认。", evidenceIds: output.task!.evidenceIds },
      findings: [{ id: "finding-1", kind: "task", severity: "undetermined", summary: "任务待确认", impact: "无法确定任务的必要前提。", claimIds: [], evidenceIds: output.task!.evidenceIds, dimensionIds: ["intent"] }],
    });
    output.dimensions[0].level = null as unknown as number;
    output.gates.find(gate => gate.id === "availability")!.status = "pending";
    h.pushProviderOutput(output);
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result).toMatchObject({ status: "pending", answerVerdict: "pending", score: null });
    expect(h.client.sendMessage).not.toHaveBeenCalled();
    expect((await h.service.observe(REQUEST_ID)).report).toEqual(completed.report);
  });

  it("继续接受使用 legacy schemaHash 启动的在途评估", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    h.freezeLegacy();
    const operation = h.operationRows.find((row) => row.id === REQUEST_ID);
    const task = h.taskRows.find((row) => row.operationId === REQUEST_ID);
    delete task.providerRuntime.enterpriseRagEvaluation.wireContract;
    operation.schemaHash = intentHash(ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA);
    const invalid = h.acceptedOutput(true);
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

    const legacyValid = h.acceptedOutput(true);
    const frozenSourceId = legacyValid.claims[0]!.sourceIds[0]!;
    for (const item of [...legacyValid.dimensions, ...legacyValid.gates]) {
      item.evidenceIds = [frozenSourceId];
    }
    h.pushProviderOutput(legacyValid, "legacy-repaired-result");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
  });

  it("继续接受使用旧 bound canonical schemaHash 启动的在途评估", async () => {
    const h = harness();
    await h.service.start(h.startInput);
    h.freezeLegacy();
    const operation = h.operationRows.find((row) => row.id === REQUEST_ID);
    const task = h.taskRows.find((row) => row.operationId === REQUEST_ID);
    const frozenInput = task.providerRuntime.enterpriseRagEvaluation.input;
    delete task.providerRuntime.enterpriseRagEvaluation.wireContract;
    operation.schemaHash = intentHash(enterpriseRagJudgeWireSchema(frozenInput));

    h.pushProviderOutput(h.acceptedOutput(true), "old-bound-valid-result");
    const completed = await h.service.observe(REQUEST_ID);
    expect(completed.status).toBe("completed");
    expect(completed.report?.result.score).toBe(100);
    expect(completed.report?.judgments.claims[0].sourceIds).toEqual([
      frozenInput.sources[0].id,
    ]);
  });

  it("在调用模型前拒绝被篡改的别名合同或 schemaHash", async () => {
    const contractTamper = harness();
    await contractTamper.service.start(contractTamper.startInput);
    const contractTask = contractTamper.taskRows.find((row) =>
      row.operationId === REQUEST_ID);
    contractTask.providerRuntime.enterpriseRagEvaluation
      .wireContract.bindings[2].canonicalId = "doc-tampered";
    const contractCalls = contractTamper.client.listAllMessages.mock.calls.length;
    await expect(contractTamper.service.observe(REQUEST_ID)).rejects.toMatchObject({
      code: "EVALUATION_CONTEXT_INVALID",
    });
    expect(contractTamper.client.listAllMessages).toHaveBeenCalledTimes(contractCalls);

    const hashTamper = harness();
    await hashTamper.service.start(hashTamper.startInput);
    hashTamper.operationRows.find((row) => row.id === REQUEST_ID).schemaHash =
      "0".repeat(64);
    const hashCalls = hashTamper.client.listAllMessages.mock.calls.length;
    const failed = await hashTamper.service.observe(REQUEST_ID);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("EVALUATION_CONTEXT_INVALID");
    expect(hashTamper.client.listAllMessages).toHaveBeenCalledTimes(hashCalls);
    expect(failed.report).toBeNull();
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
