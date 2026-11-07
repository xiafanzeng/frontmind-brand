// @vitest-environment node
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { int, MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureManusBuildReconciliationCore,
  prepareExistingManusBuildReconciliation,
  reconcileExistingManusBuild,
  type ExistingManusBuildReconciliationSnapshot,
  type ManusBuildReconciliationCore,
} from "../server/siteops/manus-build-reconciliation.js";

const mocks = vi.hoisted(() => ({
  stagedRecovery: vi.fn(),
  legacyRecovery: vi.fn(),
  reserveQuota: vi.fn(),
}));

vi.mock("../server/siteops/manus-provider.js", () => ({
  existingTaskOnlyBoundFallback: () => null,
  existingTaskOnlyRecoveryState: mocks.legacyRecovery,
  existingTaskOnlyStagedDocumentViewRecoveryState: mocks.stagedRecovery,
}));
vi.mock("../server/siteops/quota-service.js", () => ({
  reserveSiteOpsQuota: mocks.reserveQuota,
}));

const renderFailure = "BUILD_PRIMARY_RENDER_FAILED";
const serviceFailure = "FRONTMIND_BUILD_SERVICE_UNAVAILABLE";
const now = new Date("2026-11-07T07:00:00.000Z");

function snapshot(): ExistingManusBuildReconciliationSnapshot {
  return {
    build: {
      id: "build-id", projectId: "project-id", userId: 7, ordinal: 43,
      parentBuildId: "parent-id", knowledgeSnapshotId: "snapshot-id",
      quotaPeriodId: null, quotaState: null, workflowVersion: "2.9.0",
      contentPlanLocalAssetId: "plan-id", contentPlanSha256: "a".repeat(64),
      contractLocalAssetId: null, contractHash: null, sourceLocalAssetId: null,
      sourceHash: null, distLocalAssetId: null, distHash: null, qaLocalAssetId: null,
      provenanceLocalAssetId: null, upstreamManusTaskId: "task-id",
      status: "failed", errorCode: renderFailure,
      createdAt: new Date("2026-11-07T04:00:00.000Z"),
    },
    operation: {
      id: "operation-id", projectId: "project-id", userId: 7,
      buildId: "build-id", conversationTurnId: "turn-id", kind: "build_revision",
      status: "failed", provider: "xty_codex", providerTaskId: "task-id",
      errorCode: renderFailure, result: { state: "fixture" },
    },
    project: {
      id: "project-id", userId: 7, currentKnowledgeSnapshotId: "snapshot-id",
      currentBuildId: "parent-id", currentTaskStartedAt: new Date("2026-11-06T00:00:00.000Z"),
      status: "failed", revision: 12, enterpriseProjectId: null,
    },
    turn: { id: "turn-id", userId: 7, expectedRevision: 10, enterpriseProjectId: null },
    latestBuildId: "build-id", latestBuildOrdinal: 43, latestBuildOperationId: "operation-id",
  };
}

function meteredLegacySnapshot() {
  const saved = snapshot();
  saved.build.errorCode = saved.operation.errorCode = serviceFailure;
  saved.build.quotaState = "released";
  saved.build.quotaPeriodId = "quota-period";
  return saved;
}

beforeEach(() => {
  mocks.stagedRecovery.mockReset().mockReturnValue({ existingTaskOnly: true, stagedOnly: true });
  mocks.legacyRecovery.mockReset().mockReturnValue({ existingTaskOnly: true });
  mocks.reserveQuota.mockReset().mockResolvedValue("quota-period");
});

