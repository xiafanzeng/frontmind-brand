import type { Request } from "express";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { intentSkillPorts } from "./intent-skill-runtime.js";
import { resolveBrandIntentQuestion, toConfiguredIntentQuestion, type BrandQuestionResolverPorts } from "./brand-question-resolver.js";
import { createResponseLogicService } from "./response-logic-service.js";
import type { ResponseLogicApiPorts, ConfiguredIntentQuestion } from "./response-logic-core-ports.js";
import { mysqlTable, varchar, int, text, json, mysqlEnum, timestamp, uniqueIndex, index } from "drizzle-orm/mysql-core";
import type { ResponseLogicDraft, ConfirmedResponseLogic, ResponseLogicAppliedModelResult, ResponseLogicPublicationMutation } from "../contracts/response-logic.js";

/**
 * Standalone drizzle table definition for response_logic_entries (no FK callbacks).
 * Same column shapes as module/schema/index.ts — used for direct queries through
 * getDb() without instantiating the full BrandSchema. Same approach as
 * response-logic-evaluation-store.ts.
 */
const responseLogicEntries = mysqlTable("response_logic_entries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  questionId: varchar("questionId", { length: 191 }).notNull(),
  groupId: varchar("groupId", { length: 128 }).notNull(),
  groupTitle: varchar("groupTitle", { length: 255 }).notNull(),
  question: text("question").notNull(),
  intent: text("intent").notNull(),
  summary: text("summary").notNull(),
  conversationId: varchar("conversationId", { length: 191 }),
  lastTaskId: varchar("lastTaskId", { length: 255 }),
  skillName: varchar("skillName", { length: 128 }).default("response-logic-builder").notNull(),
  skillVersion: varchar("skillVersion", { length: 64 }).default("1").notNull(),
  skillContentHash: varchar("skillContentHash", { length: 64 }),
  draft: json("draft").$type<ResponseLogicDraft>().notNull(),
  confirmed: json("confirmed").$type<ConfirmedResponseLogic>(),
  appliedModelResult: json("appliedModelResult").$type<ResponseLogicAppliedModelResult>(),
  lastPublicationMutation: json("lastPublicationMutation").$type<ResponseLogicPublicationMutation>(),
  version: int("version").default(0).notNull(),
  revision: int("revision", { unsigned: true }).default(1).notNull(),
  status: mysqlEnum("status", ["draft", "confirmed"]).default("draft").notNull(),
  enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("response_logic_entries_user_question_uq").on(table.userId, table.questionId),
  index("response_logic_entries_user_status_idx").on(table.userId, table.status),
  uniqueIndex("response_logic_entries_user_conversation_uq").on(table.userId, table.conversationId),
]);

/**
 * Ownership filter for every response_logic_entries query the service issues.
 * `userId` is already the workspace-resolved owner id (Core's
 * enterpriseWorkspaceUserId maps enterprise actors onto the project owner),
 * so a single equality against userId is the complete workspace isolation.
 * Must be a real drizzle SQL chunk: the service embeds it directly in
 * .where()/and(), and a non-SQL value would either throw at query build or
 * leak rows across workspaces.
 */
export function brandResponseLogicOwnerPredicate(userId: number) {
  return sql`${responseLogicEntries.userId} = ${userId}`;
}

/**
 * Fallback-only relational question-lock stubs: when the ledger loaders
 * above are present (they always are in this runtime) these are never
 * consulted. They exist so the shared service keeps compiling and its
 * port-absent legacy path stays intact for tests that build the service
 * directly. The never-matching predicate acquires no row locks by itself.
 */
export const brandResponseLogicQuestionLockTable = mysqlTable("response_logic_entries", {
  id: varchar("id", { length: 191 }),
});
export function brandQuestionLockNoMatchPredicate(_userId: number) {
  return sql`1 = 0`;
}

import { buildDirectorySkillArchive, buildDeterministicTaskAttachmentArchive } from "@frontmind/module-contracts/task-attachment-package";
import { mysqlTable as _mysqlTable, varchar as _varchar, int as _int, mysqlEnum as _mysqlEnum, timestamp as _timestamp, uniqueIndex as _uniqueIndex, index as _index } from "drizzle-orm/mysql-core";

