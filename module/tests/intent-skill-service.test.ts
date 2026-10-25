// @vitest-environment node
import {describe, expect, it, vi} from "vitest";
import {mysqlTable, varchar, MySqlDialect} from "drizzle-orm/mysql-core";
import {createIntentWorkbenchService} from "../server/intent-workbench-service";
import {registerIntentSkillPorts} from "../server/intent-skill-runtime";
import {emptyIntentState} from "../contracts/intent-workbench";
import type {BrandKeywordPorts} from "../server/brand-keyword-ports";
import type {ModuleHttpCore} from "../server/http-api";
import type {Request} from "express";

vi.mock("../server/knowledge-node-workspace-service.js", () => ({getKnowledgeNodeDetails: vi.fn(), saveKnowledgeNodeContent: vi.fn()}));
function harness() {
  const operations = mysqlTable("operations_test", {id: varchar("id", {length: 191})});
  const tasks = mysqlTable("tasks_test", {id: varchar("id", {length: 191}), operationId: varchar("operationId", {length: 191})});
  const events = mysqlTable("events_test", {id: varchar("id", {length: 191})});
  let ledger: {revision: number; state: ReturnType<typeof emptyIntentState>} | undefined;
  const storedTasks: any[] = []; const storedOperations: any[] = [];
  const nodes = [{leafId: "node", title: "选材", branchTitle: "产品", status: "confirmed", content: "材料选择依据适用条件。", contentVersion: 1}];
  const dialect = new MySqlDialect();
  const db: any = {
    async execute(query: any) {
      const {sql, params} = dialect.sqlToQuery(query);
      if (sql.startsWith("INSERT IGNORE")) ledger ??= {revision: 0, state: JSON.parse(params.at(-1) as string)};
      if (sql.startsWith("UPDATE brand_intent")) {ledger!.state = JSON.parse(params[0] as string); ledger!.revision++;}
      if (sql.startsWith("SELECT revision")) return [[...(ledger ? [{revision: ledger.revision, payload: JSON.stringify(ledger.state)}] : [])]];
      if (sql.includes("FROM knowledge_base_builds")) return [[{id: "build", conversationId: "conversation", generation: 1, contentVersion: 1, status: "published", activeTurnId: null}]];
      if (sql.includes("FROM knowledge_base_build_nodes")) return [nodes];
      return [[]];
    },
    async transaction(work: any) {
      const before = structuredClone(ledger); const beforeTasks = structuredClone(storedTasks); const beforeOperations = structuredClone(storedOperations);
      try {return await work(db);} catch (e) {
        ledger = before; storedTasks.splice(0, storedTasks.length, ...beforeTasks); storedOperations.splice(0, storedOperations.length, ...beforeOperations); throw e;
      }
    },
    insert(table: any) {return {async values(value: any) {
      if (table === tasks) storedTasks.push(structuredClone(value));
      if (table === operations) storedOperations.push(structuredClone(value));
    }};},
    select() {return {from: () => ({where: (predicate: any) => ({limit: async () =>
      storedTasks.filter(task => task.id === dialect.sqlToQuery(predicate).params[0])})})};},
    update(table: any) {return {set: (value: any) => ({where: async (predicate: any) => {
      const id = dialect.sqlToQuery(predicate).params[0];
      Object.assign((table === tasks ? storedTasks : storedOperations).find(row => row.id === id), value);
    }})};},
  };
  const credential = {id: "credential", version: 1, verifiedAt: new Date(), status: "active", provider: "manus", agentProfile: "frontmind-base", upstreamModel: "model"};
  const client = {
    uploadFile: vi.fn(async () => ({fileId: "file"})),
    createTask: vi.fn(async () => ({taskId: "upstream-task"})),
    findCreatedTask: vi.fn(async () => ({matches: [{id: "upstream-task"}], unique: {id: "upstream-task"}})),
    taskDetail: vi.fn(async () => ({status: "running"})),
    listAllMessages: vi.fn(async (): Promise<any[]> => []),
  };
  const latestState = vi.fn(() => "running");
  registerIntentSkillPorts({
    agentOperations: operations, agentTasks: tasks, agentEvents: events,
    getApiCredentialStatus: async () => credential, getDecryptedCredentialForUser: async () => credential,
    getDecryptedCredentialForAccountById: async () => credential, lockAccountRecord: async () => {},
    assertActorAllowed: () => {}, lockCustomerProjectBusinessWrite: async () => {},
    assertServiceCapability: async () => ({}), createCredentialAgentClient: () => client,
    recordUpstreamResource: async () => {}, orderManusV2EventsByProviderRank: (values: any[]) => values,
    classifyManusV2StructuredResultEnvelope: (value: any) => value.success ? {kind: "accepted", value: value.value} : {kind: "rejected"},
    latestManusV2TaskState: latestState,
  } as unknown as BrandKeywordPorts);
  const core: ModuleHttpCore = {context: () => ({accountUserId: 42, actorUserId: 42, enterpriseProjectId: "project",
    businessOwnerId: "42", businessActorId: "42"}), database: async () => db, environment: {}};
  const service = createIntentWorkbenchService(core, {frontmindUser: {id: 42, role: "user"}} as unknown as Request);
  async function intake() {
    return service.command({kind: "intake", expectedRevision: 0, questions: [
      {id: "q", question: "材料如何选择？", category: "产品", subdivision: "", tableId: "t", rowIndex: 0, sourceRevision: 1},
    ]});
  }
  const request = {kind: "evaluate", expectedRevision: 1, questionIds: ["q"], clientRequestId: "00000000-0000-4000-8000-000000000001"};
  function output() {
    const input = storedTasks.at(-1).providerRuntime.input;
    return {operationToken: input.operationToken, inputHash: input.inputHash, evaluations: [{
      questionId: "q", value: 100, support: 100,
      dimensions: ["意图明确度", "品牌关联度", "决策相关度", "问题清晰度", "内容独特度", "知识支撑初评"].map(label => ({label, score: 100, reason: "知识证据"})),
      points: [{title: "适用条件", terms: ["条件"], status: "supported", nodeId: "node", evidence: "材料选择依据适用条件。", issue: "已确认"}], findings: [],
    }], plans: input.kind === "plan" ? [{questionId: "q", actions: [{
      kind: "question", title: "明确适用条件", nodeId: null, after: "材料选择有哪些适用条件？", source: "选材节点",
    }]}] : []};
  }
  const send = (value = output()) => client.listAllMessages.mockResolvedValue([{
    id: "event", timestamp: Date.now(), type: "structured_output_result", structured_output_result: {success: true, value},
  }]);
  return {service, client, intake, request, nodes, output, send, storedTasks, storedOperations, latestState,
    ledger: () => ledger!};
}
describe("优化模型持久化任务", () => {
  it("延迟轮询先读取已完成结果，不能仅凭本地时长判超时", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request); h.send();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    try {
      expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
      expect(h.client.createTask).toHaveBeenCalledTimes(1);
    } finally {clock.mockRestore();}
  });
  it("超时失败只回读原任务；真实结果到达后恢复，不重复上传或创建", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    try {
      expect((await h.service.poll()).state.jobs?.[0].status).toBe("failed");
      expect((await h.service.poll()).state.jobs?.[0].status).toBe("failed");
      h.send();
      const recovered = await h.service.poll();
      expect(recovered.state.jobs?.[0].status).toBe("succeeded");
      expect(recovered.state.evaluations[0].method).toBe("skill_v1");
      expect(h.client.createTask).toHaveBeenCalledTimes(1);
      expect(h.client.uploadFile).toHaveBeenCalledTimes(1);
    } finally {clock.mockRestore();}
  });
  it("超时恢复仍拒绝过期知识和伪造引用，不能覆盖更新任务", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.ledger().state.jobs![0].status = "failed";
    h.ledger().state.jobs![0].error = "模型任务超时，请查看账户任务记录后重新评估";
    h.send(); h.nodes[0].content += "知识变更";
    expect((await h.service.poll()).state.jobs?.[0].error).toContain("知识或问题已更新");
    expect(h.ledger().state.evaluations).toEqual([]);
    h.ledger().state.jobs![0].error = "模型任务超时，请查看账户任务记录后重新评估";
    h.ledger().state.jobs!.push({...h.ledger().state.jobs![0], id: "newer", status: "succeeded"});
    h.client.listAllMessages.mockClear();
    await h.service.poll();
    expect(h.client.listAllMessages).not.toHaveBeenCalled();
  });
  it("先保存任务，再调用 API；轮询发布模型结果，重放不重复创建", async () => {
    const h = harness(); await h.intake();
    const pending = await h.service.command(h.request);
    expect(pending.state.jobs?.[0].status).toBe("running");
    expect(pending.state.evaluations).toEqual([]);
    expect(h.storedOperations[0].accountUserId).toBe(42);
    expect(h.storedOperations[0].enterpriseProjectId).toBe("project");
    expect(h.client.createTask.mock.calls[0]).toBeDefined();
    h.send();
    const completed = await h.service.poll();
    expect(completed.state.jobs?.[0].status).toBe("succeeded");
    expect(completed.state.evaluations[0].method).toBe("skill_v1");
    await h.service.command(h.request);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("未知创建结果只能查询恢复，不再次 POST", async () => {
    const h = harness(); await h.intake();
    h.client.createTask.mockRejectedValueOnce(Object.assign(new Error("ambiguous"), {outcomeUnknown: true}));
    expect((await h.service.command(h.request)).state.jobs?.[0].status).toBe("create_unknown");
    h.send();
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
    expect(h.client.findCreatedTask).toHaveBeenCalledTimes(1);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("服务明确拒绝创建时立即显示失败，不进入未知创建等待或重复提交", async () => {
    const h = harness(); await h.intake();
    h.client.createTask.mockRejectedValueOnce(Object.assign(new Error("private schema error"), {
      status: 400, retryable: false, outcomeUnknown: false,
    }));
    const rejected = await h.service.command(h.request);
    expect(rejected.state.jobs?.[0].status).toBe("failed");
    expect(rejected.state.jobs?.[0].error).toContain("拒绝创建任务");
    expect(rejected.state.jobs?.[0].error).not.toContain("private");
    await h.service.poll();
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.client.findCreatedTask).not.toHaveBeenCalled();
    expect(rejected.state.evaluations).toEqual([]);
  });
  it("拒绝知识变化和伪造结果，不回退到规则评估", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.send(); h.nodes[0].content += "后来修改。";
    const changed = await h.service.poll();
    expect(changed.state.jobs?.[0].status).toBe("failed");
    expect(changed.state.evaluations).toEqual([]);
    expect(changed.state.jobs?.[0].error).toContain("知识或问题已更新");
  });
  it("模型格式错误不会写入评分，失败原因可见", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    const output = h.output(); output.evaluations[0].points[0].evidence = "伪造原文"; h.send(output);
    const result = await h.service.poll();
    expect(result.state.jobs?.[0].status).toBe("failed");
    expect(result.state.evaluations).toEqual([]);
  });
  it("任务处理中禁止修改清单及开启另一个任务", async () => {
    const h = harness(); await h.intake(); const state = await h.service.command(h.request);
    await expect(h.service.command({...h.request, expectedRevision: state.revision, clientRequestId: "00000000-0000-4000-8000-000000000002"})).rejects.toThrow("等待当前");
    await expect(h.service.command({kind: "intake", expectedRevision: state.revision, questions: [
      {id: "q2", question: "第二个问题", category: "", subdivision: "", tableId: "t", rowIndex: 1, sourceRevision: null},
    ]})).rejects.toThrow("等待当前");
  });
  it("执行和撤销后的分数由独立模型任务重评", async () => {
    const h = harness(); await h.intake();
    await h.service.command({...h.request, kind: "plan"}); h.send();
    const planned = await h.service.poll();
    const receiptId = "00000000-0000-4000-8000-000000000003";
    const executed = await h.service.execute({expectedRevision: planned.revision, clientRequestId: receiptId, questionIds: ["q"]});
    expect(executed.state.questions[0].question).toBe("材料选择有哪些适用条件？");
    expect(executed.state.receipts[0].status).toBe("completed");
    expect(executed.state.receipts[0].after).toEqual([]);
    expect(executed.state.jobs?.at(-1)?.status).toBe("running");
    h.send(); const reEvaluated = await h.service.poll();
    expect(reEvaluated.state.receipts[0].after[0].method).toBe("skill_v1");
    const reverted = await h.service.rollback({receiptId, expectedRevision: reEvaluated.revision});
    expect(reverted.state.questions[0].question).toBe("材料如何选择？");
    expect(reverted.state.receipts[0].status).toBe("reverted");
    expect(reverted.state.evaluations).toEqual([]);
    h.send(); expect((await h.service.poll()).state.evaluations[0].method).toBe("skill_v1");
    expect(h.client.createTask).toHaveBeenCalledTimes(3);
  });
  it("上游暂时不可读时保留原任务，不重复创建或泄露异常", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.client.listAllMessages.mockRejectedValueOnce(new Error("private upstream error"));
    const transient = await h.service.poll();
    expect(transient.state.jobs?.[0].status).toBe("running");
    expect(transient.state.jobs?.[0].error).toBeUndefined();
    h.send(); expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("持久化 Skill 快照遭修改时拒绝使用", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.storedTasks[0].providerRuntime.input.skill += "\nmodified";
    const result = await h.service.poll();
    expect(result.state.jobs?.[0].status).toBe("failed");
    expect(result.state.jobs?.[0].error).toContain("快照校验失败");
    expect(h.client.listAllMessages).not.toHaveBeenCalled();
  });
  it("并发轮询只允许一个租约持有者读取模型", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    let resolve!: (events: any[]) => void;
    h.client.listAllMessages.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
    const first = h.service.poll();
    await vi.waitFor(() => expect(h.client.listAllMessages).toHaveBeenCalledTimes(1));
    await h.service.poll();
    expect(h.client.listAllMessages).toHaveBeenCalledTimes(1);
    resolve([]); await first;
  });
  it("模型结束后等待结构化结果同步，而非立即判失败", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.latestState.mockReturnValue("completed");
    const waiting = await h.service.poll();
    expect(waiting.state.jobs?.[0].status).toBe("running");
    expect(waiting.state.jobs?.[0].terminalObservedAt).toBeDefined();
    h.send();
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
  });
});
