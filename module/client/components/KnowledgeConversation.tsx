import "./knowledge-conversation.css";
import BrandConversationMessage from './BrandConversationMessage';
import { EmptyConversationHint } from './KnowledgeStarter';
import { useKnowledgeBaseStarter } from '../lib/useKnowledgeBaseStarter';
import { useKnowledgeBaseUploadBatch } from '../lib/knowledge-base-upload-manager';
import { sanitizeKnowledgeBaseOutputMessages } from '../knowledge-conversation-state';
import { ChatInput, useConversation, useRuntimeContext, type BrandHomeProps } from '../host';
import KnowledgeWorkspaceStatus from './KnowledgeWorkspaceStatus';
import { GeneralExecutionActivity } from './GeneralExecutionActivity';
import { generalExecutionSlots } from '../lib/general-execution-display';
import { finalReplyIds } from '../lib/final-reply';
import { conversationExecutionTimings } from '../lib/execution-duration';
import { ExecutionDivider } from './ExecutionDuration';
export { default as KnowledgeComposer } from "./KnowledgeComposer";

/** Public knowledge build/conversation UI, shared by main and module domains. */
export default function KnowledgeConversation(props:BrandHomeProps){
 const context=useConversation();const runtime=useRuntimeContext();const conversation=context.activeConversation;
 const scope=`${context.workbenchScopeKey??runtime.workspaceId}:${runtime.accountId}:${conversation?.id??'new'}`;
 const batch=useKnowledgeBaseUploadBatch(`${scope}:${props.knowledgeBaseResetRevision??0}`,`${scope}:`);
 const start=useKnowledgeBaseStarter(batch);
 const messages=sanitizeKnowledgeBaseOutputMessages(conversation?.messages??[]).map(message=>props.messageProjection?.(message)??message);
 const running=Boolean(conversation&&['running','pending'].includes(conversation.status));
 const slots=generalExecutionSlots(messages,conversation?.execution,running);
 const copyable=finalReplyIds(messages,conversation?.execution,running);
 const timings=conversation?conversationExecutionTimings(conversation,messages):new Map();
 if(!context.hydrated)return <p role="status">{context.loading?'正在恢复知识库任务…':context.syncError??'知识库任务未加载'} <button onClick={()=>void context.refreshConversations()}>重新读取</button></p>;
 return <section className="brand-knowledge-conversation" aria-label="知识库构建与恢复">
  {context.syncError&&<p role="alert">{context.syncError}</p>}
  {!conversation?.knowledgeBase?.initialized&&!props.knowledgeBaseProgress?<EmptyConversationHint uploadScopeKey={scope} resetRevision={props.knowledgeBaseResetRevision??0} eligible={!props.knowledgeEditingBlocked} companyName="" companyConfigured={false} companyLoading={false} inline onDirtyChange={props.onComposerDirtyChange} onStartKnowledgeBase={start} onBatchCancelled={revision=>conversation?props.onKnowledgeBaseBatchCancelled?.(conversation.id,revision):undefined}/>:<>
   <div className="brand-knowledge-transcript" data-testid="chat-messages-viewport">{messages.map(message=><article key={message.id} data-reading-anchor={message.id} className={`brand-knowledge-message brand-knowledge-message--${message.role}`}>
    {props.inlineBlocks?.filter(block=>block.anchor.messageId===message.id&&block.placement==='before').map(block=><div key={block.id}>{block.content}</div>)}
    <GeneralExecutionActivity items={slots.before.get(message.id)}/>
    <BrandConversationMessage message={message} allowCopy={copyable.has(message.id)}>
     {props.inlineBlocks?.filter(block=>block.anchor.messageId===message.id&&block.placement==='after').map(block=><div key={block.id}>{block.content}</div>)}
    </BrandConversationMessage>
    {message.role==='user'&&<ExecutionDivider timing={timings.get(message.id)}/>}
    <GeneralExecutionActivity items={slots.after.get(message.id)} placement="after"/>
   </article>)}{props.conversationFooter}</div>
   {props.knowledgeBaseProgress&&<KnowledgeWorkspaceStatus progress={props.knowledgeBaseProgress}/>}
   <ChatInput {...props} operatorWorkspace syncKnowledgeBaseSnapshot/>
  </>}
 </section>;
}
