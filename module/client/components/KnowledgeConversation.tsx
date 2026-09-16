import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@frontmind/module-ui/components/ui/button';
import {Textarea} from '@frontmind/module-ui/components/ui/textarea';
import MarkdownRenderer from '@frontmind/module-ui/components/MarkdownRenderer';
import {EmptyConversationHint,buildKnowledgeBaseStarterAttachmentManifest} from './KnowledgeStarter';
import {useKnowledgeBaseStarter} from '../lib/useKnowledgeBaseStarter';
import {useKnowledgeBaseUploadBatch,useKnowledgeBaseUploadField} from '../lib/knowledge-base-upload-manager';
import {currentKnowledgeBaseReplySnapshot,sanitizeKnowledgeBaseOutputMessages} from '../knowledge-conversation-state';
import {useConversation,useRuntimeContext,useWorkspaceDraftGuard,captureWorkspaceRestOperation,type BrandHomeProps,type BrandChatInputProps} from '../host';
import {createKnowledgeBaseTurnTask,type Message} from '../lib/frontmind-api';
import {reconcileKnowledgeBaseObservation} from '../lib/knowledge-progress';
import KnowledgeBaseManagedUploadRecovery from './KnowledgeBaseManagedUploadRecovery';
import KnowledgeWorkspaceStatus from './KnowledgeWorkspaceStatus';
import KnowledgePublicExecution from './KnowledgePublicExecution';
import {GeneralExecutionActivity} from './GeneralExecutionActivity';
import {generalExecutionSlots} from '../lib/general-execution-display';
import {finalReplyIds} from '../lib/final-reply';
import {conversationExecutionTimings} from '../lib/execution-duration';
import {ExecutionDivider} from './ExecutionDuration';

/** Knowledge-only composer. Durable receipt coordinates travel with every retry. */
export function KnowledgeComposer({knowledgeBaseResetRevision=0,knowledgeEditingBlocked=false,onComposerDirtyChange,composerScope}:BrandChatInputProps){
 const context=useConversation();const conversation=context.activeConversation;
 const scope=composerScope??`supplement:${conversation?.id??'new'}`;
 const batch=useKnowledgeBaseUploadBatch(`${scope}:${knowledgeBaseResetRevision}`,`${scope}:`);
 const [text,setText]=useKnowledgeBaseUploadField(batch,'draft','');
 const [files,setFiles]=useKnowledgeBaseUploadField<File[]>(batch,'draftFiles',[]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const snapshot=currentKnowledgeBaseReplySnapshot(conversation);
 const dirty=Boolean(text.trim()||files.length);useWorkspaceDraftGuard({dirty,label:'知识节点补充资料'});
 useEffect(()=>{onComposerDirtyChange?.(dirty);return()=>onComposerDirtyChange?.(false);},[dirty,onComposerDirtyChange]);
 const frozen=batch.ref<{key:string;id:string;coordinate:NonNullable<typeof snapshot>;reset:number;conversationId:string}|null>('pending-command',null);
 async function submit(value=text){
  if(!conversation||!snapshot||busy||knowledgeEditingBlocked)return;
  const key=JSON.stringify([conversation.id,knowledgeBaseResetRevision,snapshot,value,files.map(f=>[f.name,f.size,f.lastModified])]);
  if(frozen.current&&frozen.current.key!==key){setError('上一轮提交结果尚未确认，请先重新核对状态。');return;}
  const command=frozen.current??{key,id:crypto.randomUUID(),coordinate:snapshot,reset:knowledgeBaseResetRevision,conversationId:conversation.id};frozen.current=command;
  setBusy(true);setError('');const operation=captureWorkspaceRestOperation();
  try{
   await context.flushConversation(command.conversationId);operation.assertActive();
   const input:Message[]=[{role:'user',content:[{type:'input_text',text:value.trim()||'请读取补充资料并更新当前节点。'}]}];
   context.registerKnowledgeBaseConversation(command.conversationId);
   const pendingId=`knowledge-pending:${command.id}`;
   if(!conversation.messages.some(m=>m.knowledgeBase?.clientRequestId===command.id))context.addMessage(command.conversationId,{id:pendingId,role:'user',content:value.trim(),timestamp:Date.now(),responseStartedAt:Date.now(),knowledgeBase:{kind:'pending_user',clientRequestId:command.id},attachments:files.map((file,index)=>({id:`${command.id}:${index}`,name:file.name,type:'file',file}))});
   const coordinates={conversationId:command.conversationId,clientRequestId:command.id,expectedResetRevision:command.reset,expectedGeneration:command.coordinate.generation,expectedRevision:command.coordinate.revision,expectedLeafId:command.coordinate.leafId,expectedPresentationKey:command.coordinate.presentationKey};
   const response=files.length?(await batch.submit({kind:'revise',...coordinates,input,manifest:await buildKnowledgeBaseStarterAttachmentManifest(files,files.map((_f,index)=>`${command.id}:${index+1}`),operation.signal),files:files.map((file,index)=>({file,itemId:`${command.id}:${index+1}`,ordinal:index+1})),onObservation:observation=>context.commitKnowledgeBaseObservation(command.conversationId,observation)})).response:await createKnowledgeBaseTurnTask(input,{...coordinates,expectedStateEpoch:command.coordinate.stateEpoch,expectedContentVersion:command.coordinate.contentVersion},operation.signal);
   if(response.adoptedClientRequestId&&response.adoptedClientRequestId!==command.id)context.rollbackPendingKnowledgeBaseTurn(command.conversationId,command.id);
   if(response.knowledgeObservation)context.commitKnowledgeBaseObservation(command.conversationId,response.knowledgeObservation);
   context.wakeKnowledgeBaseConversation(command.conversationId);frozen.current=null;setText('');setFiles([]);toast.success('本轮已提交');
  }catch(cause){
   const observation=(cause as {knowledgeObservation?:Parameters<typeof context.commitKnowledgeBaseObservation>[1]}).knowledgeObservation;
   if(observation)context.commitKnowledgeBaseObservation(command.conversationId,observation);
   setError(cause instanceof Error?cause.message:'提交未完成，请重新核对状态。');context.wakeKnowledgeBaseConversation(command.conversationId);
  }finally{setBusy(false);}
 }
 async function reconcile(){if(!conversation)return;setBusy(true);try{const observation=await reconcileKnowledgeBaseObservation({conversationId:conversation.id});context.commitKnowledgeBaseObservation(conversation.id,observation);if(observation.interaction.canReply)frozen.current=null;setError('');}catch(cause){setError(cause instanceof Error?cause.message:'读取失败');}finally{setBusy(false);}}
 const knowledge=conversation?.knowledgeBase;
 if(conversation&&knowledge?.activeTurnAwaitingClientAttachments&&knowledge.activeTurnId&&knowledge.activeClientRequestId)return <KnowledgeBaseManagedUploadRecovery conversationId={conversation.id} turnId={knowledge.activeTurnId} clientRequestId={knowledge.activeClientRequestId} expectedResetRevision={knowledge.activeTurnResetRevision??knowledgeBaseResetRevision} operationType={knowledge.activeTurnOperationType==='start'?'start':'revise'} onObservation={value=>context.commitKnowledgeBaseObservation(conversation.id,value)} onRecovered={()=>context.wakeKnowledgeBaseConversation(conversation.id)}/>;
 return <form className="brand-knowledge-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
  <Textarea aria-label="补充或修改当前知识节点" value={text} onChange={event=>setText(event.target.value)} disabled={busy||knowledgeEditingBlocked} placeholder={snapshot?'补充资料、描述修改，或确认当前内容':'正在等待当前节点就绪…'}/>
  <input aria-label="补充参考文件" type="file" multiple disabled={busy||!snapshot||knowledgeEditingBlocked} onChange={event=>{setFiles(Array.from(event.target.files??[]));event.currentTarget.value='';}}/>
  {!!files.length&&<ul>{files.map((file,index)=><li key={`${file.name}:${index}`}>{file.name}<button type="button" disabled={busy} onClick={()=>setFiles(files.filter((_f,i)=>i!==index))}>移除</button></li>)}</ul>}
  {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>void reconcile()}>重新核对</button></p>}
  <div><Button type="submit" disabled={busy||!snapshot||knowledgeEditingBlocked||(!text.trim()&&!files.length)}>{busy?'正在提交…':'发送补充'}</Button><Button type="button" variant="outline" disabled={busy||!snapshot||knowledgeEditingBlocked||files.length>0||Boolean(text.trim())} onClick={()=>void submit('确认当前节点')}>确认当前节点</Button></div>
 </form>;
}

