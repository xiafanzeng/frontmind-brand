// @vitest-environment node
import { MySqlDialect, int, json, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST,
  ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH,
  ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID,
  ENTERPRISE_RAG_DIMENSION_IDS,
  ENTERPRISE_RAG_GATE_IDS,
  evaluateEnterpriseRagPolicyDecision,
  type EnterpriseRagEvaluationPolicyPack,
} from "../contracts/enterprise-rag-evaluation-run.js";
import { createRagChecklist } from "../contracts/enterprise-rag-checklist.js";
import {
  applyEnterpriseRagPolicyThresholds,
  applyEnterpriseRagPolicyToChecklist,
  enterpriseRagEvaluationSkillForVersion,
  enterpriseRagProviderEvaluationInput,
  resolveEnterpriseRagEvaluationVersion,
} from "../server/enterprise-rag-evaluation-service.js";
import { intentHash } from "../server/intent-skill-runtime.js";

const CASE_ID = "00000000-0000-4000-8000-000000000301";
const PROJECT_ID = "00000000-0000-4000-8000-000000000302";
const pack: EnterpriseRagEvaluationPolicyPack = {
  schemaVersion: 1,
  promptClauses: [{ id: "prompt-medical", text: "医疗风险结论必须优先于普通建议。", citedCaseIds: [CASE_ID] }],
  scoringChecks: [{ id: "score-facts", dimensionId: "correctness", minimumLevel: 3, onBelow: "block", text: "核对核心医疗事实。", citedCaseIds: [CASE_ID] }],
  riskRules: [{ id: "risk-safety", riskId: "safety", blockedStatuses: ["failed", "pending"], text: "危险医疗建议必须阻断。", citedCaseIds: [CASE_ID] }],
  thresholds: { excellent: 90, usable: 80, improve: 60 },
};

function database(rows: { channels: any[]; versions: any[] }) {
  const versions = mysqlTable("evaluation_versions_test", {
    id: varchar("id", { length: 96 }), status: mysqlEnum("status", ["built_in", "candidate", "released", "retired"]),
    manifest: json("manifest"), manifestHash: varchar("manifestHash", { length: 64 }),
  });
  const channels = mysqlTable("evaluation_channels_test", {
    id: varchar("id", { length: 96 }), scope: mysqlEnum("scope", ["global", "workspace"]),
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }), activeVersionId: varchar("activeVersionId", { length: 96 }),
    revision: int("revision"),
  });
  const dialect = new MySqlDialect();
  class Query implements PromiseLike<any[]> {
    private table: any; private predicate: any; private maximum = Number.POSITIVE_INFINITY;
    from(table: any) { this.table = table; return this; }
    where(predicate: any) { this.predicate = predicate; return this; }
    limit(maximum: number) { this.maximum = maximum; return this; }
    then<TResult1 = any[], TResult2 = never>(onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
      const values = this.predicate ? dialect.sqlToQuery(this.predicate).params : [];
      const source = this.table === versions ? rows.versions : rows.channels;
      const selected = source.filter((row) => values.every((value) => Object.values(row).includes(value))).slice(0, this.maximum);
      return Promise.resolve(structuredClone(selected)).then(onfulfilled, onrejected);
    }
  }
  return {
    db: { select: () => new Query() },
    model: { enterpriseRagEvaluationVersions: versions, enterpriseRagEvaluationChannels: channels },
  };
}

