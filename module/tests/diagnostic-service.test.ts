// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
const mock = vi.hoisted(() => ({
  ports: null as any,
  submits: [] as any[],
  wait: null as any,
  ready: true,
  stops: [] as string[],
}));
vi.mock("../server/intent-skill-runtime.js", () => ({
  intentSkillPorts: () => mock.ports,
  intentHash: (x: unknown) =>
    createHash("sha256").update(JSON.stringify(x)).digest("hex"),
}));
vi.mock("../server/knowledge-base-progress-service.js", () => ({
  assertKnowledgeBaseReadyForUpdate: async () => {
    if (!mock.ready) throw new Error("not ready");
  },
}));
vi.mock("../server/diagnostic-monitor.js", async (original) => {
  const real = await original<any>();
  return {
    ...real,
    diagnosticMonitorClient: () => ({
      configured: true,
      submit: async (a: any) => {
        mock.submits.push(a);
        return mock.wait ? await mock.wait : "supplier-" + a.consumerTaskId;
      },
      poll: async (a: any) => ({
        answer: "医学美容科回答",
        citations: [],
        references: [],
      }),
    }),
  };
});
vi.mock("drizzle-orm", () => {
  const get = (r: any, k: any) =>
    typeof k === "string" && k.includes(".")
      ? r[k.split(".")[0]]?.[k.split(".")[1]]
      : k;
  return {
    eq: (a: any, b: any) => (r: any) => get(r, a) === get(r, b),
    and:
      (...ps: any[]) =>
      (r: any) =>
        ps.every((p) => !p || p(r)),
    desc: (k: any) => k,
    sql: (strings: TemplateStringsArray, ...values: any[]) => {
      const pattern = strings.join("?");
      if (pattern.includes("CONCAT"))
        return (r: any) =>
          get(r, values[0]) === `brand-diagnostic:${get(r, values[1])}`;
      if (pattern.trim() === "? <=> ?")
        return (r: any) =>
          (get(r, values[0]) ?? null) === (get(r, values[1]) ?? null);
      if (pattern.includes(" IN ("))
        return (r: any) =>
          ["queued", "running", "attention_required", "cancelled"].includes(
            get(r, values[0]),
          );
      return { strings, values };
    },
  };
});
import {
  createDiagnosticService,
  startDiagnosticWorker,
} from "../server/diagnostic-service.js";
import { DiagnosticMonitorError } from "../server/diagnostic-monitor.js";
import { intentHash } from "../server/intent-skill-runtime.js";
import { DIAGNOSTIC_CATEGORIES } from "../contracts/diagnostics.js";
import { SEMANTIC_AUDIT_METRICS, SEMANTIC_AUDIT_DIMENSIONS } from "../contracts/semantic-audit.js";
const table = (name: string) =>
  new Proxy({ name } as any, {
    get: (target, key) => (key === "name" ? name : `${name}.${String(key)}`),
  });
