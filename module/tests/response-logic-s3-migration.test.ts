import { describe, expect, it } from "vitest";
import {
  brandQuestionHash,
  toConfiguredIntentQuestion,
  resolveBrandIntentQuestion,
} from "../server/brand-question-resolver.js";

/**
 * S3 migration tests: Brand question resolver + question fingerprint.
 *
 * The questionHash is the context-invalidation mechanism: when a Brand user
 * optimizes a question from A to A', the hash changes even though the
 * questionId, draft revision and four-section draft content all stay the
 * same. Server-side Judge/optimizer idempotency keys and context keys must
 * include this hash so stale results are rejected.
 */
describe("S3: Brand question resolver", () => {
  it("computes a stable question hash from question + intent text", () => {
    const h1 = brandQuestionHash("问题 A", "意图 X");
    const h2 = brandQuestionHash("问题 A", "意图 X");
    const h3 = brandQuestionHash("问题 A'", "意图 X"); // question edited
    const h4 = brandQuestionHash("问题 A", "意图 Y"); // intent edited
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps a resolved Brand question to the ConfiguredIntentQuestion shape", () => {
    const resolved = {
      questionId: "universe-table:42",
      question: "当前问题文本",
      intent: "测试意图",
      category: "行业排名词",
      questionHash: "abc123",
      workspaceRevision: 7,
    };
    const config = toConfiguredIntentQuestion(resolved);
    expect(config.questionId).toBe("universe-table:42");
    expect(config.question).toBe("当前问题文本");
    expect(config.intent).toBe("测试意图");
    expect(config.writeScope.revision).toBe(7);
    expect(config.writeScope.quotaPeriodId).toBe("brand-intent");
  });

  it("returns null when the database is unavailable", async () => {
    const result = await resolveBrandIntentQuestion(
      { getDb: async () => null },
      { accountUserId: 1, enterpriseProjectId: "proj-1", questionId: "test:1" },
    );
    expect(result).toBeNull();
  });
});

describe("S3: question hash enables context invalidation", () => {
  it("same question text produces the same hash (idempotent reuse works)", () => {
    const hashA1 = brandQuestionHash("如何选择 CRM？", "选型对比");
    const hashA2 = brandQuestionHash("如何选择 CRM？", "选型对比");
    expect(hashA1).toBe(hashA2);
  });

  it("edited question text produces a different hash (stale results rejected)", () => {
    const hashA = brandQuestionHash("如何选择 CRM？", "选型对比");
    const hashAPrime = brandQuestionHash("如何选择 SaaS CRM？还是本地部署？", "选型对比");
    expect(hashA).not.toBe(hashAPrime);
  });
});
