import {useMemo, useState} from "react";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import type {IntentChange} from "../../contracts/intent-workbench";
import {knowledgeDiff} from "./knowledge-diff";

export default function KnowledgeChangeComparison({changes, current, createdAt}: {changes: IntentChange[]; current: string; createdAt?: string}) {
  const [mode, setMode] = useState<"diff" | "snapshots" | "current">("diff");
  const comparisons = useMemo(() => changes.map(change => ({change, lines: knowledgeDiff(change.action.before, change.action.after)})), [changes]);
  const last = changes.at(-1);
  const currentMatches = last && current === (last.status === "reverted" ? last.action.before : last.action.after);
  return <div className="iw-change-comparison">
    <div className="iw-change-controls" role="group" aria-label="知识内容查看方式">
      {([["diff", "变更对比"], ["snapshots", "前后全文"], ["current", "当前正文"]] as const).map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
    </div>
    {mode === "current" ? <div className="iw-article"><MarkdownRenderer content={current}/></div> : <>
      <p className="iw-change-caption">执行记录快照{createdAt && ` · ${new Date(createdAt).toLocaleString("zh-CN")}`}。{changes.some(change => change.status === "reverted") ? "本次修改已撤销，以下保留撤销前的变更记录。" : !currentMatches ? "当前节点已有后续变化，可切换“当前正文”查看最新内容。" : "对比执行前内容与本次写入内容。"}</p>
      {comparisons.map(({change, lines}, index) => <section key={change.action.id} className="iw-change-section" aria-label={`${change.action.title}前后对比`}>
        {comparisons.length > 1 && <h4>{index + 1}. {change.action.title}</h4>}
        {mode === "snapshots" ? <div className="iw-snapshot-grid"><section><h4>变更前</h4><pre>{change.action.before || "（空正文）"}</pre></section><section><h4>变更后</h4><pre>{change.action.after || "（空正文）"}</pre></section></div> : <>
          <div className="iw-diff-legend"><span className="added">+ 新增 {lines.filter(line => line.kind === "add").length} 行</span><span className="removed">− 删除 {lines.filter(line => line.kind === "remove").length} 行</span><span>其余内容未变更</span></div>
          <div className="iw-record-diff" aria-label="逐行内容差异">{lines.map((line, lineIndex) => <div className={`iw-record-line ${line.kind}`} key={lineIndex}><span aria-label={line.kind === "add" ? "新增" : line.kind === "remove" ? "删除" : "未变更"}>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}</span><pre>{line.text || "\u00a0"}</pre></div>)}</div>
        </>}
      </section>)}
    </>}
  </div>;
}
