import { describe, expect, it } from "vitest";
import type { EnterpriseRagEvaluationReport } from "../../../contracts/enterprise-rag-evaluation-run";
import {
  enterpriseRagQualityVerdictLabels,
  legacyRagVerdictLabels,
  ragVerdictLabels,
  presentRagSummary,
  presentEvaluationScore,
  reportVerdict,
} from "./rag-report-presentation";

describe("enterprise RAG report presentation", () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("shows an absent or invalid score %s as N/A without a denominator", score => {
    expect(presentEvaluationScore(score, false)).toEqual({ value: "N/A", text: "N/A", showScale: false, ariaLabel: "六维诊断评分待核验" });
  });

  it("retains a genuine zero and keeps unusable numeric scores inapplicable", () => {
    expect(presentEvaluationScore(0, false)).toEqual({ value: 0, text: "0/100", showScale: true, ariaLabel: "六维诊断评分 0，满分 100" });
    expect(presentEvaluationScore(100, true)).toEqual({ value: "N/A", text: "N/A", showScale: false, ariaLabel: "重大问题，数值分不适用" });
  });
  it("removes only generated trailing rule annotations and retains explanatory text", () => {
    expect(presentRagSummary("回答可用。（规则 rag-eval-1.2）")).toBe("回答可用。");
    expect(presentRagSummary("回答可用。(规则 rag-eval-1.3; 六维分数仅作诊断) ")).toBe("回答可用。（六维分数仅作诊断）");
    expect(presentRagSummary("回答（需要确认）。（规则 rag-eval-1.4；六维分数仅作诊断）")).toBe("回答（需要确认）。（六维分数仅作诊断）");
    for (const text of ["请核对规则 rag-eval-1.2 的原文。", "回答（规则需要确认）", "（规则 rag-eval-1.2）是原始引用。", "回答（需人工核验）"]) expect(presentRagSummary(text)).toBe(text);
  });
  it("uses quality-only labels without changing shared or historical copy", () => {
    expect(enterpriseRagQualityVerdictLabels).toEqual({
      excellent: "优秀",
      usable: "良好",
      improve: "待改进",
      unusable: "需修复",
      pending: "待核验",
    });
    expect(ragVerdictLabels.improve).toBe("可用·待改进");
    expect(legacyRagVerdictLabels.unusable).toBe("不可用，优先修复");
  });

  it("preserves the persisted server conclusion mapping", () => {
    const report = {
      result: {
        answerVerdict: "usable_with_improvements",
        status: "completed",
        recommendation: "publish_with_risk",
        score: 83,
      },
    } as EnterpriseRagEvaluationReport;
    expect(reportVerdict(report)).toBe("improve");
  });
});
