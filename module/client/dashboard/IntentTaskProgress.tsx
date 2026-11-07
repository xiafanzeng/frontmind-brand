import {ArrowLeft, Radio} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-task-progress.css";
import IntentTaskControls from "./IntentTaskControls";

export default function IntentTaskProgress({job, kind, error, pending, onBack, onViewResult, updating = pending, onPause, onResume, returnLabel = "问题列表"}: {
  job?: IntentSkillJob; kind: "evaluate" | "plan"; error: string; pending: boolean;
  onBack: () => void; onViewResult: () => void;
  returnLabel?: string;
  updating?: boolean; onPause?: () => void; onResume?: () => void;
}) {
  const completed = job?.status === "succeeded";
  const paused = job?.status === "paused";
  const failed = !completed && (job?.status === "failed" || Boolean(error));
  const status = completed ? "已完成" : paused ? "已暂停" : job?.status === "pausing" ? "正在暂停"
    : job?.status === "resuming" ? "正在继续" : failed ? "未完成" : !job ? "准备中" : updating ? "持续更新" : "等待更新";
  const emptyMessage = completed ? "结果已校验并保存。" : paused ? "当前任务已暂停。"
    : failed ? error || job?.error || "任务未完成。" : job ? "模型任务已提交，等待执行动态…" : "正在准备评估任务…";
  return <div className="iw-task-progress">
    <button className="iw-back" onClick={onBack}><ArrowLeft size={15}/>返回{returnLabel}</button>
    <section className="iw-panel iw-progress-events" aria-labelledby="intent-task-events-title">
      <header className="iw-progress-events-head">
        <h1 id="intent-task-events-title"><Radio size={18} aria-hidden="true"/>实时任务动态</h1>
        <div className="iw-progress-event-actions">
          <span className="iw-tag" role="status" aria-label="任务状态">{status}</span>
          {completed ? <button disabled={pending} onClick={onViewResult}>{job?.receiptId ? "查看优化结果" : kind === "plan" ? "查看优化方案" : "查看评估结果"}</button>
            : <IntentTaskControls job={job} pending={pending} onPause={onPause} onResume={onResume}/>}
        </div>
      </header>
      <div role="log" aria-label="实时任务动态" aria-live="polite" aria-relevant="additions">
        {job?.progress?.events.length ? job.progress.events.map(event => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time><span>{event.label}</span></p>) :
          <p className="iw-progress-empty"><span>{emptyMessage}</span></p>}
      </div>
      {job?.control?.error && <p className="iw-progress-control-error" role="alert">{job.control.error}</p>}
    </section>
  </div>;
}
