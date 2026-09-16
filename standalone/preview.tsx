import {useState} from 'react';
import type {BrandConversationClient} from '../module/client/conversation-runtime';
import type {Conversation} from '../module/client/conversation-types';
import type {RpcCall} from './api';
import {previewKnowledgeSnapshot,previewKnowledgeProgress} from './preview-data';
import SiteOpsConversationPanel from '../module/client/dashboard/siteops/SiteOpsConversationPanel';
import type {SiteOpsObservationV1} from '../module/contracts/siteops-contract';
const keywordTables=[{id:'local-brand',title:'品牌问题词库',description:'合成开发样例',columns:['问题','主分类','问题类型'],rows:[['示例企业提供哪些服务？','brand','品牌介绍'],['示例产品适合哪些应用？','product_scenario','应用场景']]}];
export const previewRpc:RpcCall=async(path,_input,mutation)=>{
 if(mutation)throw new Error('本地预览不执行后台任务；请到开发子域名验收。');
 if(path==='workspace.knowledge')return {snapshot:previewKnowledgeSnapshot};
 if(path==='workspace.knowledgeProgress')return {progress:previewKnowledgeProgress};
 if(path==='workspace.knowledgeReset.status')return {revision:0,hasKnowledge:true,canReset:false,unavailableReason:'本地预览不重置真实数据'};
 if(path==='workspace.dashboard')return {revision:1,payload:{keywordTables}};
 if(path==='workspace.brandQuestionUniverse.observe')return {reason:'本地预览不生成词库',canStart:false,knowledgeSnapshotId:previewKnowledgeSnapshot.id,dashboardRevision:1,operation:null};
 throw new Error(`本地预览未连接业务接口：${path}`);
};
export function previewConversations():BrandConversationClient{
 const records:{knowledge:Conversation[];enterprise_qa:Conversation[]}={knowledge:[],enterprise_qa:[{id:'preview-qa',title:'企业问答示例',purpose:'enterprise_qa',workbenchAgentId:'enterprise-qa',createdAt:Date.now(),updatedAt:Date.now(),status:'completed',messages:[{id:'preview-user',role:'user',content:'请介绍示例企业的主要服务。',timestamp:Date.now()},{id:'preview-answer',role:'assistant',content:'这是用于预览的合成回答。真实企业问答会读取当前工作区已发布的知识版本，并保留回答与引用。',timestamp:Date.now()}]}]};
 return {list:async purpose=>structuredClone(records[purpose]),sync:async(purpose,conversations,deleted=[])=>{const patch=new Map(conversations.map(item=>[item.id,item]));records[purpose]=[...records[purpose].filter(item=>!patch.has(item.id)&&!deleted.includes(item.id)),...conversations];},observe:async()=>{throw new Error('本地预览不读取线上任务');}};
}
const site:SiteOpsObservationV1={schemaVersion:1,executionKind:'site_ops',serviceReadiness:{visuals:{status:'not_configured'},website:{status:'not_configured'},publishing:{status:'not_configured'},domain:{status:'not_configured'}},aliyunConnection:{configured:false,status:'not_connected',verifiedAt:null,canDisconnect:false},domainState:null,project:{id:'11111111-1111-4111-8111-111111111111',conversationId:'siteops:preview',revision:1,status:'awaiting_visual_selection',currentKnowledgeSnapshotId:'22222222-2222-4222-8222-222222222222',primaryLanguage:'zh-CN',canonicalHostname:null,updatedAt:'2026-09-16T00:00:00.000Z'},brief:null,knowledgeSnapshots:[{id:'22222222-2222-4222-8222-222222222222',label:'合成知识库 · 本地预览',sourceProfile:'dashboard-core-v1',createdAt:'2026-09-16T00:00:00.000Z',active:true}],messages:[{id:'preview-site-message',role:'assistant',content:'本地建站预览。真实视觉生成、构建、发布与域名配置请在开发子域名验证。',sequence:1,metadata:{siteOps:{kind:'visual_board',subjectId:'preview-batch',revision:1,status:'active',payload:{}}},sentAt:'2026-09-16T00:00:00.000Z'}],visualCandidates:[],visualCandidatePages:[],visualGeneration:{status:'idle',targetPage:null,generatedPages:0,availablePages:0,reservedPages:0,maxPages:3,canGenerateMore:false,canSelectExisting:false},executionSteps:[],builds:[],deployments:[],socialPackages:[],rebuildRequest:{allowed:false,resetApplied:false,resetSourceBuildId:null},interactionState:'awaiting_visual_selection',latestSequence:1};
export function SiteOpsPreview(){const [notice,setNotice]=useState('本地预览不调用供应商、不建站、不发布域名。');return <SiteOpsConversationPanel observation={site} notice={notice} onAction={()=>setNotice('这是本地预览操作；真实任务请在开发子域名创建。')} onSubmitRevision={()=>setNotice('已演示提交入口；本地预览不会创建真实任务。')}/>;}
