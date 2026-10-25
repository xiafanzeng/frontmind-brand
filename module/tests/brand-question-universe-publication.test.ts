// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import {buildAndVerifyBrandQuestionUniverseWorkbook} from "../server/brand-question-universe-runtime";
import {createBrandQuestionUniverseService} from "../server/brand-question-universe-service";
import type {BrandKeywordPorts} from "../server/brand-keyword-ports";
import {eq} from "drizzle-orm";
import {mysqlTable, varchar, MySqlDialect} from "drizzle-orm/mysql-core";
import type {BrandQuestionUniversePayload} from "../contracts/brand-question-universe";

afterEach(() => vi.useRealTimers());
const payload: BrandQuestionUniversePayload = {
  schemaVersion: 1,
  operationToken: "brand-question-universe:acceptance",
  research: {competitors: [
    {name: "企业资料平台甲", url: "https://example.com/a"},
    {name: "企业资料平台乙", url: "https://example.com/b"},
  ]},
  rows: Array.from({length: 160}, (_, index) => ({
    序号: index + 1, 问题: `企业资料协作场景${index + 1}如何使用？`,
    核心词: "企业资料协作", 核心词分类: "产品场景词", 问题细分: "场景方案",
  })),
};

function stateHarness(status: string) {
  const operations = mysqlTable("operation_test", {
    id: varchar("id", {length: 36}), status: varchar("status", {length: 64}),
    scope: varchar("scope", {length: 64}), operationType: varchar("type", {length: 64}),
    contractName: varchar("name", {length: 64}), contractRevision: varchar("revision", {length: 64}),
    createdAt: varchar("created", {length: 64}),
  });
  const tasks = mysqlTable("task_test", {
    id: varchar("id", {length: 36}), operationId: varchar("operation", {length: 36}),
  });
  const events = mysqlTable("event_test", {
    taskId: varchar("task", {length: 36}), providerEventId: varchar("event", {length: 64}),
    normalizedPayload: varchar("payload", {length: 64}), providerTimestampMs: varchar("time", {length: 64}),
    id: varchar("id", {length: 36}),
  });
  const operation = {id: "operation", status, errorCode: "WORKBOOK_OR_PUBLISH_FAILED",
    createdAt: new Date(), updatedAt: new Date()};
  const task = {id: "task", providerTaskId: "original-session", providerState: "stopped"};
  const artifact = {artifactId: `artifact_${"a".repeat(64)}`,
    localAssetId: "10000000-0000-4000-8000-000000000001",
    sha256: "a".repeat(64), sizeBytes: 100};
  const context = {
    schemaVersion: 1, kind: "brand_question_universe_context",
    clientRequestId: "20000000-0000-4000-8000-000000000001",
    operationToken: payload.operationToken,
    knowledgeSnapshotId: "30000000-0000-4000-8000-000000000001",
    knowledgeSnapshotVersion: 1, knowledgeArchiveHash: "b".repeat(64),
    expectedDashboardRevision: 0, baselineKeywordTablesFingerprint: "c".repeat(64),
    brandName: "测试企业", inputHashes: {upstream: "d".repeat(64), adapter: "e".repeat(64), knowledge: "f".repeat(64)},
    firstDispatchState: "sent", firstDispatchReservedAtMs: null,
    repairAttempts: 0, repairState: "none", repairToken: null, repairReservedAtMs: null,
    repairErrors: [], lastRejectedEventId: null,
    resultArtifacts: {json: artifact, xlsx: artifact}, workbookSha256: artifact.sha256,
    tableId: "published-table", publicationOutcome: "published", publishedDashboardRevision: 1,
  };
  const dialect = new MySqlDialect();
  const locks = vi.fn();
  const db: any = {
    transaction: async (work: any) => work(db),
    select(fields: any) {
      let table: any; let predicate: any; let joined = false;
      const rows = () => {
        if (fields?.status) return [{status: operation.status}];
        if (fields?.payload) return [{payload: context}];
        if (table === events) return [];
        const params = predicate ? dialect.sqlToQuery(predicate).params : [];
        if (joined && params.includes("running") && !params.includes(operation.status)) return [];
        return [{operation, task}];
      };
      const chain: any = {
        from(value: any) {table = value; return chain;},
        innerJoin() {joined = true; return chain;},
        where(value: any) {predicate = value; return chain;},
        orderBy() {return chain;}, limit() {return chain;},
        for(value: string) {locks(value); return Promise.resolve(rows());},
        then(resolve: any, reject: any) {return Promise.resolve(rows()).then(resolve, reject);},
      };
      return chain;
    },
    update(table: any) {return {set: (value: any) => ({
      where: async () => Object.assign(table === operations ? operation : task, value),
    })};},
  };
  const client = vi.fn(() => {throw new Error("Recovery must not call provider");});
  const service = createBrandQuestionUniverseService({
    agentOperations: operations, agentTasks: tasks, agentEvents: events,
    getDb: async () => db, assertActorAllowed: () => {},
    enterpriseWorkspaceUserId: (id: number) => id,
    enterpriseAccountOwnerPredicate: () => eq(operations.id, "operation"),
    getDashboardWorkspace: async () => ({revision: 1, payload: {keywordTables: []}}),
    assertServiceCapability: async () => ({mode: "operator"}),
    getLatestAuthenticatedKnowledgeSnapshot: async () => null,
    getApiCredentialStatus: async () => ({status: "inactive"}),
    getDecryptedCredentialForUser: async () => null,
    createCredentialAgentClient: client,
    orderManusV2EventsByProviderRank: (items: any[]) => items,
    projectBrandQuestionExecution: () => undefined,
  } as unknown as BrandKeywordPorts);
  return {service, operation, task, locks, client};
}

describe("词库产物重放", () => {
  it("不同轮询时间生成同一工作簿时，字节与存储身份保持相同", async () => {
    vi.useFakeTimers({toFake: ["Date"]});
    vi.setSystemTime(new Date("2026-10-25T05:00:00Z"));
    const first = await buildAndVerifyBrandQuestionUniverseWorkbook(payload);
    vi.setSystemTime(new Date("2026-10-25T05:01:10Z"));
    const replay = await buildAndVerifyBrandQuestionUniverseWorkbook(payload);
    expect(replay.sha256).toBe(first.sha256);
    expect(replay.bytes.equals(first.bytes)).toBe(true);
  });
  it("延迟到达的失败更新不能覆盖已成功任务及其原始提供商状态", async () => {
    const h = stateHarness("succeeded");
    await h.service.updateOperationState({
      operationId: "operation", taskId: "task", status: "failed",
      providerState: "failed", errorCode: "WORKBOOK_OR_PUBLISH_FAILED",
    });
    expect(h.operation.status).toBe("succeeded");
    expect(h.task.providerState).toBe("stopped");
    expect(h.locks).toHaveBeenCalledWith("update");
  });
  it("读取已发布但被误标失败的任务时恢复原结果，不调用模型或重建产物", async () => {
    const h = stateHarness("failed");
    const result = await h.service.observeBrandQuestionUniverse({id: 42} as any);
    expect(result.operation?.status).toBe("succeeded");
    expect(result.operation?.publicationOutcome).toBe("published");
    expect(h.operation.errorCode).toBeNull();
    expect(h.client).not.toHaveBeenCalled();
  });
});
