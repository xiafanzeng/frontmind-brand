// @vitest-environment node
import type { Request } from "express";
import { MySqlDialect, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { BrandKeywordPorts } from "../server/brand-keyword-ports.js";
import {
  createEnterpriseRagGovernanceService,
  enterpriseRagRegressionDatasetHash,
  enterpriseRagRegressionMetricsPass,
  enterpriseRagWorkspaceEvaluationChannelId,
} from "../server/enterprise-rag-governance-service.js";
import type { ModuleHttpCore } from "../server/http-api.js";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime.js";

const REQUEST_ID = "00000000-0000-4000-8000-000000000201";
const PROJECT_ID = "00000000-0000-4000-8000-000000000299";

function harness(environment: Record<string, string> = {}) {
  const versions = mysqlTable("governance_versions_test", {
    id: varchar("id", { length: 96 }), status: varchar("status", { length: 32 }), manifest: json("manifest"),
    manifestHash: varchar("manifestHash", { length: 64 }), sourceProposalId: varchar("sourceProposalId", { length: 36 }), createdByUserId: int("createdByUserId"),
  });
  const channels = mysqlTable("governance_channels_test", {
    id: varchar("id", { length: 96 }), scope: varchar("scope", { length: 32 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    activeVersionId: varchar("activeVersionId", { length: 96 }), revision: int("revision"), updatedByUserId: int("updatedByUserId"),
  });
  const proposals = mysqlTable("governance_proposals_test", {
    id: varchar("id", { length: 36 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    scope: varchar("scope", { length: 32 }), clientRequestId: varchar("clientRequestId", { length: 36 }),
    requestHash: varchar("requestHash", { length: 64 }), status: varchar("status", { length: 32 }),
    caseIds: json("caseIds"), policyPack: json("policyPack"), citedCaseIds: json("citedCaseIds"),
    createdByUserId: int("createdByUserId"),
  });
  const regressions = mysqlTable("governance_regressions_test", {
    id: varchar("id", { length: 36 }), proposalId: varchar("proposalId", { length: 36 }),
    clientRequestId: varchar("clientRequestId", { length: 36 }), requestHash: varchar("requestHash", { length: 64 }),
    baselineVersionId: varchar("baselineVersionId", { length: 96 }), candidateVersionId: varchar("candidateVersionId", { length: 96 }),
    datasetHash: varchar("datasetHash", { length: 64 }), status: varchar("status", { length: 32 }),
    gateStatus: varchar("gateStatus", { length: 32 }), metrics: json("metrics"), createdByUserId: int("createdByUserId"),
  });
  const releaseEvents = mysqlTable("governance_release_events_test", {
    id: varchar("id", { length: 36 }), channelId: varchar("channelId", { length: 96 }), action: varchar("action", { length: 32 }),
    clientRequestId: varchar("clientRequestId", { length: 36 }), requestHash: varchar("requestHash", { length: 64 }),
    fromVersionId: varchar("fromVersionId", { length: 96 }), toVersionId: varchar("toVersionId", { length: 96 }),
    regressionRunId: varchar("regressionRunId", { length: 36 }), actorUserId: int("actorUserId"), reason: varchar("reason", { length: 2000 }),
  });
  const rows = {
    versions: [] as any[], channels: [] as any[], proposals: [] as any[],
    regressions: [] as any[], releaseEvents: [] as any[],
  };
  const dialect = new MySqlDialect();
  const params = (predicate: any) => predicate ? dialect.sqlToQuery(predicate).params : [];
  class Query implements PromiseLike<any[]> {
    private table: any; private predicate: any; private maximum = Number.POSITIVE_INFINITY;
    constructor(private fields?: any) {}
    from(table: any) { this.table = table; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    limit(maximum: number) { this.maximum = maximum; return this; }
    for() { return this; }
    then<TResult1 = any[], TResult2 = never>(onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      const target = this.table === versions ? rows.versions
        : this.table === channels ? rows.channels
          : this.table === proposals ? rows.proposals
            : this.table === regressions ? rows.regressions
              : rows.releaseEvents;
      const values = params(this.predicate);
      const matches = (row: any) => this.table === versions
        ? values.length === 0 || values.includes(row.id)
        : values.every((value) => Object.values(row).some((candidate) => Array.isArray(candidate)
          ? candidate.includes(value)
          : candidate === value));
      const result = target.filter(matches).slice(0, this.maximum)
        .map((row) => this.fields ? Object.fromEntries(Object.keys(this.fields).map((key) => [key, row[key]])) : structuredClone(row));
      return Promise.resolve(result).then(onfulfilled, onrejected);
    }
  }
  class Insert implements PromiseLike<void> {
    private value: any; private executed = false;
    constructor(private table: any) {}
    values(value: any) { this.value = value; return this; }
    onDuplicateKeyUpdate() { return this; }
    then<TResult1 = void, TResult2 = never>(onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      if (!this.executed) {
        this.executed = true;
        const target = this.table === versions ? rows.versions
          : this.table === channels ? rows.channels
            : this.table === proposals ? rows.proposals
              : this.table === regressions ? rows.regressions
                : rows.releaseEvents;
        if (!target.some((row) => row.id === this.value.id)) target.push(structuredClone(this.value));
      }
      return Promise.resolve().then(onfulfilled, onrejected);
    }
  }
  class Update implements PromiseLike<void> {
    private patch: any; private predicate: any;
    constructor(private table: any) {}
    set(value: any) { this.patch = value; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    then<TResult1 = void, TResult2 = never>(onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      const target = this.table === versions ? rows.versions : rows.channels;
      const values = params(this.predicate);
      for (const row of target) {
        if (values.every((value) => Object.values(row).includes(value))) Object.assign(row, structuredClone(this.patch));
      }
      return Promise.resolve().then(onfulfilled, onrejected);
    }
  }
  const db: any = {
    select(fields?: any) { return new Query(fields); },
    insert(table: any) { return new Insert(table); },
    update(table: any) { return new Update(table); },
    async transaction(work: (executor: any) => Promise<any>) { return work(db); },
  };
  registerIntentSkillPorts({
    enterpriseRagEvaluationVersions: versions, enterpriseRagEvaluationChannels: channels,
    enterpriseRagOptimizationProposals: proposals, enterpriseRagRegressionRuns: regressions,
    enterpriseRagReleaseEvents: releaseEvents,
  } as unknown as BrandKeywordPorts);
  const service = (access: "system_admin" | "delivery_admin") => {
    const core: ModuleHttpCore = {
      context: () => ({ accountUserId: 42, actorUserId: 7, enterpriseProjectId: PROJECT_ID, businessOwnerId: "42", businessActorId: "7" }),
      database: async () => db,
      environment,
    };
    return createEnterpriseRagGovernanceService(core, {
      frontmindUser: { id: 7, role: "admin", adminAccessLevel: access },
    } as unknown as Request);
  };
  return { rows, service };
}

describe("enterprise RAG governance safety boundary", () => {
  it("computes one stable server regression dataset hash", () => {
    const input = {
      proposalId: "00000000-0000-4000-8000-000000000010",
      baselineVersionId: "baseline",
      candidateVersionId: "candidate",
      baselineManifestHash: "a".repeat(64),
      candidateManifestHash: "b".repeat(64),
      frozenSnapshotHash: "c".repeat(64),
      caseIds: [
        "00000000-0000-4000-8000-000000000012",
        "00000000-0000-4000-8000-000000000011",
      ],
    };
    expect(enterpriseRagRegressionDatasetHash(input)).toMatch(/^[a-f0-9]{64}$/u);
    expect(enterpriseRagRegressionDatasetHash(input)).toBe(enterpriseRagRegressionDatasetHash({
      ...input, caseIds: [...input.caseIds].reverse(),
    }));
  });
  it("derives one stable workspace canary channel and rejects non-project identifiers", () => {
    expect(enterpriseRagWorkspaceEvaluationChannelId("00000000-0000-4000-8000-000000000099"))
      .toBe("workspace:00000000-0000-4000-8000-000000000099");
    expect(() => enterpriseRagWorkspaceEvaluationChannelId("another-workspace"))
      .toThrow();
  });
  it("fails the release gate closed unless every fixed regression criterion passes", () => {
    const passed = { overallAgreementDelta: 0, falseAcceptanceDelta: -1, falseRejectionDelta: 1, newHighRiskMisses: 0, fixedHighRiskPass: true, improvedTargetClusters: 1 };
    expect(enterpriseRagRegressionMetricsPass(passed)).toBe(true);
    expect(enterpriseRagRegressionMetricsPass({ ...passed, overallAgreementDelta: -0.01 })).toBe(false);
    expect(enterpriseRagRegressionMetricsPass({ ...passed, falseAcceptanceDelta: 1 })).toBe(false);
    expect(enterpriseRagRegressionMetricsPass({ ...passed, newHighRiskMisses: 1 })).toBe(false);
    expect(enterpriseRagRegressionMetricsPass({ ...passed, fixedHighRiskPass: false })).toBe(false);
    expect(enterpriseRagRegressionMetricsPass({ ...passed, improvedTargetClusters: 0 })).toBe(false);
    expect(enterpriseRagRegressionMetricsPass({})).toBe(false);
  });

  it("fails closed before persistence while the governance runtime is disabled", async () => {
    const { rows, service } = harness();
    await expect(service("system_admin").initialize({ clientRequestId: REQUEST_ID })).rejects.toMatchObject({ code: "GOVERNANCE_NOT_ENABLED", status: 503 });
    expect(rows.versions).toEqual([]);
    expect(rows.channels).toEqual([]);
  });

  it("allows only a system administrator to perform the explicit bootstrap", async () => {
    const { rows, service } = harness({ BRAND_RAG_GOVERNANCE_ENABLED: "true" });
    await expect(service("delivery_admin").initialize({ clientRequestId: REQUEST_ID })).rejects.toMatchObject({ code: "GOVERNANCE_FORBIDDEN", status: 403 });
    expect(rows.versions).toEqual([]);
  });

  it("idempotently registers the immutable legacy version and global channel only after an explicit call", async () => {
    const { rows, service } = harness({ BRAND_RAG_GOVERNANCE_ENABLED: "true" });
    const first = await service("system_admin").initialize({ clientRequestId: REQUEST_ID });
    const replay = await service("system_admin").initialize({ clientRequestId: REQUEST_ID });

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ initialized: true, versionId: "rag-eval-1.4+skill-3.0.0", channelId: "global" });
    expect(rows.versions).toHaveLength(1);
    expect(rows.versions[0]).toMatchObject({ id: "rag-eval-1.4+skill-3.0.0", status: "built_in" });
    expect(rows.channels).toEqual([expect.objectContaining({ id: "global", scope: "global", activeVersionId: "rag-eval-1.4+skill-3.0.0", revision: 1 })]);
  });

  it("computes the frozen regression dataset hash when the client omits it", async () => {
    const { rows, service } = harness({ BRAND_RAG_GOVERNANCE_ENABLED: "true" });
    await service("system_admin").initialize({ clientRequestId: REQUEST_ID });
    const proposalId = "00000000-0000-4000-8000-000000000221";
    const caseId = "00000000-0000-4000-8000-000000000222";
    rows.proposals.push({
      id: proposalId, enterpriseProjectId: PROJECT_ID, scope: "workspace", status: "completed",
      policyPack: { schemaVersion: 1 }, citedCaseIds: [caseId], caseIds: [caseId],
      redactedInputHash: "d".repeat(64), createdByUserId: 7,
    });
    rows.versions.push({ id: "candidate-v1", status: "candidate", sourceProposalId: proposalId, manifestHash: "b".repeat(64) });
    const created = await service("delivery_admin").startRegression(proposalId, {
      clientRequestId: "00000000-0000-4000-8000-000000000223",
      baselineVersionId: "rag-eval-1.4+skill-3.0.0",
      candidateVersionId: "candidate-v1",
    });
    expect(created.datasetHash).toBe(enterpriseRagRegressionDatasetHash({
      proposalId, baselineVersionId: "rag-eval-1.4+skill-3.0.0",
      candidateVersionId: "candidate-v1",
      baselineManifestHash: rows.versions.find((row) => row.id === "rag-eval-1.4+skill-3.0.0")!.manifestHash,
      candidateManifestHash: "b".repeat(64), frozenSnapshotHash: "d".repeat(64), caseIds: [caseId],
    }));
    expect(rows.regressions).toHaveLength(1);
    rows.versions.find((row) => row.id === "candidate-v1")!.status = "released";
    await expect(service("delivery_admin").startRegression(proposalId, {
      clientRequestId: "00000000-0000-4000-8000-000000000223",
      baselineVersionId: "rag-eval-1.4+skill-3.0.0",
      candidateVersionId: "candidate-v1",
    })).resolves.toEqual(created);
    rows.versions.find((row) => row.id === "candidate-v1")!.status = "candidate";
    await expect(service("delivery_admin").startRegression(proposalId, {
      clientRequestId: "00000000-0000-4000-8000-000000000224",
      baselineVersionId: "rag-eval-1.4+skill-3.0.0",
      candidateVersionId: "candidate-v1",
      datasetHash: "0".repeat(64),
    })).rejects.toMatchObject({ code: "REGRESSION_DATASET_HASH_MISMATCH", status: 409 });
  });

  it("creates one stable canary channel, exposes its revision and rejects stale writes", async () => {
    const { rows, service } = harness({ BRAND_RAG_GOVERNANCE_ENABLED: "true" });
    await service("system_admin").initialize({ clientRequestId: REQUEST_ID });
    const proposalId = "00000000-0000-4000-8000-000000000231";
    const runId = "00000000-0000-4000-8000-000000000232";
    rows.proposals.push({ id: proposalId, enterpriseProjectId: PROJECT_ID, status: "completed" });
    rows.versions.push({ id: "candidate-v2", status: "candidate", sourceProposalId: proposalId, manifestHash: "c".repeat(64) });
    rows.regressions.push({
      id: runId, proposalId, baselineVersionId: "rag-eval-1.4+skill-3.0.0", candidateVersionId: "candidate-v2",
      status: "completed", gateStatus: "passed", metrics: {
        overallAgreementDelta: 0, falseAcceptanceDelta: 0, falseRejectionDelta: -1,
        newHighRiskMisses: 0, fixedHighRiskPass: true, improvedTargetClusters: 1,
      },
    });
    const channelId = enterpriseRagWorkspaceEvaluationChannelId(PROJECT_ID);
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000233",
      action: "canary" as const, channelId, regressionRunId: runId, expectedRevision: 1,
      reason: "approved regression",
    };
    const event = await service("system_admin").release("candidate-v2", request);
    expect(event).toMatchObject({ action: "canary", channelId, fromVersionId: "rag-eval-1.4+skill-3.0.0", toVersionId: "candidate-v2" });
    await expect(service("system_admin").release("candidate-v2", request)).resolves.toEqual(event);
    expect(rows.channels.filter((row) => row.id === channelId)).toHaveLength(1);
    await expect(service("delivery_admin").channel(channelId)).rejects.toMatchObject({ code: "GOVERNANCE_FORBIDDEN", status: 403 });
    await expect(service("system_admin").channel(channelId)).resolves.toMatchObject({
      id: channelId, scope: "workspace", enterpriseProjectId: PROJECT_ID, activeVersionId: "candidate-v2", revision: 2,
    });
    await expect(service("system_admin").release("candidate-v2", { ...request,
      clientRequestId: "00000000-0000-4000-8000-000000000234",
    })).rejects.toMatchObject({ code: "RELEASE_REVISION_CONFLICT" });
    await expect(service("system_admin").release("candidate-v2", { ...request,
      clientRequestId: "00000000-0000-4000-8000-000000000235", channelId: "workspace:00000000-0000-4000-8000-000000000999",
    })).rejects.toMatchObject({ code: "RELEASE_CHANNEL_MISMATCH", status: 400 });
  });
});
