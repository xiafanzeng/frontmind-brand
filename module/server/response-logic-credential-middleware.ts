import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ModuleHttpCore } from "./http-api.js";
import { intentSkillPorts } from "./intent-skill-runtime.js";

/**
 * Server-side credential resolution for the response-logic routes.
 *
 * The module namespace mount (`/api/modules/brand`) does not run Core's
 * attachOptionalActiveCredential, so `req.frontmindCredential` is undefined
 * there and every response-logic credential gate would fail closed. This
 * middleware mirrors that Core attachment using the SAME resolution chain the
 * intent workbench uses (BrandKeywordPorts.getDecryptedCredentialForUser →
 * Core's keyword credential chain), which is XTY-aware: under
 * FRONTMIND_MODULE_PROVIDER_MODE/FRONTMIND_AGENT_PROVIDER_MODE =
 * "xty_openai_agents" it returns the xty_codex service identity handle.
 * Identity and ownership come exclusively from the authenticated module
 * context; nothing is trusted from the request body.
 *
 * The attached value is the credential HANDLE Core's provider ports hand out
 * (metadata + opaque credentialRef; key material stays server-side), which is
 * exactly what the response-logic runtime's client factory expects.
 */
export function createResponseLogicCredentialMiddleware(core: ModuleHttpCore): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const existing = (request as Request & { frontmindCredential?: unknown }).frontmindCredential;
    if (existing) {
      next();
      return;
    }
    void (async () => {
      let credential: unknown;
      try {
        const context = core.context(request);
        credential = await intentSkillPorts().getDecryptedCredentialForUser(context.accountUserId);
      } catch (error) {
        // A missing/unconfigured runner must fail loudly, not fall back to a
        // different provider. Core's chain throws XTY_* sentinel errors for
        // that; surface them as an explicit 503. Other resolution failures
        // leave the credential unset so the existing 401/428 gates answer.
        const message = error instanceof Error ? error.message : String(error);
        if (/^XTY_[A-Z_]+$/.test(message)) {
          response.status(503).json({
            error: { code: message, message: "模型运行器尚未配置（XTY），请联系部署人员。" },
          });
          return;
        }
        console.error("[Response Logic] server-side credential resolution failed:", error);
        next();
        return;
      }
      if (credential) {
        (request as Request & { frontmindCredential?: unknown }).frontmindCredential = credential;
      }
      next();
    })();
  };
}
