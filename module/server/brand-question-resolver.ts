import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { ConfiguredIntentQuestion } from "./response-logic-core-ports.js";

/**
 * Brand-side question resolution for the response-logic feature.
 *
 * Brand is the single source of truth for questions: they live in the
 * `brand_intent_workspaces` JSON ledger (one row per user+project), keyed by
 * stable IDs of the form `${tableId}:${rowIndex}`. This module resolves
 * those IDs to the CURRENT question text with proper workspace isolation.
 *
 * It replaces the Intent module's `getDashboardQuestion` Core port (which
 * queried Core's `enterpriseProjectQuestions` relational table) with a
 * JSON-ledger lookup that enforces the same ownership guarantees.
 */

export type BrandQuestionResolverPorts = {
  getDb(): Promise<MySql2Database<any> | null>;
};

export type ResolvedBrandQuestion = {
  questionId: string;
  question: string;
  intent: string;
  category: string;
  /** Stable content fingerprint: changes when the question text changes. */
  questionHash: string;
  /** The workspace revision at read time (for staleness detection). */
  workspaceRevision: number;
};

/**
 * Stable fingerprint of the question text. When the user optimizes a question
 * from A to A', this hash changes even though the questionId stays the same,
 * allowing Judge/optimizer context keys to detect staleness.
 */
export function brandQuestionHash(questionText: string, intentText: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ question: questionText, intent: intentText }), "utf8")
    .digest("hex");
}

/**
 * Resolve a Brand intent-workbench question by ID for an authenticated user.
 *
 * Ownership is derived exclusively from the authenticated context (never from
 * request-body userId/workspaceKey). The ledger row is selected by the
 * workspace_key digest matching the user's current enterprise project scope.
 */
export async function resolveBrandIntentQuestion(
  ports: BrandQuestionResolverPorts,
  input: { accountUserId: number; enterpriseProjectId: string | null; questionId: string },
): Promise<ResolvedBrandQuestion | null> {
  const db = await ports.getDb();
  if (!db) return null;

  const workspaceKey = createHash("sha256")
    .update(`${input.accountUserId}:${input.enterpriseProjectId ?? "personal"}`, "utf8")
    .digest("hex");

  // Read the ledger row scoped to this user + project
  const result = await db.execute(
    sql`SELECT payload, revision FROM brand_intent_workspaces
        WHERE workspace_key = ${workspaceKey}
        AND owner_user_id = ${input.accountUserId}
        AND project_id <=> ${input.enterpriseProjectId}
        LIMIT 1`,
  );
  // drizzle's mysql2 execute() resolves to the raw driver tuple [rows, fields];
  // unwrap rows the same way intent-workbench-service's rows() helper does.
  const rows = Array.isArray((result as unknown[] | null)?.[0])
    ? ((result as unknown[][])[0] as unknown[])
    : [];
  const row = (rows as unknown as Array<{ payload: string | Record<string, unknown>; revision: number }>)[0];
  if (!row) return null;

  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const question = questions.find((q: { id?: string }) => q?.id === input.questionId);
  if (!question) return null;

  return {
    questionId: question.id,
    question: String(question.question ?? ""),
    intent: String(question.intent ?? ""),
    category: String(question.category ?? ""),
    questionHash: brandQuestionHash(String(question.question ?? ""), String(question.intent ?? "")),
    workspaceRevision: row.revision ?? 0,
  };
}

/**
 * Adapt a resolved Brand question to the ConfiguredIntentQuestion shape that
 * the response-logic service/API layer expects (compatible with the Intent
 * module's getDashboardQuestion return type).
 */
export function toConfiguredIntentQuestion(
  resolved: ResolvedBrandQuestion,
): ConfiguredIntentQuestion {
  return {
    questionId: resolved.questionId,
    groupId: "brand-intent",
    groupTitle: "品牌意图优化",
    question: resolved.question,
    intent: resolved.intent,
    summary: "",
    writeScope: {
      revision: resolved.workspaceRevision,
      contractId: null,
      quotaPeriodId: "brand-intent",
    },
  };
}
