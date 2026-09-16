import { createContext, useContext, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import type { Conversation, LocalMessage } from "./conversation-types";
import type { KnowledgeBaseObservationDto, KnowledgeBaseProgressDto } from "../contracts/knowledge-base-public-progress";
import type { WorkbenchStatePatch, WorkbenchTaskState } from "@frontmind/module-ui/contracts/workbench-task";

export interface BrandConversationContext {
  workbenchScopeKey?:string;state:{conversations:Conversation[];activeConversationId?:string|null};activeConversation:Conversation|null;
  loading:boolean;hydrated:boolean;syncError:string|null;
  createConversation(options?:{title?:string;reuseEmpty?:boolean;purpose?:"enterprise_qa"|"content_production";workbenchAgentId?:string}):string;
  setActive(id:string):void;updateStatus(id:string,status:Conversation["status"],extra?:{taskId?:string;previousResponseId?:string;clearTaskPointer?:boolean;executionKind?:"general_chat_v2"|"response_logic";completedAt?:number;startedAt?:number}):void;
  settleGeneralChatDispatch(id:string,requestId:string):void;deleteConversation(id:string):void;
  flushConversation(id:string):Promise<boolean>;rollbackPendingKnowledgeBaseTurn(id:string,requestId:string):void;
  addMessage(id:string,message:LocalMessage):void;updateTitle(id:string,title:string):void;settleKnowledgeBaseStartFailure(id:string,requestId:string):void;
  registerKnowledgeBaseConversation(id:string):void;wakeKnowledgeBaseConversation(id:string):void;
  commitKnowledgeBaseObservation(id:string,observation:KnowledgeBaseObservationDto):void;
  discardKnowledgeBaseConversationsLocally(id?:string):string[];
  refreshConversationsAfterDiscard():Promise<void>;refreshConversations():Promise<void>;clearSyncError():void;
}
export type WorkspaceRestOperation={signal:AbortSignal;assertActive():void;headers(extra?:Record<string,string>):Record<string,string>;fetch(input:RequestInfo|URL,init?:RequestInit,implementation?:typeof fetch):Promise<Response>};
export type DraftGuard={dirty:boolean;label:string;save?:()=>Promise<boolean>;discard?:()=>Promise<boolean>};
export type BusinessWorkspaceSummary={title?:string;items:Array<{label:string;value:string}>;status?:string;outputs?:Array<{id:string;title:string;description?:string;type?:string;version?:string|number;status?:string;source?:string;pendingChanges?:boolean;onOpen?:()=>void;onRevise?:()=>void}>;scope?:"task"|"project";canViewProject?:boolean;onScopeChange?:(scope:"task"|"project")=>void;action?:{label:string;onClick():void}};
export type BusinessWorkspaceValue={isWorkbench:boolean;taskId:string|null;agentId:string;task?:{scopeKey?:string;pending:boolean;state?:WorkbenchTaskState|null;saveState(patch:WorkbenchStatePatch):Promise<unknown>};setSummary(summary:BusinessWorkspaceSummary|null):void};
export type BrandHomeProps={embedded?:boolean;fixedAgentProfile?:string;syncKnowledgeBaseSnapshot?:boolean;purpose?:"enterprise_qa";hideSidebar?:boolean;hidePortalNavigation?:boolean;showKnowledgeBaseStarter?:boolean;showAccountMenu?:boolean;showSettings?:boolean;standardWelcomeVariant?:"simple"|"workflow"|"enterprise_qa";messageProjection?:(message:LocalMessage)=>LocalMessage;inlineBlocks?:Array<{id:string;anchor:{kind:"message";messageId:string};placement:"before"|"after";content:ReactNode}>;conversationFooter?:ReactNode;knowledgeBaseProgress?:KnowledgeBaseProgressDto|null;knowledgeBaseResetRevision?:number;operatorWorkspace?:boolean;knowledgeEditingBlocked?:boolean;onComposerDirtyChange?:(dirty:boolean)=>void;knowledgeBaseAccountId?:number;onKnowledgeBaseBatchCancelled?:(id:string,revision:number)=>void|Promise<void>};
export type BrandChatInputProps={operatorWorkspace?:boolean;onComposerDirtyChange?:(dirty:boolean)=>void;composerScope?:string;fixedAgentProfile?:string;syncKnowledgeBaseSnapshot?:boolean;knowledgeBaseProgress?:KnowledgeBaseProgressDto|null;knowledgeBaseResetRevision?:number;knowledgeBaseAccountId?:number;knowledgeEditingBlocked?:boolean;onDirtyChange?:(dirty:boolean)=>void;onKnowledgeBaseBatchCancelled?:(id:string,revision:number)=>void|Promise<void>};
export type AgentWorkbenchShellProps={projectId:string;moduleId:string;title:string;main?:ReactNode;auxiliary?:ReactNode;composer?:ReactNode;layout?:"single"|"workflow"|"knowledge"|"workspace";toolbar?:ReactNode;taskTitle?:string;taskKey?:string;scrollMain?:boolean;showLatestControl?:boolean;auxiliaryScroll?:boolean;independentResourceScroll?:boolean;conversation?:ReactNode;children?:ReactNode;result?:ReactNode;resultTitle?:string;resultKey?:string;status?:string;embedded?:boolean;showResult?:boolean;conversationFocusRequest?:object|null;auxiliaryFocusRequest?:object|null;topbarActions?:ReactNode;titleRef?:React.RefObject<HTMLHeadingElement|null>};
export type BrandHost={
  notifyUsageChanged?():void;
  useRuntimeContext():{workspaceId:string;accountId:number;enabled:boolean};
  useConversation():BrandConversationContext;
  captureWorkspaceRestOperation:(signal?:AbortSignal|null,scope?:{enterpriseProjectId?:string;projectAssignmentId?:string},options?:{detached?:boolean})=>WorkspaceRestOperation;
  forkWorkspaceRestOperation:(operation:WorkspaceRestOperation,signal:AbortSignal)=>WorkspaceRestOperation;
  activateWorkspaceUploadScope:(key:string)=>()=>void;
  projectResourceUrl:(path:string)=>string;projectWorkspaceUrl:(path:string)=>string;deliveryProjectHeaders:(extra?:Record<string,string>)=>Record<string,string>;
  useWorkspaceDraftGuard:(input:DraftGuard)=>void;getUnsavedWorkspaceDrafts:()=>readonly unknown[];requestWorkspaceNavigation:(action:()=>void)=>void;
  showAiBillingAction:(value:unknown)=>boolean;
  Home:ComponentType<BrandHomeProps>;ChatInput:ComponentType<BrandChatInputProps>;AgentWorkbenchShell:ComponentType<AgentWorkbenchShellProps>;
  ProjectAgentWorkbench:ComponentType<{projectId:string;purpose:"enterprise_qa";children?:ReactNode}>;
  ConversationPurposeProvider:ComponentType<{purpose:"enterprise_qa";children:ReactNode}>;
  useBusinessWorkspace:()=>BusinessWorkspaceValue;useBusinessWorkspaceSummary:(summary:BusinessWorkspaceSummary|null)=>void;
};
let configured:BrandHost|null=null;
export function configureBrandHost(host:BrandHost){configured=host;}
export function brandHost(){if(!configured)throw new Error("Brand runtime context is not installed");return configured;}
export function useRuntimeContext(){return brandHost().useRuntimeContext();}
export function useConversation(){return brandHost().useConversation();}
export function captureWorkspaceRestOperation(...args:Parameters<BrandHost["captureWorkspaceRestOperation"]>){return brandHost().captureWorkspaceRestOperation(...args);}
export function forkWorkspaceRestOperation(...args:Parameters<BrandHost["forkWorkspaceRestOperation"]>){return brandHost().forkWorkspaceRestOperation(...args);}
export function activateWorkspaceUploadScope(key:string){return brandHost().activateWorkspaceUploadScope(key);}
export function projectResourceUrl(path:string){return brandHost().projectResourceUrl(path);}
export function projectWorkspaceUrl(path:string){return brandHost().projectWorkspaceUrl(path);}
export function deliveryProjectHeaders(extra?:Record<string,string>){return brandHost().deliveryProjectHeaders(extra);}
export function useWorkspaceDraftGuard(input:DraftGuard){return brandHost().useWorkspaceDraftGuard(input);}
export function getUnsavedWorkspaceDrafts(){return brandHost().getUnsavedWorkspaceDrafts();}
export function requestWorkspaceNavigation(action:()=>void){return brandHost().requestWorkspaceNavigation(action);}
export function showAiBillingAction(value:unknown){return brandHost().showAiBillingAction(value);}
export function Home(props:BrandHomeProps){const C=brandHost().Home;return <C {...props}/>;}
export function ChatInput(props:BrandChatInputProps){const C=brandHost().ChatInput;return <C {...props}/>;}
export function AgentWorkbenchShell(props:AgentWorkbenchShellProps){const C=brandHost().AgentWorkbenchShell;return <C {...props}/>;}
export function ProjectAgentWorkbench(props:{projectId:string;purpose:"enterprise_qa";children?:ReactNode}){const C=brandHost().ProjectAgentWorkbench;return <C {...props}/>;}
export function ConversationPurposeProvider(props:{purpose:"enterprise_qa";children:ReactNode}){const C=brandHost().ConversationPurposeProvider;return <C {...props}/>;}
export function useBusinessWorkspace(){return brandHost().useBusinessWorkspace();}
export function useBusinessWorkspaceSummary(summary:BusinessWorkspaceSummary|null){return brandHost().useBusinessWorkspaceSummary(summary);}
export function setWorkbenchTaskQuery(id:string){const url=new URL(location.href);url.searchParams.set("workbenchTask",id);history.replaceState(history.state,"",url);}

export function notifyUsageChanged(){brandHost().notifyUsageChanged?.();}
