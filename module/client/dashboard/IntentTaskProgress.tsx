import {ArrowLeft, Radio} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-task-progress.css";
import IntentTaskControls from "./IntentTaskControls";

const stages = ["准备知识与问题", "提交模型任务", "分析知识与评分", "校验并保存结果"];

export default function IntentTaskProgress({job, kind, error, pending, onBack, onViewResult, onPause, onResume, returnLabel = "问题列表"}: {
  job?: IntentSkillJob; kind: "evaluate" | "plan"; error: string; pending: boolean;
  onBack: () => void; onViewResult: () => void;
  returnLabel?: string;
  updating?: boolean; onPause?: () => void; onResume?: () => void;
}) {
  const completed = job?.status === "succeeded";
  const paused = job?.status === "paused";
  const failed = !completed && (job?.status === "failed" || Boolean(error));
  const stage = job?.progress?.stage;
  const step = completed ? 4 : stage === "validating" || stage === "repairing" || stage === "completed" ? 3
    : stage === "analyzing" ? 2 : stage === "submitted" ? 1 : stage === "preparing" || !job ? 0 : null;
  const status = completed ? "已完成" : paused ? "已暂停" : job?.status === "pausing" ? "正在暂停"
    : job?.status === "resuming" ? "正在继续" : failed ? "未完成" : !job ? "准备中" : "进行中";
  const stageTitle = completed ? "结果已校验并保存" : stage === "repairing" ? "正在修复输出并重新校验"
    : step === null ? "任务执行中，详细阶段暂不可用" : stages[Math.min(step, 3)];
  const emptyMessage = completed ? "结果已校验并保存。" : paused ? "当前任务已暂停。"
    : failed ? error || job?.error || "任务未完成。" : job ? "模型任务已提交，等待执行动态…" : "正在准备评估任务…";
  return <div className="iw-task-progress">
    <button className="iw-back" onClick={onBack}><ArrowLeft size={15}/>返回{returnLabel}</button>
    <section className={`iw-panel iw-progress-main${paused ? " is-paused" : ""}${failed ? " is-failed" : ""}`}
      aria-label={kind === "plan" ? "优化方案进度" : "问题评估进度"}>
      <div className="iw-progress-heading">
        <h2>{stageTitle}</h2>
        <span className="iw-progress-status" role="status" aria-label="任务状态">{status}</span>
      </div>
      <progress aria-label={kind === "plan" ? "方案阶段进度" : "评估阶段进度"} max={4} value={step ?? undefined}
        aria-valuetext={`${stageTitle}，${status}`}/>
      <ol className="iw-progress-stages">{stages.map((label, index) => <li key={label}
        className={step !== null && index < step ? "complete" : index === step ? "current" : ""}
        aria-current={index === step ? "step" : undefined}>
        <span>{index + 1}</span><b>{label}</b>
      </li>)}</ol>
    </section>
    <section className="iw-panel iw-progress-events" aria-labelledby="intent-task-events-title">
      <header className="iw-progress-events-head">
        <h1 id="intent-task-events-title"><Radio size={18} aria-hidden="true"/>实时任务动态</h1>
        <div className="iw-progress-event-actions">
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
