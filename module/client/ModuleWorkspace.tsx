import {useState,type ReactNode} from 'react';
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
import BrandReportWorkspace from './BrandReportWorkspace';
import type {IntentQuestion as BrandIntentQuestion} from '../contracts/intent-workbench';
import './brand-apple-theme.css';
export type BrandPage='reports'|'knowledge'|'keywords'|'intent'|'response-logic'|'enterprise-qa'|'website'|'website-settings';
export interface ModuleContext {module:'brand';workspace:{id:string;ownerUserId:number};capabilities:string[];marketEdition?:'cn'|'international'}
/** Actual business surfaces shared by the standalone runtime and the main host. */
export default function ModuleWorkspace({context,page='knowledge',keywordData,preview=false,previewKnowledge,previewQa,previewSiteOps,enterpriseRagNavigation,websiteBuilderNavigation,intentApi,onIntentSectionChange,intentCatalogIntegration,onEnterResponseLogic,responseLogicVisual,responseLogicToast,onResponseLogicBack}:{context:ModuleContext;page?:BrandPage;keywordData:{tables:ManagedKeywordTable[];revision:number|null;loading?:boolean;error?:unknown;knowledgePublished?:boolean};preview?:boolean;previewKnowledge?:{progress:KnowledgeBaseProgressDto;snapshot:KnowledgeSnapshotView};previewQa?:ReactNode;previewSiteOps?:ReactNode;enterpriseRagNavigation?:{onOpenWebsite?:()=>void;onOpenWebsiteAssistant?:()=>void;websiteEntryLabel?:string};websiteBuilderNavigation?:{initialStep?:BuildStep;initialSection?:import("./dashboard/ai-website-preview/SimplifiedWebsiteBuilderPreview.js").WebsiteDesignSection|null;onOpenRag?:()=>void;onStepChange?:(step:BuildStep)=>void};intentApi?:IntentWorkbenchApi;onIntentSectionChange?:(section:'universe'|'list')=>void;intentCatalogIntegration?:IntentCatalogIntegration;onEnterResponseLogic?:()=>void;
 responseLogicVisual?:{Button:React.ComponentType<React.HTMLAttributes<HTMLButtonElement>&{disabled?:boolean}>;FilePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;ImagePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;BusinessExecutionActivity?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>};
 responseLogicToast?:{success(message:string):void;error(message:string):void};
 onResponseLogicBack?:()=>void}){
 const [knowledgePage,setKnowledgePage]=useState<'build'|'display'>('build');
 const [responseLogicQuestion,setResponseLogicQuestion]=useState<BrandIntentQuestion|null>(null);
 let content:ReactNode;
 if(page==='reports')content=<BrandReportWorkspace key={context.workspace.id} projectId={context.workspace.id} preview={preview}/>;
 else if(page==='response-logic'&&responseLogicQuestion)content=<BrandResponseLogicEntry question={responseLogicQuestion} onBack={()=>{setResponseLogicQuestion(null);onResponseLogicBack?.();}} visual={responseLogicVisual??{Button:({children,disabled,onClick,className,...rest}:any)=><button type='button' disabled={disabled} onClick={onClick} className={['fm-brand-button','fm-brand-button--secondary',className].filter(Boolean).join(' ')} {...rest}>{children}</button>}} toast={responseLogicToast??{success:console.log,error:console.error}}/>;
 else if(page==='response-logic')content=<section role="status" className="iw-empty fm-brand-empty-state">
  <p>请从「优化问题」列表中选择问题并点击「进入应答逻辑」。</p>
  <button type='button' className="fm-brand-button fm-brand-button--secondary" onClick={onResponseLogicBack}>返回优化问题</button>
 </section>;
 else if(page==='keywords'||page==='intent')content=<IntentWorkbench key={context.workspace.id} initialView={page==='intent'?'list':'universe'} api={intentApi} onSectionChange={onIntentSectionChange} catalogIntegration={{...intentCatalogIntegration,onOpenAnswer:(question:BrandIntentQuestion)=>{setResponseLogicQuestion(question);onEnterResponseLogic?.();}}} keywordProps={{tables:keywordData.tables,dashboardRevision:keywordData.revision,loading:keywordData.loading,error:keywordData.error,generationEnabled:!preview,knowledgePublished:keywordData.knowledgePublished}}/>;
 else if(page==='enterprise-qa')content=preview?(previewQa??<section role="status">企业 RAG 预览数据未提供；预览模式不会连接真实问答服务。</section>):<EnterpriseRagWorkspace projectId={context.workspace.id} storageScopeKey={`live:${context.workspace.ownerUserId}:${context.workspace.id}`} onOpenWebsite={enterpriseRagNavigation?.onOpenWebsite} onOpenWebsiteAssistant={enterpriseRagNavigation?.onOpenWebsiteAssistant} websiteEntryLabel={enterpriseRagNavigation?.websiteEntryLabel}/>;
 else if(page==='website')content=preview?(previewSiteOps??<section role="status">网站建设预览数据未提供；预览模式不会打开真实建站项目。</section>):<ConnectedSimplifiedWebsiteBuilderPreview key={`website:${context.workspace.ownerUserId}:${context.workspace.id}`} initialStep={websiteBuilderNavigation?.initialStep} initialSection={websiteBuilderNavigation?.initialSection} onOpenRag={websiteBuilderNavigation?.onOpenRag} onStepChange={websiteBuilderNavigation?.onStepChange} storageScope={`live:${context.workspace.ownerUserId}:${context.workspace.id}`}/>;
 else if(page==='website-settings')content=<KnowledgeFrontendSettings ownerId={context.workspace.ownerUserId} projectId={context.workspace.id} demo={preview}/>;
 else content=<EmbeddedKnowledgeBasePanel page={knowledgePage} onPageChange={setKnowledgePage} mode="workspace" workbench projectId={context.workspace.id} preview={preview} previewData={previewKnowledge}/>;
 return <div className="fm-brand-theme" data-brand-page={page}>{content}</div>;
}
