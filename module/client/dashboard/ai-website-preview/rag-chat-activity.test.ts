import { describe, expect, it } from "vitest";
import { ragChatActivityRows } from "./rag-chat-activity";

describe("public Chinese RAG activity", () => {
  it("combines only adjacent completed invocations and preserves active or uncertain outcomes", () => {
    const rows = ragChatActivityRows([
      { id: "read-1", label: "读取文件", status: "completed" },
      { id: "read-2", label: "已读取文件", status: "completed" },
      { id: "shell", label: "执行命令", status: "completed" },
      { id: "read-3", label: "读取文件", status: "running" },
      { id: "edit", label: "编辑文件", status: "unconfirmed" },
      { id: "wait", label: "调用工具", status: "waiting" },
      { id: "error", label: "执行命令", status: "failed" },
    ]);
    expect(rows.map(row => row.text)).toEqual([
      "已读取文件（2 次）", "已执行命令", "正在读取文件…", "编辑文件，结果待确认", "调用工具，等待确认", "执行命令失败",
    ]);
    expect(rows[0].id).toBe("read-1");
    expect(rows[0].count).toBe(2);
  });

  it("uses a generic public category instead of exposing unknown English logs, paths or reasoning", () => {
    const values = ["Editing Files", "/private/work/secrets.txt", "内部推理：具体私密内容", "implementing root hook"];
    const rows = ragChatActivityRows(values.map((label, index) => ({ id: String(index), label, status: "running" })));
    expect(rows.every(row => row.text === "正在处理任务…")).toBe(true);
    expect(ragChatActivityRows()).toEqual([]);
  });
});
