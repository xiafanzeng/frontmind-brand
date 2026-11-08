import {KnowledgeOptimizationContext} from "../module/client/components/KnowledgeOptimizationContext";
import type {IntentReceipt} from "../module/contracts/intent-workbench";
import {liveIntentWorkbenchApi} from "../module/client/dashboard/intent-workbench-api";
import {projectPreviewKnowledge} from "./knowledge-preview";
import {createPreviewAnswerVisual} from "./response-logic-preview-visual";
import {ModuleShell} from "@frontmind/module-ui/dashboard/ModuleShell";
import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useLocation,useSearch} from 'wouter';
import {Toaster} from 'sonner';
import {BRAND_MODULE_LABEL,BRAND_MODULE_SIDEBAR_LABEL} from '../module/client/module-label';
import ModuleWorkspace,{type ModuleContext} from '../module/client/ModuleWorkspace';
import {EnterpriseRagPreview} from '../module/client/dashboard/ai-website-preview/EnterpriseRagPreview';
import {loadRagPreviewFixtures} from '../module/client/dashboard/ai-website-preview/rag-preview-fixture-loader';
import {SimplifiedWebsiteBuilderPreview,normalizeWebsiteBuildStep,normalizeWebsiteDesignSection,type BuildStep} from '../module/client/dashboard/ai-website-preview/SimplifiedWebsiteBuilderPreview';
import type {WebsiteEvaluationAuthorityView,WebsiteEvaluationManualReviewInput,WebsiteEvaluationReviewView} from '../module/client/dashboard/ai-website-preview/WebsiteEvaluationWorkspace';
import {configureBrandApiHooks} from '../module/client/api-hooks';
import {KnowledgeBaseUploadProvider} from '../module/client/lib/knowledge-base-upload-manager';
import {brandHost} from '../module/client/host';
import {createBrandApi,liveRpc} from './api';
import {installBrandHost,liveConversations} from './host';
import {createPreviewRpc,previewConversations} from './preview';
import {previewKnowledgeProgress,previewKnowledgeSnapshot} from './preview-data';
import {createIntentPreviewApi} from './intent-preview';
import {
 createNextWebsiteEvaluationPreviewRevision,
 createWebsiteEvaluationPreview,
 resolveWebsiteEvaluationPreviewReport,
 resolveWebsiteEvaluationPreviewSelection,
 WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS,
 WEBSITE_EVALUATION_PREVIEW_STAGES,
 type WebsiteEvaluationPreviewStage,
} from './website-evaluation-preview';
import {resolveStandaloneBrandPage,standaloneBrandViewUrl,standaloneBrandPages as pages,standaloneRagReportUrl,resolveStandaloneRagReport} from './routes';
import frontmindWordmarkUrl from '../vendor/module-ui/src/assets/frontmind-wordmark.svg';
import type {RagReportUrlBuilder} from '../module/client/dashboard/ai-website-preview/rag-report-navigation';
import './standalone.css';
import './preview.css';
const RagEvaluationReportPage=lazy(()=>import('../module/client/dashboard/ai-website-preview/RagEvaluationReportPage'));
const websiteReturnLabels:Record<BuildStep,string>={template:'选择模板',design:'网站设计',evaluation:'建设评估'};
const brandModule={id:'brand',label:BRAND_MODULE_LABEL,color:'#16794f'};
const intentModule={id:'intent',label:'意图优化',color:'#7545a0'};
const extensionsModule={id:'extensions',label:'AI 专用官网',color:'#5e6174'};
const noPreviewExamples:ReadonlySet<string>=new Set();
// 词库与问题优化归入意图优化；其他独立模块仅在本地 preview 展示。
const progressModule={id:'progress',label:'进度监控',color:'#b45309',views:[]};
const contentModule={id:'content',label:'内容制作',color:'#0e7490',views:[]};
const publishModule={id:'publish',label:'媒体发布',color:'#be123c',views:[]};
function localReviewDispositionLabel(disposition:WebsiteEvaluationManualReviewInput['disposition']){
 return disposition==='agree'?'认可计划':disposition==='reject'?'不采纳':'需要调整';
}
function useWebsiteEvaluationPreview(search:string,enabled:boolean):{
 evaluation:WebsiteEvaluationAuthorityView|undefined;
 submitReview:((input:WebsiteEvaluationManualReviewInput)=>Promise<void>)|undefined;
 reevaluate:(()=>Promise<void>)|undefined;
}{
 const selection=useMemo(()=>resolveWebsiteEvaluationPreviewSelection(search),[search]);
 const [flowStage,setFlowStage]=useState<WebsiteEvaluationPreviewStage>(()=>selection.stage);
 const [generation,setGeneration]=useState(0);
 const [reducedMotion,setReducedMotion]=useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
 const [addedReviews,setAddedReviews]=useState<WebsiteEvaluationReviewView[]>([]);
 const reviewSequence=useRef(0);
 const generationRef=useRef(0);
 const reevaluationTimersRef=useRef<number[]>([]);
 useEffect(()=>{const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;const update=()=>setReducedMotion(media.matches);update();media.addEventListener?.('change',update);return()=>media.removeEventListener?.('change',update);},[]);
 useEffect(()=>{
  if(!enabled)return;
  if(!selection.flow){setFlowStage(selection.stage);return;}
  if(reducedMotion){setFlowStage('completed');return;}
  setFlowStage('queued');
  const timers=WEBSITE_EVALUATION_PREVIEW_STAGES.slice(1).map((stage,index)=>window.setTimeout(()=>setFlowStage(stage),WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS*(index+1)));
  return()=>timers.forEach(timer=>window.clearTimeout(timer));
 },[enabled,reducedMotion,selection.flow,selection.stage]);
 useEffect(()=>()=>{
  reevaluationTimersRef.current.forEach(timer=>window.clearTimeout(timer));
  reevaluationTimersRef.current=[];
 },[]);
 const stage=selection.flow?flowStage:selection.stage;
 const activeStage=generation>0?flowStage:stage;
 const baseEvaluation=useMemo(()=>enabled?createWebsiteEvaluationPreview(activeStage,generation):undefined,[activeStage,enabled,generation]);
 useEffect(()=>{setAddedReviews([]);reviewSequence.current=0;},[baseEvaluation?.reportId]);
 const submitReview=useCallback(async(input:WebsiteEvaluationManualReviewInput)=>{
  if(!baseEvaluation?.reportId)throw new Error('当前本地预览没有可评审的报告。');
  reviewSequence.current+=1;
  const review:WebsiteEvaluationReviewView={
   reviewId:`review-local-session-${reviewSequence.current}`,
   reviewerLabel:'本地产品复核',
   disposition:input.disposition,
   dispositionLabel:localReviewDispositionLabel(input.disposition),
   repairItem:input.repairItem,
   note:input.note,
   createdAt:new Date().toISOString(),
  };
  setAddedReviews(current=>[...current,review]);
 },[baseEvaluation?.reportId]);
 const reevaluate=useCallback(async()=>{
  if(!enabled)return;
  reevaluationTimersRef.current.forEach(timer=>window.clearTimeout(timer));
  reevaluationTimersRef.current=[];
  const revision=createNextWebsiteEvaluationPreviewRevision(generationRef.current);
  generationRef.current=revision.generation;
  setGeneration(revision.generation);
  setFlowStage('queued');
  if(reducedMotion){setFlowStage('completed');return;}
  for(const nextStage of WEBSITE_EVALUATION_PREVIEW_STAGES.slice(1)){
   await new Promise<void>(resolve=>{
    const timer=window.setTimeout(()=>{
     reevaluationTimersRef.current=reevaluationTimersRef.current.filter(item=>item!==timer);
     setFlowStage(nextStage);
     resolve();
    },WEBSITE_EVALUATION_PREVIEW_FLOW_INTERVAL_MS);
    reevaluationTimersRef.current.push(timer);
   });
  }
 },[enabled,reducedMotion]);
 const evaluation=useMemo(()=>baseEvaluation?{
  ...baseEvaluation,
  reviews:[...(baseEvaluation.reviews??[]),...addedReviews],
 }:undefined,[addedReviews,baseEvaluation]);
 return {
  evaluation,
  submitReview:baseEvaluation?.status==='completed'?submitReview:undefined,
  reevaluate:enabled?reevaluate:undefined,
 };
}
function Runtime({context,preview}:{context:ModuleContext;preview:boolean}){
 const runtime=useMemo(()=>{const adapter=createBrandApi(preview?createPreviewRpc(context.workspace.id):liveRpc);configureBrandApiHooks(adapter.api);installBrandHost(context,preview?previewConversations():liveConversations,preview);return adapter;},[context,preview]);
 const intentApi=useMemo(()=>preview?createIntentPreviewApi(context.workspace.id):undefined,[preview,context.workspace.id]);
 const answerVisual=useMemo(()=>preview?createPreviewAnswerVisual(context.workspace.id):undefined,[preview,context.workspace.id]);
 const [path,navigate]=useLocation();const search=useSearch();const params=new URLSearchParams(search);
 const websiteEvaluationPreview=useWebsiteEvaluationPreview(search,preview);
 const websiteEvaluation=websiteEvaluationPreview.evaluation;
 const previewWebsiteEvaluationReport=preview?resolveWebsiteEvaluationPreviewReport(params.get('websiteReport')):undefined;
 const requestedRaw=params.get('view')??(path==='/'?'knowledge':path.slice(1));
 const requestedExample=params.get('example');
 const [previewExampleIds,setPreviewExampleIds]=useState<ReadonlySet<string>|null>(preview?null:noPreviewExamples);
 useEffect(()=>{if(!preview)return;let active=true;void loadRagPreviewFixtures().then(fixtures=>{if(active)setPreviewExampleIds(new Set(fixtures.cases.map(item=>item.id)));},()=>{if(active)setPreviewExampleIds(noPreviewExamples);});return()=>{active=false;};},[preview]);
 const requested=resolveStandaloneBrandPage(requestedRaw);
 const requestedWebsiteStep=params.get('step');const requestedReturnStep=params.get('returnStep');const requestedWebsiteSection=params.get('section');
 const websiteStep=normalizeWebsiteBuildStep(requestedWebsiteStep)??'template';const websiteSection=normalizeWebsiteDesignSection(requestedWebsiteSection);
 const returnStep=normalizeWebsiteBuildStep(requestedReturnStep);
 const page=requested??'knowledge';
 const [knowledgeReceipt,setKnowledgeReceipt]=useState<{scope:string;receipt:IntentReceipt}|undefined>();
 const requestedReceipt=params.get('intentReceipt');
 const knowledgeScope=`${context.workspace.ownerUserId}:${context.workspace.id}`;
 useEffect(()=>{let active=true;if(page==='knowledge'&&requestedReceipt)void (intentApi??liveIntentWorkbenchApi).observe().then(workspace=>{const receipt=workspace.state.receipts.find(receipt=>receipt.id===requestedReceipt);if(active)setKnowledgeReceipt(receipt?{scope:knowledgeScope,receipt}:undefined);}).catch(()=>{});return()=>{active=false;};},[page,requestedReceipt,intentApi,knowledgeScope]);
 const [previewKnowledgeData,setPreviewKnowledgeData]=useState({progress:previewKnowledgeProgress,snapshot:previewKnowledgeSnapshot as import('../module/client/components/KnowledgeBaseViewer').KnowledgeSnapshotView});
 useEffect(()=>{let active=true;if(preview&&page==='knowledge'&&intentApi)void intentApi.observe().then(workspace=>{if(active)setPreviewKnowledgeData(projectPreviewKnowledge(workspace));});return()=>{active=false;};},[preview,page,intentApi]);
 useEffect(()=>{if(!requested)navigate('/',{replace:true});else if(requestedRaw!==requested){params.set('view',requested);navigate(`/?${params.toString()}`,{replace:true});}},[navigate,requested,requestedRaw,search]);
 useEffect(()=>{if(page!=='website')return;if(requestedWebsiteStep){const normalized=normalizeWebsiteBuildStep(requestedWebsiteStep);if(!normalized){navigate('/?view=website',{replace:true});return;}if(normalized!==requestedWebsiteStep){const section=requestedWebsiteStep==='structure'?'site':requestedWebsiteStep==='assistant'?'assistant':null;navigate(normalized==='template'?'/?view=website':`/?view=website&step=${normalized}${section?`&section=${section}`:''}`,{replace:true});return;}}if(requestedWebsiteSection&&!normalizeWebsiteDesignSection(requestedWebsiteSection)){const next=new URLSearchParams(search);next.delete('section');navigate(`/?${next.toString()}`,{replace:true});}},[navigate,page,requestedWebsiteStep,requestedWebsiteSection,search]);
 useEffect(()=>{if(!requestedReturnStep)return;const next=new URLSearchParams(search);const normalized=normalizeWebsiteBuildStep(requestedReturnStep);if(!normalized)next.delete('returnStep');else if(normalized!==requestedReturnStep)next.set('returnStep',normalized);else return;navigate(`/?${next.toString()}`,{replace:true});},[navigate,requestedReturnStep,search]);
 useEffect(()=>{document.querySelector<HTMLElement>('.agent-workbench-shell__main-content')?.scrollTo({top:0,left:0});},[page]);
 const dashboard=runtime.dashboard.useQuery(undefined,{enabled:page==='keywords'||page==='intent',refetchOnWindowFocus:true});const knowledge=runtime.api.workspace.knowledge.useQuery(undefined,{enabled:page==='keywords'||page==='intent',refetchOnWindowFocus:true});
 const selectView=(id:string)=>brandHost().requestWorkspaceNavigation(()=>navigate(standaloneBrandViewUrl(id,window.location.search)));
 const brandPages=pages.filter(([id])=>id==='diagnostics'||id==='knowledge');
 const intentPages=pages.filter(([id])=>id==='keywords'||id==='intent');
 const extensionPages=pages.filter(([id])=>!['reports','diagnostics','knowledge','keywords','intent','response-logic'].includes(id));
 const selectedModule=page==='keywords'||page==='intent'||page==='response-logic'?intentModule:page==='knowledge'||page==='diagnostics'?brandModule:extensionsModule;
 const selectedPages=selectedModule.id==='intent'?intentPages:selectedModule.id==='brand'?brandPages:extensionPages;
 const reportRoute=resolveStandaloneRagReport(search,context.workspace.id,previewExampleIds??noPreviewExamples);
 const buildReportUrl:RagReportUrlBuilder=(section,coordinate,exampleId)=>brandHost().projectWorkspaceUrl(standaloneRagReportUrl(section,context.workspace.id,coordinate,preview?exampleId:undefined));
 if(preview&&requestedExample!==null&&previewExampleIds===null)return <p role="status">正在打开预览评估记录…</p>;
 if(reportRoute)return <Suspense fallback={<p role="status">正在打开评估说明与记录…</p>}><RagEvaluationReportPage storageScopeKey={preview?'preview':`live:${context.workspace.ownerUserId}:${context.workspace.id}`} preview={preview} coordinate={reportRoute.coordinate} exampleId={preview?reportRoute.exampleId:undefined} contextError={reportRoute.error} returnUrl={brandHost().projectWorkspaceUrl('/?view=enterprise-qa')} brandMarkSrc={frontmindWordmarkUrl}/></Suspense>;
 return <KnowledgeOptimizationContext.Provider value={page==="knowledge"&&knowledgeReceipt?.scope===knowledgeScope&&knowledgeReceipt.receipt.id===requestedReceipt?knowledgeReceipt.receipt:undefined}><ModuleShell module={selectedModule} navigationModules={[{...brandModule,label:BRAND_MODULE_SIDEBAR_LABEL,views:brandPages.map(([id,label])=>({id,label}))},{...intentModule,views:intentPages.map(([id,label])=>({id,label}))},...(preview?[progressModule,contentModule,publishModule]:[]),{...extensionsModule,views:extensionPages.map(([id,label])=>({id,label}))}]} views={selectedPages.map(([id,label])=>({id,label}))} activeView={page==='response-logic'?'intent':page} onSelectView={selectView} preview={preview} showViewTabs={page!=='knowledge'}><div className={`brand-page brand-page--${page}`}>
 <ModuleWorkspace context={context} page={page} preview={preview} responseLogicVisual={answerVisual} onOpenKnowledge={(nodeId,receipt)=>brandHost().requestWorkspaceNavigation(()=>{if(receipt)setKnowledgeReceipt({scope:knowledgeScope,receipt});navigate(`/?view=knowledge${nodeId?`&knowledgeNode=${encodeURIComponent(nodeId)}`:""}${receipt?`&intentReceipt=${encodeURIComponent(receipt.id)}`:""}`);})} intentApi={intentApi} onIntentSectionChange={section=>navigate(`/?view=${section==='universe'?'keywords':'intent'}`)} onEnterResponseLogic={()=>navigate('/?view=response-logic')} onResponseLogicBack={()=>navigate('/?view=intent')} keywordData={{tables:dashboard.data?.payload?.keywordTables??[],revision:dashboard.data?.revision??null,loading:dashboard.isLoading,error:dashboard.error,knowledgePublished:Boolean(knowledge.data?.snapshot)}} previewKnowledge={previewKnowledgeData} previewWebsiteEvaluationReport={previewWebsiteEvaluationReport} previewQa={preview?<EnterpriseRagPreview storageScopeKey="preview" buildReportUrl={buildReportUrl} onOpenWebsite={()=>navigate(returnStep&&returnStep!=='template'?`/?view=website&step=${returnStep}`:'/?view=website')} onOpenWebsiteAssistant={()=>navigate('/?view=website&step=design&section=assistant')} websiteEntryLabel={returnStep?`返回网站建设的${websiteReturnLabels[returnStep]}`:'开始网站建设'}/>:undefined} previewSiteOps={preview?<SimplifiedWebsiteBuilderPreview storageScope="preview" initialStep={websiteStep} initialSection={websiteSection} websiteEvaluation={websiteEvaluation} onReevaluateWebsiteEvaluation={websiteEvaluationPreview.reevaluate} onSubmitWebsiteEvaluationReview={websiteEvaluationPreview.submitReview} onOpenRag={()=>navigate(`/?view=enterprise-qa&returnStep=${websiteStep}`)} onStepChange={step=>navigate(step==='template'?'/?view=website':`/?view=website&step=${step}`,{replace:true})}/>:undefined} enterpriseRagNavigation={{buildReportUrl,onOpenWebsite:()=>navigate(returnStep&&returnStep!=='template'?`/?view=website&step=${returnStep}`:'/?view=website'),onOpenWebsiteAssistant:()=>navigate('/?view=website&step=design&section=assistant'),websiteEntryLabel:returnStep?`返回网站建设的${websiteReturnLabels[returnStep]}`:'开始网站建设'}} websiteBuilderNavigation={{initialStep:websiteStep,initialSection:websiteSection,onOpenRag:()=>navigate(`/?view=enterprise-qa&returnStep=${websiteStep}`),onStepChange:step=>navigate(step==='template'?'/?view=website':`/?view=website&step=${step}`,{replace:true})}}/>
 </div><Toaster richColors/></ModuleShell></KnowledgeOptimizationContext.Provider>;
}
export default function App({preview=false}:{preview?:boolean}){
 const [context,setContext]=useState<ModuleContext|null>(()=>preview?{module:'brand',workspace:{id:'brand-local-preview',ownerUserId:0},capabilities:['brand'],marketEdition:'cn'}:null);const [error,setError]=useState('');
 useEffect(()=>{if(preview)return;const abort=new AbortController();void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('无法进入品牌工作区，请重新通过开发门禁');return response.json();}).then(value=>{if(value.module!=='brand'||!value.workspace?.id)throw new Error('品牌运行上下文不匹配');setContext(value);}).catch(error=>{if(!abort.signal.aborted)setError(error.message);});return()=>abort.abort();},[preview]);
 return <div className={`brand-standalone${preview?' brand-standalone--preview':''}`}>{error?<p role="alert">{error}</p>:context?<KnowledgeBaseUploadProvider scopeKey={`${context.workspace.id}:${context.workspace.ownerUserId}`}><Runtime context={context} preview={preview}/></KnowledgeBaseUploadProvider>:<p role="status">正在进入品牌工作区…</p>}</div>;
}