class MemoryDb {
  data: Record<string, any[]> = { operations: [], tasks: [] };
  pending = Promise.resolve();
  select(projection?: any) {
    const db = this;
    let tableName = "",
      joined = "",
      join: any,
      where: any,
      limit = Infinity;
    return {
      from(t: any) {
        tableName = t.name;
        return this;
      },
      innerJoin(t: any, on: any) {
        joined = t.name;
        join = on;
        return this;
      },
      where(p: any) {
        where = p;
        return this;
      },
      orderBy() {
        return this;
      },
      limit(n: number) {
        limit = n;
        return this;
      },
      for() {
        return this;
      },
      then(resolve: any, reject: any) {
        try {
          let rows = db.data[tableName]!.flatMap((item) =>
            joined
              ? db.data[joined]!.map((other) => ({
                  [tableName]: item,
                  [joined]: other,
                }))
              : [{ [tableName]: item }],
          );
          if (join) rows = rows.filter(join);
          if (where) rows = rows.filter(where);
          rows = rows.slice(0, limit);
          return Promise.resolve(
            rows.map((row) =>
              !projection
                ? structuredClone(row[tableName])
                : Object.fromEntries(
                    Object.entries(projection).map(([k, v]: [string, any]) => [
                      k,
                      typeof v === "string"
                        ? row[v.split(".")[0]]?.[v.split(".")[1]]
                        : structuredClone(row[v.name]),
                    ]),
                  ),
            ),
          ).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
  }
  insert(t: any) {
    return {
      values: async (value: any) => {
        if (this.data[t.name]!.some((r) => r.id === value.id))
          throw new Error("duplicate id");
        this.data[t.name]!.push({
          createdAt: new Date(),
          updatedAt: new Date(),
          ...structuredClone(value),
        });
      },
    };
  }
  update(t: any) {
    return {
      set: (changes: any) => ({
        where: async (predicate: any) => {
          for (const row of this.data[t.name]!)
            if (predicate({ [t.name]: row }))
              Object.assign(row, structuredClone(changes));
        },
      }),
    };
  }
  async execute() {
    return [[]];
  }
  transaction<T>(work: (tx: MemoryDb) => Promise<T>): Promise<T> {
    const run = this.pending.then(() => work(this));
    this.pending = run.then(
      () => {},
      () => {},
    );
    return run;
  }
}

let db: MemoryDb;
const context = {
  accountUserId: 7,
  actorUserId: 7,
  enterpriseProjectId: "project-a",
  businessOwnerId: "7",
  businessActorId: "7",
};
const documents = [
  {
    path: "services.md",
    title: "科室服务",
    content: "医学美容科提供皮肤咨询，相关能力待核实。",
    evidenceStatus: "needs_verification",
  },
];
const service = (override = {}) =>
  createDiagnosticService(
    {
      database: async () => db as any,
      context: () => context,
      environment: { MOLI_API_TOKEN: "test" },
    },
    { ...context, ...override },
    { id: 7, role: "user" },
  );
const state = (id: string) =>
  db.data.tasks.find((t) => t.createMarker === `brand-diagnostic:${id}`)
    .providerRuntime.brandDiagnostic;
beforeEach(() => {
  db = new MemoryDb();
  mock.submits = [];
  mock.wait = null;
  mock.ready = true;
  mock.stops = [];
  db.execute = async (query?: any) => {
    const text = query?.strings.join(" ");
    if (text.includes("FROM knowledge_base_snapshots"))
      return [
        [
          {
            id: "snapshot-1",
            version: 1,
            sourceBuildId: "build-1",
            sourceConversationId: "conversation-1",
            documents,
          },
        ],
      ];
    if (text.includes("FROM knowledge_base_builds"))
      return [
        [
          {
            id: "build-1",
            conversationId: "conversation-1",
            companyName: "测试医院",
            status: "published",
            publishedSnapshotId: "snapshot-1",
            activeTurnId: null,
          },
        ],
      ];
    if (text.includes("FROM knowledge_base_build_nodes"))
      return [[{ leafId: "one", status: mock.ready ? "confirmed" : "draft" }]];
    return [[]];
  };
  mock.ports = {
    agentOperations: table("operations"),
    agentTasks: table("tasks"),
    assertActorAllowed: () => {},
    lockAccountRecord: async () => {},
    lockCustomerProjectBusinessWrite: async () => {},
    getDashboardWorkspace: async () => ({ payload: { brandName: "测试医院" } }),
    getEnterpriseProjectScope: () => ({ enterpriseProjectId: "project-a" }),
    getDecryptedCredentialForUser: async () => ({
      id: "credential",
      version: 1,
      provider: "xty_codex",
    }),
    createCredentialAgentClient: () => ({
      stopTask: async (id: string) => {
        mock.stops.push(id);
      },
      createTask: async () => ({ taskId: "model-task" }),
      listAllMessages: async () => [],
      taskDetail: async () => ({ status: "running" }),
    }),
  };
});
async function draft() {
  const s = service(),
    id = randomUUID();
  await s.create({ clientRequestId: id, subjectScope: "医学美容科" });
  return { s, id };
}
async function start() {
  const { s, id } = await draft();
  const r = state(id);
  r.questions = DIAGNOSTIC_CATEGORIES.map((category) => ({
    category,
    text: category + "问题原文",
    source: "custom",
    validation: {
      accepted: true,
      reason: "相关",
      inputHash: intentHash([
        r.basis.contentHash,
        r.subject,
        category,
        category + "问题原文",
      ]),
    },
  }));
  await s.start(id, { expectedRevision: r.revision });
  return { s, id };
}
describe("durable Brand diagnostic lifecycle", () => {
  async function collected(legacy = true) {
    const { s, id } = await start();
    const r = state(id);
    if (legacy) delete r.requiredAuditVersion;
    r.phase = "completed";
    for (const a of r.attempts) {
      a.status = "completed";
      a.taskId = "supplier-" + a.id;
      a.sample = { id: a.id, category: a.category, question: a.question, platform: a.platform, run: a.run, answer: "医学美容科提供皮肤咨询。", citations: [] };
    }
    for (const c of DIAGNOSTIC_CATEGORIES) r.results[c] = { assessment: { category: c, topics: [], answers: [], ...(c === "product_scenario" ? { knowledgeCoverage: [] } : {}) }, algorithm: "brand_diagnostics_v2" };
    return { s, id };
  }
  it("removes internal execution details without losing business activity", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    const view = await s.observe(id);
    expect(view.activity.recommendation?.status).toBe("queued");
    expect(view).not.toHaveProperty("jobs");
    expect(view).not.toHaveProperty("events");
    expect(view).not.toHaveProperty("updatedAt");
    expect(state(id).events).toEqual([]);
  });
  it("only explicitly upgrades old results and reuses all sixty supplier tasks", async () => {
    const { s, id } = await collected();
    const original = JSON.stringify(state(id).attempts);
    await s.observe(id); await s.tick(id);
    expect(state(id).jobs).toHaveLength(0);
    await Promise.all([s.semanticAudits(id, {}), s.semanticAudits(id, {})]);
    expect(state(id).jobs).toHaveLength(4);
    expect(state(id).jobs.every((j: any) => j.kind === "audit" && j.input.samples.length === 15)).toBe(true);
    await service().tick(id);
    expect(state(id).jobs[0].status).toBe("running");
    expect(JSON.stringify(state(id).attempts)).toBe(original);
    expect(mock.submits).toHaveLength(0);
    expect(state(id).phase).toBe("completed");
    await expect(service({ enterpriseProjectId: "other" }).semanticAudits(id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("automatically schedules audits for new tasks and does not mark them complete early", async () => {
    const { s, id } = await collected(false);
    state(id).phase = "analyzing";
    await s.tick(id);
    expect(state(id).jobs).toHaveLength(4);
    expect(state(id).phase).toBe("analyzing");
    expect(mock.submits).toHaveLength(0);
  });
  it("completes all four validated audits through the worker while preserving original classifications", async () => {
    const { s, id } = await collected(false);
    state(id).phase = "analyzing";
    const originalResults = JSON.stringify(state(id).results);
    const originalAnswers = JSON.stringify(state(id).attempts);
    mock.ports.orderManusV2EventsByProviderRank = (events: any[]) => events;
    mock.ports.classifyManusV2StructuredResultEnvelope = (value: unknown) => ({ kind: "accepted", value });
    mock.ports.createCredentialAgentClient = (_credential: unknown, options: any) => ({
      createTask: async () => {
        expect(options.modelPolicy).toBe("brand_diagnostics_v1");
        db.data.tasks.find((t) => t.id === options.localTaskId).providerRuntime.xtyCodex = { model: "gpt-6.1-sol", modelPolicy: options.modelPolicy };
        return { taskId: options.localTaskId };
      },
      listAllMessages: async () => {
        const job = state(id).jobs.find((j: any) => j.id === options.operationId);
        return [{ id: "output", type: "structured_output_result", structured_output_result: {
          category: job.category,
          checkedSampleIds: job.input.samples.map((_: unknown, i: number) => `A${i}`),
          metrics: SEMANTIC_AUDIT_METRICS.filter((m) => m.id !== "sample_coverage").map((m) => ({ id: m.id, status: "insufficient", value: null, explanation: "已有证据不足", satisfied: "", limitations: "未有相关基准", knowledgeRefs: [], answerRefs: [] })),
          findings: SEMANTIC_AUDIT_DIMENSIONS.map((d) => ({ dimension: d.id, text: "当前证据不足，未生成数值判断" })),
        } }];
      },
    });
    for (let step = 0; step < 10; step++) await service().tick(id);
    expect(state(id).phase).toBe("completed");
    expect(Object.keys(state(id).audits)).toHaveLength(4);
    expect(state(id).jobs.every((j: any) => j.status === "completed")).toBe(true);
    expect(JSON.stringify(state(id).results)).toBe(originalResults);
    expect(JSON.stringify(state(id).attempts)).toBe(originalAnswers);
    expect(mock.submits).toHaveLength(0);
  });
  it("retries only a failed audit using its frozen input and can stop a legacy upgrade", async () => {
    const { s, id } = await collected();
    await s.semanticAudits(id, { categories: ["reputation"] });
    const job = state(id).jobs[0];
    const frozen = JSON.stringify(job.input);
    job.status = "failed";
    state(id).results.reputation.assessment.topics.push({ topic: "later value must not change frozen retry" });
    await s.retry(id);
    expect(state(id).jobs).toHaveLength(2);
    expect(JSON.stringify(state(id).jobs[1].input)).toBe(frozen);
    expect(state(id).jobs[1].inputHash).toBe(job.inputHash);
    await s.stop(id);
    expect(state(id).phase).toBe("stopped");
    expect(state(id).jobs[1].status).toBe("cancelled");
    await service().tick(id);
    expect(mock.submits).toHaveLength(0);
  });
  it("starts the model timeout when execution begins, excluding time spent queued", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    state(id).jobs[0].createdAt = new Date(
      Date.now() - 2 * 60 * 60_000,
    ).toISOString();
    await s.tick(id);
    const job = state(id).jobs[0];
    expect(Date.now() - Date.parse(job.startedAt)).toBeLessThan(10_000);
    db.data.tasks.find((t) => t.id === job.taskId).providerRuntime.xtyCodex = {
      model: "gpt-6.1-sol",
      modelPolicy: "brand_diagnostics_v1",
    };
    mock.ports.orderManusV2EventsByProviderRank = (events: unknown[]) => events;
    mock.ports.latestManusV2TaskState = () => "running";
    await s.tick(id);
    expect(state(id).jobs[0].status).toBe("running");
  });
  it("does not rewrite an idle ledger and still executes a newly requested model task", async () => {
    const { s, id } = await draft();
    const writes = vi.spyOn(db, "update");
    await s.tick(id);
    expect(writes).not.toHaveBeenCalled();
    state(id).phase = "partial";
    await s.tick(id);
    expect(writes).not.toHaveBeenCalled();
    await s.recommend(id);
    writes.mockClear();
    await s.tick(id);
    expect(writes).toHaveBeenCalled();
    expect(state(id).jobs[0].status).toBe("running");
    await s.stop(id);
    writes.mockClear();
    await s.tick(id);
    expect(writes).not.toHaveBeenCalled();
  });
  it("does not rewrite a waiting model ledger or poll it again after a service restart until due", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    await s.tick(id);
    const job = state(id).jobs[0];
    db.data.tasks.find((t) => t.id === job.taskId).providerRuntime.xtyCodex = {
      model: "gpt-6.1-sol", modelPolicy: "brand_diagnostics_v1",
    };
    mock.ports.orderManusV2EventsByProviderRank = (events: unknown[]) => events;
    mock.ports.latestManusV2TaskState = () => "running";
    await s.tick(id);
    expect(state(id).jobs[0].nextPollAt).toBeGreaterThan(Date.now());
    const writes = vi.spyOn(db, "update");
    await service().tick(id);
    expect(writes).not.toHaveBeenCalled();
    state(id).jobs[0].nextPollAt = 0;
    await service().tick(id);
    expect(writes).toHaveBeenCalled();
    expect(state(id).jobs[0].status).toBe("running");
  });
  it("does not repeat a completed model step when earlier attempts failed or the skill changed", async () => {
    const { s, id } = await start();
    const r = state(id);
    r.jobs = [
      {
        id: "failed-old",
        kind: "assess",
        category: "reputation",
        status: "failed",
        inputHash: "older-skill",
      },
      {
        id: "completed-new",
        kind: "assess",
        category: "reputation",
        status: "completed",
        inputHash: "previous-skill",
      },
    ];
    r.results.reputation = { assessment: { category: "reputation" } };
    await s.retry(id);
    expect(state(id).jobs).toHaveLength(2);
    state(id).phase = "completed";
    const before = state(id).revision;
    await s.retry(id);
    expect(state(id).jobs).toHaveLength(2);
    expect(state(id).revision).toBe(before);
    expect(mock.submits).toHaveLength(0);
  });

  it("reassesses an incomplete coverage contract using saved answers without another collection", async () => {
    const { s, id } = await start();
    const r = state(id);
    for (const a of r.attempts) {
      a.status = "completed";
      a.taskId = "supplier-" + a.id;
      a.sample = {
        id: a.id,
        category: a.category,
        platform: a.platform,
        run: a.run,
        question: a.question,
        answer: "已保存原始回答",
        citations: [],
        references: [],
      };
    }
    r.results.product_scenario = {
      assessment: { category: "product_scenario", topics: [], answers: [] },
    };
    const ids = r.attempts.map((a: any) => a.taskId);
    await s.retry(id);
    expect(state(id).results.product_scenario).toBeUndefined();
    const job = state(id).jobs.find(
      (j: any) => j.kind === "assess" && j.category === "product_scenario",
    );
    expect(job.input.samples).toHaveLength(15);
    expect(state(id).attempts.map((a: any) => a.taskId)).toEqual(ids);
    expect(mock.submits).toHaveLength(0);
  });
  it("background polling restores ownership using the actual three-argument Core contract", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    const restore = vi.fn(
      async (
        owner: number,
        project: string | null,
        action: () => Promise<void>,
      ) => {
        expect(owner).toBe(context.accountUserId);
        expect(project).toBe(context.enterpriseProjectId);
        await action();
      },
    );
    mock.ports.runWithStoredEnterpriseProjectScope = restore;
    vi.useFakeTimers();
    try {
      startDiagnosticWorker({
        database: async () => db as any,
        context: () => context,
        environment: { MOLI_API_TOKEN: "test" },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(state(id).jobs[0].status).toBe("running");
      expect(state(id).jobs[0].providerTaskId).toBe("model-task");
      expect(mock.submits).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it("records an observed fallback even if that model request later fails", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    await s.tick(id);
    const job = state(id).jobs[0];
    db.data.tasks.find((t) => t.id === job.taskId).providerRuntime.xtyCodex = {
      model: "gpt-6.1-sol",
      modelPolicy: "brand_diagnostics_v1",
      modelFallbacks: [{ model: "gpt-5.6-sol", effort: "high", at: 1234 }],
    };
    mock.ports.orderManusV2EventsByProviderRank = () => [];
    mock.ports.latestManusV2TaskState = () => "failed";
    await s.tick(id);
    expect(state(id).jobs[0]).toMatchObject({
      status: "failed",
      model: "gpt-5.6-sol",
      fallback: true,
      modelFallbacks: [{ model: "gpt-5.6-sol", effort: "high", at: 1234 }],
    });
    expect(mock.submits).toHaveLength(0);
  });
  it("requires node confirmation and preserves unverified facts and enterprise isolation", async () => {
    mock.ready = false;
    await expect(draft()).rejects.toMatchObject({
      code: "KNOWLEDGE_NOT_READY",
    });
    mock.ready = true;
    const { s, id } = await draft();
    expect((await s.documents(id))[0].evidenceStatus).toBe(
      "needs_verification",
    );
    await expect(
      service({ enterpriseProjectId: "project-b" }).observe(id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service({ enterpriseProjectId: "project-b" }).answer(id, "sample"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("freezes exactly 60 slots and reuses duplicate starts and server restarts", async () => {
    const { s, id } = await start();
    const ids = state(id).attempts.map((a: any) => a.id);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    await s.start(id, { expectedRevision: 0 });
    await s.tick(id);
    await service().tick(id);
    expect(state(id).attempts.map((a: any) => a.id)).toEqual(ids);
    expect(mock.submits).toHaveLength(6);
    expect(new Set(mock.submits.map((a) => a.consumerTaskId)).size).toBe(6);
    expect(
      (await s.observe(id)).attempts.every(
        (a) => !("taskId" in a) && !("sample" in a),
      ),
    ).toBe(true);
  });
  it("never resubmits a collection whose acknowledgement is unknown", async () => {
    const { s, id } = await start();
    mock.wait = Promise.reject(
      new DiagnosticMonitorError("MONITOR_NETWORK", "timeout", true),
    );
    await s.tick(id);
    expect(
      state(id).attempts.filter((a: any) => a.status === "submission_unknown"),
    ).toHaveLength(3);
    const first = mock.submits.map((a) => a.consumerTaskId);
    mock.wait = null;
    await service().tick(id);
    expect(
      mock.submits.slice(3).every((a) => !first.includes(a.consumerTaskId)),
    ).toBe(true);
  });
  it("persists a late supplier acknowledgement after stop, then reads it without another paid request", async () => {
    const { s, id } = await start();
    let resolve!: (v: string) => void;
    mock.wait = new Promise((r) => {
      resolve = r;
    });
    const pending = s.tick(id);
    for (let i = 0; i < 20 && !mock.submits.length; i++)
      await new Promise((r) => setTimeout(r, 1));
    await s.stop(id);
    resolve("supplier-original");
    await pending;
    expect(mock.submits).toHaveLength(1);
    expect(state(id).phase).toBe("stopped");
    expect(state(id).attempts[0].taskId).toBe("supplier-original");
    state(id).attempts[0].nextPollAt = 0;
    await service().tick(id);
    expect(state(id).attempts[0].status).toBe("completed");
    expect(mock.submits).toHaveLength(1);
  });
  it("caches recommendations independently of question draft changes and invalidates edits", async () => {
    const { s, id } = await draft();
    await s.recommend(id);
    state(id).jobs[0].status = "completed";
    const r = state(id);
    await s.save(id, {
      expectedRevision: r.revision,
      questions: [
        {
          category: "industry_ranking",
          text: "本地皮肤咨询机构有哪些推荐？",
          source: "custom",
        },
      ],
      platforms: r.platforms,
    });
    await s.recommend(id);
    expect(state(id).jobs).toHaveLength(1);
    expect(state(id).questions[0].validation).toBeUndefined();
  });
  it("refuses stale knowledge before collection and keeps frozen knowledge after starting", async () => {
    const { s, id } = await draft();
    state(id).basis.snapshotId = "older";
    await expect(
      s.start(id, { expectedRevision: state(id).revision }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_CHANGED" });
    const started = await start();
    mock.ready = false;
    await started.s.tick(started.id);
    expect(mock.submits).toHaveLength(3);
  });
  it("retries only a failed diagnosis and leaves saved answers unchanged", async () => {
    const { s, id } = await start();
    const r = state(id);
    for (const a of r.attempts) {
      a.status = "completed";
      a.sample = {
        id: a.id,
        category: a.category,
        question: a.question,
        platform: a.platform,
        run: a.run,
        answer: "原始回答",
        citations: [],
      };
    }
    await s.tick(id);
    expect(state(id).jobs).toHaveLength(4);
    state(id).jobs[0].status = "failed";
    await s.retry(id);
    expect(state(id).jobs).toHaveLength(5);
    await s.tick(id);
    expect(mock.submits).toHaveLength(0);
    expect(
      state(id).attempts.every((a: any) => a.sample.answer === "原始回答"),
    ).toBe(true);
    expect(state(id).phase).not.toBe("completed");
  });
});
