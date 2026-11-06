import {Pause, Play} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";

export default function IntentTaskControls({job, pending, onPause, onResume}: {
  job?: IntentSkillJob; pending: boolean; onPause?: () => void; onResume?: () => void;
}) {
  if (!job || ["succeeded", "failed"].includes(job.status)) return null;
  if (job.status === "paused") return onResume
    ? <button type="button" disabled={pending} onClick={onResume}><Play size={14}/>继续评估</button> : null;
  if (["pausing", "resuming"].includes(job.status))
    return <button type="button" disabled>{job.status === "pausing" ? "正在暂停…" : "正在继续…"}</button>;
  return onPause ? <button type="button" disabled={pending || job.status !== "running"} onClick={onPause}
    title="中断当前模型执行；继续时沿用原任务上下文，可能重新处理被中断的部分。"><Pause size={14}/>暂停评估</button> : null;
}
