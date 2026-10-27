// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { assembleResponseLogicCore } from "../server/response-logic-runtime";
import { registerIntentSkillPorts, prepareIntentSkill } from "../server/intent-skill-runtime";
import { createResponseLogicCredentialMiddleware } from "../server/response-logic-credential-middleware";
import type { ModuleHttpCore } from "../server/http-api";

/**
 * Core's factory selects the provider BY CREDENTIAL: credential.provider ===
 * "xty_codex" ⇒ XtyCodexDashboardAgentProvider (Core credential-agent-client
 * first branch). These tests therefore assert the equivalent dispatch target:
 * the credential that reaches the Core factory is the xty_codex service
 * identity handle, and non-XTY credentials are rejected outright whenever an
 * XTY provider mode is requested.
 */

// Mirrors Core's synthetic XTY service identity (xty-agent-credential.ts).
const xtyHandle = {
  id: "xty-" + "a".repeat(32),
  userId: 42,
  version: 0,
  apiKey: "service:xty_codex:no-customer-key",
  fingerprint: "f" .repeat(32),
  status: "active" as const,
  verifiedAt: new Date(),
  agentProfile: "frontmind-pro",
  provider: "xty_codex",
  upstreamModel: "gpt-5.6-sol",
  upstreamEffort: "high" as const,
  credentialRef: "credential:xty-1",
};
const zhipuHandle = {
  id: "cred-zhipu-1",
  userId: 42,
  version: 3,
  apiKey: "sk-zhipu",
  fingerprint: "z".repeat(32),
  status: "active" as const,
  verifiedAt: new Date(),
  agentProfile: "manus-profile",
  provider: "zhipu",
  upstreamModel: "glm-5.3",
  upstreamEffort: "high" as const,
  credentialRef: "credential:zhipu-1",
};

const XTY_ENV = { FRONTMIND_MODULE_PROVIDER_MODE: "xty_openai_agents" };
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["FRONTMIND_MODULE_PROVIDER_MODE", "FRONTMIND_AGENT_PROVIDER_MODE"]) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function xtyMode(on: boolean) {
  if (on) process.env.FRONTMIND_MODULE_PROVIDER_MODE = "xty_openai_agents";
  else delete process.env.FRONTMIND_MODULE_PROVIDER_MODE;
  return process.env;
}

