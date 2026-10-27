// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { once } from "node:events";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { mysqlTable, varchar, int, timestamp } from "drizzle-orm/mysql-core";
import { assembleResponseLogicCore } from "../server/response-logic-runtime";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime";
import { createResponseLogicRecordRouter } from "../server/response-logic-record-api";
import { createResponseLogicApi } from "../server/response-logic-api";
import type { ModuleHttpCore } from "../server/http-api";
import { createFakeMysqlClient } from "./helpers/response-logic-fake-mysql.js";

const USER = 42;
const QUESTION_ID = "t:1";
const GONE_QUESTION_ID = "gone:1";

// Column set mirrors what the materials handler reads from local_assets.
const localAssetsTable = mysqlTable("local_assets", {
  id: varchar("id", { length: 36 }),
  scope: varchar("scope", { length: 32 }),
  accountUserId: varchar("accountUserId", { length: 36 }),
  enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
  filename: varchar("filename", { length: 512 }),
  mimeType: varchar("mimeType", { length: 255 }),
  sizeBytes: int("sizeBytes"),
  contentSha256: varchar("contentSha256", { length: 64 }),
  createdAt: timestamp("createdAt"),
  contentExpiresAt: timestamp("contentExpiresAt"),
  contentDeletedAt: timestamp("contentDeletedAt"),
});

const saveBody = {
  questionId: QUESTION_ID,
  groupId: "brand-intent",
  groupTitle: "品牌意图优化",
  question: "隆鼻材料应该怎么选",
  intent: "",
  summary: "",
  draft: {
    concern: "担心选错材料",
    conclusion: "先确认用途",
    facts: "资质见公示",
    pending: "",
    boundaries: "不承诺价格",
    references: "",
    images: [],
    attachments: [],
  },
};

async function startHarness(options: { credential: boolean }) {
  const fake = createFakeMysqlClient({
    ledger: [
      {
        ownerUserId: USER,
        projectId: null,
        revision: 5,
        payload: { version: 1, questions: [{ id: QUESTION_ID, question: "隆鼻材料应该怎么选", intent: "", category: "" }] },
      },
    ],
    localAssets: [
      { id: "asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", scope: "managed_user" as const, ownerUserId: USER, filename: "材料.txt", mimeType: "text/plain", sizeBytes: 12, sha256: "abc" },
    ],
  });
  const db = drizzle(fake.client as never);
  const upstreamClient = vi.fn(() => {
    throw new Error("UPSTREAM_STOP");
  });
  registerIntentSkillPorts({
    currentEnterpriseProjectId: () => null,
    enterpriseWorkspaceUserId: (id: number) => id,
    assertServiceCapability: vi.fn(),
    lockCustomerProjectBusinessWrite: async () => {},
    getEnterpriseProjectScope: () => null,
    enterpriseAccountOwnerPredicate: () => sql`1 = 1`,
    localAssets: localAssetsTable,
    readStoredPresalesFile: async (id: string) => (id === "asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ? { sizeBytes: 12, sha256: "abc" } : null),
    getDecryptedCredentialForUser: async () => null,
    getLatestAuthenticatedKnowledgeSnapshot: async () => null,
    getUpstreamBaseUrl: () => "https://upstream.example",
    recordUpstreamResource: async () => {},
    createCredentialAgentClient: upstreamClient,
  } as never);
  const runtime = assembleResponseLogicCore({ getDb: async () => db as never });
  // Seed one record for the resolved question so record-dependent endpoints
  // progress past their record gate.
  await runtime.responseLogicService.saveResponseLogicEntry({
    userId: USER,
    value: { ...saveBody, expectedRevision: 0, publish: false } as never,
  });

  const moduleCore: ModuleHttpCore = {
    context: () => ({
      accountUserId: USER,
      actorUserId: USER,
      enterpriseProjectId: null,
      businessOwnerId: String(USER),
      businessActorId: String(USER),
    }),
    database: async () => db as never,
    environment: {},
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { frontmindUser?: unknown }).frontmindUser = { id: USER, role: "user" };
    if (options.credential) {
      (req as unknown as { frontmindCredential?: unknown }).frontmindCredential = {
        credentialRef: "ref-1", id: "c1", userId: USER, version: 1, fingerprint: "f",
        status: "active", agentProfile: "profile", provider: "manus", upstreamModel: "m", upstreamEffort: null,
      };
    }
    next();
  });
  app.use("/response-logic", createResponseLogicRecordRouter(moduleCore, runtime));
  app.use("/response-logic", createResponseLogicApi(runtime as never).router);

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("listen failed");
  return {
    fake,
    upstreamClient,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.map(server => server.close()));
  servers.length = 0;
});

