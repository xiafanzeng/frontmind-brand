import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  businessExecutionLabels, orderExecutionTimeline,
  type ExecutionTurnState, type GeneralExecutionDto,
} from "@frontmind/module-contracts/execution";
import type { ExecutionDisplayEntry } from "../lib/general-execution-display";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import { ExecutionDuration } from "./ExecutionDuration";
import { useConversation } from "../conversation";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { isKnowledgeDetailedRecord, knowledgeTurnStateLabel, newerKnowledgeAuthority } from "../lib/knowledge-workbench-presentation";
import "./KnowledgeExecutionActivity.css";

type ActivityItem = ExecutionDisplayEntry;
type TurnHistory = NonNullable<GeneralExecutionDto["turnHistory"]>[string];
type ActivityState = "active" | "complete" | "waiting" | "error" | "recorded";
const PAGE_SIZE = 36;
// Preserve the icon supplied by the selected HTML reference.
function TraceSpark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" /></svg>;
}
const mergeActivity = (...pages: ActivityItem[][]): ActivityItem[] => orderExecutionTimeline(
  [...new Map(pages.flat().map(item => [item.id, item])).values()],
) as ActivityItem[];

function activityTitle(item: ActivityItem): string {
  if (item.kind !== "status") return "详细过程";
  if (item.publicSummaryTitle && /[\u4e00-\u9fff]/u.test(item.publicSummaryTitle))
    return item.publicSummaryTitle;
  const phase = item.publicSummaryPhase ?? item.phase;
  if (phase && Object.hasOwn(businessExecutionLabels, phase)) return businessExecutionLabels[phase];
  return "资料分析与处理";
}

function ActivityTime({ timestamp }: { timestamp: number }) {
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8.64e15) return null;
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()} title={date.toLocaleString("zh-CN")}>{date.toLocaleTimeString("zh-CN", { hour12: false })}</time>;
}

function ActivityEntry({ item, expansion }: { item: ActivityItem; expansion: { version: number; open: boolean } }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (expansion.version) setOpen(expansion.open); }, [expansion]);
  const detailsId = useId();
  // The same explicit public-record predicate governs every visible surface.
  // Raw thinking, operation descriptions and tool payloads never enter the view.
  if (!isKnowledgeDetailedRecord(item)) return null;
  return (
    <li className="knowledge-trace-thinking">
      <button type="button" className="knowledge-trace-thinking-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(value => !value)}>
        <TraceSpark />
        <span className="knowledge-trace-thinking-title">{activityTitle(item)}</span>
        <span className="knowledge-trace-summary-end"><ActivityTime timestamp={item.timestamp} /><ChevronRight className="knowledge-trace-chevron" aria-hidden="true" /></span>
      </button>
      {open && <div id={detailsId} className="knowledge-trace-thought-content" aria-label="详细过程">
        <div className="knowledge-trace-prose"><MarkdownRenderer content={item.publicSummary.trim()} allowCopy={false} generalChatLinks /></div>
      </div>}
    </li>
  );
}

function publicRecordMarkdown(items: ActivityItem[], authority?: ExecutionTurnState) {
  const lines = ["# 知识库详细过程", "", `状态：${authority?.label ?? "状态待同步"}`, ""];
  for (const [index, item] of items.filter(isKnowledgeDetailedRecord).entries()) {
    lines.push(`## ${String(index + 1).padStart(2, "0")} ${activityTitle(item)}`, "",
      `时间：${new Date(item.timestamp).toLocaleString("zh-CN", { hour12: false })}`, "", item.publicSummary.trim(), "");
  }
  return lines.join("\n");
}

