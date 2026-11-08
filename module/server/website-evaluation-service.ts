import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import {
  websiteBuildEvaluationHistoryDtoSchema,
  websiteBuildEvaluationReportSchema,
  websiteBuildEvaluationRetryInputSchema,
  websiteBuildEvaluationReviewInputSchema,
  websiteBuildEvaluationReviewSchema,
  websiteBuildEvaluationRunDtoSchema,
  type WebsiteBuildEvaluationHistoryDto,
  type WebsiteBuildEvaluationReport,
  type WebsiteBuildEvaluationReview,
  type WebsiteBuildEvaluationReviewInput,
  type WebsiteBuildEvaluationRunDto,
} from "../contracts/website-build-evaluation-run.js";
import type { ModuleHttpCore } from "./http-api.js";
import {
  lockWebsiteEvaluationDailyBudget,
  verifyWebsiteEvaluationReportIntegrity,
  websiteEvaluationDailyBudgetAdmission,
} from "./website-evaluation-runtime.js";

const coordinateSchema = z.object({
  projectId: z.string().uuid(),
  buildId: z.string().uuid(),
  cursor: z.string().trim().min(1).max(512).optional(),
}).strict();

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  runId: z.string().uuid(),
}).strict();

export type WebsiteEvaluationOwner = {
  accountUserId: number;
  actorUserId: number;
  enterpriseProjectId: string | null;
};

export interface WebsiteEvaluationStore {
  list(input: WebsiteEvaluationOwner & {
    projectId: string;
    buildId: string;
    cursor?: string;
    limit: 20;
  }): Promise<WebsiteBuildEvaluationHistoryDto>;
  getRun(input: WebsiteEvaluationOwner & { runId: string }): Promise<WebsiteBuildEvaluationRunDto | null>;
  retry(input: WebsiteEvaluationOwner & { runId: string; clientRequestId: string }): Promise<WebsiteBuildEvaluationRunDto>;
  getReport(input: WebsiteEvaluationOwner & { reportId: string }): Promise<WebsiteBuildEvaluationReport | null>;
  listReviews(input: WebsiteEvaluationOwner & { reportId: string }): Promise<WebsiteBuildEvaluationReview[]>;
  appendReview(input: WebsiteEvaluationOwner & {
    reportId: string;
    review: WebsiteBuildEvaluationReviewInput;
  }): Promise<WebsiteBuildEvaluationReview>;
}

export class WebsiteEvaluationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "WebsiteEvaluationError";
  }
}

function resultRows(result: any): any[] {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function iso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new WebsiteEvaluationError(
      "EVALUATION_RECORD_INVALID",
      "网站评估记录的时间坐标无效。",
      503,
    );
  }
  return date.toISOString();
}

function encodeCursor(value: z.infer<typeof cursorSchema>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new WebsiteEvaluationError(
      "INVALID_CURSOR",
      "评估历史游标无效，请重新加载。",
      400,
    );
  }
}

function reportFromRow(row: any): WebsiteBuildEvaluationReport | null {
  if (row?.reportJson === null || row?.reportJson === undefined) return null;
  try {
    return verifyWebsiteEvaluationReportIntegrity(
      jsonValue(row.reportJson),
      row.reportResultHash,
    );
  } catch {
    throw new WebsiteEvaluationError(
      "EVALUATION_REPORT_INVALID",
      "权威评估报告未通过完整性校验。",
      503,
    );
  }
}

function runFromRow(row: any): WebsiteBuildEvaluationRunDto {
  return websiteBuildEvaluationRunDtoSchema.parse({
    runId: row.runId,
    projectId: row.projectId,
    buildId: row.buildId,
    stage: row.stage,
    status: row.status,
    attemptCount: Number(row.attemptCount ?? 0),
    automatic: true,
    evidenceFingerprint: row.evidenceFingerprint,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    report: reportFromRow(row),
    error: row.errorCode
      ? { code: row.errorCode, message: row.errorMessage || "网站评估未完成。" }
      : null,
  });
}

