import {useEffect, useState} from "react";
import {ArrowLeft, Check, Clock3, LoaderCircle, Radio} from "lucide-react";
import type {IntentSkillJob} from "../../contracts/intent-workbench";
import "./intent-task-progress.css";

const stages = ["准备知识与问题", "提交模型任务", "分析知识与评分", "校验并保存结果"];
export default function IntentTaskProgress({job, count, kind, error, pending, onBack, onReload}: {
  job?: IntentSkillJob; count: number; kind: "evaluate" | "plan"; error: string; pending: boolean;
  onBack: () => void; onReload: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);}, []);
  const stage = job?.progress?.stage;
  const step = job?.status === "succeeded" ? 4 : stage === "validating" || stage === "repairing" ? 3 :
    stage === "analyzing" ? 2 : job?.status === "running" || job?.status === "create_unknown" ? 1 : 0;
  const created = Date.parse(job?.createdAt ?? "");
  const seconds = Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 1000)) : 0;
  const failed = job?.status === "failed" || Boolean(error);
  return <div className="iw-task-progress">
    <button className="iw-back" onClick={onBack}><ArrowLeft size={15}/>返回问题列表</button>
    <header className="iw-header"><div><span className="iw-progress-eyebrow">AI 任务进度</span>
      <h1>{failed ? "评估任务需要处理" : kind === "plan" ? "正在生成优化方案" : `正在评估 ${job?.questionIds.length ?? count} 条问题`}</h1>
      <p>根据当前知识库逐项评估，完成后自动打开结果。</p></div>
      <span className="iw-tag"><Clock3 size={14}/>已用时 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</span></header>
    <section className="iw-panel iw-progress-main">
      <div className="iw-progress-heading"><span className={`iw-progress-icon ${failed ? "failed" : ""}`}><LoaderCircle size={25}/></span>
        <div><h2>{failed ? "任务未完成" : stage === "repairing" ? "正在修复输出并重新校验" : stages[Math.min(step, 3)]}</h2>
          <p>{failed ? error || job?.error : step === 2 ? "模型正在处理知识证据，复杂问题可能需要几分钟。" : "任务进度来自服务器实际状态。"}</p></div>
        <b>{Math.min(step + 1, 4)} / 4 阶段</b></div>
      <progress aria-label="评估阶段进度" max={4} value={step}/>
      <ol className="iw-progress-stages">{stages.map((label, index) => <li key={label} className={index < step ? "complete" : index === step ? "current" : ""}>
        <span>{index < step ? <Check size={16}/> : index + 1}</span><b>{label}</b><small>{index < step ? "已完成" : index === step ? failed ? "待处理" : "进行中" : "等待"}</small></li>)}</ol>
      <div className="iw-progress-meta"><span>问题数量 <b>{job?.questionIds.length ?? count}</b></span><span>结果校验 <b>{job?.status === "succeeded" ? "已通过" : "待完成"}</b></span></div>
      <p className="iw-method">进度条表示执行阶段。评分通过完整校验后统一显示。</p>
    </section>
    <section className="iw-panel iw-progress-events"><h3><Radio size={17}/>实时任务动态<span className="iw-tag">{pending ? "持续更新" : "已暂停"}</span></h3>
      <div role="log" aria-label="实时任务动态" aria-live="polite" aria-relevant="additions">
        {job?.progress?.events.length ? job.progress.events.map(event => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time><span>{event.label}</span></p>) :
          <p><span>{job ? "模型任务已提交，等待执行动态…" : "正在准备评估任务…"}</span></p>}
      </div><p className="iw-method">可以返回列表等待；刷新页面可继续查看当前任务。</p>
      {!pending && <button onClick={onReload}>重新读取任务状态</button>}
    </section>
  </div>;
}
