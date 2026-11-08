import {Fragment, useEffect, useId, useRef, useState} from "react";
import {ArrowLeft, ArrowRight, Check, ChevronDown, GripHorizontal, MessageSquareText, Sparkles, Undo2, X} from "lucide-react";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from "@frontmind/module-ui/components/ui/dialog";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import ManagedKeywordTables, {type ManagedKeywordTablesProps} from "./ManagedKeywordTables";
import {liveIntentWorkbenchApi, isRejectedIntentRequest, type IntentWorkbenchApi} from "./intent-workbench-api";
import type {IntentWorkspace, IntentEvaluation, IntentPlan, IntentAction, IntentReceipt} from "../../contracts/intent-workbench";
import {findSavedIntentPlan, findCurrentIntentPlan, knowledgeOnlyIntentPlan, intentQuestionSnapshot, intentPlanSnapshot} from "../../contracts/intent-workbench";
import "./intent-workbench.css";
import "./saved-plan-result.css";
import "./plan-confirm.css";
import KnowledgeChangesView from "./KnowledgeChangesView";
import {useWorkspaceDraftGuard, projectWorkspaceUrl, requestWorkspaceNavigation} from "../host";
import {navigate} from "wouter/use-browser-location";
import IntentQuestionCatalog, {type IntentCatalogIntegration} from "./IntentQuestionCatalog";
import IntentTaskProgress from "./IntentTaskProgress";
import IntentIntakeFeedback, {type IntentIntakeFeedbackState} from "./IntentIntakeFeedback";
import {IntentTaskTray, IntentListEvaluationStatus, IntentListInitialLoading, IntentListRefreshStatus} from "./IntentListFeedback";
import {findCatalogQuestion} from "./intent-catalog-link";
import type {IntentCatalogViewState, IntentCatalogSort} from "./intent-catalog-view";
import type {IntentQuestion} from "../../contracts/intent-workbench";

