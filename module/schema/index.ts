
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";


export type KnowledgeDocumentRecord = {
  id?: string;
  path: string;
  title: string;
  content: string;
  kind?: "overview" | "leaf" | "evidence" | "report" | "index" | "other";
  branchId?: string;
  branchTitle?: string;
  order?: number;
  evidenceStatus?:
    | "verified_first_party"
    | "verified_authoritative"
    | "supported_third_party"
    | "inferred"
    | "needs_verification"
    | "not_applicable";
  sourceIds?: string[];
  assetIds?: string[];
  customerVisible?: boolean;
};

export type KnowledgeAssetRecord = {
  id?: string;
  key: string;
  path: string;
  mimeType: string;
  size: number;
  sha256?: string;
  width?: number;
  height?: number;
  caption?: string;
  alt?: string;
  branchId?: string;
  documentIds?: string[];
  sourcePageUrl?: string;
  sourceAssetUrl?: string;
  sourceDocumentPath?: string;
  sourceKind?:
    | "official_web"
    | "official_document"
    | "official_logo_upload"
    | "user_upload";
  sourceUploadIndex?: number;
  sourceUploadFileId?: string;
  sourceUploadSha256?: string;
  sourceUploadFilename?: string;
  sourceUploadMimeType?: string;
  sourceUploadSizeBytes?: number;
  ownership?: "first_party" | "third_party" | "unknown";
};
export interface BrandSchemaCore {
  users: { id: AnyMySqlColumn };
  apiCredentials: { id: AnyMySqlColumn };
  presalesApiCredentials: { id: AnyMySqlColumn };
  localAssets: { id: AnyMySqlColumn };
  serviceQuotaPeriods: { id: AnyMySqlColumn };
  deliveryTickets: { id: AnyMySqlColumn };
  deliveryTicketAttachments: { id: AnyMySqlColumn };
  deliveryProjectAssignments: { id: AnyMySqlColumn };
  conversations: { id: AnyMySqlColumn };
  conversationTurns: { id: AnyMySqlColumn };
  currentEnterpriseProjectId(): string | null;
}
export function createBrandSchema(core: BrandSchemaCore) {


/** One durable website-style approval workflow per customer workspace. */
const websiteStyleWorkflows = mysqlTable(
  "website_style_workflows",
  {
    userId: int("userId")
      .primaryKey()
      .references(() => core.users.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", [
      "waiting_samples",
      "awaiting_selection",
      "revision_requested",
      "confirmed",
      "legacy_confirmed",
    ])
      .default("waiting_samples")
      .notNull(),
    currentBatchId: varchar("currentBatchId", { length: 36 }),
    selectedSampleId: varchar("selectedSampleId", { length: 36 }),
    selectedByUserId: int("selectedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    selectedAt: timestamp("selectedAt"),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("website_style_workflows_status_idx").on(table.status)],
);


/** Engineer-published batches of exactly three website style samples. */
const websiteStyleSampleBatches = mysqlTable(
  "website_style_sample_batches",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    ticketId: varchar("ticketId", { length: 36 }).references(
      () => core.deliveryTickets.id,
      { onDelete: "cascade" },
    ),
    /** Legacy keeps an engineer ticket; SiteOps binds the batch to a project. */
    sourceKind: mysqlEnum("sourceKind", ["legacy_manual_three", "siteops_21st"])
      .default("legacy_manual_three")
      .notNull(),
    siteProjectId: varchar("siteProjectId", { length: 36 }),
    selectionBundleLocalAssetId: varchar("selectionBundleLocalAssetId", {
      length: 36,
    }),
    selectionBundleHash: varchar("selectionBundleHash", { length: 64 }),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    status: mysqlEnum("status", [
      "published",
      "revision_requested",
      "selected",
      "superseded",
    ])
      .default("published")
      .notNull(),
    engineerNote: text("engineerNote"),
    publishedByUserId: int("publishedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("publishedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_style_batches_user_ordinal_uq").on(
      table.userId,
      table.ordinal,
    ),
    index("website_style_batches_ticket_status_idx").on(
      table.ticketId,
      table.status,
    ),
    index("website_style_batches_site_project_status_idx").on(
      table.siteProjectId,
      table.status,
    ),
    check(
      "website_style_batches_source_ck",
      sql`(
        (${table.sourceKind} = 'legacy_manual_three' AND ${table.ticketId} IS NOT NULL AND ${table.siteProjectId} IS NULL)
        OR
        (${table.sourceKind} = 'siteops_21st' AND ${table.ticketId} IS NULL AND ${table.siteProjectId} IS NOT NULL)
      )`,
    ),
    foreignKey({
      name: "website_style_batches_bundle_asset_fk",
      columns: [table.selectionBundleLocalAssetId],
      foreignColumns: [core.localAssets.id],
    }).onDelete("restrict"),
  ],
);


/** The customer-visible images within one website-style sample batch. */
const websiteStyleSamples = mysqlTable(
  "website_style_samples",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    batchId: varchar("batchId", { length: 36 })
      .notNull()
      .references(() => websiteStyleSampleBatches.id, {
        onDelete: "cascade",
      }),
    attachmentId: varchar("attachmentId", { length: 36 }),
    previewLocalAssetId: varchar("previewLocalAssetId", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    sourceMetadata: json("sourceMetadata").$type<{
      providerItemId: string;
      promptSha256: string;
      responseSha256: string;
      taxonomy: Record<string, unknown>;
      score: number;
      rationale: string;
    }>(),
    label: varchar("label", { length: 160 }).notNull(),
    note: text("note"),
    sortOrder: int("sortOrder", { unsigned: true }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_style_samples_batch_order_uq").on(
      table.batchId,
      table.sortOrder,
    ),
    uniqueIndex("website_style_samples_batch_attachment_uq").on(
      table.batchId,
      table.attachmentId,
    ),
    foreignKey({
      name: "website_style_samples_attachment_fk",
      columns: [table.attachmentId],
      foreignColumns: [core.deliveryTicketAttachments.id],
    }).onDelete("restrict"),
    check(
      "website_style_samples_source_ck",
      sql`(
        (${table.attachmentId} IS NOT NULL AND ${table.previewLocalAssetId} IS NULL)
        OR
        (${table.attachmentId} IS NULL AND ${table.previewLocalAssetId} IS NOT NULL)
      )`,
    ),
  ],
);


/** Administrator-owned website identity shown in the customer workspace. */
const workspaceSiteProfiles = mysqlTable(
  "workspace_site_profiles",
  {
    userId: int("userId")
      .primaryKey()
      .references(() => core.users.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }),
    normalizedAsciiDomain: varchar("normalizedAsciiDomain", { length: 255 }),
    unicodeDisplayDomain: varchar("unicodeDisplayDomain", { length: 255 }),
    domainRevision: int("domainRevision", { unsigned: true })
      .default(1)
      .notNull(),
    providerAccountUid: varchar("providerAccountUid", { length: 128 }),
    domainOwnershipStatus: varchar("domainOwnershipStatus", { length: 64 }),
    dnsStatus: varchar("dnsStatus", { length: 64 }),
    icpDomainRevision: int("icpDomainRevision", { unsigned: true }),
    siteMode: mysqlEnum("siteMode", ["managed", "external", "unknown"])
      .default("unknown")
      .notNull(),
    domainStatus: mysqlEnum("domainStatus", [
      "not_started",
      "pending",
      "completed",
    ])
      .default("not_started")
      .notNull(),
    domainVerifiedAt: timestamp("domainVerifiedAt"),
    icpProvince: varchar("icpProvince", { length: 64 }),
    icpNumber: varchar("icpNumber", { length: 128 }),
    icpStatus: mysqlEnum("icpStatus", [
      "not_submitted",
      "preparing",
      "submitted",
      "approved",
      "rejected",
      "not_required",
    ])
      .default("not_submitted")
      .notNull(),
    icpVerifiedAt: timestamp("icpVerifiedAt"),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("workspace_site_profiles_domain_idx").on(table.domain),
    index("workspace_site_profiles_ascii_domain_idx").on(
      table.normalizedAsciiDomain,
    ),
    index("workspace_site_profiles_workflow_idx").on(
      table.domainStatus,
      table.icpStatus,
    ),
  ],
);


