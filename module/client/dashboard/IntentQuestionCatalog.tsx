import type {ReactNode} from "react";
import {Search} from "lucide-react";
import {keywordCategoryLabel} from "@frontmind/module-ui/keyword-categories";
import type {IntentQuestion, IntentEvaluation, IntentSkillJob} from "../../contracts/intent-workbench";

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
export default function IntentQuestionCatalog({questions, visible, evaluations, activeJob, received, integration, search, category, status, selected, pending, page, pageCount, total, savedPlanIds,
  onSearch, onCategory, onStatus, onToggle, onSelectPage, onClear, onEvaluate, onViewPlan, onGeneratePlan, onPage, onHistory, historyCount}: {
  questions: IntentQuestion[]; visible: IntentQuestion[]; integration?: IntentCatalogIntegration;
  evaluations: IntentEvaluation[]; activeJob?: IntentSkillJob; received: string[];
  search: string; category: string; status: string; selected: string[]; pending: boolean;
  page: number; pageCount: number; total: number;
  savedPlanIds: string[]; onViewPlan: (id: string) => void; onGeneratePlan: (id: string) => void;
  onSearch: (value: string) => void; onCategory: (value: string) => void; onStatus: (value: string) => void;
  onToggle: (id: string) => void; onSelectPage: (checked: boolean) => void; onClear: () => void;
  onEvaluate: (ids: string[]) => void; onPage: (page: number) => void;
  onHistory: () => void; historyCount: number;
}) {
  const categories = [...new Set(questions.map(question => question.category))];
  return <>
    <header className="iw-header iw-catalog-header">
      <div><h1>优化问题</h1><p>查看已保存评估，或评估新加入的推荐问题与历史词条。</p></div>
      <div className="iw-header-tools">
        <button onClick={onHistory}>历史记录（{historyCount}）</button>
        <label className="iw-search"><Search size={17}/><input aria-label="搜索优化问题" placeholder="搜索问题" value={search} onChange={event => onSearch(event.target.value)}/></label>
        <select aria-label="问题分类" value={category} onChange={event => onCategory(event.target.value)}><option value="all">全部类别</option>{categories.map(value => <option key={value} value={value}>{keywordCategoryLabel(value) || value}</option>)}</select>
        <select aria-label="问题状态" value={status} onChange={event => onStatus(event.target.value)}><option value="all">全部状态</option><option value="unevaluated">待评估</option><option value="supported">充分支撑</option><option value="partial">部分支撑</option><option value="missing">未支撑</option><option value="published">已有正式应答</option><option value="pending">待制作应答</option><option value="unknown">暂未同步</option></select>
        {integration?.onAddQuestion && <button className="iw-primary" onClick={integration.onAddQuestion}>新增问题</button>}
      </div>
    </header>
    {received.length > 0 && <div className="iw-handoff-banner" role="status"><div><strong>已接收所选 {received.length} 条问题</strong><p>{activeJob?.kind === "evaluate" && received.some(id => activeJob.questionIds.includes(id)) ? "问题价值正在评估；完成后可查看知识支撑并批量生成方案。" : received.every(id => evaluations.some(item => item.questionId === id)) ? "问题评估已完成，可复用已有结果并生成优化方案。" : "问题已加入清单，可继续评估问题价值与知识支撑。"}</p></div><span className="iw-tag">所选词条 → 问题优化</span></div>}
    <section className="iw-panel iw-table-wrap iw-catalog-table"><table>
      <thead><tr><th><input type="checkbox" aria-label="选择当前页问题" checked={visible.length > 0 && visible.every(item => selected.includes(item.id))} onChange={event => onSelectPage(event.target.checked)}/></th><th>候选问题</th><th>问题价值</th><th>知识支撑</th><th>主要缺口</th><th>优化状态</th><th>操作</th></tr></thead>
      <tbody>{visible.map(question => {
        const evaluation = evaluations.find(item => item.questionId === question.id);
        const evaluating = activeJob?.kind === "evaluate" && activeJob.questionIds.includes(question.id);
        const gaps = evaluation?.points.filter(point => point.status !== "supported");
        const support = !evaluation ? undefined : evaluation.support >= 80 ? "supported" : evaluation.support >= 50 ? "partial" : "missing";
        return <tr key={question.id} className={`${selected.includes(question.id) ? "selected" : ""} ${received.includes(question.id) ? "iw-new-row" : ""}`}>
        <td><input type="checkbox" aria-label={`选择${question.question}`} checked={selected.includes(question.id)} onChange={() => onToggle(question.id)}/></td>
        <td><b>{question.question}</b> {received.includes(question.id) && <span className="iw-tag">新加入</span>}<p className="iw-evidence"><span className="iw-catalog-category" data-category={question.category}>{keywordCategoryLabel(question.category) || question.category}</span> · {answerStatusLabel(integration?.answerStatuses?.[question.id])}</p></td>
        <td>{evaluating ? "评估中…" : evaluation ? <button className="iw-score-link" disabled={pending} aria-label={`查看评估：${question.question}`} onClick={() => onEvaluate([question.id])}><strong className={evaluation.value >= 80 ? "good" : "warn"}>{evaluation.value} / 100</strong></button> : "待评估"}</td>
        <td>{evaluating ? "评估中…" : evaluation ? <><button className="iw-score-link" disabled={pending} aria-label={`查看知识支撑：${question.question}`} onClick={() => onEvaluate([question.id])}><strong>{evaluation.support} / 100</strong></button><p><span className={`iw-tag ${support}`}>{support === "supported" ? "较充分" : support === "partial" ? "部分支撑" : "支撑不足"}</span></p></> : "待评估"}</td>
        <td>{evaluating ? "正在检查知识依据" : !gaps ? "评估后显示" : gaps.length ? gaps.map(point => <span key={point.title} className={`iw-tag ${point.status}`}>{point.title}</span>) : "暂无关键缺口"}</td>
        <td><span className={`iw-tag ${evaluating ? "partial" : gaps?.length ? "partial" : evaluation ? "supported" : ""}`}>{evaluating ? "评估中" : !evaluation ? "待评估" : gaps?.length ? "待优化" : "要点已支撑"}</span></td>
        <td><div className="iw-catalog-actions">
          {savedPlanIds.includes(question.id)
            ? <button className="iw-primary" disabled={pending} onClick={() => onViewPlan(question.id)}>查看优化方案</button>
            : <button className="iw-primary" disabled={pending} onClick={() => evaluation ? onGeneratePlan(question.id) : onEvaluate([question.id])}>{evaluation ? "生成优化方案" : "评估问题"}</button>}
          {(integration?.onEditQuestion || integration?.onDeleteQuestion) && <details className="iw-more-actions"><summary>更多</summary><div>
            {integration.onEditQuestion && <button disabled={pending} onClick={() => integration.onEditQuestion?.(question)}>修改问题</button>}
            {integration.onDeleteQuestion && <button disabled={pending} onClick={() => integration.onDeleteQuestion?.(question)}>删除问题</button>}
          </div></details>}
        </div></td>
      </tr>;})}</tbody>
    </table>{!visible.length && <div className="iw-empty">{questions.length ? "没有匹配问题，请调整筛选条件。" : "从推荐问题或已保存词库中选择词条，加入优化清单。"}</div>}</section>
    <div className="iw-pagination"><span>共 {total} 项</span>{pageCount > 1 && <><button disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>下一页</button></>}</div>
    {selected.length > 0 && <div className="iw-selection-bar"><span>已选择 <strong>{selected.length}</strong> 条问题</span><div><button onClick={onClear}>清空选择</button><button className="iw-primary" disabled={pending} onClick={() => onEvaluate(selected)}>批量评估并优化（{selected.length}）</button></div></div>}
  </>;
}
