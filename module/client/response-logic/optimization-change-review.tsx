import {useEffect,useMemo,useRef,useState,useId,type ReactNode} from "react";
import type {LogicField,LogicSections} from "../../contracts/response-logic-evaluation.js";
import {compareLogicText,resolveOptimizationReview,type ReviewedOptimization,type TextChange} from "../../contracts/response-logic-change-review.js";

const kindText={adjust:"调整表达",add:"补充内容",remove:"删除内容"};

/** Differences are computed from exact drafts; explanations are only verified result data. */
export function OptimizationChangeReview({field,logic,result,candidate}:{field:LogicField;logic:LogicSections;result:ReviewedOptimization;candidate:string}){
  const original=logic[field];
  const manuallyEdited=candidate!==result.optimizedDraft[field];
  const notes=useMemo(()=>manuallyEdited?compareLogicText(original,candidate):resolveOptimizationReview(logic,result).fields[field],[manuallyEdited,original,candidate,logic,result,field]);
  const [selected,setSelected]=useState<TextChange|null>(null);
  const [hover,setHover]=useState<{note:TextChange;left:number;top:number}|null>(null);
  const explanation=useRef<HTMLDivElement>(null);
  const tooltipId=useId();
  useEffect(()=>{const dismiss=()=>setHover(null);window.addEventListener("scroll",dismiss,true);window.addEventListener("resize",dismiss);return()=>{window.removeEventListener("scroll",dismiss,true);window.removeEventListener("resize",dismiss);};},[]);
  const reasons=(note:TextChange)=>note.reasonIndexes.map(index=>result.changes[index]);
  const scopeLabel=(note:TextChange)=>manuallyEdited?"人工编辑后的差异":note.reasonScope==="excerpt"?"关联草稿证据的修改意见":note.reasonScope==="section"?"本段修改意见（未逐处定位）":"未提供对应修改说明";
  const missingReason=manuallyEdited?"候选已手动编辑，原模型意见不再对应当前标记；下方依据保留模型原始说明。":"此处存在文字差异，服务端未提供对应的修改原因。";
  const reveal=(note:TextChange)=>{setSelected(note);setHover(null);requestAnimationFrame(()=>explanation.current?.scrollIntoView?.({block:"nearest",behavior:"smooth"}));};
  const hint=(note:TextChange,element:HTMLElement)=>{
    const rect=element.getBoundingClientRect(),width=Math.min(340,innerWidth-32);
    setHover({note,left:Math.max(16,Math.min(rect.left,innerWidth-width-16)),top:rect.bottom+190<innerHeight?rect.bottom+8:Math.max(16,rect.top-190)});
  };
  function textWithMarks(text:string,side:"before"|"after"){
    let cursor=0;const output:ReactNode[]=[];
    for(const note of notes){
      const start=side==="before"?note.beforeStart:note.afterStart,end=side==="before"?note.beforeEnd:note.afterEnd;
      if(start===end)continue;
      const excerpt=text.slice(start,end);
      output.push(text.slice(cursor,start));
      output.push(<span role="button" tabIndex={0} key={note.id} className={`rl-change-mark ${note.kind}${selected?.id===note.id?" is-selected":""}`} aria-label={`${kindText[note.kind]}：${excerpt}，查看修改原因`} aria-describedby={hover?.note.id===note.id?tooltipId:undefined} onMouseEnter={event=>hint(note,event.currentTarget)} onMouseLeave={()=>setHover(null)} onFocus={event=>hint(note,event.currentTarget)} onBlur={()=>setHover(null)} onKeyDown={event=>{if(event.key==="Escape")setHover(null);if(event.key==="Enter"||event.key===" "){event.preventDefault();reveal(note);}}} onClick={()=>reveal(note)}><span className="rl-change-text">{excerpt}</span></span>);
      cursor=end;
    }
    output.push(text.slice(cursor));return output;
  }
  return <div className="rl-change-review">
    <div className="rl-change-legend"><span className="adjust">调整表达</span><span className="add">补充内容</span><span className="remove">删除内容</span><small>悬停或点击标记，查看原因</small></div>
    <div className="rl-opt-compare-pair">
      <div className="rl-opt-before"><h4>原文</h4><div className="rl-review-text">{textWithMarks(original,"before")}</div></div>
      <div className="rl-opt-after"><h4>优化候选</h4><div className="rl-review-text rl-candidate-read">{textWithMarks(candidate,"after")}</div></div>
    </div>
    <div className="rl-change-explanation" ref={explanation} aria-live="polite">
      {selected?<><div className="rl-explanation-head"><span className={`rl-change-kind ${selected.kind}`}>{kindText[selected.kind]}</span><strong>{scopeLabel(selected)}</strong><button type="button" aria-label="关闭修改说明" onClick={()=>setSelected(null)}>×</button></div>{reasons(selected).length?reasons(selected).map((reason,index)=><p key={index}>{reason.summary}</p>):<p>{missingReason}</p>}</>:<p>{notes.length?"选择一处标记，查看完整修改说明。":"本段与原文一致，没有文字改动。"}</p>}
    </div>
    {hover&&<div id={tooltipId} role="tooltip" className="rl-change-tooltip" style={{left:hover.left,top:hover.top}}><strong>{scopeLabel(hover.note)}</strong><p>{(reasons(hover.note)[0]?.summary??missingReason).slice(0,100)}{(reasons(hover.note)[0]?.summary.length??0)>100?"…":""}</p><small>点击查看完整说明</small></div>}
  </div>;
}