/** Administrator-maintained, customer-visible website health checks. */
const workspaceSiteChecks = mysqlTable(
  "workspace_site_checks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    status: mysqlEnum("status", [
      "not_checked",
      "pending",
      "passed",
      "warning",
      "failed",
      "not_applicable",
    ])
      .default("not_checked")
      .notNull(),
    summary: text("summary"),
    evidence: text("evidence"),
    source: text("source"),
    checkedAt: timestamp("checkedAt"),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("workspace_site_checks_user_key_uq").on(
      table.userId,
      table.key,
    ),
    index("workspace_site_checks_user_status_idx").on(
      table.userId,
      table.status,
    ),
  ],
);


/**
 * Idempotent service-to-service knowledge imports. Only hashes of external
 * idempotency keys are stored; a completed receipt points at the published
 * immutable snapshot.
 */
const knowledgeImportReceipts = mysqlTable(
  "knowledge_import_receipts",
  {
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    source: mysqlEnum("source", ["website", "offline", "admin"])
      .default("website")
      .notNull(),
    projectId: varchar("projectId", { length: 80 }),
    companyName: varchar("companyName", { length: 200 }),
    taskId: varchar("taskId", { length: 255 }),
    fileId: varchar("fileId", { length: 255 }),
    outputItemId: varchar("outputItemId", { length: 255 }),
    descriptorHash: varchar("descriptorHash", { length: 64 }),
    sourceReference: varchar("sourceReference", { length: 191 }),
    idempotencyKeyHash: varchar("idempotencyKeyHash", { length: 64 })
      .notNull()
      .unique(),
    artifactHash: varchar("artifactHash", { length: 64 }).notNull(),
    sourceFileName: varchar("sourceFileName", { length: 512 }).notNull(),
    /** SiteOps reset epoch captured when this import receipt is reserved. */
    siteOpsKnowledgeInputEpochId: varchar("siteOpsKnowledgeInputEpochId", {
      length: 36,
    }),
    status: mysqlEnum("status", [
      "pending",
      "processing",
      "completed",
      "failed",
    ])
      .default("pending")
      .notNull(),
    snapshotId: varchar("snapshotId", { length: 36 }).references(
      () => knowledgeBaseSnapshots.id,
      { onDelete: "set null" },
    ),
    attemptCount: int("attemptCount", { unsigned: true }).default(0).notNull(),
    errorCode: varchar("errorCode", { length: 128 }),
    errorMessage: text("errorMessage"),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_import_receipts_user_artifact_uq").on(
      table.enterpriseProjectId,
      table.userId,
      table.artifactHash,
    ),
    uniqueIndex("knowledge_import_receipts_project_descriptor_uq").on(
      table.projectId,
      table.taskId,
      table.outputItemId,
      table.descriptorHash,
    ),
    index("knowledge_import_receipts_user_status_idx").on(
      table.userId,
      table.status,
    ),
    index("knowledge_import_receipts_project_task_idx").on(
      table.projectId,
      table.taskId,
    ),
  ],
);


/** Immutable versions of the final knowledge-base archive shown on the dashboard. */
const knowledgeBaseSnapshots = mysqlTable(
  "knowledge_base_snapshots",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    sourceFileName: varchar("sourceFileName", { length: 512 }).notNull(),
    sourceConversationId: varchar("sourceConversationId", { length: 191 }),
    sourceBuildId: varchar("sourceBuildId", { length: 36 }),
    sourceBuildRevision: int("sourceBuildRevision"),
    sourceTaskId: varchar("sourceTaskId", { length: 255 }),
    /** Server-derived reset epoch copied from the immutable source reservation. */
    siteOpsKnowledgeInputEpochId: varchar("siteOpsKnowledgeInputEpochId", {
      length: 36,
    }),
    sourceArtifactHash: varchar("sourceArtifactHash", { length: 64 }),
    archiveHash: varchar("archiveHash", { length: 64 }),
    maintenanceTicketId: varchar("maintenanceTicketId", { length: 36 }),
    documents: json("documents").$type<KnowledgeDocumentRecord[]>().notNull(),
    assets: json("assets").$type<KnowledgeAssetRecord[]>().notNull(),
    documentCount: int("documentCount").default(0).notNull(),
    imageCount: int("imageCount").default(0).notNull(),
    characterCount: int("characterCount").default(0).notNull(),
    totalBytes: int("totalBytes", { unsigned: true }).default(0).notNull(),
    status: mysqlEnum("status", ["active", "archived"])
      .default("active")
      .notNull(),
    createdByUserId: int("createdByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_base_snapshots_user_version_uq").on(table.enterpriseProjectId,
      table.userId,
      table.version,
    ),
    index("knowledge_base_snapshots_user_status_idx").on(
      table.userId,
      table.status,
    ),
    uniqueIndex("knowledge_base_snapshots_source_artifact_uq").on(table.enterpriseProjectId,
      table.userId,
      table.sourceBuildId,
      table.sourceBuildRevision,
      table.sourceArtifactHash,
    ),
  ],
);


/**
 * Durable progress ledger for the Socratic knowledge-base builder.
 *
 * conversationId is the browser-visible conversation id. Conversations are
 * persisted asynchronously with a user-prefixed internal id, so the build
 * keeps an explicit user boundary instead of racing that persistence queue.
 */
