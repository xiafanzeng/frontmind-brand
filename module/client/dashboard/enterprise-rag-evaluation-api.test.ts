import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  assertActive: vi.fn(),
  headers: vi.fn((extra: Record<string, string> = {}) => ({
    "X-Workspace": "workspace-1",
    ...extra,
  })),
}));

vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => mocks,
}));

import { liveEnterpriseRagEvaluationApi } from "./enterprise-rag-evaluation-api";
import { createRagChecklist, scoreRagChecklist } from "../../contracts/enterprise-rag-checklist";

function run(status = "running") {
  return {
    operationId: "operation-1",
    sourceQaTaskId: "task-1",
    turnId: "turn-1",
    status,
    createdAt: "2026-10-26T01:00:00.000Z",
    updatedAt: "2026-10-26T01:00:01.000Z",
    report: null,
    error: null,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enterprise RAG evaluation API", () => {
  it("loads server history with GET only and both immutable answer coordinates", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ latest: run(), history: [run("completed")] }),
    );

    const result = await liveEnterpriseRagEvaluationApi.latest({
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
    });

    expect(result.latest?.operationId).toBe("operation-1");
    expect(result.history).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-evaluations?sourceQaTaskId=task-1&turnId=turn-1",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("starts evaluation only through an explicit POST with the idempotency id", async () => {
    mocks.fetch.mockResolvedValueOnce(json(run("queued")));

    await liveEnterpriseRagEvaluationApi.start({
      clientRequestId: "5b68c3e8-6c46-4a0f-9a95-214c987be14e",
      sourceQaTaskId: "task-1",
      turnId: "turn-1",
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/modules/brand/rag-evaluations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          clientRequestId: "5b68c3e8-6c46-4a0f-9a95-214c987be14e",
          sourceQaTaskId: "task-1",
          turnId: "turn-1",
        }),
      }),
    );
  });

  it("rejects a structurally invalid run instead of displaying it", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ status: "completed" }));

    await expect(
      liveEnterpriseRagEvaluationApi.observe("operation-1"),
    ).rejects.toThrow(/数据结构不正确/);
  });
});

it("reads a completed v2 operation whose quality conclusion is pending", async () => {
  const ids = ["intent","correctness","completeness","citations","clarity","boundaries"];
  const report = {
    reportId:"report-2",sourceQaTaskId:"task-1",sourceTurnId:"turn-1",questionMessageId:"q",answerMessageId:"a",completedAt:"2026-10-27T01:00:00Z",
    knowledgeBase:{snapshotId:"kb",contentHash:"a".repeat(64)},
    evaluator:{skillId:"enterprise-rag-evaluation",skillVersion:"2.0.0",judgeVersion:"2.0.0",ruleVersion:"rag-eval-1.3",model:"fixture"},
    judgments:{schemaVersion:2,dimensions:ids.map(id=>({id})),gates:["facts","citations","permissions","safety","unknown","injection","availability"].map(id=>({id})),claims:[{id:"claim-1",statement:"暂无法确认。",kind:"uncertainty",relevance:"core",status:"not_applicable",sourceIds:[],rationale:"合成未知说明。"}],task:{status:"undetermined"},findings:[]},
    result:{skillId:"enterprise-rag-evaluation",version:"2.0.0",status:"pending",answerVerdict:"pending",score:null,coverage:80,recommendation:"publish_with_risk",summary:"必要前提待确认。",relatedReportIds:[],risks:[],
      dimensions:ids.map((id,index)=>({id,label:id,status:index===0?"pending":"passed",score:index===0?null:10,maxScore:20,summary:"合成输入。",evidenceIds:["a"]}))},
  };
  mocks.fetch.mockResolvedValueOnce(json({...run("completed"),report}));
  expect((await liveEnterpriseRagEvaluationApi.observe("operation-1")).report?.result.answerVerdict).toBe("pending");
  const malformed = structuredClone(report); delete (malformed.judgments as {findings?:unknown}).findings;
  mocks.fetch.mockResolvedValueOnce(json({...run("completed"),report:malformed}));
  await expect(liveEnterpriseRagEvaluationApi.observe("operation-1")).rejects.toThrow(/数据结构不正确/);
});

it("validates v3 checklist reports and rejects score/checklist drift", async () => {
  const checklist = createRagChecklist("地址在哪里？", "query");
  const checks = checklist.checks.map((check) => ({
    id: check.id,
    status: "met" as const,
    rationale: "合成固定判断：本项满足。",
    evidenceIds: ["answer:a"],
  }));
  const scored = scoreRagChecklist(checklist, checks);
  const judgments = {
    schemaVersion: 3 as const,
    operationToken: "operation-1",
    inputHash: "a".repeat(64),
    checklist,
    checks,
    dimensions: scored.dimensions.map((dimension) => ({
      id: dimension.id,
      level: 4,
      rationale: dimension.summary,
      evidenceIds: dimension.evidenceIds,
    })),
    gates: ["facts", "citations", "permissions", "safety", "unknown", "injection", "availability"].map((id) => ({
      id, status: "passed" as const, reason: "合成固定判断。", evidenceIds: ["answer:a"],
    })),
    claims: [{ id: "claim-1", statement: "地址在合成路1号。", kind: "fact", relevance: "core", status: "supported", sourceIds: ["source-1"], rationale: "合成资料支持。" }],
    task: { status: "completed", rationale: "任务完成。", evidenceIds: ["answer:a"] },
    findings: [], optionalSuggestions: [], summary: "合成 v3 报告。",
  };
  const report = {
    reportId: "report-3", sourceQaTaskId: "task-1", sourceTurnId: "turn-1",
    questionMessageId: "q", answerMessageId: "a", completedAt: "2026-10-28T01:00:00Z",
    knowledgeBase: { snapshotId: "kb", contentHash: "b".repeat(64) },
    evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "3.0.0", judgeVersion: "3.0.0", ruleVersion: "rag-eval-1.4", model: "fixture" },
    judgments,
    result: {
      skillId: "enterprise-rag-evaluation", version: "3.0.0", status: "completed",
      answerVerdict: "usable", score: scored.score, coverage: scored.coverage,
      recommendation: "recommended", summary: "合成 v3 报告。", risks: [], relatedReportIds: [],
      dimensions: scored.dimensions.map(({ checks: _checks, ...dimension }) => dimension),
    },
  };
  mocks.fetch.mockResolvedValueOnce(json({ ...run("completed"), report }));
  expect((await liveEnterpriseRagEvaluationApi.observe("operation-1")).report?.result.score).toBe(100);

  const drifted = structuredClone(report);
  drifted.result.score = 99;
  mocks.fetch.mockResolvedValueOnce(json({ ...run("completed"), report: drifted }));
  await expect(liveEnterpriseRagEvaluationApi.observe("operation-1")).rejects.toThrow(/数据结构不正确/);

  const mixed = structuredClone(report);
  mixed.evaluator.ruleVersion = "rag-eval-1.3";
  mocks.fetch.mockResolvedValueOnce(json({ ...run("completed"), report: mixed }));
  await expect(liveEnterpriseRagEvaluationApi.observe("operation-1")).rejects.toThrow(/数据结构不正确/);

  const unknown = structuredClone(report) as any;
  unknown.judgments.schemaVersion = 4;
  delete unknown.result.answerVerdict;
  mocks.fetch.mockResolvedValueOnce(json({ ...run("completed"), report: unknown }));
  await expect(liveEnterpriseRagEvaluationApi.observe("operation-1")).rejects.toThrow(/数据结构不正确/);
});
