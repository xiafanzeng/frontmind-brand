// @vitest-environment node
import type { Request } from "express";
import { MySqlDialect, int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import type { DimensionJudgment, GateJudgment } from "../client/dashboard/ai-website-preview/rag-evaluation.js";
import { RAG_DIMENSIONS, RAG_GATES } from "../client/dashboard/ai-website-preview/rag-evaluation.js";
import type { BrandKeywordPorts } from "../server/brand-keyword-ports.js";
import type { ModuleHttpCore } from "../server/http-api.js";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime.js";

const evaluationMock = vi.hoisted(() => ({ snapshot: null as any, calls: 0 }));
vi.mock("../server/enterprise-rag-evaluation-service.js", () => ({
  createEnterpriseRagEvaluationService: () => ({
    reviewSnapshot: async () => {
      evaluationMock.calls += 1;
      return evaluationMock.snapshot;
    },
  }),
}));

import {
  createEnterpriseRagHumanReviewService,
  EnterpriseRagHumanReviewError,
} from "../server/enterprise-rag-human-review-service.js";

const OPERATION_ID = "00000000-0000-4000-8000-000000000101";
const REPORT_ID = "00000000-0000-4000-8000-000000000102";
const REQUEST_ID = "00000000-0000-4000-8000-000000000103";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000201";
const RUN_ID = "00000000-0000-4000-8000-000000000202";
const RESULT_ID = "00000000-0000-4000-8000-000000000203";
const RELEASE_ID = "00000000-0000-4000-8000-000000000204";
const CANDIDATE_VERSION_ID = "rag-eval-candidate-2";

const dimensions = (level: 0 | 1 | 2 | 3 | 4 = 4): DimensionJudgment[] => RAG_DIMENSIONS.map(({ id }) => ({
  id,
  level,
  rationale: "已依据冻结资料核验。",
  evidenceIds: ["answer:a"],
  applicable: true,
}));
const gates = (status: GateJudgment["status"] = "passed"): GateJudgment[] => RAG_GATES.map(({ id }) => ({
  id,
  status,
  reason: "已核验。",
}));

function frozenSnapshot() {
  const report = {
    reportId: REPORT_ID,
    sourceQaTaskId: "00000000-0000-4000-8000-000000000104",
    sourceTurnId: "00000000-0000-4000-8000-000000000105",
    conversationId: "conversation",
    questionMessageId: "q",
    answerMessageId: "a",
    questionHash: "q",
    answerHash: "a",
    knowledgeBase: { snapshotId: "snapshot", version: 3, sourceFileName: "knowledge.zip", documentCount: 1, contentHash: "knowledge-hash" },
    evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "3.0.0", ruleVersion: "rag-eval-1.4", judgeVersion: "3.0.0", provider: "xty_codex", model: "model", effort: null, skillHash: "a".repeat(64), outputHash: "b".repeat(64) },
    judgments: { schemaVersion: 3, operationToken: "token", inputHash: "input-hash", checks: [], claims: [], summary: "ok", task: { status: "completed", rationale: "ok", evidenceIds: ["answer:a"] }, findings: [], gates: gates().map((item) => ({ ...item, evidenceIds: ["answer:a"] })) },
    result: {
      answerVerdict: "usable",
      skillId: "enterprise-rag-evaluation",
      version: "3.0.0",
      status: "completed",
      score: 100,
      coverage: 100,
      recommendation: "recommended",
      summary: "ok",
      dimensions: RAG_DIMENSIONS.map(({ id, label, weight }) => ({ id, label, status: "passed", score: weight, maxScore: weight, summary: "ok", evidenceIds: ["answer:a"] })),
      risks: [],
      relatedReportIds: [],
    },
    createdAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
  };
  return {
    operationId: OPERATION_ID,
    report,
    input: {
      question: "门诊时间是什么？",
      answer: "门诊时间为 8:00。",
      allowedEvidenceIds: ["answer:a"],
      knowledgeBase: report.knowledgeBase,
    },
    operation: { provider: "xty_codex", model: "model" },
  };
}

