import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,Check,CheckCircle2,ChevronRight,Download,FileBarChart2,FileText,Loader2,RefreshCw,Search,ShieldCheck,Sparkles} from 'lucide-react';
import {captureWorkspaceRestOperation,projectResourceUrl} from './host';
import {REPORT_PLATFORMS,REPORT_STAGES,type ReportRunView,type ReportWorkspace} from '../contracts/report-run';
import './brand-report-workspace.css';

type Workspace=ReportWorkspace&{profileHash:string};
const labels:Record<ReportRunView['phase'],string>={researching:'正在研究',awaiting_confirmation:'请确认诊断范围',monitoring:'正在采集回答',analyzing:'正在分析与制定方案',rendering:'正在生成报告',completed:'报告已完成',failed:'当前步骤未完成'};
const steps=['选择资料','企业与市场研究','确认诊断范围','诊断与方案','交付报告'];
function stepFor(run:ReportRunView|null){return !run?0:run.phase==='researching'?1:run.phase==='awaiting_confirmation'?2:['monitoring','analyzing'].includes(run.phase)?3:run.phase==='failed'?(run.stages.length<4?1:3):4;}
export default function BrandReportWorkspace({projectId,preview=false}:{projectId:string;preview?:boolean}){
 const operation=useMemo(()=>captureWorkspaceRestOperation(),[projectId]);
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[selected,setSelected]=useState<string|null>(null),[creating,setCreating]=useState(false);
 const [includeKnowledge,setIncludeKnowledge]=useState(false),[product,setProduct]=useState(''),[platforms,setPlatforms]=useState<string[]>(REPORT_PLATFORMS.map(p=>p.id));
 const [loading,setLoading]=useState(!preview),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=creating?null:workspace?.runs.find(r=>r.id===selected)??workspace?.runs[0]??null;
 async function request<T>(tail='',input?:unknown):Promise<T>{
  operation.assertActive();const response=await operation.fetch(`/api/modules/brand/reports${tail}`,{method:input===undefined?'GET':'POST',credentials:'same-origin',headers:operation.headers(input===undefined?{}:{'Content-Type':'application/json'}),body:input===undefined?undefined:JSON.stringify(input)});
  const value=await response.json();operation.assertActive();if(!response.ok)throw new Error(value?.error?.message??'报告服务暂不可用，请重新读取。');return value;
 }
 async function refresh(){if(preview)return;try{const value=await request<Workspace>();setWorkspace(value);setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{let live=true;const load=async()=>{if(!live)return;await refresh();};void load();const timer=setInterval(()=>void load(),6000);return()=>{live=false;clearInterval(timer);};},[operation,preview]);
 useEffect(()=>{setProduct(run?.products[0]?.id??'');setPlatforms(run?.platforms.length?run.platforms:REPORT_PLATFORMS.map(p=>p.id));},[run?.id,run?.products.length]);
 async function action(fn:()=>Promise<ReportRunView>){setBusy(true);setError('');try{const result=await fn();setSelected(result.id);setCreating(false);await refresh();}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重新读取。');}finally{setBusy(false);}}
 const artifactUrl=(file:string,download=false)=>projectResourceUrl(`/api/modules/brand/reports/${run?.id}/files/${file}${download?'?download=1':''}`);
 const chosenProduct=run?.products.find(p=>p.id===product);
 const statusStep=stepFor(run);
 const start=()=>action(()=>request('',{clientRequestId:crypto.randomUUID(),includeKnowledge,profileHash:workspace?.profileHash}));
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
    <div className="brand-report__source-grid"><button className="brand-report__source is-selected" aria-pressed="true" type="button"><div className="brand-report__card-icon"><FileText size={22}/></div><span className="brand-report__check"><Check size={14}/></span><h3>{workspace?.company.name||'当前企业'}</h3><p>{workspace?.company.summary||'使用当前企业资料，自动研究公开信息与市场情况。'}</p><small>当前企业 · 已选择</small></button>
    <button type="button" disabled={!workspace?.knowledge.available} className={`brand-report__source ${includeKnowledge?'is-selected':''}`} aria-pressed={includeKnowledge} onClick={()=>setIncludeKnowledge(!includeKnowledge)}><div className="brand-report__card-icon"><Search size={22}/></div>{includeKnowledge&&<span className="brand-report__check"><Check size={14}/></span>}<h3>已有品牌知识库</h3><p>{workspace?.knowledge.available?`补充 ${workspace.knowledge.documentCount} 份已发布知识，帮助核实产品、服务与品牌事实。`:'还没有已发布知识库。可以直接基于企业资料开始研究。'}</p><small>{workspace?.knowledge.available?'可选资料':'暂未建立'}</small></button></div>
    <div className="brand-report__start-note"><ShieldCheck size={18}/><span>研究后会先请你确认诊断问题与平台。确认后，采集、分析和报告生成自动继续。</span></div>
    {!workspace?.company.ready&&<p className="brand-report__warning">请先完善当前企业资料，确定企业名称。</p>}
    <button className="brand-report__primary" disabled={busy||!workspace?.company.ready} onClick={()=>void start()}>{busy?<Loader2 className="spin" size={17}/>:<Sparkles size={17}/>}开始品牌研究<ArrowRight size={17}/></button>
    <div className="brand-report__deliverables"><div><FileBarChart2 size={23}/><h3>全景报告</h3><p>完整研究、诊断证据、品牌策略与行动路径</p><small>网页版 / PDF</small></div><div><FileText size={23}/><h3>汇报报告</h3><p>把关键结论与方案组织成清晰的汇报内容</p><small>网页版 / 可编辑 PPTX</small></div></div>
   </>:<>
    <div className="brand-report__run-heading"><div><h2>{run.brandName}</h2><p>{new Date(run.createdAt).toLocaleString('zh-CN')} 创建</p></div><span className={`brand-report__status brand-report__status--${run.phase}`}>{!['completed','failed','awaiting_confirmation'].includes(run.phase)&&<Loader2 className="spin" size={14}/>} {labels[run.phase]}</span></div>
    {run.phase==='awaiting_confirmation'&&<section className="brand-report__confirmation" aria-label="确认诊断范围"><div className="brand-report__section-title"><span>03</span><div><h2>确认本轮诊断范围</h2><p>选择一个核心产品与采集平台，确认后自动完成后续分析和两份报告。</p></div></div>
     <h3>先检查哪类产品或服务？</h3><div className="brand-report__option-grid">{run.products.map(item=><button type="button" key={item.id} aria-pressed={product===item.id} className={`brand-report__option ${product===item.id?'is-selected':''}`} onClick={()=>setProduct(item.id)}><strong>{item.label}</strong><span>{item.question}</span>{product===item.id&&<CheckCircle2 size={17}/>}</button>)}</div>
     <div className="brand-report__questions"><p><span>问题 1</span>{chosenProduct?.question??'请选择一个核心产品'}</p><p><span>问题 2</span>{run.brandName}有什么缺点和问题？</p></div>
     <h3>在哪些 AI 平台采集？</h3><div className="brand-report__platforms">{REPORT_PLATFORMS.map(p=><button type="button" key={p.id} aria-pressed={platforms.includes(p.id)} className={platforms.includes(p.id)?'is-selected':''} onClick={()=>setPlatforms(current=>current.includes(p.id)?current.filter(id=>id!==p.id):[...current,p.id])}>{platforms.includes(p.id)&&<Check size={15}/>} {p.label}</button>)}</div>
     <p className="brand-report__muted">每个问题在每个平台采集 5 次，共 {platforms.length*10} 份真实回答。</p>
     <button className="brand-report__primary" disabled={busy||!product||!platforms.length} onClick={()=>void action(()=>request(`/${run.id}/confirm`,{expectedRevision:run.revision,productId:product,platforms}))}>{busy?<Loader2 className="spin" size={17}/>:<CheckCircle2 size={17}/>}确认并继续</button>
    </section>}
    {run.phase==='monitoring'&&<div className="brand-report__progress-card"><div><Loader2 className="spin" size={20}/><strong>正在采集诊断回答</strong><span>{run.sampleCount} / {run.expectedSamples}</span></div><progress value={run.sampleCount} max={run.expectedSamples||1}/><p>回答与引用来源会逐笔保存，完成后自动进入诊断分析。</p></div>}
    {run.phase==='failed'&&<div className="brand-report__error" role="alert"><strong>{run.currentStage}未完成</strong><p>{run.error?.message}</p>{run.canRetry&&<button disabled={busy} className="brand-report__secondary" onClick={()=>void action(()=>request(`/${run.id}/retry`,{}))}><RefreshCw size={15}/>恢复本轮任务</button>}</div>}
    {run.phase==='completed'&&<section className="brand-report__results" aria-label="报告成果"><div className="brand-report__section-title"><span><Check size={18}/></span><div><h2>两份报告已就绪</h2><p>完整诊断留作研究依据，汇报内容用于展示与讨论。</p></div></div><div className="brand-report__result-grid">
     <article><div className="brand-report__card-icon"><FileBarChart2 size={26}/></div><h3>全景报告</h3><p>企业事实、市场趋势、真实诊断、品牌策略和行动方案。</p><a className="brand-report__primary" href={artifactUrl('panorama.html')} target="_blank" rel="noreferrer">打开全景报告<ArrowRight size={16}/></a><a className="brand-report__download" href={artifactUrl('panorama.pdf',true)}><Download size={16}/>下载 PDF</a></article>
     <article><div className="brand-report__card-icon"><FileText size={26}/></div><h3>汇报报告</h3><p>关键指标、诊断结论与推进路线，网页版与演示稿使用同一份内容。</p><a className="brand-report__primary" href={artifactUrl('briefing.html')} target="_blank" rel="noreferrer">打开汇报报告<ArrowRight size={16}/></a><a className="brand-report__download" href={artifactUrl('briefing.pptx',true)}><Download size={16}/>下载 PPTX</a></article>
    </div><a className="brand-report__bundle" href={artifactUrl('reports.zip',true)}><Download size={16}/>下载全部报告与证据 ZIP</a></section>}
    <section className="brand-report__research"><div className="brand-report__section-title"><span><Search size={18}/></span><div><h2>研究与分析进度</h2><p>每个阶段完成后，摘要会显示在这里。</p></div></div><div className="brand-report__stage-grid">{REPORT_STAGES.map(([id,label])=>{const done=run.stages.find(s=>s.id===id),running=run.currentStage===id&&!['failed','completed','awaiting_confirmation'].includes(run.phase);return <article key={id} className={`brand-report__stage ${done?'is-done':running?'is-running':''}`}><div><span>{id}</span>{done?<CheckCircle2 size={17}/>:running?<Loader2 className="spin" size={17}/>:null}</div><h3>{label}</h3><p>{done?.summary??(running?'正在读取资料、核实来源并整理本阶段结论…':'等待前序步骤完成')}</p></article>;})}</div></section>
   </>}
  </main>
 </section>;
}
