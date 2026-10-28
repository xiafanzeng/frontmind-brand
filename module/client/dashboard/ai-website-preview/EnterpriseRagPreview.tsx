import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpenCheck, Bot, ClipboardCheck, FileText, Lightbulb, Search, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { loadWebsiteDraft } from "./SimplifiedWebsiteBuilderPreview";
import { previewKnowledgeCollectionCount, previewKnowledgeFragmentCount } from "./preview-copy";
import { usePreviewDialog } from "./qa-widget/usePreviewDialog";
import { RAG_ACCEPTANCE_PARAMS, RAG_ATTRIBUTIONS, RAG_CASE_MODE_LABELS, RAG_CASE_STATUS_LABELS, RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, resolveConversationOutcome, scoreEvaluation, type DimensionId, type DimensionJudgment, type GateJudgment, type Rating } from "./rag-evaluation";
import { RAG_SAMPLE_CASES, findRagSample, type RagCase, type RagIssue } from "./rag-evaluation-cases";
import { enterpriseRagEvaluationSkill } from "./enterprise-rag-evaluation-skill";
import { saveEvaluationReport } from "./evaluation-report-store";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";
import {
  liveEnterpriseRagEvaluationApi,
} from "../enterprise-rag-evaluation-api";
import type {
  EnterpriseRagEvaluationReport,
  EnterpriseRagEvaluationRunDto,
} from "../../../contracts/enterprise-rag-evaluation-run";
import "./simplified-product-preview.css";
import "./rag-evaluation-ui.css";
import { scoreEvaluation as scoreLegacyEvaluation } from "./rag-evaluation-legacy";
import { ragVerdictLabels, legacyRagVerdictLabels, reportVerdict } from "./rag-report-presentation";
import { isGradedRagJudgment } from "../../../contracts/enterprise-rag-evaluation-run";

export type EnterpriseRagLiveRuntime = {
  loaded: boolean;
  failed: boolean;
  refreshFailed?: boolean;
  failureCode?: string;
  configured: boolean | null;
  providerLabel: string;
  knowledgeBase: {
    snapshotId: string;
    version: number;
    sourceFileName: string;
    documentCount: number;
  } | null;
  currentKnowledgeBase: {
    snapshotId: string;
    version: number;
    sourceFileName: string;
    documentCount: number;
  } | null;
  knowledgeBinding: "current_publication" | "frozen_task" | "historical_unknown";
  taskId?: string;
  /** Server-owned ordinary-chat turn coordinate for the displayed final answer. */
  turnId?: string;
  conversationReady: boolean;
  question: string;
  questionId?: string;
  answer: string;
  answerId?: string;
  sources: Array<{
    id: string;
    title: string;
    kind: "published_knowledge" | "user_attachment";
  }>;
  busy: boolean;
  running: boolean;
  pendingDispatchQuestion?: string;
  notice?: string;
  onAsk: (question: string) => Promise<boolean>;
  onRetryPending: () => Promise<boolean>;
  onStop: () => Promise<boolean>;
  onRetryKnowledge: () => void;
  onStartNewConversation: () => void;
  onOpenKnowledge: () => void;
};
type Props = {
  onOpenWebsite: () => void;
  onOpenWebsiteAssistant: () => void;
  websiteEntryLabel?: string;
  storageScopeKey?: string;
  live?: EnterpriseRagLiveRuntime;
};
type Drawer = "review" | "evidence" | "rules" | "improve" | "answer" | "history" | null;
type RecordEntry = { id: string; question: string; answer: string; need: string; reviewer: string; time: string; ruleVersion: string; knowledgeVersion: string; dimensions: DimensionJudgment[]; gates: GateJudgment[] };
const HISTORY_KEY = "frontmind-rag-reviews-v1";
const AUTOMATIC_REQUEST_KEY = "frontmind-rag-evaluation-request-v1";
const AUTOMATIC_SUBMITTED_NOTICE = "自动评估已提交；离开页面后任务仍会继续，重新打开可恢复进度。";
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
const verdicts = ragVerdictLabels;
const emptyDimensions = (): DimensionJudgment[] => RAG_DIMENSIONS.map(({ id }) => ({ id, level: null, rationale: "", evidenceIds: [], applicable: true }));
const emptyGates = (): GateJudgment[] => RAG_GATES.map(({ id }) => ({ id, status: "pending", reason: "" }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const format = (value: number) => Number(value.toFixed(2)).toString();

function presentEvaluationScore(
  score: number | null | undefined,
  unavailable: boolean,
) {
  if (unavailable) {
    return {
      value: "!",
      text: "!",
      showScale: false,
      ariaLabel: "重大问题，数值分不适用",
    };
  }
  const value = score ?? "—";
  return {
    value,
    text: `${value}/100`,
    showScale: true,
    ariaLabel:
      typeof score === "number"
        ? `六维诊断评分 ${score}，满分 100`
        : "六维诊断评分待核验",
  };
}

const terminalEvaluationStatuses = new Set(["completed", "failed"]);
const automaticStatusLabels: Record<EnterpriseRagEvaluationRunDto["status"], string> = {
  queued: "已排队",
  uploading: "正在准备评估材料",
  create_unknown: "正在确认评估任务",
  running: "自动评估中",
  result_pending: "正在校验评估结果",
  completed: "自动评估已完成",
  failed: "自动评估失败",
};

function mergeAutomaticRuns(
  runs: EnterpriseRagEvaluationRunDto[],
): EnterpriseRagEvaluationRunDto[] {
  const unique = new Map<string, EnterpriseRagEvaluationRunDto>();
  for (const run of runs) {
    if (!unique.has(run.operationId)) unique.set(run.operationId, run);
  }
  return [...unique.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20);
}

function automaticRequestStorageKey(sourceQaTaskId: string, turnId: string) {
  return `${AUTOMATIC_REQUEST_KEY}.${encodeURIComponent(sourceQaTaskId)}.${encodeURIComponent(turnId)}`;
}

function reportDimensions(
  report: EnterpriseRagEvaluationReport,
): DimensionJudgment[] {
  return report.judgments.dimensions.map((item) => ({
    id: item.id,
    level: item.level as Rating | null,
    rationale: item.rationale,
    evidenceIds: [...item.evidenceIds],
    applicable: true,
  }));
}

function reportGates(report: EnterpriseRagEvaluationReport): GateJudgment[] {
  return report.judgments.gates.map((item) => ({
    id: item.id,
    status: item.status,
    reason: item.reason,
  }));
}

export function enterpriseRagHistoryStorageKey(scopeKey?: string) {
  return scopeKey?.trim()
    ? `${HISTORY_KEY}.${encodeURIComponent(scopeKey.trim())}`
    : HISTORY_KEY;
}

function loadHistory(storageKey: string): RecordEntry[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is RecordEntry => item && typeof item.id === "string" && typeof item.question === "string" && typeof item.answer === "string" && typeof item.need === "string" && typeof item.reviewer === "string" && typeof item.time === "string" && typeof item.ruleVersion === "string" && /^rag-eval-\d+\.\d+$/u.test(item.ruleVersion) && typeof item.knowledgeVersion === "string" && Array.isArray(item.dimensions) && item.dimensions.every((d: DimensionJudgment) => d && typeof d.id === "string" && typeof d.rationale === "string" && Array.isArray(d.evidenceIds)) && Array.isArray(item.gates) && item.gates.every((g: GateJudgment) => g && typeof g.reason === "string" && typeof g.id === "string")).slice(0, 30);
  } catch { return []; }
}