function harness() {
  const users = mysqlTable("review_users_test", {
    id: int("id"), displayName: varchar("displayName", { length: 128 }), username: varchar("username", { length: 128 }),
    name: varchar("name", { length: 128 }), role: varchar("role", { length: 32 }), adminAccessLevel: varchar("adminAccessLevel", { length: 32 }),
    engineerRoleType: varchar("engineerRoleType", { length: 64 }), isActive: int("isActive"),
  });
  const assignments = mysqlTable("review_assignments_test", {
    id: varchar("id", { length: 36 }), customerUserId: int("customerUserId"), engineerUserId: int("engineerUserId"), roleType: varchar("roleType", { length: 64 }),
  });
  const reviews = mysqlTable("reviews_test", {
    id: varchar("id", { length: 36 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }), accountUserId: int("accountUserId"),
    operationId: varchar("operationId", { length: 36 }), reportId: varchar("reportId", { length: 36 }), reviewerUserId: int("reviewerUserId"),
    reviewerDisplayName: varchar("reviewerDisplayName", { length: 128 }), clientRequestId: varchar("clientRequestId", { length: 36 }),
    requestHash: varchar("requestHash", { length: 64 }), contentHash: varchar("contentHash", { length: 64 }), supersedesReviewId: varchar("supersedesReviewId", { length: 36 }),
    questionSnapshot: varchar("questionSnapshot", { length: 1000 }), answerSnapshot: varchar("answerSnapshot", { length: 1000 }),
    knowledgeSnapshot: json("knowledgeSnapshot"), aiReportSnapshot: json("aiReportSnapshot"), evaluationVersionId: varchar("evaluationVersionId", { length: 96 }),
    promptVersion: varchar("promptVersion", { length: 96 }), promptHash: varchar("promptHash", { length: 64 }),
    promptTemplateFrozen: int("promptTemplateFrozen"), sourceBundleHash: varchar("sourceBundleHash", { length: 64 }), ruleVersion: varchar("ruleVersion", { length: 96 }),
    skillVersion: varchar("skillVersion", { length: 96 }), judgeVersion: varchar("judgeVersion", { length: 96 }), modelVersion: varchar("modelVersion", { length: 191 }),
    humanScoringVersion: varchar("humanScoringVersion", { length: 96 }), humanScoringHash: varchar("humanScoringHash", { length: 64 }),
    humanVerdict: varchar("humanVerdict", { length: 32 }), humanScore: int("humanScore"), alignment: varchar("alignment", { length: 32 }),
    caseStatus: varchar("caseStatus", { length: 32 }), dimensions: json("dimensions"), gates: json("gates"), diff: json("diff"), createdAt: timestamp("createdAt"),
  });
  const cases = mysqlTable("review_cases_test", {
    id: varchar("id", { length: 36 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }), accountUserId: int("accountUserId"),
    operationId: varchar("operationId", { length: 36 }), reportId: varchar("reportId", { length: 36 }), status: varchar("status", { length: 32 }),
    revision: int("revision"), resolvedEvaluationVersionId: varchar("resolvedEvaluationVersionId", { length: 96 }), createdAt: timestamp("createdAt"), updatedAt: timestamp("updatedAt"),
  });
  const events = mysqlTable("review_events_test", {
    id: varchar("id", { length: 36 }), caseId: varchar("caseId", { length: 36 }), actorUserId: int("actorUserId"),
    clientRequestId: varchar("clientRequestId", { length: 36 }), requestHash: varchar("requestHash", { length: 64 }), eventType: varchar("eventType", { length: 64 }),
    payload: json("payload"), createdAt: timestamp("createdAt"),
  });
  const optimizationProposals = mysqlTable("review_proposals_test", {
    id: varchar("id", { length: 36 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }), scope: varchar("scope", { length: 32 }),
    status: varchar("status", { length: 32 }), caseIds: json("caseIds"), citedCaseIds: json("citedCaseIds"),
    createdAt: timestamp("createdAt"), updatedAt: timestamp("updatedAt"),
  });
  const regressionRuns = mysqlTable("review_regression_runs_test", {
    id: varchar("id", { length: 36 }), proposalId: varchar("proposalId", { length: 36 }), baselineVersionId: varchar("baselineVersionId", { length: 96 }),
    candidateVersionId: varchar("candidateVersionId", { length: 96 }), datasetHash: varchar("datasetHash", { length: 64 }), status: varchar("status", { length: 32 }),
    gateStatus: varchar("gateStatus", { length: 32 }), metrics: json("metrics"), createdAt: timestamp("createdAt"), completedAt: timestamp("completedAt"),
  });
  const regressionResults = mysqlTable("review_regression_results_test", {
    id: varchar("id", { length: 36 }), runId: varchar("runId", { length: 36 }), caseKey: varchar("caseKey", { length: 191 }),
    result: json("result"), createdAt: timestamp("createdAt"),
  });
  const evaluationVersions = mysqlTable("review_evaluation_versions_test", {
    id: varchar("id", { length: 96 }), status: varchar("status", { length: 32 }), manifestHash: varchar("manifestHash", { length: 64 }),
    sourceProposalId: varchar("sourceProposalId", { length: 36 }), createdAt: timestamp("createdAt"),
  });
  const evaluationChannels = mysqlTable("review_evaluation_channels_test", {
    id: varchar("id", { length: 96 }), scope: varchar("scope", { length: 32 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    activeVersionId: varchar("activeVersionId", { length: 96 }), revision: int("revision"), updatedAt: timestamp("updatedAt"),
  });
  const releaseEvents = mysqlTable("review_release_events_test", {
    id: varchar("id", { length: 36 }), channelId: varchar("channelId", { length: 96 }), action: varchar("action", { length: 32 }),
    fromVersionId: varchar("fromVersionId", { length: 96 }), toVersionId: varchar("toVersionId", { length: 96 }), regressionRunId: varchar("regressionRunId", { length: 36 }),
    createdAt: timestamp("createdAt"),
  });
  const rows = {
    users: [
      { id: 7, displayName: "评审甲", username: "reviewer-a", name: "评审甲", role: "delivery_member", adminAccessLevel: null, engineerRoleType: "monitoring_optimization_engineer", isActive: 1 },
      { id: 8, displayName: "评审乙", username: "reviewer-b", name: "评审乙", role: "delivery_member", adminAccessLevel: null, engineerRoleType: "monitoring_optimization_engineer", isActive: 1 },
      { id: 9, displayName: "客户", username: "customer", name: "客户", role: "user", adminAccessLevel: null, engineerRoleType: null, isActive: 1 },
      { id: 10, displayName: "管理员", username: "admin", name: "管理员", role: "admin", adminAccessLevel: "delivery_admin", engineerRoleType: null, isActive: 1 },
    ],
    assignments: [
      { id: "assignment-a", customerUserId: 42, engineerUserId: 7, roleType: "monitoring_optimization_engineer" },
      { id: "assignment-b", customerUserId: 42, engineerUserId: 8, roleType: "monitoring_optimization_engineer" },
    ],
    reviews: [] as any[], cases: [] as any[], events: [] as any[],
    optimizationProposals: [] as any[], regressionRuns: [] as any[], regressionResults: [] as any[],
    evaluationVersions: [] as any[], evaluationChannels: [] as any[], releaseEvents: [] as any[],
  };
  const dialect = new MySqlDialect();
  const values = (predicate: any) => predicate ? dialect.sqlToQuery(predicate).params : [];
  const primitiveValues = (value: any): any[] => value === null || ["string", "number", "boolean"].includes(typeof value)
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(primitiveValues)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(primitiveValues)
        : [];
  const matches = (table: any, row: any, predicate: any) => {
    const params = values(predicate);
    if (table === optimizationProposals) return params.includes(row.enterpriseProjectId) && row.caseIds.some((id: string) => params.includes(id));
    if (table === regressionRuns) return params.includes(row.proposalId);
    if (table === regressionResults) return params.includes(row.runId) && params.includes(row.caseKey);
    if (table === evaluationVersions) return params.includes(row.id) || params.includes(row.sourceProposalId);
    if (table === evaluationChannels) return row.scope === "global" ? params.includes("global") : params.includes("workspace") && params.includes(row.enterpriseProjectId);
    if (table === releaseEvents) return params.includes(row.channelId) && [row.fromVersionId, row.toVersionId, row.regressionRunId].some((value) => params.includes(value));
    const rowValues = primitiveValues(row);
    return params.every((value) => rowValues.includes(value));
  };
  const sourceRows = (table: any) => table === users ? rows.users
    : table === assignments ? rows.assignments
      : table === reviews ? rows.reviews
        : table === cases ? rows.cases
          : table === events ? rows.events
            : table === optimizationProposals ? rows.optimizationProposals
              : table === regressionRuns ? rows.regressionRuns
                : table === regressionResults ? rows.regressionResults
                  : table === evaluationVersions ? rows.evaluationVersions
                    : table === evaluationChannels ? rows.evaluationChannels
                      : table === releaseEvents ? rows.releaseEvents
                        : [];
  const project = (fields: any, row: any) => fields ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]])) : row;
  class Query implements PromiseLike<any[]> {
    private table: any; private predicate: any; private maximum = Number.POSITIVE_INFINITY;
    constructor(private fields?: any) {}
    from(table: any) { this.table = table; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    orderBy() { return this; }
    limit(maximum: number) { this.maximum = maximum; return this; }
    for() { return this; }
    then<TResult1 = any[], TResult2 = never>(onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      const result = sourceRows(this.table).filter((row) => matches(this.table, row, this.predicate)).slice(0, this.maximum).map((row) => project(this.fields, structuredClone(row)));
      return Promise.resolve(result).then(onfulfilled, onrejected);
    }
  }
  class Insert implements PromiseLike<void> {
    private value: any; private ignoreDuplicate = false; private executed = false;
    constructor(private table: any) {}
    values(value: any) { this.value = value; return this; }
    onDuplicateKeyUpdate() { this.ignoreDuplicate = true; return this; }
    private run() {
      if (this.executed) return; this.executed = true;
      const target = sourceRows(this.table);
      const duplicate = this.table === cases
        ? target.find((row) => row.enterpriseProjectId === this.value.enterpriseProjectId && row.reportId === this.value.reportId)
        : this.table === reviews
          ? target.find((row) => row.enterpriseProjectId === this.value.enterpriseProjectId && row.reviewerUserId === this.value.reviewerUserId && (row.clientRequestId === this.value.clientRequestId || row.reportId === this.value.reportId && row.contentHash === this.value.contentHash))
          : this.table === events && this.value.clientRequestId
            ? target.find((row) => row.caseId === this.value.caseId && row.actorUserId === this.value.actorUserId && row.clientRequestId === this.value.clientRequestId)
            : undefined;
      if (duplicate && this.ignoreDuplicate) return;
      if (duplicate) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY", errno: 1062 });
      target.push({ ...structuredClone(this.value), createdAt: this.value.createdAt ?? new Date(), updatedAt: this.value.updatedAt ?? new Date() });
    }
    then<TResult1 = void, TResult2 = never>(onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
    }
  }
  const db: any = {
    select(fields?: any) { return new Query(fields); },
    insert(table: any) { return new Insert(table); },
    update(table: any) { return { set: (updates: any) => ({ where: async (predicate: any) => {
      for (const row of sourceRows(table).filter((candidate) => matches(table, candidate, predicate))) Object.assign(row, structuredClone(updates));
    } }) }; },
    async transaction(work: (executor: any) => Promise<any>) { return work(db); },
  };
  registerIntentSkillPorts({
    users,
    deliveryProjectAssignments: assignments,
    enterpriseRagHumanReviews: reviews,
    enterpriseRagReviewCases: cases,
    enterpriseRagReviewCaseEvents: events,
    enterpriseRagOptimizationProposals: optimizationProposals,
    enterpriseRagRegressionRuns: regressionRuns,
    enterpriseRagRegressionResults: regressionResults,
    enterpriseRagEvaluationVersions: evaluationVersions,
    enterpriseRagEvaluationChannels: evaluationChannels,
    enterpriseRagReleaseEvents: releaseEvents,
  } as unknown as BrandKeywordPorts);
  const core = (actorUserId: number, enterpriseProjectId = "project"): ModuleHttpCore => ({
    context: () => ({ accountUserId: 42, actorUserId, enterpriseProjectId, businessOwnerId: "42", businessActorId: String(actorUserId) }),
    database: async () => db,
    environment: {},
  });
  const service = (actorUserId: number, enterpriseProjectId = "project") => createEnterpriseRagHumanReviewService(core(actorUserId, enterpriseProjectId), {
    frontmindUser: {
      id: actorUserId,
      role: rows.users.find((item) => item.id === actorUserId)?.role,
      adminAccessLevel: rows.users.find((item) => item.id === actorUserId)?.adminAccessLevel,
    },
  } as unknown as Request);
  return { rows, service };
}

