// @vitest-environment node
import type { Request } from "express";
import { MySqlDialect, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { BrandKeywordPorts } from "../server/brand-keyword-ports.js";
import {
  createEnterpriseRagGovernanceService,
  enterpriseRagRegressionMetricsPass,
} from "../server/enterprise-rag-governance-service.js";
import type { ModuleHttpCore } from "../server/http-api.js";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime.js";

const REQUEST_ID = "00000000-0000-4000-8000-000000000201";

function harness(environment: Record<string, string> = {}) {
  const versions = mysqlTable("governance_versions_test", {
    id: varchar("id", { length: 96 }), status: varchar("status", { length: 32 }), manifest: json("manifest"),
    manifestHash: varchar("manifestHash", { length: 64 }), sourceProposalId: varchar("sourceProposalId", { length: 36 }), createdByUserId: int("createdByUserId"),
  });
  const channels = mysqlTable("governance_channels_test", {
    id: varchar("id", { length: 96 }), scope: varchar("scope", { length: 32 }), enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
    activeVersionId: varchar("activeVersionId", { length: 96 }), revision: int("revision"), updatedByUserId: int("updatedByUserId"),
  });
  const rows = { versions: [] as any[], channels: [] as any[] };
  const dialect = new MySqlDialect();
  const params = (predicate: any) => predicate ? dialect.sqlToQuery(predicate).params : [];
  class Query implements PromiseLike<any[]> {
    private table: any; private predicate: any; private maximum = Number.POSITIVE_INFINITY;
    constructor(private fields?: any) {}
    from(table: any) { this.table = table; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    limit(maximum: number) { this.maximum = maximum; return this; }
    then<TResult1 = any[], TResult2 = never>(onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      const target = this.table === versions ? rows.versions : rows.channels;
      const values = params(this.predicate);
      const result = target.filter((row) => values.every((value) => Object.values(row).includes(value))).slice(0, this.maximum)
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
        const target = this.table === versions ? rows.versions : rows.channels;
        if (!target.some((row) => row.id === this.value.id)) target.push(structuredClone(this.value));
      }
      return Promise.resolve().then(onfulfilled, onrejected);
    }
  }
  const db: any = {
    select(fields?: any) { return new Query(fields); },
    insert(table: any) { return new Insert(table); },
    async transaction(work: (executor: any) => Promise<any>) { return work(db); },
  };
  registerIntentSkillPorts({ enterpriseRagEvaluationVersions: versions, enterpriseRagEvaluationChannels: channels } as unknown as BrandKeywordPorts);
  const service = (access: "system_admin" | "delivery_admin") => {
    const core: ModuleHttpCore = {
      context: () => ({ accountUserId: 42, actorUserId: 7, enterpriseProjectId: "project", businessOwnerId: "42", businessActorId: "7" }),
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
  it("fails the release gate closed unless every fixed regression criterion passes", () => {
    const passed = { overallAgreementDelta: 0, falseAcceptanceDelta: -1, newHighRiskMisses: 0, fixedHighRiskPass: true, improvedTargetClusters: 1 };
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
});
