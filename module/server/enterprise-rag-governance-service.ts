import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import { EnterpriseRagHumanReviewError } from "./enterprise-rag-human-review-service.js";
import { intentHash, intentSkillPorts } from "./intent-skill-runtime.js";

type Actor = { id: number; role: string; adminAccessLevel?: "system_admin" | "delivery_admin" | null };
const LEGACY_EVALUATION_VERSION_ID = "rag-eval-1.4+skill-3.0.0";
const LEGACY_EVALUATION_MANIFEST = {
  evaluationVersionId: LEGACY_EVALUATION_VERSION_ID,
  promptVersion: "enterprise-rag-skill-3.0.0",
  promptHash: "040a9693623cea80f63de8487796042e8dc183cc257a24af875651d01b00f5a6",
  ruleVersion: "rag-eval-1.4",
  scoringVersion: "3.0.0",
  judgeVersion: "3.0.0",
  modelPolicy: "frozen_by_report",
} as const;
const LEGACY_EVALUATION_MANIFEST_HASH = createHash("sha256")
  .update(JSON.stringify(LEGACY_EVALUATION_MANIFEST))
  .digest("hex");
const bootstrapSchema = z.object({ clientRequestId: z.string().uuid() }).strict();
const optimizationSchema = z.object({
  clientRequestId: z.string().uuid(),
  scope: z.enum(["workspace", "cross_workspace"]),
  caseIds: z.array(z.string().uuid()).min(1).max(500),
}).strict();
const regressionSchema = z.object({
  clientRequestId: z.string().uuid(),
  baselineVersionId: z.string().min(1).max(96),
  candidateVersionId: z.string().min(1).max(96),
  datasetHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const releaseSchema = z.object({
  clientRequestId: z.string().uuid(),
  action: z.enum(["canary", "global", "rollback"]),
  channelId: z.string().min(1).max(96),
  regressionRunId: z.string().uuid().optional(),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2_000),
}).strict();
const releaseMetricsSchema = z.object({
  overallAgreementDelta: z.number().finite(),
  falseAcceptanceDelta: z.number().finite(),
  newHighRiskMisses: z.number().int().nonnegative(),
  fixedHighRiskPass: z.boolean(),
  improvedTargetClusters: z.number().int().nonnegative(),
}).passthrough();
export function enterpriseRagRegressionMetricsPass(value: unknown) {
  const parsed = releaseMetricsSchema.safeParse(value);
  return parsed.success && parsed.data.overallAgreementDelta >= 0 && parsed.data.falseAcceptanceDelta <= 0 &&
    parsed.data.newHighRiskMisses === 0 && parsed.data.fixedHighRiskPass && parsed.data.improvedTargetClusters >= 1;
}
const duplicateKey = (error: unknown) => {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; errno?: unknown; cause?: unknown } : {};
  const cause = candidate.cause && typeof candidate.cause === "object" ? candidate.cause as { code?: unknown; errno?: unknown } : {};
  return candidate.code === "ER_DUP_ENTRY" || Number(candidate.errno) === 1062 || cause.code === "ER_DUP_ENTRY" || Number(cause.errno) === 1062;
};

/**
 * Durable governance boundary. The feature flag remains off until the audited
 * proposal/regression worker is shipped; no page read can create paid work.
 */
