import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  type WebsiteBuildEvaluationReport,
  type WebsiteBuildEvaluationRunDto,
} from "../../../contracts/website-build-evaluation-run";

const mocks = vi.hoisted(() => ({
  liveSiteOps: {
    observation: {
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        revision: 7,
      },
      builds: [],
    },
  },
  received: null as null | Record<string, unknown>,
}));

vi.mock("../siteops/ConnectedSiteOpsConversationPanel", () => ({
  default: ({
    render: renderView,
  }: {
    render?: (props: unknown) => ReactNode;
  }) => (
    <>
      {renderView
        ? renderView(mocks.liveSiteOps)
        : <div data-testid="established-siteops-panel">域名与发布设置</div>}
    </>
  ),
}));

vi.mock("../../host", () => ({
  useRuntimeContext: () => ({
    workspaceId: "workspace-1",
    accountId: 42,
    enabled: true,
  }),
}));

vi.mock("./SimplifiedWebsiteBuilderPreview", () => ({
  SimplifiedWebsiteBuilderPreview: (props: Record<string, unknown>) => {
    mocks.received = props;
    return (
      <button
        type="button"
        data-testid="designed-website-builder"
        onClick={() => (props.onStepChange as ((step: string) => void) | undefined)?.("design")}
      >
        三步建站
      </button>
    );
  },
}));

import ConnectedSimplifiedWebsiteBuilderPreview, {
  projectWebsiteEvaluationAuthority,
} from "./ConnectedSimplifiedWebsiteBuilderPreview";

function authorityReport(reportId = "report-current"): WebsiteBuildEvaluationReport {
  return {
    schemaVersion: 1,
    reportId,
    runId: "33333333-3333-4333-8333-333333333333",
    projectId: "11111111-1111-4111-8111-111111111111",
    buildId: "22222222-2222-4222-8222-222222222222",
    buildOrdinal: 3,
    stage: "build_readiness",
    evidenceFingerprint: "a".repeat(64),
    reportHash: "b".repeat(64),
    evaluator: {
      skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
      ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
      judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
      evidenceVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
      provider: "openai_agents",
      model: "fixed-judge",
      skillHash: "c".repeat(64),
      outputHash: "d".repeat(64),
    },
    coverage: {
      requiredEvidencePercent: 100,
      routeViewportPercent: 100,
      brandReferencePercent: 40,
      criticalRouteIds: ["home"],
      structuralRouteIds: ["home"],
      viewports: ["1440x1000", "390x844", "320x720"],
    },
    score: 0,
    verdict: "not_recommended",
    summary: "服务端权威零分报告。",
    judgments: WEBSITE_BUILD_EVALUATION_CHECKS.map((check) => ({
      checkId: check.id,
      anchor: 0 as const,
      rationale: `${check.label}未达标。`,
      evidenceIds: [`evidence:${check.id}`],
    })),
    dimensions: WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      score: 0,
      normalizedScore: dimension.id === "brand_consistency" ? 50 : 0,
      judgmentCount: 4 as const,
      evidenceIds: [`dimension:${dimension.id}`],
    })),
    criticalRisks: [{
      id: "risk-core-task",
      kind: "core_task_broken",
      title: "核心任务中断",
      summary: "首页入口不可用。",
      checkIds: ["visitor_entry_clear"],
      evidenceIds: ["evidence:visitor_entry_clear"],
    }],
    findings: [{
      id: "finding-home",
      checkId: "visitor_entry_clear",
      severity: "critical",
      title: "修复首页入口",
      summary: "入口不可见。",
      impact: "访客无法开始任务。",
      suggestedAction: "在首页增加任务入口。",
      evidenceIds: ["evidence:visitor_entry_clear"],
      target: { kind: "route", routeId: "home" },
    }, {
      id: "finding-brand",
      checkId: "brand_visual_tokens",
      severity: "medium",
      title: "补齐字体配置",
      summary: "长内容页仍使用默认字体。",
      impact: "品牌视觉不一致。",
      suggestedAction: "返回 Brand Kit 补齐字体偏好。",
      evidenceIds: ["evidence:brand_visual_tokens"],
      target: { kind: "brand_kit", sectionId: "evaluation-inputs" },
    }],
    relatedRagReportIds: [],
    comparablePreviousReportId: "report-prior",
    createdAt: "2026-11-08T01:00:00.000Z",
    completedAt: "2026-11-08T01:01:00.000Z",
  };
}

function authorityRun(report: WebsiteBuildEvaluationReport): WebsiteBuildEvaluationRunDto {
  return {
    runId: report.runId,
    projectId: report.projectId,
    buildId: report.buildId,
    stage: "build_readiness",
    status: "completed",
    attemptCount: 1,
    automatic: true,
    evidenceFingerprint: report.evidenceFingerprint,
    createdAt: report.createdAt,
    updatedAt: report.completedAt,
    report,
    error: null,
  };
}

