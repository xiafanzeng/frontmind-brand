import {act,renderHook,waitFor,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {createBrandConversationRuntime,type BrandConversationClient} from './conversation-runtime';
import type {Conversation} from './conversation-types';
afterEach(cleanup);
function client(records:Conversation[]=[]):BrandConversationClient{return {list:vi.fn(async()=>records),sync:vi.fn(async()=>{}),observe:vi.fn(async()=>{throw new Error('No provider call expected');})};}
function conversation(id:string):Conversation{return {id,title:'企业问答',purpose:'enterprise_qa',workbenchAgentId:'enterprise-qa',messages:[],status:'idle',createdAt:1,updatedAt:1};}
describe('fixed brand business history',()=>{
 it('creates knowledge histories with an explicit server-verifiable purpose marker',async()=>{
  const transport=client();const runtime=createBrandConversationRuntime(transport,'knowledge','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));let id='';act(()=>{id=result.current.createConversation({title:'自定义标题'});});await waitFor(()=>expect(transport.sync).toHaveBeenCalled());expect(result.current.activeConversation).toMatchObject({id,title:'自定义标题',workbenchAgentId:'knowledge'});expect(transport.sync).toHaveBeenCalledWith('knowledge',expect.arrayContaining([expect.objectContaining({id,workbenchAgentId:'knowledge'})]));runtime.dispose();
 });
 it('keeps unsaved messages across a stale refresh and strips browser file bytes from sync',async()=>{
  const base=conversation('qa-a');const transport=client([base]);const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  act(()=>result.current.addMessage('qa-a',{id:'draft-a',role:'user',content:'尚未发送',timestamp:2,attachments:[{id:'file-a',name:'brief.txt',type:'file',file:new File(['local-only'],'brief.txt'),blobUrl:'blob:local'}]}));await act(()=>result.current.refreshConversations());expect(result.current.activeConversation?.messages[0]?.content).toBe('尚未发送');await act(()=>result.current.flushConversation('qa-a'));const persisted=vi.mocked(transport.sync).mock.calls.at(-1)![1][0].messages[0].attachments![0];expect(persisted).toMatchObject({name:'brief.txt'});expect(persisted).not.toHaveProperty('file');expect(persisted).not.toHaveProperty('blobUrl');runtime.dispose();
 });
 it('retains a failed save and restores clean server task state after a successful retry',async()=>{
  const records=[conversation('qa-a')];const transport=client(records);vi.mocked(transport.sync).mockRejectedValueOnce(new Error('temporary save outage'));const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));act(()=>result.current.updateTitle('qa-a','尚未保存的标题'));await act(async()=>{await expect(result.current.flushConversation('qa-a')).rejects.toThrow('temporary save outage');});expect(result.current.syncError).toContain('temporary');await act(()=>result.current.refreshConversations());expect(result.current.activeConversation?.title).toBe('尚未保存的标题');await act(()=>result.current.flushConversation('qa-a'));records[0]={...records[0],title:'服务器新状态',status:'completed'};await act(()=>result.current.refreshConversations());expect(result.current.activeConversation).toMatchObject({title:'服务器新状态',status:'completed'});runtime.dispose();
 });
});
