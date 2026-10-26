import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {reportRuntimePatch} from '../../workflows/report-harness/runtime-config.mjs';
import {publicEvents} from '../../workflows/report-harness/events.mjs';

assert.ok(Number(process.versions.node.split('.')[0])>=24);
const root=await mkdtemp(path.join(os.tmpdir(),'frontmind-harness-offline-'));
let requests=0;const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw);assert.equal(req.url,'/v1/chat/completions');assert.equal(body.model,'deepseek-flash');
 assert.equal(req.headers.authorization,'Bearer offline-not-a-real-key');requests++;
 const hasResult=body.messages.some(message=>message.role==='tool');
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const frame=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:`offline-${requests}`,object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason}]})}\n\n`);
 frame({role:'assistant',content:''});
 if(!hasResult){frame({tool_calls:[{index:0,id:'call_offline_1',type:'function',function:{name:'write_research_note',arguments:JSON.stringify({name:'offline.md',text:'离线模拟：实际工具已保存中间分析。'})}}]});frame({},'tool_calls');}
 else{frame({content:'离线模拟工具执行完成。'});frame({},'stop');}
 res.write(`data: ${JSON.stringify({id:`offline-${requests}`,object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\n`);
 res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const stageConfig=path.join(root,'current-stage.json');await mkdir(path.join(root,'work'));await mkdir(path.join(root,'home'));
await writeFile(stageConfig,JSON.stringify({jobId:'offline-job',stageId:'S5.5',operationToken:'offline',inputHash:'offline',inputDirectory:'stages/offline-job'}));
const patch=reportRuntimePatch({root,stageConfig});
const provider=patch.find(row=>row.insert).insert.find(row=>row.id==='llm-pi-ai').config.providers['frontmind-deepseek'];
assert.equal(provider.baseURL,'https://api.deepseek.com/v1');
provider.baseURL=`http://127.0.0.1:${server.address().port}/v1`; // Test-only local mock; production has no endpoint override.
const patchPath=path.join(root,'offline.patch.json');await writeFile(patchPath,JSON.stringify(patch));
const harness=new DeepSeekHarness({profile:'sdk-minimal',patches:[patchPath],dshHome:path.join(root,'dsh-home'),processCwd:root,cwd:root,provider:'frontmind-deepseek',model:'deepseek-flash',maxTokens:4096,env:{PATH:process.env.PATH,HOME:path.join(root,'home'),TMPDIR:root,REPORT_DEEPSEEK_API_KEY:'offline-not-a-real-key',DSH_TELEMETRY_MODE:'DISABLED',DSH_TELEMETRY_DISABLED:'1'},initializeTimeoutMs:60000});
try{
 await harness.start();assert.equal(requests,0,'initialize must not send model requests');
 const events=[],sessionId=randomUUID();
 const first=await harness.run('离线测试，请保存一次研究笔记。',{sessionId,onNotification:notification=>events.push(...publicEvents(notification))});
 assert.equal(first.events.filter(event=>event.type==='turn/end').at(-1).data.reason.kind,'completed');
 assert.equal(requests,2);assert.equal(events.find(event=>event.kind==='tool_start').message,'保存中间分析');
 assert.equal(events.find(event=>event.kind==='tool_start').toolCallId,'call_offline_1');
 assert.equal(events.find(event=>event.kind==='tool_end').toolCallId,'call_offline_1');
 assert.ok(events.some(event=>event.kind==='artifact'&&event.detail==='work/S5.5-offline.md'));
 assert.equal(await readFile(path.join(root,'work/S5.5-offline.md'),'utf8'),'离线模拟：实际工具已保存中间分析。');
 const second=await harness.run('同一会话继续，确认已保存产物。',{sessionId});assert.equal(second.sessionId,first.sessionId);assert.equal(requests,3);
 console.log(JSON.stringify({initializedWithoutModelCall:true,localMockRequests:requests,toolCallId:'call_offline_1',sessionReused:true}));
}finally{await harness.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
