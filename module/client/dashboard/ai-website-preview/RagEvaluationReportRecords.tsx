import { useEffect, useRef, useState } from "react";
import { liveEnterpriseRagEvaluationApi, type EnterpriseRagEvaluationCoordinate } from "../enterprise-rag-evaluation-api";
import { liveEnterpriseRagHumanReviewApi } from "../enterprise-rag-human-review-api";
import type { EnterpriseRagHumanReviewDto } from "../../../contracts/enterprise-rag-human-review";
import { isChecklistRagJudgment, isGradedRagJudgment, type EnterpriseRagEvaluationReport, type EnterpriseRagEvaluationRunDto } from "../../../contracts/enterprise-rag-evaluation-run";
import { RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, scoreEvaluation } from "./rag-evaluation";
import { scoreEvaluation as scoreLegacyEvaluation } from "./rag-evaluation-legacy";
import { enterpriseRagQualityVerdictLabels, legacyRagVerdictLabels, presentRagSummary, reportVerdict } from "./rag-report-presentation";
import { enterpriseRagHistoryStorageKey, readRagReviewHistory, type RagReviewHistoryRead, type RagReviewRecord } from "./rag-review-history";
import "./rag-report-records.css";

export type RagEvaluationReportRecordsProps = {
  storageScopeKey: string;
  preview: boolean;
  coordinate?: EnterpriseRagEvaluationCoordinate;
};

const runStatus: Record<EnterpriseRagEvaluationRunDto["status"], string> = {
  queued: "已排队", uploading: "正在准备材料", create_unknown: "正在确认任务",
  running: "自动评估中", result_pending: "正在校验结果", completed: "评估完成", failed: "评估失败",
};
const gateStatus: Record<string, string> = { passed: "通过", failed: "发现风险", pending: "待核验" };
const checkStatus: Record<string, string> = { met: "满足", partial: "部分满足", unmet: "不满足", undetermined: "待核验", not_applicable: "不适用" };
const claimStatus: Record<string, string> = { supported: "有支持", partial: "部分支持", unsupported: "无支持", contradicted: "与依据矛盾", unverifiable: "待补证", not_applicable: "非事实说明" };
const terminal = new Set(["completed", "failed"]);
const number = (value: number) => Number(value.toFixed(2)).toString();
const stamp = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value || "时间未记录";
};

function Score({ value, unavailable = false }: { value?: number | null; unavailable?: boolean }) {
  return <span className="rag-report-record-score">{unavailable ? "评分不适用" : typeof value === "number" ? `${number(value)} / 100` : "—"}</span>;
}

function EvidenceIds({ ids }: { ids: unknown[] }) {
  const available = ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  return <p className="rag-report-record-note">证据定位：{available.length ? available.join("、") : "未记录"}</p>;
}

function Metadata({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return <dl className="rag-report-record-metadata">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null || value === undefined || value === "" ? "未记录" : value}</dd></div>)}</dl>;
}

