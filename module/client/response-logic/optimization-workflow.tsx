import {TaskStageCard} from "./task-stage-card.js";
import "./optimization-result.css";
import {useEffect,useMemo,useState,useRef,useId} from "react";
import type {LogicField,LogicSections} from "../../contracts/response-logic-evaluation.js";
import {LOGIC_FIELDS} from "../../contracts/response-logic-evaluation.js";
import type {OptimizationOutput,OptimizationChange} from "../../contracts/response-logic-optimization.js";
import {WorkbenchSteps} from "./workbench-parts.js";
import type {OptimizationState} from "../use-optimization-generation.js";
import "./evaluation.css";
import "./optimization-review.css";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@frontmind/module-ui/components/ui/dialog";

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
  const [confirmAdopt,setConfirmAdopt]=useState(false);
  const tabsId=useId();
  const candidateInput=useRef<HTMLTextAreaElement>(null);

  // Bind the editable copy to the CURRENT candidate only; a new candidate
  // (fresh generation after reset) starts from the model's proposal again.
  useEffect(()=>{
    if(result){setEdited(result.optimizedDraft);setAccepted(allSelected());setAdopted(false);setConfirmAdopt(false);adoptingRef.current=false;}
  },[result]);
  const effectiveEdited=edited??(result?result.optimizedDraft:logic);
  const hasCandidate=optimization.state.phase==="completed"&&result!==null;
  useEffect(()=>{
    const fit=()=>{const input=candidateInput.current;if(input){input.style.height="auto";if(input.scrollHeight)input.style.height=`${input.scrollHeight+2}px`;}};
    fit();window.addEventListener("resize",fit);return()=>window.removeEventListener("resize",fit);
  },[activeField,effectiveEdited,hasCandidate]);
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
    try{onAdopt(buildAdoptionPatch(result,accepted,effectiveEdited));setAdopted(true);setConfirmAdopt(false);}catch(error){adoptingRef.current=false;throw error;}
  };
  const startGeneration=()=>{void optimization.start();};

  return <section className={`rl-eval-root${hasCandidate?" rl-opt-review":""}`} aria-label="优化应答逻辑">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回评估详情</button></div>
    <header className="rl-eval-heading"><div><h2>优化应答逻辑</h2><p>{question}{intent?` · Intent：${intent}`:""} · 优化基于已完成的 LLM 四维评估，生成候选版本供人工审阅与逐栏采用。</p></div></header>
    <WorkbenchSteps step={adopted?3:2}/>

    {optimization.state.phase==="idle"&&!judgeTaskId&&<div className="rl-opt-toolbar rl-eval-card" role="status">
      <h3>尚无可用的评估结果</h3>
      <p className="rl-eval-score-description">优化必须基于当前内容的 LLM 四维评估。请先返回评估页完成「查看四维评估」，再回来生成优化版本。</p>
    </div>}

    {optimization.state.phase==="idle"&&judgeTaskId&&<div className="rl-opt-toolbar rl-eval-card rl-opt-generation-intro">
      <p className="rl-opt-generation-copy">将以当前四栏草稿为输入，结合已完成的 Judge 评估结论与企业知识材料，由 LLM 生成优化候选版本。生成后可逐栏审阅、编辑并选择采用哪些栏目。</p>
      <div className="rl-eval-action-buttons"><button type="button" className="rl-eval-primary" onClick={startGeneration}>生成优化版本</button></div>
    </div>}

    {["starting","running","uncertain","failed"].includes(optimization.state.phase)&&<TaskStageCard flow="optimizer" phase={optimization.state.phase} taskId={optimization.state.taskId} execution={optimization.state.execution} error={optimization.state.error} errorCode={optimization.state.errorCode} onResume={optimization.resume} onRetry={optimization.state.taskId?optimization.resume:startGeneration} retryLabel={optimization.state.taskId?"恢复查询":"重新生成"}/>}

    {optimization.state.phase==="failed"&&<button type="button" className="rl-eval-outline" onClick={optimization.reset}>放弃本次优化</button>}
    {hasCandidate&&result&&<>
      <section className="rl-opt-comparison rl-eval-card" aria-label="原文与优化候选对照">
        <div className="rl-opt-review-heading"><h3>逐段对照</h3><span className="rl-opt-candidate-status">{adopted?"已采用到草稿":"尚未采用"}</span><button type="button" className="rl-opt-text-action" disabled={adopted} onClick={()=>setEdited(result.optimizedDraft)}>恢复模型建议</button></div>
        <div className="rl-opt-field-tabs" role="tablist" aria-label="四段应答逻辑">{LOGIC_FIELDS.map(({field,title},index)=><button type="button" role="tab" key={field} id={`${tabsId}-${field}`} aria-controls={`${tabsId}-panel`} aria-selected={activeField===field} tabIndex={activeField===field?0:-1} onClick={()=>setActiveField(field)} onKeyDown={event=>{
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?3:(index+(event.key==="ArrowRight"?1:3))%4;
          const nextField=LOGIC_FIELDS[next].field;setActiveField(nextField);document.getElementById(`${tabsId}-${nextField}`)?.focus();
        }}>{title}</button>)}</div>
        {LOGIC_FIELDS.filter(({field})=>field===activeField).map(({field,title:label})=><div key={field} id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${field}`}>
          <div className="rl-opt-section-controls"><span>{logic[field]===result.optimizedDraft[field]?"本段未修改":"本段有修改"}</span><div className="rl-opt-section-choice" role="group" aria-label={`${label}的采用选择`}>
            <button type="button" disabled={adopted} aria-pressed={accepted[field]} onClick={()=>setAccepted({...accepted,[field]:true})}>采用候选</button>
            <button type="button" disabled={adopted} aria-pressed={!accepted[field]} onClick={()=>setAccepted({...accepted,[field]:false})}>保持原文</button>
          </div></div>
          <div className="rl-opt-compare-pair"><div className="rl-opt-before"><h4>原文</h4><p>{logic[field]||"（暂无内容）"}</p></div><div className="rl-opt-after"><h4>优化候选 <small>可编辑</small></h4><textarea ref={candidateInput} disabled={adopted} value={effectiveEdited[field]} aria-label={`编辑${label}`} onChange={event=>setEdited({...effectiveEdited,[field]:event.target.value})} rows={6}/></div></div>
          {(changesByField.get(field)??[]).length>0&&<details className="rl-opt-modification-evidence"><summary>查看修改依据</summary>{(changesByField.get(field)??[]).map((change,index)=><div className="rl-opt-issue" key={index}><p>{change.summary}</p>{change.evidence.map((evidence,i)=><p className="rl-judge-evidence" key={i}>「{evidence.excerpt}」<span className="rl-eval-tag neutral">{EVIDENCE_SOURCE_TEXT[evidence.source]??evidence.source}</span> — {evidence.supports}</p>)}</div>)}</details>}
        </div>)}
      </section>
      <footer className="rl-opt-adoption-bar"><div><span>已选 <strong>{LOGIC_FIELDS.filter(({field})=>accepted[field]).length}</strong> / 4 段</span><small>采用到草稿后，仍需更新应答逻辑。</small></div><div className="rl-opt-adoption-actions"><button type="button" className="rl-opt-text-action" onClick={optimization.reset}>放弃候选</button><button type="button" className="rl-eval-primary" disabled={adopted||!LOGIC_FIELDS.some(({field})=>accepted[field])} onClick={()=>setConfirmAdopt(true)}>{adopted?"已采用到编辑器草稿":"采用选中项到草稿"}</button></div></footer>
      <Dialog open={confirmAdopt} onOpenChange={setConfirmAdopt}><DialogContent className="fm-brand-portal-theme iw-modal rl-opt-adopt-dialog"><DialogHeader><DialogTitle>采用选中内容到草稿？</DialogTitle><DialogDescription>仅替换以下段落，其他段落保留当前草稿。采用后仍需更新应答逻辑才正式生效。</DialogDescription></DialogHeader><ul>{LOGIC_FIELDS.filter(({field})=>accepted[field]).map(({field,title})=><li key={field}>{title}</li>)}</ul><DialogFooter><button type="button" className="rl-eval-outline" onClick={()=>setConfirmAdopt(false)}>取消</button><button type="button" className="iw-primary" disabled={adopted} onClick={adopt}>确认采用</button></DialogFooter></DialogContent></Dialog>
    </>}
  </section>;
}
