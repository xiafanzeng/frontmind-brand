// @vitest-environment node
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  ensureSiteOpsProfileForOwner,
  SiteOpsServiceError,
} from "../server/siteops/service.js";

function executorFor(rows: Array<{ userId: number }>) {
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onDuplicateKeyUpdate }));
  const insert = vi.fn(() => ({ values }));
  const forUpdate = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn(() => ({ for: forUpdate }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    executor: { insert, select },
    spies: { insert, values, onDuplicateKeyUpdate, forUpdate },
  };
}

describe("SiteOps profile initialization", () => {
  it("is an idempotent no-op on duplicate and locks the owned row", async () => {
    const table = { userId: Symbol("profile.userId") };
    const ownerPredicate = Symbol("owned-profile") as unknown as SQL;
    const { executor, spies } = executorFor([{ userId: 7 }]);

    await expect(
      ensureSiteOpsProfileForOwner(executor, {
        table,
        ownerPredicate,
        userId: 7,
      }),
    ).resolves.toEqual({ userId: 7 });

    expect(spies.insert).toHaveBeenCalledWith(table);
    expect(spies.values).toHaveBeenCalledWith({ userId: 7 });
    expect(spies.onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: { userId: expect.anything() },
    });
    expect(spies.forUpdate).toHaveBeenCalledWith("update");
  });

  it("rejects a duplicate project key that is not visible to the owner", async () => {
    const table = { userId: Symbol("profile.userId") };
    const { executor } = executorFor([]);

    await expect(
      ensureSiteOpsProfileForOwner(executor, {
        table,
        ownerPredicate: Symbol("other-owner") as unknown as SQL,
        userId: 7,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SiteOpsServiceError>>({
        code: "FORBIDDEN",
        statusCode: 403,
      }),
    );
  });
});
