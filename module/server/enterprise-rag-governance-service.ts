import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import {
  ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST,
  ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH,
  ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID,
  ENTERPRISE_RAG_DIMENSION_IDS,
  ENTERPRISE_RAG_GATE_IDS,
} from "../contracts/enterprise-rag-evaluation-run.js";
import type { ModuleHttpCore } from "./http-api.js";
import { EnterpriseRagHumanReviewError } from "./enterprise-rag-human-review-service.js";
import { intentHash, intentSkillPorts } from "./intent-skill-runtime.js";

type Actor = { id: number; role: string; adminAccessLevel?: "system_admin" | "delivery_admin" | null };
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
  datasetHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
  falseRejectionDelta: z.number().finite(),
  newHighRiskMisses: z.number().int().nonnegative(),
  fixedHighRiskPass: z.boolean(),
  improvedTargetClusters: z.number().int().nonnegative(),
}).passthrough();
export function enterpriseRagRegressionMetricsPass(value: unknown) {
  const parsed = releaseMetricsSchema.safeParse(value);
  return parsed.success && parsed.data.overallAgreementDelta >= 0 && parsed.data.falseAcceptanceDelta <= 0 &&
    parsed.data.newHighRiskMisses === 0 && parsed.data.fixedHighRiskPass && parsed.data.improvedTargetClusters >= 1;
}
export const enterpriseRagWorkspaceEvaluationChannelId = (enterpriseProjectId: string) =>
  `workspace:${z.string().uuid().parse(enterpriseProjectId)}`;
export const ENTERPRISE_RAG_GOVERNANCE_FIXED_DATASET_VERSION =
  "enterprise-rag-fixed-structured-v2";
export function enterpriseRagRegressionDatasetHash(input: {
  proposalId: string;
  baselineVersionId: string;
  candidateVersionId: string;
  baselineManifestHash: string;
  candidateManifestHash: string;
  frozenSnapshotHash: string;
  caseIds: string[];
}) {
  return intentHash({
    schemaVersion: 1,
    fixedDatasetVersion: ENTERPRISE_RAG_GOVERNANCE_FIXED_DATASET_VERSION,
    proposalId: input.proposalId,
    baselineVersionId: input.baselineVersionId,
    candidateVersionId: input.candidateVersionId,
    baselineManifestHash: input.baselineManifestHash,
    candidateManifestHash: input.candidateManifestHash,
    frozenSnapshotHash: input.frozenSnapshotHash,
    caseIds: [...new Set(input.caseIds)].sort(),
  });
}
const duplicateKey = (error: unknown) => {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; errno?: unknown; cause?: unknown } : {};
  const cause = candidate.cause && typeof candidate.cause === "object" ? candidate.cause as { code?: unknown; errno?: unknown } : {};
  return candidate.code === "ER_DUP_ENTRY" || Number(candidate.errno) === 1062 || cause.code === "ER_DUP_ENTRY" || Number(cause.errno) === 1062;
};

function normalizedAiVerdict(review: any) {
  const report = review.aiReportSnapshot ?? {};
  const diff = review.diff ?? {};
  const score = diff.overall?.aiScore ?? report.result?.score ?? null;
  const raw = diff.overall?.aiVerdict ?? report.result?.answerVerdict ?? "pending";
  return { score, verdict: raw === "usable_with_improvements" ? "improve" : raw === "usable" && score === 100 ? "excellent" : raw };
}

