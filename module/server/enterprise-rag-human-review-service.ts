import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import {
  enterpriseRagHumanReviewCreateSchema,
  type EnterpriseRagHumanReviewDto,
  type EnterpriseRagReviewAlignment,
  type EnterpriseRagReviewCaseStatus,
  type EnterpriseRagReviewContextDto,
  type EnterpriseRagReviewDiff,
  type EnterpriseRagReviewVerdict,
} from "../contracts/enterprise-rag-human-review.js";
import type { EnterpriseRagEvaluationReport } from "../contracts/enterprise-rag-evaluation-run.js";
import {
  RAG_DIMENSIONS,
  RAG_GATES,
  scoreEvaluation,
  type DimensionJudgment,
  type GateJudgment,
} from "../client/dashboard/ai-website-preview/rag-evaluation.js";
import type { ModuleHttpCore } from "./http-api.js";
import { createEnterpriseRagEvaluationService } from "./enterprise-rag-evaluation-service.js";
import { intentHash, intentSkillPorts } from "./intent-skill-runtime.js";

type Actor = {
  id: number;
  role: string;
  adminAccessLevel?: "system_admin" | "delivery_admin" | null;
  engineerRoleType?: string | null;
};

export class EnterpriseRagHumanReviewError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = "EnterpriseRagHumanReviewError";
  }
}

const iso = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
};
const duplicateKey = (error: unknown) => {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; errno?: unknown; cause?: unknown } : {};
  const cause = candidate.cause && typeof candidate.cause === "object" ? candidate.cause as { code?: unknown; errno?: unknown } : {};
  return candidate.code === "ER_DUP_ENTRY" || Number(candidate.errno) === 1062 || cause.code === "ER_DUP_ENTRY" || Number(cause.errno) === 1062;
};

function reportVerdict(report: EnterpriseRagEvaluationReport): EnterpriseRagReviewVerdict {
  const value = report.result.answerVerdict;
  if (value === "unusable") return "unusable";
  if (value === "pending" || report.result.status !== "completed") return "pending";
  if (value === "usable_with_improvements") return "improve";
  if (value === "usable") return report.result.score === 100 ? "excellent" : "usable";
  if (report.result.recommendation === "not_recommended") return "unusable";
  if (report.result.recommendation === "publish_with_risk") return "improve";
  return report.result.score === 100 ? "excellent" : report.result.score === null ? "pending" : "usable";
}

function aiDimensions(report: EnterpriseRagEvaluationReport) {
  return RAG_DIMENSIONS.map(({ id }) => {
    const item = report.result.dimensions.find((dimension) => dimension.id === id);
    // The immutable report keeps its exact fractional score. Human review uses
    // the existing integer 0..4 control, so comparison uses one stable bucket.
    const level = item?.score === null || item?.score === undefined || !item.maxScore || item.status === "not_applicable"
      ? null
      : Math.max(0, Math.min(4, Math.round(4 * item.score / item.maxScore)));
    return { id, level };
  });
}

function aiGates(report: EnterpriseRagEvaluationReport) {
  const judgments = "gates" in report.judgments && Array.isArray(report.judgments.gates)
    ? report.judgments.gates
    : [];
  return RAG_GATES.map(({ id }) => {
    const gate = judgments.find((item) => item.id === id);
    return {
      id,
      status: gate?.status === "failed" ? "failed" as const : gate?.status === "passed" ? "passed" as const : "pending" as const,
    };
  });
}

function humanResult(dimensions: DimensionJudgment[], gates: GateJudgment[]) {
  const result = scoreEvaluation({ dimensions, gates });
  const verdict: EnterpriseRagReviewVerdict = result.verdict === "usable" && result.score === 100
    ? "excellent"
    : result.verdict;
  return { score: result.score, verdict };
}

const verdictRank: Record<Exclude<EnterpriseRagReviewVerdict, "pending">, number> = {
  unusable: 1,
  improve: 2,
  usable: 3,
  excellent: 4,
};
const gateSeverity: Record<GateJudgment["status"], number> = { passed: 0, pending: 1, failed: 2 };

