import { describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request } from "express";
import { once } from "node:events";
import { createResponseLogicEvaluationRouter } from "../server/response-logic-evaluation-api.js";
import { createResponseLogicEvaluationStore } from "../server/response-logic-evaluation-store.js";
import type { CoreRequest } from "../server/response-logic-core-ports.js";

/**
 * S2.5 integration audit tests: verify the evaluation API's runtime behavior
 * against the exact authentication pattern Core's module-business-api uses.
 *
 * Core module-business-api.ts line 23: `const actor=request.frontmindUser;`
 * — Core sets this via `requireExpressAuth` middleware BEFORE routing to the
 * module handler, so `req.frontmindUser` IS available in Brand's module
 * context at runtime (same as Brand's own intent-workbench-service.ts:51).
 */

class MockServiceEntitlementError extends Error {
  code: string; statusCode: number;
  constructor(code: string, message: string, statusCode = 403) {
    super(message); this.code = code; this.statusCode = statusCode;
  }
}

const testQuestion = {
  questionId: "audit-q1",
  groupId: "g1",
  groupTitle: "审计组",
  question: "审计用测试问题",
  intent: "测试意图",
  summary: "测试",
  writeScope: { revision: 1, contractId: null, quotaPeriodId: "p1" },
};

const mockCore = {
  enterpriseWorkspaceUserId: (id: number) => id,
  assertServiceCapability: async () => {},
  ServiceEntitlementError: MockServiceEntitlementError,
  sendAiBillingError: (() => false) as unknown as (...args: unknown[]) => boolean,
  getDashboardQuestion: async () => testQuestion,
  getResponseLogicEntry: async () => null,
  evaluationStore: createResponseLogicEvaluationStore({ getDb: async () => null }),
};

async function makeApp(withUser: boolean) {
  const app = express();
  app.use(express.json());
  // Reproduce Core's module-business-api middleware pattern:
  // set frontmindUser before routing (same as requireExpressAuth + module mount)
  app.use((request, _res, next) => {
    if (withUser) {
      (request as Request & { frontmindUser?: { id: number; role: string } }).frontmindUser = { id: 7, role: "user" };
    }
    next();
  });
  app.use("/evaluation", createResponseLogicEvaluationRouter(mockCore as never));
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address()!.port}` };
}

describe("S2.5: evaluation API auth pattern (Core module-business-api compatibility)", () => {
  it("returns 401 when frontmindUser is not set (anonymous request)", async () => {
    const { server, url } = await makeApp(false);
    try {
      const res = await fetch(`${url}/evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: "audit-q1" }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    } finally { server.close(); }
  });

  it("proceeds past auth when frontmindUser is set (Core host pattern)", async () => {
    const { server, url } = await makeApp(true);
    try {
      const res = await fetch(`${url}/evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: url },
        body: JSON.stringify({ questionId: "audit-q1", expectedRevision: 1 }),
      });
      // Should NOT be 401; expect 404 because getResponseLogicEntry returns null
      expect(res.status).not.toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("RESPONSE_LOGIC_RECORD_MISSING");
    } finally { server.close(); }
  });

  it("returns 422 for a question not found in dashboard config", async () => {
    const app = express();
    app.use(express.json());
    app.use((request, _res, next) => {
      (request as Request & { frontmindUser?: { id: number; role: string } }).frontmindUser = { id: 7, role: "user" };
      next();
    });
    const coreWithNoQuestion = {
      ...mockCore,
      getDashboardQuestion: async () => null,
    };
    app.use("/evaluation", createResponseLogicEvaluationRouter(coreWithNoQuestion as never));
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const res = await fetch(`http://127.0.0.1:${server.address()!.port}/evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
        body: JSON.stringify({ questionId: "nonexistent" }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");
    } finally { server.close(); }
  });

  it("returns 400 for invalid input (empty body)", async () => {
    const { server, url } = await makeApp(true);
    try {
      const res = await fetch(`${url}/evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: url },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally { server.close(); }
  });
});

describe("S2.5: workspaceQuestionTable port is a deliberate wiring point", () => {
  it("is declared as any in the ports interface (documented decision, not a bug)", async () => {
    // Read the actual source to confirm the port type is `any` (not silently
    // changed by TypeScript inference)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../server/response-logic-service.ts"),
      "utf-8",
    );
    // The port signature must be explicitly `any` — it is a Core wiring
    // injection point, not a Brand-owned table
    expect(source).toContain("workspaceQuestionTable(): any;");
  });
});
