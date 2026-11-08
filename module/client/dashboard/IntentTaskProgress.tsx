import {ArrowLeft, Radio} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-task-progress.css";
import IntentTaskControls from "./IntentTaskControls";

export default function IntentTaskProgress({job, kind, error, pending, onBack, onViewResult, onPause, onResume, onRetry, returnLabel = "问题列表"}: {
  job?: IntentSkillJob; kind: "evaluate" | "plan"; error: string; pending: boolean;
  onBack: () => void; onViewResult: () => void;
  returnLabel?: string;
  updating?: boolean; onPause?: () => void; onResume?: () => void;
  onRetry?: () => void;
}) {
  const stages = kind === "plan" ? ["准备知识与问题", "提交模型任务", "生成知识库优化方案", "校验并保存方案"]
    : ["准备知识与问题", "提交模型任务", "分析知识与评分", "校验并保存结果"];
  const completed = job?.status === "succeeded";
  const paused = job?.status === "paused";
  const failed = job?.status === "failed";
  const uncertain = !completed && !failed && (Boolean(error) || job?.status === "create_unknown");
  const stage = job?.progress?.stage;
  const step = completed ? 4 : stage === "validating" || stage === "repairing" || stage === "completed" ? 3
    : stage === "analyzing" ? 2 : stage === "submitted" ? 1 : stage === "preparing" || !job ? 0 : null;
  const status = completed ? "已完成" : paused ? "已暂停" : job?.status === "pausing" ? "正在暂停"
    : job?.status === "resuming" ? "正在恢复" : failed ? "未完成" : uncertain ? "状态待确认" : !job ? "准备中" : "进行中";
  const stageTitle = completed ? "结果已校验并保存" : paused ? `${kind === "plan" ? "方案生成" : "问题评估"}已暂停` : stage === "repairing" ? "正在修复输出并重新校验"
    : step === null ? "任务执行中，详细阶段暂不可用" : stages[Math.min(step, 3)];
  const emptyMessage = completed ? "结果已校验并保存。" : paused ? "当前任务已暂停。"
    : failed ? job?.error || "任务未完成。" : uncertain ? "请重新读取状态，核对当前任务。" : job ? "模型任务已提交，等待执行动态…" : kind === "plan" ? "正在准备方案生成任务…" : "正在准备评估任务…";
  return <div className="iw-task-progress">
    <button className="iw-back" onClick={onBack}><ArrowLeft size={15}/>返回{returnLabel}</button>
    <section className={`iw-panel iw-progress-main${paused ? " is-paused" : ""}${failed ? " is-failed" : ""}`}
      aria-label={kind === "plan" ? "优化方案进度" : "问题评估进度"}>
      <div className="iw-progress-heading">
        <h2>{stageTitle}</h2>
        <div className="iw-progress-event-actions"><span className="iw-progress-status" role="status" aria-label="任务状态">{status}</span>
          {!completed && <IntentTaskControls job={job} pending={pending} onPause={onPause} onResume={onResume}/>}
          {job?.status === "failed" && onRetry && <button className="iw-task-resume" disabled={pending} onClick={onRetry}>{kind === "plan" ? "重新生成方案" : "重新评估"}</button>}
        </div>
      </div>
      {paused&&<p className="iw-progress-paused-hint">任务已暂停。点击“继续{kind === "plan" ? "生成方案" : "评估"}”恢复当前任务。</p>}
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
          {uncertain && <button disabled={pending} onClick={onViewResult}>{error ? "重新读取" : "核对提交状态"}</button>}
          {completed && <button disabled={pending} onClick={onViewResult}>{job?.receiptId ? "查看优化结果" : kind === "plan" ? "查看优化方案" : "查看评估结果"}</button>}
        </div>
      </header>
      {error && !completed && <p className="iw-progress-control-error" role="alert">{error}</p>}
      <div role="log" aria-label="实时任务动态" aria-live="polite" aria-relevant="additions">
        {job?.progress?.events.length ? job.progress.events.map(event => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time><span>{event.label}</span></p>) :
          <p className="iw-progress-empty"><span>{emptyMessage}</span></p>}
      </div>
      {job?.control?.error && <p className="iw-progress-control-error" role="alert">{job.control.error}</p>}
    </section>
  </div>;
}
