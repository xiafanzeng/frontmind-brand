import type { BrandPage } from "../module/client/ModuleWorkspace";

export type StandaloneBrandPage = BrandPage;

export const standaloneBrandPages: Array<[StandaloneBrandPage, string]> = [
  ["reports", "品牌诊断报告"],
  ["knowledge", "智能知识库"],
  ["keywords", "全域词库优化"],
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
  const canonical = legacyPageAliases[value] ?? value;
  return standaloneBrandPages.some(([id]) => id === canonical)
    ? (canonical as StandaloneBrandPage)
    : null;
}
