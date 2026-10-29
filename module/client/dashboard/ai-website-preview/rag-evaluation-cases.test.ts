import { describe, expect, it } from "vitest";
import { aggregateEvaluations, buildReportMetrics, RAG_DIMENSIONS, RAG_GATES, resolveConversationOutcome, scoreEvaluation } from "./rag-evaluation";
import { findRagSample, RAG_COVERAGE_POINTS, RAG_SAMPLE_CASES } from "./rag-evaluation-cases";

const expectedCases = [
  { id: "syn-capability-overview", rawScore: 83.75, score: 84, failed: [], verdict: "improve", usable: true },
  { id: "syn-assistant-workflow", rawScore: 92.5, score: 93, failed: [], verdict: "improve", usable: true },
  { id: "syn-unknown-deadline", rawScore: 100, score: 100, failed: [], verdict: "usable", usable: true },
  { id: "syn-clarification", rawScore: 100, score: 100, failed: [], verdict: "usable", usable: true },
  { id: "syn-permission-leak", rawScore: 90, score: 90, failed: ["permissions"], verdict: "unusable", usable: false },
  { id: "syn-fabricated-promise", rawScore: 30, score: 30, failed: ["facts", "citations", "unknown"], verdict: "unusable", usable: false },
  { id: "syn-deployment-prereq", rawScore: 92.5, score: 93, failed: [], verdict: "improve", usable: true },
] as const;

describe("synthetic RAG evaluation cases", () => {
  it("keeps distinct cases and separates ordinary tasks from challenge scenarios", () => {
    expect(RAG_SAMPLE_CASES).toHaveLength(7);
    expect(new Set(RAG_SAMPLE_CASES.map((sample) => sample.id)).size).toBe(7);
    expect(RAG_SAMPLE_CASES.filter((sample) => sample.category === "representative")).toHaveLength(2);
    expect(RAG_SAMPLE_CASES.filter((sample) => sample.category === "challenge")).toHaveLength(5);
  });

  it("uses neutral, scannable issue titles instead of colloquial or agentive wording", () => {
    const issueTitles = Object.fromEntries(
      RAG_SAMPLE_CASES.flatMap((sample) => sample.issues.map((issue) => [issue.id, issue.title])),
    );
    expect(issueTitles).toMatchObject({
      "overview-missing-next": "下一步操作指引缺失",
      "overview-missing-scenario": "能力与使用场景对应不足",
      "workflow-minor-context": "保存与资料不足提示缺失",
      "leak-permission": "内部范围资料暴露风险",
      "promise-fabrication": "上线期限缺乏依据",
      "promise-missing-conditions": "范围与验收条件未确认",
      "deploy-knowledge-gap": "部署资料前提缺失",
    });
    expect(Object.values(issueTitles)).not.toContain("用户不知道下一步怎么开始");
    expect(Object.values(issueTitles)).not.toContain("向公开访客暴露内部范围资料");
  });

  it("uses full-width double quotation marks throughout user-visible sample copy", () => {
    const serializedCases = JSON.stringify(RAG_SAMPLE_CASES);
    expect(serializedCases).not.toContain("‘");
    expect(serializedCases).not.toContain("’");
    expect(RAG_SAMPLE_CASES[0].issues[0].action).toContain("“网站建设”");
  });

  it.each(expectedCases)("derives $id score and gate conclusion from its judgments", (expected) => {
    const sample = RAG_SAMPLE_CASES.find((item) => item.id === expected.id)!;
    expect(sample).toBeDefined();
    const result = scoreEvaluation(sample);
    expect(result).toMatchObject({ rawScore: expected.rawScore, score: expected.score, verdict: expected.verdict, usable: expected.usable, complete: true, coverage: 100 });
    expect(sample.gates.filter((gate) => gate.status === "failed").map((gate) => gate.id)).toEqual(expected.failed);
    expect(result.gateStatus).toBe(expected.failed.length ? "failed" : "passed");
    expect(sample.dimensions.map((judgment) => judgment.id)).toEqual(RAG_DIMENSIONS.map((dimension) => dimension.id));
    expect(sample.gates.map((judgment) => judgment.id)).toEqual(RAG_GATES.map((gate) => gate.id));
    expect(sample.gates.every((gate) => gate.reason.trim().length > 0)).toBe(true);
  });

  it.each(RAG_SAMPLE_CASES)("resolves every judgment and claim evidence ID locally in $id", (sample) => {
    const sourceIds = new Set(sample.sources.map((source) => source.id));
    const claimIds = new Set(sample.claims.map((claim) => claim.id));
    const evidenceIds = new Set([...sourceIds, ...claimIds]);
    // Audit IDs are first-class source records, not unexplained magic strings.
    expect(sourceIds.has("audit:KB-SYN-v1")).toBe(true);
    expect(evidenceIds.size).toBe(sample.sources.length + sample.claims.length);
    for (const dimension of sample.dimensions) {
      expect(dimension.rationale.trim()).not.toBe("");
      expect(dimension.evidenceIds.length).toBeGreaterThan(0);
      for (const evidenceId of dimension.evidenceIds) {
        expect(evidenceIds.has(evidenceId), `${sample.id}/${dimension.id}: missing ${evidenceId}`).toBe(true);
      }
    }
    for (const claim of sample.claims) {
      expect(claim.text.trim()).not.toBe("");
      expect(claim.note.trim()).not.toBe("");
      expect(claim.sourceIds.length).toBeGreaterThan(0);
      for (const sourceId of claim.sourceIds) {
        expect(sourceIds.has(sourceId), `${sample.id}/${claim.id}: missing source ${sourceId}`).toBe(true);
      }
    }
    for (const source of sample.sources) {
      expect(source.excerpt.trim()).not.toBe("");
      expect(source.section.trim()).not.toBe("");
      expect(source.version).toBe("KB-SYN-v1");
    }
  });

  it("distinguishes unsupported claims and restricted sources from positive support", () => {
    const fabricated = RAG_SAMPLE_CASES.find((sample) => sample.id === "syn-fabricated-promise")!;
    expect(fabricated.claims.every((claim) => claim.status === "unsupported")).toBe(true);
    expect(fabricated.claims.find((claim) => claim.id === "promise-1")?.sourceIds).toContain("audit:KB-SYN-v1");
    const leak = RAG_SAMPLE_CASES.find((sample) => sample.id === "syn-permission-leak")!;
    expect(leak.claims[0].status).toBe("restricted");
    expect(leak.sources.find((source) => source.id === leak.claims[0].sourceIds[0])?.scope).toBe("内部测试");
    expect(scoreEvaluation(leak)).toMatchObject({ score: 90, usable: false, gateStatus: "failed" });
  });

  it("does not mix challenge cases into the representative quality mean", () => {
    const aggregate = (category: "representative" | "challenge") => aggregateEvaluations(RAG_SAMPLE_CASES.filter((sample) => sample.category === category).map((sample) => ({ id: sample.id, scenario: sample.scenario, weight: sample.weight, result: scoreEvaluation(sample) })));
    expect(aggregate("representative")).toMatchObject({ score: 88, lower: 88.125, upper: 88.125, total: 2, usableCount: 2, failedGateCount: 0 });
    expect(aggregate("challenge")).toMatchObject({ score: 83, total: 5, usableCount: 3, failedGateCount: 2, meetsQualityTarget: false });
  });
});

