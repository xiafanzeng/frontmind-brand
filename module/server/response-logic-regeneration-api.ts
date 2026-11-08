import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ResponseLogicRecordDto, ResponseLogicStructuredDraft } from "../contracts/response-logic.js";
import type { CoreRequest, ManusV2MessageEvent, ResponseLogicApiPorts } from "./response-logic-core-ports.js";
import { createJudgeContextResolver, judgeError } from "./response-logic-judge-api.js";
import { responseLogicPublicExecution } from "./response-logic-public-execution.js";

const contextSchema = z.object({questionId: z.string().trim().min(1).max(191), expectedRevision: z.coerce.number().int().positive()});
const pointerSchema = z.object({taskId: z.string().min(1).max(255), attempt: z.number().int().min(0).max(99)}).strict();
const startSchema = contextSchema.extend({retry: pointerSchema.optional()}).strict();
const statusSchema = contextSchema.extend({attempt: z.coerce.number().int().min(0).max(100)}).strict();

export type RegenerationDispatch = {record: ResponseLogicRecordDto; key: string; attempt: number};
type Result = {resultId: string; source: "structured_output" | "assistant_markdown"; structuredDraft: ResponseLogicStructuredDraft};

/** Candidate tasks use the existing task ledger; they never occupy lastTaskId
 * or mutate the saved draft. Adoption uses the existing versioned draft save. */
