import {useEffect, useState} from "react";
import {Clock3, LoaderCircle, RefreshCw} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-list-feedback.css";

const stageLabels = {
  preparing: "正在准备知识与问题",
  submitted: "评估任务已提交，等待执行动态",
  analyzing: "正在分析知识与评分",
  validating: "正在校验并保存评估结果",
  repairing: "正在修复评估结果并重新校验",
};

export function IntentListRefreshStatus() {
  return <span className="iw-list-refresh" role="status" aria-label="列表更新状态"><RefreshCw size={14} aria-hidden="true"/>正在更新</span>;
}

export function IntentListEvaluationStatus({job, uncertain, onViewTask}: {
  job: IntentSkillJob; uncertain: boolean; onViewTask: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const created = Date.parse(job.createdAt ?? "");
  useEffect(() => {
    if (!Number.isFinite(created)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.id, created]);
  const seconds = Math.max(0, Math.floor((now - created) / 1000));
  const stage = job.progress?.stage;
  const unconfirmed = uncertain || job.status === "create_unknown";
  const description = unconfirmed
    ? "任务状态暂不可确认，请查看当前任务恢复查询。"
    : job.repair ? stageLabels.repairing
    : stage && stage in stageLabels ? stageLabels[stage as keyof typeof stageLabels]
    : job.status === "queued" ? "评估任务已排队，等待执行"
    : job.status === "uploading" ? "正在准备评估材料"
    : "任务执行中，详细阶段暂不可用";
  return <section className="iw-list-task" aria-label="问题评估任务">
    <div className="iw-list-task-main">
      <span className="iw-list-task-icon"><LoaderCircle size={20} aria-hidden="true"/></span>
      <div className="iw-list-task-copy" role="status"><h3>{unconfirmed ? `评估任务待确认 · ${job.questionIds.length} 条问题` : `正在评估 ${job.questionIds.length} 条问题`}</h3><p>{description}</p></div>
      <div className="iw-list-task-actions">
        {Number.isFinite(created) && <span className="iw-list-task-time"><Clock3 size={14} aria-hidden="true"/>已耗时 {Math.floor(seconds / 60)}分{seconds % 60}秒</span>}
        <button type="button" onClick={onViewTask}>查看当前任务</button>
      </div>
    </div>
    <p className="iw-list-task-note">{unconfirmed ? "请先恢复查询，避免重复提交。" : "任务正在处理，请勿重复提交。"}</p>
  </section>;
}
