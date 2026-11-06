import { describe, expect, it } from "vitest";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import { ragLiveActivity } from "./rag-live-activity";

const execution = { schemaVersion: 1, taskId: "task", coverage: "complete", timeline: [
  { id: "old", turnId: "old", userMessageId: "q0", userSequence: 1, rank: 1, timestamp: 1, kind: "tool", label: "读取文件", status: "running" },
  { id: "read", turnId: "current", userMessageId: "q1", userSequence: 2, rank: 2, timestamp: 2, kind: "tool", label: "读取文件", status: "completed" },
  { id: "unknown", turnId: "current", userMessageId: "q1", userSequence: 2, rank: 3, timestamp: 3, kind: "tool", label: "/private/path/secret", status: "returned" },
  { id: "thinking", turnId: "current", userMessageId: "q1", userSequence: 2, rank: 4, timestamp: 4, kind: "status", status: "thinking", thinkingText: "private reasoning" },
] } as GeneralExecutionDto;

describe("current RAG turn activity", () => {
  it("binds actual tool evidence to the current question and never exposes private text or unknown labels", () => {
    expect(ragLiveActivity({ execution, questionId: "q1", turnId: "current", running: true })).toEqual([
      { id: "progress:0", label: "读取文件", status: "completed" },
      { id: "progress:1", label: "调用工具", status: "unconfirmed" },
      { id: "progress:2", label: "整理回答", status: "running" },
    ]);
  });
  it("never borrows another turn's records and hides history once the answer is finished", () => {
    expect(ragLiveActivity({ execution, running: true })).toEqual([]);
    expect(ragLiveActivity({ execution, questionId: "absent", running: true })).toEqual([]);
    expect(ragLiveActivity({ execution, questionId: "q1", turnId: "old", running: true })).toEqual([]);
    expect(ragLiveActivity({ execution, questionSequence: 2, running: false })).toEqual([]);
    expect(ragLiveActivity({ execution, questionSequence: 2, running: true })).toHaveLength(3);
  });
  it("keeps real preparation phases that Core records as ended", () => {
    const preparation = {...execution, timeline: [
      {id: "submit", turnId: "current", userMessageId: "q1", userSequence: 2, rank: -2, timestamp: 2, kind: "status", phase: "submitting_question", label: "untrusted label", status: "ended"},
      {id: "knowledge", turnId: "current", userMessageId: "q1", userSequence: 2, rank: -1, timestamp: 2, kind: "status", phase: "loading_knowledge", status: "ended"},
    ]} as GeneralExecutionDto;
    expect(ragLiveActivity({execution: preparation, questionId: "q1", turnId: "current", running: true})).toEqual([
      {id: "progress:0", label: "提交问题", status: "completed"},
      {id: "progress:1", label: "读取知识依据", status: "completed"},
    ]);
  });
});
