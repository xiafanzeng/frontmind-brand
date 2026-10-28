import {useEffect, useRef, useState} from "react";
import {ArrowLeft, ArrowRight, Check, ChevronDown, FileText, Search, Sparkles, Undo2} from "lucide-react";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from "@frontmind/module-ui/components/ui/dialog";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import ManagedKeywordTables, {type ManagedKeywordTablesProps} from "./ManagedKeywordTables";
import {liveIntentWorkbenchApi, type IntentWorkbenchApi} from "./intent-workbench-api";
import type {IntentWorkspace, IntentEvaluation, IntentPlan, IntentAction} from "../../contracts/intent-workbench";
import "./intent-workbench.css";
import KnowledgeChangeComparison from "./KnowledgeChangeComparison";
import {useWorkspaceDraftGuard, projectWorkspaceUrl, requestWorkspaceNavigation} from "../host";
import {navigate} from "wouter/use-browser-location";
import IntentQuestionCatalog, {type IntentCatalogIntegration} from "./IntentQuestionCatalog";
import IntentTaskProgress from "./IntentTaskProgress";
import {findCatalogQuestion} from "./intent-catalog-link";

type View = "universe" | "list" | "evaluation" | "plan" | "result" | "knowledge" | "progress";
type Selection = Parameters<NonNullable<ManagedKeywordTablesProps["onUseQuestion"]>>[0];
const labels = {supported: "已支撑", partial: "部分支撑", missing: "未支撑"};
function Score({value}: {value: number}) {return <span className={`iw-score ${value >= 80 ? "good" : value >= 50 ? "warn" : "bad"}`}><b>{value}</b><i><em style={{width: `${value}%`}}/></i></span>;}
function Steps({step}: {step: number}) {return <div className="iw-steps">{["查看评估", "确认方案", "执行结果"].map((label, index) => <div key={label} className={index <= step ? "active" : ""}><span>{index < step ? <Check size={15}/> : index + 1}</span>{label}{index < 2 && <i/>}</div>)}</div>;}
function Evaluation({item}: {item: IntentEvaluation}) {
  return <div className="iw-evaluation">
    <div><div className="iw-score-cards">
      <section className="iw-panel iw-score-card"><span>问题价值</span><strong>{item.value}<small> / 100</small></strong>
        <details className="iw-dimensions"><summary>查看 6 项评分维度 <ChevronDown size={14}/></summary><div>{item.dimensions.map(dimension => <div key={dimension.label}><span>{dimension.label}</span><Score value={dimension.score}/><p>{dimension.reason}</p></div>)}</div></details>
        <p>按意图、品牌关联、决策、清晰度、独特度和知识支撑综合评估。</p></section>
      <section className="iw-panel iw-score-card"><span>知识支撑</span><strong className={item.support >= 80 ? "good" : "warn"}>{item.support}<small> / 100</small></strong><span className="iw-tag">{item.support >= 80 ? "较充分" : item.support >= 50 ? "部分支撑" : "支撑不足"}</span><p>{item.points.filter(point => point.status === "supported").length} 项已支撑 · {item.points.filter(point => point.status === "partial").length} 项部分支撑 · {item.points.filter(point => point.status === "missing").length} 项未支撑</p></section>
    </div><section className="iw-panel"><h3>回答要点支撑矩阵 <small>{item.points.length} 个必要回答要点</small></h3><div className="iw-table-wrap"><table><thead><tr><th>回答要点</th><th>支撑状态</th><th>匹配知识节点 / 证据</th><th>内容问题</th></tr></thead><tbody>{item.points.map(point => <tr key={point.title}><td><b>{point.title}</b></td><td><span className={`iw-tag ${point.status}`}>{labels[point.status]}</span></td><td>{point.nodeTitle ?? "暂无匹配节点"}{point.evidence && <p className="iw-evidence">{point.evidence}</p>}</td><td>{point.issue}</td></tr>)}</tbody></table></div></section></div>
    <aside className="iw-panel iw-diagnosis"><h3>诊断摘要</h3>{item.findings.length ? item.findings.map(finding => <p key={finding}><Sparkles size={16}/>{finding}</p>) : <p><Check size={16}/>当前要点均有相关内容支撑。</p>}<div className="iw-method">{item.method === "skill_v1" ? "AI 基于当前知识证据评估" : "历史规则评估 / 演示数据"} · 非真实搜索热度<br/>更新时间：{new Date(item.evaluatedAt).toLocaleString("zh-CN")}<br/>引用待核验资料不计为充分支撑。</div></aside>
  </div>;
}
function PlanEditor({plan, question, onChange}: {plan: IntentPlan; question: string; onChange: (plan: IntentPlan) => void}) {
  const [active, setActive] = useState(plan.actions.find(item => item.kind === "node")?.id ?? plan.actions[0]?.id);
  const action = plan.actions.find(item => item.id === active) ?? plan.actions[0];
  const update = (id: string, patch: Partial<IntentAction>) => onChange({...plan, actions: plan.actions.map(item => item.id === id ? {...item, ...patch} : item)});
  return <div className="iw-plan-grid"><div className="iw-panel iw-tasks">{plan.actions.map(item => <section key={item.id} className={`iw-task ${item.selected ? "selected" : ""} ${item.id === action?.id ? "is-active" : ""}`}>
    <label><input type="checkbox" checked={item.selected} onChange={event => update(item.id, {selected: event.target.checked})}/><b>{item.title}</b><span className="iw-tag">{item.kind === "todo" ? "需补资料" : item.kind === "node" ? "需审核" : "低风险"}</span></label>
    <p>{item.source}</p><button onClick={() => setActive(item.id)}>查看并编辑</button><button onClick={() => update(item.id, {selected: false})}>不采纳</button>
  </section>)}</div><section className="iw-panel iw-preview"><h3>{action?.kind === "node" ? "知识节点变更预览" : action?.title}<span className="iw-tag">可编辑</span></h3>{action && <div className="iw-preview-body"><p className="iw-evidence">{question} · {action.source}</p>{action.before && <div className="iw-diff remove"><b>修改前</b><pre>{action.before}</pre></div>}<label className="iw-edit-label">修改后<textarea aria-label={`${action.title}修改后`} value={action.after} rows={action.kind === "node" ? 12 : 5} maxLength={action.kind === "question" ? 500 : 300000} onChange={event => update(action.id, {after: event.target.value})}/></label><p className="iw-method">节点正文须人工审核。资料待办不会直接消除知识缺口。</p></div>}</section></div>;
}
export default function IntentWorkbench({keywordProps, initialView = "universe", api = liveIntentWorkbenchApi, onSectionChange, catalogIntegration}: {
  keywordProps: ManagedKeywordTablesProps; initialView?: "universe" | "list"; api?: IntentWorkbenchApi;
  onSectionChange?: (section: "universe" | "list") => void;
  catalogIntegration?: IntentCatalogIntegration;
}) {
  const [workspace, setWorkspace] = useState<IntentWorkspace | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [pending, setPending] = useState(false);
  const [progressKind, setProgressKind] = useState<"evaluate" | "plan">("evaluate");
  const [progressJobId, setProgressJobId] = useState<string>();
  const [error, setError] = useState("");
  const [intake, setIntake] = useState<Selection[] | null>(null);
  const [received, setReceived] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [singleQueue, setSingleQueue] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<IntentPlan[]>([]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [receiptId, setReceiptId] = useState<string>();
  const [undoOpen, setUndoOpen] = useState(false);
  const [nodeId, setNodeId] = useState<string>();
  const [nodeSearch, setNodeSearch] = useState("");
  const mounted = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const emittedSection = useRef<"universe" | "list" | undefined>(undefined);
  const executeId = useRef<string | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true; generation.current++; running.current = false;
    setView(initialView); setProgressJobId(undefined);
    setWorkspace(null); setDrafts([]); setDraftDirty(false); setReceived([]); setSelected([]);
    void run(() => api.observe(), undefined, true);
    return () => {mounted.current = false; generation.current++;};
  }, [api]);
  useEffect(() => {
    if (emittedSection.current === initialView) {emittedSection.current = undefined; return;}
    if (!running.current) setView(initialView);
  }, [initialView]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = 0;
    }
    element.scrollIntoView({block: "start"});
  }, [view]);
  async function saveDrafts() {
    if (!workspace || pending) return false;
    const result = await run(async () => {
      let current = workspace;
      for (const draft of drafts) current = await api.command({kind: "edit", expectedRevision: current.revision, questionId: draft.questionId,
        actions: draft.actions.map(({id, selected, after}) => ({id, selected, after}))});
      return current;
    });
    if (result) setDraftDirty(false);
    return Boolean(result);
  }
  useWorkspaceDraftGuard({dirty: draftDirty, label: "优化方案修改", save: saveDrafts, discard: async () => {setDraftDirty(false); return true;}});
  async function run(work: () => Promise<IntentWorkspace>, next?: View, restoreJob = false, modelKind?: "evaluate" | "plan") {
    if (running.current) return;
    running.current = true; setPending(true); setError("");
    if (modelKind) {setProgressKind(modelKind); setProgressJobId(undefined); setView("progress");}
    const destination = next ?? (view === "progress" ? "evaluation" : view);
    const version = generation.current;
    const priorJob = workspace?.state.jobs?.at(-1);
    const current = () => mounted.current && version === generation.current;
    try {
      let data = await work();
      if (!current()) return;
      setWorkspace(data);
      const latest = data.state.jobs?.at(-1);
      if (latest?.status === "failed" && (latest.id !== priorJob?.id || priorJob?.status !== "failed"))
        throw new Error(latest.error ?? "模型生成失败，请重新评估");
      const job = data.state.jobs?.find(item => !["succeeded", "failed"].includes(item.status));
      if (next) setView(next);
      if (job && restoreJob) {
        setScope(job.questionIds); setIndex(0); setExpanded([]); setSingleQueue([]);
      }
      if (job) {setProgressKind(job.kind); setProgressJobId(job.id); setView("progress");}
      if (job && api.waitForJob) data = await api.waitForJob(job.id, value => {
        if (!current()) throw new Error("工作区已切换");
        setWorkspace(value);
      });
      if (current()) {
        setWorkspace(data);
        const finished = data.state.jobs?.find(item => item.id === job?.id);
        if (finished?.status === "failed") throw new Error(finished.error ?? "模型任务未完成");
        if (next || job || modelKind) setView(job?.receiptId ? "result" : restoreJob && job ? "evaluation" : destination);
        if (job && restoreJob && job.kind === "plan") {
          setDrafts(structuredClone(data.state.plans.filter(item => job.questionIds.includes(item.questionId))));
          setDraftDirty(false); setView("plan");
        }
        return data;
      }
    }
    catch (cause) {if (current()) setError(cause instanceof Error ? cause.message : "操作失败，请重试");}
    finally {if (current()) {running.current = false; setPending(false);}}
  }
  const questions = workspace?.state.questions ?? [];
  const evaluations = workspace?.state.evaluations ?? [];
  const activeJob = workspace?.state.jobs?.find(item => !["succeeded", "failed"].includes(item.status));
  const receipt = workspace?.state.receipts.find(item => item.id === receiptId) ?? workspace?.state.receipts.at(-1);
  const filtered = questions.filter(question => question.question.toLowerCase().includes(search.toLowerCase()) &&
    (category === "all" || question.category === category) &&
    (status === "all" || (["unevaluated", "supported", "partial", "missing"].includes(status) ? (() => {
      const item = evaluations.find(item => item.questionId === question.id);
      return (item ? item.support >= 80 ? "supported" : item.support >= 50 ? "partial" : "missing" : "unevaluated") === status;
    })() : (catalogIntegration?.answerStatuses?.[question.id] ?? "unknown") === status)))
    .sort((a, b) => Number(received.includes(b.id)) - Number(received.includes(a.id)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 10, (currentPage + 1) * 10);
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  const revision = workspace?.revision ?? 0;
  const command = (input: Record<string, unknown>) => api.command({...input, expectedRevision: revision,
    ...(["evaluate", "plan"].includes(String(input.kind)) ? {clientRequestId: crypto.randomUUID()} : {})});
  async function evaluate(ids: string[], force = false) {
    if (pending || running.current || !ids.length) return;
    setScope(ids); setIndex(0); setExpanded([]);
    setSingleQueue(ids.length === 1 ? [...new Set([ids[0], ...filtered.filter(item =>
      evaluations.some(evaluation => evaluation.questionId === item.id)).map(item => item.id)])] : []);
    const missing = force ? ids : ids.filter(id => !evaluations.some(item => item.questionId === id));
    if (!missing.length) {setView("evaluation"); return;}
    await run(() => command({kind: "evaluate", questionIds: missing}), "evaluation", false, "evaluate");
  }
  async function nextEvaluation() {
    const next = singleQueue[singleQueue.indexOf(scope[0]) + 1];
    if (!next) return;
    setScope([next]); setIndex(0);
    // Next browses saved evaluations. Creating another model task is explicit.
  }
  async function confirmIntake() {
    if (!intake?.length || pending || !workspace) return;
    const incoming = intake.map(item => ({
      id: `${item.tableId}:${item.rowIndex}`, question: item.question, category: item.category,
      subdivision: "", tableId: item.tableId, rowIndex: item.rowIndex, sourceRevision: item.dashboardRevision ?? null,
    }));
    // A lost response may have saved the previous intake. Read first, link to
    // existing questions/results, and submit only genuinely missing entries.
    const data = await run(async () => {
      const current = await api.observe();
      const missing = incoming.filter(item => !findCatalogQuestion(item, current.state.questions));
      return missing.length ? api.command({kind: "intake", expectedRevision: current.revision, questions: missing}) : current;
    }, "list");
    if (!data) return;
    const ids = [...new Set(incoming.map(item => findCatalogQuestion(item, data.state.questions)?.id).filter((id): id is string => Boolean(id)))];
    if (incoming.some(item => !findCatalogQuestion(item, data.state.questions))) {setError("所选词条未能完整关联，请重新读取后确认。"); return;}
    setReceived(ids); setSelected(ids); setScope(ids); setIndex(0); setExpanded([]); setSingleQueue([]);
    setSearch(""); setCategory("all"); setStatus("all"); setPage(0); setIntake(null);
    emittedSection.current = "list"; onSectionChange?.("list");
    const missing = ids.filter(id => !data.state.evaluations.some(item => item.questionId === id));
    if (missing.length) await run(() => api.command({kind: "evaluate", expectedRevision: data.revision,
      clientRequestId: crypto.randomUUID(), questionIds: missing}), "evaluation", false, "evaluate");
    else setView("evaluation");
  }
  async function plan() {
    const data = await run(() => command({kind: "plan", questionIds: scope}), "plan", false, "plan");
    if (data) {setDrafts(data.state.plans.filter(item => scope.includes(item.questionId))); setDraftDirty(false); setView("plan");}
  }
  async function execute() {
    if (!workspace) return;
    const validDrafts = drafts.filter(draft => scope.includes(draft.questionId));
    if (validDrafts.some(draft => draft.actions.some(action => action.selected && !action.after.trim()))) {setError("请填写已选动作的修改内容"); return;}
    await run(async () => {
      let current = workspace;
      for (const draft of validDrafts) current = await api.command({kind: "edit", expectedRevision: current.revision, questionId: draft.questionId,
        actions: draft.actions.map(({id, selected, after}) => ({id, selected, after}))});
      setDraftDirty(false);
      executeId.current ??= crypto.randomUUID();
      setReceiptId(executeId.current); setView("result");
      const result = await api.execute({expectedRevision: current.revision, clientRequestId: executeId.current, questionIds: scope});
      executeId.current = undefined;
      return result;
    }, "result");
  }
  function changeDraft(plan: IntentPlan) {setDrafts(items => items.map(item => item.questionId === plan.questionId ? plan : item)); setDraftDirty(true);}
  function openKnowledge(target?: string) {setNodeId(target ?? receipt?.changes.find(change => change.action.kind === "node" && change.status === "succeeded")?.action.nodeId ?? workspace?.nodes[0]?.id); setView("knowledge");}
  function exportReport() {
    const blob = new Blob([JSON.stringify({questions, evaluations, todos: workspace?.state.todos, receipt}, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "GEO-优化评估报告.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  const evaluated = scope.map(id => evaluations.find(item => item.questionId === id)).filter((item): item is IntentEvaluation => Boolean(item));
  const activeEvaluation = evaluated[index] ?? evaluated[0];
  const node = workspace?.nodes.find(item => item.id === nodeId) ?? workspace?.nodes[0];
  const currentChanges = receipt?.changes.filter(change => change.action.kind === "node" && change.action.nodeId === node?.id && (change.status === "succeeded" || change.status === "reverted")) ?? [];
  function openSection(section: "universe" | "list") {setView(section); emittedSection.current = section; onSectionChange?.(section);}
  return <div ref={container} className={`iw-workbench iw-view-${view}`} aria-busy={pending}>
    {error && <div className="iw-error" role="alert">{error}<button disabled={pending} onClick={() => void run(() => api.observe(), undefined, true)}>重新读取</button></div>}
    {view === "progress" && <IntentTaskProgress job={workspace?.state.jobs?.find(item => item.id === progressJobId)}
      kind={progressKind} count={scope.length} error={error} pending={pending} onBack={() => setView("list")}
      onReload={() => void run(() => api.observe(), undefined, true)}/>}
    {pending && view !== "result" && view !== "progress" && <div className="iw-panel" role="status">
      {activeJob?.repair ? "正在自动修复模型结果并重新校验，请稍候…" : activeJob ? `正在${activeJob.kind === "plan" ? "生成优化方案" : "评估问题"} · ${activeJob.questionIds.length} 条问题，AI 生成可能需要几分钟…` : "正在读取优化工作台…"}
      {activeJob && <><p>已有任务正在处理，完成前暂不能重复评估。</p><button onClick={() => {
        setScope(activeJob.questionIds); setIndex(0); setExpanded([]); setSingleQueue([]); setProgressJobId(activeJob.id); setProgressKind(activeJob.kind); setView("progress");
      }}>查看当前任务</button></>}
    </div>}
    {!pending && !error && view !== "progress" && workspace?.state.jobs?.at(-1)?.status === "failed" && <div className="iw-error" role="alert">{workspace.state.jobs.at(-1)?.error}</div>}
    {view === "universe" && <><header className="iw-header iw-universe-header"><div><h1>词条生成与优化</h1><p>推荐核心词 → 生成问题 → 选择新词条 → 加入优化清单</p></div><button onClick={() => openSection("list")}>查看优化清单 <span className="iw-tag">{questions.length}</span><ArrowRight size={15}/></button></header><ManagedKeywordTables {...keywordProps} onUseQuestion={selection => setIntake([selection])} onUseQuestions={items => setIntake(items)}
      optimizationState={workspace?.state} onViewEvaluation={id => void evaluate([id])}/></>}
    {view !== "universe" && !workspace && !error && <div role="status" className="iw-empty">正在读取优化工作台…</div>}
    {view === "list" && workspace && <>
      <IntentQuestionCatalog questions={questions} visible={visible} evaluations={evaluations} activeJob={activeJob} received={received} integration={catalogIntegration}
        search={search} category={category} status={status} selected={selected} pending={pending}
        page={currentPage} pageCount={pageCount} total={filtered.length}
        onSearch={value => {setSearch(value); setPage(0);}} onCategory={value => {setCategory(value); setPage(0);}} onStatus={value => {setStatus(value); setPage(0);}}
        onToggle={toggle} onClear={() => setSelected([])} onEvaluate={ids => void evaluate(ids)} onPage={setPage} onUniverse={() => openSection("universe")}
        onSelectPage={checked => setSelected(ids => checked ? [...new Set([...ids, ...visible.map(item => item.id)])] : ids.filter(id => !visible.some(item => item.id === id)))}/>
      {workspace.state.plans.length > 0 && <div className="iw-toolbar"><span>已保存 {workspace.state.plans.length} 个方案</span><button disabled={pending} onClick={() => {const saved = workspace.state.plans.filter(item => !selected.length || selected.includes(item.questionId)); setDrafts(structuredClone(saved)); setScope(saved.map(item => item.questionId)); setDraftDirty(false); setView("plan");}}>继续审核已保存方案</button></div>}
      {workspace.state.receipts.length > 0 && <section className="iw-panel iw-todo-list"><h3>执行记录</h3>{[...workspace.state.receipts].reverse().map(item => <div key={item.id}><span>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.changes.length} 项动作 · {({running: "待确认", completed: "已完成", partial: "部分完成", reverted: "已撤销"})[item.status]}</span> <button onClick={() => {setReceiptId(item.id); setView("result");}}>查看执行记录</button></div>)}</section>}
      {workspace.state.receipts.some(item => item.status === "running") && <div className="iw-sticky"><span>有执行尚未确认完成</span><button disabled={pending} onClick={() => {const runningReceipt = workspace.state.receipts.find(item => item.status === "running")!; setReceiptId(runningReceipt.id); setView("result"); void run(() => api.execute({expectedRevision: revision, clientRequestId: runningReceipt.id, questionIds: [...new Set(runningReceipt.changes.map(change => change.questionId))]}));}}>继续原执行</button></div>}
    </>}
    {view === "evaluation" && pending && <><button className="iw-back" onClick={() => setView("list")}><ArrowLeft size={15}/>返回问题列表</button><header className="iw-header"><div><h1>{activeJob?.kind === "plan" ? "正在生成优化方案" : `正在评估 ${scope.length} 条问题`}</h1><p>任务完成后显示最新评估结果，请勿重复提交。</p></div></header><Steps step={activeJob?.kind === "plan" ? 1 : 0}/></>}
    {view === "evaluation" && !pending && !activeEvaluation && <div className="iw-panel"><p>当前任务尚无有效评估结果，请返回列表查看任务提示。</p><button onClick={() => setView("list")}>返回问题列表</button></div>}
    {view === "evaluation" && !pending && activeEvaluation && <>
      <button className="iw-back" onClick={() => setView("list")}><ArrowLeft size={15}/>返回问题列表</button><header className="iw-header"><div><h1>{scope.length > 1 ? "批量评估结果" : questions.find(item => item.id === activeEvaluation.questionId)?.question}</h1><p>查看问题价值、必要回答要点与可引用的知识依据。</p></div>{scope.length === 1 && <div><span className="iw-tag">{Math.max(1, singleQueue.indexOf(scope[0]) + 1)} / {Math.max(1, singleQueue.length)}</span> <button disabled={pending || !singleQueue[singleQueue.indexOf(scope[0]) + 1]} onClick={() => void nextEvaluation()}>下一条 <ArrowRight size={15}/></button></div>}</header><Steps step={0}/>
      <p className="iw-method">正在查看已保存的评估结果；“重新评估”会基于当前知识库创建新任务。</p>
      {scope.length > 1 && <><p className="iw-method">每个问题独立评估、独立生成建议，最后统一确认和执行。</p><div className="iw-batch-summary">{[
        ["已评估问题", `${evaluated.length} / ${scope.length} 条`],
        ["存在知识缺口", `${evaluated.filter(item => item.points.some(point => point.status !== "supported")).length} 条`],
        ["平均问题价值", `${Math.round(evaluated.reduce((sum, item) => sum + item.value, 0) / evaluated.length)} / 100`],
        ["未充分支撑要点", `${evaluated.reduce((sum, item) => sum + item.points.filter(point => point.status !== "supported").length, 0)} 项`],
      ].map(([label, value]) => <section className="iw-panel" key={label}><span>{label}</span><strong>{value}</strong></section>)}</div></>}
      {scope.length === 1 ? <Evaluation item={activeEvaluation}/> : <section className="iw-panel iw-batch-list">{evaluated.map(item => <div key={item.questionId}><div className="iw-batch-row"><b>{questions.find(question => question.id === item.questionId)?.question}</b><span>问题价值 <Score value={item.value}/></span><span>知识支撑 <Score value={item.support}/></span><button aria-expanded={expanded.includes(item.questionId)} onClick={() => setExpanded(items => items.includes(item.questionId) ? items.filter(id => id !== item.questionId) : [...items, item.questionId])}><ChevronDown size={15}/>{expanded.includes(item.questionId) ? "收起细则" : "展开细则"}</button></div>{expanded.includes(item.questionId) && <div className="iw-batch-detail"><Evaluation item={item}/></div>}</div>)}</section>}
      <div className="iw-sticky"><p>方案可逐项审核，知识正文不会自动采纳。</p><div><button disabled={pending} onClick={() => void evaluate(scope, true)}>重新评估</button><button className="iw-primary" disabled={pending || evaluated.length !== scope.length} onClick={() => void plan()}>{scope.length > 1 ? `批量生成优化方案（${scope.length}）` : "生成优化方案"} <ArrowRight size={16}/></button></div></div>
    </>}
    {view === "plan" && <><button className="iw-back" onClick={() => setView("evaluation")}><ArrowLeft size={15}/>返回评估详情</button><header className="iw-header"><div><h1>确认优化方案</h1><p>选择需要执行的动作，查看并编辑具体内容变更。</p></div><span className="iw-tag">{scope.length} 个问题</span></header><Steps step={1}/>{drafts.map(draft => <section className="iw-plan-section" key={draft.questionId}><h2>{questions.find(item => item.id === draft.questionId)?.question}</h2><PlanEditor plan={draft} question={questions.find(item => item.id === draft.questionId)?.question ?? ""} onChange={changeDraft}/><p className="iw-method">AI 根据当前知识证据生成方案。请审核修改内容；执行后通过真实模型重新评估。</p></section>)}<div className="iw-sticky"><span>已选择 <strong>{drafts.reduce((sum, draft) => sum + draft.actions.filter(action => action.selected).length, 0)}</strong> 项 · 执行后重新评估实际支撑</span><div><button disabled={pending} onClick={() => void saveDrafts()}>{draftDirty ? "保存方案草稿" : "方案已保存"}</button><button className="iw-primary" disabled={pending || !drafts.some(draft => draft.actions.some(action => action.selected))} onClick={() => void execute()}>确认并执行已选动作</button></div></div></>}
    {view === "result" && receipt && !receipt.after.length && !pending && <div className="iw-panel" role="status">{receipt.reEvaluationError ?? "本次变更已保存，模型重评结果尚未生成。可重新读取任务状态。"}</div>}
    {view === "result" && <><Steps step={2}/>{pending ? <section className="iw-panel iw-executing" role="status"><div className="iw-spinner"/><h2>正在执行优化</h2><p>正在保存已选动作并重新评估，请等待服务器确认。</p><progress/></section> : receipt ? <><section className="iw-panel"><header className="iw-result-hero"><span><Check size={27}/></span><h1>{receipt.status === "reverted" ? "本次优化已撤销" : receipt.status === "partial" ? "优化部分完成" : receipt.status === "running" ? "执行仍待确认" : "优化执行完成"}</h1><p>{receipt.changes.filter(change => change.status === "succeeded").length} 项成功 · {receipt.changes.filter(change => change.status === "failed").length} 项未完成 · 资料待办不计作知识补齐</p></header><div className="iw-results">{receipt.after.map(after => {const before = receipt.before.find(item => item.questionId === after.questionId); return <div key={after.questionId}><b>{questions.find(item => item.id === after.questionId)?.question}</b><div className="iw-comparison"><p>问题价值 <strong>{before?.value ?? "—"} → {after.value}</strong></p><p>知识支撑 <strong>{before?.support ?? "—"} → {after.support}</strong></p><p>未充分支撑 <strong>{before?.points.filter(point => point.status !== "supported").length ?? "—"} → {after.points.filter(point => point.status !== "supported").length}</strong></p></div></div>;})}{receipt.changes.map(change => <div className="iw-result-row" key={change.action.id}><div><b>{change.action.title}</b><p>{change.error ?? change.action.source}</p></div><span className={`iw-tag ${change.status === "succeeded" ? "supported" : "partial"}`}>{({pending: "待确认", succeeded: "成功", failed: "未完成", reverted: "已撤销"})[change.status]}</span></div>)}</div><footer className="iw-result-footer"><button onClick={exportReport}>导出评估报告</button><button onClick={() => openKnowledge()}>查看知识库变更</button><button disabled={receipt.status === "reverted" || receipt.status === "running"} onClick={() => setUndoOpen(true)}><Undo2 size={15}/>撤销本次优化</button><button className="iw-primary" onClick={() => setView("list")}>返回问题列表</button></footer></section></> : <div className="iw-empty">暂无执行记录</div>}</>}
    {view === "knowledge" && workspace && <><button className="iw-back" onClick={() => setView(receipt ? "result" : "list")}><ArrowLeft size={15}/>返回优化工作台</button><header className="iw-header"><div><h1>知识库变更</h1><p>定位实际节点，对比执行前后内容与资料缺口。</p></div><button onClick={exportReport}>导出变更记录</button></header><div className="iw-knowledge"><article className="iw-panel"><h3>{node?.title ?? "暂无知识节点"}<small>{node?.branch}</small></h3>{node && (currentChanges.length > 0 ? <KnowledgeChangeComparison key={`${receipt?.id}:${node.id}`} changes={currentChanges} current={node.content} createdAt={receipt?.createdAt}/> : <div className="iw-article"><p className="iw-change-caption">该节点在本次执行中没有已写入的变更记录，以下为当前正文。</p><MarkdownRenderer content={node.content}/></div>)}<p className="iw-method">{node?.verified ? "当前节点已确认" : "当前节点需再核验；不会计为充分支撑"}</p></article><aside className="iw-panel iw-tree"><h3>知识结构 <small>{workspace.nodes.length} 个节点</small></h3><label><Search size={16}/><input aria-label="搜索知识节点" placeholder="搜索节点标题或内容" value={nodeSearch} onChange={event => setNodeSearch(event.target.value)}/></label>{workspace.nodes.filter(item => `${item.title}${item.content}`.includes(nodeSearch)).map(item => <button className={node?.id === item.id ? "active" : ""} key={item.id} onClick={() => setNodeId(item.id)}><FileText size={16}/><span><b>{item.title}</b><small>{item.branch}</small></span><em>{item.verified ? "已确认" : "需核验"}</em></button>)}</aside></div></>}
    {view === "knowledge" && <div className="iw-sticky"><p>继续编辑、确认节点、上传资料和下载知识库，请进入原有知识库工作区。</p><button className="iw-primary" onClick={() => requestWorkspaceNavigation(() => navigate(projectWorkspaceUrl("/?view=knowledge")))}>打开智能知识库</button></div>}
    <Dialog open={intake !== null} onOpenChange={open => {if (!open) setIntake(null);}}><DialogContent className="iw-modal"><DialogHeader><DialogTitle>加入优化清单</DialogTitle><DialogDescription>已有评估会直接打开保存的结果；尚未评估的问题才会提交模型任务。</DialogDescription></DialogHeader>
      {(error || !workspace) && <div className="iw-intake-recovery" role="status"><p>{error || "正在读取优化清单，所选词条已保留。"}</p><button disabled={pending} onClick={() => void run(() => api.observe())}>{pending ? "正在重新读取…" : "重试读取优化清单"}</button></div>}
      <div className="iw-intake-list">{intake?.map(item => <div key={`${item.tableId}:${item.rowIndex}`}><span><b>{item.question}</b><small>{item.category}</small></span><button disabled={pending} aria-label={`移除${item.question}`} onClick={() => setIntake(items => items?.filter(entry => entry !== item) ?? null)}>移除</button></div>)}</div><DialogFooter><button onClick={() => setIntake(null)}>取消</button><button className="iw-primary" disabled={pending || !intake?.length || !workspace} onClick={() => void confirmIntake()}>确认选择并交给问题优化（{intake?.length ?? 0}）</button></DialogFooter></DialogContent></Dialog>
    <Dialog open={undoOpen} onOpenChange={setUndoOpen}><DialogContent className="iw-modal"><DialogHeader><DialogTitle>撤销本次优化？</DialogTitle><DialogDescription>恢复本次修改的问题和节点，删除对应资料待办。已有后续修改时将保留内容并提示冲突。</DialogDescription></DialogHeader><DialogFooter><button onClick={() => setUndoOpen(false)}>取消</button><button className="iw-primary" disabled={pending} onClick={() => {setUndoOpen(false); void run(() => api.rollback({receiptId: receipt!.id, expectedRevision: revision}));}}>确认撤销</button></DialogFooter></DialogContent></Dialog>
  </div>;
}
