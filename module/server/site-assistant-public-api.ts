import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

/**
 * Public AI assistant API for the published static website.
 *
 * Anonymous website visitors ask questions through the floating assistant
 * window. Every question is executed by the existing enterprise QA pipeline
 * (published knowledge snapshot + provider agent + answer contract) through
 * the module container's own authenticated internal routes, running as the
 * fixed module workspace. This router owns validation, CORS, rate limits and
 * multi-turn session mapping; it never exposes internal identifiers or
 * provider details to the public caller.
 */

export const SITE_ASSISTANT_API_PATH = "/api/public/site-assistant";

export type SiteAssistantPublicLimits = {
  questionMaxChars: number;
  perIpWindowMs: number;
  perIpMaxQuestions: number;
  globalWindowMs: number;
  globalMaxQuestions: number;
  sessionMaxTurns: number;
  sessionIdleMs: number;
  askDeadlineMs: number;
  pollIntervalMs: number;
};

export const SITE_ASSISTANT_DEFAULT_LIMITS: SiteAssistantPublicLimits = {
  questionMaxChars: 500,
  perIpWindowMs: 10 * 60_000,
  perIpMaxQuestions: 12,
  globalWindowMs: 60 * 60_000,
  globalMaxQuestions: 80,
  sessionMaxTurns: 30,
  sessionIdleMs: 2 * 60 * 60_000,
  askDeadlineMs: 150_000,
  pollIntervalMs: 1_500,
};

export type SiteAssistantPublicConfig = {
  /** Loopback base the module app listens on, e.g. http://127.0.0.1:3001. */
  selfOrigin: string;
  /** Public module origin used for gateway host/origin checks, e.g. https://brand.frontmind.cn. */
  publicOrigin: string;
  /** Module gateway secret injected on internal calls. */
  gatewaySecret: string;
  limits?: Partial<SiteAssistantPublicLimits>;
};

type InternalJsonFetch = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs?: number,
) => Promise<{ status: number; json: unknown }>;

export type SiteAssistantInternalClient = {
  /** Authenticated internal call into the module container's own HTTP routes. */
  json: InternalJsonFetch;
};

type AssistantSession = {
  token: string;
  conversationId: string;
  taskId: string | null;
  turns: number;
  lastSeenAt: number;
};

export type SiteAssistantAskErrorCode =
  | "ASSISTANT_QUESTION_INVALID"
  | "ASSISTANT_RATE_LIMITED"
  | "ASSISTANT_SESSION_TURNS_EXCEEDED"
  | "ASSISTANT_KNOWLEDGE_UNAVAILABLE"
  | "ASSISTANT_UNAVAILABLE"
  | "ASSISTANT_ANSWER_TIMEOUT"
  | "ASSISTANT_ANSWER_UNAVAILABLE";

const ASSISTANT_NAME = "AI 助手";
const ASSISTANT_GREETING = "你好，我是本站的 AI 助手，可以就网站内容向你解答。";
const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "cancelled",
  "error",
  "failed",
]);

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Prefer express-resolved `req.ip`: the app trusts exactly one proxy hop, so
 * this is the peer the gateway actually saw. A client-supplied
 * x-forwarded-for prefix is attacker-controlled and never used for limits.
 */
export function siteAssistantClientIp(request: Request): string {
  if (typeof request.ip === "string" && request.ip.trim()) return request.ip.trim();
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return "unknown";
}

function corsHeaders(response: Response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
}

function publicError(
  response: Response,
  status: number,
  code: SiteAssistantAskErrorCode,
  message: string,
  extra?: Record<string, unknown>,
) {
  response.status(status).json({
    schemaVersion: 1,
    error: { code, message },
    ...(extra ?? {}),
  });
}

type RateWindow = { hits: number[] };

