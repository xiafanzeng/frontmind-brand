import { useBusinessFlowState, readFlowString } from "./useBusinessFlowState";
import {
  keywordPickerRows,
  type KeywordSelection,
} from "./workflow/KeywordPicker";
import { Database, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useBusinessWorkspace,
  useBusinessWorkspaceSummary,
} from "./BusinessWorkspaceContext";
import "./business-module-flows.css";
import "./managed-keyword-tables.css";
import {
  KEYWORD_CATEGORY_OPTIONS,
  isKeywordCategoryColumn,
  keywordCategoryColumnIndex,
  keywordCategoryKey,
  keywordCategoryLabel,
  keywordTableDisplayText as safeText,
  type KeywordCategoryKey,
} from "@frontmind/module-ui/keyword-categories";
import { trpc } from "../api-hooks";
import QuestionTemplateApiFlow from "./QuestionTemplateApiFlow";

export type ManagedKeywordTable = {
  id: string;
  title: string;
  description?: string | null;
  columns: string[];
  rows: unknown[][];
};

export type ManagedKeywordQuotaAvailability = Partial<
  Record<
    KeywordCategoryKey,
    {
      available: boolean;
      unavailableLabel?: string;
    }
  >
>;

export type ManagedKeywordTablesProps = {
  tables: ManagedKeywordTable[];
  loading?: boolean;
  error?: unknown;
  onUseQuestion?: (question: {
    question: string;
    category: KeywordCategoryKey;
    tableId: string;
    rowIndex: number;
    dashboardRevision?: number;
    workbenchTaskId?: string;
  }) => void;
  /** Optional batch intake; existing host-owned single selection stays compatible. */
  onUseQuestions?: (questions: Array<{
    question: string; category: KeywordCategoryKey; tableId: string;
    rowIndex: number; dashboardRevision?: number;
  }>) => void;
  quotaAvailability?: ManagedKeywordQuotaAvailability;
  generationEnabled?: boolean;
  dashboardRevision?: number | null;
  knowledgePublished?: boolean;
  /** A host-owned import dialog can preserve the highlighted source row. */
  selectedKeyword?: { tableId: string; rowIndex: number } | null;
};

const KEYWORD_SOURCE_DESCRIPTION =
  "全域词库汇总已保存的问题。上方可推荐并保存新问题，下方可筛选已有问题并导入优化工作台。";

function normalizedColumnName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
}

function isHiddenCustomerColumn(value: unknown) {
  const column = normalizedColumnName(value);
  return (
    column === "序号" ||
    column === "核心词" ||
    column === "创建日期" ||
    column.includes("热度")
  );
}

function questionColumnIndex(columns: readonly unknown[]) {
  return columns.findIndex((column) => normalizedColumnName(column) === "问题");
}

