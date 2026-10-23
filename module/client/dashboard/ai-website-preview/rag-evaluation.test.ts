import { describe, expect, it } from "vitest";
import {
  aggregateEvaluations, buildReportMetrics, RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, resolveConversationOutcome, scoreEvaluation,
  type EvaluationInput, type EvaluationResult, type Rating,
} from "./rag-evaluation";

function input(levels: Array<Rating | null> = [4, 4, 3, 4, 3, 4]): EvaluationInput {
  return {
    dimensions: RAG_DIMENSIONS.map(({ id }, index) => ({ id, level: levels[index], rationale: "回答片段符合已锁定锚点。", evidenceIds: [`evidence-${id}`], applicable: true })),
    gates: RAG_GATES.map(({ id }) => ({ id, status: "passed", reason: "已核验本次回答和来源。" })),
  };
}

function result(rawScore: number): EvaluationResult {
  const scored = scoreEvaluation(input([4, 4, 4, 4, 4, 4]));
  return { ...scored, score: Math.round(rawScore), rawScore, lower: rawScore, upper: rawScore, usable: rawScore >= 80, verdict: rawScore >= 90 ? "excellent" : rawScore >= 80 ? "usable" : rawScore >= 70 ? "improve" : "unusable" };
}

describe("RAG single-answer scoring", () => {
  it("reproduces the documented six-dimension example without losing internal precision", () => {
    const scored = scoreEvaluation(input());
    expect(RAG_RULE_VERSION).toBe("rag-eval-1.2");
    expect(RAG_DIMENSIONS.reduce((sum, dimension) => sum + dimension.weight, 0)).toBe(100);
    expect(scored).toMatchObject({ rawScore: 92.5, score: 93, lower: 92.5, upper: 92.5, coverage: 100, gateStatus: "passed", verdict: "excellent", usable: true, complete: true, confidence: "medium" });
    expect(scored.earnedByDimension.completeness).toBe(11.25);
    expect(scored.confidence).not.toBe("high");
  });

  it("keeps unjudged weight in mathematical bounds rather than treating it as zero or renormalizing it", () => {
    const scored = scoreEvaluation(input([4, 4, null, 4, 3, 4]));
    expect(scored).toMatchObject({ score: null, rawScore: null, lower: 81.25, upper: 96.25, coverage: 85, verdict: "pending", usable: false, complete: false });
    expect(scored.earnedByDimension.completeness).toBeNull();
  });

  it("does not count numeric ratings without both a reason and evidence", () => {
    const sample = input();
    sample.dimensions[0].rationale = " ";
    sample.dimensions[1].evidenceIds = [" "];
    const scored = scoreEvaluation(sample);
    expect(scored).toMatchObject({ score: null, coverage: 55, lower: 47.5, upper: 92.5, complete: false });
  });

  it("allows well-evidenced correct refusal to receive full marks", () => {
    const sample = input([4, 4, 4, 4, 4, 4]);
    sample.dimensions.forEach((dimension) => {
      dimension.rationale = "快照审计确认没有业务答案；回答正确拒答并提供有效人工路径。";
      dimension.evidenceIds = ["snapshot-audit", "answer-refusal", "verified-contact"];
    });
    expect(scoreEvaluation(sample)).toMatchObject({ score: 100, verdict: "excellent", usable: true });
  });

  it("makes a permission gate failure override a high quality score", () => {
    const sample = input([4, 4, 4, 4, 4, 0]);
    sample.gates[2] = { id: "permissions", status: "failed", reason: "向公开访客暴露了内部资料。" };
    expect(scoreEvaluation(sample)).toMatchObject({ score: 90, gateStatus: "failed", verdict: "unusable", usable: false, complete: true, confidence: "low" });
  });

  it("blocks use while any gate remains pending, even when quality is known", () => {
    const sample = input([4, 4, 4, 4, 4, 4]);
    sample.gates[0].status = "pending";
    const scored = scoreEvaluation(sample);
    expect(scored).toMatchObject({ score: 100, coverage: 100, gateStatus: "pending", verdict: "pending", usable: false, complete: false });
  });

  it("requires a reason for passing gates and preserves a reported failure even without a reason", () => {
    const sample = input();
    sample.gates[0].reason = "";
    expect(scoreEvaluation(sample).gateStatus).toBe("pending");
    sample.gates[0].status = "failed";
    expect(scoreEvaluation(sample)).toMatchObject({ gateStatus: "failed", verdict: "unusable", complete: false });
  });

  it("renormalizes only preconfigured N/A dimensions with an explanation", () => {
    const sample = input([4, 4, 4, 4, 4, 4]);
    sample.dimensions[3].applicable = false;
    sample.dimensions[3].rationale = "用例启动前已批准不含企业事实的纯澄清问题。";
    sample.dimensions[3].level = null;
    sample.dimensions[3].evidenceIds = [];
    expect(scoreEvaluation(sample)).toMatchObject({ score: 100, coverage: 100, usable: true });
    sample.dimensions[3].rationale = "";
    expect(scoreEvaluation(sample)).toMatchObject({ score: null, coverage: 85, lower: 85, upper: 100 });
  });

  it("does not classify a rounded display score of 80 as usable when its raw score is below 80", () => {
    const sample = input([4, 3, 3, 3, 4, 3]);
    sample.dimensions[0].applicable = false;
    const scored = scoreEvaluation(sample);
    expect(scored.rawScore).toBe(79.6875);
    expect(scored).toMatchObject({ score: 80, verdict: "improve", usable: false });
  });

  it("keeps missing and duplicate dimensions pending instead of picking a favorable entry", () => {
    const missing = input();
    missing.dimensions.shift();
    expect(scoreEvaluation(missing)).toMatchObject({ score: null, coverage: 80, lower: 72.5, upper: 92.5 });
    const duplicate = input();
    duplicate.dimensions.push({ ...duplicate.dimensions[0], level: 0 });
    expect(scoreEvaluation(duplicate)).toMatchObject({ score: null, coverage: 80, lower: 72.5, upper: 92.5 });
  });

  it("returns pending for illegal ratings or all dimensions being inapplicable", () => {
    const illegal = input();
    illegal.dimensions[0].level = 5 as Rating;
    expect(scoreEvaluation(illegal)).toMatchObject({ score: null, coverage: 80, complete: false, verdict: "pending" });
    const noApplicable = input();
    noApplicable.dimensions.forEach((dimension) => { dimension.applicable = false; });
    expect(scoreEvaluation(noApplicable)).toMatchObject({ score: null, coverage: 0, lower: 0, upper: 100, complete: false });
  });

  it("keeps missing and duplicated gates from becoming fully passed", () => {
    const sample = input();
    sample.gates.pop();
    expect(scoreEvaluation(sample)).toMatchObject({ gateStatus: "pending", usable: false });
    sample.gates.push({ ...sample.gates[0] });
    expect(scoreEvaluation(sample)).toMatchObject({ gateStatus: "pending", usable: false });
  });

  it("gives unknown configuration no official score", () => {
    const sample = input();
    sample.dimensions.push({ ...sample.dimensions[0], id: "unexpected" as never });
    expect(scoreEvaluation(sample)).toMatchObject({ score: null, lower: 0, upper: 100, coverage: 0, complete: false });
  });
});

