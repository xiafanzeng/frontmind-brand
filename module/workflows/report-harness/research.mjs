import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {writeDocument} from './safe-files.mjs';

export function publicAddress(address){
 if(isIP(address)===6)return false; // The pinned fetch implementation deliberately uses public IPv4 only.
 if(isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===198&&(b===18||b===19)));
}
export function publicResearchUrl(raw){
 const url=new URL(raw);
 if(url.protocol!=='https:'||(url.port&&url.port!=='443')||url.username||url.password||url.hash||url.href.length>3000)throw new Error('REPORT_RESEARCH_URL_DENIED');
 const host=url.hostname.toLowerCase();
 if(isIP(host)||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||host==='frontmind.cn'||host.endsWith('.frontmind.cn')||host==='frontmind.net'||host.endsWith('.frontmind.net')||/(^|[.-])(api|admin|dashboard|console|metadata)([.-]|$)/.test(host))throw new Error('REPORT_RESEARCH_HOST_DENIED');
 if(/\/(?:api|graphql|rpc|admin|login|logout|order|pay|checkout|publish|submit)(?:\/|$)/i.test(url.pathname)||[...url.searchParams.keys()].some(key=>/token|secret|api.?key|password|authorization/i.test(key)))throw new Error('REPORT_RESEARCH_BUSINESS_API_DENIED');
 return url;
}
export async function fetchPublicPage(raw,{signal,dnsLookup=lookup,request=https.request}={}){
 let url=publicResearchUrl(raw);
 for(let redirects=0;redirects<=3;redirects++){
  signal?.throwIfAborted();const resolved=await dnsLookup(url.hostname,{family:4,all:true});
  if(!resolved.length||resolved.some(row=>!publicAddress(row.address)))throw new Error('REPORT_RESEARCH_ADDRESS_DENIED');
  const ip=resolved[0].address;
  const response=await new Promise((resolve,reject)=>{
   const req=request(url,{method:'GET',signal,timeout:20000,headers:{'User-Agent':'FrontMind-Report-Research/1.0','Accept':'text/html,text/plain,application/xhtml+xml'},lookup:(_host,options,callback)=>options.all?callback(null,[{address:ip,family:4}]):callback(null,ip,4)},res=>{
    if([301,302,303,307,308].includes(res.statusCode)){res.resume();resolve({redirect:res.headers.location});return;}
    if(res.statusCode<200||res.statusCode>=300){res.resume();reject(new Error(`REPORT_RESEARCH_HTTP_${res.statusCode}`));return;}
    if(!/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(res.headers['content-type']??'')){res.resume();reject(new Error('REPORT_RESEARCH_CONTENT_TYPE_DENIED'));return;}
    const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(new Error('REPORT_RESEARCH_PAGE_TOO_LARGE'));return;}chunks.push(chunk);});
    res.on('error',reject);res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
   });
   req.on('timeout',()=>req.destroy(new Error('REPORT_RESEARCH_TIMEOUT')));req.on('error',reject);req.end();
  });
  if(response.redirect){url=publicResearchUrl(new URL(response.redirect,url).href);continue;}
  return {url:url.href,html:response.html,fetchedAt:new Date().toISOString()};
 }
 throw new Error('REPORT_RESEARCH_REDIRECT_LIMIT');
}
export function htmlText(html){return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,match=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[match]).replace(/\s+/g,' ').trim();}
export function searchResults(html){
 const results=[];
 for(const match of html.matchAll(/<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)){
  const anchor=match[1].match(/<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);if(!anchor)continue;
  let target=anchor[1].replace(/&amp;/g,'&');
  try{const link=new URL(target);if(link.hostname.endsWith('bing.com')&&link.pathname.startsWith('/ck/')){const value=link.searchParams.get('u');if(value?.startsWith('a1'))target=Buffer.from(value.slice(2),'base64').toString('utf8');}target=publicResearchUrl(target).href;}catch{continue;}
  results.push({title:htmlText(anchor[2]).slice(0,250),url:target,snippet:htmlText(match[1]).slice(0,1400)});if(results.length===8)break;
 }
 return results;
}
/** Reject only clearly unrelated result sets. This is a lexical sanity check,
 * not a claim that a matching page is true or authoritative. */