function formatNumber(value: unknown) {
  const parsed = Number(String(value ?? 0).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("zh-CN") : "";
}

function questionSubdivisionColumnIndex(columns: readonly unknown[]) {
  return columns.findIndex(
    (column) => normalizedColumnName(column) === "问题细分",
  );
}

function keywordDisplayColumns(columns: readonly string[]) {
  return columns
    .map((column, columnIndex) => ({ column, columnIndex }))
    .filter(({ column }) => !isHiddenCustomerColumn(column));
}

function KeywordPageHeader({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">{safeText(eyebrow)}</span>
          <h2>{safeText(title)}</h2>
          <p>{safeText(desc)}</p>
        </div>
        {actions}
      </div>
    </header>
  );
}

function KeywordEmptyPanel({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  const { isWorkbench } = useBusinessWorkspace();
  if (isWorkbench) {
    return (
      <section className="keyword-start-step">
        <h2>{safeText(title)}</h2>
        <p>{safeText(description)}</p>
        {actions}
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{safeText(title)}</h3>
      </div>
      <div className="empty-state">
        <Database size={24} />
        <p>{safeText(description)}</p>
        {actions}
      </div>
    </section>
  );
}

/** Legacy host imports remain compatible without offering a generation action. */
export function BrandQuestionUniverseGenerationControl(_props: {knowledgePublished?: boolean;presentation?: "empty" | "catalog"}) {return null;}
export function BrandQuestionUniverseGenerationAction(_props: {disabled: boolean;status: string;onStart: () => void;label?: string}) {return null;}

function KeywordPanel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="panel global-keyword-panel">
      <div className="panel-head">
        <h3>{safeText(title)}</h3>
        <div className="panel-actions">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export default function ManagedKeywordTables({
  tables,
  loading = false,
  error,
  onUseQuestion,
  onUseQuestions,
  quotaAvailability,
  generationEnabled = false,
  dashboardRevision,
  knowledgePublished,
  selectedKeyword,
}: ManagedKeywordTablesProps) {
  const { isWorkbench } = useBusinessWorkspace();
  const utils = trpc.useUtils();
  // The confirmation modal is pure ephemeral UI state: it must stay closed on
  // first entry, refresh, navigation and project switches, and open only from
  // an explicit 选择词条 click. Filters below remain persisted flow state.
  const [pages, setPages] = useState<Record<string, number>>({});
  const [batchSelection, setBatchSelection] = useState<Record<string, {
    question: string; category: KeywordCategoryKey; tableId: string;
    rowIndex: number; dashboardRevision?: number;
  }>>({});
  const batchItems = Object.values(batchSelection);
  useEffect(() => setBatchSelection({}), [dashboardRevision]);
  const [searchTerm, setSearchTerm] = useBusinessFlowState(
    "keywordSearch",
    "",
    readFlowString,
  );
  const [tableFilter, setTableFilter] = useBusinessFlowState(
    "keywordTable",
    "all",
    readFlowString,
  );
  const [categoryFilter, setCategoryFilter] = useBusinessFlowState(
    "keywordCategory",
    "all",
    readFlowString,
  );
  const [subdivisionFilter, setSubdivisionFilter] = useBusinessFlowState(
    "keywordSubdivision",
    "all",
    readFlowString,
  );
  const keyword = searchTerm.trim().toLowerCase();
  useEffect(
    () => setPages({}),
    [searchTerm, tableFilter, categoryFilter, subdivisionFilter],
  );
  const hasKeywordCategories = useMemo(
    () =>
      tables.some((table) => {
        const categoryColumnIndex = keywordCategoryColumnIndex(table.columns);
        return (
          categoryColumnIndex >= 0 &&
          table.rows.some((row) =>
            Boolean(keywordCategoryKey(row[categoryColumnIndex])),
          )
        );
      }),
    [tables],
  );
  const subdivisionOptions = useMemo(
    () =>
      [
        ...new Set(
          tables.flatMap((table) => {
            const subdivisionIndex = questionSubdivisionColumnIndex(
              table.columns,
            );
            return subdivisionIndex < 0
              ? []
              : table.rows
                  .map((row) => safeText(row[subdivisionIndex]))
                  .filter(Boolean);
          }),
        ),
      ].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [tables],
  );
  const visibleTables = useMemo(() => {
    const selectedTables =
      tableFilter === "all"
        ? tables
        : tables.filter((table) => table.id === tableFilter);
    return selectedTables
      .map((table) => {
        const categoryColumnIndex = keywordCategoryColumnIndex(table.columns);
        const subdivisionColumnIndex = questionSubdivisionColumnIndex(
          table.columns,
        );
        const displayColumns = keywordDisplayColumns(table.columns);
        const rows = table.rows
          .map((row, rowIndex) => ({ row, rowIndex }))
          .filter(({ row }) => {
            if (
              categoryFilter !== "all" &&
              (categoryColumnIndex < 0 ||
                keywordCategoryKey(row[categoryColumnIndex]) !== categoryFilter)
            ) {
              return false;
            }
            if (
              subdivisionFilter !== "all" &&
              (subdivisionColumnIndex < 0 ||
                safeText(row[subdivisionColumnIndex]) !== subdivisionFilter)
            ) {
              return false;
            }
            if (!keyword) return true;
            return displayColumns.some(({ columnIndex }) => {
              const cell = row[columnIndex];
              const text = String(cell).toLowerCase();
              const mappedCategory =
                columnIndex === categoryColumnIndex
                  ? keywordCategoryLabel(cell)?.toLowerCase()
                  : null;
              return (
                text.includes(keyword) ||
                Boolean(mappedCategory?.includes(keyword))
              );
            });
          });
        return { ...table, rows, displayColumns };
      })
      .filter(
        (table) =>
          (!keyword &&
            categoryFilter === "all" &&
            subdivisionFilter === "all") ||
          table.rows.length > 0,
      );
  }, [categoryFilter, keyword, subdivisionFilter, tableFilter, tables]);
  const totalRows = useMemo(
    () => tables.reduce((total, table) => total + table.rows.length, 0),
    [tables],
  );
  const visibleRows = useMemo(
    () => visibleTables.reduce((total, table) => total + table.rows.length, 0),
    [visibleTables],
  );

  useBusinessWorkspaceSummary({
    title: "项目词库",
    scope: "project",
    items: tables.length
      ? [
          {
            label: "当前生效词库",
            value: `${totalRows} 条问题`,
          },
        ]
      : [],
  });
  return (
    <section
      className={`page-shell brand-deep-page brand-keyword-workspace ${isWorkbench ? "keyword-conversation-flow" : ""}`}
    >
      {!isWorkbench && (
        <KeywordPageHeader
          eyebrow="MindPromise智诺 / 品牌建设"
          title="品牌全域词库"
          desc={KEYWORD_SOURCE_DESCRIPTION}
        />
      )}
      {generationEnabled && (
        <QuestionTemplateApiFlow onSaved={() => utils.workspace.dashboard.invalidate()} />
      )}
      {tables.length === 0 ? (
        loading ? (
          <KeywordEmptyPanel
            title="正在载入品牌全域词库"
            description="正在载入当前企业的词库数据。"
          />
        ) : error ? (
          <KeywordEmptyPanel
            title="品牌全域词库暂时无法载入"
            description="请稍后刷新页面重试。"
          />
        ) : !generationEnabled ? (
          <KeywordEmptyPanel
            title="品牌全域词库正在准备中"
            description="内容发布后会自动显示在这里。"
          />
        ) : null
      ) : (
        <>
          <div className="saas-toolbar keyword-toolbar-saas">
            <div className="saas-search">
              <Search size={16} />
              <input
                type="search"
                placeholder="搜索问题、主分类或问题细分..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="clear-btn"
                  aria-label="清空搜索"
                  onClick={() => setSearchTerm("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {(tables.length > 1 ||
              hasKeywordCategories ||
              subdivisionOptions.length > 0) && (
              <div className="filter-group">
                {hasKeywordCategories && (
                  <div className="filter-item">
                    <label htmlFor="managed-keyword-category">主分类</label>
                    <select
                      id="managed-keyword-category"
                      value={categoryFilter}
                      onChange={(event) =>
                        setCategoryFilter(event.target.value)
                      }
                    >
                      <option value="all">全部主分类</option>
                      {KEYWORD_CATEGORY_OPTIONS.map((category) => (
                        <option key={category.key} value={category.key}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {subdivisionOptions.length > 0 && (
                  <div className="filter-item">
                    <label htmlFor="managed-keyword-subdivision">
                      问题细分
                    </label>
                    <select
                      id="managed-keyword-subdivision"
                      value={subdivisionFilter}
                      onChange={(event) =>
                        setSubdivisionFilter(event.target.value)
                      }
                    >
                      <option value="all">全部问题细分</option>
                      {subdivisionOptions.map((subdivision) => (
                        <option key={subdivision} value={subdivision}>
                          {subdivision}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {tables.length > 1 && (
                  <div className="filter-item">
                    <label htmlFor="managed-keyword-table">词表</label>
                    <select
                      id="managed-keyword-table"
                      value={tableFilter}
                      onChange={(event) => setTableFilter(event.target.value)}
                    >
                      <option value="all">全部词表</option>
                      {tables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {safeText(table.title)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="keyword-stats-bar">
            <span>
              共 <strong>{formatNumber(totalRows)}</strong> 条词库记录
            </span>
            <span>
              当前显示 <strong>{formatNumber(visibleRows)}</strong> 条
            </span>
          </div>
          <div className="saas-content-area">
            {visibleTables.map((table) => {
              const tableQuestionColumnIndex = questionColumnIndex(
                table.columns,
              );
              const tableCategoryColumnIndex = keywordCategoryColumnIndex(
                table.columns,
              );
              const pageCount = Math.max(1, Math.ceil(table.rows.length / 20));
              const page = Math.min(pages[table.id] ?? 0, pageCount - 1);
              const rows = isWorkbench
                ? table.rows.slice(page * 20, (page + 1) * 20)
                : table.rows;
              return (
                <KeywordPanel
                  title={tables.length === 1 ? "全域词库" : table.title}
                  key={table.id}
                  actions={
                    <span className="entity-count">
                      {formatNumber(table.rows.length)} 条
                    </span>
                  }
                >
                  <div className="keyword-table-wrap">
                    <table className="keyword-table">
                      <thead>
                        <tr>
                          {table.displayColumns.map(
                            ({ column, columnIndex }) => (
                              <th key={`${column}-${columnIndex}`}>
                                {isKeywordCategoryColumn(column)
                                  ? "主分类"
                                  : safeText(column)}
                              </th>
                            ),
                          )}
                          {onUseQuestion && (
                            <th>{onUseQuestions ? "选择词条" : "问题优化"}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ row, rowIndex }) => {
                          const question = safeText(
                            row[tableQuestionColumnIndex],
                          );
                          const category = keywordCategoryKey(
                            row[tableCategoryColumnIndex],
                          );
                          const quotaAccess = category
                            ? quotaAvailability?.[category]
                            : undefined;
                          return (
                            <tr
                              key={`${table.id}-${rowIndex}`}
                              className={onUseQuestions && batchSelection[`${table.id}:${rowIndex}`] ? "keyword-row-selected" : undefined}
                              aria-selected={isWorkbench ? selectedKeyword?.tableId === table.id && selectedKeyword.rowIndex === rowIndex : undefined}
                            >
                              {table.displayColumns.map(
                                ({ column, columnIndex }) => {
                                  const normalizedColumn =
                                    normalizedColumnName(column);
                                  const value = safeText(row[columnIndex]);
                                  const isCategory =
                                    isKeywordCategoryColumn(column);
                                  const displayValue = isKeywordCategoryColumn(
                                    column,
                                  )
                                    ? keywordCategoryLabel(value) || value
                                    : value;
                                  const isPriority =
                                    normalizedColumn.includes("优先级");
                                  const priorityTone = value.includes("高")
                                    ? "high"
                                    : value.includes("重点") ||
                                        value.includes("中")
                                      ? "mid"
                                      : "low";
                                  return (
                                    <td
                                      key={`${table.id}-${rowIndex}-${columnIndex}`}
                                      className={
                                        normalizedColumn === "问题"
                                          ? "keyword-question-cell"
                                          : undefined
                                      }
                                    >
                                      {isCategory ? (
                                        <span
                                          className="keyword-pill fm-question-category-pill"
                                          data-category={category || undefined}
                                        >
                                          {displayValue}
                                        </span>
                                      ) : isPriority ? (
                                        <span
                                          className={`priority-pill priority-${priorityTone}`}
                                        >
                                          {displayValue}
                                        </span>
                                      ) : (
                                        displayValue
                                      )}
                                    </td>
                                  );
                                },
                              )}
                              {onUseQuestion && (
                                <td>
                                  <button
                                    type="button"
                                    className="operator-secondary-button keyword-action-button disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={
                                      (isWorkbench &&
                                        dashboardRevision == null) ||
                                      !question ||
                                      !category ||
                                      quotaAccess?.available === false
                                    }
                                    onClick={() => {
                                      if (!category) return;
                                      const selection = {
                                        question,
                                        category,
                                        tableId: table.id,
                                        rowIndex,
                                      };
                                      const item = {...selection, ...(dashboardRevision != null ? {dashboardRevision} : {})};
                                      if (onUseQuestions) {
                                        const key = `${table.id}:${rowIndex}`;
                                        setBatchSelection(current => {
                                          const next = {...current};
                                          if (next[key]) delete next[key]; else next[key] = item;
                                          return next;
                                        });
                                      } else onUseQuestion?.(item);
                                    }}
                                  >
                                    {quotaAccess?.available === false
                                      ? quotaAccess.unavailableLabel ||
                                        "该类额度已满"
                                      : onUseQuestions && batchSelection[`${table.id}:${rowIndex}`] ? "已选择 ✓" : "选择词条"}
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {isWorkbench && pageCount > 1 && (
                    <nav
                      className="business-flow-pagination"
                      aria-label={`${table.title}分页`}
                    >
                      <span>
                        {page + 1} / {pageCount} 页
                      </span>
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() =>
                          setPages((value) => ({
                            ...value,
                            [table.id]: page - 1,
                          }))
                        }
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        disabled={page + 1 >= pageCount}
                        onClick={() =>
                          setPages((value) => ({
                            ...value,
                            [table.id]: page + 1,
                          }))
                        }
                      >
                        下一页
                      </button>
                    </nav>
                  )}
                </KeywordPanel>
              );
            })}
            {visibleTables.length === 0 && (
              <KeywordEmptyPanel
                title="没有匹配的词库内容"
                description="请调整搜索词或筛选条件后重试。"
              />
            )}
          </div>
          {onUseQuestions && batchItems.length > 0 && (
            <div className="iw-sticky">
              <span>已选择 <strong>{batchItems.length}</strong> 条问题 · 支持跨筛选连续选择</span>
              <div><button type="button" onClick={() => setBatchSelection({})}>清空选择</button>
              <button type="button" className="iw-primary" onClick={() => onUseQuestions(batchItems)}>批量加入优化清单（{batchItems.length}）</button></div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
