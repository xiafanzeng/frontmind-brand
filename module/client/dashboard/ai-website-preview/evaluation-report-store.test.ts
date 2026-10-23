import { beforeEach, describe, expect, it } from "vitest";
import {
  parseEvaluationResult,
  runEvaluationSkill,
  type EvaluationResult,
  type EvaluationSkill,
} from "./evaluation-skill-contract";
import {
  EVALUATION_REPORT_STORAGE_KEY,
  MAX_STORED_EVALUATION_REPORTS,
  MAX_STORED_PUBLISH_DECISIONS,
  PUBLISH_DECISION_STORAGE_KEY,
  findLatestEvaluationReport,
  findLatestPublishDecision,
  getEvaluationReportById,
  getPublishDecisionById,
  getRelatedEvaluationReports,
  listEvaluationReports,
  listPublishDecisions,
  parsePublishDecision,
  saveEvaluationReport,
  savePublishDecision,
  savePublishDecisionWithReports,
  type EvaluationReportSnapshot,
  type PublishDecision,
} from "./evaluation-report-store";

const result = (
  overrides: Partial<EvaluationResult> = {},
): EvaluationResult => ({
  skillId: "enterprise-rag-evaluation",
  version: "1.0.0",
  status: "completed",
  score: 84,
  coverage: 100,
  recommendation: "publish_with_risk",
  summary: "回答基本可用，但仍有需确认的风险。",
  dimensions: [
    {
      id: "correctness",
      label: "正确性",
      status: "partial",
      score: 20,
      maxScore: 25,
      summary: "核心事实有依据。",
      evidenceIds: ["evidence-1"],
    },
  ],
  risks: [
    {
      id: "risk-source-age",
      severity: "medium",
      title: "来源时效待核验",
      summary: "发布前建议确认来源日期。",
      evidenceIds: ["evidence-1"],
    },
  ],
  relatedReportIds: [],
  ...overrides,
});

const report = (
  reportId: string,
  createdAt: string,
  overrides: Partial<EvaluationReportSnapshot> = {},
): EvaluationReportSnapshot => ({
  reportId,
  createdAt,
  subject: { kind: "rag-answer", id: "answer-1", version: "draft-1" },
  result: result(),
  ...overrides,
});

const decision = (
  decisionId: string,
  createdAt: string,
  overrides: Partial<PublishDecision> = {},
): PublishDecision => ({
  decisionId,
  createdAt,
  subject: { kind: "website-build", id: "site-1", version: "draft-1" },
  action: "publish",
  mode: "accepted_risk",
  evaluationReportIds: ["report-rag-1", "report-site-1"],
  acknowledgedRiskIds: ["risk-source-age"],
  riskAcknowledged: true,
  note: "先发布内部试用版本。",
  ...overrides,
});

function seedDecisionReports() {
  expect(saveEvaluationReport(report("report-rag-1", "2026-10-23T03:00:00.000Z"))).toBe(true);
  expect(saveEvaluationReport(report("report-site-1", "2026-10-23T04:00:00.000Z", {
    subject: { kind: "website-build", id: "site-1", version: "draft-1" },
    result: result({ skillId: "website-build-evaluation", relatedReportIds: ["report-rag-1"] }),
  }))).toBe(true);
}

beforeEach(() => window.localStorage.clear());

