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
export async function researchSearch(query,{root,stage,signal}={}){
 if(typeof query!=='string'||query.length<2||query.length>300)throw new Error('REPORT_RESEARCH_QUERY_INVALID');
 const page=await fetchPublicPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}`,{signal});
 const results=searchResults(page.html);if(!results.length)throw new Error('REPORT_SEARCH_NO_READABLE_RESULTS: 搜索引擎未返回可读取结果；请根据已知官网直接抓取，不得虚构检索结果。');
 const text=JSON.stringify({query,engine:'Bing public web',fetchedAt:page.fetchedAt,results},null,2);
 const artifact=`work/${stage}-search-${createHash('sha256').update(query).digest('hex').slice(0,12)}.json`;await writeDocument(root,artifact,text);
 return {artifact,query,results};
}
export async function researchFetch(url,{root,stage,signal}={}){
 const page=await fetchPublicPage(url,{signal});const text=htmlText(page.html).slice(0,50000);
 const artifact=`work/${stage}-source-${createHash('sha256').update(page.url).digest('hex').slice(0,12)}.md`;
 await writeDocument(root,artifact,`# 公开来源\n\nURL: ${page.url}\n抓取时间: ${page.fetchedAt}\n\n${text}`);
 return {url:page.url,fetchedAt:page.fetchedAt,artifact,text};
}
