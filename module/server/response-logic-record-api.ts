import { Router, type Response } from "express";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import type { ResponseLogicRuntimeCore } from "./response-logic-runtime.js";
import { saveResponseLogicSchema } from "../contracts/response-logic.js";

/**
 * Record endpoints for the response-logic feature: list/save plus a tiny
 * authenticated question-context read the workbench uses to detect question
 * edits made elsewhere (e.g. another tab) and invalidate stale judge /
 * optimization results client-side.
 *
 * The Intent module served list/save from its own module router
 * (`module/server/router.ts`, mounted by Core at /api/intent/response-logic).
 * The migrated Brand response-logic router factory only covers generation,
 * materials, adoption, evaluation, judge and optimization, so Brand mounts
 * this small router at the same `/response-logic` prefix in the module
 * namespace, backed by the already-migrated service. Identity comes
 * exclusively from the server-verified module context; the client can never
 * supply userId or workspace coordinates.
 */
export function createResponseLogicRecordRouter(
  core: ModuleHttpCore,
  rlRuntime: ResponseLogicRuntimeCore,
): Router {
  const router = Router();

  const sendRecordError = (
    res: Response,
    error: unknown,
    fallbackCode: string,
    fallbackMessage: string,
  ) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "请求字段无效",
          issues: error.issues.map(({ path, message }) => ({ path, message })),
        },
      });
      return;
    }
    const known = error as {
      statusCode?: unknown;
      responseLogicCode?: unknown;
      code?: unknown;
      message?: unknown;
    } | null;
    if (
      known && typeof known === "object" && typeof known.code === "string" &&
      known.code === "DATABASE_UNAVAILABLE"
    ) {
      res.status(503).json({
        error: { code: "DATABASE_UNAVAILABLE", message: "数据服务暂不可用，请稍后重试" },
      });
      return;
    }
    if (
      known && typeof known === "object" &&
      typeof known.statusCode === "number" && known.statusCode >= 400 &&
      known.statusCode < 500 &&
      (typeof known.responseLogicCode === "string" || typeof known.code === "string")
    ) {
      res.status(known.statusCode).json({
        error: {
          code: (known.responseLogicCode ?? known.code) as string,
          message: typeof known.message === "string" ? known.message : fallbackMessage,
        },
      });
      return;
    }
    console.error("[Response Logic] record list/save error:", error);
    res.status(500).json({ error: { code: fallbackCode, message: fallbackMessage } });
  };

  router.get("/", async (req, res) => {
    try {
      const context = core.context(req);
      await rlRuntime.assertServiceCapability(context.accountUserId, "responseLogic");
      res.setHeader("Cache-Control", "no-store");
      const records = await rlRuntime.responseLogicService.listResponseLogicEntries(
        context.accountUserId,
      );
      res.json({ records });
    } catch (error) {
      sendRecordError(res, error, "RESPONSE_LOGIC_LIST_FAILED", "读取应答逻辑列表失败，请稍后重试");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const context = core.context(req);
      await rlRuntime.assertServiceCapability(context.accountUserId, "responseLogic");
      const value = saveResponseLogicSchema.strict().parse(req.body ?? {});
      // Trusted question ownership check through the Brand ledger resolver —
      // the same gate every other response-logic handler applies. Brand
      // questions live in brand_intent_workspaces, so the service's
      // relational lock can never validate them (see response-logic-runtime).
      const configuredQuestion = await rlRuntime.getDashboardQuestion(
        context.accountUserId,
        value.questionId,
      );
      if (!configuredQuestion) {
        res.status(422).json({
          error: {
            code: "RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED",
            message: "当前问题尚未由管理员配置",
          },
        });
        return;
      }
      const record = await rlRuntime.responseLogicService.saveResponseLogicEntry({
        userId: context.accountUserId,
        value,
        // Currency of the question context this save is based on: the ledger
        // revision from the resolver read above is re-verified under the
        // ledger row lock inside the save transaction — a question edit that
        // landed in between bumps the revision and the save fails with 409.
        expectedQuestionScope: configuredQuestion.writeScope,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ record });
    } catch (error) {
      sendRecordError(res, error, "RESPONSE_LOGIC_SAVE_FAILED", "保存应答逻辑失败，请稍后重试");
    }
  });

  const questionContextQuerySchema = z
    .object({ questionId: z.string().trim().min(1).max(191) })
    .strict();

  router.get("/question-context", async (req, res) => {
    try {
      const parsed = questionContextQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "缺少有效的问题标识" },
        });
        return;
      }
      const context = core.context(req);
      await rlRuntime.assertServiceCapability(context.accountUserId, "responseLogic");
      // Trusted resolution through the Brand ledger resolver: ownership and
      // workspace scope come from the authenticated context, never the query.
      const configured = await rlRuntime.getDashboardQuestion(
        context.accountUserId,
        parsed.data.questionId,
      );
      if (!configured) {
        res.status(404).json({
          error: {
            code: "RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED",
            message: "当前问题不存在或不可访问",
          },
        });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        questionId: configured.questionId,
        question: configured.question,
        intent: configured.intent ?? "",
        workspaceRevision: configured.writeScope.revision,
      });
    } catch (error) {
      sendRecordError(res, error, "RESPONSE_LOGIC_QUESTION_CONTEXT_FAILED", "读取当前问题失败，请稍后重试");
    }
  });

  return router;
}
