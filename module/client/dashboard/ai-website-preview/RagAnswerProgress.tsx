import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock3, LoaderCircle, TriangleAlert } from "lucide-react";
import type { RagChatActivityRow } from "./rag-chat-activity";

/** Shows observed work only; elapsed time never advances a made-up stage. */
export function RagAnswerProgress({ rows, submitting }: { rows: readonly RagChatActivityRow[]; submitting: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lastActiveIndex = rows.findLastIndex(row => row.status === "running" || row.status === "waiting");
  const visible = expanded ? rows : lastActiveIndex >= 0 && lastActiveIndex < rows.length - 4
    ? rows.filter((_, index) => index === lastActiveIndex || index >= rows.length - 3)
    : rows.slice(-4);
  const active = rows.some(row => row.status === "running" || row.status === "waiting");
  return <div className="rag-chat-wait rag-answer-progress" data-testid="rag-chat-wait" role="status" aria-live="polite" aria-atomic="false">
    <div className="rag-answer-progress-heading">回答进展</div>
    {rows.length > 4 && <button type="button" className="rag-answer-progress-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "收起进展" : `查看全部 ${rows.length} 项进展`}{expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>}
    <ol className="rag-answer-progress-list" aria-label="本轮执行进展">
      {visible.map(item => <li key={item.id} className={`rag-chat-activity is-${item.status}`} data-activity-status={item.status}>
        <span className="rag-answer-progress-icon" aria-hidden="true">{item.status === "completed" ? <Check size={13} /> : item.status === "failed" ? <TriangleAlert size={13} /> : item.status === "running" ? <LoaderCircle size={14} /> : <Clock3 size={13} />}</span>
        <span className="rag-chat-activity-text">{item.text}</span>
      </li>)}
      {!active && <li className="rag-chat-activity is-running" data-activity-status="running">
        <span className="rag-answer-progress-icon" aria-hidden="true"><LoaderCircle size={14} /></span>
        <span className="rag-chat-activity-text">{submitting ? "正在提交问题…" : "正在处理，等待更多进展…"}</span>
      </li>}
    </ol>
    <p className="rag-answer-progress-note">回答完成后会自动显示。</p>
  </div>;
}
