import {ModuleShell} from "@frontmind/module-ui/dashboard/ModuleShell";
import {useEffect,useMemo,useState} from 'react';
import {useLocation,useSearch} from 'wouter';
import {Toaster} from 'sonner';
import {BRAND_MODULE_LABEL} from '../module/client/module-label';
import ModuleWorkspace,{type BrandPage,type ModuleContext} from '../module/client/ModuleWorkspace';
import {configureBrandApiHooks} from '../module/client/api-hooks';
import {KnowledgeBaseUploadProvider} from '../module/client/lib/knowledge-base-upload-manager';
import {brandHost} from '../module/client/host';
import EnterpriseQaConversation from '../module/client/EnterpriseQaConversation';
import {createBrandApi,liveRpc} from './api';
import {installBrandHost,liveConversations,ConversationPurposeProvider} from './host';
import {previewRpc,previewConversations,SiteOpsPreview} from './preview';
import {previewKnowledgeProgress,previewKnowledgeSnapshot} from './preview-data';
import './standalone.css';
const pages:Array<[BrandPage,string]>=[['knowledge','智能知识库'],['keywords','品牌全域词库'],['enterprise-qa','企业问答'],['website','网站管理'],['website-settings','内容分析与 AI 部件']];
const brandModule={id:'brand',label:BRAND_MODULE_LABEL,color:'#16794f'};
const extensionsModule={id:'extensions',label:'AI专用官网',color:'#5e6174'};
function Runtime({context,preview}:{context:ModuleContext;preview:boolean}){
 const runtime=useMemo(()=>{const adapter=createBrandApi(preview?previewRpc:liveRpc);configureBrandApiHooks(adapter.api);installBrandHost(context,preview?previewConversations():liveConversations,preview);return adapter;},[context,preview]);
 const [path,navigate]=useLocation();const search=useSearch();const requested=new URLSearchParams(search).get('view')??(path==='/'?'knowledge':path.slice(1));const page=pages.some(([id])=>id===requested)?requested as BrandPage:'knowledge';
 useEffect(()=>{if(!pages.some(([id])=>id===requested))navigate('/',{replace:true});},[requested,navigate]);
 const dashboard=runtime.dashboard.useQuery(undefined,{enabled:page==='keywords',refetchOnWindowFocus:true});const knowledge=runtime.api.workspace.knowledge.useQuery(undefined,{enabled:page==='keywords',refetchOnWindowFocus:true});
 const selectedModule=page==='knowledge'||page==='keywords'?brandModule:extensionsModule;
 const selectedPages=pages.filter(([id])=>(id==='knowledge'||id==='keywords')===(selectedModule.id==='brand'));
 return <ModuleShell module={selectedModule} navigationModules={[{...brandModule,views:pages.slice(0,2).map(([id,label])=>({id,label}))},{...extensionsModule,views:pages.slice(2).map(([id,label])=>({id,label}))}]} views={selectedPages.map(([id,label])=>({id,label}))} activeView={page} onSelectView={id=>brandHost().requestWorkspaceNavigation(()=>navigate(`/?view=${id}`))} preview={preview} showViewTabs={page==='enterprise-qa'?preview:page!=='knowledge'}><div className={`brand-page brand-page--${page}`}><ModuleWorkspace context={context} page={page} preview={preview} keywordData={{tables:dashboard.data?.payload?.keywordTables??[],revision:dashboard.data?.revision??null,loading:dashboard.isLoading,error:dashboard.error,knowledgePublished:Boolean(knowledge.data?.snapshot)}} previewKnowledge={{progress:previewKnowledgeProgress,snapshot:previewKnowledgeSnapshot}} previewQa={<ConversationPurposeProvider><EnterpriseQaConversation preview/></ConversationPurposeProvider>} previewSiteOps={<SiteOpsPreview/>}/></div><Toaster richColors/></ModuleShell>;
}
export default function App({preview=false}:{preview?:boolean}){
 const [context,setContext]=useState<ModuleContext|null>(()=>preview?{module:'brand',workspace:{id:'brand-local-preview',ownerUserId:0},capabilities:['brand'],marketEdition:'cn'}:null);const [error,setError]=useState('');
 useEffect(()=>{if(preview)return;const abort=new AbortController();void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('无法进入品牌工作区，请重新通过开发门禁');return response.json();}).then(value=>{if(value.module!=='brand'||!value.workspace?.id)throw new Error('品牌运行上下文不匹配');setContext(value);}).catch(error=>{if(!abort.signal.aborted)setError(error.message);});return()=>abort.abort();},[preview]);
 return <div className="brand-standalone">{error?<p role="alert">{error}</p>:context?<KnowledgeBaseUploadProvider scopeKey={`${context.workspace.id}:${context.workspace.ownerUserId}`}><Runtime context={context} preview={preview}/></KnowledgeBaseUploadProvider>:<p role="status">正在进入品牌工作区…</p>}</div>;
}
