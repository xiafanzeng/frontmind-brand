import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderToString } from "katex";
import { createRagChecklist, scoreRagChecklist, type RagCheckJudgment } from "../../../contracts/enterprise-rag-checklist";
import { RAG_DIMENSIONS, RAG_GATES, scoreEvaluation, type DimensionJudgment } from "./rag-evaluation";
import { RagEvaluationReportRules, RAG_REPORT_FORMULAS, RAG_REPORT_SYMBOLS } from "./RagEvaluationReportRules";

describe("report scoring rules", () => {
  it("renders every authored formula as accessible mathematical notation", () => {
    for (const formula of Object.values({ ...RAG_REPORT_FORMULAS, ...RAG_REPORT_SYMBOLS })) {
      const markup = renderToString(formula, { displayMode: true, output: "htmlAndMathml", trust: false, throwOnError: true });
      expect(markup).toContain("katex-mathml");
      expect(markup).toContain("<math");
      expect(markup).not.toContain("katex-error");
    }
  });

  it("distinguishes scoring methods without showing version identifiers", () => {
    const { container } = render(<div className="rag-report"><RagEvaluationReportRules /></div>);
    expect(screen.getByRole("heading", { name: /01 评分规则/ })).toBeTruthy();
    for (const method of ["自动评估", "人工评审", "历史规则"]) expect(screen.getByRole("heading", { name: method })).toBeTruthy();
    expect(container.textContent).not.toContain("合成示例");
    expect(container.textContent).not.toMatch(/rag-eval|1\.[234]/u);
    expect(container.textContent).not.toMatch(/需求说明第十三章|服务端|接口|技术设计/u);
    expect(screen.getByText(/按检查项计分的自动报告只展示已有分数与覆盖率，不推算额外区间/)).toBeTruthy();
    for (const symbol of container.querySelectorAll(".rag-report-symbols dt")) expect(symbol.querySelector("math")).toBeTruthy();
    for (const explanation of container.querySelectorAll(".rag-report-formula-note")) {
      expect(explanation.querySelector("math")).toBeTruthy();
      expect([...explanation.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("")).not.toMatch(/[A-Zwℓᵢⱼ]/u);
    }
    const authored = new Set(Object.values({ ...RAG_REPORT_FORMULAS, ...RAG_REPORT_SYMBOLS }));
    const rendered = new Set([...container.querySelectorAll('annotation[encoding="application/x-tex"]')].map(node => node.textContent));
    expect(rendered).toEqual(authored);
    for (const dimension of RAG_DIMENSIONS) expect(screen.getByRole("rowheader", { name: dimension.label })).toBeTruthy();
    for (const gate of RAG_GATES) expect(screen.getByRole("rowheader", { name: gate.label })).toBeTruthy();
  });

  it("keeps the report methodology neutral in local preview", () => {
    const { container } = render(<div className="rag-report"><RagEvaluationReportRules preview /></div>);
    expect(within(container).getByRole("heading", { name: "人工评审" })).toBeTruthy();
    expect(container.textContent).not.toContain("合成示例");
  });

  it("matches the documented dimension normalization and weighted coverage for checklist exclusions", () => {
    const checklist = createRagChecklist("如何找到官网？");
    checklist.checks[0].applicable = false;
    checklist.checks[0].exclusionReason = "测试计划预先排除";
    const judgments: RagCheckJudgment[] = checklist.checks.map(check => ({ id: check.id, status: check.applicable ? "met" : "not_applicable", rationale: "已核对", evidenceIds: check.applicable ? ["source-1"] : [] }));
    judgments[1].status = "partial";
    const complete = scoreRagChecklist(checklist, judgments);
    // Intent retains its 20-point dimension weight: 20 × (8 × ½) / 8 = 10.
    expect(complete.dimensions[0].score).toBe(10);
    expect(complete.score).toBe(90);
    judgments.find(item => item.id === "facts_supporting")!.status = "undetermined";
    const pending = scoreRagChecklist(checklist, judgments);
    expect(pending.score).toBeNull();
    expect(pending.coverage).toBe(92);
  });

  it("matches the documented manual bounds when a weighted dimension lacks evidence", () => {
    const dimensions: DimensionJudgment[] = RAG_DIMENSIONS.map(item => ({ id: item.id, level: 4, rationale: "已核对", evidenceIds: ["source-1"], applicable: true }));
    dimensions.find(item => item.id === "boundaries")!.applicable = false;
    dimensions.find(item => item.id === "intent")!.level = 3;
    const gates = RAG_GATES.map(item => ({ id: item.id, status: "passed" as const, reason: "已核对" }));
    const complete = scoreEvaluation({ dimensions, gates });
    expect(complete.rawScore).toBeCloseTo(100 * 85 / 90);
    expect(complete.score).toBe(94);
    dimensions.find(item => item.id === "correctness")!.evidenceIds = [];
    const pending = scoreEvaluation({ dimensions, gates });
    expect(pending.score).toBeNull();
    expect(pending.lower).toBeCloseTo(100 * 60 / 90);
    expect(pending.upper).toBeCloseTo(100 * 85 / 90);
    expect(pending.coverage).toBeCloseTo(100 * 65 / 90);
  });
});
