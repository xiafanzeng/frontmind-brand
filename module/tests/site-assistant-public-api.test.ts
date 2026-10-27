// @vitest-environment node
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import express from "express";
import type {AddressInfo} from "node:net";
import {
  createSiteAssistantPublicApi,
  extractAssistantAnswer,
  SITE_ASSISTANT_DEFAULT_LIMITS,
  type SiteAssistantInternalClient,
} from "../server/site-assistant-public-api.js";

type Call = {method: "GET" | "POST"; path: string; body?: unknown};
type Handler = {
  match: (call: Call) => boolean;
  status?: number;
  json?: unknown | (() => unknown);
};

function fakeClient(handlers: Handler[]) {
  const calls: Call[] = [];
  const json = vi.fn(async (method: "GET" | "POST", path: string, body?: unknown) => {
    const call = {method, path, body};
    calls.push(call);
    const handler = handlers.find((entry) => entry.match(call));
    if (!handler) throw new Error(`UNEXPECTED_INTERNAL_CALL ${method} ${path}`);
    return {
      status: handler.status ?? 200,
      json: typeof handler.json === "function" ? handler.json() : (handler.json ?? null),
    };
  });
  return {client: {json} as unknown as SiteAssistantInternalClient, calls};
}

const config = {
  selfOrigin: "http://127.0.0.1:3001",
  publicOrigin: "https://brand.frontmind.cn",
  gatewaySecret: "unit-test-secret",
};

const runtimeConfigWithKnowledge: Handler = {
  match: (call) => call.method === "GET" && call.path.startsWith("/api/frontmind/v2/runtime-config"),
  json: {knowledgeBase: {snapshotId: "snap-1", version: 3, sourceFileName: "company.md", documentCount: 7}},
};

const assistantOutput = [
  {role: "user", content: [{type: "input_text", text: "问：你们提供什么服务？"}]},
  {
    role: "assistant",
    content: [{type: "output_text", text: "FrontMind 提供品牌知识管理。"}],
    enterprise_qa_answer: {
      schemaVersion: 1,
      sources: [{id: "doc-1", title: "公司介绍", kind: "published_knowledge"}],
    },
  },
];
const completedTask = {id: "task-1", status: "completed", output: assistantOutput};
const conversationSync: Handler = {
  match: (call) => call.method === "POST" && call.path === "/api/brand/conversations/sync",
  json: {ok: true},
};

let server: ReturnType<typeof express>;
let listener: import("node:http").Server;
let baseUrl = "";
let currentRouter: import("express").RequestHandler = (_request, _response, next) => next();

beforeAll(async () => {
  server = express();
  server.use(express.json());
  server.use((request, response, next) => currentRouter(request, response, next));
  listener = server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
});

function mountApi(handlers: Handler[], limits?: Record<string, number>) {
  const {client, calls} = fakeClient(handlers);
  currentRouter = createSiteAssistantPublicApi({...config, ...(limits ? {limits} : {})}, {
    client,
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
  });
  return {calls};
}

