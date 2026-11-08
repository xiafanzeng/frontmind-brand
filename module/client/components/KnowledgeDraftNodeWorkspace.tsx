import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, CircleDot, CircleHelp, Search, X } from "lucide-react";
import type { KnowledgeBaseDraftLeafDto, KnowledgeBaseDraftPreviewDto } from "../../contracts/knowledge-base-public-progress";
import type { ExecutionTurnState } from "@frontmind/module-contracts/execution";
import { Button } from "@frontmind/module-ui/components/ui/button";
import { Input } from "@frontmind/module-ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@frontmind/module-ui/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@frontmind/module-ui/components/ui/sheet";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import "./knowledge-node-workspace.css";

const editingLabels: Record<KnowledgeBaseDraftLeafDto["editingState"], string> = {
  pending: "待整理", processing: "整理中", ready: "已整理",
  needs_retry: "整理待重试", awaiting_confirmation: "结果待确认",
};
const editingIcons = { pending: Circle, processing: CircleDot, ready: Check, needs_retry: CircleHelp, awaiting_confirmation: CircleHelp };
const sourceLabel = (leaf: KnowledgeBaseDraftLeafDto) => leaf.contentSource === "edited" ? "已整理正文" : "生成原稿";
const availableBranches = (preview: KnowledgeBaseDraftPreviewDto) => preview.status === "available" ? preview.branches : [];

/** This renderer consumes retained draft text only. It has no content fetch,
 * mutation callbacks, formal-node coordinates or publication controls. */
