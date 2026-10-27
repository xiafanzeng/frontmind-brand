import {createHash, randomUUID} from "node:crypto";
import {sql, eq} from "drizzle-orm";
import {z} from "zod";
import type {Request} from "express";
import type {ModuleHttpCore} from "./http-api.js";
import {getKnowledgeNodeDetails, saveKnowledgeNodeContent} from "./knowledge-node-workspace-service.js";
import {projectKnowledgeBaseCustomerMarkdown} from "../contracts/knowledge-base-materialized-contract.js";
import {
  emptyIntentState,
  type IntentState, type IntentNode, type IntentWorkspace, type IntentSkillJob,
} from "../contracts/intent-workbench.js";
import {intentHash, prepareIntentSkill, reserveIntentSkill, intentSkillClient, uploadIntentSkill,
  validateIntentSkillResult, INTENT_WIRE_SCHEMA, intentSkillPorts, IntentSkillRuntimeError, type IntentSkillInput} from "./intent-skill-runtime.js";

export class IntentWorkbenchError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {super(message);}
}
const id = z.string().min(1).max(191);
const commandSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("intake"), expectedRevision: z.number().int().nonnegative(), questions: z.array(z.object({
    id, question: z.string().trim().min(2).max(500), category: z.string().max(80), subdivision: z.string().max(80),
    tableId: id, rowIndex: z.number().int().nonnegative(), sourceRevision: z.number().int().nonnegative().nullable(),
  }).strict()).min(1).max(160)}).strict(),
  z.object({kind: z.literal("evaluate"), clientRequestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), questionIds: z.array(id).min(1).max(160)}).strict(),
  z.object({kind: z.literal("plan"), clientRequestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), questionIds: z.array(id).min(1).max(160)}).strict(),
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
      const actor = (request as Request & {frontmindUser?: {id: number; role: string}}).frontmindUser;
      if (!actor || actor.id !== context.actorUserId) throw new IntentWorkbenchError("ACTOR_INVALID", "当前账号无权修改此工作区", 403);
      const model = intentSkillPorts();
      model.assertActorAllowed(actor);
      await model.lockCustomerProjectBusinessWrite(tx, context.accountUserId, actor);
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
  const activeJob = (job: IntentSkillJob) => !["succeeded", "failed"].includes(job.status);
  const timeoutMessage = "模型任务超时，请查看账户任务记录后重新评估";
  const recoverableTimeout = (job: IntentSkillJob) => job.status === "failed" && job.error === timeoutMessage;
  // Migrate the previous stopped-as-failed diagnosis by observing the original task.
  const legacyFailure = (job: IntentSkillJob) => job.status === "failed" &&
    job.error === "模型任务失败，请检查账户任务记录" && !job.repair;
  const recoverableJob = (job: IntentSkillJob) => recoverableTimeout(job) || legacyFailure(job);
  async function startSkill(kind: "evaluate" | "plan", questionIds: string[], expectedRevision: number,
    clientRequestId: string, receiptId?: string) {
    const previous = (await observe()).state.jobs?.find(job => job.id === clientRequestId);
    if (previous) {
      if (previous.kind !== kind || intentHash([...previous.questionIds].sort()) !== intentHash([...new Set(questionIds)].sort()))
        throw new IntentWorkbenchError("IDEMPOTENCY_CONFLICT", "任务标识已用于其他问题");
      await advance(previous);
      return observe();
    }
    let prepared: Awaited<ReturnType<typeof prepareIntentSkill>>;
    try {prepared = await prepareIntentSkill(context.accountUserId);}
    catch (error) {throw new IntentWorkbenchError("MODEL_UNAVAILABLE", error instanceof IntentSkillRuntimeError ? error.message : "当前模型服务不可用，请检查服务权限与 API 配置", 503);}
    const data = await knowledge();
    if (!data.nodes.length) throw new IntentWorkbenchError("KNOWLEDGE_MISSING", "请先生成品牌知识库");
    if (Buffer.byteLength(JSON.stringify(data.nodes), "utf8") > 6 * 1024 * 1024)
      throw new IntentWorkbenchError("KNOWLEDGE_LIMIT", "当前知识库过大，请缩小知识范围后评估");
    let reserved!: IntentSkillJob;
    await locked(expectedRevision, async (tx, ledger) => {
      if (ledger.state.jobs?.some(activeJob) || ledger.state.receipts.some(r => r.status === "running" || (r.lease?.expiresAt ?? 0) > Date.now()))
        throw new IntentWorkbenchError("OPERATION_ACTIVE", "请先等待当前优化任务完成");
      const selectedQuestions = [...new Set(questionIds)].map(id => {
        const question = ledger.state.questions.find(q => q.id === id);
        if (!question) throw new IntentWorkbenchError("QUESTION_MISSING", "所选问题已不存在");
        return question;
      });
      const frozen = {kind, selectedQuestions, candidates: ledger.state.questions, nodes: data.nodes, skill: prepared.skill};
      const inputHash = intentHash(frozen);
      reserved = {id: clientRequestId, taskId: randomUUID(), kind, questionIds: selectedQuestions.map(q => q.id),
        status: "queued", createdAt: new Date().toISOString(), inputHash, knowledgeHash: intentHash(data.nodes),
        questionsHash: intentHash(ledger.state.questions), credentialId: prepared.credential.id,
        credentialVersion: prepared.credential.version, skillHash: prepared.skillHash, model: prepared.credential.upstreamModel, receiptId};
      const input: IntentSkillInput = {...frozen, inputHash, operationToken: `brand-intent:${clientRequestId}`};
      await reserveIntentSkill(tx, reserved, input, prepared.credential, context.accountUserId, context.enterpriseProjectId);
      ledger.state.jobs ??= [];
      ledger.state.jobs.push(reserved);
      ledger.state.evaluations = ledger.state.evaluations.filter(item => !reserved.questionIds.includes(item.questionId));
      ledger.state.plans = ledger.state.plans.filter(item => !reserved.questionIds.includes(item.questionId));
      // Keep task history bounded; never remove an active task.
      ledger.state.jobs = ledger.state.jobs.slice(-100);
    });
    await advance(reserved);
    return observe();
  }
  async function advance(original: IntentSkillJob) {
    if ((!activeJob(original) && !recoverableJob(original)) || (original.lease?.expiresAt ?? 0) > Date.now()) return;
    const owner = randomUUID();
    let job: IntentSkillJob | undefined;
    await locked(undefined, async (_tx, ledger) => {
      const current = ledger.state.jobs?.find(j => j.id === original.id);
      if (!current || (!activeJob(current) && !recoverableJob(current)) || (current.lease?.expiresAt ?? 0) > Date.now()) return;
      // A late result must never replace a newer evaluation of the same question.
      if (recoverableJob(current) && ledger.state.jobs!.slice(ledger.state.jobs!.indexOf(current) + 1)
        .some(later => later.questionIds.some(id => current.questionIds.includes(id)))) return;
      current.lease = {owner, expiresAt: Date.now() + 120000}; job = structuredClone(current);
    });
    if (!job) return;
    let phase = job.status;
    let terminalError: string | undefined;
    let repairDispatch = false;
    let progress = job.progress;
    try {
      const db = await database();
      const {core: model, client, repairClient, task, input} = await intentSkillClient(job, context.accountUserId, db);
      const update = async (status: IntentSkillJob["status"], providerTaskId?: string, providerRequestId?: string | null) => {
        await locked(undefined, async (tx, ledger) => {
          const current = ledger.state.jobs!.find(j => j.id === job!.id)!;
          if (current.lease?.owner !== owner || current.lease.expiresAt < Date.now()) throw new IntentSkillRuntimeError("任务执行权已变化");
          current.status = status;
          current.lease.expiresAt = Date.now() + 120000;
          if (status === "create_unknown") current.createClaimedAt = Date.now();
          await tx.update(model.agentOperations).set({status: status === "failed" ? "attention_required" : "running", updatedAt: new Date()}).where(eq(model.agentOperations.id, job!.id));
          await tx.update(model.agentTasks).set({providerState: status, ...(providerTaskId ? {providerTaskId} : {}),
            ...(providerRequestId ? {providerRequestId} : {}), updatedAt: new Date()}).where(eq(model.agentTasks.id, job!.taskId));
        });
        phase = status;
      };
      const timedOut = Date.now() - (job.repair?.claimedAt ?? Date.parse(job.createdAt)) > 30 * 60_000;
      if (phase === "queued" || phase === "uploading") {
        if (timedOut) throw new IntentSkillRuntimeError(timeoutMessage);
        await update("uploading");
        const attachments = await uploadIntentSkill(client, model, job, input, context.accountUserId);
        // Claim before POST. A crash/ambiguous response is reconciled by reads only.
        await update("create_unknown");
        const created = await client.createTask({
          title: task.title, prompt: `解压附件并完整读取 SKILL.md，按其流程处理 input.json。只返回结构化结果。\nFRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({operationToken: input.operationToken})}`,
          attachments, agentProfile: job.model, locale: "zh-CN", interactiveMode: false,
          structuredOutputSchema: INTENT_WIRE_SCHEMA,
        });
        await update("running", created.taskId, created.requestId);
        await model.recordUpstreamResource({userId: context.accountUserId, apiCredentialId: job.credentialId, kind: "task", upstreamId: created.taskId});
        return;
      }
      let providerTaskId = task.providerTaskId;
      if (phase === "create_unknown" && !providerTaskId) {
        const found = await client.findCreatedTask({title: task.title, operationToken: input.operationToken,
          createdAfterSeconds: Math.floor(Date.parse(job.createdAt) / 1000) - 60, createdBeforeSeconds: Math.floor(Date.now() / 1000) + 60});
        if (found.matches.length > 1) throw new IntentSkillRuntimeError("发现多个同标识模型任务，请人工核对账户任务记录");
        if (!found.unique) {
          if (Date.now() - (job.createClaimedAt ?? Date.parse(job.createdAt)) > 2 * 60_000) throw new IntentSkillRuntimeError("模型任务创建结果无法确认，请核对账户任务记录；系统不会重复创建");
          return;
        }
        providerTaskId = found.unique.id;
        await update("running", providerTaskId);
        await model.recordUpstreamResource({userId: context.accountUserId, apiCredentialId: job.credentialId, kind: "task", upstreamId: providerTaskId});
      }
      if (!providerTaskId) {
        if (timedOut && phase !== "failed") throw new IntentSkillRuntimeError(timeoutMessage);
        return;
      }
      const allEvents: Array<{id: string; type: string; timestamp: number; [key: string]: any}> = await client.listAllMessages({taskId: providerTaskId, order: "asc"});
      // Only fixed public labels cross the workspace boundary, never provider
      // content, tool arguments, reasoning or unvalidated scores.
      const publicLabels: Record<string, string> = {
        task_created: "模型任务已创建", task_state: "模型任务状态已更新",
        status_update: "模型任务状态已更新",
        assistant_message: "模型返回了一条任务消息",
        tool_call: "模型正在调用工具处理资料", tool_result: "工具处理已返回",
        tool_use: "模型正在调用工具处理资料",
        structured_output_result: "已收到评估结果，正在校验",
      };
      const previousEvents = progress?.events ?? [];
      const publicEvents = allEvents.filter(event => Object.hasOwn(publicLabels, event.type)).map(event => ({
        id: digest(event.id), label: publicLabels[event.type]!,
        at: Number.isFinite(event.timestamp) && event.timestamp > 0 && event.timestamp < 8.64e15 ?
          new Date(event.timestamp).toISOString() : previousEvents.find(item => item.id === digest(event.id))?.at ?? job!.createdAt,
      }));
      const mergedEvents = new Map([...previousEvents, ...publicEvents].map(event => [event.id, event]));
      progress = {stage: job.repair ? "repairing" : allEvents.some(event => event.type === "structured_output_result") ? "validating" : allEvents.length ? "analyzing" : "submitted",
        updatedAt: new Date().toISOString(), events: [...mergedEvents.values()].slice(-24)};
      // A repair turn may never borrow the original turn's result or terminal event.
      const baseline = new Set(job.repair?.baselineEventIds ?? []);
      const events = allEvents.filter(event => !baseline.has(event.id));
      const resultEvent = model.orderManusV2EventsByProviderRank(events, "newest_first").find(event => event.type === "structured_output_result");
      let invalidResult: string | undefined;
      let classified: ReturnType<typeof model.classifyManusV2StructuredResultEnvelope> | undefined;
      let result: ReturnType<typeof validateIntentSkillResult> | undefined;
      if (resultEvent) {
        try {
          classified = model.classifyManusV2StructuredResultEnvelope(resultEvent.structured_output_result);
          if (classified.kind !== "accepted") throw new IntentSkillRuntimeError("模型未返回有效结构化结果");
          result = validateIntentSkillResult(classified.value, input, job);
        } catch (error) {
          if (!(error instanceof IntentSkillRuntimeError) && !(error instanceof z.ZodError)) throw error;
          invalidResult = error instanceof z.ZodError ? "模型输出字段不符合评分结构" : error.message;
        }
      }
      if (resultEvent && result && classified?.kind === "accepted") {
        const accepted = classified;
        const currentKnowledge = await knowledge();
        await locked(undefined, async (tx, ledger) => {
          const current = ledger.state.jobs!.find(j => j.id === job!.id)!;
          if (current.lease?.owner !== owner || current.lease.expiresAt < Date.now()) throw new IntentSkillRuntimeError("任务执行权已变化");
          if (phase === "failed" && ledger.state.jobs!.slice(ledger.state.jobs!.indexOf(current) + 1)
            .some(later => later.questionIds.some(id => current.questionIds.includes(id))))
            throw new IntentSkillRuntimeError("已有更新的评估任务，旧任务结果不再发布");
          if (intentHash(currentKnowledge.nodes) !== job!.knowledgeHash || intentHash(ledger.state.questions) !== job!.questionsHash)
            throw new IntentSkillRuntimeError("任务期间知识或问题已更新，请重新评估");
          ledger.state.evaluations = [...ledger.state.evaluations.filter(e => !job!.questionIds.includes(e.questionId)), ...result.evaluations];
          if (job!.kind === "plan") ledger.state.plans = [...ledger.state.plans.filter(p => !job!.questionIds.includes(p.questionId)), ...result.plans];
          if (job!.receiptId) {
            const receipt = ledger.state.receipts.find(r => r.id === job!.receiptId);
            if (receipt && receipt.status !== "reverted") receipt.after = result.evaluations;
          }
          current.status = "succeeded"; delete current.error;
          await tx.insert(model.agentEvents).values({id: randomUUID(), taskId: job!.taskId, providerEventId: resultEvent.id,
            eventType: "structured_output_result", providerTimestampMs: resultEvent.timestamp,
            normalizedPayload: {kind: "intent_skill_result", value: accepted.value}});
          await tx.update(model.agentOperations).set({status: "succeeded", errorCode: null, updatedAt: new Date()}).where(eq(model.agentOperations.id, job!.id));
          await tx.update(model.agentTasks).set({providerState: "succeeded", lastMessageSyncAt: new Date(), updatedAt: new Date()}).where(eq(model.agentTasks.id, job!.taskId));
        });
        return;
      }
      // Old timeout failures may only retrieve an existing result, never dispatch.
      if (phase === "failed" && !legacyFailure(job)) return;
      const state = model.latestManusV2TaskState(events) ?? (await client.taskDetail(providerTaskId)).status;
      if (["error", "failed", "cancelled"].includes(state))
        throw new IntentSkillRuntimeError(state === "cancelled" ? "模型任务已取消，未写入评分" : "模型执行异常，未写入评分；请查看该任务的执行错误后重试");
      if (["finished", "completed", "stopped"].includes(state)) {
        const final = model.orderManusV2EventsByProviderRank(events, "newest_first")
          .find(event => event.type === "assistant_message" && typeof (event.assistant_message as any)?.content === "string" && (event.assistant_message as any).content.trim());
        if (final && !invalidResult) {
          let raw = String((final.assistant_message as any)?.content).trim();
          const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(raw);
          if (fence) raw = fence[1]!.trim();
          try {
            validateIntentSkillResult(JSON.parse(raw), input, job);
          } catch (error) {
            invalidResult = error instanceof SyntaxError ? "模型最终 JSON 语法错误" :
              error instanceof z.ZodError ? "模型输出字段不符合评分结构" :
              error instanceof IntentSkillRuntimeError ? error.message : "模型最终结果不可验证";
          }
        }
        if (invalidResult) {
          if (job.repair) throw new IntentSkillRuntimeError(`模型结果自动修复后仍未通过校验：${invalidResult}；未写入评分，请重新评估`);
          const currentKnowledge = await knowledge();
          const intentId = randomUUID();
          // Persist a single mutation claim BEFORE sending. Ambiguous responses
          // are reconciled by reads; no later poll can repeat this POST.
          await locked(undefined, async (tx, ledger) => {
            const current = ledger.state.jobs!.find(j => j.id === job!.id)!;
            if (current.lease?.owner !== owner || current.lease.expiresAt < Date.now() || current.repair)
              throw new IntentSkillRuntimeError("任务执行权已变化");
            if (ledger.state.jobs!.slice(ledger.state.jobs!.indexOf(current) + 1)
              .some(later => later.questionIds.some(id => current.questionIds.includes(id))))
              throw new IntentSkillRuntimeError("已有更新的评估任务，旧任务结果不再发布");
            if (intentHash(currentKnowledge.nodes) !== job!.knowledgeHash || intentHash(ledger.state.questions) !== job!.questionsHash)
              throw new IntentSkillRuntimeError("任务期间知识或问题已更新，请重新评估");
            current.repair = {intentId, claimedAt: Date.now(), baselineEventIds: allEvents.map(event => event.id), reason: invalidResult!};
            current.status = "running"; delete current.error; delete current.terminalObservedAt;
            await tx.update(model.agentOperations).set({status: "result_pending", errorCode: null, updatedAt: new Date()}).where(eq(model.agentOperations.id, job!.id));
          });
          phase = "running";
          repairDispatch = true;
          await repairClient(intentId).sendMessage({
            taskId: providerTaskId, structuredOutputSchema: INTENT_WIRE_SCHEMA,
            prompt: `上一轮结果未通过校验：${invalidResult}。请重新完整读取原附件 SKILL.md 和 input.json，修正并返回完整 JSON。原知识与问题仍是唯一来源，禁止执行方案、联网补造证据或改变任务标识。根字段只能是 operationToken,inputHash,evaluations,plans；检查所有括号、逗号、字段及连续原文引用，再按最终要点重算 support、第六维和 value。仅返回 JSON，不要解释。\noperationToken=${input.operationToken}\ninputHash=${input.inputHash}\n本轮修复标识=${intentId}`,
          });
          await locked(undefined, async (_tx, ledger) => {
            const current = ledger.state.jobs!.find(j => j.id === job!.id)!;
            if (current.lease?.owner === owner && current.repair?.intentId === intentId) current.repair.sentAt = Date.now();
          });
          return;
        }
        if (job.repair && !events.length) {
          if (!job.repair.sentAt && Date.now() - job.repair.claimedAt > 2 * 60_000)
            throw new IntentSkillRuntimeError("模型结果修复请求未能确认，系统未重复提交；请重新评估");
          if (timedOut) throw new IntentSkillRuntimeError(timeoutMessage);
          return;
        }
        if (!job.terminalObservedAt) {
          await locked(undefined, async (tx, ledger) => {
            const current = ledger.state.jobs!.find(j => j.id === job!.id)!;
            if (current.lease?.owner !== owner) return;
            current.terminalObservedAt = Date.now();
            await tx.update(model.agentOperations).set({status: "result_pending", updatedAt: new Date()}).where(eq(model.agentOperations.id, job!.id));
          });
          return;
        }
        if (Date.now() - job.terminalObservedAt < 2 * 60_000) return;
        throw new IntentSkillRuntimeError("模型任务已结束，但没有可验证的评估结果");
      }
      if (timedOut) throw new IntentSkillRuntimeError(timeoutMessage);
    } catch (error) {
      // Upstream transport errors are retriable reads; creation is never retried.
      const upstream = error as {outcomeUnknown?: boolean; retryable?: boolean; status?: number};
      const creationRejected = phase === "create_unknown" && upstream.outcomeUnknown === false &&
        upstream.retryable === false && upstream.status !== undefined &&
        upstream.status >= 400 && upstream.status < 500;
      const repairRejected = repairDispatch && upstream.outcomeUnknown === false &&
        upstream.retryable === false && upstream.status !== undefined && upstream.status >= 400 && upstream.status < 500;
      if (((phase === "running" || phase === "failed") && !repairRejected && !(error instanceof IntentSkillRuntimeError) && !(error instanceof z.ZodError)) ||
        (phase === "create_unknown" && !creationRejected && !(error instanceof IntentSkillRuntimeError) && !(error instanceof z.ZodError)) ||
        (phase === "uploading" && upstream.retryable)) return;
      terminalError = error instanceof z.ZodError ? "模型输出字段格式不正确，请重新生成" :
        error instanceof IntentSkillRuntimeError ? error.message :
        repairRejected ? "模型服务拒绝结果修复请求，未写入评分；请检查账户 API 后重新评估" :
        creationRejected ? "模型服务拒绝创建任务，请检查账户 API 配置和任务记录" :
        "模型服务调用未完成，请检查账户任务记录";
    } finally {
      await locked(undefined, async (tx, ledger) => {
        const current = ledger.state.jobs?.find(j => j.id === job!.id);
        if (current?.lease?.owner !== owner) return;
        delete current.lease;
        current.progress = {
          stage: terminalError ? "failed" : current.status === "succeeded" ? "completed" :
            current.repair ? "repairing" : current.status === "running" ? progress?.stage ?? "submitted" :
            current.status === "create_unknown" ? "submitted" : "preparing",
          updatedAt: new Date().toISOString(), events: progress?.events ?? [],
        };
        if (terminalError) {
          current.status = "failed"; current.error = terminalError;
          const model = intentSkillPorts();
          await tx.update(model.agentOperations).set({
            status: phase === "create_unknown" ? "attention_required" : "failed", errorCode: "INTENT_RESULT_UNAVAILABLE", updatedAt: new Date(),
          }).where(eq(model.agentOperations.id, job!.id));
        }
      });
    }
  }
  async function poll() {
    const workspace = await observe();
    const job = workspace.state.jobs?.find(activeJob) ??
      workspace.state.jobs?.find((candidate, index, jobs) => recoverableJob(candidate) &&
        !jobs.slice(index + 1).some(later => later.questionIds.some(id => candidate.questionIds.includes(id))));
    if (job) await advance(job);
    return observe();
  }
  async function command(value: unknown) {
    const input = commandSchema.parse(value);
    if (input.kind === "evaluate" || input.kind === "plan")
      return startSkill(input.kind, input.questionIds, input.expectedRevision, input.clientRequestId);
    const data = await knowledge();
    await locked(input.expectedRevision, async (_tx, ledger) => {
      if (ledger.state.receipts.some(receipt => receipt.status === "running" || (receipt.lease?.expiresAt ?? 0) > Date.now()))
        throw new IntentWorkbenchError("EXECUTION_ACTIVE", "请先继续完成当前执行");
      if (ledger.state.jobs?.some(activeJob)) throw new IntentWorkbenchError("OPERATION_ACTIVE", "请等待当前优化评估完成");
      const state = ledger.state;
      if (input.kind === "intake") {
        for (const question of input.questions) {
          if (!state.questions.some(item => item.id === question.id || item.question === question.question)) state.questions.push(question);
        }
        if (state.questions.length > 500) throw new IntentWorkbenchError("LIST_LIMIT", "优化清单最多保留 500 条问题");
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
    const executionKnowledge = await knowledge();
    if (!existing) await locked(input.expectedRevision, async (_tx, ledger) => {
      if (ledger.state.jobs?.some(activeJob)) throw new IntentWorkbenchError("OPERATION_ACTIVE", "请等待当前评估完成");
      if (ledger.state.receipts.some(receipt => receipt.status === "running")) throw new IntentWorkbenchError("EXECUTION_ACTIVE", "已有执行处理中，请继续原执行");
      const plans = input.questionIds.map(questionId => {
        const plan = ledger.state.plans.find(item => item.questionId === questionId);
        if (!plan) throw new IntentWorkbenchError("PLAN_MISSING", "请先生成并审核方案");
        const source = ledger.state.jobs?.find(job => job.kind === "plan" && job.inputHash === plan.inputHash && job.status === "succeeded");
        if (!source || source.knowledgeHash !== intentHash(executionKnowledge.nodes) || source.questionsHash !== intentHash(ledger.state.questions))
          throw new IntentWorkbenchError("PLAN_STALE", "方案依据的知识或问题已变化，请重新生成方案");
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
    await locked(undefined, async (_tx, ledger) => {
      receipt = ledger.state.receipts.find(item => item.id === input.clientRequestId)!;
      if (receipt.lease?.owner !== leaseOwner) throw new IntentWorkbenchError("LEASE_CHANGED", "执行权已变化");
      const changedIds = receipt.changes.map(item => item.questionId);
      ledger.state.evaluations = ledger.state.evaluations.filter(item => !changedIds.includes(item.questionId));
      ledger.state.plans = ledger.state.plans.filter(item => !changedIds.includes(item.questionId));
      receipt.status = receipt.changes.some(change => change.status === "failed") ? "partial" : "completed";
      delete receipt.lease;
    });
    return reEvaluateReceipt(receipt.id, [...new Set(receipt.changes.map(item => item.questionId))]);
  }
  async function rollback(value: unknown) {
    const input = z.object({receiptId: z.string().uuid(), expectedRevision: z.number().int().nonnegative()}).strict().parse(value);
    const workspace = await observe();
    if (workspace.state.jobs?.some(activeJob)) throw new IntentWorkbenchError("OPERATION_ACTIVE", "请等待当前评估完成后撤销");
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
      const changedIds = target.changes.map(change => change.questionId);
      ledger.state.evaluations = ledger.state.evaluations.filter(item => !changedIds.includes(item.questionId));
      ledger.state.plans = ledger.state.plans.filter(item => !changedIds.includes(item.questionId));
    });
    return reEvaluateReceipt(receipt.id, [...new Set(receipt.changes.map(item => item.questionId))]);
  }
  async function reEvaluateReceipt(receiptId: string, questionIds: string[]) {
    try {
      return await startSkill("evaluate", questionIds, (await observe()).revision, randomUUID(), receiptId);
    } catch {
      await locked(undefined, async (_tx, ledger) => {
        const target = ledger.state.receipts.find(r => r.id === receiptId)!;
        target.reEvaluationError = "变更已保存，但模型重评未启动，请返回问题列表重新评估";
      });
      return observe();
    }
  }
  return {observe, poll, command, execute, rollback};
}