const viewedCompletionKey="frontmind:intent:viewed-completions:v1";
function readViewedCompletions():string[] {
  try {const ids=JSON.parse(localStorage.getItem(viewedCompletionKey)??"[]");return Array.isArray(ids)?ids.filter((id):id is string=>typeof id==="string"):[];}catch{return [];}
}
type View = "universe" | "list" | "evaluation" | "plan" | "result" | "knowledge" | "progress" | "history-detail";
type Selection = Parameters<NonNullable<ManagedKeywordTablesProps["onUseQuestion"]>>[0];
const labels = {supported: "已支撑", partial: "部分支撑", missing: "未支撑"};
/** Mirrors HOST_QUESTION_TABLE in module/server/intent-question-catalog.ts; kept local so client code never imports the server tree. */
const HOST_QUESTION_TABLE_ID = "dashboard:confirmed";
function Score({value}: {value: number}) {return <span className={`iw-score ${value >= 80 ? "good" : value >= 50 ? "warn" : "bad"}`}><b>{value}</b><i><em style={{width: `${value}%`}}/></i></span>;}
function Steps({step}: {step: number}) {return <div className="iw-steps">{["查看评估", "确认方案", "执行结果"].map((label, index) => <div key={label} className={index <= step ? "active" : ""}><span>{index < step ? <Check size={15}/> : index + 1}</span>{label}{index < 2 && <i/>}</div>)}</div>;}
function ScoreDimensions({item}: {item: IntentEvaluation}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{left: number; top: number} | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: number; x: number; y: number; left: number; top: number; width: number; height: number} | null>(null);
  function move(left: number, top: number, width: number, height: number) {
    setPosition({left: Math.max(12, Math.min(left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12))});
  }
  function close() {setOpen(false); setPosition(null); drag.current = null;}
  useEffect(() => {close();}, [item.questionId, item.evaluatedAt]);
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      const rect = content.current?.getBoundingClientRect();
      if (rect) move(rect.left, rect.top, rect.width, rect.height);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);
  return <>
    <button type="button" className="iw-dimensions-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => {setPosition(null); setOpen(true);}}>查看 {item.dimensions.length} 项评分维度 <ChevronDown size={14}/></button>
    <Dialog open={open} onOpenChange={value => {if (!value) close();}}>
      <DialogContent ref={content} className="fm-brand-portal-theme iw-modal iw-dimensions-modal"
        data-brand-surface="intent-workbench" showCloseButton={false}
        style={position ? {left: position.left, top: position.top, transform: "none", translate: "none"} : undefined}>
        <div className="iw-dimensions-handle" tabIndex={0} aria-label="拖动评分弹窗标题栏，或使用方向键移动"
          onPointerDown={event => {
            if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
            const rect = content.current?.getBoundingClientRect();
            if (!rect) return;
            event.preventDefault(); event.currentTarget.focus();
            drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY,
              left: rect.left, top: rect.top, width: rect.width, height: rect.height};
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const start = drag.current;
            if (start?.id === event.pointerId) move(start.left + event.clientX - start.x,
              start.top + event.clientY - start.y, start.width, start.height);
          }}
          onPointerUp={event => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {drag.current = null;}}
          onLostPointerCapture={() => {drag.current = null;}}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            const rect = content.current?.getBoundingClientRect();
            if (!rect) return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 10;
            move(rect.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
              rect.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0), rect.width, rect.height);
          }}>
          <DialogHeader><DialogTitle>问题价值评分详情</DialogTitle>
            <DialogDescription>共 {item.dimensions.length} 项评分维度 · 拖动标题栏可移动</DialogDescription></DialogHeader>
          <GripHorizontal className="iw-dimensions-grip" size={18} aria-hidden="true"/>
          <button type="button" className="iw-dimensions-close" aria-label="关闭评分详情" onClick={close}><X size={18}/></button>
        </div>
        <div className="iw-dimensions-body" tabIndex={0} aria-label="评分维度内容">
          {item.dimensions.length ? item.dimensions.map(dimension => <section key={dimension.label} className="iw-dimension">
            <div><h3>{dimension.label}</h3><Score value={dimension.score}/></div><p>{dimension.reason}</p>
          </section>) : <p>此评估暂无评分维度详情。</p>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
function Evaluation({item}: {item: IntentEvaluation}) {
  return <div className="iw-evaluation">
    <div><div className="iw-score-cards">
      <section className="iw-panel iw-score-card"><span>问题价值</span><strong>{item.value}<small> / 100</small></strong>
        <ScoreDimensions item={item}/>
        <p>按意图、品牌关联、决策、清晰度、独特度和知识支撑综合评估。</p></section>
      <section className="iw-panel iw-score-card"><span>知识支撑</span><strong className={item.support >= 80 ? "good" : "warn"}>{item.support}<small> / 100</small></strong><span className="iw-tag">{item.support >= 80 ? "较充分" : item.support >= 50 ? "部分支撑" : "支撑不足"}</span><p>{item.points.filter(point => point.status === "supported").length} 项已支撑 · {item.points.filter(point => point.status === "partial").length} 项部分支撑 · {item.points.filter(point => point.status === "missing").length} 项未支撑</p></section>
    </div><section className="iw-panel"><h3>回答要点支撑矩阵 <small>{item.points.length} 个必要回答要点</small></h3><div className="iw-table-wrap"><table><thead><tr><th>回答要点</th><th>支撑状态</th><th>匹配知识节点 / 证据</th><th>内容问题</th></tr></thead><tbody>{item.points.map(point => <tr key={point.title}><td><b>{point.title}</b></td><td><span className={`iw-tag ${point.status}`}>{labels[point.status]}</span></td><td>{point.nodeTitle ?? "暂无匹配节点"}{point.evidence && <p className="iw-evidence">{point.evidence}</p>}</td><td>{point.issue}</td></tr>)}</tbody></table></div></section></div>
    <aside className="iw-panel iw-diagnosis"><h3>诊断摘要</h3>{item.findings.length ? item.findings.map(finding => <p key={finding}><Sparkles size={16}/>{finding}</p>) : <p><Check size={16}/>当前要点均有相关内容支撑。</p>}<div className="iw-method">更新时间：<time dateTime={item.evaluatedAt}>{new Date(item.evaluatedAt).toLocaleString("zh-CN")}</time></div></aside>
  </div>;
}
export function PlanEditor({plan: savedPlan, onChange, pendingKind}: {plan: IntentPlan; onChange: (plan: IntentPlan) => void; pendingKind?: "evaluate" | "plan"}) {
  const plan = knowledgeOnlyIntentPlan(savedPlan);
  const previewId = useId();
  const [active, setActive] = useState(plan.actions.find(item => item.kind === "node")?.id ?? plan.actions[0]?.id);
  const action = plan.actions.find(item => item.id === active) ?? plan.actions[0];
  const update = (id: string, patch: Partial<IntentAction>) => onChange({...plan, actions: plan.actions.map(item => item.id === id ? {...item, ...patch} : item)});
  if (!plan.actions.length) return <div className="iw-plan-empty-state" role="status" aria-live="polite"><span className="iw-plan-empty-icon" aria-hidden="true">{pendingKind ? <span className="iw-spinner"/> : <Sparkles size={20}/>}</span><div><h3>{pendingKind === "evaluate" ? "正在评估问题，暂无优化方案，请等待" : pendingKind === "plan" ? "正在生成优化方案，请稍候" : "暂无可执行的优化方案"}</h3><p>{pendingKind ? "完成后即可查看并确认方案。" : "请重新生成方案，审核知识库正文修改后再执行。"}</p></div></div>;
  return <div className="iw-plan-grid iw-plan-editor">
    <div className="iw-panel iw-tasks">{plan.actions.map(item => <section key={item.id} aria-label={`优化动作：${item.title}`} className={`iw-task ${item.selected ? "selected" : ""} ${item.id === action?.id ? "is-active" : ""}`}>
      <button type="button" className="iw-task-open" aria-label={`查看并编辑：${item.title}`} aria-pressed={item.id === action?.id} aria-controls={previewId} onClick={() => setActive(item.id)}><ArrowRight size={18}/></button>
      <div className="iw-task-content">
        <div className="iw-task-heading">
          <input type="checkbox" aria-label={`采纳：${item.title}`} checked={item.selected} onChange={event => update(item.id, {selected: event.target.checked})}/>
          <b>{item.title}</b>
        </div>
        <p>{item.source}</p>
      </div>
    </section>)}</div>
    <section id={previewId} className="iw-panel iw-preview" aria-label="优化动作修改前后">
      <h3>{action?.kind === "node" ? "知识节点变更预览" : action?.title ?? "内容变更预览"}</h3>
      {action && <div className="iw-preview-body">
        <section className="iw-plan-before"><h4>修改前</h4>{action.before ? <pre>{action.before}</pre> : <p className="iw-plan-empty">暂无原内容</p>}</section>
        <label className="iw-plan-after"><span>修改后</span><textarea aria-label={`${action.title}修改后`} value={action.after} rows={12} maxLength={300000} onChange={event => update(action.id, {after: event.target.value})}/></label>
      </div>}
    </section>
  </div>;
}
export default function IntentWorkbench({keywordProps, initialView = "universe", api = liveIntentWorkbenchApi, onSectionChange, catalogIntegration, initialCatalogState, onCatalogExit, onOpenKnowledge}: {
  keywordProps: ManagedKeywordTablesProps; initialView?: "universe" | "list"; api?: IntentWorkbenchApi;
  onSectionChange?: (section: "universe" | "list") => void;
  catalogIntegration?: IntentCatalogIntegration;
  initialCatalogState?: IntentCatalogViewState;
  onCatalogExit?: (state: IntentCatalogViewState) => void;
  onOpenKnowledge?: (nodeId?: string, receipt?: IntentReceipt) => void;
}) {
  const [workspace, setWorkspace] = useState<IntentWorkspace | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [evaluationReturnView, setEvaluationReturnView] = useState<"universe" | "list">("list");
  const [pending, setPending] = useState(false);
  const [dismissedCompletionIds, setDismissedCompletionIds] = useState<string[]>(readViewedCompletions);
  function markCompletionsViewed(jobIds:string[]) {
    setDismissedCompletionIds(current=>{const ids=[...new Set([...current,...readViewedCompletions(),...jobIds])];try{localStorage.setItem(viewedCompletionKey,JSON.stringify(ids));}catch{}return ids;});
  }
  function markCompletionViewed(id:string) {markCompletionsViewed([id]);}
  useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key===viewedCompletionKey)setDismissedCompletionIds(readViewedCompletions());};window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);},[]);
  const [dismissedFailureId, setDismissedFailureId] = useState<string>();
  const [submittingIds, setSubmittingIds] = useState<string[]>([]);
  const [savingQuestionId, setSavingQuestionId] = useState<string>();
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [blockedModelAction, setBlockedModelAction] = useState<"evaluate" | "plan" | null>(null);
  const [pendingEvaluationKeyword, setPendingEvaluationKeyword] = useState<Pick<Selection, "tableId" | "rowIndex"> | null>(null);
  const [pendingRead, setPendingRead] = useState(false);
  const [watching, setWatching] = useState(false);
  const [progressKind, setProgressKind] = useState<"evaluate" | "plan">("evaluate");
  const [progressJobId, setProgressJobId] = useState<string>();
  const [error, setErrorMessage] = useState("");
  const errorNavigation = useRef(0);
  const [taskErrors,setTaskErrors]=useState<Record<string,string>>({});
  const [submissionRejected,setSubmissionRejected]=useState(false);
  const [received, setReceived] = useState<string[]>([]);
  const [intakeFeedback, setIntakeFeedback] = useState<IntentIntakeFeedbackState>(null);
  const [selected, setSelected] = useState<string[]>(initialCatalogState?.selected ?? []);
  const [scope, setScope] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [singleQueue, setSingleQueue] = useState<string[]>([]);
  const [search, setSearch] = useState(initialCatalogState?.search ?? "");
  const [category, setCategory] = useState("all");
  const [answerStatus, setAnswerStatus] = useState("all");
  const [sort, setSort] = useState<IntentCatalogSort>(initialCatalogState?.sort ?? "newest");
  const [page, setPage] = useState(initialCatalogState?.page ?? 0);
  const [expandedGaps, setExpandedGaps] = useState<string[]>(initialCatalogState?.expandedGaps ?? []);
  const restoreCatalogFocus = useRef(initialCatalogState?.questionId);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<IntentPlan[]>([]);
  const draftBases = useRef(new Map<string, ReturnType<typeof intentPlanSnapshot>>());
  function loadDrafts(plans:IntentPlan[]) {
    draftBases.current=new Map(plans.map(plan=>[plan.questionId,intentPlanSnapshot(structuredClone(plan))]));
    setDrafts(plans);
  }
  const [draftDirty, setDraftDirty] = useState(false);
  const [receiptId, setReceiptId] = useState<string>();
  const [historyId, setHistoryId] = useState<string>();
  const [historyQuestionId, setHistoryQuestionId] = useState<string>();
  const [undoOpen, setUndoOpen] = useState(false);
  const [nodeId, setNodeId] = useState<string>();
  const [questionAction, setQuestionAction] = useState<{kind: "edit" | "delete"; question: IntentQuestion} | null>(null);
  const [questionDraft, setQuestionDraft] = useState({question: ""});
  const [questionError, setQuestionError] = useState("");
  const [deletedRecently, setDeletedRecently] = useState<IntentQuestion | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const runningRead = useRef(false);
  const runSequence = useRef(0);
  const questionSaving = useRef(false);
  const draftSaving = useRef(false);
  const draftVersion = useRef(0);
  const workspaceRef = useRef<IntentWorkspace | null>(null);
  const navigationVersion = useRef(0);
  function setError(message:string,navigation=navigationVersion.current){errorNavigation.current=navigation;setErrorMessage(message);}
  function setTaskError(id:string,message:string){setTaskErrors(current=>{
    if((current[id]??"")===message)return current;
    const next={...current};if(message)next[id]=message;else delete next[id];return next;
  });}
  function navigateView(next: View) {navigationVersion.current++; viewRef.current = next; setView(next);}
  const watchControllers = useRef(new Map<string, AbortController>());
  const planSubmissions = useRef(new Set<string>());
  const progressJobIdRef = useRef(progressJobId);
  progressJobIdRef.current = progressJobId;
  const viewRef = useRef(view);
  viewRef.current = view;
  const draftDirtyRef = useRef(draftDirty);
  draftDirtyRef.current = draftDirty;
  const emittedSection = useRef<"universe" | "list" | undefined>(undefined);
  const initialViewRef = useRef(initialView);
  const executeId = useRef<string | undefined>(undefined);
  const executingRef = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true; generation.current++; running.current = false; runningRead.current = false; runSequence.current++;
    setDismissedCompletionIds(readViewedCompletions());
    setTaskErrors({});setSubmissionRejected(false);
    workspaceRef.current = null; questionSaving.current = false; draftSaving.current = false;
    setSubmittingIds([]); setSavingQuestionId(undefined); setSavingDrafts(false); setBlockedModelAction(null);
    executingRef.current = false; executeId.current = undefined; setExecuting(false);
    setView(initialView); setProgressJobId(undefined); setEvaluationReturnView("list");
    setWorkspace(null); loadDrafts([]); setDraftDirty(false); setReceived([]); setSelected(initialCatalogState?.selected ?? []); setHistoryId(undefined); setHistoryQuestionId(undefined);
    setQuestionAction(null); setQuestionError("");
    setPendingEvaluationKeyword(null);
    setIntakeFeedback(null);
    void run(() => api.observe(), undefined, true, undefined, true);
    return () => {mounted.current = false; generation.current++;
      for (const controller of watchControllers.current.values()) controller.abort();
      watchControllers.current.clear(); planSubmissions.current.clear();};
  }, [api]);
  useEffect(() => {
    if (intakeFeedback !== "success") return;
    const timer = window.setTimeout(() => setIntakeFeedback(null), 1100);
    return () => window.clearTimeout(timer);
  }, [intakeFeedback]);
  useEffect(() => {
    if (!deletedRecently) return;
    const timer = window.setTimeout(() => setDeletedRecently(null), 6000);
    return () => window.clearTimeout(timer);
  }, [deletedRecently]);
  useEffect(() => {
    if (initialViewRef.current === initialView) return;
    initialViewRef.current = initialView;
    if (emittedSection.current === initialView) {emittedSection.current = undefined; return;}
    navigateView(initialView);
  }, [initialView]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = 0;
    }
    element.scrollIntoView({block: "start"});
  }, [view]);
  useEffect(() => {
    if (view !== "list" || !workspace || !restoreCatalogFocus.current) return;
    const row = Array.from(container.current?.querySelectorAll<HTMLElement>("[data-question-id]") ?? [])
      .find(item => item.dataset.questionId === restoreCatalogFocus.current);
    if (!row) return;
    const frame = requestAnimationFrame(() => {
      restoreCatalogFocus.current = undefined;
      row.scrollIntoView({block: "center"});
      row.querySelector<HTMLButtonElement>(".iw-answer-entry")?.focus({preventScroll:true});
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace, view]);
  async function saveDrafts() {
    if (!workspace || draftSaving.current) return false;
    draftSaving.current = true; setSavingDrafts(true);
    const version = generation.current, edits = draftVersion.current;
    const currentSession = () => mounted.current && generation.current === version;
    try {
      let current = await api.observe();
      if (!currentSession()) return false;
      applyWorkspace(current);
      current = workspaceRef.current!;
      for (const draft of drafts) {
        const base = findSavedIntentPlan(current.state, draft.questionId);
        if (!base) throw new Error("此问题的方案已变化，请重新读取后核对；草稿已保留");
        current = await api.command({kind: "edit", expectedRevision: workspaceRef.current!.revision, questionId: draft.questionId,
          expectedPlan: draftBases.current.get(draft.questionId) ?? intentPlanSnapshot(base),
          actions: draft.actions.map(({id, selected, after}) => ({id, selected, after}))});
        if (!currentSession()) return false;
        applyWorkspace(current);
        const acknowledged=findSavedIntentPlan(current.state,draft.questionId);
        if(acknowledged)draftBases.current.set(draft.questionId,intentPlanSnapshot(acknowledged));
      }
      if (edits === draftVersion.current) setDraftDirty(false);
      return true;
    } catch (cause) {
      if (currentSession()) setError(cause instanceof Error ? cause.message : "保存草稿失败，请重试");
      return false;
    } finally {
      if (currentSession()) {draftSaving.current = false; setSavingDrafts(false);}
    }
  }
  useWorkspaceDraftGuard({dirty: draftDirty, label: "优化方案修改", save: saveDrafts, discard: async () => {setDraftDirty(false); return true;}});
  function applyWorkspace(data: IntentWorkspace) {
    if (workspaceRef.current && workspaceRef.current.revision > data.revision) return;
    const safe = {...data, state: {...data.state, plans: data.state.plans.map(knowledgeOnlyIntentPlan)}};
    workspaceRef.current = safe;
    setWorkspace(safe);
  }
  function watchJob(job: NonNullable<IntentWorkspace["state"]["jobs"]>[number], destination: View) {
    if (watchControllers.current.has(job.id)) return;
    if (!api.waitForJob || job.status === "paused") return;
    const controller = new AbortController();
    watchControllers.current.set(job.id, controller);
    const version = generation.current;
    const current = () => mounted.current && generation.current === version && !controller.signal.aborted;
    setWatching(true);
    void api.waitForJob(job.id, data => {
      if (current()) {applyWorkspace(data);setTaskError(job.id,"");}
    }, controller.signal).then(data => {
      if (!current()) return;
      applyWorkspace(data);
      data = workspaceRef.current!;
      const finished = data.state.jobs?.find(item => item.id === job.id);
      // Browsing, editing and host navigation must never be stolen by completion.
      if (finished?.status !== "succeeded" || viewRef.current !== "progress" ||
          progressJobIdRef.current !== job.id || draftDirtyRef.current) return;
      if (finished.result && finished.questionIds.some(id =>
        !data.state.questions.some(question => question.id === id &&
          finished.result!.questions.some(original => original.id === id && original.question === question.question &&
            original.category === question.category && original.subdivision === question.subdivision)))) {
        setHistoryId(finished.id); setHistoryQuestionId(undefined); setView("history-detail"); return;
      }
      setScope(finished.questionIds); setIndex(0); setExpanded([]); setSingleQueue([]);
      if (finished.receiptId) {setReceiptId(finished.receiptId); setView("result");}
      else if (finished.kind === "plan") {
        loadDrafts(structuredClone(data.state.plans.filter(item => finished.questionIds.includes(item.questionId)).map(knowledgeOnlyIntentPlan)));
        setDraftDirty(false); setView("plan");
      } else setView(destination === "plan" ? "evaluation" : destination);
    }).catch(cause => {
      if (current()) setTaskError(job.id,cause instanceof Error ? cause.message : "任务状态读取失败，请重新读取");
    }).finally(() => {
      if (watchControllers.current.get(job.id) === controller) watchControllers.current.delete(job.id);
      if (mounted.current && generation.current === version) setWatching(watchControllers.current.size > 0);
    });
  }
  async function controlJob(action: "pause" | "resume", jobId = progressJobId ?? activeJob?.id) {
    const target = workspaceRef.current?.state.jobs?.find(job => job.id === jobId);
    if (!target || !api.control || (pending && !pendingRead)) return;
    watchControllers.current.get(target.id)?.abort(); watchControllers.current.delete(target.id);
    setWatching(watchControllers.current.size > 0);
    const data = await run(() => api.control!({jobId: target.id, action}),undefined,false,undefined,false,[],target.id);
    if (!data && target.status !== "paused") watchJob(target, target.kind === "plan" ? "plan" : "evaluation");
  }
  async function run(work: () => Promise<IntentWorkspace>, next?: View, restoreJob = false, modelKind?: "evaluate" | "plan", readOnly = false, requestQuestionIds: string[] = [], failureJobId?:string) {
    if (running.current && (readOnly || !runningRead.current)) return;
    const sequence=++runSequence.current;
    const errorJobId=failureJobId??(!modelKind&&viewRef.current==="progress"?progressJobIdRef.current:undefined);
    if(errorJobId)setTaskError(errorJobId,"");
    running.current = true; runningRead.current = readOnly; setPending(true); setPendingRead(readOnly); setError("");
    setSubmittingIds(requestQuestionIds);
    if (modelKind) {setProgressKind(modelKind); setProgressJobId(failureJobId);progressJobIdRef.current=failureJobId;setSubmissionRejected(false); setView("progress");}
    const navigation = navigationVersion.current;
    const ownsNavigation = () => navigation === navigationVersion.current && !draftDirtyRef.current;
    const destination = next ?? (view === "progress" ? "evaluation" : view);
    const version = generation.current;
    const priorJob = workspace?.state.jobs?.at(-1);
    const current = () => mounted.current && version === generation.current;
    try {
      let data = await work();
      if (!current()) return;
      applyWorkspace(data);
      if(errorJobId)setTaskError(errorJobId,"");
      data = workspaceRef.current!;
      // A background read must not release a newer write's lock or steal its page.
      if(sequence!==runSequence.current)return data;
      const latest = data.state.jobs?.at(-1);
      if (latest?.status === "failed" && (!errorJobId||latest.id===errorJobId||Boolean(modelKind)) &&
          (!modelKind||(latest.kind===modelKind&&requestQuestionIds.every(id=>latest.questionIds.includes(id)))) &&
          (latest.id !== priorJob?.id || priorJob?.status !== "failed"))
        throw new Error(latest.error ?? "模型生成失败，请重新评估");
      const jobs = data.state.jobs?.filter(item => !["succeeded", "failed"].includes(item.status)) ?? [];
      const job = modelKind ? jobs.find(item => item.kind === modelKind &&
        requestQuestionIds.every(id => item.questionIds.includes(id))) :
        restoreJob&&viewRef.current==="progress" ? jobs.find(item=>item.id===progressJobIdRef.current) :
        jobs.find(item => item.id === progressJobIdRef.current) ?? jobs[0];
      const completed = restoreJob && ownsNavigation() && viewRef.current === "progress" ? data.state.jobs?.find(item =>
        item.id === progressJobId && item.status === "succeeded") : undefined;
      if (completed) {
        setHistoryQuestionId(undefined);
        setScope(completed.questionIds); setIndex(0); setExpanded([]); setSingleQueue([]);
        if (completed.receiptId && data.state.receipts.some(item => item.id === completed.receiptId)) {
          setReceiptId(completed.receiptId); setView("result");
        } else if (completed.kind === "plan") {
          const saved = data.state.plans.filter(item => completed.questionIds.includes(item.questionId) &&
            (!completed.inputHash || item.inputHash === completed.inputHash));
          if (saved.length === completed.questionIds.length) {
            loadDrafts(structuredClone(saved.map(knowledgeOnlyIntentPlan))); setDraftDirty(false); setView("plan");
          } else if (completed.result) {setHistoryId(completed.id); setView("history-detail");}
          else setView("evaluation");
        } else if (completed.result && completed.questionIds.some(id =>
          !data.state.evaluations.some(item => item.questionId === id && item.provenance?.operationId === completed.id))) {
          setHistoryId(completed.id); setView("history-detail");
        } else setView("evaluation");
        return data;
      }
      if(readOnly&&restoreJob&&ownsNavigation()&&viewRef.current==="progress"&&errorJobId&&
          !data.state.jobs?.some(item=>item.id===errorJobId)){
        setTaskError(errorJobId,"尚未读取到本次任务，请稍后重新读取确认；请勿重复提交。");
        return data;
      }
      if (next && ownsNavigation()) setView(next);
      if (job && restoreJob && ownsNavigation() && viewRef.current === "progress") {
        setScope(job.questionIds); setIndex(0); setExpanded([]); setSingleQueue([]);
      }
      if (job) {
        if (ownsNavigation() || !progressJobIdRef.current) {setProgressKind(job.kind); setProgressJobId(job.id); progressJobIdRef.current = job.id;}
        if (ownsNavigation() && (modelKind || viewRef.current === "progress")) setView("progress");
        for (const currentJob of data.state.jobs?.filter(item => !["succeeded", "failed"].includes(item.status)) ?? [])
          watchJob(currentJob, currentJob.receiptId ? "result" : currentJob.kind === "plan" ? "plan" : "evaluation");
        return data;
      }
      if (current()) {
        applyWorkspace(data);
        if ((next || modelKind) && ownsNavigation()) setView(destination);
        return data;
      }
    }
    catch (cause) {if (current() && sequence===runSequence.current) {
      const message=cause instanceof Error?cause.message:"操作失败，请重试";
      if(errorJobId)setTaskError(errorJobId,message);else setError(message,navigation);
      if(modelKind){setError(message,navigation);setSubmissionRejected(isRejectedIntentRequest(cause));}
    }}
    finally {if (current() && sequence===runSequence.current) {running.current = false; runningRead.current = false; setPending(false); setSubmittingIds([]);}}
  }
  const questions = workspace?.state.questions ?? [];
  const evaluations = workspace?.state.evaluations ?? [];
  const activeJobs = workspace?.state.jobs?.filter(item => !["succeeded", "failed"].includes(item.status)) ?? [];
  const activeJob = activeJobs[0];
  const initialListLoading = view === "list" && !workspace && !error;
  const listTask = activeJob ?? workspace?.state.jobs?.find(item => item.id === progressJobId);
  const listEvaluation = view === "list" && listTask && !dismissedCompletionIds.includes(listTask.id) ? listTask : undefined;
  const completedTasks=(workspace?.state.jobs??[]).filter(job=>job.status==="succeeded"&&!dismissedCompletionIds.includes(job.id)).slice().reverse();
  const listTasks = view === "list" ? [...activeJobs,...completedTasks,...(listEvaluation?.status==="failed"?[listEvaluation]:[])] : [];
  const refreshingList = view === "list" && Boolean(workspace) && pending && pendingRead && !activeJob;
  const receipt = receiptId ? workspace?.state.receipts.find(item => item.id === receiptId) : workspace?.state.receipts.at(-1);
  // The ledger appends newly added questions; reverse that order for newest first.
  const newestOrder = new Map(questions.map((question, position) => [question.id, position]));
  const scoreByQuestion = new Map(evaluations.map(item => [item.questionId, item]));
  const filtered = questions.filter(question => {
    if (!question.question.toLowerCase().includes(search.toLowerCase())) return false;
    if (!catalogIntegration?.answerStatuses) return true;
    if (category !== "all" && question.category !== category) return false;
    if (answerStatus === "all") return true;
    const evaluation = evaluations.find(item => item.questionId === question.id);
    if (answerStatus === "unevaluated") return !evaluation;
    if (["supported", "partial", "missing"].includes(answerStatus)) return Boolean(evaluation && (evaluation.support >= 80 ? "supported" : evaluation.support >= 50 ? "partial" : "missing") === answerStatus);
    return (catalogIntegration.answerStatuses[question.id] ?? "unknown") === answerStatus;
  })
    .sort((a, b) => {
      const newestFirst = newestOrder.get(b.id)! - newestOrder.get(a.id)!;
      if (sort === "newest") return newestFirst;
      const left = scoreByQuestion.get(a.id)?.[sort], right = scoreByQuestion.get(b.id)?.[sort];
      // Unknown scores are not zero. Keep unevaluated questions after numeric scores.
      if (left == null || right == null) return left == null && right == null ? newestFirst : left == null ? 1 : -1;
      return left - right || newestFirst;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 10, (currentPage + 1) * 10);
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  const revision = workspace?.revision ?? 0;
  const command = (input: Record<string, unknown>) => {
    const model = ["evaluate", "plan"].includes(String(input.kind));
    const ids = model ? input.questionIds as string[] : [];
    const expectedQuestions = questions.filter(question => ids.includes(question.id)).map(intentQuestionSnapshot);
    if (model && expectedQuestions.length !== new Set(ids).size)
      return Promise.reject(new Error("所选问题已变化，请重新读取并确认问题后再提交"));
    return api.command({...input, expectedRevision: workspaceRef.current?.revision ?? revision,
      ...(model ? {clientRequestId: input.clientRequestId ?? crypto.randomUUID(), expectedQuestions} : {})});
  };
  function openQuestionAction(kind: "edit" | "delete", question: IntentQuestion) {
    if (questionSaving.current) return;
    navigationVersion.current++;
    setQuestionError(""); setQuestionAction({kind, question});
    setQuestionDraft({question: question.question});
  }
  /** Approved v3 behavior: deleting from the checklist runs immediately; the old
   *  confirmation dialog is replaced by an undo bar. Host questions are dismissed
   *  server-side (the host catalog stays authoritative and re-checking there
   *  restores them); manually added questions come back through intake. */
  async function deleteQuestionNow(question: IntentQuestion) {
    if (questionSaving.current) return;
    navigationVersion.current++;
    setQuestionError("");
    questionSaving.current = true; setSavingQuestionId(question.id);
    const version = generation.current;
    const currentSession = () => mounted.current && generation.current === version;
    try {
      const current = await api.observe();
      if (!currentSession()) return;
      applyWorkspace(current);
      const data = await command({kind: "delete-question", questionId: question.id});
      if (!currentSession()) return;
      applyWorkspace(data);
      setSelected(ids => ids.filter(id => id !== question.id));
      setReceived(ids => ids.filter(id => id !== question.id));
      setScope(ids => ids.filter(id => id !== question.id));
      setSingleQueue(ids => ids.filter(id => id !== question.id));
      setDeletedRecently(question);
    } catch (cause) {
      if (currentSession()) setError(cause instanceof Error ? cause.message : "删除失败，请重试");
    } finally {
      if (currentSession()) {questionSaving.current = false; setSavingQuestionId(undefined);}
    }
  }
  async function undoDeleteQuestion() {
    const question = deletedRecently;
    if (!question || questionSaving.current) return;
    questionSaving.current = true;
    const version = generation.current;
    const currentSession = () => mounted.current && generation.current === version;
    try {
      setDeletedRecently(null);
      const data = await command(question.tableId === HOST_QUESTION_TABLE_ID
        ? {kind: "restore-question", questionId: question.id}
        : {kind: "intake", questions: [question]});
      if (!currentSession()) return;
      applyWorkspace(data);
    } catch (cause) {
      if (currentSession()) setError(cause instanceof Error ? cause.message : "恢复失败，请重新添加该问题");
    } finally {
      if (currentSession()) questionSaving.current = false;
    }
  }
  async function saveQuestionAction() {
    if (!questionAction || questionSaving.current) return;
    const {kind, question} = questionAction;
    if (kind === "edit" && questionDraft.question.trim().length < 2) {
      setQuestionError("请填写至少 2 个字的问题"); return;
    }
    setQuestionError("");
    questionSaving.current = true; setSavingQuestionId(question.id);
    const version = generation.current;
    const currentSession = () => mounted.current && generation.current === version;
    try {
      // The task can advance while the dialog is open. Read its latest ledger
      // before this independent write; the server still checks target and revision.
      const current = await api.observe();
      if (!currentSession()) return;
      applyWorkspace(current);
      const data = await command(kind === "edit"
          ? {kind: "update-question", questionId: question.id, question: questionDraft.question.trim(),
            category: question.category, subdivision: question.subdivision}
          : {kind: "delete-question", questionId: question.id});
      if (!currentSession()) return;
      applyWorkspace(data);
      if (kind === "delete") {
        setSelected(ids => ids.filter(id => id !== question.id));
        setReceived(ids => ids.filter(id => id !== question.id));
        setScope(ids => ids.filter(id => id !== question.id));
        setSingleQueue(ids => ids.filter(id => id !== question.id));
      }
      setQuestionAction(null);
    } catch (cause) {
      if (currentSession()) setQuestionError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      if (currentSession()) {questionSaving.current = false; setSavingQuestionId(undefined);}
    }
  }
  async function evaluate(ids: string[], force = false) {
    if (!ids.length) return;
    const missing = force ? ids : ids.filter(id => !evaluations.some(item => item.questionId === id));
    const conflict = activeJobs.find(job => job.questionIds.some(id => missing.includes(id)));
    if (missing.length && conflict) {openTaskDetails(conflict.id, view === "universe" ? "universe" : "list"); return;}
    if (missing.length && submittingIds.some(id => missing.includes(id))) return;
    if (missing.length && running.current && !runningRead.current) {setError("工作台正在保存，请稍后重试。"); return;}
    if (view === "universe" || view === "list") setEvaluationReturnView(view);
    setScope(ids); setIndex(0); setExpanded([]);
    setSingleQueue(ids.length === 1 ? [...new Set([ids[0], ...filtered.filter(item =>
      evaluations.some(evaluation => evaluation.questionId === item.id)).map(item => item.id)])] : []);
    navigateView("evaluation");
    if (!missing.length) return;
    const requestId=crypto.randomUUID();
    await run(() => command({kind: "evaluate", questionIds: missing,clientRequestId:requestId}), "evaluation", false, "evaluate", false, missing,requestId);
  }
  async function nextEvaluation() {
    const next = singleQueue[singleQueue.indexOf(scope[0]) + 1];
    if (!next) return;
    navigationVersion.current++;
    setScope([next]); setIndex(0);
    // Next browses saved evaluations. Creating another model task is explicit.
  }
  async function addToCatalog(selections: Selection[]) {
    if (!selections.length || (running.current && !runningRead.current)) return;
    const version = generation.current;
    setIntakeFeedback("saving");
    const incoming = [...new Map(selections.map(item => [`${item.tableId}:${item.rowIndex}`, {
      id: `${item.tableId}:${item.rowIndex}`, question: item.question, category: item.category,
      subdivision: "", tableId: item.tableId, rowIndex: item.rowIndex, sourceRevision: item.dashboardRevision ?? null,
    }])).values()];
    // A lost response may have saved the previous intake. Read first, link to
    // existing questions/results, and submit only genuinely missing entries.
    const data = await run(async () => {
      const current = await api.observe();
      const missing = incoming.filter(item => !findCatalogQuestion(item, current.state.questions));
      const saved = missing.length ? await api.command({kind: "intake", expectedRevision: current.revision, questions: missing}) : current;
      if (incoming.some(item => !findCatalogQuestion(item, saved.state.questions)))
        throw new Error("所选词条未能完整加入，请重试加入优化清单。");
      return saved;
    }, "list");
    if (!mounted.current || version !== generation.current) return;
    if (!data) {setIntakeFeedback(null); return;}
    setIntakeFeedback("success");
    const ids = [...new Set(incoming.map(item => findCatalogQuestion(item, data.state.questions)?.id).filter((id): id is string => Boolean(id)))];
    setReceived(ids); setSelected(ids); setScope(ids); setIndex(0); setExpanded([]); setSingleQueue([]);
    setSearch(""); setSort("newest"); setPage(0);
    emittedSection.current = "list"; onSectionChange?.("list");
  }
  async function evaluateFromKeywords(selection: Selection) {
    if (running.current && !runningRead.current) return;
    const incoming = {
      id: `${selection.tableId}:${selection.rowIndex}`, question: selection.question, category: selection.category,
      subdivision: "", tableId: selection.tableId, rowIndex: selection.rowIndex, sourceRevision: selection.dashboardRevision ?? null,
    };
    // Resolve the durable question and latest revision before creating a task.
    // Keep the source table open while the existing watcher updates its score.
    const version = generation.current;
    setPendingEvaluationKeyword({tableId: selection.tableId, rowIndex: selection.rowIndex});
    try {
      await run(async () => {
        const current = await api.observe();
        const saved = findCatalogQuestion(incoming, current.state.questions) ? current
          : await api.command({kind: "intake", expectedRevision: current.revision, questions: [incoming]});
        const target = findCatalogQuestion(incoming, saved.state.questions);
        if (!target) throw new Error("词条未能保存，评估尚未开始，请重试。");
        if (saved.state.evaluations.some(item => item.questionId === target.id)) return saved;
        if (saved.state.jobs?.some(job => !["succeeded", "failed"].includes(job.status) && job.questionIds.includes(target.id)))
          throw new Error("该问题已有任务正在处理，请查看该问题的任务后继续。");
        return api.command({kind: "evaluate", expectedRevision: saved.revision, questionIds: [target.id], clientRequestId: crypto.randomUUID(),
          expectedQuestions: [intentQuestionSnapshot(target)]});
      }, undefined, false, undefined, false, [findCatalogQuestion(incoming, workspace?.state.questions ?? [])?.id ?? incoming.id]);
    } finally {
      if (mounted.current && version === generation.current) setPendingEvaluationKeyword(null);
    }
  }
  async function plan(force = false, ids = scope) {
    if (!workspace || !ids.length) return;
    const missing = force ? ids : ids.filter(id => !findCurrentIntentPlan(workspace, id)?.actions.length);
    const existing = workspaceRef.current?.state.jobs?.find(job => job.kind === "plan" &&
      !["succeeded", "failed"].includes(job.status) && job.questionIds.some(id => missing.includes(id)));
    if (existing) {openTaskDetails(existing.id, view === "universe" ? "universe" : "list"); return;}
    if (missing.some(id => planSubmissions.current.has(id))) return;
    setScope(ids);
    navigationVersion.current++;
    if (!missing.length) {
      loadDrafts(ids.map(id => structuredClone(findCurrentIntentPlan(workspace, id)!)));
      setDraftDirty(false); setView("plan"); return;
    }
    const navigation = navigationVersion.current;
    missing.forEach(id => planSubmissions.current.add(id));
    const version = generation.current, requestId = crypto.randomUUID();
    const currentSession = () => mounted.current && generation.current === version;
    setProgressKind("plan"); setProgressJobId(requestId); progressJobIdRef.current = requestId;
    setView("progress"); setError("");setSubmissionRejected(false);setTaskError(requestId,"");
    try {
      const current = await api.observe();
      if (!currentSession()) return;
      applyWorkspace(current);
      const existing = current.state.jobs?.find(job => job.kind === "plan" &&
        !["succeeded", "failed"].includes(job.status) && job.questionIds.some(id => missing.includes(id)));
      const data = existing ? current : await command({kind: "plan", questionIds: missing, clientRequestId: requestId});
      if (!currentSession()) return;
      applyWorkspace(data);
      const job = existing ?? data.state.jobs?.find(item => item.kind === "plan" && item.questionIds.some(id => missing.includes(id)) &&
        !["succeeded", "failed"].includes(item.status));
      if (job) {
        if (navigation === navigationVersion.current) {setProgressJobId(job.id); progressJobIdRef.current = job.id;}
        watchJob(job, "plan");
      } else if (navigation === navigationVersion.current && !draftDirtyRef.current) {
        loadDrafts(structuredClone(data.state.plans.filter(item => ids.includes(item.questionId)).map(knowledgeOnlyIntentPlan)));
        setDraftDirty(false); setView("plan");
      }
    } catch (cause) {
      if (currentSession()) {
        const message=cause instanceof Error?cause.message:"生成方案失败，请重试";
        setTaskError(requestId,message);setError(message,navigation);setSubmissionRejected(isRejectedIntentRequest(cause));
      }
    } finally {if (currentSession()) missing.forEach(id => planSubmissions.current.delete(id));}
  }
  async function execute() {
    if (!workspace || executingRef.current || draftSaving.current) return;
    if (activeJobs.some(job => job.questionIds.some(id => scope.includes(id)))) {
      setError("所选问题仍有任务正在处理，请先完成该问题的任务；其他问题的任务不影响执行。"); return;
    }
    const validDrafts = drafts.filter(draft => scope.includes(draft.questionId)).map(knowledgeOnlyIntentPlan);
    if (!validDrafts.length || validDrafts.some(draft => !draft.actions.length)) {setError("方案没有可执行的知识库优化动作，请重新生成方案"); return;}
    if (validDrafts.some(draft => draft.actions.some(action => action.selected && !action.after.trim()))) {setError("请填写已选动作的修改内容"); return;}
    const executingDraftVersion = draftVersion.current;
    const version = generation.current;
    const currentSession = () => mounted.current && generation.current === version;
    executingRef.current = true; setExecuting(true); setError("");
    navigateView("result");
    const navigation = navigationVersion.current;
    try {
      let current = await api.observe();
      if (!currentSession()) return;
      applyWorkspace(current);
      current = workspaceRef.current!;
      const existing = executeId.current && current.state.receipts.find(item => item.id === executeId.current);
      if (!existing) for (const draft of validDrafts) {
        const base = findSavedIntentPlan(current.state, draft.questionId);
        if (!base) throw new Error("此问题的方案已变化，请重新读取后核对；草稿已保留");
        current = await api.command({kind: "edit", expectedRevision: current.revision, questionId: draft.questionId,
          expectedPlan: draftBases.current.get(draft.questionId) ?? intentPlanSnapshot(base), actions: draft.actions.map(({id, selected, after}) => ({id, selected, after}))});
        if (!currentSession()) return;
        applyWorkspace(current);
        const acknowledged=findSavedIntentPlan(current.state,draft.questionId);
        if(acknowledged)draftBases.current.set(draft.questionId,intentPlanSnapshot(acknowledged));
      }
      // A rejected execution must keep the acknowledged draft and revision,
      // rather than exposing an unrelated historical receipt as its result.
      applyWorkspace(current);
      if (executingDraftVersion === draftVersion.current) {
        // run() checks this ref before React commits the state update. The
        // acknowledged draft must not block its own result navigation.
        draftDirtyRef.current = false;
        setDraftDirty(false);
      }
      executeId.current ??= crypto.randomUUID();
      const approved = current.state.plans.filter(plan => scope.includes(plan.questionId)).map(intentPlanSnapshot);
      const result = existing && existing.status !== "running" ? current : await api.execute({expectedRevision: current.revision,
        clientRequestId: executeId.current, questionIds: scope, ...(existing ? {} : {expectedPlans: approved})});
      if (!currentSession()) return;
      if (!result.state.receipts.some(item => item.id === executeId.current))
        throw new Error("尚未取得本次执行记录。方案和勾选已保留，请重新读取确认执行状态。");
      setReceiptId(executeId.current);
      applyWorkspace(result);
      executeId.current = undefined;
      if (navigation === navigationVersion.current) navigateView("result");
      for (const job of result.state.jobs?.filter(job => !["succeeded", "failed"].includes(job.status)) ?? [])
        watchJob(job, job.receiptId ? "result" : job.kind === "plan" ? "plan" : "evaluation");
    } catch (cause) {
      if (currentSession()) {
        const ownsNavigation=navigation===navigationVersion.current;
        if (ownsNavigation) navigateView("plan");
        setError(cause instanceof Error ? cause.message : "执行尚未确认，草稿已保留，请重新读取后核对",ownsNavigation?navigationVersion.current:navigation);
      }
    } finally {if (currentSession()) {executingRef.current = false; setExecuting(false);}}
  }
  function changeDraft(plan: IntentPlan) {draftVersion.current++; setDrafts(items => items.map(item => item.questionId === plan.questionId ? plan : item)); setDraftDirty(true);}
  function openKnowledge(target?: string) {
    const changedNode=target??receipt?.changes.find(change=>change.action.kind==="node"&&["succeeded","reverted"].includes(change.status))?.action.nodeId??undefined;
    if(onOpenKnowledge){onOpenKnowledge(changedNode,receipt);return;}
    setNodeId(changedNode);navigateView("knowledge");
  }
  const evaluated = scope.map(id => evaluations.find(item => item.questionId === id)).filter((item): item is IntentEvaluation => Boolean(item));
  const activeEvaluation = evaluated[index] ?? evaluated[0];
  useEffect(() => {
    if (view === "evaluation" && workspace && !pending && !activeEvaluation) navigateView(evaluationReturnView);
  }, [view, workspace, pending, activeEvaluation, evaluationReturnView]);
  const history = [...(workspace?.state.jobs ?? [])].filter(job => job.status === "succeeded" && job.result).reverse();
  const archived = history.find(job => job.id === historyId)?.result;
  const savedPlanIds = workspace ? questions.filter(question => findCurrentIntentPlan(workspace, question.id)).map(question => question.id) : [];
  function openSavedPlan(id: string) {
    const saved = workspace && findCurrentIntentPlan(workspace, id);
    if (saved) {
      if (view === "list") setEvaluationReturnView("list");
      setScope([id]); setIndex(0); setExpanded([]); setSingleQueue([]);
      loadDrafts([structuredClone(saved)]); setDraftDirty(false); navigateView("plan");
    }
  }
  function openTaskDetails(jobId: string, returnView: "universe" | "list") {
    const job = workspace?.state.jobs?.find(item => item.id === jobId);
    if (!job) return;
    setError("");setSubmissionRejected(false);
    // Inspect the selected task without submitting or restarting its watcher.
    setEvaluationReturnView(returnView); setScope(job.questionIds); setIndex(0);
    setExpanded([]); setSingleQueue([]); setProgressJobId(job.id);
    progressJobIdRef.current = job.id; setProgressKind(job.kind); navigateView("progress");
  }
  async function openCompletedEvaluation(jobId: string) {
    const job = workspace?.state.jobs?.find(item => item.id === jobId && item.status === "succeeded");
    if (!job) return;
    if (job.result && job.questionIds.some(id => !workspace?.state.questions.some(question => question.id === id &&
      job.result!.questions.some(original => original.id === id && original.question === question.question &&
        original.category === question.category && original.subdivision === question.subdivision)))) {
      setHistoryId(job.id); setHistoryQuestionId(undefined); navigateView("history-detail"); markCompletionViewed(job.id); return;
    }
    // Completion already supplied validated results. Viewing never evaluates again.
    setEvaluationReturnView("list"); setScope(job.questionIds); setIndex(0);
    setExpanded([]); setSingleQueue([]);
    const hasResults = (data: IntentWorkspace) => job.questionIds.every(id => {
      const item = data.state.evaluations.find(item => item.questionId === id);
      if (!item || (item.provenance?.operationId && item.provenance.operationId !== job.id)) return false;
      const saved = data.state.jobs?.find(item => item.id === job.id)?.result?.evaluations.find(item => item.questionId === id);
      if (saved) return saved.evaluatedAt === item.evaluatedAt;
      const created = Date.parse(job.createdAt ?? "");
      return !Number.isFinite(created) || Date.parse(item.evaluatedAt) >= created;
    });
    if (workspace && hasResults(workspace)) {
      setError(""); navigateView("evaluation"); markCompletionViewed(job.id); return;
    }
    if(workspace&&job.result&&!hasResults(workspace)) {
      setHistoryId(job.id);setHistoryQuestionId(undefined);navigateView("history-detail");markCompletionViewed(job.id);return;
    }
    // The terminal event can arrive before its result snapshot. Recover by reading.
    const loaded=await run(async () => {
      const current = await api.observe();
      if (!hasResults(current))
        throw new Error("评估结果尚未完整读取，请重新读取。");
      return current;
    }, "evaluation", false, undefined, true);
    if(loaded&&hasResults(loaded))markCompletionViewed(job.id);
  }
  const evaluationReturnLabel = evaluationReturnView === "universe" ? "已保存词条" : "问题列表";
  const retainKeywordPage = view === "universe" || (evaluationReturnView === "universe" && ["progress", "evaluation", "plan"].includes(view));
  function openSection(section: "universe" | "list") {navigateView(section); emittedSection.current = section; onSectionChange?.(section);}
  return <div ref={container} className={`iw-workbench iw-view-${view}`} aria-busy={pending || executing}>
    <IntentIntakeFeedback state={intakeFeedback}/>
    {view === "history-detail" && workspace && <>
      <button className="iw-back" onClick={() => {
        setHistoryId(undefined); setHistoryQuestionId(undefined); openSection("list");
      }}><ArrowLeft size={15}/>返回问题列表</button>
      <header className="iw-header iw-saved-header"><h1>已保存任务结果</h1></header>
      {archived && <section className="iw-saved-result" aria-label="已保存任务详情">
        {archived.evaluations.filter(item => !historyQuestionId || item.questionId === historyQuestionId).map(item => <section key={item.questionId} className="iw-plan-section iw-saved-question">
          <div className="iw-saved-question-header">
            <h2>{archived.questions.find(question => question.id === item.questionId)?.question}</h2>
            {catalogIntegration?.onOpenAnswer && questions.find(question => question.id === item.questionId) && <button onClick={() => catalogIntegration.onOpenAnswer?.(questions.find(question => question.id === item.questionId)!)}>进入应答逻辑<ArrowRight size={16}/></button>}
          </div>
          <Evaluation item={item}/>
          {archived.plans.filter(plan => plan.questionId === item.questionId).map(plan => <section className="iw-panel iw-saved-plan" key={plan.questionId}>
            <h3>已保存优化方案</h3><div className="iw-saved-actions">{plan.actions.map((action, actionIndex) => <details className="iw-saved-action" key={action.id}>
              <summary><span className="iw-saved-action-index" aria-hidden="true">{actionIndex + 1}</span><span>{action.title}</span><ChevronDown size={18} aria-hidden="true"/></summary>
              <div className="iw-saved-action-body">
                <p className="iw-saved-action-source">{action.source}</p>
                <div className="iw-saved-content-grid">
                  <section><h4>修改前</h4><MarkdownRenderer content={action.before || "无"}/></section>
                  <section><h4>建议内容</h4><MarkdownRenderer content={action.after}/></section>
                </div>
              </div>
            </details>)}</div>
          </section>)}
        </section>)}
      </section>}
      {!archived && <section className="iw-panel" role="status">未找到该任务的已保存结果，请返回问题列表后重新选择任务。</section>}
    </>}
    {error && view !== "progress" && (view==="list"||errorNavigation.current===navigationVersion.current) && <div className="iw-error" role="alert">{error}<button disabled={pending} onClick={() => void run(() => api.observe(), undefined, true, undefined, true)}>重新读取</button></div>}
    {view === "progress" && <IntentTaskProgress job={workspace?.state.jobs?.find(item => item.id === progressJobId)}
      kind={progressKind} error={(progressJobId?taskErrors[progressJobId]:errorNavigation.current===navigationVersion.current?error:"")??""} pending={pending} updating={watching} submissionRejected={submissionRejected}
      onPause={api.control ? () => void controlJob("pause") : undefined} onResume={api.control ? () => void controlJob("resume") : undefined}
      onRetry={() => {const failed=workspace?.state.jobs?.find(item=>item.id===progressJobId);
        if(failed?.status!=="failed")return;
        if(failed.kind==="plan")void plan(true,failed.questionIds);else void evaluate(failed.questionIds,true);}}
      returnLabel={evaluationReturnLabel}
      onBack={() => navigateView(evaluationReturnView)}
      onViewResult={() => void run(() => api.observe(), undefined, true, undefined, true)}/>}
    {!pending && !error && view !== "progress" && workspace?.state.jobs?.at(-1)?.status === "failed" &&
      workspace.state.jobs.at(-1)!.id !== dismissedFailureId && <div className="iw-error" role="alert">{workspace.state.jobs.at(-1)!.error}
      <button disabled={pending} onClick={() => {const failed = workspace.state.jobs?.at(-1);
        if (!failed) return;
        if (failed.kind === "plan") void plan(true, failed.questionIds); else void evaluate(failed.questionIds, true);}}>重试本次任务</button>
      <button disabled={pending} onClick={() => {const failed = workspace.state.jobs?.at(-1);
        if (failed) setDismissedFailureId(failed.id);}}>知道了</button></div>}
    {retainKeywordPage && <div className="iw-enter" hidden={view !== "universe"}><header className="iw-header iw-universe-header"><div><h1>词条生成</h1></div></header><ManagedKeywordTables {...keywordProps} onUseQuestion={selection => addToCatalog([selection])} onUseQuestions={items => addToCatalog(items)}
      onOptimizationSavingChange={saving => setIntakeFeedback(state => saving ? "saving" : state === "saving" ? null : state)}
      optimizationState={workspace?.state} onViewEvaluation={id => void evaluate([id])}
      onViewEvaluationTask={id => openTaskDetails(id, "universe")}
      onEvaluateQuestion={selection => void evaluateFromKeywords(selection)} evaluationPending={pending && !pendingRead}
      evaluationPendingKeyword={pendingEvaluationKeyword}/></div>}
    {initialListLoading && <IntentListInitialLoading/>}
    {view !== "universe" && view !== "list" && !workspace && !error && <div role="status" className="iw-empty">正在读取优化工作台…</div>}
    {view === "list" && workspace && <div className="iw-enter">
      {deletedRecently && <div className="iw-undo-bar" role="status">
        <b>{deletedRecently.question}</b>
        <span>已从优化清单删除</span>
        <button type="button" onClick={() => void undoDeleteQuestion()}>撤销删除</button>
        <button type="button" aria-label="关闭删除提示" onClick={() => setDeletedRecently(null)}>×</button>
      </div>}
      <IntentQuestionCatalog questions={questions} visible={visible} evaluations={evaluations} activeJobs={activeJobs} received={received} integration={{
        ...catalogIntegration,
        onOpenAnswer: catalogIntegration?.onOpenAnswer ? question => {
          navigationVersion.current++;
          onCatalogExit?.({search, category: "all", status: "all", sort, page: currentPage, selected, expandedGaps, questionId: question.id});
          catalogIntegration.onOpenAnswer?.(question);
        } : undefined,
        onEditQuestion: catalogIntegration?.onEditQuestion ?? (question => openQuestionAction("edit", question)),
        onDeleteQuestion: catalogIntegration?.onDeleteQuestion ?? (question => void deleteQuestionNow(question)),
      }}
        headerStatus={refreshingList ? <IntentListRefreshStatus/> : undefined}
        taskFeedback={listTasks.length ? <IntentTaskTray jobs={listTasks} attentionIds={Object.keys(taskErrors).filter(id=>Boolean(taskErrors[id]))}>{listTasks.map((job,position) => <Fragment key={job.id}>{job.status==="succeeded"&&listTasks[position-1]?.status!=="succeeded"&&<div className="iw-task-tray-completed-header"><h4 className="iw-task-tray-completed-heading">已完成</h4><button type="button" className="iw-task-tray-read-all" onClick={()=>markCompletionsViewed(completedTasks.map(task=>task.id))}>全部已读</button></div>}<IntentListEvaluationStatus
          job={job} uncertain={Boolean(taskErrors[job.id])} pending={pending && !pendingRead}
          taskError={taskErrors[job.id]} onRefresh={()=>void run(()=>api.observe(),undefined,false,undefined,true,[],job.id)}
          questionLabel={job.questionIds.map(id => questions.find(question => question.id === id)?.question ?? "历史问题").join("；")}
          onViewResult={() => {
            if (job.kind !== "plan") {void openCompletedEvaluation(job.id); return;}
            const saved = job.questionIds.flatMap(id => {const plan = findCurrentIntentPlan(workspace, id); return plan ? [structuredClone(plan)] : [];});
            if (saved.length === job.questionIds.length) {setScope(job.questionIds); setIndex(0); loadDrafts(saved); setDraftDirty(false); navigateView("plan");}
            else if(job.result) {setHistoryId(job.id); setHistoryQuestionId(undefined); navigateView("history-detail");}
            else {setTaskError(job.id,"方案结果尚未完整读取，请重新读取后查看。");return;}
            markCompletionViewed(job.id);
          }}
          onPause={api.control ? () => void controlJob("pause", job.id) : undefined} onResume={api.control ? () => void controlJob("resume", job.id) : undefined}
          onViewTask={() => openTaskDetails(job.id, "list")}/></Fragment>)}</IntentTaskTray> : undefined}
        savedPlanIds={savedPlanIds} onViewPlan={openSavedPlan} onGeneratePlan={id => void plan(false, [id])}
        expandedGaps={expandedGaps} onGapToggle={(id, open) => setExpandedGaps(ids => open ? ids.includes(id) ? ids : [...ids,id] : ids.filter(item => item !== id))}
        search={search} sort={sort} onSort={value => {setSort(value); setPage(0);}} selected={selected} pending={pending && !pendingRead}
        mutationBlockedIds={savingQuestionId ? [savingQuestionId] : []}
        page={currentPage} pageCount={pageCount} total={filtered.length}
        category={category} status={answerStatus} onCategory={value => {setCategory(value);setPage(0);}} onStatus={value => {setAnswerStatus(value);setPage(0);}}
        onSearch={value => {setSearch(value); setPage(0);}}
        onToggle={toggle} onClear={() => setSelected([])} onEvaluate={ids => void evaluate(ids)} onPage={setPage}
        onSelectPage={checked => setSelected(ids => checked ? [...new Set([...ids, ...visible.map(item => item.id)])] : ids.filter(id => !visible.some(item => item.id === id)))}/>
      {workspace.state.receipts.some(item => item.status === "running") && <div className="iw-sticky"><span>有执行尚未确认完成</span><button disabled={pending} onClick={() => {const runningReceipt = workspace.state.receipts.find(item => item.status === "running")!; setReceiptId(runningReceipt.id); setView("result"); void run(() => api.execute({expectedRevision: revision, clientRequestId: runningReceipt.id, questionIds: [...new Set(runningReceipt.changes.map(change => change.questionId))]}));}}>继续原执行</button></div>}
    </div>}
    {view === "evaluation" && pending && !activeEvaluation && <><button className="iw-back" onClick={() => navigateView(evaluationReturnView)}><ArrowLeft size={15}/>返回{evaluationReturnLabel}</button><header className="iw-header"><div><h1>{activeJob?.kind === "plan" ? "正在生成优化方案" : `正在评估 ${scope.length} 条问题`}</h1><p>任务完成后显示最新评估结果，请勿重复提交。</p></div></header><Steps step={activeJob?.kind === "plan" ? 1 : 0}/></>}
    {view === "evaluation" && activeEvaluation && <>
      <button className="iw-back" onClick={() => navigateView(evaluationReturnView)}><ArrowLeft size={15}/>返回{evaluationReturnLabel}</button>
      <header className="iw-header iw-evaluation-header">
        <div className="iw-evaluation-question">
          <span className="iw-question-mark" aria-hidden="true"><MessageSquareText size={20}/></span>
          <div className="iw-question-heading"><span className="iw-question-caption">{scope.length > 1 ? "评估概览" : "当前评估问题"}</span>
            <h1>{scope.length > 1 ? "批量评估结果" : questions.find(item => item.id === activeEvaluation.questionId)?.question}</h1>
            <p>查看问题价值、必要回答要点与可引用的知识依据。</p>
          </div>
        </div>
        {scope.length === 1 && <div className="iw-question-navigation"><span className="iw-tag">{Math.max(1, singleQueue.indexOf(scope[0]) + 1)} / {Math.max(1, singleQueue.length)}</span>
          <button disabled={!singleQueue[singleQueue.indexOf(scope[0]) + 1]} onClick={() => void nextEvaluation()}>下一条 <ArrowRight size={15}/></button>
        </div>}
      </header><Steps step={0}/>
      <p className="iw-method">正在查看已保存的评估结果；“重新评估”会基于当前知识库创建新任务。</p>
      {scope.length > 1 && <><p className="iw-method">每个问题独立评估、独立生成建议，最后统一确认和执行。</p><div className="iw-batch-summary">{[
        ["已评估问题", `${evaluated.length} / ${scope.length} 条`],
        ["存在知识缺口", `${evaluated.filter(item => item.points.some(point => point.status !== "supported")).length} 条`],
        ["平均问题价值", `${Math.round(evaluated.reduce((sum, item) => sum + item.value, 0) / evaluated.length)} / 100`],
        ["未充分支撑要点", `${evaluated.reduce((sum, item) => sum + item.points.filter(point => point.status !== "supported").length, 0)} 项`],
      ].map(([label, value]) => <section className="iw-panel" key={label}><span>{label}</span><strong>{value}</strong></section>)}</div></>}
      {scope.length === 1 ? <Evaluation item={activeEvaluation}/> : <section className="iw-panel iw-batch-list">{evaluated.map(item => <div key={item.questionId}><div className="iw-batch-row"><b>{questions.find(question => question.id === item.questionId)?.question}</b><span>问题价值 <Score value={item.value}/></span><span>知识支撑 <Score value={item.support}/></span><button aria-expanded={expanded.includes(item.questionId)} onClick={() => setExpanded(items => items.includes(item.questionId) ? items.filter(id => id !== item.questionId) : [...items, item.questionId])}><ChevronDown size={15}/>{expanded.includes(item.questionId) ? "收起细则" : "展开细则"}</button></div>{expanded.includes(item.questionId) && <div className="iw-batch-detail"><Evaluation item={item}/></div>}</div>)}</section>}
      <div className="iw-sticky"><div><button disabled={(pending && !pendingRead) || activeJobs.some(job => job.questionIds.some(id => scope.includes(id)))} onClick={() => void evaluate(scope, true)}>重新评估</button>
        {scope.length === 1 && savedPlanIds.includes(scope[0])
          ? <button className="iw-primary" onClick={() => openSavedPlan(scope[0])}>查看优化方案</button>
          : <button className="iw-primary" onClick={() => void plan()}>生成优化方案</button>}
      </div></div>
    </>}
    {view === "plan" && <>
      <div className="iw-plan-navigation"><button className="iw-back" onClick={() => navigateView("evaluation")}><ArrowLeft size={15}/>返回评估详情</button></div>
      <header className="iw-header iw-plan-page-header"><div><h1>确认优化方案</h1><p>选择需要执行的动作，查看并编辑具体内容变更。</p></div></header>
      <Steps step={1}/>
      {drafts.map(draft => <section className="iw-plan-section" key={draft.questionId}>
        <header className="iw-plan-question-heading"><h2>{questions.find(item => item.id === draft.questionId)?.question}</h2></header>
        <PlanEditor plan={draft} onChange={changeDraft} pendingKind={workspace?.state.jobs?.find(job => !["succeeded", "failed"].includes(job.status) && job.questionIds.includes(draft.questionId))?.kind}/>
      </section>)}
      <div className="iw-sticky"><span>已选正文修改 <strong>{drafts.reduce((sum, draft) => sum + draft.actions.filter(action => action.selected && action.kind === "node").length, 0)}</strong> 项</span><div>
        {draftDirty && <button disabled={savingDrafts} onClick={() => void saveDrafts()}>保存方案草稿</button>}
        <button className="iw-primary" title={activeJobs.some(job => job.questionIds.some(id => scope.includes(id))) ? "所选问题的任务仍在处理，其他问题的任务不影响执行" : undefined}
          disabled={executing || savingDrafts || activeJobs.some(job => job.questionIds.some(id => scope.includes(id))) || !drafts.some(draft => draft.actions.some(action => action.selected))}
          onClick={() => void execute()}>确认并执行已选动作</button>
      </div></div>
    </>}
    {view === "result" && <><Steps step={2}/>{executing || (pending && !pendingRead) ? <section className="iw-panel iw-executing" role="status"><div className="iw-spinner"/><h2>正在执行优化</h2><p>正在保存已选动作，请等待服务器确认；完成后自动显示本次结果。</p><progress/></section> : receipt ? <><section className="iw-panel"><header className="iw-result-hero"><span><Check size={27}/></span><h1>{receipt.status === "reverted" ? "本次优化已撤销" : receipt.status === "partial" ? "优化部分完成" : receipt.status === "running" ? "执行仍待确认" : "优化执行完成"}</h1><p>正文已修改 {receipt.changes.filter(change => change.status === "succeeded" && change.action.kind === "node").length} 项 · {receipt.changes.filter(change => change.status === "failed").length} 项未完成</p></header><div className="iw-results">{receipt.after.map(after => {const before = receipt.before.find(item => item.questionId === after.questionId); return <div key={after.questionId}><b>{questions.find(item => item.id === after.questionId)?.question}</b><div className="iw-comparison"><p>问题价值 <strong>{before?.value ?? "—"} → {after.value}</strong></p><p>知识支撑 <strong>{before?.support ?? "—"} → {after.support}</strong></p><p>未充分支撑 <strong>{before?.points.filter(point => point.status !== "supported").length ?? "—"} → {after.points.filter(point => point.status !== "supported").length}</strong></p></div></div>;})}{receipt.changes.filter(change => change.action.kind === "node").map(change => <div className="iw-result-row" key={change.action.id}><div><b>{change.action.title}</b><p>{change.error ?? change.action.source}</p></div><span className={`iw-tag ${change.status === "succeeded" ? "supported" : "partial"}`}>{({pending: "待确认", succeeded: "成功", failed: "未完成", reverted: "已撤销"})[change.status]}</span></div>)}</div><footer className="iw-result-footer"><button onClick={() => openKnowledge()}>查看知识库变更</button><button disabled={receipt.status === "reverted" || receipt.status === "running"} onClick={() => setUndoOpen(true)}><Undo2 size={15}/>撤销本次优化</button><button className="iw-primary" onClick={() => setView("list")}>返回问题列表</button></footer></section></> : <div className="iw-empty">暂无执行记录</div>}</>}
    {view === "knowledge" && workspace && <><button className="iw-back" onClick={() => setView(receipt ? "result" : "list")}><ArrowLeft size={15}/>返回优化工作台</button><header className="iw-header"><div><h1>知识库变更</h1><p>按本次执行记录查看正文前后差异。</p></div></header><KnowledgeChangesView nodes={workspace.nodes} receipt={receipt} initialNodeId={nodeId}/></>}
    {view === "knowledge" && <div className="iw-knowledge-footer"><p>补充资料、编辑或核验正文，请进入智能知识库。</p><button className="iw-primary" onClick={() => requestWorkspaceNavigation(() => navigate(projectWorkspaceUrl("/?view=knowledge")))}>打开智能知识库</button></div>}
    {blockedModelAction && <Dialog open onOpenChange={open => {if (!open) setBlockedModelAction(null);}}><DialogContent className="fm-brand-portal-theme iw-modal" data-brand-surface="intent-workbench"><DialogHeader>
      <DialogTitle>等待当前任务完成</DialogTitle>
      <DialogDescription>当前任务完成后可{blockedModelAction === "plan" ? "生成新的优化方案" : "评估其他问题"}。已保存的结果和方案可随时查看。</DialogDescription>
    </DialogHeader><DialogFooter><button onClick={() => setBlockedModelAction(null)}>返回问题列表</button>
      <button className="iw-primary" onClick={() => {
        setBlockedModelAction(null);
        if (activeJob) openTaskDetails(activeJob.id, view === "universe" ? "universe" : "list");
        else {setScope(submittingIds); setEvaluationReturnView(view === "universe" ? "universe" : "list"); navigateView("progress");}
      }}>查看当前任务</button>
    </DialogFooter></DialogContent></Dialog>}
    {questionAction && <Dialog open onOpenChange={open => {if (!open && !savingQuestionId) setQuestionAction(null);}}><DialogContent className={`fm-brand-portal-theme iw-modal iw-question-modal${questionAction.kind === "delete" ? " iw-delete-modal" : ""}`} data-brand-surface="intent-workbench"><DialogHeader>
      <DialogTitle>{questionAction.kind === "edit" ? "修改问题" : "删除问题？"}</DialogTitle>
      <DialogDescription>{questionAction.kind === "edit" ? "修改后保存到当前优化清单。原评分和方案保留在已保存任务中，修改后的问题需重新评估。" : "仅从当前优化清单移除该问题。已保存词库、历史任务、应答内容和执行记录保留。"}</DialogDescription>
    </DialogHeader>
      {questionAction.kind === "edit" ? <div className="iw-question-fields">
        <label>问题内容<textarea aria-label="问题内容" value={questionDraft.question} disabled={Boolean(savingQuestionId)} rows={4} maxLength={500} onChange={event => setQuestionDraft(draft => ({...draft, question: event.target.value}))}/></label>
      </div> : <p className="iw-delete-question">{questionAction.question.question}</p>}
      {questionError && <p role="alert">{questionError}</p>}
      <DialogFooter><button disabled={Boolean(savingQuestionId)} onClick={() => setQuestionAction(null)}>取消</button>
        <button className="iw-primary" disabled={Boolean(savingQuestionId)} onClick={() => void saveQuestionAction()}>{savingQuestionId ? "正在保存…" : questionAction.kind === "edit" ? "保存修改" : "确认删除"}</button>
      </DialogFooter>
    </DialogContent></Dialog>}
    <Dialog open={undoOpen} onOpenChange={setUndoOpen}><DialogContent className="fm-brand-portal-theme iw-modal" data-brand-surface="intent-workbench"><DialogHeader><DialogTitle>撤销本次优化？</DialogTitle><DialogDescription>恢复本次修改的知识库正文。已有后续修改时将保留内容并提示冲突。</DialogDescription></DialogHeader><DialogFooter><button onClick={() => setUndoOpen(false)}>取消</button><button className="iw-primary" disabled={pending} onClick={() => {setUndoOpen(false); void run(() => api.rollback({receiptId: receipt!.id, expectedRevision: revision}));}}>确认撤销</button></DialogFooter></DialogContent></Dialog>
  </div>;
}
