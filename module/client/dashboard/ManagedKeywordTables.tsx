import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { BusinessExecutionActivity } from "../components/BusinessExecutionActivity";
import { useBusinessFlowState, readFlowString } from "./useBusinessFlowState";
import {
  keywordPickerRows,
  type KeywordSelection,
} from "./workflow/KeywordPicker";
import { Database, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { projectWorkspaceUrl } from "../host";
import { requestWorkspaceNavigation } from "../host";
import { navigate } from "wouter/use-browser-location";

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
  quotaAvailability?: ManagedKeywordQuotaAvailability;
  generationEnabled?: boolean;
  dashboardRevision?: number | null;
  knowledgePublished?: boolean;
  /** A host-owned import dialog can preserve the highlighted source row. */
  selectedKeyword?: { tableId: string; rowIndex: number } | null;
};

const KEYWORD_SOURCE_DESCRIPTION =
  "基于百度营销、小红书蒲公英、抖音巨量指数等平台数据综合整理 GEO 优化问题，支持按主分类与问题细分筛选。";

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

function brandQuestionUniverseStatus(
  observation:
    | {
        reason: string;
        operation: {
          status: string;
          repairAttempts: number;
          publicationOutcome: string | null;
        } | null;
      }
    | undefined,
) {
  if (!observation) return "正在检查抓取条件…";
  const operation = observation.operation;
  if (operation?.status === "queued") return "任务已排队，正在上传安全知识包。";
  if (operation?.status === "running") {
    return operation.repairAttempts > 0
      ? `正在修复并校验结果（${operation.repairAttempts}/3）。`
      : "正在抓取并生成 160 条品牌问题。";
  }
  if (operation?.status === "result_pending")
    return "结果已返回，正在校验和发布。";
  if (operation?.status === "succeeded") {
    if (operation.publicationOutcome === "engineer_won") {
      return "工程师正式版本已生效，自动结果未覆盖。";
    }
    if (operation.publicationOutcome === "newer_auto_won") {
      return "更新的自动版本已生效，本次结果未覆盖。";
    }
    if (operation.publicationOutcome === "snapshot_superseded") {
      return "知识库已更新，本次结果未发布；可重新抓取。";
    }
    return "品牌全域词库已生成并发布。";
  }
  if (operation?.status === "failed") return "本次抓取未完成，请重试。";
  if (operation?.status === "attention_required") {
    return "任务需要人工检查，请联系 FrontMind 支持。";
  }
  if (observation.reason === "knowledge_required")
    return "请先完成并发布当前认证知识库。";
  if (observation.reason === "safe_knowledge_required")
    return "当前认证知识库没有可用于词库生成的公开内容。";
  if (observation.reason === "knowledge_scope_exceeded")
    return "当前知识库超过自动处理范围，请联系 FrontMind 协助。";
  if (observation.reason === "credential_required")
    return "自动生成服务尚未就绪，请联系 FrontMind。";
  if (observation.reason === "engineer_version")
    return "工程师正式版本已发布，自动抓取已停用。";
  if (observation.reason === "operation_active")
    return "品牌全域词库正在抓取。";
  return "已就绪，可基于当前知识库抓取品牌全域词库。";
}

