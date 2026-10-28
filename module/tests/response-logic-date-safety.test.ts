// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toDateOrNow, providerExpiresAtToDate } from "../server/response-logic-date-utils.js";

/**
 * Regression tests for the toISOString TypeError that blocked every
 * /response-logic/start in production. The two crash sources were:
 *
 * 1. buildVerifiedResponseLogicAttachments receiving MySQL2 string dates or
 *    null createdAt from localAssets.
 * 2. providerFileLeases insert passing new Date(NaN) from an undefined
 *    uploaded.detail.expiresAt.
 */

describe("toDateOrNow: safe date normalization", () => {
  it("passes through valid Date objects unchanged", () => {
    const d = new Date("2026-10-27T10:00:00Z");
    const result = toDateOrNow(d);
    expect(result).toBe(d);
  });

  it("replaces Invalid Date with now instead of crashing downstream", () => {
    const invalid = new Date(NaN);
    const result = toDateOrNow(invalid);
    expect(result.getTime()).not.toBeNaN();
    expect(() => result.toISOString()).not.toThrow();
  });

  it("parses MySQL2 dateStrings format", () => {
    const result = toDateOrNow("2026-10-27 10:00:00");
    expect(result.getTime()).not.toBeNaN();
    expect(result.toISOString()).toContain("2026-10-27");
  });

  it("parses ISO strings", () => {
    const result = toDateOrNow("2026-10-27T10:00:00.000Z");
    expect(result.toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });

  it("parses Unix millisecond numbers", () => {
    const ms = Date.now();
    const result = toDateOrNow(ms);
    expect(result.getTime()).toBe(ms);
  });

  it("falls back to now for null", () => {
    const result = toDateOrNow(null);
    expect(result.getTime()).not.toBeNaN();
    expect(() => result.toISOString()).not.toThrow();
  });

  it("falls back to now for undefined", () => {
    const result = toDateOrNow(undefined);
    expect(result.getTime()).not.toBeNaN();
    expect(() => result.toISOString()).not.toThrow();
  });

  it("falls back to now for empty string", () => {
    const result = toDateOrNow("");
    expect(result.getTime()).not.toBeNaN();
  });

  it("falls back to now for NaN", () => {
    const result = toDateOrNow(NaN);
    expect(result.getTime()).not.toBeNaN();
  });
});

describe("providerExpiresAtToDate: safe provider expiry handling", () => {
  it("converts valid Unix seconds to a Date", () => {
    const seconds = Math.floor(Date.now() / 1000) + 3600;
    const result = providerExpiresAtToDate(seconds);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(seconds * 1000);
  });

  it("returns null for undefined (provider omitted expiresAt)", () => {
    const result = providerExpiresAtToDate(undefined);
    expect(result).toBeNull();
  });

  it("returns null for string values (wrong type from provider)", () => {
    const result = providerExpiresAtToDate("3600");
    expect(result).toBeNull();
  });

  it("returns null for NaN", () => {
    const result = providerExpiresAtToDate(NaN);
    expect(result).toBeNull();
  });

  it("returns null for null", () => {
    const result = providerExpiresAtToDate(null);
    expect(result).toBeNull();
  });

  it("never returns an Invalid Date", () => {
    // This is the key regression: the old code did new Date(undefined * 1000)
    // → new Date(NaN) → drizzle timestamp mapper crashed
    const allResults = [
      providerExpiresAtToDate(undefined),
      providerExpiresAtToDate(NaN),
      providerExpiresAtToDate(Infinity),
      providerExpiresAtToDate("bad"),
    ];
    for (const result of allResults) {
      if (result !== null) {
        expect(result.getTime()).not.toBeNaN();
      }
    }
  });
});

describe("safeErrorForLog: stack preservation and secret redaction", () => {
  it("preserves stack frames for Error objects and redacts secrets", async () => {
    const { assembleResponseLogicCore } = await import("../server/response-logic-runtime.js");
    const { registerIntentSkillPorts } = await import("../server/intent-skill-runtime.js");
    registerIntentSkillPorts({} as never);
    const runtime = assembleResponseLogicCore({ getDb: async () => null as never });

    const secret = "my-secret-key-abc123def456";
    const error = new Error(`Failed with token=${secret}`);
    const logged = runtime.safeErrorForLog(error, { secrets: [secret] }) as {
      name: string; stack?: string;
    };
    expect(logged.name).toBe("Error");
    expect(logged.stack).toBeDefined();
    expect(logged.stack).not.toContain(secret);
  });

  it("handles non-Error objects gracefully", async () => {
    const { assembleResponseLogicCore } = await import("../server/response-logic-runtime.js");
    const { registerIntentSkillPorts } = await import("../server/intent-skill-runtime.js");
    registerIntentSkillPorts({} as never);
    const runtime = assembleResponseLogicCore({ getDb: async () => null as never });
    expect((runtime.safeErrorForLog("plain") as { message: string }).message).toBe("plain");
    expect((runtime.safeErrorForLog(null) as { message: string }).message).toBe("null");
  });
});