function reviewFromRow(row: any): WebsiteBuildEvaluationReview {
  try {
    const stored = typeof row.checkReviews === "string"
      ? JSON.parse(row.checkReviews)
      : row.checkReviews;
    const legacy = Array.isArray(stored);
    if (!legacy && (!stored
      || typeof stored !== "object"
      || !Array.isArray((stored as any).checkComments))) {
      throw new Error("invalid stored review payload");
    }
    const checkComments = legacy ? stored : (stored as any).checkComments;
    const repairItem = legacy ? undefined : (stored as any).repairItem;
    return websiteBuildEvaluationReviewSchema.parse({
      reviewId: row.reviewId,
      reportId: row.reportId,
      reviewerUserId: Number(row.reviewerUserId),
      disposition: row.disposition,
      checkComments,
      ...(repairItem === undefined ? {} : { repairItem }),
      note: row.note ?? "",
      createdAt: iso(row.createdAt),
    });
  } catch (cause) {
    if (cause instanceof WebsiteEvaluationError) throw cause;
    throw new WebsiteEvaluationError(
      "EVALUATION_REVIEW_INVALID",
      "人工复核记录未通过完整性校验。",
      503,
    );
  }
}

function sameReviewPayload(
  stored: WebsiteBuildEvaluationReview,
  requested: WebsiteBuildEvaluationReviewInput,
) {
  if (stored.disposition !== requested.disposition || stored.note !== requested.note) {
    return false;
  }
  if (stored.repairItem?.kind !== requested.repairItem?.kind
    || stored.repairItem?.id !== requested.repairItem?.id) {
    return false;
  }
  if (stored.checkComments.length !== requested.checkComments.length) return false;
  return stored.checkComments.every((comment, index) => {
    const requestedComment = requested.checkComments[index];
    return requestedComment !== undefined
      && comment.checkId === requestedComment.checkId
      && comment.comment === requestedComment.comment;
  });
}

function assertReviewRepairItem(
  report: WebsiteBuildEvaluationReport,
  repairItem: WebsiteBuildEvaluationReviewInput["repairItem"],
) {
  if (!repairItem) return;
  const belongsToReport = repairItem.kind === "critical_risk"
    ? report.criticalRisks.some((risk) => risk.id === repairItem.id)
    : report.findings.some((finding) => finding.id === repairItem.id);
  if (!belongsToReport) {
    throw new WebsiteEvaluationError(
      "EVALUATION_REVIEW_TARGET_INVALID",
      "评审所关联的修复项不属于当前网站评估报告。",
      400,
    );
  }
}

const runProjection = sql.raw(`
  r.id AS runId,
  r.project_id AS projectId,
  r.build_id AS buildId,
  r.stage AS stage,
  r.status AS status,
  r.attempt_count AS attemptCount,
  r.evidence_fingerprint AS evidenceFingerprint,
  r.error_code AS errorCode,
  r.error_message AS errorMessage,
  r.created_at AS createdAt,
  r.updated_at AS updatedAt,
  rep.result AS reportJson,
  rep.result_hash AS reportResultHash
`);

