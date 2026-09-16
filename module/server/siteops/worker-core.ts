import type { BrandSchema } from "../../schema/index.js";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
export interface SiteOpsWorkerCore {
  tables: BrandSchema;
  /** Shared execution/file infrastructure supplied by Core; no credential values. */
  localAssets: any;
  messages: any;
  getDb(): Promise<MySql2Database<any> | null>;
  runWithStoredEnterpriseProjectScope<T>(userId: number, projectId: string | null, action: () => Promise<T>): Promise<T>;
  enterpriseAccountOwnerPredicate(table: any, userId: number): SQL;
  enterpriseOwnerPredicate(table: any, userId: number): SQL;
  enterpriseSiteProfileTable(): BrandSchema["enterpriseProjectSiteProfiles"] | BrandSchema["workspaceSiteProfiles"];
  enterpriseSiteProfileOwnerPredicate(userId: number): SQL;
  finalizePendingTwentyFirstCredentialRevocations(): Promise<unknown>;
  runtimeErrorForLog(error: unknown): unknown;
}
