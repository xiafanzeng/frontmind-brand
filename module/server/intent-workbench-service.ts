import {createHash, randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod";
import type {Request} from "express";
import type {ModuleHttpCore} from "./http-api.js";
import {getKnowledgeNodeDetails, saveKnowledgeNodeContent} from "./knowledge-node-workspace-service.js";
import {projectKnowledgeBaseCustomerMarkdown} from "../contracts/knowledge-base-materialized-contract.js";
import {
  createIntentPlan, emptyIntentState, evaluateIntent,
  type IntentState, type IntentNode, type IntentWorkspace,
} from "../contracts/intent-workbench.js";

export class IntentWorkbenchError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {super(message);}
}
const id = z.string().min(1).max(191);
const commandSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("intake"), expectedRevision: z.number().int().nonnegative(), questions: z.array(z.object({
    id, question: z.string().trim().min(2).max(500), category: z.string().max(80), subdivision: z.string().max(80),
    tableId: id, rowIndex: z.number().int().nonnegative(), sourceRevision: z.number().int().nonnegative().nullable(),
  }).strict()).min(1).max(160)}).strict(),
  z.object({kind: z.literal("evaluate"), expectedRevision: z.number().int().nonnegative(), questionIds: z.array(id).min(1).max(160)}).strict(),
  z.object({kind: z.literal("plan"), expectedRevision: z.number().int().nonnegative(), questionIds: z.array(id).min(1).max(160)}).strict(),
  z.object({kind: z.literal("edit"), expectedRevision: z.number().int().nonnegative(), questionId: id,
    actions: z.array(z.object({id, selected: z.boolean(), after: z.string().trim().min(1).max(300000)}).strict()).max(3)}).strict(),
  z.object({kind: z.literal("todo"), expectedRevision: z.number().int().nonnegative(), todoId: id,
    source: z.string().trim().min(1).max(2000)}).strict(),
]);
function rows(result: any): any[] {return Array.isArray(result?.[0]) ? result[0] : [];}
function digest(value: string) {return createHash("sha256").update(value).digest("hex");}

