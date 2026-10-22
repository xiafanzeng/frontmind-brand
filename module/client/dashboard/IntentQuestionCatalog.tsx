import type {ReactNode} from "react";
import {Search} from "lucide-react";
import {keywordCategoryLabel} from "@frontmind/module-ui/keyword-categories";
import type {IntentQuestion} from "../../contracts/intent-workbench";

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
export default function IntentQuestionCatalog({questions, visible, integration, search, category, status, selected, pending, page, pageCount, total,
  onSearch, onCategory, onStatus, onToggle, onSelectPage, onClear, onEvaluate, onPage}: {
  questions: IntentQuestion[]; visible: IntentQuestion[]; integration?: IntentCatalogIntegration;
  search: string; category: string; status: string; selected: string[]; pending: boolean;
  page: number; pageCount: number; total: number;
  onSearch: (value: string) => void; onCategory: (value: string) => void; onStatus: (value: string) => void;
  onToggle: (id: string) => void; onSelectPage: (checked: boolean) => void; onClear: () => void;
  onEvaluate: (ids: string[]) => void; onPage: (page: number) => void;
}) {
  const categories = [...new Set(questions.map(question => question.category))];
  return <>
    <details className="iw-intent-generation"><summary aria-disabled={!integration?.generationPanel} onClick={event => {if (!integration?.generationPanel) event.preventDefault();}}>从企业信息和参考材料生成问题</summary>{integration?.generationPanel && <div>{integration.generationPanel}</div>}</details>
    <header className="iw-header iw-catalog-header">
      <h1>优化问题</h1>
      <div className="iw-header-tools">
        <label className="iw-search"><Search size={17}/><input aria-label="搜索优化问题" placeholder="搜索问题" value={search} onChange={event => onSearch(event.target.value)}/></label>
        <select aria-label="问题分类" value={category} onChange={event => onCategory(event.target.value)}><option value="all">全部类别</option>{categories.map(value => <option key={value} value={value}>{keywordCategoryLabel(value) || value}</option>)}</select>
        <select aria-label="应答状态" value={status} onChange={event => onStatus(event.target.value)}><option value="all">全部状态</option><option value="published">已有正式应答</option><option value="pending">待制作应答</option><option value="unknown">暂未同步</option></select>
        <button className="iw-primary" disabled={!integration?.onAddQuestion} onClick={integration?.onAddQuestion}>新增问题</button>
      </div>
    </header>
    <section className="iw-panel iw-table-wrap iw-catalog-table"><table>
      <thead><tr><th><input type="checkbox" aria-label="选择当前页问题" checked={visible.length > 0 && visible.every(item => selected.includes(item.id))} onChange={event => onSelectPage(event.target.checked)}/></th><th>问题</th><th>分类</th><th>应答状态</th><th>操作</th></tr></thead>
      <tbody>{visible.map(question => <tr key={question.id} className={selected.includes(question.id) ? "selected" : ""}>
        <td><input type="checkbox" aria-label={`选择${question.question}`} checked={selected.includes(question.id)} onChange={() => onToggle(question.id)}/></td>
        <td>{question.question}</td>
        <td><span className="iw-catalog-category" data-category={question.category}>{keywordCategoryLabel(question.category) || question.category}</span></td>
        <td>{answerStatusLabel(integration?.answerStatuses?.[question.id])}</td>
        <td><div className="iw-catalog-actions">
          <button className="iw-assess-entry" disabled={pending} onClick={() => onEvaluate([question.id])}>查看词条评估</button>
          <button disabled={!integration?.onOpenAnswer} onClick={() => integration?.onOpenAnswer?.(question)}>进入应答逻辑</button>
          <button disabled={!integration?.onEditQuestion} onClick={() => integration?.onEditQuestion?.(question)}>修改问题</button>
          <button disabled={!integration?.onDeleteQuestion} onClick={() => integration?.onDeleteQuestion?.(question)}>删除问题</button>
        </div></td>
      </tr>)}</tbody>
    </table>{!visible.length && <div className="iw-empty">{questions.length ? "没有匹配问题，请调整筛选条件。" : "从品牌全域词库选择问题，加入优化清单。"}</div>}</section>
    <div className="iw-pagination"><span>共 {total} 项</span><button disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>下一页</button></div>
    {selected.length > 0 && <div className="iw-selection-bar"><span>已选择 <strong>{selected.length}</strong> 条问题</span><div><button onClick={onClear}>清空选择</button><button className="iw-primary" disabled={pending} onClick={() => onEvaluate(selected)}>批量评估并优化（{selected.length}）</button></div></div>}
  </>;
}
