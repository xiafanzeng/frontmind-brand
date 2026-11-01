import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import {
  createDiagnosticService,
  startDiagnosticWorker,
  DiagnosticError,
} from "./diagnostic-service.js";
export function createDiagnosticRouter(core: ModuleHttpCore): Router {
  const router = Router();
  startDiagnosticWorker(core);
  const service = (req: Request) => {
    const context = core.context(req);
    const actor = (
      req as Request & { frontmindUser?: { id: number; role: string } }
    ).frontmindUser;
    if (!actor || actor.id !== context.actorUserId)
      throw new DiagnosticError("UNAUTHORIZED", "请先登录企业工作区", 401);
    return createDiagnosticService(core, context, actor);
  };
  const handle =
    (fn: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        res.json(await fn(req));
      } catch (e) {
        const known = e instanceof DiagnosticError;
        res
          .status(known ? e.status : e instanceof z.ZodError ? 400 : 503)
          .json({
            error: {
              code: known
                ? e.code
                : e instanceof z.ZodError
                  ? "INVALID_INPUT"
                  : "DIAGNOSTIC_UNAVAILABLE",
              message: known
                ? e.message
                : e instanceof z.ZodError
                  ? "提交格式不正确"
                  : "诊断服务暂不可用，请稍后读取",
            },
          });
      }
    };
  router.get(
    "/",
    handle((req) => service(req).workspace()),
  );
  router.post(
    "/drafts",
    handle((req) => service(req).create(req.body)),
  );
  router.get(
    "/:id",
    handle((req) => service(req).observe(req.params.id)),
  );
  router.post(
    "/:id/draft",
    handle((req) => service(req).save(req.params.id, req.body)),
  );
  router.post(
    "/:id/recommend",
    handle((req) => service(req).recommend(req.params.id)),
  );
  router.post(
    "/:id/validate",
    handle((req) => service(req).validate(req.params.id)),
  );
  router.post(
    "/:id/start",
    handle((req) => service(req).start(req.params.id, req.body)),
  );
  router.post(
    "/:id/stop",
    handle((req) => service(req).stop(req.params.id)),
  );
  router.post(
    "/:id/retry",
    handle((req) => service(req).retry(req.params.id)),
  );
  router.get(
    "/:id/answers/:sampleId",
    handle((req) => service(req).answer(req.params.id, req.params.sampleId)),
  );
  router.get(
    "/:id/knowledge",
    handle((req) => service(req).documents(req.params.id)),
  );
  return router;
}