export function computeEnterpriseRagReviewDiff(
  report: EnterpriseRagEvaluationReport,
  dimensions: DimensionJudgment[],
  gates: GateJudgment[],
): { diff: EnterpriseRagReviewDiff; humanVerdict: EnterpriseRagReviewVerdict; humanScore: number | null } {
  const aiVerdict = reportVerdict(report);
  const aiScore = report.result.score;
  const aiDimensionValues = aiDimensions(report);
  const aiGateValues = aiGates(report);
  const human = humanResult(dimensions, gates);
  const dimensionDiffs = dimensions.flatMap((dimension) => {
    const aiLevel = aiDimensionValues.find((item) => item.id === dimension.id)?.level ?? null;
    return aiLevel === dimension.level ? [] : [{ id: dimension.id, aiLevel, humanLevel: dimension.level }];
  });
  const gateDiffs = gates.flatMap((gate) => {
    const aiStatus = aiGateValues.find((item) => item.id === gate.id)?.status ?? "pending";
    return aiStatus === gate.status ? [] : [{ id: gate.id, aiStatus, humanStatus: gate.status }];
  });
  let alignment: EnterpriseRagReviewAlignment;
  if (aiVerdict === "pending" || human.verdict === "pending") {
    alignment = "insufficient_information";
  } else {
    const overallDelta = verdictRank[human.verdict] - verdictRank[aiVerdict];
    const directions = [
      ...dimensionDiffs.map((item) => item.aiLevel === null || item.humanLevel === null ? 0 : Math.sign(item.humanLevel - item.aiLevel)),
      ...gateDiffs.map((item) => Math.sign(gateSeverity[item.aiStatus] - gateSeverity[item.humanStatus])),
    ].filter((item) => item !== 0);
    const positive = overallDelta > 0 || directions.some((item) => item > 0);
    const negative = overallDelta < 0 || directions.some((item) => item < 0);
    alignment = positive && negative ? "mixed" : positive ? "human_more_positive" : negative ? "human_more_negative" : "aligned";
  }
  const overallChanged = aiVerdict !== human.verdict || aiScore !== human.score;
  const diff: EnterpriseRagReviewDiff = {
    alignment,
    ...(overallChanged ? { overall: { aiVerdict, aiScore, humanVerdict: human.verdict, humanScore: human.score } } : {}),
    dimensions: dimensionDiffs,
    gates: gateDiffs,
  };
  return { diff, humanVerdict: human.verdict, humanScore: human.score };
}

