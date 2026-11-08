import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  type WebsiteBuildEvaluationReport,
} from "../../../contracts/website-build-evaluation-run";

const mocks = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock("../website-evaluation-api", () => ({
  liveWebsiteEvaluationApi: { report: mocks.report },
}));

import WebsiteEvaluationReportPage, {
  websiteEvaluationReportUrl,
} from "./WebsiteEvaluationReportPage";

function reportFixture(): WebsiteBuildEvaluationReport {
  const judgments = WEBSITE_BUILD_EVALUATION_CHECKS.map((check, index) => ({
    checkId: check.id,
    anchor: (index === 0 ? 0.5 : 1) as 0 | 0.5 | 1,
    rationale: `${check.label}的服务端判定。`,
    evidenceIds: [`evidence:${check.id}`],
  }));
  return {
    schemaVersion: 1,
    reportId: "report-authority-1",
    runId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    buildId: "33333333-3333-4333-8333-333333333333",
    buildOrdinal: 7,
    stage: "build_readiness",
    evidenceFingerprint: "a".repeat(64),
    reportHash: "b".repeat(64),
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "fixed-website-judge",
      skillHash: "c".repeat(64),
      outputHash: "d".repeat(64),
    },
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: 40,
      criticalRouteIds: ["home", "contact"],
      structuralRouteIds: ["home", "contact", "about"],
      viewports: ["1440x1000", "390x844", "320x720"],
    },
    // This fixture deliberately proves the page renders the authoritative
    // values without invoking a browser scorer.
    score: 0,
    verdict: "not_recommended",
    summary: "服务端已完成六维判定。",
    judgments,
    dimensions: WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension, index) => ({
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      score: index === 0 ? 10 : 0,
      normalizedScore: index === 0 ? 50 : 0,
      judgmentCount: 4,
      evidenceIds: [`dimension:${dimension.id}`],
    })),
    criticalRisks: [{
      id: "risk-core-task",
      kind: "core_task_broken",
      title: "核心任务中断",
      summary: "联系路径没有到达成功条件。",
      checkIds: ["visitor_success_reachable"],
      evidenceIds: ["evidence:visitor_success_reachable"],
    }],
    findings: [{
      id: "finding-contact",
      checkId: "visitor_success_reachable",
      severity: "high",
      title: "补全联系成功反馈",
      summary: "提交后缺少可见的成功状态。",
      impact: "访客无法确认任务是否完成。",
      suggestedAction: "在联系页表单后增加成功确认。",
      evidenceIds: ["evidence:visitor_success_reachable"],
      target: { kind: "route", routeId: "contact", sectionId: "form", anchor: "submit" },
    }],
    relatedRagReportIds: ["rag-report-reference"],
    comparablePreviousReportId: null,
    createdAt: "2026-11-08T01:00:00.000Z",
    completedAt: "2026-11-08T01:01:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("WebsiteEvaluationReportPage", () => {
  it("renders a matching local fixture without requesting the live report API", async () => {
    const fixture = reportFixture();

    render(
      <WebsiteEvaluationReportPage
        reportId={fixture.reportId}
        returnUrl="/?view=website&step=evaluation"
        initialReport={fixture}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect((await screen.findByTestId("website-report-score")).textContent).toBe("0");
    expect(screen.getByRole("heading", { name: "暂缓发布" })).toBeTruthy();
    expect(screen.getAllByTestId("website-report-anchor")).toHaveLength(24);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("fails closed when the injected local fixture does not match the URL", async () => {
    const fixture = reportFixture();

    render(
      <WebsiteEvaluationReportPage
        reportId="report-other"
        returnUrl="/?view=website&step=evaluation"
        initialReport={fixture}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("不匹配");
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("loads one immutable report and renders its true zero, normalized dimensions and 24 evidence anchors", async () => {
    const fixture = reportFixture();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mocks.report.mockResolvedValue(fixture);

    render(<WebsiteEvaluationReportPage reportId={fixture.reportId} returnUrl="/?view=website&step=evaluation" />);

    expect(screen.getByRole("status").textContent).toContain("正在读取权威报告");
    expect((await screen.findByTestId("website-report-score")).textContent).toBe("0");
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith(fixture.reportId);
    expect(screen.getByTestId("website-report-dimension-visitor_task").textContent).toBe("50");
    expect(screen.getAllByTestId("website-report-anchor")).toHaveLength(24);
    expect(screen.getByText("0.5 · 部分达标")).toBeTruthy();
    expect(screen.getByText("evidence:visitor_entry_clear")).toBeTruthy();
    expect(screen.getByText("核心任务中断")).toBeTruthy();
    expect(screen.getByText("补全联系成功反馈")).toBeTruthy();
    expect(screen.getAllByText("100%", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText(fixture.reportHash)).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("shows the server error and retries the same read without starting an evaluation", async () => {
    const fixture = reportFixture();
    mocks.report
      .mockRejectedValueOnce(new Error("报告不存在或无权访问。"))
      .mockResolvedValueOnce(fixture);

    render(<WebsiteEvaluationReportPage reportId={fixture.reportId} returnUrl="/?view=website" />);

    expect((await screen.findByRole("alert")).textContent).toContain("无权访问");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect((await screen.findByTestId("website-report-score")).textContent).toBe("0");
    expect(mocks.report).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenNthCalledWith(1, fixture.reportId);
    expect(mocks.report).toHaveBeenNthCalledWith(2, fixture.reportId);
  });

  it("builds an encoded standalone report URL", () => {
    expect(websiteEvaluationReportUrl("report / 一"))
      .toBe("/?view=website&websiteReport=report+%2F+%E4%B8%80");
  });
});
