// @vitest-environment node
import {describe, expect, it, vi} from "vitest";
import {mysqlTable, varchar, json, MySqlDialect} from "drizzle-orm/mysql-core";
import {createIntentWorkbenchService} from "../server/intent-workbench-service";
import {getKnowledgeNodeDetails,saveKnowledgeNodeContent} from "../server/knowledge-node-workspace-service.js";
import {registerIntentSkillPorts} from "../server/intent-skill-runtime";
import {emptyIntentState, findSavedIntentPlan} from "../contracts/intent-workbench";
import type {BrandKeywordPorts} from "../server/brand-keyword-ports";
import type {ModuleHttpCore} from "../server/http-api";
import type {Request} from "express";

vi.mock("../server/knowledge-node-workspace-service.js", () => ({getKnowledgeNodeDetails: vi.fn(), saveKnowledgeNodeContent: vi.fn()}));
function harness(options: {mysqlJsonPayload?: "object" | "string"} = {}) {
  const operations = mysqlTable("operations_test", {id: varchar("id", {length: 191})});
  const tasks = mysqlTable("tasks_test", {id: varchar("id", {length: 191}), operationId: varchar("operationId", {length: 191})});
  const events = mysqlTable("events_test", {id: varchar("id", {length: 191}), taskId: varchar("taskId", {length: 191}), normalizedPayload: json("normalizedPayload")});
  let ledger: {revision: number; state: ReturnType<typeof emptyIntentState>} | undefined;
  const storedTasks: any[] = []; const storedOperations: any[] = []; const storedEvents: any[] = [];
  const nodes = [{leafId: "node", title: "选材", branchTitle: "产品", status: "confirmed", content: "材料选择依据适用条件。", contentVersion: 1}];
  const dialect = new MySqlDialect();
  // MySQL JSON normalizes object keys; neither driver return shape preserves
  // the insertion order used by the writer. Exercise the real SQL payload
  // boundary instead of passing the same in-memory question object back.
  function persistedPayload(state: ReturnType<typeof emptyIntentState>) {
    const value = JSON.parse(JSON.stringify(state), (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)))
        : value);
    return options.mysqlJsonPayload === "object" ? value : JSON.stringify(value);
  }
  const db: any = {
    async execute(query: any) {
      const {sql, params} = dialect.sqlToQuery(query);
      if (sql.startsWith("INSERT IGNORE")) ledger ??= {revision: 0, state: JSON.parse(params.at(-1) as string)};
      if (sql.startsWith("UPDATE brand_intent")) {ledger!.state = JSON.parse(params[0] as string); ledger!.revision++;}
      if (sql.startsWith("SELECT revision")) return [[...(ledger ? [{revision: ledger.revision,
        payload: options.mysqlJsonPayload ? persistedPayload(ledger.state) : JSON.stringify(ledger.state)}] : [])]];
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
      if (table === events) storedEvents.push(structuredClone(value));
    }};},
    select() {return {from: (table: any) => ({where: (predicate: any) => ({limit: async () =>
      (table === events ? storedEvents.filter(event => event.taskId === dialect.sqlToQuery(predicate).params[0]) :
        storedTasks.filter(task => task.id === dialect.sqlToQuery(predicate).params[0] && task.operationId === dialect.sqlToQuery(predicate).params[1]))})})};},
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
    sendMessage: vi.fn(async () => ({taskId: "upstream-task"})),
    stopTask: vi.fn(async () => ({taskId: "upstream-task"})),
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
      kind: "todo", title: "补充适用条件资料", nodeId: null, after: "补充并核验材料适用条件的来源资料", source: "选材节点",
    }]}] : []};
  }
  const send = (value = output()) => client.listAllMessages.mockResolvedValue([{
    id: "event", timestamp: Date.now(), type: "structured_output_result", structured_output_result: {success: true, value},
  }]);
  return {service, client, intake, request, nodes, output, send, storedTasks, storedOperations, latestState,
    core, storedEvents, ledger: () => ledger!};
}
describe("优化模型持久化任务", () => {
  it("暂停真实上游执行、刷新不推进，继续同一任务并忽略暂停前的取消事件", async () => {
    const h = harness();
    await h.intake(); await h.service.command(h.request);
    h.client.stopTask.mockImplementation(async () => {
      h.client.taskDetail.mockResolvedValue({status: "cancelled"}); return {taskId: "upstream-task"};
    });
    const paused = await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
    expect(paused.state.jobs![0].status).toBe("paused");
    await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
    const reads = h.client.listAllMessages.mock.calls.length;
    await h.service.poll();
    expect(h.client.listAllMessages).toHaveBeenCalledTimes(reads);
    expect(h.client.stopTask).toHaveBeenCalledTimes(1);
    h.client.listAllMessages.mockResolvedValue([{id: "old-stop", type: "user_stop", timestamp: Date.now()}]);
    const resumed = await h.service.control({jobId: h.request.clientRequestId, action: "resume"});
    expect(resumed.state.jobs![0].status).toBe("running");
    expect(h.client.sendMessage).toHaveBeenCalledWith(expect.objectContaining({taskId: "upstream-task", structuredOutputSchema: expect.any(Object)}));
    await h.service.control({jobId: h.request.clientRequestId, action: "resume"});
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    h.send();
    expect((await h.service.poll()).state.jobs![0].status).toBe("succeeded");
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("暂停请求结果不明时只读核对，不重复停止或误报已暂停", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.client.stopTask.mockRejectedValue(new TypeError("connection lost"));
    expect((await h.service.control({jobId: h.request.clientRequestId, action: "pause"})).state.jobs![0].status).toBe("pausing");
    await h.service.poll(); await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
    expect(h.client.stopTask).toHaveBeenCalledTimes(1);
    h.client.taskDetail.mockResolvedValue({status: "cancelled"});
    expect((await h.service.poll()).state.jobs![0].status).toBe("paused");
  });
  it("继续请求结果不明时不重复发送，观察到新执行后恢复原任务", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.client.taskDetail.mockResolvedValue({status: "cancelled"});
    await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
    h.client.sendMessage.mockRejectedValue(new TypeError("connection lost"));
    expect((await h.service.control({jobId: h.request.clientRequestId, action: "resume"})).state.jobs![0].status).toBe("resuming");
    await h.service.poll(); await h.service.control({jobId: h.request.clientRequestId, action: "resume"});
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    h.client.taskDetail.mockResolvedValue({status: "running"});
    expect((await h.service.poll()).state.jobs![0].status).toBe("running");
  });
  it("删除当前评估题和其他题均生效，原题结果只留历史，不恢复删除问题", async () => {
    const h = harness(); await h.intake();
    const withOther = await h.service.command({kind: "intake", expectedRevision: 1, questions: [{
      id: "q2", question: "其他问题如何处理？", category: "产品", subdivision: "", tableId: "t", rowIndex: 1, sourceRevision: 1,
    }]});
    const started = await h.service.command({...h.request, expectedRevision: withOther.revision});
    const removed = await h.service.command({kind: "delete-question", questionId: "q", expectedRevision: started.revision});
    await h.service.command({kind: "delete-question", questionId: "q2", expectedRevision: removed.revision});
    h.send();
    const completed = await h.service.poll();
    expect(completed.state.jobs![0].status).toBe("succeeded");
    expect(completed.state.questions).toEqual([]);
    expect(completed.state.evaluations).toEqual([]);
    expect(completed.state.jobs![0].result!.questions[0].question).toBe("材料如何选择？");
  });
  it("正式问题仅来源版本和位置变化时保留评估，实际题干变化时拒绝评分", async () => {
    for (const semanticChange of [false, true]) {
      const h = harness();
      let questions = [{id: "q", question: "材料如何选择？", category: "产品", subdivision: "",
        tableId: "dashboard:confirmed", rowIndex: 1, sourceRevision: 4}];
      h.core.intentQuestionCatalog = async () => questions;
      const first = await h.service.observe();
      await h.service.command({...h.request, expectedRevision: first.revision});
      questions = questions.map(question => ({...question, sourceRevision: 5, rowIndex: 0,
        question: semanticChange ? "材料如何保养？" : question.question}));
      h.send();
      const completed = await h.service.poll();
      expect(completed.state.jobs![0].status).toBe("succeeded");
      expect(completed.state.evaluations).toHaveLength(semanticChange ? 0 : 1);
    }
  });
  it.each(["object", "string"] as const)("MySQL JSON %s round trip keeps GET stable and permits the first evaluation once", async mysqlJsonPayload => {
    const h = harness({mysqlJsonPayload});
    const questions = [{id: "q", question: "材料如何选择？", category: "product_scenario", subdivision: "",
      tableId: "dashboard:confirmed", rowIndex: 0, sourceRevision: 4}];
    h.core.intentQuestionCatalog = async () => questions;
    const first = await h.service.observe();
    expect(first.state.questions).toEqual(questions);
    expect(JSON.stringify(first.state.questions[0])).not.toBe(JSON.stringify(questions[0]));
    expect(first.state.questions[0].sourceRevision).toBe(4);
    expect((await h.service.observe()).revision).toBe(first.revision);
    const request = {...h.request, expectedRevision: first.revision};
    const started = await h.service.command(request);
    expect(started.state.jobs).toHaveLength(1);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.storedTasks).toHaveLength(1);
    expect((await h.service.observe()).revision).toBe(started.revision);
    const repeated = await h.service.command(request);
    expect(repeated.state.jobs).toHaveLength(1);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.storedTasks).toHaveLength(1);
  });
  it("同步宿主正式问题但不更换 ID、不重复写入或启动评估", async () => {
    const h = harness();
    let questions = Array.from({length: 8}, (_, rowIndex) => ({id: `formal-${rowIndex}`,
      question: `正式问题${rowIndex}？`, category: "product_scenario", subdivision: "",
      tableId: "dashboard:confirmed", rowIndex, sourceRevision: 4}));
    h.core.intentQuestionCatalog = vi.fn(async () => questions);
    const first = await h.service.observe();
    expect(first.state.questions).toEqual(questions);
    expect((await h.service.observe()).revision).toBe(first.revision);
    expect(h.client.createTask).not.toHaveBeenCalled();
    expect(h.storedTasks).toEqual([]);
    // 方案B：宿主问题可从本清单移除（dismissal）；目录仍持有它时不回注，revision 稳定。
    const removed = await h.service.command({kind: "delete-question", questionId: questions[0].id,
      expectedRevision: first.revision});
    expect(removed.state.questions.map(q => q.id)).toEqual(questions.slice(1).map(q => q.id));
    expect(removed.state.dismissedHostQuestionIds).toEqual([questions[0].id]);
    const dismissedView = await h.service.observe();
    expect(dismissedView.state.questions.map(q => q.id)).toEqual(questions.slice(1).map(q => q.id));
    expect((await h.service.observe()).revision).toBe(dismissedView.revision);
    // 撤销：清除 dismissal 后，宿主目录下一次读取重新注入（追加到清单尾部）。
    const restored = await h.service.command({kind: "restore-question", questionId: questions[0].id,
      expectedRevision: dismissedView.revision});
    expect(restored.state.questions.map(q => q.id)).toEqual(expect.arrayContaining(questions.map(q => q.id)));
    expect(restored.state.questions).toHaveLength(questions.length);
    expect(restored.state.dismissedHostQuestionIds).toEqual([]);
    // 宿主取消勾选后 dismissal 过期清除，重新勾选的问题再次进入清单。
    await h.service.command({kind: "delete-question", questionId: questions[0].id,
      expectedRevision: restored.revision});
    questions = questions.slice(1);
    const unchecked = await h.service.observe();
    expect(unchecked.state.questions.map(q => q.id)).toEqual(questions.map(q => q.id));
    expect(unchecked.state.dismissedHostQuestionIds).toEqual([]);
    const recheckedCatalog = [first.state.questions[0], ...questions];
    questions = recheckedCatalog;
    const rechecked = await h.service.observe();
    expect(rechecked.state.questions.map(q => q.id)).toEqual(expect.arrayContaining(recheckedCatalog.map(q => q.id)));
    expect(rechecked.state.questions).toHaveLength(recheckedCatalog.length);
    expect(h.client.createTask).not.toHaveBeenCalled();
  });
  it("正式问题的资料待办执行保留原题及来源，并启动独立复评", async () => {
    const h = harness();
    const initial = await h.intake();
    h.core.intentQuestionCatalog = async () => initial.state.questions.map(question => ({...question, tableId: "dashboard:confirmed"}));
    const synced = await h.service.observe();
    await h.service.command({...h.request, kind: "plan", expectedRevision: synced.revision});
    h.send();
    const planned = await h.service.poll();
    const executed = await h.service.execute({expectedRevision: planned.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000007", questionIds: ["q"]});
    expect(executed.state.receipts[0]).toMatchObject({status: "completed", changes: [
      {questionId: "q", action: {kind: "todo"}, status: "succeeded"},
    ]});
    expect(executed.state.todos).toMatchObject([{questionId: "q", title: "补充并核验材料适用条件的来源资料", status: "pending"}]);
    expect(h.ledger().state.questions).toEqual(synced.state.questions);
    expect(executed.state.jobs?.at(-1)).toMatchObject({kind: "evaluate", status: "running"});
    expect(h.client.createTask).toHaveBeenCalledTimes(2);
  });
  it("checks formal source freshness before reserving a paid command", async () => {
    const h = harness();
    const initial = await h.intake();
    const questions = initial.state.questions.map(question => ({...question, tableId: "dashboard:confirmed"}));
    h.core.intentQuestionCatalog = async () => questions;
    const synced = await h.service.observe();
    // Simulate another writer changing the formal source after the preflight
    // observe but before this operation obtains the business write lock.
    h.core.intentQuestionCatalog = vi.fn().mockResolvedValueOnce(questions)
      .mockResolvedValue(questions.map(question => ({...question, question: "正式来源已修改？", sourceRevision: 2})));
    await expect(h.service.command({...h.request, expectedRevision: synced.revision}))
      .rejects.toMatchObject({code: "REVISION_CONFLICT"});
    expect(h.storedTasks).toEqual([]);
    expect(h.client.createTask).not.toHaveBeenCalled();
  });
  it("问题修改和删除通过真实命令落库，保留历史且不创建模型任务", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    const history = structuredClone(completed.state.jobs);
    const updated = await h.service.command({kind: "update-question", expectedRevision: completed.revision,
      questionId: "q", question: "材料选型需要哪些依据？", category: "industry", subdivision: "选型"});
    expect(updated.state.questions[0]).toEqual({...completed.state.questions[0],
      question: "材料选型需要哪些依据？", category: "industry", subdivision: "选型"});
    expect(updated.state.evaluations).toEqual([]);
    expect(updated.state.plans).toEqual([]);
    expect(updated.state.jobs).toEqual(history);
    const reopened = createIntentWorkbenchService(h.core, {frontmindUser: {id: 42, role: "user"}} as unknown as Request);
    expect((await reopened.observe()).state.questions).toEqual(updated.state.questions);
    await expect(reopened.command({kind: "delete-question", expectedRevision: completed.revision, questionId: "q"})).rejects.toThrow("清单已被更新");
    expect((await reopened.observe()).state.questions).toHaveLength(1);
    const removed = await reopened.command({kind: "delete-question", expectedRevision: updated.revision, questionId: "q"});
    expect(removed.state.questions).toEqual([]);
    expect(removed.state.jobs).toEqual(history);
    expect((await reopened.observe()).state.questions).toEqual([]);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("重复问题和非法输入拒绝，评估中的删除独立生效", async () => {
    const h = harness(); const initial = await h.intake();
    const second = await h.service.command({kind: "intake", expectedRevision: initial.revision,
      questions: [{...initial.state.questions[0], id: "q2", question: "另一个材料问题？", rowIndex: 1}]});
    await expect(h.service.command({kind: "update-question", expectedRevision: second.revision,
      questionId: "q", question: second.state.questions[1].question, category: "industry", subdivision: ""})).rejects.toThrow("相同问题");
    await expect(h.service.command({kind: "update-question", expectedRevision: second.revision,
      questionId: "q", question: " ", category: "industry", subdivision: ""})).rejects.toThrow();
    expect((await h.service.observe()).state.questions).toEqual(second.state.questions);
    const running = await h.service.command({...h.request, expectedRevision: second.revision});
    await h.service.command({kind: "delete-question", expectedRevision: running.revision, questionId: "q"});
    expect((await h.service.observe()).state.questions).toHaveLength(1);
  });
  it.each(["running", "paused"])("%s时改当前题不改任务输入，新题不承接旧评分方案", async status => {
    const h = harness(); await h.intake();
    let current = await h.service.command({...h.request, kind: "plan"});
    if (status === "paused") {
      h.client.taskDetail.mockResolvedValue({status: "cancelled"});
      current = await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
    }
    const changed = await h.service.command({kind: "update-question", expectedRevision: current.revision,
      questionId: "q", question: "材料如何维护？", category: "产品", subdivision: ""});
    expect(changed.state.questions[0].question).toBe("材料如何维护？");
    expect(h.storedTasks[0].providerRuntime.input.selectedQuestions[0].question).toBe("材料如何选择？");
    if (status === "paused") {
      await h.service.control({jobId: h.request.clientRequestId, action: "resume"});
      h.client.taskDetail.mockResolvedValue({status: "running"});
    }
    h.send();
    const completed = await h.service.poll();
    expect(completed.state.jobs![0].status).toBe("succeeded");
    expect(completed.state.jobs![0].result!.questions[0].question).toBe("材料如何选择？");
    expect(completed.state.evaluations).toEqual([]);
    expect(completed.state.plans).toEqual([]);
    expect(findSavedIntentPlan(completed.state, "q")).toBeUndefined();
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it.each(["running", "paused"])("%s评估不拦截独立方案，重复评估仍拒绝且后台推进方案", async status => {
    const h = harness(); await h.intake();
    let current = await h.service.command(h.request);
    const oldOutput = h.output();
    if (status === "paused") {
      h.client.taskDetail.mockResolvedValue({status: "cancelled"});
      current = await h.service.control({jobId: h.request.clientRequestId, action: "pause"});
      h.client.taskDetail.mockResolvedValue({status: "running"});
    }
    const planRequest = {...h.request, kind: "plan", expectedRevision: current.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000002"};
    const parallel = await h.service.command(planRequest);
    expect(parallel.state.jobs!.map(job => job.kind)).toEqual(["evaluate", "plan"]);
    expect(parallel.state.jobs![0].status).toBe(status);
    await expect(h.service.command({...h.request, expectedRevision: parallel.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000003"})).rejects.toMatchObject({code: "OPERATION_ACTIVE"});
    await h.service.command({...planRequest, expectedRevision: parallel.revision});
    expect(h.client.createTask).toHaveBeenCalledTimes(2);
    const planOutput = h.output();
    // Separate upstream events by immutable operation input.
    h.client.listAllMessages.mockImplementation(async () => []);
    h.send(planOutput);
    if (status === "running") {
      h.client.listAllMessages.mockResolvedValueOnce([{id: "evaluation", timestamp: Date.now(),
        type: "structured_output_result", structured_output_result: {success: true, value: oldOutput}}]);
    }
    const completed = await h.service.poll();
    expect(completed.state.jobs![1].status).toBe("succeeded");
    expect(completed.state.jobs![0].status).toBe(status === "paused" ? "paused" : "succeeded");
    expect(completed.state.plans).toHaveLength(1);
    expect(completed.state.evaluations[0].provenance?.operationId).toBe(planRequest.clientRequestId);
  });
  it("完成结果固化，修改方案和失败重评均不覆盖历史，刷新无需调用模型", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    const snapshot = structuredClone(completed.state.jobs![0].result!);
    expect(snapshot.questions[0].question).toBe("材料如何选择？");
    expect(snapshot.plans).toHaveLength(1);
    await h.service.command({kind: "edit", expectedRevision: completed.revision, questionId: "q",
      actions: [{id: completed.state.plans[0].actions[0].id, selected: true, after: "修改后的问题？"}]});
    const current = await h.service.observe();
    expect(current.state.jobs![0].result).toEqual(snapshot);
    h.client.createTask.mockRejectedValueOnce(Object.assign(new Error("rejected"), {status: 400, retryable: false, outcomeUnknown: false}));
    const failed = await h.service.command({...h.request, expectedRevision: current.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000002"});
    expect(failed.state.jobs![1].status).toBe("failed");
    expect(failed.state.evaluations).toEqual(completed.state.evaluations);
    expect(failed.state.plans[0].actions[0].after).toBe("修改后的问题？");
    expect(failed.state.jobs![0].result).toEqual(snapshot);
    h.client.listAllMessages.mockClear();
    const reopened = createIntentWorkbenchService(h.core, {frontmindUser: {id: 42, role: "user"}} as unknown as Request);
    expect((await reopened.observe()).state.jobs![0].result).toEqual(snapshot);
    expect(h.client.listAllMessages).not.toHaveBeenCalled();
  });
  it("生成方案期间仍可保存当前题草稿，迟到的新方案留历史且不覆盖人工保存", async () => {
    const h = harness(); await h.intake();
    await h.service.command({...h.request, kind: "plan"}); h.send();
    const initial = await h.service.poll();
    h.client.listAllMessages.mockResolvedValue([]);
    const request = {...h.request, kind: "plan", expectedRevision: initial.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000009"};
    const running = await h.service.command(request);
    const action = running.state.plans[0].actions[0];
    await h.service.command({kind: "edit", expectedRevision: running.revision, questionId: "q",
      actions: [{id: action.id, selected: true, after: "人工保存的资料收集要求"}]});
    h.send();
    const completed = await h.service.poll();
    expect(completed.state.jobs!.at(-1)!.status).toBe("succeeded");
    expect(completed.state.plans[0].actions[0].after).toBe("人工保存的资料收集要求");
    expect(completed.state.jobs!.at(-1)!.result!.plans[0].actions[0].after).not.toBe("人工保存的资料收集要求");
  });
  it("历史成功任务从已验收的本地事件恢复，凭据失效也不派发模型", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    delete h.ledger().state.jobs![0].result;
    h.ledger().state.evaluations = []; h.ledger().state.plans = [];
    h.client.listAllMessages.mockClear();
    const credentialRead = vi.spyOn((await import("../server/intent-skill-runtime")).intentSkillPorts(), "getDecryptedCredentialForAccountById");
    credentialRead.mockRejectedValue(new Error("credential retired"));
    const reopened = await h.service.observe();
    expect(reopened.state.jobs![0].result!.evaluations[0].value).toBe(100);
    expect(reopened.state.jobs![0].result!.plans).toEqual(completed.state.plans);
    expect(credentialRead).not.toHaveBeenCalled();
    expect(h.client.listAllMessages).not.toHaveBeenCalled();
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    const revision = reopened.revision;
    expect((await h.service.observe()).revision).toBe(revision);
    credentialRead.mockRestore();
  });
  it("保存历史方案草稿时恢复已验收方案，保留输入依据和历史快照，不调用模型", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    delete h.ledger().state.jobs![0].result!.plans[0].inputHash;
    const snapshot = structuredClone(h.ledger().state.jobs![0].result);
    h.ledger().state.plans = [];
    const reopened = await h.service.observe();
    const reads = h.client.listAllMessages.mock.calls.length;
    expect(reopened.state.plans).toEqual([]);
    const action = snapshot!.plans[0].actions[0];
    const edited = await h.service.command({kind: "edit", expectedRevision: reopened.revision, questionId: "q",
      actions: [{id: action.id, selected: true, after: "人工审核后的问题？"}]});
    expect(edited.state.plans[0].inputHash).toBe(completed.state.jobs![0].inputHash);
    expect(edited.state.plans[0].actions[0].after).toBe("人工审核后的问题？");
    expect(edited.state.jobs![0].result).toEqual(snapshot);
    expect((await h.service.observe()).state.plans).toEqual(edited.state.plans);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.client.listAllMessages).toHaveBeenCalledTimes(reads);
  });
  it("历史草稿恢复不绕过过期方案校验，执行拒绝时不产生回执", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    h.ledger().state.plans = [];
    h.nodes[0].content += "更新后的知识。";
    const action = completed.state.plans[0].actions[0];
    const edited = await h.service.command({kind: "edit", expectedRevision: completed.revision, questionId: "q",
      actions: [{id: action.id, selected: true, after: "审核后的问题？"}]});
    await expect(h.service.execute({expectedRevision: edited.revision,
      clientRequestId: "00000000-0000-4000-8000-000000000098", questionIds: ["q"]})).rejects.toMatchObject({code: "PLAN_STALE"});
    expect(h.ledger().state.receipts).toEqual([]);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("历史快照不能覆盖当前已编辑草稿，非法动作恢复失败不会写入方案", async () => {
    const h = harness(); await h.intake(); await h.service.command({...h.request, kind: "plan"}); h.send();
    const completed = await h.service.poll();
    const action = completed.state.plans[0].actions[0];
    h.ledger().state.plans[0].actions[0].after = "当前已编辑草稿";
    const current = await h.service.command({kind: "edit", expectedRevision: completed.revision, questionId: "q",
      actions: [{id: action.id, selected: false, after: "保留当前编辑"}]});
    expect(current.state.plans[0].actions[0].after).toBe("保留当前编辑");
    h.ledger().state.plans = [];
    await expect(h.service.command({kind: "edit", expectedRevision: current.revision, questionId: "q",
      actions: [{id: "unknown-action", selected: true, after: "不应保存"}]})).rejects.toMatchObject({code: "ACTION_MISSING"});
    expect(h.ledger().state.plans).toEqual([]);
    expect(h.ledger().revision).toBe(current.revision);
  });
  it("恢复历史拒绝伪造原文和错误任务关联，不影响现有清单", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request); h.send(); await h.service.poll();
    delete h.ledger().state.jobs![0].result;
    h.storedEvents[0].normalizedPayload.value.evaluations[0].points[0].evidence = "伪造";
    expect((await h.service.observe()).state.jobs![0].result).toBeUndefined();
    h.storedTasks[0].operationId = "another-workspace";
    expect((await h.service.observe()).state.jobs![0].result).toBeUndefined();
  });
  it("大量事件连续读取时稳定保留最近24条，不回跳旧事件", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    const timestamp = Date.now();
    h.client.listAllMessages.mockResolvedValue(Array.from({length: 30}, (_, index) => ({
      id: `event-${index}`, type: "assistant_message", timestamp: timestamp + index,
    })));
    const first = (await h.service.poll()).state.jobs![0].progress!.events;
    const second = (await h.service.poll()).state.jobs![0].progress!.events;
    expect(first).toHaveLength(24);
    expect(second).toEqual(first);
    expect(first[0].at).toBe(new Date(timestamp + 6).toISOString());
    expect(first.at(-1)!.at).toBe(new Date(timestamp + 29).toISOString());
  });
  it("任务动态只保存公开标签，重复读取去重且不暴露原始内容", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.client.listAllMessages.mockResolvedValue([{id: "private-id", type: "assistant_message", timestamp: Date.now(),
      assistant_message: {content: "secret reasoning and unvalidated score 99"}},
    {id: "unknown", type: "reasoning", timestamp: Date.now(), content: "private"}]);
    await h.service.poll();
    const progress = (await h.service.poll()).state.jobs![0].progress!;
    expect(progress.stage).toBe("analyzing");
    expect(progress.events).toHaveLength(1);
    expect(progress.events[0].label).toBe("模型返回了一条任务消息");
    expect(JSON.stringify(progress)).not.toMatch(/secret reasoning|private-id|unvalidated score/);
    h.send(); const completed = await h.service.poll();
    expect(completed.state.jobs![0].progress!.stage).toBe("completed");
    expect(completed.state.evaluations).toHaveLength(1);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
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
    expect((await h.service.poll()).state.jobs?.[0].error).toContain("知识已更新");
    expect(h.ledger().state.evaluations).toEqual([]);
    h.ledger().state.jobs![0].error = "模型任务超时，请查看账户任务记录后重新评估";
    h.ledger().state.jobs!.push({...h.ledger().state.jobs![0], id: "newer", status: "succeeded"});
    h.client.listAllMessages.mockClear();
    await h.service.poll();
    expect(h.client.listAllMessages).not.toHaveBeenCalled();
  });
  it("回读期间开启更新任务时，旧结果不能发布", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.ledger().state.jobs![0].status = "failed";
    h.ledger().state.jobs![0].error = "模型任务超时，请查看账户任务记录后重新评估";
    let resolve!: (events: any[]) => void;
    h.client.listAllMessages.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
    const recovering = h.service.poll();
    await vi.waitFor(() => expect(h.client.listAllMessages).toHaveBeenCalledTimes(1));
    h.ledger().state.jobs!.push({...h.ledger().state.jobs![0], id: "newer", status: "running"});
    resolve([{id: "event", timestamp: Date.now(), type: "structured_output_result",
      structured_output_result: {success: true, value: h.output()}}]);
    await recovering;
    expect(h.ledger().state.evaluations).toEqual([]);
    expect(h.ledger().state.jobs![0].error).toContain("更新的评估任务");
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
    expect(changed.state.jobs?.[0].error).toContain("知识已更新");
  });
  it("模型证据错误触发一次修复，修复再次失败仍不写入评分", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    const output = h.output(); output.evaluations[0].points[0].evidence = "伪造原文"; h.send(output);
    h.latestState.mockReturnValue("stopped");
    expect((await h.service.poll()).state.jobs?.[0].repair).toBeDefined();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    h.client.listAllMessages.mockResolvedValue([{id: "repaired", timestamp: Date.now(), type: "structured_output_result",
      structured_output_result: {success: true, value: output}}]);
    const result = await h.service.poll();
    expect(result.state.jobs?.[0].status).toBe("failed");
    expect(result.state.jobs?.[0].error).toContain("自动修复后仍未通过");
    expect(result.state.evaluations).toEqual([]);
  });
  it("任务处理中禁止开启另一个模型任务，仍可加入其他问题", async () => {
    const h = harness(); await h.intake(); const state = await h.service.command(h.request);
    await expect(h.service.command({...h.request, expectedRevision: state.revision, clientRequestId: "00000000-0000-4000-8000-000000000002"})).rejects.toThrow("等待当前");
    const added = await h.service.command({kind: "intake", expectedRevision: state.revision, questions: [
      {id: "q2", question: "第二个问题", category: "", subdivision: "", tableId: "t", rowIndex: 1, sourceRevision: null},
    ]});
    expect(added.state.questions).toHaveLength(2);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
  });
  it("执行和撤销后的分数由独立模型任务重评", async () => {
    const h = harness(); const initial = await h.intake();
    await h.service.command({...h.request, kind: "plan"}); h.send();
    const planned = await h.service.poll();
    const receiptId = "00000000-0000-4000-8000-000000000003";
    const executed = await h.service.execute({expectedRevision: planned.revision, clientRequestId: receiptId, questionIds: ["q"]});
    expect(executed.state.questions).toEqual(initial.state.questions);
    expect(executed.state.todos).toMatchObject([{questionId: "q", title: "补充并核验材料适用条件的来源资料", status: "pending"}]);
    expect(executed.state.receipts[0].changes).toMatchObject([{questionId: "q", action: {kind: "todo"}, status: "succeeded"}]);
    expect(executed.state.receipts[0].status).toBe("completed");
    expect(executed.state.receipts[0].after).toEqual([]);
    expect(executed.state.jobs?.at(-1)?.status).toBe("running");
    h.send(); const reEvaluated = await h.service.poll();
    expect(reEvaluated.state.receipts[0].after[0].method).toBe("skill_v1");
    const reverted = await h.service.rollback({receiptId, expectedRevision: reEvaluated.revision});
    expect(reverted.state.questions).toEqual(initial.state.questions);
    expect(reverted.state.todos).toEqual([]);
    expect(reverted.state.receipts[0].changes[0].status).toBe("reverted");
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
  it("正常 stopped 等待结果同步，不再误报执行失败", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.latestState.mockReturnValue("stopped");
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("running");
    expect(h.client.sendMessage).not.toHaveBeenCalled();
    h.send(); expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
  });
  it("最终 JSON 语法错误在原任务追加一次修复，刷新和并发不重复派发", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.latestState.mockReturnValue("stopped");
    const original = {id: "original", type: "assistant_message", assistant_message: {content: '{"evaluations":[}'}};
    h.client.listAllMessages.mockResolvedValue([original]);
    let finish!: () => void;
    h.client.sendMessage.mockImplementationOnce(() => new Promise(done => {finish = () => done({taskId: "upstream-task"});}));
    const repairing = h.service.poll();
    await vi.waitFor(() => expect(h.client.sendMessage).toHaveBeenCalledTimes(1));
    expect(h.ledger().state.jobs![0].repair?.reason).toContain("JSON 语法");
    await h.service.poll(); finish(); await repairing; await h.service.poll();
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.client.createTask).toHaveBeenCalledTimes(1);
    expect(h.ledger().state.evaluations).toEqual([]);
    h.send();
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("succeeded");
  });
  it("未知修复请求只回读，不再次 POST，也不借用原轮结果", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.latestState.mockReturnValue("stopped");
    h.client.listAllMessages.mockResolvedValue([{id: "bad", type: "assistant_message", assistant_message: {content: "invalid JSON"}}]);
    h.client.sendMessage.mockRejectedValueOnce(Object.assign(new Error("transport"), {outcomeUnknown: true}));
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("running");
    await h.service.poll(); expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121_000);
    try {
      expect((await h.service.poll()).state.jobs?.[0].error).toContain("修复请求未能确认");
      expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
    } finally {clock.mockRestore();}
  });
  it("真实执行失败与用户取消不触发结果修复", async () => {
    for (const state of ["failed", "error", "cancelled"]) {
      const h = harness(); await h.intake(); await h.service.command(h.request); h.latestState.mockReturnValue(state);
      const result = await h.service.poll();
      expect(result.state.jobs?.[0].status).toBe("failed");
      expect(result.state.jobs?.[0].error).not.toBe("模型任务失败，请检查账户任务记录");
      expect(h.client.sendMessage).not.toHaveBeenCalled();
    }
  });
  it("历史 stopped 误判可恢复，但已存在更新任务时不追加修复", async () => {
    const h = harness(); await h.intake(); await h.service.command(h.request);
    h.ledger().state.jobs![0].status = "failed"; h.ledger().state.jobs![0].error = "模型任务失败，请检查账户任务记录";
    h.latestState.mockReturnValue("stopped");
    h.client.listAllMessages.mockResolvedValue([{id: "bad", type: "assistant_message", assistant_message: {content: "invalid JSON"}}]);
    expect((await h.service.poll()).state.jobs?.[0].status).toBe("running");
    expect(h.client.sendMessage).toHaveBeenCalledTimes(1);
  });
});