async function ask(body: unknown, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/ask`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
    ...init,
  });
  return {status: response.status, body: await response.json(), headers: response.headers};
}

describe("public site assistant api", () => {
  it("extracts the newest assistant answer with validated sources", () => {
    const answer = extractAssistantAnswer(completedTask);
    expect(answer?.text).toBe("FrontMind 提供品牌知识管理。");
    expect(answer?.sources).toEqual([{id: "doc-1", title: "公司介绍", kind: "published_knowledge"}]);
    expect(extractAssistantAnswer({...completedTask, status: "failed"})).toBeNull();
    expect(extractAssistantAnswer(null)).toBeNull();
  });

  it("reports assistant availability and knowledge state on /config", async () => {
    mountApi([runtimeConfigWithKnowledge]);
    const response = await fetch(`${baseUrl}/config`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      assistant: {name: "AI 助手"},
      knowledgeBase: {version: 3, documentCount: 7},
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers OPTIONS preflight without internal calls", async () => {
    const {calls} = mountApi([]);
    const response = await fetch(`${baseUrl}/ask`, {method: "OPTIONS"});
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(calls).toHaveLength(0);
  });

  it("rejects missing or oversized questions before any internal call", async () => {
    const {calls} = mountApi([runtimeConfigWithKnowledge]);
    const empty = await ask({question: "   "});
    expect(empty.status).toBe(400);
    const long = await ask({question: "长".repeat(SITE_ASSISTANT_DEFAULT_LIMITS.questionMaxChars + 1)});
    expect(long.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("asks one question through conversation sync, task creation and polling", async () => {
    let polls = 0;
    const {calls} = mountApi([
      runtimeConfigWithKnowledge,
      {match: (call) => call.method === "POST" && call.path === "/api/brand/conversations/sync", json: {ok: true}},
      {match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks", json: {id: "task-9", status: "running"}},
      {
        match: (call) => call.method === "GET" && call.path === "/api/frontmind/v2/tasks/task-9",
        json: () => {
          polls += 1;
          return polls < 2 ? {id: "task-9", status: "running"} : completedTask;
        },
      },
    ]);
    const response = await ask({question: "你们提供什么服务？"});
    expect(response.status).toBe(200);
    expect(response.body.answer.text).toBe("FrontMind 提供品牌知识管理。");
    expect(response.body.answer.sources).toEqual([{id: "doc-1", title: "公司介绍", kind: "published_knowledge"}]);
    expect(response.body.knowledge).toEqual({version: 3});
    expect(typeof response.body.session).toBe("string");
    expect(calls.some((call) => call.path === "/api/brand/conversations/sync")).toBe(true);
    const create = calls.find((call) => call.path === "/api/frontmind/v2/tasks");
    expect(create?.body).toMatchObject({purpose: "enterprise_qa", prompt: "你们提供什么服务？"});
    const sync = calls.find((call) => call.path === "/api/brand/conversations/sync");
    expect(sync?.body).toMatchObject({
      purpose: "enterprise_qa",
      conversations: [{purpose: "enterprise_qa", status: "idle", messages: []}],
      deletedIds: [],
    });
  });

  it("continues an existing session through the task message route", async () => {
    const {calls} = mountApi([
      runtimeConfigWithKnowledge,
      conversationSync,
      {match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks", json: {id: "task-1", status: "completed", output: assistantOutput}},
      {
        match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks/task-1/messages",
        json: {
          id: "task-1",
          status: "completed",
          output: [...assistantOutput, {role: "assistant", content: [{type: "output_text", text: "第二轮回答。"}]}],
        },
      },
    ]);
    const first = await ask({question: "第一轮"});
    expect(first.status).toBe(200);
    const session = first.body.session;
    const second = await ask({question: "第二轮", session});
    expect(second.status).toBe(200);
    expect(second.body.session).toBe(session);
    expect(second.body.answer.text).toBe("第二轮回答。");
    expect(calls.some((call) => call.path === "/api/frontmind/v2/tasks/task-1/messages")).toBe(true);
    // A follow-up must not create a second conversation.
    expect(calls.filter((call) => call.path === "/api/brand/conversations/sync")).toHaveLength(1);
  });

  it("starts a new session when the token is unknown", async () => {
    mountApi([
      runtimeConfigWithKnowledge,
      {match: (call) => call.method === "POST" && call.path === "/api/brand/conversations/sync", json: {}},
      {match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks", json: completedTask},
    ]);
    const response = await ask({question: "你好", session: "not-a-known-session"});
    expect(response.status).toBe(200);
    expect(response.body.session).not.toBe("not-a-known-session");
  });

  it("blocks questions past the per-IP window limit", async () => {
    mountApi([runtimeConfigWithKnowledge], {perIpMaxQuestions: 2});
    const first = await ask({question: "第一"});
    const second = await ask({question: "第二"});
    // Both reach the (unstubbed) dispatch and fail generically, but they count.
    expect([first.status, second.status]).toEqual([503, 503]);
    const blocked = await ask({question: "第三"});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("ASSISTANT_RATE_LIMITED");
  });

  it("caps turns per session", async () => {
    mountApi([runtimeConfigWithKnowledge], {sessionMaxTurns: 1});
    const first = await ask({question: "第一轮"});
    expect(first.status).toBe(503);
    const second = await ask({question: "第二轮", session: first.body.session});
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("ASSISTANT_SESSION_TURNS_EXCEEDED");
  });

  it("surfaces no-knowledge state as a friendly unavailable answer", async () => {
    mountApi([
      {match: (call) => call.method === "GET" && call.path.startsWith("/api/frontmind/v2/runtime-config"), json: {knowledgeBase: null}},
    ]);
    const response = await ask({question: "你们是谁"});
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ASSISTANT_KNOWLEDGE_UNAVAILABLE");
  });

  it("never leaks internal error detail when dispatch fails", async () => {
    mountApi([
      runtimeConfigWithKnowledge,
      {match: (call) => call.method === "POST" && call.path === "/api/brand/conversations/sync", json: {}},
      {
        match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks",
        status: 428,
        json: {error: {code: "API_CREDENTIAL_REQUIRED", message: "internal secret detail"}},
      },
    ]);
    const response = await ask({question: "你们是谁"});
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ASSISTANT_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("internal secret detail");
  });

  it("returns 404 with CORS headers for unknown assistant routes", async () => {
    mountApi([]);
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
