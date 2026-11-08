import { describe, expect, it } from "vitest";
import {
  RAG_STARTER_PROMPT_VERSION,
  parseGeneratedRagStarterQuestions,
  parseRagStarterQuestionTexts,
} from "../contracts/rag-starter-questions.js";
import {
  ragStarterKnowledgeContentHash,
  ragStarterSourceCatalog,
} from "../server/rag-starter-question-reservation.js";

describe("RAG starter question contract", () => {
  const operationToken = "rag-starter:11111111-1111-4111-8111-111111111111";
  const inputHash = "a".repeat(64);

  it("uses the customer-language v2 generation coordinate", () => {
    expect(RAG_STARTER_PROMPT_VERSION).toBe("rag-starter-questions-v2");
  });

  it("accepts exactly three unique, bounded questions with frozen evidence aliases", () => {
    const questions = parseGeneratedRagStarterQuestions({
      operationToken,
      inputHash,
      questions: [
        { text: "FrontMind 可以帮企业做什么？", sourceAliases: ["KB-001"] },
        { text: "你们的核心服务包括哪些？", sourceAliases: ["KB-001", "KB-002"] },
        { text: "如何开始使用你们的服务？", sourceAliases: ["KB-002"] },
      ],
    }, {
      operationToken,
      inputHash,
      allowedSourceAliases: new Set(["KB-001", "KB-002"]),
    });
    expect(questions).toHaveLength(3);
  });

  it("rejects duplicate questions and aliases outside the frozen whitelist", () => {
    expect(() => parseRagStarterQuestionTexts([
      "你们提供哪些服务？",
      " 你们提供哪些服务？ ",
      "如何开始？",
    ])).toThrow();
    expect(() => parseGeneratedRagStarterQuestions({
      operationToken,
      inputHash,
      questions: [
        { text: "你们提供哪些服务？", sourceAliases: ["KB-999"] },
        { text: "你们的核心优势是什么？", sourceAliases: ["KB-001"] },
        { text: "如何开始使用？", sourceAliases: ["KB-001"] },
      ],
    }, {
      operationToken,
      inputHash,
      allowedSourceAliases: new Set(["KB-001"]),
    })).toThrow("RAG_STARTER_RESULT_SOURCE_INVALID");
  });

  it.each([
    "医学美容科公开介绍了哪些服务，哪些信息仍需核验？",
    "根据公开资料，医学美容科介绍了哪些服务？",
    "知识库显示你们提供哪些服务？",
    "资料显示你们有哪些服务？",
    "公开资料里有哪些门诊安排？",
    "知识库中有哪些项目，哪些内容未披露？",
    "仍需核验的信息有哪些？",
    "现有文档里哪些内容待补充？",
    "哪些资质仍需核实？",
    "你们有哪些服务，哪些资质仍需核实？",
    "这些结论的依据是否充分？",
  ])("rejects internal knowledge-governance wording from generated questions: %s", (badQuestion) => {
    expect(() => parseGeneratedRagStarterQuestions({
      operationToken,
      inputHash,
      questions: [
        { text: badQuestion, sourceAliases: ["KB-001"] },
        { text: "你们可以帮助我解决哪些问题？", sourceAliases: ["KB-001"] },
        { text: "如何预约咨询？", sourceAliases: ["KB-001"] },
      ],
    }, {
      operationToken,
      inputHash,
      allowedSourceAliases: new Set(["KB-001"]),
    })).toThrow("RAG_STARTER_RESULT_CUSTOMER_LANGUAGE_INVALID");
  });

  it("allows real customer verification and cost-confirmation questions", () => {
    expect(() => parseGeneratedRagStarterQuestions({
      operationToken,
      inputHash,
      questions: [
        { text: "如何核验医生资质？", sourceAliases: ["KB-001"] },
        { text: "预约前要确认哪些费用？", sourceAliases: ["KB-001"] },
        { text: "哪些项目需要术前检查或补充材料？", sourceAliases: ["KB-001"] },
      ],
    }, {
      operationToken,
      inputHash,
      allowedSourceAliases: new Set(["KB-001"]),
    })).not.toThrow();

    expect(() => parseGeneratedRagStarterQuestions({
      operationToken,
      inputHash,
      questions: [
        { text: "公开收费标准在哪里查看？", sourceAliases: ["KB-001"] },
        { text: "申请资料里哪些材料需要盖章？", sourceAliases: ["KB-001"] },
        { text: "收费依据是否公开？", sourceAliases: ["KB-001"] },
      ],
    }, {
      operationToken,
      inputHash,
      allowedSourceAliases: new Set(["KB-001"]),
    })).not.toThrow();

    expect(() => parseRagStarterQuestionTexts([
      "医学美容科公开介绍了哪些服务，哪些信息仍需核验？",
      "你们可以帮助我解决哪些问题？",
      "如何预约咨询？",
    ])).not.toThrow();
  });

  it("builds stable aliases and a content hash only from immutable document data", () => {
    const documents = [
      { path: "b.md", title: "B", content: "第二份资料" },
      { path: "a.md", title: "A", content: "第一份资料" },
      { path: "private.md", title: "Private", content: "不应透出", customerVisible: false },
    ];
    expect(ragStarterSourceCatalog(documents).map((item) => [item.alias, item.path])).toEqual([
      ["KB-001", "a.md"],
      ["KB-002", "b.md"],
    ]);
    expect(ragStarterKnowledgeContentHash(documents)).toMatch(/^[a-f0-9]{64}$/u);
    expect(ragStarterKnowledgeContentHash(documents)).toBe(ragStarterKnowledgeContentHash(structuredClone(documents)));
  });
});
