import {useEffect, useState} from "react";
import {ArrowLeft, Check, Clock3, LoaderCircle, Radio} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-task-progress.css";

const stages = ["准备知识与问题", "提交模型任务", "分析知识与评分", "校验并保存结果"];
export default function IntentTaskProgress({job, count, kind, error, pending, onBack, onReload, onViewResult}: {
  job?: IntentSkillJob; count: number; kind: "evaluate" | "plan"; error: string; pending: boolean;
  onBack: () => void; onReload: () => void; onViewResult: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [startedAt] = useState(Date.now());
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);}, []);
  const stage = job?.progress?.stage;
  const step = job?.status === "succeeded" ? 4 : stage === "validating" || stage === "repairing" ? 3 :
    stage === "analyzing" ? 2 : job?.status === "running" || job?.status === "create_unknown" ? 1 : 0;
  const created = Date.parse(job?.createdAt ?? "");
  const seconds = Math.max(0, Math.floor((now - (Number.isFinite(created) ? created : startedAt)) / 1000));
  const completed = job?.status === "succeeded";
  const failed = !completed && (job?.status === "failed" || Boolean(error));
  return <div className="iw-task-progress">
    <button className="iw-back" onClick={onBack}><ArrowLeft size={15}/>返回问题列表</button>
    <header className="iw-header"><div>
      <h1>{completed ? kind === "plan" ? "优化方案已完成" : "评估已完成" : failed ? "评估任务需要处理" : kind === "plan" ? "正在生成优化方案" : `正在评估 ${job?.questionIds.length ?? count} 条问题`}</h1>
      <p>根据当前知识库逐项评估，完成后自动打开结果。</p></div>
      <span className="iw-tag"><Clock3 size={14}/>已用时 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</span></header>
    <section className="iw-panel iw-progress-main">
      <div className="iw-progress-heading"><span className={`iw-progress-icon ${failed ? "failed" : ""}`}>{completed ? <Check size={25}/> : <LoaderCircle size={25}/>}</span>
        <div><h2>{completed ? "结果已校验并保存" : failed ? "任务未完成" : stage === "repairing" ? "正在修复输出并重新校验" : stages[Math.min(step, 3)]}</h2>
          <p>{completed ? "可以直接查看已保存结果，无需重新评估。" : failed ? error || job?.error : step === 2 ? "模型正在处理知识证据，复杂问题可能需要几分钟。" : "任务进度来自服务器实际状态。"}</p></div>
        <b>{Math.min(step + 1, 4)} / 4 阶段</b></div>
      <progress aria-label="评估阶段进度" max={4} value={step}/>
      <ol className="iw-progress-stages">{stages.map((label, index) => <li key={label} className={index < step ? "complete" : index === step ? "current" : ""}>
        <span>{index < step ? <Check size={16}/> : index + 1}</span><b>{label}</b><small>{index < step ? "已完成" : index === step ? failed ? "待处理" : "进行中" : "等待"}</small></li>)}</ol>
      <div className="iw-progress-meta"><span>问题数量 <b>{job?.questionIds.length ?? count}</b></span><span>结果校验 <b>{job?.status === "succeeded" ? "已通过" : "待完成"}</b></span></div>
      <p className="iw-method">进度条表示执行阶段。评分通过完整校验后统一显示。</p>
      {completed && <button className="iw-primary" disabled={pending} onClick={onViewResult}>{job?.receiptId ? "查看优化结果" : kind === "plan" ? "查看优化方案" : "查看评估结果"}</button>}
    </section>
    <section className="iw-panel iw-progress-events"><h3><Radio size={17}/>实时任务动态<span className="iw-tag">{completed ? "已完成" : pending ? "持续更新" : "已暂停"}</span></h3>
      <div role="log" aria-label="实时任务动态" aria-live="polite" aria-relevant="additions">
        {job?.progress?.events.length ? job.progress.events.map(event => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time><span>{event.label}</span></p>) :
          <p><span>{job ? "模型任务已提交，等待执行动态…" : "正在准备评估任务…"}</span></p>}
      </div><p className="iw-method">可以返回列表等待；刷新页面可继续查看当前任务。</p>
      {!pending && <button onClick={onReload}>重新读取任务状态</button>}
    </section>
  </div>;
}
