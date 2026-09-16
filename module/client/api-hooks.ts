import type { KnowledgeSnapshotView } from "./components/KnowledgeBaseViewer";
import type { KnowledgeBaseProgressDto } from "../contracts/knowledge-base-public-progress";
import type { SiteOpsObservationV1 } from "../contracts/siteops-contract";
import type { SiteOpsActInput } from "../contracts/siteops";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
export type QueryResult<T>={data:T|undefined;error:{message:string}|null;isLoading:boolean;isFetching:boolean;isError:boolean;isSuccess:boolean;refetch(options?:{cancelRefetch?:boolean}):Promise<{data:T|undefined;error?:unknown}>};
export type QueryOptions<T>={enabled?:boolean;retry?:false;refetchOnMount?:boolean|"always";refetchOnWindowFocus?:boolean;refetchInterval?:number|false|((query:{state:{data:T|undefined}})=>number|false);refetchIntervalInBackground?:boolean;trpc?:{abortOnUnmount?:boolean}};
export type QueryHook<I,O>={useQuery(input:I,options?:QueryOptions<O>):QueryResult<O>};
export type MutationHook<I,O>={useMutation(options?:{onSuccess?:(data:O)=>void}):{data?:O;error:{message:string}|null;isPending:boolean;mutate(input:I):void;mutateAsync(input:I):Promise<O>;reset():void}};
export type CachePort<I,O>={invalidate():Promise<void>;cancel():Promise<void>;fetch(input?:I):Promise<O>;setData(input:I,updater:(previous:O|undefined)=>O|undefined):void};
export type KnowledgeResetStatus={revision:number;hasKnowledge:boolean;canReset:boolean;unavailableReason:string|null};
export type KeywordObservation={reason:string;canStart:boolean;knowledgeSnapshotId:string|null;dashboardRevision:number;operation:{status:string;repairAttempts:number;publicationOutcome:string|null}|null;execution?:GeneralExecutionDto|null};
export type SiteOpsAck={schemaVersion:1;accepted:true;clientRequestId:string;projectRevision:number;latestSequence:number;operationId:string|null;interactionState:SiteOpsObservationV1["interactionState"]};
export type BrandApiHooks={workspace:{
 knowledge:QueryHook<void,{snapshot:KnowledgeSnapshotView|null}>;
 knowledgeProgress:QueryHook<void|{conversationId:string},{progress:KnowledgeBaseProgressDto|null}>;
 knowledgeReset:{status:QueryHook<void,KnowledgeResetStatus>;reset:MutationHook<{expectedRevision:number},unknown>};
 brandQuestionUniverse:{observe:QueryHook<void,KeywordObservation>;start:MutationHook<{knowledgeSnapshotId:string;clientRequestId:string;expectedDashboardRevision:number},KeywordObservation>};
 siteOps:{open:MutationHook<void,SiteOpsObservationV1>;observe:QueryHook<{conversationId:string},SiteOpsObservationV1>;actFast:MutationHook<SiteOpsActInput,SiteOpsAck>;sendMessage:MutationHook<{conversationId:string;clientRequestId:string;text:string;localAssetIds:string[];expectedProjectRevision:number},unknown>;aliyunConnection:{beginOAuth:MutationHook<{conversationId:string},{authorizationUrl:string;expiresAt:string}>;listDomains:QueryHook<{conversationId:string},{domains:Array<{domain:string;displayDomain:string}>}>;disconnect:MutationHook<{conversationId:string},unknown>}};
};useUtils():{workspace:{knowledge:{invalidate():Promise<void>;clear():void};knowledgeProgress:CachePort<void|{conversationId:string},{progress:KnowledgeBaseProgressDto|null}>;knowledgeReset:{status:CachePort<void,KnowledgeResetStatus>};portal:{invalidate():Promise<void>};dashboard:{invalidate():Promise<void>};brandQuestionUniverse:{observe:{invalidate():Promise<void>;cancel():Promise<void>}}}}};
let installed:BrandApiHooks|undefined;
export function configureBrandApiHooks(hooks:BrandApiHooks){installed=hooks;}
export const trpc:BrandApiHooks=new Proxy({} as BrandApiHooks,{get(_target,key){if(!installed)throw new Error("Brand business client is not installed");return Reflect.get(installed,key);}});
