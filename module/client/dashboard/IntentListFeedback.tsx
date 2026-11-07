import {useEffect, useRef, useState} from "react";
import {Clock3, LoaderCircle, RefreshCw, X} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-list-feedback.css";
import IntentTaskControls from "./IntentTaskControls";

export function IntentListInitialLoading() {
  return <>
    <header className="iw-header iw-catalog-header">
      <div><h1>优化问题</h1><p>查看已保存评估，或评估新加入的推荐问题与历史词条。</p></div>
      <div className="iw-list-skeleton-tools" aria-hidden="true">
        <span/><span/><span/>
      </div>
    </header>
    <section className="iw-list-initial" aria-label="问题列表" aria-busy="true">
      <div className="iw-list-initial-status" role="status" aria-label="问题列表加载状态">
        <LoaderCircle size={16} aria-hidden="true"/><span>正在加载已保存的问题…</span>
      </div>
      <div className="iw-list-skeleton" aria-hidden="true">
        <div className="iw-list-skeleton-head"><span/><span/><span/><span/><span/><span/><span/></div>
        {[0, 1, 2].map(row => <div className="iw-list-skeleton-row" key={row}>
          <span className="iw-list-skeleton-check"/>
          <div className="iw-list-skeleton-copy"><span/><span/><span/></div>
          <span/><span/>
          <div className="iw-list-skeleton-copy"><span/><span/></div>
          <span/><span/>
        </div>)}
      </div>
    </section>
  </>;
}

export function IntentListRefreshStatus() {
  return <span className="iw-list-refresh" role="status" aria-label="列表更新状态"><RefreshCw size={14} aria-hidden="true"/>正在更新</span>;
}

export function IntentListEvaluationStatus({job, uncertain, onViewTask, onViewResult, pending = false, onPause, onResume, onDismiss, autoDismiss = true}: {
  job: IntentSkillJob; uncertain: boolean; onViewTask: () => void;
  onViewResult?: () => void;
  pending?: boolean; onPause?: () => void; onResume?: () => void;
  onDismiss?: () => void; autoDismiss?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const created = Date.parse(job.createdAt ?? "");
  const terminal = job.status === "succeeded" || job.status === "failed";
  const finished = [Date.parse(job.result?.completedAt ?? ""), job.terminalObservedAt ?? NaN,
    Date.parse(job.progress?.updatedAt ?? "")].find(Number.isFinite);
  useEffect(() => {
    if (!Number.isFinite(created)) return;
    setNow(Date.now());
    if (terminal) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.id, created, terminal]);
  const seconds = Math.max(0, Math.floor(((terminal ? finished ?? now : now) - created) / 1000));
  const unconfirmed = uncertain || job.status === "create_unknown";
  const paused = job.status === "paused";
  const completed = job.status === "succeeded";
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!completed || !autoDismiss) return;
    const timer = window.setTimeout(() => dismissRef.current?.(), 8000);
    return () => window.clearTimeout(timer);
  }, [job.id, completed, autoDismiss]);
  return <section className={`iw-list-task${completed ? " iw-list-task--completed" : ""}`} aria-label="问题评估任务">
    <div className="iw-list-task-main">
      <div className="iw-list-task-copy" role="status"><h3>{completed ? "评估已完成" : paused ? `评估已暂停 · ${job.questionIds.length} 条问题` : unconfirmed ? `评估任务待确认 · ${job.questionIds.length} 条问题` : job.kind === "plan" ? `正在生成优化方案 · ${job.questionIds.length} 条问题` : `正在评估 ${job.questionIds.length} 条问题`}</h3></div>
      <div className="iw-list-task-actions">
        {Number.isFinite(created) && <span className="iw-list-task-time"><Clock3 size={14} aria-hidden="true"/>已耗时 {Math.floor(seconds / 60)}分{seconds % 60}秒</span>}
        <button type="button" onClick={completed ? onViewResult ?? onViewTask : onViewTask}>{completed ? "查看评估结果" : "查看当前任务"}</button>
        <IntentTaskControls job={job} pending={pending} onPause={onPause} onResume={onResume}/>
        {completed && onDismiss && <button type="button" className="iw-list-task-dismiss" aria-label="关闭评估完成提示" onClick={onDismiss}><X size={16}/></button>}
      </div>
    </div>
    {!completed && job.control?.error && <p className="iw-list-task-note" role="alert">{job.control.error}</p>}
  </section>;
}
