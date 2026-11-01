// @vitest-environment node
import { describe, it, expect } from "vitest";
import { diagnosticEvidenceCatalog } from "../server/diagnostic-evidence.js";
import {
  validateAssessment,
  diagnosticMetrics,
  diagnosticBreakdown,
  validateQuestionDecisions,
} from "../server/diagnostic-results.js";
import type {
  DiagnosticAssessment,
  KnowledgeBasis,
  DiagnosticSample,
} from "../contracts/diagnostics.js";
const basis: KnowledgeBasis = {
  snapshotId: "s",
  version: 1,
  buildId: "b",
  conversationId: "c",
  companyName: "甲医院",
  contentHash: "h",
  documents: [
    { path: "service.md", title: "服务", content: "医学美容科提供激光服务。" },
  ],
};
const samples: DiagnosticSample[] = [
  {
    id: "1",
    category: "industry_ranking",
    platform: "doubao",
    run: 1,
    question: "本地医美机构推荐",
    answer: "推荐：1. 甲医院医学美容科；2. 乙机构。",
    citations: [],
  },
  {
    id: "2",
    category: "industry_ranking",
    platform: "doubao",
    run: 2,
    question: "本地医美机构推荐",
    answer: "甲医院有综合医疗服务。",
    citations: [],
  },
];
const assessment: DiagnosticAssessment = {
  category: "industry_ranking",
  summary: "本轮明确推荐科室的回答只有一份。",
  topics: [
    {
      topic: "激光服务",
      verdict: "omitted",
      docPath: "service.md",
      kbExcerpt: "医学美容科提供激光服务。",
      answerRefs: [],
      explanation: "本轮未说明激光服务。",
    },
  ],
  answers: [
    {
      sampleId: "1",
      mentioned: true,
      attribution: "subject",
      mentionEvidence: "甲医院医学美容科",
      recommended: true,
      rank: 1,
      recommendationEvidence: "推荐：1. 甲医院医学美容科",
      competitors: [{ name: "乙机构", rank: 2, excerpt: "2. 乙机构" }],
    },
    {
      sampleId: "2",
      mentioned: true,
      attribution: "parent_only",
      mentionEvidence: "甲医院有综合医疗服务",
      recommended: false,
      rank: null,
      recommendationEvidence: "",
      competitors: [],
    },
  ],
};
describe("四类诊断证据与指标", () => {
  it("restores source-local answer references before computing persisted metrics", () => {
    const indexed = diagnosticEvidenceCatalog(samples, basis);
    expect(indexed.samples.map((s) => s.id)).toEqual(["A0", "A1"]);
    const a = structuredClone(assessment);
    a.answers[0].sampleId = "A0";
    a.answers[1].sampleId = "A1";
    a.answers[0].mentionEvidence = "@quote:A0.0";
    a.answers[1].mentionEvidence = "@quote:A1.0";
    a.topics[0].verdict = "unverifiable";
    a.topics[0].answerRefs = [{ sampleId: "A0", excerpt: "@quote:A0.0" }];
    const result = validateAssessment(a, "industry_ranking", samples, basis);
    expect(result.answers.map((s) => s.sampleId)).toEqual(["1", "2"]);
    expect(result.topics[0].answerRefs[0]).toEqual({
      sampleId: "1", excerpt: samples[0].answer,
    });
    expect(diagnosticMetrics(result).find((m) => m.id === "mention")?.sampleIds).toEqual(["1"]);
    a.answers[1].sampleId = "1";
    expect(() => validateAssessment(a, "industry_ranking", samples, basis)).toThrow(/未完整对应/);
    a.answers[1].sampleId = "A99";
    expect(() => validateAssessment(a, "industry_ranking", samples, basis)).toThrow(/其他样本/);
  });
  it("reports all cross-source quote failures and their allowed source ranges in one repair", () => {
    const a = structuredClone(assessment);
    a.answers[0].mentionEvidence = "@quote:A1.0";
    a.answers[1].mentionEvidence = "@quote:A0.0";
    a.topics[0].kbExcerpt = "@quote:A0.0";
    expect(() => validateAssessment(a, "industry_ranking", samples, basis)).toThrow(
      /docPath[\s\S]*@quote:K0\.0[\s\S]*sampleId.*1[\s\S]*范围=@quote:A0\.0[\s\S]*sampleId.*2[\s\S]*范围=@quote:A1\.0/,
    );
  });
  it("resolves model-selected evidence to exact source text and rejects cross-source IDs", () => {
    const a = structuredClone(assessment);
    a.topics[0].kbExcerpt = "@quote:K0.0";
    a.answers[0].mentionEvidence = "@quote:A0.0";
    a.answers[0].recommendationEvidence = "@quote:A0.0";
    a.answers[0].competitors[0].excerpt = "@quote:A0.0";
    a.answers[1].mentionEvidence = "@quote:A1.0";
    const result = validateAssessment(a, "industry_ranking", samples, basis);
    expect(result.topics[0].kbExcerpt).toBe(basis.documents[0].content);
    expect(result.answers[0]).toMatchObject({
      mentionEvidence: samples[0].answer,
    });
    a.answers[1].mentionEvidence = "@quote:A0.0";
    expect(() =>
      validateAssessment(a, "industry_ranking", samples, basis),
    ).toThrow(/不属于当前来源/);
    a.answers[1].mentionEvidence = "@quote:A1.9999";
    expect(() =>
      validateAssessment(a, "industry_ranking", samples, basis),
    ).toThrow(/不属于当前来源/);
    a.answers[1].mentionEvidence = "@quote:A1.0";
    a.topics[0].kbExcerpt = "@quote:A1.0";
    expect(() =>
      validateAssessment(a, "industry_ranking", samples, basis),
    ).toThrow(/不属于当前来源/);
  });
  it("indexes long Unicode evidence without changing text or silently truncating it", () => {
    const answer = "甲".repeat(799) + "😀" + "乙".repeat(805);
    const indexed = diagnosticEvidenceCatalog(
      [{ ...samples[0], answer }],
      basis,
    );
    expect(indexed.samples[0].excerpts.map((x) => x.text).join("")).toBe(
      answer,
    );
    expect(
      indexed.samples[0].excerpts.every(
        (x) => x.text.length <= 800 && answer.includes(x.text),
      ),
    ).toBe(true);
  });
  it("returns sample-specific evidence failures together so one repair can correct all invalid quotes", () => {
    const invalid = structuredClone(assessment);
    invalid.answers[0].mentionEvidence = "不存在的第一段证据";
    invalid.answers[1].mentionEvidence = "不存在的第二段证据";
    expect(() =>
      validateAssessment(invalid, "industry_ranking", samples, basis),
    ).toThrow(/sampleId=1[\s\S]*sampleId=2/);
  });

  it("产品覆盖要求逐回答判读，部分遗漏不计为整体遗漏", () => {
    const source = samples.map((s, i) => ({
      ...s,
      category: "product_scenario" as const,
      answer: i ? "请到院咨询" : "医学美容科提供激光服务。",
    }));
    const a: DiagnosticAssessment = {
      category: "product_scenario",
      summary: "一份回答提到服务，另一份未覆盖。",
      topics: assessment.topics,
      answers: source.map((s) => ({ sampleId: s.id, claims: [] })),
      knowledgeCoverage: [
        {
          point: "激光服务",
          docPath: "service.md",
          kbExcerpt: "医学美容科提供激光服务。",
          answers: [
            {
              sampleId: "1",
              covered: true,
              excerpt: "医学美容科提供激光服务。",
            },
            { sampleId: "2", covered: false, excerpt: "" },
          ],
        },
      ],
    };
    validateAssessment(a, "product_scenario", source, basis);
    const aliased = structuredClone(a);
    aliased.answers.forEach((answer, i) => { answer.sampleId = `A${i}`; });
    aliased.knowledgeCoverage[0].answers.forEach((answer, i) => { answer.sampleId = `A${i}`; });
    aliased.knowledgeCoverage[0].answers[0].excerpt = "@quote:A0.0";
    expect(validateAssessment(aliased, "product_scenario", source, basis)).toEqual(a);
    expect(diagnosticMetrics(a).find((m) => m.id === "coverage")).toMatchObject(
      { value: 100, denominator: 1 },
    );
    expect(diagnosticMetrics(a).find((m) => m.id === "omitted")?.value).toBe(0);
    const b = diagnosticBreakdown(a, source, "甲医院");
    expect(b.coverage[0]).toMatchObject({
      sampleIds: ["1"],
      missingSampleIds: ["2"],
      platforms: [{ count: 1, denominator: 2 }],
    });
    const partial = structuredClone(a);
    partial.knowledgeCoverage[0]!.answers.pop();
    expect(() =>
      validateAssessment(partial, "product_scenario", source, basis),
    ).toThrow(/全部回答/);
    const noPoints = structuredClone(a);
    noPoints.knowledgeCoverage = [];
    validateAssessment(noPoints, "product_scenario", source, basis);
    expect(
      diagnosticMetrics(noPoints).find((m) => m.id === "coverage")?.value,
    ).toBeNull();
    expect(
      diagnosticMetrics(noPoints).find((m) => m.id === "omitted")?.value,
    ).toBeNull();
    const duplicate = structuredClone(a);
    duplicate.knowledgeCoverage.push({
      ...duplicate.knowledgeCoverage[0]!,
      point: "第二份回答遗漏激光服务",
    });
    expect(() =>
      validateAssessment(duplicate, "product_scenario", source, basis),
    ).toThrow(/重复/);
  });
  it("平台、位次、信源和钻取都基于相同样本，重复引用不重复计数", () => {
    const source = { url: "https://example.com/evidence", title: "公开资料" };
    const b = diagnosticBreakdown(
      assessment,
      samples.map((s) => ({
        ...s,
        citations: [source, source],
        references: [source],
      })),
      "甲医院医学美容科",
    );
    expect(
      b.platforms[0].metrics.find((m) => m.id.endsWith(":recommend")),
    ).toMatchObject({ value: 50, denominator: 2, sampleIds: ["1"] });
    expect(b.ranks.find((r) => r.name === "乙机构")).toMatchObject({
      averageRank: 2,
      rankedSamples: 1,
      sampleIds: ["1"],
    });
    expect(b.sources).toHaveLength(2);
    expect(
      b.sources.every((s) => s.count === 2 && s.sampleIds.length === 2),
    ).toBe(true);
    expect(
      b.drilldowns.find((d) => d.id === b.sources[0].id)?.sampleIds,
    ).toEqual(["1", "2"]);
  });
  it("医院背景不计入科室推荐，缺失位次不补零", () => {
    const a = validateAssessment(
      assessment,
      "industry_ranking",
      samples,
      basis,
    );
    const m = diagnosticMetrics(a);
    expect(m.find((x) => x.id === "recommend")).toMatchObject({
      value: 50,
      denominator: 2,
      sampleIds: ["1"],
    });
    expect(m.find((x) => x.id === "average_rank")).toMatchObject({
      value: 1,
      denominator: 1,
    });
    expect(m.find((x) => x.id === "attribution_pending")?.value).toBe(1);
  });
  it("拒绝跨题样本、伪造引文和不属于冻结版本的知识", () => {
    const wrong = structuredClone(assessment);
    wrong.answers[0].sampleId = "elsewhere";
    expect(() =>
      validateAssessment(wrong, "industry_ranking", samples, basis),
    ).toThrow();
    const fabricated = structuredClone(assessment);
    fabricated.answers[0].mentionEvidence = "不存在的证据";
    expect(() =>
      validateAssessment(fabricated, "industry_ranking", samples, basis),
    ).toThrow(/原文/);
    const old = structuredClone(assessment);
    old.topics[0].docPath = "other.md";
    expect(() =>
      validateAssessment(old, "industry_ranking", samples, basis),
    ).toThrow(/冻结版本/);
  });
  it("无法判断舆情不当作中性，不为非排名题计算排名", () => {
    const a: DiagnosticAssessment = {
      category: "reputation",
      summary: "未提供足以判断口碑的信息。",
      topics: assessment.topics,
      answers: [
        {
          sampleId: "1",
          sentiment: "unknown",
          sentimentEvidence: "",
          risks: [],
        },
        {
          sampleId: "2",
          sentiment: "neutral",
          sentimentEvidence: "一般",
          risks: [],
        },
      ],
    };
    const m = diagnosticMetrics(a);
    expect(m.find((x) => x.id === "unknown")?.value).toBe(50);
    expect(m.find((x) => x.id === "neutral")?.value).toBe(50);
    expect(m.some((x) => x.id === "average_rank")).toBe(false);
  });
  it("同一回答多个主张按主张数统计，钻取列表去重", () => {
    const a: DiagnosticAssessment = {
      category: "product_scenario",
      summary: "产品主张部分与当前资料一致。",
      topics: assessment.topics,
      knowledgeCoverage: [
        {
          point: "服务",
          docPath: "service.md",
          kbExcerpt: "服务",
          answers: [{ sampleId: "1", covered: true, excerpt: "一" }],
        },
      ],
      answers: [
        {
          sampleId: "1",
          claims: [
            {
              claim: "一",
              excerpt: "一",
              verdict: "supported",
              docPath: "service.md",
              kbExcerpt: "服务",
            },
            {
              claim: "二",
              excerpt: "二",
              verdict: "supported",
              docPath: "service.md",
              kbExcerpt: "服务",
            },
            {
              claim: "三",
              excerpt: "三",
              verdict: "contradicted",
              docPath: "service.md",
              kbExcerpt: "服务",
            },
          ],
        },
      ],
    };
    expect(
      diagnosticMetrics(a).find((x) => x.id === "supported"),
    ).toMatchObject({ value: 66.7, denominator: 3, sampleIds: ["1"] });
  });
  it("自定义排名题可通过，但校验不能改写文本", () => {
    const q = {
      category: "industry_ranking" as const,
      text: "本地医美机构推荐",
    };
    const value = {
      decisions: [
        {
          ...q,
          accepted: true,
          reason: "属于该业务的开放推荐问题",
          evidenceRefs: ["service.md"],
        },
      ],
    };
    expect(validateQuestionDecisions(value, [q], basis)[0].accepted).toBe(true);
    expect(() =>
      validateQuestionDecisions(value, [{ ...q, text: "另一条问题" }], basis),
    ).toThrow(/改写/);
  });
});