const knowledgeBaseBuilds = mysqlTable(
  "knowledge_base_builds",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversationId", { length: 191 }).notNull(),
    /**
     * Server-generated SiteOps reset epoch captured when this immutable build
     * reservation is created. Historical and non-SiteOps builds remain null.
     */
    siteOpsKnowledgeInputEpochId: varchar("site_ops_knowledge_input_epoch_id", {
      length: 36,
    }),
    companyName: varchar("companyName", { length: 255 }).notNull(),
    companyWebsite: text("companyWebsite"),
    upstreamTaskId: varchar("upstreamTaskId", { length: 255 }),
    /**
     * Legacy rows are deliberately not resumed. A reset creates a new
     * materialized build whose complete working set is Dashboard-owned.
     */
    executionMode: varchar("execution_mode", { length: 32 }),
    activeWorkingSetId: varchar("active_working_set_id", { length: 36 }),
    contentVersion: int("content_version", { unsigned: true }),
    /**
     * Provider protocol authority. Legacy rows continue to read through
     * upstreamTaskId; v2 rows bind exactly one canonical writer task for the
     * lifetime of a build generation.
     */
    providerProtocol: varchar("providerProtocol", { length: 32 })
      .default("legacy_v1")
      .notNull(),
    canonicalTaskId: varchar("canonicalTaskId", { length: 255 }),
    canonicalTaskGeneration: int("canonicalTaskGeneration", {
      unsigned: true,
    }),
    canonicalCredentialId: varchar("canonicalCredentialId", {
      length: 36,
    }),
    canonicalTaskState: varchar("canonicalTaskState", { length: 32 })
      .default("unbound")
      .notNull(),
    canonicalTaskUrl: varchar("canonicalTaskUrl", { length: 1024 }),
    canonicalTaskCreatedAt: timestamp("canonicalTaskCreatedAt"),
    /** Content-safe hashes and old task references for a legacy handoff. */
    handoffProvenance: json("handoffProvenance").$type<Record<
      string,
      unknown
    > | null>(),
    skillName: varchar("skillName", { length: 128 })
      .default("socratic-kb-builder")
      .notNull(),
    skillVersion: varchar("skillVersion", { length: 64 })
      .default("1")
      .notNull(),
    skillContentHash: varchar("skillContentHash", { length: 64 }),
    /**
     * Immutable depth contract pinned when the build is created. Historical
     * rows default to v1 (8–115); new Dashboard builds explicitly use v2
     * (30–115).
     */
    treePolicyVersion: int("treePolicyVersion", { unsigned: true })
      .default(1)
      .notNull(),
    /** Validated first-turn research ledger; required by tree policy v2. */
    initialResearchCoverage: json("initialResearchCoverage").$type<Record<
      string,
      unknown
    > | null>(),
    status: mysqlEnum("status", [
      "researching",
      "confirming",
      "ready_to_publish",
      "published",
      "protocol_error",
      "failed",
    ])
      .default("researching")
      .notNull(),
    /**
     * Monotonic build identity. Resetting/restarting a build increments the
     * generation so a delayed task from an older run can be ignored safely.
     */
    generation: int("generation", { unsigned: true }).default(1).notNull(),
    /** Monotonic version for atomic server-approved UI observations. */
    stateEpoch: int("stateEpoch", { unsigned: true }).default(0).notNull(),
    activeTurnId: varchar("activeTurnId", { length: 36 }),
    /** Cross-process claim for legacy/open builds which have no active turn. */
    recoveryLeaseOwnerHash: varchar("recoveryLeaseOwnerHash", { length: 64 }),
    recoveryLeaseExpiresAt: timestamp("recoveryLeaseExpiresAt"),
    lastAppliedOperationKey: varchar("lastAppliedOperationKey", {
      length: 128,
    }),
    currentPresentationKey: varchar("currentPresentationKey", {
      length: 191,
    }),
    revision: int("revision").default(0).notNull(),
    currentLeafId: varchar("currentLeafId", { length: 191 }),
    totalNodeCount: int("totalNodeCount").default(0).notNull(),
    confirmedCount: int("confirmedCount").default(0).notNull(),
    directPrefilledCount: int("directPrefilledCount").default(0).notNull(),
    needsVerificationCount: int("needsVerificationCount").default(0).notNull(),
    lastReconciledHash: varchar("lastReconciledHash", { length: 64 }),
    lastOutputLength: int("lastOutputLength").default(0).notNull(),
    lastOutputItemIds: json("lastOutputItemIds")
      .$type<string[]>()
      .default([])
      .notNull(),
    lastTurnUserText: longtext("lastTurnUserText"),
    lastTurnAttachmentCount: int("lastTurnAttachmentCount")
      .default(0)
      .notNull(),
    awaitingResponseSince: timestamp("awaitingResponseSince"),
    packageRevision: int("packageRevision"),
    packageTaskId: varchar("packageTaskId", { length: 255 }),
    packageOutputItemId: varchar("packageOutputItemId", { length: 255 }),
    packageFileId: varchar("packageFileId", { length: 255 }),
    packageFilename: varchar("packageFilename", { length: 512 }),
    packageDescriptorHash: varchar("packageDescriptorHash", { length: 64 }),
    /** Immutable physical Skill archive pinned for this build. */
    skillArchiveSha256: varchar("skillArchiveSha256", { length: 64 }),
    skillArchiveBytes: int("skillArchiveBytes", { unsigned: true }),
    skillArchiveStorageKey: varchar("skillArchiveStorageKey", {
      length: 1024,
    }),
    /** Content completion is independent from asynchronous package readiness. */
    contentCompletedAt: timestamp("contentCompletedAt"),
    packageStatus: varchar("packageStatus", { length: 32 })
      .default("not_started")
      .notNull(),
    packageAttemptCount: int("packageAttemptCount", { unsigned: true })
      .default(0)
      .notNull(),
    packageNextRetryAt: timestamp("packageNextRetryAt"),
    packageLastErrorCode: varchar("packageLastErrorCode", { length: 128 }),
    /** Immutable, Dashboard-owned copy of the first-node official logo. */
    logoStorageKey: varchar("logoStorageKey", { length: 1024 }),
    logoSha256: varchar("logoSha256", { length: 64 }),
    logoBytes: int("logoBytes", { unsigned: true }),
    logoFilename: varchar("logoFilename", { length: 512 }),
    logoMimeType: varchar("logoMimeType", { length: 255 }),
    /** Immutable, Dashboard-owned copy of the validated final archive. */
    packageStorageKey: varchar("packageStorageKey", { length: 1024 }),
    packageArchiveSha256: varchar("packageArchiveSha256", { length: 64 }),
    packageSizeBytes: int("packageSizeBytes", { unsigned: true }),
    protocolErrorCode: varchar("protocolErrorCode", { length: 128 }),
    protocolError: text("protocolError"),
    publishedSnapshotId: varchar("publishedSnapshotId", {
      length: 36,
    }).references(() => knowledgeBaseSnapshots.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completedAt"),
    publishedAt: timestamp("publishedAt"),
  },
  (table) => [
    uniqueIndex("knowledge_base_builds_user_conversation_uq").on(
      table.userId,
      table.conversationId,
    ),
    index("knowledge_base_builds_user_status_idx").on(
      table.userId,
      table.status,
    ),
    index("knowledge_base_builds_task_idx").on(table.upstreamTaskId),
    uniqueIndex("knowledge_base_builds_canonical_task_idx").on(
      table.canonicalTaskId,
    ),
    index("knowledge_base_builds_canonical_credential_idx").on(
      table.canonicalCredentialId,
    ),
    index("knowledge_base_builds_active_turn_idx").on(table.activeTurnId),
    index("knowledge_base_builds_recovery_lease_idx").on(
      table.status,
      table.recoveryLeaseExpiresAt,
    ),
  ],
);


/** Every row is one real leaf and can only advance in ordinal order. */
const knowledgeBaseBuildNodes = mysqlTable(
  "knowledge_base_build_nodes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    buildId: varchar("buildId", { length: 36 })
      .notNull()
      .references(() => knowledgeBaseBuilds.id, { onDelete: "cascade" }),
    leafId: varchar("leafId", { length: 191 }).notNull(),
    branchId: varchar("branchId", { length: 128 }).notNull(),
    branchTitle: varchar("branchTitle", { length: 255 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    ordinal: int("ordinal").notNull(),
    status: mysqlEnum("status", [
      "pending",
      "current",
      "confirmed",
      "direct_prefilled",
      "needs_verification",
    ])
      .default("pending")
      .notNull(),
    transitionReason: text("transitionReason"),
    contentMarkdown: longtext("contentMarkdown"),
    lastUserInput: longtext("lastUserInput"),
    sourceUrls: json("sourceUrls").$type<string[]>().default([]).notNull(),
    imageUrls: json("imageUrls").$type<string[]>().default([]).notNull(),
    lastTaskId: varchar("lastTaskId", { length: 255 }),
    sourceTurnId: varchar("sourceTurnId", { length: 36 }),
    presentationKey: varchar("presentationKey", { length: 191 }),
    contentSha256: varchar("contentSha256", { length: 64 }),
    contentVersion: int("content_version", { unsigned: true }),
    assetRefs: json("asset_refs").$type<string[]>(),
    lastResponseAt: timestamp("lastResponseAt"),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_base_build_nodes_leaf_uq").on(
      table.buildId,
      table.leafId,
    ),
    uniqueIndex("knowledge_base_build_nodes_ordinal_uq").on(
      table.buildId,
      table.ordinal,
    ),
    index("knowledge_base_build_nodes_status_idx").on(
      table.buildId,
      table.status,
    ),
    index("knowledge_base_build_nodes_source_turn_idx").on(table.sourceTurnId),
  ],
);


