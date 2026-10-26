import {describe, expect, it} from "vitest";
import {
  ENTERPRISE_RAG_DIMENSION_IDS,
  ENTERPRISE_RAG_GATE_IDS,
  validateEnterpriseRagJudgeOutput,
  type EnterpriseRagEvaluationFrozenInput,
} from "../contracts/enterprise-rag-evaluation-run";

const input: EnterpriseRagEvaluationFrozenInput = {
  schemaVersion: 1,
  operationToken: "rag-evaluation:00000000-0000-4000-8000-000000000001",
  inputHash: "a".repeat(64),
  sourceQaTaskId: "qa-task",
  sourceTurnId: "qa-turn",
  conversationId: "conversation",
  questionMessageId: "question-message",
  answerMessageId: "answer-message",
  question: "营业时间是什么？",
  answer: "营业时间是每天九点到十八点。",
  sources: [{
    id: "doc-1",
    title: "营业时间",
    kind: "published_knowledge",
    citedByAnswer: true,
    content: "营业时间是每天九点到十八点。",
  }],
  allowedEvidenceIds: ["answer-message", "doc-1"],
  knowledgeBase: {
    snapshotId: "00000000-0000-4000-8000-000000000002",
    version: 1,
    sourceFileName: "knowledge.md",
    documentCount: 1,
    contentHash: "b".repeat(64),
  },
  evaluator: {
    skillId: "enterprise-rag-evaluation",
    skillVersion: "1.0.0",
    ruleVersion: "rag-eval-1.2",
    judgeVersion: "1.0.0",
  },
};

function validOutput() {
  return {
    operationToken: input.operationToken,
    inputHash: input.inputHash,
    dimensions: ENTERPRISE_RAG_DIMENSION_IDS.map((id) => ({
      id,
      level: 4,
      rationale: "回答和冻结知识一致。",
      evidenceIds: ["answer-message", "doc-1"],
    })),
    gates: ENTERPRISE_RAG_GATE_IDS.map((id) => ({
      id,
      status: "passed" as const,
      reason: "未发现该项风险。",
      evidenceIds: ["answer-message", "doc-1"],
    })),
    claims: [{
      id: "claim-1",
      statement: "营业时间是每天九点到十八点。",
      status: "supported" as "supported" | "partial" | "unsupported",
      sourceIds: ["doc-1"],
      rationale: "来源逐字支持该陈述。",
    }],
    summary: "回答完整且有冻结来源支持。",
  };
}

describe("企业 RAG 自动评估模型输出边界", () => {
  it("接受与任务、回答和冻结来源严格绑定的完整判断", () => {
    const result = validateEnterpriseRagJudgeOutput(validOutput(), input);
    expect(result.dimensions.map(({id}) => id)).toEqual(ENTERPRISE_RAG_DIMENSION_IDS);
    expect(result.gates.map(({id}) => id)).toEqual(ENTERPRISE_RAG_GATE_IDS);
  });

  it("拒绝其他任务、乱序评分项和未授权证据", () => {
    const wrongTask = validOutput();
    wrongTask.inputHash = "c".repeat(64);
    expect(() => validateEnterpriseRagJudgeOutput(wrongTask, input)).toThrow("不属于本次任务");

    const wrongOrder = validOutput();
    wrongOrder.dimensions.reverse();
    expect(() => validateEnterpriseRagJudgeOutput(wrongOrder, input)).toThrow("锁定顺序");

    const inventedEvidence = validOutput();
    inventedEvidence.gates[0].evidenceIds = ["doc-invented"];
    expect(() => validateEnterpriseRagJudgeOutput(inventedEvidence, input)).toThrow("未授权证据");
  });

  it("拒绝改写回答陈述和不可读取来源的充分支持结论", () => {
    const paraphrase = validOutput();
    paraphrase.claims[0].statement = "每天上午九点营业。";
    expect(() => validateEnterpriseRagJudgeOutput(paraphrase, input)).toThrow("连续原文");

    const unavailableInput: EnterpriseRagEvaluationFrozenInput = {
      ...input,
      sources: [{...input.sources[0], content: null}],
    };
    expect(() => validateEnterpriseRagJudgeOutput(validOutput(), unavailableInput)).toThrow("可读取的冻结来源");
  });

  it("拒绝给无支持陈述挂载来源", () => {
    const value = validOutput();
    value.claims[0].status = "unsupported";
    expect(() => validateEnterpriseRagJudgeOutput(value, input)).toThrow("不得附带来源");
  });

  it("拒绝陈述证据与高分、门禁结论自相矛盾", () => {
    const unsupported = validOutput();
    unsupported.claims[0].status = "unsupported";
    unsupported.claims[0].sourceIds = [];
    expect(() => validateEnterpriseRagJudgeOutput(unsupported, input)).toThrow(
      "无支持陈述与事实、引用门禁或评分不一致",
    );

    unsupported.gates.find(({id}) => id === "facts")!.status = "failed";
    unsupported.gates.find(({id}) => id === "citations")!.status = "failed";
    unsupported.dimensions.find(({id}) => id === "correctness")!.level = 2;
    unsupported.dimensions.find(({id}) => id === "citations")!.level = 2;
    expect(() => validateEnterpriseRagJudgeOutput(unsupported, input)).not.toThrow();

    const partial = validOutput();
    partial.claims[0].status = "partial";
    expect(() => validateEnterpriseRagJudgeOutput(partial, input)).toThrow(
      "部分支持陈述与引用门禁或评分不一致",
    );
    partial.gates.find(({id}) => id === "citations")!.status = "failed";
    partial.dimensions.find(({id}) => id === "correctness")!.level = 3;
    partial.dimensions.find(({id}) => id === "citations")!.level = 3;
    expect(() => validateEnterpriseRagJudgeOutput(partial, input)).not.toThrow();
  });

  it("区分冻结语料中的依据与回答实际展示的引用", () => {
    const uncitedInput: EnterpriseRagEvaluationFrozenInput = {
      ...input,
      sources: [{...input.sources[0], citedByAnswer: false}],
    };
    const value = validOutput();
    expect(() => validateEnterpriseRagJudgeOutput(value, uncitedInput)).toThrow(
      "陈述依据未被回答引用",
    );
    value.gates.find(({id}) => id === "citations")!.status = "failed";
    value.dimensions.find(({id}) => id === "citations")!.level = 2;
    expect(() => validateEnterpriseRagJudgeOutput(value, uncitedInput)).not.toThrow();
  });
});
