import {type CSSProperties, type ReactNode} from "react";
import {Search, ChevronRight, ArrowDown, ArrowDownUp} from "lucide-react";
import type {IntentQuestion, IntentEvaluation, IntentSkillJob} from "../../contracts/intent-workbench";
import type {IntentCatalogSort} from "./intent-catalog-view";

/** Supplied by the intent owner's host; this module only owns the evaluation entry. */
export type IntentCatalogIntegration = {
  answerStatuses?: Record<string, "published" | "pending">;
  generationPanel?: ReactNode;
  onAddQuestion?: () => void;
  onOpenAnswer?: (question: IntentQuestion) => void;
  onEditQuestion?: (question: IntentQuestion) => void;
  onDeleteQuestion?: (question: IntentQuestion) => void;
};
export const answerStatusLabel = (status?: string) => status === "published" ? "已有正式应答" : status === "pending" ? "待制作应答" : "暂未同步";
function CatalogCell({children, secondary}: {children: ReactNode; secondary?: ReactNode}) {
  return <div className="iw-catalog-cell"><div className="iw-catalog-primary">{children}</div><div className={`iw-catalog-secondary${secondary ? "" : " iw-catalog-secondary-empty"}`}>{secondary}</div></div>;
}
export default function IntentQuestionCatalog({questions, visible, evaluations, activeJob, received, integration, search, sort = "newest", onSort, selected, pending, page, pageCount, savedPlanIds,
  onSearch, onToggle, onSelectPage, onClear, onEvaluate, onViewPlan, onGeneratePlan, onPage, onHistory, historyCount, headerStatus, taskFeedback, mutationBlockedIds = [], expandedGaps = [], onGapToggle}: {
  questions: IntentQuestion[]; visible: IntentQuestion[]; integration?: IntentCatalogIntegration;
  evaluations: IntentEvaluation[]; activeJob?: IntentSkillJob; received: string[];
  search: string; selected: string[]; pending: boolean;
  sort?: IntentCatalogSort; onSort?: (sort: IntentCatalogSort) => void;
  page: number; pageCount: number; total: number;
  savedPlanIds: string[]; onViewPlan: (id: string) => void; onGeneratePlan: (id: string) => void;
  onSearch: (value: string) => void;
  onToggle: (id: string) => void; onSelectPage: (checked: boolean) => void; onClear: () => void;
  onEvaluate: (ids: string[]) => void; onPage: (page: number) => void;
  onHistory: () => void; historyCount: number;
  headerStatus?: ReactNode; taskFeedback?: ReactNode;
  mutationBlockedIds?: string[];
  expandedGaps?: string[]; onGapToggle?: (id: string, open: boolean) => void;
}) {
  const scoreHeader = (field: "value" | "support", label: string) => <th aria-sort={sort === field ? "ascending" : "none"}>
    <button className="iw-catalog-sort" type="button" aria-label={`按${label}从低到高排列`} aria-pressed={sort === field}
      title={sort === field ? "已按分数从低到高排列，再点恢复最新加入优先" : "按分数从低到高排列"}
      onClick={() => onSort?.(sort === field ? "newest" : field)}>
      {label}{sort === field ? <ArrowDown size={14} aria-hidden="true"/> : <ArrowDownUp size={14} aria-hidden="true"/>}
    </button>
  </th>;
  return <>
    <header className="iw-header iw-catalog-header">
      <div>{headerStatus ? <div className="iw-catalog-title-row"><h1>优化问题</h1>{headerStatus}</div> : <h1>优化问题</h1>}</div>
      <div className="iw-header-tools">
        <label className="iw-search"><Search size={17}/><input aria-label="搜索优化问题" placeholder="搜索问题" value={search} onChange={event => onSearch(event.target.value)}/></label>
        {integration?.onAddQuestion && <button className="iw-primary" onClick={integration.onAddQuestion}>新增问题</button>}
      </div>
    </header>
    {taskFeedback}
    {selected.length > 0 && <div className="iw-selection-bar"><span>已选择 <strong>{selected.length}</strong> 条问题</span><div><button onClick={onClear}>清空选择</button><button className="iw-primary" disabled={pending || Boolean(activeJob)} onClick={() => onEvaluate(selected)}>批量评估并优化（{selected.length}）</button></div></div>}
    <section className="iw-panel iw-table-wrap iw-catalog-table"><table>
      <colgroup><col className="iw-catalog-col-select"/><col className="iw-catalog-col-question"/><col className="iw-catalog-col-value"/><col className="iw-catalog-col-support"/><col className="iw-catalog-col-gaps"/><col className="iw-catalog-col-actions"/></colgroup>
      <thead><tr><th><input type="checkbox" aria-label="选择当前页问题" checked={visible.length > 0 && visible.every(item => selected.includes(item.id))} onChange={event => onSelectPage(event.target.checked)}/></th><th>候选问题</th>{scoreHeader("value", "问题价值")}{scoreHeader("support", "知识支撑")}<th>主要缺口</th><th>操作</th></tr></thead>
      <tbody>{visible.map((question, index) => {
        const evaluation = evaluations.find(item => item.questionId === question.id);
        const evaluating = activeJob?.kind === "evaluate" && activeJob.questionIds.includes(question.id);
        const planning = activeJob?.kind === "plan" && activeJob.questionIds.includes(question.id);
        const gaps = evaluation?.points.filter(point => point.status !== "supported");
        return <tr key={question.id} data-question-id={question.id} className={`${selected.includes(question.id) ? "selected" : ""} ${received.includes(question.id) ? "iw-new-row" : ""}`}
          style={{"--i": index} as CSSProperties}
          aria-selected={selected.includes(question.id)} tabIndex={0}
          onClick={event => {
            if ((event.target as Element).closest("button, input, label, a, select, textarea, summary, [role=button]")) return;
            onToggle(question.id);
          }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== " " && event.key !== "Enter")) return;
            event.preventDefault();
            onToggle(question.id);
          }}>
        <td><CatalogCell><input type="checkbox" aria-label={`选择${question.question}`} checked={selected.includes(question.id)} onChange={() => onToggle(question.id)}/></CatalogCell></td>
        <td><CatalogCell><b>{question.question}</b></CatalogCell></td>
        <td><CatalogCell>{evaluating ? "评估中…" : evaluation ? <button className="iw-score-link" aria-label={`查看评估：${question.question}`} onClick={() => onEvaluate([question.id])}><strong className={evaluation.value >= 80 ? "good" : "warn"}>{evaluation.value} / 100</strong></button> : "待评估"}</CatalogCell></td>
        <td><CatalogCell>{evaluating ? "评估中…" : evaluation ? <button className="iw-score-link" aria-label={`查看知识支撑：${question.question}`} onClick={() => onEvaluate([question.id])}><strong>{evaluation.support} / 100</strong></button> : "待评估"}</CatalogCell></td>
        <td><CatalogCell>{evaluating ? "正在检查知识依据" : !gaps ? "评估后显示" : gaps.length ? <details className="iw-catalog-gaps" open={onGapToggle ? expandedGaps.includes(question.id) : undefined} onToggle={event => onGapToggle?.(question.id, event.currentTarget.open)}>
          <summary><span className="iw-gap-summary-text"><span className="iw-gap-title" title={gaps[0].title}>{gaps[0].title}</span>{gaps.length > 1 && <span className="iw-gap-suffix">等</span>}</span><ChevronRight size={15} aria-hidden="true"/></summary>
          <ul>{gaps.map((point,index) => <li key={`${index}-${point.title}`}><span className="iw-gap-index" aria-hidden="true">{String(index + 1).padStart(2,"0")}</span><span>{point.title}</span></li>)}</ul>
        </details> : "暂无关键缺口"}</CatalogCell></td>
        <td><div className="iw-catalog-actions">
          <button className="iw-primary iw-answer-entry" disabled={!integration?.onOpenAnswer} onClick={() => integration?.onOpenAnswer?.(question)}>进入应答逻辑</button>
          {planning ? <button className="iw-plan-entry" disabled>方案生成中…</button> : savedPlanIds.includes(question.id)
            ? <button className="iw-plan-entry" onClick={() => onViewPlan(question.id)}>查看优化方案</button>
            : <button className="iw-plan-entry" disabled={!evaluation && (pending || Boolean(activeJob))} onClick={() => evaluation ? onGeneratePlan(question.id) : onEvaluate([question.id])}>{evaluation ? "生成优化方案" : "评估问题"}</button>}
          <button title={mutationBlockedIds.includes(question.id) ? "该问题正在处理，完成后可修改" : undefined} disabled={mutationBlockedIds.includes(question.id) || !integration?.onEditQuestion} onClick={() => integration?.onEditQuestion?.(question)}>修改问题</button>
          <button title={mutationBlockedIds.includes(question.id) ? "该问题正在处理，完成后可删除" : undefined} disabled={mutationBlockedIds.includes(question.id) || !integration?.onDeleteQuestion} onClick={() => integration?.onDeleteQuestion?.(question)}>删除问题</button>
        </div></td>
      </tr>;})}</tbody>
    </table>{!visible.length && <div className="iw-empty">{questions.length ? "没有匹配问题，请调整筛选条件。" : "从推荐问题或已保存词库中选择词条，加入优化清单。"}</div>}</section>
    {pageCount > 1 && <div className="iw-pagination"><button disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>下一页</button></div>}

  </>;
}
