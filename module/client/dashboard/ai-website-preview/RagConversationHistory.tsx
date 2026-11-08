import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, History, LoaderCircle, Square, SquareCheckBig, SquarePen, Trash2 } from "lucide-react";
import type { ConversationDeleteResult } from "../../host";
import "./rag-conversation-history.css";

export type RagConversationHistoryItem = { id: string; title: string; subtitle?: string; disabled?: boolean; deletingDisabled?: boolean };
type ActionResult = void | boolean | Promise<void | boolean>;
type DeleteActionResult = void | boolean | ConversationDeleteResult | Promise<void | boolean | ConversationDeleteResult>;
type PendingRecord = { ids: string[]; startedAt: number };
const pendingStorageKey = (scope: string) => `frontmind-rag-pending-deletions-v2.${encodeURIComponent(scope)}`;
const legacyPendingStorageKey = (scope: string) => `frontmind-rag-pending-deletions-v1.${encodeURIComponent(scope)}`;
const validIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 512))]
  : [];
function readPending(scope: string): PendingRecord {
  const key = pendingStorageKey(scope);
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) || "null");
    if (parsed && typeof parsed === "object") {
      const record = parsed as { ids?: unknown; startedAt?: unknown };
      return { ids: validIds(record.ids), startedAt: typeof record.startedAt === "number" ? record.startedAt : 0 };
    }
    const legacyKey = legacyPendingStorageKey(scope);
    const legacy = validIds(JSON.parse(sessionStorage.getItem(legacyKey) || "[]"));
    if (legacy.length) {
      sessionStorage.removeItem(legacyKey);
      const migrated = { ids: legacy, startedAt: 0 };
      sessionStorage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* A damaged recovery record must never block history. */ }
  return { ids: [], startedAt: 0 };
}
function writePending(key: string, ids: string[], startedAt = Date.now()): boolean {
  try {
    if (ids.length) sessionStorage.setItem(key, JSON.stringify({ ids: [...new Set(ids)], startedAt } satisfies PendingRecord));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
function normalizedDeleteResult(value: void | boolean | ConversationDeleteResult): ConversationDeleteResult {
  if (value && typeof value === "object" && "ok" in value) return value;
  return value === false
    ? { ok: false, reason: "unknown", message: "该对话未能删除，请稍后重试。" }
    : { ok: true };
}

export function RagConversationHistory({ scopeKey, items, activeId, onNew, onSelect, onDelete, onOpen, loading = false, error, busy = false, deletingId, deletingIds = [], historyDisabled = false, newDisabled, examples = [], activeExampleId, onSelectExample }: {
  scopeKey: string;
  items: RagConversationHistoryItem[];
  examples?: RagConversationHistoryItem[];
  activeExampleId?: string;
  onSelectExample?: (id: string) => ActionResult;
  activeId?: string | null;
  onNew: () => void;
  onSelect: (id: string) => ActionResult;
  onDelete: (id: string) => DeleteActionResult;
  onOpen?: () => void;
  loading?: boolean;
  error?: string | null;
  busy?: boolean;
  deletingId?: string | null;
  deletingIds?: string[];
  historyDisabled?: boolean;
  newDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pendingKey = pendingStorageKey(scopeKey);
  const initialPending = readPending(scopeKey);
  const [staged, setStaged] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [pending, setPending] = useState<string[]>(initialPending.ids);
  const pendingStartedAtRef = useRef(initialPending.startedAt);
  const [localDeleting, setLocalDeleting] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<Map<string, string>>(() => new Map());
  const [selecting, setSelecting] = useState(false);
  const [actionError, setActionError] = useState("");
  const headingId = useId();
  const stagedRef = useRef(new Set<string>());
  const selectedRef = useRef(new Set<string>());
  const deletingRef = useRef(new Set<string>());
  const scopeRef = useRef(scopeKey);
  const scopeGenerationRef = useRef(0);
  const selectingRef = useRef(false);
  const mountedRef = useRef(true);
  const latest = useRef({ items, activeId, onSelect, onDelete, pendingKey, scopeKey });
  latest.current = { items, activeId, onSelect, onDelete, pendingKey, scopeKey };
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const undoRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const allDeleting = new Set([...deletingIds, ...(deletingId ? [deletingId] : []), ...localDeleting]);
  const committing = allDeleting.size > 0;
  const scopeChanged = scopeRef.current !== scopeKey;

  useEffect(() => {
    if (!scopeChanged) return;
    scopeRef.current = scopeKey;
    scopeGenerationRef.current += 1;
    const recovered = readPending(scopeKey);
    pendingStartedAtRef.current = recovered.startedAt;
    stagedRef.current = new Set();
    selectedRef.current = new Set();
    deletingRef.current = new Set();
    selectingRef.current = false;
    setOpen(false);
    setStaged(new Set());
    setSelected(new Set());
    setMultiSelect(false);
    setPending(recovered.ids);
    setLocalDeleting(new Set());
    setFailures(new Map());
    setSelecting(false);
    setActionError("");
  }, [scopeChanged, scopeKey]);

  useEffect(() => {
    if (scopeChanged || loading || error || !pending.length) return;
    const present = new Set(items.map(item => item.id));
    const remaining = pending.filter(id => present.has(id) || deletingRef.current.has(id));
    if (remaining.length === pending.length) return;
    if (writePending(pendingKey, remaining, pendingStartedAtRef.current)) {
      setPending(remaining);
      if (!remaining.length) setActionError("");
    } else setActionError("浏览器存储不可用，无法更新删除结果记录。");
  }, [items, loading, error, pending, pendingKey, scopeChanged]);

  const navigationDisabled = busy || selecting;
  const canStage = !busy && !selecting && !committing && pending.length === 0;
  const updateStaged = (next: Set<string>) => { stagedRef.current = next; setStaged(next); };
  const updateSelected = (next: Set<string>) => { selectedRef.current = next; setSelected(next); };
  const markDeleting = (next: Set<string>) => { deletingRef.current = next; if (mountedRef.current) setLocalDeleting(new Set(next)); };

  const runPending = (ids: string[]) => {
    const frozenIds = [...new Set(ids)].filter(Boolean);
    if (!frozenIds.length) return false;
    const key = pendingKey;
    const frozenScope = scopeKey;
    const frozenGeneration = scopeGenerationRef.current;
    const recorded = readPending(frozenScope).ids;
    const retryingRecordedBatch = recorded.length === frozenIds.length && recorded.every(id => frozenIds.includes(id));
    if (deletingRef.current.size > 0 || deletingId || deletingIds.length > 0 || (recorded.length > 0 && !retryingRecordedBatch)) {
      setActionError("请先核对或处理上一批删除结果，再继续删除。");
      setOpen(true);
      return false;
    }
    const startedAt = Date.now();
    if (!writePending(key, frozenIds, startedAt)) {
      setActionError("浏览器存储不可用，暂时无法安全删除对话。请重新打开历史记录后重试。");
      setOpen(true);
      return false;
    }
    pendingStartedAtRef.current = startedAt;
    setPending(frozenIds);
    setActionError("");
    setFailures(previous => { const next = new Map(previous); frozenIds.forEach(id => next.delete(id)); return next; });
    markDeleting(new Set([...deletingRef.current, ...frozenIds]));
    const frozenDelete = latest.current.onDelete;
    const remaining = new Set(frozenIds);
    const failed = new Map<string, string>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < frozenIds.length) {
        const id = frozenIds[cursor++];
        let result: ConversationDeleteResult;
        try { result = normalizedDeleteResult(await frozenDelete(id)); }
        catch (caught) { result = { ok: false, reason: caught instanceof TypeError ? "network_error" : "unknown", message: caught instanceof Error ? caught.message : "删除失败，请稍后重试。" }; }
        const responseUncertain = !result.ok && (result.reason === "network_error" || result.reason === "unknown");
        if (result.ok || !responseUncertain) remaining.delete(id);
        if (!result.ok) failed.set(id, result.message);
        writePending(key, [...remaining], startedAt);
        if (mountedRef.current && latest.current.scopeKey === frozenScope && scopeGenerationRef.current === frozenGeneration) {
          const nextDeleting = new Set(deletingRef.current); nextDeleting.delete(id); markDeleting(nextDeleting);
          setPending([...remaining]);
          if (!result.ok) setFailures(previous => new Map(previous).set(id, result.message));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, frozenIds.length) }, () => worker())).then(() => {
      if (!mountedRef.current || latest.current.scopeKey !== frozenScope || scopeGenerationRef.current !== frozenGeneration) return;
      if (failed.size) setActionError(`${frozenIds.length - failed.size} 条删除完成，${failed.size} 条未删除。`);
      else setActionError(`${frozenIds.length} 条对话删除完成。`);
    });
    return true;
  };

  const changeOpen = (next: boolean) => {
    if (next) {
      const recovered = readPending(scopeKey);
      pendingStartedAtRef.current = recovered.startedAt;
      setPending(recovered.ids);
      setOpen(true);
      onOpen?.();
      return;
    }
    setOpen(false);
    const ids = [...stagedRef.current];
    updateStaged(new Set());
    updateSelected(new Set());
    setMultiSelect(false);
    if (ids.length) runPending(ids);
  };
  const select = async (id: string) => {
    if (busy || selectingRef.current || allDeleting.has(id) || stagedRef.current.has(id)) return;
    if (multiSelect) {
      const next = new Set(selectedRef.current); next.has(id) ? next.delete(id) : next.add(id); updateSelected(next); return;
    }
    selectingRef.current = true;
    setActionError(""); setSelecting(true);
    try {
      if (await onSelect(id) !== false) {
        if (mountedRef.current) changeOpen(false);
      } else if (mountedRef.current) setActionError("暂时无法切换对话，请重试。");
    } catch { if (mountedRef.current) setActionError("暂时无法切换对话，请重试。"); }
    finally { selectingRef.current = false; if (mountedRef.current) setSelecting(false); }
  };
  const selectExample = async (id: string) => {
    if (busy || selectingRef.current || multiSelect) return;
    selectingRef.current = true;
    setSelecting(true); setActionError("");
    try { if (await onSelectExample?.(id) !== false && mountedRef.current) changeOpen(false); }
    catch { if (mountedRef.current) setActionError("暂时无法打开示例，请重试。"); }
    finally { selectingRef.current = false; if (mountedRef.current) setSelecting(false); }
  };
  const stage = (id: string) => {
    if (!canStage || allDeleting.has(id) || pending.includes(id) || selectingRef.current) return;
    const next = new Set(stagedRef.current); next.add(id); updateStaged(next); setActionError("");
    requestAnimationFrame(() => undoRefs.current.get(id)?.focus());
  };
  const undo = (id: string) => {
    const next = new Set(stagedRef.current); next.delete(id); updateStaged(next);
    requestAnimationFrame(() => removeRefs.current.get(id)?.focus());
  };
  const stageSelected = () => {
    if (!canStage || !selectedRef.current.size) return;
    const next = new Set([...stagedRef.current, ...selectedRef.current]);
    updateStaged(next); updateSelected(new Set()); setMultiSelect(false); setActionError("");
  };

  return <div className="rag-conversation-actions" aria-label="问答会话操作">
    <button type="button" className="rag-conversation-action" aria-label="新建问答" title="新建问答" disabled={(newDisabled ?? busy) || selecting} onClick={onNew}><SquarePen size={18} strokeWidth={1.7} aria-hidden="true" /></button>
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild><button type="button" className="rag-conversation-action" aria-label="历史问答" title="历史问答" disabled={historyDisabled}><History size={18} strokeWidth={1.7} aria-hidden="true" /></button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="fm-brand-portal-theme rag-conversation-popover" side="bottom" align="end" sideOffset={8} collisionPadding={16} aria-labelledby={headingId}>
          <header aria-busy={loading}><h3 id={headingId}>历史问答</h3><span className="rag-conversation-popover__loading" role={loading ? "status" : undefined} aria-label={loading ? "正在加载历史问答" : undefined}>{loading && <LoaderCircle size={16} aria-hidden="true" />}</span>{items.length > 0 && <button type="button" className="rag-conversation-popover__multi" disabled={busy || committing || pending.length > 0} onClick={() => { setMultiSelect(value => !value); updateSelected(new Set()); }}>{multiSelect ? "取消多选" : "多选"}</button>}</header>
          {!loading && error && <p className="rag-conversation-popover__message" role="alert">{error}</p>}
          {actionError && <p className="rag-conversation-popover__message" role="alert">{actionError}</p>}
          {committing && <p className="rag-conversation-popover__message" role="status">正在删除 {allDeleting.size} 条对话…</p>}
          {!committing && pending.length > 0 && <div className="rag-conversation-popover__recovery" role="status">
            <span>上次有 {pending.length} 条删除结果未确认。</span>
            <button type="button" disabled={busy || loading || Boolean(error)} onClick={() => onOpen?.()}>重新核对</button>
            <button type="button" disabled={busy || loading || Boolean(error)} onClick={() => runPending(pending)}>重试</button>
            <button type="button" onClick={() => { if (writePending(pendingKey, [])) { setPending([]); setFailures(new Map()); setActionError(""); } else setActionError("浏览器存储不可用，无法关闭提示。"); }}>关闭提示</button>
          </div>}
          {!loading && !error && !items.length && <p className="rag-conversation-popover__message">暂无历史问答</p>}
          {items.length > 0 && <ul className="rag-conversation-popover__list" aria-label="历史对话">
            {items.map(item => {
              const deleting = allDeleting.has(item.id);
              const selectedItem = selected.has(item.id);
              const failure = failures.get(item.id);
              return <li className={`rag-conversation-popover__item${failure ? " has-error" : ""}`} key={item.id}>
                {staged.has(item.id) ? <div className="rag-conversation-popover__staged">
                  <span className="rag-conversation-popover__staged-title">{item.title || "未命名对话"}</span>
                  <button ref={node => { if (node) undoRefs.current.set(item.id, node); else undoRefs.current.delete(item.id); }} type="button" aria-label={`撤销删除${item.title || "未命名对话"}`} onClick={() => undo(item.id)}>撤销</button>
                </div> : <>
                  {multiSelect && <button type="button" role="checkbox" aria-checked={selectedItem} aria-label={`选择${item.title || "未命名对话"}`} className="rag-conversation-popover__selector" disabled={!canStage || item.disabled || item.deletingDisabled || deleting || pending.includes(item.id)} onClick={() => void select(item.id)}>{selectedItem ? <SquareCheckBig size={18} aria-hidden="true" /> : <Square size={18} aria-hidden="true" />}</button>}
                  <button type="button" className="rag-conversation-popover__choice" aria-label={item.title || "未命名对话"} aria-current={activeId === item.id ? "true" : undefined} disabled={navigationDisabled || item.disabled || deleting} title={item.disabled ? "对话运行中，暂不能切换" : undefined} onClick={() => void select(item.id)}>
                    <span className="rag-conversation-popover__copy"><span className="rag-conversation-popover__title">{item.title || "未命名对话"}</span>{item.subtitle && <span className="rag-conversation-popover__subtitle">{item.subtitle}</span>}{failure && <span className="rag-conversation-popover__failure">{failure}</span>}</span>
                    {deleting ? <LoaderCircle className="rag-conversation-popover__row-loading" size={16} aria-label="删除中" /> : activeId === item.id && <Check className="rag-conversation-popover__check" size={16} aria-hidden="true" />}
                  </button>
                  {!multiSelect && <button ref={node => { if (node) removeRefs.current.set(item.id, node); else removeRefs.current.delete(item.id); }} type="button" className="rag-conversation-popover__remove" disabled={!canStage || item.disabled || item.deletingDisabled || deleting || pending.includes(item.id)} aria-label={`${failure ? "重试删除" : "删除"}${item.title || "未命名对话"}`} title={item.deletingDisabled ? "对话运行中" : pending.includes(item.id) ? "删除结果尚未确认" : failure ? "重试" : "删除对话"} onClick={() => stage(item.id)}>{failure ? <span>重试</span> : <Trash2 size={16} strokeWidth={1.7} aria-hidden="true" />}</button>}
                </>}
              </li>;
            })}
          </ul>}
          {multiSelect && <div className="rag-conversation-popover__selection-bar"><span>已选 {selected.size} 条</span><button type="button" onClick={() => updateSelected(new Set())} disabled={!selected.size}>取消选择</button><button type="button" className="is-delete" onClick={stageSelected} disabled={!selected.size}>删除所选</button></div>}
          {examples.length > 0 && <section className="rag-conversation-popover__examples" aria-label="预览问答">
            <h4>预览问答</h4><ul className="rag-conversation-popover__list">
              {examples.map(item => <li key={item.id} className="rag-conversation-popover__item"><button type="button" className="rag-conversation-popover__choice" aria-current={activeExampleId === item.id ? "true" : undefined} disabled={navigationDisabled || multiSelect} onClick={() => void selectExample(item.id)}><span className="rag-conversation-popover__copy"><span className="rag-conversation-popover__title">{item.title}</span><span className="rag-conversation-popover__subtitle">示例</span></span>{activeExampleId === item.id && <Check size={16} aria-hidden="true" />}</button></li>)}
            </ul>
          </section>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
