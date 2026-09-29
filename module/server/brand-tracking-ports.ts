import type {CoreSqlTable} from "../contracts/sql-table.js";
import type {BrandSchema} from "../schema/index.js";
export type BrandTrackingActor = {
 id: number; role: "user" | "admin" | "delivery_member"; isActive: boolean;
 marketEdition?: "domestic" | "overseas"; engineerRoleType?: "ai_operations_engineer" | "monitoring_optimization_engineer" | "content_distribution_engineer" | null;
};
export type BrandTrackingTables = BrandSchema & {
 users: CoreSqlTable<{id:number;username:string|null;displayName:string|null;role:"user"|"admin"|"delivery_member";isActive:boolean;marketEdition:"domestic"|"overseas"}>;
 deliveryProjectAssignments: CoreSqlTable<{id:string;customerUserId:number;engineerUserId:number|null;roleType:string}>;
};
