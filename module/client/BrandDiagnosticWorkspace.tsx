import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  Loader2,
  Search,
  Square,
  X,
} from "lucide-react";
import { captureWorkspaceRestOperation } from "./host";
import {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_LABELS,
  type DiagnosticCategory,
  type DiagnosticQuestion,
  type DiagnosticWorkspace,
  type DiagnosticRunView,
  type DiagnosticSample,
  type KnowledgeBasis,
  type DiagnosticResult,
} from "../contracts/diagnostics";
import {
  DiagnosticOverview,
  DiagnosticKnowledgeComparison,
  DiagnosticSemanticAudit,
  isDiagnosticPending,
} from "./BrandDiagnosticResults";
import { DiagnosticCharts } from "./DiagnosticCharts";
import "./brand-diagnostics.css";
const ROOT = "/api/modules/brand/diagnostics";

const phases = {
  draft: "选择诊断范围",
  collecting: "正在采集",
  analyzing: "正在诊断",
  completed: "诊断完成",
  partial: "部分未完成",
  stopped: "已停止",
};
const verdicts = {
  supported: "与知识一致",
  contradicted: "与当前知识库不一致",
  omitted: "回答遗漏",
  unverifiable: "无法核验",
};
const categoryHelp = {
  industry_ranking: "看用户不点名品牌时，AI 会推荐谁",
  competitor_comparison: "看 AI 如何比较双方，以及依据是否可靠",
  reputation: "看口碑、风险和信任信息如何被表达",
  product_scenario: "看产品与服务是否被准确理解",
};
function urlState() {
  const p = new URLSearchParams(window.location.search);
  const q = p.get("question");
  return {
    id: p.get("diagnosis"),
    category: DIAGNOSTIC_CATEGORIES.includes(q as DiagnosticCategory)
      ? (q as DiagnosticCategory)
      : null,
    answer: p.get("answer"),
    metric: p.get("metric"),
  };
}
function locationPatch(values: Record<string, string | null>) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(values))
    if (v) u.searchParams.set(k, v);
    else u.searchParams.delete(k);
  window.history.replaceState(window.history.state, "", u);
}
export default function BrandDiagnosticWorkspace({
  onOpenKnowledge,
  onOpenMonitoring,
  preview = false,
  storageKey = "brand-diagnostic-draft",
}: {
  onOpenKnowledge?: () => void;
  onOpenMonitoring?: () => void;
  preview?: boolean;
  storageKey?: string;
}) {
  const operation = useMemo(() => captureWorkspaceRestOperation(), []);
  const savedDraft = useMemo(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const requested = urlState().id;
      return requested && value?.runId !== requested ? null : value;
    } catch {
      return null;
    }
  }, [storageKey]);
  const draftRequestId = useRef(
    savedDraft?.clientRequestId ?? crypto.randomUUID(),
  );
  async function request<T>(path: string, body?: unknown): Promise<T> {
    operation.assertActive();
    const response = await operation.fetch(ROOT + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: operation.headers({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    operation.assertActive();
    if (!response.ok)
      throw new Error(value.error?.message ?? "诊断服务暂不可用");
    return value;
  }
  const initial = useRef(urlState());
  const [workspace, setWorkspace] = useState<DiagnosticWorkspace | null>(null);
  const [run, setRun] = useState<DiagnosticRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(
    initial.current.id ?? savedDraft?.runId ?? null,
  );
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>(
    savedDraft?.questions ?? [],
  );
  const [platforms, setPlatforms] = useState<string[]>(
    savedDraft?.platforms ?? ["doubao", "yuanbao", "qianwen"],
  );
  const [subjectScope, setSubjectScope] = useState(
    savedDraft?.subjectScope ?? "",
  );
  const [dirty, setDirty] = useState(!!savedDraft);
  const dirtyRef = useRef(!!savedDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [knowledgePath, setKnowledgePath] = useState<string | null>(null);
  const [basisId, setBasisId] = useState<string>(savedDraft?.basisId ?? "");
  const [documents, setDocuments] = useState<KnowledgeBasis["documents"]>([]);
  const [category, setCategory] = useState<DiagnosticCategory | null>(
    initial.current.category,
  );
  const [answerId, setAnswerId] = useState(initial.current.answer);
  const [metric, setMetric] = useState(initial.current.metric);
  const [answer, setAnswer] = useState<DiagnosticSample | null>(null);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    if (preview) return;
    if (dirty)
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          clientRequestId: draftRequestId.current,
          runId,
          questions,
          platforms,
          subjectScope,
          basisId,
        }),
      );
    else localStorage.removeItem(storageKey);
  }, [
    dirty,
    questions,
    platforms,
    subjectScope,
    basisId,
    runId,
    storageKey,
    preview,
  ]);
  const currentId = useRef(runId);
  currentId.current = runId;
  dirtyRef.current = dirty;
  const latestRun = useRef<DiagnosticRunView | null>(null);
  function adopt(value: DiagnosticRunView, force = false) {
    if (
      latestRun.current?.id === value.id &&
      latestRun.current.revision > value.revision
    )
      return;
    latestRun.current = value;
    setRun(value);
    if (value.confirmedAt) {
      setDirty(false);
      dirtyRef.current = false;
    }
    if (force || !dirtyRef.current) {
      setQuestions(value.questions);
      setPlatforms(value.platforms);
      setSubjectScope(value.subjectScope);
      setBasisId(value.basis.snapshotId);
    }
  }
  async function refresh() {
    const w = await request<DiagnosticWorkspace>("");
    setWorkspace(w);
    const id = currentId.current;
    if (id) {
      adopt(await request<DiagnosticRunView>(`/${id}`));
      if (urlState().id !== id) locationPatch({ diagnosis: id });
    } else if (w.initialRunId) {
      currentId.current = w.initialRunId;
      setRunId(w.initialRunId);
      adopt(await request<DiagnosticRunView>(`/${w.initialRunId}`));
      locationPatch({ diagnosis: w.initialRunId, new: null });
    }
    setLoadError("");
  }
  useEffect(() => {
    if (preview) return;
    let active = true;
    const poll = async () => {
      try {
        if (active) await refresh();
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [preview, runId]);
  useEffect(() => {
    setAnswer(null);
    setDetailError("");
    if (!runId || !answerId) return;
    let active = true;
    void request<DiagnosticSample>(
      `/${runId}/answers/${encodeURIComponent(answerId)}`,
    )
      .then((v) => {
        if (active) setAnswer(v);
      })
      .catch((e) => {
        if (active) setDetailError(e.message);
      });
    return () => {
      active = false;
    };
  }, [runId, answerId]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ensureDraft() {
    if (run) return run;
    const created = await request<DiagnosticRunView>("/drafts", {
      clientRequestId: draftRequestId.current,
      subjectScope,
      basisId: basisId || workspace?.knowledge.bases?.[0]?.snapshotId,
    });
    setRunId(created.id);
    currentId.current = created.id;
    locationPatch({ diagnosis: created.id, report: null, new: null });
    adopt(created);
    return created;
  }
  async function persist() {
    const current = await ensureDraft();
    if (!dirty && run) return current;
    const latest = await request<DiagnosticRunView>(`/${current.id}`);
    const value = await request<DiagnosticRunView>(`/${current.id}/draft`, {
      expectedRevision: latest.revision,
      questions: questions.map(({ category, text, source }) => ({
        category,
        text,
        source,
      })),
      platforms,
      basisId: basisId || current.basis.snapshotId,
    });
    setDirty(false);
    dirtyRef.current = false;
    adopt(value, true);
    return value;
  }
  function editQuestion(
    category: DiagnosticCategory,
    text: string,
    source: "recommended" | "custom",
  ) {
    setQuestions((q) =>
      [
        ...q.filter((x) => x.category !== category),
        { category, text, source },
      ].filter((q) => q.text.trim()),
    );
    setDirty(true);
  }
  function openAnswers(c: DiagnosticCategory, metricId: string | null = null) {
    setCategory(c);
    setMetric(metricId);
    setAnswerId(null);
    locationPatch({ question: c, metric: metricId, answer: null });
  }
  function closeAnswers() {
    setCategory(null);
    setAnswerId(null);
    setMetric(null);
    locationPatch({ question: null, answer: null, metric: null });
  }
  async function showKnowledge(path?: string) {
    const current = await ensureDraft();
    const content = documents.length
      ? documents
      : await request<KnowledgeBasis["documents"]>(`/${current.id}/knowledge`);
    if (!Array.isArray(content))
      throw new Error("知识依据格式不正确，请重新读取");
    setDocuments(content);
    setKnowledgePath(path ?? content[0]?.path ?? "missing");
  }
  async function downloadKnowledge() {
    const current = await persist();
    const response = await operation.fetch(
      `${ROOT}/${current.id}/knowledge-archive`,
      {
        credentials: "same-origin",
        headers: operation.headers({}),
      },
    );
    operation.assertActive();
    if (!response.ok) throw new Error("知识工作包读取失败，请重试");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.basis.companyName}-知识库-v${current.basis.version}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  useEffect(() => {
    setDocuments([]);
    if (!runId) return;
    let active = true;
    void request<KnowledgeBasis["documents"]>(`/${runId}/knowledge`)
      .then((value) => {
        if (active && Array.isArray(value)) setDocuments(value);
      })
      .catch(() => {
        /* Opening a document retries and reports the error. */
      });
    return () => {
      active = false;
    };
  }, [runId, run?.basis.contentHash]);
  const selectedBasis =
    workspace?.knowledge.bases?.find((basis) => basis.snapshotId === basisId) ??
    (run ? run.basis : workspace?.knowledge.bases?.[0]);
  const selectedDocument = documents.find(
    (document) => document.path === knowledgePath,
  );
  const frozen = !!run?.confirmedAt;
  const stopped = run?.phase === "stopped";
  const running = run && ["collecting", "analyzing"].includes(run.phase);
  const activity = run?.activity;
  const recommending = isDiagnosticPending(activity?.recommendation?.status);
  const validating = isDiagnosticPending(activity?.validation?.status);
  const activeBusiness =
    recommending ||
    validating ||
    DIAGNOSTIC_CATEGORIES.some(
      (c) =>
        isDiagnosticPending(activity?.assessments[c]?.status) ||
        isDiagnosticPending(activity?.audits[c]?.status),
    );
  const failedAssessment = DIAGNOSTIC_CATEGORIES.some(
    (c) => activity?.assessments[c]?.status === "failed" && !run?.results[c],
  );
  const canStart =
    questions.length === 4 &&
    !dirty &&
    questions.every((q) => q.validation?.accepted) &&
    platforms.length > 0 &&
    !frozen &&
    run?.phase !== "stopped";
  const selectedResult = category ? run?.results[category] : undefined;
  const selectedMetric = [
    ...(selectedResult?.metrics ?? []),
    ...(selectedResult?.breakdown.drilldowns ?? []),
    ...(selectedResult?.assessment.topics ?? []).map((topic, index) => ({
      id: `topic:${index}`,
      label: topic.topic,
      sampleIds: topic.answerRefs.map((ref) => ref.sampleId),
    })),
    ...(category ? (run?.audits?.[category]?.metrics ?? []) : []).map(
      (item) => ({
        id: `audit:${item.id}`,
        label: item.label,
        sampleIds: item.answerRefs.map((ref) => ref.sampleId),
      }),
    ),
  ].find((m) => m.id === metric);
  const answerRecords =
    run?.attempts.filter(
      (a) =>
        a.category === category &&
        (!selectedMetric || selectedMetric.sampleIds.includes(a.id)),
    ) ?? [];
  if (preview)
    return (
      <div className="bd-workspace">
        <h1>AI 语义诊断</h1>
        <p>连接企业工作区后，使用完整知识工作包开始四类诊断。</p>
      </div>
    );
  return (
    <section
      id="brand-diagnostic-workspace"
      className="bd-workspace"
      aria-label="AI 语义诊断"
    >
      <header className="bd-header">
        <div>
          <span className="bd-eyebrow">品牌建设</span>
          <h2>AI 语义诊断</h2>
          <p>基于本轮知识版本，查看四类真实回答中的品牌表现与认知差异。</p>
        </div>
        <span className="bd-status">
          {run
            ? run.phase === "completed" && activeBusiness
              ? "语义评估中"
              : run.phase === "completed" &&
                  !DIAGNOSTIC_CATEGORIES.every((c) => run.audits?.[c])
                ? "分类诊断完成"
                : phases[run.phase]
            : "知识库 → 四类诊断"}
        </span>
      </header>
      <nav className="bd-steps" aria-label="诊断流程">
        {[
          ["knowledge", "知识依据"],
          ["questions", "选择问题"],
          ["collection", "真实采集"],
          ["results", "语义诊断"],
        ].map(([id, label], i) => (
          <a key={id} href={`#diagnostic-${id}`}>
            <span>{i + 1}</span>
            {label}
            {i < 3 && <ChevronRight size={16} />}
          </a>
        ))}
      </nav>
      {(error || loadError) && (
        <div className="bd-error" role="alert">
          {error || loadError}
          <button type="button" onClick={() => void act(refresh)}>
            重新读取
          </button>
        </div>
      )}
      <section id="diagnostic-knowledge" className="bd-section">
        <div className="bd-section-heading">
          <span className="bd-number">01</span>
          <div>
            <h2>本轮知识依据</h2>
            <p>选择完整工作稿或正式发布版本，冻结本轮对照范围</p>
          </div>
          <Database size={23} />
        </div>
        {!workspace ? (
          <p role="status">正在读取企业知识状态…</p>
        ) : (
          <>
            <div className="bd-basis">
              <strong>
                {run?.subject ?? workspace.knowledge.companyName ?? "当前企业"}
              </strong>
              {selectedBasis && (
                <span className="bd-status">
                  {selectedBasis.kind === "working_set"
                    ? "构建工作稿"
                    : "正式发布版"}{" "}
                  · v{selectedBasis.version}
                </span>
              )}
              <span>
                {selectedBasis
                  ? `${selectedBasis.total ?? workspace.knowledge.total} 个节点 · 已确认 ${selectedBasis.confirmed ?? workspace.knowledge.confirmed} 个`
                  : workspace.knowledge.message}
              </span>
            </div>
            {!frozen && !!workspace.knowledge.bases?.length && (
              <label className="bd-basis-select">
                知识版本
                <select
                  value={basisId || selectedBasis?.snapshotId}
                  disabled={busy || activeBusiness}
                  onChange={(event) => {
                    setBasisId(event.target.value);
                    setDirty(true);
                    setDocuments([]);
                  }}
                >
                  {workspace.knowledge.bases.map((basis) => (
                    <option key={basis.snapshotId} value={basis.snapshotId}>
                      {basis.kind === "working_set"
                        ? "构建工作稿"
                        : "正式发布版"}{" "}
                      · v{basis.version} ·{" "}
                      {basis.total ?? workspace.knowledge.total} 个节点
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedBasis?.kind === "working_set" && (
              <p className="bd-note">
                已确认 {selectedBasis.confirmed ?? 0}/
                {selectedBasis.total ?? workspace.knowledge.total}{" "}
                个节点。初诊采用这一工作稿，人工审阅与事实核验状态会随依据保留。
              </p>
            )}
            <div className="bd-toolbar">
              {(workspace.knowledge.ready || run) && (
                <button
                  disabled={busy}
                  onClick={() => void act(downloadKnowledge)}
                >
                  下载本轮知识 ZIP
                </button>
              )}
              {onOpenKnowledge && (
                <button className="bd-link" onClick={onOpenKnowledge}>
                  前往智能知识库
                </button>
              )}
            </div>
          </>
        )}
      </section>
      <section
        id="diagnostic-questions"
        className={`bd-section ${!workspace?.knowledge.ready && !run ? "is-locked" : ""}`}
      >
        <div className="bd-section-heading">
          <span className="bd-number">02</span>
          <div>
            <h2>四类问题，各选一个</h2>
            <p>选择知识库推荐的问题，或输入你希望验证的真实问题。</p>
          </div>
        </div>
        {!workspace?.knowledge.ready && !run ? (
          <p>完整知识工作包生成并校验后，即可选择初诊问题。</p>
        ) : (
          <>
            <div className="bd-scope">
              <label>
                限定业务主体（可选）
                <input
                  value={subjectScope}
                  disabled={!!run || busy}
                  onChange={(e) => setSubjectScope(e.target.value)}
                  placeholder="例如：某个科室、产品线或业务"
                  maxLength={120}
                />
              </label>
              <p>
                {subjectScope
                  ? `仅诊断${subjectScope}，企业整体资料作为相关背景。`
                  : "留空时诊断当前企业整体。"}
              </p>
            </div>
            <div className="bd-toolbar">
              <button
                disabled={busy || frozen || stopped || recommending}
                onClick={() =>
                  void act(async () => {
                    const r = await persist();
                    adopt(await request(`/${r.id}/recommend`, {}));
                  })
                }
              >
                {recommending ? (
                  <Loader2 className="bd-spin" size={16} />
                ) : (
                  <Search size={16} />
                )}{" "}
                {recommending
                  ? "正在生成推荐问题…"
                  : run?.recommendations.length
                    ? "刷新推荐问题"
                    : "根据知识库推荐问题"}
              </button>
              <small>也可以直接输入四题，再校验问题。</small>
            </div>
            {activity?.recommendation?.status === "failed" && (
              <p className="bd-invalid" role="alert">
                {activity.recommendation.error ??
                  "问题推荐暂未完成，可以重试，或直接输入四题。"}
              </p>
            )}
            <div className="bd-question-grid">
              {DIAGNOSTIC_CATEGORIES.map((c) => {
                const q = questions.find((q) => q.category === c);
                return (
                  <article key={c} className="bd-question-card">
                    <div>
                      <h3>{DIAGNOSTIC_LABELS[c]}</h3>
                      <span>{q ? "已选 1 题" : "待选择"}</span>
                    </div>
                    <p>{categoryHelp[c]}</p>
                    <div className="bd-candidates">
                      {run?.recommendations
                        .filter((q) => q.category === c)
                        .map((candidate, i) => (
                          <div key={i} className="bd-candidate">
                            <button
                              aria-pressed={q?.text === candidate.text}
                              disabled={frozen || stopped || busy}
                              onClick={() =>
                                editQuestion(c, candidate.text, "recommended")
                              }
                            >
                              <span>
                                {q?.text === candidate.text ? (
                                  <Check size={16} />
                                ) : (
                                  <span className="bd-radio" />
                                )}
                              </span>
                              <span>
                                {candidate.text}
                                <small>{candidate.rationale}</small>
                              </span>
                            </button>
                            <div
                              className="bd-question-evidence"
                              aria-label="推荐知识依据"
                            >
                              {candidate.evidenceRefs
                                .slice(0, 3)
                                .map((path) => {
                                  const doc = documents.find(
                                    (document) => document.path === path,
                                  );
                                  return (
                                    <button
                                      key={path}
                                      className="bd-evidence-link"
                                      disabled={busy}
                                      onClick={() =>
                                        void act(() => showKnowledge(path))
                                      }
                                    >
                                      <strong>
                                        {doc?.title ?? "查看知识依据"}
                                      </strong>
                                      {doc && (
                                        <small>
                                          {doc.content
                                            .replace(/[#*`>]/g, "")
                                            .slice(0, 90)}
                                          …
                                        </small>
                                      )}
                                      <small>
                                        {doc?.evidenceStatus ===
                                        "needs_verification"
                                          ? "待核实"
                                          : "知识对照"}
                                      </small>
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        ))}
                    </div>
                    {activity?.recommendation?.status === "completed" &&
                      !run?.recommendations.some((candidate) => candidate.category === c) &&
                      <p className="bd-note">{c === "competitor_comparison" ? "当前知识缺少可核验的比较对象。可输入双方与一个比较维度后校验。" : "本类知识依据暂不足以形成推荐。可直接输入一个具体问题后校验。"}</p>}
                    <label>
                      <textarea
                        aria-label={`${DIAGNOSTIC_LABELS[c]}问题`}
                        value={q?.text ?? ""}
                        disabled={frozen || stopped || busy}
                        rows={3}
                        maxLength={120}
                        onChange={(e) =>
                          editQuestion(c, e.target.value, "custom")
                        }
                        placeholder="输入一条清楚、具体的问题"
                      />
                    </label>
                    {q?.validation && (
                      <p
                        className={
                          q.validation.accepted ? "bd-valid" : "bd-invalid"
                        }
                      >
                        {q.validation.accepted ? "✓ " : ""}
                        {q.validation.reason}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            {!frozen && !stopped && (
              <div className="bd-toolbar">
                <button
                  disabled={busy || questions.length !== 4 || validating}
                  onClick={() =>
                    void act(async () => {
                      const r = await persist();
                      if (!r.questions.every((q) => q.validation?.accepted))
                        adopt(await request(`/${r.id}/validate`, {}));
                    })
                  }
                >
                  {validating ? (
                    <Loader2 className="bd-spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  {validating ? "正在校验四题…" : "保存并校验四题"}
                </button>
                <span>
                  {dirty
                    ? "问题修改尚未校验"
                    : canStart
                      ? "四类问题已就绪"
                      : "四类各填写一题后校验"}
                </span>
              </div>
            )}
            {activity?.validation?.status === "failed" && (
              <p className="bd-invalid" role="alert">
                {activity.validation.error ?? "问题校验尚未完成，请重试。"}
              </p>
            )}
          </>
        )}
      </section>
      <section id="diagnostic-collection" className="bd-section">
        <div className="bd-section-heading">
          <span className="bd-number">03</span>
          <div>
            <h2>{frozen ? "采集完成情况" : "选择采集平台"}</h2>
            <p>每道问题在每个平台采集五次；确认后自动完成四类诊断。</p>
          </div>
        </div>
        <div className="bd-platforms">
          {workspace?.platforms.map((p) => (
            <button
              key={p.id}
              disabled={frozen || stopped || busy || !workspace.knowledge.ready}
              aria-pressed={platforms.includes(p.id)}
              onClick={() => {
                setPlatforms((ps) =>
                  ps.includes(p.id)
                    ? ps.filter((x) => x !== p.id)
                    : [...ps, p.id],
                );
                setDirty(true);
              }}
            >
              {platforms.includes(p.id) && <Check size={16} />} {p.label}
            </button>
          ))}
        </div>
        <div className="bd-count">
          <strong>
            {frozen
              ? `${run.completedSamples} / ${run.expectedSamples}`
              : platforms.length * 20}
          </strong>
          <span>
            {frozen
              ? "份真实回答已保存"
              : `份真实回答 · 4 题 × ${platforms.length} 平台 × 5 次`}
          </span>
        </div>
        {!frozen ? (
          <>
            <p className="bd-note">
              采集使用当前账户配置的服务额度。页面不估算供应商未提供的费用。
            </p>
            <button
              className="bd-primary"
              disabled={busy || !canStart}
              onClick={() =>
                void act(async () => {
                  const r = await persist();
                  const latest = await request<DiagnosticRunView>(`/${r.id}`);
                  adopt(
                    await request(`/${r.id}/start`, {
                      expectedRevision: latest.revision,
                    }),
                    true,
                  );
                })
              }
            >
              开始采集并诊断
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            <div className="bd-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>诊断问题</th>
                    {platforms.map((p) => (
                      <th key={p}>
                        {workspace?.platforms.find((x) => x.id === p)?.label ??
                          p}
                      </th>
                    ))}
                    <th>诊断状态</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAGNOSTIC_CATEGORIES.map((c) => (
                    <tr key={c}>
                      <th>{DIAGNOSTIC_LABELS[c]}</th>
                      {platforms.map((p) => {
                        const a = run.attempts.filter(
                          (a) => a.category === c && a.platform === p,
                        );
                        return (
                          <td key={p}>
                            <strong>
                              {a.filter((a) => a.status === "completed").length}
                              /5
                            </strong>
                            {a.some((a) =>
                              ["failed", "submission_unknown"].includes(
                                a.status,
                              ),
                            ) && (
                              <small className="bd-invalid">有未完成样本</small>
                            )}
                          </td>
                        );
                      })}
                      <td>
                        {run.results[c]
                          ? run.audits?.[c]
                            ? "诊断与语义评估已完成"
                            : isDiagnosticPending(activity?.audits[c]?.status)
                              ? "语义评估中"
                              : "分类诊断已完成"
                          : activity?.assessments[c]?.status === "running"
                            ? "正在分析"
                            : isDiagnosticPending(
                                  activity?.assessments[c]?.status,
                                )
                              ? "等待诊断执行"
                              : activity?.assessments[c]?.status === "failed"
                                ? "诊断未完成"
                                : "等待回答齐全"}
                        {activity?.assessments[c]?.status === "failed" &&
                          activity.assessments[c]?.error && (
                            <small className="bd-invalid">
                              {activity.assessments[c]?.error}
                            </small>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bd-toolbar">
              {!stopped && (running || activeBusiness) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      adopt(await request(`/${run.id}/stop`, {})),
                    )
                  }
                >
                  <Square size={14} />
                  停止本轮
                </button>
              )}
              {(run.phase === "partial" ||
                run.phase === "stopped" ||
                failedAssessment) &&
                run.phase !== "completed" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        adopt(await request(`/${run.id}/retry`, {})),
                      )
                    }
                  >
                    {stopped ? "继续本次初诊" : "恢复未完成诊断"}
                  </button>
                )}
            </div>
          </>
        )}
        {run && !frozen && activeBusiness && run.phase !== "stopped" && (
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => adopt(await request(`/${run.id}/stop`, {})))
            }
          >
            <Square size={14} />
            停止本轮
          </button>
        )}
      </section>
      <section id="diagnostic-results" className="bd-section">
        <div className="bd-section-heading">
          <span className="bd-number">04</span>
          <div>
            <h2>AI 语义诊断</h2>
            <p>基于本轮真实回答的分类指标、知识差异与证据。</p>
          </div>
        </div>
        {run && <DiagnosticOverview run={run} onAnswers={openAnswers} />}
        <nav className="bd-category-nav" aria-label="诊断结果导航">
          {DIAGNOSTIC_CATEGORIES.map((c) => (
            <a key={c} href={`#result-${c}`}>
              {DIAGNOSTIC_LABELS[c]}
            </a>
          ))}
        </nav>
        {DIAGNOSTIC_CATEGORIES.map((c) => {
          const storedResult = run?.results[c];
          const needsCoverageReview =
            c === "product_scenario" &&
            storedResult &&
            !Array.isArray((storedResult.assessment as any).knowledgeCoverage);
          const result = needsCoverageReview ? undefined : storedResult;
          return (
            <article
              id={`result-${c}`}
              key={c}
              className={`bd-result bd-result--${c}`}
            >
              <div className="bd-result-heading">
                <div>
                  <span className="bd-eyebrow">{DIAGNOSTIC_LABELS[c]}</span>
                  <h3>
                    {run?.questions.find((q) => q.category === c)?.text ??
                      "选择本类问题后展示诊断"}
                  </h3>
                </div>
                {run?.attempts.some((x) => x.category === c && x.hasAnswer) && (
                  <button onClick={() => openAnswers(c)}>
                    查看回答
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
              {needsCoverageReview && (
                <p className="bd-note">
                  产品覆盖指标需要按全部回答重新核对，原始采集已保留。
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        adopt(await request(`/${run!.id}/retry`, {})),
                      )
                    }
                  >
                    复用回答，重新核对覆盖指标
                  </button>
                </p>
              )}
              {!result ? (
                <p className="bd-empty">
                  {run?.phase === "stopped"
                    ? "本轮已停止，当前类别尚未生成诊断。"
                    : "本题回答齐全并通过诊断校验后，将在这里展示结果。"}
                </p>
              ) : (
                <>
                  <nav
                    className="bd-result-nav"
                    aria-label={`${DIAGNOSTIC_LABELS[c]}结果分区`}
                  >
                    <a href={`#diagnostic-metrics-${c}`}>分类指标</a>
                    <a href={`#diagnostic-audit-${c}`}>五维审计</a>
                    <a href={`#diagnostic-comparison-${c}`}>知识库对照</a>
                  </nav>
                  <p className="bd-finding">{result.assessment.summary}</p>
                  <small className="bd-measurement">
                    有效／计划回答 {result.samples} /{" "}
                    {run!.platforms.length * 5} 份 · {run?.platforms.length}{" "}
                    个平台 · 指标由回答判读明细计算，点击数字查看原始依据
                  </small>
                  <div className="bd-metrics" id={`diagnostic-metrics-${c}`}>
                    {result.metrics.map((m) => (
                      <button key={m.id} onClick={() => openAnswers(c, m.id)}>
                        <span>{m.label}</span>
                        <strong>
                          {m.value ?? "—"}
                          <small>{m.value === null ? "" : m.unit}</small>
                        </strong>
                        {m.denominator !== undefined && (
                          <small>
                            {m.numerator !== undefined
                              ? `${m.numerator} / ${m.denominator}${c === "product_scenario" ? " 项" : " 份回答"}`
                              : `统计基数 ${m.denominator}`}
                          </small>
                        )}
                        {m.unit === "%" && m.value !== null && (
                          <div className="bd-bar">
                            <i style={{ width: `${m.value}%` }} />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  <DiagnosticCharts
                    result={result}
                    onDrilldown={(id) => openAnswers(c, id)}
                  />
                  <CategoryMatrix
                    result={result}
                    onDrilldown={(id) => openAnswers(c, id)}
                    onOpen={(id) => {
                      openAnswers(c);
                      setAnswerId(id);
                      locationPatch({ answer: id });
                    }}
                  />
                  <div id={`diagnostic-audit-${c}`}>
                    <DiagnosticSemanticAudit
                      audit={run?.audits?.[c]}
                      status={activity?.audits[c]?.status}
                      error={activity?.audits[c]?.error}
                      allowRequest={
                        !run?.requiredAuditVersion ||
                        activity?.audits[c]?.status === "failed"
                      }
                      disabled={busy || stopped}
                      onRequest={() =>
                        void act(async () =>
                          adopt(
                            await request(`/${run!.id}/semantic-audits`, {
                              categories: [c],
                            }),
                          ),
                        )
                      }
                      onKnowledge={(path) =>
                        void act(() => showKnowledge(path))
                      }
                      onAnswers={(id) => openAnswers(c, id)}
                      onAnswer={(id) => {
                        openAnswers(c);
                        setAnswerId(id);
                        locationPatch({ answer: id });
                      }}
                    />
                  </div>
                  <DiagnosticKnowledgeComparison
                    key={`${run!.id}:${c}`}
                    run={run!}
                    categoryScope={c}
                    onKnowledge={(path) => void act(() => showKnowledge(path))}
                    onAnswers={openAnswers}
                    onAnswer={(category, id) => {
                      openAnswers(category);
                      setAnswerId(id);
                      locationPatch({ answer: id });
                    }}
                  />
                  <details className="bd-method">
                    <summary>指标说明与适用边界</summary>
                    <p>
                      {c === "industry_ranking"
                        ? "提及、推荐和 TopN 以有效回答数为分母。有效平均位次只使用有明确推荐顺序的样本。母企业单独提及不会自动算作业务主体推荐。"
                        : c === "competitor_comparison"
                          ? "偏好来自回答原文，不代表客观竞争胜负；未表态单独统计。比较维度只计算原文有实际内容的回答。"
                          : c === "reputation"
                            ? "分布由模型对回答进行判读，无法判断单列。风险主题为 AI 提及内容，不能据此认定事件属实。"
                            : "要点覆盖以本题相关知识要点为基数；主张一致比例仅统计有知识依据可对照的主张。无法核验与遗漏单列。"}
                    </p>
                    <p>
                      结果只描述本题、本轮样本。与知识库相符不代表完成独立事实核查；四类不合成为企业总分。
                    </p>
                    <p>
                      分类判读实际模型：{result.model}
                      {result.fallback ? "（使用故障备用模型）" : "（主模型）"}
                      。
                    </p>
                    {run?.audits?.[c] && (
                      <p>
                        五维评估实际模型：{run.audits[c]!.model}
                        {run.audits[c]!.fallback
                          ? "（使用故障备用模型）"
                          : "（主模型）"}
                        。
                      </p>
                    )}
                  </details>
                </>
              )}
            </article>
          );
        })}
      </section>
      {stopped && !frozen && (
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => adopt(await request(`/${run!.id}/retry`, {})))
          }
        >
          继续本次初诊
        </button>
      )}
      {run?.phase === "completed" && (
        <footer className="bd-footer">
          <p>本企业初诊已完成。后续问题与复测可在进度监控中继续维护。</p>
          {onOpenMonitoring && (
            <button onClick={onOpenMonitoring}>
              进入进度监控
              <ArrowRight size={16} />
            </button>
          )}
        </footer>
      )}
      <Dialog.Root
        open={knowledgePath !== null}
        onOpenChange={(open) => {
          if (!open) setKnowledgePath(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="bd-overlay" />
          <Dialog.Content className="bd-drawer bd-knowledge-drawer fm-brand-portal-theme">
            <header>
              <div>
                <Dialog.Title>
                  {selectedDocument?.title ?? "知识依据"}
                </Dialog.Title>
                <Dialog.Description>
                  本轮冻结知识 ·{" "}
                  {run?.basis.kind === "working_set"
                    ? "构建工作稿"
                    : "正式发布版"}{" "}
                  v{run?.basis.version}
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="关闭知识详情">
                <X size={22} />
              </Dialog.Close>
            </header>
            <div className="bd-answer-content">
              {selectedDocument ? (
                <>
                  <p className="bd-note">
                    {selectedDocument.reviewStatus === "confirmed"
                      ? "已人工确认"
                      : "保留原审阅状态"}{" "}
                    ·{" "}
                    {selectedDocument.evidenceStatus === "needs_verification"
                      ? "待核实内容"
                      : "事实核验以所附来源为依据"}
                  </p>
                  <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>
                    {selectedDocument.content}
                  </ReactMarkdown>
                </>
              ) : (
                <p role="alert">
                  未找到本轮冻结版本中的该文档。
                  <button
                    onClick={() =>
                      void act(() => showKnowledge(knowledgePath!))
                    }
                  >
                    重新读取
                  </button>
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={category !== null}
        onOpenChange={(open) => {
          if (!open) closeAnswers();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="bd-overlay" />
          <Dialog.Content className="bd-drawer fm-brand-portal-theme">
            <header>
              <div>
                <Dialog.Title>
                  {category ? DIAGNOSTIC_LABELS[category] : ""} · 回答与证据
                </Dialog.Title>
                <Dialog.Description>
                  {selectedMetric
                    ? `${selectedMetric.label}对应的回答记录`
                    : run?.questions.find((q) => q.category === category)?.text}
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="关闭回答详情">
                <X size={22} />
              </Dialog.Close>
            </header>
            <div className="bd-drawer-body">
              <div className="bd-answer-list">
                {answerRecords.map((a) => (
                  <button
                    key={a.id}
                    disabled={!a.hasAnswer}
                    aria-pressed={answerId === a.id}
                    onClick={() => {
                      setAnswerId(a.id);
                      locationPatch({ answer: a.id });
                    }}
                  >
                    <strong>
                      {workspace?.platforms.find((p) => p.id === a.platform)
                        ?.label ?? a.platform}{" "}
                      · 第 {a.run} 次
                    </strong>
                    <span>
                      {a.hasAnswer ? "查看原始回答" : (a.error ?? "回答未就绪")}
                    </span>
                  </button>
                ))}
                {!answerRecords.length && (
                  <p>当前指标没有对应回答。遗漏要点请查看知识对照。</p>
                )}
              </div>
              <div className="bd-answer-content">
                {detailError ? (
                  <p role="alert">{detailError}</p>
                ) : answer ? (
                  <>
                    <h3>
                      {workspace?.platforms.find(
                        (p) => p.id === answer.platform,
                      )?.label ?? answer.platform}{" "}
                      · 第 {answer.run} 次回答
                    </h3>
                    <small>
                      {answer.collectedAt &&
                        new Date(answer.collectedAt).toLocaleString(
                          "zh-CN",
                        )}{" "}
                      · 原始采集
                    </small>
                    {selectedResult && (
                      <AnswerEvidence
                        result={selectedResult}
                        sampleId={answer.id}
                        onKnowledge={(path) => {
                          closeAnswers();
                          void act(() => showKnowledge(path));
                        }}
                      />
                    )}
                    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>
                      {answer.answer}
                    </ReactMarkdown>
                    <Sources
                      title="回答实际引用"
                      sources={answer.citations}
                      observation={answer.sourceObservability?.citations}
                    />
                    <Sources
                      title="检索参考（不等于实际引用）"
                      sources={answer.references ?? []}
                      observation={answer.sourceObservability?.references}
                    />
                  </>
                ) : (
                  <p>
                    {answerId
                      ? "正在读取完整回答…"
                      : "选择一条记录，查看完整回答与原始信源。"}
                  </p>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
function Sources({
  title,
  sources,
  observation,
}: {
  title: string;
  sources: DiagnosticSample["citations"];
  observation?: "returned" | "not_returned" | "unknown";
}) {
  return (
    <section className="bd-sources">
      <h4>
        {title}
        {sources.length || observation === "returned"
          ? ` · ${sources.length}`
          : ""}
      </h4>
      {sources.length ? (
        <ol>
          {sources.map((s, i) => (
            <li key={`${s.url}-${i}`}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title || s.url}
              </a>
              <small>{s.site || new URL(s.url).hostname}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          {observation === "returned"
            ? "采集服务返回了来源字段，本次没有此类来源。"
            : "当前没有可核验的此类来源记录，不能据此认定回答没有引用或缺乏权威依据。"}
        </p>
      )}
    </section>
  );
}
function CategoryMatrix({
  result,
  onOpen,
  onDrilldown,
}: {
  result: DiagnosticResult;
  onOpen: (sampleId: string) => void;
  onDrilldown: (id: string) => void;
}) {
  const a = result.assessment;
  const b = result.breakdown;
  return (
    <>
      {a.category === "industry_ranking" && (
        <div className="bd-ranks">
          <h4>本主体与其他机构的可确认位次</h4>
          <p>
            位次越小越靠前；只计算原文可确认的推荐排名。列名、提及和推荐分别判读。
          </p>
          {b.ranks.map((r) => (
            <button
              key={r.id}
              className="bd-rank-row"
              onClick={() => onDrilldown(r.id)}
            >
              <strong>{r.name}</strong>
              <span className="bd-rank-track">
                <i style={{ width: `${r.barPercent}%` }} />
              </span>
              <span>
                {r.averageRank === null
                  ? "位次不可用"
                  : `平均第 ${r.averageRank} 位`}
                <small>
                  位次样本 {r.rankedSamples} · 提及 {r.mentions} 份
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="bd-table-wrap">
        <table>
          <caption>平台差异 · 点击数字查看对应回答</caption>
          <thead>
            <tr>
              <th>平台</th>
              <th>有效回答</th>
              {b.platforms[0]?.metrics.map((m) => (
                <th key={m.id}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.platforms.map((p) => (
              <tr key={p.id}>
                <th>{p.label}</th>
                <td>{p.samples}</td>
                {p.metrics.map((m) => (
                  <td key={m.id}>
                    <button
                      className="bd-link"
                      onClick={() => onDrilldown(m.id)}
                    >
                      {m.value ?? "—"}
                      {m.value === null ? "" : m.unit}
                    </button>
                    {m.denominator !== undefined && (
                      <small>基数 {m.denominator}</small>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.category === "competitor_comparison" && (
        <details className="bd-topics" open>
          <summary>双方主张与比较维度</summary>
          <div className="bd-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>维度</th>
                  <th>本主体主张</th>
                  <th>比较对象主张</th>
                  <th>证据</th>
                </tr>
              </thead>
              <tbody>
                {a.answers.flatMap((x) =>
                  x.dimensions.map((d, i) => (
                    <tr key={`${x.sampleId}-${i}`}>
                      <th>{d.name}</th>
                      <td>{d.subjectClaim || "未提供"}</td>
                      <td>{d.competitorClaim || "未提供"}</td>
                      <td>
                        <button
                          className="bd-link"
                          onClick={() => onOpen(x.sampleId)}
                        >
                          原始回答
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {a.category === "reputation" && (
        <div className="bd-table-wrap">
          <table>
            <caption>AI 回答提及的风险主题 · 事件真实性需另行核验</caption>
            <thead>
              <tr>
                <th>主题</th>
                <th>提及回答数</th>
                <th>原文依据</th>
              </tr>
            </thead>
            <tbody>
              {b.risks.map((r) => (
                <tr key={r.id}>
                  <th>{r.theme}</th>
                  <td>
                    {r.count}/{r.denominator}
                  </td>
                  <td>
                    <button
                      className="bd-link"
                      onClick={() => onDrilldown(r.id)}
                    >
                      查看回答
                    </button>
                  </td>
                </tr>
              ))}
              {!b.risks.length && (
                <tr>
                  <td colSpan={3}>
                    本轮未识别有原文支持的风险主题；不代表不存在风险。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {a.category === "product_scenario" && (
        <div className="bd-table-wrap">
          <table>
            <caption>
              产品与服务要点覆盖 · 数字为有对应证据的回答数／平台有效回答数
            </caption>
            <thead>
              <tr>
                <th>知识要点</th>
                <th>覆盖状态</th>
                {b.platforms.map((p) => (
                  <th key={p.id}>{p.label}</th>
                ))}
                <th>依据</th>
              </tr>
            </thead>
            <tbody>
              {b.coverage.map((t) => (
                <tr key={t.id}>
                  <th>{t.topic}</th>
                  <td>
                    {t.verdict === "covered" ? "有相关表述" : "全部未提及"}
                  </td>
                  {t.platforms.map((p) => (
                    <td key={p.platform}>
                      {p.count}/{p.denominator}
                    </td>
                  ))}
                  <td>
                    <button
                      className="bd-link"
                      onClick={() => onDrilldown(t.id)}
                    >
                      {t.sampleIds.length ? "查看回答" : "未找到回答依据"}
                    </button>
                    {!!t.missingSampleIds.length && (
                      <button
                        className="bd-link"
                        onClick={() => onDrilldown(t.missingId)}
                      >
                        未覆盖 {t.missingSampleIds.length} 份
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!b.coverage.length && (
                <tr>
                  <td colSpan={3 + b.platforms.length}>
                    当前知识没有可量化的相关要点；请查看知识对照中的限制说明。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <details className="bd-topics">
        <summary>信源洞察 · 实际引用与检索参考</summary>
        <p>
          按使用该来源的回答数统计，同一回答重复链接只计一次。引用频率不代表权威程度。
        </p>
        {b.sources.length ? (
          <div className="bd-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th>类型</th>
                  <th>回答数</th>
                </tr>
              </thead>
              <tbody>
                {b.sources.map((s) => (
                  <tr key={s.id}>
                    <th>
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    </th>
                    <td>{s.kind === "citation" ? "实际引用" : "检索参考"}</td>
                    <td>
                      <button
                        className="bd-link"
                        onClick={() => onDrilldown(s.id)}
                      >
                        {s.count} 份 · 查看回答
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>采集服务未返回可统计的信源。</p>
        )}
      </details>
    </>
  );
}

function AnswerEvidence({
  result,
  sampleId,
  onKnowledge,
}: {
  result: DiagnosticResult;
  sampleId: string;
  onKnowledge: (path: string) => void;
}) {
  const a = result.assessment;
  const records: Array<{
    label: string;
    excerpt: string;
    kb?: string | null;
    path?: string | null;
  }> = [];
  if (a.category === "industry_ranking") {
    const row = a.answers.find((x) => x.sampleId === sampleId);
    if (row) {
      records.push({
        label: row.mentioned ? "品牌提及依据" : "未识别品牌提及",
        excerpt: row.mentionEvidence,
      });
      records.push({
        label: row.recommended
          ? `本主体推荐依据${row.rank === null ? "（位次不可确认）" : ` · 第 ${row.rank} 位`}`
          : "未计为本主体推荐",
        excerpt: row.recommendationEvidence,
      });
    }
  } else if (a.category === "competitor_comparison") {
    const row = a.answers.find((x) => x.sampleId === sampleId);
    if (row) {
      records.push({
        label: {
          subject: "明确倾向本主体",
          competitor: "明确倾向比较对象",
          balanced: "双方各有适用",
          unspecified: "未明确偏好",
        }[row.preference],
        excerpt: row.preferenceEvidence,
      });
      records.push(
        ...row.dimensions.map((d) => ({ label: d.name, excerpt: d.excerpt })),
      );
    }
  } else if (a.category === "reputation") {
    const row = a.answers.find((x) => x.sampleId === sampleId);
    if (row) {
      records.push({
        label: {
          positive: "正面",
          neutral: "中性",
          negative: "负面",
          mixed: "混合",
          unknown: "无法判断",
        }[row.sentiment],
        excerpt: row.sentimentEvidence,
      });
      records.push(
        ...row.risks.map((r) => ({ label: r.theme, excerpt: r.excerpt })),
      );
    }
  } else {
    const row = a.answers.find((x) => x.sampleId === sampleId);
    if (row)
      records.push(
        ...row.claims.map((c) => ({
          label: `${c.claim} · ${verdicts[c.verdict]}`,
          excerpt: c.excerpt,
          kb: c.kbExcerpt,
          path: c.docPath,
        })),
      );
    for (const point of a.knowledgeCoverage ?? []) {
      const row = point.answers.find((x) => x.sampleId === sampleId);
      if (row)
        records.push({
          label: `${point.point} · ${row.covered ? "有相关表述" : "本条未覆盖"}`,
          excerpt: row.excerpt,
          kb: point.kbExcerpt,
          path: point.docPath,
        });
    }
  }
  const topics = result.assessment.topics.filter((t) =>
    t.answerRefs.some((r) => r.sampleId === sampleId),
  );
  return (
    <details className="bd-topic">
      <summary>
        本条回答的判读依据 · {records.length + topics.length} 项
      </summary>
      {records.map((r, i) => (
        <div key={`record-${i}`}>
          <strong>{r.label}</strong>
          {r.excerpt && <blockquote>{r.excerpt}</blockquote>}
          {r.kb && <p>知识库：{r.kb}</p>}
          {r.path && (
            <button className="bd-link" onClick={() => onKnowledge(r.path!)}>
              回看知识依据
            </button>
          )}
        </div>
      ))}
      {topics.map((t, i) => (
        <div key={i}>
          <strong>
            {t.topic} · {verdicts[t.verdict]}
          </strong>
          <p>{t.explanation}</p>
          {t.answerRefs
            .filter((r) => r.sampleId === sampleId)
            .map((r, j) => (
              <blockquote key={j}>{r.excerpt}</blockquote>
            ))}
          {t.kbExcerpt && (
            <p>
              知识库：{t.kbExcerpt}（{t.docPath}）
            </p>
          )}
          {t.docPath && (
            <button className="bd-link" onClick={() => onKnowledge(t.docPath!)}>
              回看知识依据
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
