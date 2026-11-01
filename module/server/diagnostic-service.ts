import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import { intentHash, intentSkillPorts } from "./intent-skill-runtime.js";
import { assertKnowledgeBaseReadyForUpdate } from "./knowledge-base-progress-service.js";
import { diagnosticEvidenceCatalog } from "./diagnostic-evidence.js";
import {
  diagnosticMonitorClient,
  DiagnosticMonitorError,
} from "./diagnostic-monitor.js";
import {
  validateAssessment,
  validateRecommendations,
  validateQuestionDecisions,
  diagnosticMetrics,
  diagnosticBreakdown,
} from "./diagnostic-results.js";
import {
  DIAGNOSTIC_CATEGORIES,
  latestDiagnosticJobs,
  DIAGNOSTIC_LABELS,
  DIAGNOSTIC_PLATFORMS,
  DIAGNOSTIC_MODEL_POLICY,
  questionSchema,
  recommendationSchema,
  validationSchema,
  assessmentSchema,
  type DiagnosticRun,
  type DiagnosticRunView,
  type DiagnosticJob,
  type DiagnosticAttempt,
  type KnowledgeBasis,
  type KnowledgeReadiness,
  type DiagnosticCategory,
} from "../contracts/diagnostics.js";

const OP = "brand_diagnostic_v1";
const MODEL_OP = "brand_diagnostic_model_v1";
const ROOT = "brandDiagnostic";
const now = () => new Date().toISOString();
const uuid = z.string().uuid();
const rows = (r: any): any[] => (Array.isArray(r?.[0]) ? r[0] : []);
const obj = (v: any): any => (typeof v === "string" ? JSON.parse(v) : v);
type Context = ReturnType<ModuleHttpCore["context"]>;
type Actor = { id: number; role: string };
export class DiagnosticError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
function event(
  r: DiagnosticRun,
  message: string,
  category?: DiagnosticCategory,
) {
  r.events.push({ id: randomUUID(), at: now(), message, category });
}
const qHash = (r: DiagnosticRun, q: { category: string; text: string }) =>
  intentHash([r.basis.contentHash, r.subject, q.category, q.text]);
