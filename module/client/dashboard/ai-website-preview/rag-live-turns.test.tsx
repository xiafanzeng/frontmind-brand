import {describe,it,expect} from 'vitest';
import {normalizeRagEpochMilliseconds,ragLiveTurns} from './rag-live-turns';
import type {Conversation} from '../../conversation-types';

describe('local rule replies alongside real RAG turns',()=>{
 it('normalizes plausible legacy epoch seconds without changing current milliseconds',()=>{
  expect(normalizeRagEpochMilliseconds(1_793_893_500)).toBe(1_793_893_500_000);
  expect(normalizeRagEpochMilliseconds(1_793_893_500_000)).toBe(1_793_893_500_000);
  expect(normalizeRagEpochMilliseconds(42)).toBe(42);
  expect(normalizeRagEpochMilliseconds(Number.NaN)).toBeUndefined();
 });
 it('normalizes a legacy final answer completion time at the read boundary',()=>{
  const conversation:Conversation={id:'legacy-time',title:'问答',purpose:'enterprise_qa',status:'completed',taskId:'task',createdAt:1_793_893_498,updatedAt:1_793_893_500,messages:[
   {id:'q1',role:'user',content:'企业服务有哪些？',timestamp:1_793_893_498},
   {id:'a1',role:'assistant',content:'提供企业知识服务。',timestamp:1_793_893_500,generalChat:{schemaVersion:1,kind:'assistant_projection',turnId:'turn-1',agentTaskId:'task',providerEventId:'event',userMessageId:'q1',serverOwned:true,isFinalAnswer:true}},
  ]};
  expect(ragLiveTurns(conversation)).toMatchObject([{completedAt:1_793_893_500_000}]);
  expect(conversation.messages[1]?.timestamp).toBe(1_793_893_500);
 });
 it('keeps a completed greeting visible while the next real answer runs without borrowing its evaluation coordinate',()=>{
  const conversation:Conversation={id:'conversation',title:'问答',purpose:'enterprise_qa',status:'running',taskId:'task',createdAt:1,updatedAt:4,messages:[
   {id:'q1',role:'user',content:'你好',timestamp:1},
   {id:'a1',role:'assistant',content:'你好，有什么可以帮你？',timestamp:2,enterpriseQaLocalReply:{schemaVersion:1,kind:'local_reply',source:'rule',reason:'greeting',turnId:'greeting-turn',userMessageId:'q1',answerMessageId:'a1',serverOwned:true,evaluation:'not_required',knowledgeBase:{snapshotId:'hospital-snapshot',version:7,sourceFileName:'东莞台心医院-knowledge-base.zip',documentCount:12,companyName:'东莞台心医院'}}},
   {id:'q2',role:'user',content:'医院有哪些科室？',timestamp:3},
   {id:'intermediate',role:'assistant',content:'正在检索',timestamp:4,generalChat:{schemaVersion:1,kind:'assistant_projection',turnId:'real-turn',agentTaskId:'task',providerEventId:'event',userMessageId:'q2',serverOwned:true,isFinalAnswer:false}},
  ]};
  expect(ragLiveTurns(conversation,true)).toMatchObject([
   {question:'你好',answer:'你好，有什么可以帮你？',evaluation:'not_required',turnId:'greeting-turn',taskId:undefined,coordinate:undefined,knowledgeBase:{snapshotId:'hospital-snapshot',version:7,companyName:'东莞台心医院'}},
   {question:'医院有哪些科室？',answer:'',evaluation:undefined,coordinate:undefined},
  ]);
 });
});