/** Public knowledge build/conversation UI, shared by main and module domains. */
export default function KnowledgeConversation(props:BrandHomeProps){
 const context=useConversation();const runtime=useRuntimeContext();const conversation=context.activeConversation;
 const scope=`${context.workbenchScopeKey??runtime.workspaceId}:${runtime.accountId}:${conversation?.id??'new'}`;
 const batch=useKnowledgeBaseUploadBatch(`${scope}:${props.knowledgeBaseResetRevision??0}`,`${scope}:`);
 const start=useKnowledgeBaseStarter(batch);
 const messages=sanitizeKnowledgeBaseOutputMessages(conversation?.messages??[]);
 const running=Boolean(conversation&&['running','pending'].includes(conversation.status));
 const slots=generalExecutionSlots(messages,conversation?.execution,running);
 const copyable=finalReplyIds(messages,conversation?.execution,running);
 const timings=conversation?conversationExecutionTimings(conversation,messages):new Map();
 if(!context.hydrated)return <p role="status">{context.loading?'正在恢复知识库任务…':context.syncError??'知识库任务未加载'} <button onClick={()=>void context.refreshConversations()}>重新读取</button></p>;
 return <section className="brand-knowledge-conversation" aria-label="知识库构建与恢复">
  {context.syncError&&<p role="alert">{context.syncError}</p>}
  {!conversation?.knowledgeBase?.initialized&&!props.knowledgeBaseProgress?<EmptyConversationHint uploadScopeKey={scope} resetRevision={props.knowledgeBaseResetRevision??0} eligible={!props.knowledgeEditingBlocked} companyName="" companyConfigured={false} companyLoading={false} inline onDirtyChange={props.onComposerDirtyChange} onStartKnowledgeBase={start} onBatchCancelled={revision=>conversation?props.onKnowledgeBaseBatchCancelled?.(conversation.id,revision):undefined}/>:<>
   <div className="brand-knowledge-transcript">{messages.map(message=><article key={message.id} className={`brand-knowledge-message brand-knowledge-message--${message.role}`}><GeneralExecutionActivity items={slots.before.get(message.id)}/>{props.inlineBlocks?.filter(block=>block.anchor.messageId===message.id&&block.placement==='before').map(block=><div key={block.id}>{block.content}</div>)}<MarkdownRenderer content={message.content} allowCopy={copyable.has(message.id)}/>{message.attachments?.length?<ul>{message.attachments.map(file=><li key={file.id}>{file.name}</li>)}</ul>:null}<ExecutionDivider timing={timings.get(message.id)}/><GeneralExecutionActivity items={slots.after.get(message.id)} placement="after"/></article>)}{props.conversationFooter}</div>
   {props.knowledgeBaseProgress&&<KnowledgeWorkspaceStatus progress={props.knowledgeBaseProgress}/>}
   <KnowledgeComposer {...props}/>
  </>}
 </section>;
}
