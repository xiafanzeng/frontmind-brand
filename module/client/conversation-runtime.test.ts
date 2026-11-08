import {act,renderHook,waitFor,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {createBrandConversationRuntime,type BrandConversationClient} from './conversation-runtime';
import type {Conversation} from './conversation-types';
afterEach(cleanup);
function client(records:Conversation[]=[]):BrandConversationClient{return {list:vi.fn(async()=>records),sync:vi.fn(async()=>{}),observe:vi.fn(async()=>{throw new Error('No provider call expected');})};}
function conversation(id:string):Conversation{return {id,title:'企业问答',purpose:'enterprise_qa',workbenchAgentId:'enterprise-qa',messages:[],status:'idle',createdAt:1,updatedAt:1};}
describe('fixed brand business history',()=>{
 it('keeps a newly created and already saved conversation when an older history response arrives',async()=>{
  const transport=client();let releaseHistory!:(records:Conversation[])=>void;
  vi.mocked(transport.list).mockImplementationOnce(()=>new Promise(resolve=>{releaseHistory=resolve;}));
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');
  const {result}=renderHook(()=>runtime.useConversation());
  await waitFor(()=>expect(result.current.loading).toBe(true));
  let created='';act(()=>{created=result.current.createConversation({reuseEmpty:false,title:'新会话'});});
  await waitFor(()=>expect(transport.sync).toHaveBeenCalledTimes(1));
  await act(async()=>{await Promise.resolve();});
  // The save has succeeded and cleared dirty before the stale list resolves.
  await act(async()=>{releaseHistory([conversation('server-old')]);});
  expect(result.current.hydrated).toBe(true);
  expect(result.current.activeConversation?.id).toBe(created);
  expect(result.current.state.conversations.map(item=>item.id)).toEqual(expect.arrayContaining([created,'server-old']));
  // A lagging list started after that save must not drop an unobserved create.
  vi.mocked(transport.list).mockResolvedValueOnce([conversation('server-old')]);
  await act(()=>result.current.refreshConversations());
  expect(result.current.activeConversation?.id).toBe(created);
  expect(result.current.state.conversations.some(item=>item.id===created)).toBe(true);
  runtime.dispose();
 });
 it('keeps edits whose save finished while an older list request was in flight',async()=>{
  const base=conversation('qa-a');const transport=client([base]);
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');
  const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  let releaseHistory!:(records:Conversation[])=>void;
  vi.mocked(transport.list).mockImplementationOnce(()=>new Promise(resolve=>{releaseHistory=resolve;}));
  let refresh!:Promise<void>;act(()=>{refresh=result.current.refreshConversations();});
  act(()=>result.current.updateTitle('qa-a','已成功保存的新标题'));
  await act(async()=>{expect(await result.current.flushConversation('qa-a')).toBe(true);});
  await act(async()=>{releaseHistory([{...base,title:'旧标题'}]);await refresh;});
  expect(result.current.activeConversation?.title).toBe('已成功保存的新标题');
  runtime.dispose();
 });
 it('preserves a user selection made after a refresh started even when the URL still names another conversation',async()=>{
  const transport=client([conversation('qa-a'),conversation('qa-b')]);
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');
  const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  const originalUrl=location.href;history.replaceState(null,'','/?workbenchTask=qa-a');
  try {
   let releaseHistory!:(records:Conversation[])=>void;
   vi.mocked(transport.list).mockImplementationOnce(()=>new Promise(resolve=>{releaseHistory=resolve;}));
   let refresh!:Promise<void>;act(()=>{refresh=result.current.refreshConversations();result.current.setActive('qa-b');});
   await act(async()=>{releaseHistory([conversation('qa-a'),conversation('qa-b')]);await refresh;});
   expect(result.current.activeConversation?.id).toBe('qa-b');
  } finally {history.replaceState(null,'',originalUrl);runtime.dispose();}
 });
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
 it('serializes deletion after a pending save and prevents a stale refresh resurrecting the conversation',async()=>{
  const record=conversation('qa-a');const transport=client([record]);let releaseSave!:()=>void;
  vi.mocked(transport.sync).mockImplementation(async (_purpose,records)=>{if(records.length)await new Promise<void>(resolve=>{releaseSave=resolve;});});
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  let save!:Promise<boolean>;let deletion!:Promise<boolean>;
  act(()=>{result.current.updateTitle('qa-a','新标题');save=result.current.flushConversation('qa-a');});
  await waitFor(()=>expect(transport.sync).toHaveBeenCalledTimes(1));
  act(()=>{deletion=result.current.deleteConversation('qa-a') as Promise<boolean>;result.current.updateTitle('qa-a','不应保存');});
  expect(result.current.activeConversation?.id).toBe('qa-a');expect(transport.sync).toHaveBeenCalledTimes(1);
  await act(async()=>{releaseSave();await save;expect(await deletion).toBe(true);});
  expect(vi.mocked(transport.sync).mock.calls[1][2]).toEqual(['qa-a']);expect(result.current.state.conversations).toHaveLength(0);
  await act(()=>result.current.refreshConversations());expect(result.current.state.conversations).toHaveLength(0);
  runtime.dispose();
 });
 it('preserves the conversation and reports a failed deletion',async()=>{
  const transport=client([conversation('qa-a')]);vi.mocked(transport.sync).mockRejectedValueOnce(new Error('删除失败'));
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  await act(async()=>{expect(await result.current.deleteConversation('qa-a')).toBe(false);});
  expect(result.current.activeConversation?.id).toBe('qa-a');expect(result.current.syncError).toBe('删除失败');runtime.dispose();
 });
 it('uses the confirmed endpoint result and never removes a server-blocked conversation',async()=>{
  const transport=client([conversation('qa-a')]);transport.deleteConfirmed=vi.fn(async()=>({ok:false as const,reason:'active_turn' as const,message:'该对话仍在回答中，请稍后再试。'}));
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  await act(async()=>{expect(await result.current.deleteConversationConfirmed('qa-a')).toEqual({ok:false,reason:'active_turn',message:'该对话仍在回答中，请稍后再试。'});});
  expect(transport.deleteConfirmed).toHaveBeenCalledWith('enterprise_qa','qa-a');
  expect(vi.mocked(transport.sync).mock.calls.some(call=>call[2]?.includes('qa-a'))).toBe(false);
  expect(result.current.activeConversation?.id).toBe('qa-a');expect(result.current.syncError).toContain('仍在回答');runtime.dispose();
 });
 it('runs confirmed delete transports concurrently without allowing the targets to be saved again',async()=>{
  const transport=client([conversation('qa-a'),conversation('qa-b')]);
  const releases=new Map<string,(result:{ok:true})=>void>();
  transport.deleteConfirmed=vi.fn(async(_purpose,id)=>await new Promise<{ok:true}>(resolve=>{releases.set(id,resolve);}));
  const runtime=createBrandConversationRuntime(transport,'enterprise_qa','test-workspace');
  const {result}=renderHook(()=>runtime.useConversation());await waitFor(()=>expect(result.current.hydrated).toBe(true));
  let first!:Promise<{ok:boolean}>;let second!:Promise<{ok:boolean}>;
  act(()=>{first=result.current.deleteConversationConfirmed('qa-a');});
  await waitFor(()=>expect(transport.deleteConfirmed).toHaveBeenCalledWith('enterprise_qa','qa-a'));
  act(()=>{second=result.current.deleteConversationConfirmed('qa-b');});
  await waitFor(()=>expect(transport.deleteConfirmed).toHaveBeenCalledTimes(2));
  act(()=>result.current.updateTitle('qa-a','不应保存'));
  await act(async()=>{expect(await result.current.flushConversation('qa-a')).toBe(false);});
  expect(result.current.state.conversations.find(item=>item.id==='qa-a')?.title).toBe('企业问答');
  expect(transport.sync).not.toHaveBeenCalled();
  await act(async()=>{releases.get('qa-a')?.({ok:true});releases.get('qa-b')?.({ok:true});expect(await first).toEqual({ok:true});expect(await second).toEqual({ok:true});});
  expect(result.current.state.conversations).toHaveLength(0);runtime.dispose();
 });
});
