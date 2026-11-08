import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  scoreWebsiteBuildEvaluation,
  validateWebsiteBuildEvaluationJudgeOutput,
  websiteBuildEvaluationCoverageSchema,
  websiteBuildEvaluationReportSchema,
  type WebsiteBuildEvaluationCoverage,
  type WebsiteBuildEvaluationJudgeOutput,
  type WebsiteBuildEvaluationReport,
  type WebsiteBuildEvaluationRunStatus,
} from "../contracts/website-build-evaluation-run.js";
import {
  freezeWebsiteEvaluationEvidenceManifest,
} from "./website-evaluation-evidence.js";

export const WEBSITE_EVALUATION_SWEEP_INTERVAL_MS = 5_000;
export const WEBSITE_EVALUATION_MAX_ATTEMPT_MS = 30 * 60_000;
// The provider deadline stays exactly 30 minutes. One sweeper interval of
// lease grace lets the same worker durably record timeout/retry after aborting
// the call, while preventing another worker from dispatching it concurrently.
export const WEBSITE_EVALUATION_LEASE_MS =
  WEBSITE_EVALUATION_MAX_ATTEMPT_MS + WEBSITE_EVALUATION_SWEEP_INTERVAL_MS;
export const WEBSITE_EVALUATION_MAX_AUTOMATIC_RETRIES = 1;

export type WebsiteEvaluationWorkerAdmission =
  | { admitted: true; dailyBudgetUnits: number }
  | {
      admitted: false;
      reason: "worker_disabled" | "daily_budget_exhausted" | "project_concurrency";
      dailyBudgetUnits: number;
    };

/** Pure admission policy. The worker switch is fail-closed by default. */
export function websiteEvaluationWorkerAdmission(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  dailyUsageUnits: number;
  requestedUnits?: number;
  activeProjectRuns: number;
}): WebsiteEvaluationWorkerAdmission {
  const environment = input.environment ?? process.env;
  const enabled = ["1", "true", "on"].includes(
    (environment.FRONTMIND_WEBSITE_EVALUATION_WORKER_ENABLED ?? "")
      .trim()
      .toLowerCase(),
  );
  const configured = Number(
    environment.FRONTMIND_WEBSITE_EVALUATION_DAILY_BUDGET_UNITS ?? "0",
  );
  const dailyBudgetUnits = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 0;
  if (!enabled) return { admitted: false, reason: "worker_disabled", dailyBudgetUnits };
  if (input.activeProjectRuns >= 1) {
    return { admitted: false, reason: "project_concurrency", dailyBudgetUnits };
  }
  if (
    dailyBudgetUnits === 0 ||
    input.dailyUsageUnits + (input.requestedUnits ?? 1) > dailyBudgetUnits
  ) {
    return { admitted: false, reason: "daily_budget_exhausted", dailyBudgetUnits };
  }
  return { admitted: true, dailyBudgetUnits };
}

export type WebsiteEvaluationRuntimeRun = {
  runId: string;
  projectId: string;
  buildId: string;
  status: WebsiteBuildEvaluationRunStatus;
  attemptCount: number;
  automaticRetryCount: number;
  startedAt: Date | null;
  evidenceFingerprint: string;
  evidenceVersion: string;
  ruleVersion: string;
  judgeVersion: string;
  skillVersion: string;
  frozenModel?: string | null;
  frozenSkillHash?: string | null;
  /** Public-only frozen coordinates. Private source text is never admitted. */
  publicInput: Record<string, unknown>;
  evidence?: WebsiteEvaluationCapturedEvidence;
  pendingReport?: WebsiteBuildEvaluationReport;
  attemptId?: string;
  attemptTrigger?: WebsiteEvaluationAttemptTrigger;
  attemptRuntime?: Record<string, unknown>;
};

export type WebsiteEvaluationCapturedEvidence = {
  evidenceHash: string;
  allowedEvidenceIds: string[];
  artifactId: string | null;
  publicEvidence: Record<string, unknown>;
  buildOrdinal: number;
  coverage: WebsiteBuildEvaluationCoverage;
  relatedRagReportIds?: string[];
  comparablePreviousReportId?: string | null;
  assistantProbe?: {
    mode: "isolated_read_only";
    evidenceId: string;
    conversationWritten: false;
    status: "passed" | "failed";
  };
};

export type WebsiteEvaluationAttemptTrigger =
  | "automatic"
  | "automatic_retry"
  | "manual_retry";