function TurnActivity({ items, authority: incomingAuthority, history }: { items: ActivityItem[]; authority?: ExecutionTurnState; history?: TurnHistory }) {
  const authorityRef = useRef(incomingAuthority);
  authorityRef.current = newerKnowledgeAuthority(authorityRef.current, incomingAuthority);
  const authority = authorityRef.current;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expansion, setExpansion] = useState({ version: 0, open: true });
  const [newCount, setNewCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [retained, setRetained] = useState<ActivityItem[]>(items);
  const latestAuthority = useRef(authority);
  latestAuthority.current = authority;
  const allItems = useMemo(() => {
    const liveIds = new Set(items.map(item => item.id));
    return mergeActivity(retained, items).map<ActivityItem>(item => {
      const current = liveIds.has(item.id) && authority?.state === "running";
      if (current) return item;
      if (item.kind === "tool") return {...item,animate:false,isCurrent:false,status:item.status === "running" ? "unconfirmed" : item.status};
      return {...item,animate:false,isCurrent:false};
    });
  }, [retained, items, authority?.state]);
  useEffect(() => { setRetained(previous => mergeActivity(previous, items)); }, [items]);
  const { activeConversation, wakeKnowledgeBaseConversation, refreshConversations } = useConversation();
  const tail = useRef<HTMLDivElement>(null);
  const tailVisible = useRef(true);
  const previousIds = useRef(new Set(items.filter(isKnowledgeDetailedRecord).map(item => item.id)));
  useEffect(() => {
    const element = tail.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      tailVisible.current = entry?.isIntersecting === true;
      if (tailVisible.current) setNewCount(0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const detailed = items.filter(isKnowledgeDetailedRecord);
    const added = detailed.filter(item => !previousIds.current.has(item.id)).length;
    previousIds.current = new Set(detailed.map(item => item.id));
    // Keep the existing oldest visible record mounted as new records append.
    // A moving last-N window would remove content while the user reads it.
    if (added) setVisibleCount(value => Math.min(Number.MAX_SAFE_INTEGER, value + added));
    if (added && !tailVisible.current) setNewCount(value => value + added);
  }, [items]);
  const active = authority?.state === "running";
  const headerState: ActivityState = !authority ? "waiting" : authority.state === "completed" ? "complete" : authority.state === "failed" ? "error" : authority.state === "running" ? "active" : "waiting";
  const readable = allItems.filter(isKnowledgeDetailedRecord);
  const visible = readable.slice(-visibleCount);
  // Server history totals/cursors count transport events. Keep those raw for
  // traversal, but never present them as a count of detailed records.
  const unreadHistory = Math.max(0, (history?.totalEntries ?? allItems.length) - allItems.length);
  const requestHistory = async (beforeId?: string) => {
    if (!authority) throw new Error("正在同步任务状态，请稍后读取过程记录");
    const rest = captureWorkspaceRestOperation();
    const response = await rest.fetch("/api/knowledge-base/execution-history", {method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({buildId:authority.buildId,generation:authority.generation,turnId:items[0]!.turnId,beforeId})});
    const page = await response.json();
    rest.assertActive();
    if (!response.ok) throw new Error(page.error?.message ?? "过程记录暂未读取成功");
    if (latestAuthority.current?.buildId !== page.buildId || latestAuthority.current?.generation !== page.generation || page.turnId !== items[0]!.turnId)
      throw new Error("知识库已更新，请重新打开过程记录");
    const entries = (page.entries as ActivityItem[]).map<ActivityItem>(item => {
      if (item.kind === "tool") return { ...item, animate: false,
        status: item.status === "running" && latestAuthority.current?.state !== "running" ? "unconfirmed" : item.status };
      return { ...item, animate: false };
    });
    return {...page,entries} as {entries:ActivityItem[];hasMore:boolean;oldestEntryId?:string;totalEntries:number};
  };
  const readAllHistory = async () => {
    if (!history) return readable;
    let beforeId: string | undefined;
    let result: ActivityItem[] = [];
    const seen = new Set<string>();
    do {
      const page = await requestHistory(beforeId);
      result = mergeActivity(page.entries,result);
      if (!page.hasMore) break;
      if (!page.oldestEntryId || seen.has(page.oldestEntryId)) throw new Error("过程记录分页暂未完成，请稍后重试");
      seen.add(page.oldestEntryId);
      beforeId = page.oldestEntryId;
    } while (true);
    setRetained(previous => mergeActivity(previous,result));
    return result.filter(isKnowledgeDetailedRecord);
  };
  const withHistory = async (action: () => Promise<void>) => {
    if (historyBusy) return;
    setHistoryBusy(true);
    try { await action(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "过程记录暂未读取成功"); }
    finally { setHistoryBusy(false); }
  };
  const loadEarlier = () => void withHistory(async () => {
    if (readable.length > visible.length) { setVisibleCount(value => value + PAGE_SIZE); return; }
    if (!unreadHistory) return;
    let beforeId = allItems[0]?.id ?? history?.oldestEntryId;
    let combined = allItems;
    const seen = new Set<string>();
    // A page may contain only hidden tool/lifecycle records. Traverse it in
    // the same action until actual public detail or the end of history arrives.
    while (true) {
      const page = await requestHistory(beforeId);
      const previousCount = combined.filter(isKnowledgeDetailedRecord).length;
      combined = mergeActivity(page.entries, combined);
      setRetained(previous => mergeActivity(page.entries, previous));
      const added = combined.filter(isKnowledgeDetailedRecord).length - previousCount;
      if (added) setVisibleCount(value => value + added);
      if (!page.hasMore) {
        if (combined.length < page.totalEntries) {
          const complete = await readAllHistory();
          setVisibleCount(value => value + Math.max(0, complete.length - combined.filter(isKnowledgeDetailedRecord).length));
        }
        break;
      }
      if (added) break;
      if (!page.oldestEntryId || seen.has(page.oldestEntryId)) throw new Error("过程记录分页暂未完成，请稍后重试");
      seen.add(page.oldestEntryId);
      beforeId = page.oldestEntryId;
    }
  });
  const hasCollapsedHistory = !expansion.open || unreadHistory > 0 || visible.length < readable.length;
  const expandAll = () => void withHistory(async () => {
    if (hasCollapsedHistory) { if (unreadHistory) await readAllHistory(); setVisibleCount(Number.MAX_SAFE_INTEGER); }
    setExpansion(value => ({version:value.version + 1,open:hasCollapsedHistory}));
  });
  const copy = () => void withHistory(async () => {
    await navigator.clipboard.writeText(publicRecordMarkdown(await readAllHistory(),authority));
    toast.success("已复制详细过程");
  });
  const download = () => void withHistory(async () => {
    const content = publicRecordMarkdown(await readAllHistory(),authority);
    const url = URL.createObjectURL(new Blob([content], {type:"text/markdown;charset=utf-8"}));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "知识库详细过程.md"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  const retryProse = async () => {
    if (!authority?.proseRetryable || retrying) return;
    const saving = authority.phase === "saving_knowledge_nodes";
    setRetrying(true);
    try {
      const rest = captureWorkspaceRestOperation();
      const response = await rest.fetch("/api/knowledge-base/prose/retry", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: authority.buildId, turnId: items[0]!.turnId }) });
      const result = await response.json();
      rest.assertActive();
      if (!response.ok) throw new Error(result.error?.message ?? (saving ? "暂时无法重试保存，请重新读取状态" : "暂时无法继续整理，请重新读取状态"));
      if (activeConversation) wakeKnowledgeBaseConversation(activeConversation.id);
      await refreshConversations();
      toast.success(saving ? "已开始重新保存" : "已继续文字整理");
    } catch (error) { toast.error(error instanceof Error ? error.message : saving ? "暂时无法重试保存" : "暂时无法继续整理"); }
    finally { setRetrying(false); }
  };
  return (
    <section className="knowledge-trace-window" data-active={active || undefined}>
      <header className="knowledge-trace-toolbar">
        <div className="knowledge-trace-brand"><span className="knowledge-trace-brand-mark" aria-hidden="true"><TraceSpark /></span>知识库执行过程</div>
        <div className="knowledge-trace-toolbar-actions">
          <span className="knowledge-trace-control-status" data-state={headerState} role="status">
            <span className="knowledge-trace-status-dot" aria-hidden="true" />{knowledgeTurnStateLabel(authority)}
            {authority && <><span aria-hidden="true">·</span><ExecutionDuration startedAt={authority.startedAt} completedAt={authority.completedAt} active={active || (authority.state === "waiting" && authority.completedAt === undefined)} /></>}
          </span>
          <button type="button" className="knowledge-trace-button is-ghost" disabled={historyBusy} onClick={copy} aria-label="复制详细过程"><Copy /><span>复制</span></button>
          <button type="button" className="knowledge-trace-button" disabled={historyBusy} onClick={download} aria-label="下载详细过程"><Download /><span>下载</span></button>
          {authority?.proseRetryable && <button type="button" className="knowledge-trace-button is-primary" disabled={retrying} onClick={() => void retryProse()}><RotateCcw />{authority.phase === "saving_knowledge_nodes" ? retrying ? "正在重试保存…" : "重试保存" : retrying ? "正在继续…" : "继续文字整理"}</button>}
        </div>
      </header>
      <div className="knowledge-trace-thread">
        <div className="knowledge-trace-assistant-label"><span className="knowledge-trace-assistant-avatar" aria-hidden="true"><TraceSpark /></span>FrontMind Agent<span>详细过程</span></div>
        <p className="knowledge-trace-intro">{authority?.label ?? "正在同步任务状态"}{authority?.totalNodes ? ` · 已整理 ${authority.processedNodes ?? 0}/${authority.totalNodes} 个节点` : ""}</p>
        <div className="knowledge-trace-record-controls">
          <button type="button" className="knowledge-trace-button is-ghost" disabled={historyBusy} onClick={expandAll}><ChevronRight className={`knowledge-trace-chevron ${hasCollapsedHistory ? "" : "is-open"}`} />{hasCollapsedHistory ? "展开全部" : "收起详情"}</button>
          <span>{historyBusy ? "正在读取记录…" : `${unreadHistory ? "已载入 " : ""}${readable.length} 条详细过程`}</span>
        </div>
        {readable.length > visible.length || unreadHistory > 0 ? <button type="button" disabled={historyBusy} className="knowledge-trace-button knowledge-trace-more" onClick={loadEarlier}>{unreadHistory ? "查看较早的详细过程" : `查看较早的详细过程（还有 ${readable.length - visible.length} 条）`}</button> : null}
        <ol className="knowledge-trace-records" aria-label="详细过程">{visible.map(item => <ActivityEntry key={item.id} item={item} expansion={expansion} />)}</ol>
        {!readable.length && <p className="knowledge-trace-empty">{active ? "正在处理资料，详细过程会在形成后显示。" : !authority || authority.state === "unknown" ? "暂未读取到详细过程，正在同步任务状态。" : "本轮尚无已保存的详细过程。"}</p>}
        {newCount > 0 && <button type="button" className="knowledge-trace-button knowledge-trace-new" onClick={() => { tail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); setNewCount(0); }}>有 {newCount} 条新进展 · 查看最新</button>}
        <div ref={tail} />
      </div>
    </section>
  );
}

export function KnowledgeExecutionActivity({ items, turnStates, turnHistory, placement = "before" }: {
  items?: ActivityItem[]; turnStates?: GeneralExecutionDto["turnStates"]; turnHistory?: GeneralExecutionDto["turnHistory"]; placement?: "before" | "after";
}) {
  if (!items?.length) return null;
  const groups = new Map<string, ActivityItem[]>();
  for (const item of orderExecutionTimeline(items) as ActivityItem[]) {
    const group = groups.get(item.turnId) ?? []; group.push(item); groups.set(item.turnId, group);
  }
  return <div className="knowledge-execution" aria-label="执行过程" data-placement={placement}>{[...groups].map(([turnId, group]) => <TurnActivity key={turnId} items={group} authority={turnStates?.[turnId]} history={turnHistory?.[turnId]} />)}</div>;
}
