import type {Readable} from 'node:stream';
export type ManusV2MessageEvent=Record<string,unknown>&{id:string;type:string;timestamp:number;providerOriginalRank?:number};
export type ManusV2Attachment={file_id:string;filename:string;file_data?:never;mime_type?:never}|{file_data:string;filename:string;mime_type:string;file_id?:never};
export type ManusV2StructuredOutputSchema=Record<string,unknown>;
export type CredentialMetadata={id:string;userId:number;version:number;credentialRef:string;provider:'manus'|'zhipu'|'xty_codex';upstreamModel:string;upstreamEffort:string|null;agentProfile:string};
export type ProviderError=Error&{code:string;status:number|null;retryable:boolean;outcomeUnknown:boolean;operation:string;retryAfterMs:number|null;providerRequestId:string|null;providerField?:string|null;providerPath?:string|null;transportCause?:unknown;transportPhase?:unknown;transportAttempt?:unknown;transportElapsedMs?:unknown;transportBytesWritten?:unknown};
export interface DashboardAgentClientOptions {credentialRef?:string;credentialId:string;credentialVersion:number;accountUserId:number;credentialOwnerUserId?:number;provider:'manus'|'zhipu'|'xty_codex';intentId?:string;upstreamModel?:string;upstreamEffort?:string|null;rateLimitScope?:string;timeoutMs?:number;[key:string]:unknown}
export interface DashboardAgentClient {
 createTask(input:any):Promise<{taskId:string;taskUrl?:string|null;requestId?:string|null;raw:Record<string,unknown>;[key:string]:unknown}>;
 sendMessage(input:any):Promise<{taskId:string;taskUrl?:string|null;requestId?:string|null;raw:Record<string,unknown>;[key:string]:unknown}>;
 taskDetail(taskId:string):Promise<any>;
 listAllMessages(input:{taskId:string;order:'asc'|'desc';stopAfterOperationToken?:string}):Promise<ManusV2MessageEvent[]>;
 findCreatedTask(input:any):Promise<any>;
 stopTask(input:any):Promise<any>;
 deleteTask(input:any):Promise<any>;
 confirmAction(input:any):Promise<any>;
 uploadFile(input:any):Promise<any>;
 fileDetail(input:any):Promise<any>;
 deleteFile(input:any):Promise<any>;
 probeCredential():Promise<any>;
 downloadArtifact?(fileId:string):Promise<{status:number;headers:Record<string,string>;data:Readable}>;
}
export type TwentyFirstNativeTemplateSummary={templateId:string|number;slug:string;name:string;version:string|null;verified:boolean;includedWithPlan:boolean;sortRank:number;previewUrl:string;sourceOwner:string;sourceRepo:string;sourceCommitSha:string;sourceSubdirectory:string|null;sourceLicense:'MIT'|'Apache-2.0'};
export type TwentyFirstNativeTemplateArchive={templateId:string|number;slug:string;version:string|null;archive:Uint8Array;sha256:string;contentType:'application/zip';sourceUrlOrigin:string;sourceSubdirectory:string|null};
export type TwentyFirstReadOnlySession={effectiveSearchLimit?:number;preferredSearchType?:'template'|'component';preferredTemplateSort?:'popular';search(input:{query:string;type:'template'|'component';limit:number;tag?:'hero';sort?:'recommended'|'popular'}):Promise<unknown>;getComponent?:(id:string|number)=>Promise<unknown>};
export interface TwentyFirstClient {
 withReadOnlySession<T>(credentialRef:string,use:(session:TwentyFirstReadOnlySession)=>Promise<T>,options?:{signal?:AbortSignal}):Promise<T>;
 listNativeTemplates(credentialRef:string,options?:{limit?:number;signal?:AbortSignal;excludeTemplateIds?:readonly string[];excludeSlugs?:readonly string[]}):Promise<TwentyFirstNativeTemplateSummary[]>;
 downloadNativeTemplate(credentialRef:string,input:{templateId:string|number;slug:string;version?:string|null;sourceOwner?:string;sourceRepo?:string;sourceCommitSha?:string;sourceSubdirectory?:string|null;sourceLicense?:'MIT'|'Apache-2.0';signal?:AbortSignal}):Promise<TwentyFirstNativeTemplateArchive>;
}