/** One immutable provider execution for initial materialization or revision. */
const knowledgeBaseExecutions = mysqlTable(
  "knowledge_base_executions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    buildId: varchar("build_id", { length: 36 }).notNull(),
    generation: int("generation", { unsigned: true }).notNull(),
    operationType: mysqlEnum("operation_type", [
      "initial",
      "revision",
    ]).notNull(),
    targetLeafId: varchar("target_leaf_id", { length: 191 }),
    baseWorkingSetId: varchar("base_working_set_id", { length: 36 }),
    operationId: varchar("operation_id", { length: 128 }).notNull(),
    providerTaskId: varchar("provider_task_id", { length: 255 }),
    apiCredentialId: varchar("api_credential_id", { length: 36 }).notNull(),
    credentialVersion: int("credential_version", { unsigned: true }).notNull(),
    publicProfile: varchar("public_profile", { length: 32 }).notNull(),
    upstreamModel: varchar("upstream_model", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "reserved",
      "submitted",
      "result_pending",
      "succeeded",
      "failed",
      "attention_required",
    ])
      .default("reserved")
      .notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("knowledge_base_executions_operation_uq").on(
      table.buildId,
      table.generation,
      table.operationId,
    ),
    index("knowledge_base_executions_status_idx").on(
      table.buildId,
      table.status,
    ),
  ],
);


/** Complete immutable node/evidence/asset bytes for one content version. */
const knowledgeBaseWorkingSets = mysqlTable(
  "knowledge_base_working_sets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    buildId: varchar("build_id", { length: 36 }).notNull(),
    generation: int("generation", { unsigned: true }).notNull(),
    contentVersion: int("content_version", { unsigned: true }).notNull(),
    sourceExecutionId: varchar("source_execution_id", { length: 36 }),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
    packageSha256: varchar("package_sha256", { length: 64 }).notNull(),
    manifestSha256: varchar("manifest_sha256", { length: 64 }).notNull(),
    manifest: json("manifest").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", ["staged", "active", "superseded", "invalid"])
      .default("staged")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    activatedAt: timestamp("activated_at"),
  },
  (table) => [
    uniqueIndex("knowledge_base_working_sets_version_uq").on(
      table.buildId,
      table.generation,
      table.contentVersion,
    ),
    uniqueIndex("knowledge_base_working_sets_package_uq").on(
      table.buildId,
      table.generation,
      table.packageSha256,
    ),
    index("knowledge_base_working_sets_status_idx").on(
      table.buildId,
      table.status,
    ),
  ],
);


/** User-requested, role-approved destructive reset of one workspace KB. */
const knowledgeBaseResetRequests = mysqlTable(
  "knowledge_base_reset_requests",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    ticketId: varchar("ticketId", { length: 36 })
      .notNull()
      .references(() => core.deliveryTickets.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    assignedProjectAssignmentId: varchar("assignedProjectAssignmentId", {
      length: 36,
    }),
    assignedMemberId: int("assignedMemberId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    activeKey: varchar("activeKey", { length: 191 }),
    reasonCode: mysqlEnum("reasonCode", [
      "stuck",
      "upload_error",
      "build_error",
      "enterprise_materials",
      "other",
    ]).notNull(),
    reasonNote: text("reasonNote"),
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .default("pending")
      .notNull(),
    decisionNote: text("decisionNote"),
    decidedByUserId: int("decidedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    cleanupSummary: json("cleanupSummary").$type<{
      builds: number;
      snapshots: number;
      conversations: number;
      attachments: number;
      importReceipts: number;
    }>(),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_base_reset_requests_ticket_uq").on(table.ticketId),
    uniqueIndex("knowledge_base_reset_requests_active_key_uq").on(
      table.activeKey,
    ),
    index("knowledge_base_reset_requests_user_status_idx").on(
      table.userId,
      table.status,
    ),
    index("knowledge_base_reset_requests_member_status_idx").on(
      table.assignedMemberId,
      table.status,
    ),
    foreignKey({
      name: "kb_reset_project_assignment_fk",
      columns: [table.assignedProjectAssignmentId],
      foreignColumns: [core.deliveryProjectAssignments.id],
    }).onDelete("set null"),
  ],
);


/** Monotonic KB reset revision used by open browser tabs to discard old state. */
const knowledgeBaseResetStates = mysqlTable(
  "knowledge_base_reset_states",
  {
    userId: int("userId")
      .primaryKey()
      .references(() => core.users.id, { onDelete: "cascade" }),
    revision: int("revision", { unsigned: true }).default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
);


/** Prevents an asynchronously persisted browser snapshot from resurrecting KB chat. */
const knowledgeBaseConversationTombstones = mysqlTable(
  "knowledge_base_conversation_tombstones",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    publicConversationId: varchar("publicConversationId", {
      length: 191,
    }).notNull(),
    resetRequestId: varchar("resetRequestId", { length: 36 })
      .notNull()
      .references(() => knowledgeBaseResetRequests.id, {
        onDelete: "cascade",
      }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("kb_conversation_tombstones_user_conversation_uq").on(
      table.userId,
      table.publicConversationId,
    ),
  ],
);


/**
 * Compact reset tombstones that outlive the verbose reset ticket. They keep
 * stale browser tabs from recreating a knowledge-base conversation after the
 * ticket and its request details have passed the retention window.
 */
const knowledgeBaseConversationRetentionTombstones = mysqlTable(
  "knowledge_base_conversation_retention_tombstones",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    publicConversationId: varchar("publicConversationId", {
      length: 191,
    }).notNull(),
    resetAt: timestamp("resetAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "kb_retention_tombstones_user_fk",
      columns: [table.userId],
      foreignColumns: [core.users.id],
    }).onDelete("cascade"),
    uniqueIndex("kb_retention_tombstones_user_conversation_uq").on(
      table.userId,
      table.publicConversationId,
    ),
  ],
);


/** Retry queue for deletion of KB-only local assets and upstream resources. */
const knowledgeBaseResetCleanupJobs = mysqlTable(
  "knowledge_base_reset_cleanup_jobs",
  {
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),
    id: varchar("id", { length: 36 }).primaryKey(),
    resetRequestId: varchar("resetRequestId", { length: 36 }),
    userId: int("userId").notNull(),
    apiCredentialId: varchar("apiCredentialId", { length: 36 }),
    kind: mysqlEnum("kind", ["task", "file", "local_asset"]).notNull(),
    /**
     * Full local storage key. Local keys can exceed the upstream identifier
     * limit, so `upstreamId` stores their SHA-256 queue identity while this
     * column preserves the lossless path used by the cleanup worker.
     */
    localAssetKey: text("localAssetKey"),
    upstreamId: varchar("upstreamId", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["pending", "completed", "failed"])
      .default("pending")
      .notNull(),
    attemptCount: int("attemptCount", { unsigned: true }).default(0).notNull(),
    lastError: text("lastError"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "kb_reset_cleanup_request_fk",
      columns: [table.resetRequestId],
      foreignColumns: [knowledgeBaseResetRequests.id],
    }).onDelete("set null"),
    foreignKey({
      name: "kb_reset_cleanup_user_fk",
      columns: [table.userId],
      foreignColumns: [core.users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "kb_reset_cleanup_credential_fk",
      columns: [table.apiCredentialId],
      foreignColumns: [core.apiCredentials.id],
    }).onDelete("set null"),
    uniqueIndex("kb_reset_cleanup_request_resource_uq").on(
      table.resetRequestId,
      table.kind,
      table.upstreamId,
    ),
    index("kb_reset_cleanup_status_attempt_idx").on(
      table.status,
      table.attemptCount,
    ),
  ],
);