describe("evaluation skill contract", () => {
  it("executes a callable Skill and validates its declared identity", async () => {
    const skill: EvaluationSkill<{ score: number }> = {
      skillId: "enterprise-rag-evaluation",
      version: "1.0.0",
      evaluate: ({ score }) => result({ score }),
    };

    await expect(runEvaluationSkill(skill, { score: 91 })).resolves.toMatchObject({
      skillId: skill.skillId,
      version: skill.version,
      score: 91,
    });
    await expect(
      runEvaluationSkill(
        { ...skill, evaluate: () => result({ version: "2.0.0" }) },
        { score: 91 },
      ),
    ).rejects.toThrow(/identity/iu);
  });

  it("rejects forbidden publication authority fields and malformed scores", () => {
    expect(parseEvaluationResult({ ...result(), canPublish: false })).toBeNull();
    expect(parseEvaluationResult({ ...result(), canConfirm: false })).toBeNull();
    expect(parseEvaluationResult({ ...result(), publishAllowed: false })).toBeNull();
    expect(parseEvaluationResult({ ...result(), blockingRelease: true })).toBeNull();
    expect(parseEvaluationResult({ ...result(), coverage: 101 })).toBeNull();
    expect(parseEvaluationResult({ ...result(), score: Number.NaN })).toBeNull();
    expect(parseEvaluationResult({ ...result(), status: "not_run", score: 100 })).toBeNull();
    expect(parseEvaluationResult({ ...result(), status: "failed", score: 0 })).toBeNull();
    expect(parseEvaluationResult({ ...result(), status: "completed", coverage: 80 })).toBeNull();
    expect(parseEvaluationResult({ ...result(), status: "pending", recommendation: "recommended" })).toBeNull();
    expect(parseEvaluationResult({
      ...result(),
      dimensions: [{ ...result().dimensions[0], status: "pending" }],
    })).toBeNull();
    expect(parseEvaluationResult({
      ...result(),
      dimensions: [{ ...result().dimensions[0], status: "not_applicable", score: 20 }],
    })).toBeNull();
    expect(parseEvaluationResult({
      ...result(),
      recommendation: "recommended",
      risks: [{ ...result().risks[0], severity: "critical" }],
    })).toBeNull();
  });

  it("accepts human-readable Unicode evidence references without relaxing report IDs", () => {
    const withChineseEvidence = result({
      dimensions: [{
        ...result().dimensions[0],
        evidenceIds: ["产品手册 第 3 段", "回答原句：支持中文定位"],
      }],
    });
    expect(parseEvaluationResult(withChineseEvidence)?.dimensions[0].evidenceIds).toEqual([
      "产品手册 第 3 段",
      "回答原句：支持中文定位",
    ]);
    expect(parseEvaluationResult({ ...withChineseEvidence, relatedReportIds: ["包含 空格"] })).toBeNull();
  });
});

