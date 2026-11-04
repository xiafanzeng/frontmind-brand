import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiagnosticKnowledgeComparison,
  DiagnosticOverview,
  DiagnosticSemanticAudit,
} from "./BrandDiagnosticResults";
import {
  SEMANTIC_AUDIT_DIMENSIONS,
  SEMANTIC_AUDIT_METRICS,
  SEMANTIC_AUDIT_VERSION,
  type SemanticAuditResult,
} from "../contracts/semantic-audit";
import type { DiagnosticRunView } from "../contracts/diagnostics";

const audit: SemanticAuditResult = {
  category: "reputation",
  schemaVersion: 1,
  scoringVersion: SEMANTIC_AUDIT_VERSION,
  skillVersion: "v1",
  inputHash: "input",
  generatedAt: "2026-11-01T12:00:00Z",
  model: "gpt-6.1-sol",
  fallback: false,
  samples: 15,
  plannedSamples: 15,
  metrics: SEMANTIC_AUDIT_METRICS.map((metric) => ({
    ...metric,
    value: metric.dimension === "authority" ? null : 0,
    score: metric.dimension === "authority" ? null : 0,
    method: metric.id === "sample_coverage" ? "calculated" : "model",
    status: metric.dimension === "authority" ? "insufficient" : "scored",
    explanation: "基于本题回答与冻结知识进行判断。",
    satisfied: "",
    limitations:
      metric.dimension === "authority"
        ? "来源正文缺失，不能用零分代替。"
        : "相关表达未达到知识基准。",
    knowledgeRefs: [{ docPath: "scope.md", excerpt: "科室负责相关服务" }],
    answerRefs: [{ sampleId: "answer-a", excerpt: "用于判读的回答短摘录" }],
  })),
  dimensions: SEMANTIC_AUDIT_DIMENSIONS.map((dimension) => ({
    ...dimension,
    score: dimension.id === "authority" ? null : 0,
    status: dimension.id === "authority" ? "insufficient" : "scored",
    assessed: dimension.id === "authority" ? 0 : 2,
    total: dimension.id === "authority" ? 3 : 2,
    finding:
      dimension.id === "authority"
        ? "来源材料不足，保留核验边界。"
        : "本题相关表达尚未充分进入回答。",
  })),
};
const run = {
  subject: "测试医院（医学美容科）",
  basis: { version: 2 },
  completedSamples: 15,
  expectedSamples: 60,
  phase: "partial",
  platforms: ["doubao", "yuanbao", "qianwen"],
  results: {
    reputation: {
      samples: 15,
      metrics: [
        {
          id: "negative",
          label: "负面",
          value: 20,
          unit: "%",
          denominator: 15,
        },
      ],
      assessment: {
        summary: "风险表达需要进一步核验。",
        topics: [
          {
            topic: "科室服务边界",
            verdict: "supported",
            docPath: "scope.md",
            kbExcerpt: "知识库中的科室范围",
            answerRefs: [
              { sampleId: "answer-a", excerpt: "AI 正确表达了科室范围" },
            ],
            explanation: "与当前知识一致。",
          },
          {
            topic: "未经核验的承诺",
            verdict: "unverifiable",
            docPath: null,
            kbExcerpt: null,
            answerRefs: [
              { sampleId: "answer-b", excerpt: "AI 出现了缺少来源的承诺" },
            ],
            explanation: "材料不足以核验。",
          },
        ],
      },
    },
  },
} as unknown as DiagnosticRunView;

afterEach(cleanup);
describe("diagnostic result evidence", () => {
  it("preserves zero scores while leaving unavailable dimensions unscored", () => {
    const onAnswers = vi.fn();
    render(
      <DiagnosticSemanticAudit
        audit={audit}
        disabled={false}
        allowRequest={false}
        onRequest={vi.fn()}
        onKnowledge={vi.fn()}
        onAnswers={onAnswers}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText("0 / 30")).toBeTruthy();
    expect(screen.getByText("依据不足 · 0/3 项可评")).toBeTruthy();
    expect(
      screen.queryByRole("meter", { name: "语义权威性模型评分" }),
    ).toBeNull();
    expect(screen.queryByText(/gpt-6.1-sol|2026-11-01|总分.*100/)).toBeNull();
    const visibility = screen.getByText("语义可见度").closest("details")!;
    fireEvent.click(visibility.querySelector("summary")!);
    fireEvent.click(
      within(visibility).getAllByRole("button", {
        name: /查看 1 份回答依据/,
      })[0],
    );
    expect(onAnswers).toHaveBeenCalledWith("audit:accurate_recognition");
  });

  it("only requests an explicit missing audit and keeps collection out of the action", () => {
    const onRequest = vi.fn();
    const { rerender } = render(
      <DiagnosticSemanticAudit
        disabled={false}
        allowRequest
        onRequest={onRequest}
        onKnowledge={vi.fn()}
        onAnswers={vi.fn()}
        onAnswer={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "复用回答，补充语义评估" }),
    );
    expect(onRequest).toHaveBeenCalledOnce();
    rerender(
      <DiagnosticSemanticAudit
        status="running"
        disabled={false}
        allowRequest
        onRequest={onRequest}
        onKnowledge={vi.fn()}
        onAnswers={vi.fn()}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /补充语义评估/ })).toBeNull();
    expect(
      screen.getByText("正在使用本题已保存的回答进行语义评估。"),
    ).toBeTruthy();
  });

  it("filters visible comparisons without dropping their knowledge and answer links", () => {
    const onKnowledge = vi.fn(),
      onAnswer = vi.fn();
    render(
      <DiagnosticKnowledgeComparison
        run={run}
        onKnowledge={onKnowledge}
        onAnswers={vi.fn()}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText("知识库中的科室范围")).toBeTruthy();
    expect(screen.getByText(/对照基准来自本轮冻结知识/)).toBeTruthy();
    expect(screen.queryByText(/对照基准来自企业已确认知识/)).toBeNull();
    expect(screen.getByText("AI 正确表达了科室范围")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /查看知识节点/ }));
    expect(onKnowledge).toHaveBeenCalledWith("scope.md");
    fireEvent.click(screen.getAllByRole("button", { name: "查看这份回答" })[0]);
    expect(onAnswer).toHaveBeenCalledWith("reputation", "answer-a");
    fireEvent.click(screen.getByRole("button", { name: /无法核验 1/ }));
    expect(screen.queryByText("科室服务边界")).toBeNull();
    expect(screen.getByText("未经核验的承诺")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("combobox", { name: "筛选知识对照类别" }),
      { target: { value: "industry_ranking" } },
    );
    expect(screen.getByText("当前筛选下没有对照要点。")).toBeTruthy();
  });

  it("keeps each category metric separate and opens its original answer evidence", () => {
    const onAnswers = vi.fn();
    render(<DiagnosticOverview run={run} onAnswers={onAnswers} />);
    fireEvent.click(screen.getByRole("button", { name: /负面/ }));
    expect(onAnswers).toHaveBeenCalledWith("reputation", "negative");
    expect(screen.getByText(/统计基数 15/)).toBeTruthy();
    expect(screen.getAllByText("等待本类诊断结果")).toHaveLength(3);
  });
});