/** One customer-owned, single-site SiteOps project and conversation. */
const siteProjects = mysqlTable(
  "site_projects",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 191 })
      .notNull()
      .references(() => core.conversations.id, { onDelete: "restrict" }),
    currentKnowledgeSnapshotId: varchar("current_knowledge_snapshot_id", {
      length: 36,
    }),
    currentBuildId: varchar("current_build_id", { length: 36 }),
    globalLiveDeploymentId: varchar("global_live_deployment_id", {
      length: 36,
    }),
    mainlandLiveDeploymentId: varchar("mainland_live_deployment_id", {
      length: 36,
    }),
    primaryLanguage: varchar("primary_language", { length: 32 })
      .default("zh-CN")
      .notNull(),
    canonicalHostname: varchar("canonical_hostname", { length: 255 }),
    /**
     * Unforgeable fresh-input boundary rotated by an approved SiteOps reset.
     * Null preserves the historical pre-2.9 compatibility path.
     */
    knowledgeInputEpochId: varchar("knowledge_input_epoch_id", { length: 36 }),
    currentTaskStartedAt: timestamp("current_task_started_at")
      .defaultNow()
      .notNull(),
    minimumKnowledgeSnapshotVersion: int("minimum_knowledge_snapshot_version", {
      unsigned: true,
    }),
    status: mysqlEnum("status", [
      "draft",
      "collecting_brief",
      "visual_searching",
      "awaiting_visual_selection",
      "building",
      "preview_ready",
      "approved",
      "live",
      "attention_required",
      "failed",
      "cancelled",
    ])
      .default("draft")
      .notNull(),
    brief: json("brief").$type<Record<string, unknown>>(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_projects_user_uq").on(table.enterpriseProjectId, table.userId),
    index("site_projects_legacy_owner_idx").on(table.userId),
    uniqueIndex("site_projects_conversation_uq").on(table.conversationId),
    index("site_projects_status_updated_idx").on(table.status, table.updatedAt),
    foreignKey({
      name: "site_projects_snapshot_fk",
      columns: [table.currentKnowledgeSnapshotId],
      foreignColumns: [knowledgeBaseSnapshots.id],
    }).onDelete("restrict"),
  ],
);