function input(clientRequestId = REQUEST_ID, humanDimensions = dimensions(), humanGates = gates(), supersedesReviewId?: string) {
  return { clientRequestId, operationId: OPERATION_ID, reportId: REPORT_ID, dimensions: humanDimensions, gates: humanGates, confirmed: true, ...(supersedesReviewId ? { supersedesReviewId } : {}) };
}

describe("enterprise RAG formal human-review persistence", () => {
  it("persists an append-only trusted snapshot and replays retries without duplicating it", async () => {
    evaluationMock.snapshot = frozenSnapshot(); evaluationMock.calls = 0;
    const before = structuredClone(evaluationMock.snapshot.report);
    const { rows, service } = harness();

    const first = await service(7).create(input());
    const replay = await service(7).create(input());
    const contentReplay = await service(7).create(input("00000000-0000-4000-8000-000000000106"));

    expect(first.review.id).toBe(replay.review.id);
    expect(contentReplay.review.id).toBe(first.review.id);
    expect(contentReplay.review.clientRequestId).toBe(REQUEST_ID);
    expect(rows.reviews).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.reviews[0]).toMatchObject({
      questionSnapshot: "门诊时间是什么？",
      answerSnapshot: "门诊时间为 8:00。",
      evaluationVersionId: "rag-eval-1.4+skill-3.0.0",
      promptVersion: "unfrozen",
      promptHash: "0".repeat(64),
      promptTemplateFrozen: false,
      sourceBundleHash: "a".repeat(64),
      ruleVersion: "rag-eval-1.4",
      skillVersion: "3.0.0",
      modelVersion: "model",
      humanScoringVersion: "human-review-1.0.0",
    });
    expect(rows.reviews[0].humanScoringHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.review.humanScoring).toEqual({
      version: "human-review-1.0.0",
      hash: rows.reviews[0].humanScoringHash,
    });
    expect(evaluationMock.snapshot.report).toEqual(before);
    expect(rows.reviews[0].aiReportSnapshot).toEqual(before);
  });

  it("projects the complete immutable report-to-release lineage without leaking another workspace", async () => {
    evaluationMock.snapshot = frozenSnapshot(); evaluationMock.calls = 0;
    const { rows, service } = harness();
    const created = await service(7).create(input());
    const caseId = rows.cases[0].id;
    const createdAt = new Date("2026-11-08T00:00:00.000Z");
    const legacyVersionId = "rag-eval-1.4+skill-3.0.0";
    rows.optimizationProposals.push(
      { id: PROPOSAL_ID, enterpriseProjectId: "project", scope: "workspace", status: "completed", caseIds: [caseId], citedCaseIds: [caseId], createdAt, updatedAt: createdAt },
      { id: "00000000-0000-4000-8000-000000000211", enterpriseProjectId: "other-project", scope: "workspace", status: "completed", caseIds: [caseId], citedCaseIds: [caseId], createdAt, updatedAt: createdAt },
    );
    rows.regressionRuns.push({
      id: RUN_ID, proposalId: PROPOSAL_ID, baselineVersionId: legacyVersionId, candidateVersionId: CANDIDATE_VERSION_ID,
      datasetHash: "dataset", status: "completed", gateStatus: "passed", metrics: { agreement: 1 }, createdAt, completedAt: createdAt,
    });
    rows.regressionResults.push(
      { id: RESULT_ID, runId: RUN_ID, caseKey: caseId, result: { improved: true }, createdAt },
      { id: "00000000-0000-4000-8000-000000000212", runId: RUN_ID, caseKey: "unrelated-case", result: { improved: false }, createdAt },
    );
    rows.evaluationVersions.push(
      { id: legacyVersionId, status: "built_in", manifestHash: "legacy", sourceProposalId: null, createdAt },
      { id: CANDIDATE_VERSION_ID, status: "released", manifestHash: "candidate", sourceProposalId: PROPOSAL_ID, createdAt },
      { id: "other-version", status: "released", manifestHash: "other", sourceProposalId: "00000000-0000-4000-8000-000000000211", createdAt },
    );
    rows.evaluationChannels.push(
      { id: "global", scope: "global", enterpriseProjectId: null, activeVersionId: CANDIDATE_VERSION_ID, revision: 2, updatedAt: createdAt },
      { id: "other-workspace", scope: "workspace", enterpriseProjectId: "other-project", activeVersionId: CANDIDATE_VERSION_ID, revision: 2, updatedAt: createdAt },
    );
    rows.releaseEvents.push(
      { id: RELEASE_ID, channelId: "global", action: "global", fromVersionId: legacyVersionId, toVersionId: CANDIDATE_VERSION_ID, regressionRunId: RUN_ID, createdAt },
      { id: "00000000-0000-4000-8000-000000000213", channelId: "other-workspace", action: "canary", fromVersionId: legacyVersionId, toVersionId: CANDIDATE_VERSION_ID, regressionRunId: RUN_ID, createdAt },
    );
    const callsBeforeLineage = evaluationMock.calls;

    const lineage = await service(7).lineage(REPORT_ID);

    expect(evaluationMock.calls).toBe(callsBeforeLineage);
    expect(lineage.automaticReport).toEqual(evaluationMock.snapshot.report);
    expect(lineage.reviews.map((row: any) => row.id)).toEqual([created.review.id]);
    expect(lineage.case.id).toBe(caseId);
    expect(lineage.proposals.map((row: any) => row.id)).toEqual([PROPOSAL_ID]);
    expect(lineage.regressionRuns.map((row: any) => row.id)).toEqual([RUN_ID]);
    expect(lineage.regressionResults.map((row: any) => row.id)).toEqual([RESULT_ID]);
    expect(lineage.evaluationVersions.map((row: any) => row.id).sort()).toEqual([CANDIDATE_VERSION_ID, legacyVersionId].sort());
    expect(lineage.releaseEvents.map((row: any) => row.id)).toEqual([RELEASE_ID]);
    expect(lineage.channels.map((row: any) => row.id)).toEqual(["global"]);
    expect(lineage.frozenHumanScoring).toEqual(created.review.humanScoring);
    expect(lineage.frozenEvaluation).toMatchObject({
      promptVersion: "unfrozen", promptHash: "0".repeat(64),
      promptTemplateFrozen: false, sourceBundleHash: "a".repeat(64),
    });
  });

  it("rejects an idempotency key reused for changed content", async () => {
    evaluationMock.snapshot = frozenSnapshot();
    const { service } = harness();
    await service(7).create(input());
    await expect(service(7).create(input(REQUEST_ID, dimensions(2), gates("failed")))).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    } satisfies Partial<EnterpriseRagHumanReviewError>);
  });

  it("requires revisions to append through the current review instead of overwriting or forking history", async () => {
    evaluationMock.snapshot = frozenSnapshot();
    const { rows, service } = harness();
    const first = await service(7).create(input());
    const revisionRequestId = "00000000-0000-4000-8000-000000000108";

    await expect(service(7).create(input(revisionRequestId, dimensions(2), gates("failed")))).rejects.toMatchObject({
      code: "SUPERSEDES_REVIEW_REQUIRED",
      status: 409,
    });
    const revision = await service(7).create(input(revisionRequestId, dimensions(2), gates("failed"), first.review.id));
    expect(revision.review.supersedesReviewId).toBe(first.review.id);
    expect(rows.reviews).toHaveLength(2);
    expect(rows.reviews[0].humanVerdict).toBe("excellent");
  });

  it("moves conflicting reviewers into reconciliation and projects that current status without mutating reviews", async () => {
    evaluationMock.snapshot = frozenSnapshot();
    const { rows, service } = harness();
    const first = await service(7).create(input());
    const second = await service(8).create(input("00000000-0000-4000-8000-000000000107", dimensions(2), gates("failed")));
    const listed = await service(7).list(OPERATION_ID);

    expect(first.review.status).toBe("aligned");
    expect(second.review.status).toBe("needs_reconciliation");
    expect(rows.cases[0].status).toBe("needs_reconciliation");
    expect(listed.reviews).toHaveLength(2);
    expect(listed.reviews.every((review) => review.status === "needs_reconciliation")).toBe(true);
    expect(rows.reviews[0].caseStatus).toBe("aligned");
  });

  it("keeps customer accounts read-only and does not fetch the paid evaluation snapshot on a forbidden submit", async () => {
    evaluationMock.snapshot = frozenSnapshot(); evaluationMock.calls = 0;
    const { rows, service } = harness();
    await expect(service(9).create(input())).rejects.toMatchObject({ code: "REVIEW_FORBIDDEN", status: 403 });
    expect(evaluationMock.calls).toBe(0);
    expect(rows.reviews).toHaveLength(0);
  });

  it("checks the workspace scope before replaying a reconciliation idempotency event", async () => {
    evaluationMock.snapshot = frozenSnapshot();
    const { rows, service } = harness();
    await service(7).create(input());
    await service(8).create(input("00000000-0000-4000-8000-000000000107", dimensions(2), gates("failed")));
    const caseRow = rows.cases[0];
    const reconciliationRequestId = "00000000-0000-4000-8000-000000000109";
    const reconciliation = {
      clientRequestId: reconciliationRequestId,
      expectedRevision: caseRow.revision,
      reviewId: rows.reviews[0].id,
      status: "aligned",
      reason: "按第一位评审人的不可变记录复核。",
    };
    await service(10).reconcile(caseRow.id, reconciliation);

    await expect(service(10, "other-project").reconcile(caseRow.id, reconciliation)).rejects.toMatchObject({
      code: "REVIEW_CASE_NOT_FOUND",
      status: 404,
    });
  });
});
