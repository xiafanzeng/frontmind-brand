import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_NODE_PROSE_HASH,
  knowledgeProseInstruction,
} from "../contracts/knowledge-node-prose.js";
import { knowledgeProseSaveRecoveryCandidate } from "../contracts/knowledge-prose-recovery.js";

describe("Core runtime prose ABI", () => {
  it("ships the prose contract imported by the Dashboard runtime", () => {
    expect(KNOWLEDGE_NODE_PROSE_HASH).toMatch(/^[a-f0-9]{64}$/u);
    expect(knowledgeProseInstruction("现有材料")).toContain("现有材料");
  });

  it("ships the recovery contract imported by maintenance tooling", () => {
    expect(typeof knowledgeProseSaveRecoveryCandidate).toBe("function");
  });
});