describe("RAG scenario-weighted aggregation", () => {
  it("averages cases within scenarios before applying locked scenario weights", () => {
    const aggregate = aggregateEvaluations([
      { id: "faq-1", scenario: "FAQ", weight: 1, result: result(100) },
      { id: "faq-2", scenario: "FAQ", weight: 1, result: result(100) },
      { id: "policy-1", scenario: "政策", weight: 3, result: result(80) },
    ]);
    expect(aggregate).toMatchObject({ score: 85, lower: 85, upper: 85, total: 3, coverage: 100, usableRate: 100, meetsQualityTarget: true });
  });

  it("retains pending cases in the denominator and shows a range until every case is complete", () => {
    const aggregate = aggregateEvaluations([
      { id: "ready", scenario: "FAQ", weight: 1, result: result(100) },
      { id: "pending", scenario: "FAQ", weight: 1, result: scoreEvaluation({ dimensions: [], gates: [] }) },
    ]);
    expect(aggregate).toMatchObject({ score: null, lower: 50, upper: 100, coverage: 50, total: 2, usableCount: 1, pendingCount: 1, usableRate: 50, meetsQualityTarget: false });
  });

  it("counts a confirmed system failure as complete and zero without dropping it", () => {
    const failed = input([0, 0, 0, 0, 0, 0]);
    failed.gates[6] = { id: "availability", status: "failed", reason: "日志确认空答被返回为成功。" };
    const aggregate = aggregateEvaluations([
      { id: "good", scenario: "FAQ", weight: 1, result: result(100) },
      { id: "system-failure", scenario: "FAQ", weight: 1, result: scoreEvaluation(failed) },
    ]);
    expect(aggregate).toMatchObject({ score: 50, total: 2, coverage: 100, failedGateCount: 1, usableRate: 50, pendingCount: 0, meetsQualityTarget: false });
  });

  it("fails the RAG quality target for any gate failure even when score and usable rate pass", () => {
    const cases = Array.from({ length: 10 }, (_, index) => ({ id: String(index), scenario: "FAQ", weight: 1, result: result(100) }));
    cases[0].result = { ...result(90), gateStatus: "failed", usable: false, verdict: "unusable", confidence: "low" };
    expect(aggregateEvaluations(cases)).toMatchObject({ score: 99, usableRate: 90, failedGateCount: 1, coverage: 100, meetsQualityTarget: false });
  });

  it("uses raw scores for the usable count and release threshold", () => {
    const aggregate = aggregateEvaluations([{ id: "rounded-80", scenario: "FAQ", weight: 1, result: result(79.75) }]);
    expect(aggregate).toMatchObject({ score: 80, lower: 79.75, usableCount: 0, usableRate: 0, meetsQualityTarget: false });
    expect(aggregateEvaluations([{ id: "rounded-85", scenario: "FAQ", weight: 1, result: result(84.75) }])).toMatchObject({ score: 85, usableRate: 100, meetsQualityTarget: false });
  });

  it("requires every scenario to meet its floor even when an overall mean is high", () => {
    expect(aggregateEvaluations([
      { id: "common", scenario: "FAQ", weight: 99, result: result(100) },
      { id: "rare", scenario: "高风险", weight: 1, result: result(79) },
    ])).toMatchObject({ score: 100, meetsQualityTarget: false });
  });

  it("rejects inconsistent scene weights, duplicate case IDs and empty batches", () => {
    const first = { id: "case", scenario: "FAQ", weight: 1, result: result(100) };
    expect(aggregateEvaluations([first, { ...first, id: "case-2", weight: 2 }])).toMatchObject({ score: null, total: 2, coverage: 0, pendingCount: 2, meetsQualityTarget: false });
    expect(aggregateEvaluations([first, first])).toMatchObject({ score: null, total: 2, meetsQualityTarget: false });
    expect(aggregateEvaluations([])).toMatchObject({ score: null, total: 0, coverage: 0, usableRate: 0, meetsQualityTarget: false });
  });
});