describe("connected redesigned website builder", () => {
  it("renders the later product design with the real SiteOps adapter", () => {
    const onOpenRag = vi.fn();
    const onStepChange = vi.fn();

    render(
      <ConnectedSimplifiedWebsiteBuilderPreview
        initialStep="design"
        onOpenRag={onOpenRag}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByTestId("designed-website-builder")).toBeTruthy();
    expect(mocks.received).toMatchObject({
      initialStep: "design",
      onOpenRag,
      onStepChange,
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:workspace-1",
    });
  });

  it("keeps the three-step builder mounted and removes the legacy management-page switch", () => {
    const onStepChange = vi.fn();
    const view = render(<ConnectedSimplifiedWebsiteBuilderPreview onStepChange={onStepChange} />);
    const page = within(view.container);

    fireEvent.click(page.getByTestId("designed-website-builder"));

    expect(onStepChange).toHaveBeenCalledWith("design");
    expect(page.queryByTestId("established-siteops-panel")).toBeNull();
    expect(page.getByTestId("designed-website-builder")).toBeTruthy();
    expect(page.queryByRole("button", { name: "返回三步建站" })).toBeNull();
    expect(mocks.received).not.toHaveProperty("onOpenSiteOpsRelease");
  });

  it("honors the host workspace scope instead of sharing drafts across projects", () => {
    render(
      <ConnectedSimplifiedWebsiteBuilderPreview storageScope="live:42:project-9" />,
    );

    expect(mocks.received).toMatchObject({
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:project-9",
    });
  });

  it("projects normalized authority scores, frozen build inputs and scoped report history without listing the current report twice", () => {
    const report = authorityReport();
    const prior = {
      ...authorityReport("report-prior"),
      runId: "44444444-4444-4444-8444-444444444444",
      reportHash: "e".repeat(64),
      completedAt: "2026-11-07T01:01:00.000Z",
    } satisfies WebsiteBuildEvaluationReport;
    const projected = projectWebsiteEvaluationAuthority({
      run: authorityRun(report),
      history: [authorityRun(report), authorityRun(prior)],
      location: "/workspace/brand?view=website&projectId=project-scope",
      buildBrief: {
        companyName: "测试企业",
        primaryLanguage: "zh-CN",
        contacts: [],
        offerings: ["企业服务"],
        audience: ["客户"],
        conversionGoal: "完成联系",
        contentInventory: {
          schemaVersion: 1,
          source: "frozen_knowledge_snapshot",
          entries: [],
        },
        routes: [{
          id: "home",
          slug: "/",
          title: "首页",
          sourceDocumentIds: ["document-1"],
        }],
        verifiedFacts: [],
        publicAssetIds: [],
        unknowns: [],
        brandKitV1: {
          schemaVersion: 1,
          primaryColor: "#315b8a",
          secondaryColors: [],
          fontPreferences: ["Inter"],
          toneKeywords: ["专业"],
          forbiddenPhrases: [],
        },
        visitorTaskV1: {
          schemaVersion: 1,
          goal: "从首页完成联系",
          entryRouteId: "home",
          successCriteria: ["显示成功确认"],
          requiredRouteIds: ["home"],
          assistantRequired: false,
          generatedFromBriefHash: "f".repeat(64),
          confirmedAt: "2026-11-08T00:00:00.000Z",
          confirmedByUserId: 7,
        },
      },
    });

    expect(projected.score).toBe(0);
    expect(projected.verdict).toBe("暂缓发布");
    expect(projected.reportHash).toBe("b".repeat(64));
    expect(projected.dimensions.find((item) => item.id === "brand_consistency")?.score).toBe(50);
    expect(projected.dimensions.flatMap((item) => item.anchors ?? [])).toHaveLength(24);
    expect(projected.criticalRiskIds).toEqual(["risk-core-task"]);
    expect(projected.risks).toHaveLength(2);
    expect(projected.risks[0]?.id).toBe("risk-core-task");
    expect(projected.risks[0]?.target).toEqual({ kind: "route", routeId: "home" });
    expect(projected.risks[0]?.repairItem).toEqual({
      kind: "critical_risk",
      id: "risk-core-task",
    });
    expect(projected.risks[1]?.repairItem).toEqual({
      kind: "finding",
      id: "finding-brand",
    });
    expect(projected.frozenBrandKitLabel).toContain("主色 #315b8a");
    expect(projected.frozenVisitorTaskLabel).toContain("从首页完成联系");
    expect(projected.reportUrl).toBe(
      "/workspace/brand?view=website&projectId=project-scope&websiteReport=report-current",
    );
    expect(projected.history).toEqual([
      expect.objectContaining({
        reportId: "report-prior",
        comparisonEligible: true,
        scoreDelta: 0,
        reportUrl: "/workspace/brand?view=website&projectId=project-scope&websiteReport=report-prior",
      }),
    ]);
  });
});