describe("staged source build reconciliation eligibility", () => {
  it("binds the validated staged recovery to the frozen build and plan coordinates", () => {
    const saved = snapshot();
    expect(prepareExistingManusBuildReconciliation(saved, now)).toMatchObject({
      quotaPeriodId: null, recoveryErrorCode: renderFailure,
      stagedPlan: { localAssetId: "plan-id", sha256: "a".repeat(64) },
      recoveryState: { existingTaskOnly: true, stagedOnly: true },
    });
    expect(mocks.stagedRecovery).toHaveBeenCalledWith({
      result: saved.operation.result, taskId: "task-id", operationId: "operation-id",
      projectId: "project-id", userId: 7, contentPlanLocalAssetId: "plan-id",
      contentPlanSha256: "a".repeat(64), now,
    });
    expect(mocks.legacyRecovery).not.toHaveBeenCalled();
  });

  it("keeps the legacy failed build recovery metered", () => {
    const saved = meteredLegacySnapshot();
    expect(prepareExistingManusBuildReconciliation(saved, now)).toMatchObject({
      quotaPeriodId: "quota-period", recoveryErrorCode: serviceFailure, stagedPlan: null,
    });
    saved.build.quotaPeriodId = null;
    saved.build.quotaState = null;
    expect(() => prepareExistingManusBuildReconciliation(saved, now)).toThrow("SITEOPS_RECONCILE_RELEASED_QUOTA_REQUIRED");
    expect(mocks.stagedRecovery).not.toHaveBeenCalled();
  });

  it.each([
    ["older workflow", (saved: ReturnType<typeof snapshot>) => { saved.build.workflowVersion = "2.8.0"; }, "RECOVERABLE_TERMINAL_REQUIRED"],
    ["formal source", (saved: ReturnType<typeof snapshot>) => { saved.build.sourceLocalAssetId = "formal-id"; }, "BUILD_ALREADY_HAS_ARTIFACTS"],
    ["missing plan", (saved: ReturnType<typeof snapshot>) => { saved.build.contentPlanSha256 = null; }, "STAGED_PLAN_REQUIRED"],
    ["newer operation", (saved: ReturnType<typeof snapshot>) => { saved.latestBuildOperationId = "new-op"; }, "NEWER_BUILD_OR_OPERATION_EXISTS"],
    ["changed project revision", (saved: ReturnType<typeof snapshot>) => { saved.project.revision += 1; }, "PROJECT_REVISION_CHANGED"],
    ["mixed quota pair", (saved: ReturnType<typeof snapshot>) => { saved.build.quotaState = "released"; }, "RELEASED_QUOTA_REQUIRED"],
  ] as const)("rejects %s", (_name, change, code) => {
    const saved = snapshot();
    change(saved);
    expect(() => prepareExistingManusBuildReconciliation(saved, now)).toThrow(`SITEOPS_RECONCILE_${code}`);
  });

  it("fails closed when the persisted verdict or staged receipt cannot be admitted", () => {
    mocks.stagedRecovery.mockImplementation(() => { throw new Error("STAGING_EXPIRED"); });
    expect(() => prepareExistingManusBuildReconciliation(snapshot(), now)).toThrow("SITEOPS_RECONCILE_STAGED_SOURCE_REVALIDATION_INVALID");
    expect(mocks.legacyRecovery).not.toHaveBeenCalled();
  });
});

function table<const Name extends string, const Columns extends readonly string[]>(name: Name, columns: Columns) {
  return mysqlTable(name, Object.fromEntries(columns.map(column => [column, varchar(column, { length: 64 })])));
}

const tables = {
  siteBuilds: table("site_builds", ["id", "projectId", "ordinal", "status", "quotaState", "quotaPeriodId", "upstreamManusTaskId", "errorCode", "contentPlanLocalAssetId", "contentPlanSha256", "contractLocalAssetId", "contractHash", "sourceLocalAssetId", "sourceHash", "distLocalAssetId", "distHash", "qaLocalAssetId", "provenanceLocalAssetId"]),
  siteOperations: table("site_operations", ["id", "projectId", "buildId", "status", "provider", "providerTaskId", "errorCode", "leaseOwner", "leaseExpiresAt", "kind", "createdAt"]),
  siteProjects: mysqlTable("site_projects", {
    id: varchar("id", { length: 36 }),
    userId: int("user_id"),
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    status: varchar("status", { length: 32 }),
    revision: int("revision"),
    currentBuildId: varchar("current_build_id", { length: 36 }),
    currentKnowledgeSnapshotId: varchar("current_knowledge_snapshot_id", { length: 36 }),
  }),
  conversationTurns: table("conversation_turns", ["id"]),
};
configureManusBuildReconciliationCore({
  tables: tables as unknown as ManusBuildReconciliationCore["tables"],
  enterpriseOwnerPredicate: (project, userId) => and(
    eq(project.userId, userId),
    isNull(project.enterpriseProjectId),
  )!,
});