function ReportDetails({ report }: { report: EnterpriseRagEvaluationReport }) {
  const judged = report.judgments;
  const graded = isGradedRagJudgment(judged);
  const checklist = isChecklistRagJudgment(judged);
  return <>
    <div className="rag-report-record-block"><h4>评估结论</h4><p>{presentRagSummary(report.result.summary)}</p><Metadata rows={[
      ["诊断分", report.result.score === null ? "待核验" : `${number(report.result.score)} / 100`],
      ["评审覆盖率", `${number(report.result.coverage)}%`],
      ["知识版本", `v${report.knowledgeBase.version}`],
    ]} />{reportVerdict(report) === "unusable" && <p className="rag-report-record-note">诊断分不改变“需修复”的结论。</p>}</div>
    {graded && <div className="rag-report-record-block"><h4>客户任务结果</h4><p>{({ completed: "已完成", failed: "未完成", undetermined: "待核验" })[judged.task.status]} · {judged.task.rationale}</p><EvidenceIds ids={judged.task.evidenceIds} /></div>}
    <div className="rag-report-record-block"><h4>六维判断</h4><div className="rag-report-record-table-scroll" tabIndex={0} role="region" aria-label="六维判断明细"><table><thead><tr><th>维度</th><th>得分／权重</th><th>判断依据</th></tr></thead><tbody>{report.result.dimensions.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{item.score === null ? "待核验" : number(item.score)} / {item.maxScore}</td><td>{item.summary}<EvidenceIds ids={item.evidenceIds} /></td></tr>)}</tbody></table></div></div>
    {checklist && <div className="rag-report-record-block"><h4>冻结检查项</h4><p>{judged.checklist.selectionReason}</p><ol className="rag-report-record-list">{judged.checklist.checks.map(check => {
      const result = judged.checks.find(item => item.id === check.id);
      return <li key={check.id}><strong>{check.label}</strong><span className="rag-report-record-inline-status">{result ? checkStatus[result.status] : "待核验"} · {check.weight} 分</span><p>{check.requirement}</p><p>{result?.rationale || "暂无判断理由。"}</p>{!check.applicable && <p>排除理由：{check.exclusionReason}</p>}{result && <EvidenceIds ids={result.evidenceIds} />}</li>;
    })}</ol></div>}
    <div className="rag-report-record-block"><h4>关键风险核验</h4><ul className="rag-report-record-list">{judged.gates.map(item => <li key={item.id}><strong>{RAG_GATES.find(gate => gate.id === item.id)?.label ?? item.id}</strong><span className="rag-report-record-inline-status">{gateStatus[item.status]}</span><p>{item.reason}</p><EvidenceIds ids={item.evidenceIds} /></li>)}</ul></div>
    {report.result.risks.length > 0 && <div className="rag-report-record-block"><h4>报告风险</h4><ul className="rag-report-record-list">{report.result.risks.map(item => <li key={item.id}><strong>{item.title}</strong><span className="rag-report-record-inline-status">{({ low: "低", medium: "中", high: "高", critical: "关键" })[item.severity]}</span><p>{item.summary}</p><EvidenceIds ids={item.evidenceIds} /></li>)}</ul></div>}
    <div className="rag-report-record-block"><h4>陈述与证据</h4>{judged.claims.length ? <ol className="rag-report-record-list">{judged.claims.map(item => <li key={item.id}><strong>{item.id}</strong><span className="rag-report-record-inline-status">{claimStatus[item.status] ?? item.status}</span><blockquote>{item.statement}</blockquote><p>{item.rationale}</p><EvidenceIds ids={item.sourceIds} /></li>)}</ol> : <p>报告未提供陈述记录。</p>}</div>
    {graded && judged.findings.length > 0 && <div className="rag-report-record-block"><h4>发现的问题</h4><ul className="rag-report-record-list">{judged.findings.map(item => <li key={item.id}><strong>{item.summary}</strong><span className="rag-report-record-inline-status">{({ critical: "关键问题", improvement: "改进项", undetermined: "待核验" })[item.severity]}</span><p>{item.impact}</p><EvidenceIds ids={[...item.claimIds, ...item.evidenceIds]} /></li>)}</ul></div>}
    {checklist && judged.optionalSuggestions.length > 0 && <div className="rag-report-record-block"><h4>可选建议</h4><ul className="rag-report-record-list">{judged.optionalSuggestions.map(item => <li key={item.id}><strong>{item.summary}</strong><p>{item.benefit}</p><EvidenceIds ids={item.evidenceIds} /></li>)}</ul></div>}
    <div className="rag-report-record-block"><h4>报告溯源</h4><Metadata rows={[
      ["报告编号", report.reportId], ["完成时间", stamp(report.completedAt)],
      ["问答任务", report.sourceQaTaskId], ["回答轮次", report.sourceTurnId], ["会话编号", report.conversationId],
      ["问题消息", report.questionMessageId], ["回答消息", report.answerMessageId],
      ["知识资料", report.knowledgeBase.sourceFileName], ["知识快照", report.knowledgeBase.snapshotId],
      ["知识哈希", report.knowledgeBase.contentHash], ["问题哈希", report.questionHash], ["回答哈希", report.answerHash],
      ["评估器哈希", report.evaluator.skillHash], ["输出哈希", report.evaluator.outputHash],
      ["关联报告", report.result.relatedReportIds.length ? report.result.relatedReportIds.join("、") : "无"],
    ]} /></div>
  </>;
}

