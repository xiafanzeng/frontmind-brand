import { describe, expect, it } from "vitest";
import {
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