function freezeBasePolicySignals(review: any) {
  const report = review.aiReportSnapshot && typeof review.aiReportSnapshot === "object"
    ? review.aiReportSnapshot
    : {};
  const result = report.result && typeof report.result === "object" ? report.result : {};
  const judgments = report.judgments && typeof report.judgments === "object" ? report.judgments : {};
  const policyWasApplied = Boolean(report.evaluator?.policyPack);
  const answerVerdict = result.policyBaseAnswerVerdict ?? (!policyWasApplied ? result.answerVerdict : null);
  if (!(["usable", "usable_with_improvements", "unusable", "pending"] as const).includes(answerVerdict)) {
    throw new EnterpriseRagHumanReviewError(
      "GOVERNANCE_BASE_SIGNALS_UNAVAILABLE",
      "所选评审缺少可验证的基础评估信号，不能进入离线回归。",
      409,
    );
  }
  const rawDimensions = Array.isArray(judgments.dimensions) ? judgments.dimensions : [];
  const dimensions = ENTERPRISE_RAG_DIMENSION_IDS.map((id) => {
    const value = rawDimensions.find((item: any) => item?.id === id)?.level;
    if (value !== null && !(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4)) {
      throw new EnterpriseRagHumanReviewError("GOVERNANCE_BASE_SIGNALS_INVALID", "基础维度评分无法验证。", 409);
    }
    return { id, level: value ?? null };
  });
  const rawGates = Array.isArray(judgments.gates) ? judgments.gates : [];
  const gates = ENTERPRISE_RAG_GATE_IDS.map((id) => {
    const status = rawGates.find((item: any) => item?.id === id)?.status;
    if (!(status === "passed" || status === "failed" || status === "pending")) {
      throw new EnterpriseRagHumanReviewError("GOVERNANCE_BASE_SIGNALS_INVALID", "基础风险门结果无法验证。", 409);
    }
    return { id, status };
  });
  const riskSeverities = Array.isArray(result.risks)
    ? result.risks.map((risk: any) => risk?.severity).filter((severity: unknown) =>
      severity === "low" || severity === "medium" || severity === "high" || severity === "critical")
    : [];
  const score = result.score === null ? null : Number(result.score);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    throw new EnterpriseRagHumanReviewError("GOVERNANCE_BASE_SIGNALS_INVALID", "基础总分无法验证。", 409);
  }
  if (!(result.status === "not_run" || result.status === "pending" || result.status === "completed" || result.status === "failed")) {
    throw new EnterpriseRagHumanReviewError("GOVERNANCE_BASE_SIGNALS_INVALID", "基础评估状态无法验证。", 409);
  }
  return {
    status: result.status,
    score,
    answerVerdict,
    riskSeverities,
    dimensions,
    gates,
  };
}

/** Strict, text-free snapshot used by the proposal worker. The immutable
 * review id/content hash stay server-side; only `projection` may leave Core. */
function freezeGovernanceReview(caseRow: any, review: any) {
  const knowledge = review.knowledgeSnapshot && typeof review.knowledgeSnapshot === "object" ? review.knowledgeSnapshot : {};
  if (typeof knowledge.snapshotId !== "string" || !Number.isSafeInteger(knowledge.version) || knowledge.version < 0) {
    throw new EnterpriseRagHumanReviewError("GOVERNANCE_KNOWLEDGE_VERSION_INVALID", "所选评审的冻结知识版本无法验证。", 400);
  }
  const diff = review.diff ?? {};
  const dimensions = Array.isArray(review.dimensions) ? review.dimensions : [];
  const gates = Array.isArray(review.gates) ? review.gates : [];
  const ai = normalizedAiVerdict(review);
  return {
    caseId: String(caseRow.id),
    reviewId: String(review.id),
    reviewContentHash: String(review.contentHash),
    projection: {
      caseId: String(caseRow.id),
      alignment: String(review.alignment),
      evaluationVersionId: String(review.evaluationVersionId),
      knowledgeVersionKey: intentHash({ snapshotId: knowledge.snapshotId, version: knowledge.version }),
      ai,
      baseSignals: freezeBasePolicySignals(review),
      human: {
        verdict: String(review.humanVerdict),
        score: review.humanScore === null || review.humanScore === undefined ? null : Number(review.humanScore),
      },
      dimensionChanges: Array.isArray(diff.dimensions) ? diff.dimensions.map((item: any) => {
        const judgment = dimensions.find((candidate: any) => candidate.id === item.id);
        return { id: String(item.id), aiLevel: item.aiLevel ?? null, humanLevel: item.humanLevel ?? null,
          rationaleProvided: typeof judgment?.rationale === "string" && Boolean(judgment.rationale.trim()),
          evidenceCount: Array.isArray(judgment?.evidenceIds) ? judgment.evidenceIds.length : 0 };
      }) : [],
      riskChanges: Array.isArray(diff.gates) ? diff.gates.map((item: any) => {
        const judgment = gates.find((candidate: any) => candidate.id === item.id);
        return { id: String(item.id), aiStatus: String(item.aiStatus), humanStatus: String(item.humanStatus),
          reasonProvided: typeof judgment?.reason === "string" && Boolean(judgment.reason.trim()) };
      }) : [],
      humanGateStates: gates.map((gate: any) => ({ id: String(gate.id), status: String(gate.status) })),
    },
  };
}