export function createSqlWebsiteEvaluationStore(core: ModuleHttpCore): WebsiteEvaluationStore {
  const requireManualRetryAdmission = async (db: any, now: Date) => {
    const admission = await websiteEvaluationDailyBudgetAdmission({
      tx: db,
      environment: core.environment,
      now,
    });
    if (!admission.admitted) {
      throw new WebsiteEvaluationError(
        admission.reason === "daily_budget_exhausted"
          ? "EVALUATION_DAILY_BUDGET_EXHAUSTED"
          : "EVALUATION_WORKER_DISABLED",
        admission.reason === "daily_budget_exhausted"
          ? "今日网站评估预算已用尽，请稍后再试。"
          : "网站评估 worker 当前已停用，暂不能重试。",
        503,
      );
    }
  };
  const ownedRun = async (db: any, owner: WebsiteEvaluationOwner, runId: string, lock = false) => {
    const result = await db.execute(sql`
      SELECT ${runProjection}
      FROM site_evaluation_runs r
      INNER JOIN site_projects p ON p.id = r.project_id
      LEFT JOIN site_evaluation_reports rep ON rep.run_id = r.id
      WHERE r.id = ${runId}
        AND r.admission_mode = 'user'
        AND r.user_id = ${owner.accountUserId}
        AND p.user_id = ${owner.accountUserId}
        AND r.enterpriseProjectId <=> ${owner.enterpriseProjectId}
        AND p.enterpriseProjectId <=> ${owner.enterpriseProjectId}
      LIMIT 1
      ${lock ? sql.raw("FOR UPDATE") : sql``}
    `);
    return resultRows(result)[0] ?? null;
  };

  const ownedReport = async (db: any, owner: WebsiteEvaluationOwner, reportId: string, lock = false) => {
    const result = await db.execute(sql`
      SELECT rep.id AS reportId, rep.result AS reportJson,
             rep.result_hash AS reportResultHash
      FROM site_evaluation_reports rep
      INNER JOIN site_evaluation_runs r ON r.id = rep.run_id
      INNER JOIN site_projects p ON p.id = rep.project_id
      WHERE rep.id = ${reportId}
        AND r.admission_mode = 'user'
        AND rep.user_id = ${owner.accountUserId}
        AND r.user_id = ${owner.accountUserId}
        AND p.user_id = ${owner.accountUserId}
        AND r.enterpriseProjectId <=> ${owner.enterpriseProjectId}
        AND p.enterpriseProjectId <=> ${owner.enterpriseProjectId}
      LIMIT 1
      ${lock ? sql.raw("FOR UPDATE") : sql``}
    `);
    return resultRows(result)[0] ?? null;
  };

  return {
    async list(input) {
      const cursor = decodeCursor(input.cursor);
      const db = await core.database();
      const ownedBuildRows = resultRows(await db.execute(sql`
        SELECT b.id AS buildId
        FROM site_builds b
        INNER JOIN site_projects p ON p.id = b.project_id
        WHERE b.id = ${input.buildId}
          AND b.project_id = ${input.projectId}
          AND b.user_id = ${input.accountUserId}
          AND p.user_id = ${input.accountUserId}
          AND p.enterpriseProjectId <=> ${input.enterpriseProjectId}
        LIMIT 1
      `));
      if (!ownedBuildRows[0]) {
        return { latest: null, history: [], nextCursor: null };
      }
      const result = await db.execute(sql`
        SELECT ${runProjection}
        FROM site_evaluation_runs r
        INNER JOIN site_projects p ON p.id = r.project_id
        LEFT JOIN site_evaluation_reports rep ON rep.run_id = r.id
        WHERE r.project_id = ${input.projectId}
          AND r.admission_mode = 'user'
          AND r.user_id = ${input.accountUserId}
          AND p.user_id = ${input.accountUserId}
          AND r.enterpriseProjectId <=> ${input.enterpriseProjectId}
          AND p.enterpriseProjectId <=> ${input.enterpriseProjectId}
          ${cursor ? sql`AND (r.created_at < ${cursor.createdAt} OR (r.created_at = ${cursor.createdAt} AND r.id < ${cursor.runId}))` : sql``}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 21
      `);
      const rows = resultRows(result);
      const page = rows.slice(0, 20);
      const history = page.map(runFromRow);
      const tail = page.at(-1);
      const latestRows = resultRows(await db.execute(sql`
        SELECT ${runProjection}
        FROM site_evaluation_runs r
        INNER JOIN site_projects p ON p.id = r.project_id
        LEFT JOIN site_evaluation_reports rep ON rep.run_id = r.id
        WHERE r.project_id = ${input.projectId}
          AND r.build_id = ${input.buildId}
          AND r.admission_mode = 'user'
          AND r.user_id = ${input.accountUserId}
          AND p.user_id = ${input.accountUserId}
          AND r.enterpriseProjectId <=> ${input.enterpriseProjectId}
          AND p.enterpriseProjectId <=> ${input.enterpriseProjectId}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      `));
      const latest = latestRows[0] ? runFromRow(latestRows[0]) : null;
      return {
        latest,
        history,
        nextCursor: rows.length > 20 && tail
          ? encodeCursor({ createdAt: iso(tail.createdAt), runId: tail.runId })
          : null,
      };
    },

    async getRun(input) {
      const db = await core.database();
      const row = await ownedRun(db, input, input.runId);
      return row ? runFromRow(row) : null;
    },

    async retry(input) {
      const db = await core.database();
      await db.transaction(async (tx: any) => {
        const budgetLocked = await lockWebsiteEvaluationDailyBudget(tx);
        const row = await ownedRun(tx, input, input.runId, true);
        if (!row) throw new WebsiteEvaluationError("EVALUATION_NOT_FOUND", "未找到此网站评估。", 404);
        if (!budgetLocked) {
          throw new WebsiteEvaluationError(
            "EVALUATION_BUDGET_LOCK_UNAVAILABLE",
            "网站评估预算锁暂不可用，请稍后再试。",
            503,
          );
        }
        const existing = resultRows(await tx.execute(sql`
          SELECT id FROM site_evaluation_attempts
          WHERE run_id = ${input.runId} AND client_request_id = ${input.clientRequestId}
          LIMIT 1
        `))[0];
        if (existing) return;
        if (row.reportJson !== null && row.reportJson !== undefined) {
          throw new WebsiteEvaluationError("EVALUATION_ALREADY_COMPLETED", "已完成的权威报告不可重写。", 409);
        }
        if (row.status !== "failed") {
          throw new WebsiteEvaluationError("EVALUATION_RETRY_NOT_READY", "仅可重试已终止失败的评估。", 409);
        }
        const ordinal = Number(row.attemptCount ?? 0) + 1;
        const now = new Date();
        await requireManualRetryAdmission(tx, now);
        await tx.execute(sql`
          INSERT INTO site_evaluation_attempts
            (id, run_id, ordinal, trigger, client_request_id, status, created_at)
          VALUES
            (${randomUUID()}, ${input.runId}, ${ordinal}, 'manual_retry', ${input.clientRequestId}, 'queued', ${now})
        `);
        await tx.execute(sql`
          UPDATE site_evaluation_runs
          SET status = 'queued', attempt_count = ${ordinal}, next_attempt_at = ${now},
              started_at = NULL,
              lease_owner = NULL, lease_expires_at = NULL,
              error_code = NULL, error_message = NULL, completed_at = NULL,
              updated_at = ${now}
          WHERE id = ${input.runId}
        `);
      });
      const refreshed = await this.getRun(input);
      if (!refreshed) throw new WebsiteEvaluationError("EVALUATION_NOT_FOUND", "未找到此网站评估。", 404);
      return refreshed;
    },

    async getReport(input) {
      const db = await core.database();
      const row = await ownedReport(db, input, input.reportId);
      if (!row) return null;
      return reportFromRow(row);
    },

    async listReviews(input) {
      const db = await core.database();
      if (!await ownedReport(db, input, input.reportId)) return [];
      const result = await db.execute(sql`
        SELECT id AS reviewId, report_id AS reportId, reviewer_user_id AS reviewerUserId,
               disposition, check_reviews AS checkReviews, note, created_at AS createdAt
        FROM site_evaluation_reviews
        WHERE report_id = ${input.reportId} AND user_id = ${input.accountUserId}
        ORDER BY created_at ASC, id ASC
      `);
      return resultRows(result).map(reviewFromRow);
    },

    async appendReview(input) {
      const db = await core.database();
      let reviewId = "";
      await db.transaction(async (tx: any) => {
        const reportRow = await ownedReport(tx, input, input.reportId, true);
        if (!reportRow) {
          throw new WebsiteEvaluationError("EVALUATION_REPORT_NOT_FOUND", "未找到此网站评估报告。", 404);
        }
        const report = reportFromRow(reportRow);
        if (!report) {
          throw new WebsiteEvaluationError("EVALUATION_REPORT_NOT_FOUND", "未找到此网站评估报告。", 404);
        }
        assertReviewRepairItem(report, input.review.repairItem);
        const requestedReviewId = randomUUID();
        await tx.execute(sql`
          INSERT INTO site_evaluation_reviews
            (id, report_id, user_id, reviewer_user_id, client_request_id, disposition, check_reviews, note, created_at)
          VALUES
            (${requestedReviewId}, ${input.reportId}, ${input.accountUserId}, ${input.actorUserId},
             ${input.review.clientRequestId}, ${input.review.disposition},
             ${JSON.stringify({
               checkComments: input.review.checkComments,
               ...(input.review.repairItem ? { repairItem: input.review.repairItem } : {}),
             })}, ${input.review.note}, ${new Date()})
          ON DUPLICATE KEY UPDATE id = id
        `);
        const storedRow = resultRows(await tx.execute(sql`
          SELECT id AS reviewId, report_id AS reportId, reviewer_user_id AS reviewerUserId,
                 disposition, check_reviews AS checkReviews, note, created_at AS createdAt
          FROM site_evaluation_reviews
          WHERE report_id = ${input.reportId}
            AND user_id = ${input.accountUserId}
            AND client_request_id = ${input.review.clientRequestId}
          LIMIT 1
        `))[0];
        if (!storedRow) {
          throw new WebsiteEvaluationError(
            "EVALUATION_REVIEW_UNAVAILABLE",
            "人工复核记录暂不可读。",
            503,
          );
        }
        const storedReview = reviewFromRow(storedRow);
        if (!sameReviewPayload(storedReview, input.review)) {
          throw new WebsiteEvaluationError(
            "EVALUATION_REVIEW_IDEMPOTENCY_CONFLICT",
            "这次评审请求与已保存内容不一致，请重新提交。",
            409,
          );
        }
        reviewId = storedReview.reviewId;
      });
      const result = await db.execute(sql`
        SELECT id AS reviewId, report_id AS reportId, reviewer_user_id AS reviewerUserId,
               disposition, check_reviews AS checkReviews, note, created_at AS createdAt
        FROM site_evaluation_reviews
        WHERE id = ${reviewId} AND report_id = ${input.reportId} AND user_id = ${input.accountUserId}
        LIMIT 1
      `);
      const row = resultRows(result)[0];
      if (!row) throw new WebsiteEvaluationError("EVALUATION_REVIEW_UNAVAILABLE", "人工复核记录暂不可读。", 503);
      return reviewFromRow(row);
    },
  };
}

