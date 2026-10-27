import {ModuleShell} from "@frontmind/module-ui/dashboard/ModuleShell";
import {useEffect,useMemo,useState} from 'react';
import {useLocation,useSearch} from 'wouter';
import {Toaster} from 'sonner';
import {BRAND_MODULE_LABEL,BRAND_MODULE_SIDEBAR_LABEL} from '../module/client/module-label';
import ModuleWorkspace,{type ModuleContext} from '../module/client/ModuleWorkspace';
import {EnterpriseRagPreview} from '../module/client/dashboard/ai-website-preview/EnterpriseRagPreview';
import {SimplifiedWebsiteBuilderPreview,type BuildStep} from '../module/client/dashboard/ai-website-preview/SimplifiedWebsiteBuilderPreview';
import {configureBrandApiHooks} from '../module/client/api-hooks';
import {KnowledgeBaseUploadProvider} from '../module/client/lib/knowledge-base-upload-manager';
import {brandHost} from '../module/client/host';
import {createBrandApi,liveRpc} from './api';
import {installBrandHost,liveConversations} from './host';
import {previewRpc,previewConversations} from './preview';
import {previewKnowledgeProgress,previewKnowledgeSnapshot} from './preview-data';
import {createIntentPreviewApi} from './intent-preview';
import {resolveStandaloneBrandPage,standaloneBrandPages as pages} from './routes';
import './standalone.css';
import './preview.css';
const websiteSteps:BuildStep[]=['template','structure','assistant','evaluation'];
const websiteReturnLabels:Record<BuildStep,string>={template:'模板选择',structure:'结构确认',assistant:'AI 助手',evaluation:'整体评估'};
const brandModule={id:'brand',label:BRAND_MODULE_LABEL,color:'#16794f'};
const intentModule={id:'intent',label:'意图优化',color:'#7545a0'};
const extensionsModule={id:'extensions',label:'AI专用官网',color:'#5e6174'};
// 词库与问题优化归入意图优化；其他独立模块仅在本地 preview 展示。
const progressModule={id:'progress',label:'进度监控',color:'#b45309',views:[]};
const contentModule={id:'content',label:'内容制作',color:'#0e7490',views:[]};
const publishModule={id:'publish',label:'媒体发布',color:'#be123c',views:[]};
function Runtime({context,preview}:{context:ModuleContext;preview:boolean}){
 const runtime=useMemo(()=>{const adapter=createBrandApi(preview?previewRpc:liveRpc);configureBrandApiHooks(adapter.api);installBrandHost(context,preview?previewConversations():liveConversations,preview);return adapter;},[context,preview]);
 const intentApi=useMemo(()=>preview?createIntentPreviewApi(context.workspace.id):undefined,[preview,context.workspace.id]);
 const [path,navigate]=useLocation();const search=useSearch();const params=new URLSearchParams(search);
 const requestedRaw=params.get('view')??(path==='/'?'reports':path.slice(1));
 const requested=resolveStandaloneBrandPage(requestedRaw);
 const requestedWebsiteStep=params.get('step');const requestedReturnStep=params.get('returnStep');
 const websiteStep=websiteSteps.includes(requestedWebsiteStep as BuildStep)?(requestedWebsiteStep as BuildStep):'template';
 const returnStep=websiteSteps.includes(requestedReturnStep as BuildStep)?(requestedReturnStep as BuildStep):null;
 const page=requested??'knowledge';
 useEffect(()=>{if(!requested)navigate('/',{replace:true});else if(requestedRaw!==requested){params.set('view',requested);navigate(`/?${params.toString()}`,{replace:true});}},[navigate,requested,requestedRaw,search]);
 useEffect(()=>{if(page==='website'&&requestedWebsiteStep&&!websiteSteps.includes(requestedWebsiteStep as BuildStep))navigate('/?view=website',{replace:true});},[navigate,page,requestedWebsiteStep]);
 useEffect(()=>{document.querySelector<HTMLElement>('.agent-workbench-shell__main-content')?.scrollTo({top:0,left:0});},[page]);
 const dashboard=runtime.dashboard.useQuery(undefined,{enabled:page==='keywords'||page==='intent',refetchOnWindowFocus:true});const knowledge=runtime.api.workspace.knowledge.useQuery(undefined,{enabled:page==='keywords'||page==='intent',refetchOnWindowFocus:true});
 const brandPages=pages.filter(([id])=>id==='reports'||id==='knowledge');
 const intentPages=pages.filter(([id])=>id==='keywords'||id==='intent');
 const extensionPages=pages.filter(([id])=>!['reports','knowledge','keywords','intent','response-logic'].includes(id));
 const selectedModule=page==='keywords'||page==='intent'||page==='response-logic'?intentModule:page==='knowledge'||page==='reports'?brandModule:extensionsModule;
 const selectedPages=selectedModule.id==='intent'?intentPages:selectedModule.id==='brand'?brandPages:extensionPages;
 return <ModuleShell module={selectedModule} navigationModules={[{...brandModule,label:BRAND_MODULE_SIDEBAR_LABEL,views:brandPages.map(([id,label])=>({id,label}))},{...intentModule,views:intentPages.map(([id,label])=>({id,label}))},...(preview?[progressModule,contentModule,publishModule]:[]),{...extensionsModule,views:extensionPages.map(([id,label])=>({id,label}))}]} views={selectedPages.map(([id,label])=>({id,label}))} activeView={page} onSelectView={id=>brandHost().requestWorkspaceNavigation(()=>navigate(`/?view=${id}`))} preview={preview} showViewTabs={page!=='knowledge'}><div className={`brand-page brand-page--${page}`}>
 <ModuleWorkspace context={context} page={page} preview={preview} intentApi={intentApi} onIntentSectionChange={section=>navigate(`/?view=${section==='universe'?'keywords':'intent'}`)} onEnterResponseLogic={()=>navigate('/?view=response-logic')} onResponseLogicBack={()=>navigate('/?view=intent')} keywordData={{tables:dashboard.data?.payload?.keywordTables??[],revision:dashboard.data?.revision??null,loading:dashboard.isLoading,error:dashboard.error,knowledgePublished:Boolean(knowledge.data?.snapshot)}} previewKnowledge={{progress:previewKnowledgeProgress,snapshot:previewKnowledgeSnapshot}} previewQa={preview?<EnterpriseRagPreview storageScopeKey="preview" onOpenWebsite={()=>navigate(returnStep&&returnStep!=='template'?`/?view=website&step=${returnStep}`:'/?view=website')} onOpenWebsiteAssistant={()=>navigate('/?view=website&step=assistant')} websiteEntryLabel={returnStep?`返回网站建设的${websiteReturnLabels[returnStep]}`:'开始网站建设'}/>:undefined} previewSiteOps={preview?<SimplifiedWebsiteBuilderPreview storageScope="preview" initialStep={websiteStep} onOpenRag={()=>navigate(`/?view=enterprise-qa&returnStep=${websiteStep}`)} onStepChange={step=>navigate(step==='template'?'/?view=website':`/?view=website&step=${step}`,{replace:true})}/>:undefined} enterpriseRagNavigation={{onOpenWebsite:()=>navigate(returnStep&&returnStep!=='template'?`/?view=website&step=${returnStep}`:'/?view=website'),onOpenWebsiteAssistant:()=>navigate('/?view=website&step=assistant'),websiteEntryLabel:returnStep?`返回网站建设的${websiteReturnLabels[returnStep]}`:'开始网站建设'}} websiteBuilderNavigation={{initialStep:websiteStep,onOpenRag:()=>navigate(`/?view=enterprise-qa&returnStep=${websiteStep}`),onStepChange:step=>navigate(step==='template'?'/?view=website':`/?view=website&step=${step}`,{replace:true})}}/>
 </div><Toaster richColors/></ModuleShell>;
}
export default function App({preview=false}:{preview?:boolean}){
 const [context,setContext]=useState<ModuleContext|null>(()=>preview?{module:'brand',workspace:{id:'brand-local-preview',ownerUserId:0},capabilities:['brand'],marketEdition:'cn'}:null);const [error,setError]=useState('');
 useEffect(()=>{if(preview)return;const abort=new AbortController();void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('无法进入品牌工作区，请重新通过开发门禁');return response.json();}).then(value=>{if(value.module!=='brand'||!value.workspace?.id)throw new Error('品牌运行上下文不匹配');setContext(value);}).catch(error=>{if(!abort.signal.aborted)setError(error.message);});return()=>abort.abort();},[preview]);
 return <div className={`brand-standalone${preview?' brand-standalone--preview':''}`}>{error?<p role="alert">{error}</p>:context?<KnowledgeBaseUploadProvider scopeKey={`${context.workspace.id}:${context.workspace.ownerUserId}`}><Runtime context={context} preview={preview}/></KnowledgeBaseUploadProvider>:<p role="status">正在进入品牌工作区…</p>}</div>;
}
