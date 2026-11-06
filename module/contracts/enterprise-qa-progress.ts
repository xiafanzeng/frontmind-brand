/** Public progress contains categories only: no prompts, tool payloads or reasoning. */
export type EnterpriseQaProgressStatus = "running" | "completed" | "waiting" | "failed" | "unconfirmed";

export type EnterpriseQaProgressActivity = {
  /** A local ordinal, never an internal task, conversation or provider identifier. */
  id: string;
  label: string;
  status: EnterpriseQaProgressStatus;
};

export type EnterpriseQaProgressInput = {
  execution?: unknown;
  questionId?: string;
  questionSequence?: number;
  turnId?: string;
  running: boolean;
};

const toolLabels = new Set([
  "执行命令", "读取文件", "写入文件", "编辑文件", "检索文本", "查找文件", "查看目录",
  "搜索网页", "读取网页", "浏览网页", "运行代码", "调用扩展工具", "调用工具",
]);
const phaseLabels: Record<string, string> = {
  submitting_question: "提交问题",
  loading_knowledge: "读取知识依据",
  analyzing_question: "分析问题",
  searching_knowledge: "查找企业知识",
  organizing_evidence: "整理依据",
  answering: "生成回答",
  confirming_result: "确认结果",
  saving_result: "保存结果",
};
const lifecycleLabels: Record<string, string> = {
  thinking: "整理回答",
  running: "处理任务",
  rescheduling: "恢复处理",
  retrying: "重试处理",
  waiting: "处理任务",
};
export const enterpriseQaProgressLabels: readonly string[] = [
  ...toolLabels, ...Object.values(phaseLabels), ...new Set(Object.values(lifecycleLabels)),
];
const toolStatuses = new Set<EnterpriseQaProgressStatus>(["running", "completed", "waiting", "failed", "unconfirmed"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function phaseStatus(value: unknown): EnterpriseQaProgressStatus | null {
  if (value === "ended") return "completed";
  if (value === "error") return "failed";
  if (value === "cancelled") return "unconfirmed";
  if (value === "waiting") return "waiting";
  return typeof value === "string" && Object.hasOwn(lifecycleLabels, value) ? "running" : null;
}

/**
 * The authenticated RAG workbench and anonymous website bridge share this
 * projection. Both must supply the current user-message identity. A supplied
 * turn is an additional fence; otherwise only that question's latest turn is
 * used. Missing or contradictory ownership never borrows earlier activity.
 */
export function enterpriseQaProgress(input: EnterpriseQaProgressInput): EnterpriseQaProgressActivity[] {
  const execution = record(input.execution);
  const hasQuestionId = typeof input.questionId === "string" && Boolean(input.questionId);
  const hasQuestionSequence = Number.isSafeInteger(input.questionSequence) && Number(input.questionSequence) >= 0;
  if (!input.running || !execution || !Array.isArray(execution.timeline) || (!hasQuestionId && !hasQuestionSequence)) return [];
  const entries = execution.timeline.flatMap(value => {
    const entry = record(value);
    if (!entry || typeof entry.id !== "string" || typeof entry.turnId !== "string" || !entry.turnId ||
      !Number.isSafeInteger(entry.userSequence) || typeof entry.rank !== "number" || !Number.isFinite(entry.rank) ||
      typeof entry.timestamp !== "number" || !Number.isFinite(entry.timestamp)) return [];
    const sameQuestion = hasQuestionId
      ? entry.userMessageId === input.questionId ||
        (!entry.userMessageId && hasQuestionSequence && entry.userSequence === input.questionSequence)
      : entry.userSequence === input.questionSequence;
    return sameQuestion && (!input.turnId || entry.turnId === input.turnId) ? [entry] : [];
  }).sort((left, right) => Number(left.userSequence) - Number(right.userSequence) ||
    Number(left.timestamp) - Number(right.timestamp) || Number(left.rank) - Number(right.rank));
  const latestTurn = entries.at(-1)?.turnId;
  if (!latestTurn) return [];
  const current = [...new Map(entries.filter(entry => entry.turnId === latestTurn)
    .map(entry => [entry.id, entry])).values()]
    .sort((left, right) => Number(left.rank) - Number(right.rank) || Number(left.timestamp) - Number(right.timestamp));
  const activity: EnterpriseQaProgressActivity[] = [];
  let latestLifecycle: { index: number; entry: Record<string, unknown> } | undefined;
  for (const [index, entry] of current.entries()) {
    if (entry.kind === "tool") {
      const status = entry.status === "returned" ? "unconfirmed" : entry.status;
      if (typeof status !== "string" || !toolStatuses.has(status as EnterpriseQaProgressStatus)) continue;
      activity.push({id: `progress:${index}`, label: typeof entry.label === "string" && toolLabels.has(entry.label) ? entry.label : "调用工具", status: status as EnterpriseQaProgressStatus});
    } else if (entry.kind === "status") {
      if (typeof entry.phase === "string" && Object.hasOwn(phaseLabels, entry.phase)) {
        const status = phaseStatus(entry.status);
        if (status) activity.push({id: `progress:${index}`, label: phaseLabels[entry.phase]!, status});
      } else if (!entry.phase) latestLifecycle = {index, entry};
    }
  }
  if (!activity.some(item => item.status === "running" || item.status === "waiting") && latestLifecycle) {
    const {index, entry} = latestLifecycle;
    if (typeof entry.status === "string" && Object.hasOwn(lifecycleLabels, entry.status)) {
      activity.push({id: `progress:${index}`, label: lifecycleLabels[entry.status]!, status: entry.status === "waiting" ? "waiting" : "running"});
    }
  }
  return activity;
}
