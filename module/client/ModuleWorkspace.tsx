import {useState,type ReactNode} from 'react';
import EmbeddedKnowledgeBasePanel from './components/EmbeddedKnowledgeBasePanel';
import ManagedKeywordTables,{type ManagedKeywordTable} from './dashboard/ManagedKeywordTables';
import EnterpriseQaWorkspace from './dashboard/EnterpriseQaWorkspace';
import ConnectedSiteOpsConversationPanel from './dashboard/siteops/ConnectedSiteOpsConversationPanel';
import KnowledgeFrontendSettings from './dashboard/knowledge-frontend/KnowledgeFrontendSettings';
import type {KnowledgeBaseProgressDto} from '../contracts/knowledge-base-public-progress';
import type {KnowledgeSnapshotView} from './components/KnowledgeBaseViewer';
export type BrandPage='knowledge'|'keywords'|'enterprise-qa'|'website'|'website-settings';
export interface ModuleContext {module:'brand';workspace:{id:string;ownerUserId:number};capabilities:string[];marketEdition?:'cn'|'international'}
/** Actual business surfaces shared by the standalone runtime and the main host. */
export default function ModuleWorkspace({context,page='knowledge',keywordData,preview=false,previewKnowledge,previewQa,previewSiteOps}:{context:ModuleContext;page?:BrandPage;keywordData:{tables:ManagedKeywordTable[];revision:number|null;loading?:boolean;error?:unknown;knowledgePublished?:boolean};preview?:boolean;previewKnowledge?:{progress:KnowledgeBaseProgressDto;snapshot:KnowledgeSnapshotView};previewQa?:ReactNode;previewSiteOps?:ReactNode}){
 const [knowledgePage,setKnowledgePage]=useState<'build'|'display'>('build');
 if(page==='keywords')return <ManagedKeywordTables tables={keywordData.tables} dashboardRevision={keywordData.revision} loading={keywordData.loading} error={keywordData.error} generationEnabled={!preview} knowledgePublished={keywordData.knowledgePublished}/>;
 if(page==='enterprise-qa')return preview&&previewQa?previewQa:<EnterpriseQaWorkspace workbench projectId={context.workspace.id}/>;
 if(page==='website')return preview&&previewSiteOps?previewSiteOps:<ConnectedSiteOpsConversationPanel/>;
 if(page==='website-settings')return <KnowledgeFrontendSettings ownerId={context.workspace.ownerUserId} projectId={context.workspace.id} demo={preview}/>;
 return <EmbeddedKnowledgeBasePanel page={knowledgePage} onPageChange={setKnowledgePage} mode="workspace" workbench projectId={context.workspace.id} preview={preview} previewData={previewKnowledge}/>;
}
