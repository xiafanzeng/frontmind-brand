import { describe, expect, it } from "vitest";
import {
  resolveStandaloneBrandPage,
  standaloneBrandPages,
} from "../../standalone/routes";

describe("brand standalone business routes", () => {
  it("uses the real enterprise QA and SiteOps page identifiers", () => {
    expect(standaloneBrandPages.slice(-2).map(([id]) => id)).toEqual([
      "enterprise-qa",
      "website",
    ]);
  });

  it("resolves the response-logic workbench instead of falling back to knowledge", () => {
    expect(resolveStandaloneBrandPage("response-logic")).toBe("response-logic");
    expect(standaloneBrandPages.map(([id]) => id)).toContain("response-logic");
  });

  it("keeps old preview links as canonical live-route aliases", () => {
    expect(resolveStandaloneBrandPage("enterprise-rag")).toBe("enterprise-qa");
    expect(resolveStandaloneBrandPage("website-builder")).toBe("website");
  });

  it("rejects unknown pages instead of mounting a preview surface", () => {
    expect(resolveStandaloneBrandPage("unknown-page")).toBeNull();
  });
});