/** Immutable customer website build; artifacts are existing local_assets. */
const siteBuilds = mysqlTable(
  "site_builds",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    knowledgeSnapshotId: varchar("knowledge_snapshot_id", { length: 36 })
      .notNull()
      .references(() => knowledgeBaseSnapshots.id, { onDelete: "restrict" }),
    knowledgeArchiveHash: varchar("knowledge_archive_hash", {
      length: 64,
    }).notNull(),
    parentBuildId: varchar("parent_build_id", { length: 36 }),
    quotaPeriodId: varchar("quota_period_id", { length: 36 }),
    quotaState: mysqlEnum("quota_state", ["reserved", "consumed", "released"]),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    workflowUpstreamVersion: varchar("workflow_upstream_version", {
      length: 32,
    }).notNull(),
    workflowUpstreamHash: varchar("workflow_upstream_hash", {
      length: 64,
    }).notNull(),
    workflowVersion: varchar("workflow_version", { length: 32 }).notNull(),
    workflowPackageHash: varchar("workflow_package_hash", { length: 64 }),
    starterVersion: varchar("starter_version", { length: 32 }).notNull(),
    twentyFirstCredentialId: varchar("twenty_first_credential_id", {
      length: 36,
    }),
    twentyFirstCredentialVersion: int("twenty_first_credential_version", {
      unsigned: true,
    }),
    styleSampleId: varchar("style_sample_id", { length: 36 }).references(
      () => websiteStyleSamples.id,
      { onDelete: "restrict" },
    ),
    styleRevision: int("style_revision", { unsigned: true }),
    brief: json("brief").$type<Record<string, unknown>>().notNull(),
    selectionHash: varchar("selection_hash", { length: 64 }),
    contentPlanLocalAssetId: varchar("content_plan_local_asset_id", {
      length: 36,
    }),
    contentPlanSha256: varchar("content_plan_sha256", { length: 64 }),
    contractLocalAssetId: varchar("contract_local_asset_id", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    contractHash: varchar("contract_hash", { length: 64 }),
    sourceLocalAssetId: varchar("source_local_asset_id", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    sourceHash: varchar("source_hash", { length: 64 }),
    distLocalAssetId: varchar("dist_local_asset_id", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    distHash: varchar("dist_hash", { length: 64 }),
    qaLocalAssetId: varchar("qa_local_asset_id", { length: 36 }).references(
      () => core.localAssets.id,
      { onDelete: "restrict" },
    ),
    provenanceLocalAssetId: varchar("provenance_local_asset_id", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    upstreamManusTaskId: varchar("upstream_manus_task_id", { length: 255 }),
    repairAttempts: int("repair_attempts", { unsigned: true })
      .default(0)
      .notNull(),
    status: mysqlEnum("status", [
      "preparing",
      "visual_searching",
      "awaiting_visual_selection",
      "design_compiling",
      "contract_ready",
      "building",
      "qa_running",
      "preview_ready",
      "approved",
      "failed",
      "attention_required",
      "cancelled",
      "superseded",
    ])
      .default("preparing")
      .notNull(),
    approvedAt: timestamp("approved_at"),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_builds_project_ordinal_uq").on(
      table.projectId,
      table.ordinal,
    ),
    index("site_builds_project_status_idx").on(table.projectId, table.status),
    index("site_builds_parent_idx").on(table.parentBuildId),
    index("site_builds_quota_period_state_idx").on(
      table.quotaPeriodId,
      table.quotaState,
    ),
    foreignKey({
      name: "site_builds_21st_credential_fk",
      columns: [table.twentyFirstCredentialId],
      foreignColumns: [core.presalesApiCredentials.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "site_builds_quota_period_fk",
      columns: [table.quotaPeriodId],
      foreignColumns: [core.serviceQuotaPeriods.id],
    }).onDelete("restrict"),
    check(
      "site_builds_credential_version_ck",
      sql`(
        (${table.twentyFirstCredentialId} IS NULL AND ${table.twentyFirstCredentialVersion} IS NULL)
        OR
        (${table.twentyFirstCredentialId} IS NOT NULL AND ${table.twentyFirstCredentialVersion} IS NOT NULL)
      )`,
    ),
    check(
      "site_builds_quota_pair_ck",
      sql`(
        (${table.quotaPeriodId} IS NULL AND ${table.quotaState} IS NULL)
        OR
        (${table.quotaPeriodId} IS NOT NULL AND ${table.quotaState} IS NOT NULL)
      )`,
    ),
  ],
);


/** Immutable, tenant-bound user media frozen for one revision build. */
const siteBuildInputAssets = mysqlTable(
  "site_build_input_assets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    buildId: varchar("build_id", { length: 36 })
      .notNull()
      .references(() => siteBuilds.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    sourceAssetId: varchar("source_asset_id", { length: 191 }).notNull(),
    localAssetId: varchar("local_asset_id", { length: 36 })
      .notNull()
      .references(() => core.localAssets.id, { onDelete: "restrict" }),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    filename: varchar("filename", { length: 512 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    width: int("width", { unsigned: true }).notNull(),
    height: int("height", { unsigned: true }).notNull(),
    publicPath: varchar("public_path", { length: 512 }).notNull(),
    siteOpsKnowledgeInputEpochId: varchar("site_ops_knowledge_input_epoch_id", {
      length: 36,
    }),
    taskStartedAt: timestamp("task_started_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_build_input_assets_build_ordinal_uq").on(
      table.buildId,
      table.ordinal,
    ),
    uniqueIndex("site_build_input_assets_build_source_uq").on(
      table.buildId,
      table.sourceAssetId,
    ),
    uniqueIndex("site_build_input_assets_build_public_path_uq").on(
      table.buildId,
      table.publicPath,
    ),
    index("site_build_input_assets_local_asset_idx").on(table.localAssetId),
    index("site_build_input_assets_project_task_idx").on(
      table.projectId,
      table.taskStartedAt,
    ),
    index("site_build_input_assets_project_epoch_idx").on(
      table.projectId,
      table.siteOpsKnowledgeInputEpochId,
    ),
  ],
);


/** Leased, idempotent SiteOps side-effect reservation. */
const siteOperations = mysqlTable(
  "site_operations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    conversationTurnId: varchar("conversation_turn_id", {
      length: 36,
    }).references(() => core.conversationTurns.id, { onDelete: "set null" }),
    buildId: varchar("build_id", { length: 36 }).references(
      () => siteBuilds.id,
      { onDelete: "set null" },
    ),
    kind: mysqlEnum("kind", [
      "brief_message",
      "visual_search",
      "site_build",
      "build_revision",
      "deploy",
      "rollback",
      "social_package",
      "domain_sync",
      "dns_apply",
      "dns_rollback",
    ]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "succeeded",
      "failed",
      "outcome_unknown",
      "attention_required",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    clientRequestId: varchar("client_request_id", { length: 128 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    input: json("input").$type<Record<string, unknown>>().notNull(),
    provider: varchar("provider", { length: 64 }),
    providerOperationId: varchar("provider_operation_id", { length: 512 }),
    providerTaskId: varchar("provider_task_id", { length: 512 }),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    attempt: int("attempt", { unsigned: true }).default(0).notNull(),
    result: json("result").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_operations_project_request_uq").on(
      table.projectId,
      table.clientRequestId,
    ),
    index("site_operations_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    index("site_operations_build_idx").on(table.buildId, table.status),
  ],
);


/**
 * One immutable, task-scoped pool of complete 21st Template candidates.
 *
 * Status values deliberately use varchar plus application validation instead
 * of changing an existing MySQL enum. This keeps the migration additive while
 * allowing a future lifecycle state to be introduced without rebuilding a
 * customer-facing table.
 */
const visualCandidatePools = mysqlTable(
  "visual_candidate_pools",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 }).notNull(),
    userId: int("user_id").notNull(),
    knowledgeSnapshotId: varchar("knowledge_snapshot_id", {
      length: 36,
    }).notNull(),
    credentialId: varchar("credential_id", { length: 36 }).notNull(),
    credentialVersion: int("credential_version", { unsigned: true }).notNull(),
    initialOperationId: varchar("initial_operation_id", {
      length: 36,
    }).notNull(),
    generationKey: varchar("generation_key", { length: 64 }).notNull(),
    taskStartedAt: timestamp("task_started_at").notNull(),
    projectRevision: int("project_revision", { unsigned: true }).notNull(),
    seed: varchar("seed", { length: 64 }).notNull(),
    catalogFingerprint: varchar("catalog_fingerprint", {
      length: 64,
    }).notNull(),
    queryPlanHash: varchar("query_plan_hash", { length: 64 }).notNull(),
    manifestLocalAssetId: varchar("manifest_local_asset_id", {
      length: 36,
    }).notNull(),
    manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
    pageCount: int("page_count", { unsigned: true }).notNull(),
    candidateCount: int("candidate_count", { unsigned: true }).notNull(),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "visual_candidate_pools_project_fk",
      columns: [table.projectId],
      foreignColumns: [siteProjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visual_candidate_pools_user_fk",
      columns: [table.userId],
      foreignColumns: [core.users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visual_candidate_pools_snapshot_fk",
      columns: [table.knowledgeSnapshotId],
      foreignColumns: [knowledgeBaseSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "visual_candidate_pools_credential_fk",
      columns: [table.credentialId],
      foreignColumns: [core.presalesApiCredentials.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "visual_candidate_pools_operation_fk",
      columns: [table.initialOperationId],
      foreignColumns: [siteOperations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "visual_candidate_pools_manifest_fk",
      columns: [table.manifestLocalAssetId],
      foreignColumns: [core.localAssets.id],
    }).onDelete("restrict"),
    uniqueIndex("visual_candidate_pools_generation_uq").on(table.generationKey),
    index("visual_candidate_pools_project_task_idx").on(
      table.projectId,
      table.taskStartedAt,
      table.status,
    ),
    index("visual_candidate_pools_snapshot_credential_idx").on(
      table.knowledgeSnapshotId,
      table.credentialId,
      table.credentialVersion,
    ),
    check(
      "visual_candidate_pools_status_ck",
      sql`${table.status} IN ('active', 'selected', 'superseded')`,
    ),
    check(
      "visual_candidate_pools_capacity_ck",
      sql`(${table.pageCount} BETWEEN 1 AND 3 AND ${table.candidateCount} = ${table.pageCount} * 9)`,
    ),
  ],
);


/** A locally frozen V6 page. Only `published` pages have a customer batch. */
const visualCandidatePoolPages = mysqlTable(
  "visual_candidate_pool_pages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    poolId: varchar("pool_id", { length: 36 }).notNull(),
    pageNumber: int("page_number", { unsigned: true }).notNull(),
    status: varchar("status", { length: 32 }).default("reserved").notNull(),
    selectionBundleLocalAssetId: varchar("selection_bundle_local_asset_id", {
      length: 36,
    }).notNull(),
    selectionBundleHash: varchar("selection_bundle_hash", {
      length: 64,
    }).notNull(),
    candidateCount: int("candidate_count", { unsigned: true }).notNull(),
    bundleSizeBytes: int("bundle_size_bytes", { unsigned: true }).notNull(),
    batchId: varchar("batch_id", { length: 36 }),
    publishedOperationId: varchar("published_operation_id", {
      length: 36,
    }),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "visual_candidate_pool_pages_pool_fk",
      columns: [table.poolId],
      foreignColumns: [visualCandidatePools.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visual_candidate_pool_pages_bundle_fk",
      columns: [table.selectionBundleLocalAssetId],
      foreignColumns: [core.localAssets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "visual_candidate_pool_pages_batch_fk",
      columns: [table.batchId],
      foreignColumns: [websiteStyleSampleBatches.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "visual_candidate_pool_pages_operation_fk",
      columns: [table.publishedOperationId],
      foreignColumns: [siteOperations.id],
    }).onDelete("restrict"),
    uniqueIndex("visual_candidate_pool_pages_pool_page_uq").on(
      table.poolId,
      table.pageNumber,
    ),
    uniqueIndex("visual_candidate_pool_pages_batch_uq").on(table.batchId),
    index("visual_candidate_pool_pages_status_idx").on(
      table.poolId,
      table.status,
      table.pageNumber,
    ),
    check(
      "visual_candidate_pool_pages_status_ck",
      sql`${table.status} IN ('reserved', 'published', 'selected', 'superseded')`,
    ),
    check(
      "visual_candidate_pool_pages_capacity_ck",
      sql`(${table.pageNumber} BETWEEN 1 AND 3 AND ${table.candidateCount} = 9 AND ${table.bundleSizeBytes} > 0 AND ${table.bundleSizeBytes} <= 104857600)`,
    ),
    check(
      "visual_candidate_pool_pages_publish_ck",
      sql`(
        (${table.status} = 'reserved' AND ${table.batchId} IS NULL AND ${table.publishedOperationId} IS NULL AND ${table.publishedAt} IS NULL)
        OR
        (${table.status} IN ('published', 'selected') AND ${table.batchId} IS NOT NULL AND ${table.publishedOperationId} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)
        OR
        ${table.status} = 'superseded'
      )`,
    ),
  ],
);


/**
 * Durable preview references for every frozen page, including pages that have
 * not yet been published as a customer-visible batch. Retention must follow
 * these rows rather than the age of the underlying local asset.
 */
const visualCandidatePoolItems = mysqlTable(
  "visual_candidate_pool_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    poolPageId: varchar("pool_page_id", { length: 36 }).notNull(),
    sampleId: varchar("sample_id", { length: 36 }).notNull(),
    position: int("position", { unsigned: true }).notNull(),
    previewLocalAssetId: varchar("preview_local_asset_id", {
      length: 36,
    }).notNull(),
    previewSha256: varchar("preview_sha256", { length: 64 }).notNull(),
    sourceTreeSha256: varchar("source_tree_sha256", { length: 64 }).notNull(),
    providerTemplateId: varchar("provider_template_id", {
      length: 191,
    }).notNull(),
    providerSlug: varchar("provider_slug", { length: 191 }).notNull(),
    providerVersion: varchar("provider_version", { length: 191 }),
    providerItemKey: varchar("provider_item_key", { length: 512 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "visual_candidate_pool_items_page_fk",
      columns: [table.poolPageId],
      foreignColumns: [visualCandidatePoolPages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visual_candidate_pool_items_preview_fk",
      columns: [table.previewLocalAssetId],
      foreignColumns: [core.localAssets.id],
    }).onDelete("restrict"),
    uniqueIndex("visual_candidate_pool_items_page_sample_uq").on(
      table.poolPageId,
      table.sampleId,
    ),
    uniqueIndex("visual_candidate_pool_items_page_position_uq").on(
      table.poolPageId,
      table.position,
    ),
    uniqueIndex("visual_candidate_pool_items_preview_uq").on(
      table.previewLocalAssetId,
    ),
    uniqueIndex("visual_candidate_pool_items_page_provider_uq").on(
      table.poolPageId,
      table.providerItemKey,
    ),
    index("visual_candidate_pool_items_source_tree_idx").on(
      table.sourceTreeSha256,
    ),
    check(
      "visual_candidate_pool_items_position_ck",
      sql`${table.position} BETWEEN 0 AND 8`,
    ),
  ],
);


/** Append-only deployment and rollback records. */
const siteDeployments = mysqlTable(
  "site_deployments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    buildId: varchar("build_id", { length: 36 })
      .notNull()
      .references(() => siteBuilds.id, { onDelete: "restrict" }),
    operationId: varchar("operation_id", { length: 36 }).references(
      () => siteOperations.id,
      { onDelete: "set null" },
    ),
    target: mysqlEnum("target", [
      "global_excluding_cn",
      "mainland_cn",
    ]).notNull(),
    intent: mysqlEnum("intent", ["deploy", "rollback"]).notNull(),
    rollbackOfDeploymentId: varchar("rollback_of_deployment_id", {
      length: 36,
    }),
    expectedHeadDeploymentId: varchar("expected_head_deployment_id", {
      length: 36,
    }),
    distLocalAssetId: varchar("dist_local_asset_id", { length: 36 })
      .notNull()
      .references(() => core.localAssets.id, { onDelete: "restrict" }),
    distHash: varchar("dist_hash", { length: 64 }).notNull(),
    domainRevision: int("domain_revision", { unsigned: true }).notNull(),
    providerDeploymentId: varchar("provider_deployment_id", { length: 512 }),
    publicUrl: text("public_url"),
    verification: json("verification").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "reserved",
      "deploying",
      "verifying",
      "active",
      "superseded",
      "failed",
      "attention_required",
    ])
      .default("reserved")
      .notNull(),
    activatedAt: timestamp("activated_at"),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_deployments_operation_uq").on(table.operationId),
    index("site_deployments_project_target_status_idx").on(
      table.projectId,
      table.target,
      table.status,
    ),
  ],
);


/** Download-only WeChat and Xiaohongshu packages. */
const socialPackages = mysqlTable(
  "social_packages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    knowledgeSnapshotId: varchar("knowledge_snapshot_id", {
      length: 36,
    }).notNull(),
    operationId: varchar("operation_id", { length: 36 }).references(
      () => siteOperations.id,
      { onDelete: "set null" },
    ),
    ticketId: varchar("ticket_id", { length: 36 }).references(
      () => core.deliveryTickets.id,
      { onDelete: "set null" },
    ),
    quotaPeriodId: varchar("quota_period_id", { length: 36 }),
    quotaState: mysqlEnum("quota_state", ["reserved", "consumed", "released"]),
    channel: mysqlEnum("channel", ["wechat", "xiaohongshu"]).notNull(),
    manifest: json("manifest").$type<Record<string, unknown>>(),
    manifestHash: varchar("manifest_hash", { length: 64 }),
    archiveLocalAssetId: varchar("archive_local_asset_id", {
      length: 36,
    }).references(() => core.localAssets.id, { onDelete: "restrict" }),
    archiveHash: varchar("archive_hash", { length: 64 }),
    previewLocalAssetIds: json("preview_local_asset_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    qa: json("qa").$type<Record<string, unknown>>(),
    downloadCount: int("download_count", { unsigned: true })
      .default(0)
      .notNull(),
    status: mysqlEnum("status", [
      "queued",
      "building",
      "ready",
      "failed",
      "attention_required",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_packages_operation_uq").on(table.operationId),
    index("social_packages_project_channel_idx").on(
      table.projectId,
      table.channel,
      table.createdAt,
    ),
    index("social_packages_quota_period_state_idx").on(
      table.quotaPeriodId,
      table.quotaState,
    ),
    foreignKey({
      name: "social_packages_snapshot_fk",
      columns: [table.knowledgeSnapshotId],
      foreignColumns: [knowledgeBaseSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "social_packages_quota_period_fk",
      columns: [table.quotaPeriodId],
      foreignColumns: [core.serviceQuotaPeriods.id],
    }).onDelete("restrict"),
    check(
      "social_packages_quota_pair_ck",
      sql`(
        (${table.quotaPeriodId} IS NULL AND ${table.quotaState} IS NULL)
        OR
        (${table.quotaPeriodId} IS NOT NULL AND ${table.quotaState} IS NOT NULL)
      )`,
    ),
  ],
);


/** Customer-approved AliDNS OAuth grant. Access tokens are never persisted. */
const siteProviderConnections = mysqlTable(
  "site_provider_connections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["aliyun_cn"]).notNull(),
    accountUid: varchar("account_uid", { length: 128 }).notNull(),
    oauthCredentialId: varchar("oauth_credential_id", {
      length: 36,
    }).notNull(),
    encryptionVersion: int("encryption_version").default(1).notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    encryptionIv: varchar("encryption_iv", { length: 32 }).notNull(),
    encryptionAuthTag: varchar("encryption_auth_tag", { length: 32 }).notNull(),
    capabilities: json("capabilities").$type<string[]>().default([]).notNull(),
    status: mysqlEnum("status", ["active", "invalid", "revoked"])
      .default("active")
      .notNull(),
    verifiedAt: timestamp("verified_at"),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_provider_connections_project_provider_uq").on(
      table.projectId,
      table.provider,
    ),
    index("site_provider_connections_account_idx").on(table.accountUid),
    foreignKey({
      name: "site_provider_connections_oauth_credential_fk",
      columns: [table.oauthCredentialId],
      foreignColumns: [core.presalesApiCredentials.id],
    }).onDelete("restrict"),
  ],
);


/** Exact AliDNS records owned by FrontMind for one domain revision. */
const siteDnsRecords = mysqlTable(
  "site_dns_records",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => siteProjects.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    domainAscii: varchar("domain_ascii", { length: 255 }).notNull(),
    domainRevision: int("domain_revision", { unsigned: true }).notNull(),
    recordType: varchar("record_type", { length: 16 }).notNull(),
    rr: varchar("rr", { length: 255 }).notNull(),
    expectedValue: text("expected_value").notNull(),
    expectedTtl: int("expected_ttl", { unsigned: true }).notNull(),
    beforeValue: text("before_value"),
    beforeTtl: int("before_ttl", { unsigned: true }),
    observedValue: text("observed_value"),
    observedTtl: int("observed_ttl", { unsigned: true }),
    providerRecordId: varchar("provider_record_id", { length: 191 }),
    remarkMarker: varchar("remark_marker", { length: 255 }).notNull(),
    status: mysqlEnum("status", [
      "planned",
      "applying",
      "propagating",
      "active",
      "conflict",
      "failed",
      "outcome_unknown",
      "rolled_back",
    ])
      .default("planned")
      .notNull(),
    verifiedAt: timestamp("verified_at"),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("site_dns_records_project_revision_tuple_uq").on(
      table.projectId,
      table.domainRevision,
      table.rr,
      table.recordType,
    ),
    index("site_dns_records_status_idx").on(table.status, table.updatedAt),
  ],
);