export function BrandQuestionUniverseGenerationControl({
  knowledgePublished,
  presentation = "empty",
}: {
  knowledgePublished?: boolean;
  presentation?: "empty" | "catalog";
}) {
  const { isWorkbench, task } = useBusinessWorkspace();
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);
  const [readTimedOut, setReadTimedOut] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const inFlight = useRef(false);
  const utils = trpc.useUtils();
  const observation = trpc.workspace.brandQuestionUniverse.observe.useQuery(
    undefined,
    {
      enabled: knowledgePublished !== false,
      retry: false,
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
      trpc: { abortOnUnmount: true },
    },
  );
  const start = trpc.workspace.brandQuestionUniverse.start.useMutation();
  const [submitted, setSubmitted] = useState<typeof observation.data>();
  const generationIntent = useRef<{
    fingerprint: string;
    clientRequestId: string;
  } | null>(null);
  const refreshedRun = useRef<string | null>(null);
  const data = observation.data;
  // Existing catalog visits show eligibility only. A new click owns the process
  // below its action; unrelated or old observations cannot replace that run.
  const current = submitted?.execution?.runId
    ? data?.execution?.runId === submitted.execution.runId
      ? data
      : submitted
    : undefined;
  useEffect(() => {
    setReadTimedOut(false);
    if (knowledgePublished === false || data || observation.error) return;
    const timeout = window.setTimeout(() => setReadTimedOut(true), 12_000);
    return () => window.clearTimeout(timeout);
  }, [knowledgePublished, data, observation.error, readAttempt]);
  useEffect(() => {
    const runId = current?.execution?.runId;
    if (
      !runId ||
      current.operation?.status !== "succeeded" ||
      refreshedRun.current === runId
    )
      return;
    refreshedRun.current = runId;
    void utils.workspace.dashboard.invalidate();
  }, [current, utils]);
  const openKnowledge = () =>
    requestWorkspaceNavigation(() =>
      navigate(projectWorkspaceUrl("/?view=knowledge")),
    );
  const knowledgeAction = (
    <button
      type="button"
      className="operator-secondary-button keyword-action-button"
      onClick={openKnowledge}
    >
      前往智能知识库
    </button>
  );
  const retryRead = () =>
    void (async () => {
      setBindingError(null);
      setReadTimedOut(false);
      setReadAttempt((value) => value + 1);
      try {
        await utils.workspace.brandQuestionUniverse.observe.cancel();
        await observation.refetch();
        await utils.workspace.dashboard.invalidate();
      } catch (cause) {
        setBindingError(
          cause instanceof Error ? cause.message : "读取失败，请重试。",
        );
      }
    })();
  const renderNotice = (
    title: string,
    description: string,
    actions: ReactNode,
  ) =>
    presentation === "catalog" ? (
      <div className="keyword-catalog-generation keyword-generation-control">
        <p role="status">{description}</p>
        {actions}
      </div>
    ) : (
      <KeywordEmptyPanel
        title={title}
        description={description}
        actions={actions}
      />
    );
  if (presentation === "catalog" && !submitted) return null;
  if (knowledgePublished === false || data?.reason === "knowledge_required") {
    return renderNotice(
      "先完成企业知识库",
      "完成首轮知识节点确认后，系统会自动发布知识库。品牌全域词库将基于已发布的知识版本生成。",
      knowledgeAction,
    );
  }
  if (!data) {
    const failed = Boolean(
      observation.error ||
        readTimedOut ||
        observation.isSuccess ||
        bindingError,
    );
    return renderNotice(
      failed ? "暂时无法读取词库状态" : "正在读取词库生成条件",
      failed
        ? bindingError ||
            observation.error?.message ||
            (readTimedOut
              ? "读取超时。可以重新读取，或先检查知识库是否已经发布。"
              : "未能取得有效状态，请重新读取。")
        : "正在读取当前项目的知识版本和词库状态。",
      <div className="keyword-start-actions">
        {failed && (
          <button
            type="button"
            className="operator-secondary-button keyword-action-button"
            onClick={retryRead}
          >
            重新读取
          </button>
        )}
        {presentation === "empty" && knowledgeAction}
      </div>,
    );
  }
  const readiness = brandQuestionUniverseStatus({ ...data, operation: null });
  const currentActive =
    current?.operation &&
    ["queued", "running", "result_pending"].includes(current.operation.status);
  const disabled =
    !data.canStart || start.isPending || binding || Boolean(currentActive);
  const status =
    bindingError ||
    start.error?.message ||
    observation.error?.message ||
    (binding
      ? "正在提交抓取请求…"
      : current
        ? brandQuestionUniverseStatus(current)
        : presentation === "catalog" && data.canStart
          ? ""
          : readiness);
  const begin = async () => {
    if (!data.knowledgeSnapshotId || disabled || inFlight.current) return;
    inFlight.current = true;
    setBinding(true);
    setBindingError(null);
    setSubmitted(undefined);
    const fingerprint = JSON.stringify([
      data.knowledgeSnapshotId,
      data.dashboardRevision,
    ]);
    if (generationIntent.current?.fingerprint !== fingerprint) {
      generationIntent.current = {
        fingerprint,
        clientRequestId: crypto.randomUUID(),
      };
    }
    const requestId = generationIntent.current.clientRequestId;
    try {
      if (isWorkbench && task) {
        await task.saveState({
          step: "keyword-generating",
          resources: [
            { kind: "knowledge_snapshot", id: data.knowledgeSnapshotId },
          ],
          record: {
            id: requestId,
            label: "生成品牌全域词库",
            status: "pending",
          },
        });
      }
      const result = await start.mutateAsync({
        knowledgeSnapshotId: data.knowledgeSnapshotId,
        clientRequestId: requestId,
        expectedDashboardRevision: data.dashboardRevision,
      });
      setSubmitted(result);
      // Acknowledged requests can be regenerated after they finish. Uncertain
      // submissions retain their idempotency key for a safe retry instead.
      generationIntent.current = null;
      void utils.workspace.brandQuestionUniverse.observe.invalidate();
      if (isWorkbench && task) {
        void task
          .saveState({
            step: "keyword-observing",
            record: {
              id: requestId,
              label: "已提交词库生成",
              status: "completed",
              detail: "生成进度与正式词库以当前服务返回为准。",
            },
          })
          .catch(() =>
            setBindingError(
              "生成请求已提交，任务记录同步失败；刷新页面可重新读取。",
            ),
          );
      }
    } catch (cause) {
      setBindingError(
        cause instanceof Error ? cause.message : "生成未能开始，请重试。",
      );
    } finally {
      inFlight.current = false;
      setBinding(false);
    }
  };
  const actions =
    presentation === "catalog" ? null : (
      <div className="keyword-start-actions">
        <BrandQuestionUniverseGenerationAction
          disabled={disabled}
          label="抓取品牌全域词库"
          status={status}
          onStart={() => void begin()}
        />
        {(!data.canStart || Boolean(observation.error)) && (
          <button
            type="button"
            className="operator-secondary-button keyword-action-button"
            onClick={retryRead}
          >
            刷新词库状态
          </button>
        )}
        {["safe_knowledge_required", "knowledge_scope_exceeded"].includes(
          data.reason,
        ) && knowledgeAction}
      </div>
    );
  return (
    <section className="keyword-generation-control" aria-label="词库生成">
      {presentation === "catalog" ? (
        <div className="keyword-catalog-generation">{actions}</div>
      ) : (
        <KeywordEmptyPanel
          title="生成品牌全域词库"
          description="从已发布的企业知识出发，整理可用于后续优化的问题。生成后，词库将直接显示在这里。"
          actions={actions}
        />
      )}
      {current?.execution && (
        <div
          className="keyword-generation-progress"
          aria-label="本次词库生成过程"
        >
          <BusinessExecutionActivity
            execution={current.execution}
            thinkingDisplay="inline"
          />
        </div>
      )}
    </section>
  );
}

