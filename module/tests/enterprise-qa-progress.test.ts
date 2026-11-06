import {describe, expect, it} from "vitest";
import {enterpriseQaProgress} from "../contracts/enterprise-qa-progress";

function event(overrides: Record<string, unknown> = {}) {
  return {id: "internal-event", turnId: "internal-turn", userMessageId: "current-question", userSequence: 2,
    rank: 0, timestamp: 100, kind: "tool", label: "读取文件", status: "running", ...overrides};
}
function progress(timeline: unknown[], overrides: Record<string, unknown> = {}) {
  return enterpriseQaProgress({execution: {timeline}, questionId: "current-question", running: true, ...overrides});
}

describe("safe enterprise QA progress shared by RAG and the public website", () => {
  it("rejects malformed snapshots and unbound history", () => {
    for (const execution of [undefined, null, [], {}, {timeline: null}, {timeline: [null, false, {}, event({rank: NaN}), event({timestamp: Infinity})]}]) {
      expect(enterpriseQaProgress({execution, questionId: "current-question", running: true})).toEqual([]);
    }
    expect(progress([event()], {questionId: undefined})).toEqual([]);
    expect(progress([event()], {running: false})).toEqual([]);
    expect(progress([event()], {turnId: "another-turn"})).toEqual([]);
    expect(progress([event({userMessageId: "old-question"})], {questionSequence: 2})).toEqual([]);
  });

  it("uses only the newest turn of this question and can enforce a supplied turn", () => {
    const timeline = [event({id: "old", turnId: "old-turn", timestamp: 50}), event(), event({id: "other", userMessageId: "other-question", timestamp: 200})];
    expect(progress(timeline)).toEqual([{id: "progress:0", label: "读取文件", status: "running"}]);
    expect(progress(timeline, {turnId: "old-turn"})).toEqual([{id: "progress:0", label: "读取文件", status: "running"}]);
    expect(progress([event({userMessageId: undefined})], {questionSequence: 2})).toHaveLength(1);
    expect(progress([event()], {questionId: undefined, questionSequence: 2})).toHaveLength(1);
  });

  it("projects actual completed preparation without inventing subsequent retrieval", () => {
    expect(progress([
      event({id: "knowledge", kind: "status", phase: "loading_knowledge", rank: -1, status: "ended", label: "secret"}),
      event({id: "submit", kind: "status", phase: "submitting_question", rank: -2, status: "ended"}),
      event({id: "unknown-phase", kind: "status", phase: "private_phase", status: "running"}),
    ])).toEqual([
      {id: "progress:0", label: "提交问题", status: "completed"},
      {id: "progress:1", label: "读取知识依据", status: "completed"},
    ]);
  });

  it("never exposes identifiers, payloads, reasoning or public-summary source text", () => {
    const result = progress([
      event({id: "secret-tool", label: "/private/path", status: "returned", arguments: "token=secret", result: "private"}),
      event({id: "secret-status", rank: 1, kind: "status", status: "thinking", thinkingText: "private reasoning", publicSummary: "free-form source text", publicSummaryTitle: "untrusted title"}),
    ]);
    expect(result).toEqual([
      {id: "progress:0", label: "调用工具", status: "unconfirmed"},
      {id: "progress:1", label: "整理回答", status: "running"},
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|private|internal|current-question|free-form|untrusted/);
  });

  it("validates tool outcomes and preserves actual failed or waiting stages", () => {
    expect(progress([
      event({status: "provider-specific-state"}),
      event({id: "waiting", rank: 1, kind: "status", phase: "searching_knowledge", status: "waiting"}),
      event({id: "failed", rank: 2, kind: "status", phase: "answering", status: "error"}),
    ])).toEqual([
      {id: "progress:1", label: "查找企业知识", status: "waiting"},
      {id: "progress:2", label: "生成回答", status: "failed"},
    ]);
  });

  it("deduplicates event snapshots and does not append a generic status over active work", () => {
    expect(progress([
      event({status: "completed"}), event(),
      event({id: "thinking", rank: 1, kind: "status", status: "thinking"}),
    ])).toEqual([{id: "progress:0", label: "读取文件", status: "running"}]);
  });
});
