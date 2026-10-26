// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { and, eq } from "drizzle-orm";
import {
  assembleResponseLogicCore,
  brandResponseLogicOwnerPredicate,
  brandResponseLogicQuestionLockTable,
  brandQuestionLockNoMatchPredicate,
} from "../server/response-logic-runtime";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime";

const dialect = new MySqlDialect();

const validSaveValue = {
  questionId: "t:1",
  groupId: "brand-intent",
  groupTitle: "品牌意图优化",
  question: "隆鼻材料应该怎么选",
  intent: "",
  summary: "",
  expectedRevision: 0,
  draft: {
    concern: "",
    conclusion: "",
    facts: "",
    pending: "",
    boundaries: "",
    references: "",
    images: [],
    attachments: [],
  },
  publish: false,
} as never;

/**
 * A transaction/db double that absorbs every drizzle builder chain and
 * resolves each awaited statement to []. The save path then runs to its final
 * re-select, which finds no row and throws the service's NOT_FOUND — proving
 * the whole path traversed the question lock and CAS without any port error.
 */
function absorbingDb() {
  const query = () => {
    const promise = Promise.resolve([]);
    const callable = () => chain;
    const base: Record<string, unknown> = {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
    const chain = new Proxy(callable, {
      get(_target, prop) {
        if (prop in base) return base[prop as string];
        return () => chain;
      },
      apply() {
        return chain;
      },
    }) as unknown as { then: Promise<unknown>["then"] } & Record<string, any>;
    return chain;
  };
  // The ledger question lock reads brand_intent_workspaces via raw execute;
  // serve one row so the lock finds the question and the save can proceed to
  // its final re-select (NOT_FOUND) exactly as before.
  const ledgerResult = [
    [{ payload: JSON.stringify({ version: 1, questions: [{ id: "t:1" }] }), revision: 5 }],
    [{ name: "payload" }, { name: "revision" }],
  ];
  const execute = async (config?: unknown) =>
    JSON.stringify(config)?.includes("brand_intent_workspaces") ? ledgerResult : [];
  const tx = new Proxy({} as Record<string, any>, {
    get(_target, prop) {
      if (prop === "execute") return execute;
      return (..._args: unknown[]) => query();
    },
  });
  return {
    transaction: async (callback: (executor: unknown) => unknown) => callback(tx),
    select: () => query(),
    insert: () => query(),
    update: () => query(),
    execute,
  } as never;
}

registerIntentSkillPorts({
  currentEnterpriseProjectId: () => null,
  lockCustomerProjectBusinessWrite: async () => {},
} as never);

const runtime = assembleResponseLogicCore({ getDb: async () => absorbingDb() });

describe("brand response-logic runtime service ports", () => {
  it("builds a real ownership predicate that scopes every query by userId", () => {
    const owner = brandResponseLogicOwnerPredicate(42);
    const direct = dialect.sqlToQuery(owner as never);
    expect(direct.sql).toContain("`response_logic_entries`.`userId` = ?");
    expect(direct.params).toEqual([42]);

    const combined = dialect.sqlToQuery(
      and(owner as never, eq(brandResponseLogicQuestionLockTable.id, "t:1")) as never,
    );
    expect(combined.sql).toContain("`userId` = ?");
    expect(combined.sql).toContain("`id` = ?");
    expect(combined.params).toEqual([42, "t:1"]);
  });

  it("keeps the relational question lock on a never-matching real table", () => {
    const lockQuery = dialect.sqlToQuery(
      and(
        eq(brandResponseLogicQuestionLockTable.id, "t:1"),
        brandQuestionLockNoMatchPredicate(42) as never,
      ) as never,
    );
    expect(lockQuery.sql).toContain("1 = 0");
    expect(lockQuery.sql).toContain("`response_logic_entries`");
  });

  it("lists records through the runtime without a port error", async () => {
    await expect(
      runtime.responseLogicService.listResponseLogicEntries(42),
    ).resolves.toEqual([]);
  });

  it("runs save through the question lock and CAS instead of the broken stubs", async () => {
    // With the pre-fix ports this rejected with
    // BRAND_LEDGER_QUESTIONS_USE_RESOLVER_NOT_TABLE at the lock. With the
    // fixed ports the absorbing db lets the save traverse lock + CAS +
    // insert, and only the final re-select reports NOT_FOUND.
    await expect(
      runtime.responseLogicService.saveResponseLogicEntry({
        userId: 42,
        value: validSaveValue,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Response logic was not saved" });
  });
});
