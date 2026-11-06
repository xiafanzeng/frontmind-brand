import type { BrandPage } from "../module/client/ModuleWorkspace";
import type { RagReportSection } from "../module/client/dashboard/ai-website-preview/rag-report-navigation";
import type { EnterpriseRagEvaluationCoordinate } from "../module/client/dashboard/enterprise-rag-evaluation-api";

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

export function standaloneRagReportUrl(section: RagReportSection, workspaceId: string, coordinate?: EnterpriseRagEvaluationCoordinate) {
  const params = new URLSearchParams({ view: "enterprise-qa", report: "1", workspace: workspaceId });
  if (coordinate) {
    params.set("sourceQaTaskId", coordinate.sourceQaTaskId);
    params.set("turnId", coordinate.turnId);
  }
  return `/?${params.toString()}#${section}`;
}

export function resolveStandaloneRagReport(search: string, workspaceId: string) {
  const params = new URLSearchParams(search);
  if (resolveStandaloneBrandPage(params.get("view") ?? "") !== "enterprise-qa" || params.get("report") !== "1") return null;
  const expectedWorkspace = params.get("workspace");
  const task = params.get("sourceQaTaskId");
  const turn = params.get("turnId");
  const validId = (value: string | null): value is string => Boolean(value && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value));
  const coordinate = validId(task) && validId(turn) ? { sourceQaTaskId: task, turnId: turn } : undefined;
  return {
    coordinate,
    error: expectedWorkspace && expectedWorkspace !== workspaceId
      ? "报告链接与当前工作区不一致。请回到对应工作区重新打开，避免查看其他工作区的记录。"
      : (task !== null || turn !== null) && !coordinate
        ? "回答标识不完整或无效。请从企业 RAG 页面重新打开评估记录。"
        : null,
  };
}
