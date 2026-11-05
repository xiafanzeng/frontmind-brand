import {TaskStageCard} from "./task-stage-card.js";
import "./optimization-result.css";
import {useEffect,useMemo,useState,useRef} from "react";
import type {LogicField,LogicSections} from "../../contracts/response-logic-evaluation.js";
import {LOGIC_FIELDS} from "../../contracts/response-logic-evaluation.js";
import type {OptimizationOutput,OptimizationChange} from "../../contracts/response-logic-optimization.js";
import {WorkbenchSteps} from "./workbench-parts.js";
import type {OptimizationState} from "../use-optimization-generation.js";
import "./evaluation.css";

function allSelected():Record<LogicField,boolean>{return {concern:true,conclusion:true,facts:true,boundaries:true};}

/**
 * Pure adoption decision: only the sections the user explicitly selected,
 * using their (possibly hand-edited) candidate text. Sections the user did
 * not select are NOT included, so the existing draft keeps its own content.
 */
export function buildAdoptionPatch(result:OptimizationOutput,accepted:Record<LogicField,boolean>,edited:LogicSections):Partial<LogicSections>{
  const patch:Partial<LogicSections>={};
  for(const {field} of LOGIC_FIELDS){
    if(!accepted[field])continue;
    patch[field]=edited[field];
  }
  return patch;
}

const EVIDENCE_SOURCE_TEXT:Record<string,string>={draft:"草稿原文",knowledge:"知识材料"};

/**
 * LLM optimization flow: generate a candidate from the verified judge
 * diagnosis (server-side), review the per-change reasons and evidence, edit
 * or deselect sections, then ADOPT the selection into the editor draft via
 * the caller-provided onAdopt — which must go through the existing
 * patchDraft/stash pipeline. Nothing here publishes or writes the server
 * record directly, and no heuristic/demo content is ever shown as an LLM
 * candidate.
 */