/** Durable workspace ledger. Schema is created by the included migration, never at request time. */
export function createIntentWorkbenchService(core: ModuleHttpCore, request: Request) {
  const context = core.context(request);
  const workspaceKey = digest(`${context.accountUserId}:${context.enterpriseProjectId ?? "personal"}`);
  const scope = sql`userId = ${context.accountUserId} AND enterpriseProjectId <=> ${context.enterpriseProjectId}`;
  const ledgerScope = sql`workspace_key = ${workspaceKey} AND owner_user_id = ${context.accountUserId} AND project_id <=> ${context.enterpriseProjectId}`;
  async function database() {return core.database();}
  async function readLedger(tx: any, lock = false): Promise<{revision: number; state: IntentState}> {
    const result = rows(await tx.execute(sql`SELECT revision, payload FROM brand_intent_workspaces WHERE ${ledgerScope} ${lock ? sql`FOR UPDATE` : sql``}`))[0];
    if (!result) return {revision: 0, state: emptyIntentState()};
    const payload = typeof result.payload === "string" ? JSON.parse(result.payload) : result.payload;
    if (payload?.version !== 1) throw new IntentWorkbenchError("STATE_INVALID", "优化清单格式不可读，请联系维护人员");
    return {revision: Number(result.revision), state: payload};
  }
  async function locked<T>(expectedRevision: number | undefined, work: (tx: any, ledger: {revision: number; state: IntentState}) => Promise<T>) {
    const db = await database();
    return db.transaction(async tx => {
      await tx.execute(sql`INSERT IGNORE INTO brand_intent_workspaces (workspace_key, owner_user_id, project_id, revision, payload) VALUES (${workspaceKey}, ${context.accountUserId}, ${context.enterpriseProjectId}, 0, ${JSON.stringify(emptyIntentState())})`);
      const ledger = await readLedger(tx, true);
      if (expectedRevision !== undefined && ledger.revision !== expectedRevision)
        throw new IntentWorkbenchError("REVISION_CONFLICT", "清单已被更新，请重新读取后操作");
      const result = await work(tx, ledger);
      await tx.execute(sql`UPDATE brand_intent_workspaces SET payload = ${JSON.stringify(ledger.state)}, revision = revision + 1 WHERE ${ledgerScope}`);
      return result;
    });
  }
  async function knowledge() {
    const db = await database();
    const build = rows(await db.execute(sql`SELECT id, conversationId, generation, content_version AS contentVersion, status, activeTurnId FROM knowledge_base_builds WHERE ${scope} AND execution_mode = 'materialized_bundle_v1' AND active_working_set_id IS NOT NULL ORDER BY updatedAt DESC LIMIT 1`))[0];
    if (!build) {
      const snapshot = rows(await db.execute(sql`SELECT documents FROM knowledge_base_snapshots WHERE ${scope} AND status = 'active' ORDER BY version DESC LIMIT 1`))[0];
      const documents = typeof snapshot?.documents === "string" ? JSON.parse(snapshot.documents) : snapshot?.documents ?? [];
      return {build: null, nodes: documents.filter((item: any) => item.customerVisible !== false).map((item: any) => ({
        id: item.id ?? item.path, title: item.title, branch: item.branchTitle ?? "正式知识",
        content: item.content, verified: ["verified_first_party", "verified_authoritative", "supported_third_party"].includes(item.evidenceStatus),
        editable: false,
      })) as IntentNode[]};
    }
    const nodeRows = rows(await db.execute(sql`SELECT leafId, title, branchTitle, status, contentMarkdown AS content, content_version AS contentVersion FROM knowledge_base_build_nodes WHERE buildId = ${build.id} ORDER BY ordinal`));
    return {build, nodes: nodeRows.filter(node => Number(node.contentVersion) === Number(build.contentVersion) && node.content).map(node => ({
      id: node.leafId, title: node.title, branch: node.branchTitle, content: node.content,
      verified: node.status === "confirmed", editable: !build.activeTurnId && ["confirming", "ready_to_publish", "published"].includes(build.status),
    })) as IntentNode[]};
  }
  async function observe(): Promise<IntentWorkspace> {
    const db = await database();
    const [ledger, data] = await Promise.all([readLedger(db), knowledge()]);
    return {...ledger, nodes: data.nodes, preview: false};
  }
  async function command(value: unknown) {
    const input = commandSchema.parse(value);
    const data = await knowledge();
    await locked(input.expectedRevision, async (_tx, ledger) => {
      if (ledger.state.receipts.some(receipt => receipt.status === "running" || (receipt.lease?.expiresAt ?? 0) > Date.now()))
        throw new IntentWorkbenchError("EXECUTION_ACTIVE", "请先继续完成当前执行");
      const state = ledger.state;
      if (input.kind === "intake") {
        for (const question of input.questions) {
          if (!state.questions.some(item => item.id === question.id || item.question === question.question)) state.questions.push(question);
        }
        if (state.questions.length > 500) throw new IntentWorkbenchError("LIST_LIMIT", "优化清单最多保留 500 条问题");
      } else if (input.kind === "evaluate" || input.kind === "plan") {
        for (const questionId of input.questionIds) {
          const question = state.questions.find(item => item.id === questionId);
          if (!question) throw new IntentWorkbenchError("QUESTION_MISSING", "所选问题已不存在");
          const evaluation = evaluateIntent(question, data.nodes, state.questions);
          state.evaluations = [...state.evaluations.filter(item => item.questionId !== questionId), evaluation];
          if (input.kind === "plan") state.plans = [...state.plans.filter(item => item.questionId !== questionId), createIntentPlan(question, evaluation, data.nodes)];
        }
      } else if (input.kind === "edit") {
        const plan = state.plans.find(item => item.questionId === input.questionId);
        if (!plan) throw new IntentWorkbenchError("PLAN_MISSING", "请先生成方案");
        for (const edit of input.actions) {
          const action = plan.actions.find(item => item.id === edit.id);
          if (!action) throw new IntentWorkbenchError("ACTION_MISSING", "方案动作不存在");
          if (action.kind === "question" && edit.after.length > 500) throw new IntentWorkbenchError("QUESTION_TOO_LONG", "问题最多 500 字");
          action.selected = edit.selected;
          if (action.kind === "node") {
            const node = data.nodes.find(item => item.id === action.nodeId);
            if (!node) throw new IntentWorkbenchError("NODE_MISSING", "知识节点已不存在");
            action.after = projectKnowledgeBaseCustomerMarkdown({leafTitle: node.title, markdown: edit.after});
          } else action.after = edit.after;
        }
      } else {
        const todo = state.todos.find(item => item.id === input.todoId);
        if (!todo) throw new IntentWorkbenchError("TODO_MISSING", "资料待办不存在");
        todo.status = "completed"; todo.source = input.source;
      }
    });
    return observe();
  }
  const executeSchema = z.object({expectedRevision: z.number().int().nonnegative(), clientRequestId: z.string().uuid(), questionIds: z.array(id).min(1).max(160)}).strict();
  async function execute(value: unknown) {
    const input = executeSchema.parse(value);
    const existing = (await observe()).state.receipts.find(receipt => receipt.id === input.clientRequestId);
    if (existing && [...new Set(existing.changes.map(change => change.questionId))].sort().join("|") !== [...new Set(input.questionIds)].sort().join("|"))
      throw new IntentWorkbenchError("IDEMPOTENCY_CONFLICT", "本次执行标识已用于其他问题");
    if (existing && existing.status !== "running") return observe();
    if (!existing) await locked(input.expectedRevision, async (_tx, ledger) => {
      if (ledger.state.receipts.some(receipt => receipt.status === "running")) throw new IntentWorkbenchError("EXECUTION_ACTIVE", "已有执行处理中，请继续原执行");
      const plans = input.questionIds.map(questionId => {
        const plan = ledger.state.plans.find(item => item.questionId === questionId);
        if (!plan) throw new IntentWorkbenchError("PLAN_MISSING", "请先生成并审核方案");
        return plan;
      });
      const changes = plans.flatMap(plan => plan.actions.filter(action => action.selected).map(action => ({questionId: plan.questionId, action: structuredClone(action), status: "pending" as const})));
      if (!changes.length) throw new IntentWorkbenchError("EMPTY_PLAN", "请至少选择一项动作");
      const nodeIds = changes.filter(change => change.action.kind === "node").map(change => change.action.nodeId);
      if (new Set(nodeIds).size !== nodeIds.length) throw new IntentWorkbenchError("NODE_CONFLICT", "多个方案修改同一知识节点，请分别执行并重新生成方案");
      ledger.state.receipts.push({id: input.clientRequestId, status: "running", createdAt: new Date().toISOString(), changes,
        before: ledger.state.evaluations.filter(item => input.questionIds.includes(item.questionId)), after: []});
    });
    const leaseOwner = randomUUID();
    await locked(undefined, async (_tx, ledger) => {
      const target = ledger.state.receipts.find(item => item.id === input.clientRequestId)!;
      if ((target.lease?.expiresAt ?? 0) > Date.now()) throw new IntentWorkbenchError("EXECUTION_ACTIVE", "当前执行仍在处理中，请稍后重新读取");
      target.lease = {owner: leaseOwner, expiresAt: Date.now() + 120000};
    });
    let receipt = (await observe()).state.receipts.find(item => item.id === input.clientRequestId)!;
    for (const change of receipt.changes.filter(item => item.status === "pending")) {
      await locked(undefined, async (_tx, ledger) => {
        const target = ledger.state.receipts.find(item => item.id === receipt.id)!;
        if (target.lease?.owner !== leaseOwner || target.lease.expiresAt < Date.now()) throw new IntentWorkbenchError("LEASE_CHANGED", "执行权已变化，请重新读取");
        target.lease.expiresAt = Date.now() + 120000;
      });
      let failure: string | undefined;
      try {
        if (change.action.kind === "node") {
          const current = await knowledge();
          const node = current.nodes.find(item => item.id === change.action.nodeId);
          if (!node || !current.build) throw new IntentWorkbenchError("NODE_MISSING", "知识节点已不存在");
          if (node.content !== change.action.after) {
            if (node.content !== change.action.before) throw new IntentWorkbenchError("NODE_CHANGED", "知识节点已有其他修改，请重新生成方案");
            const details = await getKnowledgeNodeDetails(context.accountUserId, {conversationId: current.build.conversationId,
              leafId: node.id, expectedGeneration: current.build.generation, expectedContentVersion: current.build.contentVersion});
            await saveKnowledgeNodeContent(context.accountUserId, {
              conversationId: details.coordinates.conversationId, leafId: node.id,
              clientRequestId: `intent:${digest(`${receipt.id}:${change.action.id}`)}`,
              expectedGeneration: details.coordinates.generation, expectedRevision: details.coordinates.revision,
              expectedStateEpoch: details.coordinates.stateEpoch, expectedContentVersion: details.coordinates.contentVersion,
              expectedResetRevision: details.coordinates.resetRevision, contentMarkdown: change.action.after,
            });
          }
        }
      } catch (error) {
        failure = error instanceof IntentWorkbenchError ? error.message : "节点保存未完成，原文已保留；请重新读取知识库";
      }
      await locked(undefined, async (_tx, ledger) => {
        const target = ledger.state.receipts.find(item => item.id === receipt.id)!.changes.find(item => item.action.id === change.action.id)!;
        if (ledger.state.receipts.find(item => item.id === receipt.id)!.lease?.owner !== leaseOwner) throw new IntentWorkbenchError("LEASE_CHANGED", "执行权已变化");
        if (target.status !== "pending") return;
        if (!failure && change.action.kind === "question") {
          const question = ledger.state.questions.find(item => item.id === change.questionId);
          if (!question || question.question !== change.action.before) failure = "问题已被修改，请重新评估";
          else question.question = change.action.after;
        }
        if (!failure && change.action.kind === "todo") {
          const todoId = `${receipt.id}:${change.action.id}`;
          if (!ledger.state.todos.some(todo => todo.id === todoId)) ledger.state.todos.push({
            id: todoId, questionId: change.questionId, title: change.action.after, status: "pending", source: "",
          });
        }
        target.status = failure ? "failed" : "succeeded"; target.error = failure;
      });
    }
    const current = await knowledge();
    await locked(undefined, async (_tx, ledger) => {
      receipt = ledger.state.receipts.find(item => item.id === input.clientRequestId)!;
      if (receipt.lease?.owner !== leaseOwner) throw new IntentWorkbenchError("LEASE_CHANGED", "执行权已变化");
      receipt.after = [...new Set(receipt.changes.map(item => item.questionId))].map(questionId =>
        evaluateIntent(ledger.state.questions.find(item => item.id === questionId)!, current.nodes, ledger.state.questions));
      ledger.state.evaluations = [...ledger.state.evaluations.filter(item => !receipt.after.some(after => after.questionId === item.questionId)), ...receipt.after];
      receipt.status = receipt.changes.some(change => change.status === "failed") ? "partial" : "completed";
      delete receipt.lease;
    });
    return observe();
  }
  async function rollback(value: unknown) {
    const input = z.object({receiptId: z.string().uuid(), expectedRevision: z.number().int().nonnegative()}).strict().parse(value);
    const workspace = await observe();
    if (workspace.revision !== input.expectedRevision) throw new IntentWorkbenchError("REVISION_CONFLICT", "清单已更新，请重新读取");
    const receipt = workspace.state.receipts.find(item => item.id === input.receiptId);
    if (!receipt || receipt.status === "running") throw new IntentWorkbenchError("RECEIPT_INVALID", "当前执行无法撤销");
    if (receipt.status === "reverted") return workspace;
    if (workspace.state.receipts.some(item => item.status === "running" || (item.lease?.expiresAt ?? 0) > Date.now())) throw new IntentWorkbenchError("EXECUTION_ACTIVE", "请先完成当前执行");
    // Verify every target before any restoration; never overwrite subsequent edits.
    const data = await knowledge();
    for (const change of receipt.changes.filter(item => item.status === "succeeded")) {
      const actual = change.action.kind === "node" ? data.nodes.find(node => node.id === change.action.nodeId)?.content :
        change.action.kind === "question" ? workspace.state.questions.find(question => question.id === change.questionId)?.question : change.action.after;
      if (actual !== change.action.after && !(change.action.kind === "node" && actual === change.action.before))
        throw new IntentWorkbenchError("ROLLBACK_CONFLICT", "内容已有后续修改，无法直接撤销；请保留并人工核对");
    }
    const leaseOwner = randomUUID();
    await locked(input.expectedRevision, async (_tx, ledger) => {
      const target = ledger.state.receipts.find(item => item.id === receipt.id)!;
      if (ledger.state.receipts.some(item => item.status === "running" || (item.lease?.expiresAt ?? 0) > Date.now()))
        throw new IntentWorkbenchError("EXECUTION_ACTIVE", "已有操作进行中，请稍后重试");
      target.lease = {owner: leaseOwner, expiresAt: Date.now() + 120000};
    });
    for (const change of [...receipt.changes].reverse().filter(item => item.status === "succeeded" && item.action.kind === "node")) {
      await locked(undefined, async (_tx, ledger) => {
        const target = ledger.state.receipts.find(item => item.id === receipt.id)!;
        if (target.lease?.owner !== leaseOwner || target.lease.expiresAt < Date.now()) throw new IntentWorkbenchError("LEASE_CHANGED", "撤销权已变化，请重新读取");
        target.lease.expiresAt = Date.now() + 120000;
      });
      const current = await knowledge();
      if (!current.build) throw new IntentWorkbenchError("NODE_MISSING", "当前知识库不可编辑");
      const details = await getKnowledgeNodeDetails(context.accountUserId, {conversationId: current.build.conversationId,
        leafId: change.action.nodeId, expectedGeneration: current.build.generation, expectedContentVersion: current.build.contentVersion});
      if (details.node.contentMarkdown !== change.action.after && details.node.contentMarkdown !== change.action.before) throw new IntentWorkbenchError("ROLLBACK_CONFLICT", "节点已有后续修改");
      if (details.node.contentMarkdown !== change.action.before) await saveKnowledgeNodeContent(context.accountUserId, {conversationId: details.coordinates.conversationId, leafId: details.node.leafId,
        clientRequestId: `intent-undo:${digest(`${receipt.id}:${change.action.id}`)}`, expectedGeneration: details.coordinates.generation,
        expectedRevision: details.coordinates.revision, expectedStateEpoch: details.coordinates.stateEpoch,
        expectedContentVersion: details.coordinates.contentVersion, expectedResetRevision: details.coordinates.resetRevision, contentMarkdown: change.action.before});
      await locked(undefined, async (_tx, ledger) => {
        if (ledger.state.receipts.find(item => item.id === receipt.id)!.lease?.owner !== leaseOwner) throw new IntentWorkbenchError("LEASE_CHANGED", "撤销权已变化");
        ledger.state.receipts.find(item => item.id === receipt.id)!.changes.find(item => item.action.id === change.action.id)!.status = "reverted";
      });
    }
    await locked(undefined, async (_tx, ledger) => {
      const target = ledger.state.receipts.find(item => item.id === receipt.id)!;
      if (target.lease?.owner !== leaseOwner) throw new IntentWorkbenchError("LEASE_CHANGED", "撤销权已变化");
      for (const change of target.changes.filter(item => item.status === "succeeded")) {
        if (change.action.kind === "question") {
          const question = ledger.state.questions.find(item => item.id === change.questionId)!;
          if (question.question !== change.action.after) throw new IntentWorkbenchError("ROLLBACK_CONFLICT", "问题已有后续修改");
          question.question = change.action.before;
        } else if (change.action.kind === "todo") ledger.state.todos = ledger.state.todos.filter(todo => todo.id !== `${target.id}:${change.action.id}`);
        change.status = "reverted";
      }
      target.status = "reverted";
      delete target.lease;
      const refreshed = await knowledge();
      for (const questionId of new Set(target.changes.map(change => change.questionId))) {
        const question = ledger.state.questions.find(item => item.id === questionId);
        if (question) ledger.state.evaluations = [...ledger.state.evaluations.filter(item => item.questionId !== questionId), evaluateIntent(question, refreshed.nodes, ledger.state.questions)];
      }
    });
    return observe();
  }
  return {observe, command, execute, rollback};
}
