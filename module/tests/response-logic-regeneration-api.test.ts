// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import express from "express";
import http from "node:http";
import {once} from "node:events";
import {createResponseLogicApi} from "../server/response-logic-api";
const servers: http.Server[] = [];
afterEach(async () => {await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));});
async function harness() {
  const record: any = {id: "r1", questionId: "q1", groupId: "g1", groupTitle: "品牌意图", question: "如何选择？", intent: "选型", summary: "", conversationId: "c1", revision: 3, version: 1,
    confirmed: {version: 1, conclusion: "已发布内容"}, lastTaskId: "original", appliedModelResult: {taskId: "original", resultId: "original-result"},
    draft: {concern: "旧关注点", conclusion: "旧结论", facts: "旧依据", boundaries: "旧边界", pending: "", references: "", attachments: [], images: []}, createdAt: 1, updatedAt: 1};
  const candidate = {concern: "新关注点", conclusion: "新结论", facts: "新依据", boundaries: "新边界"};
  const tasks = new Map<string, {id: string; status: string; output: unknown; prompt: string}>();
  const owned = new Set<string>();
  const control = {authenticated: true, project: "p1", readOnlyLookup: true, changeDuringUpload: false};
  const credential = {id: "credential", version: 1, credentialRef: "test", agentProfile: "frontmind-pro"};
  const events = (task: typeof tasks extends Map<string, infer T> ? T : never) => [
    {id: "operation", type: "user_message", timestamp: 1000, operationToken: "current"},
    ...(task.output ? [{id: "result", type: "structured_output_result", timestamp: 2000, structured_output_result: {success: true, value: task.output}}] : []),
    {id: "state", type: "status_update", timestamp: 3000, status_update: {agent_status: task.status}},
  ];
  class UnusedError extends Error {}
  const core: any = {
    enterpriseWorkspaceUserId: (id: number) => id, getEnterpriseProjectScope: () => ({enterpriseProjectId: control.project}),
    assertServiceCapability: async () => {}, ServiceEntitlementError: UnusedError, sendAiBillingError: () => false,
    getDashboardQuestion: async () => ({questionId: "q1", groupId: "g1", groupTitle: "品牌意图", question: record.question, intent: record.intent, summary: "", writeScope: {revision: 1, contractId: "contract", quotaPeriodId: "period"}}),
    getResponseLogicEntry: async () => structuredClone(record), credentialForRequest: () => credential,
    getFrontMindCredentials: () => ({credentialRef: "test"}), getUpstreamBaseUrl: () => "http://unused",
    getLatestKnowledgeSnapshot: async () => null, getDb: async () => ({}),
    getCredentialForUpstreamResource: async (_user: number, _kind: string, id: string) => owned.has(id) ? credential : null,
    recordUpstreamResource: vi.fn(async (input: any) => {if (input.kind === "task") owned.add(input.upstreamId);}),
    recordResponseLogicTaskStart: vi.fn(), requireResponseLogicProviderReadiness: vi.fn(async () => ({recordRevision: 3})), adoptResponseLogicModelResult: vi.fn(),
    buildDeterministicTaskAttachmentArchive: async (input: any) => ({bytes: Buffer.from(JSON.stringify(input)), contentHash: "a".repeat(64)}),
    toUpstreamAgentProfile: (value: string) => value, assertUpstreamPromptBudget: (value: string) => value,
    redactSensitivePayload: (value: unknown) => value, redactSensitiveText: (value: string) => value,
    latestManusV2TaskState: (list: any[]) => [...list].reverse().find(e => e.type === "status_update")?.status_update.agent_status ?? null,
    orderManusV2EventsByProviderRank: (list: any[], direction: string) => direction === "oldest_first" ? [...list] : [...list].reverse(),
    manusV2EventOperationToken: (event: any) => event.operationToken,
    classifyManusV2StructuredResultEnvelope: (value: any) => value?.success === true ? {kind: "accepted", value: value.value} : {kind: "rejected"},
    ResponseLogicConfirmedError: UnusedError, ResponseLogicTaskActiveError: UnusedError, ResponseLogicProviderReadinessError: UnusedError,
    ResponseLogicTaskSupersededError: UnusedError, ResponseLogicRevisionConflictError: UnusedError, ResponseLogicPublicationRequestConflictError: UnusedError,
    ResponseLogicResultAdoptionError: UnusedError, ManusV2ApiError: UnusedError, safeErrorForLog: (e: any) => ({message: e.message}),
    createCredentialAgentClient: (_credential: any, options: any) => ({
      findCreatedTaskReadOnly: control.readOnlyLookup ? async () => ({unique: tasks.get(options.intentId) ?? null}) : undefined,
      uploadFile: async () => {if (control.changeDuringUpload) record.revision++; return {fileId: "file", detail: {expiresAt: 1900000000}};},
      createTask: async ({prompt}: {prompt: string}) => {
        if (!tasks.has(options.intentId)) tasks.set(options.intentId, {id: `candidate-${tasks.size}`, status: "running", output: null, prompt});
        return {taskId: tasks.get(options.intentId)!.id, raw: {}};
      },
      listAllMessages: async ({taskId}: {taskId: string}) => {const task = [...tasks.values()].find(t => t.id === taskId); return task ? events(task) : [];},
    }),
  };
  const app = express(); app.use(express.json()); app.use((req: any, _res, next) => {if (control.authenticated) req.frontmindUser = {id: 7}; next();});
  app.use("/api/response-logic", createResponseLogicApi(core).router);
  const server = http.createServer(app); servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/response-logic/regeneration`;
  const start = (body: any = {}) => fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({questionId: "q1", expectedRevision: 3, ...body})});
  const status = (id: string, attempt = 0) => fetch(`${url}/tasks/${id}/status?questionId=q1&expectedRevision=3&attempt=${attempt}`);
  return {record, candidate, tasks, core, control, owned, start, status, recover: () => fetch(`${url}/recovery?questionId=q1&expectedRevision=3`)};
}
describe("regeneration uses the real generation builder without writing the draft", () => {
  it("deduplicates starts, restores read-only, validates four sections and preserves published/current data", async () => {
    const h = await harness(), before = structuredClone(h.record);
    const [a, b] = await Promise.all([h.start(), h.start()]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    const first = await a.json(); expect((await b.json()).taskId).toBe(first.taskId);
    expect(h.tasks.size).toBe(1); expect(h.record).toEqual(before);
    expect(h.core.recordResponseLogicTaskStart).not.toHaveBeenCalled();
    expect(h.core.requireResponseLogicProviderReadiness).toHaveBeenCalledWith(expect.objectContaining({candidateOnly: true, taskId: "original", expectedOperationRevision: 3}));
    const task = [...h.tasks.values()][0]; task.status = "stopped"; task.output = h.candidate;
    expect(await (await h.status(first.taskId)).json()).toMatchObject({status: "completed", structuredDraft: h.candidate, recordRevision: 3});
    const bindings = h.core.recordUpstreamResource.mock.calls.length;
    expect(await (await h.recover()).json()).toMatchObject({status: "found", taskId: first.taskId, attempt: 0});
    expect(h.core.recordUpstreamResource.mock.calls).toHaveLength(bindings);
    expect(h.record).toEqual(before); expect(h.core.adoptResponseLogicModelResult).not.toHaveBeenCalled();
  });
  it("never creates a retry for a running task; retries a failed candidate only once", async () => {
    const h = await harness(); const first = await (await h.start()).json();
    const retry = {retry: {taskId: first.taskId, attempt: 0}};
    expect((await h.start(retry)).status).toBe(409);
    const task = [...h.tasks.values()][0]; task.status = "stopped"; task.output = {concern: "missing fields"};
    expect((await h.status(first.taskId)).status).toBe(422);
    const next = await (await h.start(retry)).json();
    expect(next.attempt).toBe(1); expect((await (await h.start(retry)).json()).taskId).toBe(next.taskId);
    expect(h.tasks.size).toBe(2);
  });
  it("rejects cross-project tasks, stale revisions, invalid bodies and unauthenticated callers", async () => {
    const h = await harness(); const first = await (await h.start()).json();
    expect(first.taskId).toBeTruthy();
    expect((await h.status("foreign")).status).toBe(403);
    h.control.project = "p2"; expect((await h.status(first.taskId)).status).toBe(403);
    h.record.revision++; expect((await h.status(first.taskId)).status).toBe(409);
    expect((await h.start({draft: {conclusion: "overwrite"}})).status).toBe(400);
    h.control.authenticated = false; expect((await h.start()).status).toBe(401);
    expect(h.tasks.size).toBe(1);
  });
  it("fails closed on unavailable lookup and a draft edit during input upload", async () => {
    const h = await harness(); h.control.readOnlyLookup = false;
    expect((await h.start()).status).toBe(503); expect(h.tasks.size).toBe(0);
    h.control.readOnlyLookup = true; h.control.changeDuringUpload = true;
    expect((await h.start()).status).toBe(409); expect(h.tasks.size).toBe(0);
  });
});
