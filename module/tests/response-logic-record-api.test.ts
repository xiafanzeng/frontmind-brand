// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Router } from "express";
import http from "node:http";
import { once } from "node:events";
import { createResponseLogicRecordRouter } from "../server/response-logic-record-api";
import type { ModuleHttpCore } from "../server/http-api";
import type { ResponseLogicRuntimeCore } from "../server/response-logic-runtime";

const validSaveBody = {
  questionId: "t:1",
  groupId: "brand-intent",
  groupTitle: "品牌意图优化",
  question: "隆鼻材料应该怎么选",
  intent: "",
  summary: "",
  draft: {
    concern: "用户关注材料安全性",
    conclusion: "先确认用途，再核对证书范围",
    facts: "资质证书：见官网公示",
    pending: "",
    boundaries: "不承诺具体价格",
    references: "",
    images: [],
  },
};

function createHarness(options: {
  accountUserId?: number;
  actorUserId?: number;
  enterpriseProjectId?: string | null;
  extraRouter?: Router;
}) {
  const accountUserId = options.accountUserId ?? 42;
  const actorUserId = options.actorUserId ?? 42;
  const runtime = {
    assertServiceCapability: vi.fn(),
    getDashboardQuestion: vi.fn(),
    responseLogicService: {
      listResponseLogicEntries: vi.fn(),
      saveResponseLogicEntry: vi.fn(),
    },
  } as unknown as ResponseLogicRuntimeCore & {
    assertServiceCapability: ReturnType<typeof vi.fn>;
    getDashboardQuestion: ReturnType<typeof vi.fn>;
    responseLogicService: {
      listResponseLogicEntries: ReturnType<typeof vi.fn>;
      saveResponseLogicEntry: ReturnType<typeof vi.fn>;
    };
  };
  const core: ModuleHttpCore = {
    context: () => ({
      accountUserId,
      actorUserId,
      enterpriseProjectId: options.enterpriseProjectId ?? null,
      businessOwnerId: String(accountUserId),
      businessActorId: String(actorUserId),
    }),
    database: async () => null,
    environment: {},
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/response-logic", createResponseLogicRecordRouter(core, runtime));
  if (options.extraRouter) app.use("/response-logic", options.extraRouter);
  const server = http.createServer(app);
  return {
    runtime,
    accountUserId,
    async start() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (typeof address === "object" && address) {
        return `http://127.0.0.1:${address.port}`;
      }
      throw new Error("test server failed to listen");
    },
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

const consoles = () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  return error;
};

describe("response-logic record list/save routes", () => {
  let stderr: ReturnType<typeof consoles>;
  beforeEach(() => {
    stderr = consoles();
  });
  afterEach(() => {
    stderr.mockRestore();
  });

  it("lists records with the server-verified identity and capability check", async () => {
    const harness = createHarness({ accountUserId: 42, enterpriseProjectId: "proj-1" });
    const url = await harness.start();
    try {
      harness.runtime.responseLogicService.listResponseLogicEntries.mockResolvedValue([
        { questionId: "t:1", revision: 3 },
      ]);
      const response = await fetch(`${url}/response-logic`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = await response.json();
      expect(payload).toEqual({ records: [{ questionId: "t:1", revision: 3 }] });
      expect(harness.runtime.assertServiceCapability).toHaveBeenCalledWith(42, "responseLogic");
      expect(harness.runtime.responseLogicService.listResponseLogicEntries).toHaveBeenCalledWith(42);
    } finally {
      await harness.close();
    }
  });

  it("maps an entitlement rejection to its status code", async () => {
    const harness = createHarness({});
    const url = await harness.start();
    try {
      harness.runtime.assertServiceCapability.mockRejectedValue(
        Object.assign(new Error("服务不可用"), { code: "SERVICE_FORBIDDEN", statusCode: 403 }),
      );
      const response = await fetch(`${url}/response-logic`);
      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.error.code).toBe("SERVICE_FORBIDDEN");
      expect(harness.runtime.responseLogicService.listResponseLogicEntries).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("saves a valid record and echoes the stored record", async () => {
    const harness = createHarness({ accountUserId: 7 });
    const url = await harness.start();
    try {
      harness.runtime.getDashboardQuestion.mockResolvedValue({ questionId: "t:1" });
      harness.runtime.responseLogicService.saveResponseLogicEntry.mockResolvedValue({
        questionId: "t:1",
        revision: 4,
      });
      const response = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSaveBody),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toEqual({ record: { questionId: "t:1", revision: 4 } });
      const call = harness.runtime.responseLogicService.saveResponseLogicEntry.mock.calls[0][0];
      expect(call.userId).toBe(7);
      expect(call.value.questionId).toBe("t:1");
      expect(call.value.expectedRevision).toBe(0);
      expect(call.value.publish).toBe(false);
      expect(harness.runtime.getDashboardQuestion).toHaveBeenCalledWith(7, "t:1");
    } finally {
      await harness.close();
    }
  });

  it("rejects a save for a question the caller's ledger does not resolve", async () => {
    const harness = createHarness({});
    const url = await harness.start();
    try {
      harness.runtime.getDashboardQuestion.mockResolvedValue(null);
      const response = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSaveBody),
      });
      expect(response.status).toBe(422);
      const payload = await response.json();
      expect(payload.error.code).toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");
      expect(harness.runtime.responseLogicService.saveResponseLogicEntry).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("rejects an invalid body with field-level issues", async () => {
    const harness = createHarness({});
    const url = await harness.start();
    try {
      const response = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: "" }),
      });
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error.code).toBe("INVALID_INPUT");
      expect(Array.isArray(payload.error.issues)).toBe(true);
      expect(harness.runtime.responseLogicService.saveResponseLogicEntry).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("maps a revision conflict to 409 with the response-logic code", async () => {
    const harness = createHarness({});
    const url = await harness.start();
    try {
      harness.runtime.getDashboardQuestion.mockResolvedValue({ questionId: "t:1" });
      harness.runtime.responseLogicService.saveResponseLogicEntry.mockRejectedValue(
        Object.assign(new Error("应答逻辑 t:1 已更新到 R5"), {
          code: "CONFLICT",
          responseLogicCode: "RESPONSE_LOGIC_REVISION_CONFLICT",
          statusCode: 409,
        }),
      );
      const response = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSaveBody),
      });
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.error.code).toBe("RESPONSE_LOGIC_REVISION_CONFLICT");
    } finally {
      await harness.close();
    }
  });

  it("maps a database outage to 503 and an unknown failure to a safe 500", async () => {
    const harness = createHarness({});
    const url = await harness.start();
    try {
      harness.runtime.getDashboardQuestion.mockResolvedValue({ questionId: "t:1" });
      harness.runtime.responseLogicService.saveResponseLogicEntry.mockRejectedValueOnce(
        Object.assign(new Error("db down"), { code: "DATABASE_UNAVAILABLE" }),
      );
      const unavailable = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSaveBody),
      });
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json()).error.code).toBe("DATABASE_UNAVAILABLE");

      harness.runtime.responseLogicService.saveResponseLogicEntry.mockRejectedValueOnce(
        new Error("boom"),
      );
      const failed = await fetch(`${url}/response-logic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSaveBody),
      });
      expect(failed.status).toBe(500);
      const payload = await failed.json();
      expect(payload.error.code).toBe("RESPONSE_LOGIC_SAVE_FAILED");
      expect(payload.error.message).not.toContain("boom");
    } finally {
      await harness.close();
    }
  });

  it("falls through to the full response-logic router for non-record paths", async () => {
    const downstream = express.Router();
    downstream.post("/start", (_req, res) => {
      res.status(202).json({ id: "task-1" });
    });
    const harness = createHarness({ extraRouter: downstream });
    const url = await harness.start();
    try {
      const response = await fetch(`${url}/response-logic/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ id: "task-1" });
    } finally {
      await harness.close();
    }
  });
});
