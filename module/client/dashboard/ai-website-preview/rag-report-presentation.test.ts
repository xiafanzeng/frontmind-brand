import { describe, expect, it } from "vitest";
import type { EnterpriseRagEvaluationReport } from "../../../contracts/enterprise-rag-evaluation-run";
import {
  enterpriseRagQualityVerdictLabels,
  legacyRagVerdictLabels,
  ragVerdictLabels,
  reportVerdict,
} from "./rag-report-presentation";

describe("enterprise RAG report presentation", () => {
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
