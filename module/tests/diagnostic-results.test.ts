// @vitest-environment node
import { describe, it, expect } from "vitest";
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
