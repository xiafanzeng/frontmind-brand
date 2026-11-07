import { useBusinessFlowState, readFlowString } from "./useBusinessFlowState";
import {
  keywordPickerRows,
  type KeywordSelection,
} from "./workflow/KeywordPicker";
import { ChevronRight, Database, Search, X } from "lucide-react";
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
import type {IntentState} from "../../contracts/intent-workbench";
import {findCatalogQuestion} from "./intent-catalog-link";

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

export type ManagedKeywordQuestionSelection = {
  question: string;
  category: KeywordCategoryKey;
  tableId: string;
  rowIndex: number;
  dashboardRevision?: number;
  workbenchTaskId?: string;
};

export type ManagedKeywordTablesProps = {
  tables: ManagedKeywordTable[];
  loading?: boolean;
  error?: unknown;
  onUseQuestion?: (question: ManagedKeywordQuestionSelection) => void | Promise<void>;
  /** Optional batch intake; existing host-owned single selection stays compatible. */
  onUseQuestions?: (questions: Array<{
    question: string; category: KeywordCategoryKey; tableId: string;
    rowIndex: number; dashboardRevision?: number;
  }>) => void | Promise<void>;
  onOptimizationSavingChange?: (saving: boolean) => void;
  quotaAvailability?: ManagedKeywordQuotaAvailability;
  generationEnabled?: boolean;
  dashboardRevision?: number | null;
  knowledgePublished?: boolean;
  /** A host-owned import dialog can preserve the highlighted source row. */
  selectedKeyword?: { tableId: string; rowIndex: number } | null;
  optimizationState?: IntentState;
  onViewEvaluation?: (questionId: string) => void;
  onViewEvaluationTask?: (jobId: string) => void;
  onEvaluateQuestion?: (question: ManagedKeywordQuestionSelection) => void;
  evaluationPending?: boolean;
  evaluationPendingKeyword?: Pick<ManagedKeywordQuestionSelection, "tableId" | "rowIndex"> | null;
};