it("确认默认方案即写入现有知识库、保留正文快照，刷新可见且可撤销", async () => {
  const h=harness();await h.intake();
  await h.service.command({...h.request,kind:"plan"});
  const original=h.nodes[0].content;
  const output=h.output();
  output.plans[0].actions.unshift({kind:"node",title:"整理选材口径",nodeId:"node",after:"# 选材\n\n材料选择依据适用条件。\n\n## 选择步骤\n\n先确认适用条件，再对照现有材料选择。",source:"选材节点现有内容"} as any);
  h.send(output);
  const planned=await h.service.poll();
  const bodyAction=planned.state.plans[0].actions.find(action=>action.kind==="node")!;
  expect(bodyAction.selected).toBe(true);
  const details=vi.mocked(getKnowledgeNodeDetails);
  const save=vi.mocked(saveKnowledgeNodeContent);
  details.mockImplementation(async()=>({coordinates:{conversationId:"conversation",generation:1,revision:1,stateEpoch:1,contentVersion:1,resetRevision:0},node:{leafId:"node",contentMarkdown:h.nodes[0].content}}) as any);
  save.mockImplementation(async(_userId,input)=>{h.nodes[0].content=input.contentMarkdown;return {} as any;});
  try{
    const receiptId="00000000-0000-4000-8000-000000000099";
    const executed=await h.service.execute({expectedRevision:planned.revision,clientRequestId:receiptId,questionIds:["q"]});
    expect(save).toHaveBeenCalledWith(42,expect.objectContaining({conversationId:"conversation",leafId:"node",contentMarkdown:bodyAction.after}));
    expect(executed.state.receipts[0].changes.find(change=>change.action.kind==="node")).toMatchObject({status:"succeeded",action:{before:original,after:bodyAction.after}});
    expect((await h.service.observe()).nodes[0].content).toBe(bodyAction.after);
    expect(executed.state.todos).toHaveLength(1);
    const writes=save.mock.calls.length;
    await h.service.execute({expectedRevision:planned.revision,clientRequestId:receiptId,questionIds:["q"]});
    expect(save).toHaveBeenCalledTimes(writes);
    h.send();const completed=await h.service.poll();
    const reverted=await h.service.rollback({expectedRevision:completed.revision,receiptId});
    expect(reverted.nodes[0].content).toBe(original);
    expect(reverted.state.receipts[0].status).toBe("reverted");
    expect(reverted.state.receipts[0].changes[0].action.after).toBe(bodyAction.after);
  }finally{details.mockReset();save.mockReset();}
});

