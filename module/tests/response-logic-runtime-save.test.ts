// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { assembleResponseLogicCore } from "../server/response-logic-runtime";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime";
import { resolveBrandIntentQuestion } from "../server/brand-question-resolver";
import { createFakeMysqlClient } from "./helpers/response-logic-fake-mysql.js";

const USER = 42;
const OTHER = 43;
const QUESTION_ID = "t:1";

const saveValue = {
  questionId: QUESTION_ID,
  groupId: "brand-intent",
  groupTitle: "品牌意图优化",
  question: "隆鼻材料应该怎么选",
  intent: "材料对比",
  summary: "",
  expectedRevision: 0,
  draft: {
    concern: "担心选错材料",
    conclusion: "先确认用途，再核对证书范围",
    facts: "资质证书：见官网公示",
    pending: "",
    boundaries: "不承诺具体价格",
    references: "",
    images: [],
    attachments: [],
  },
  publish: false,
} as never;

function createHarness() {
  const fake = createFakeMysqlClient({
    ledger: [
      {
        ownerUserId: USER,
        projectId: null,
        revision: 5,
        payload: {
          version: 1,
          questions: [
            { id: QUESTION_ID, question: "隆鼻材料应该怎么选", intent: "材料对比", category: "产品场景词" },
          ],
        },
      },
    ],
  });
  const db = drizzle(fake.client as never);
  registerIntentSkillPorts({
    currentEnterpriseProjectId: () => null,
    lockCustomerProjectBusinessWrite: async () => {},
  } as never);
  const runtime = assembleResponseLogicCore({ getDb: async () => db as never });
  return { fake, db, runtime };
}

describe("brand response-logic runtime save (real drizzle construction, in-memory mysql)", () => {
  it("resolves the ledger question through the real resolver and driver tuple shape", async () => {
    const { db } = createHarness();
    const resolved = await resolveBrandIntentQuestion(
      { getDb: async () => db as never },
      { accountUserId: USER, enterpriseProjectId: null, questionId: QUESTION_ID },
    );
    expect(resolved).toMatchObject({ questionId: QUESTION_ID, question: "隆鼻材料应该怎么选", workspaceRevision: 5 });

    const foreign = await resolveBrandIntentQuestion(
      { getDb: async () => db as never },
      { accountUserId: OTHER, enterpriseProjectId: null, questionId: QUESTION_ID },
    );
    expect(foreign).toBeNull();
  });

  it("saves a record end to end and returns the persisted row", async () => {
    const { fake, runtime } = createHarness();
    const record = await runtime.responseLogicService.saveResponseLogicEntry({
      userId: USER,
      value: saveValue,
    });
    expect(record).toMatchObject({ questionId: QUESTION_ID, revision: 1 });
    expect(fake.entries).toHaveLength(1);
    expect(fake.entries[0]).toMatchObject({
      userId: USER,
      questionId: QUESTION_ID,
      revision: 1,
      enterpriseProjectId: null,
    });
    // The question lock read the ledger row FOR UPDATE inside the tx.
    expect(
      fake.sqlLog.some(sql =>
        sql.toLowerCase().includes("brand_intent_workspaces") && sql.toLowerCase().includes("for update")),
    ).toBe(true);
  });

  it("lists only the owning workspace and hides the record from other users", async () => {
    const { runtime } = createHarness();
    await runtime.responseLogicService.saveResponseLogicEntry({ userId: USER, value: saveValue });
    const owned = await runtime.responseLogicService.listResponseLogicEntries(USER);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ questionId: QUESTION_ID });
    const foreign = await runtime.responseLogicService.listResponseLogicEntries(OTHER);
    expect(foreign).toEqual([]);
    expect(await runtime.getResponseLogicEntry(OTHER, QUESTION_ID)).toBeNull();
  });

  it("rejects a stale revision with 409 semantics and does not overwrite", async () => {
    const { fake, runtime } = createHarness();
    await runtime.responseLogicService.saveResponseLogicEntry({ userId: USER, value: saveValue });
    await expect(
      runtime.responseLogicService.saveResponseLogicEntry({ userId: USER, value: saveValue }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      responseLogicCode: "RESPONSE_LOGIC_REVISION_CONFLICT",
      statusCode: 409,
    });
    expect(fake.entries[0].revision).toBe(1);
  });

  it("saves the next revision when the CAS expectation matches", async () => {
    const { runtime } = createHarness();
    await runtime.responseLogicService.saveResponseLogicEntry({ userId: USER, value: saveValue });
    const updated = await runtime.responseLogicService.saveResponseLogicEntry({
      userId: USER,
      value: { ...(saveValue as object), expectedRevision: 1 } as never,
    });
    expect(updated).toMatchObject({ questionId: QUESTION_ID, revision: 2 });
    const reread = await runtime.getResponseLogicEntry(USER, QUESTION_ID);
    expect(reread).toMatchObject({ revision: 2, questionId: QUESTION_ID });
  });

  it("accepts a save whose question scope matches the current ledger revision", async () => {
    const { runtime } = createHarness();
    const record = await runtime.responseLogicService.saveResponseLogicEntry({
      userId: USER,
      value: saveValue,
      expectedQuestionScope: { revision: 5, contractId: null, quotaPeriodId: "brand-intent" },
    });
    expect(record).toMatchObject({ questionId: QUESTION_ID, revision: 1 });
  });

  it("rejects a save based on a question context the ledger has since moved past (Q1→Q2 race)", async () => {
    const { fake, runtime } = createHarness();
    // Request A resolved the question at ledger revision 5 ...
    const resolvedScope = { revision: 5, contractId: null, quotaPeriodId: "brand-intent" };
    // ... request B edits the question (every intent-workbench command bumps
    // the ledger revision) and commits before A saves.
    fake.ledgerRows[0].revision = 6;
    fake.ledgerRows[0].payload = {
      version: 1,
      questions: [{ id: QUESTION_ID, question: "修改后的新问题文本", intent: "", category: "" }],
    };
    await expect(
      runtime.responseLogicService.saveResponseLogicEntry({
        userId: USER,
        value: saveValue,
        expectedQuestionScope: resolvedScope,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fake.entries).toHaveLength(0);
    // A fresh resolve after the edit saves normally with the new scope.
    await expect(
      runtime.responseLogicService.saveResponseLogicEntry({
        userId: USER,
        value: { ...(saveValue as object), question: "修改后的新问题文本" } as never,
        expectedQuestionScope: { revision: 6, contractId: null, quotaPeriodId: "brand-intent" },
      }),
    ).resolves.toMatchObject({ questionId: QUESTION_ID, revision: 1 });
  });

  it("rejects a save whose question no longer exists in the ledger", async () => {
    const { fake, runtime } = createHarness();
    fake.ledgerRows[0].payload = { version: 1, questions: [] };
    await expect(
      runtime.responseLogicService.saveResponseLogicEntry({ userId: USER, value: saveValue }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fake.entries).toHaveLength(0);
  });
});