export function createWebsiteEvaluationService(core: ModuleHttpCore, request: Request) {
  const context = core.context(request);
  const owner: WebsiteEvaluationOwner = {
    accountUserId: context.accountUserId,
    actorUserId: context.actorUserId,
    enterpriseProjectId: context.enterpriseProjectId,
  };
  const store = core.websiteEvaluationStore ?? createSqlWebsiteEvaluationStore(core);
  const requireRun = async (runId: string) => {
    const parsed = z.string().uuid().parse(runId);
    const run = await store.getRun({ ...owner, runId: parsed });
    if (!run) throw new WebsiteEvaluationError("EVALUATION_NOT_FOUND", "未找到此网站评估。", 404);
    return websiteBuildEvaluationRunDtoSchema.parse(run);
  };
  const requireReport = async (reportId: string) => {
    const parsed = z.string().trim().min(1).max(128).parse(reportId);
    const report = await store.getReport({ ...owner, reportId: parsed });
    if (!report) throw new WebsiteEvaluationError("EVALUATION_REPORT_NOT_FOUND", "未找到此网站评估报告。", 404);
    return websiteBuildEvaluationReportSchema.parse(report);
  };
  return {
    async latest(projectId: unknown, buildId: unknown, cursor?: unknown) {
      const coordinate = coordinateSchema.parse({ projectId, buildId, ...(cursor ? { cursor } : {}) });
      const result = await store.list({ ...owner, ...coordinate, limit: 20 });
      return websiteBuildEvaluationHistoryDtoSchema.parse(result);
    },
    observe: requireRun,
    async retry(runId: string, value: unknown) {
      const parsedRunId = z.string().uuid().parse(runId);
      const retry = websiteBuildEvaluationRetryInputSchema.parse(value);
      return websiteBuildEvaluationRunDtoSchema.parse(
        await store.retry({ ...owner, runId: parsedRunId, clientRequestId: retry.clientRequestId }),
      );
    },
    report: requireReport,
    async reviews(reportId: string) {
      await requireReport(reportId);
      return z.array(websiteBuildEvaluationReviewSchema).parse(
        await store.listReviews({ ...owner, reportId }),
      );
    },
    async appendReview(reportId: string, value: unknown) {
      const report = await requireReport(reportId);
      const review = websiteBuildEvaluationReviewInputSchema.parse(value);
      assertReviewRepairItem(report, review.repairItem);
      return websiteBuildEvaluationReviewSchema.parse(
        await store.appendReview({ ...owner, reportId, review }),
      );
    },
  };
}
