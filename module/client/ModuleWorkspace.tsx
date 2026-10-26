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
import type {IntentQuestion as BrandIntentQuestion} from '../contracts/intent-workbench';
export type BrandPage='knowledge'|'keywords'|'intent'|'response-logic'|'enterprise-qa'|'website'|'website-settings';
export interface ModuleContext {module:'brand';workspace:{id:string;ownerUserId:number};capabilities:string[];marketEdition?:'cn'|'international'}
/** Actual business surfaces shared by the standalone runtime and the main host. */
export default function ModuleWorkspace({context,page='knowledge',keywordData,preview=false,previewKnowledge,previewQa,previewSiteOps,enterpriseRagNavigation,websiteBuilderNavigation,intentApi,onIntentSectionChange,intentCatalogIntegration,responseLogicVisual,responseLogicToast,onResponseLogicBack}:{context:ModuleContext;page?:BrandPage;keywordData:{tables:ManagedKeywordTable[];revision:number|null;loading?:boolean;error?:unknown;knowledgePublished?:boolean};preview?:boolean;previewKnowledge?:{progress:KnowledgeBaseProgressDto;snapshot:KnowledgeSnapshotView};previewQa?:ReactNode;previewSiteOps?:ReactNode;enterpriseRagNavigation?:{onOpenWebsite?:()=>void;onOpenWebsiteAssistant?:()=>void;websiteEntryLabel?:string};websiteBuilderNavigation?:{initialStep?:BuildStep;onOpenRag?:()=>void;onStepChange?:(step:BuildStep)=>void};intentApi?:IntentWorkbenchApi;onIntentSectionChange?:(section:'universe'|'list')=>void;intentCatalogIntegration?:IntentCatalogIntegration;
 responseLogicVisual?:{Button:React.ComponentType<React.HTMLAttributes<HTMLButtonElement>&{disabled?:boolean}>;FilePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;ImagePreview?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;BusinessExecutionActivity?:React.ComponentType<React.HTMLAttributes<HTMLDivElement>>};
 responseLogicToast?:{success(message:string):void;error(message:string):void};
 onResponseLogicBack?:()=>void}){
 const [knowledgePage,setKnowledgePage]=useState<'build'|'display'>('build');
 const [responseLogicQuestion,setResponseLogicQuestion]=useState<BrandIntentQuestion|null>(null);
 if(page==='response-logic'&&responseLogicQuestion)return <BrandResponseLogicEntry question={responseLogicQuestion} onBack={()=>{setResponseLogicQuestion(null);onResponseLogicBack?.();}} visual={responseLogicVisual??{Button:({children,disabled,onClick,...rest}:any)=><button type='button' disabled={disabled} onClick={onClick} style={{padding:'6px 14px',borderRadius:6,border:'1px solid #d0d5dd',background:'white',cursor:disabled?'not-allowed':'pointer',fontSize:14}} {...rest}>{children}</button>}} toast={responseLogicToast??{success:console.log,error:console.error}}/>;
 if(page==='keywords'||page==='intent')return <IntentWorkbench key={context.workspace.id} initialView={page==='intent'?'list':'universe'} api={intentApi} onSectionChange={onIntentSectionChange} catalogIntegration={{...intentCatalogIntegration,onOpenAnswer:(question:BrandIntentQuestion)=>{setResponseLogicQuestion(question);}}} keywordProps={{tables:keywordData.tables,dashboardRevision:keywordData.revision,loading:keywordData.loading,error:keywordData.error,generationEnabled:!preview,knowledgePublished:keywordData.knowledgePublished}}/>;
 if(page==='enterprise-qa')return preview?(previewQa??<section role="status">企业 RAG 预览数据未提供；预览模式不会连接真实问答服务。</section>):<EnterpriseRagWorkspace projectId={context.workspace.id} storageScopeKey={`live:${context.workspace.ownerUserId}:${context.workspace.id}`} onOpenWebsite={enterpriseRagNavigation?.onOpenWebsite} onOpenWebsiteAssistant={enterpriseRagNavigation?.onOpenWebsiteAssistant} websiteEntryLabel={enterpriseRagNavigation?.websiteEntryLabel}/>;
 if(page==='website')return preview?(previewSiteOps??<section role="status">网站建设预览数据未提供；预览模式不会打开真实建站项目。</section>):<ConnectedSimplifiedWebsiteBuilderPreview key={`website:${context.workspace.ownerUserId}:${context.workspace.id}`} initialStep={websiteBuilderNavigation?.initialStep} onOpenRag={websiteBuilderNavigation?.onOpenRag} onStepChange={websiteBuilderNavigation?.onStepChange} storageScope={`live:${context.workspace.ownerUserId}:${context.workspace.id}`}/>;
 if(page==='website-settings')return <KnowledgeFrontendSettings ownerId={context.workspace.ownerUserId} projectId={context.workspace.id} demo={preview}/>;
 return <EmbeddedKnowledgeBasePanel page={knowledgePage} onPageChange={setKnowledgePage} mode="workspace" workbench projectId={context.workspace.id} preview={preview} previewData={previewKnowledge}/>;
}