export function createEnterpriseRagGovernanceService(core: ModuleHttpCore, request: Request) {
  const context = core.context(request);
  const model = intentSkillPorts();
  const actor = (request as Request & { frontmindUser?: Actor }).frontmindUser;
  const database = () => core.database();
  function assertAdmin(systemOnly = false) {
    const valid = actor && actor.id === context.actorUserId && actor.role === "admin" &&
      (systemOnly ? actor.adminAccessLevel === "system_admin" : ["delivery_admin", "system_admin"].includes(String(actor.adminAccessLevel)));
    if (!valid) throw new EnterpriseRagHumanReviewError("GOVERNANCE_FORBIDDEN", "当前账号无权执行此评估治理操作。", 403);
  }
  function assertEnabled() {
    if (core.environment.BRAND_RAG_GOVERNANCE_ENABLED !== "true") {
      throw new EnterpriseRagHumanReviewError("GOVERNANCE_NOT_ENABLED", "评估优化与回归运行能力尚未启用。", 503);
    }
  }
  async function assertInitialized(db: any) {
    const [version, channel] = await Promise.all([
      db.select({ id: model.enterpriseRagEvaluationVersions.id, manifestHash: model.enterpriseRagEvaluationVersions.manifestHash })
        .from(model.enterpriseRagEvaluationVersions).where(eq(model.enterpriseRagEvaluationVersions.id, LEGACY_EVALUATION_VERSION_ID)).limit(1),
      db.select({ id: model.enterpriseRagEvaluationChannels.id, scope: model.enterpriseRagEvaluationChannels.scope, activeVersionId: model.enterpriseRagEvaluationChannels.activeVersionId })
        .from(model.enterpriseRagEvaluationChannels).where(eq(model.enterpriseRagEvaluationChannels.id, "global")).limit(1),
    ]);
    if (version[0]?.manifestHash !== LEGACY_EVALUATION_MANIFEST_HASH || channel[0]?.scope !== "global" || !channel[0]?.activeVersionId) {
      throw new EnterpriseRagHumanReviewError("GOVERNANCE_NOT_INITIALIZED", "请先由系统管理员显式初始化评估版本治理。", 409);
    }
  }
  async function initialize(value: unknown) {
    assertAdmin(true); assertEnabled();
    const input = bootstrapSchema.parse(value);
    const db = await database();
    await db.transaction(async (tx: any) => {
      await tx.insert(model.enterpriseRagEvaluationVersions).values({
        id: LEGACY_EVALUATION_VERSION_ID,
        status: "built_in",
        manifest: LEGACY_EVALUATION_MANIFEST,
        manifestHash: LEGACY_EVALUATION_MANIFEST_HASH,
        sourceProposalId: null,
        createdByUserId: actor!.id,
      }).onDuplicateKeyUpdate({ set: { id: sql`${model.enterpriseRagEvaluationVersions.id}` } });
      await tx.insert(model.enterpriseRagEvaluationChannels).values({
        id: "global",
        scope: "global",
        enterpriseProjectId: null,
        activeVersionId: LEGACY_EVALUATION_VERSION_ID,
        revision: 1,
        updatedByUserId: actor!.id,
      }).onDuplicateKeyUpdate({ set: { id: sql`${model.enterpriseRagEvaluationChannels.id}` } });
    });
    await assertInitialized(db);
    return { clientRequestId: input.clientRequestId, initialized: true, versionId: LEGACY_EVALUATION_VERSION_ID, channelId: "global" };
  }
  async function startOptimization(value: unknown) {
    assertAdmin(); assertEnabled();
    const input = optimizationSchema.parse(value);
    if (input.scope === "cross_workspace" && actor!.adminAccessLevel !== "system_admin") throw new EnterpriseRagHumanReviewError("CROSS_WORKSPACE_FORBIDDEN", "只有系统管理员可明确发起脱敏的跨企业分析。", 403);
    if (input.scope === "workspace" && !context.enterpriseProjectId) throw new EnterpriseRagHumanReviewError("PROJECT_REQUIRED", "工作区优化任务必须绑定企业项目。", 409);
    const db = await database();
    await assertInitialized(db);
    const requestHash = intentHash(input);
    const existing = (await db.select().from(model.enterpriseRagOptimizationProposals).where(and(
      eq(model.enterpriseRagOptimizationProposals.createdByUserId, actor!.id),
      eq(model.enterpriseRagOptimizationProposals.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (existing) {
      if (existing.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "优化任务请求标识已用于其他内容。");
      return existing;
    }
    const cases = await db.select().from(model.enterpriseRagReviewCases).where(and(
      inArray(model.enterpriseRagReviewCases.id, [...new Set(input.caseIds)]),
      input.scope === "workspace" ? eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId) : sql`TRUE`,
      eq(model.enterpriseRagReviewCases.status, "pending_analysis"),
    ));
    if (cases.length !== new Set(input.caseIds).size) throw new EnterpriseRagHumanReviewError("CASES_NOT_ELIGIBLE", "所选案例不完整、仍待复核或不属于当前范围。", 400);
    const row = {
      id: randomUUID(), enterpriseProjectId: input.scope === "workspace" ? context.enterpriseProjectId : null,
      scope: input.scope, clientRequestId: input.clientRequestId, requestHash, status: "reserved",
      caseIds: [...new Set(input.caseIds)].sort(),
      redactedInputHash: createHash("sha256").update(JSON.stringify(cases.map((item: any) => ({ id: item.id, reportId: item.reportId, status: item.status })))).digest("hex"),
      policyPack: null, citedCaseIds: [], createdByUserId: actor!.id,
    };
    try {
      await db.insert(model.enterpriseRagOptimizationProposals).values(row);
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const replay = (await db.select().from(model.enterpriseRagOptimizationProposals).where(and(
        eq(model.enterpriseRagOptimizationProposals.createdByUserId, actor!.id),
        eq(model.enterpriseRagOptimizationProposals.clientRequestId, input.clientRequestId),
      )).limit(1))[0];
      if (!replay) throw new EnterpriseRagHumanReviewError("OPTIMIZATION_CONCURRENT_WRITE", "并发优化任务正在结算，请重新读取。", 409);
      if (replay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "优化任务请求标识已用于其他内容。");
      return replay;
    }
    return row;
  }
  async function optimization(runId: string) {
    assertAdmin();
    const id = z.string().uuid().parse(runId); const db = await database();
    const row = (await db.select().from(model.enterpriseRagOptimizationProposals).where(eq(model.enterpriseRagOptimizationProposals.id, id)).limit(1))[0];
    if (!row || (row.scope === "workspace" && row.enterpriseProjectId !== context.enterpriseProjectId) ||
      (row.scope === "cross_workspace" && actor!.adminAccessLevel !== "system_admin")) {
      throw new EnterpriseRagHumanReviewError("OPTIMIZATION_NOT_FOUND", "优化任务不存在。", 404);
    }
    return row;
  }
  async function startRegression(proposalId: string, value: unknown) {
    assertAdmin(); assertEnabled();
    const id = z.string().uuid().parse(proposalId); const input = regressionSchema.parse(value); const db = await database();
    await assertInitialized(db);
    const proposal = await optimization(id);
    if (proposal.status !== "completed" || !proposal.policyPack || !Array.isArray(proposal.citedCaseIds) || !proposal.citedCaseIds.length) throw new EnterpriseRagHumanReviewError("PROPOSAL_NOT_READY", "候选方案尚未完成或没有引用对应分歧案例。");
    const requestHash = intentHash(input);
    const existing = (await db.select().from(model.enterpriseRagRegressionRuns).where(and(
      eq(model.enterpriseRagRegressionRuns.createdByUserId, actor!.id), eq(model.enterpriseRagRegressionRuns.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (existing) {
      if (existing.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "回归任务请求标识已用于其他内容。");
      return existing;
    }
    const versions = await db.select({ id: model.enterpriseRagEvaluationVersions.id, status: model.enterpriseRagEvaluationVersions.status, sourceProposalId: model.enterpriseRagEvaluationVersions.sourceProposalId })
      .from(model.enterpriseRagEvaluationVersions).where(inArray(model.enterpriseRagEvaluationVersions.id, [input.baselineVersionId, input.candidateVersionId]));
    const baseline = versions.find((item: any) => item.id === input.baselineVersionId);
    const candidate = versions.find((item: any) => item.id === input.candidateVersionId);
    if (!baseline || !candidate || candidate.sourceProposalId !== id || candidate.status !== "candidate") {
      throw new EnterpriseRagHumanReviewError("REGRESSION_VERSION_INVALID", "回归必须对比已登记基线与该提案产生的候选版本。", 400);
    }
    const row = { id: randomUUID(), proposalId: id, ...input, requestHash, status: "reserved", gateStatus: "pending", metrics: null, createdByUserId: actor!.id };
    try {
      await db.insert(model.enterpriseRagRegressionRuns).values(row);
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const replay = (await db.select().from(model.enterpriseRagRegressionRuns).where(and(
        eq(model.enterpriseRagRegressionRuns.createdByUserId, actor!.id),
        eq(model.enterpriseRagRegressionRuns.clientRequestId, input.clientRequestId),
      )).limit(1))[0];
      if (!replay) throw new EnterpriseRagHumanReviewError("REGRESSION_CONCURRENT_WRITE", "并发回归任务正在结算，请重新读取。", 409);
      if (replay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "回归任务请求标识已用于其他内容。");
      return replay;
    }
    return row;
  }
  async function regression(runId: string) {
    assertAdmin(); const id = z.string().uuid().parse(runId); const db = await database();
    const row = (await db.select().from(model.enterpriseRagRegressionRuns).where(eq(model.enterpriseRagRegressionRuns.id, id)).limit(1))[0];
    if (!row) throw new EnterpriseRagHumanReviewError("REGRESSION_NOT_FOUND", "回归任务不存在。", 404);
    await optimization(String(row.proposalId));
    return row;
  }
  async function release(versionId: string, value: unknown) {
    assertAdmin(true); assertEnabled();
    const target = z.string().min(1).max(96).parse(versionId); const input = releaseSchema.parse(value); const db = await database();
    await assertInitialized(db);
    const requestHash = intentHash({ versionId: target, ...input });
    const replay = (await db.select().from(model.enterpriseRagReleaseEvents).where(and(
      eq(model.enterpriseRagReleaseEvents.actorUserId, actor!.id),
      eq(model.enterpriseRagReleaseEvents.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (replay) {
      if (replay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "发布请求标识已用于其他内容。");
      return replay;
    }
    return db.transaction(async (tx: any) => {
      const version = (await tx.select().from(model.enterpriseRagEvaluationVersions).where(eq(model.enterpriseRagEvaluationVersions.id, target)).limit(1))[0];
      const regression = input.regressionRunId
        ? (await tx.select().from(model.enterpriseRagRegressionRuns).where(eq(model.enterpriseRagRegressionRuns.id, input.regressionRunId)).limit(1))[0]
        : null;
      const channel = (await tx.select().from(model.enterpriseRagEvaluationChannels).where(eq(model.enterpriseRagEvaluationChannels.id, input.channelId)).limit(1).for("update"))[0];
      if (!version || !channel || (input.action !== "rollback" && !regression)) throw new EnterpriseRagHumanReviewError("RELEASE_INPUT_NOT_FOUND", "评估版本、回归结果或发布通道不存在。", 404);
      const concurrentReplay = (await tx.select().from(model.enterpriseRagReleaseEvents).where(and(
        eq(model.enterpriseRagReleaseEvents.actorUserId, actor!.id),
        eq(model.enterpriseRagReleaseEvents.clientRequestId, input.clientRequestId),
      )).limit(1))[0];
      if (concurrentReplay) {
        if (concurrentReplay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "发布请求标识已用于其他内容。");
        return concurrentReplay;
      }
      if (Number(channel.revision) !== input.expectedRevision) throw new EnterpriseRagHumanReviewError("RELEASE_REVISION_CONFLICT", "发布通道已变更，请重新读取。");
      if (input.action !== "rollback") {
        if (version.status !== "candidate" || regression!.candidateVersionId !== target || regression!.status !== "completed" || regression!.gateStatus !== "passed") throw new EnterpriseRagHumanReviewError("REGRESSION_GATE_FAILED", "候选版本未通过完整离线回归，禁止发布。");
        if (!enterpriseRagRegressionMetricsPass(regression!.metrics)) throw new EnterpriseRagHumanReviewError("REGRESSION_GATE_FAILED", "回归结果未满足发布门禁。");
      } else {
        const priorRelease = (await tx.select({ id: model.enterpriseRagReleaseEvents.id }).from(model.enterpriseRagReleaseEvents).where(and(
          eq(model.enterpriseRagReleaseEvents.channelId, channel.id),
          eq(model.enterpriseRagReleaseEvents.toVersionId, target),
        )).limit(1))[0];
        if (version.status !== "built_in" && !priorRelease) throw new EnterpriseRagHumanReviewError("ROLLBACK_TARGET_INVALID", "只能回滚到该通道之前发布过的评估版本。", 400);
      }
      if (input.action === "global") {
        const canary = (await tx.select({ id: model.enterpriseRagReleaseEvents.id }).from(model.enterpriseRagReleaseEvents).where(and(
          eq(model.enterpriseRagReleaseEvents.action, "canary"),
          eq(model.enterpriseRagReleaseEvents.toVersionId, target),
        )).limit(1))[0];
        if (!canary) throw new EnterpriseRagHumanReviewError("CANARY_REQUIRED", "候选评估版本必须先完成至少一个工作区灰度发布。", 409);
      }
      const channelMatches = input.action === "rollback" || (input.action === "global" && channel.scope === "global") || (input.action === "canary" && channel.scope === "workspace");
      if (!channelMatches) throw new EnterpriseRagHumanReviewError("RELEASE_CHANNEL_MISMATCH", "发布动作与通道范围不匹配。", 400);
      const event = { id: randomUUID(), channelId: channel.id, action: input.action, clientRequestId: input.clientRequestId, requestHash, fromVersionId: channel.activeVersionId, toVersionId: target, regressionRunId: regression?.id ?? null, actorUserId: actor!.id, reason: input.reason };
      await tx.insert(model.enterpriseRagReleaseEvents).values(event);
      await tx.update(model.enterpriseRagEvaluationChannels).set({ activeVersionId: target, revision: Number(channel.revision) + 1, updatedByUserId: actor!.id, updatedAt: new Date() }).where(eq(model.enterpriseRagEvaluationChannels.id, channel.id));
      return event;
    });
  }
  return { initialize, startOptimization, optimization, startRegression, regression, release };
}
