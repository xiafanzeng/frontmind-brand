import type { MySql2Database } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
import type { BrandSchema } from "../../schema/index.js";
import type { CoreSqlTable } from "../../contracts/sql-table.js";
import type { LocalAsset, ConversationTurn } from "../../contracts/core-records.js";
export type SiteOpsDatabase = MySql2Database<any>;
export type SiteOpsCoreError = Error & { code: string; statusCode?: number };
export type SiteOpsCoreErrorConstructor = new (...args: any[]) => SiteOpsCoreError;
export type SiteOpsOwnershipPredicate = (...args: any[]) => SQL;
export type SiteOpsOAuthProjectIdentity = { projectId: string; userId: number; actorUserId?: number; enterpriseProjectId?: string | null };
export type EncryptedCredential = { encryptionVersion: number; encryptedKey: string; encryptionIv: string; encryptionAuthTag: string };
export type PresalesApiCredential = EncryptedCredential & {
 id: string; provider: string; slot: string; version: number; fingerprint: string;
 status: "active" | "retired" | "deleted"; validationStatus: "unverified" | "verified" | "invalid";
 createdByUserId: number | null; verifiedAt: Date | null; retiredAt: Date | null; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
};
export type ServiceQuotaPeriod = {
 id: string; contractId: string; userId: number; ordinal: number; startsAt: Date; endsAt: Date;
 industryLimit: number; competitorComparisonLimit: number; reputationLimit: number; productScenarioLimit: number; totalQuestionLimit: number;
 contentAssetPublishLimit: number; websiteContentPublishLimit: number; archivedContentAssetPublishUsed: number; archivedWebsiteContentPublishUsed: number;
 revision: number; createdAt: Date; updatedAt: Date;
};
export type SiteOpsInfrastructureTables = BrandSchema & {
 localAssets: CoreSqlTable<LocalAsset>; conversationTurns: CoreSqlTable<ConversationTurn>;
 presalesApiCredentials: CoreSqlTable<PresalesApiCredential>; serviceQuotaPeriods: CoreSqlTable<ServiceQuotaPeriod>;
};
export type ContentQuotaPool = "content_asset_publish" | "website_content_publish";
export type SiteOpsServicePortal = {
 mode?: "operator" | "service";
 service: { status: string; planCode: string | null; contractId: string | null };
 entitlementRollout: { mode: "compatibility" | "enforced" };
 quotaPeriods?: Array<{periodId: string}>;
 quotas?: {periodId: string} | null;
};
