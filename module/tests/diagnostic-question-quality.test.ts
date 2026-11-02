import { describe, expect, it } from "vitest";
import {
  diagnosticQuestionFormatIssue,
  assertDiagnosticQuestionPortfolio,
} from "../server/diagnostic-question-quality";
import type {
  DiagnosticRecommendation,
  KnowledgeBasis,
} from "../contracts/diagnostics";
const basis: KnowledgeBasis = {
  snapshotId: "s",
  version: 1,
  buildId: "b",
  conversationId: "c",
  companyName: "甲医院",
  contentHash: "h",
  documents: [
    {
      path: "service.md",
      title: "医学美容科",
      content:
        "甲医院医学美容科提供激光祛斑。乙医院也提供皮肤美容服务，双方服务范围有公开资料可核对。",
    },
  ],
};
const candidate = (
  input: Partial<DiagnosticRecommendation>,
): DiagnosticRecommendation => ({
  category: "industry_ranking",
  text: "东莞有哪些医美机构推荐？",
  rationale: "了解不点名时的推荐范围",
  enterpriseAnchor: null,
  offeringAnchor: null,
  competitorAnchor: null,
  evidenceRefs: ["service.md"],
  ...input,
});
describe("Brand short question contract", () => {
  it("accepts all four source-supported intents", () => {
    expect(() =>
      assertDiagnosticQuestionPortfolio(
        [
          candidate({}),
          candidate({
            category: "competitor_comparison",
            text: "甲医院与乙医院的皮肤美容服务有何区别？",
            enterpriseAnchor: "甲医院",
            competitorAnchor: "乙医院",
            rationale: "比较服务边界的表达",
          }),
          candidate({
            category: "reputation",
            text: "甲医院医学美容科口碑怎么样？",
            enterpriseAnchor: "甲医院",
            rationale: "检查口碑信息的核验依据",
          }),
          candidate({
            category: "product_scenario",
            text: "甲医院激光祛斑适合哪些情况？",
            enterpriseAnchor: "甲医院",
            offeringAnchor: "激光祛斑",
            rationale: "核对服务适用条件",
          }),
        ],
        basis,
      ),
    ).not.toThrow();
  });
  it("rejects compound prompts, invented competitors and named ranking", () => {
    expect(diagnosticQuestionFormatIssue("口碑如何，安全可靠吗？")).toMatch(
      /单句/,
    );
    expect(diagnosticQuestionFormatIssue("应该推荐哪些机构")).toMatch(
      /中文问号/,
    );
    expect(() =>
      assertDiagnosticQuestionPortfolio(
        [candidate({ text: "甲医院有哪些值得推荐的服务？" })],
        basis,
      ),
    ).toThrow(/不点名/);
    expect(() =>
      assertDiagnosticQuestionPortfolio(
        [
          candidate({
            category: "competitor_comparison",
            text: "甲医院与丙医院相比有哪些区别？",
            enterpriseAnchor: "甲医院",
            competitorAnchor: "丙医院",
          }),
        ],
        basis,
      ),
    ).toThrow(/明确双方/);
  });
  it("rejects repeated reasons and template substitution", () => {
    expect(() =>
      assertDiagnosticQuestionPortfolio(
        [candidate({}), candidate({ text: "东莞哪些机构值得推荐？" })],
        basis,
      ),
    ).toThrow(/理由重复/);
  });
});
