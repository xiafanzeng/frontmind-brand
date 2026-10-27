import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readDocument,writeDocument,listDocuments} from '../workflows/report-harness/safe-files.mjs';
import {publicAddress,publicResearchUrl,searchResults,searchRelevance,sogouSearchResults,sogouRedirectTarget,researchSearch,fetchPublicPage} from '../workflows/report-harness/research.mjs';
import {publicEvents} from '../workflows/report-harness/events.mjs';
import {reportRuntimePatch} from '../workflows/report-harness/runtime-config.mjs';

test('report tools keep documents inside their root and refuse symbolic links',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'report-files-'));
 try{
  await mkdir(path.join(root,'work'));await writeDocument(root,'work/S1-note.md','研究结果');
  assert.equal(await readDocument(root,'work/S1-note.md'),'研究结果');
  assert.deepEqual((await listDocuments(root)).map(item=>item.id),['work/S1-note.md']);
  await assert.rejects(writeDocument(root,'../escape.json','{}'),/PATH_INVALID/);
  await assert.rejects(writeDocument(root,'work\\escape.json','{}'),/PATH_INVALID/);
  await symlink(path.join(root,'work/S1-note.md'),path.join(root,'work/linked.md'));
  await assert.rejects(readDocument(root,'work/linked.md'),/LINK_FORBIDDEN/);
  assert.equal((await listDocuments(root)).length,1);
  await writeFile(path.join(root,'work/large.json'),'x'.repeat(600000));const list=await listDocuments(root);assert.equal(list.length,2);assert.equal(list.find(item=>item.title==='large.json').truncated,true);assert.equal(list.find(item=>item.title==='large.json').text.length,2048);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('research excludes private IPs, business APIs, credentials and internal frontmind hosts',async()=>{
 for(const value of ['127.0.0.1','10.0.0.1','172.16.1.2','169.254.169.254','192.168.1.2','100.64.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(value),false,value);
 assert.equal(publicAddress('8.8.8.8'),true);
 for(const value of ['http://example.org/','https://localhost/','https://brand.frontmind.cn/','https://api.deepseek.com/','https://example.org/api/orders','https://example.org/?api_key=x','https://user:pass@example.org/'])assert.throws(()=>publicResearchUrl(value),undefined,value);
 assert.equal(publicResearchUrl('https://example.org/about').href,'https://example.org/about');
 let requested=false;await assert.rejects(fetchPublicPage('https://example.org/',{dnsLookup:async()=>[{address:'127.0.0.1'}],request:()=>{requested=true;}}),/ADDRESS_DENIED/);assert.equal(requested,false);
});

test('search parses observed results and preserves source URLs',()=>{
 assert.deepEqual(searchResults('<li class="b_algo"><h2><a href="https://example.org/about">真实官网</a></h2><p>公开信息</p></li>'),[{title:'真实官网',url:'https://example.org/about',snippet:'真实官网 公开信息'}]);
 assert.deepEqual(searchResults('captcha'),[]);
});

test('search relevance rejects unrelated Bing results without requiring an exact query match',()=>{
 assert.equal(searchRelevance('东莞台心医院 医学美容科',[{title:'Speedtest by Ookla',snippet:'Test your internet connection.'}]).related,false);
 assert.equal(searchRelevance('东莞台心医院 医学美容科',[{title:'东莞市人民政府',snippet:'东莞旅游景点与城市介绍'}]).related,false);
 assert.equal(searchRelevance('东莞台心医院 医学美容科',[{title:'台心医院美容科介绍',snippet:'公开介绍'}]).related,true);
 assert.equal(searchRelevance('Microsoft official website',[{title:'Microsoft – Cloud, Productivity and Gaming',snippet:'Explore our products'}]).related,true);
 assert.equal(searchRelevance('工业机器人 伺服电机 精度',[{title:'伺服电机的控制精度',snippet:'工业应用'}]).related,true);
});

const sogouFixture='<div class="vrwrap"><div class="struct201102"><h3 class="vr-title  " vrcid="title.ba18e87"><a target="_blank" href="/link?url=observed&amp;x=1"><em><!--red_beg-->示例企业<!--red_end--></em>电池技术</a></h3><div class="fz-mid space-txt">公开的<em>电池</em>研发资料</div></div></div>';
test('Sogou parses observed vr-title structure and validates literal redirect targets',()=>{
 assert.deepEqual(sogouSearchResults(sogouFixture),[{title:'示例企业 电池技术',url:'https://www.sogou.com/link?url=observed&x=1',snippet:'示例企业 电池技术 公开的 电池 研发资料'}]);
 assert.equal(sogouRedirectTarget('<script>window.location.replace("https://example.org/research?a=1&b=2")</script>'),'https://example.org/research?a=1&b=2');
 for(const target of ['http://example.org','https://127.0.0.1/','https://brand.frontmind.cn/','https://example.org/api/private'])assert.throws(()=>sogouRedirectTarget(`<script>window.location.replace(${JSON.stringify(target)})</script>`));
 assert.throws(()=>sogouRedirectTarget('<script>window.location.replace(getTarget())</script>'),/UNREADABLE/);
});

test('unrelated Bing results fall back with observed engine, reason and safe final URLs',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'report-search-'));
 try{
  const calls=[];
  const result=await researchSearch('示例企业 电池技术',{root,stage:'S3',dnsLookup:async()=>[{address:'8.8.8.8'}],loadPage:async url=>{
   calls.push(url);return {url,fetchedAt:'2026-10-27T00:00:00Z',html:url.includes('bing.com')?'<li class="b_algo"><h2><a href="https://speedtest.net/">Speedtest</a></h2><p>Internet speed test</p></li>':url.includes('/web?')?sogouFixture:'<script>window.location.replace("https://example.org/research")</script>'};
  }});
  assert.equal(result.engine,'Sogou public web');assert.equal(result.attempts[0].reason,'unrelated_results');assert.equal(result.results[0].url,'https://example.org/research');assert.equal(calls.length,3);
  assert.equal(JSON.parse(await readDocument(root,result.artifact)).results[0].url,result.results[0].url);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a Sogou redirect resolving to a private address fails with durable diagnostics',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'report-search-'));
 try{
  await assert.rejects(researchSearch('示例企业 电池技术',{root,stage:'S3',dnsLookup:async()=>[{address:'10.0.0.1'}],loadPage:async url=>({url,html:url.includes('bing.com')?'captcha':url.includes('/web?')?sogouFixture:'<script>window.location.replace("https://example.org/private")</script>'})}),/NO_RELEVANT_RESULTS/);
  const documents=await listDocuments(root);const diagnostic=JSON.parse(await readDocument(root,documents[0].id));
  assert.equal(diagnostic.status,'failed');assert.equal(diagnostic.attempts.at(-1).reason,'no_safe_related_targets');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pinned public DNS supports both Node lookup callback modes',async()=>{
 for(const all of [false,true]){
  const page=await fetchPublicPage('https://example.org/about',{dnsLookup:async()=>[{address:'8.8.8.8'}],request:(_url,options,receive)=>{
   options.lookup('example.org',{all},(error,address,family)=>{assert.equal(error,null);if(all)assert.deepEqual(address,[{address:'8.8.8.8',family:4}]);else{assert.equal(address,'8.8.8.8');assert.equal(family,4);}});
   const request=new EventEmitter();request.end=()=>{const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'text/html'};receive(response);response.end('<h1>Observed public page</h1>');};return request;
  }});
  assert.equal(page.html,'<h1>Observed public page</h1>');
 }
});

test('public event projection hides reasoning and pairs tool calls with official callId',()=>{
 const emit=event=>publicEvents({method:'session.event',params:{event}});
 const start=emit({type:'tool/call',data:{name:'fetch_public_page',callId:'call-1',step:2,arguments:'{"url":"https://example.org"}'}})[0];assert.equal(start.toolCallId,'call-1');assert.equal(start.message,'核查公开网页');
 const end=emit({type:'tool/result',data:{step:2,message:{toolCallId:'call-1',content:[{type:'text',text:'{"artifact":"work/source.md"}'}],isError:false}}});assert.equal(end[0].toolCallId,'call-1');assert.equal(end[1].kind,'artifact');
 const text=emit({type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'private-thought'},{type:'text',text:'公开结果'}]},stream:[{reasoning:'private-stream'}],usage:{inputTokens:3,outputTokens:5,reasoningTokens:999}}});
 assert.equal(text[0].message,'公开结果');assert.ok(!JSON.stringify(text).includes('private'));assert.ok(!JSON.stringify(text).includes('reasoningTokens'));
 assert.deepEqual(emit({type:'assistant/attempt',data:{stream:[{text:'private'}]}}),[]);
});