export default function KnowledgeDraftNodeWorkspace({
  preview, className = "", detailPresentation = "drawer", detailContainer,
  onDetailsOpenChange, onNodeOpen,
}: {
  preview: KnowledgeBaseDraftPreviewDto;
  className?: string;
  detailPresentation?: "drawer" | "inline" | "dialog";
  detailContainer?: HTMLElement | null;
  onDetailsOpenChange?: (open: boolean) => void;
  onNodeOpen?: () => void;
}) {
  const branches = availableBranches(preview);
  const leaves = useMemo(() => branches.flatMap(branch => branch.leaves), [branches]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const nodeElements = useRef(new Map<string, HTMLButtonElement>());
  const inlineElement = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const selected = leaves.find(leaf => leaf.id === selectedId);
  const inline = detailPresentation === "inline";
  const modal = detailPresentation === "dialog";
  useEffect(() => { onDetailsOpenChange?.(open); }, [open, onDetailsOpenChange]);
  useEffect(() => () => onDetailsOpenChange?.(false), [onDetailsOpenChange]);
  useEffect(() => {
    if (preview.status === "available" && selectedId && !leaves.some(leaf => leaf.id === selectedId)) {
      setOpen(false);
      setSelectedId(null);
    }
  }, [leaves, preview.status, selectedId]);
  useEffect(() => { if (inline && open) inlineElement.current?.focus({ preventScroll: true }); }, [inline, open]);
  const select = (id: string) => { setSelectedId(id); setOpen(true); onNodeOpen?.(); };
  const close = () => {
    setOpen(false);
    if (inline && selectedId) requestAnimationFrame(() => nodeElements.current.get(selectedId)?.focus({ preventScroll: true }));
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (selectedId) nodeElements.current.get(selectedId)?.focus({ preventScroll: true });
  };
  const query = search.trim().toLocaleLowerCase();
  const visibleBranches = branches.map(branch => ({ ...branch, leaves: branch.leaves.filter(leaf =>
    !query || leaf.title.toLocaleLowerCase().includes(query) || leaf.contentMarkdown.toLocaleLowerCase().includes(query),
  ) })).filter(branch => branch.leaves.length > 0);
  const Title = inline ? "h2" : modal ? DialogTitle : SheetTitle;
  const Description = inline ? "p" : modal ? DialogDescription : SheetDescription;
  const detail = <>
    <header className="knowledge-node-workspace__drawer-header">
      <div><p>{selected?.branchTitle ?? "草稿预览"}</p><Title {...(inline ? { id: titleId } : {})}>{selected?.title ?? "知识节点草稿"}</Title></div>
      <Button type="button" size="icon" variant="ghost" aria-label="关闭草稿详情" onClick={close}><X aria-hidden="true" /></Button>
      <Description {...(inline ? { id: descriptionId } : {})} className="sr-only">查看已保留的知识节点草稿全文及文字整理进度。</Description>
    </header>
    {preview.status === "available" && <label className="knowledge-node-workspace__node-switch">切换节点
      <select aria-label="切换草稿节点" value={selectedId ?? ""} onChange={event => select(event.target.value)}>
        {branches.map(branch => <optgroup key={branch.id} label={branch.title}>{branch.leaves.map(leaf =>
          <option key={leaf.id} value={leaf.id}>{leaf.title} · {editingLabels[leaf.editingState]}</option>,
        )}</optgroup>)}
      </select>
    </label>}
    <div className="knowledge-node-workspace__detail">
      {preview.status === "unavailable" ? <p role="status" className="knowledge-node-workspace__notice">暂时无法读取草稿，正在自动恢复预览。</p> : selected ? <>
        <div className="knowledge-node-workspace__draft-labels" aria-label="草稿状态">
          <span>草稿 · 只读预览</span><span data-draft-state={selected.editingState}>{editingLabels[selected.editingState]}</span><span>{sourceLabel(selected)}</span>
        </div>
        <div className="knowledge-node-workspace__markdown"><MarkdownRenderer content={selected.contentMarkdown} hideRelativeImages /></div>
      </> : <p className="knowledge-node-workspace__notice">请选择一个草稿节点查看正文。</p>}
    </div>
  </>;
  return <section className={`knowledge-node-workspace ${className}`} aria-label="知识草稿预览">
    <header className="knowledge-node-workspace__header" hidden={inline && open && !detailContainer}>
      <div><h2>知识结构</h2><p>{preview.totalNodes > 0 ? `${preview.totalNodes} 个草稿节点` : "草稿正在恢复"} · {preview.status === "available" ? "只读预览" : "读取待恢复"}</p></div>
    </header>
    <p className="knowledge-node-workspace__notice" hidden={inline && open && !detailContainer}>
      {preview.totalNodes > 0 ? `已整理 ${preview.processedNodes}/${preview.totalNodes} 个节点。` : "文字整理进度正在同步。"}全部整理并保存后进入正式核验。
    </p>
    {preview.status === "unavailable" ? <div className="knowledge-node-workspace__empty" role="status"><h3>暂时无法读取草稿</h3><p>已保留的内容正在重新同步，恢复后将自动显示目录。</p></div>
      : leaves.length === 0 ? <div className="knowledge-node-workspace__empty" role="status"><h3>正在同步草稿目录</h3><p>已生成的节点将在这里显示。</p></div>
      : <div className="knowledge-node-workspace__directory" hidden={inline && open && !detailContainer}>
        <div className="knowledge-node-workspace__search"><Search aria-hidden="true" /><Input aria-label="搜索草稿标题或内容" placeholder="搜索节点标题或内容" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <nav className="knowledge-node-workspace__tree" aria-label="知识草稿目录">
          {!visibleBranches.length ? <p className="knowledge-node-workspace__notice">没有匹配的草稿节点。</p> : <ul>{visibleBranches.map(branch => {
            const fullBranch = branches.find(item => item.id === branch.id)!;
            const total = fullBranch.leaves.length;
            const ready = fullBranch.leaves.filter(leaf => leaf.editingState === "ready").length;
            const retry = fullBranch.leaves.filter(leaf => leaf.editingState === "needs_retry").length;
            const expanded = Boolean(query) || !collapsed.has(branch.id);
            const percent = total ? Math.round(ready / total * 100) : 0;
            return <li key={branch.id} className="knowledge-node-workspace__branch-card">
              <button type="button" className="knowledge-node-workspace__branch" aria-expanded={expanded} onClick={() => setCollapsed(previous => {
                const next = new Set(previous); next.has(branch.id) ? next.delete(branch.id) : next.add(branch.id); return next;
              })}>
                <span className="knowledge-node-workspace__branch-number">{String(branches.findIndex(item => item.id === branch.id) + 1).padStart(2, "0")}</span>
                <span className="knowledge-node-workspace__branch-summary"><span className="knowledge-node-workspace__branch-heading"><strong>{branch.title}</strong><span>已整理 {ready}/{total}</span></span><span className="knowledge-node-workspace__branch-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span></span>
                {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              </button>
              {expanded && <div className="knowledge-node-workspace__branch-body">
                <div className="knowledge-node-workspace__branch-counts" aria-label={`${branch.title}草稿整理状态`}><span data-status="confirmed">已整理 {ready}</span>{retry > 0 && <span data-status="needs_verification">待重试 {retry}</span>}<span data-status="pending">待完成 {total - ready - retry}</span></div>
                <ul>{branch.leaves.map(leaf => { const Icon = editingIcons[leaf.editingState]; return <li key={leaf.id}>
                  <button type="button" className="knowledge-node-workspace__leaf" data-draft-state={leaf.editingState} aria-label={`${leaf.title} ${editingLabels[leaf.editingState]} ${sourceLabel(leaf)}`} aria-current={selectedId === leaf.id ? "true" : undefined} aria-haspopup={inline ? undefined : "dialog"} onClick={() => select(leaf.id)} ref={node => { if (node) nodeElements.current.set(leaf.id, node); else nodeElements.current.delete(leaf.id); }}>
                    <span className="knowledge-node-workspace__leaf-icon"><Icon aria-hidden="true" /></span><span className="knowledge-node-workspace__leaf-title">{leaf.title}<small className="knowledge-node-workspace__draft-source">{sourceLabel(leaf)}</small></span><span className="knowledge-node-workspace__status">{editingLabels[leaf.editingState]}</span><ChevronRight aria-hidden="true" />
                  </button>
                </li>; })}</ul>
              </div>}
            </li>;
          })}</ul>}
        </nav>
      </div>}
    {inline ? open && ((content: React.ReactNode) => detailContainer ? createPortal(content, detailContainer) : content)(
      <section ref={inlineElement} className="knowledge-node-workspace knowledge-node-workspace__inline-detail" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } }}>{detail}</section>,
    ) : modal ? <Dialog open={open} onOpenChange={setOpen}><DialogContent className="fm-brand-portal-theme knowledge-node-workspace knowledge-node-workspace-modal" data-brand-page="knowledge" overlayClassName="knowledge-node-workspace-overlay" showCloseButton={false} onCloseAutoFocus={restoreFocus}>{detail}</DialogContent></Dialog>
      : <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="fm-brand-portal-theme knowledge-node-workspace knowledge-node-workspace-drawer" data-brand-page="knowledge" overlayClassName="knowledge-node-workspace-overlay" showCloseButton={false} onCloseAutoFocus={restoreFocus}>{detail}</SheetContent></Sheet>}
  </section>;
}

/** The initial draft has no reply target yet; show its actual phase instead
 * of the generic running-conversation composer placeholder. */
export function KnowledgeDraftComposerStatus({ preview, authority }: { preview: KnowledgeBaseDraftPreviewDto; authority?: ExecutionTurnState }) {
  return <div className="knowledge-workspace-status knowledge-draft-composer-status" role="status">
    <p>{authority?.label ?? "草稿已保留，正在同步任务状态"}{preview.totalNodes > 0 ? ` · 已整理 ${preview.processedNodes}/${preview.totalNodes} 个节点` : ""}</p>
    <p>{preview.status === "available" ? "可在右侧查看草稿全文；整理并保存完成后继续核验。" : "草稿预览暂时无法读取，正在自动恢复。"}</p>
  </div>;
}
