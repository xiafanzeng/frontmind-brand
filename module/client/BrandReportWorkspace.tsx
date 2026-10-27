import {useEffect,useMemo,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {ArrowRight,Check,CheckCircle2,ChevronRight,Download,FileBarChart2,FileText,Loader2,RefreshCw,Search,ShieldCheck,Sparkles,Square} from 'lucide-react';
import {captureWorkspaceRestOperation,projectResourceUrl} from './host';
import {REPORT_PLATFORMS,REPORT_STAGES,type ReportRunView,type ReportWorkspace,type ReportProcessView} from '../contracts/report-run';
import './brand-report-workspace.css';

type Workspace=ReportWorkspace&{profileHash:string};
const labels:Record<ReportRunView['phase'],string>={researching:'正在研究',awaiting_confirmation:'请确认诊断范围',monitoring:'正在采集回答',analyzing:'正在分析与制定方案',rendering:'正在生成报告',completed:'报告已完成',failed:'当前步骤未完成',cancelled:'已停止'};
const steps=['选择资料','企业与市场研究','确认诊断范围','诊断与方案','交付报告'];
function stepFor(run:ReportRunView|null){return !run?0:run.phase==='researching'?1:run.phase==='awaiting_confirmation'?2:['monitoring','analyzing'].includes(run.phase)?3:['failed','cancelled'].includes(run.phase)?(!run.stages.some(stage=>stage.id==='S4.8')?1:3):4;}
export default function BrandReportWorkspace({projectId,preview=false}:{projectId:string;preview?:boolean}){
 const operation=useMemo(()=>captureWorkspaceRestOperation(),[projectId]);
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[selected,setSelected]=useState<string|null>(()=>new URLSearchParams(window.location.search).get('report')),[creating,setCreating]=useState(false);
 const [includeKnowledge,setIncludeKnowledge]=useState(false),[product,setProduct]=useState(''),[platforms,setPlatforms]=useState<string[]>(REPORT_PLATFORMS.map(p=>p.id));
 const [subjectMode,setSubjectMode]=useState<'company'|'focus'>('company'),[subjectScope,setSubjectScope]=useState('');
 const [eventStage,setEventStage]=useState('all'),[showAllEvents,setShowAllEvents]=useState(false);
 const [loading,setLoading]=useState(!preview),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=creating?null:workspace?.runs.find(r=>r.id===selected)??workspace?.runs[0]??null;
 useEffect(()=>{if(!run)return;const url=new URL(window.location.href);url.searchParams.set('report',run.id);window.history.replaceState(null,'',url);},[run?.id]);
 async function request<T>(tail='',input?:unknown):Promise<T>{
  operation.assertActive();const response=await operation.fetch(`/api/modules/brand/reports${tail}`,{method:input===undefined?'GET':'POST',credentials:'same-origin',headers:operation.headers(input===undefined?{}:{'Content-Type':'application/json'}),body:input===undefined?undefined:JSON.stringify(input)});
  const value=await response.json();operation.assertActive();if(!response.ok)throw new Error(value?.error?.message??'报告服务暂不可用，请重新读取。');return value;
 }
 async function refresh(){if(preview)return;try{const value=await request<Workspace>();setWorkspace(value);setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{let live=true;const load=async()=>{if(!live)return;await refresh();};void load();const timer=setInterval(()=>void load(),3000);return()=>{live=false;clearInterval(timer);};},[operation,preview]);
 useEffect(()=>{setProduct(run?.products[0]?.id??'');setPlatforms(run?.platforms.length?run.platforms:REPORT_PLATFORMS.map(p=>p.id));},[run?.id,run?.products.length]);
 async function action(fn:()=>Promise<ReportRunView>){setBusy(true);setError('');try{const result=await fn();setSelected(result.id);setCreating(false);await refresh();}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重新读取。');}finally{setBusy(false);}}
 const [process,setProcess]=useState<ReportProcessView>({events:[],nextCursor:0,hasMore:false,documents:[],intermediate:[]});
 const [processError,setProcessError]=useState('');
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setTimeout>|undefined,cursor=0;
  setProcess({events:[],nextCursor:0,hasMore:false,documents:[],intermediate:[]});setProcessError('');
  if(!run?.id||preview)return;
  const id=run.id;
  const poll=async()=>{try{
   const next=await request<ReportProcessView>(`/${id}/process?after=${cursor}`);
   if(!live)return;cursor=next.nextCursor;
   setProcess(current=>({...next,events:[...current.events,...next.events.filter(event=>!current.events.some(old=>old.seq===event.seq))]}));
   setProcessError('');timer=setTimeout(()=>void poll(),next.hasMore?50:2000);
  }catch(e){if(live){setProcessError(e instanceof Error?e.message:'过程记录暂不可用');timer=setTimeout(()=>void poll(),5000);}}};
  void poll();return()=>{live=false;if(timer)clearTimeout(timer);};
 },[run?.id,operation,preview]);
 const artifactUrl=(file:string,download=false)=>projectResourceUrl(`/api/modules/brand/reports/${run?.id}/files/${file}${download?'?download=1':''}`);
 const chosenProduct=run?.products.find(p=>p.id===product);
 const statusStep=stepFor(run);
 const start=()=>action(()=>request('',{clientRequestId:crypto.randomUUID(),includeKnowledge,profileHash:workspace?.profileHash,...(subjectMode==='focus'?{subjectScope:subjectScope.trim()}:{})}));
 const filteredEvents=process.events.filter(event=>eventStage==='all'||event.stageId===eventStage);
 const visibleEvents=showAllEvents?filteredEvents:filteredEvents.slice(-80);
 const currentStageLabel=REPORT_STAGES.find(stage=>stage[0]===run?.currentStage)?.[1]??run?.currentStage;
 return <section className="brand-report" aria-label="品牌诊断报告">
  <aside className="brand-report__history">
   <div className="brand-report__history-heading"><FileBarChart2 size={19}/><strong>品牌诊断报告</strong></div>
   <button className="brand-report__new" onClick={()=>{setCreating(true);setError('');}}>＋ 新建报告</button>
   <div className="brand-report__history-list">{workspace?.runs.map(item=><button key={item.id} className={`brand-report__history-item ${run?.id===item.id?'is-active':''}`} onClick={()=>{setSelected(item.id);setCreating(false);}}><span>{item.brandName}</span><small>{new Date(item.createdAt).toLocaleDateString('zh-CN')} · {labels[item.phase]}</small></button>)}</div>
   <p className="brand-report__history-note">研究过程与报告保存在当前企业工作区。</p>
  </aside>
  <main className="brand-report__main">
   <header className="brand-report__heading"><div><p className="brand-report__eyebrow">BRAND INTELLIGENCE</p><h1>先看清现状，再制定品牌方案</h1><p>从企业资料出发，理解市场、检查 AI 回答，形成完整诊断和可执行的推进方案。</p></div><button className="brand-report__icon" onClick={()=>void refresh()} aria-label="重新读取报告"><RefreshCw size={17}/></button></header>
   <ol className="brand-report__steps">{steps.map((label,index)=><li key={label} className={index===statusStep?'is-current':index<statusStep?'is-done':''}><span>{index<statusStep?<Check size={14}/>:index+1}</span>{label}{index<4&&<ChevronRight size={14}/>}</li>)}</ol>
   {error&&<div className="brand-report__error" role="alert">{error}</div>}
   {preview?<div className="brand-report__empty"><FileBarChart2 size={32}/><h2>品牌诊断报告</h2><p>正式工作区中可以选择企业资料，确认诊断问题并生成全景报告与汇报报告。</p></div>:loading?<p role="status" className="brand-report__loading"><Loader2 className="spin" size={18}/>正在读取企业与报告…</p>:!run?<>
    <div className="brand-report__section-title"><span>01</span><div><h2>选择本轮研究资料</h2><p>企业资料会随任务保存，后续修改不会改变本轮报告。</p></div></div>
    <fieldset className="brand-report__scope"><legend>本轮研究主体</legend><div className="brand-report__option-grid">
     <button type="button" className={`brand-report__option ${subjectMode==='company'?'is-selected':''}`} aria-pressed={subjectMode==='company'} onClick={()=>setSubjectMode('company')}><strong>企业整体</strong><span>{workspace?.company.name}</span></button>
     <button type="button" className={`brand-report__option ${subjectMode==='focus'?'is-selected':''}`} aria-pressed={subjectMode==='focus'} onClick={()=>setSubjectMode('focus')}><strong>聚焦业务或部门</strong><span>以指定业务为研究主体，企业整体资料作为背景</span></button></div>
     {subjectMode==='focus'&&<label className="brand-report__scope-field">业务或部门名称<input value={subjectScope} onChange={event=>setSubjectScope(event.target.value)} maxLength={120} placeholder="填写本轮研究的业务或部门"/><small>研究主体：{workspace?.company.name}（{subjectScope.trim()||'待填写'}）</small></label>}
    </fieldset>
    <div className="brand-report__source-grid"><button className="brand-report__source is-selected" aria-pressed="true" type="button"><div className="brand-report__card-icon"><FileText size={22}/></div><span className="brand-report__check"><Check size={14}/></span><h3>{workspace?.company.name||'当前企业'}</h3><p>{workspace?.company.summary||'使用当前企业资料，自动研究公开信息与市场情况。'}</p><small>当前企业 · 已选择</small></button>
    <button type="button" disabled={!workspace?.knowledge.available} className={`brand-report__source ${includeKnowledge?'is-selected':''}`} aria-pressed={includeKnowledge} onClick={()=>setIncludeKnowledge(!includeKnowledge)}><div className="brand-report__card-icon"><Search size={22}/></div>{includeKnowledge&&<span className="brand-report__check"><Check size={14}/></span>}<h3>已有品牌知识库</h3><p>{workspace?.knowledge.available?`补充 ${workspace.knowledge.documentCount} 份已发布知识，帮助核实产品、服务与品牌事实。`:'还没有已发布知识库。可以直接基于企业资料开始研究。'}</p><small>{workspace?.knowledge.available?'可选资料':'暂未建立'}</small></button></div>
    <div className="brand-report__start-note"><ShieldCheck size={18}/><span>研究后会先请你确认诊断问题与平台。确认后，采集、分析和报告生成自动继续。</span></div>
    {!workspace?.company.ready&&<p className="brand-report__warning">请先完善当前企业资料，确定企业名称。</p>}
    <button className="brand-report__primary" disabled={busy||!workspace?.company.ready||(subjectMode==='focus'&&!subjectScope.trim())} onClick={()=>void start()}>{busy?<Loader2 className="spin" size={17}/>:<Sparkles size={17}/>}开始品牌研究<ArrowRight size={17}/></button>
    <div className="brand-report__deliverables"><div><FileBarChart2 size={23}/><h3>全景报告</h3><p>完整研究、诊断证据、品牌策略与行动路径</p><small>在线预览 / HTML 下载</small></div><div><FileText size={23}/><h3>汇报报告</h3><p>把关键结论与方案组织成清晰的汇报内容</p><small>在线预览 / HTML 下载</small></div></div>
   </>:<>
    <div className="brand-report__run-heading"><div><h2>{run.brandName}</h2><p>{new Date(run.createdAt).toLocaleString('zh-CN')} 创建</p></div><span className={`brand-report__status brand-report__status--${run.phase}`}>{!['completed','failed','cancelled','awaiting_confirmation'].includes(run.phase)&&<Loader2 className="spin" size={14}/>} {labels[run.phase]}</span>{run.canStop&&<button className="brand-report__secondary" disabled={busy} onClick={()=>void action(()=>request(`/${run.id}/stop`,{}))}><Square size={14}/>停止本轮</button>}</div>
    {run.phase==='awaiting_confirmation'&&<section className="brand-report__confirmation" aria-label="确认诊断范围"><div className="brand-report__section-title"><span>03</span><div><h2>确认本轮诊断范围</h2><p>选择一个核心产品与采集平台，确认后自动完成后续分析和两份报告。</p></div></div>
     <h3>先检查哪类产品或服务？</h3><div className="brand-report__option-grid">{run.products.map(item=><button type="button" key={item.id} aria-pressed={product===item.id} className={`brand-report__option ${product===item.id?'is-selected':''}`} onClick={()=>setProduct(item.id)}><strong>{item.label}</strong><span>{item.question}</span>{product===item.id&&<CheckCircle2 size={17}/>}</button>)}</div>
     <div className="brand-report__questions"><p><span>问题 1</span>{chosenProduct?.question??'请选择一个核心产品'}</p><p><span>问题 2</span>{run.brandName}有什么缺点和问题？</p></div>
     <h3>在哪些 AI 平台采集？</h3><div className="brand-report__platforms">{REPORT_PLATFORMS.map(p=><button type="button" key={p.id} aria-pressed={platforms.includes(p.id)} className={platforms.includes(p.id)?'is-selected':''} onClick={()=>setPlatforms(current=>current.includes(p.id)?current.filter(id=>id!==p.id):[...current,p.id])}>{platforms.includes(p.id)&&<Check size={15}/>} {p.label}</button>)}</div>
     <p className="brand-report__muted">每个问题在每个平台采集 5 次，共 {platforms.length*10} 份真实回答。</p>
     <button className="brand-report__primary" disabled={busy||!product||!platforms.length} onClick={()=>void action(()=>request(`/${run.id}/confirm`,{expectedRevision:run.revision,productId:product,platforms}))}>{busy?<Loader2 className="spin" size={17}/>:<CheckCircle2 size={17}/>}确认并继续</button>
    </section>}
    {run.phase==='monitoring'&&<div className="brand-report__progress-card"><div><Loader2 className="spin" size={20}/><strong>正在采集诊断回答</strong><span>{run.sampleCount} / {run.expectedSamples}</span></div><progress value={run.sampleCount} max={run.expectedSamples||1}/><p>回答与引用来源会逐笔保存，完成后自动进入诊断分析。</p></div>}
    {['failed','cancelled'].includes(run.phase)&&<div className="brand-report__error" role="alert"><strong>{run.phase==='cancelled'?'本轮已停止':`${run.currentStage}未完成`}</strong><p>{run.error?.message}</p>{run.canRetry&&<button disabled={busy} className="brand-report__secondary" onClick={()=>void action(()=>request(`/${run.id}/retry`,{}))}><RefreshCw size={15}/>恢复本轮任务</button>}</div>}
    {run.phase==='completed'&&<section className="brand-report__results" aria-label="报告成果"><div className="brand-report__section-title"><span><Check size={18}/></span><div><h2>两份报告已就绪</h2><p>完整诊断留作研究依据，汇报内容用于展示与讨论。</p></div></div><div className="brand-report__result-grid">
     <article><div className="brand-report__card-icon"><FileBarChart2 size={26}/></div><h3>全景报告</h3><p>企业事实、市场趋势、真实诊断、品牌策略和行动方案。</p><a className="brand-report__primary" href={artifactUrl('panorama.html')} target="_blank" rel="noreferrer">打开全景报告<ArrowRight size={16}/></a><a className="brand-report__download" href={artifactUrl('panorama.html',true)}><Download size={16}/>下载全景 HTML</a></article>
     <article><div className="brand-report__card-icon"><FileText size={26}/></div><h3>汇报报告</h3><p>关键指标、诊断结论与推进路线，与全景报告使用同一批实测数据。</p><a className="brand-report__primary" href={artifactUrl('briefing.html')} target="_blank" rel="noreferrer">打开汇报报告<ArrowRight size={16}/></a><a className="brand-report__download" href={artifactUrl('briefing.html',true)}><Download size={16}/>下载汇报 HTML</a></article>
    </div><a className="brand-report__bundle" href={artifactUrl('reports.zip',true)}><Download size={16}/>下载全部报告与证据 ZIP</a></section>}
    <section className="brand-report__research" aria-label="报告执行过程">
     <div className="brand-report__section-title"><span><Search size={18}/></span><div><h2>执行过程</h2><p>查看当前进展、工具结果和已保存的研究正文。</p></div></div>
     <div className="brand-report__live-status" role="status"><strong>{labels[run.phase]} · {currentStageLabel}</strong><p>{process.events.at(-1)?.message??'正在读取已保存的过程记录…'}</p><small>执行模型：{run.model} · 已保存 {process.documents.length} 个阶段 · {run.sampleCount}/{run.expectedSamples||30} 份采集</small></div>
     <div className="brand-report__stage-index">{REPORT_STAGES.map(([id,label])=><span key={id} className={run.stages.some(s=>s.id===id)?'is-done':run.currentStage===id?'is-current':''}>{run.stages.some(s=>s.id===id)&&<Check size={12}/>} {label}</span>)}</div>
     {processError&&<p role="alert" className="brand-report__warning">{processError}</p>}
     <div className="brand-report__process-filter"><label>查看阶段 <select value={eventStage} onChange={event=>{setEventStage(event.target.value);setShowAllEvents(false);}}><option value="all">全部阶段</option>{[...new Set(process.events.map(event=>event.stageId))].map(id=><option key={id} value={id}>{REPORT_STAGES.find(stage=>stage[0]===id)?.[1]??id}</option>)}</select></label>{filteredEvents.length>80&&<button className="brand-report__secondary" onClick={()=>setShowAllEvents(!showAllEvents)}>{showAllEvents?'收起较早记录':`展开全部 ${filteredEvents.length} 条记录`}</button>}</div>
     <ol className="brand-report__timeline">{visibleEvents.map(event=><li key={event.seq} className={`brand-report__event brand-report__event--${event.kind}`}>
      <div className="brand-report__event-meta"><time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time><span>{event.stageId}</span><span>{{status:'进度',text:'输出',tool_start:'工具调用',tool_end:'工具结果',usage:'用量',artifact:'文件已保存',error:'未完成'}[event.kind]}</span></div>
      <div className="brand-report__event-message">{event.message}</div>
      {event.detail&&<details><summary>查看详情</summary><pre>{event.detail}</pre></details>}
     </li>)}</ol>
     {!process.events.length&&<p className="brand-report__muted">{run.engine==='legacy'?'这份历史报告没有实时执行记录，已完成的研究正文保留在下方。':'准备开始，执行记录会自动更新。'}</p>}
     {!!process.intermediate.length&&<div className="brand-report__documents" aria-label="中间文件">{process.intermediate.map(document=><details key={document.id} className="brand-report__document"><summary><FileText size={17}/><strong>{document.title}</strong><span>{new Date(document.updatedAt).toLocaleTimeString('zh-CN')}</span></summary><div className="brand-report__markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{document.text}</ReactMarkdown></div><a className="brand-report__download" href={projectResourceUrl(`/api/modules/brand/reports/${run.id}/intermediate?file=${encodeURIComponent(document.id)}`)} target="_blank" rel="noreferrer">{document.truncated?'打开完整文件':'单独打开文件'}</a></details>)}</div>}
     <div className="brand-report__documents">{process.documents.map(document=><details key={document.id} className="brand-report__document">
      <summary><FileText size={17}/><strong>{document.title}</strong><span>展开完整研究</span></summary>
      <p>{document.summary}</p><div className="brand-report__markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{document.markdown}</ReactMarkdown></div>
      {!!document.sources.length&&<div className="brand-report__sources"><strong>参考来源</strong>{document.sources.map((source,index)=><a key={index} href={source.url} target="_blank" rel="noreferrer">{source.title||source.url}</a>)}</div>}
     </details>)}</div>
    </section>
   </>}
  </main>
 </section>;
}
