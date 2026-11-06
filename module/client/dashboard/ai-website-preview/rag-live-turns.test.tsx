import {describe,it,expect} from 'vitest';
import {ragLiveTurns} from './rag-live-turns';
import type {Conversation} from '../../conversation-types';

describe('local rule replies alongside real RAG turns',()=>{
 it('keeps a completed greeting visible while the next real answer runs without borrowing its evaluation coordinate',()=>{
  const conversation:Conversation={id:'conversation',title:'问答',purpose:'enterprise_qa',status:'running',taskId:'task',createdAt:1,updatedAt:4,messages:[
   {id:'q1',role:'user',content:'你好',timestamp:1},
   {id:'a1',role:'assistant',content:'你好，有什么可以帮你？',timestamp:2,enterpriseQaLocalReply:{schemaVersion:1,kind:'local_reply',source:'rule',reason:'greeting',turnId:'greeting-turn',userMessageId:'q1',answerMessageId:'a1',serverOwned:true,evaluation:'not_required'}},
   {id:'q2',role:'user',content:'医院有哪些科室？',timestamp:3},
   {id:'intermediate',role:'assistant',content:'正在检索',timestamp:4,generalChat:{schemaVersion:1,kind:'assistant_projection',turnId:'real-turn',agentTaskId:'task',providerEventId:'event',userMessageId:'q2',serverOwned:true,isFinalAnswer:false}},
  ]};
  expect(ragLiveTurns(conversation,true)).toMatchObject([
   {question:'你好',answer:'你好，有什么可以帮你？',evaluation:'not_required',turnId:'greeting-turn',taskId:undefined,coordinate:undefined},
   {question:'医院有哪些科室？',answer:'',evaluation:undefined,coordinate:undefined},
  ]);
 });
});