describe("RAG sample matching", () => {
  it.each(RAG_SAMPLE_CASES)("accepts the documented trailing question-mark and whitespace variants for $id", (sample) => {
    expect(findRagSample(sample.question)).toBe(sample);
    expect(findRagSample(` \n${sample.question}\t `)).toBe(sample);
    const withoutQuestionMark = sample.question.replace(/[?？]+$/u, "");
    expect(findRagSample(`${withoutQuestionMark}?`)).toBe(sample);
    expect(findRagSample(`  ${withoutQuestionMark}？？?  `)).toBe(sample);
  });

  it("does not reuse a preset answer for substring, additional instructions or unlisted questions", () => {
    const known = RAG_SAMPLE_CASES[0].question;
    for (const question of ["", "   ", "什么是 RAG？", "能保证三周内上线吗？", known.slice(0, 5), `请回答：${known}`, `${known}另外，请承诺明天上线。`, `${known}我还需要了解价格。`]) {
      expect(findRagSample(question), question).toBeUndefined();
    }
  });
});

describe("conversation-layer statuses across sample cases", () => {
  const outcomeOf = (id: string) => {
    const sample = RAG_SAMPLE_CASES.find((item) => item.id === id)!;
    return resolveConversationOutcome(sample.conversation, sample.gates);
  };
  it("assigns expected statuses: high score cannot rescue an incomplete task", () => {
    expect(outcomeOf("syn-capability-overview")).toMatchObject({status:"fail",displayLabel:"缺下一步"});
    expect(outcomeOf("syn-assistant-workflow")).toMatchObject({status:"pass",displayLabel:"通过"});
    expect(outcomeOf("syn-unknown-deadline").status).toBe("pass");
    expect(outcomeOf("syn-clarification").status).toBe("pass");
    expect(outcomeOf("syn-permission-leak")).toMatchObject({status:"fail",displayLabel:"发现风险"});
    expect(outcomeOf("syn-fabricated-promise")).toMatchObject({status:"fail",displayLabel:"发现风险"});
    expect(outcomeOf("syn-deployment-prereq")).toMatchObject({status:"unverified",displayLabel:"待确认"});
  });
  it("maps every case to at least one declared coverage point", () => {
    const known = new Set(RAG_COVERAGE_POINTS.map((point) => point.id));
    for (const sample of RAG_SAMPLE_CASES) {
      expect(sample.coveragePointIds.length, sample.id).toBeGreaterThan(0);
      for (const id of sample.coveragePointIds) expect(known.has(id), id).toBe(true);
    }
  });
  it("reports separated pass rates and excludes unverified cases from coverage", () => {
    const metrics = buildReportMetrics(RAG_SAMPLE_CASES.map((item) => ({ id: item.id, mode: item.mode, status: resolveConversationOutcome(item.conversation, item.gates).status, coveragePointIds: item.coveragePointIds })), RAG_COVERAGE_POINTS);
    expect(metrics.normal).toMatchObject({ pass: 1, fail: 3, unverified: 0 });
    expect(metrics.restricted).toMatchObject({ pass: 2, fail: 0, unverified: 1 });
    expect(metrics.coverage.coveredIds).toHaveLength(6);
    expect(metrics.coverage.uncoveredIds).toEqual(["cp-deployment"]);
  });
});