describe("evaluation report snapshots", () => {
  it("falls back safely for corrupted storage and ignores invalid entries", () => {
    window.localStorage.setItem(EVALUATION_REPORT_STORAGE_KEY, "{broken-json");
    expect(listEvaluationReports()).toEqual([]);

    window.localStorage.setItem(
      EVALUATION_REPORT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        reports: [
          report("valid-report", "2026-10-23T02:00:00.000Z"),
          { reportId: "invalid-report" },
        ],
        decisions: [],
      }),
    );
    expect(listEvaluationReports().map((item) => item.reportId)).toEqual([
      "valid-report",
    ]);
  });

  it("stores at most 30 newest immutable reports", () => {
    for (let index = 0; index < 35; index += 1) {
      expect(
        saveEvaluationReport(
          report(
            `report-${index}`,
            new Date(Date.UTC(2026, 9, 23, 0, index)).toISOString(),
          ),
        ),
      ).toBe(true);
    }
    const reports = listEvaluationReports();
    expect(reports).toHaveLength(MAX_STORED_EVALUATION_REPORTS);
    expect(reports[0].reportId).toBe("report-34");
    expect(reports.at(-1)?.reportId).toBe("report-5");

    const original = reports[0];
    expect(saveEvaluationReport(original)).toBe(true);
    expect(
      saveEvaluationReport({
        ...original,
        result: result({ score: 1 }),
      }),
    ).toBe(false);
    expect(getEvaluationReportById(original.reportId)?.result.score).toBe(84);
  });

  it("gets by ID, finds the latest exact match, and resolves explicit links only", () => {
    const rag = report("rag-report", "2026-10-23T01:00:00.000Z");
    const unrelated = report("unrelated-rag", "2026-10-23T04:00:00.000Z", {
      subject: { kind: "rag-answer", id: "answer-2", version: "draft-1" },
    });
    const website = report("website-report", "2026-10-23T03:00:00.000Z", {
      subject: { kind: "website-build", id: "site-1", version: "draft-3" },
      result: result({
        skillId: "website-build-evaluation",
        version: "1.0.0",
        relatedReportIds: [rag.reportId],
      }),
    });
    [rag, unrelated, website].forEach((item) =>
      expect(saveEvaluationReport(item)).toBe(true),
    );

    expect(getEvaluationReportById("rag-report")).toEqual(rag);
    expect(
      findLatestEvaluationReport({
        skillId: "enterprise-rag-evaluation",
        subjectId: "answer-1",
        subjectVersion: "draft-1",
      })?.reportId,
    ).toBe("rag-report");
    expect(
      findLatestEvaluationReport({ relatedReportId: "rag-report" })?.reportId,
    ).toBe("website-report");
    expect(getRelatedEvaluationReports(website).map((item) => item.reportId)).toEqual([
      "rag-report",
    ]);
    expect(getRelatedEvaluationReports(website)).not.toContainEqual(unrelated);
  });

  it("rejects a report whose explicit related report does not exist", () => {
    const dangling = report("website-dangling", "2026-10-23T03:00:00.000Z", {
      subject: { kind: "website-build", id: "site-1", version: "draft-3" },
      result: result({
        skillId: "website-build-evaluation",
        relatedReportIds: ["missing-rag-report"],
      }),
    });

    expect(saveEvaluationReport(dangling)).toBe(false);
    expect(listEvaluationReports()).toEqual([]);
  });

  it("filters dangling report chains and decisions from corrupted stored data", () => {
    const valid = report("valid-report", "2026-10-23T01:00:00.000Z");
    const dangling = report("dangling-report", "2026-10-23T02:00:00.000Z", {
      result: result({ relatedReportIds: ["missing-report"] }),
    });
    const cascading = report("cascading-report", "2026-10-23T03:00:00.000Z", {
      result: result({ relatedReportIds: [dangling.reportId] }),
    });
    window.localStorage.setItem(EVALUATION_REPORT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      reports: [valid, dangling, cascading],
      decisions: [decision("corrupted-decision", "2026-10-23T04:00:00.000Z", {
        evaluationReportIds: [valid.reportId],
      })],
    }));

    expect(listEvaluationReports().map((item) => item.reportId)).toEqual([valid.reportId]);
    expect(listPublishDecisions()).toEqual([]);
  });
});

