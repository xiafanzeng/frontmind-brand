import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  WEBSITE_BUILD_EVALUATION_CONTRACT_REVISION,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
} from "../contracts/website-build-evaluation-run.js";
import type { BrandSchema } from "../schema/index.js";

export const WEBSITE_EVALUATION_CONTRACT_REVISION =
  WEBSITE_BUILD_EVALUATION_CONTRACT_REVISION;
export const WEBSITE_EVALUATION_EVIDENCE_VERSION =
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION;
export const WEBSITE_EVALUATION_RULE_VERSION =
  WEBSITE_BUILD_EVALUATION_RULE_VERSION;
export const WEBSITE_EVALUATION_JUDGE_VERSION =
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION;
export const WEBSITE_EVALUATION_SKILL_VERSION =
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION;

export type WebsiteEvaluationMode = "off" | "shadow" | "allowlist" | "live";

type EvaluationTables = Pick<
  BrandSchema,
  "siteEvaluationRuns"
>;

type ArtifactBinding = {
  id: string;
  sha256: string;
};

export type AutomaticWebsiteEvaluationInput = {
  enterpriseProjectId: string | null;
  userId: number;
  projectId: string;
  buildId: string;
  knowledgeSnapshotId: string;
  knowledgeArchiveHash: string;
  brief: unknown;
  selectionHash: string | null;
  artifactBindings: {
    contract: ArtifactBinding;
    source: ArtifactBinding;
    dist: ArtifactBinding;
    qa: ArtifactBinding;
    provenance: ArtifactBinding;
  };
  now?: Date;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

export function canonicalWebsiteEvaluationJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function uuidFromHash(hash: string) {
  const variant = (Number.parseInt(hash[16]!, 16) & 0x3) | 0x8;
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant.toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export function websiteEvaluationMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebsiteEvaluationMode {
  const value = environment.FRONTMIND_WEBSITE_EVALUATION_MODE?.trim();
  return value === "shadow" || value === "allowlist" || value === "live"
    ? value
    : "off";
}

function projectAllowlist(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return new Set(
    (environment.FRONTMIND_WEBSITE_EVALUATION_ALLOW_PROJECT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function websiteEvaluationProjectEligible(input: {
  projectId: string;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const environment = input.environment ?? process.env;
  const mode = websiteEvaluationMode(environment);
  if (mode === "off") return false;
  if (mode === "live") return true;
  return projectAllowlist(environment).has(input.projectId);
}

export function websiteEvaluationAdmissionProjection(input: {
  projectId: string;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const environment = input.environment ?? process.env;
  const mode = websiteEvaluationMode(environment);
  const required = websiteEvaluationProjectEligible({
    projectId: input.projectId,
    environment,
  });
  return {
    mode,
    required,
    userVisible: required && mode !== "shadow",
  } as const;
}

export function websiteEvaluationEvidenceFingerprint(
  input: AutomaticWebsiteEvaluationInput,
) {
  return sha256(
    canonicalWebsiteEvaluationJson({
      schemaVersion: 1,
      buildId: input.buildId,
      knowledgeSnapshotId: input.knowledgeSnapshotId,
      knowledgeArchiveHash: input.knowledgeArchiveHash,
      brief: input.brief,
      selectionHash: input.selectionHash,
      artifacts: Object.fromEntries(
        Object.entries(input.artifactBindings).map(([kind, binding]) => [
          kind,
          { id: binding.id, sha256: binding.sha256.toLowerCase() },
        ]),
      ),
      evidenceManifestVersion: WEBSITE_EVALUATION_EVIDENCE_VERSION,
    }),
  );
}

export function automaticWebsiteEvaluationRunId(input: {
  userId: number;
  enterpriseProjectId: string | null;
  projectId: string;
  buildId: string;
  evidenceFingerprint: string;
}) {
  return uuidFromHash(
    sha256(
      canonicalWebsiteEvaluationJson({
        namespace: "frontmind.website-build-evaluation.auto.v1",
        userId: input.userId,
        enterpriseProjectId: input.enterpriseProjectId,
        projectId: input.projectId,
        buildId: input.buildId,
        stage: "build_readiness",
        evidenceFingerprint: input.evidenceFingerprint,
        ruleVersion: WEBSITE_EVALUATION_RULE_VERSION,
        judgeVersion: WEBSITE_EVALUATION_JUDGE_VERSION,
      }),
    ),
  );
}

/**
 * Reserve only durable local work. This function never calls a model or reads
 * provider state and is safe to execute in the SiteOps artifact transaction.
 */
export async function reserveAutomaticWebsiteEvaluation(input: {
  tx: any;
  tables: EvaluationTables;
  environment?: Readonly<Record<string, string | undefined>>;
  build: AutomaticWebsiteEvaluationInput;
}) {
  const environment = input.environment ?? process.env;
  const mode = websiteEvaluationMode(environment);
  if (
    !websiteEvaluationProjectEligible({
      projectId: input.build.projectId,
      environment,
    })
  ) {
    return { eligible: false as const, mode };
  }
  const evidenceFingerprint = websiteEvaluationEvidenceFingerprint(input.build);
  const runId = automaticWebsiteEvaluationRunId({
    userId: input.build.userId,
    enterpriseProjectId: input.build.enterpriseProjectId,
    projectId: input.build.projectId,
    buildId: input.build.buildId,
    evidenceFingerprint,
  });
  const idempotencyKeyHash = sha256(
    `website-build-evaluation\0${runId}\0${evidenceFingerprint}`,
  );
  const now = input.build.now ?? new Date();
  const table = input.tables.siteEvaluationRuns;
  await input.tx
    .insert(table)
    .values({
      enterpriseProjectId: input.build.enterpriseProjectId,
      id: runId,
      userId: input.build.userId,
      projectId: input.build.projectId,
      buildId: input.build.buildId,
      stage: "build_readiness",
      status: "queued",
      admissionMode: mode === "shadow" ? "shadow" : "user",
      evidenceFingerprint,
      evidenceManifestVersion: WEBSITE_EVALUATION_EVIDENCE_VERSION,
      ruleVersion: WEBSITE_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_EVALUATION_JUDGE_VERSION,
      skillVersion: WEBSITE_EVALUATION_SKILL_VERSION,
      contractRevision: WEBSITE_EVALUATION_CONTRACT_REVISION,
      idempotencyKeyHash,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`${table.id}` } });
  return {
    eligible: true as const,
    mode,
    runId,
    evidenceFingerprint,
  };
}
