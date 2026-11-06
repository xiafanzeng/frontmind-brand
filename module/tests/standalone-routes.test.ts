import { describe, expect, it } from "vitest";
import {
  resolveStandaloneBrandPage,
  standaloneBrandPages,
  standaloneBrandViewUrl,
  standaloneRagReportUrl,
  resolveStandaloneRagReport,
} from "../../standalone/routes";
import { RAG_SAMPLE_CASES } from "../client/dashboard/ai-website-preview/rag-evaluation-cases";

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

  it("links to one report page with workspace-bound coordinates and separate chapters", () => {
    const coordinate = { sourceQaTaskId: "task 1", turnId: "turn/2" };
    const rules = new URL(standaloneRagReportUrl("rules", "workspace-a", coordinate), "https://brand.frontmind.cn");
    expect(rules.hash).toBe("#rules");
    expect(resolveStandaloneRagReport(rules.search, "workspace-a")).toEqual({ coordinate, error: null });
    expect(new URL(standaloneRagReportUrl("records", "workspace-a", coordinate), rules).hash).toBe("#records");
    expect([...rules.searchParams.keys()]).toEqual(["view", "report", "workspace", "sourceQaTaskId", "turnId"]);
  });

  it("allows rules without an answer but rejects mismatched workspaces and partial coordinates", () => {
    expect(resolveStandaloneRagReport("?view=enterprise-qa&report=1", "workspace-a")).toEqual({ coordinate: undefined, error: null });
    expect(resolveStandaloneRagReport("?view=enterprise-qa&report=1&workspace=b", "workspace-a")?.error).toContain("工作区不一致");
    expect(resolveStandaloneRagReport("?view=enterprise-qa&report=1&sourceQaTaskId=task", "workspace-a")?.error).toContain("标识不完整");
    expect(resolveStandaloneRagReport("?view=knowledge&report=1", "workspace-a")).toBeNull();
    expect(resolveStandaloneRagReport("?view=enterprise-qa", "workspace-a")).toBeNull();
  });

  it("opens only canonical examples and keeps them separate from live coordinates", () => {
    const exampleId = RAG_SAMPLE_CASES[0].id;
    const url = new URL(standaloneRagReportUrl("records", "workspace-a", undefined, exampleId), "https://brand.frontmind.cn");
    expect(url.searchParams.get("example")).toBe(exampleId);
    expect(url.searchParams.has("sourceQaTaskId")).toBe(false);
    expect(resolveStandaloneRagReport(url.search, "workspace-a")).toEqual({ coordinate: undefined, exampleId, error: null });
    expect(resolveStandaloneRagReport(`${url.search}&sourceQaTaskId=real&turnId=turn`, "workspace-a")?.error).toContain("不能混用");
    expect(resolveStandaloneRagReport(`${url.search}&example=${exampleId}`, "workspace-a")?.error).toContain("标识无效");
    for (const example of ["unknown", "", "../syn-capability", "rag-eval-1.2"]) {
      const invalid = resolveStandaloneRagReport(`?view=enterprise-qa&report=1&example=${encodeURIComponent(example)}`, "workspace-a");
      expect(invalid?.error).toContain("标识无效");
      expect(invalid?.coordinate).toBeUndefined();
      expect(invalid?.exampleId).toBeUndefined();
    }
    expect(() => standaloneRagReportUrl("records", "workspace-a", { sourceQaTaskId: "real", turnId: "turn" }, exampleId)).toThrow("不能混用");
  });
});

