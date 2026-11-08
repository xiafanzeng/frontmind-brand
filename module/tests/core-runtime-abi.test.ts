import { describe, expect, it } from "vitest";
import {
  assertKnowledgeProsePreserved,
  KNOWLEDGE_NODE_PROSE_HASH,
  knowledgeProseInstruction,
} from "../contracts/knowledge-node-prose.js";
import { knowledgeProseSaveRecoveryCandidate } from "../contracts/knowledge-prose-recovery.js";
import { KIMI_KNOWLEDGE_DOCUMENT_MAX_BYTES } from "../contracts/knowledge-base-upload-limits.js";

describe("Core runtime prose ABI", () => {
  it("ships the prose contract imported by the Dashboard runtime", () => {
    expect(KNOWLEDGE_NODE_PROSE_HASH).toMatch(/^[a-f0-9]{64}$/u);
    expect(knowledgeProseInstruction("现有材料")).toContain("现有材料");
    expect(typeof assertKnowledgeProsePreserved).toBe("function");
  });

  it("ships the recovery contract imported by maintenance tooling", () => {
    expect(typeof knowledgeProseSaveRecoveryCandidate).toBe("function");
  });

  it("ships the Kimi upload limit imported by the Dashboard runtime", () => {
    expect(KIMI_KNOWLEDGE_DOCUMENT_MAX_BYTES).toBe(100 * 1024 ** 2);
  });
});