function pruneWindow(window: RateWindow, now: number, windowMs: number) {
  window.hits = window.hits.filter((hit) => now - hit < windowMs);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function messageText(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value
    .map((item) =>
      item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : "",
    )
    .join("")
    .trim();
}

type AssistantAnswerMessage = {
  text: string;
  sources: Array<{ id: string; title: string; kind: string }>;
};

/** Extract the newest assistant answer with its server-validated citations. */
export function extractAssistantAnswer(task: unknown): AssistantAnswerMessage | null {
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  const record = task as {
    output?: unknown;
    status?: unknown;
  };
  if (record.status !== "completed" || !Array.isArray(record.output)) return null;
  for (let index = record.output.length - 1; index >= 0; index -= 1) {
    const message = record.output[index] as
      | {
          role?: unknown;
          content?: unknown;
          text?: unknown;
          enterprise_qa_answer?: unknown;
        }
      | null;
    if (!message || message.role !== "assistant") continue;
    const text = messageText(message.content) || (typeof message.text === "string" ? message.text.trim() : "");
    const meta = message.enterprise_qa_answer;
    const sources: AssistantAnswerMessage["sources"] = [];
    if (
      meta &&
      typeof meta === "object" &&
      Array.isArray((meta as { sources?: unknown }).sources)
    ) {
      for (const entry of (meta as { sources: unknown[] }).sources) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { title?: unknown }).title === "string"
        ) {
          sources.push({
            id: (entry as { id: string }).id,
            title: (entry as { title: string }).title,
            kind: String((entry as { kind?: unknown }).kind ?? "published_knowledge"),
          });
        }
      }
    }
    if (text) return { text, sources };
  }
  return null;
}

/**
 * Build the internal JSON client. node:http is used deliberately: the module
 * gateway validates the Host header, and fetch/undici silently drops custom
 * Host headers, which would make every internal call fail origin checks.
 */
export function createSiteAssistantInternalClient(
  config: SiteAssistantPublicConfig,
): SiteAssistantInternalClient {
  const self = new URL(config.selfOrigin);
  const publicHost = new URL(config.publicOrigin).host;
  const json: InternalJsonFetch = (method, path, body, timeoutMs = 30_000) =>
    new Promise((resolve, reject) => {
      const payload =
        body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
      const request = httpRequest(
        {
          hostname: self.hostname,
          port: self.port || 80,
          path,
          method,
          headers: {
            host: publicHost,
            origin: config.publicOrigin,
            "x-frontmind-module-gateway": config.gatewaySecret,
            ...(payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.byteLength),
                }
              : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = null;
            }
            resolve({ status: response.statusCode ?? 0, json: parsed });
          });
          response.on("error", reject);
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error("ASSISTANT_INTERNAL_TIMEOUT"));
      });
      request.on("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  return { json };
}

export type SiteAssistantRuntime = {
  config: () => Promise<
    | { status: "ok"; knowledgeBase: { version: number; documentCount: number; sourceFileName: string } | null }
    | { status: "unavailable" }
  >;
};

