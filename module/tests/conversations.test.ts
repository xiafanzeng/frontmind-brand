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