describe("conversation-layer outcome and report metrics", () => {
  const passedGates = RAG_GATES.map(({ id }) => ({ id, status: "passed" as const, reason: "ok" }));
  const layer = (overrides: Partial<import("./rag-evaluation").ConversationLayer> = {}) => ({
    task: "完成任务", runsRequired: 1 as const,
    completionPoints: [{ id: "p1", label: "必要点", met: true }],
    ...overrides,
  });
  it("passes only when all completion points are met and no gate failed", () => {
    expect(resolveConversationOutcome(layer(), passedGates).status).toBe("pass");
    expect(resolveConversationOutcome(layer({ completionPoints: [{ id: "p1", label: "必要点", met: false }] }), passedGates).status).toBe("fail");
    expect(resolveConversationOutcome(layer(), [...passedGates.slice(0, 2), { id: RAG_GATES[6].id, status: "failed", reason: "x" }, ...passedGates.slice(3, 6)])).toMatchObject({ status: "fail", blockingCount: 1 });
  });
  it("marks prerequisite-missing cases unverified regardless of gates or points", () => {
    const outcome = resolveConversationOutcome(layer({ prerequisiteMissing: true, completionPoints: [{ id: "p1", label: "必要点", met: null }] }), passedGates);
    expect(outcome.status).toBe("unverified");
    expect(outcome.reason).toContain("前提不足");
  });
  it("keeps normal and restricted pass rates separate and shows null for empty denominators", () => {
    const points = [{ id: "cp-a", label: "A", risk: "常规" }, { id: "cp-b", label: "B", risk: "高风险" }];
    const metrics = buildReportMetrics([
      { id: "1", mode: "normal", status: "pass", coveragePointIds: ["cp-a"] },
      { id: "2", mode: "normal", status: "fail", coveragePointIds: ["cp-a"] },
      { id: "3", mode: "restricted", status: "pass", coveragePointIds: ["cp-b"] },
      { id: "4", mode: "restricted", status: "unverified", coveragePointIds: [] },
    ], points);
    expect(metrics.normal.passRate).toBe(50);
    expect(metrics.restricted).toMatchObject({ pass: 1, fail: 0, unverified: 1, passRate: 100 });
    expect(metrics.coverage).toMatchObject({ coveredIds: ["cp-a", "cp-b"], uncoveredIds: [], rate: 100 });
    const empty = buildReportMetrics([{ id: "1", mode: "restricted", status: "unverified", coveragePointIds: ["cp-a"] }], points);
    expect(empty.restricted.passRate).toBeNull();
    expect(empty.coverage.uncoveredIds).toContain("cp-a");
  });
});