function transaction(saved: ReturnType<typeof snapshot>, affected: number[] = []) {
  const rows = [
    [saved.build], [saved.operation], [saved.project], [saved.turn],
    [{ id: saved.latestBuildId, ordinal: saved.latestBuildOrdinal }],
    [{ id: saved.latestBuildOperationId }],
  ];
  const updates: Array<{ target: unknown; values: Record<string, unknown>; condition: ReturnType<MySqlDialect["sqlToQuery"]> }> = [];
  const dialect = new MySqlDialect();
  const tx = {
    select() {
      const query = {
        from: () => query, where: () => query, orderBy: () => query, limit: () => query,
        for: async () => rows.shift() ?? [],
      };
      return query;
    },
    update(target: unknown) {
      return { set: (values: Record<string, unknown>) => ({
        where: async (condition: SQL) => {
          updates.push({ target, values, condition: dialect.sqlToQuery(condition) });
          return [{ affectedRows: affected.shift() ?? 1 }];
        },
      }) };
    },
  };
  return { db: { transaction: async <T,>(run: (tx: unknown) => Promise<T>) => run(tx) }, updates };
}

describe("staged source reconciliation writes", () => {
  it.each([
    {
      scope: "enterprise",
      enterpriseProjectId: "enterprise-project-id",
      operator: "= ?",
      scopeParams: ["enterprise-project-id"],
    },
    { scope: "legacy", enterpriseProjectId: null, operator: "is null", scopeParams: [] },
  ])("compares the locked $scope scope in the project CAS", async ({ enterpriseProjectId, operator, scopeParams }) => {
    const saved = snapshot();
    saved.project.enterpriseProjectId = saved.turn.enterpriseProjectId = enterpriseProjectId;
    const { db, updates } = transaction(saved);

    await reconcileExistingManusBuild(db, { buildId: "build-id", now });

    const conditions = [
      "`site_projects`.`id` = ?",
      "`site_projects`.`user_id` = ?",
      "`site_projects`.`enterpriseProjectId` " + operator,
      "`site_projects`.`status` = ?",
      "`site_projects`.`revision` = ?",
      "`site_projects`.`current_build_id` = ?",
      "`site_projects`.`current_knowledge_snapshot_id` = ?",
    ];
    expect(updates[2].condition).toMatchObject({
      sql: "(" + conditions.join(" and ") + ")",
      params: ["project-id", 7, ...scopeParams, "failed", 12, "parent-id", "snapshot-id"],
    });
  });

  it("rejects a same-owner turn in another enterprise scope before any update", async () => {
    const saved = snapshot();
    saved.project.enterpriseProjectId = "enterprise-project-id";
    saved.turn.enterpriseProjectId = "another-enterprise-project-id";
    const { db, updates } = transaction(saved);

    await expect(reconcileExistingManusBuild(db, { buildId: "build-id", now })).rejects.toThrow("SITEOPS_RECONCILE_PROJECT_SCOPE_MISMATCH");
    expect(updates).toHaveLength(0);
  });

  it("checks the null quota pair and frozen plan in the build CAS without reserving quota", async () => {
    const { db, updates } = transaction(snapshot());
    await expect(reconcileExistingManusBuild(db, { buildId: "build-id", now })).resolves.toMatchObject({
      nextOperationStatus: "running", existingTaskOnly: true, quotaState: null,
    });
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
    expect(updates.map(update => update.target)).toEqual([tables.siteOperations, tables.siteBuilds, tables.siteProjects]);
    expect(updates[0].condition.params).toContain(renderFailure);
    expect(updates[1].values.quotaState).toBeNull();
    expect(updates[1].condition.sql).toContain("`quotaState` is null");
    expect(updates[1].condition.sql).toContain("`quotaPeriodId` is null");
    expect(updates[1].condition.params).toEqual(expect.arrayContaining(["plan-id", "a".repeat(64), renderFailure]));
  });

  it("retains the metered reservation and released quota CAS", async () => {
    const { db, updates } = transaction(meteredLegacySnapshot());
    await expect(reconcileExistingManusBuild(db, { buildId: "build-id", now })).resolves.toMatchObject({ quotaState: "reserved" });
    expect(mocks.reserveQuota).toHaveBeenCalledWith(expect.anything(), {
      userId: 7, quotaPool: "website_content_publish", quotaPeriodIds: ["quota-period"],
    });
    expect(updates[1].condition.params).toEqual(expect.arrayContaining(["released", "quota-period"]));
  });

  it("stops the transaction before the project update if the staged build CAS fails", async () => {
    const { db, updates } = transaction(snapshot(), [1, 0]);
    await expect(reconcileExistingManusBuild(db, { buildId: "build-id", now })).rejects.toThrow("SITEOPS_RECONCILE_BUILD_CAS_CONFLICT");
    expect(updates.map(update => update.target)).toEqual([tables.siteOperations, tables.siteBuilds]);
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
  });
});