export function BrandQuestionUniverseGenerationAction({
  disabled,
  status,
  onStart,
  label = "抓取品牌全域词库",
}: {
  disabled: boolean;
  status: string;
  onStart: () => void;
  label?: string;
}) {
  return (
    <div className="flex max-w-md flex-col items-start gap-2">
      <button
        type="button"
        className="operator-primary-button keyword-action-button disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onStart}
      >
        {label}
      </button>
      {status && (
        <span className="text-xs text-slate-500" role="status">
          {safeText(status)}
        </span>
      )}
    </div>
  );
}

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
  quotaAvailability,
  generationEnabled = false,
  dashboardRevision,
  knowledgePublished,
  selectedKeyword,
}: ManagedKeywordTablesProps) {
  const { isWorkbench } = useBusinessWorkspace();
  // The confirmation modal is pure ephemeral UI state: it must stay closed on
  // first entry, refresh, navigation and project switches, and open only from
  // an explicit 选择词条 click. Filters below remain persisted flow state.
  const [initialGenerationSession] = useState(() => tables.length === 0);
  const [pages, setPages] = useState<Record<string, number>>({});
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
      {generationEnabled &&
        initialGenerationSession &&
        (!loading || tables.length > 0) &&
        (!error || tables.length > 0) && (
          <BrandQuestionUniverseGenerationControl
            knowledgePublished={knowledgePublished}
            presentation={tables.length > 0 ? "catalog" : "empty"}
          />
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
                            <th>问题优化</th>
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
                                      onUseQuestion?.({...selection, ...(dashboardRevision != null ? {dashboardRevision} : {})});
                                    }}
                                  >
                                    {quotaAccess?.available === false
                                      ? quotaAccess.unavailableLabel ||
                                        "该类额度已满"
                                      : "选择词条"}
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
        </>
      )}
    </section>
  );
}
