import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpenCheck, Bot, ClipboardCheck, FileText, Lightbulb, Search, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { loadWebsiteDraft } from "./SimplifiedWebsiteBuilderPreview";
import { previewKnowledgeCollectionCount, previewKnowledgeFragmentCount } from "./preview-copy";
import { usePreviewDialog } from "./qa-widget/usePreviewDialog";
import { RAG_ACCEPTANCE_PARAMS, RAG_ATTRIBUTIONS, RAG_CASE_MODE_LABELS, RAG_CASE_STATUS_LABELS, RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, aggregateEvaluations, buildReportMetrics, resolveConversationOutcome, scoreEvaluation, type DimensionId, type DimensionJudgment, type GateJudgment, type Rating } from "./rag-evaluation";
import { RAG_COVERAGE_POINTS, RAG_SAMPLE_CASES, findRagSample, type RagCase, type RagIssue } from "./rag-evaluation-cases";
import { enterpriseRagEvaluationSkill } from "./enterprise-rag-evaluation-skill";
import { saveEvaluationReport } from "./evaluation-report-store";
import "./simplified-product-preview.css";
import "./rag-evaluation-ui.css";

type Props = { onOpenWebsite: () => void; onOpenWebsiteAssistant: () => void; websiteEntryLabel?: string };
type Drawer = "review" | "evidence" | "rules" | "improve" | "answer" | "history" | null;
type RecordEntry = { id: string; question: string; answer: string; need: string; reviewer: string; time: string; ruleVersion: string; knowledgeVersion: string; dimensions: DimensionJudgment[]; gates: GateJudgment[] };
const HISTORY_KEY = "frontmind-rag-reviews-v1";
const KNOWLEDGE_VERSION = "KB-SYN-v1";
const shortLabels = ["需求满足", "正确与有据", "信息完整", "引用与时效", "清晰可行动", "边界与安全"];
const levels = ["不满足", "少量满足", "部分满足", "基本满足", "充分满足"];
const dimensionActions: Record<DimensionId, string> = {
  intent: "先用一句话正面回答核心问题；若缺少场景，先提出必要的澄清问题。",
  correctness: "逐条对照授权原文，删除无依据的承诺并更正矛盾事实。",
  completeness: "补齐用户完成任务必需的条件、限制和步骤，不添加无关信息。",
  citations: "为核心结论补充可访问的来源、段落和版本；无法核验时明确未知。",
  clarity: "改为结论在前、步骤在后，并给出一个可执行的下一步。",
  boundaries: "去除越权或敏感内容，明确未知、授权范围及转人工路径。",
};
const verdicts = { excellent: "优秀", usable: "可用，仍有优化空间", improve: "需要改进", unusable: "不可用，优先修复", pending: "待完成评审" };
const emptyDimensions = (): DimensionJudgment[] => RAG_DIMENSIONS.map(({ id }) => ({ id, level: null, rationale: "", evidenceIds: [], applicable: true }));
const emptyGates = (): GateJudgment[] => RAG_GATES.map(({ id }) => ({ id, status: "pending", reason: "" }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const format = (value: number) => Number(value.toFixed(2)).toString();

function loadHistory(): RecordEntry[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is RecordEntry => item && typeof item.id === "string" && typeof item.question === "string" && typeof item.answer === "string" && typeof item.need === "string" && typeof item.reviewer === "string" && typeof item.time === "string" && typeof item.ruleVersion === "string" && /^rag-eval-\d+\.\d+$/u.test(item.ruleVersion) && typeof item.knowledgeVersion === "string" && Array.isArray(item.dimensions) && item.dimensions.every((d: DimensionJudgment) => d && typeof d.id === "string" && typeof d.rationale === "string" && Array.isArray(d.evidenceIds)) && Array.isArray(item.gates) && item.gates.every((g: GateJudgment) => g && typeof g.reason === "string" && typeof g.id === "string")).slice(0, 30);
  } catch { return []; }
}

