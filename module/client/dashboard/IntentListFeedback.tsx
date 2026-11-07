import {useEffect, useState} from "react";
import {Check, Clock3, LoaderCircle, RefreshCw} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-list-feedback.css";
import IntentTaskControls from "./IntentTaskControls";

const stageLabels = {
  preparing: "正在准备知识与问题",
  submitted: "评估任务已提交，等待执行动态",
  analyzing: "正在分析知识与评分",
  validating: "正在校验并保存评估结果",
  repairing: "正在修复评估结果并重新校验",
};

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

export function IntentListEvaluationStatus({job, uncertain, onViewTask, onViewResult, pending = false, onPause, onResume}: {
  job: IntentSkillJob; uncertain: boolean; onViewTask: () => void;
  onViewResult?: () => void;
  pending?: boolean; onPause?: () => void; onResume?: () => void;
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
  const stage = job.progress?.stage;
  const unconfirmed = uncertain || job.status === "create_unknown";
  const paused = job.status === "paused";
  const completed = job.status === "succeeded";
  const description = completed ? "结果已校验并保存，可查看评估结果。"
    : paused ? "已中断模型执行，继续时沿用原任务上下文。"
    : job.status === "pausing" ? "正在等待模型停止执行"
    : job.status === "resuming" ? "正在恢复原任务的评估"
    : unconfirmed
    ? "任务状态暂不可确认，请查看当前任务恢复查询。"
    : job.repair ? stageLabels.repairing
    : stage && stage in stageLabels ? stageLabels[stage as keyof typeof stageLabels]
    : job.status === "queued" ? "评估任务已排队，等待执行"
    : job.status === "uploading" ? "正在准备评估材料"
    : "任务执行中，详细阶段暂不可用";
  return <section className="iw-list-task" aria-label="问题评估任务">
    <div className="iw-list-task-main">
      <span className="iw-list-task-icon">{completed ? <Check size={20} aria-hidden="true"/> : <LoaderCircle size={20} aria-hidden="true"/>}</span>
      <div className="iw-list-task-copy" role="status"><h3>{completed ? "评估已完成" : paused ? `评估已暂停 · ${job.questionIds.length} 条问题` : unconfirmed ? `评估任务待确认 · ${job.questionIds.length} 条问题` : job.kind === "plan" ? `正在生成优化方案 · ${job.questionIds.length} 条问题` : `正在评估 ${job.questionIds.length} 条问题`}</h3><p>{description}</p></div>
      <div className="iw-list-task-actions">
        {Number.isFinite(created) && <span className="iw-list-task-time"><Clock3 size={14} aria-hidden="true"/>已耗时 {Math.floor(seconds / 60)}分{seconds % 60}秒</span>}
        <button type="button" onClick={completed ? onViewResult ?? onViewTask : onViewTask}>{completed ? "查看评估结果" : "查看当前任务"}</button>
        <IntentTaskControls job={job} pending={pending} onPause={onPause} onResume={onResume}/>
      </div>
    </div>
    <p className="iw-list-task-note">{job.control?.error ?? (completed ? "已保留当前页面和选择，可随时查看评估结果。" : paused ? "可继续查看和处理其他问题；继续评估时可能重新处理被中断的部分。" : unconfirmed ? "请先恢复查询，避免重复提交。" : "任务在后台处理，可继续查看和处理其他问题。")}</p>
  </section>;
}