function AutomaticRecord({ run }: { run: EnterpriseRagEvaluationRunDto }) {
  const report = run.report;
  const verdict = report ? reportVerdict(report) : null;
  const label = report && verdict ? (report.evaluator.ruleVersion === "rag-eval-1.2" ? legacyRagVerdictLabels : enterpriseRagQualityVerdictLabels)[verdict] : runStatus[run.status];
  return <details className="rag-report-record" data-testid="rag-report-automatic-record">
    <summary><span className="rag-report-record-meta"><time dateTime={run.createdAt}>{stamp(run.createdAt)}</time><span>{label}</span></span><span className="rag-report-record-line"><span>{report?.result.summary ? presentRagSummary(report.result.summary) : run.error?.message || runStatus[run.status]}</span><Score value={report?.result.score} unavailable={verdict === "unusable"} /></span></summary>
    <div className="rag-report-record-detail"><Metadata rows={[["操作编号", run.operationId], ["运行状态", runStatus[run.status]], ["最近更新", stamp(run.updatedAt)]]} />{run.error && <p role="status">{run.error.message}（{run.error.code}）</p>}{report ? <ReportDetails report={report} /> : <p>本次评估尚未生成报告。</p>}</div>
  </details>;
}

type ManualRecordView = {
  record: RagReviewRecord;
  authoritative?: Pick<EnterpriseRagHumanReviewDto, "humanScore" | "humanVerdict">;
};

function ManualRecord({ record, authoritative }: ManualRecordView) {
  const grade = record.ruleVersion === "rag-eval-1.2" ? scoreLegacyEvaluation(record) : record.ruleVersion === RAG_RULE_VERSION ? scoreEvaluation(record) : null;
  const verdict = authoritative?.humanVerdict ?? grade?.verdict;
  const score = authoritative ? authoritative.humanScore : grade?.score;
  const label = verdict ? (record.ruleVersion === "rag-eval-1.2" ? legacyRagVerdictLabels : enterpriseRagQualityVerdictLabels)[verdict] : "历史规则暂不支持重新计算";
  return <details className="rag-report-record" data-testid="rag-report-manual-record">
    <summary><span className="rag-report-record-meta"><time dateTime={record.time}>{stamp(record.time)}</time><span>{label}</span></span><span className="rag-report-record-line"><span>{record.question || "未记录问题"}</span><Score value={score} unavailable={verdict === "unusable"} /></span></summary>
    <div className="rag-report-record-detail">
      <Metadata rows={[["评审人", record.reviewer], ["知识版本", record.knowledgeVersion], ["记录编号", record.id]]} />
      {!grade && <p className="rag-report-record-note">以下保留原始评审内容，不使用当前规则重新计算。</p>}
      <div className="rag-report-record-block"><h4>任务描述</h4><p>{record.need || "未记录"}</p></div>
      <div className="rag-report-record-block"><h4>问题与回答</h4><p>{record.question}</p><blockquote>{record.answer}</blockquote></div>
      {grade && <Metadata rows={[["诊断分", score === null || score === undefined ? "待核验" : `${number(score)} / 100`], ["评审覆盖率", `${number(grade.coverage)}%`], ["可能得分范围", `${number(grade.lower)}–${number(grade.upper)}`]]} />}
      <div className="rag-report-record-block"><h4>六维人工评分</h4><ul className="rag-report-record-list">{record.dimensions.map((item, index) => <li key={`${item.id}-${index}`}><strong>{RAG_DIMENSIONS.find(dimension => dimension.id === item.id)?.label ?? item.id}</strong><span className="rag-report-record-inline-status">{item.applicable === false ? "不适用" : typeof item.level === "number" ? `${item.level} / 4` : "待核验"}</span><p>{item.rationale || "未记录理由"}</p><EvidenceIds ids={item.evidenceIds} /></li>)}</ul></div>
      <div className="rag-report-record-block"><h4>关键风险核验</h4><ul className="rag-report-record-list">{record.gates.map((item, index) => <li key={`${item.id}-${index}`}><strong>{RAG_GATES.find(gate => gate.id === item.id)?.label ?? item.id}</strong><span className="rag-report-record-inline-status">{gateStatus[item.status] ?? "待核验"}</span><p>{item.reason || "未记录理由"}</p></li>)}</ul></div>
    </div>
  </details>;
}