describe("enterprise RAG evaluation version consumption", () => {
  it("labels the legacy Skill hash honestly and pins the built-in manifest", async () => {
    expect(ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST).toMatchObject({
      legacySkillVersion: "3.0.0",
      legacySkillHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      promptTemplateFrozen: false,
      policyPack: null,
      policyPackHash: null,
    });
    expect(ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST).not.toHaveProperty("promptHash");
    expect(intentHash(ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST))
      .toBe(ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH);
    const shippedSkill = await readFile(new URL("../workflows/evaluate-enterprise-rag/SKILL.md", import.meta.url), "utf8");
    expect(intentHash(shippedSkill)).toBe(ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST.legacySkillHash);
  });

  it("resolves the bootstrapped global built-in version when governance is enabled", async () => {
    const fixture = database({
      channels: [{ id: "global", scope: "global", enterpriseProjectId: null, activeVersionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID, revision: 1 }],
      versions: [{ id: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID, status: "built_in", manifest: ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST, manifestHash: ENTERPRISE_RAG_BUILTIN_EVALUATION_MANIFEST_HASH }],
    });
    await expect(resolveEnterpriseRagEvaluationVersion({ enabled: true, enterpriseProjectId: PROJECT_ID, db: fixture.db, model: fixture.model as never }))
      .resolves.toMatchObject({ evaluationVersionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID, channelScope: "global" });
  });

  it("keeps the built-in evaluator without any database read while governance is disabled", async () => {
    const result = await resolveEnterpriseRagEvaluationVersion({
      enabled: false, enterpriseProjectId: PROJECT_ID,
      db: { select: () => { throw new Error("must stay read-free"); } }, model: {} as never,
    });
    expect(result).toMatchObject({
      evaluationVersionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID,
      channelScope: "built_in",
    });
  });

  it("prefers the current workspace canary over the global released version", async () => {
    const candidateManifest = {
      schemaVersion: 1, sourceProposalId: CASE_ID,
      policyPack: pack, policyPackHash: intentHash(pack),
    };
    const globalManifest = { evaluationVersionId: ENTERPRISE_RAG_BUILTIN_EVALUATION_VERSION_ID };
    const fixture = database({
      channels: [
        { id: "global", scope: "global", enterpriseProjectId: null, activeVersionId: "global-version", revision: 2 },
        { id: `workspace:${PROJECT_ID}`, scope: "workspace", enterpriseProjectId: PROJECT_ID, activeVersionId: "candidate-version", revision: 2 },
      ],
      versions: [
        { id: "global-version", status: "released", manifest: globalManifest, manifestHash: intentHash(globalManifest) },
        { id: "candidate-version", status: "candidate", manifest: candidateManifest, manifestHash: intentHash(candidateManifest) },
      ],
    });
    const result = await resolveEnterpriseRagEvaluationVersion({
      enabled: true, enterpriseProjectId: PROJECT_ID, db: fixture.db, model: fixture.model as never,
    });
    expect(result).toMatchObject({
      evaluationVersionId: "candidate-version", channelScope: "workspace", policyPack: pack,
    });
  });

  it("fails closed when a channel points at a tampered manifest", async () => {
    const fixture = database({
      channels: [{ id: "global", scope: "global", enterpriseProjectId: null, activeVersionId: "released", revision: 1 }],
      versions: [{ id: "released", status: "released", manifest: { policyPack: pack }, manifestHash: "0".repeat(64) }],
    });
    await expect(resolveEnterpriseRagEvaluationVersion({
      enabled: true, enterpriseProjectId: PROJECT_ID, db: fixture.db, model: fixture.model as never,
    })).rejects.toMatchObject({ code: "EVALUATION_VERSION_HASH_MISMATCH", status: 503 });
  });

  it("fails closed when a policy pack does not match its own manifest hash", async () => {
    const manifest = { schemaVersion: 1, policyPack: pack, policyPackHash: "0".repeat(64) };
    const fixture = database({
      channels: [{ id: "global", scope: "global", enterpriseProjectId: null, activeVersionId: "released", revision: 1 }],
      versions: [{ id: "released", status: "released", manifest, manifestHash: intentHash(manifest) }],
    });
    await expect(resolveEnterpriseRagEvaluationVersion({
      enabled: true, enterpriseProjectId: PROJECT_ID, db: fixture.db, model: fixture.model as never,
    })).rejects.toMatchObject({ code: "EVALUATION_VERSION_POLICY_HASH_MISMATCH", status: 503 });
  });

  it("keeps candidate citations and free text out of provider payloads", () => {
    const checklist = applyEnterpriseRagPolicyToChecklist(createRagChecklist("医院地址是什么？"), pack);
    expect(JSON.stringify(checklist)).not.toContain("核对核心医疗事实");
    const skill = enterpriseRagEvaluationSkillForVersion("base skill", {
      evaluationVersionId: "candidate", evaluationManifestHash: "a".repeat(64),
      policyPack: pack, channelId: `workspace:${PROJECT_ID}`, channelScope: "workspace",
    });
    expect(skill).toBe("base skill");
    const provider = enterpriseRagProviderEvaluationInput({ evaluator: { policyPack: pack } } as never);
    expect(JSON.stringify(provider)).not.toContain(CASE_ID);
    expect(provider.evaluator).not.toHaveProperty("policyPack");
  });

  it("uses frozen thresholds without allowing them to override an existing critical block", () => {
    const base = {
      skillId: "enterprise-rag-evaluation", version: "3.0.0", status: "completed" as const,
      answerVerdict: "usable" as const, score: 70, coverage: 100,
      recommendation: "recommended" as const, summary: "ok", dimensions: [], risks: [], relatedReportIds: [],
    };
    expect(applyEnterpriseRagPolicyThresholds(base, pack)).toMatchObject({
      answerVerdict: "usable_with_improvements", recommendation: "publish_with_risk", policyBand: "improve",
    });
    expect(applyEnterpriseRagPolicyThresholds({ ...base, score: 95 }, pack)).toMatchObject({
      answerVerdict: "usable", recommendation: "recommended", policyBand: "excellent",
    });
    expect(applyEnterpriseRagPolicyThresholds({
      ...base, score: 95, answerVerdict: "usable_with_improvements" as const,
      recommendation: "publish_with_risk" as const,
    }, pack)).toMatchObject({
      answerVerdict: "usable_with_improvements", recommendation: "publish_with_risk", policyBand: "improve",
    });
    const critical = { ...base, answerVerdict: "unusable" as const, recommendation: "not_recommended" as const,
      risks: [{ id: "risk", severity: "critical" as const, title: "risk", summary: "risk", evidenceIds: [] }] };
    expect(applyEnterpriseRagPolicyThresholds(critical, pack)).toMatchObject({
      answerVerdict: "unusable", recommendation: "not_recommended", policyBand: "unusable",
    });
  });

  it("uses the exact shared deterministic executor in production and offline regression", () => {
    const dimensions = ENTERPRISE_RAG_DIMENSION_IDS.map((id) => ({ id, level: 4 }));
    const gates = ENTERPRISE_RAG_GATE_IDS.map((id) => ({ id, status: "passed" as const }));
    const base = {
      skillId: "enterprise-rag-evaluation", version: "3.0.0", status: "completed" as const,
      answerVerdict: "usable_with_improvements" as const, score: 88, coverage: 100,
      recommendation: "publish_with_risk" as const, summary: "ok", dimensions: [],
      risks: [{ id: "low", severity: "low" as const, title: "low", summary: "low", evidenceIds: [] }],
      relatedReportIds: [],
    };
    const pure = evaluateEnterpriseRagPolicyDecision({
      status: base.status, score: base.score, answerVerdict: base.answerVerdict,
      riskSeverities: base.risks.map((risk) => risk.severity), dimensions, gates,
    }, pack);
    const production = applyEnterpriseRagPolicyThresholds(base, pack, { dimensions, gates });
    expect(pure).toMatchObject({
      answerVerdict: "usable", policyBand: "usable",
      reasonCodes: expect.arrayContaining(["safe_threshold_promotion"]),
    });
    expect(production).toMatchObject({
      answerVerdict: pure.answerVerdict,
      policyBand: pure.policyBand,
      policyBaseAnswerVerdict: "usable_with_improvements",
      recommendation: "recommended",
    });
  });
});
