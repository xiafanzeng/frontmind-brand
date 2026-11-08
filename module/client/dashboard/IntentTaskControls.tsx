import {Pause, Play} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";

export default function IntentTaskControls({job, pending, onPause, onResume}: {
  job?: IntentSkillJob; pending: boolean; onPause?: () => void; onResume?: () => void;
}) {
  if (!job || ["succeeded", "failed"].includes(job.status)) return null;
  const label = job.kind === "plan" ? "生成方案" : "评估";
  if (job.status === "paused") return onResume
    ? <button type="button" className="iw-task-resume" disabled={pending} onClick={onResume}><Play size={14}/>继续{label}</button> : null;
  if (["pausing", "resuming"].includes(job.status))
    return <button type="button" disabled>{job.status === "pausing" ? "正在暂停…" : `正在恢复${job.kind === "plan" ? "方案生成" : "评估"}…`}</button>;
  return onPause ? <button type="button" disabled={pending || job.status !== "running"} onClick={onPause}
    title="中断当前模型执行；继续时沿用原任务上下文，可能重新处理被中断的部分。"><Pause size={14}/>暂停{label}</button> : null;
}