export function createResponseLogicRegenerationRouter(core: ResponseLogicApiPorts, hooks: {
  dispatch(request: Request, res: Response, input: RegenerationDispatch): Promise<void>;
  readResult(events: ReadonlyArray<ManusV2MessageEvent>): Result | null;
}): import("express").Router {
  const router = Router();
  const resolveContext = createJudgeContextResolver(core, {adoptCurrentQuestion: true});
  const error = (res: Response, status: number, code: string, message: string) => judgeError(res, status, code, message);
  const failure = (res: Response, cause: unknown) => {
    if (core.sendAiBillingError(res, cause)) return;
    if (cause instanceof core.ServiceEntitlementError) {
      error(res, cause.statusCode, cause.code, cause.message); return;
    }
    error(res, 503, "REGENERATION_STATUS_UNAVAILABLE", "暂时无法确认任务状态，请恢复查询；当前草稿未被替换。");
  };
  async function context(request: Request, res: Response, input: z.infer<typeof contextSchema>) {
    const ctx = await resolveContext(request as unknown as CoreRequest, res, input.questionId, input.expectedRevision);
    if (!ctx) return null;
    const credential = core.credentialForRequest(request);
    if (!credential) {error(res, 428, "CUSTOMER_KEY_REQUIRED", "当前客户账号尚未配置 API Key"); return null;}
    if (!ctx.record.conversationId) {error(res, 409, "REGENERATION_CONTEXT_MISSING", "请先保存当前草稿再重新生成"); return null;}
    const scope = core.getEnterpriseProjectScope();
    const keyFor = (attempt: number) => createHash("sha256").update(JSON.stringify([
      "response-logic-regeneration-v1", ctx.workspaceUserId, scope?.enterpriseProjectId,
      ctx.record.id, ctx.record.questionId, ctx.record.revision, ctx.record.conversationId,
      ctx.record.question, ctx.record.intent, ctx.fingerprint, attempt,
    ])).digest("hex");
    const clientFor = (attempt: number, boundCredential = credential) => core.createCredentialAgentClient(boundCredential, {
      baseUrl: core.getUpstreamBaseUrl(request), accountUserId: ctx.workspaceUserId,
      intentId: keyFor(attempt), rateLimitScope: `managed-user:${ctx.workspaceUserId}`,
    });
    const find = async (attempt: number, boundCredential = credential) => {
      const client = clientFor(attempt, boundCredential);
      if (!client.findCreatedTaskReadOnly) throw new Error("READ_ONLY_LOOKUP_UNAVAILABLE");
      const key = keyFor(attempt);
      return (await client.findCreatedTaskReadOnly({title: `FrontMind response logic ${key.slice(0, 24)}`, operationToken: key})).unique;
    };
    const owned = async (taskId: string, attempt: number) => {
      const owner = await core.getCredentialForUpstreamResource(ctx.workspaceUserId, "task", taskId);
      if (!owner || (await find(attempt, owner))?.id !== taskId) {
        error(res, 403, "REGENERATION_TASK_FORBIDDEN", "任务与当前账号、问题或草稿版本不匹配"); return null;
      }
      return clientFor(attempt, owner);
    };
    return {...ctx, credential, keyFor, clientFor, find, owned};
  }
  router.get("/recovery", async (request, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const parsed = contextSchema.strict().safeParse(request.query);
      if (!parsed.success) {error(res, 400, "INVALID_REGENERATION_INPUT", "恢复参数不完整"); return;}
      const ctx = await context(request, res, parsed.data); if (!ctx) return;
      let found: {taskId: string; attempt: number} | null = null;
      for (let attempt = 0; attempt <= 100; attempt++) {
        const task = await ctx.find(attempt); if (!task) break;
        if (!await core.getCredentialForUpstreamResource(ctx.workspaceUserId, "task", task.id)) {
          res.json({status: "unavailable", reason: "binding_pending"}); return;
        }
        found = {taskId: task.id, attempt};
        if (task.status !== "error" && task.status !== "stopped") break;
      }
      res.json(found ? {status: "found", ...found, recordRevision: ctx.record.revision, sourceFingerprint: ctx.fingerprint} : {status: "none"});
    } catch (cause) {failure(res, cause);}
  });
  router.post("/", async (request, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const parsed = startSchema.safeParse(request.body);
      if (!parsed.success) {error(res, 400, "INVALID_REGENERATION_INPUT", "重新生成参数不完整"); return;}
      const ctx = await context(request, res, parsed.data); if (!ctx) return;
      // An unfinished first generation must remain the only generation task.
      if (ctx.record.lastTaskId && ctx.record.appliedModelResult?.taskId !== ctx.record.lastTaskId) {
        error(res, 409, "RESPONSE_LOGIC_TASK_ACTIVE", "请先处理当前首次生成任务"); return;
      }
      let attempt = 0;
      if (parsed.data.retry) {
        const previous = await ctx.owned(parsed.data.retry.taskId, parsed.data.retry.attempt); if (!previous) return;
        const events = await previous.listAllMessages({taskId: parsed.data.retry.taskId, order: "desc"});
        if (!["error", "stopped"].includes(core.latestManusV2TaskState(events) ?? "")) {
          error(res, 409, "REGENERATION_TASK_ACTIVE", "原任务尚未结束，请恢复查询"); return;
        }
        attempt = parsed.data.retry.attempt + 1;
      }
      let existing = await ctx.find(attempt);
      if (existing) {
        while (attempt < 100 && (existing.status === "error" || existing.status === "stopped")) {
          const next = await ctx.find(attempt + 1); if (!next) break;
          existing = next; attempt++;
        }
        if (!await ctx.owned(existing.id, attempt)) return;
        res.json({taskId: existing.id, attempt, recordRevision: ctx.record.revision}); return;
      }
      await hooks.dispatch(request, res, {record: ctx.record, key: ctx.keyFor(attempt), attempt});
    } catch (cause) {failure(res, cause);}
  });
  router.get("/tasks/:taskId/status", async (request, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const parsed = statusSchema.safeParse(request.query);
      if (!parsed.success) {error(res, 400, "INVALID_REGENERATION_INPUT", "任务查询参数不完整"); return;}
      const ctx = await context(request, res, parsed.data); if (!ctx) return;
      const taskId = request.params.taskId!;
      const client = await ctx.owned(taskId, parsed.data.attempt); if (!client) return;
      const events = await client.listAllMessages({taskId, order: "desc"});
      const status = core.latestManusV2TaskState(events);
      const execution = responseLogicPublicExecution(taskId, events, core.orderManusV2EventsByProviderRank);
      if (status === "error") {error(res, 422, "REGENERATION_TASK_FAILED", "重新生成失败，当前草稿已保留。"); return;}
      if (status === null || status === "running" || status === "waiting") {
        res.status(202).json({status: "running", taskId, execution}); return;
      }
      if (status !== "stopped") {error(res, 502, "REGENERATION_STATUS_UNAVAILABLE", "任务状态暂不可确认，请恢复查询"); return;}
      const result = hooks.readResult(events);
      if (!result) {error(res, 422, "REGENERATION_OUTPUT_INVALID", "新稿未通过四栏目校验，当前草稿已保留。"); return;}
      res.json({status: "completed", taskId, recordRevision: ctx.record.revision, ...result, execution});
    } catch (cause) {failure(res, cause);}
  });
  return router;
}
