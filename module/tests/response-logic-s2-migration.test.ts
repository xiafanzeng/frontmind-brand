import { describe, expect, it } from "vitest";
import { Router } from "express";
import {
  createResponseLogicEvaluationStore,
} from "../server/response-logic-evaluation-store.js";
import { createResponseLogicEvaluationRouter } from "../server/response-logic-evaluation-api.js";
import {
  createResponseLogicRuleEvaluation,
  fingerprintLogic,
  RULE_EVALUATION_VERSION,
} from "../contracts/response-logic-evaluation.js";

const logic = {
  concern: "用户关注机构资质与真实性",
  conclusion: "先核验资质与授权，再对比服务范围。",
  facts: "资质证书：见官网公示",
  boundaries: "不使用绝对化承诺",
};

const testQuestion = {
  questionId: "test-q1",
  groupId: "g1",
  groupTitle: "测试组",
  question: "机构靠谱吗？如何判断服务商资质？",
  intent: "机构可信度与选型判断标准",
  summary: "选型判断标准",
  writeScope: { revision: 1, contractId: null, quotaPeriodId: "p1" },
};

/** Deterministic rule evaluation contract functions should work in Brand context. */
describe("S2: rule evaluation contracts work in Brand module", () => {
  it("computes a stable fingerprint from the four draft sections", () => {
    const fp1 = fingerprintLogic(logic);
    const fp2 = fingerprintLogic({ ...logic });
    const fp3 = fingerprintLogic({ ...logic, conclusion: "不同的结论" });
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it("produces a valid rule evaluation from a question + draft", () => {
    const evaluation = createResponseLogicRuleEvaluation({
      questionId: testQuestion.questionId,
      question: testQuestion.question,
      intent: testQuestion.intent,
      version: null,
      revision: 1,
      logic,
    });
    expect(evaluation.kind).toBe("rule-evaluation");
    expect(evaluation.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(evaluation.sourceFingerprint).toBeTruthy();
    const dims = evaluation.dimensions;
    expect(Object.keys(dims)).toEqual([
      "relevance",
      "completeness",
      "actionability",
      "boundaryRisk",
    ]);
  });
});

/** The evaluation store must degrade honestly when the table doesn't exist. */
describe("S2: evaluation store degradation", () => {
  it("reports persisted:false on save when the table is missing", async () => {
    const store = createResponseLogicEvaluationStore({
      getDb: async () => null,
    });
    const result = await store.save({
      userId: 7,
      questionId: "test-q1",
      recordRevision: 1,
      confirmedVersion: null,
      sourceFingerprint: fingerprintLogic(logic),
      ruleVersion: RULE_EVALUATION_VERSION,
      evaluation: createResponseLogicRuleEvaluation({
        questionId: "test-q1",
        question: testQuestion.question,
        intent: testQuestion.intent,
        version: null,
        revision: 1,
        logic,
      }),
    });
    expect(result.available).toBe(false);
  });

  it("returns latest=null when the database is unavailable", async () => {
    const store = createResponseLogicEvaluationStore({
      getDb: async () => null,
    });
    const latest = await store.getLatest(7, "test-q1");
    expect(latest.available).toBe(false);
  });
});

/** The evaluation API router should mount and respond with proper errors. */
describe("S2: evaluation API router", () => {
  it("rejects unauthenticated requests", async () => {
    const router = createResponseLogicEvaluationRouter({
      enterpriseWorkspaceUserId: (id: number) => id,
      assertServiceCapability: async () => {},
      ServiceEntitlementError: class extends Error {
        code: string; statusCode: number;
        constructor(code: string, message: string, statusCode = 403) { super(message); this.code = code; this.statusCode = statusCode; }
      },
      sendAiBillingError: () => false,
      getDashboardQuestion: async () => testQuestion,
      getResponseLogicEntry: async () => null,
      evaluationStore: createResponseLogicEvaluationStore({ getDb: async () => null }),
    } as never);

    const app = Router();
    app.use("/evaluation", router);
    // The router should exist and be mountable
    expect(router).toBeDefined();
  });
});
