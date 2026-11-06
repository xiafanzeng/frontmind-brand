import { useEffect, useState, type ReactNode } from "react";
import { Check, Clock3, AlertCircle, Loader2 } from "lucide-react";
import {
  taskStagePresentation,
  type TaskStageInput,
} from "./task-stage-model.js";
import "./task-stage-card.css";

export function TaskStageCard(
  props: TaskStageInput & {
    error?: string;
    errorCode?: string;
    onRetry?: () => void;
    onResume?: () => void;
    retryLabel?: string;
    failureActions?: ReactNode;
  },
) {
  const model = taskStagePresentation(props);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (
      !model.startedAt ||
      props.phase === "completed" ||
      props.phase === "failed"
    )
      return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [model.startedAt, props.phase]);
  const seconds = model.startedAt
    ? Math.max(0, Math.floor((now - model.startedAt) / 1000))
    : null;
  const unavailable = props.phase === "uncertain" || props.degraded;
  const title =
    props.phase === "failed"
      ? {
          generation: "生成未完成",
          regeneration: "重新生成未完成",
          judge: "LLM 语义评估未完成",
          optimizer: "优化未完成",
        }[props.flow]
      : props.phase === "uncertain"
        ? "任务状态待确认"
        : props.phase === "completed"
          ? "处理完成"
          : props.adopting
            ? "正在保存生成结果…"
            : {
                generation: "正在生成应答逻辑…",
                regeneration: "正在重新生成应答逻辑…",
                judge: "LLM 语义评估进行中",
                optimizer: "正在生成优化版本…",
              }[props.flow];
  return (
    <section className="rl-task-stages" aria-label="任务阶段">
      <header>
        <div>
          <span className="rl-task-eyebrow">
            {props.flow === "generation"
              ? "应答逻辑生成"
              : props.flow === "regeneration" ? "重新生成应答逻辑 · 当前草稿已保留" : props.flow === "judge"
                ? "LLM 语义评估"
                : "优化候选生成"}
          </span>
          <h3>{title}</h3>
        </div>
        <span className="rl-task-duration">
          <Clock3 size={14} />
          {seconds === null
            ? "耗时暂不可用"
            : `已观测 ${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`}
        </span>
      </header>
      <p className="rl-task-description" role="status">
        {props.phase === "failed"
          ? props.error || "任务未完成，请查看错误详情。"
          : model.description}
      </p>
      <div className="rl-task-body">
        <ol>
          {model.stages.map((stage, index) => (
            <li
              key={stage.label}
              className={`rl-task-stage is-${stage.status}`}
              aria-current={index === model.current ? "step" : undefined}
            >
              <span className="rl-task-marker">
                {stage.status === "completed" ? (
                  <Check size={14} />
                ) : stage.status === "failed" ? (
                  <AlertCircle size={14} />
                ) : stage.status === "running" ? (
                  <Loader2 size={14} />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                <b>{stage.label}</b>
                <small>
                  {stage.status === "completed"
                    ? "已完成"
                    : stage.status === "failed"
                      ? "失败"
                      : stage.status === "running"
                        ? "进行中"
                        : index === model.current && unavailable
                          ? "等待状态确认"
                          : "待执行"}
                </small>
              </div>
            </li>
          ))}
        </ol>
        <aside className="rl-task-activity">
          <h4>最近任务动态</h4>
          {model.activities.length ? (
            <ul>
              {model.activities.map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  <time>
                    {new Date(
                      item.time < 1e12 ? item.time * 1000 : item.time,
                    ).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p>尚无可展示的执行动态。</p>
          )}
          <p className="rl-task-hint">
            仅展示已确认的执行信息；阶段缺失时不推算进度。
          </p>
        </aside>
      </div>
      {(props.phase === "failed" || unavailable) && (
        <footer>
          {(props.error || props.errorCode) && (
            <details>
              <summary>查看错误详情</summary>
              <p>{props.error}</p>
              {props.errorCode && <p>错误代码：{props.errorCode}</p>}
              {props.taskId && <p>任务标识：{props.taskId}</p>}
            </details>
          )}
          {props.phase === "failed" && props.failureActions ? props.failureActions : unavailable
            ? props.onResume &&
              (props.taskId || props.flow !== "generation") && (
                <button type="button" onClick={props.onResume}>
                  恢复查询
                </button>
              )
            : props.onRetry && (
                <button type="button" onClick={props.onRetry}>
                  {props.retryLabel ?? "重试"}
                </button>
              )}
        </footer>
      )}
    </section>
  );
}
