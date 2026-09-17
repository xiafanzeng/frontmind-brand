import {useCallback,useEffect,useRef,useState} from "react";
import BrandConversationMessage from "./components/BrandConversationMessage";
import {brandHost,useConversation,type BrandHomeProps} from "./host";
import type {Conversation,LocalMessage} from "./conversation-types";
import type {GeneralChatDispatchMetadata} from "@frontmind/module-contracts/chat-dispatch";
import "./enterprise-qa-conversation.css";
import { isQaTaskTerminal, startEnterpriseQaPolling } from "./enterprise-qa-polling";

type QaTask={id:string;purpose?:string;status:string;error?:{message?:string}};
function status(value:string):Conversation["status"]{return value==="cancelled"?"completed":["running","pending","awaiting_input","completed","error","failed"].includes(value)?value as Conversation["status"]:"idle";}
/** Business QA transport. The host supplies its purpose-scoped store and the
 * private runtime supplies ownership/knowledge; no product login or agent list. */
export default function EnterpriseQaConversation({preview=false,messageProjection,conversationFooter,knowledgeEditingBlocked,..._props}:BrandHomeProps&{preview?:boolean}) {
 const context=useConversation();const ref=useRef(context);ref.current=context;
 const [prompt,setPrompt]=useState("");const [files,setFiles]=useState<File[]>([]);const [sending,setSending]=useState(false);const [notice,setNotice]=useState("");const lock=useRef(false);
 const active=context.activeConversation;
 const request=useCallback(async<T,>(path:string,init:RequestInit={}):Promise<T>=>{const rest=brandHost().captureWorkspaceRestOperation();const response=await rest.fetch(path,{credentials:"same-origin",...init});const value=await response.json();rest.assertActive();if(!response.ok)throw new Error(value.error?.message??value.message??value.error??`请求失败 (${response.status})`);return value;},[]);
 useEffect(() => {
  if (preview || !active?.taskId || active.purpose !== "enterprise_qa" || isQaTaskTerminal(active.status)) return;
  const taskId = active.taskId;
  const conversationId = active.id;
  return startEnterpriseQaPolling({
   read: () => request<QaTask>(`/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}`),
   refresh: async () => { if (ref.current.activeConversation?.id === conversationId) await ref.current.refreshConversations(); },
   onError: error => setNotice(error instanceof Error ? error.message : String(error)),
  });
 }, [preview, active?.id, active?.taskId, active?.status, request]);
 const send=useCallback(async(text:string,attachments:File[])=>{
  const conversation=ref.current.activeConversation;if(lock.current||!conversation)return;
  if(preview){setNotice("本地预览不调用企业问答供应商；请在开发子域名验证真实回答与引用。");return;}
  if(conversation.purpose!=="enterprise_qa")throw new Error("请先选择企业问答任务");
  lock.current=true;setSending(true);setNotice("");
  try{
   let pending=conversation.messages.findLast(message=>message.role==="user"&&message.generalChatDispatch);
   if(pending&&pending.content!==text)throw new Error("上一条消息尚未确认，请先重试该消息。");
   if(!pending){
    if(attachments.length>32||attachments.some(file=>file.size>64*1024*1024))throw new Error("附件最多32份，每份不超过64MB。");
    const uploaded=[];for(const file of attachments){const value=await request<{localAssetId:string;filename:string;expiresAt:number}>("/api/frontmind/v2/assets",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-FrontMind-Mime":file.type||"application/octet-stream","X-FrontMind-Filename":encodeURIComponent(file.name),"X-FrontMind-Size":String(file.size)},body:file});uploaded.push(value);}
    const clientRequestId=crypto.randomUUID();const dispatch:GeneralChatDispatchMetadata={schemaVersion:1,kind:"pending_user",clientRequestId,providerPrompt:text,localAssetIds:[...new Set(uploaded.map(file=>file.localAssetId))].sort(),localTaskId:conversation.taskId??null,modelProfile:conversation.taskId?null:"frontmind-base",...(!conversation.taskId?{purpose:"enterprise_qa"}:{} )};
    pending={id:clientRequestId,role:"user",content:text,timestamp:Date.now(),attachments:uploaded.map(file=>({id:file.localAssetId,type:"file" as const,name:file.filename,fileId:file.localAssetId,expiresAt:file.expiresAt})),generalChatDispatch:dispatch};
    ref.current.addMessage(conversation.id,pending);
   }
   if(!await ref.current.flushConversation(conversation.id))throw new Error("输入尚未保存，已保留本次消息，请重试。");
   const dispatch=pending.generalChatDispatch!;
   const result=await request<QaTask>(`/api/frontmind/v2/tasks${dispatch.localTaskId?`/${encodeURIComponent(dispatch.localTaskId)}/messages`:""}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conversationId:conversation.id,clientRequestId:dispatch.clientRequestId,prompt:dispatch.providerPrompt,localAssetIds:dispatch.localAssetIds,...(!dispatch.localTaskId?{modelProfile:dispatch.modelProfile,purpose:"enterprise_qa"}:{})})});
   if(result.purpose&&result.purpose!=="enterprise_qa")throw new Error("返回任务不属于企业问答");
   ref.current.updateStatus(conversation.id,status(result.status),{taskId:result.id,previousResponseId:result.id,executionKind:"general_chat_v2"});
   ref.current.settleGeneralChatDispatch(conversation.id,pending.id);
   if(!await ref.current.flushConversation(conversation.id))throw new Error("回答已开始，任务绑定尚未保存；请刷新恢复原任务。");
   setPrompt("");setFiles([]);await ref.current.refreshConversations();
  }catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{lock.current=false;setSending(false);}
 },[preview,request]);
 const busy=sending||knowledgeEditingBlocked||["running","pending"].includes(active?.status??"");
 return <section className="brand-qa-chat" aria-label="企业问答对话">{notice&&<p role="alert" className="brand-qa-notice">{notice}</p>}<div className="brand-qa-messages">{active?.messages.map(original=>{const message=messageProjection?.(original)??original;return <article key={message.id} className={`brand-qa-message brand-qa-message--${message.role}`}><BrandConversationMessage message={message} allowCopy={!busy}>{message.outputFiles?.filter(file=>/^\/api\/frontmind\/v2\/artifacts\/[^/]+\/content(?:\?|$)/.test(file.fileUrl)).map(file=><a className="brand-qa-output" key={file.fileUrl} href={file.fileUrl} target="_blank" rel="noreferrer">{file.fileName}</a>)}{message.generalChatDispatch&&<button type="button" disabled={sending} onClick={()=>void send(message.content,[])}>重试本次提交</button>}</BrandConversationMessage></article>})}</div>{conversationFooter}<form onSubmit={event=>{event.preventDefault();if(prompt.trim()&&!busy)void send(prompt,files);}}><textarea aria-label="企业问答问题" value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="输入关于本企业的问题；回答会依据本工作区已发布的企业知识" disabled={busy||!active}/><input type="file" aria-label="企业问答附件" multiple disabled={busy||!active} onChange={event=>setFiles(Array.from(event.target.files??[]))}/><div><button type="submit" disabled={busy||!active||!prompt.trim()}>发送问题</button>{active?.taskId&&["running","pending"].includes(active.status)&&<button type="button" onClick={()=>void request(`/api/frontmind/v2/tasks/${encodeURIComponent(active.taskId!)}/stop`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(()=>ref.current.refreshConversations()).catch(error=>setNotice(error.message))}>停止当前执行</button>}</div></form></section>;
}