describe("publish decisions", () => {
  it("records an explicit risk acknowledgement separately from reports", () => {
    seedDecisionReports();
    const selected = decision("decision-1", "2026-10-23T05:00:00.000Z");
    expect(savePublishDecision(selected)).toBe(true);

    expect(getPublishDecisionById("decision-1")).toEqual(selected);
    expect(
      findLatestPublishDecision({
        subjectId: "site-1",
        evaluationReportId: "report-rag-1",
      }),
    ).toEqual(selected);
    expect(window.localStorage.getItem(EVALUATION_REPORT_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PUBLISH_DECISION_STORAGE_KEY)).not.toBeNull();
  });

  it("validates acknowledgement semantics and retains at most 30 decisions", () => {
    seedDecisionReports();
    expect(
      parsePublishDecision(
        decision("bad-normal", "2026-10-23T00:00:00.000Z", {
          mode: "follow_recommendation",
          riskAcknowledged: true,
        }),
      ),
    ).toBeNull();
    expect(
      parsePublishDecision(
        decision("bad-risk", "2026-10-23T00:00:00.000Z", {
          mode: "accepted_risk",
          riskAcknowledged: false,
        }),
      ),
    ).toBeNull();

    for (let index = 0; index < 35; index += 1) {
      expect(
        savePublishDecision(
          decision(
            `decision-${index}`,
            new Date(Date.UTC(2026, 9, 23, 1, index)).toISOString(),
          ),
        ),
      ).toBe(true);
    }
    const decisions = listPublishDecisions();
    expect(decisions).toHaveLength(MAX_STORED_PUBLISH_DECISIONS);
    expect(decisions[0].decisionId).toBe("decision-34");
    expect(decisions.at(-1)?.decisionId).toBe("decision-5");
  });

  it("never evicts reports that retained decisions or report links still reference", () => {
    seedDecisionReports();
    expect(savePublishDecision(decision("decision-pinned", "2026-10-23T05:00:00.000Z"))).toBe(true);

    for (let index = 0; index < 35; index += 1) {
      expect(saveEvaluationReport(report(
        `unrelated-${index}`,
        new Date(Date.UTC(2026, 9, 24, 0, index)).toISOString(),
        { subject: { kind: "rag-answer", id: `answer-${index}`, version: "draft-1" } },
      ))).toBe(true);
    }

    expect(listEvaluationReports()).toHaveLength(MAX_STORED_EVALUATION_REPORTS + 2);
    expect(getEvaluationReportById("report-rag-1")).not.toBeNull();
    expect(getEvaluationReportById("report-site-1")).not.toBeNull();
    expect(getRelatedEvaluationReports("report-site-1").map((item) => item.reportId)).toEqual(["report-rag-1"]);
  });

  it("rejects a publish decision that would point at missing reports", () => {
    expect(savePublishDecision(decision("dangling-decision", "2026-10-23T05:00:00.000Z"))).toBe(false);
  });

  it("atomically stores the 31st decision and removes only the evicted decision's orphaned report", () => {
    const rag = report("shared-rag-report", "2026-10-23T00:00:00.000Z");
    expect(saveEvaluationReport(rag)).toBe(true);

    for (let index = 0; index <= MAX_STORED_PUBLISH_DECISIONS; index += 1) {
      const version = `draft-${index}`;
      const website = report(
        `website-report-${index}`,
        new Date(Date.UTC(2026, 9, 23, 1, index)).toISOString(),
        {
          subject: { kind: "website-build", id: "site-1", version },
          result: result({
            skillId: "website-build-evaluation",
            relatedReportIds: [rag.reportId],
          }),
        },
      );
      const publish = decision(
        `publish-decision-${index}`,
        new Date(Date.UTC(2026, 9, 23, 2, index)).toISOString(),
        {
          subject: website.subject,
          evaluationReportIds: [website.reportId, rag.reportId],
        },
      );

      expect(savePublishDecisionWithReports({
        reports: [website],
        decision: publish,
      })).toBe(true);
    }

    const decisions = listPublishDecisions();
    expect(decisions).toHaveLength(MAX_STORED_PUBLISH_DECISIONS);
    expect(getPublishDecisionById("publish-decision-0")).toBeNull();
    expect(getPublishDecisionById(`publish-decision-${MAX_STORED_PUBLISH_DECISIONS}`)).not.toBeNull();
    expect(getEvaluationReportById("website-report-0")).toBeNull();
    expect(getEvaluationReportById(`website-report-${MAX_STORED_PUBLISH_DECISIONS}`)).not.toBeNull();
    expect(getEvaluationReportById(rag.reportId)).not.toBeNull();
    decisions.forEach((item) => {
      item.evaluationReportIds.forEach((reportId) => {
        expect(getEvaluationReportById(reportId)).not.toBeNull();
      });
    });
  });

  it("leaves no report or decision half-written when the atomic storage write fails", () => {
    let serialized: string | null = null;
    let failWrites = false;
    const storage = {
      getItem: () => serialized,
      setItem: (_key: string, value: string) => {
        if (failWrites) throw new Error("quota exceeded");
        serialized = value;
      },
    };
    const rag = report("atomic-rag", "2026-10-23T01:00:00.000Z");
    expect(saveEvaluationReport(rag, storage)).toBe(true);
    const before = serialized;
    const website = report("atomic-website", "2026-10-23T02:00:00.000Z", {
      subject: { kind: "website-build", id: "site-atomic", version: "draft-atomic" },
      result: result({
        skillId: "website-build-evaluation",
        relatedReportIds: [rag.reportId],
      }),
    });
    const publish = decision("atomic-decision", "2026-10-23T03:00:00.000Z", {
      subject: website.subject,
      evaluationReportIds: [website.reportId, rag.reportId],
    });

    failWrites = true;
    expect(savePublishDecisionWithReports({ reports: [website], decision: publish }, storage)).toBe(false);
    expect(serialized).toBe(before);
    expect(getEvaluationReportById(website.reportId, storage)).toBeNull();
    expect(getPublishDecisionById(publish.decisionId, storage)).toBeNull();
  });
});