/**
 * Standalone drizzle table for provider_file_leases (no FK callbacks).
 * Same column shapes as Core's drizzle/schema.ts:426 — used to check which
 * files have already been uploaded to the upstream provider.
 */
const providerFileLeases = _mysqlTable("provider_file_leases", {
  id: _varchar("id", { length: 36 }).primaryKey(),
  localAssetId: _varchar("local_asset_id", { length: 36 }).notNull(),
  apiCredentialId: _varchar("api_credential_id", { length: 36 }).notNull(),
  credentialVersion: _int("credential_version", { unsigned: true }).notNull(),
  providerFileId: _varchar("provider_file_id", { length: 512 }),
  providerRequestId: _varchar("provider_request_id", { length: 512 }),
  uploadState: _mysqlEnum("upload_state", ["reserved","uploading","uploaded","expired","failed","outcome_unknown"]).notNull(),
  expiresAt: _timestamp("expiresAt"),
  createdAt: _timestamp("created_at").defaultNow().notNull(),
  updatedAt: _timestamp("updated_at").defaultNow().notNull(),
});

/** Core file-content-retention.ts:282 — explicit expiry or upload-time + retention. */
const FILE_CONTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (Core default)
function _retentionTimestamp(value: Date | string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : undefined;
}
function fileResourceContentExpiry(resource: { uploadedAt?: Date | string | number | null; contentExpiresAt?: Date | string | number | null }): number | undefined {
  const explicit = _retentionTimestamp(resource.contentExpiresAt);
  if (explicit !== undefined) return explicit;
  const origin = _retentionTimestamp(resource.uploadedAt);
  return origin === undefined ? undefined : origin + FILE_CONTENT_RETENTION_MS;
}
function isFileResourceContentExpired(resource: { uploadedAt?: Date | string | number | null; contentExpiresAt?: Date | string | number | null; contentDeletedAt?: Date | string | number | null }, now = Date.now()): boolean {
  if (_retentionTimestamp(resource.contentDeletedAt) !== undefined) return true;
  const expiresAt = fileResourceContentExpiry(resource);
  return expiresAt !== undefined && expiresAt <= now;
}
import { assertUpstreamPromptBudget } from "@frontmind/module-contracts/upstream-prompt-budget";

/**
 * Runtime assembly for the response-logic feature inside the Brand module.
 *
 * Assembles the ~50 ResponseLogicApiPorts from Brand's existing infrastructure:
 * - BrandKeywordPorts (globally registered by the keyword service composition root)
 * - Brand's schema tables (responseLogicEntries from S1)
 * - brand-question-resolver (S3) for Brand-ledger question resolution
 * - response-logic-service (S2) for CRUD operations
 *
 * This replaces the 'core as never' casts in http-api.ts with real implementations.
 */

export type ResponseLogicRuntimeCore = ResponseLogicApiPorts & {
  /** Brand ledger question resolution (replaces Core's enterpriseProjectQuestions lookup). */
  resolveQuestion(accountUserId: number, enterpriseProjectId: string | null, questionId: string): Promise<ConfiguredIntentQuestion | null>;
  /** The underlying response-logic service instance for CRUD. */
  responseLogicService: ReturnType<typeof createResponseLogicService>;
};

