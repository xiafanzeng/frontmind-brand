import {useEffect,useMemo,useState} from 'react';
import {useLocation,useSearch} from 'wouter';
import {Toaster} from 'sonner';
import {BRAND_MODULE_LABEL} from '../module/client/module-label';
import ModuleWorkspace,{type BrandPage,type ModuleContext} from '../module/client/ModuleWorkspace';
import {configureBrandApiHooks} from '../module/client/api-hooks';
import {brandHost} from '../module/client/host';
import EnterpriseQaConversation from '../module/client/EnterpriseQaConversation';
import {createBrandApi,liveRpc} from './api';
import {installBrandHost,liveConversations,ConversationPurposeProvider} from './host';
import {previewRpc,previewConversations,SiteOpsPreview} from './preview';
import {previewKnowledgeProgress,previewKnowledgeSnapshot} from './preview-data';
import './standalone.css';
const pages:Array<[BrandPage,string]>=[['knowledge','智能知识库'],['keywords','品牌词库'],['enterprise-qa','企业问答'],['website','AI 官网'],['website-settings','官网设置']];
function Runtime({context,preview}:{context:ModuleContext;preview:boolean}){
 const runtime=useMemo(()=>{const adapter=createBrandApi(preview?previewRpc:liveRpc);configureBrandApiHooks(adapter.api);installBrandHost(context,preview?previewConversations():liveConversations,preview);return adapter;},[context,preview]);
 const [path,navigate]=useLocation();const search=useSearch();const requested=new URLSearchParams(search).get('view')??(path==='/'?'knowledge':path.slice(1));const page=pages.some(([id])=>id===requested)?requested as BrandPage:'knowledge';
 useEffect(()=>{if(!pages.some(([id])=>id===requested))navigate('/',{replace:true});},[requested,navigate]);
 const dashboard=runtime.dashboard.useQuery(undefined,{enabled:page==='keywords',refetchOnWindowFocus:true});const knowledge=runtime.api.workspace.knowledge.useQuery(undefined,{enabled:page==='keywords',refetchOnWindowFocus:true});
 return <><header className="brand-header"><strong>{BRAND_MODULE_LABEL}</strong><nav aria-label="品牌模块页面">{pages.map(([id,label])=><button key={id} aria-current={id===page?'page':undefined} onClick={()=>brandHost().requestWorkspaceNavigation(()=>navigate(`/?view=${id}`))}>{label}</button>)}</nav></header>{preview&&<aside className="brand-preview-banner">本地预览 · 合成资料与业务状态；不连接线上数据库、不调用真实供应商。真实业务在开发子域名验收。</aside>}<main className={`brand-page brand-page--${page}`}><ModuleWorkspace context={context} page={page} preview={preview} keywordData={{tables:dashboard.data?.payload?.keywordTables??[],revision:dashboard.data?.revision??null,loading:dashboard.isLoading,error:dashboard.error,knowledgePublished:Boolean(knowledge.data?.snapshot)}} previewKnowledge={{progress:previewKnowledgeProgress,snapshot:previewKnowledgeSnapshot}} previewQa={<ConversationPurposeProvider><EnterpriseQaConversation preview/></ConversationPurposeProvider>} previewSiteOps={<SiteOpsPreview/>}/></main><Toaster richColors/></>;
}
export default function App({preview=false}:{preview?:boolean}){
 const [context,setContext]=useState<ModuleContext|null>(()=>preview?{module:'brand',workspace:{id:'brand-local-preview',ownerUserId:0},capabilities:['brand'],marketEdition:'cn'}:null);const [error,setError]=useState('');
 useEffect(()=>{if(preview)return;const abort=new AbortController();void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('无法进入品牌工作区，请重新通过开发门禁');return response.json();}).then(value=>{if(value.module!=='brand'||!value.workspace?.id)throw new Error('品牌运行上下文不匹配');setContext(value);}).catch(error=>{if(!abort.signal.aborted)setError(error.message);});return()=>abort.abort();},[preview]);
 return <div className="brand-standalone">{error?<p role="alert">{error}</p>:context?<Runtime context={context} preview={preview}/>:<p role="status">正在进入品牌工作区…</p>}</div>;
}
