import { orderExecutionTimeline, type GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import type { RagChatActivity } from "./rag-chat-activity";

const toolLabels = new Set(["执行命令", "读取文件", "写入文件", "编辑文件", "检索文本", "查找文件", "查看目录", "搜索网页", "读取网页", "浏览网页", "运行代码", "调用扩展工具", "调用工具"]);

/** Only actual, current-turn public execution evidence becomes chat progress. */
export function ragLiveActivity(input: {
  execution?: GeneralExecutionDto; questionId?: string; questionSequence?: number; turnId?: string; running: boolean;
}): RagChatActivity[] {
  if (!input.running || !input.execution || (!input.questionId && input.questionSequence === undefined)) return [];
  const entries = orderExecutionTimeline(input.execution.timeline).filter(entry =>
    (entry.userMessageId === input.questionId && Boolean(input.questionId) ||
      input.questionSequence !== undefined && entry.userSequence === input.questionSequence) &&
    (!input.turnId || entry.turnId === input.turnId));
  const latestTurn = entries.at(-1)?.turnId;
  const current = entries.filter(entry => entry.turnId === latestTurn);
  const tools: RagChatActivity[] = current.flatMap(entry => entry.kind === "tool" ? [{
    id: entry.id,
    label: toolLabels.has(entry.label) ? entry.label : "调用工具",
    status: entry.status === "returned" ? "unconfirmed" : entry.status,
  }] : []);
  if (!tools.some(tool => tool.status === "running" || tool.status === "waiting")) {
    const last = current.findLast(entry => entry.kind === "status");
    if (last?.kind === "status" && ["thinking", "running", "rescheduling", "retrying", "waiting"].includes(last.status)) {
      const labels: Record<string, string> = { thinking: "整理回答", running: "处理任务", rescheduling: "处理任务", retrying: "处理任务", waiting: "处理任务" };
      tools.push({ id: last.id, label: labels[last.status]!, status: last.status === "waiting" ? "waiting" : "running" });
    }
  }
  return tools;
}