describe("response-logic runtime client factory under XTY provider mode", () => {
  it("forwards the xty service identity to the Core factory (builder, judge and optimizer share this mapping)", () => {
    const factory = vi.fn(() => ({ __client: true }));
    registerIntentSkillPorts({
      currentEnterpriseProjectId: () => null,
      lockCustomerProjectBusinessWrite: async () => {},
      getDecryptedCredentialForUser: async () => null,
      createCredentialAgentClient: factory,
    } as never);
    const runtime = assembleResponseLogicCore({
      getDb: async () => null as never,
      environment: { ...XTY_ENV },
    });
    const client = runtime.createCredentialAgentClient(xtyHandle as never, { accountUserId: 42 });
    expect((client as { __client: boolean }).__client).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][0]).toMatchObject({
      provider: "xty_codex",
      upstreamModel: "gpt-5.6-sol",
      upstreamEffort: "high",
      version: 0,
    });
    expect(factory.mock.calls[0][1]).toMatchObject({ accountUserId: 42 });
  });

  it("rejects a non-XTY credential explicitly instead of dispatching through zhipu", () => {
    const factory = vi.fn();
    registerIntentSkillPorts({
      currentEnterpriseProjectId: () => null,
      lockCustomerProjectBusinessWrite: async () => {},
      getDecryptedCredentialForUser: async () => null,
      createCredentialAgentClient: factory,
    } as never);
    const runtime = assembleResponseLogicCore({
      getDb: async () => null as never,
      environment: { FRONTMIND_AGENT_PROVIDER_MODE: "xty_openai_agents" },
    });
    expect(() => runtime.createCredentialAgentClient(zhipuHandle as never)).toThrowError(
      /XTY 模型运行器/,
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it("keeps legacy pass-through behavior when no XTY mode is requested", () => {
    const factory = vi.fn(() => ({ __client: true }));
    registerIntentSkillPorts({
      currentEnterpriseProjectId: () => null,
      lockCustomerProjectBusinessWrite: async () => {},
      getDecryptedCredentialForUser: async () => null,
      createCredentialAgentClient: factory,
    } as never);
    const runtime = assembleResponseLogicCore({
      getDb: async () => null as never,
      environment: {},
    });
    expect(() => runtime.createCredentialAgentClient(zhipuHandle as never)).not.toThrow();
    expect(factory).toHaveBeenCalledWith(zhipuHandle, undefined);
  });

  it("never applies the zhipu model whitelist to the XTY identity", () => {
    const factory = vi.fn(() => ({ __client: true }));
    registerIntentSkillPorts({
      currentEnterpriseProjectId: () => null,
      lockCustomerProjectBusinessWrite: async () => {},
      getDecryptedCredentialForUser: async () => null,
      createCredentialAgentClient: factory,
    } as never);
    const runtime = assembleResponseLogicCore({
      getDb: async () => null as never,
      environment: { ...XTY_ENV },
    });
    // gpt-5.6-sol is not in the zhipu whitelist (glm-5.3 family); the runtime
    // must pass it through untouched — model selection is the XTY provider's
    // contract (credential.upstreamModel), not Brand's.
    expect(() => runtime.createCredentialAgentClient(xtyHandle as never)).not.toThrow();
    expect(factory.mock.calls[0][0].upstreamModel).toBe("gpt-5.6-sol");
  });
});

describe("intent workbench skill preparation under XTY provider mode", () => {
  function registerIntentPorts(credential: unknown) {
    registerIntentSkillPorts({
      assertServiceCapability: async () => {},
      getApiCredentialStatus: async () => ({
        status: "active", verifiedAt: new Date(), version: (credential as {version: number}).version,
      }),
      getDecryptedCredentialForUser: async () => credential,
    } as never);
  }

  it("prepares the optimize-intent skill against the xty service identity", async () => {
    xtyMode(true);
    registerIntentPorts(xtyHandle);
    const prepared = await prepareIntentSkill(42);
    expect(prepared.credential).toMatchObject({ provider: "xty_codex", upstreamModel: "gpt-5.6-sol" });
  });

  it("fails explicitly when the resolved credential is not the XTY identity", async () => {
    xtyMode(true);
    registerIntentPorts(zhipuHandle);
    await expect(prepareIntentSkill(42)).rejects.toThrowError(/XTY 模型运行器/);
  });

  it("keeps the legacy credential path when no XTY mode is requested", async () => {
    xtyMode(false);
    registerIntentPorts(zhipuHandle);
    const prepared = await prepareIntentSkill(42);
    expect(prepared.credential).toMatchObject({ provider: "zhipu" });
  });
});

describe("server-side credential middleware for module requests", () => {
  const moduleCore: ModuleHttpCore = {
    context: () => ({
      accountUserId: 42, actorUserId: 42, enterpriseProjectId: null,
      businessOwnerId: "42", businessActorId: "42",
    }),
    database: async () => null as never,
    environment: {},
  };

  function run(ports: unknown, attachExisting = false) {
    registerIntentSkillPorts(ports as never);
    const middleware = createResponseLogicCredentialMiddleware(moduleCore);
    const request = { frontmindUser: { id: 42 } } as Request & { frontmindCredential?: unknown };
    if (attachExisting) request.frontmindCredential = zhipuHandle;
    let statusCode = 0;
    let body: unknown;
    let nextCalled = false;
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(payload: unknown) { body = payload; resolveDone(); return this; },
    } as unknown as Response;
    middleware(request, response, (() => { nextCalled = true; resolveDone(); }) as NextFunction);
    return {
      request,
      done,
      get status() { return statusCode; },
      get body() { return body; },
      get nextCalled() { return nextCalled; },
    };
  }

  it("attaches the server-resolved XTY credential when the mount provides none", async () => {
    xtyMode(true);
    const fetchCredential = vi.fn(async () => xtyHandle);
    const outcome = run({ getDecryptedCredentialForUser: fetchCredential });
    await outcome.done;
    expect(outcome.nextCalled).toBe(true);
    expect(outcome.request.frontmindCredential).toMatchObject({
      provider: "xty_codex",
      credentialRef: "credential:xty-1",
    });
    expect(fetchCredential).toHaveBeenCalledWith(42);
  });

  it("leaves an existing attached credential untouched", async () => {
    const fetchCredential = vi.fn(async () => xtyHandle);
    const outcome = run({ getDecryptedCredentialForUser: fetchCredential }, true);
    await outcome.done;
    expect(outcome.request.frontmindCredential).toBe(zhipuHandle);
    expect(fetchCredential).not.toHaveBeenCalled();
  });

  it("answers 503 with the XTY sentinel when the runner is not configured", async () => {
    xtyMode(true);
    const outcome = run({
      getDecryptedCredentialForUser: async () => { throw new Error("XTY_AGENT_NOT_CONFIGURED"); },
    });
    await outcome.done;
    expect(outcome.nextCalled).toBe(false);
    expect(outcome.status).toBe(503);
    expect((outcome.body as { error: { code: string } }).error.code).toBe("XTY_AGENT_NOT_CONFIGURED");
  });

  it("continues without a credential on ordinary resolution failures (401 gates answer)", async () => {
    const outcome = run({
      getDecryptedCredentialForUser: async () => { throw new Error("database down"); },
    });
    await outcome.done;
    expect(outcome.nextCalled).toBe(true);
    expect(outcome.request.frontmindCredential).toBeUndefined();
  });

  it("continues without a credential when none is configured", async () => {
    const outcome = run({ getDecryptedCredentialForUser: async () => null });
    await outcome.done;
    expect(outcome.nextCalled).toBe(true);
    expect(outcome.request.frontmindCredential).toBeUndefined();
  });
});