const enterpriseProjectSiteProfiles = mysqlTable(
  "enterprise_project_site_profiles",
  {
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => { const id = core.currentEnterpriseProjectId(); if (!id) throw new Error("ENTERPRISE_PROJECT_REQUIRED"); return id; }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }),
    normalizedAsciiDomain: varchar("normalizedAsciiDomain", { length: 255 }),
    unicodeDisplayDomain: varchar("unicodeDisplayDomain", { length: 255 }),
    domainRevision: int("domainRevision", { unsigned: true })
      .default(1)
      .notNull(),
    providerAccountUid: varchar("providerAccountUid", { length: 128 }),
    domainOwnershipStatus: varchar("domainOwnershipStatus", { length: 64 }),
    dnsStatus: varchar("dnsStatus", { length: 64 }),
    icpDomainRevision: int("icpDomainRevision", { unsigned: true }),
    siteMode: mysqlEnum("siteMode", ["managed", "external", "unknown"])
      .default("unknown")
      .notNull(),
    domainStatus: mysqlEnum("domainStatus", [
      "not_started",
      "pending",
      "completed",
    ])
      .default("not_started")
      .notNull(),
    domainVerifiedAt: timestamp("domainVerifiedAt"),
    icpProvince: varchar("icpProvince", { length: 64 }),
    icpNumber: varchar("icpNumber", { length: 128 }),
    icpStatus: mysqlEnum("icpStatus", [
      "not_submitted",
      "preparing",
      "submitted",
      "approved",
      "rejected",
      "not_required",
    ])
      .default("not_submitted")
      .notNull(),
    icpVerifiedAt: timestamp("icpVerifiedAt"),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("workspace_site_profiles_domain_idx").on(table.domain),
    index("workspace_site_profiles_ascii_domain_idx").on(
      table.normalizedAsciiDomain,
    ),
    index("workspace_site_profiles_workflow_idx").on(
      table.domainStatus,
      table.icpStatus,
    ),
  ],
);
return { websiteStyleWorkflows, websiteStyleSampleBatches, websiteStyleSamples, workspaceSiteProfiles, workspaceSiteChecks, knowledgeImportReceipts, knowledgeBaseSnapshots, knowledgeBaseBuilds, knowledgeBaseBuildNodes, knowledgeBaseExecutions, knowledgeBaseWorkingSets, knowledgeBaseResetRequests, knowledgeBaseResetStates, knowledgeBaseConversationTombstones, knowledgeBaseConversationRetentionTombstones, knowledgeBaseResetCleanupJobs, siteProjects, siteBuilds, siteBuildInputAssets, siteOperations, visualCandidatePools, visualCandidatePoolPages, visualCandidatePoolItems, siteDeployments, socialPackages, siteProviderConnections, siteDnsRecords, enterpriseProjectSiteProfiles };
}
export type BrandSchema = ReturnType<typeof createBrandSchema>;