export function createEnterpriseRagHumanReviewService(core: ModuleHttpCore, request: Request) {
  const context = core.context(request);
  const model = intentSkillPorts();
  const actor = (request as Request & { frontmindUser?: Actor }).frontmindUser;
  const evaluation = createEnterpriseRagEvaluationService(core, request);

  function assertActor() {
    if (!actor || actor.id !== context.actorUserId) throw new EnterpriseRagHumanReviewError("ACTOR_INVALID", "当前账号无权读取此企业工作区。", 403);
    if (!context.enterpriseProjectId) throw new EnterpriseRagHumanReviewError("PROJECT_REQUIRED", "正式人工评审必须绑定企业项目。", 409);
  }
  async function database() { return core.database(); }
  async function reviewerIdentity(db: any) {
    assertActor();
    const row = (await db.select({
      id: model.users.id, displayName: model.users.displayName, username: model.users.username,
      name: model.users.name, role: model.users.role, adminAccessLevel: model.users.adminAccessLevel,
      engineerRoleType: model.users.engineerRoleType, isActive: model.users.isActive,
    }).from(model.users).where(eq(model.users.id, actor!.id)).limit(1))[0];
    if (!row?.isActive) throw new EnterpriseRagHumanReviewError("REVIEWER_INACTIVE", "当前评审账号不可用。", 403);
    return { row, public: { userId: actor!.id, displayName: String(row.displayName || row.name || row.username || `#${actor!.id}`) } };
  }
  async function canReview(db: any, identity: Awaited<ReturnType<typeof reviewerIdentity>>) {
    if (identity.row.role === "admin" && ["system_admin", "delivery_admin"].includes(String(identity.row.adminAccessLevel))) return true;
    if (identity.row.role !== "delivery_member" || identity.row.engineerRoleType !== "monitoring_optimization_engineer") return false;
    const assignment = (await db.select({ id: model.deliveryProjectAssignments.id }).from(model.deliveryProjectAssignments).where(and(
      eq(model.deliveryProjectAssignments.customerUserId, context.accountUserId),
      eq(model.deliveryProjectAssignments.engineerUserId, actor!.id),
      eq(model.deliveryProjectAssignments.roleType, "monitoring_optimization_engineer"),
    )).limit(1))[0];
    return Boolean(assignment);
  }
  function dto(row: any): EnterpriseRagHumanReviewDto {
    const knowledge = row.knowledgeSnapshot ?? {};
    return {
      id: String(row.id), clientRequestId: String(row.clientRequestId), operationId: String(row.operationId), reportId: String(row.reportId),
      reviewer: { userId: Number(row.reviewerUserId), displayName: String(row.reviewerDisplayName) },
      createdAt: iso(row.createdAt), supersedesReviewId: row.supersedesReviewId ? String(row.supersedesReviewId) : null,
      humanVerdict: row.humanVerdict, humanScore: row.humanScore === null || row.humanScore === undefined ? null : Number(row.humanScore),
      alignment: row.alignment, status: row.caseStatus,
      snapshot: {
        question: String(row.questionSnapshot), answer: String(row.answerSnapshot), need: "",
        knowledgeVersion: `${String(knowledge.sourceFileName || "历史知识快照")} · v${String(knowledge.version || "?")}`,
      },
      dimensions: structuredClone(row.dimensions), gates: structuredClone(row.gates), diff: structuredClone(row.diff),
    };
  }
  async function withCurrentCaseStatus(db: any, row: any) {
    const currentCase = (await db.select({ status: model.enterpriseRagReviewCases.status }).from(model.enterpriseRagReviewCases).where(and(
      eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId),
      eq(model.enterpriseRagReviewCases.reportId, row.reportId),
    )).limit(1))[0];
    return currentCase ? { ...row, caseStatus: currentCase.status } : row;
  }
  async function reviewRows(operationId: string, executor?: any) {
    assertActor();
    const db = executor ?? await database();
    const rows = await db.select().from(model.enterpriseRagHumanReviews).where(and(
      eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
      eq(model.enterpriseRagHumanReviews.accountUserId, context.accountUserId),
      eq(model.enterpriseRagHumanReviews.operationId, operationId),
    )).orderBy(desc(model.enterpriseRagHumanReviews.createdAt), desc(model.enterpriseRagHumanReviews.id));
    const currentCase = (await db.select({ status: model.enterpriseRagReviewCases.status }).from(model.enterpriseRagReviewCases).where(and(
      eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId),
      eq(model.enterpriseRagReviewCases.operationId, operationId),
    )).limit(1))[0];
    return currentCase ? rows.map((row: any) => ({ ...row, caseStatus: currentCase.status })) : rows;
  }
  async function contextDto(operationId: string): Promise<EnterpriseRagReviewContextDto> {
    assertActor();
    const db = await database();
    const [snapshot, identity, rows] = await Promise.all([evaluation.reviewSnapshot(operationId), reviewerIdentity(db), reviewRows(operationId, db)]);
    const allowed = await canReview(db, identity);
    return {
      operationId, reportId: snapshot.report.reportId, canReview: allowed,
      reason: allowed ? null : "当前账号没有正式人工评审权限。", reviewer: identity.public,
      ai: { verdict: reportVerdict(snapshot.report), score: snapshot.report.result.score, dimensions: aiDimensions(snapshot.report), gates: aiGates(snapshot.report) },
      reviews: rows.map(dto),
    };
  }
  async function list(operationId: string) {
    z.string().uuid().parse(operationId);
    await evaluation.reviewSnapshot(operationId);
    return { reviews: (await reviewRows(operationId)).map(dto) };
  }
  async function create(value: unknown) {
    assertActor();
    const input = enterpriseRagHumanReviewCreateSchema.parse(value);
    const db = await database();
    const identity = await reviewerIdentity(db);
    if (!await canReview(db, identity)) throw new EnterpriseRagHumanReviewError("REVIEW_FORBIDDEN", "当前账号没有正式人工评审权限。", 403);
    const snapshot = await evaluation.reviewSnapshot(input.operationId);
    if (snapshot.report.reportId !== input.reportId) throw new EnterpriseRagHumanReviewError("REPORT_MISMATCH", "人工评审与当前不可变报告不匹配。");
    const allowedEvidence = new Set(snapshot.input.allowedEvidenceIds);
    if (input.dimensions.some((dimension) => dimension.evidenceIds.some((id) => !allowedEvidence.has(id)))) {
      throw new EnterpriseRagHumanReviewError("EVIDENCE_INVALID", "人工评审引用了不属于本回答冻结快照的依据。", 400);
    }
    const requestHash = intentHash(input);
    const contentHash = intentHash({ operationId: input.operationId, reportId: input.reportId, dimensions: input.dimensions, gates: input.gates, supersedesReviewId: input.supersedesReviewId ?? null });
    const existingRequest = (await db.select().from(model.enterpriseRagHumanReviews).where(and(
      eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
      eq(model.enterpriseRagHumanReviews.reviewerUserId, actor!.id),
      eq(model.enterpriseRagHumanReviews.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "本次评审请求标识已用于其他内容。");
      const review = dto(await withCurrentCaseStatus(db, existingRequest)); return { review, diff: review.diff };
    }
    const duplicate = (await db.select().from(model.enterpriseRagHumanReviews).where(and(
      eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
      eq(model.enterpriseRagHumanReviews.reportId, input.reportId),
      eq(model.enterpriseRagHumanReviews.reviewerUserId, actor!.id),
      eq(model.enterpriseRagHumanReviews.contentHash, contentHash),
    )).limit(1))[0];
    if (duplicate) { const review = dto(await withCurrentCaseStatus(db, duplicate)); return { review, diff: review.diff }; }
    const computed = computeEnterpriseRagReviewDiff(snapshot.report, input.dimensions as DimensionJudgment[], input.gates as GateJudgment[]);
    const initialStatus: EnterpriseRagReviewCaseStatus = computed.diff.alignment === "aligned" ? "aligned"
      : computed.diff.alignment === "insufficient_information" ? "insufficient_information" : "pending_analysis";
    const reviewId = randomUUID();
    let persisted: any;
    try {
      await db.transaction(async (tx: any) => {
      const proposedCase = { id: randomUUID(), enterpriseProjectId: context.enterpriseProjectId, accountUserId: context.accountUserId, operationId: input.operationId, reportId: input.reportId, status: initialStatus, revision: 0 };
      await tx.insert(model.enterpriseRagReviewCases).values(proposedCase).onDuplicateKeyUpdate({
        set: { updatedAt: sql`${model.enterpriseRagReviewCases.updatedAt}` },
      });
      const caseRow = (await tx.select().from(model.enterpriseRagReviewCases).where(and(
        eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId),
        eq(model.enterpriseRagReviewCases.reportId, input.reportId),
      )).limit(1).for("update"))[0];
      if (!caseRow) throw new EnterpriseRagHumanReviewError("REVIEW_CASE_RESERVATION_FAILED", "人工评审案例未能安全保存。", 503);
      const priorRows = await tx.select().from(model.enterpriseRagHumanReviews).where(and(
        eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
        eq(model.enterpriseRagHumanReviews.reportId, input.reportId),
      )).orderBy(desc(model.enterpriseRagHumanReviews.createdAt), desc(model.enterpriseRagHumanReviews.id));
      const concurrentRequest = priorRows.find((row: any) => Number(row.reviewerUserId) === actor!.id && row.clientRequestId === input.clientRequestId);
      if (concurrentRequest) {
        if (concurrentRequest.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "本次评审请求标识已用于其他内容。");
        persisted = concurrentRequest;
        return;
      }
      const concurrentContent = priorRows.find((row: any) => Number(row.reviewerUserId) === actor!.id && row.contentHash === contentHash);
      if (concurrentContent) {
        persisted = concurrentContent;
        return;
      }
      const supersededIds = new Set(priorRows.map((row: any) => row.supersedesReviewId).filter(Boolean).map(String));
      const currentReviewerReview = priorRows.find((row: any) => Number(row.reviewerUserId) === actor!.id && !supersededIds.has(String(row.id)));
      if (currentReviewerReview && !input.supersedesReviewId) {
        throw new EnterpriseRagHumanReviewError("SUPERSEDES_REVIEW_REQUIRED", "修订人工评审必须追加到当前评审记录。", 409);
      }
      if (input.supersedesReviewId && String(currentReviewerReview?.id ?? "") !== input.supersedesReviewId) {
        throw new EnterpriseRagHumanReviewError("SUPERSEDED_REVIEW_INVALID", "只能追加修订当前评审人的同一报告最新记录。", 400);
      }
      const latestByReviewer = new Map<number, any>();
      for (const row of priorRows) if (!supersededIds.has(String(row.id)) && !latestByReviewer.has(Number(row.reviewerUserId))) latestByReviewer.set(Number(row.reviewerUserId), row);
      latestByReviewer.set(actor!.id, { humanVerdict: computed.humanVerdict, gates: input.gates, alignment: computed.diff.alignment });
      const active = [...latestByReviewer.values()];
      const conflict = active.length > 1 && (new Set(active.map((row) => row.humanVerdict)).size > 1 || RAG_GATES.some(({ id }) => new Set(active.map((row) => row.gates.find((gate: GateJudgment) => gate.id === id)?.status)).size > 1));
      const hasActionableDisagreement = active.some((row) => !["aligned", "insufficient_information"].includes(String(row.alignment)));
      const hasInsufficientInformation = active.some((row) => row.alignment === "insufficient_information");
      const caseStatus: EnterpriseRagReviewCaseStatus = conflict ? "needs_reconciliation"
        : hasActionableDisagreement ? "pending_analysis"
        : hasInsufficientInformation ? "insufficient_information"
        : "aligned";
      const evaluator = snapshot.report.evaluator;
      const row = {
        id: reviewId, enterpriseProjectId: context.enterpriseProjectId, accountUserId: context.accountUserId,
        operationId: input.operationId, reportId: input.reportId, reviewerUserId: actor!.id,
        reviewerDisplayName: identity.public.displayName, clientRequestId: input.clientRequestId, requestHash, contentHash,
        supersedesReviewId: input.supersedesReviewId ?? null, questionSnapshot: snapshot.input.question, answerSnapshot: snapshot.input.answer,
        knowledgeSnapshot: snapshot.report.knowledgeBase, aiReportSnapshot: snapshot.report,
        evaluationVersionId: `${evaluator.ruleVersion}+skill-${evaluator.skillVersion}`,
        promptVersion: `enterprise-rag-skill-${evaluator.skillVersion}`, promptHash: evaluator.skillHash,
        ruleVersion: evaluator.ruleVersion, skillVersion: evaluator.skillVersion, judgeVersion: evaluator.judgeVersion, modelVersion: evaluator.model,
        humanVerdict: computed.humanVerdict, humanScore: computed.humanScore, alignment: computed.diff.alignment, caseStatus,
        dimensions: input.dimensions, gates: input.gates, diff: computed.diff,
      };
      await tx.insert(model.enterpriseRagHumanReviews).values(row);
      await tx.update(model.enterpriseRagReviewCases).set({ status: caseStatus, revision: Number(caseRow.revision ?? 0) + 1, updatedAt: new Date() }).where(eq(model.enterpriseRagReviewCases.id, caseRow.id));
      await tx.insert(model.enterpriseRagReviewCaseEvents).values({
        id: randomUUID(), caseId: caseRow.id, actorUserId: actor!.id,
        clientRequestId: input.clientRequestId, requestHash,
        eventType: conflict ? "conflict_detected" : "review_appended", payload: { reviewId, alignment: computed.diff.alignment, caseStatus },
      });
      persisted = { ...row, createdAt: new Date() };
      });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const replay = (await db.select().from(model.enterpriseRagHumanReviews).where(and(
        eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
        eq(model.enterpriseRagHumanReviews.reviewerUserId, actor!.id),
        eq(model.enterpriseRagHumanReviews.clientRequestId, input.clientRequestId),
      )).limit(1))[0] ?? (await db.select().from(model.enterpriseRagHumanReviews).where(and(
        eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
        eq(model.enterpriseRagHumanReviews.reportId, input.reportId),
        eq(model.enterpriseRagHumanReviews.reviewerUserId, actor!.id),
        eq(model.enterpriseRagHumanReviews.contentHash, contentHash),
      )).limit(1))[0];
      if (!replay) throw new EnterpriseRagHumanReviewError("REVIEW_CONCURRENT_WRITE", "并发评审正在结算，请重新读取。", 409);
      if (replay.clientRequestId === input.clientRequestId && replay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "本次评审请求标识已用于其他内容。");
      persisted = replay;
    }
    persisted = (await db.select().from(model.enterpriseRagHumanReviews).where(and(
      eq(model.enterpriseRagHumanReviews.id, persisted.id),
      eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
    )).limit(1))[0] ?? persisted;
    const review = dto(await withCurrentCaseStatus(db, persisted)); return { review, diff: review.diff };
  }
  async function lineage(reportId: string) {
    assertActor();
    const parsed = z.string().uuid().parse(reportId);
    const db = await database();
    const reviews = await db.select().from(model.enterpriseRagHumanReviews).where(and(
      eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId), eq(model.enterpriseRagHumanReviews.reportId, parsed),
    )).orderBy(desc(model.enterpriseRagHumanReviews.createdAt));
    const caseRow = (await db.select().from(model.enterpriseRagReviewCases).where(and(
      eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId), eq(model.enterpriseRagReviewCases.reportId, parsed),
    )).limit(1))[0] ?? null;
    const events = caseRow ? await db.select().from(model.enterpriseRagReviewCaseEvents).where(eq(model.enterpriseRagReviewCaseEvents.caseId, caseRow.id)).orderBy(desc(model.enterpriseRagReviewCaseEvents.createdAt)) : [];
    const proposals = caseRow ? await db.select({
      id: model.enterpriseRagOptimizationProposals.id,
      scope: model.enterpriseRagOptimizationProposals.scope,
      status: model.enterpriseRagOptimizationProposals.status,
      caseIds: model.enterpriseRagOptimizationProposals.caseIds,
      citedCaseIds: model.enterpriseRagOptimizationProposals.citedCaseIds,
      createdAt: model.enterpriseRagOptimizationProposals.createdAt,
      updatedAt: model.enterpriseRagOptimizationProposals.updatedAt,
    }).from(model.enterpriseRagOptimizationProposals).where(and(
      eq(model.enterpriseRagOptimizationProposals.enterpriseProjectId, context.enterpriseProjectId),
      sql`JSON_CONTAINS(${model.enterpriseRagOptimizationProposals.caseIds}, JSON_QUOTE(${caseRow.id}))`,
    )).orderBy(desc(model.enterpriseRagOptimizationProposals.createdAt)) : [];
    const proposalIds = proposals.map((row: any) => String(row.id));
    const regressionRuns = proposalIds.length ? await db.select({
      id: model.enterpriseRagRegressionRuns.id,
      proposalId: model.enterpriseRagRegressionRuns.proposalId,
      baselineVersionId: model.enterpriseRagRegressionRuns.baselineVersionId,
      candidateVersionId: model.enterpriseRagRegressionRuns.candidateVersionId,
      datasetHash: model.enterpriseRagRegressionRuns.datasetHash,
      status: model.enterpriseRagRegressionRuns.status,
      gateStatus: model.enterpriseRagRegressionRuns.gateStatus,
      metrics: model.enterpriseRagRegressionRuns.metrics,
      createdAt: model.enterpriseRagRegressionRuns.createdAt,
      completedAt: model.enterpriseRagRegressionRuns.completedAt,
    }).from(model.enterpriseRagRegressionRuns).where(inArray(model.enterpriseRagRegressionRuns.proposalId, proposalIds)).orderBy(desc(model.enterpriseRagRegressionRuns.createdAt)) : [];
    const runIds = regressionRuns.map((row: any) => String(row.id));
    const regressionResults = caseRow && runIds.length ? await db.select({
      id: model.enterpriseRagRegressionResults.id,
      runId: model.enterpriseRagRegressionResults.runId,
      caseKey: model.enterpriseRagRegressionResults.caseKey,
      result: model.enterpriseRagRegressionResults.result,
      createdAt: model.enterpriseRagRegressionResults.createdAt,
    }).from(model.enterpriseRagRegressionResults).where(and(
      inArray(model.enterpriseRagRegressionResults.runId, runIds),
      inArray(model.enterpriseRagRegressionResults.caseKey, [String(caseRow.id), String(caseRow.reportId), String(caseRow.operationId)]),
    )).orderBy(desc(model.enterpriseRagRegressionResults.createdAt)) : [];
    const evaluationVersionIds = [...new Set([
      ...reviews.map((row: any) => row.evaluationVersionId),
      ...regressionRuns.flatMap((row: any) => [row.baselineVersionId, row.candidateVersionId]),
      caseRow?.resolvedEvaluationVersionId,
    ].filter((value): value is string => typeof value === "string" && value.length > 0))];
    const versionRelation = evaluationVersionIds.length && proposalIds.length
      ? or(
          inArray(model.enterpriseRagEvaluationVersions.id, evaluationVersionIds),
          inArray(model.enterpriseRagEvaluationVersions.sourceProposalId, proposalIds),
        )
      : evaluationVersionIds.length
        ? inArray(model.enterpriseRagEvaluationVersions.id, evaluationVersionIds)
        : proposalIds.length
          ? inArray(model.enterpriseRagEvaluationVersions.sourceProposalId, proposalIds)
          : null;
    const linkedEvaluationVersions = versionRelation ? await db.select({
      id: model.enterpriseRagEvaluationVersions.id,
      status: model.enterpriseRagEvaluationVersions.status,
      manifestHash: model.enterpriseRagEvaluationVersions.manifestHash,
      sourceProposalId: model.enterpriseRagEvaluationVersions.sourceProposalId,
      createdAt: model.enterpriseRagEvaluationVersions.createdAt,
    }).from(model.enterpriseRagEvaluationVersions).where(versionRelation) : [];
    const relatedEvaluationVersionIds = [...new Set([
      ...evaluationVersionIds,
      ...linkedEvaluationVersions.map((row: any) => row.id),
    ].filter((value): value is string => typeof value === "string" && value.length > 0))];
    const candidateChannels = relatedEvaluationVersionIds.length ? await db.select({
      id: model.enterpriseRagEvaluationChannels.id,
      scope: model.enterpriseRagEvaluationChannels.scope,
      enterpriseProjectId: model.enterpriseRagEvaluationChannels.enterpriseProjectId,
      activeVersionId: model.enterpriseRagEvaluationChannels.activeVersionId,
      revision: model.enterpriseRagEvaluationChannels.revision,
      updatedAt: model.enterpriseRagEvaluationChannels.updatedAt,
    }).from(model.enterpriseRagEvaluationChannels).where(or(
      eq(model.enterpriseRagEvaluationChannels.scope, "global"),
      and(eq(model.enterpriseRagEvaluationChannels.scope, "workspace"), eq(model.enterpriseRagEvaluationChannels.enterpriseProjectId, context.enterpriseProjectId)),
    )) : [];
    const allowedChannelIds = candidateChannels.map((row: any) => String(row.id));
    const releaseRelations = [
      ...(relatedEvaluationVersionIds.length ? [
        inArray(model.enterpriseRagReleaseEvents.fromVersionId, relatedEvaluationVersionIds),
        inArray(model.enterpriseRagReleaseEvents.toVersionId, relatedEvaluationVersionIds),
      ] : []),
      ...(runIds.length ? [inArray(model.enterpriseRagReleaseEvents.regressionRunId, runIds)] : []),
    ];
    const releaseEvents = allowedChannelIds.length && releaseRelations.length ? await db.select({
      id: model.enterpriseRagReleaseEvents.id,
      channelId: model.enterpriseRagReleaseEvents.channelId,
      action: model.enterpriseRagReleaseEvents.action,
      fromVersionId: model.enterpriseRagReleaseEvents.fromVersionId,
      toVersionId: model.enterpriseRagReleaseEvents.toVersionId,
      regressionRunId: model.enterpriseRagReleaseEvents.regressionRunId,
      createdAt: model.enterpriseRagReleaseEvents.createdAt,
    }).from(model.enterpriseRagReleaseEvents).where(and(
      inArray(model.enterpriseRagReleaseEvents.channelId, allowedChannelIds),
      releaseRelations.length === 1 ? releaseRelations[0] : or(...releaseRelations),
    )).orderBy(desc(model.enterpriseRagReleaseEvents.createdAt)) : [];
    const eventVersionIds = [...new Set(releaseEvents.flatMap((row: any) => [row.fromVersionId, row.toVersionId])
      .filter((value): value is string => typeof value === "string" && value.length > 0))];
    const missingEventVersionIds = eventVersionIds.filter((id) => !relatedEvaluationVersionIds.includes(id));
    const eventEvaluationVersions = missingEventVersionIds.length ? await db.select({
      id: model.enterpriseRagEvaluationVersions.id,
      status: model.enterpriseRagEvaluationVersions.status,
      manifestHash: model.enterpriseRagEvaluationVersions.manifestHash,
      sourceProposalId: model.enterpriseRagEvaluationVersions.sourceProposalId,
      createdAt: model.enterpriseRagEvaluationVersions.createdAt,
    }).from(model.enterpriseRagEvaluationVersions).where(inArray(model.enterpriseRagEvaluationVersions.id, missingEventVersionIds)) : [];
    const evaluationVersions = [...linkedEvaluationVersions, ...eventEvaluationVersions];
    const linkedChannelIds = new Set(releaseEvents.map((row: any) => String(row.channelId)));
    const evaluationVersionIdSet = new Set([...relatedEvaluationVersionIds, ...eventVersionIds]);
    const channels = candidateChannels.filter((row: any) => linkedChannelIds.has(String(row.id)) || evaluationVersionIdSet.has(String(row.activeVersionId)));
    const frozenReview = reviews[0] ?? null;
    return {
      reportId: parsed,
      automaticReport: frozenReview?.aiReportSnapshot ?? null,
      frozenEvaluation: frozenReview ? {
        evaluationVersionId: frozenReview.evaluationVersionId,
        promptVersion: frozenReview.promptVersion,
        promptHash: frozenReview.promptHash,
        ruleVersion: frozenReview.ruleVersion,
        skillVersion: frozenReview.skillVersion,
        judgeVersion: frozenReview.judgeVersion,
        modelVersion: frozenReview.modelVersion,
      } : null,
      reviews: reviews.map((row: any) => dto(caseRow ? { ...row, caseStatus: caseRow.status } : row)),
      case: caseRow,
      events,
      proposals,
      regressionRuns,
      regressionResults,
      evaluationVersions,
      releaseEvents,
      channels,
    };
  }
  async function reconcile(caseId: string, value: unknown) {
    assertActor();
    if (actor!.role !== "admin" || !["delivery_admin", "system_admin"].includes(String(actor!.adminAccessLevel))) {
      throw new EnterpriseRagHumanReviewError("RECONCILIATION_FORBIDDEN", "只有有权管理员可以复核冲突的人工结论。", 403);
    }
    const id = z.string().uuid().parse(caseId);
    const input = z.object({
      clientRequestId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      reviewId: z.string().uuid(),
      status: z.enum(["aligned", "pending_analysis", "insufficient_information", "not_adopted"]),
      reason: z.string().trim().min(1).max(2_000),
    }).strict().parse(value);
    const db = await database();
    const requestHash = intentHash(input);
    const existing = (await db.select().from(model.enterpriseRagReviewCaseEvents).where(and(
      eq(model.enterpriseRagReviewCaseEvents.caseId, id),
      eq(model.enterpriseRagReviewCaseEvents.actorUserId, actor!.id),
      eq(model.enterpriseRagReviewCaseEvents.clientRequestId, input.clientRequestId),
    )).limit(1))[0];
    if (existing) {
      if (existing.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "复核请求标识已用于其他内容。");
      return { caseId: id, status: existing.payload?.status, revision: existing.payload?.revision };
    }
    return db.transaction(async (tx: any) => {
      const caseRow = (await tx.select().from(model.enterpriseRagReviewCases).where(and(
        eq(model.enterpriseRagReviewCases.id, id),
        eq(model.enterpriseRagReviewCases.enterpriseProjectId, context.enterpriseProjectId),
      )).limit(1).for("update"))[0];
      if (!caseRow) throw new EnterpriseRagHumanReviewError("REVIEW_CASE_NOT_FOUND", "人工评审案例不存在。", 404);
      const concurrentReplay = (await tx.select().from(model.enterpriseRagReviewCaseEvents).where(and(
        eq(model.enterpriseRagReviewCaseEvents.caseId, id),
        eq(model.enterpriseRagReviewCaseEvents.actorUserId, actor!.id),
        eq(model.enterpriseRagReviewCaseEvents.clientRequestId, input.clientRequestId),
      )).limit(1))[0];
      if (concurrentReplay) {
        if (concurrentReplay.requestHash !== requestHash) throw new EnterpriseRagHumanReviewError("IDEMPOTENCY_CONFLICT", "复核请求标识已用于其他内容。");
        return { caseId: id, status: concurrentReplay.payload?.status, revision: concurrentReplay.payload?.revision };
      }
      if (caseRow.status !== "needs_reconciliation") throw new EnterpriseRagHumanReviewError("RECONCILIATION_NOT_REQUIRED", "当前案例不在冲突复核状态。");
      if (Number(caseRow.revision) !== input.expectedRevision) throw new EnterpriseRagHumanReviewError("REVIEW_CASE_REVISION_CONFLICT", "人工评审案例已更新，请重新读取。");
      const review = (await tx.select().from(model.enterpriseRagHumanReviews).where(and(
        eq(model.enterpriseRagHumanReviews.id, input.reviewId),
        eq(model.enterpriseRagHumanReviews.reportId, caseRow.reportId),
        eq(model.enterpriseRagHumanReviews.enterpriseProjectId, context.enterpriseProjectId),
      )).limit(1))[0];
      if (!review) throw new EnterpriseRagHumanReviewError("RECONCILIATION_REVIEW_INVALID", "复核结论必须引用该案例的原始人工评审。", 400);
      const derivedStatus: EnterpriseRagReviewCaseStatus = review.alignment === "aligned" ? "aligned"
        : review.alignment === "insufficient_information" ? "insufficient_information" : "pending_analysis";
      if (input.status !== "not_adopted" && input.status !== derivedStatus) {
        throw new EnterpriseRagHumanReviewError("RECONCILIATION_STATUS_INVALID", "复核状态必须由所选不可变人工评审结论确定性派生。", 400);
      }
      const resolvedStatus = input.status === "not_adopted" ? "not_adopted" : derivedStatus;
      await tx.update(model.enterpriseRagReviewCases).set({ status: resolvedStatus, revision: Number(caseRow.revision) + 1, updatedAt: new Date() }).where(eq(model.enterpriseRagReviewCases.id, id));
      await tx.insert(model.enterpriseRagReviewCaseEvents).values({
        id: randomUUID(), caseId: id, actorUserId: actor!.id, clientRequestId: input.clientRequestId, requestHash,
        eventType: resolvedStatus === "not_adopted" ? "not_adopted" : "reconciled",
        payload: { reviewId: input.reviewId, status: resolvedStatus, reason: input.reason, revision: Number(caseRow.revision) + 1 },
      });
      return { caseId: id, status: resolvedStatus, revision: Number(caseRow.revision) + 1 };
    });
  }
  return { context: contextDto, list, create, lineage, reconcile };
}