function manualIssues(dimensions: DimensionJudgment[], gates: GateJudgment[]): RagIssue[] {
  const risks: RagIssue[] = gates.filter((item) => item.status === "failed").map((item) => ({ id: `gate-${item.id}`, priority: "P0", title: `${RAG_GATES.find((gate) => gate.id === item.id)?.label}存在关键风险`, impact: item.reason, action: "先移除或修正风险内容，核对授权与依据，再重新评审。" }));
  const gaps: RagIssue[] = dimensions.filter((item) => item.level !== null && item.level < 4).sort((a, b) => (a.level ?? 4) - (b.level ?? 4)).map((item) => ({ id: item.id, priority: item.level! <= 2 ? "P1" : "P2", title: `${RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}可改进`, impact: item.rationale, action: dimensionActions[item.id], dimensionId: item.id }));
  return [...risks, ...gaps].slice(0, 3);
}

export function EnterpriseRagPreview({ onOpenWebsite, onOpenWebsiteAssistant, websiteEntryLabel = "开始网站建设", storageScopeKey, live }: Props) {
  const first = RAG_SAMPLE_CASES[0];
  const historyStorageKey = enterpriseRagHistoryStorageKey(storageScopeKey);
  const [websiteDraft] = useState(() =>
    live ? null : loadWebsiteDraft(storageScopeKey),
  );
  const [activeCase, setActiveCase] = useState<RagCase | null>(live ? null : first);
  const [question, setQuestion] = useState(live?.question ?? first.question);
  const [answer, setAnswer] = useState(live?.answer ?? first.answer);
  const [need, setNeed] = useState(live?.question ? `准确回答访客问题：${live.question}` : live ? "" : first.need);
  const [input, setInput] = useState("");
  const [dimensions, setDimensions] = useState(live ? emptyDimensions() : clone(first.dimensions));
  const [gates, setGates] = useState(live ? emptyGates() : clone(first.gates));
  const [mode, setMode] = useState<"sample" | "manual">(live ? "manual" : "sample");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [reviewDimensions, setReviewDimensions] = useState<DimensionJudgment[]>([]);
  const [reviewGates, setReviewGates] = useState<GateJudgment[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [answerEdit, setAnswerEdit] = useState("");
  const [needEdit, setNeedEdit] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState(() => loadHistory(historyStorageKey));
  const [automaticRun, setAutomaticRun] =
    useState<EnterpriseRagEvaluationRunDto | null>(null);
  const [automaticHistory, setAutomaticHistory] = useState<
    EnterpriseRagEvaluationRunDto[]
  >([]);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [automaticStarting, setAutomaticStarting] = useState(false);
  const [automaticError, setAutomaticError] = useState("");
  const backgroundRef = useRef<HTMLDivElement>(null);
  const syncedLiveAnswer = useRef("");
  const fallbackAutomaticRequestIds = useRef(new Map<string, string>());
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
  useEffect(() => {
    setHistory(loadHistory(historyStorageKey));
  }, [historyStorageKey]);
  const liveAnswerKey = live
    ? `${live.questionId ?? live.question}\u0000${live.answerId ?? live.answer}`
    : "";
  useEffect(() => {
    if (!live || syncedLiveAnswer.current === liveAnswerKey) return;
    syncedLiveAnswer.current = liveAnswerKey;
    setActiveCase(null);
    setQuestion(live.question);
    setAnswer(live.answer);
    setNeed(live.question ? `准确回答访客问题：${live.question}` : "");
    setDimensions(emptyDimensions());
    setGates(emptyGates());
    setMode("manual");
    setNotice(
      live.answer
        ? "已载入真实企业问答结果；可读取已有自动评估，或明确点击按钮发起一次新的模型评估。"
        : "",
    );
  }, [liveAnswerKey, live]);
  const automaticCoordinate =
    live?.taskId && live.turnId && live.answer
      ? { sourceQaTaskId: live.taskId, turnId: live.turnId }
      : null;
  const automaticCoordinateKey = automaticCoordinate
    ? `${automaticCoordinate.sourceQaTaskId}\u0000${automaticCoordinate.turnId}\u0000${live?.answerId ?? ""}`
    : "";
  useEffect(() => {
    let active = true;
    setAutomaticRun(null);
    setAutomaticHistory([]);
    setAutomaticError("");
    setAutomaticLoading(Boolean(automaticCoordinate));
    if (!automaticCoordinate) return () => { active = false; };
    void liveEnterpriseRagEvaluationApi
      .latest(automaticCoordinate)
      .then(({ latest, history: serverHistory }) => {
        if (!active) return;
        setAutomaticRun(latest);
        setAutomaticHistory(mergeAutomaticRuns(serverHistory));
        setAutomaticError(
          latest?.status === "failed"
            ? latest.error?.message ?? "自动评估失败，请重新发起评估。"
            : "",
        );
        const requestKey = automaticRequestStorageKey(
          automaticCoordinate.sourceQaTaskId,
          automaticCoordinate.turnId,
        );
        if (latest && !terminalEvaluationStatuses.has(latest.status)) {
          fallbackAutomaticRequestIds.current.set(requestKey, latest.operationId);
        } else if (latest) {
          fallbackAutomaticRequestIds.current.delete(requestKey);
        }
        try {
          if (latest && !terminalEvaluationStatuses.has(latest.status)) {
            sessionStorage.setItem(requestKey, latest.operationId);
          } else if (latest && terminalEvaluationStatuses.has(latest.status)) {
            sessionStorage.removeItem(requestKey);
          }
        } catch { /* The in-memory map above remains authoritative for this tab. */ }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAutomaticError(
          error instanceof Error ? error.message : "自动评估记录读取失败，请稍后重试。",
        );
      })
      .finally(() => {
        if (active) setAutomaticLoading(false);
      });
    return () => { active = false; };
  }, [automaticCoordinateKey]);
  useEffect(() => {
    if (
      !automaticRun ||
      terminalEvaluationStatuses.has(automaticRun.status) ||
      !automaticCoordinate
    ) return;
    let active = true;
    let timeout: number | undefined;
    const poll = () => {
      timeout = window.setTimeout(() => {
        void liveEnterpriseRagEvaluationApi
          .observe(automaticRun.operationId)
          .then((next) => {
            if (!active) return;
            if (
              next.sourceQaTaskId !== automaticCoordinate.sourceQaTaskId ||
              next.turnId !== automaticCoordinate.turnId
            ) {
              throw new Error("自动评估结果与当前回答不匹配，已停止展示。");
            }
            setAutomaticRun(next);
            if (next.report) {
              setAutomaticHistory((old) => mergeAutomaticRuns([next, ...old]));
            }
            if (terminalEvaluationStatuses.has(next.status)) {
              const requestKey = automaticRequestStorageKey(
                automaticCoordinate.sourceQaTaskId,
                automaticCoordinate.turnId,
              );
              fallbackAutomaticRequestIds.current.delete(requestKey);
              try { sessionStorage.removeItem(requestKey); }
              catch { /* Already cleared from the in-memory fallback. */ }
            }
            setAutomaticError(
              next.status === "failed"
                ? next.error?.message ?? "自动评估失败，请重新发起评估。"
                : "",
            );
            if (next.status === "failed") setNotice("");
            if (!terminalEvaluationStatuses.has(next.status)) poll();
          })
          .catch((error: unknown) => {
            if (!active) return;
            setAutomaticError(
              error instanceof Error ? error.message : "自动评估状态读取失败，请稍后重试。",
            );
            poll();
          });
      }, 2_500);
    };
    poll();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [automaticRun?.operationId, automaticRun?.status, automaticCoordinateKey]);
  const automaticReportRun = automaticRun?.status === "completed" && automaticRun.report
    ? automaticRun
    : automaticHistory.find(
        (run) => run.status === "completed" && Boolean(run.report),
      ) ?? null;
  const automaticReport = automaticReportRun?.report ?? null;
  const mirroredServerReportIds = useRef(new Set<string>());
  useEffect(() => {
    if (!live || !automaticReport) return;
    if (mirroredServerReportIds.current.has(automaticReport.reportId)) return;
    mirroredServerReportIds.current.add(automaticReport.reportId);
    // Completed server reports are mirrored once into the shared scoped audit so
    // the website flow can explicitly link them; saveEvaluationReport is idempotent.
    saveEvaluationReport({
      reportId: automaticReport.reportId,
      createdAt: automaticReport.completedAt,
      subject: {
        kind: "rag-answer",
        id: automaticReport.sourceTurnId,
        version: automaticReport.evaluator.ruleVersion,
      },
      result: automaticReport.result,
    }, scopedEvaluationStorage(storageScopeKey));
  }, [automaticReport?.reportId, live, storageScopeKey]);
  const displayDimensions = automaticReport
    ? reportDimensions(automaticReport)
    : dimensions;
  const displayGates = automaticReport ? reportGates(automaticReport) : gates;
  const calculatedResult = scoreEvaluation({
    dimensions: displayDimensions,
    gates: displayGates,
  });
  const result = automaticReport
    ? {
        ...calculatedResult,
        score: automaticReport.result.score,
        coverage: automaticReport.result.coverage,
        complete: automaticReport.result.status === "completed",
        verdict: reportVerdict(automaticReport),
        gateStatus: automaticReport.judgments.gates.some(
          (gate) => gate.status === "failed",
        )
          ? ("failed" as const)
          : automaticReport.judgments.gates.some(gate => gate.status === "pending") ? ("pending" as const) : ("passed" as const),
      }
    : calculatedResult;
  const issues = automaticReport
    ? automaticReport.result.risks.map((risk) => ({
        id: risk.id,
        priority: risk.severity === "critical" ? ("P0" as const) : risk.severity === "high" || risk.severity === "medium" ? ("P1" as const) : ("P2" as const),
        title: risk.title,
        impact: risk.summary,
        action: "按服务端评估报告核对对应证据，修订回答后重新生成并复评。",
      }))
    : mode === "sample" && activeCase
      ? activeCase.issues
      : manualIssues(dimensions, gates);
  const conversation = activeCase ? resolveConversationOutcome(activeCase.conversation, activeCase.gates) : null;
  const attributionLabel = activeCase?.conversation.attribution ? RAG_ATTRIBUTIONS.find((item) => item.id === activeCase.conversation.attribution)?.label : null;
  const historicalKnowledge = Boolean(
    live && live.knowledgeBinding !== "current_publication",
  );
  const knowledgeVersion = live
    ? live.knowledgeBase
      ? `v${live.knowledgeBase.version}`
      : historicalKnowledge
        ? "历史任务知识版本未知"
        : "尚未发布"
    : activeCase
      ? KNOWLEDGE_VERSION
      : "待绑定正式知识版本";
  const currentSources = live
    ? live.sources.map((source) => ({
        ...source,
        scope: source.kind === "published_knowledge" ? "企业资料" : "本轮附件",
        section: "服务端解析引用",
        version:
          source.kind === "user_attachment" ? "本轮附件" : knowledgeVersion,
        excerpt: "",
      }))
    : activeCase?.sources ?? [];
  const canAsk = live
    ? live.loaded &&
      !live.failed &&
      live.configured === true &&
      live.providerLabel !== "未配置" &&
      Boolean(live.knowledgeBase) &&
      live.conversationReady &&
      !live.pendingDispatchQuestion &&
      !live.busy
    : true;
  const hasNewerPublication = Boolean(
    live?.knowledgeBinding === "frozen_task" &&
      live.knowledgeBase &&
      live.currentKnowledgeBase &&
      live.currentKnowledgeBase.version > live.knowledgeBase.version,
  );
  const displayRuleVersion = automaticReport?.evaluator.ruleVersion ?? RAG_RULE_VERSION;
  const displayVerdicts = automaticReport && !automaticReport.result.answerVerdict ? legacyRagVerdictLabels : verdicts;
  const gradedJudgments = automaticReport && isGradedRagJudgment(automaticReport.judgments) ? automaticReport.judgments : null;
  const tone = result.gateStatus === "failed" || result.verdict === "unusable" ? "danger" : result.verdict === "improve" ? "pending" : result.complete ? "ready" : "pending";
  const headlineScore = presentEvaluationScore(result.score, tone === "danger");

  const startAutomaticEvaluation = async () => {
    if (!automaticCoordinate || !live?.answer || automaticStarting) return;
    setAutomaticStarting(true);
    setAutomaticError("");
    const requestKey = automaticRequestStorageKey(
      automaticCoordinate.sourceQaTaskId,
      automaticCoordinate.turnId,
    );
    let clientRequestId = fallbackAutomaticRequestIds.current.get(requestKey);
    try { clientRequestId = sessionStorage.getItem(requestKey) || clientRequestId; }
    catch { /* Use the component-scoped fallback below. */ }
    if (!clientRequestId) {
      clientRequestId = crypto.randomUUID();
      fallbackAutomaticRequestIds.current.set(requestKey, clientRequestId);
      try { sessionStorage.setItem(requestKey, clientRequestId); }
      catch { /* The in-memory fallback still prevents a same-page duplicate. */ }
    }
    try {
      const previous = automaticRun;
      const next = await liveEnterpriseRagEvaluationApi.start({
        clientRequestId,
        ...automaticCoordinate,
      });
      if (
        next.sourceQaTaskId !== automaticCoordinate.sourceQaTaskId ||
        next.turnId !== automaticCoordinate.turnId
      ) {
        throw new Error("自动评估任务与当前回答不匹配，已停止展示。");
      }
      if (previous?.report) {
        setAutomaticHistory((old) =>
          mergeAutomaticRuns([previous, ...old]),
        );
      }
      setAutomaticRun(next);
      if (next.report) {
        setAutomaticHistory((old) => mergeAutomaticRuns([next, ...old]));
      }
      if (terminalEvaluationStatuses.has(next.status)) {
        fallbackAutomaticRequestIds.current.delete(requestKey);
        try { sessionStorage.removeItem(requestKey); }
        catch { /* Already cleared from the in-memory fallback. */ }
      } else {
        fallbackAutomaticRequestIds.current.set(requestKey, next.operationId);
        try { sessionStorage.setItem(requestKey, next.operationId); }
        catch { /* The in-memory fallback retains the server operation id. */ }
      }
      setNotice(
        next.status === "completed"
          ? "服务端自动评估已完成并保存为不可变报告。"
          : next.status === "failed"
            ? ""
          : AUTOMATIC_SUBMITTED_NOTICE,
      );
      if (next.status === "failed") {
        setAutomaticError(
          next.error?.message ?? "自动评估失败，请重新发起评估。",
        );
      }
    } catch (error) {
      setAutomaticError(
        error instanceof Error ? error.message : "自动评估提交失败，请稍后重试。",
      );
    } finally {
      setAutomaticStarting(false);
    }
  };

  const selectCase = (item: RagCase) => {
    setActiveCase(item); setQuestion(item.question); setAnswer(item.answer); setNeed(item.need);
    setDimensions(clone(item.dimensions)); setGates(clone(item.gates)); setMode("sample");
    setNotice("已载入合成样例及预设评审；分数由六维规则实时计算。");
  };
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    if (live) {
      if (!canAsk) return;
      const submitted = input.trim();
      setActiveCase(null); setQuestion(submitted); setAnswer(""); setNeed(`准确回答访客问题：${submitted}`); setMode("manual");
      setDimensions(emptyDimensions()); setGates(emptyGates()); setInput("");
      setNotice(
        live.knowledgeBinding === "current_publication"
          ? "问题已提交，正在基于当前发布知识版本生成回答…"
          : "问题已提交，正在基于本任务冻结知识版本生成回答…",
      );
      void live.onAsk(submitted).then((accepted) => {
        if (!accepted) setNotice("问题未成功提交，请检查上方状态后重试。");
      });
      return;
    }
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
    setReviewDimensions(clone(displayDimensions)); setReviewGates(clone(displayGates)); setConfirmed(false); setDrawer("review");
  };
  const openAnswer = () => {
    if (live) return;
    setAnswerEdit(answer); setNeedEdit(need); setDrawer("answer");
  };
  const updateAnswer = (value: string, task: string) => {
    setAnswer(value.trim()); setNeed(task.trim()); setActiveCase(null); setMode("manual");
    setDimensions(emptyDimensions()); setGates(emptyGates()); close();
    setNotice("回答或用户任务已更新，旧评分已失效，请重新核验。历史记录保留原快照。");
  };
  const saveReview = () => {
    if (!answer.trim() || !need.trim() || !reviewer.trim() || !confirmed) return;
    const record: RecordEntry = { id: `review-${crypto.randomUUID()}`, question, answer, need, reviewer: reviewer.trim(), time: new Date().toISOString(), ruleVersion: RAG_RULE_VERSION, knowledgeVersion: live ? knowledgeVersion : activeCase ? KNOWLEDGE_VERSION : "人工录入-待绑定正式知识版本", dimensions: clone(reviewDimensions), gates: clone(reviewGates) };
    const skillResult = enterpriseRagEvaluationSkill.evaluate({ dimensions: record.dimensions, gates: record.gates });
    const reportSaved = saveEvaluationReport({
      reportId: `report-${record.id}`,
      createdAt: record.time,
      subject: { kind: "rag-answer", id: record.id, version: record.ruleVersion },
      result: skillResult,
    }, scopedEvaluationStorage(storageScopeKey));
    setDimensions(record.dimensions); setGates(record.gates); setMode("manual");
    const next = [record, ...history].slice(0, 30); setHistory(next);
    try { localStorage.setItem(historyStorageKey, JSON.stringify(next)); setNotice(`已保存人工复核快照（${reviewer.trim()}）${reportSaved ? "" : "；评估快照存储不可用"}。人工记录是辅助复核，不会覆盖服务端自动评估报告；未判定或缺少证据的维度仍保持待评估。`); }
    catch { setNotice("人工评审已计算，但浏览器存储不可用，本次记录仅在当前页面保留。"); }
    close();
  };
  const drawerTitle = { review: "人工评审与计算", evidence: "回答依据与陈述核验", rules: "评分规则", improve: "优化方案", answer: "录入待评估回答", history: "评估记录" };
  const serverHistory = mergeAutomaticRuns([
    ...(automaticRun ? [automaticRun] : []),
    ...automaticHistory,
  ]);
  const recordedEvaluationCount = history.length + serverHistory.length;
  const automaticBusy = Boolean(
    automaticStarting ||
      automaticLoading ||
      (automaticRun && !terminalEvaluationStatuses.has(automaticRun.status)),
  );

  return <section className="sfp-root erag-root rag-eval-root" data-testid={live ? "enterprise-rag-live-root" : undefined}>
    <div ref={backgroundRef}>
      <header className="sfp-heading erag-heading"><div><h1>让回答真正满足用户需求</h1><p>从问题、回答和证据出发，发现缺口并确定下一步优化。</p></div><button className="sfp-button sfp-button--ghost" onClick={onOpenWebsite}>{websiteEntryLabel}</button></header>
      <div className="erag-flow" aria-label="企业 RAG 工作方式"><div><span><BookOpenCheck size={18} /></span><strong>企业知识库</strong></div><i /><div><span><Search size={18} /></span><strong>检索与回答</strong></div><i /><div><span><ClipboardCheck size={18} /></span><strong>回答质量评估</strong></div></div>
      <div className="rag-toolbar"><span className="rag-toolbar-label">单次问答</span><div><button onClick={() => setDrawer("rules")}>评分规则</button><button onClick={() => setDrawer("history")}>评估记录 {recordedEvaluationCount > 0 ? `(${recordedEvaluationCount})` : ""}</button></div></div>
      {(live?.notice || notice) && <div className={!live?.notice && notice === AUTOMATIC_SUBMITTED_NOTICE ? "rag-muted" : "sfp-notice"} role={live?.notice ? "alert" : "status"}>{live?.notice || notice}</div>}
      {automaticError && <div className="sfp-notice" role="alert">{automaticError}</div>}
      {live?.refreshFailed && <div className="sfp-notice" role="alert">暂时无法刷新知识来源；页面继续显示上次已确认的{historicalKnowledge ? "本任务冻结快照" : "当前发布快照"}，不会用其他版本替代。<div className="rag-panel-actions"><button className="sfp-button sfp-button--ghost" onClick={live.onRetryKnowledge}>重新检查</button></div></div>}
      {live?.pendingDispatchQuestion && <div className="sfp-notice" role="alert">上次问题“{live.pendingDispatchQuestion}”已保存在当前会话，但尚未确认提交。<div className="rag-panel-actions"><button className="sfp-button sfp-button--primary" disabled={live.busy} onClick={() => void live.onRetryPending()}>重试上次问题</button></div></div>}
      {live && !canAsk && !live.busy && !live.pendingDispatchQuestion && <div className="sfp-notice" role={live.failed || live.configured !== true || live.providerLabel === "未配置" || live.knowledgeBinding === "historical_unknown" ? "alert" : "status"}>{!live.loaded ? historicalKnowledge ? "正在读取本任务冻结的知识快照…" : "正在确认企业知识库与模型状态…" : live.failed ? historicalKnowledge ? `无法确认本任务冻结的历史知识版本${live.failureCode ? `（${live.failureCode}）` : ""}；未使用当前发布版本替代。` : `知识库状态读取失败${live.failureCode ? `（${live.failureCode}）` : ""}。` : live.configured === false ? "企业问答模型尚未配置，请管理员检查模型凭据。" : live.configured !== true || live.providerLabel === "未配置" ? "企业问答模型状态尚未确认；请重新检查后再提问。" : !live.knowledgeBase ? historicalKnowledge ? "本任务的历史知识快照版本未知；未使用当前发布版本冒充来源。" : "请先完成并发布企业知识库，再开始真实问答。" : !live.conversationReady ? "正在准备企业问答会话…" : "当前任务正在处理。"}<div className="rag-panel-actions"><button className="sfp-button sfp-button--ghost" onClick={live.onRetryKnowledge}>重新检查</button>{!live.knowledgeBase && live.knowledgeBinding === "current_publication" && <button className="sfp-button sfp-button--primary" onClick={live.onOpenKnowledge}>前往智能知识库</button>}</div></div>}
      <div className="erag-layout">
        <div className="erag-left-column">
          <section className="sfp-panel erag-knowledge-card"><div className="erag-card-heading"><div><span className="erag-card-icon"><FileText size={18} /></span><strong>RAG 知识底座</strong></div><span className="erag-version">{live ? live.knowledgeBinding === "current_publication" ? live.knowledgeBase ? "当前发布知识快照" : "等待发布" : live.knowledgeBase ? "本任务冻结知识快照" : live.loaded ? "历史快照版本未知" : "正在读取历史快照" : "合成知识快照"}</span></div>
            <div className="erag-stats"><div><strong>{live ? live.knowledgeBase ? 1 : 0 : previewKnowledgeCollectionCount}</strong><small>{live ? historicalKnowledge ? "任务冻结快照" : "发布快照" : "知识集合"}</small></div><div><strong>{live ? live.knowledgeBase?.documentCount ?? 0 : previewKnowledgeFragmentCount}</strong><small>{live ? "知识文档" : "示例知识片段"}</small></div><div><strong>{currentSources.length}</strong><small>当前来源</small></div></div>
            <div className="rag-knowledge-row"><span>{live ? live.knowledgeBase?.sourceFileName || knowledgeVersion : activeCase ? KNOWLEDGE_VERSION : "实际来源待录入"}</span><button onClick={() => setDrawer("evidence")}>查看知识与依据 <ArrowRight size={14} /></button></div>
            {live && <p className="rag-muted">知识版本 {knowledgeVersion} · 问答模型 {live.providerLabel}</p>}
            {hasNewerPublication && <div className="sfp-notice" role="status"><p>项目已发布 v{live?.currentKnowledgeBase?.version}；本会话仍使用冻结的 {knowledgeVersion}。</p><div className="rag-panel-actions"><button className="sfp-button sfp-button--primary" disabled={live?.busy} onClick={live?.onStartNewConversation}>使用 v{live?.currentKnowledgeBase?.version} 新建问答</button></div></div>}
          </section>
          <section className="sfp-panel erag-test-card"><div className="erag-card-heading"><div><span className="erag-card-icon"><Bot size={18} /></span><strong>回答示例试用</strong></div>{live ? <div className="rag-panel-actions"><span className="rag-muted">服务端原始回答</span>{live.taskId && <button className="rag-text-button" disabled={live.busy} onClick={live.onStartNewConversation}>新建问答</button>}</div> : <button className="rag-text-button" onClick={openAnswer}>{answer ? "编辑回答" : "录入回答"}</button>}</div>
            {!live && <label className="rag-case-picker">示例场景<select aria-label="选择评估示例" value={activeCase?.id ?? "custom"} onChange={(event) => { const item = RAG_SAMPLE_CASES.find((item) => item.id === event.target.value); if (item) selectCase(item); }}><option value="custom" disabled>自定义问题</option>{RAG_SAMPLE_CASES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
            <div className="erag-test-thread"><p className="erag-user-message">{question || (live ? "输入一个企业相关问题开始真实问答。" : "")}</p><article><header><Sparkles size={16} /><strong>{websiteDraft?.design.assistant.name || "企业助手"}</strong><small>{live ? live.running ? "真实回答生成中" : "真实企业问答" : activeCase ? "合成回答" : "人工录入"}</small></header><p data-testid={live ? "rag-answer" : undefined}>{answer || (live && live.busy ? historicalKnowledge ? "正在读取本任务冻结知识并生成回答…" : "正在读取当前发布知识并生成回答…" : live ? "尚无待评估回答。请提交真实问题。" : "尚无待评估回答。请录入一条回答进行人工评审。")}</p>{currentSources.length > 0 && <div className="erag-citations">{currentSources.map((source, index) => <button data-testid={live ? "rag-source" : undefined} key={`${"kind" in source ? source.kind : "source"}:${source.id}`} onClick={() => setDrawer("evidence")}>[{index + 1}] {source.title}</button>)}</div>}</article></div>
            <form className="erag-composer" onSubmit={submitQuestion}><input data-testid={live ? "rag-question-input" : undefined} aria-label={live ? "输入企业 RAG 问题" : "输入企业 RAG 示例问题"} placeholder={live ? "输入访客问题，基于已发布知识回答" : "输入访客问题，或选择上方示例"} value={input} disabled={Boolean(live) && !canAsk} onChange={(event) => setInput(event.currentTarget.value)} /><button data-testid={live ? "rag-submit" : undefined} type="submit" disabled={Boolean(live) && (!canAsk || !input.trim())}><Send size={16} />{live ? live.busy ? "回答中…" : "发送问题" : "试用问题"}</button>{live?.running && <button type="button" className="sfp-button sfp-button--ghost" onClick={() => void live.onStop()}>停止</button>}</form>
          </section>
        </div>
        <aside className="sfp-panel erag-evaluation-panel" role="region" aria-label="回答质量评估">
          <div className="erag-evaluation-panel__heading"><div><span className="erag-card-icon"><ClipboardCheck size={18} /></span><span><h2>回答质量评估</h2><small>{automaticReport ? "真实回答 · 服务端自动评估" : live ? "真实回答 · 待自动评估" : mode === "sample" ? "合成样例 · 预设评审" : "人工评审 · 本地计算"}</small></span></div><output data-testid="rag-evaluation-score" className={`erag-evaluation-score is-${tone}`} aria-label={headlineScore.ariaLabel} aria-live="polite"><strong>{headlineScore.value}</strong>{headlineScore.showScale && <small>/100</small>}</output></div>
          {automaticReport && automaticReport.evaluator.ruleVersion !== RAG_RULE_VERSION && <section className="sfp-notice" aria-label="历史评估规则">
            <p data-testid="rag-legacy-rule-notice">正在显示按 {automaticReport.evaluator.ruleVersion} 生成的历史报告，原评分和结论保持不变。需要主动按新规则复评才能生成新结论；页面不会自动发起模型评估。</p>
          </section>}
          {live && <section data-testid="rag-auto-evaluation-status" className="rag-automatic-evaluation" aria-label="服务端自动评估状态"><div><strong>{automaticRun ? automaticStatusLabels[automaticRun.status] : automaticLoading ? "正在读取已有评估" : "尚未运行自动评估"}</strong><small>{automaticRun?.status === "failed" ? automaticRun.error?.message ?? "自动评估失败，请重新发起评估。" : automaticReport ? automaticRun && automaticReportRun && automaticRun.operationId !== automaticReportRun.operationId ? `复评期间显示上一份不可变报告 ${automaticReport.reportId}` : `报告 ${automaticReport.reportId}` : "页面加载只读取已有记录，不会自动产生模型费用。"}</small></div><button data-testid="rag-auto-evaluate" className="sfp-button sfp-button--primary" disabled={!automaticCoordinate || automaticBusy || !answer.trim()} onClick={() => void startAutomaticEvaluation()}>{automaticBusy ? "自动评估中…" : automaticRun ? "重新自动评估" : "开始自动评估"}</button></section>}
          <section className={`rag-verdict is-${tone}`} aria-label="当前评估摘要"><strong>{displayVerdicts[result.verdict]}</strong><p>{automaticReport ? automaticReport.result.summary : result.gateStatus === "failed" ? "发现关键回答风险；高分不能把该回答判为可用，但不会取消网站发布选择。" : result.complete ? (mode === "sample" ? activeCase?.summary : "结论基于人工判定，只提供质量建议，不是发布授权。") : "完成维度与关键风险核验后，才能形成回答可用性结论。"}</p><div className="rag-status-row"><span><ShieldCheck size={14} />关键风险{result.gateStatus === "passed" ? "已核验" : result.gateStatus === "failed" ? "已发现" : "待核验"}</span><span>评审覆盖 {format(result.coverage)}%（检查完成程度）</span>{automaticReport && <span>服务器留痕 · {automaticReport.evaluator.model}</span>}{tone !== "danger" && !result.complete && <span>可能分数 {Math.floor(result.lower)}–{Math.ceil(result.upper)}</span>}</div></section>
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
          <div className="erag-evaluation-dimensions rag-dimensions" aria-label="六维加权评分">{RAG_DIMENSIONS.map((item, index) => { const judgment = displayDimensions.find((d) => d.id === item.id); const serverDimension = automaticReport?.result.dimensions.find((dimension) => dimension.id === item.id); const earned = automaticReport ? serverDimension?.score ?? null : result.earnedByDimension[item.id]; return <button data-testid={automaticReport ? "rag-evaluation-dimension" : undefined} key={item.id} className={earned === null ? "is-pending" : (judgment?.level ?? 0) < 3 ? "is-attention" : "is-positive"} onClick={openReview}><span>{shortLabels[index]}</span><strong>{earned === null ? "—" : format(earned)}<small>/{item.weight}</small></strong></button>; })}</div>
          <section className="rag-user-need"><h3>用户真正想确认</h3><p>{need || "请在录入回答时补充用户任务，避免只按字面匹配评分。"}</p></section>
          <section className="rag-priority"><h3><Lightbulb size={17} />优先优化</h3>{issues.length ? <><div><span className={`rag-priority-label is-${issues[0].priority}`}>{issues[0].priority}</span><strong>{issues[0].title}</strong></div><p>{issues[0].action}</p><button className="rag-text-button" onClick={() => setDrawer("improve")}>查看优化方案 <ArrowRight size={14} /></button></> : <p>{result.complete ? "当前记录没有待修复项；继续用更多真实场景验证。" : "先补齐当前回答的判断依据，再确定优化方向。"}</p>}</section>
          <div className="rag-panel-actions"><div><button aria-label="人工评审与计算" className="sfp-button sfp-button--ghost" disabled={!answer.trim() || !need.trim()} onClick={openReview}>{live ? "人工复核（次要）" : "人工评审与计算"}</button><button className="sfp-button sfp-button--ghost" onClick={() => setDrawer("evidence")}>查看回答依据</button></div>{live && <p className="rag-muted">人工复核只作为辅助记录，不会覆盖服务端自动评估或网站建设评估。</p>}<button className="rag-text-button rag-website-link" onClick={onOpenWebsiteAssistant}>进入网站设计 <ArrowRight size={14} /></button></div>
        </aside>
      </div>
    </div>
    {drawer && <div className="rag-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside ref={dialogRef} className="rag-drawer" role="dialog" aria-modal="true" aria-labelledby="rag-drawer-title" tabIndex={-1}><header><div><small>{displayRuleVersion}</small><h2 id="rag-drawer-title">{drawerTitle[drawer]}</h2></div><button aria-label="关闭评估面板" onClick={close}><X size={20} /></button></header><div className="rag-drawer-body">
      {drawer === "review" && <><div className="rag-context"><strong>{question}</strong><p>{answer}</p><small>当前任务：{need || "尚未填写"}</small></div><p className="rag-muted">逐维核验后填写等级、理由与证据定位。缺项可保存，但不会被当成已通过。适用性已按固定方案冻结。</p>{RAG_DIMENSIONS.map((item, index) => { const judgment = reviewDimensions[index]; return <fieldset className="rag-review-field" key={item.id}><legend>{shortLabels[index]} · {item.weight} 分</legend><p>{item.question}</p><label>判断等级<select aria-label={`${shortLabels[index]}等级`} value={judgment?.level ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, level: event.target.value === "" ? null : Number(event.target.value) as Rating } : d))}><option value="">待判定</option>{levels.map((label, level) => <option key={level} value={level}>{level} · {label}</option>)}</select></label><label>判断理由<textarea aria-label={`${shortLabels[index]}理由`} value={judgment?.rationale ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, rationale: event.target.value } : d))} /></label><label>证据定位<input aria-label={`${shortLabels[index]}证据`} placeholder="来源段落、陈述 ID 或回答原句；用逗号分隔" value={judgment?.evidenceIds.join(", ") ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, evidenceIds: event.target.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean) } : d))} /></label></fieldset>; })}<h3>关键回答风险</h3>{RAG_GATES.map((item, index) => <fieldset className="rag-review-field rag-gate-field" key={item.id}><legend>{item.label}</legend><p>{item.description}</p><label>核验结果<select aria-label={`${item.label}风险核验`} value={reviewGates[index]?.status ?? "pending"} onChange={(event) => setReviewGates((old) => old.map((g) => g.id === item.id ? { ...g, status: event.target.value as GateJudgment["status"] } : g))}><option value="pending">待核验</option><option value="passed">通过</option><option value="failed">发现风险</option></select></label><label>核验依据<input aria-label={`${item.label}风险核验依据`} value={reviewGates[index]?.reason ?? ""} onChange={(event) => setReviewGates((old) => old.map((g) => g.id === item.id ? { ...g, reason: event.target.value } : g))} /></label></fieldset>)}<label className="rag-reviewer">评审人<input aria-label="评审人" value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="姓名或评审代号" /></label><label className="rag-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />已对照当前回答与证据进行核验，不将预设评审当作自动评估结果。</label><p className="rag-muted">记录仅保存在当前浏览器，最多保留 30 条。请勿粘贴敏感业务资料。</p></>}
      {drawer === "answer" && <><div className="rag-context"><strong>{question}</strong></div><label className="rag-editor-label">用户任务<textarea aria-label="用户任务" value={needEdit} onChange={(event) => setNeedEdit(event.target.value)} placeholder="访客希望解决什么、做出什么决定？" /></label><label className="rag-editor-label">实际回答<textarea className="rag-answer-editor" aria-label="实际回答" value={answerEdit} onChange={(event) => setAnswerEdit(event.target.value)} placeholder="粘贴待评估的回答，包括引用定位。此处不会调用模型。" /></label><p className="rag-muted">保存后清空当前评审。人工证据通过评审表逐项记录，不会自动继承示例来源。</p></>}
      {drawer === "evidence" && <>
        <div className="rag-context"><strong>{question}</strong><p>知识版本：{automaticReport ? `v${automaticReport.knowledgeBase.version}` : knowledgeVersion}</p></div>
        <h3>陈述与证据</h3>
        {automaticReport ? automaticReport.judgments.claims.map((claim) => <article className="rag-evidence" key={claim.id}><header><strong>{claim.id}</strong><span className={["supported", "not_applicable"].includes(claim.status) ? "" : "rag-danger-text"}>{{ supported: "有支持", partial: "部分支持", unsupported: "无支持", contradicted: "与依据矛盾", unverifiable: "待补证", not_applicable: "非事实说明" }[claim.status]}</span></header><p>{claim.statement}</p><small>{claim.rationale} · 来源：{claim.sourceIds.join("、") || "没有来源"}</small></article>) : !live && activeCase?.claims.length ? activeCase.claims.map((claim) => <article className="rag-evidence" key={claim.id}><header><strong>{claim.id}</strong><span className={["supported", "not_applicable"].includes(claim.status) ? "" : "rag-danger-text"}>{{ supported: "有支持", partial: "部分支持", unsupported: "无支持", restricted: "权限受限" }[claim.status]}</span></header><p>{claim.text}</p><small>{claim.note} · {claim.sourceIds.join("、") || "没有来源"}</small></article>) : <p>{live ? "尚无服务端陈述级自动评估；可点击“开始自动评估”，或以人工复核记录辅助检查。" : "当前为人工录入回答。请在评审表中逐维记录可核验的原文与来源定位。"}</p>}
        <h3>{live ? "参考资料" : "来源原文"}</h3>
        {currentSources.length ? currentSources.map((source) => <article data-testid={live ? "rag-source" : undefined} className="rag-evidence" key={`${"kind" in source ? source.kind : "source"}:${source.id}`}><header><strong>{source.title}</strong><span>{source.scope}</span></header><small>{source.id} · {source.section} · {source.version}</small>{source.excerpt ? <blockquote>{source.excerpt}</blockquote> : <p className="rag-muted">当前接口只公开服务端解析后的资料标识与标题，不展示或伪造原文摘录。</p>}</article>) : <p>当前回答没有返回参考资料。</p>}
        <h3>{automaticReport ? "自动评估六维判断" : "本次判断记录"}</h3>
        {displayDimensions.map((item, index) => <article className="rag-evidence" key={item.id}><strong>{shortLabels[index]} · {item.level === null ? "待判定" : `${item.level}/4`}</strong><p>{item.rationale || "判断理由待补充"}</p><small>证据：{item.evidenceIds.join("、") || "待补充"}</small></article>)}
        <h3>关键风险核验</h3>
        {displayGates.map((gate) => { const automaticGate = automaticReport?.judgments.gates.find((item) => item.id === gate.id); return <article data-testid={automaticReport ? "rag-evaluation-gate" : undefined} className="rag-evidence" key={gate.id}><strong>{RAG_GATES.find((g) => g.id === gate.id)?.label} · {{ passed: "通过", failed: "发现风险", pending: "待核验" }[gate.status]}</strong><p>{gate.reason || "尚无核验记录"}</p>{automaticGate && <small>证据：{automaticGate.evidenceIds.join("、")}</small>}</article>; })}
        {automaticReport && <><h3>不可变报告溯源</h3><article data-testid="rag-auto-evaluation-report" className="rag-evidence rag-provenance"><p><strong>报告 ID：</strong>{automaticReport.reportId}</p><p><strong>源问答任务 / 轮次：</strong>{automaticReport.sourceQaTaskId} / {automaticReport.sourceTurnId}</p><p><strong>问题 / 回答消息：</strong>{automaticReport.questionMessageId} / {automaticReport.answerMessageId}</p><p><strong>冻结知识：</strong>{automaticReport.knowledgeBase.snapshotId} · {automaticReport.knowledgeBase.contentHash}</p><p><strong>评估器：</strong>{automaticReport.evaluator.skillId} {automaticReport.evaluator.skillVersion} · 规则 {automaticReport.evaluator.ruleVersion} · Judge {automaticReport.evaluator.judgeVersion}</p><p><strong>模型：</strong>{automaticReport.evaluator.provider} / {automaticReport.evaluator.model}{automaticReport.evaluator.effort ? ` / ${automaticReport.evaluator.effort}` : ""}</p><p><strong>输入 / Skill 哈希：</strong>{automaticReport.judgments.inputHash} / {automaticReport.evaluator.skillHash}</p><small>完成时间：{new Date(automaticReport.completedAt).toLocaleString("zh-CN")}</small></article></>}
        <p className="rag-muted">{automaticReport ? "自动结论绑定本次回答、服务端冻结知识、规则与模型版本；网站建设评估仍是独立流程。" : live ? "参考资料表示本次回答实际使用的材料；人工复核不会替代服务端自动评估。" : "预设评审只针对这些合成文本与快照；不证明真实服务已抵御注入、越权或其他攻击。"}</p>
      </>}
      {drawer === "rules" && <><h3>六维 100 分</h3><p className="rag-formula">总分 = Σ（维度权重 × 等级 ÷ 4）</p>{RAG_DIMENSIONS.map((item) => <article className="rag-evidence" key={item.id}><header><strong>{item.label}</strong><b>{item.weight} 分</b></header><p>{item.question}</p></article>)}<h3>等级与结论</h3><p>0 不满足 · 1 少量满足 · 2 部分满足 · 3 基本满足 · 4 充分满足。等级必须附判断理由和证据定位。</p><p>{displayRuleVersion === "rag-eval-1.3" ? "分数仅作诊断，不设单独否决阈值。核心任务完成且证据完整、无重大风险时可用；有非关键问题时显示可用 · 待改进。重大风险或核心任务明确失败显示不可用 · 需修复，必要证据不足显示待核验。" : "历史规则：原始分 ≥90 优秀；≥80 可用；≥70 需要改进；低于 70 不可用。历史结论仍按原冻结规则解释。"}</p>{displayRuleVersion === "rag-eval-1.3" ? <><h3>重大风险与改进项</h3><p>核实建议不等于事实承诺，但其中的电话、操作和企业承诺仍须核验。只按当前任务判断必要信息，不要求无关扩展；来源缺失保留未知。评审覆盖率不代表回答正确率。</p></> : <p>当前展示历史规则与历史结论；新规则不会追溯改判此报告。</p>}<h3>关键风险优先于回答分数</h3><p>任一关键风险成立，该回答直接判为不可用；有风险待核验，不判为可用。此结论是质量建议，不阻止用户进入网站发布确认。</p>{RAG_GATES.map((item) => <article className="rag-evidence" key={item.id}><strong>{item.label}</strong><p>{item.description}</p></article>)}<h3>缺证据不计作通过</h3><p>未判定维度不删除、不补成满分。页面显示已核验权重覆盖率及数学上的可能得分范围；范围不是统计置信区间。不适用项须在正式测试计划中预先批准，当前页面不提供临时剔除。</p><h3>分数的使用边界</h3><p>单次回答分、企业 RAG 系统分与网站建设评估彼此独立。合成示例、单人自评和少量测试都不能替代正式代表集验收或独立复核。任务未完成或关键回答风险成立时，高分不改变该回答的质量结论；但评估结果不拥有网站发布权限。</p><h3>验收参数 · 初始默认值</h3><p>以下为需求说明第十三章的初始基线，用于试运行与技术设计，不是实测结论；调整需保留原值、原因、版本与审批记录。</p>{RAG_ACCEPTANCE_PARAMS.map((item) => <article className="rag-evidence" key={item.label}><header><strong>{item.label}</strong></header><p>{item.value}</p></article>)}</>}
      {drawer === "improve" && <>{gradedJudgments ? [
        ["critical", "必须修复"], ["improvement", "建议改进"], ["undetermined", "待补证"],
      ].map(([severity, label]) => <section key={severity}><h3>{label}</h3>{gradedJudgments.findings.filter(finding => finding.severity === severity).map(finding => <article className="rag-evidence" key={finding.id}><strong>{finding.summary}</strong><p>影响：{finding.impact}</p>{finding.claimIds.map(id => <blockquote key={id}>{gradedJudgments.claims.find(claim => claim.id === id)?.statement}</blockquote>)}<small>证据：{finding.evidenceIds.join("、")}；维度：{finding.dimensionIds.join("、")}</small></article>)}{!gradedJudgments.findings.some(finding => finding.severity === severity) && <p>当前没有此类记录。</p>}</section>) : (() => { const blocking = issues.filter((issue) => issue.priority === "P0"); const recorded = issues.filter((issue) => issue.priority !== "P0"); return <>
        <h3>高优先级风险（建议修复并复测）</h3>{blocking.length ? blocking.map((issue) => <article className="rag-evidence" key={issue.id}><header><strong>{issue.title}</strong><span>{issue.priority}</span></header><p>{issue.impact}</p><small>修复方向：{issue.action}</small></article>) : <p className="rag-muted">当前没有已确认的高优先级风险。完整对话层判定不通过时，会在此说明。</p>}
        <h3>一般记录项（仍需留痕）</h3>{recorded.length ? recorded.map((issue) => <article className="rag-evidence" key={issue.id}><header><strong>{issue.title}</strong><span>{issue.priority}</span></header><p>{issue.impact}</p><small>修复方向：{issue.action}</small></article>) : <p className="rag-muted">当前没有一般记录项。重复询问、轻微弱相关推荐、展示前已纠正的误拦属于这一类。</p>}
      </>; })()}{mode === "sample" && activeCase ? <><h3>{activeCase.improvement.title}</h3><ol>{activeCase.improvement.steps.map((step) => <li key={step}>{step}</li>)}</ol>{activeCase.improvement.answer && <><h3>建议改写 · 待复评</h3><p className="rag-proposed-answer">{activeCase.improvement.answer}</p><button className="sfp-button sfp-button--primary" onClick={() => updateAnswer(activeCase.improvement.answer!, need)}>采用改写并重新评审</button></>}</> : <p>建议由当前人工判断生成，请对照真实知识修订。页面不会编造一条“高分回答”。</p>}</>}
      {drawer === "history" && <>
        {live && <><h3>服务端自动评估记录</h3><p className="rag-muted">以下记录来自服务端，绑定问答任务、轮次、冻结知识、规则与模型版本。完成后的报告不可被人工复核覆盖。</p>{serverHistory.length === 0 ? <p>{automaticLoading ? "正在读取已有自动评估…" : "当前回答暂无自动评估记录。页面加载不会自动发起付费评估。"}</p> : serverHistory.map((run, index) => { const score = presentEvaluationScore(run.report?.result.score, Boolean(run.report && reportVerdict(run.report) === "unusable")); return <article className="rag-evidence" key={run.operationId}><header><strong>{index === 0 ? "最新自动评估" : "历史自动评估"}</strong><span className={`rag-history-score${score.showScale ? "" : " is-danger"}`} aria-label={score.ariaLabel}>{score.text}</span></header><p>{automaticStatusLabels[run.status]}{run.report ? ` · ${run.report.result.summary}` : run.error ? ` · ${run.error.message}` : ""}</p><small>操作 {run.operationId} · {new Date(run.createdAt).toLocaleString("zh-CN")}</small>{run.report && <details><summary>查看不可变报告信息</summary><p>报告：{run.report.reportId}</p><p>问答任务 / 轮次：{run.report.sourceQaTaskId} / {run.report.sourceTurnId}</p><p>知识快照：{run.report.knowledgeBase.snapshotId} · v{run.report.knowledgeBase.version}</p><p>评估 Skill / 规则：{run.report.evaluator.skillVersion} / {run.report.evaluator.ruleVersion}</p><p>模型：{run.report.evaluator.provider} / {run.report.evaluator.model}</p><p>六维 {run.report.judgments.dimensions.length} 项 · 风险门 {run.report.judgments.gates.length} 项 · 陈述 {run.report.judgments.claims.length} 项</p></details>}</article>; })}</>}
        <h3>{live ? "人工复核记录（辅助）" : "人工评审记录"}</h3>
        <p className="rag-muted">本地快照绑定问题、回答、知识版本和规则版本；修改回答不会覆盖旧记录。当前浏览器保存 {history.length}/30 条。{live ? "人工复核不改变服务端自动报告。" : ""}</p>
        {history.length === 0 ? <p>暂无已保存的人工评审。完成评审后在这里查看。</p> : history.map((record) => { const grade = record.ruleVersion === "rag-eval-1.2" ? scoreLegacyEvaluation(record) : record.ruleVersion === RAG_RULE_VERSION ? scoreEvaluation(record) : null; const sameAnswer = record.question === question && record.answer === answer && record.need === need; const score = presentEvaluationScore(grade?.score, grade?.verdict === "unusable"); return <article className="rag-evidence" key={record.id}><header><strong>{record.question}</strong><span className={`rag-history-score${score.showScale ? "" : " is-danger"}`} aria-label={score.ariaLabel}>{score.text}</span></header><p>{grade ? (record.ruleVersion === "rag-eval-1.2" ? legacyRagVerdictLabels : verdicts)[grade.verdict] : "历史规则暂不支持重新计算"} · {sameAnswer ? "与当前回答相同" : "历史快照，不适用于当前回答"}</p><small>{record.reviewer} · {new Date(record.time).toLocaleString("zh-CN")} · {record.knowledgeVersion} · {record.ruleVersion}</small><details><summary>查看回答与判断</summary><p>{record.answer}</p>{record.dimensions.map((item) => <p key={item.id}>{RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}：{item.level ?? "待判定"}/4 · {item.rationale}</p>)}</details></article>; })}
      </>}
    </div><footer>{drawer === "review" ? <button className="sfp-button sfp-button--primary" disabled={!answer.trim() || !need.trim() || !reviewer.trim() || !confirmed} onClick={saveReview}>保存评审并计算</button> : drawer === "answer" ? <button className="sfp-button sfp-button--primary" disabled={!answerEdit.trim() || !needEdit.trim()} onClick={() => updateAnswer(answerEdit, needEdit)}>保存回答，重新评审</button> : <button className="sfp-button sfp-button--ghost" onClick={close}>完成</button>}</footer></aside></div>}
  </section>;
}
export default EnterpriseRagPreview;