export function diagnosticView(r: DiagnosticRun): DiagnosticRunView {
  const { basis, attempts, jobs, lease: _, ...rest } = r;
  const { documents: __, ...basisMeta } = basis;
  return {
    ...rest,
    basis: basisMeta,
    attempts: attempts.map(({ sample, taskId, ...a }) => ({
      ...a,
      hasAnswer: !!sample,
    })),
    jobs: jobs.map(
      ({
        input,
        lease,
        providerTaskId,
        baselineEventIds,
        repairPrompt,
        repairPending,
        ...j
      }) => j,
    ),
    expectedSamples: attempts.length || r.platforms.length * 20,
    completedSamples: attempts.filter((a) => a.status === "completed").length,
  };
}
export function createDiagnosticService(
  core: ModuleHttpCore,
  context: Context,
  actor: Actor,
) {
  const model = intentSkillPorts();
  const scope = and(
    eq(model.agentOperations.operationType, OP),
    eq(model.agentOperations.accountUserId, context.accountUserId),
    sql`${model.agentOperations.enterpriseProjectId} <=> ${context.enterpriseProjectId}`,
  );
  async function find(id: string, db?: any) {
    return (
      await (db ?? (await core.database()))
        .select({ operation: model.agentOperations, task: model.agentTasks })
        .from(model.agentOperations)
        .innerJoin(
          model.agentTasks,
          and(
            eq(model.agentTasks.operationId, model.agentOperations.id),
            sql`${model.agentTasks.createMarker}=CONCAT('brand-diagnostic:',${model.agentOperations.id})`,
          ),
        )
        .where(and(scope, eq(model.agentOperations.id, uuid.parse(id))))
        .limit(1)
    )[0];
  }
  const state = (o: any): DiagnosticRun => o.task.providerRuntime[ROOT];
  async function owned(id: string) {
    const o = await find(id);
    if (!o)
      throw new DiagnosticError("NOT_FOUND", "诊断任务不存在或无权访问", 404);
    return o;
  }
  async function mutate<T>(
    id: string,
    fn: (r: DiagnosticRun, tx: any) => Promise<T> | T,
    owner?: string,
  ) {
    const db = await core.database();
    return db.transaction(async (tx: any) => {
      const o = await find(id, tx);
      if (!o) throw new DiagnosticError("NOT_FOUND", "诊断任务不存在", 404);
      const [task] = await tx
        .select()
        .from(model.agentTasks)
        .where(eq(model.agentTasks.id, o.task.id))
        .limit(1)
        .for("update");
      const r: DiagnosticRun = task.providerRuntime[ROOT];
      if (owner && (r.lease?.owner !== owner || r.lease.until < Date.now()))
        throw new DiagnosticError("LEASE_CHANGED", "任务正在其他执行器处理");
      const storedBefore = JSON.stringify(r);
      const before = intentHash({ ...r, lease: undefined });
      const result = await fn(r, tx);
      // An idle poll must not rewrite the full answer/knowledge ledger.
      if (JSON.stringify(r) === storedBefore) return result;
      if (intentHash({ ...r, lease: undefined }) !== before) {
        r.revision++;
        r.updatedAt = now();
      }
      await tx
        .update(model.agentTasks)
        .set({
          providerRuntime: { ...task.providerRuntime, [ROOT]: r },
          providerState: r.phase,
          updatedAt: new Date(),
        })
        .where(eq(model.agentTasks.id, task.id));
      await tx
        .update(model.agentOperations)
        .set({
          status:
            r.phase === "completed"
              ? "succeeded"
              : r.phase === "stopped"
                ? "cancelled"
                : r.phase === "partial"
                  ? "attention_required"
                  : "running",
          updatedAt: new Date(),
        })
        .where(eq(model.agentOperations.id, id));
      return result;
    });
  }
  function allowWrite() {
    if (actor.id !== context.actorUserId)
      throw new DiagnosticError("FORBIDDEN", "无权修改企业诊断", 403);
    model.assertActorAllowed(actor);
  }
  async function knowledge(): Promise<{
    readiness: KnowledgeReadiness;
    basis?: KnowledgeBasis;
  }> {
    const db = await core.database();
    const owner = sql`userId=${context.accountUserId} AND enterpriseProjectId <=> ${context.enterpriseProjectId}`;
    const snapshot = rows(
      await db.execute(
        sql`SELECT id,version,sourceBuildId,sourceConversationId,documents FROM knowledge_base_snapshots WHERE ${owner} AND status='active' ORDER BY version DESC LIMIT 1`,
      ),
    )[0];
    const build = rows(
      await db.execute(
        sql`SELECT id,conversationId,companyName,status,publishedSnapshotId,activeTurnId,content_version AS contentVersion FROM knowledge_base_builds WHERE ${owner} AND (execution_mode IS NULL OR execution_mode<>'reset_retired') ORDER BY updatedAt DESC LIMIT 1`,
      ),
    )[0];
    const nodes = build
      ? rows(
          await db.execute(
            sql`SELECT leafId,status FROM knowledge_base_build_nodes WHERE buildId=${build.id}`,
          ),
        )
      : [];
    const confirmed = nodes.filter((n) =>
      ["confirmed", "direct_prefilled"].includes(n.status),
    ).length;
    const profile = await model.getDashboardWorkspace(context.accountUserId);
    const companyName = String(
      build?.companyName ?? profile?.payload?.brandName ?? "",
    );
    const readiness: KnowledgeReadiness = {
      ready: false,
      status: !build ? "missing" : "confirming",
      message: !build
        ? "请先构建知识库并逐项确认"
        : `知识库已确认 ${confirmed}/${nodes.length} 项`,
      confirmed,
      total: nodes.length,
      companyName,
      snapshotId: snapshot?.id ?? null,
      version: snapshot?.version ?? null,
      conversationId: build?.conversationId ?? null,
    };
    if (
      !build ||
      !nodes.length ||
      confirmed !== nodes.length ||
      build.activeTurnId
    )
      return { readiness };
    try {
      await assertKnowledgeBaseReadyForUpdate({
        userId: context.accountUserId,
        conversationId: build.conversationId,
        expectedBuildId: build.id,
      });
    } catch {
      return { readiness };
    }
    if (
      !snapshot ||
      snapshot.sourceBuildId !== build.id ||
      build.publishedSnapshotId !== snapshot.id ||
      build.status !== "published"
    )
      return {
        readiness: {
          ...readiness,
          status: "publishing",
          message: "节点已确认，正在等待当前知识版本发布",
        },
      };
    const documents = (obj(snapshot.documents) as KnowledgeBasis["documents"])
      .filter((d) => typeof d.content === "string" && d.content.trim())
      .map((d) => ({
        path: d.path,
        title: d.title,
        content: d.content,
        evidenceStatus: d.evidenceStatus,
      }));
    if (!documents.length)
      return {
        readiness: { ...readiness, message: "已发布知识版本缺少可引用正文" },
      };
    return {
      readiness: {
        ...readiness,
        ready: true,
        status: "ready",
        message: "全部节点已确认，知识版本已发布",
      },
      basis: {
        snapshotId: snapshot.id,
        version: snapshot.version,
        buildId: build.id,
        conversationId: build.conversationId,
        companyName,
        contentHash: intentHash(documents),
        documents,
      },
    };
  }
  async function list() {
    return (
      await (
        await core.database()
      )
        .select({ operation: model.agentOperations, task: model.agentTasks })
        .from(model.agentOperations)
        .innerJoin(
          model.agentTasks,
          and(
            eq(model.agentTasks.operationId, model.agentOperations.id),
            sql`${model.agentTasks.createMarker}=CONCAT('brand-diagnostic:',${model.agentOperations.id})`,
          ),
        )
        .where(scope)
        .orderBy(desc(model.agentOperations.createdAt))
        .limit(30)
    ).map(state);
  }
  async function workspace() {
    const [k, runs] = await Promise.all([knowledge(), list()]);
    return {
      knowledge: k.readiness,
      platforms: DIAGNOSTIC_PLATFORMS,
      repeatPerPlatform: 5 as const,
      model: "gpt-6.1-sol" as const,
      fallbackModel: "gpt-5.6-sol" as const,
      runs: runs.map(({ id, subject, phase, createdAt }) => ({
        id,
        subject,
        phase,
        createdAt,
      })),
    };
  }
  async function credential() {
    const c = await model.getDecryptedCredentialForUser(context.accountUserId);
    if (!c || c.provider !== "xty_codex")
      throw new DiagnosticError(
        "MODEL_UNAVAILABLE",
        "诊断需要已配置的 XTY 模型服务",
        503,
      );
    return c;
  }
  async function create(value: unknown) {
    allowWrite();
    const input = z
      .object({
        clientRequestId: uuid,
        subjectScope: z.string().trim().max(120).default(""),
      })
      .strict()
      .parse(value);
    const existing = await find(input.clientRequestId);
    if (existing) {
      if (state(existing).subjectScope !== input.subjectScope)
        throw new DiagnosticError(
          "IDEMPOTENCY_CONFLICT",
          "请求已用于其他诊断主体",
        );
      return diagnosticView(state(existing));
    }
    const k = await knowledge();
    if (!k.basis)
      throw new DiagnosticError("KNOWLEDGE_NOT_READY", k.readiness.message);
    const c = await credential();
    const r: DiagnosticRun = {
      id: input.clientRequestId,
      version: 1,
      revision: 0,
      phase: "draft",
      subject: input.subjectScope
        ? `${k.basis.companyName}（${input.subjectScope}）`
        : k.basis.companyName,
      subjectScope: input.subjectScope,
      basis: k.basis,
      questions: [],
      platforms: DIAGNOSTIC_PLATFORMS.map((p) => p.id),
      recommendations: [],
      jobs: [],
      attempts: [],
      results: {},
      events: [],
      createdAt: now(),
      updatedAt: now(),
    };
    event(r, `已绑定逐项确认后的知识库版本 ${r.basis.version}`);
    const db = await core.database();
    await db.transaction(async (tx: any) => {
      await model.lockAccountRecord(tx, context.accountUserId);
      await model.lockCustomerProjectBusinessWrite(
        tx,
        context.accountUserId,
        actor,
      );
      if (await find(r.id, tx)) return;
      await tx.insert(model.agentOperations).values({
        id: r.id,
        enterpriseProjectId: context.enterpriseProjectId,
        provider: "xty_codex",
        scope: "managed_user",
        accountUserId: context.accountUserId,
        presalesProjectId: null,
        operationType: OP,
        idempotencyKeyHash: intentHash([
          OP,
          context.accountUserId,
          context.enterpriseProjectId,
          r.id,
        ]),
        requestHash: intentHash([r.basis.contentHash, r.subject]),
        contractName: OP,
        contractRevision: 1,
        schemaHash: intentHash(OP),
        apiCredentialId: c.id,
        credentialVersion: c.version,
        publicProfile: "brand-diagnostics",
        upstreamModel: "gpt-6.1-sol",
        status: "queued",
      });
      await tx.insert(model.agentTasks).values({
        id: randomUUID(),
        operationId: r.id,
        createMarker: `brand-diagnostic:${r.id}`,
        title: `AI 语义诊断 · ${r.subject}`,
        providerState: "draft",
        providerRuntime: {
          [ROOT]: r,
          diagnosticContext: context,
          diagnosticActor: actor,
          executionScope: model.getEnterpriseProjectScope(),
        },
      });
    });
    return diagnosticView(state(await owned(r.id)));
  }
  async function assertCurrentBasis(r: DiagnosticRun) {
    const k = await knowledge();
    if (
      !k.basis ||
      k.basis.snapshotId !== r.basis.snapshotId ||
      k.basis.contentHash !== r.basis.contentHash
    )
      throw new DiagnosticError(
        "KNOWLEDGE_CHANGED",
        "知识版本已变化，请使用已确认的新版本建立诊断",
      );
  }
  async function save(id: string, value: unknown) {
    allowWrite();
    const input = z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        questions: z.array(questionSchema).max(4),
        platforms: z
          .array(z.enum(["doubao", "yuanbao", "qianwen"]))
          .min(1)
          .max(3),
      })
      .strict()
      .parse(value);
    await assertCurrentBasis(state(await owned(id)));
    if (
      new Set(input.questions.map((q) => q.category)).size !==
        input.questions.length ||
      new Set(input.platforms).size !== input.platforms.length
    )
      throw new DiagnosticError("DUPLICATE", "类别或平台重复");
    await mutate(id, (r) => {
      if (r.phase === "stopped" || r.confirmedAt)
        throw new DiagnosticError("FROZEN", "本轮配置已经冻结或停止");
      if (r.revision !== input.expectedRevision)
        throw new DiagnosticError("REVISION_CHANGED", "草稿已更新，请重新读取");
      r.questions = input.questions.map((q) => {
        const previous = r.questions.find(
          (x) => x.category === q.category && x.text === q.text,
        );
        const recommended =
          q.source === "recommended" &&
          r.recommendations.some(
            (x) => x.category === q.category && x.text === q.text,
          );
        return {
          ...q,
          ...(previous?.validation
            ? { validation: previous.validation }
            : recommended
              ? {
                  validation: {
                    accepted: true,
                    reason: "已根据当前知识版本推荐",
                    inputHash: qHash(r, q),
                  },
                }
              : {}),
        };
      });
      r.platforms = input.platforms;
    });
    return diagnosticView(state(await owned(id)));
  }
  async function addJob(
    id: string,
    kind: DiagnosticJob["kind"],
    category?: DiagnosticCategory,
  ) {
    const c = await credential();
    const skill = await readFile(
      new URL("../workflows/brand-diagnostics/SKILL.md", import.meta.url),
      "utf8",
    );
    return mutate(id, async (r, tx) => {
      if (r.phase === "stopped")
        throw new DiagnosticError("STOPPED", "本轮已停止");
      const selected =
        kind === "recommend"
          ? []
          : (category
              ? r.questions.filter((q) => q.category === category)
              : r.questions
            ).map(({ category, text, source }) => ({ category, text, source }));
      const samples = category
        ? r.attempts
            .filter((a) => a.category === category)
            .flatMap((a) => (a.sample ? [a.sample] : []))
        : [];
      const input = {
        kind,
        diagnosisId: id,
        subject: r.subject,
        subjectScope: r.subjectScope,
        knowledge: r.basis,
        questions: selected,
        samples,
        skill,
      };
      const inputHash = intentHash(input);
      const prior = r.jobs.find(
        (j) =>
          j.kind === kind &&
          j.category === category &&
          j.inputHash === inputHash &&
          !["failed", "cancelled"].includes(j.status),
      );
      if (prior) return prior.id;
      const job: DiagnosticJob = {
        id: randomUUID(),
        taskId: randomUUID(),
        kind,
        category,
        inputHash,
        status: "queued",
        input,
        model: "gpt-6.1-sol",
        fallback: false,
        repairCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      r.jobs.push(job);
      await tx.insert(model.agentOperations).values({
        id: job.id,
        enterpriseProjectId: context.enterpriseProjectId,
        provider: "xty_codex",
        scope: "managed_user",
        accountUserId: context.accountUserId,
        presalesProjectId: null,
        operationType: MODEL_OP,
        idempotencyKeyHash: intentHash([MODEL_OP, job.id]),
        requestHash: inputHash,
        contractName: MODEL_OP,
        contractRevision: 1,
        schemaHash: intentHash(schemaFor(kind)),
        apiCredentialId: c.id,
        credentialVersion: c.version,
        publicProfile: "brand-diagnostics",
        upstreamModel: "gpt-6.1-sol",
        status: "queued",
      });
      await tx.insert(model.agentTasks).values({
        id: job.taskId,
        operationId: job.id,
        createMarker: `brand-diagnostic-model:${job.id}`,
        title: `${DIAGNOSTIC_LABELS[category!] ?? "诊断问题"} · ${kind}`,
        providerState: "queued",
        providerRuntime: { diagnosticJob: { parentId: id, inputHash } },
      });
      event(
        r,
        kind === "recommend"
          ? "正在根据已确认知识推荐四类问题"
          : kind === "validate"
            ? "正在校验所选问题"
            : "开始结构化诊断",
        category,
      );
      return job.id;
    });
  }
  async function recommend(id: string) {
    allowWrite();
    const r = state(await owned(id));
    if (r.confirmedAt) throw new DiagnosticError("FROZEN", "本轮配置已冻结");
    await assertCurrentBasis(r);
    await addJob(id, "recommend");
    return observe(id);
  }
  async function validate(id: string) {
    allowWrite();
    const r = state(await owned(id));
    if (r.confirmedAt || !r.questions.length)
      throw new DiagnosticError("INVALID_STATE", "请先填写待校验问题");
    await assertCurrentBasis(r);
    await addJob(id, "validate");
    return observe(id);
  }
  async function start(id: string, value: unknown) {
    allowWrite();
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(value);
    const before = state(await owned(id));
    if (before.confirmedAt) return diagnosticView(before);
    await assertCurrentBasis(before);
    if (!diagnosticMonitorClient(core.environment).configured)
      throw new DiagnosticError(
        "MONITOR_UNAVAILABLE",
        "真实采集服务尚未配置",
        503,
      );
    await mutate(id, (r) => {
      if (r.confirmedAt) return;
      if (r.phase === "stopped")
        throw new DiagnosticError("STOPPED", "本轮已停止");
      if (r.revision !== input.expectedRevision)
        throw new DiagnosticError("REVISION_CHANGED", "配置已变化，请重新读取");
      if (
        r.questions.length !== 4 ||
        DIAGNOSTIC_CATEGORIES.some(
          (c) =>
            !r.questions.some(
              (q) =>
                q.category === c &&
                q.validation?.accepted &&
                q.validation.inputHash === qHash(r, q),
            ),
        )
      )
        throw new DiagnosticError(
          "QUESTIONS_NOT_READY",
          "请为四类各选择一个通过校验的问题",
        );
      if (new Set(r.questions.map((q) => q.text.trim())).size !== 4)
        throw new DiagnosticError("DUPLICATE_QUESTION", "四类问题不能重复");
      r.confirmedAt = now();
      r.phase = "collecting";
      r.attempts = r.questions.flatMap((q) =>
        r.platforms.flatMap((platform) =>
          Array.from({ length: 5 }, (_, i) => ({
            id: `fm${intentHash([OP, r.id, q.category, q.text, platform, i]).slice(0, 60)}`,
            category: q.category,
            question: q.text,
            platform,
            run: i + 1,
            status: "queued" as const,
          })),
        ),
      );
      event(r, `诊断范围已确认，开始采集 ${r.attempts.length} 份真实回答`);
    });
    return observe(id);
  }
  async function observe(id: string) {
    return diagnosticView(state(await owned(id)));
  }
  async function answer(id: string, sampleId: string) {
    const r = state(await owned(id));
    const a = r.attempts.find((a) => a.id === sampleId);
    if (!a?.sample)
      throw new DiagnosticError("ANSWER_NOT_READY", "该条回答尚未就绪", 404);
    return a.sample;
  }
  async function documents(id: string) {
    return state(await owned(id)).basis.documents;
  }
  async function stop(id: string) {
    allowWrite();
    await mutate(id, (r) => {
      if (r.phase === "completed") return;
      r.phase = "stopped";
      event(r, "已停止提交后续任务，保留已取得的回答与诊断");
    });
    const r = state(await owned(id));
    for (const j of r.jobs.filter((j) =>
      ["running", "submitting", "queued"].includes(j.status),
    )) {
      {
        const client = await jobClient(j);
        await client.stopTask?.(j.providerTaskId ?? j.taskId).catch(() => {});
      }
      await mutate(id, (r) => {
        const current = r.jobs.find((x) => x.id === j.id)!;
        current.status = "cancelled";
      });
    }
    return observe(id);
  }
  async function retry(id: string) {
    allowWrite();
    const r = state(await owned(id));
    if (r.phase === "stopped")
      throw new DiagnosticError(
        "STOPPED",
        "已停止的任务不会自动重启，请新建诊断",
      );
    const refreshCoverage =
      !!r.results.product_scenario &&
      !Array.isArray(
        (r.results.product_scenario.assessment as any).knowledgeCoverage,
      );
    if (r.phase === "completed" && !refreshCoverage) return observe(id);
    if (refreshCoverage) await addJob(id, "assess", "product_scenario");
    await mutate(id, (r) => {
      if (refreshCoverage) {
        delete r.results.product_scenario;
        event(
          r,
          "复用原有回答，按逐要点逐回答合同重新核对产品覆盖指标",
          "product_scenario",
        );
      }
      for (const a of r.attempts)
        if (
          a.status === "failed" &&
          a.taskId &&
          a.error?.startsWith("采集查询")
        ) {
          a.status = "submitted";
          delete a.error;
        }
      if (r.confirmedAt) r.phase = "collecting";
      event(r, "恢复未完成诊断，已取得的采集回答继续复用");
    });
    for (const j of latestDiagnosticJobs(r.jobs).filter(
      (j) => j.status === "failed",
    )) {
      const satisfied =
        j.kind === "assess"
          ? !!r.results[j.category!]
          : j.kind === "recommend"
            ? r.recommendations.length > 0
            : r.questions.length === 4 &&
              r.questions.every((q) => q.validation?.inputHash === qHash(r, q));
      if (!satisfied) await addJob(id, j.kind, j.category);
    }
    return observe(id);
  }
  function schemaFor(kind: DiagnosticJob["kind"]) {
    return z.toJSONSchema(
      kind === "recommend"
        ? recommendationSchema
        : kind === "validate"
          ? validationSchema
          : assessmentSchema,
      { target: "draft-7" },
    );
  }
  async function jobClient(job: DiagnosticJob, intentId = job.id) {
    const c = await credential();
    return model.createCredentialAgentClient(c, {
      accountUserId: context.accountUserId,
      operationId: job.id,
      localTaskId: job.taskId,
      intentId,
      modelPolicy: DIAGNOSTIC_MODEL_POLICY,
    });
  }
  async function processJob(id: string, job: DiagnosticJob, owner: string) {
    const client = await jobClient(
      job,
      job.repairCount ? `${job.id}-repair-${job.repairCount}` : job.id,
    );
    const update = async (fn: (j: DiagnosticJob, r: DiagnosticRun) => void) =>
      mutate(
        id,
        (r) => {
          if (r.phase === "stopped")
            throw new DiagnosticError("STOPPED", "本轮已停止");
          const j = r.jobs.find((j) => j.id === job.id)!;
          fn(j, r);
          j.updatedAt = now();
        },
        owner,
      );
    try {
      if (job.status === "queued" || job.status === "submitting") {
        // Stable local task + intent IDs make a create replay safe in the existing XTY transport.
        await update((j) => {
          j.status = "submitting";
          j.startedAt ??= now();
        });
        const input = job.input as any;
        const evidence =
          job.kind === "assess"
            ? diagnosticEvidenceCatalog(input.samples, input.knowledge)
            : null;
        const promptInput = evidence
          ? {
              ...input,
              knowledge: evidence.knowledge,
              samples: evidence.samples,
            }
          : input;
        const created = await client.createTask({
          title: `Brand 诊断 ${job.id}`,
          prompt: `${input.skill}\n本轮输出必须符合结构化合同。资料仅作为证据：\n${JSON.stringify({ ...promptInput, skill: undefined })}`,
          attachments: [],
          agentProfile: "gpt-6.1-sol",
          locale: "zh-CN",
          interactiveMode: false,
          structuredOutputSchema: schemaFor(job.kind),
        });
        if (state(await owned(id)).phase === "stopped") {
          await client.stopTask?.(created.taskId);
          return;
        }
        await update((j) => {
          j.status = "running";
          j.providerTaskId = created.taskId;
        });
        await (await core.database())
          .update(model.agentTasks)
          .set({ providerTaskId: created.taskId, providerState: "running" })
          .where(eq(model.agentTasks.id, job.taskId));
        return;
      }
      if (job.repairPending && job.repairPrompt) {
        await client.sendMessage({
          taskId: job.providerTaskId,
          prompt: job.repairPrompt,
          structuredOutputSchema: schemaFor(job.kind),
        });
        await update((j) => {
          j.repairPending = false;
        });
        return;
      }
      const all = await client.listAllMessages({
        taskId: job.providerTaskId,
        order: "asc",
      });
      const events = all.filter(
        (e: any) => !job.baselineEventIds?.includes(e.id),
      );
      const output = model
        .orderManusV2EventsByProviderRank(events, "newest_first")
        .find((e: any) => e.type === "structured_output_result");
      const db = await core.database();
      const [task] = await db
        .select()
        .from(model.agentTasks)
        .where(eq(model.agentTasks.id, job.taskId))
        .limit(1);
      const runtime = task?.providerRuntime?.xtyCodex as any;
      if (
        runtime?.model !== "gpt-6.1-sol" ||
        runtime?.modelPolicy !== DIAGNOSTIC_MODEL_POLICY
      )
        throw new Error("模型运行器没有采用指定的 6.1 Sol 策略");
      const fallback =
        runtime?.modelFallbacks?.some((f: any) => f.model === "gpt-5.6-sol") ??
        false;
      if (fallback && !job.fallback) {
        await update((j, r) => {
          j.fallback = true;
          j.model = "gpt-5.6-sol";
          j.modelFallbacks = runtime.modelFallbacks
            .filter((f: any) => f.model === "gpt-5.6-sol")
            .map((f: any) => ({ model: f.model, effort: f.effort, at: f.at }));
          event(
            r,
            "本环节已接续备用 5.6 Sol，原有采集与已完成操作继续复用",
            job.category,
          );
        });
      }
      if (output) {
        try {
          const envelope = model.classifyManusV2StructuredResultEnvelope(
            output.structured_output_result,
          );
          if (envelope.kind !== "accepted")
            throw new Error("模型输出未通过结构校验");
          const frozen = job.input as any;
          const current = state(await owned(id));
          let result: any;
          if (job.kind === "recommend")
            result = validateRecommendations(envelope.value, current.basis);
          else if (job.kind === "validate")
            result = validateQuestionDecisions(
              envelope.value,
              frozen.questions,
              current.basis,
            );
          else
            result = validateAssessment(
              envelope.value,
              job.category!,
              frozen.samples,
              current.basis,
            );
          await update((j, r) => {
            j.status = "completed";
            j.fallback = fallback;
            j.model = fallback ? "gpt-5.6-sol" : "gpt-6.1-sol";
            if (job.kind === "recommend") r.recommendations = result;
            else if (job.kind === "validate")
              for (const d of result) {
                const q = r.questions.find(
                  (q) => q.category === d.category && q.text === d.text,
                );
                if (q)
                  q.validation = {
                    accepted: d.accepted,
                    reason: d.reason,
                    inputHash: qHash(r, q),
                  };
              }
            else
              r.results[job.category!] = {
                assessment: result,
                metrics: diagnosticMetrics(result),
                breakdown: diagnosticBreakdown(
                  result,
                  frozen.samples,
                  r.subject,
                ),
                samples: frozen.samples.length,
                generatedAt: now(),
                model: j.model,
                fallback,
                algorithm:
                  job.category === "product_scenario"
                    ? "brand_diagnostics_v2"
                    : DIAGNOSTIC_MODEL_POLICY,
              };
            event(
              r,
              `${job.kind === "recommend" ? "问题推荐" : job.kind === "validate" ? "问题校验" : "结构化诊断"}已完成${fallback ? "，本环节使用备用 5.6 Sol" : ""}`,
              job.category,
            );
          });
          await db
            .update(model.agentOperations)
            .set({ status: "succeeded" })
            .where(eq(model.agentOperations.id, job.id));
          return;
        } catch (e) {
          if (job.repairCount >= 1) throw e;
          const reason = e instanceof Error ? e.message : "结构校验未通过";
          await update((j, r) => {
            j.repairCount = 1;
            j.baselineEventIds = all.map((e: any) => e.id);
            j.repairPending = true;
            j.repairPrompt = `原输入保持不变。上次输出未通过服务端校验：${reason.slice(0, 6000)}。请修正并直接返回完整 JSON，禁止生成文件。`;
            event(
              r,
              "诊断结果需要修正证据或字段，正在使用原输入修订",
              job.category,
            );
          });
          return;
        }
      }
      const status =
        model.latestManusV2TaskState(events) ??
        (await client.taskDetail(job.providerTaskId)).status;
      if (["failed", "error", "cancelled", "stopped"].includes(status))
        throw new Error("模型任务未完成，可恢复本环节");
      if (["completed", "succeeded", "done"].includes(status))
        throw new Error("模型已结束但没有有效结构化结果");
      if (Date.now() - Date.parse(job.startedAt ?? job.updatedAt) > 30 * 60_000)
        throw new Error("模型任务超过处理时限，已有采集已保留");
    } catch (e) {
      if (
        e instanceof DiagnosticError &&
        ["STOPPED", "LEASE_CHANGED"].includes(e.code)
      )
        return;
      if (
        (["queued", "submitting"].includes(job.status) || job.repairPending) &&
        Date.now() - Date.parse(job.updatedAt) < 120_000 &&
        (e as any)?.outcomeUnknown
      ) {
        await update((j) => {
          j.status = job.repairPending ? "running" : "submitting";
          j.error = "模型提交结果待确认，正在核对原任务";
        });
        return;
      }
      await update((j, r) => {
        j.status = "failed";
        j.error =
          e instanceof Error ? e.message.slice(0, 1800) : "模型服务暂不可用";
        event(
          r,
          `${job.kind === "assess" ? "诊断" : "问题处理"}未完成：${j.error}`,
          job.category,
        );
      });
    }
  }
  async function processAttempt(
    id: string,
    a: DiagnosticAttempt,
    owner: string,
  ) {
    const monitor = diagnosticMonitorClient(core.environment);
    const attempt = {
      consumerTaskId: a.id,
      question: a.question,
      platform: a.platform,
      run: a.run,
      status: a.status as any,
      taskId: a.taskId,
      submittedAt: a.submittedAt,
    };
    const update = async (
      fn: (a: DiagnosticAttempt, r: DiagnosticRun) => void,
    ) =>
      mutate(
        id,
        (r) => {
          fn(r.attempts.find((x) => x.id === a.id)!, r);
        },
        owner,
      );
    try {
      if (a.status === "queued") {
        await update((a, r) => {
          if (r.phase === "stopped")
            throw new DiagnosticError("STOPPED", "本轮已停止");
          a.status = "submitting";
          a.submittedAt = now();
          event(r, `${a.platform} · 第 ${a.run}/5 次采集已提交`, a.category);
        });
        const taskId = await monitor.submit(
          attempt,
          state(await owned(id)).subject,
        );
        await update((a) => {
          a.status = "submitted";
          a.taskId = taskId;
          a.nextPollAt = Date.now() + 300_000;
        });
        return;
      }
      if (a.status === "submitting") {
        await update((a) => {
          a.status = "submission_unknown";
          a.error = "提交结果待核对；已保留原标识，系统不会重复提交付费采集";
        });
        return;
      }
      if (a.status !== "submitted" || (a.nextPollAt ?? 0) > Date.now()) return;
      const result = await monitor.poll(
        attempt,
        state(await owned(id)).subject,
      );
      await update((a, r) => {
        if (!result) {
          a.nextPollAt = Date.now() + 30_000;
          return;
        }
        a.status = "completed";
        a.sample = {
          id: a.id,
          category: a.category,
          platform: a.platform,
          run: a.run,
          question: a.question,
          answer: result.answer,
          citations: result.citations,
          references: result.references,
          collectedAt: result.collectedAt,
        };
        delete a.error;
        event(
          r,
          `${a.platform} · 第 ${a.run}/5 次回答与来源已保存`,
          a.category,
        );
      });
    } catch (e) {
      if (e instanceof DiagnosticError) return;
      await update((a, r) => {
        if (e instanceof DiagnosticMonitorError && e.ambiguous) {
          a.status = "submission_unknown";
          a.error = "采集提交结果待核对，不会重复提交";
        } else if (
          a.taskId &&
          e instanceof DiagnosticMonitorError &&
          ["MONITOR_NETWORK", "MONITOR_RESPONSE"].includes(e.code)
        ) {
          a.status = "submitted";
          a.nextPollAt = Date.now() + 60_000;
          a.error = "采集查询暂不可用，稍后读取同一任务";
        } else {
          a.status = "failed";
          a.error = e instanceof Error ? e.message : "采集未完成";
        }
        event(r, a.error!, a.category);
      });
    }
  }
  async function tick(id: string) {
    const owner = randomUUID();
    let acquired = false;
    await mutate(id, (r) => {
      const pendingModel = r.jobs.some((j) =>
        ["queued", "submitting", "running"].includes(j.status),
      );
      const pendingCollection = r.attempts.some((a) =>
        ["queued", "submitting", "submitted"].includes(a.status),
      );
      if (
        r.phase === "completed" ||
        (["draft", "partial"].includes(r.phase) &&
          !pendingModel &&
          !pendingCollection) ||
        (r.phase === "stopped" &&
          !r.attempts.some(
            (a) => a.status === "submitted" || a.status === "submitting",
          )) ||
        (r.lease && r.lease.until > Date.now())
      )
        return;
      r.lease = { owner, until: Date.now() + 180_000 };
      acquired = true;
    });
    if (!acquired) return;
    try {
      let r = state(await owned(id));
      const job =
        r.phase === "stopped"
          ? undefined
          : r.jobs.find((j) =>
              ["queued", "submitting", "running"].includes(j.status),
            );
      if (job) await processJob(id, job, owner);
      r = state(await owned(id));
      if (r.phase === "stopped") {
        for (const a of r.attempts
          .filter(
            (a) =>
              a.status === "submitting" ||
              (a.status === "submitted" && (a.nextPollAt ?? 0) <= Date.now()),
          )
          .slice(0, 3))
          await processAttempt(id, a, owner);
        return;
      }
      if (r.confirmedAt) {
        for (const a of r.attempts
          .filter(
            (a) =>
              a.status === "queued" ||
              a.status === "submitting" ||
              (a.status === "submitted" && (a.nextPollAt ?? 0) <= Date.now()),
          )
          .slice(0, 3))
          await processAttempt(id, a, owner);
        r = state(await owned(id));
        for (const category of DIAGNOSTIC_CATEGORIES) {
          const all = r.attempts.filter((a) => a.category === category);
          if (
            all.length &&
            all.every((a) => a.status === "completed") &&
            !r.results[category] &&
            !r.jobs.some((j) => j.kind === "assess" && j.category === category)
          )
            await addJob(id, "assess", category);
        }
        await mutate(
          id,
          (r) => {
            if (r.phase === "stopped") return;
            if (DIAGNOSTIC_CATEGORIES.every((c) => r.results[c])) {
              r.phase = "completed";
              event(r, "四类诊断已完成，全部指标可追溯到本轮回答");
            } else if (
              r.jobs.some(
                (j) =>
                  j.kind === "assess" &&
                  ["queued", "running", "submitting"].includes(j.status),
              )
            )
              r.phase = "analyzing";
            else if (
              r.attempts.some((a) =>
                ["queued", "submitted", "submitting"].includes(a.status),
              )
            )
              r.phase = "collecting";
            else r.phase = "partial";
          },
          owner,
        );
      }
    } finally {
      await mutate(id, (r) => {
        if (r.lease?.owner === owner) delete r.lease;
      }).catch(() => {});
    }
  }
  return {
    workspace,
    knowledge,
    create,
    save,
    recommend,
    validate,
    start,
    observe,
    answer,
    documents,
    stop,
    retry,
    tick,
  };
}
const workers = new WeakSet<object>();
export function startDiagnosticWorker(core: ModuleHttpCore) {
  if (workers.has(core)) return;
  workers.add(core);
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const model = intentSkillPorts();
      const db = await core.database();
      const jobs = await db
        .select({ task: model.agentTasks })
        .from(model.agentOperations)
        .innerJoin(
          model.agentTasks,
          and(
            eq(model.agentTasks.operationId, model.agentOperations.id),
            sql`${model.agentTasks.createMarker}=CONCAT('brand-diagnostic:',${model.agentOperations.id})`,
          ),
        )
        .where(
          and(
            eq(model.agentOperations.operationType, OP),
            sql`${model.agentOperations.status} IN ('queued','running','attention_required','cancelled')`,
          ),
        )
        .orderBy(desc(model.agentOperations.createdAt))
        .limit(100);
      for (const { task } of jobs) {
        const p = task.providerRuntime as any;
        if (!p?.[ROOT] || !p.diagnosticContext) continue;
        await model
          .runWithStoredEnterpriseProjectScope(
            p.diagnosticContext.accountUserId,
            p.diagnosticContext.enterpriseProjectId,
            () =>
              createDiagnosticService(
                core,
                p.diagnosticContext,
                p.diagnosticActor,
              ).tick(p[ROOT].id),
          )
          .catch((e: unknown) =>
            console.error(
              "[Brand diagnostics]",
              p[ROOT].id,
              e instanceof DiagnosticError
                ? e.code
                : e instanceof Error &&
                    /^[A-Z][A-Z0-9_]{2,100}$/.test(e.message)
                  ? e.message
                  : e instanceof Error
                    ? e.name
                    : "WORKER_ERROR",
            ),
          );
      }
    } catch {
      console.error("[Brand diagnostics] worker unavailable");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll(), 3000);
  timer.unref();
  setTimeout(() => void poll(), 1000).unref();
}