function selectFrozenReviews(cases: any[], reviews: any[], events: any[]) {
  const reconciled = new Map<string, string>();
  for (const event of events) {
    const reviewId = event.payload && typeof event.payload === "object" ? event.payload.reviewId : null;
    if (typeof reviewId === "string" && !reconciled.has(String(event.caseId))) reconciled.set(String(event.caseId), reviewId);
  }
  return cases.map((caseRow) => {
    const candidates = reviews.filter((review) => review.reportId === caseRow.reportId &&
      review.enterpriseProjectId === caseRow.enterpriseProjectId && Number(review.accountUserId) === Number(caseRow.accountUserId));
    const superseded = new Set(candidates.map((review) => review.supersedesReviewId).filter(Boolean).map(String));
    const selectedId = reconciled.get(String(caseRow.id));
    const review = selectedId
      ? candidates.find((candidate) => String(candidate.id) === selectedId)
      : candidates.find((candidate) => !superseded.has(String(candidate.id)));
    if (!review) throw new EnterpriseRagHumanReviewError("REVIEW_SNAPSHOT_MISSING", "所选案例缺少可冻结的有效评审。", 409);
    return freezeGovernanceReview(caseRow, review);
  });
}

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
        .from(model.enterpriseRagEvaluationVersions).where(eq(model.enterpriseRagEvaluationVersions.id, ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID)).limit(1),
      db.select({ id: model.enterpriseRagEvaluationChannels.id, scope: model.enterpriseRagEvaluationChannels.scope, activeVersionId: model.enterpriseRagEvaluationChannels.activeVersionId })
        .from(model.enterpriseRagEvaluationChannels).where(eq(model.enterpriseRagEvaluationChannels.id, "global")).limit(1),
    ]);
    if (version[0]?.manifestHash !== ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH || channel[0]?.scope !== "global" || !channel[0]?.activeVersionId) {
      throw new EnterpriseRagHumanReviewError("GOVERNANCE_NOT_INITIALIZED", "请先由系统管理员显式初始化评估版本治理。", 409);
    }
  }
  async function initialize(value: unknown) {
    assertAdmin(true); assertEnabled();
    const input = bootstrapSchema.parse(value);
    const db = await database();
    await db.transaction(async (tx: any) => {
      await tx.insert(model.enterpriseRagEvaluationVersions).values({
        id: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID,
        status: "built_in",
        manifest: ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST,
        manifestHash: ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH,
        sourceProposalId: null,
        createdByUserId: actor!.id,
      }).onDuplicateKeyUpdate({ set: { id: sql`${model.enterpriseRagEvaluationVersions.id}` } });
      await tx.insert(model.enterpriseRagEvaluationChannels).values({
        id: "global",
        scope: "global",
        enterpriseProjectId: null,
        activeVersionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID,
        revision: 1,
        updatedByUserId: actor!.id,
      }).onDuplicateKeyUpdate({ set: { id: sql`${model.enterpriseRagEvaluationChannels.id}` } });
    });
    await assertInitialized(db);
    return { clientRequestId: input.clientRequestId, initialized: true, versionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID, channelId: "global" };
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
    let row: any;
    try {
      await db.transaction(async (tx: any) => {
        const concurrentReplay = (await tx.select().from(model.enterpriseRagOptimizationProposals).where(and(
          eq(model.enterpriseRagOptimizationProposals.createdByUserId, actor!.id),
          eq(model.enterpriseRagOptimizationProposals.clientRequestId, input.clientRequestId),
        )).limit(1).for("update"))[0];
        if (concurrentReplay) {
          if (concurrentReplay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "优化任务请求标识已用于其他内容。");
          row = concurrentReplay;
          return;
        }
        const caseIds = [...new Set(input.caseIds)].sort();
        const cases = await tx.select().from(model.enterpriseRagReviewCases).where(and(
          inArray(model.enterpriseRagReviewCases.id, caseIds),
          input.scope === "workspace" ? eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId) : sql`TRUE`,
          eq(model.enterpriseRagReviewCases.status, "pending_analysis"),
        )).orderBy(model.enterpriseRagReviewCases.id).for("update");
        if (cases.length !== caseIds.length) throw new EnterpriseRagHumanReviewError("CASES_NOT_ELIGIBLE", "所选案例不完整、仍待复核或不属于当前范围。", 400);
        const reviews = await tx.select().from(model.enterpriseRagHumanReviews).where(
          inArray(model.enterpriseRagHumanReviews.reportId, cases.map((item: any) => String(item.reportId))),
        ).orderBy(desc(model.enterpriseRagHumanReviews.createdAt), desc(model.enterpriseRagHumanReviews.id));
        const events = await tx.select().from(model.enterpriseRagReviewCaseEvents).where(and(
          inArray(model.enterpriseRagReviewCaseEvents.caseId, caseIds),
          eq(model.enterpriseRagReviewCaseEvents.eventType, "reconciled"),
        )).orderBy(desc(model.enterpriseRagReviewCaseEvents.createdAt));
        const frozenCaseSnapshots = selectFrozenReviews(cases, reviews, events);
        row = {
          id: randomUUID(), enterpriseProjectId: input.scope === "workspace" ? context.enterpriseProjectId : null,
          scope: input.scope, clientRequestId: input.clientRequestId, requestHash, status: "reserved",
          caseIds, frozenCaseSnapshots, redactedInputHash: intentHash(frozenCaseSnapshots),
          policyPack: null, citedCaseIds: [], createdByUserId: actor!.id,
        };
        await tx.insert(model.enterpriseRagOptimizationProposals).values(row);
      });
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
    const existing = (await db.select().from(model.enterpriseRagRegressionRuns).where(and(
      eq(model.enterpriseRagRegressionRuns.createdByUserId, actor!.id),
      eq(model.enterpriseRagRegressionRuns.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (existing) {
      const sameIntent = String(existing.proposalId) === id &&
        String(existing.baselineVersionId) === input.baselineVersionId &&
        String(existing.candidateVersionId) === input.candidateVersionId &&
        (!input.datasetHash || String(existing.datasetHash) === input.datasetHash);
      if (!sameIntent) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "回归任务请求标识已用于其他内容。");
      return existing;
    }
    const citedCaseIds = Array.isArray(proposal.citedCaseIds) ? proposal.citedCaseIds.map(String) : [];
    if (proposal.status !== "completed" || !proposal.policyPack || !citedCaseIds.length) throw new EnterpriseRagHumanReviewError("PROPOSAL_NOT_READY", "候选方案尚未完成或没有引用对应分歧案例。");
    const versions = await db.select({
      id: model.enterpriseRagEvaluationVersions.id,
      status: model.enterpriseRagEvaluationVersions.status,
      sourceProposalId: model.enterpriseRagEvaluationVersions.sourceProposalId,
      manifestHash: model.enterpriseRagEvaluationVersions.manifestHash,
    }).from(model.enterpriseRagEvaluationVersions).where(inArray(
      model.enterpriseRagEvaluationVersions.id,
      [input.baselineVersionId, input.candidateVersionId],
    ));
    const baseline = versions.find((item: any) => item.id === input.baselineVersionId);
    const candidate = versions.find((item: any) => item.id === input.candidateVersionId);
    if (!baseline || !candidate || candidate.sourceProposalId !== id || candidate.status !== "candidate") {
      throw new EnterpriseRagHumanReviewError("REGRESSION_VERSION_INVALID", "回归必须对比已登记基线与该提案产生的候选版本。", 400);
    }
    const datasetHash = enterpriseRagRegressionDatasetHash({
      proposalId: id,
      baselineVersionId: input.baselineVersionId,
      candidateVersionId: input.candidateVersionId,
      baselineManifestHash: String(baseline.manifestHash),
      candidateManifestHash: String(candidate.manifestHash),
      frozenSnapshotHash: String(proposal.redactedInputHash),
      caseIds: citedCaseIds,
    });
    if (input.datasetHash && input.datasetHash !== datasetHash) {
      throw new EnterpriseRagHumanReviewError("REGRESSION_DATASET_HASH_MISMATCH", "回归数据集已变更，请重新读取候选方案。", 409);
    }
    const normalizedInput = { ...input, datasetHash };
    const requestHash = intentHash(normalizedInput);
    const row = { id: randomUUID(), proposalId: id, ...normalizedInput, requestHash, status: "reserved", gateStatus: "pending", metrics: null, createdByUserId: actor!.id };
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
  async function channel(channelId: string) {
    assertAdmin(true);
    const id = z.string().min(1).max(96).parse(channelId);
    const db = await database();
    await assertInitialized(db);
    const row = (await db.select().from(model.enterpriseRagEvaluationChannels)
      .where(eq(model.enterpriseRagEvaluationChannels.id, id)).limit(1))[0];
    if (!row || (row.scope === "workspace" && row.enterpriseProjectId !== context.enterpriseProjectId)) {
      throw new EnterpriseRagHumanReviewError("EVALUATION_CHANNEL_NOT_FOUND", "评估版本通道不存在。", 404);
    }
    return row;
  }
  async function release(versionId: string, value: unknown) {
    assertAdmin(true); assertEnabled();
    const target = z.string().min(1).max(96).parse(versionId); const input = releaseSchema.parse(value); const db = await database();
    await assertInitialized(db);
    if (input.action === "canary") {
      if (!context.enterpriseProjectId) throw new EnterpriseRagHumanReviewError("PROJECT_REQUIRED", "工作区灰度发布必须绑定当前企业项目。", 409);
      if (input.channelId !== enterpriseRagWorkspaceEvaluationChannelId(context.enterpriseProjectId)) {
        throw new EnterpriseRagHumanReviewError("RELEASE_CHANNEL_MISMATCH", "灰度发布通道与当前企业项目不匹配。", 400);
      }
    }
    if (input.action === "global" && input.channelId !== "global") {
      throw new EnterpriseRagHumanReviewError("RELEASE_CHANNEL_MISMATCH", "全局发布必须使用全局评估通道。", 400);
    }
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
      const releaseProposal = regression
        ? (await tx.select().from(model.enterpriseRagOptimizationProposals)
            .where(eq(model.enterpriseRagOptimizationProposals.id, regression.proposalId)).limit(1))[0]
        : null;
      if (input.action === "canary") {
        const global = (await tx.select().from(model.enterpriseRagEvaluationChannels)
          .where(and(eq(model.enterpriseRagEvaluationChannels.id, "global"), eq(model.enterpriseRagEvaluationChannels.scope, "global")))
          .limit(1).for("update"))[0];
        if (!global) throw new EnterpriseRagHumanReviewError("GOVERNANCE_NOT_INITIALIZED", "全局评估版本通道尚未初始化。", 409);
        await tx.insert(model.enterpriseRagEvaluationChannels).values({
          id: input.channelId, scope: "workspace", enterpriseProjectId: context.enterpriseProjectId,
          activeVersionId: global.activeVersionId, revision: 1, updatedByUserId: actor!.id,
        }).onDuplicateKeyUpdate({ set: { id: sql`${model.enterpriseRagEvaluationChannels.id}` } });
      }
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
        if (version.status !== "candidate" || regression!.candidateVersionId !== target ||
          regression!.baselineVersionId !== channel.activeVersionId ||
          regression!.proposalId !== version.sourceProposalId || !releaseProposal ||
          regression!.status !== "completed" || regression!.gateStatus !== "passed") {
          throw new EnterpriseRagHumanReviewError("REGRESSION_GATE_FAILED", "候选版本未通过当前基线的完整离线回归，禁止发布。");
        }
        if (input.action === "canary" && releaseProposal.enterpriseProjectId !== context.enterpriseProjectId) {
          throw new EnterpriseRagHumanReviewError("RELEASE_WORKSPACE_MISMATCH", "候选版本不属于当前企业项目。", 403);
        }
        if (!enterpriseRagRegressionMetricsPass(regression!.metrics)) throw new EnterpriseRagHumanReviewError("REGRESSION_GATE_FAILED", "回归结果未满足发布门禁。");
      } else {
        const priorRelease = (await tx.select({ id: model.enterpriseRagReleaseEvents.id }).from(model.enterpriseRagReleaseEvents).where(and(
          eq(model.enterpriseRagReleaseEvents.channelId, channel.id),
          eq(model.enterpriseRagReleaseEvents.toVersionId, target),
        )).limit(1))[0];
        if (version.status !== "built_in" && !priorRelease) throw new EnterpriseRagHumanReviewError("ROLLBACK_TARGET_INVALID", "只能回滚到该通道之前发布过的评估版本。", 400);
      }
      if (input.action === "global") {
        const [canary, activeCanary] = await Promise.all([
          tx.select({ id: model.enterpriseRagReleaseEvents.id }).from(model.enterpriseRagReleaseEvents).where(and(
            eq(model.enterpriseRagReleaseEvents.action, "canary"),
            eq(model.enterpriseRagReleaseEvents.toVersionId, target),
          )).limit(1),
          tx.select({ id: model.enterpriseRagEvaluationChannels.id }).from(model.enterpriseRagEvaluationChannels).where(and(
            eq(model.enterpriseRagEvaluationChannels.scope, "workspace"),
            eq(model.enterpriseRagEvaluationChannels.activeVersionId, target),
          )).limit(1),
        ]);
        if (!canary[0] || !activeCanary[0]) throw new EnterpriseRagHumanReviewError("CANARY_REQUIRED", "候选评估版本必须先完成并保持至少一个工作区灰度发布。", 409);
      }
      const channelMatches = input.action === "rollback" || (input.action === "global" && channel.scope === "global") || (input.action === "canary" && channel.scope === "workspace");
      if (!channelMatches) throw new EnterpriseRagHumanReviewError("RELEASE_CHANNEL_MISMATCH", "发布动作与通道范围不匹配。", 400);
      if (channel.scope === "workspace" && channel.enterpriseProjectId !== context.enterpriseProjectId) {
        throw new EnterpriseRagHumanReviewError("RELEASE_CHANNEL_MISMATCH", "评估通道不属于当前企业项目。", 403);
      }
      const event = { id: randomUUID(), channelId: channel.id, action: input.action, clientRequestId: input.clientRequestId, requestHash, fromVersionId: channel.activeVersionId, toVersionId: target, regressionRunId: regression?.id ?? null, actorUserId: actor!.id, reason: input.reason };
      await tx.insert(model.enterpriseRagReleaseEvents).values(event);
      await tx.update(model.enterpriseRagEvaluationChannels).set({ activeVersionId: target, revision: Number(channel.revision) + 1, updatedByUserId: actor!.id, updatedAt: new Date() }).where(eq(model.enterpriseRagEvaluationChannels.id, channel.id));
      if (input.action === "global" && version.status === "candidate") {
        await tx.update(model.enterpriseRagEvaluationVersions).set({ status: "released" })
          .where(eq(model.enterpriseRagEvaluationVersions.id, target));
      }
      return event;
    });
  }
  return { initialize, startOptimization, optimization, startRegression, regression, channel, release };
}