it("保存接口未实际更新正文时，不把拟写入内容标记为成功变更", async () => {
  const h=harness();await h.intake();await h.service.command({...h.request,kind:"plan"});
  const output=h.output();
  output.plans[0].actions=[{kind:"node",title:"整理选材口径",nodeId:"node",after:"# 选材\n\n材料选择依据适用条件。\n\n先核对适用条件，再选择材料。",source:"选材节点"} as any];
  h.send(output);const planned=await h.service.poll();
  const details=vi.mocked(getKnowledgeNodeDetails),save=vi.mocked(saveKnowledgeNodeContent);
  details.mockResolvedValue({coordinates:{conversationId:"conversation",generation:1,revision:1,stateEpoch:1,contentVersion:1,resetRevision:0},node:{leafId:"node",contentMarkdown:h.nodes[0].content}} as any);
  save.mockResolvedValue({accepted:true,unchanged:false});
  try{
    const result=await h.service.execute({expectedRevision:planned.revision,clientRequestId:"00000000-0000-4000-8000-000000000098",questionIds:["q"]});
    expect(result.state.receipts[0]).toMatchObject({status:"partial",changes:[{status:"failed",error:"尚未确认正文已写入知识库，请重新读取后核对"}]});
    expect(result.nodes[0].content).toBe("材料选择依据适用条件。");
  }finally{details.mockReset();save.mockReset();}
});
