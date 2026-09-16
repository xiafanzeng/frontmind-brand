import {afterEach,describe,expect,it,vi} from "vitest";
import express from "express";
import {type Server} from "node:http";
import {createBrandConversationRouter,assertBrandConversationPurpose,brandConversationPurpose,type BrandConversationSnapshot} from "../server/conversations";
const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));});
const snapshot=(id:string,purpose?:string,agent?:string):BrandConversationSnapshot=>({id,purpose,workbenchAgentId:agent,messages:[]});
async function host(saved:BrandConversationSnapshot[]){const save=vi.fn(),remove=vi.fn();const app=express();app.use(express.json());app.use(createBrandConversationRouter({list:async()=>saved,save,delete:remove}));const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(resolve=>server.on('listening',resolve));return {base:`http://127.0.0.1:${(server.address() as any).port}`,save,remove};}
describe("brand conversation business boundary",()=>{
 it("does not turn a generic chat title into knowledge authority",()=>{expect(brandConversationPurpose({...snapshot('general'),title:'企业知识库构建'})).toBeNull();});
 it("rejects relabeling a saved general/content task",()=>{expect(()=>assertBrandConversationPurpose('enterprise_qa',snapshot('same','enterprise_qa'),snapshot('same','content_production'))).toThrow('PURPOSE_MISMATCH');});
 it("rejects mixed-task dispatch metadata in a knowledge snapshot",()=>{expect(()=>assertBrandConversationPurpose('knowledge',{...snapshot('knowledge',undefined,'knowledge'),messages:[{generalChatDispatch:{purpose:'content_production'}}]})).toThrow('DISPATCH_MISMATCH');});
 it("lists only the requested saved business purpose",async()=>{const h=await host([snapshot('k',undefined,'knowledge'),snapshot('q','enterprise_qa'),snapshot('g'),snapshot('c','content_production')]);const res=await fetch(h.base+'/conversations?purpose=knowledge');expect(await res.json()).toEqual({conversations:[snapshot('k',undefined,'knowledge')]});});
 it("rejects a mixed batch before any save or deletion",async()=>{const h=await host([snapshot('general')]);const res=await fetch(h.base+'/conversations/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'enterprise_qa',conversations:[snapshot('new','enterprise_qa'),snapshot('general','enterprise_qa')]})});expect(res.status).toBe(403);expect(h.save).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();});
 it("saves the independent knowledge workflow and tolerates repeated deletion",async()=>{const h=await host([]);const res=await fetch(h.base+'/conversations/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'knowledge',conversations:[snapshot('new',undefined,'knowledge')],deletedIds:['already-deleted']})});expect(await res.json()).toEqual({success:true});expect(h.save).toHaveBeenCalledOnce();expect(h.remove).not.toHaveBeenCalled();});
});

describe("saved enterprise question draft identity", () => {
 it("does not accept a browser-only purpose marker", async () => {
  const h = await host([]);
  const res = await fetch(h.base + '/conversations/sync', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'enterprise_qa',conversations:[snapshot('new',undefined,'enterprise-qa')]})});
  expect(res.status).toBe(403);
  expect(h.save).not.toHaveBeenCalled();
 });
 it("normalizes only a saved draft and accepts its next sync or deletion", async () => {
  const saved = snapshot('draft',undefined,'enterprise-qa');
  const h = await host([saved]);
  const res = await fetch(h.base + '/conversations?purpose=enterprise_qa');
  const {conversations} = await res.json();
  expect(conversations).toEqual([{...saved,purpose:'enterprise_qa'}]);
  expect(saved.purpose).toBeUndefined();
  const sync = await fetch(h.base + '/conversations/sync', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'enterprise_qa',conversations})});
  expect(sync.status).toBe(200);
  expect(h.save).toHaveBeenCalledOnce();
  const remove = await fetch(h.base + '/conversations/sync', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'enterprise_qa',conversations:[],deletedIds:['draft']})});
  expect(remove.status).toBe(200);
  expect(h.remove).toHaveBeenCalledOnce();
 });
 it.each([
  {purpose:'content_production'},
  {taskId:'general-task'},
  {previousResponseId:'general-task'},
  {execution:{taskId:'general-task'}},
  {executionKind:'general_chat_v2'},
  {messages:[{generalChat:{taskId:'general-task'}}]},
  {messages:[{generalChatDispatch:{purpose:'content_production'}}]},
  {messages:[{knowledgeBase:{serverOwned:true}}]},
 ])("never promotes bound or other-purpose metadata %j to a draft", async metadata => {
  const h = await host([{...snapshot('bound',undefined,'enterprise-qa'),...metadata}]);
  expect(await (await fetch(h.base+'/conversations?purpose=enterprise_qa')).json()).toEqual({conversations:[]});
  for (const change of [{conversations:[snapshot('bound','enterprise_qa','enterprise-qa')]},{conversations:[],deletedIds:['bound']}]) {
   const res = await fetch(h.base + '/conversations/sync', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'enterprise_qa',...change})});
   expect(res.status).toBe(403);
  }
  expect(h.save).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
 });
});
