import BusinessChatInput from "@frontmind/module-ui/components/BusinessChatInput";
import type { BusinessComposerRuntime } from "@frontmind/module-ui/components/business-composer-runtime";
import { currentKnowledgeBaseReplySnapshot } from "./knowledge-conversation-state";
import { formatKnowledgeBaseUploadBytes } from "./lib/knowledge-base-upload-manager";
import {useMemo} from "react";
import BrandConversationMessage from "./components/BrandConversationMessage";
import {brandHost,useConversation,useWorkspaceDraftGuard,type BrandHomeProps} from "./host";
import type {Conversation,LocalMessage} from "./conversation-types";
import "./enterprise-qa-conversation.css";
import { useEnterpriseQaController } from "./use-enterprise-qa-controller";
/** Business QA transport. The host supplies its purpose-scoped store and the
 * private runtime supplies ownership/knowledge; no product login or agent list. */
export default function EnterpriseQaConversation({preview=false,messageProjection,conversationFooter,knowledgeEditingBlocked,..._props}:BrandHomeProps&{preview?:boolean}) {
 const {active,sending,notice,send,stop}=useEnterpriseQaController({preview});
 const composerRuntime=useMemo<BusinessComposerRuntime<unknown,unknown,Conversation,unknown>>(()=>({
  useConversation, currentKnowledgeBaseReplySnapshot,
  useSendMessage:()=>({sendMessage:send,uploadProgress:null,knowledgeBaseAttachmentAttempt:null,stopKnowledgeBaseAttachmentAttempt(){},continueKnowledgeBaseAttachmentAttempt(){},discardKnowledgeBaseAttachmentAttempt(){}}),
  useChatSubmission:()=>null,useWorkspaceDraftGuard,
  captureWorkspaceRestOperation:()=>brandHost().captureWorkspaceRestOperation(),
  consumePendingFrontMindBuildDraft:()=>"",GeneralAgentRuntimeBadge:()=>null,KnowledgeBaseManagedUploadRecovery:()=>null,generalSuggestions:[],
  formatKnowledgeBaseUploadBytes,chatAttachmentSizeError:file=>file.size>64*1024*1024?"企业问答附件每份不超过64MB。":null,knowledgeLogoNoticeCode:"unused-qa-logo",
 }),[send]);
 const busy=sending||knowledgeEditingBlocked||["running","pending"].includes(active?.status??"");
 return <section className="brand-qa-chat" aria-label="企业问答对话">{notice&&<p role="alert" className="brand-qa-notice">{notice}</p>}<div className="brand-qa-messages">{active?.messages.map(original=>{const message=messageProjection?.(original)??original;return <article key={message.id} className={`brand-qa-message brand-qa-message--${message.role}`}><BrandConversationMessage message={message} allowCopy={!busy}>{message.generalChatDispatch&&<button className="brand-qa-retry" type="button" disabled={sending} onClick={()=>void send(message.content,[])}>重试本次提交</button>}</BrandConversationMessage></article>})}</div>{conversationFooter}<BusinessChatInput runtime={composerRuntime} purpose="enterprise_qa" welcomeSuggestions="enterprise_qa" operatorWorkspace knowledgeEditingBlocked={Boolean(knowledgeEditingBlocked)||!active}/>{active?.taskId&&["running","pending"].includes(active.status)&&<button className="brand-qa-stop" type="button" onClick={()=>void stop()}>停止当前执行</button>}</section>;
}