export type VisualCandidatePool = BrandSchema["visualCandidatePools"]["$inferSelect"];

export type VisualCandidatePoolPage = BrandSchema["visualCandidatePoolPages"]["$inferSelect"];

export type VisualCandidatePoolItem = BrandSchema["visualCandidatePoolItems"]["$inferSelect"];

export type WorkspaceSiteProfile = BrandSchema["workspaceSiteProfiles"]["$inferSelect"];

export type WorkspaceSiteCheck = BrandSchema["workspaceSiteChecks"]["$inferSelect"];

export type KnowledgeImportReceipt = BrandSchema["knowledgeImportReceipts"]["$inferSelect"];

export type KnowledgeBaseSnapshot = BrandSchema["knowledgeBaseSnapshots"]["$inferSelect"];

export type KnowledgeBaseBuild = BrandSchema["knowledgeBaseBuilds"]["$inferSelect"];

export type KnowledgeBaseBuildNode = BrandSchema["knowledgeBaseBuildNodes"]["$inferSelect"];

export type KnowledgeBaseExecution = BrandSchema["knowledgeBaseExecutions"]["$inferSelect"];

export type KnowledgeBaseWorkingSet = BrandSchema["knowledgeBaseWorkingSets"]["$inferSelect"];

export type KnowledgeBaseResetRequest = BrandSchema["knowledgeBaseResetRequests"]["$inferSelect"];

export type KnowledgeBaseResetState = BrandSchema["knowledgeBaseResetStates"]["$inferSelect"];

export type KnowledgeBaseConversationTombstone = BrandSchema["knowledgeBaseConversationTombstones"]["$inferSelect"];

export type KnowledgeBaseConversationRetentionTombstone = BrandSchema["knowledgeBaseConversationRetentionTombstones"]["$inferSelect"];

export type KnowledgeBaseResetCleanupJob = BrandSchema["knowledgeBaseResetCleanupJobs"]["$inferSelect"];

export type SiteProject = BrandSchema["siteProjects"]["$inferSelect"];

export type SiteBuild = BrandSchema["siteBuilds"]["$inferSelect"];

export type SiteOperation = BrandSchema["siteOperations"]["$inferSelect"];

export type SiteDeployment = BrandSchema["siteDeployments"]["$inferSelect"];

export type SocialPackage = BrandSchema["socialPackages"]["$inferSelect"];

export type SiteProviderConnection = BrandSchema["siteProviderConnections"]["$inferSelect"];

export type SiteDnsRecord = BrandSchema["siteDnsRecords"]["$inferSelect"];