test('production patch fixes the official model route and disables shell tools',()=>{
 const patch=reportRuntimePatch({root:'/safe/report',stageConfig:'/safe/report/current-stage.json'});
 for(const id of ['persistent-bash','persistent-pwsh','terminal-bash','terminal-pwsh','session-log-deepseek','llm-deepseek'])assert.ok(patch.some(row=>row.id===id&&row.disabled===true));
 const provider=patch.find(row=>row.insert).insert.find(row=>row.id==='llm-pi-ai').config.providers['frontmind-deepseek'];
 assert.equal(provider.baseURL,'https://api.deepseek.com/v1');assert.equal(provider.models[0].id,'deepseek-flash');assert.equal(provider.apiKeyEnv,'REPORT_DEEPSEEK_API_KEY');assert.ok(!JSON.stringify(patch).includes('xty'));
});

test('official SDK initializes without a model call, executes a local mock tool and reuses its session',{timeout:90000},async(t)=>{
 const require=createRequire(import.meta.url);
 const node=process.env.REPORT_HARNESS_NODE_BIN??(Number(process.versions.node.split('.')[0])>=24?process.execPath:process.platform==='linux'&&process.arch==='x64'?require.resolve('node-linux-x64/bin/node'):undefined);
 if(!node){t.skip('本机需 Node 24 或 REPORT_HARNESS_NODE_BIN 执行 SDK 检验；Linux 构建使用随模块安装的私有 Node 24。');return;}
 const {stdout}=await promisify(execFile)(node,[fileURLToPath(new URL('./helpers/report-harness-sdk-offline.mjs',import.meta.url))],{timeout:80000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,LANG:process.env.LANG,TMPDIR:process.env.TMPDIR}});
 const result=JSON.parse(stdout.trim());assert.equal(result.initializedWithoutModelCall,true);assert.equal(result.sessionReused,true);assert.equal(result.localMockRequests,3);
});
