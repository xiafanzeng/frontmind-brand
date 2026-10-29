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
import {
  signSiteAssistantBuildBinding,
  siteAssistantBuildBindingPayloadSchema,
  SITE_ASSISTANT_BINDING_SECRET_ENV,
} from "../server/siteops/site-assistant-binding.js";

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
    expect(create?.body).toMatchObject({purpose: "enterprise_qa", prompt: "你们提供什么服务？", modelProfile: "frontmind-base"});
    const sync = calls.find((call) => call.path === "/api/brand/conversations/sync");
    expect(sync?.body).toMatchObject({
      purpose: "enterprise_qa",
      conversations: [
        {
          purpose: "enterprise_qa",
          status: "running",
          messages: [{role: "user", content: "你们提供什么服务？"}],
        },
      ],
      deletedIds: [],
    });
    // The dispatched user message must be synced under the same id the task
    // creation references, carrying the matching dispatch metadata.
    const syncedMessage = sync?.body.conversations[0].messages[0];
    expect(create?.body.clientRequestId).toBe(syncedMessage.id);
    expect(syncedMessage.generalChatDispatch).toMatchObject({
      schemaVersion: 1,
      kind: "pending_user",
      clientRequestId: syncedMessage.id,
      providerPrompt: "你们提供什么服务？",
      localAssetIds: [],
      localTaskId: null,
      modelProfile: "frontmind-base",
      purpose: "enterprise_qa",
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
    // Every turn syncs the same conversation, with the task pointers set and
    // the continuation dispatch metadata bound to the running task.
    const syncs = calls.filter((call) => call.path === "/api/brand/conversations/sync");
    expect(syncs).toHaveLength(2);
    expect(syncs[0].body.conversations[0].taskId).toBeUndefined();
    expect(syncs[1].body.conversations[0]).toMatchObject({taskId: "task-1", previousResponseId: "task-1"});
    expect(syncs[1].body.conversations[0].messages.map((message: {role: string; content: string}) => message.content)).toEqual(["第一轮", "第二轮"]);
    expect(syncs[1].body.conversations[0].messages[1].generalChatDispatch).toMatchObject({localTaskId: "task-1", modelProfile: null});
    expect(syncs[1].body.conversations[0].messages[1].generalChatDispatch.purpose).toBeUndefined();
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


const BINDING_SECRET = "unit-test-binding-secret";

function bindingPayloadFor(snapshotId: string, archiveHash: string) {
  return siteAssistantBuildBindingPayloadSchema.parse({
    schemaVersion: 1,
    buildId: "44444444-4444-4444-8444-444444444444",
    knowledgeSnapshotId: snapshotId,
    knowledgeArchiveHash: archiveHash,
    designRevision: 7,
    draftHash: "b".repeat(64),
    assistantName: "知识助手",
    welcome: "你好，我可以基于本站知识回答问题。",
    assistantAccent: "#8a2be2",
  });
}

describe("public site assistant build bindings", () => {
  it("pins the dispatched knowledge snapshot from a signed build binding", async () => {
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, BINDING_SECRET);
    const payload = bindingPayloadFor("22222222-2222-4222-8222-222222222222", "a".repeat(64));
    const binding = {...payload, signature: signSiteAssistantBuildBinding(payload, BINDING_SECRET)};
    let polls = 0;
    const {calls} = mountApi([
      runtimeConfigWithKnowledge,
      conversationSync,
      {match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks", json: {id: "task-b1", status: "running"}},
      {
        match: (call) => call.method === "GET" && call.path === "/api/frontmind/v2/tasks/task-b1",
        json: () => {
          polls += 1;
          return polls < 2 ? {id: "task-b1", status: "running"} : completedTask;
        },
      },
    ]);

    const response = await ask({question: "问一下企业服务", binding});
    vi.unstubAllEnvs();

    expect(response.status).toBe(200);
    expect(response.body.answer.text).toBe("FrontMind 提供品牌知识管理。");
    const taskCreate = calls.find((call) => call.path === "/api/frontmind/v2/tasks");
    expect(taskCreate?.body).toMatchObject({
      knowledgeBase: {snapshotId: payload.knowledgeSnapshotId, contentHash: "a".repeat(64)},
    });
    const sync = calls.find((call) => call.path === "/api/brand/conversations/sync");
    const dispatch = (sync?.body as {conversations: Array<{messages: Array<{generalChatDispatch: {knowledgeBase?: unknown}}>}>})
      .conversations[0]!.messages.at(-1)!.generalChatDispatch;
    expect(dispatch.knowledgeBase).toEqual({
      snapshotId: payload.knowledgeSnapshotId,
      contentHash: "a".repeat(64),
    });
  });

  it("rejects forged or unsupported bindings before any internal call", async () => {
    const payload = bindingPayloadFor("22222222-2222-4222-8222-222222222222", "a".repeat(64));
    const valid = {...payload, signature: signSiteAssistantBuildBinding(payload, BINDING_SECRET)};
    const forged = {
      ...payload,
      signature: signSiteAssistantBuildBinding(payload, "some-other-secret"),
    };

    // No secret configured on the API side: any binding is unsupported.
    const {calls} = mountApi([]);
    const first = await ask({question: "问一下", binding: valid});
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe("ASSISTANT_BINDING_UNSUPPORTED");
    expect(calls).toHaveLength(0);

    // With a secret configured, a forged signature is rejected outright.
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, BINDING_SECRET);
    const strict = mountApi([]);
    const second = await ask({question: "问一下", binding: forged});
    vi.unstubAllEnvs();
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("ASSISTANT_BINDING_INVALID");
  });

  it("starts a new conversation when the binding knowledge changes", async () => {
    vi.stubEnv(SITE_ASSISTANT_BINDING_SECRET_ENV, BINDING_SECRET);
    const firstPayload = bindingPayloadFor("22222222-2222-4222-8222-222222222222", "a".repeat(64));
    const secondPayload = bindingPayloadFor("33333333-3333-4333-8333-333333333333", "c".repeat(64));
    const firstBinding = {...firstPayload, signature: signSiteAssistantBuildBinding(firstPayload, BINDING_SECRET)};
    const secondBinding = {...secondPayload, signature: signSiteAssistantBuildBinding(secondPayload, BINDING_SECRET)};
    const {calls} = mountApi([
      runtimeConfigWithKnowledge,
      conversationSync,
      {match: (call) => call.method === "POST" && call.path === "/api/frontmind/v2/tasks", json: () => ({id: `task-${calls.length}`, status: "completed", output: assistantOutput})},
    ]);

    const first = await ask({question: "第一问", binding: firstBinding});
    expect(first.status).toBe(200);
    const second = await ask({question: "第二问", session: first.body.session, binding: secondBinding});
    vi.unstubAllEnvs();

    expect(second.status).toBe(200);
    expect(second.body.session).not.toBe(first.body.session);
    const conversations = calls
      .filter((call) => call.path === "/api/brand/conversations/sync")
      .map((call) => (call.body as {conversations: Array<{id: string}>}).conversations[0]!.id);
    expect(conversations).toHaveLength(2);
    expect(conversations[1]).not.toBe(conversations[0]);
  });
});