const KEYWORD_SOURCE_DESCRIPTION =
  "已保存的推荐问题与历史词库统一展示，可加入优化清单或查看已有评估。";

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
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel global-keyword-panel">
      {(title || actions) && <div className="panel-head">
        {title && <h3>{safeText(title)}</h3>}
        <div className="panel-actions">{actions}</div>
      </div>}
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
  onOptimizationSavingChange,
  quotaAvailability,
  generationEnabled = false,
  dashboardRevision,
  knowledgePublished,
  selectedKeyword,
  optimizationState,
  onViewEvaluation,
  onViewEvaluationTask,
  onEvaluateQuestion,
  evaluationPending = false,
  evaluationPendingKeyword,
}: ManagedKeywordTablesProps) {
  const { isWorkbench } = useBusinessWorkspace();
  const utils = trpc.useUtils();
  const [sourceView,setSourceView]=useState<"recommended"|"saved">(generationEnabled?"recommended":"saved");
  const sourceTables = tables;
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
  function openSource(source: "recommended" | "saved") {
    setSourceView(source); setTableFilter("all"); setCategoryFilter("all");
    setSubdivisionFilter("all"); setSearchTerm(""); setPages({});
  }
  useEffect(
    () => setPages({}),
    [searchTerm, tableFilter, categoryFilter, subdivisionFilter],
  );
  const hasKeywordCategories = useMemo(
    () =>
      sourceTables.some((table) => {
        const categoryColumnIndex = keywordCategoryColumnIndex(table.columns);
        return (
          categoryColumnIndex >= 0 &&
          table.rows.some((row) =>
            Boolean(keywordCategoryKey(row[categoryColumnIndex])),
          )
        );
      }),
    [sourceTables],
  );
  const subdivisionOptions = useMemo(
    () =>
      [
        ...new Set(
          sourceTables.flatMap((table) => {
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
    [sourceTables],
  );
  const visibleTables = useMemo(() => {
    const selectedTables =
      tableFilter === "all"
        ? sourceTables
        : sourceTables.filter((table) => table.id === tableFilter);
    return selectedTables
      .map((table) => {
        const categoryColumnIndex = keywordCategoryColumnIndex(table.columns);
        const subdivisionColumnIndex = questionSubdivisionColumnIndex(
          table.columns,
        );
        const displayColumns = keywordDisplayColumns(table.columns);
        const rows = table.rows
          .map((row, rowIndex) => ({ row, rowIndex, sourceTableId: table.id }))
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
  }, [categoryFilter, keyword, subdivisionFilter, tableFilter, sourceTables]);
  // Present one customer-facing table while preserving each row's durable source identity.
  const displayTables = useMemo(() => {
    if (!generationEnabled) return visibleTables;
    const columns = ["问题", "主分类", "问题细分"];
    const rows = [...visibleTables].reverse().flatMap(table => {
      const questionIndex = questionColumnIndex(table.columns);
      const categoryIndex = keywordCategoryColumnIndex(table.columns);
      const subdivisionIndex = questionSubdivisionColumnIndex(table.columns);
      return table.rows.map(({row, rowIndex, sourceTableId}) => ({
        row: [row[questionIndex], row[categoryIndex], subdivisionIndex < 0 ? "—" : row[subdivisionIndex] || "—"],
        rowIndex, sourceTableId,
      }));
    });
    return rows.length ? [{id: "saved-keywords", title: "已保存词条", columns,
      displayColumns: keywordDisplayColumns(columns), rows}] : [];
  }, [generationEnabled, visibleTables]);
  const totalRows = useMemo(
    () => tables.reduce((total, table) => total + table.rows.length, 0),
    [tables],
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
        <nav className="qt-source-tabs" aria-label="词条来源">
          <button type="button" aria-pressed={sourceView==="recommended"} onClick={()=>openSource("recommended")}>生成新词条</button>
          <button type="button" aria-pressed={sourceView==="saved"} onClick={()=>openSource("saved")}>已保存词条 <b>{totalRows}</b></button>
        </nav>
      )}
      {generationEnabled && (
        <div hidden={sourceView!=="recommended"}><QuestionTemplateApiFlow onSaved={() => utils.workspace.dashboard.invalidate()} onOptimizationSavingChange={onOptimizationSavingChange} onOptimize={onUseQuestions ?? (onUseQuestion ? items => {if(items[0])return onUseQuestion(items[0]);} : undefined)} /></div>
      )}
      {(!generationEnabled || sourceView!=="recommended") && (sourceTables.length === 0 ? (
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
        ) : <KeywordEmptyPanel title="尚未保存词条" description="先生成推荐问题并勾选保存，即可在这里查看。"/>
      ) : (
        <>
          {onUseQuestions && batchItems.length > 0 && (
            <div className="keyword-batch-actions" role="status">
              <div><button type="button" onClick={() => setBatchSelection({})}>清空选择</button>
              <button type="button" className="iw-primary" onClick={() => onUseQuestions(batchItems)}>批量加入优化清单（{batchItems.length}）</button></div>
            </div>
          )}
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
            {(sourceTables.length > 1 ||
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
                {sourceTables.length > 1 && (
                  <div className="filter-item">
                    <label htmlFor="managed-keyword-table">词表</label>
                    <select
                      id="managed-keyword-table"
                      value={tableFilter}
                      onChange={(event) => setTableFilter(event.target.value)}
                    >
                      <option value="all">全部词表</option>
                      {sourceTables.map((table) => (
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
          <div className="saas-content-area">
            {displayTables.map((table) => {
              const tableQuestionColumnIndex = questionColumnIndex(
                table.columns,
              );
              const tableCategoryColumnIndex = keywordCategoryColumnIndex(
                table.columns,
              );
              const pageCount = Math.max(1, Math.ceil(table.rows.length / 20));
              const page = Math.min(pages[table.id] ?? 0, pageCount - 1);
              const paginate = isWorkbench || Boolean(onUseQuestions);
              const rows = paginate
                ? table.rows.slice(page * 20, (page + 1) * 20)
                : table.rows;
              return (
                <KeywordPanel
                  title={generationEnabled ? undefined : table.title}
                  key={table.id}
                >
                  <div className="keyword-table-wrap">
                    <table className="keyword-table">
                      <thead>
                        <tr>
                          {onUseQuestions && <th className="keyword-selection-cell">选择</th>}
                          {table.displayColumns.map(
                            ({ column, columnIndex }) => (
                              <th key={`${column}-${columnIndex}`}>
                                {isKeywordCategoryColumn(column)
                                  ? "主分类"
                                  : safeText(column)}
                              </th>
                            ),
                          )}
                          {onUseQuestions && <th className="keyword-evaluation-cell">评估</th>}
                          {onUseQuestion && !onUseQuestions && <th>问题优化</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ row, rowIndex, sourceTableId }) => {
                          const question = safeText(
                            row[tableQuestionColumnIndex],
                          );
                          const category = keywordCategoryKey(
                            row[tableCategoryColumnIndex],
                          );
                          const quotaAccess = category
                            ? quotaAvailability?.[category]
                            : undefined;
                          const linked = optimizationState ? findCatalogQuestion({question, tableId: sourceTableId, rowIndex}, optimizationState.questions) : undefined;
                          const evaluation = linked ? optimizationState?.evaluations.find(item => item.questionId === linked.id) : undefined;
                          const evaluationJob = optimizationState?.jobs?.find(job => !["succeeded", "failed"].includes(job.status));
                          const evaluating = linked && evaluationJob?.kind === "evaluate" && evaluationJob.questionIds.includes(linked.id);
                          const submittingEvaluation = evaluationPending && evaluationPendingKeyword?.tableId === sourceTableId &&
                            evaluationPendingKeyword.rowIndex === rowIndex;
                          const selectionKey = `${sourceTableId}:${rowIndex}`;
                          const isSelected = Boolean(batchSelection[selectionKey]);
                          const selectionDisabled = (isWorkbench && dashboardRevision == null) || !question || !category || quotaAccess?.available === false;
                          const toggleSelection = () => {
                            if (selectionDisabled || !category) return;
                            setBatchSelection(current => {
                              const next = {...current};
                              if (next[selectionKey]) delete next[selectionKey];
                              else next[selectionKey] = {question, category, tableId: sourceTableId, rowIndex, ...(dashboardRevision != null ? {dashboardRevision} : {})};
                              return next;
                            });
                          };
                          return (
                            <tr
                              key={`${sourceTableId}-${rowIndex}`}
                              className={onUseQuestions ? `keyword-row-selectable${isSelected ? " keyword-row-selected" : ""}${selectionDisabled ? " keyword-row-disabled" : ""}` : undefined}
                              aria-selected={onUseQuestions ? isSelected : isWorkbench ? selectedKeyword?.tableId === sourceTableId && selectedKeyword.rowIndex === rowIndex : undefined}
                              tabIndex={onUseQuestions && !selectionDisabled ? 0 : undefined}
                              onClick={onUseQuestions ? event => {
                                if ((event.target as HTMLElement).closest("button, input, label, a, select, textarea, [role=button]")) return;
                                toggleSelection();
                              } : undefined}
                              onKeyDown={onUseQuestions ? event => {
                                if (event.target !== event.currentTarget || (event.key !== " " && event.key !== "Enter")) return;
                                event.preventDefault();
                                toggleSelection();
                              } : undefined}
                            >
                              {onUseQuestions && <td className="keyword-selection-cell">
                                <label className="keyword-selection-label"><input type="checkbox" aria-label={`选择${question}`}
                                  checked={isSelected}
                                  disabled={selectionDisabled}
                                  onChange={toggleSelection}/></label>

                              </td>}
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
                                      key={`${sourceTableId}-${rowIndex}-${columnIndex}`}
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
                              {onUseQuestions && <td className="keyword-evaluation-cell">
                                {evaluating && evaluationJob && onViewEvaluationTask ? <button type="button" className="keyword-evaluation-button"
                                  aria-label={`查看评估详情：${question}`} title="查看当前评估任务的进度"
                                  onClick={() => onViewEvaluationTask(evaluationJob.id)}>
                                  <span>{evaluationJob.status === "paused" ? "评估已暂停" : evaluationJob.status === "pausing" ? "正在暂停" : evaluationJob.status === "resuming" ? "正在继续" : "评估中"} · 查看详情</span>
                                  <ChevronRight size={14} aria-hidden="true"/>
                                </button> : evaluation && linked && onViewEvaluation ? <button type="button" className="keyword-evaluation-button" aria-label={`查看评估：${question}`} title="查看完整评估" onClick={() => onViewEvaluation(linked.id)}>
                                  <span className="keyword-evaluation-metric"><span>价值</span><strong>{evaluation.value}</strong></span>
                                  <span className="keyword-evaluation-divider" aria-hidden="true"/>
                                  <span className="keyword-evaluation-metric"><span>支撑</span><strong>{evaluation.support}</strong></span>
                                  <ChevronRight size={14} aria-hidden="true"/>
                                </button> : optimizationState && onEvaluateQuestion ? <button type="button" className="keyword-evaluation-button keyword-evaluation-start"
                                  aria-label={`评估问题：${question}`}
                                  title={evaluationJob ? "请先完成当前评估任务" : submittingEvaluation ? "正在提交当前词条的评估" : evaluationPending ? "请等待当前操作完成后再评估" : "评估当前词条"}
                                  disabled={selectionDisabled || evaluationPending || Boolean(evaluationJob)}
                                  onClick={() => {
                                    if (!category) return;
                                    onEvaluateQuestion({question, category, tableId: sourceTableId, rowIndex, ...(dashboardRevision != null ? {dashboardRevision} : {})});
                                  }}>
                                  <span>{evaluating ? evaluationJob?.status === "paused" ? "评估已暂停" : "评估中…" : submittingEvaluation ? "正在处理…" : "评估问题"}</span>
                                  <ChevronRight size={14} aria-hidden="true"/>
                                </button> :
                                  <small>{!optimizationState ? "优化状态尚未读取" : linked ? "已在优化清单 · 待评估" : "尚未加入优化"}</small>}
                              </td>}
                              {onUseQuestion && !onUseQuestions && (
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
                                        tableId: sourceTableId,
                                        rowIndex,
                                      };
                                      const item = {...selection, ...(dashboardRevision != null ? {dashboardRevision} : {})};
                                      if (onUseQuestions) {
                                        const key = `${sourceTableId}:${rowIndex}`;
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
                                      : onUseQuestions && batchSelection[`${sourceTableId}:${rowIndex}`] ? "已选择 ✓" : "选择词条"}
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {paginate && pageCount > 1 && (
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
            {displayTables.length === 0 && (
              <KeywordEmptyPanel
                title="没有匹配的词库内容"
                description="请调整搜索词或筛选条件后重试。"
              />
            )}
          </div>
        </>
      ))}
    </section>
  );
}
