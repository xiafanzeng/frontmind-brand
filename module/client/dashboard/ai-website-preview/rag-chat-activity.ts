export type RagChatActivity = {
  id: string;
  label: string;
  status: "running" | "completed" | "waiting" | "failed" | "unconfirmed";
};

export type RagChatActivityRow = RagChatActivity & { text: string; count: number };

// Only public activity categories belong in the compact chat presentation.
// Commands, paths and provider reasoning stay outside this component.
const activityLabels = new Set([
  "读取文件", "编辑文件", "执行命令", "搜索网页", "检索知识", "检索企业资料",
  "读取参考片段", "整理回答", "生成回答", "处理任务", "调用工具", "补充要求",
  "写入文件", "检索文本", "查找文件", "查看目录", "读取网页", "浏览网页", "运行代码", "调用扩展工具",
]);

export function ragChatActivityRows(activity: readonly RagChatActivity[] = []): RagChatActivityRow[] {
  const rows: Array<RagChatActivity & { count: number }> = [];
  for (const item of activity) {
    const raw = item.label.replace(/^(?:正在|已)/u, "").replace(/[…。]+$/u, "");
    const label = activityLabels.has(raw) ? raw : "处理任务";
    const previous = rows.at(-1);
    if (item.status === "completed" && previous?.status === "completed" && previous.label === label) previous.count += 1;
    else rows.push({ ...item, label, count: 1 });
  }
  return rows.map(item => ({
    ...item,
    text: item.status === "running" ? `正在${item.label}…`
      : item.status === "completed" ? `已${item.label}${item.count > 1 ? `（${item.count} 次）` : ""}`
      : item.status === "failed" ? `${item.label}失败`
      : item.status === "waiting" ? `${item.label}，等待确认`
      : `${item.label}，结果待确认`,
  }));
}