/** Read the module workspace's currently published knowledge base state. */
export function readSiteAssistantRuntime(
  client: SiteAssistantInternalClient,
): SiteAssistantRuntime {
  return {
    async config() {
      try {
        const response = await client.json(
          "GET",
          "/api/frontmind/v2/runtime-config?purpose=enterprise_qa",
        );
        if (response.status !== 200 || !response.json) return { status: "unavailable" };
        const knowledgeBase = (response.json as { knowledgeBase?: unknown })
          .knowledgeBase;
        if (
          !knowledgeBase ||
          typeof knowledgeBase !== "object" ||
          !Number.isInteger((knowledgeBase as { version?: unknown }).version)
        ) {
          return { status: "ok", knowledgeBase: null };
        }
        const value = knowledgeBase as {
          version: number;
          documentCount?: unknown;
          sourceFileName?: unknown;
        };
        return {
          status: "ok",
          knowledgeBase: {
            version: value.version,
            documentCount: Number(value.documentCount) || 0,
            sourceFileName:
              typeof value.sourceFileName === "string" ? value.sourceFileName : "",
          },
        };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

function pruneSessions(
  sessions: Map<string, AssistantSession>,
  now: number,
  idleMs: number,
) {
  for (const [token, session] of sessions) {
    if (now - session.lastSeenAt > idleMs) sessions.delete(token);
  }
}

export function createSiteAssistantPublicApi(
  config: SiteAssistantPublicConfig,
  options: {
    client?: SiteAssistantInternalClient;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Router {
  const limits: SiteAssistantPublicLimits = {
    ...SITE_ASSISTANT_DEFAULT_LIMITS,
    ...(config.limits ?? {}),
  };
  const client = options.client ?? createSiteAssistantInternalClient(config);
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const runtime = readSiteAssistantRuntime(client);
  const sessions = new Map<string, AssistantSession>();
  const perIpWindows = new Map<string, RateWindow>();
  const globalWindow: RateWindow = { hits: [] };
  const router = Router();

  router.options(/.*/, (_req, res) => {
    corsHeaders(res);
    res.status(204).end();
  });

  router.get("/config", async (_req, res) => {
    corsHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    const state = await runtime.config();
    if (state.status !== "ok") {
      return publicError(
        res,
        503,
        "ASSISTANT_UNAVAILABLE",
        "AI 助手暂时不可用，请稍后再试。",
      );
    }
    res.json({
      schemaVersion: 1,
      assistant: { name: ASSISTANT_NAME, greeting: ASSISTANT_GREETING },
      knowledgeBase: state.knowledgeBase,
    });
  });

  router.post("/ask", async (req, res) => {
    corsHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    const timestamp = now();

    const question =
      typeof (req.body as { question?: unknown } | undefined)?.question === "string"
        ? ((req.body as { question: string }).question ?? "").trim()
        : "";
    if (!question || question.length > limits.questionMaxChars) {
      return publicError(
        res,
        400,
        "ASSISTANT_QUESTION_INVALID",
        `请输入 1 到 ${limits.questionMaxChars} 字之间的问题。`,
      );
    }

    pruneSessions(sessions, timestamp, limits.sessionIdleMs);
    const ipHash = sha256(siteAssistantClientIp(req));
    const ipWindow = perIpWindows.get(ipHash) ?? { hits: [] };
    pruneWindow(ipWindow, timestamp, limits.perIpWindowMs);
    pruneWindow(globalWindow, timestamp, limits.globalWindowMs);
    if (
      ipWindow.hits.length >= limits.perIpMaxQuestions ||
      globalWindow.hits.length >= limits.globalMaxQuestions
    ) {
      return publicError(
        res,
        429,
        "ASSISTANT_RATE_LIMITED",
        "当前提问较为频繁，请稍作休息后再试。",
      );
    }

    const requestedSession =
      typeof (req.body as { session?: unknown } | undefined)?.session === "string"
        ? (req.body as { session: string }).session
        : "";
    let session = requestedSession
      ? sessions.get(requestedSession) ?? null
      : null;
    if (session && session.turns >= limits.sessionMaxTurns) {
      return publicError(
        res,
        429,
        "ASSISTANT_SESSION_TURNS_EXCEEDED",
        "本次会话提问次数已达上限，关闭窗口后可重新开始。",
      );
    }

    const knowledge = await runtime.config();
    if (knowledge.status !== "ok") {
      return publicError(
        res,
        503,
        "ASSISTANT_UNAVAILABLE",
        "AI 助手暂时不可用，请稍后再试。",
      );
    }
    if (!knowledge.knowledgeBase) {
      return publicError(
        res,
        503,
        "ASSISTANT_KNOWLEDGE_UNAVAILABLE",
        "本站尚未发布可用的知识库，AI 助手暂不能回答。",
      );
    }

    if (!session) {
      session = {
        token: randomUUID().replaceAll("-", ""),
        conversationId: `site-assistant-${randomUUID()}`,
        taskId: null,
        turns: 0,
        lastSeenAt: timestamp,
      };
      sessions.set(session.token, session);
    }
    session.lastSeenAt = timestamp;
    session.turns += 1;
    ipWindow.hits.push(timestamp);
    perIpWindows.set(ipHash, ipWindow);
    globalWindow.hits.push(timestamp);

    try {
      if (!session.taskId) {
        const sync = await client.json(
          "POST",
          "/api/brand/conversations/sync",
          {
            conversation: {
              id: session.conversationId,
              title: "官网 AI 助手",
              purpose: "enterprise_qa",
              messages: [],
              status: "idle",
              createdAt: Math.floor(timestamp / 1000),
              updatedAt: Math.floor(timestamp / 1000),
            },
          },
        );
        if (sync.status >= 400) {
          throw Object.assign(new Error("ASSISTANT_CONVERSATION_SYNC_FAILED"), {
            internalStatus: sync.status,
          });
        }
      }

      const clientRequestId = `site-assistant-${randomUUID()}`;
      const dispatch = session.taskId
        ? await client.json(
            "POST",
            `/api/frontmind/v2/tasks/${encodeURIComponent(session.taskId)}/messages`,
            {
              conversationId: session.conversationId,
              clientRequestId,
              prompt: question,
              localAssetIds: [],
            },
          )
        : await client.json("POST", "/api/frontmind/v2/tasks", {
            conversationId: session.conversationId,
            clientRequestId,
            prompt: question,
            modelProfile: "frontmind-pro",
            purpose: "enterprise_qa",
            localAssetIds: [],
          });
      if (dispatch.status >= 400 || !dispatch.json) {
        throw Object.assign(new Error("ASSISTANT_TASK_DISPATCH_FAILED"), {
          internalStatus: dispatch.status,
        });
      }
      const taskId =
        (dispatch.json as { id?: unknown }).id ??
        session.taskId ??
        "";
      if (typeof taskId !== "string" || !taskId) {
        throw new Error("ASSISTANT_TASK_ID_MISSING");
      }
      session.taskId = taskId;

      const deadline = timestamp + limits.askDeadlineMs;
      let task: unknown = dispatch.json;
      let status = (dispatch.json as { status?: unknown }).status;
      while (
        typeof status !== "string" ||
        !TERMINAL_TASK_STATUSES.has(status)
      ) {
        if (now() >= deadline) {
          return publicError(
            res,
            504,
            "ASSISTANT_ANSWER_TIMEOUT",
            "回答生成超时，请稍后重新提问。",
            { session: session.token },
          );
        }
        await wait(limits.pollIntervalMs);
        const poll = await client.json(
          "GET",
          `/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}`,
        );
        if (poll.status !== 200) {
          throw Object.assign(new Error("ASSISTANT_TASK_POLL_FAILED"), {
            internalStatus: poll.status,
          });
        }
        task = poll.json;
        status = (poll.json as { status?: unknown }).status;
      }

      if (status !== "completed") {
        return publicError(
          res,
          502,
          "ASSISTANT_ANSWER_UNAVAILABLE",
          "本次回答未能生成，请换个问法再试。",
          { session: session.token },
        );
      }
      const answer = extractAssistantAnswer(task);
      if (!answer) {
        return publicError(
          res,
          502,
          "ASSISTANT_ANSWER_UNAVAILABLE",
          "本次回答未能生成，请换个问法再试。",
          { session: session.token },
        );
      }
      res.json({
        schemaVersion: 1,
        session: session.token,
        answer: { text: answer.text, sources: answer.sources },
        knowledge: { version: knowledge.knowledgeBase.version },
      });
    } catch (error) {
      console.warn("[site-assistant] ask_failed", {
        code: error instanceof Error ? error.message : "UNKNOWN",
        internalStatus: (error as { internalStatus?: unknown }).internalStatus,
        ipHash,
        sessionTurns: session.turns,
      });
      return publicError(
        res,
        503,
        "ASSISTANT_UNAVAILABLE",
        "AI 助手暂时不可用，请稍后再试。",
        { session: session.token },
      );
    }
  });

  router.use((req, res) => {
    corsHeaders(res);
    res.status(404).json({
      schemaVersion: 1,
      error: { code: "ASSISTANT_ROUTE_NOT_FOUND", message: "接口不存在" },
    });
  });

  return router;
}
