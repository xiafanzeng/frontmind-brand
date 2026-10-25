import {describe, expect, it} from "vitest";
import {intentHash, validateIntentSkillResult, type IntentSkillInput} from "../server/intent-skill-runtime";
import type {IntentSkillJob} from "../contracts/intent-workbench";

function fixture(kind: "evaluate" | "plan" = "plan") {
  const input: IntentSkillInput = {kind, operationToken: "brand-intent:task", inputHash: "a".repeat(64), skill: "Skill",
    selectedQuestions: [{id: "q", question: "如何选择材料？", category: "产品", subdivision: "", tableId: "t", rowIndex: 0, sourceRevision: 1}],
    candidates: [], nodes: [{id: "n", title: "选材", branch: "产品", content: "材料选择依据适用条件。", verified: true, editable: true}]};
  const job = {id: "task", inputHash: input.inputHash, skillHash: intentHash(input.skill), model: "model"} as IntentSkillJob;
  const value = {operationToken: input.operationToken, inputHash: input.inputHash, evaluations: [{
    questionId: "q", value: 100, support: 100,
    dimensions: ["意图明确度", "品牌关联度", "决策相关度", "问题清晰度", "内容独特度", "知识支撑初评"].map(label => ({label, score: 100, reason: "依据知识"})),
    points: [{title: "适用条件", terms: ["条件"], status: "supported", nodeId: "n", evidence: "材料选择依据适用条件。", issue: "已有证据"}],
    findings: [],
  }], plans: kind === "plan" ? [{questionId: "q", actions: [
    {kind: "question", title: "明确适用条件", nodeId: null, after: "材料选择有哪些适用条件？", source: "选材节点"},
    {kind: "node", title: "重组回答口径", nodeId: "n", after: "# 选材\n\n材料选择依据适用条件。", source: "选材节点原文"},
  ]}] : []};
  return {input, job, value};
}
describe("真实优化 Skill 输出校验", () => {
  it("输入哈希不受数据库 JSON 字段顺序影响", () => {
    expect(intentHash({a: 1, nested: {x: 2, y: 3}})).toBe(intentHash({nested: {y: 3, x: 2}, a: 1}));
    expect(intentHash(["a|b", "c"])).not.toBe(intentHash(["a", "b|c"]));
  });
  it("保留模型评分及来源，节点变更默认需要人工采纳", () => {
    const {input, job, value} = fixture();
    const result = validateIntentSkillResult(value, input, job);
    expect(result.evaluations[0].method).toBe("skill_v1");
    expect(result.evaluations[0].provenance?.operationId).toBe(job.id);
    expect(result.plans[0].actions[0].before).toBe(input.selectedQuestions[0].question);
    expect(result.plans[0].actions[1].selected).toBe(false);
    expect(result.plans[0].actions[1].before).toBe(input.nodes[0].content);
  });
  it.each(["operationToken", "inputHash"] as const)("拒绝其他任务的 %s", field => {
    const {input, job, value} = fixture(); value[field] = "b".repeat(64);
    expect(() => validateIntentSkillResult(value, input, job)).toThrow();
  });
  it("拒绝遗漏或重复问题", () => {
    const {input, job, value} = fixture(); value.evaluations.push(value.evaluations[0]);
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("完整覆盖");
  });
  it.each(["虚构证据", "未确认节点", "待核验表述"])("拒绝充分支撑中的%s", mode => {
    const {input, job, value} = fixture();
    if (mode === "虚构证据") value.evaluations[0].points[0].evidence = "获得权威证书";
    if (mode === "未确认节点") input.nodes[0].verified = false;
    if (mode === "待核验表述") {
      input.nodes[0].content = "证书资料待核验。";
      value.evaluations[0].points[0].evidence = input.nodes[0].content;
    }
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("可验证");
  });
  it("拒绝伪造评分和不可编辑节点", () => {
    const {input, job, value} = fixture(); value.evaluations[0].value = 99;
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("评分口径");
    value.evaluations[0].value = 100; input.nodes[0].editable = false;
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("不可编辑");
  });
  it("只评估时拒绝执行方案，方案拒绝重复动作", () => {
    const {input, job, value} = fixture(); input.kind = "evaluate";
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("完整覆盖");
    input.kind = "plan"; value.plans[0].actions.push(value.plans[0].actions[0]);
    expect(() => validateIntentSkillResult(value, input, job)).toThrow("重复动作");
  });
});
