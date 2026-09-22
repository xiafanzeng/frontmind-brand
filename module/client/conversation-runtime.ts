import {useEffect,useSyncExternalStore} from 'react';
import {KnowledgeBasePollingCoordinator} from './lib/knowledge-base-coordinator';
import {applyKnowledgeBaseObservation,mergeKnowledgeBaseHydration,type Conversation} from './knowledge-conversation-state';
import type {KnowledgeBaseObservationDto} from '../contracts/knowledge-base-public-progress';
import type {BrandConversationContext} from './host';
export interface BrandConversationClient {
 list(purpose:'knowledge'|'enterprise_qa'):Promise<Conversation[]>;
 sync(purpose:'knowledge'|'enterprise_qa',conversations:Conversation[],deletedIds?:string[]):Promise<void>;
 observe(conversationId:string,signal:AbortSignal):Promise<KnowledgeBaseObservationDto>;
}
/** A title or purpose marker identifies a draft, not a started build. */
function hasKnowledgeBaseExecution(record:Conversation){
 return Boolean(record.knowledgeBase?.initialized||record.taskId||record.previousResponseId||record.messages.some(message=>message.knowledgeBase?.serverOwned&&(message.knowledgeBase.buildId||message.knowledgeBase.turnId)));
}
/** Fixed workspace business history; no login, roles or tenant selection. */
export function createBrandConversationRuntime(client:BrandConversationClient,purpose:'knowledge'|'enterprise_qa',workspaceId:string){
 let value:{conversations:Conversation[];activeConversationId:string|null;hydrated:boolean;loading:boolean;error:string|null}={conversations:[],activeConversationId:null,hydrated:false,loading:false,error:null};
 const listeners=new Set<()=>void>();const dirty=new Set<string>();let loading:Promise<void>|undefined;let saving=Promise.resolve();
 const emit=()=>listeners.forEach(listener=>listener());
 const update=(change:Partial<typeof value>)=>{
  if(Object.entries(change).every(([key,next])=>Object.is(value[key as keyof typeof value],next)))return;
  value={...value,...change};emit();
 };
 const modify=(id:string,apply:(record:Conversation)=>Conversation,shouldSave=true)=>{const next=value.conversations.map(record=>record.id===id?apply(record):record);if(shouldSave)dirty.add(id);update({conversations:next});};
 async function flush(id:string){
  const record=value.conversations.find(item=>item.id===id);if(!record)return false;
  const snapshot={...record,messages:record.messages.map(message=>({...message,attachments:message.attachments?.map(({file,blobUrl,...attachment})=>attachment)}))};
  const run=saving.catch(()=>{}).then(()=>client.sync(purpose,[snapshot]));saving=run;
  try{await run;const current=value.conversations.find(item=>item.id===id);if(current===record)dirty.delete(id);update({error:null});return true;}catch(error){update({error:error instanceof Error?error.message:'保存失败'});throw error;}
 }
 let observationError: {id:string;message:string}|null=null;
 const reportObservationError=(id:string,error:unknown)=>{
  // A historic build's polling failure must not replace the active workspace.
  if(id!==value.activeConversationId)return;
  observationError={id,message:error instanceof Error?error.message:'知识库状态读取失败'};
  update({error:observationError.message});
 };
 const coordinator=new KnowledgeBasePollingCoordinator({observe:client.observe,apply(id,observation){
  modify(id,current=>applyKnowledgeBaseObservation(current,observation),false);
  if(observationError?.id===id){
   if(value.error===observationError.message)update({error:null});
   observationError=null;
  }
 },onTransientError:reportObservationError,onPermanentError:reportObservationError});
 async function refresh(){if(loading)return loading;update({loading:true});loading=(async()=>{try{const remote=await client.list(purpose);const merged=remote.map(record=>purpose==='knowledge'?mergeKnowledgeBaseHydration(value.conversations.find(item=>item.id===record.id),record):dirty.has(record.id)?value.conversations.find(item=>item.id===record.id)??record:record);const ids=new Set(merged.map(item=>item.id));for(const record of value.conversations)if(dirty.has(record.id)&&!ids.has(record.id))merged.push(record);const queryId=new URL(location.href).searchParams.get('workbenchTask');const active=[queryId,value.activeConversationId,merged[0]?.id].find(id=>id&&merged.some(item=>item.id===id))??null;update({conversations:merged,activeConversationId:active,hydrated:true,error:null});if(purpose==='knowledge')for(const record of merged)if(hasKnowledgeBaseExecution(record)){coordinator.register(record.id);coordinator.wake(record.id);}}catch(error){update({error:error instanceof Error?error.message:'历史记录读取失败'});}finally{loading=undefined;update({loading:false});}})();return loading;}
 function createConversation(options?:Parameters<BrandConversationContext['createConversation']>[0]){if(options?.reuseEmpty!==false){const existing=value.conversations.find(record=>!record.messages.length&&!record.knowledgeBase);if(existing){update({activeConversationId:existing.id});return existing.id;}}const now=Date.now();const record:Conversation={id:crypto.randomUUID(),title:options?.title??(purpose==='knowledge'?'企业知识库构建':'企业问答'),...(purpose==='enterprise_qa'?{purpose:'enterprise_qa' as const}:{}),workbenchAgentId:purpose==='knowledge'?'knowledge':'enterprise-qa',messages:[],status:'idle',createdAt:now,updatedAt:now};dirty.add(record.id);update({conversations:[record,...value.conversations],activeConversationId:record.id});void flush(record.id).catch(()=>{});return record.id;}
 // Effects in the business components depend on these actions. Keep their
 // identity stable across snapshots so a state update cannot wake another poll.
 const actions:Omit<BrandConversationContext,'workbenchScopeKey'|'state'|'activeConversation'|'loading'|'hydrated'|'syncError'>={createConversation,setActive(id){if(value.conversations.some(record=>record.id===id))update({activeConversationId:id});},addMessage(id,message){modify(id,record=>({...record,messages:record.messages.some(item=>item.id===message.id)?record.messages.map(item=>item.id===message.id?message:item):[...record.messages,message],updatedAt:Date.now()}));},updateTitle(id,title){modify(id,record=>({...record,title,updatedAt:Date.now()}));},updateStatus(id,status,extra){modify(id,record=>({...record,status,...extra,...(extra?.clearTaskPointer?{taskId:undefined,previousResponseId:undefined}:{}),updatedAt:Date.now()}));},flushConversation:flush,registerKnowledgeBaseConversation(id){if(purpose==='knowledge')coordinator.register(id);},wakeKnowledgeBaseConversation(id){if(purpose==='knowledge')coordinator.wake(id);},commitKnowledgeBaseObservation(id,observation){modify(id,record=>applyKnowledgeBaseObservation(record,observation),false);},settleKnowledgeBaseStartFailure(id,requestId){modify(id,record=>({...record,status:'error',messages:record.messages.filter(message=>message.knowledgeBase?.clientRequestId!==requestId)}));},rollbackPendingKnowledgeBaseTurn(id,requestId){modify(id,record=>({...record,messages:record.messages.filter(message=>message.knowledgeBase?.clientRequestId!==requestId)}));},settleGeneralChatDispatch(id,requestId){modify(id,record=>({...record,messages:record.messages.map(message=>message.generalChatDispatch?.clientRequestId===requestId?{...message,generalChatDispatch:undefined}:message)}));},deleteConversation(id){void client.sync(purpose,[],[id]).then(()=>{coordinator.unregister(id);dirty.delete(id);update({conversations:value.conversations.filter(record=>record.id!==id),activeConversationId:value.activeConversationId===id?null:value.activeConversationId});}).catch(error=>update({error:error.message}));},discardKnowledgeBaseConversationsLocally(primaryId){const ids=value.conversations.filter(record=>record.id===primaryId||record.knowledgeBase||record.workbenchAgentId==='knowledge'||record.title==='企业知识库构建').map(record=>record.id);for(const id of ids){coordinator.unregister(id);dirty.delete(id);}update({conversations:value.conversations.filter(record=>!ids.includes(record.id)),activeConversationId:ids.includes(value.activeConversationId??'')?null:value.activeConversationId});return ids;},refreshConversations:refresh,refreshConversationsAfterDiscard:refresh,clearSyncError(){update({error:null});}};
 const api=():BrandConversationContext=>({...actions,workbenchScopeKey:`brand:${workspaceId}:${purpose}`,state:{conversations:value.conversations,activeConversationId:value.activeConversationId},activeConversation:value.conversations.find(record=>record.id===value.activeConversationId)??null,loading:value.loading,hydrated:value.hydrated,syncError:value.error});
 function useConversation(){useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>value);useEffect(()=>{if(!value.hydrated)void refresh();const wake=()=>{if(purpose==='knowledge')for(const record of value.conversations)if(hasKnowledgeBaseExecution(record))coordinator.wake(record.id);};window.addEventListener('focus',wake);window.addEventListener('online',wake);return()=>{window.removeEventListener('focus',wake);window.removeEventListener('online',wake);};},[]);return api();}
 return {useConversation,refresh,dispose:()=>coordinator.dispose()};
}