export function assembleResponseLogicCore(input: {
  getDb(): Promise<MySql2Database<any> | null>;
  /** Server environment (defaults to process.env) for provider-mode checks. */
  environment?: Readonly<Record<string, string | undefined>>;
}): ResponseLogicRuntimeCore {
  const bkp = intentSkillPorts();
  const db = input.getDb;
  const environment = input.environment ?? process.env;
  // Mirrors Core's keyword credential chain selection (brand-keyword-credential.ts):
  // when either mode flag selects the OpenAI Agents/XTY runner, every business
  // call must go through the xty_codex service identity — never a silent
  // fallback to a customer zhipu key.
  const xtyProviderModeRequested = () =>
    environment.FRONTMIND_MODULE_PROVIDER_MODE === "xty_openai_agents" ||
    environment.FRONTMIND_AGENT_PROVIDER_MODE === "xty_openai_agents";

  const questionResolverPorts: BrandQuestionResolverPorts = { getDb: db };

  // Wrap the Brand ledger resolver as the getDashboardQuestion port —
  // the ONLY path to question data for the response-logic feature in Brand.
  const resolveQuestion = async (
    accountUserId: number,
    enterpriseProjectId: string | null,
    questionId: string,
  ): Promise<ConfiguredIntentQuestion | null> => {
    const resolved = await resolveBrandIntentQuestion(questionResolverPorts, {
      accountUserId,
      enterpriseProjectId,
      questionId,
    });
    return resolved ? toConfiguredIntentQuestion(resolved) : null;
  };

  // Instantiate the response-logic service with Brand's schema tables
  const responseLogicService = createResponseLogicService({
    tables: { responseLogicEntries } as never,
    getDb: db as never,
    AuthServiceError: class extends Error {
      code: string;
      constructor(code: string, message: string) { super(message); this.code = code; }
    } as never,
    lockCustomerProjectBusinessWrite: bkp.lockCustomerProjectBusinessWrite as never,
    // Brand questions live in the brand_intent_workspaces JSON ledger. These
    // two loaders are the authoritative question lookups for every write lock
    // and the pre-dispatch readiness check: the ledger row is read under
    // lockCustomerProjectBusinessWrite and its own FOR UPDATE inside the
    // caller's transaction, and the ledger revision is the scope currency —
    // every intent-workbench mutation bumps it, so a question edit between
    // the API-layer resolver read and this in-transaction read fails the
    // expectedScope comparison with CONFLICT. The never-matching relational
    // stubs below remain only as the port-absent fallback path.
    loadQuestionForWrite: async (executor: never, userId: number, questionId: string) => {
      const projectId = bkp.currentEnterpriseProjectId();
      const workspaceKey = createHash("sha256")
        .update(`${userId}:${projectId ?? "personal"}`, "utf-8")
        .digest("hex");
      const result = await (executor as {
        execute(query: unknown): Promise<unknown>;
      }).execute(
        sql`SELECT revision, payload FROM brand_intent_workspaces
            WHERE workspace_key = ${workspaceKey}
            AND owner_user_id = ${userId}
            AND project_id <=> ${projectId}
            FOR UPDATE`,
      );
      const rows = Array.isArray((result as unknown[] | null)?.[0])
        ? (result as unknown[][])[0]
        : [];
      const row = (rows as unknown as Array<{ payload: unknown; revision: number }>)[0];
      if (!row) return null;
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      const questions = Array.isArray((payload as { questions?: unknown })?.questions)
        ? (payload as { questions: Array<{ id?: string }> }).questions
        : [];
      return questions.some(question => question?.id === questionId)
        ? {
            status: "selected",
            selectionApprovalStatus: "approved",
            locked: true,
            revision: Number(row.revision ?? 0),
            contractId: null,
            quotaPeriodId: "brand-intent",
          }
        : null;
    },
    loadQuestionForReadiness: async (userId: number, questionId: string) => {
      const resolved = await resolveQuestion(userId, bkp.currentEnterpriseProjectId(), questionId);
      return resolved
        ? {
            status: "selected",
            selectionApprovalStatus: "approved",
            locked: true,
            revision: resolved.writeScope.revision,
            contractId: null,
            quotaPeriodId: "brand-intent",
          }
        : null;
    },
    workspaceQuestionTable: () => brandResponseLogicQuestionLockTable as never,
    workspaceQuestionOwnerPredicate: brandQuestionLockNoMatchPredicate as never,
    enterpriseOwnerPredicate: ((_table: never, userId: number) =>
      brandResponseLogicOwnerPredicate(userId)) as never,
    enterpriseProjectIdForOwner: (userId: number) => bkp.currentEnterpriseProjectId(),
    credentialMayServeAccount: async () => true, // Brand credential model doesn't have account-level restrictions
    claimUpstreamTask: async () => {}, // upstream_resources handled via recordUpstreamResource
  });

  const core = {
    // ── Authentication & Authorization ──
    enterpriseWorkspaceUserId: (userId: number) => bkp.enterpriseWorkspaceUserId(userId),
    assertServiceCapability: (userId: number, cap: string) => bkp.assertServiceCapability(userId, cap),
    ServiceEntitlementError: class extends Error {
      code: string; statusCode: number;
      constructor(code: string, message: string, statusCode = 403) { super(message); this.code = code; this.statusCode = statusCode; }
    } as never,
    sendAiBillingError: (() => false) as never, // Brand module doesn't have AI billing integration yet

    // ── Question Resolution (Brand ledger) ──
    getDashboardQuestion: (userId: number, questionId: string) => {
      const projectId = bkp.currentEnterpriseProjectId();
      return resolveQuestion(userId, projectId, questionId);
    },
    resolveQuestion,

    // ── Response Logic Records (service) ──
    getResponseLogicEntry: (userId: number, questionId: string) => responseLogicService.getResponseLogicEntry(userId, questionId),
    responseLogicService,

    // ── Knowledge & Credentials ──
    getLatestKnowledgeSnapshot: (userId: number) => bkp.getLatestAuthenticatedKnowledgeSnapshot(userId),
    credentialForRequest: (request: unknown) => {
      const req = request as Request & { frontmindCredential?: { id: string; userId: number; version: number; credentialRef: string; fingerprint: string; status: string; agentProfile: string; provider: string; upstreamModel: string; upstreamEffort: string | null } };
      return req.frontmindCredential as never;
    },
    getFrontMindCredentials: (request: unknown) => {
      const req = request as Request & { frontmindCredential?: { credentialRef?: string } };
      return { credentialRef: req.frontmindCredential?.credentialRef };
    },
    getCredentialForUpstreamResource: (userId: number, kind: string, upstreamId: string) => {
      return bkp.getDecryptedCredentialForUser(userId) as never;
    },
    createCredentialAgentClient: (credential: never, options?: Record<string, unknown>) => {
      const handle = credential as unknown as { provider?: unknown } | null | undefined;
      if (xtyProviderModeRequested() && (!handle || handle.provider !== "xty_codex")) {
        // Explicit failure instead of dispatching through a zhipu credential
        // while the deployment requires the XTY runner. Handlers map this via
        // the ServiceEntitlementError shape (status + code).
        throw Object.assign(
          new Error("当前部署要求使用 XTY 模型运行器，但解析到的凭据不是 XTY 服务身份，已拒绝调用。"),
          { code: "RESPONSE_LOGIC_PROVIDER_MODE_VIOLATION", statusCode: 503 },
        );
      }
      return bkp.createCredentialAgentClient(credential, options as never) as never;
    },

    // ── Upstream Task Infrastructure ──
    getUpstreamBaseUrl: (request: unknown) => bkp.getUpstreamBaseUrl(request),
    toUpstreamAgentProfile: (profile: string) => profile,
    recordUpstreamResource: (input: { userId: number; apiCredentialId: string; kind: string; upstreamId: string }) =>
      bkp.recordUpstreamResource(input) as never,

    // ── ManusV2 Structured Output ──
    classifyManusV2StructuredResultEnvelope: (input: unknown) => bkp.classifyManusV2StructuredResultEnvelope(input) as never,
    latestManusV2TaskState: (events: readonly unknown[]) => bkp.latestManusV2TaskState(events as never) as never,
    orderManusV2EventsByProviderRank: (events: readonly unknown[], direction: string) =>
      bkp.orderManusV2EventsByProviderRank(events as never, direction as never) as never,
    ManusV2ApiError: bkp.ManusV2ApiError as never,

    // ── Skill & Attachment Packaging ──
    assertUpstreamPromptBudget: (value: string) => assertUpstreamPromptBudget(value),
    buildDeterministicTaskAttachmentArchive: (input: never) => buildDeterministicTaskAttachmentArchive(input),
    buildDirectorySkillArchive: (input: never) => buildDirectorySkillArchive(input),

    // ── Service error classes + methods (hoisted from responseLogicService) ──
    ResponseLogicConfirmedError: responseLogicService.ResponseLogicConfirmedError,
    ResponseLogicProviderReadinessError: responseLogicService.ResponseLogicProviderReadinessError,
    ResponseLogicPublicationRequestConflictError: responseLogicService.ResponseLogicPublicationRequestConflictError,
    ResponseLogicResultAdoptionError: responseLogicService.ResponseLogicResultAdoptionError,
    ResponseLogicRevisionConflictError: responseLogicService.ResponseLogicRevisionConflictError,
    ResponseLogicTaskActiveError: responseLogicService.ResponseLogicTaskActiveError,
    ResponseLogicTaskSupersededError: responseLogicService.ResponseLogicTaskSupersededError,
    adoptResponseLogicModelResult: responseLogicService.adoptResponseLogicModelResult,
    assertResponseLogicRecordEditable: responseLogicService.assertResponseLogicRecordEditable,
    recordResponseLogicTaskStart: responseLogicService.recordResponseLogicTaskStart,
    releaseResponseLogicTaskBinding: responseLogicService.releaseResponseLogicTaskBinding,
    requireResponseLogicProviderReadiness: responseLogicService.requireResponseLogicProviderReadiness,
    updateResponseLogicDraftMaterials: responseLogicService.updateResponseLogicDraftMaterials,

    // ── BrandKeywordPorts additions ──
    getEnterpriseProjectScope: bkp.getEnterpriseProjectScope,
    enterpriseAccountOwnerPredicate: bkp.enterpriseAccountOwnerPredicate,
    readStoredPresalesFile: bkp.readStoredPresalesFile,
    manusV2EventOperationToken: bkp.manusV2EventOperationToken,

    // ── Execution / security ports (Brand doesn't have these yet — honest stubs) ──
    projectGeneralExecution: () => { throw new Error("EXECUTION_PROJECTION_NOT_AVAILABLE_IN_BRAND"); },
    generalExecutionActivity: (() => ({})) as never,
    orderExecutionTimeline: ((events: unknown[]) => events) as never,
    projectBusinessExecution: () => { throw new Error("EXECUTION_PROJECTION_NOT_AVAILABLE_IN_BRAND"); },
    localAssets: bkp.localAssets as never,
    providerFileLeases: providerFileLeases as never,
    fileResourceContentExpiry: fileResourceContentExpiry as never,
    isFileResourceContentExpired: isFileResourceContentExpired as never,
    redactSensitivePayload: ((value: unknown) => {
      if (!value || typeof value !== "object") return value;
      const REDACTED = "[REDACTED]";
      const SENSITIVE_KEYS = /^(apiKey|password|token|secret|authorization|credential|cookie|session)/i;
      const walk = (obj: Record<string, unknown>): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
          if (SENSITIVE_KEYS.test(key)) result[key] = REDACTED;
          else if (val && typeof val === "object" && !Array.isArray(val)) result[key] = walk(val as Record<string, unknown>);
          else if (typeof val === "string" && val.length > 200) result[key] = val.slice(0, 200) + "…[TRUNCATED]";
          else result[key] = val;
        }
        return result;
      };
      return walk(value as Record<string, unknown>);
    }) as never,
    redactSensitiveText: ((value: string) => {
      // Redact credential-like patterns: Bearer tokens, API keys, long base64 strings
      return value
        .replace(/Bearer\s+[A-Za-z0-9+/=]{20,}/gi, "Bearer [REDACTED]")
        .replace(/(?:sk-|pk-|xty-)[A-Za-z0-9]{16,}/g, "[REDACTED]")
        .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, (m) => m.length > 40 ? "[REDACTED]" : m);
    }) as never,
    safeErrorForLog: ((error: unknown, options?: { secrets?: Iterable<unknown> }) => {
      if (!(error instanceof Error)) return { message: String(error).slice(0, 500) };
      // Redact known secret shapes from the stack, then keep enough frames to
      // pinpoint the throwing line. The Core original preserves the full
      // sanitized stack; this mirror keeps the top 10 lines which cover the
      // entire response-logic call depth.
      const secrets = Array.from(options?.secrets ?? []).map(String);
      let stack = error.stack ?? "";
      for (const secret of secrets) {
        if (secret.length > 3) stack = stack.split(secret).join("[REDACTED]");
      }
      stack = stack
        .replace(/Bearer\s+[A-Za-z0-9+/=]{20,}/gi, "Bearer [REDACTED]")
        .replace(/(?:sk-|pk-|xty-)[A-Za-z0-9]{16,}/g, "[REDACTED]");
      return {
        name: error.name,
        message: error.message,
        code: (error as { code?: string }).code,
        ...(stack ? { stack: stack.split("\n").slice(0, 10).join("\n") } : {}),
      };
    }) as never,

    // ── Database ──
    getDb: db as never,
  };

  return core as Record<string, unknown> as unknown as ResponseLogicRuntimeCore;
}