export interface WebsiteEvaluationRuntimeStore {
  claimNext(input: {
    leaseOwner: string;
    now: Date;
    leaseExpiresAt: Date;
    /** False still allows already-metered attempts to converge. */
    allowNewAttempt?: boolean;
  }): Promise<WebsiteEvaluationRuntimeRun | null>;
  startAttempt(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    trigger: WebsiteEvaluationAttemptTrigger;
    model: string;
    skillHash: string;
    now: Date;
  }): Promise<void>;
  saveCapturedEvidence(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    evidence: WebsiteEvaluationCapturedEvidence;
    now: Date;
  }): Promise<void>;
  savePendingReport(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    report: WebsiteBuildEvaluationReport;
    now: Date;
  }): Promise<void>;
  commitReportOnce(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    report: WebsiteBuildEvaluationReport;
    now: Date;
  }): Promise<void>;
  scheduleAutomaticRetry(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    code: string;
    message: string;
    now: Date;
  }): Promise<void>;
  failTerminal(input: {
    run: WebsiteEvaluationRuntimeRun;
    leaseOwner: string;
    code: string;
    message: string;
    now: Date;
  }): Promise<void>;
}

function sqlRows(result: any): any[] {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function storedJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

export function websiteEvaluationReportHash(
  report: Omit<WebsiteBuildEvaluationReport, "reportHash">,
) {
  return sha256(report);
}

/** Verifies both the embedded digest and the immutable database coordinate. */
export function verifyWebsiteEvaluationReportIntegrity(
  value: unknown,
  expectedHash?: string | null,
) {
  const report = websiteBuildEvaluationReportSchema.parse(value);
  const { reportHash, ...withoutHash } = report;
  const computedHash = websiteEvaluationReportHash(withoutHash);
  if (
    computedHash !== reportHash ||
    (expectedHash !== undefined && expectedHash !== null && expectedHash !== computedHash)
  ) {
    throw new WebsiteEvaluationRuntimeError(
      "WEBSITE_EVALUATION_REPORT_IMMUTABLE",
      "权威评估报告内容摘要不一致。",
      false,
    );
  }
  return report;
}

/**
 * Serializes all attempt reservations on the oldest durable evaluation row.
 * The row lock is transaction-scoped, so the same-day count and insert become
 * atomic across processes without adding a sixth website-evaluation table.
 */
export async function lockWebsiteEvaluationDailyBudget(tx: any) {
  const sentinel = sqlRows(await tx.execute(sql`
    SELECT id FROM site_evaluation_runs
    ORDER BY created_at ASC, id ASC
    LIMIT 1 FOR UPDATE
  `))[0];
  // An empty table means there cannot be an attempt to admit. Treat it as
  // ordinary idle work instead of turning every five-second sweep into a
  // transient failure log. Once a run exists, its oldest row is the stable
  // global serialization point for all attempt reservations.
  return Boolean(sentinel);
}

export async function websiteEvaluationDailyBudgetAdmission(input: {
  tx: any;
  environment?: Readonly<Record<string, string | undefined>>;
  now: Date;
}) {
  const dayStart = new Date(input.now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const usageRows = sqlRows(await input.tx.execute(sql`
    SELECT COUNT(*) AS usageUnits
    FROM site_evaluation_attempts
    WHERE created_at >= ${dayStart} AND created_at < ${dayEnd}
  `));
  const parsedUsage = Number(usageRows[0]?.usageUnits ?? 0);
  return websiteEvaluationWorkerAdmission({
    environment: input.environment,
    dailyUsageUnits: Number.isFinite(parsedUsage)
      ? Math.max(0, Math.floor(parsedUsage))
      : 0,
    requestedUnits: 1,
    activeProjectRuns: 0,
  });
}

/**
 * The managed judge may propose narrative findings, but it never owns the
 * arithmetic, verdict, timestamps, identifier or result hash. Those fields
 * are reconstructed here from the fixed 24 anchored judgments.
 */
export function authoritativeWebsiteEvaluationReport(input: {
  judgeOutput: unknown;
  model: string;
  skillHash: string;
  run: WebsiteEvaluationRuntimeRun;
  evidence: WebsiteEvaluationCapturedEvidence;
  now: Date;
}) {
  const frozen = {
    schemaVersion: 1 as const,
    operationToken: input.run.runId,
    evidenceFingerprint: input.run.evidenceFingerprint,
    projectId: input.run.projectId,
    buildId: input.run.buildId,
    stage: "build_readiness" as const,
    allowedEvidenceIds: input.evidence.allowedEvidenceIds,
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents" as const,
      model: input.model,
    } as const,
  };
  const output = validateWebsiteBuildEvaluationJudgeOutput(
    input.judgeOutput,
    frozen,
  );
  const scored = scoreWebsiteBuildEvaluation({
    judgments: output.judgments,
    criticalRisks: output.criticalRisks,
  });
  if (!scored.complete) {
    throw new WebsiteEvaluationRuntimeError(
      "REQUIRED_EVIDENCE_MISSING",
      "固定检查项缺失有效证据，未生成质量分。",
      false,
    );
  }
  const completedAt = input.now.toISOString();
  const withoutHash: Omit<WebsiteBuildEvaluationReport, "reportHash"> = {
    schemaVersion: 1,
    reportId: randomUUID(),
    runId: input.run.runId,
    projectId: input.run.projectId,
    buildId: input.run.buildId,
    buildOrdinal:
      input.evidence.buildOrdinal > 0
        ? input.evidence.buildOrdinal
        : Number(input.run.publicInput.buildOrdinal),
    stage: "build_readiness",
    evidenceFingerprint: input.run.evidenceFingerprint,
    evaluator: {
      ...frozen.evaluator,
      skillHash: input.skillHash,
      outputHash: sha256(output),
    },
    coverage: websiteBuildEvaluationCoverageSchema.parse(
      input.evidence.coverage,
    ),
    score: scored.score,
    verdict: scored.verdict,
    dimensions: scored.dimensions,
    summary: output.summary,
    judgments: output.judgments,
    criticalRisks: output.criticalRisks,
    findings: output.findings,
    relatedRagReportIds: input.evidence.relatedRagReportIds ?? [],
    comparablePreviousReportId:
      input.evidence.comparablePreviousReportId ?? null,
    createdAt: completedAt,
    completedAt,
  };
  return websiteBuildEvaluationReportSchema.parse({
    ...withoutHash,
    reportHash: websiteEvaluationReportHash(withoutHash),
  });
}

function runtimeRunFromRow(row: any): WebsiteEvaluationRuntimeRun {
  const attemptRuntime = storedJson(row.attemptRuntime);
  const evidence = attemptRuntime.evidence as WebsiteEvaluationCapturedEvidence | undefined;
  const pending = websiteBuildEvaluationReportSchema.safeParse(attemptRuntime.pendingReport);
  return {
    runId: row.runId,
    projectId: row.projectId,
    buildId: row.buildId,
    status: row.status,
    attemptCount: Number(row.attemptCount ?? 0),
    automaticRetryCount: Number(row.automaticRetryCount ?? 0),
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    evidenceFingerprint: row.evidenceFingerprint,
    evidenceVersion: row.evidenceVersion,
    ruleVersion: row.ruleVersion,
    judgeVersion: row.judgeVersion,
    skillVersion: row.skillVersion,
    frozenModel: row.frozenModel ?? null,
    frozenSkillHash: row.frozenSkillHash ?? null,
    publicInput: {
      projectId: row.projectId,
      buildId: row.buildId,
      buildOrdinal: Number(row.buildOrdinal ?? 0),
      stage: "build_readiness",
      ...(() => {
        const brief = storedJson(row.buildBrief);
        return {
          ...(brief.brandKitV1 ? { brandKitV1: brief.brandKitV1 } : {}),
          ...(brief.visitorTaskV1
            ? { visitorTaskV1: brief.visitorTaskV1 }
            : {}),
          ...(Array.isArray(brief.routes)
            ? {
                routes: brief.routes.map((route) => {
                  const value = storedJson(route);
                  return {
                    id: value.id,
                    slug: value.slug,
                    title: value.title,
                  };
                }),
              }
            : {}),
        };
      })(),
    },
    ...(evidence ? { evidence } : {}),
    ...(pending.success ? { pendingReport: pending.data } : {}),
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    ...(row.attemptTrigger ? { attemptTrigger: row.attemptTrigger } : {}),
    attemptRuntime,
  };
}

/** MySQL persistence adapter used by the Core host; all transitions are leased. */
export function createSqlWebsiteEvaluationRuntimeStore(input: {
  database(): Promise<MySql2Database<any>>;
  environment?: Readonly<Record<string, string | undefined>>;
}): WebsiteEvaluationRuntimeStore {
  const assertLease = async (
    tx: any,
    run: WebsiteEvaluationRuntimeRun,
    leaseOwner: string,
    now: Date,
  ) => {
    const row = sqlRows(await tx.execute(sql`
      SELECT id FROM site_evaluation_runs
      WHERE id = ${run.runId} AND lease_owner = ${leaseOwner}
        AND lease_expires_at > ${now}
      LIMIT 1 FOR UPDATE
    `))[0];
    if (!row) {
      throw new WebsiteEvaluationRuntimeError(
        "WEBSITE_EVALUATION_LEASE_LOST",
        "评估租约已失效。",
        true,
      );
    }
  };
  const updateAttempt = async (
    tx: any,
    run: WebsiteEvaluationRuntimeRun,
    values: {
      status: string;
      runtime?: Record<string, unknown>;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: Date | null;
    },
  ) => {
    if (!run.attemptId) {
      throw new WebsiteEvaluationRuntimeError(
        "WEBSITE_EVALUATION_ATTEMPT_MISSING",
        "评估尝试记录不可读。",
      );
    }
    await tx.execute(sql`
      UPDATE site_evaluation_attempts
      SET status = ${values.status},
          runtime = ${JSON.stringify(values.runtime === undefined ? run.attemptRuntime ?? {} : values.runtime)},
          error_code = ${values.errorCode === undefined ? null : values.errorCode},
          error_message = ${values.errorMessage === undefined ? null : values.errorMessage},
          completed_at = ${values.completedAt === undefined ? null : values.completedAt}
      WHERE id = ${run.attemptId} AND run_id = ${run.runId}
    `);
  };

  return {
    async claimNext({ leaseOwner, now, leaseExpiresAt, allowNewAttempt = true }) {
      const db = await input.database();
      return db.transaction(async (tx: any) => {
        if (!await lockWebsiteEvaluationDailyBudget(tx)) {
          return null;
        }
        const rows = sqlRows(await tx.execute(sql`
          SELECT r.id AS runId, r.project_id AS projectId, r.build_id AS buildId,
                 r.status, r.attempt_count AS attemptCount,
                 r.automatic_retry_count AS automaticRetryCount,
                 r.started_at AS startedAt,
                 r.evidence_fingerprint AS evidenceFingerprint,
                 r.evidence_manifest_version AS evidenceVersion,
                 r.rule_version AS ruleVersion, r.judge_version AS judgeVersion,
                 r.skill_version AS skillVersion, r.model AS frozenModel,
                 r.skill_hash AS frozenSkillHash,
                 b.ordinal AS buildOrdinal, b.brief AS buildBrief,
                 a.id AS attemptId, a.trigger AS attemptTrigger,
                 a.status AS attemptStatus, a.runtime AS attemptRuntime
          FROM site_evaluation_runs r
          INNER JOIN site_projects p ON p.id = r.project_id
          INNER JOIN site_builds b ON b.id = r.build_id AND b.project_id = r.project_id
          LEFT JOIN site_evaluation_attempts a
            ON a.run_id = r.id AND a.ordinal = r.attempt_count
          WHERE r.status IN ('queued', 'capturing', 'running', 'result_pending')
            AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ${now})
            AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= ${now})
            AND (
              ${allowNewAttempt}
              OR r.status <> 'queued'
              OR a.status = 'queued'
            )
            AND NOT EXISTS (
              SELECT 1 FROM site_evaluation_runs busy
              WHERE busy.project_id = r.project_id AND busy.id <> r.id
                AND (
                  busy.status IN ('capturing', 'running', 'result_pending')
                  OR (busy.status = 'queued' AND busy.lease_expires_at > ${now})
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM site_evaluation_reports report WHERE report.run_id = r.id
            )
          ORDER BY r.created_at ASC, r.id ASC
          LIMIT 1 FOR UPDATE SKIP LOCKED
        `));
        const row = rows[0];
        if (!row) return null;
        if (row.status === "queued" && row.attemptStatus !== "queued") {
          const admission = await websiteEvaluationDailyBudgetAdmission({
            tx,
            environment: input.environment,
            now,
          });
          if (!admission.admitted) return null;
          const ordinal = Number(row.attemptCount ?? 0) + 1;
          const trigger: WebsiteEvaluationAttemptTrigger = ordinal === 1
            ? "automatic"
            : Number(row.automaticRetryCount ?? 0) > 0
              ? "automatic_retry"
              : "manual_retry";
          const attemptId = randomUUID();
          await tx.execute(sql`
            INSERT INTO site_evaluation_attempts
              (id, run_id, ordinal, trigger, status, created_at)
            VALUES (${attemptId}, ${row.runId}, ${ordinal}, ${trigger}, 'queued', ${now})
          `);
          row.attemptId = attemptId;
          row.attemptTrigger = trigger;
          row.attemptStatus = "queued";
          row.attemptCount = ordinal;
          await tx.execute(sql`
            UPDATE site_evaluation_runs
            SET attempt_count = ${ordinal}, updated_at = ${now}
            WHERE id = ${row.runId}
          `);
        }
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET lease_owner = ${leaseOwner}, lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
          WHERE id = ${row.runId}
            AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
        `);
        return runtimeRunFromRow(row);
      });
    },

    async startAttempt({ run, leaseOwner, trigger, model, skillHash, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        const rows = sqlRows(await tx.execute(sql`
          SELECT r.attempt_count AS attemptCount, r.model AS frozenModel,
                 r.skill_hash AS frozenSkillHash,
                 a.id AS attemptId, a.status AS attemptStatus
          FROM site_evaluation_runs r
          LEFT JOIN site_evaluation_attempts a
            ON a.run_id = r.id AND a.ordinal = r.attempt_count
          WHERE r.id = ${run.runId} AND r.status = 'queued' AND r.lease_owner = ${leaseOwner}
            AND r.lease_expires_at > ${now}
          LIMIT 1 FOR UPDATE
        `));
        const row = rows[0];
        if (!row) throw new WebsiteEvaluationRuntimeError("WEBSITE_EVALUATION_LEASE_LOST", "评估租约已失效。", true);
        if (
          (row.frozenModel && row.frozenModel !== model) ||
          (row.frozenSkillHash && row.frozenSkillHash !== skillHash)
        ) {
          throw new WebsiteEvaluationRuntimeError(
            "WEBSITE_EVALUATION_RUNNER_MISMATCH",
            "评估重试不能切换已冻结的模型或 skill。",
            false,
          );
        }
        const attemptId = row.attemptId as string | null;
        const ordinal = Number(row.attemptCount ?? 0);
        if (!attemptId || row.attemptStatus !== "queued") {
          throw new WebsiteEvaluationRuntimeError(
            "WEBSITE_EVALUATION_ATTEMPT_MISSING",
            "网站评估尝试尚未完成原子预算预留。",
            true,
          );
        }
        await tx.execute(sql`
          UPDATE site_evaluation_attempts
          SET status = 'capturing', model = ${model}, started_at = ${now}, error_code = NULL,
              error_message = NULL, completed_at = NULL
          WHERE id = ${attemptId} AND run_id = ${run.runId}
        `);
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'capturing', attempt_count = ${ordinal}, started_at = ${now},
              model = COALESCE(model, ${model}),
              skill_hash = COALESCE(skill_hash, ${skillHash}),
              next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
              error_code = NULL, error_message = NULL, updated_at = ${now}
          WHERE id = ${run.runId} AND lease_owner = ${leaseOwner}
        `);
      });
    },

    async saveCapturedEvidence({ run, leaseOwner, evidence, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        await assertLease(tx, run, leaseOwner, now);
        await updateAttempt(tx, run, {
          status: "running",
          runtime: { ...(run.attemptRuntime ?? {}), evidence },
        });
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'running', lease_owner = NULL, lease_expires_at = NULL, updated_at = ${now}
          WHERE id = ${run.runId} AND status = 'capturing' AND lease_owner = ${leaseOwner}
        `);
      });
    },

    async savePendingReport({ run, leaseOwner, report, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        await assertLease(tx, run, leaseOwner, now);
        await updateAttempt(tx, run, {
          status: "result_pending",
          runtime: { ...(run.attemptRuntime ?? {}), evidence: run.evidence, pendingReport: report },
        });
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'result_pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ${now}
          WHERE id = ${run.runId} AND status = 'running' AND lease_owner = ${leaseOwner}
        `);
      });
    },

    async commitReportOnce({ run, leaseOwner, report, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        await assertLease(tx, run, leaseOwner, now);
        const verifiedReport = verifyWebsiteEvaluationReportIntegrity(
          report,
          report.reportHash,
        );
        const existing = sqlRows(await tx.execute(sql`
          SELECT id, result AS resultJson, result_hash AS resultHash
          FROM site_evaluation_reports
          WHERE run_id = ${run.runId} LIMIT 1 FOR UPDATE
        `))[0];
        if (existing) {
          try {
            verifyWebsiteEvaluationReportIntegrity(
              typeof existing.resultJson === "string"
                ? JSON.parse(existing.resultJson)
                : existing.resultJson,
              existing.resultHash,
            );
          } catch {
            throw new WebsiteEvaluationRuntimeError(
              "WEBSITE_EVALUATION_REPORT_IMMUTABLE",
              "已存在的权威报告未通过内容摘要校验。",
            );
          }
          if (existing.resultHash !== verifiedReport.reportHash) {
            throw new WebsiteEvaluationRuntimeError(
              "WEBSITE_EVALUATION_REPORT_IMMUTABLE",
              "同一逻辑评估已存在不同哈希的权威报告。",
            );
          }
        }
        if (!existing) {
          const evidence = run.evidence;
          if (!evidence) throw new WebsiteEvaluationRuntimeError("REQUIRED_EVIDENCE_MISSING", "冻结证据不可读。");
          await tx.execute(sql`
            INSERT INTO site_evaluation_reports
              (id, run_id, user_id, project_id, build_id, stage,
               evidence_fingerprint, evidence_local_asset_id, evidence_hash,
               rule_version, judge_version, skill_version, frozen_evidence,
               judgments, result, result_hash, completed_at, created_at)
            SELECT ${verifiedReport.reportId}, r.id, r.user_id, r.project_id, r.build_id, r.stage,
                   r.evidence_fingerprint, ${evidence.artifactId}, ${evidence.evidenceHash},
                   r.rule_version, r.judge_version, r.skill_version,
                   ${JSON.stringify(evidence.publicEvidence)}, ${JSON.stringify(verifiedReport.judgments)}, ${JSON.stringify(verifiedReport)},
                   ${verifiedReport.reportHash}, ${new Date(verifiedReport.completedAt)}, ${now}
            FROM site_evaluation_runs r
            WHERE r.id = ${run.runId} AND r.lease_owner = ${leaseOwner}
          `);
        }
        await updateAttempt(tx, run, { status: "completed", completedAt: now });
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'completed', completed_at = ${now},
              lease_owner = NULL, lease_expires_at = NULL,
              error_code = NULL, error_message = NULL, updated_at = ${now}
          WHERE id = ${run.runId} AND lease_owner = ${leaseOwner}
        `);
      });
    },

    async scheduleAutomaticRetry({ run, leaseOwner, code, message, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        await assertLease(tx, run, leaseOwner, now);
        if (run.attemptId) {
          await updateAttempt(tx, run, {
            status: "failed", errorCode: code, errorMessage: message, completedAt: now,
          });
        }
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'queued', automatic_retry_count = automatic_retry_count + 1,
              next_attempt_at = ${now}, started_at = NULL,
              lease_owner = NULL, lease_expires_at = NULL,
              error_code = ${code}, error_message = ${message}, updated_at = ${now}
          WHERE id = ${run.runId} AND lease_owner = ${leaseOwner}
            AND automatic_retry_count < ${WEBSITE_EVALUATION_MAX_AUTOMATIC_RETRIES}
        `);
      });
    },

    async failTerminal({ run, leaseOwner, code, message, now }) {
      const db = await input.database();
      await db.transaction(async (tx: any) => {
        await assertLease(tx, run, leaseOwner, now);
        if (run.attemptId) {
          await updateAttempt(tx, run, {
            status: "failed", errorCode: code, errorMessage: message, completedAt: now,
          });
        }
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'failed', completed_at = ${now}, next_attempt_at = NULL,
              lease_owner = NULL, lease_expires_at = NULL,
              error_code = ${code}, error_message = ${message}, updated_at = ${now}
          WHERE id = ${run.runId} AND lease_owner = ${leaseOwner}
        `);
      });
    },
  };
}

export interface WebsiteEvaluationRunner {
  readonly model: string;
  readonly skillHash: string;
  capture(input: {
    runId: string;
    buildId: string;
    evidenceFingerprint: string;
    publicInput: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<WebsiteEvaluationCapturedEvidence>;
  judge(input: {
    runId: string;
    buildId: string;
    evidenceFingerprint: string;
    evidence: WebsiteEvaluationCapturedEvidence;
    signal: AbortSignal;
    versions: {
      evidence: string;
      rule: string;
      judge: string;
      skill: string;
    };
  }): Promise<WebsiteBuildEvaluationJudgeOutput>;
}

export class WebsiteEvaluationRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly transient = false,
  ) {
    super(message);
    this.name = "WebsiteEvaluationRuntimeError";
  }
}

function runtimeError(error: unknown) {
  if (error instanceof WebsiteEvaluationRuntimeError) return error;
  return new WebsiteEvaluationRuntimeError(
    "WEBSITE_EVALUATION_RUNTIME_FAILED",
    error instanceof Error ? error.message : "网站评估运行失败。",
    false,
  );
}

function assertFrozenVersions(
  run: WebsiteEvaluationRuntimeRun,
  runner: WebsiteEvaluationRunner,
) {
  const valid =
    run.evidenceVersion === WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION &&
    run.ruleVersion === WEBSITE_BUILD_EVALUATION_RULE_VERSION &&
    run.judgeVersion === WEBSITE_BUILD_EVALUATION_JUDGE_VERSION &&
    run.skillVersion === WEBSITE_BUILD_EVALUATION_SKILL_VERSION &&
    (!run.frozenModel || run.frozenModel === runner.model) &&
    (!run.frozenSkillHash || run.frozenSkillHash === runner.skillHash);
  if (!valid) {
    throw new WebsiteEvaluationRuntimeError(
      "WEBSITE_EVALUATION_VERSION_MISMATCH",
      "评估任务的规则、裁判或证据版本与冻结运行时不一致。",
      false,
    );
  }
}

function attemptExpired(
  run: WebsiteEvaluationRuntimeRun,
  now: Date,
  maxAttemptMs = WEBSITE_EVALUATION_MAX_ATTEMPT_MS,
) {
  return Boolean(
    run.startedAt && now.getTime() - run.startedAt.getTime() >= maxAttemptMs,
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function evidenceValidationError(error: unknown): never {
  const detail = error instanceof Error ? error.message : "";
  const missing = detail.includes("REQUIRED_EVIDENCE_MISSING");
  throw new WebsiteEvaluationRuntimeError(
    missing ? "REQUIRED_EVIDENCE_MISSING" : "REQUIRED_EVIDENCE_INVALID",
    missing
      ? "必需评估证据缺失，未生成质量分。"
      : "冻结证据清单未通过完整性校验，未生成质量分。",
    false,
  );
}

function validateCapturedEvidence(
  run: WebsiteEvaluationRuntimeRun,
  evidence: WebsiteEvaluationCapturedEvidence,
) {
  if (!/^[a-f0-9]{64}$/u.test(evidence.evidenceHash)) {
    throw new WebsiteEvaluationRuntimeError(
      "REQUIRED_EVIDENCE_INVALID",
      "冻结证据摘要不可读，未生成质量分。",
      false,
    );
  }
  if (!Number.isInteger(evidence.buildOrdinal) || evidence.buildOrdinal < 1) {
    throw new WebsiteEvaluationRuntimeError(
      "REQUIRED_EVIDENCE_INVALID",
      "构建版本坐标不可读，未生成质量分。",
      false,
    );
  }
  const coverage = websiteBuildEvaluationCoverageSchema.parse(evidence.coverage);
  let frozen: ReturnType<typeof freezeWebsiteEvaluationEvidenceManifest>;
  try {
    frozen = freezeWebsiteEvaluationEvidenceManifest(evidence.publicEvidence);
  } catch (error) {
    evidenceValidationError(error);
  }
  if (
    frozen.manifest.buildId !== run.buildId ||
    frozen.evidenceHash !== evidence.evidenceHash ||
    !sameOrderedStrings(frozen.allowedEvidenceIds, evidence.allowedEvidenceIds) ||
    !sameOrderedStrings(
      frozen.frozen.criticalRoutes.map(({ id }) => id),
      coverage.criticalRouteIds,
    ) ||
    !sameOrderedStrings(
      frozen.frozen.structuralRoutes.map(({ id }) => id),
      coverage.structuralRouteIds,
    ) ||
    !sameOrderedStrings(
      frozen.frozen.viewports.map(({ id }) => id),
      coverage.viewports,
    )
  ) {
    throw new WebsiteEvaluationRuntimeError(
      "REQUIRED_EVIDENCE_INVALID",
      "冻结证据摘要或覆盖坐标不一致，未生成质量分。",
      false,
    );
  }
  const visitorTask = run.publicInput.visitorTaskV1;
  const assistantRequired = Boolean(
    visitorTask &&
      typeof visitorTask === "object" &&
      !Array.isArray(visitorTask) &&
      (visitorTask as Record<string, unknown>).assistantRequired === true,
  );
  if (
    assistantRequired &&
    (!evidence.assistantProbe ||
      evidence.assistantProbe.mode !== "isolated_read_only" ||
      evidence.assistantProbe.conversationWritten !== false ||
      !evidence.allowedEvidenceIds.includes(evidence.assistantProbe.evidenceId))
  ) {
    throw new WebsiteEvaluationRuntimeError(
      "REQUIRED_ASSISTANT_PROBE_MISSING",
      "核心访客任务要求使用助手，但隔离只读探测证据缺失。",
      false,
    );
  }
}

export function createWebsiteEvaluationRuntime(input: {
  store: WebsiteEvaluationRuntimeStore;
  runner: WebsiteEvaluationRunner;
  leaseOwner?: string;
  now?: () => Date;
  /** Test-only override; production uses the fixed 30-minute contract. */
  maxAttemptMs?: number;
}) {
  const leaseOwner = input.leaseOwner ?? `website-evaluation:${randomUUID()}`;
  const now = input.now ?? (() => new Date());
  const maxAttemptMs = input.maxAttemptMs ?? WEBSITE_EVALUATION_MAX_ATTEMPT_MS;

  const timeoutError = () => new WebsiteEvaluationRuntimeError(
    "WEBSITE_EVALUATION_ATTEMPT_TIMEOUT",
    "网站评估单次尝试已超过 30 分钟。",
    true,
  );

  async function withinAttemptDeadline<T>(
    run: WebsiteEvaluationRuntimeRun,
    operation: (signal: AbortSignal) => Promise<T>,
  ) {
    if (!run.startedAt) {
      throw new WebsiteEvaluationRuntimeError(
        "WEBSITE_EVALUATION_ATTEMPT_MISSING",
        "网站评估尝试缺少开始时间。",
        false,
      );
    }
    const remainingMs = run.startedAt.getTime() + maxAttemptMs - now().getTime();
    if (remainingMs <= 0) throw timeoutError();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const error = timeoutError();
        reject(error);
        controller.abort(error);
      }, remainingMs);
      timer.unref?.();
    });
    try {
      const result = await Promise.race([operation(controller.signal), timeout]);
      if (attemptExpired(run, now(), maxAttemptMs)) throw timeoutError();
      return result;
    } catch (error) {
      if (timedOut || controller.signal.aborted) throw timeoutError();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fail(run: WebsiteEvaluationRuntimeRun, error: unknown, at: Date) {
    const failure = runtimeError(error);
    if (
      failure.transient &&
      run.automaticRetryCount < WEBSITE_EVALUATION_MAX_AUTOMATIC_RETRIES
    ) {
      await input.store.scheduleAutomaticRetry({
        run,
        leaseOwner,
        code: failure.code,
        message: failure.message,
        now: at,
      });
      return "queued" as const;
    }
    await input.store.failTerminal({
      run,
      leaseOwner,
      code: failure.code,
      message: failure.message,
      now: at,
    });
    return "failed" as const;
  }

  async function advance(run: WebsiteEvaluationRuntimeRun) {
    const at = now();
    try {
      assertFrozenVersions(run, input.runner);
      if (attemptExpired(run, at, maxAttemptMs)) throw timeoutError();
      if (run.status === "queued") {
        const trigger: WebsiteEvaluationAttemptTrigger = run.attemptTrigger ?? (run.attemptCount === 0
          ? "automatic"
          : run.automaticRetryCount > 0
            ? "automatic_retry"
            : "manual_retry");
        await input.store.startAttempt({
          run,
          leaseOwner,
          trigger,
          model: input.runner.model,
          skillHash: input.runner.skillHash,
          now: at,
        });
        return "capturing" as const;
      }
      if (run.status === "capturing") {
        const evidence = await withinAttemptDeadline(run, (signal) =>
          input.runner.capture({
            runId: run.runId,
            buildId: run.buildId,
            evidenceFingerprint: run.evidenceFingerprint,
            publicInput: structuredClone(run.publicInput),
            signal,
          }));
        validateCapturedEvidence(run, evidence);
        const completedAt = now();
        if (attemptExpired(run, completedAt, maxAttemptMs)) throw timeoutError();
        await input.store.saveCapturedEvidence({ run, leaseOwner, evidence, now: completedAt });
        return "running" as const;
      }
      if (run.status === "running") {
        const evidence = run.evidence;
        if (!evidence) {
          throw new WebsiteEvaluationRuntimeError(
            "REQUIRED_EVIDENCE_MISSING",
            "冻结证据不可读，未生成质量分。",
            false,
          );
        }
        validateCapturedEvidence(run, evidence);
        const judgeOutput = await withinAttemptDeadline(run, (signal) => input.runner.judge({
            runId: run.runId,
            buildId: run.buildId,
            evidenceFingerprint: run.evidenceFingerprint,
            evidence: structuredClone(evidence),
            signal,
            versions: {
              evidence: run.evidenceVersion,
              rule: run.ruleVersion,
              judge: run.judgeVersion,
              skill: run.skillVersion,
            },
          }));
        const completedAt = now();
        if (attemptExpired(run, completedAt, maxAttemptMs)) throw timeoutError();
        const report = authoritativeWebsiteEvaluationReport({
          judgeOutput,
          model: input.runner.model,
          skillHash: input.runner.skillHash,
          run,
          evidence,
          now: completedAt,
        });
        await input.store.savePendingReport({
          run: { ...run, evidence },
          leaseOwner,
          report,
          now: completedAt,
        });
        return "result_pending" as const;
      }
      if (run.status === "result_pending") {
        if (!run.pendingReport) {
          throw new WebsiteEvaluationRuntimeError(
            "WEBSITE_EVALUATION_RESULT_MISSING",
            "评估结果同步不完整。",
            true,
          );
        }
        await input.store.commitReportOnce({
          run,
          leaseOwner,
          report: verifyWebsiteEvaluationReportIntegrity(run.pendingReport),
          now: now(),
        });
        return "completed" as const;
      }
      return run.status;
    } catch (error) {
      return fail(run, error, now());
    }
  }

  return {
    leaseOwner,
    advance,
    async runOnce() {
      const at = now();
      const run = await input.store.claimNext({
        leaseOwner,
        now: at,
        leaseExpiresAt: new Date(at.getTime() + WEBSITE_EVALUATION_LEASE_MS),
      });
      if (!run) return null;
      return { runId: run.runId, status: await advance(run) };
    },
    startSweeper() {
      let active = false;
      const timer = setInterval(() => {
        if (active) return;
        active = true;
        void this.runOnce().finally(() => { active = false; });
      }, WEBSITE_EVALUATION_SWEEP_INTERVAL_MS);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}

/** Explicit local/test adapter. It never performs network or paid work. */
export function createFakeWebsiteEvaluationRunner(fixtures: {
  evidence: WebsiteEvaluationCapturedEvidence;
  judgeOutput: WebsiteBuildEvaluationJudgeOutput;
  model?: string;
  skillHash?: string;
}): WebsiteEvaluationRunner {
  return {
    model: fixtures.model ?? "local-fake-website-judge",
    skillHash: fixtures.skillHash ?? "f".repeat(64),
    async capture() { return structuredClone(fixtures.evidence); },
    async judge() { return structuredClone(fixtures.judgeOutput); },
  };
}