type AutomaticState = { owner: string; runs: EnterpriseRagEvaluationRunDto[]; loading: boolean; awaiting: boolean; error: string };

export function RagEvaluationReportRecords({ storageScopeKey, preview, coordinate }: RagEvaluationReportRecordsProps) {
  const storageKey = enterpriseRagHistoryStorageKey(storageScopeKey);
  const [manual, setManual] = useState<{ key: string; value: RagReviewHistoryRead }>(() => ({ key: storageKey, value: readRagReviewHistory(storageKey) }));
  const owner = JSON.stringify([storageScopeKey, preview, coordinate?.sourceQaTaskId, coordinate?.turnId]);
  const [automatic, setAutomatic] = useState<AutomaticState>({ owner, runs: [], loading: !preview && Boolean(coordinate), awaiting: false, error: "" });
  const [formalManual, setFormalManual] = useState<{ owner: string; reviews: EnterpriseRagHumanReviewDto[]; loading: boolean }>({ owner, reviews: [], loading: !preview && Boolean(coordinate) });
  const reloadAutomatic = useRef<() => void>(() => {});

  useEffect(() => {
    const read = () => setManual({ key: storageKey, value: readRagReviewHistory(storageKey) });
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey) read(); };
    const visible = () => { if (document.visibilityState === "visible") read(); };
    read();
    window.addEventListener("storage", storage); window.addEventListener("focus", read); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", visible); };
  }, [storageKey]);

  useEffect(() => {
    let alive = true;
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (preview || !coordinate) {
        setAutomatic({ owner, runs: [], loading: false, awaiting: false, error: "" });
        setFormalManual({ owner, reviews: [], loading: false });
        return;
      }
      const sequence = ++request;
      setAutomatic(previous => ({ owner, runs: previous.owner === owner ? previous.runs : [], loading: true, awaiting: previous.owner === owner && previous.awaiting, error: "" }));
      setFormalManual(previous => ({ owner, reviews: previous.owner === owner ? previous.reviews : [], loading: true }));
      try {
        const result = await liveEnterpriseRagEvaluationApi.latest(coordinate);
        if (!alive || sequence !== request) return;
        const incoming = [...(result.latest ? [result.latest] : []), ...result.history];
        if (incoming.some(run => run.sourceQaTaskId !== coordinate.sourceQaTaskId || run.turnId !== coordinate.turnId || (run.report && (run.report.sourceQaTaskId !== coordinate.sourceQaTaskId || run.report.sourceTurnId !== coordinate.turnId)))) throw new Error("评估记录与当前回答不匹配，请重新打开报告页。");
        const unique = new Map<string, EnterpriseRagEvaluationRunDto>();
        incoming.forEach(run => { if (!unique.has(run.operationId)) unique.set(run.operationId, run); });
        const runs = [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
        const hasReport = runs.some(run => Boolean(run.report));
        const blocked = !hasReport && result.automaticAdmission?.status === "blocked";
        const awaiting = !hasReport && !blocked && Boolean(result.automaticExpected || result.automaticAdmission?.status === "retrying");
        setAutomatic({ owner, runs, loading: false, awaiting, error: blocked ? "评估未完成，请重新读取状态。" : "" });
        const reportOperationIds = [...new Set(runs.filter(run => Boolean(run.report)).map(run => run.operationId))];
        if (reportOperationIds.length === 0) setFormalManual({ owner, reviews: [], loading: false });
        else {
          void Promise.all(reportOperationIds.map(operationId => liveEnterpriseRagHumanReviewApi.list(operationId))).then(groups => {
            if (!alive || sequence !== request) return;
            const uniqueReviews = new Map<string, EnterpriseRagHumanReviewDto>();
            groups.flat().forEach(review => { if (!uniqueReviews.has(review.id)) uniqueReviews.set(review.id, review); });
            setFormalManual({ owner, reviews: [...uniqueReviews.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), loading: false });
          }).catch(() => {
            if (!alive || sequence !== request) return;
            setFormalManual(previous => ({ owner, reviews: previous.owner === owner ? previous.reviews : [], loading: false }));
          });
        }
        if ((awaiting || runs.some(run => !terminal.has(run.status))) && document.visibilityState === "visible") timer = setTimeout(() => void refresh(), 5000);
      } catch (error) {
        if (!alive || sequence !== request) return;
        setAutomatic(previous => ({ owner, runs: previous.owner === owner ? previous.runs : [], loading: false, awaiting: false, error: error instanceof Error ? error.message : "暂时无法读取自动评估记录。" }));
        setFormalManual(previous => ({ owner, reviews: previous.owner === owner ? previous.reviews : [], loading: false }));
      }
    };
    const focus = () => { void refresh(); };
    const visibility = () => { if (document.visibilityState === "visible") void refresh(); else clearTimeout(timer); };
    reloadAutomatic.current = focus;
    void refresh(); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { alive = false; ++request; clearTimeout(timer); reloadAutomatic.current = () => {}; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, [owner]);

  const history = manual.key === storageKey ? manual.value : { records: [], status: "ready" as const, discarded: 0 };
  const state = automatic.owner === owner ? automatic : { owner, runs: [], loading: !preview && Boolean(coordinate), awaiting: false, error: "" };
  const formalReviews = formalManual.owner === owner ? formalManual.reviews : [];
  const manualRecords: ManualRecordView[] = preview
    ? [...history.records].sort((a, b) => b.time.localeCompare(a.time)).map(record => ({ record }))
    : formalReviews.map(review => ({
        record: {
          id: review.id,
          question: review.snapshot.question,
          answer: review.snapshot.answer,
          need: review.snapshot.need || review.snapshot.question,
          reviewer: review.reviewer.displayName,
          time: review.createdAt,
          ruleVersion: RAG_RULE_VERSION,
          knowledgeVersion: review.snapshot.knowledgeVersion,
          dimensions: review.dimensions,
          gates: review.gates,
        },
        authoritative: { humanScore: review.humanScore, humanVerdict: review.humanVerdict },
      }));
  return <section id="records" className="rag-report-section rag-report-records" aria-labelledby="rag-report-records-title">
    <h2 id="rag-report-records-title"><span className="rag-report-section-number">02</span> 评估记录</h2>
    <p>自动评估与人工评审分别保留原有规则和结果。</p>
    <section className="rag-report-record-group" aria-labelledby="rag-report-auto-title"><h3 id="rag-report-auto-title">当前回答的自动评估</h3><p className="rag-report-record-note">仅展示打开此页时所选回答的记录，不包含工作区其他问答。</p>
      {coordinate && !preview && <Metadata rows={[["问答任务", coordinate.sourceQaTaskId], ["回答轮次", coordinate.turnId]]} />}
      {state.error && <div className="rag-report-record-notice" role="alert"><p>{state.error}</p>{state.runs.length > 0 && <p>下方保留上次成功读取的记录。</p>}<button type="button" onClick={() => reloadAutomatic.current()}>重新读取</button></div>}
      {state.awaiting ? <p className="rag-report-record-note" role="status">正在评估本次回答</p> : state.loading && <p className="rag-report-record-note" role="status">正在读取评估记录…</p>}
      {preview ? <p className="rag-report-empty">暂无评估记录。</p> : !coordinate ? <p className="rag-report-empty">未选择回答。请从企业 RAG 页面打开对应回答的评估记录。</p> : state.runs.length === 0 && !state.loading && !state.awaiting && !state.error ? <p className="rag-report-empty">当前回答暂无自动评估记录。</p> : null}
      {state.runs.map(run => <AutomaticRecord key={run.operationId} run={run} />)}
    </section>
    <section className="rag-report-record-group" aria-labelledby="rag-report-manual-title"><h3 id="rag-report-manual-title">当前工作区的人工评审</h3>
      {preview && history.status === "unavailable" && <p role="alert">浏览器存储不可用，暂时无法读取人工评审记录。</p>}
      {preview && history.status === "invalid" && <p role="alert">部分本地记录格式无效，无法完整读取；有效记录仍显示在下方。</p>}
      {manualRecords.length === 0 && (preview ? history.status === "ready" : !formalManual.loading) && <p className="rag-report-empty">暂无已保存的人工评审。</p>}
      {manualRecords.map((item, index) => <ManualRecord key={`${item.record.id}-${index}`} {...item} />)}
    </section>
  </section>;
}
