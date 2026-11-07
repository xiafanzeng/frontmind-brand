import {KnowledgeOptimizationContext} from './components/KnowledgeOptimizationContext';
import type {IntentReceipt} from '../contracts/intent-workbench';
import {requestWorkspaceNavigation,projectWorkspaceUrl} from './host';
import {navigate} from 'wouter/use-browser-location';
import {useEffect,useState,useRef,useContext,type ReactNode} from 'react';
import EmbeddedKnowledgeBasePanel from './components/EmbeddedKnowledgeBasePanel';
import type {ManagedKeywordTable} from './dashboard/ManagedKeywordTables';
import EnterpriseRagWorkspace from './dashboard/EnterpriseRagWorkspace';
import ConnectedSimplifiedWebsiteBuilderPreview from './dashboard/ai-website-preview/ConnectedSimplifiedWebsiteBuilderPreview';
import type {BuildStep} from './dashboard/ai-website-preview/SimplifiedWebsiteBuilderPreview';
import KnowledgeFrontendSettings from './dashboard/knowledge-frontend/KnowledgeFrontendSettings';
import type {KnowledgeBaseProgressDto} from '../contracts/knowledge-base-public-progress';
import type {KnowledgeSnapshotView} from './components/KnowledgeBaseViewer';
import IntentWorkbench from './dashboard/IntentWorkbench';
import type {IntentWorkbenchApi} from './dashboard/intent-workbench-api';
import type {IntentCatalogIntegration} from './dashboard/IntentQuestionCatalog';
import BrandResponseLogicEntry from './BrandResponseLogicEntry';
import BrandDiagnosticWorkspace from './BrandDiagnosticWorkspace';
import type {IntentQuestion as BrandIntentQuestion} from '../contracts/intent-workbench';
import './brand-apple-theme.css';
import './dashboard/catalog-review.css';
import type {IntentCatalogViewState} from './dashboard/intent-catalog-view';
import type {RagReportUrlBuilder} from './dashboard/ai-website-preview/rag-report-navigation';
export type BrandPage='reports'|'knowledge'|'diagnostics'|'keywords'|'intent'|'response-logic'|'enterprise-qa'|'website'|'website-settings';
export interface ModuleContext {module:'brand';workspace:{id:string;ownerUserId:number};capabilities:string[];marketEdition?:'cn'|'international'}
/** Actual business surfaces shared by the standalone runtime and the main host. */
export default function ModuleWorkspace({context,page='knowledge',keywordData,preview=false,previewKnowledge,previewQa,previewSiteOps,onOpenKnowledge,enterpriseRagNavigation,websiteBuilderNavigation,intentApi,onIntentSectionChange,intentCatalogIntegration,onEnterResponseLogic,responseLogicVisual,responseLogicToast,onResponseLogicBack}:{context:ModuleContext;page?:BrandPage;keywordData:{tables:ManagedKeywordTable[];revision:number|null;loading?:boolean;error?:unknown;knowledgePublished?:boolean};preview?:boolean;previewKnowledge?:{progress:KnowledgeBaseProgressDto;snapshot:KnowledgeSnapshotView};previewQa?:ReactNode;previewSiteOps?:ReactNode;onOpenKnowledge?:(nodeId?:string,receipt?:IntentReceipt)=>void;enterpriseRagNavigation?:{onOpenWebsite?:()=>void;onOpenWebsiteAssistant?:()=>void;websiteEntryLabel?:string;buildReportUrl?:RagReportUrlBuilder};websiteBuilderNavigation?:{initialStep?:BuildStep;initialSection?:import("./dashboard/ai-website-preview/SimplifiedWebsiteBuilderPreview.js").WebsiteDesignSection|null;onOpenRag?:()=>void;onStepChange?:(step:BuildStep)=>void};intentApi?:IntentWorkbenchApi;onIntentSectionChange?:(section:'universe'|'list')=>void;intentCatalogIntegration?:IntentCatalogIntegration;onEnterResponseLogic?:()=>void;
 responseLogicVisual?:{Button:React.ComponentType<React.HTMLAttributes<HTMLButtonElement>&{disabled?:boolean}>;FilePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;ImagePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;BusinessExecutionActivity?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>};
 responseLogicToast?:{success(message:string):void;error(message:string):void};
 onResponseLogicBack?:()=>void}){
 const inheritedOptimization=useContext(KnowledgeOptimizationContext);
 const [knowledgeOptimization,setKnowledgeOptimization]=useState<{scope:string;receipt?:IntentReceipt}>();
 const [knowledgePage,setKnowledgePage]=useState<'build'|'display'>('build');
 const [responseLogicQuestion,setResponseLogicQuestion]=useState<BrandIntentQuestion|null>(null);
 const catalogReturn = useRef<{scope:string;state:IntentCatalogViewState}|null>(null);
 const catalogScope = `${context.workspace.ownerUserId}:${context.workspace.id}`;
 const orphanResponseLogic = page==='response-logic'&&!responseLogicQuestion;
 const effectivePage = orphanResponseLogic?'intent':page;
 useEffect(()=>{
  if(orphanResponseLogic)onResponseLogicBack?.();
 },[orphanResponseLogic,onResponseLogicBack]);
 let content:ReactNode;
 if(effectivePage==='knowledge')content=<EmbeddedKnowledgeBasePanel key={context.workspace.id} page={knowledgePage} onPageChange={setKnowledgePage} mode="workspace" workbench projectId={context.workspace.id} preview={preview} previewData={previewKnowledge}/>;
 else if(effectivePage==='diagnostics'||effectivePage==='reports')content=<BrandDiagnosticWorkspace key={context.workspace.id} storageKey={`brand-diagnostics:${context.workspace.ownerUserId}:${context.workspace.id}`} preview={preview} onOpenKnowledge={onOpenKnowledge}/>;
 else if(effectivePage==='response-logic'&&responseLogicQuestion)content=<BrandResponseLogicEntry question={responseLogicQuestion} onBack={()=>setResponseLogicQuestion(null)} visual={responseLogicVisual??{Button:({children,disabled,onClick,className,...rest}:any)=><button type='button' disabled={disabled} onClick={onClick} className={['fm-brand-button','fm-brand-button--secondary',className].filter(Boolean).join(' ')} {...rest}>{children}</button>}} toast={responseLogicToast??{success:console.log,error:console.error}}/>;
 else if(effectivePage==='keywords'||effectivePage==='intent')content=<IntentWorkbench key={context.workspace.id} initialView={effectivePage==='intent'?'list':'universe'} initialCatalogState={catalogReturn.current?.scope===catalogScope?catalogReturn.current.state:undefined} onCatalogExit={state=>{catalogReturn.current={scope:catalogScope,state};}} api={intentApi} onOpenKnowledge={(nodeId,receipt)=>{setKnowledgeOptimization({scope:catalogScope,receipt});if(onOpenKnowledge)onOpenKnowledge(nodeId,receipt);else requestWorkspaceNavigation(()=>navigate(projectWorkspaceUrl(`/?view=knowledge${nodeId?`&knowledgeNode=${encodeURIComponent(nodeId)}`:""}`)));}} onSectionChange={onIntentSectionChange} catalogIntegration={{...intentCatalogIntegration,onOpenAnswer:(question:BrandIntentQuestion)=>{setResponseLogicQuestion(question);onEnterResponseLogic?.();}}} keywordProps={{tables:keywordData.tables,dashboardRevision:keywordData.revision,loading:keywordData.loading,error:keywordData.error,generationEnabled:!preview||Boolean(intentApi),knowledgePublished:keywordData.knowledgePublished}}/>;
 else if(effectivePage==='enterprise-qa')content=preview?(previewQa??<section role="status">企业 RAG 预览数据未提供；预览模式不会连接真实问答服务。</section>):<EnterpriseRagWorkspace projectId={context.workspace.id} storageScopeKey={`live:${context.workspace.ownerUserId}:${context.workspace.id}`} onOpenWebsite={enterpriseRagNavigation?.onOpenWebsite} onOpenWebsiteAssistant={enterpriseRagNavigation?.onOpenWebsiteAssistant} websiteEntryLabel={enterpriseRagNavigation?.websiteEntryLabel} buildReportUrl={enterpriseRagNavigation?.buildReportUrl}/>;
 else if(effectivePage==='website')content=preview?(previewSiteOps??<section role="status">网站建设预览数据未提供；预览模式不会打开真实建站项目。</section>):<ConnectedSimplifiedWebsiteBuilderPreview key={`website:${context.workspace.ownerUserId}:${context.workspace.id}`} initialStep={websiteBuilderNavigation?.initialStep} initialSection={websiteBuilderNavigation?.initialSection} onOpenRag={websiteBuilderNavigation?.onOpenRag} onStepChange={websiteBuilderNavigation?.onStepChange} storageScope={`live:${context.workspace.ownerUserId}:${context.workspace.id}`}/>;
 else if(effectivePage==='website-settings')content=<KnowledgeFrontendSettings ownerId={context.workspace.ownerUserId} projectId={context.workspace.id} demo={preview}/>;
 else content=<EmbeddedKnowledgeBasePanel page={knowledgePage} onPageChange={setKnowledgePage} mode="workspace" workbench projectId={context.workspace.id} preview={preview} previewData={previewKnowledge}/>;
 return <KnowledgeOptimizationContext.Provider value={knowledgeOptimization?.scope===catalogScope?knowledgeOptimization.receipt:inheritedOptimization}><div className="fm-brand-theme" data-brand-page={effectivePage}>{content}</div></KnowledgeOptimizationContext.Provider>;
}