describe("response-logic resolver gate across all public endpoints", () => {
  it("fails closed with 422 when the caller's ledger cannot resolve the question", async () => {
    const harness = await startHarness({ credential: true });
    servers.push(harness);
    const json = { "Content-Type": "application/json" };

    const cases: Array<[string, RequestInit]> = [
      ["POST /response-logic", { method: "POST", headers: json, body: JSON.stringify({ ...saveBody, questionId: GONE_QUESTION_ID }) }],
      ["POST /response-logic/start", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, groupId: "brand-intent", groupTitle: "品牌意图优化", question: "gone", intent: "", summary: "", conversationId: "c1", operationRevision: 1, userMessage: "生成", draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] } }) }],
      ["GET /response-logic/tasks/tk-1/status", { method: "GET" }],
      ["POST /response-logic/materials", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, expectedRevision: 1, addAssetIds: ["asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }) }],
      ["POST /response-logic/adopt-result", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, conversationId: "c1", taskId: "tk-1", resultId: "r1", operationRevision: 1 }) }],
      ["POST /response-logic/evaluation", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, expectedRevision: 1 }) }],
      ["GET /response-logic/evaluation/latest", { method: "GET" }],
      ["POST /response-logic/evaluation/judge", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, expectedRevision: 1 }) }],
      ["GET /response-logic/evaluation/judge/tasks/tk-1/status", { method: "GET" }],
      ["POST /response-logic/optimization", { method: "POST", headers: json, body: JSON.stringify({ questionId: GONE_QUESTION_ID, expectedRevision: 1, judgeTaskId: "jt-1" }) }],
      ["GET /response-logic/optimization/tasks/tk-1/status", { method: "GET" }],
    ];
    for (const [label, init] of cases) {
      const url = label.startsWith("GET /response-logic/tasks")
        ? `${harness.url}/response-logic/tasks/tk-1/status?questionId=${encodeURIComponent(GONE_QUESTION_ID)}&conversationId=c1&operationRevision=1`
        : label.includes("/evaluation/latest")
          ? `${harness.url}/response-logic/evaluation/latest?questionId=${encodeURIComponent(GONE_QUESTION_ID)}`
          : label.includes("judge/tasks")
            ? `${harness.url}/response-logic/evaluation/judge/tasks/tk-1/status?questionId=${encodeURIComponent(GONE_QUESTION_ID)}&expectedRevision=1`
            : label.includes("optimization/tasks")
              ? `${harness.url}/response-logic/optimization/tasks/tk-1/status?questionId=${encodeURIComponent(GONE_QUESTION_ID)}&expectedRevision=1&judgeTaskId=jt-1`
              : harness.url + label.replace(/^(\w+) \/response-logic/, "/response-logic");
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => ({}));
      expect(`${label} → ${response.status}`, JSON.stringify(payload)).toBe(`${label} → 422`);
      expect(payload.error?.code).toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");
    }
    // No case may reach an upstream provider client.
    expect(harness.upstreamClient).not.toHaveBeenCalled();
  });

  it("serves resolved questions and stops at the next gate, not the resolver", async () => {
    const withCredential = await startHarness({ credential: true });
    servers.push(withCredential);
    const noCredential = await startHarness({ credential: false });
    servers.push(noCredential);
    const json = { "Content-Type": "application/json" };

    // List + save work end to end.
    const list = await fetch(`${withCredential.url}/response-logic`);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ records: [{ questionId: QUESTION_ID }] });

    // Task status passes the question gate and fails at task binding.
    const status = await fetch(
      `${withCredential.url}/response-logic/tasks/tk-1/status?questionId=${encodeURIComponent(QUESTION_ID)}&conversationId=c1&operationRevision=1`,
    );
    expect([403, 404, 409]).toContain(status.status);
    expect((await status.json()).error?.code).not.toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");

    // Materials binding succeeds with an owned asset.
    const materials = await fetch(`${withCredential.url}/response-logic/materials`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 1, addAssetIds: ["asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }),
    });
    const materialsPayload = await materials.json().catch(() => ({}));
    expect(materials.status).toBe(200);
    const materialsRecord = materialsPayload.record;
    expect(materialsRecord.draft.attachments).toHaveLength(1);
    expect(materialsRecord.draft.attachments[0]).toMatchObject({ fileId: "asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", filename: "材料.txt" });

    // Rule evaluation: latest is empty first, POST computes, latest serves it.
    const latestBefore = await fetch(`${withCredential.url}/response-logic/evaluation/latest?questionId=${encodeURIComponent(QUESTION_ID)}`);
    expect([404, 200]).toContain(latestBefore.status);
    const evaluate = await fetch(`${withCredential.url}/response-logic/evaluation`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: materialsRecord.revision }),
    });
    expect(evaluate.status).toBe(200);
    const envelope = await evaluate.json();
    expect(envelope.status).toBe("completed");
    expect(envelope.evaluation).toMatchObject({ questionId: QUESTION_ID });

    // Adopt passes the resolver and fails at the task binding instead.
    const adopt = await fetch(`${withCredential.url}/response-logic/adopt-result`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, conversationId: "c1", taskId: "tk-1", resultId: "r1", operationRevision: 1 }),
    });
    expect(adopt.status).not.toBe(422);
    expect((await adopt.json()).error?.code).not.toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");

    // Judge and optimization (no credential): question gate passed, stopped
    // at the customer-key gate.
    const judgeStart = await fetch(`${noCredential.url}/response-logic/evaluation/judge`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 1 }),
    });
    expect(judgeStart.status).toBe(428);
    const optimizationStart = await fetch(`${noCredential.url}/response-logic/optimization`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 1, judgeTaskId: "jt-1" }),
    });
    expect(optimizationStart.status).toBe(428);

    // Task polling without an owned upstream task stops at ownership (403).
    const judgeStatus = await fetch(
      `${noCredential.url}/response-logic/evaluation/judge/tasks/tk-1/status?questionId=${encodeURIComponent(QUESTION_ID)}&expectedRevision=1`,
    );
    expect(judgeStatus.status).toBe(403);
    const optimizationStatus = await fetch(
      `${noCredential.url}/response-logic/optimization/tasks/tk-1/status?questionId=${encodeURIComponent(QUESTION_ID)}&expectedRevision=1&judgeTaskId=jt-1`,
    );
    expect(optimizationStatus.status).toBe(403);

    // Generation start (with credential) passes the question gate and reaches
    // the upstream boundary — the stub throws, surfacing a non-question error.
    const start = await fetch(`${withCredential.url}/response-logic/start`, {
      method: "POST", headers: json,
      body: JSON.stringify({
        questionId: QUESTION_ID, groupId: "brand-intent", groupTitle: "品牌意图优化",
        question: "隆鼻材料应该怎么选", intent: "", summary: "",
        conversationId: "c1", operationRevision: 1, userMessage: "生成应答逻辑",
        draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] },
      }),
    });
    const startPayload = await start.json().catch(() => ({}));
    expect(start.status).not.toBe(422);
    expect(startPayload.error?.code).not.toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");
    // Boundary: the segments beyond the question gate (readiness, archive
    // build, upstream dispatch) are covered by the migrated Intent suite;
    // this matrix proves only that the resolver gate lets the flow through.
  });

  it("fails judge and optimization closed while the record's question basis is stale (Q1→Q2)", async () => {
    const harness = await startHarness({ credential: false });
    servers.push(harness);
    const json = { "Content-Type": "application/json" };

    // Tab A saved the record under Q1; tab B edits the ledger question to Q2
    // (ledger revision bumps; the record's stored basis stays Q1).
    harness.fake.ledgerRows[0].revision = 6;
    harness.fake.ledgerRows[0].payload = {
      version: 1,
      questions: [{ id: QUESTION_ID, question: "修改后的新问题文本", intent: "", category: "" }],
    };

    const judgeStart = await fetch(`${harness.url}/response-logic/evaluation/judge`, {
      method: "POST", headers: json, body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 1 }),
    });
    expect(judgeStart.status).toBe(409);
    expect((await judgeStart.json()).error?.code).toBe("RESPONSE_LOGIC_QUESTION_CONTEXT_STALE");

    const judgeStatus = await fetch(
      `${harness.url}/response-logic/evaluation/judge/tasks/tk-1/status?questionId=${encodeURIComponent(QUESTION_ID)}&expectedRevision=1`,
    );
    expect(judgeStatus.status).toBe(409);
    expect((await judgeStatus.json()).error?.code).toBe("RESPONSE_LOGIC_QUESTION_CONTEXT_STALE");

    const optimizationStart = await fetch(`${harness.url}/response-logic/optimization`, {
      method: "POST", headers: json,
      body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 1, judgeTaskId: "jt-1" }),
    });
    expect(optimizationStart.status).toBe(409);
    expect((await optimizationStart.json()).error?.code).toBe("RESPONSE_LOGIC_QUESTION_CONTEXT_STALE");

    const optimizationStatus = await fetch(
      `${harness.url}/response-logic/optimization/tasks/tk-1/status?questionId=${encodeURIComponent(QUESTION_ID)}&expectedRevision=1&judgeTaskId=jt-1`,
    );
    expect(optimizationStatus.status).toBe(409);
    expect((await optimizationStatus.json()).error?.code).toBe("RESPONSE_LOGIC_QUESTION_CONTEXT_STALE");

    // No upstream client may be reached from a stale context.
    expect(harness.upstreamClient).not.toHaveBeenCalled();

    // Re-saving the draft under the edited question text restores the basis
    // and unblocks evaluation (the credential gate is the next stop).
    const resaved = await fetch(`${harness.url}/response-logic`, {
      method: "POST", headers: json,
      body: JSON.stringify({ ...saveBody, question: "修改后的新问题文本", expectedRevision: 1, publish: false }),
    });
    expect(resaved.status).toBe(200);
    const judgeAfter = await fetch(`${harness.url}/response-logic/evaluation/judge`, {
      method: "POST", headers: json, body: JSON.stringify({ questionId: QUESTION_ID, expectedRevision: 2 }),
    });
    expect(judgeAfter.status).toBe(428);
  });
});