export function searchRelevance(query,results){
 const normalized=query.normalize('NFKC').toLowerCase();
 const units=new Set(normalized.match(/[a-z0-9][a-z0-9.+-]{2,}/g)??[]);
 for(const word of normalized.match(/[\p{Script=Han}]+/gu)??[]){
  if(word.length===1)continue;
  for(let i=0;i<word.length-1;i++)units.add(word.slice(i,i+2));
 }
 if(!units.size)return {related:results.length>0,coverage:null};
 const coverage=Math.max(0,...results.map(result=>{
  const text=`${result.title} ${result.snippet}`.normalize('NFKC').toLowerCase();
  return [...units].filter(unit=>text.includes(unit)).length/units.size;
 }));
 return {related:results.length>0&&coverage>=0.2,coverage};
}
export function sogouSearchResults(html){
 const headings=[...html.matchAll(/<h3\b[^>]*class=["'][^"']*\bvr-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi)],results=[];
 for(let index=0;index<headings.length;index++){
  const match=headings[index],anchor=match[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);if(!anchor)continue;
  let url;try{url=publicResearchUrl(new URL(anchor[1].replace(/&amp;/g,'&'),'https://www.sogou.com').href).href;}catch{continue;}
  const block=html.slice(match.index+match[0].length,headings[index+1]?.index??html.length);
  const summary=block.match(/<(?:div|p)\b[^>]*class=["'][^"']*\b(?:fz-mid|str_info)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1]??'';
  const title=htmlText(anchor[2]).slice(0,250);
  results.push({title,url,snippet:`${title} ${htmlText(summary)}`.trim().slice(0,1400)});if(results.length===8)break;
 }
 return results;
}
export function sogouRedirectTarget(html){
 // Parse a literal from the observed redirect page; never evaluate its script.
 const literal=html.match(/window\.location\.replace\(\s*("(?:[^"\\]|\\.)*")\s*\)/)?.[1];
 if(!literal)throw new Error('REPORT_SEARCH_REDIRECT_UNREADABLE');
 return publicResearchUrl(JSON.parse(literal)).href;
}
async function resolveSogouResult(result,{signal,loadPage,dnsLookup}){
 const url=new URL(result.url);
 if(url.hostname!=='www.sogou.com'||url.pathname!=='/link')return result;
 const page=await loadPage(url.href,{signal});
 const target=page.url===url.href?sogouRedirectTarget(page.html):publicResearchUrl(page.url).href;
 if(new URL(target).hostname==='www.sogou.com')throw new Error('REPORT_SEARCH_REDIRECT_UNREADABLE');
 const addresses=await dnsLookup(new URL(target).hostname,{family:4,all:true});
 if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw new Error('REPORT_RESEARCH_ADDRESS_DENIED');
 return {...result,url:target};
}
export async function researchSearch(query,{root,stage,signal,loadPage=fetchPublicPage,dnsLookup=lookup}={}){
 if(typeof query!=='string'||query.length<2||query.length>300)throw new Error('REPORT_RESEARCH_QUERY_INVALID');
 const attempts=[],artifact=`work/${stage}-search-${createHash('sha256').update(query).digest('hex').slice(0,12)}.json`;
 const engines=[{name:'Bing public web',url:`https://www.bing.com/search?q=${encodeURIComponent(query)}`,parse:searchResults},
  {name:'Sogou public web',url:`https://www.sogou.com/web?query=${encodeURIComponent(query)}`,parse:sogouSearchResults}];
 for(const engine of engines){
  signal?.throwIfAborted();
  try{
   const page=await loadPage(engine.url,{signal});let results=engine.parse(page.html);
   let relevance=searchRelevance(query,results);
   if(!relevance.related){attempts.push({engine:engine.name,url:page.url,reason:results.length?'unrelated_results':'no_readable_results',coverage:relevance.coverage,resultCount:results.length});continue;}
   if(engine.name==='Sogou public web'){
    const resolved=await Promise.allSettled(results.map(result=>resolveSogouResult(result,{signal,loadPage,dnsLookup})));
    signal?.throwIfAborted();results=resolved.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
    relevance=searchRelevance(query,results);
    if(!relevance.related){attempts.push({engine:engine.name,url:page.url,reason:'no_safe_related_targets',coverage:relevance.coverage,resultCount:results.length});continue;}
   }
   const result={artifact,query,engine:engine.name,searchUrl:page.url,fetchedAt:page.fetchedAt,results,
    ...(attempts.length?{fallbackReason:'前序搜索未得到相关、可读取的结果，已切换公开搜索引擎。',attempts}:{})};
   await writeDocument(root,artifact,JSON.stringify(result,null,2));return result;
  }catch(error){signal?.throwIfAborted();attempts.push({engine:engine.name,url:engine.url,reason:String(error?.message??error).slice(0,300)});}
 }
 await writeDocument(root,artifact,JSON.stringify({query,status:'failed',attempts},null,2));
 throw new Error('REPORT_SEARCH_NO_RELEVANT_RESULTS: 公开搜索没有返回相关且可安全访问的结果，诊断已保存。请根据已知官网直接核查并注明检索限制，不得引用无关结果或虚构来源。');
}
export async function researchFetch(url,{root,stage,signal}={}){
 const page=await fetchPublicPage(url,{signal});const text=htmlText(page.html).slice(0,50000);
 const artifact=`work/${stage}-source-${createHash('sha256').update(page.url).digest('hex').slice(0,12)}.md`;
 await writeDocument(root,artifact,`# 公开来源\n\nURL: ${page.url}\n抓取时间: ${page.fetchedAt}\n\n${text}`);
 return {url:page.url,fetchedAt:page.fetchedAt,artifact,text};
}
