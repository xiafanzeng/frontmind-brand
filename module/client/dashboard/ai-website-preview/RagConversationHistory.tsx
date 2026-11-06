import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, History, SquarePen, Trash2 } from "lucide-react";
import "./rag-conversation-history.css";

export type RagConversationHistoryItem = { id: string; title: string; subtitle?: string; disabled?: boolean };
type ActionResult = void | boolean | Promise<void | boolean>;
const pendingStorageKey = (scope: string) => `frontmind-rag-pending-deletions-v1.${encodeURIComponent(scope)}`;
function readPending(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 512))] : [];
  } catch { return []; }
}
function writePending(key: string, ids: string[]): boolean {
  try {
    if (ids.length) sessionStorage.setItem(key, JSON.stringify(ids));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

export function RagConversationHistory({ scopeKey, items, activeId, onNew, onSelect, onDelete, onOpen, loading = false, error, busy = false, deletingId, historyDisabled = false, newDisabled, examples = [], activeExampleId, onSelectExample }: {
  scopeKey: string;
  items: RagConversationHistoryItem[];
  examples?: RagConversationHistoryItem[];
  activeExampleId?: string;
  onSelectExample?: (id: string) => ActionResult;
  activeId?: string | null;
  onNew: () => void;
  onSelect: (id: string) => ActionResult;
  onDelete: (id: string) => ActionResult;
  onOpen?: () => void;
  loading?: boolean;
  error?: string | null;
  busy?: boolean;
  deletingId?: string | null;
  historyDisabled?: boolean;
  newDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pendingKey = pendingStorageKey(scopeKey);
  const [staged, setStaged] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<string[]>(() => readPending(pendingKey));
  const [selecting, setSelecting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const headingId = useId();
  const stagedRef = useRef(new Set<string>());
  const committingRef = useRef(false);
  const mountedRef = useRef(true);
  const latest = useRef({ items, activeId, onSelect, onDelete, pendingKey });
  latest.current = { items, activeId, onSelect, onDelete, pendingKey };
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const undoRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // A request may have finished after the component unmounted. Once the host
  // supplies an authoritative list, forget pending IDs that no longer exist.
  useEffect(() => {
    if (loading || error || committing || !pending.length) return;
    const present = new Set(items.map(item => item.id));
    const remaining = pending.filter(id => present.has(id));
    if (remaining.length === pending.length) return;
    if (writePending(pendingKey, remaining)) { setPending(remaining); if (!remaining.length) setActionError(""); }
    else setActionError("浏览器存储不可用，无法更新待删除记录。");
  }, [items, loading, error, committing, pending, pendingKey]);
  const actionsDisabled = busy || selecting || committing || Boolean(deletingId);
  const canStage = !actionsDisabled && pending.length === 0;

  const runPending = (ids: string[], selectedId?: string) => {
    if (!ids.length || committingRef.current) return;
    const key = pendingKey;
    if (!writePending(key, ids)) {
      setActionError("浏览器存储不可用，暂时无法安全删除对话。请撤销后再关闭。");
      setOpen(true);
      return;
    }
    stagedRef.current.clear();
    setStaged(new Set());
    setPending(ids);
    committingRef.current = true;
    setCommitting(true);
    setActionError("");
    void (async () => {
      let remaining = [...ids];
      let failed = 0;
      const active = selectedId ?? latest.current.activeId;
      const stagedIds = new Set(ids);
      if (!selectedId && active && stagedIds.has(active)) {
        const survivor = latest.current.items.find(item => !stagedIds.has(item.id) && !item.disabled);
        if (survivor) {
          try {
            if (await latest.current.onSelect(survivor.id) === false) throw new Error("switch failed");
          } catch {
            if (mountedRef.current && latest.current.pendingKey === key) { setActionError("无法切换对话，删除尚未完成。"); setCommitting(false); }
            committingRef.current = false;
            return;
          }
        }
      }
      const ordered = [...ids.filter(id => id !== active), ...ids.filter(id => id === active)];
      for (const id of ordered) {
        // A workspace change or unmount must never delete from a different context.
        if (!mountedRef.current || latest.current.pendingKey !== key) break;
        let succeeded = false;
        try { succeeded = await latest.current.onDelete(id) !== false; }
        catch { /* Keep failed IDs for explicit retry. */ }
        if (succeeded) {
          remaining = remaining.filter(value => value !== id);
          writePending(key, remaining);
          if (mountedRef.current && latest.current.pendingKey === key) setPending([...remaining]);
        } else failed += 1;
      }
      if (mountedRef.current && latest.current.pendingKey === key) {
        setCommitting(false);
        if (failed) setActionError(`${failed} 条对话未能删除，请重试或取消待删除。`);
      }
      committingRef.current = false;
    })();
  };
  const changeOpen = (next: boolean, selectedId?: string) => {
    if (next) { setPending(readPending(pendingKey)); setOpen(true); onOpen?.(); return; }
    setOpen(false);
    const ids = [...stagedRef.current];
    if (ids.length) runPending(ids, selectedId);
  };
  const select = async (id: string) => {
    setActionError(""); setSelecting(true);
    try {
      if (await onSelect(id) !== false) {
        if (mountedRef.current) changeOpen(false, id);
      } else if (mountedRef.current) setActionError("暂时无法切换对话，请重试。");
    } catch { if (mountedRef.current) setActionError("暂时无法切换对话，请重试。"); }
    finally { if (mountedRef.current) setSelecting(false); }
  };
  const selectExample = async (id: string) => {
    if (actionsDisabled) return;
    setSelecting(true); setActionError("");
    try { if (await onSelectExample?.(id) !== false && mountedRef.current) changeOpen(false, `example:${id}`); }
    catch { if (mountedRef.current) setActionError("暂时无法打开示例，请重试。"); }
    finally { if (mountedRef.current) setSelecting(false); }
  };
  const stage = (id: string) => {
    const next = new Set(stagedRef.current); next.add(id); stagedRef.current = next; setStaged(next); setActionError("");
    requestAnimationFrame(() => undoRefs.current.get(id)?.focus());
  };
  const undo = (id: string) => {
    const next = new Set(stagedRef.current); next.delete(id); stagedRef.current = next; setStaged(next);
    requestAnimationFrame(() => removeRefs.current.get(id)?.focus());
  };

  return <div className="rag-conversation-actions" aria-label="问答会话操作">
    <button type="button" className="rag-conversation-action" aria-label="新建问答" title="新建问答" disabled={(newDisabled ?? busy) || committing} onClick={onNew}><SquarePen size={18} strokeWidth={1.7} aria-hidden="true" /></button>
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild><button type="button" className="rag-conversation-action" aria-label="历史问答" title="历史问答" disabled={historyDisabled}><History size={18} strokeWidth={1.7} aria-hidden="true" /></button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="fm-brand-portal-theme rag-conversation-popover" side="bottom" align="end" sideOffset={8} collisionPadding={16} aria-labelledby={headingId}>
          <header><h3 id={headingId}>历史问答</h3></header>
          {loading && <p className="rag-conversation-popover__message" role="status">正在加载历史问答…</p>}
          {!loading && error && <p className="rag-conversation-popover__message" role="alert">{error}</p>}
          {actionError && <p className="rag-conversation-popover__message" role="alert">{actionError}</p>}
          {committing && <p className="rag-conversation-popover__hint" role="status">正在删除对话…</p>}
          {!committing && pending.length > 0 && <div className="rag-conversation-popover__recovery" role="status">
            <span>有 {pending.length} 条对话删除未完成。</span>
            <button type="button" disabled={busy || loading || Boolean(error)} onClick={() => runPending(pending)}>重试删除</button>
            <button type="button" onClick={() => { if (writePending(pendingKey, [])) { setPending([]); setActionError(""); } else setActionError("浏览器存储不可用，无法取消待删除。"); }}>取消待删除</button>
          </div>}
          {!loading && !error && !items.length && <p className="rag-conversation-popover__message">暂无历史问答</p>}
          {busy && <p className="rag-conversation-popover__hint">当前回答完成后可切换或删除对话。</p>}
          {items.length > 0 && <ul className="rag-conversation-popover__list" aria-label="历史对话">
            {items.map(item => <li className="rag-conversation-popover__item" key={item.id}>
              {staged.has(item.id) ? <div className="rag-conversation-popover__staged">
                <span className="rag-conversation-popover__staged-title">{item.title || "未命名对话"} <small>已删除</small></span>
                <button ref={node => { if (node) undoRefs.current.set(item.id, node); else undoRefs.current.delete(item.id); }} type="button" disabled={committing} aria-label={`撤销删除${item.title || "未命名对话"}`} onClick={() => undo(item.id)}>撤销</button>
              </div> : <>
                <button type="button" className="rag-conversation-popover__choice" aria-current={activeId === item.id ? "true" : undefined} disabled={actionsDisabled || item.disabled} title={item.disabled ? "对话运行中，暂不能切换" : undefined} onClick={() => void select(item.id)}>
                  <span className="rag-conversation-popover__copy"><span className="rag-conversation-popover__title">{item.title || "未命名对话"}</span>{item.subtitle && <span className="rag-conversation-popover__subtitle">{item.subtitle}</span>}</span>
                  {activeId === item.id && <Check className="rag-conversation-popover__check" size={16} aria-hidden="true" />}
                </button>
                <button ref={node => { if (node) removeRefs.current.set(item.id, node); else removeRefs.current.delete(item.id); }} type="button" className="rag-conversation-popover__remove" disabled={!canStage || item.disabled} aria-label={`删除${item.title || "未命名对话"}`} title={item.disabled ? "对话运行中，暂不能删除" : "删除对话"} onClick={() => stage(item.id)}><Trash2 size={16} strokeWidth={1.7} aria-hidden="true" /></button>
              </>}
            </li>)}
          </ul>}
          {examples.length > 0 && <section className="rag-conversation-popover__examples" aria-label="示例问答">
            <h4>示例问答</h4><ul className="rag-conversation-popover__list">
              {examples.map(item => <li key={item.id} className="rag-conversation-popover__item"><button type="button" className="rag-conversation-popover__choice" aria-current={activeExampleId === item.id ? "true" : undefined} disabled={actionsDisabled} onClick={() => void selectExample(item.id)}><span className="rag-conversation-popover__copy"><span className="rag-conversation-popover__title">{item.title}</span><span className="rag-conversation-popover__subtitle">示例 · 预设评审</span></span>{activeExampleId === item.id && <Check size={16} aria-hidden="true" />}</button></li>)}
            </ul>
          </section>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
