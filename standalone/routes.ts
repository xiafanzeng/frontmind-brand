import type { BrandPage } from "../module/client/ModuleWorkspace";

export type StandaloneBrandPage = BrandPage;

export const standaloneBrandPages: Array<[StandaloneBrandPage, string]> = [
  ["knowledge", "智能知识库"],
  ["diagnostics", "AI 语义诊断"],
  ["keywords", "词条生成"],
  ["intent", "优化问题"],
  ["response-logic", "应答逻辑"],
  ["enterprise-qa", "企业 RAG"],
  ["website", "网站建设"],
];

const legacyPageAliases: Record<string, StandaloneBrandPage> = {
  "enterprise-rag": "enterprise-qa",
  "website-builder": "website",
};

export function resolveStandaloneBrandPage(value: string) {
  const canonical = value === "reports" ? "diagnostics" : legacyPageAliases[value] ?? value;
  return standaloneBrandPages.some(([id]) => id === canonical)
    ? (canonical as StandaloneBrandPage)
    : null;
}

/** Keep the selected diagnosis/answer when switching the two Brand subpages. */
export function standaloneBrandViewUrl(view: string, currentSearch: string) {
  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams({view});
  if (["knowledge", "diagnostics"].includes(current.get("view") ?? "knowledge") && ["knowledge", "diagnostics"].includes(view)) {
    for (const key of ["diagnosis", "question", "answer", "metric"]) {
      const value = current.get(key);
      if (value) next.set(key, value);
    }
  }
  return `/?${next.toString()}`;
}