function manualIssues(dimensions: DimensionJudgment[], gates: GateJudgment[]): RagIssue[] {
  const risks: RagIssue[] = gates.filter((item) => item.status === "failed").map((item) => ({ id: `gate-${item.id}`, priority: "P0", title: `${RAG_GATES.find((gate) => gate.id === item.id)?.label}存在关键风险`, impact: item.reason, action: "先移除或修正风险内容，核对授权与依据，再重新评审。" }));
  const gaps: RagIssue[] = dimensions.filter((item) => item.level !== null && item.level < 4).sort((a, b) => (a.level ?? 4) - (b.level ?? 4)).map((item) => ({ id: item.id, priority: item.level! <= 2 ? "P1" : "P2", title: `${RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}可改进`, impact: item.rationale, action: dimensionActions[item.id], dimensionId: item.id }));
  return [...risks, ...gaps].slice(0, 3);
}

export function EnterpriseRagPreview({ onOpenWebsite, onOpenWebsiteAssistant, websiteEntryLabel = "开始网站建设" }: Props) {
  const first = RAG_SAMPLE_CASES[0];
  const [websiteDraft] = useState(loadWebsiteDraft);
  const [activeCase, setActiveCase] = useState<RagCase | null>(first);
  const [question, setQuestion] = useState(first.question);
  const [answer, setAnswer] = useState(first.answer);
  const [need, setNeed] = useState(first.need);
  const [input, setInput] = useState("");
  const [dimensions, setDimensions] = useState(clone(first.dimensions));
  const [gates, setGates] = useState(clone(first.gates));
  const [mode, setMode] = useState<"sample" | "manual">("sample");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [reviewDimensions, setReviewDimensions] = useState<DimensionJudgment[]>([]);
  const [reviewGates, setReviewGates] = useState<GateJudgment[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [answerEdit, setAnswerEdit] = useState("");
  const [needEdit, setNeedEdit] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [tab, setTab] = useState<"single" | "set">("single");
  const backgroundRef = useRef<HTMLDivElement>(null);
  const close = () => {
    // Restore interactivity before the dialog hook returns focus to its trigger.
    if (backgroundRef.current) backgroundRef.current.inert = false;
    setDrawer(null);
  };
  const dialogRef = usePreviewDialog(drawer !== null, close);
  useEffect(() => {
    if (backgroundRef.current) backgroundRef.current.inert = drawer !== null;
    if (!drawer) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [drawer]);
  const result = scoreEvaluation({ dimensions, gates });
  const issues = mode === "sample" && activeCase ? activeCase.issues : manualIssues(dimensions, gates);
  const conversation = activeCase ? resolveConversationOutcome(activeCase.conversation, activeCase.gates) : null;
  const attributionLabel = activeCase?.conversation.attribution ? RAG_ATTRIBUTIONS.find((item) => item.id === activeCase.conversation.attribution)?.label : null;
  const currentSources = activeCase?.sources ?? [];
  const tone = result.gateStatus === "failed" || result.verdict === "unusable" ? "danger" : result.complete ? "ready" : "pending";

  const selectCase = (item: RagCase) => {
    setActiveCase(item); setQuestion(item.question); setAnswer(item.answer); setNeed(item.need);
    setDimensions(clone(item.dimensions)); setGates(clone(item.gates)); setMode("sample"); setTab("single");
    setNotice("已载入合成样例及预设评审；分数由六维规则实时计算。");
  };
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    const match = findRagSample(input);
    if (match) selectCase(match);
    else {
      setActiveCase(null); setQuestion(input.trim()); setAnswer(""); setNeed(""); setMode("manual");
      setDimensions(emptyDimensions()); setGates(emptyGates());
      setNotice("此问题不在示例库。请录入实际回答后人工评审；当前预览未连接真实问答服务。");
    }
    setInput("");
  };
  const openReview = () => {
    setReviewDimensions(clone(dimensions)); setReviewGates(clone(gates)); setConfirmed(false); setDrawer("review");
  };
  const openAnswer = () => { setAnswerEdit(answer); setNeedEdit(need); setDrawer("answer"); };
  const updateAnswer = (value: string, task: string) => {
    setAnswer(value.trim()); setNeed(task.trim()); setActiveCase(null); setMode("manual");
    setDimensions(emptyDimensions()); setGates(emptyGates()); close();
    setNotice("回答或用户任务已更新，旧评分已失效，请重新核验。历史记录保留原快照。");
  };
  const saveReview = () => {
    if (!answer.trim() || !need.trim() || !reviewer.trim() || !confirmed) return;
    const record: RecordEntry = { id: `review-${crypto.randomUUID()}`, question, answer, need, reviewer: reviewer.trim(), time: new Date().toISOString(), ruleVersion: RAG_RULE_VERSION, knowledgeVersion: activeCase ? KNOWLEDGE_VERSION : "人工录入-待绑定正式知识版本", dimensions: clone(reviewDimensions), gates: clone(reviewGates) };
    const skillResult = enterpriseRagEvaluationSkill.evaluate({ dimensions: record.dimensions, gates: record.gates });
    const reportSaved = saveEvaluationReport({
      reportId: `report-${record.id}`,
      createdAt: record.time,
      subject: { kind: "rag-answer", id: record.id, version: record.ruleVersion },
      result: skillResult,
    });
    setDimensions(record.dimensions); setGates(record.gates); setMode("manual");
    const next = [record, ...history].slice(0, 30); setHistory(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setNotice(`已保存人工评审与独立 RAG 评估快照（${reviewer.trim()}）${reportSaved ? "" : "；评估快照存储不可用"}。未判定或缺少证据的维度仍保持待评估。`); }
    catch { setNotice("人工评审已计算，但浏览器存储不可用，本次记录仅在当前页面保留。"); }
    close();
  };
  const drawerTitle = { review: "人工评审与计算", evidence: "回答依据与陈述核验", rules: "评分规则", improve: "优化方案", answer: "录入待评估回答", history: "评估记录" };
  const groups = (["representative", "challenge"] as const).map((category) => {
    const items = RAG_SAMPLE_CASES.filter((item) => item.category === category);
    return { category, items, result: aggregateEvaluations(items.map((item) => ({ id: item.id, scenario: item.scenario, weight: item.weight, result: scoreEvaluation(item) }))) };
  });

  return <section className="sfp-root erag-root rag-eval-root">
    <div ref={backgroundRef}>
      <header className="sfp-heading erag-heading"><div><h1>让回答真正满足用户需求</h1><p>从问题、回答和证据出发，发现缺口并确定下一步优化。</p></div><button className="sfp-button sfp-button--ghost" onClick={onOpenWebsite}>{websiteEntryLabel}</button></header>
      <div className="erag-flow" aria-label="企业 RAG 工作方式"><div><span><BookOpenCheck size={18} /></span><strong>企业知识库</strong></div><i /><div><span><Search size={18} /></span><strong>检索与回答</strong></div><i /><div><span><ClipboardCheck size={18} /></span><strong>回答质量评估</strong></div></div>
      <div className="rag-toolbar"><div role="tablist" aria-label="评估工作区"><button role="tab" aria-selected={tab === "single"} onClick={() => setTab("single")}>单次问答</button><button role="tab" aria-selected={tab === "set"} onClick={() => setTab("set")}>测试集演示</button></div><div><button onClick={() => setDrawer("rules")}>评分规则</button><button onClick={() => setDrawer("history")}>评估记录 {history.length > 0 ? `(${history.length})` : ""}</button></div></div>
      {notice && <div className="sfp-notice" role="status">{notice}</div>}
      {tab === "single" ? <div className="erag-layout">
        <div className="erag-left-column">
          <section className="sfp-panel erag-knowledge-card"><div className="erag-card-heading"><div><span className="erag-card-icon"><FileText size={18} /></span><strong>RAG 知识底座</strong></div><span className="erag-version">合成知识快照</span></div>
            <div className="erag-stats"><div><strong>{previewKnowledgeCollectionCount}</strong><small>知识集合</small></div><div><strong>{previewKnowledgeFragmentCount}</strong><small>示例知识片段</small></div><div><strong>{currentSources.length}</strong><small>当前来源</small></div></div>
            <div className="rag-knowledge-row"><span>{activeCase ? KNOWLEDGE_VERSION : "实际来源待录入"}</span><button onClick={() => setDrawer("evidence")}>查看知识与依据 <ArrowRight size={14} /></button></div>
          </section>
          <section className="sfp-panel erag-test-card"><div className="erag-card-heading"><div><span className="erag-card-icon"><Bot size={18} /></span><strong>回答示例试用</strong></div><button className="rag-text-button" onClick={openAnswer}>{answer ? "编辑回答" : "录入回答"}</button></div>
            <label className="rag-case-picker">示例场景<select aria-label="选择评估示例" value={activeCase?.id ?? "custom"} onChange={(event) => { const item = RAG_SAMPLE_CASES.find((item) => item.id === event.target.value); if (item) selectCase(item); }}><option value="custom" disabled>自定义问题</option>{RAG_SAMPLE_CASES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <div className="erag-test-thread"><p className="erag-user-message">{question}</p><article><header><Sparkles size={16} /><strong>{websiteDraft.assistant.name || "企业助手"}</strong><small>{activeCase ? "合成回答" : "人工录入"}</small></header><p>{answer || "尚无待评估回答。请粘贴实际回答，不会为新问题套用默认示例。"}</p>{currentSources.length > 0 && <div className="erag-citations">{currentSources.map((source, index) => <button key={source.id} onClick={() => setDrawer("evidence")}>[{index + 1}] {source.title}</button>)}</div>}</article></div>
            <form className="erag-composer" onSubmit={submitQuestion}><input aria-label="输入企业 RAG 示例问题" placeholder="输入访客问题，或选择上方示例" value={input} onChange={(event) => setInput(event.currentTarget.value)} /><button type="submit"><Send size={16} />试用问题</button></form>
          </section>
        </div>
        <aside className="sfp-panel erag-evaluation-panel" role="region" aria-label="回答质量评估">
          <div className="erag-evaluation-panel__heading"><div><span className="erag-card-icon"><ClipboardCheck size={18} /></span><span><h2>回答质量评估</h2><small>{mode === "sample" ? "合成样例 · 预设评审" : "人工评审 · 本地计算"}</small></span></div><output className={`erag-evaluation-score is-${tone}`} aria-label="综合评分" aria-live="polite"><span><strong>{result.score ?? "—"}</strong><small>/100</small></span><em>{result.complete ? "六维加权分" : "待完成评审"}</em></output></div>
          <section className={`rag-verdict is-${tone}`} aria-label="当前评估摘要"><strong>{verdicts[result.verdict]}</strong><p>{result.gateStatus === "failed" ? "发现关键回答风险；高分不能把该回答判为可用，但不会取消网站发布选择。" : result.complete ? (mode === "sample" ? activeCase?.summary : "结论基于人工判定，只提供质量建议，不是发布授权。") : "完成维度与关键风险核验后，才能形成回答可用性结论。"}</p><div className="rag-status-row"><span><ShieldCheck size={14} />关键风险{result.gateStatus === "passed" ? "已核验" : result.gateStatus === "failed" ? "已发现" : "待核验"}</span><span>评审覆盖 {format(result.coverage)}%</span>{!result.complete && <span>可能分数 {Math.floor(result.lower)}–{Math.ceil(result.upper)}</span>}</div></section>
          <section className="rag-conversation" aria-label="完整对话判定">
            <header><h3>完整对话判定</h3>{conversation && <span className={`rag-case-status is-${conversation.status}`}>{RAG_CASE_STATUS_LABELS[conversation.status]}</span>}</header>
            {mode === "sample" && activeCase && conversation ? <>
              <p className="rag-conversation__task"><strong>客户任务：</strong>{activeCase.conversation.task}</p>
              <ul className="rag-checklist">{activeCase.conversation.completionPoints.map((point) => <li key={point.id} className={point.met === true ? "is-met" : point.met === false ? "is-miss" : "is-na"}><i aria-hidden="true">{point.met === true ? "✓" : point.met === false ? "✗" : "？"}</i>{point.label}</li>)}</ul>
              <p className="rag-conversation__reason">{conversation.reason}</p>
              <div className="rag-conversation__meta">
                <span>{RAG_CASE_MODE_LABELS[activeCase.mode]}</span>
                <span>{activeCase.set === "benchmark" ? "稳定基准集" : "扩展测试集"}</span>
                <span>规定运行 {activeCase.conversation.runsRequired} 次</span>
                {attributionLabel && <span>归因：{attributionLabel}</span>}
              </div>
            </> : <p className="rag-conversation__reason">完整对话层判定在正式测试用例中执行（客户任务、逐轮记录、必要完成点与规定运行次数）。当前为单次回答评审，单轮分数不能替代任务完成判定。</p>}
          </section>
          <div className="erag-evaluation-dimensions rag-dimensions" aria-label="六维加权评分">{RAG_DIMENSIONS.map((item, index) => { const judgment = dimensions.find((d) => d.id === item.id); const earned = result.earnedByDimension[item.id]; return <button key={item.id} className={earned === null ? "is-pending" : (judgment?.level ?? 0) < 3 ? "is-attention" : "is-positive"} onClick={openReview}><span>{shortLabels[index]}</span><strong>{earned === null ? "—" : format(earned)}<small>/{item.weight}</small></strong></button>; })}</div>
          <section className="rag-user-need"><h3>用户真正想确认</h3><p>{need || "请在录入回答时补充用户任务，避免只按字面匹配评分。"}</p></section>
          <section className="rag-priority"><h3><Lightbulb size={17} />优先优化</h3>{issues.length ? <><div><span className={`rag-priority-label is-${issues[0].priority}`}>{issues[0].priority}</span><strong>{issues[0].title}</strong></div><p>{issues[0].action}</p><button className="rag-text-button" onClick={() => setDrawer("improve")}>查看优化方案 <ArrowRight size={14} /></button></> : <p>{result.complete ? "当前记录没有待修复项；继续用更多真实场景验证。" : "先补齐当前回答的判断依据，再确定优化方向。"}</p>}</section>
          <div className="rag-panel-actions"><div><button className="sfp-button sfp-button--primary" disabled={!answer.trim() || !need.trim()} onClick={openReview}>人工评审与计算</button><button className="sfp-button sfp-button--ghost" onClick={() => setDrawer("evidence")}>查看回答依据</button></div><button className="rag-text-button rag-website-link" onClick={onOpenWebsiteAssistant}>进入网站建设的 AI 助手 <ArrowRight size={14} /></button></div>
        </aside>
      </div> : (() => {
        const report = buildReportMetrics(RAG_SAMPLE_CASES.map((item) => ({ id: item.id, mode: item.mode, status: resolveConversationOutcome(item.conversation, item.gates).status, coveragePointIds: item.coveragePointIds })), RAG_COVERAGE_POINTS);
        const rate = (value: number | null) => value === null ? "—" : `${format(value)}%`;
        return <section className="sfp-panel rag-testset"><header><h2>测试集与验收口径演示</h2><p>合成样例演示用例状态、覆盖点与分项指标；通过率不能抵消已确认的回答风险，也不构成企业 RAG 系统分或发布授权。</p></header>
          <div className="rag-metric-row" aria-label="核心统计指标">
            <div><strong>{rate(report.normal.passRate)}</strong><small>正常问答通过率 · {report.normal.pass}/{report.normal.pass + report.normal.fail} 已判定</small></div>
            <div><strong>{rate(report.restricted.passRate)}</strong><small>受限应答通过率 · {report.restricted.pass}/{report.restricted.pass + report.restricted.fail} 已判定</small></div>
            <div><strong>{report.normal.unverified + report.restricted.unverified}</strong><small>未验收（单列，不并入通过率）</small></div>
            <div><strong>{rate(report.coverage.rate)}</strong><small>必要覆盖点 · {report.coverage.coveredIds.length}/{RAG_COVERAGE_POINTS.length}</small></div>
          </div>
          <div className="rag-coverage-chips" aria-label="必要覆盖点覆盖情况">{RAG_COVERAGE_POINTS.map((point) => <span key={point.id} className={report.coverage.uncoveredIds.includes(point.id) ? "is-uncovered" : "is-covered"}>{point.label}{report.coverage.uncoveredIds.includes(point.id) ? " · 未完成有效覆盖" : ""}<small>{point.risk}</small></span>)}</div>
          {groups.map((group) => <section key={group.category}><div className="rag-testset-heading"><h3>{group.category === "representative" ? "代表集 · 常规任务" : "挑战集 · 风险与边界"}</h3><span>{group.category === "representative" ? `场景加权分 ${group.result.score ?? "—"}/100` : `可用 ${group.result.usableCount}/${group.result.total} · 关键风险 ${group.result.failedGateCount}`}</span></div><div className="rag-case-list">{group.items.map((item) => { const grade = scoreEvaluation(item); const outcome = resolveConversationOutcome(item.conversation, item.gates); const attribution = item.conversation.attribution ? RAG_ATTRIBUTIONS.find((entry) => entry.id === item.conversation.attribution)?.label : null; return <button key={item.id} onClick={() => selectCase(item)}><span><strong>{item.title}</strong><small>{item.question}</small>{attribution && <small className="rag-attribution">归因：{attribution}</small>}</span><span className="rag-case-result"><span className={`rag-case-status is-${outcome.status}`}>{RAG_CASE_STATUS_LABELS[outcome.status]}</span><b className={grade.gateStatus === "failed" ? "rag-danger-text" : ""}>{grade.score ?? "—"}</b><small>/100 <ArrowRight size={14} /></small></span></button>; })}</div></section>)}
          <p className="rag-muted">正常问答与受限应答分别统计；分母为零显示"—"，未验收用例单列且不计入有效覆盖。重点风险用例（越权、无依据承诺）规定运行 3 次，全部通过才算通过；当前为合成预设评审，属演示数据。稳定基准集与扩展测试集分层管理，历史结果不覆盖；模拟访客自动执行、批量复测与独立复核尚待接入（M1 后端）。</p>
        </section>;
      })()}
    </div>
    {drawer && <div className="rag-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside ref={dialogRef} className="rag-drawer" role="dialog" aria-modal="true" aria-labelledby="rag-drawer-title" tabIndex={-1}><header><div><small>{RAG_RULE_VERSION}</small><h2 id="rag-drawer-title">{drawerTitle[drawer]}</h2></div><button aria-label="关闭评估面板" onClick={close}><X size={20} /></button></header><div className="rag-drawer-body">
      {drawer === "review" && <><div className="rag-context"><strong>{question}</strong><p>{answer}</p><small>当前任务：{need || "尚未填写"}</small></div><p className="rag-muted">逐维核验后填写等级、理由与证据定位。缺项可保存，但不会被当成已通过。适用性已按固定方案冻结。</p>{RAG_DIMENSIONS.map((item, index) => { const judgment = reviewDimensions[index]; return <fieldset className="rag-review-field" key={item.id}><legend>{shortLabels[index]} · {item.weight} 分</legend><p>{item.question}</p><label>判断等级<select aria-label={`${shortLabels[index]}等级`} value={judgment?.level ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, level: event.target.value === "" ? null : Number(event.target.value) as Rating } : d))}><option value="">待判定</option>{levels.map((label, level) => <option key={level} value={level}>{level} · {label}</option>)}</select></label><label>判断理由<textarea aria-label={`${shortLabels[index]}理由`} value={judgment?.rationale ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, rationale: event.target.value } : d))} /></label><label>证据定位<input aria-label={`${shortLabels[index]}证据`} placeholder="来源段落、陈述 ID 或回答原句；用逗号分隔" value={judgment?.evidenceIds.join(", ") ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, evidenceIds: event.target.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean) } : d))} /></label></fieldset>; })}<h3>关键回答风险</h3>{RAG_GATES.map((item, index) => <fieldset className="rag-review-field rag-gate-field" key={item.id}><legend>{item.label}</legend><p>{item.description}</p><label>核验结果<select aria-label={`${item.label}风险核验`} value={reviewGates[index]?.status ?? "pending"} onChange={(event) => setReviewGates((old) => old.map((g) => g.id === item.id ? { ...g, status: event.target.value as GateJudgment["status"] } : g))}><option value="pending">待核验</option><option value="passed">通过</option><option value="failed">发现风险</option></select></label><label>核验依据<input aria-label={`${item.label}风险核验依据`} value={reviewGates[index]?.reason ?? ""} onChange={(event) => setReviewGates((old) => old.map((g) => g.id === item.id ? { ...g, reason: event.target.value } : g))} /></label></fieldset>)}<label className="rag-reviewer">评审人<input aria-label="评审人" value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="姓名或评审代号" /></label><label className="rag-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />已对照当前回答与证据进行核验，不将预设评审当作自动评估结果。</label><p className="rag-muted">记录仅保存在当前浏览器，最多保留 30 条。请勿粘贴敏感业务资料。</p></>}
      {drawer === "answer" && <><div className="rag-context"><strong>{question}</strong></div><label className="rag-editor-label">用户任务<textarea aria-label="用户任务" value={needEdit} onChange={(event) => setNeedEdit(event.target.value)} placeholder="访客希望解决什么、做出什么决定？" /></label><label className="rag-editor-label">实际回答<textarea className="rag-answer-editor" aria-label="实际回答" value={answerEdit} onChange={(event) => setAnswerEdit(event.target.value)} placeholder="粘贴待评估的回答，包括引用定位。此处不会调用模型。" /></label><p className="rag-muted">保存后清空当前评审。人工证据通过评审表逐项记录，不会自动继承示例来源。</p></>}
      {drawer === "evidence" && <><div className="rag-context"><strong>{question}</strong><p>知识版本：{activeCase ? KNOWLEDGE_VERSION : "待绑定正式知识版本"}</p></div><h3>陈述与证据</h3>{activeCase?.claims.length ? activeCase.claims.map((claim) => <article className="rag-evidence" key={claim.id}><header><strong>{claim.id}</strong><span className={claim.status === "supported" ? "" : "rag-danger-text"}>{{ supported: "有支持", partial: "部分支持", unsupported: "无支持", restricted: "权限受限" }[claim.status]}</span></header><p>{claim.text}</p><small>{claim.note} · {claim.sourceIds.join("、") || "没有来源"}</small></article>) : <p>当前为人工录入回答。请在评审表中逐维记录可核验的原文与来源定位。</p>}<h3>来源原文</h3>{currentSources.map((source) => <article className="rag-evidence" key={source.id}><header><strong>{source.title}</strong><span>{source.scope}</span></header><small>{source.id} · {source.section} · {source.version}</small><blockquote>{source.excerpt}</blockquote></article>)}<h3>本次判断记录</h3>{dimensions.map((item, index) => <article className="rag-evidence" key={item.id}><strong>{shortLabels[index]} · {item.level === null ? "待判定" : `${item.level}/4`}</strong><p>{item.rationale || "判断理由待补充"}</p><small>证据：{item.evidenceIds.join("、") || "待补充"}</small></article>)}<h3>关键风险核验</h3>{gates.map((gate) => <article className="rag-evidence" key={gate.id}><strong>{RAG_GATES.find((g) => g.id === gate.id)?.label} · {{ passed: "通过", failed: "发现风险", pending: "待核验" }[gate.status]}</strong><p>{gate.reason || "尚无核验记录"}</p></article>)}<p className="rag-muted">预设评审只针对这些合成文本与快照；不证明真实服务已抵御注入、越权或其他攻击。</p></>}
      {drawer === "rules" && <><h3>六维 100 分</h3><p className="rag-formula">总分 = Σ（维度权重 × 等级 ÷ 4）</p>{RAG_DIMENSIONS.map((item) => <article className="rag-evidence" key={item.id}><header><strong>{item.label}</strong><b>{item.weight} 分</b></header><p>{item.question}</p></article>)}<h3>等级与结论</h3><p>0 不满足 · 1 少量满足 · 2 部分满足 · 3 基本满足 · 4 充分满足。等级必须附判断理由和证据定位。</p><p>原始分 ≥90 优秀；≥80 可用；≥70 需要改进；低于 70 不可用。显示分四舍五入，结论使用未取整的原始分。</p><h3>关键风险优先于回答分数</h3><p>任一关键风险成立，该回答直接判为不可用；有风险待核验，不判为可用。此结论是质量建议，不阻止用户进入网站发布确认。</p>{RAG_GATES.map((item) => <article className="rag-evidence" key={item.id}><strong>{item.label}</strong><p>{item.description}</p></article>)}<h3>缺证据不计作通过</h3><p>未判定维度不删除、不补成满分。页面显示已核验权重覆盖率及数学上的可能得分范围；范围不是统计置信区间。不适用项须在正式测试计划中预先批准，当前页面不提供临时剔除。</p><h3>分数的使用边界</h3><p>单次回答分、企业 RAG 系统分与网站建设评估彼此独立。合成示例、单人自评和少量测试都不能替代正式代表集验收或独立复核。任务未完成或关键回答风险成立时，高分不改变该回答的质量结论；但评估结果不拥有网站发布权限。</p><h3>验收参数 · 初始默认值</h3><p>以下为需求说明第十三章的初始基线，用于试运行与技术设计，不是实测结论；调整需保留原值、原因、版本与审批记录。</p>{RAG_ACCEPTANCE_PARAMS.map((item) => <article className="rag-evidence" key={item.label}><header><strong>{item.label}</strong></header><p>{item.value}</p></article>)}</>}
      {drawer === "improve" && <>{(() => { const blocking = issues.filter((issue) => issue.priority === "P0"); const recorded = issues.filter((issue) => issue.priority !== "P0"); return <>
        <h3>高优先级风险（建议修复并复测）</h3>{blocking.length ? blocking.map((issue) => <article className="rag-evidence" key={issue.id}><header><strong>{issue.title}</strong><span>{issue.priority}</span></header><p>{issue.impact}</p><small>修复方向：{issue.action}</small></article>) : <p className="rag-muted">当前没有已确认的高优先级风险。完整对话层判定不通过时，会在此说明。</p>}
        <h3>一般记录项（仍需留痕）</h3>{recorded.length ? recorded.map((issue) => <article className="rag-evidence" key={issue.id}><header><strong>{issue.title}</strong><span>{issue.priority}</span></header><p>{issue.impact}</p><small>修复方向：{issue.action}</small></article>) : <p className="rag-muted">当前没有一般记录项。重复询问、轻微弱相关推荐、展示前已纠正的误拦属于这一类。</p>}
      </>; })()}{mode === "sample" && activeCase ? <><h3>{activeCase.improvement.title}</h3><ol>{activeCase.improvement.steps.map((step) => <li key={step}>{step}</li>)}</ol>{activeCase.improvement.answer && <><h3>建议改写 · 待复评</h3><p className="rag-proposed-answer">{activeCase.improvement.answer}</p><button className="sfp-button sfp-button--primary" onClick={() => updateAnswer(activeCase.improvement.answer!, need)}>采用改写并重新评审</button></>}</> : <p>建议由当前人工判断生成，请对照真实知识修订。页面不会编造一条“高分回答”。</p>}</>}
      {drawer === "history" && <><p className="rag-muted">本地快照绑定问题、回答、知识版本和规则版本；修改回答不会覆盖旧记录。当前浏览器保存 {history.length}/30 条。</p>{history.length === 0 ? <p>暂无已保存的人工评审。完成评审后在这里查看。</p> : history.map((record) => { const grade = scoreEvaluation(record); const sameAnswer = record.question === question && record.answer === answer && record.need === need; return <article className="rag-evidence" key={record.id}><header><strong>{record.question}</strong><span>{grade.score ?? "—"}/100</span></header><p>{verdicts[grade.verdict]} · {sameAnswer ? "与当前回答相同" : "历史快照，不适用于当前回答"}</p><small>{record.reviewer} · {new Date(record.time).toLocaleString("zh-CN")} · {record.knowledgeVersion} · {record.ruleVersion}</small><details><summary>查看回答与判断</summary><p>{record.answer}</p>{record.dimensions.map((item) => <p key={item.id}>{RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}：{item.level ?? "待判定"}/4 · {item.rationale}</p>)}</details></article>; })}</>}
    </div><footer>{drawer === "review" ? <button className="sfp-button sfp-button--primary" disabled={!answer.trim() || !need.trim() || !reviewer.trim() || !confirmed} onClick={saveReview}>保存评审并计算</button> : drawer === "answer" ? <button className="sfp-button sfp-button--primary" disabled={!answerEdit.trim() || !needEdit.trim()} onClick={() => updateAnswer(answerEdit, needEdit)}>保存回答，重新评审</button> : <button className="sfp-button sfp-button--ghost" onClick={close}>完成</button>}</footer></aside></div>}
  </section>;
}
export default EnterpriseRagPreview;
