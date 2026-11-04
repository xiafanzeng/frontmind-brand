import { describe, expect, it } from "vitest";
import {
  resolveStandaloneBrandPage,
  standaloneBrandPages,
  standaloneBrandViewUrl,
} from "../../standalone/routes";

describe("brand standalone business routes", () => {
  it("provides parallel knowledge and diagnosis subpages with stable answer selection", () => {
    expect(standaloneBrandPages.slice(0,2)).toEqual([["knowledge","智能知识库"],["diagnostics","AI 语义诊断"]]);
    expect(resolveStandaloneBrandPage("diagnostics")).toBe("diagnostics");
    const selected="?view=diagnostics&diagnosis=task&question=reputation&metric=positive&answer=sample&diagnosticView=expanded";
    const knowledge=standaloneBrandViewUrl("knowledge",selected);
    const diagnosis=standaloneBrandViewUrl("diagnostics",new URL(knowledge,"https://brand.frontmind.cn").search);
    expect(new URL(diagnosis,"https://brand.frontmind.cn").searchParams.get("answer")).toBe("sample");
    expect(diagnosis).not.toContain("diagnosticView");
    expect(standaloneBrandViewUrl("intent",selected)).toBe("/?view=intent");
  });

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

