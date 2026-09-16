import type {CoreSqlTable} from "../contracts/sql-table.js";
import type {LocalAsset} from "../contracts/core-records.js";
import type {SQL} from "drizzle-orm";
export type BrandKeywordActor={id:number;role:string};
export type BrandKeywordCredential={id:string;userId:number;version:number;credentialRef:string;fingerprint:string;status:"active"|"retired";verifiedAt:Date|null;agentProfile:"frontmind-base"|"frontmind-pro";provider:"manus"|"zhipu"|"xty_codex";upstreamModel:string;upstreamEffort:string|null};
export type BrandKeywordEvent=Record<string,unknown>&{id:string;type:string;timestamp:number;providerOriginalRank?:number};
type Operation={id:string;enterpriseProjectId:string|null;provider:string;scope:"managed_user"|"website_frontend";accountUserId:number|null;presalesProjectId:string|null;operationType:string;idempotencyKeyHash:string;requestHash:string;contractName:string;contractRevision:number;schemaHash:string;apiCredentialId:string;credentialVersion:number;publicProfile:string;upstreamModel:string;status:"queued"|"running"|"result_pending"|"succeeded"|"failed"|"cancelled"|"attention_required";errorCode:string|null;createdAt:Date;updatedAt:Date};
type Task={id:string;providerRuntime:Record<string,unknown>|null;operationId:string;providerTaskId:string|null;providerRequestId:string|null;createMarker:string;title:string;providerState:string;lastMessageSyncAt:Date|null;resultDeadlineAt:Date|null;createdAt:Date;updatedAt:Date};
type Event={id:string;taskId:string;providerEventId:string;eventType:string;providerTimestampMs:number;normalizedPayload:Record<string,unknown>;receivedAt:Date;updatedAt:Date};
type Artifact={id:string;operationId:string|null;taskId:string|null;sourceEventId:string;attachmentIndex:number;filename:string;mimeType:string;sizeBytes:number;contentSha256:string;storageKey:string;validationState:"staged"|"valid"|"invalid";refCount:number;createdAt:Date};
type Port=(...args:any[])=>any;
export interface BrandKeywordPorts {
 agentOperations:CoreSqlTable<Operation>;agentTasks:CoreSqlTable<Task>;agentEvents:CoreSqlTable<Event>;artifacts:CoreSqlTable<Artifact>;localAssets:CoreSqlTable<LocalAsset>;
 assertActorAllowed(actor:BrandKeywordActor):void;lockAccountRecord(tx:any,userId:number):Promise<void>;
 getDecryptedCredentialForUser(userId:number):Promise<BrandKeywordCredential|null>;
 getDecryptedCredentialForAccountById(userId:number,id:string):Promise<BrandKeywordCredential|null>;
 createCredentialAgentClient(credential:BrandKeywordCredential,options?:{accountUserId?:number;operationId?:string;localTaskId?:string;intentId?:string}):{uploadFile:Port;createTask:Port;listAllMessages:Port;sendMessage:Port;findCreatedTask:Port;taskDetail:Port};
 getDb:Port;projectBrandQuestionExecution:Port;lockCustomerProjectBusinessWrite:Port;currentEnterpriseProjectId:Port;enterpriseWorkspaceUserId:Port;getEnterpriseProjectScope:Port;runWithStoredEnterpriseProjectScope:Port;enterpriseAccountOwnerPredicate:Port;enterpriseDashboardTable:Port;enterpriseDashboardOwnerPredicate:Port;
 dashboardPayloadSchema:{parse:Port};getApiCredentialStatus:Port;recordUpstreamResource:Port;getLatestAuthenticatedKnowledgeSnapshot:Port;DashboardRevisionConflictError:new(...args:any[])=>Error;getDashboardWorkspace:Port;getKnowledgeSnapshotById:Port;updateDashboardWorkspace:Port;classifyManusV2StructuredResultEnvelope:Port;latestManusV2TaskState:Port;ManusV2ApiError:new(...args:any[])=>Error&{outcomeUnknown:boolean;status:number|null;providerRequestId?:string|null;code:string;retryable:boolean};manusV2EventOperationToken:Port;manusV2EventsContainOperationToken:Port;orderManusV2EventsByProviderRank:(events:readonly BrandKeywordEvent[],direction:"oldest_first"|"newest_first")=>BrandKeywordEvent[];assertServiceCapability:Port;getUpstreamBaseUrl:Port;sealLocalAssetStorageIdentity:Port;readStoredPresalesFile:Port;removeStoredPresalesFile:Port;stagePresalesFileContent:Port;
}