export function ResponseLogicOptimizationWorkflow({question,intent,logic,judgeTaskId,optimization,onAdopt,onBack}:{question:string;intent:string;logic:LogicSections;judgeTaskId:string;optimization:{state:OptimizationState;start:()=>Promise<void>;reset:()=>void;resume?:()=>void};onAdopt:(patch:Partial<LogicSections>)=>void;onBack:()=>void}){
  const result=optimization.state.result;
  const [edited,setEdited]=useState<LogicSections|null>(null);
  const [accepted,setAccepted]=useState<Record<LogicField,boolean>>(allSelected());
  const [activeField,setActiveField]=useState<LogicField>("concern");
  const [adopted,setAdopted]=useState(false);
  const adoptingRef=useRef(false);

  // Bind the editable copy to the CURRENT candidate only; a new candidate
  // (fresh generation after reset) starts from the model's proposal again.
  useEffect(()=>{
    if(result){setEdited(result.optimizedDraft);setAccepted(allSelected());setAdopted(false);adoptingRef.current=false;}
  },[result]);
  const effectiveEdited=edited??(result?result.optimizedDraft:logic);
  const hasCandidate=optimization.state.phase==="completed"&&result!==null;
  const dirty=!adopted&&hasCandidate&&result&&LOGIC_FIELDS.some(({field})=>effectiveEdited[field]!==result.optimizedDraft[field]||!accepted[field]);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);

  const changesByField=useMemo(()=>{
    const map=new Map<LogicField,OptimizationChange[]>();
    if(!result)return map;
    for(const change of result.changes){
      const list=map.get(change.field)??[];
      list.push(change);
      map.set(change.field,list);
    }
    return map;
  },[result]);

  const adopt=()=>{
    if(!result||adoptingRef.current||!LOGIC_FIELDS.some(({field})=>accepted[field]))return;
    adoptingRef.current=true;
    try{onAdopt(buildAdoptionPatch(result,accepted,effectiveEdited));setAdopted(true);}catch(error){adoptingRef.current=false;throw error;}
  };
  const startGeneration=()=>{void optimization.start();};

  return <section className="rl-eval-root" aria-label="优化应答逻辑">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回评估详情</button></div>
    <header className="rl-eval-heading"><div><h2>优化应答逻辑</h2><p>{question}{intent?` · Intent：${intent}`:""} · 优化基于已完成的 LLM 四维评估，生成候选版本供人工审阅与逐栏采用。</p></div></header>
    <WorkbenchSteps step={adopted?3:2}/>

    {optimization.state.phase==="idle"&&!judgeTaskId&&<div className="rl-opt-toolbar rl-eval-card" role="status">
      <h3>尚无可用的评估结果</h3>
      <p className="rl-eval-score-description">优化必须基于当前内容的 LLM 四维评估。请先返回评估页完成「查看四维评估」，再回来生成优化版本。</p>
    </div>}

    {optimization.state.phase==="idle"&&judgeTaskId&&<div className="rl-opt-toolbar rl-eval-card">
      <p className="rl-eval-score-description">将以当前四栏草稿为输入，结合已完成的 Judge 评估结论与企业知识材料，由 LLM 生成优化候选版本。生成后可逐栏审阅、编辑并选择采用哪些栏目。</p>
      <div className="rl-eval-action-buttons"><button type="button" className="rl-eval-primary" onClick={startGeneration}>生成优化版本</button></div>
    </div>}

    {["starting","running","uncertain","failed"].includes(optimization.state.phase)&&<TaskStageCard flow="optimizer" phase={optimization.state.phase} taskId={optimization.state.taskId} execution={optimization.state.execution} error={optimization.state.error} errorCode={optimization.state.errorCode} onResume={optimization.resume} onRetry={optimization.state.taskId?optimization.resume:startGeneration} retryLabel={optimization.state.taskId?"恢复查询":"重新生成"}/>}

    {optimization.state.phase==="failed"&&<button type="button" className="rl-eval-outline" onClick={optimization.reset}>放弃本次优化</button>}
    {hasCandidate&&result&&<><div className="rl-opt-toolbar">
      <span className="rl-eval-tag supported">LLM 优化候选 · 未写入正式内容</span>
      <button type="button" className="rl-eval-outline" onClick={()=>setEdited(result.optimizedDraft)}>恢复模型建议</button>
      <button type="button" className="rl-eval-outline" onClick={optimization.reset}>放弃候选</button>
    </div>
    <div className="rl-opt-result-layout">
      <section className="rl-opt-result-summary rl-eval-card" aria-label="优化摘要">
        <h3>优化摘要</h3>
        <div className="rl-opt-core-summary"><h4>核心优化结论</h4><p>{result.summary}</p></div>
        {result.changes.length>0&&<><h4>主要优化建议与修改依据</h4><ol className="rl-opt-suggestions">{result.changes.map((change,index)=><li key={`${change.field}-${index}`}><b>{LOGIC_FIELDS.find(item=>item.field===change.field)?.title}</b><p>{change.summary}</p>{change.evidence.length>0&&<details><summary>查看修改依据</summary>{change.evidence.map((evidence,i)=><p key={i}>「{evidence.excerpt}」<span className="rl-eval-tag neutral">{EVIDENCE_SOURCE_TEXT[evidence.source]??evidence.source}</span> — {evidence.supports}</p>)}</details>}</li>)}</ol><h4>候选中的知识边界与风险提示</h4><p className="rl-opt-boundary-text">{result.optimizedDraft.boundaries}</p></>}
      </section>
      <aside className="rl-opt-result-adopt rl-eval-card" aria-label="采用确认">
        <h3>采用到草稿 <small>已选 {LOGIC_FIELDS.filter(({field})=>accepted[field]).length} / 4 项</small></h3>
        <p className="rl-eval-score-description">逐段选择；保持原文的内容不会被候选覆盖。</p>
        <div className="rl-opt-choices">{LOGIC_FIELDS.map(({field,title},index)=><div key={field}><b>{index+1}. {title}</b><div><label className={accepted[field]?"selected":""}><input type="checkbox" disabled={adopted} checked={accepted[field]} aria-label={`采用${title}`} onChange={event=>setAccepted({...accepted,[field]:event.target.checked})}/>采用候选</label><button type="button" disabled={adopted} aria-pressed={!accepted[field]} onClick={()=>setAccepted({...accepted,[field]:false})}>保持原文</button></div></div>)}</div>
        <p className="rl-eval-score-description">仅把选中栏目写入编辑器草稿；仍沿用现有保存与发布流程，不会自动发布。</p>
        <div className="rl-eval-action-buttons"><button type="button" className="rl-eval-primary" disabled={adopted||!LOGIC_FIELDS.some(({field})=>accepted[field])} onClick={adopt}>{adopted?"已采用到编辑器草稿":"采用选中项到草稿"}</button><button type="button" className="rl-eval-outline" onClick={optimization.reset}>放弃候选</button></div>
      </aside>
    </div>
    <section className="rl-opt-comparison rl-eval-card" aria-label="原文与优化候选对照">
      <h3>逐段对照</h3><div className="rl-opt-field-tabs" role="group" aria-label="选择对照段落">{LOGIC_FIELDS.map(({field,title})=><button type="button" key={field} aria-pressed={activeField===field} onClick={()=>setActiveField(field)}>{title}</button>)}</div>
      {LOGIC_FIELDS.filter(({field})=>field===activeField).map(({field,title:label})=><div key={field}>
        <div className="rl-opt-compare-pair"><div className="rl-opt-before"><b>原文</b><p>{logic[field]||"（暂无内容）"}</p></div><div className="rl-opt-after"><b>优化候选（可编辑）</b><textarea disabled={adopted} value={effectiveEdited[field]} aria-label={`编辑${label}`} onChange={event=>setEdited({...effectiveEdited,[field]:event.target.value})} rows={Math.max(5,Math.min(14,Math.ceil((effectiveEdited[field].length||1)/35)))}/><span className="rl-eval-tag neutral">{accepted[field]?"已选择候选":"保持原文"}</span></div></div>
        {(changesByField.get(field)??[]).map((change,index)=><div className="rl-opt-issue" key={index}><p className="rl-opt-evidence"><b>修改原因</b>{change.summary}</p>{change.evidence.map((evidence,i)=><p className="rl-judge-evidence" key={i}>「{evidence.excerpt}」<span className="rl-eval-tag neutral">{EVIDENCE_SOURCE_TEXT[evidence.source]??evidence.source}</span> — {evidence.supports}</p>)}</div>)}
      </div>)}
    </section>
    <div className="rl-eval-actions"><span>优化建议需人工审核后采用；采用仅写入编辑器草稿，不直接写入服务器正式内容。</span><button type="button" className="rl-eval-outline" onClick={onBack}>返回评估详情</button></div>
    </>}
  </section>;
}
