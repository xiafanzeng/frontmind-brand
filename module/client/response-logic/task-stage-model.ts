import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import { isJudgeResultFailure } from "../../contracts/response-logic-judge-failure.js";
import { readResponseLogicExecution } from "../../contracts/response-logic-progress.js";
export type TaskFlow = "generation" | "judge" | "optimizer" | "regeneration";
export type StageState = "completed" | "running" | "pending" | "failed";
export type TaskStageInput = {
  flow: TaskFlow;
  phase: string;
  taskId?: string | null;
  execution?: GeneralExecutionDto;
  adopting?: boolean;
  degraded?: boolean;
  errorCode?: string;
};
const labels: Record<TaskFlow, string[]> = {
  regeneration: ["准备问题与企业知识材料", "提交重新生成任务", "分析资料并生成四段新稿", "校验新稿并返回候选"],
  generation: [
    "准备问题与企业知识材料",
    "提交模型生成任务",
    "分析资料并生成四段应答逻辑",
    "校验结果并保存",
  ],
  judge: [
    "准备 Question、Intent 和应答逻辑材料",
    "提交 LLM 评估任务",
    "分析知识证据与完成四维评分",
    "校验评估结果并返回",
  ],
  optimizer: [
    "读取当前应答逻辑与评估结果",
    "提交优化任务",
    "分析优化内容并生成候选版本",
    "校验候选内容并整理优化摘要",
  ],
};
export function taskStagePresentation(input: TaskStageInput) {
  const execution = input.taskId
    ? readResponseLogicExecution(input.execution, input.taskId)
    : undefined;
  const entries = execution?.timeline ?? [];
  const active = entries.some(
    (e) =>
      e.kind === "tool" ||
      (e.kind === "status" && ["running", "thinking"].includes(e.status)),
  );
  const ended = entries.some(
    (e) => e.kind === "status" && e.status === "ended",
  );
  const complete = input.phase === "completed";
  const uncertain = input.phase === "uncertain" || input.degraded;
  const current =
    complete || input.adopting || ended || (input.flow === "judge" && isJudgeResultFailure(input.errorCode)) || input.errorCode === "REGENERATION_OUTPUT_INVALID" ? 3 : active ? 2 : input.taskId ? 1 : 0;
  const hasExecution = entries.length > 0;
  const stages = labels[input.flow].map((label, index) => ({
    label,
    status: (complete
      ? "completed"
      : index === current
        ? input.phase === "failed"
          ? "failed"
          : uncertain
            ? "pending"
            : "running"
        : index < current
          ? "completed"
          : "pending") as StageState,
  }));
  const description = uncertain
    ? "暂时无法确认任务状态，请恢复查询；不会自动创建新任务。"
    : input.adopting
      ? "生成结果已通过校验，正在保存；保存成功后才会进入编辑。"
      : complete
        ? input.flow === "generation"
          ? "生成结果已保存。"
          : input.flow === "judge"
            ? "评估结果已通过校验。"
            : "候选已通过校验，仍需人工审阅和采用。"
        : !input.taskId
          ? "正在准备本次请求，尚未确认任务创建。"
          : !hasExecution
            ? "任务已提交，详细阶段暂不可用；正在查询真实执行状态。"
            : current === 3
              ? "已收到任务结束事件，正在等待结果校验；尚未确认保存。"
              : current === 2
                ? input.flow === "judge"
                  ? "评估任务正在执行；资料分析与四维评分的内部细分阶段暂不可用。"
                  : "任务正在执行；分析与生成的内部细分阶段暂不可用。"
                : "任务已提交，正在等待执行。";
  const activities = entries
    .slice(-3)
    .map((e) => ({
      id: e.id,
      time: e.timestamp,
      text:
        e.kind === "tool"
          ? e.status === "failed"
            ? "资料处理步骤报告异常"
            : e.status === "completed" || e.status === "returned"
              ? "资料处理步骤已返回"
              : "正在处理任务资料"
          : e.kind === "status"
            ? ((
                {
                  running: "任务正在执行",
                  thinking: "任务正在处理输入",
                  waiting: "任务等待执行",
                  rescheduling: "任务等待重新调度",
                  retrying: "任务正在恢复执行",
                  error: "任务报告执行异常",
                  ended: "任务执行已结束，等待结果校验",
                  cancelled: "任务已取消",
                } as Record<string, string>
              )[e.status] ?? "执行状态已更新")
            : "执行状态已更新",
    }));
  const times = entries
    .map((e) => e.timestamp)
    .filter((t) => t > 0)
    .map((t) => (t < 1e12 ? t * 1000 : t));
  return {
    stages,
    current,
    description,
    activities,
    startedAt: times.length ? Math.min(...times) : undefined,
  };
}
