import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, ChartNoAxesColumnIncreasing, ClipboardCheck, FileText, ShieldCheck, X } from "lucide-react";
import { loadWebsiteDraft } from "./SimplifiedWebsiteBuilderPreview";
import { previewKnowledgeCollectionCount, previewKnowledgeFragmentCount } from "./preview-copy";
import { usePreviewDialog } from "./qa-widget/usePreviewDialog";
import { RAG_ACCEPTANCE_PARAMS, RAG_ATTRIBUTIONS, RAG_CASE_MODE_LABELS, RAG_DIMENSIONS, RAG_GATES, RAG_RULE_VERSION, resolveConversationOutcome, scoreEvaluation, type DimensionId, type DimensionJudgment, type GateJudgment, type Rating } from "./rag-evaluation";
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
import "./rag-evidence-topics.css";
import "./rag-review-disclosure.css";
import "./rag-page-entrance.css";
import { scoreEvaluation as scoreLegacyEvaluation } from "./rag-evaluation-legacy";
import { enterpriseRagQualityVerdictLabels, legacyRagVerdictLabels, reportVerdict } from "./rag-report-presentation";
import { RagEvaluationRadar } from "./RagEvaluationRadar";
import { RagEvaluationGauge } from "./RagEvaluationGauge";
import { RagEvaluationDisclosure } from "./RagEvaluationDisclosure";
import { RagReviewEvidencePicker, RagReviewSelect } from "./RagReviewControls";
import { buildReviewEvidenceOptions, type ReviewEvidenceOption } from "./rag-review-evidence";
import { RagChat, type RagChatTurn, type RagChatFollowup } from "./RagChat";
import { presentRagSummary, presentEvaluationScore } from "./rag-report-presentation";
import { RagConversationHistory, type RagConversationHistoryItem } from "./RagConversationHistory";
import { useRagPreviewHistory, type RagPreviewConversationSnapshot } from "./useRagPreviewHistory";
import type { RagChatActivity } from "./rag-chat-activity";
import { RagImprovementPlan } from "./RagImprovementPlan";
import { buildRagImprovementPlan } from "./rag-improvement-plan";
import { RagAnswerWindows, type AnswerPanel } from "./RagAnswerWindows";
import { RagTaskChecklist } from "./RagTaskChecklist";
import { RagProgressiveText, revealOpacity, textGraphemes } from "./RagProgressiveText";
import { useDataReveal } from "./useDataReveal";
import { useRagPageEntrance } from "./useRagPageEntrance";
import { RagEntranceReadyContext } from "./RagEntranceContext";
import { useRagEvaluationLayout } from "./useRagEvaluationLayout";
import { RAG_CHECKLIST_RULE_VERSION } from "../../../contracts/enterprise-rag-checklist";
import { isChecklistRagJudgment } from "../../../contracts/enterprise-rag-evaluation-run";
import type { RagReportUrlBuilder } from "./rag-report-navigation";
import { enterpriseRagHistoryStorageKey, loadRagReviewHistory as loadHistory, type RagReviewRecord as RecordEntry } from "./rag-review-history";
export { enterpriseRagHistoryStorageKey } from "./rag-review-history";

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
  conversationId?: string;
  taskId?: string;
  /** Server-owned ordinary-chat turn coordinate for the displayed final answer. */
  turnId?: string;
  conversationReady: boolean;
  previousTurns?: RagChatTurn[];
  draftAdoptedFrom?: string;
  onDraftInput?: () => void;
  canSend?: boolean;
  selectedAnswerKey?: string;
  onSelectAnswer?: (key: string) => void;
  chat?: { question: string; answer: string; answerKey: string; sources: Array<{id:string;title:string;kind?:string}>; completedAt?: number; evaluation?: "not_required" };
  evaluationNotRequired?: boolean;
  conversationHistory?: {
    items: RagConversationHistoryItem[];
    activeId?: string | null;
    loading?: boolean;
    error?: string | null;
    busy?: boolean;
    deletingId?: string | null;
    onSelect: (id: string) => void | boolean | Promise<void | boolean>;
    onDelete: (id: string) => void | boolean | Promise<void | boolean>;
    onOpen?: () => void;
  };
  question: string;
  questionId?: string;
  answer: string;
  answerId?: string;
  answerCompletedAt?: number;

  sources: Array<{
    id: string;
    title: string;
    kind: "published_knowledge" | "user_attachment";
  }>;
  busy: boolean;
  running: boolean;
  runningTurnId?: string;
  steeringSupported?: boolean;
  activity?: RagChatActivity[];
  onSteer?: (text: string) => Promise<boolean>;
  onFollowup?: (text: string) => Promise<boolean>;
  followups?: RagChatFollowup[];
  followupsPaused?: boolean;
  onCancelFollowup?: (id: string) => Promise<boolean>;
  onResumeFollowups?: () => Promise<boolean>;
  onRetryFollowup?: (id: string) => Promise<boolean>;
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
  buildReportUrl?: RagReportUrlBuilder;
  live?: EnterpriseRagLiveRuntime;
};
type Drawer = "review" | "evidence" | "rules" | "improve" | "answer" | "history" | null;
type ReviewDraftContext = { ownerKey: string; scopeKey: string; question: string; answer: string; need: string; knowledgeVersion: string; evidenceOptions: ReviewEvidenceOption[] };
type ReviewDraft = ReviewDraftContext & { dimensions: DimensionJudgment[]; gates: GateJudgment[]; reviewer: string; confirmed: boolean };
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
const verdicts = enterpriseRagQualityVerdictLabels;
const emptyDimensions = (): DimensionJudgment[] => RAG_DIMENSIONS.map(({ id }) => ({ id, level: null, rationale: "", evidenceIds: [], applicable: true }));
const emptyGates = (): GateJudgment[] => RAG_GATES.map(({ id }) => ({ id, status: "pending", reason: "" }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const format = (value: number) => Number(value.toFixed(2)).toString();
type EvidenceTone = "positive" | "attention" | "danger" | "neutral" | "info";
const claimStatusLabels: Record<string, string> = {
  supported: "有支持",
  partial: "部分支持",
  unsupported: "无支持",
  contradicted: "与依据矛盾",
  unverifiable: "待补证",
  not_applicable: "非事实说明",
  restricted: "权限受限",
};
const claimStatusTones: Record<string, EvidenceTone> = {
  supported: "positive",
  partial: "attention",
  unsupported: "danger",
  contradicted: "danger",
  unverifiable: "attention",
  not_applicable: "neutral",
  restricted: "danger",
};
const gateStatusLabels: Record<GateJudgment["status"], string> = {
  passed: "通过",
  failed: "发现风险",
  pending: "待核验",
};
function RagEvidenceTag({ label, tone, testId }: { label: string; tone: EvidenceTone; testId: string }) {
  return <span className={`rag-evidence-tag is-${tone}`} data-testid={testId}>{label}</span>;
}

function RagGateStatusOrb({ label, status }: { label: string; status: GateJudgment["status"] }) {
  return <i
    className={`rag-evaluation-status-orb rag-gate-status-orb is-${status}`}
    data-testid="rag-gate-status-orb"
    role="img"
    aria-label={`${label}：${gateStatusLabels[status]}`}
  />;
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
  const results = new Map(report.result.dimensions.map((item) => [item.id, item]));
  const checklist = isChecklistRagJudgment(report.judgments);
  return report.judgments.dimensions.map((item) => {
    const result = results.get(item.id);
    return {
      id: item.id,
      level: checklist ? null : item.level as Rating | null,
      rationale: item.rationale,
      evidenceIds: [...item.evidenceIds],
      applicable: result?.status !== "not_applicable",
    };
  });
}

function reportGates(report: EnterpriseRagEvaluationReport): GateJudgment[] {
  return report.judgments.gates.map((item) => ({
    id: item.id,
    status: item.status,
    reason: item.reason,
  }));
}

function manualIssues(dimensions: DimensionJudgment[], gates: GateJudgment[]): RagIssue[] {
  const risks: RagIssue[] = gates.filter((item) => item.status === "failed").map((item) => ({ id: `gate-${item.id}`, priority: "P0", title: `${RAG_GATES.find((gate) => gate.id === item.id)?.label}存在关键风险`, impact: item.reason, action: "先移除或修正风险内容，核对授权与依据，再重新评审。" }));
  const gaps: RagIssue[] = dimensions.filter((item) => item.level !== null && item.level < 4).sort((a, b) => (a.level ?? 4) - (b.level ?? 4)).map((item) => ({ id: item.id, priority: item.level! <= 2 ? "P1" : "P2", title: `${RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}可改进`, impact: item.rationale, action: dimensionActions[item.id], dimensionId: item.id }));
  return [...risks, ...gaps].slice(0, 3);
}

export function EnterpriseRagPreview({ storageScopeKey, live, buildReportUrl }: Props) {
  const historyStorageKey = enterpriseRagHistoryStorageKey(storageScopeKey);
  const previewHistory = useRagPreviewHistory(storageScopeKey, !live, true);
  const initialPreview = previewHistory.activeSnapshot;
  const initialCase = initialPreview?.caseId ? RAG_SAMPLE_CASES.find(item => item.id === initialPreview.caseId) ?? null : null;
  const [websiteDraft] = useState(() =>
    live ? null : loadWebsiteDraft(storageScopeKey),
  );
  const [activeCase, setActiveCase] = useState<RagCase | null>(live ? null : initialCase);
  const [question, setQuestion] = useState(live?.question ?? initialPreview?.question ?? "");
  const [answer, setAnswer] = useState(live?.answer ?? initialPreview?.answer ?? "");
  const [need, setNeed] = useState(live?.question ? `准确回答访客问题：${live.question}` : live ? "" : initialPreview?.need ?? "");
  const [previewAnswerIdentity, setPreviewAnswerIdentity] = useState(initialPreview?.previewAnswerIdentity ?? `authored:${crypto.randomUUID()}`);
  const [previewPreviousTurns, setPreviewPreviousTurns] = useState(initialPreview?.previousTurns ?? []);
  const [input, setInput] = useState(initialPreview?.input ?? "");
  const inputRevision = useRef(0);
  const liveInputOwner = useRef({ scope: storageScopeKey, conversation: live?.conversationId, adoptedFrom: live?.draftAdoptedFrom });
  liveInputOwner.current = { scope: storageScopeKey, conversation: live?.conversationId, adoptedFrom: live?.draftAdoptedFrom };
  const liveDrafts = useRef(new Map<string, string>());
  const liveDraftOwner = useRef({ scope: storageScopeKey, conversation: live?.conversationId });
  useLayoutEffect(() => {
    if (!live) return;
    const previous = liveDraftOwner.current;
    if (previous.scope !== storageScopeKey) {
      liveDrafts.current.clear();
      liveDraftOwner.current = { scope: storageScopeKey, conversation: live.conversationId };
      setInput("");
    } else if (previous.conversation !== live.conversationId) {
      if (previous.conversation) liveDrafts.current.set(previous.conversation, input);
      liveDraftOwner.current = { scope: storageScopeKey, conversation: live.conversationId };
      if (live.draftAdoptedFrom === previous.conversation && live.conversationId) liveDrafts.current.set(live.conversationId, input);
      else setInput(live.conversationId ? liveDrafts.current.get(live.conversationId) ?? "" : "");
    }
  }, [storageScopeKey, live?.conversationId]);
  const [dimensions, setDimensions] = useState(initialPreview ? clone(initialPreview.dimensions) : emptyDimensions());
  const [gates, setGates] = useState(initialPreview ? clone(initialPreview.gates) : emptyGates());
  const [mode, setMode] = useState<"sample" | "manual">(live ? "manual" : initialPreview?.mode ?? "manual");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [sheetModal, setSheetModal] = useState(false);
  const [reviewDimensions, setReviewDimensions] = useState<DimensionJudgment[]>([]);
  const [reviewGates, setReviewGates] = useState<GateJudgment[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewDraftSnapshot, setReviewDraftSnapshot] = useState<ReviewDraftContext | null>(null);
  const reviewDrafts = useRef(new Map<string, ReviewDraft>());
  const reviewDraftScope = useRef(historyStorageKey);
  if (reviewDraftScope.current !== historyStorageKey) {
    reviewDraftScope.current = historyStorageKey;
    reviewDrafts.current.clear();
  }
  const [answerEdit, setAnswerEdit] = useState("");
  const [questionEdit, setQuestionEdit] = useState("");
  const [needEdit, setNeedEdit] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState(() => loadHistory(historyStorageKey));
  const [automaticReadVersion, setAutomaticReadVersion] = useState(0);
  const [automaticExpectedState, setAutomaticExpected] = useState(false);
  const [automaticAdmissionBlocked, setAutomaticAdmissionBlocked] = useState(false);
  const expectedReadOwner = useRef({ key: "", since: 0 });
  const [automaticRunState, setAutomaticRun] =
    useState<EnterpriseRagEvaluationRunDto | null>(null);
  const [automaticHistoryState, setAutomaticHistory] = useState<
    EnterpriseRagEvaluationRunDto[]
  >([]);
  const [automaticLoadingState, setAutomaticLoading] = useState(false);
  const [automaticStartingState, setAutomaticStarting] = useState(false);
  const [automaticErrorState, setAutomaticError] = useState("");
  const [automaticDataOwner, setAutomaticDataOwner] = useState("");
  const automaticMounted = useRef(true);
  const automaticRequestToken = useRef(0);
  const automaticStartLock = useRef<{ ownerKey: string; generation: number; token: number } | null>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const entranceReady = useRagPageEntrance(backgroundRef, storageScopeKey ?? "preview");
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingEvidenceSelection = useRef<string | null>(null);
  useEffect(() => {
    const update = () => backgroundRef.current?.style.setProperty("--rag-visible-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
    update(); window.visualViewport?.addEventListener("resize", update);
    return () => window.visualViewport?.removeEventListener("resize", update);
  }, []);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewQueueKey = JSON.stringify([storageScopeKey, previewHistory.activeId]);
  const [previewQueues, setPreviewQueues] = useState<Record<string, { items: RagChatFollowup[]; paused: boolean }>>({});
  const previewQueue = previewQueues[previewQueueKey] ?? { items: [], paused: false };
  const [previewActivity, setPreviewActivity] = useState<RagChatActivity[]>([]);
  const previewStages = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [previewAnswerRevision, setPreviewAnswerRevision] = useState(0);
  const [previewCompletedAt, setPreviewCompletedAt] = useState(() => initialPreview?.completedAt ?? Date.now());
  const previewOperation = useRef(0);
  const previewDelay = useRef<{ timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null);
  const cancelPreview = () => {
    previewOperation.current += 1;
    previewStages.current.forEach(clearTimeout);
    previewStages.current = [];
    setPreviewActivity([]);
    if (previewDelay.current) {
      clearTimeout(previewDelay.current.timer);
      previewDelay.current.resolve();
      previewDelay.current = null;
    }
    setPreviewBusy(false);
  };
  const previewSnapshot = (): RagPreviewConversationSnapshot => ({
    previousTurns: previewPreviousTurns, question, answer, need, input,
    caseId: activeCase?.id ?? null, dimensions, gates, mode, previewAnswerIdentity,
    completedAt: previewCompletedAt,
  });
  const restorePreview = (snapshot: RagPreviewConversationSnapshot | null) => {
    cancelPreview();
    setPreviewPreviousTurns(snapshot?.previousTurns ?? []);
    setActiveCase(snapshot?.caseId ? RAG_SAMPLE_CASES.find(item => item.id === snapshot.caseId) ?? null : null);
    setQuestion(snapshot?.question ?? ""); setAnswer(snapshot?.answer ?? ""); setNeed(snapshot?.need ?? ""); setInput(snapshot?.input ?? "");
    setDimensions(snapshot ? clone(snapshot.dimensions) : emptyDimensions());
    setGates(snapshot ? clone(snapshot.gates) : emptyGates());
    setMode(snapshot?.mode ?? "manual");
    setPreviewAnswerIdentity(snapshot?.previewAnswerIdentity ?? `authored:${crypto.randomUUID()}`);
    setPreviewCompletedAt(snapshot?.completedAt ?? Date.now());
    setNotice("");
  };
  const previewScope = useRef(storageScopeKey);
  useEffect(() => {
    if (live) return;
    if (previewScope.current !== storageScopeKey) {
      previewScope.current = storageScopeKey;
      restorePreview(previewHistory.activeSnapshot);
      return;
    }
    if (!previewBusy) previewHistory.save(previewSnapshot(), previewHistory.activeId);
  }, [storageScopeKey, live, previewHistory.activeId, previewBusy, previewPreviousTurns, question, answer, need, input, activeCase, dimensions, gates, mode, previewAnswerIdentity, previewCompletedAt]);
  useEffect(() => {
    cancelPreview();
    return () => {
      previewOperation.current += 1;
      previewStages.current.forEach(clearTimeout);
      if (previewDelay.current) {
        clearTimeout(previewDelay.current.timer);
        previewDelay.current.resolve();
        previewDelay.current = null;
      }
    };
  }, [storageScopeKey, live?.taskId]);
  const syncedLiveAnswer = useRef("");
  const fallbackAutomaticRequestIds = useRef(new Map<string, string>());
  const close = (panel?: AnswerPanel) => {
    if (panel) { closeAnswerPanel(panel); return; }
    // Restore interactivity before the dialog hook returns focus to its trigger.
    if (backgroundRef.current) backgroundRef.current.inert = false;
    setDrawer(null);
  };
  const dialogRef = usePreviewDialog(drawer !== null, close);
  useLayoutEffect(() => {
    if (backgroundRef.current) backgroundRef.current.inert = drawer !== null || sheetModal;
    if (!drawer && !sheetModal) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [drawer, sheetModal]);
  useEffect(() => {
    setHistory(loadHistory(historyStorageKey));
  }, [historyStorageKey]);
  const liveAnswerKey = live
    ? JSON.stringify([historyStorageKey, live.conversationId, live.taskId, live.turnId, live.questionId, live.answerId, live.question, live.answer])
    : "";
  // Report refreshes and manual scoring do not change the answer being reviewed.
  // A sample keeps its identity when selected again; authored answers have their
  // own local identity so two independent copies never share a draft by accident.
  const answerContextKey = JSON.stringify([
    historyStorageKey,
    live && activeCase ? ["example", activeCase.id] : live ? ["live", liveAnswerKey, live.knowledgeBinding, live.knowledgeBase?.snapshotId, live.knowledgeBase?.version] : ["preview", previewHistory.activeId, previewAnswerIdentity],
    question, answer, need,
  ]);
  const currentAnswerContext = useRef(answerContextKey);
  currentAnswerContext.current = answerContextKey;
  const reviewDraftContext = reviewDraftSnapshot?.ownerKey === answerContextKey && reviewDraftSnapshot.scopeKey === historyStorageKey
    ? reviewDraftSnapshot
    : null;
  useEffect(() => {
    if (!reviewDraftSnapshot || reviewDraftSnapshot.scopeKey !== historyStorageKey || !reviewDrafts.current.has(reviewDraftSnapshot.ownerKey)) return;
    reviewDrafts.current.set(reviewDraftSnapshot.ownerKey, {
      ...reviewDraftSnapshot,
      dimensions: clone(reviewDimensions), gates: clone(reviewGates), reviewer, confirmed,
    });
  }, [reviewDraftSnapshot, reviewDimensions, reviewGates, reviewer, confirmed, historyStorageKey]);
  useEffect(() => {
    setReviewDraftSnapshot(current => current?.scopeKey === historyStorageKey ? current : null);
  }, [historyStorageKey]);
  useEffect(() => {
    if (!live || syncedLiveAnswer.current === liveAnswerKey) return;
    syncedLiveAnswer.current = liveAnswerKey;
    if (activeCase && mode === "sample") return;
    setActiveCase(null);
    setQuestion(live.question);
    setAnswer(live.answer);
    setNeed(live.question ? `准确回答访客问题：${live.question}` : "");
    const savedReview = history.find(record => record.subjectKey === JSON.stringify([historyStorageKey, live.selectedAnswerKey ?? liveAnswerKey]));
    setDimensions(savedReview ? clone(savedReview.dimensions) : emptyDimensions());
    setGates(savedReview ? clone(savedReview.gates) : emptyGates());
    setMode("manual");
    setNotice("");
  }, [liveAnswerKey, live]);
  const automaticCoordinate =
    !activeCase && !live?.evaluationNotRequired && live?.taskId && live.turnId && live.answer && question === live.question && answer === live.answer
      ? { sourceQaTaskId: live.taskId, turnId: live.turnId }
      : null;
  const automaticCoordinateKey = automaticCoordinate
    ? JSON.stringify([answerContextKey, automaticCoordinate.sourceQaTaskId, automaticCoordinate.turnId, live?.answerId])
    : "";
  const automaticOwner = useRef({ key: automaticCoordinateKey, generation: 0 });
  if (automaticOwner.current.key !== automaticCoordinateKey) {
    automaticOwner.current = { key: automaticCoordinateKey, generation: automaticOwner.current.generation + 1 };
    automaticRequestToken.current += 1;
    automaticStartLock.current = null;
  }
  const automaticMatchesCurrent = Boolean(automaticCoordinateKey && automaticDataOwner === automaticCoordinateKey);
  const automaticRun = automaticMatchesCurrent ? automaticRunState : null;
  const automaticHistory = automaticMatchesCurrent ? automaticHistoryState : [];
  const automaticLoading = automaticMatchesCurrent && automaticLoadingState;
  const automaticStarting = automaticMatchesCurrent && automaticStartingState;
  const automaticError = automaticMatchesCurrent ? automaticErrorState : "";
  useEffect(() => {
    automaticMounted.current = true;
    return () => {
      automaticMounted.current = false;
      automaticRequestToken.current += 1;
      automaticStartLock.current = null;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let readTimer: number | undefined;
    const ownerKey = automaticCoordinateKey;
    const generation = automaticOwner.current.generation;
    const token = ++automaticRequestToken.current;
    const isCurrent = () => active && automaticMounted.current && automaticOwner.current.key === ownerKey && automaticOwner.current.generation === generation && automaticRequestToken.current === token;
    setAutomaticDataOwner(ownerKey);
    if (automaticDataOwner !== ownerKey) { setAutomaticRun(null); setAutomaticHistory([]); }
    setAutomaticError("");
    setAutomaticAdmissionBlocked(false);
    setAutomaticStarting(false);
    setAutomaticLoading(Boolean(automaticCoordinate));
    if (expectedReadOwner.current.key !== ownerKey) { setAutomaticExpected(false); expectedReadOwner.current = { key: ownerKey, since: Date.now() }; }
    if (!automaticCoordinate) return () => { active = false; };
    void liveEnterpriseRagEvaluationApi
      .latest(automaticCoordinate)
      .then(({ latest, history: serverHistory, automaticExpected, automaticAdmission }) => {
        if (!isCurrent()) return;
        const awaiting = !latest && automaticExpected === true;
        setAutomaticExpected(awaiting);
        setAutomaticAdmissionBlocked(automaticAdmission?.status === "blocked");
        if (awaiting && isCurrent()) {
          const interval = Date.now() - expectedReadOwner.current.since < 60000 ? 2000 : 5000;
          readTimer = window.setTimeout(() => setAutomaticReadVersion(value => value + 1), interval);
        }
        setAutomaticRun(latest);
        setAutomaticHistory(mergeAutomaticRuns(serverHistory));
        setAutomaticError(
          latest?.status === "failed"
            ? latest.error?.message ?? "自动评估失败，请重新发起评估。"
            : automaticAdmission?.status === "blocked" ? "评估暂未开始，请稍后重试读取。" : "",
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
        if (!isCurrent()) return;
        setAutomaticError(
          error instanceof Error ? error.message : "自动评估记录读取失败，请稍后重试。",
        );
      })
      .finally(() => {
        if (isCurrent()) setAutomaticLoading(false);
      });
    return () => { active = false; if (readTimer !== undefined) window.clearTimeout(readTimer); };
  }, [automaticCoordinateKey, automaticReadVersion]);
  useEffect(() => {
    if (
      !automaticRun ||
      terminalEvaluationStatuses.has(automaticRun.status) ||
      !automaticCoordinate
    ) return;
    let active = true;
    const ownerKey = automaticCoordinateKey;
    const generation = automaticOwner.current.generation;
    const token = automaticRequestToken.current;
    const isCurrent = () => active && automaticMounted.current && automaticOwner.current.key === ownerKey && automaticOwner.current.generation === generation && automaticRequestToken.current === token;
    let timeout: number | undefined;
    const poll = () => {
      timeout = window.setTimeout(() => {
        void liveEnterpriseRagEvaluationApi
          .observe(automaticRun.operationId)
          .then((next) => {
            if (!isCurrent()) return;
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
            if (terminalEvaluationStatuses.has(next.status)) setNotice("");
            if (!terminalEvaluationStatuses.has(next.status)) poll();
          })
          .catch((error: unknown) => {
            if (!isCurrent()) return;
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
    if (!live || !automaticReport || automaticOwner.current.key !== automaticCoordinateKey) return;
    const mirrorKey = JSON.stringify([historyStorageKey, automaticReport.reportId]);
    if (mirroredServerReportIds.current.has(mirrorKey)) return;
    mirroredServerReportIds.current.add(mirrorKey);
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
  }, [automaticReport?.reportId, live, storageScopeKey, historyStorageKey, automaticCoordinateKey]);
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
  const taskStatus = mode === "sample" && activeCase && conversation ? conversation.status : "unverified";
  const taskStatusLabel = mode === "sample" && activeCase && conversation ? conversation.displayLabel : "待确认";
  const taskHasRisk = taskStatus === "fail" && Boolean(activeCase?.gates.some((gate) => gate.status === "failed"));
  const attributionLabel = activeCase?.conversation.attribution ? RAG_ATTRIBUTIONS.find((item) => item.id === activeCase.conversation.attribution)?.label : null;
  const historicalKnowledge = Boolean(
    live && live.knowledgeBinding !== "current_publication",
  );
  const knowledgeVersion = activeCase ? KNOWLEDGE_VERSION : live
    ? live.knowledgeBase
      ? `v${live.knowledgeBase.version}`
      : historicalKnowledge
        ? "历史任务知识版本未知"
        : "尚未发布"
    : activeCase
      ? KNOWLEDGE_VERSION
      : "待绑定正式知识版本";
  const currentSources = activeCase ? activeCase.sources : live
    ? live.sources.map((source) => ({
        ...source,
        scope: source.kind === "published_knowledge" ? "企业资料" : "本轮附件",
        section: "服务端解析引用",
        version:
          source.kind === "user_attachment" ? "本轮附件" : knowledgeVersion,
        excerpt: "",
      }))
    : [];
  const canAsk = live?.canSend !== undefined ? live.canSend : live
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
  const exampleReadOnly = Boolean(live && activeCase);
  const displayRuleVersion = automaticReport?.evaluator.ruleVersion ?? (live ? RAG_CHECKLIST_RULE_VERSION : RAG_RULE_VERSION);
  const displayVerdicts = automaticReport && !automaticReport.result.answerVerdict ? legacyRagVerdictLabels : verdicts;
  const checklistJudgments = automaticReport && isChecklistRagJudgment(automaticReport.judgments) ? automaticReport.judgments : null;
  const radarDimensions = automaticReport?.result.dimensions ?? RAG_DIMENSIONS.map((definition) => {
    const judgment = displayDimensions.find((item) => item.id === definition.id);
    const earned = result.earnedByDimension[definition.id];
    return {
      id: definition.id,
      label: definition.label,
      score: earned,
      maxScore: definition.weight,
      status: judgment?.applicable === false
        ? "not_applicable" as const
        : earned === null
          ? "pending" as const
          : earned === definition.weight
            ? "passed" as const
            : "partial" as const,
      summary: judgment?.rationale || "尚无判断依据。",
      evidenceIds: judgment?.evidenceIds ?? [],
    };
  });
  const automaticBusy = Boolean(automaticStarting || (automaticMatchesCurrent && automaticExpectedState) || (automaticRun && !terminalEvaluationStatuses.has(automaticRun.status)));
  const evaluationNotRequired = Boolean(live?.evaluationNotRequired && !exampleReadOnly && !automaticReport);
  const hasQualityJudgment = Boolean(automaticReport || activeCase || dimensions.some(item => item.level !== null) || gates.some(item => item.status !== "pending"));
  const neutralEvaluation = !hasQualityJudgment;
  const awaitingEvaluation = !answer.trim() && !automaticReport;
  const evaluationFailed = !automaticStarting && Boolean(automaticRun?.status === "failed" || (automaticMatchesCurrent && automaticAdmissionBlocked));
  const evaluationWaiting = !hasQualityJudgment && !evaluationNotRequired && (automaticBusy || automaticLoading || (automaticCoordinate && !automaticMatchesCurrent));
  const tone = neutralEvaluation ? "neutral" : result.gateStatus === "failed" || result.verdict === "unusable" ? "danger" : result.verdict === "improve" ? "pending" : result.complete ? "ready" : "pending";
  const hasPerfectScore = result.complete && result.score === 100 && tone !== "danger";
  const displayVerdictLabel = !neutralEvaluation ? displayVerdicts[result.verdict].replace(/\s*·\s*/g, " · ") : evaluationNotRequired ? "无需评估" : evaluationFailed ? "评估未完成" : automaticError ? "暂时无法读取评分" : evaluationWaiting ? "正在评估本次回答" : awaitingEvaluation ? "待评估" : "暂无评估";
  const evaluationSummary = neutralEvaluation
    ? evaluationNotRequired ? "问候无需评分。" : evaluationFailed || automaticError ? "稍后可重试，当前回答已保留。" : evaluationWaiting ? "结果会自动更新，可继续对话。" : awaitingEvaluation ? "回答完成后开始评估。" : "当前回答没有评估记录。"
    : automaticReport
    ? presentRagSummary(automaticReport.result.summary)
    : result.gateStatus === "failed"
      ? "发现关键回答风险；高分不能把该回答判为可用，但不会取消网站发布选择。"
      : result.complete
        ? mode === "sample"
          ? activeCase?.summary
          : "结论基于人工判定，只提供质量建议，不是发布授权。"
        : "完成维度与关键风险核验后，才能形成回答可用性结论。";
  const { overviewRef, stacked: overviewStacked, summaryTwoLines } = useRagEvaluationLayout(
    `${evaluationSummary}\u0000${displayVerdictLabel}\u0000${result.gateStatus}\u0000${result.coverage}`,
  );
  const { ref: verdictRevealRef, progress: verdictRevealProgress } = useDataReveal<HTMLElement>(
    true,
    JSON.stringify([automaticReport?.reportId, question, answer, evaluationSummary, displayVerdictLabel, result.score, result.gateStatus, result.coverage]),
    800,
    "linear",
    entranceReady("quality"),
  );
  const verdictTitleText = textGraphemes(displayVerdictLabel);
  const verdictSummaryText = textGraphemes(evaluationSummary ?? "");
  const verdictRiskText = textGraphemes(`关键风险${result.gateStatus === "passed" ? "已核验" : result.gateStatus === "failed" ? "已发现" : "待核验"}`);
  const verdictCoverageText = textGraphemes(`评审覆盖 ${format(result.coverage)}%`);
  const verdictMetricCount = verdictRiskText.length + verdictCoverageText.length;

  const startAutomaticEvaluation = async () => {
    if (!automaticCoordinate || !live?.answer || automaticRun?.status !== "failed" || automaticStarting || automaticLoading || automaticStartLock.current) return;
    const ownerKey = automaticCoordinateKey;
    const generation = automaticOwner.current.generation;
    const token = ++automaticRequestToken.current;
    automaticStartLock.current = { ownerKey, generation, token };
    const isCurrent = () => automaticMounted.current && automaticOwner.current.key === ownerKey && automaticOwner.current.generation === generation && automaticRequestToken.current === token;
    setAutomaticDataOwner(ownerKey);
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
      if (!isCurrent()) return;
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
        terminalEvaluationStatuses.has(next.status) ? "" : AUTOMATIC_SUBMITTED_NOTICE,
      );
      if (next.status === "failed") {
        setAutomaticError(
          next.error?.message ?? "自动评估失败，请重新发起评估。",
        );
      }
    } catch (error) {
      if (!isCurrent()) return;
      setAutomaticError(
        error instanceof Error ? error.message : "自动评估提交失败，请稍后重试。",
      );
    } finally {
      if (isCurrent()) {
        automaticStartLock.current = null;
        setAutomaticStarting(false);
      }
    }
  };

  const selectCase = (item: RagCase) => {
    cancelPreview();
    setPreviewAnswerIdentity(`sample:${item.id}`);
    setPreviewCompletedAt(Date.now());
    setActiveCase(item); setQuestion(item.question); setAnswer(item.answer); setNeed(item.need);
    setDimensions(clone(item.dimensions)); setGates(clone(item.gates)); setMode("sample");
    setNotice("");
  };
  const enqueuePreview = async (text: string) => {
    if (!text.trim()) return false;
    setPreviewQueues(old => ({ ...old, [previewQueueKey]: { paused: old[previewQueueKey]?.paused ?? false, items: [...(old[previewQueueKey]?.items ?? []), { id: crypto.randomUUID(), text: text.trim(), status: "queued" }] } }));
    return true;
  };
  const submitQuestion = async (queuedQuestion?: string) => {
    if (!(queuedQuestion ?? input).trim() || previewBusy) return;
    const submitted = (queuedQuestion ?? input).trim();
    if (live) {
      if (!canAsk || exampleReadOnly) return;
      const owner = { scope: storageScopeKey, conversation: live.conversationId };
      const revision = ++inputRevision.current;
      const isOwner = () => liveInputOwner.current.scope === owner.scope && (liveInputOwner.current.conversation === owner.conversation || (Boolean(owner.conversation) && liveInputOwner.current.adoptedFrom === owner.conversation));
      setInput("");
      if (owner.conversation) liveDrafts.current.set(owner.conversation, "");
      setActiveCase(null); setQuestion(submitted); setAnswer(""); setNeed(`准确回答访客问题：${submitted}`); setMode("manual");
      setDimensions(emptyDimensions()); setGates(emptyGates());
      setNotice("");
      let accepted = false;
      try { accepted = await live.onAsk(submitted); } catch { /* Retain only the submitted owner's untouched draft. */ }
      if (!accepted) {
        if (isOwner()) {
          if (inputRevision.current === revision) setInput(current => current === "" ? submitted : current);
          setNotice("问题未成功提交，内容已保留，请重试。");
        } else if (liveInputOwner.current.scope === owner.scope && owner.conversation && !liveDrafts.current.get(owner.conversation)) {
          liveDrafts.current.set(owner.conversation, submitted);
        }
      }
      return;
    }
    const match = findRagSample(submitted);
    if (question.trim() && answer.trim()) setPreviewPreviousTurns(old => [...old, { id: crypto.randomUUID(), question, answer }]);
    cancelPreview();
    setPreviewAnswerIdentity(`authored:${crypto.randomUUID()}`);
    if (queuedQuestion === undefined) setInput("");
    setActiveCase(null); setQuestion(submitted); setAnswer(""); setNeed(""); setMode("manual");
    setDimensions(emptyDimensions()); setGates(emptyGates());
    if (match) {
      const operation = previewOperation.current;
      setPreviewBusy(true);
      setPreviewActivity([{ id: "preview-read", label: "读取文件", status: "running" }]);
      previewStages.current = [setTimeout(() => setPreviewActivity([
        { id: "preview-read", label: "读取文件", status: "completed" },
        { id: "preview-search", label: "检索文本", status: "running" },
      ]), 250), setTimeout(() => setPreviewActivity([
        { id: "preview-read", label: "读取文件", status: "completed" },
        { id: "preview-search", label: "检索文本", status: "completed" },
        { id: "preview-response", label: "整理回答", status: "running" },
      ]), 550)];
      setNotice("");
      await new Promise<void>(resolve => {
        previewDelay.current = { timer: setTimeout(resolve, 900), resolve };
      });
      if (operation !== previewOperation.current) return;
      previewDelay.current = null;
      selectCase(match);
      setQuestion(submitted);
      setPreviewAnswerRevision(value => value + 1);
    } else {
      setNotice("此问题不在示例库。请录入实际回答后人工评审；当前预览未连接真实问答服务。");
    }
  };
  useEffect(() => {
    if (live || previewBusy || previewQueue.paused || previewQueue.items[0]?.status !== "queued") return;
    const next = previewQueue.items[0];
    const owner = previewQueueKey;
    setPreviewQueues(old => ({ ...old, [owner]: { ...old[owner], items: old[owner].items.map(item => item.id === next.id ? { ...item, status: "dispatching" } : item) } }));
    void submitQuestion(next.text).then(() => setPreviewQueues(old => ({ ...old, [owner]: { ...old[owner], items: old[owner].items.filter(item => item.id !== next.id) } })));
  }, [live, previewBusy, previewQueueKey, previewQueue.paused, previewQueue.items[0]?.id, previewQueue.items[0]?.status]);
  const ensureReviewDraft = () => {
    if (exampleReadOnly) return true;
    if (!answer.trim() || !need.trim() || currentAnswerContext.current !== answerContextKey || (live && !exampleReadOnly && (question !== live.question || answer !== live.answer))) return false;
    if (reviewDraftSnapshot?.ownerKey === answerContextKey && reviewDrafts.current.has(answerContextKey)) return true;
    const draft = reviewDrafts.current.get(answerContextKey) ?? {
      ownerKey: answerContextKey,
      scopeKey: historyStorageKey,
      question, answer, need,
      knowledgeVersion: live ? knowledgeVersion : activeCase ? KNOWLEDGE_VERSION : "人工录入-待绑定正式知识版本",
      evidenceOptions: buildReviewEvidenceOptions({
        answer,
        answerId: live?.answerId ?? automaticReport?.answerMessageId,
        claims: automaticReport?.judgments.claims ?? activeCase?.claims.map(item => ({ id: item.id, statement: item.text })),
        sources: live?.sources ?? activeCase?.sources,
        selectedValues: displayDimensions.flatMap(item => item.evidenceIds),
      }),
      dimensions: clone(displayDimensions), gates: clone(displayGates), reviewer: "", confirmed: false,
    };
    reviewDrafts.current.set(answerContextKey, draft);
    setReviewDraftSnapshot({ ownerKey: draft.ownerKey, scopeKey: draft.scopeKey, question: draft.question, answer: draft.answer, need: draft.need, knowledgeVersion: draft.knowledgeVersion, evidenceOptions: draft.evidenceOptions });
    setReviewDimensions(clone(draft.dimensions)); setReviewGates(clone(draft.gates));
    setReviewer(draft.reviewer); setConfirmed(draft.confirmed);
    return true;
  };
  const openAnswer = () => {
    if (live) return;
    if (visibleAnswerPanels.includes("answer")) { openAnswerPanel("answer", true); return; }
    setQuestionEdit(question); setAnswerEdit(answer); setNeedEdit(need); openAnswerPanel("answer", true);
  };
  const startNewConversation = () => {
    if (live) {
      setActiveCase(null); syncedLiveAnswer.current = "";
      live.onStartNewConversation();
      return;
    }
    if (previewBusy) return;
    previewHistory.save(previewSnapshot());
    previewHistory.create();
    restorePreview(null);
    questionInputRef.current?.focus();
  };
  const selectPreviewConversation = (id: string) => {
    if (previewBusy) return false;
    previewHistory.save(previewSnapshot());
    const snapshot = previewHistory.select(id);
    if (!snapshot) return false;
    restorePreview(snapshot);
    return true;
  };
  const deletePreviewConversation = (id: string) => {
    if (previewBusy) return false;
    const result = previewHistory.remove(id);
    if (result.wasActive) restorePreview(result.next);
    return true;
  };
  const updateAnswer = (value: string, task: string, editedQuestion: string) => {
    cancelPreview();
    setPreviewAnswerIdentity(`authored:${crypto.randomUUID()}`);
    setPreviewCompletedAt(Date.now());
    setQuestion(editedQuestion.trim()); setAnswer(value.trim()); setNeed(task.trim()); setActiveCase(null); setMode("manual");
    setDimensions(emptyDimensions()); setGates(emptyGates()); close("answer");
    setNotice("回答或用户任务已更新，旧评分已失效，请重新核验。历史记录保留原快照。");
  };
  const saveReview = () => {
    const snapshot = reviewDraftContext;
    if (exampleReadOnly) return;
    if (!snapshot || snapshot.ownerKey !== currentAnswerContext.current || snapshot.scopeKey !== reviewDraftScope.current || !snapshot.answer.trim() || !snapshot.need.trim() || !reviewer.trim() || !confirmed || (live && !exampleReadOnly && (question !== live.question || answer !== live.answer))) return;
    const record: RecordEntry = { ...(live ? { subjectKey: JSON.stringify([historyStorageKey, live.selectedAnswerKey ?? liveAnswerKey]) } : {}), id: `review-${crypto.randomUUID()}`, question: snapshot.question, answer: snapshot.answer, need: snapshot.need, reviewer: reviewer.trim(), time: new Date().toISOString(), ruleVersion: RAG_RULE_VERSION, knowledgeVersion: snapshot.knowledgeVersion, dimensions: clone(reviewDimensions), gates: clone(reviewGates) };
    const skillResult = enterpriseRagEvaluationSkill.evaluate({ dimensions: record.dimensions, gates: record.gates });
    const reportSaved = saveEvaluationReport({
      reportId: `report-${record.id}`,
      createdAt: record.time,
      subject: { kind: "rag-answer", id: record.id, version: record.ruleVersion },
      result: skillResult,
    }, scopedEvaluationStorage(storageScopeKey));
    setDimensions(record.dimensions); setGates(record.gates); setMode("manual");
    const next = [record, ...history].slice(0, 30); setHistory(next);
    try { localStorage.setItem(historyStorageKey, JSON.stringify(next)); setNotice(reportSaved ? "" : "人工评审已保存，但评估快照存储不可用。"); }
    catch { setNotice("人工评审已计算，但浏览器存储不可用，本次记录仅在当前页面保留。"); }
    reviewDrafts.current.delete(snapshot.ownerKey);
    setReviewDraftSnapshot(null);
    setReviewer(""); setConfirmed(false);
    close("review");
  };
  const drawerTitle = { review: "人工评审与计算", evidence: "回答依据与陈述核验", rules: "评分规则", improve: "优化方案", answer: "录入待评估回答", history: "评估记录" };
  const serverHistory = mergeAutomaticRuns([
    ...(automaticRun ? [automaticRun] : []),
    ...automaticHistory,
  ]);
  const recordedEvaluationCount = history.length + serverHistory.length;
  const [answerPanelState, setAnswerPanelState] = useState<{ owner: string; panels: AnswerPanel[]; active: AnswerPanel | null }>({ owner: "", panels: [], active: null });
  const visibleAnswerPanels = answerPanelState.owner === answerContextKey ? answerPanelState.panels : [];
  const visibleActivePanel = answerPanelState.owner === answerContextKey ? answerPanelState.active : null;
  useEffect(() => {
    setAnswerPanelState({ owner: answerContextKey, panels: [], active: null });
  }, [answerContextKey]);
  const openAnswerPanel = (panel: AnswerPanel, focus = false) => {
    if (panel === "review" && !ensureReviewDraft()) return;
    setAnswerPanelState(previous => {
      const panels = previous.owner === answerContextKey ? previous.panels : [];
      if (previous.owner === answerContextKey && previous.active === panel && panels.includes(panel)) return previous;
      return { owner: answerContextKey, panels: panels.includes(panel) ? panels : [...panels, panel], active: panel };
    });
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-answer-panel="${panel}"]`)?.focus());
  };
  useEffect(() => {
    if (pendingEvidenceSelection.current && pendingEvidenceSelection.current === live?.selectedAnswerKey && question === live.question && answer === live.answer) {
      pendingEvidenceSelection.current = null; openAnswerPanel("evidence", true);
    }
  }, [live?.selectedAnswerKey, answerContextKey]);
  const closeAnswerPanel = (panel: AnswerPanel) => {
    setAnswerPanelState(previous => {
      const panels = previous.panels.filter(item => item !== panel);
      return { ...previous, panels, active: previous.active === panel ? panels.at(-1) ?? null : previous.active };
    });
  };
  const renderDrawerBody = (panel: NonNullable<Drawer>) => <>
      {panel === "review" && exampleReadOnly && <>
        <section className="rag-drawer-section rag-review-topic rag-review-dimensions" aria-label="六维人工判断">
          <div className="rag-review-topic__heading"><ChartNoAxesColumnIncreasing size={18} aria-hidden="true" /><h3>六维人工评分</h3></div>
          {displayDimensions.map(item => <RagEvaluationDisclosure key={item.id} label={RAG_DIMENSIONS.find(d => d.id === item.id)?.label ?? item.id}><p>{item.level == null ? "待判断" : `${item.level} / 4`} · {item.rationale}</p></RagEvaluationDisclosure>)}
        </section>
        <section className="rag-drawer-section rag-review-topic rag-review-topic--risks">
          <div className="rag-review-topic__heading"><ShieldCheck size={18} aria-hidden="true" /><h3>关键回答风险</h3></div>
          <div className="rag-review-risks">{displayGates.map(item => <RagEvaluationDisclosure key={item.id} label={RAG_GATES.find(g => g.id === item.id)?.label ?? item.id}><p>{item.reason}</p></RagEvaluationDisclosure>)}</div>
        </section>
      </>}
      {panel === "review" && !exampleReadOnly && reviewDraftContext && <>
        <p className="rag-muted rag-review-overview">对照当前回答与来源，逐项填写评分、理由和风险核验依据。人工评审仅作辅助记录，不会覆盖服务端自动评估或网站建设评估；缺少依据的项目不计通过。</p>
        <section className="rag-drawer-section rag-review-topic rag-review-dimensions" aria-label="六维人工判断">
          <div className="rag-review-topic__heading"><ChartNoAxesColumnIncreasing size={18} aria-hidden="true" /><h3>六维人工评分</h3></div>
          {RAG_DIMENSIONS.map((item, index) => {
            const judgment = reviewDimensions[index];
            return <RagEvaluationDisclosure label={shortLabels[index]} key={item.id}>
              <fieldset className="rag-review-field" aria-label={`${shortLabels[index]}评分`}>
                <p className="rag-review-dimension-weight">满分 {item.weight} 分</p>
                <p>{item.question}</p>
                <RagReviewSelect label={`${shortLabels[index]}等级`} fieldLabel="判断等级" value={judgment?.level == null ? "" : String(judgment.level)} options={[{ value: "", label: "待判定" }, ...levels.map((label, level) => ({ value: String(level), label: `${level} · ${label}` }))]} onValueChange={value => setReviewDimensions(old => old.map(d => d.id === item.id ? { ...d, level: value === "" ? null : Number(value) as Rating } : d))} />
                <label>判断理由<textarea rows={3} aria-label={`${shortLabels[index]}理由`} value={judgment?.rationale ?? ""} onChange={(event) => setReviewDimensions((old) => old.map((d) => d.id === item.id ? { ...d, rationale: event.target.value } : d))} /></label>
                <RagReviewEvidencePicker label={`${shortLabels[index]}证据`} values={judgment?.evidenceIds ?? []} options={reviewDraftContext.evidenceOptions} onValuesChange={evidenceIds => setReviewDimensions(old => old.map(d => d.id === item.id ? { ...d, evidenceIds } : d))} />
              </fieldset>
            </RagEvaluationDisclosure>;
          })}
        </section>
        <section className="rag-drawer-section rag-review-topic rag-review-topic--risks">
          <div className="rag-review-topic__heading"><ShieldCheck size={18} aria-hidden="true" /><h3>关键回答风险</h3></div>
          <div className="rag-review-risks" role="group" aria-label="关键回答风险核验">
          {RAG_GATES.map((item, index) => <RagEvaluationDisclosure label={item.label} key={item.id}>
            <fieldset className="rag-review-field rag-gate-field" aria-label={`${item.label}风险核验内容`}>
              <p>{item.description}</p>
              <RagReviewSelect label={`${item.label}风险核验`} fieldLabel="核验结果" value={reviewGates[index]?.status ?? "pending"} options={[{ value: "passed", label: "通过" }, { value: "pending", label: "待核验" }, { value: "failed", label: "发现风险" }]} onValueChange={status => setReviewGates(old => old.map(g => g.id === item.id ? { ...g, status: status as GateJudgment["status"] } : g))} />
              <label>核验依据<textarea rows={3} aria-label={`${item.label}风险核验依据`} value={reviewGates[index]?.reason ?? ""} onChange={(event) => setReviewGates((old) => old.map((g) => g.id === item.id ? { ...g, reason: event.target.value } : g))} /></label>
            </fieldset>
          </RagEvaluationDisclosure>)}
          </div>
        </section>
        <section className="rag-drawer-section rag-review-confirmation" aria-label="确认人工评审">
          <label className="rag-reviewer">评审人<input aria-label="评审人" value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="姓名或评审代号" /></label>
          <label className="rag-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>已对照当前回答与证据进行核验，不将预设评审当作自动评估结果。</span></label>
          <p className="rag-muted">记录仅保存在当前浏览器，最多保留 30 条。请勿粘贴敏感业务资料。</p>
        </section>
      </>}
      {panel === "answer" && <><label className="rag-editor-label">问题<textarea aria-label="问题" value={questionEdit} onChange={(event) => setQuestionEdit(event.target.value)} placeholder="输入访客的问题" /></label><label className="rag-editor-label">用户任务<textarea aria-label="用户任务" value={needEdit} onChange={(event) => setNeedEdit(event.target.value)} placeholder="访客希望解决什么、做出什么决定？" /></label><label className="rag-editor-label">实际回答<textarea className="rag-answer-editor" aria-label="实际回答" value={answerEdit} onChange={(event) => setAnswerEdit(event.target.value)} placeholder="粘贴待评估的回答，包括引用定位。此处不会调用模型。" /></label><p className="rag-muted">保存后清空当前评审。人工证据通过评审表逐项记录，不会自动继承示例来源。</p></>}
      {panel === "evidence" && <>
        <div className="rag-evidence-topics">
        <section className="rag-drawer-section rag-evidence-topic">
          <h3>陈述与证据</h3>
          {automaticReport ? automaticReport.judgments.claims.length ? <div className="rag-evidence-records">{automaticReport.judgments.claims.map((claim) => <article className="rag-evidence rag-evidence--claim" key={claim.id}>
            <header><strong>{claim.id}</strong><RagEvidenceTag label={claimStatusLabels[claim.status] ?? claim.status} tone={claimStatusTones[claim.status] ?? "neutral"} testId="rag-evidence-claim-status" /></header>
            <p>{claim.statement}</p><small>{claim.rationale} · 来源：{claim.sourceIds.join("、") || "没有来源"}</small>
          </article>)}</div> : <p className="rag-muted">本次报告没有陈述级核验记录。</p> : activeCase?.claims.length ? <div className="rag-evidence-records">{activeCase.claims.map((claim) => <article className="rag-evidence rag-evidence--claim" key={claim.id}>
            <header><strong>{claim.id}</strong><RagEvidenceTag label={claimStatusLabels[claim.status] ?? claim.status} tone={claimStatusTones[claim.status] ?? "neutral"} testId="rag-evidence-claim-status" /></header>
            <p>{claim.text}</p><small>{claim.note} · {claim.sourceIds.join("、") || "没有来源"}</small>
          </article>)}</div> : <p className="rag-muted">{live ? "此回答尚无陈述级评估记录。" : "当前为人工录入回答。请在评审表中逐维记录可核验的原文与来源定位。"}</p>}
        </section>
        <section className="rag-drawer-section rag-evidence-topic">
          <h3>{live ? "参考资料" : "来源原文"}</h3>
          {currentSources.length ? <div className="rag-evidence-records">{currentSources.map((source) => <article data-testid={live ? "rag-source" : undefined} className="rag-evidence rag-evidence--source" key={`${"kind" in source ? source.kind : "source"}:${source.id}`}>
            <header><strong>{source.title}</strong><RagEvidenceTag label={source.scope} tone="info" testId="rag-evidence-source-scope" /></header>
            <small>{source.id} · {source.section} · {source.version}</small>
            {source.excerpt ? <blockquote>{source.excerpt}</blockquote> : <p className="rag-muted">当前接口只公开服务端解析后的资料标识与标题，不展示或伪造原文摘录。</p>}
          </article>)}</div> : <p className="rag-muted">当前回答没有返回参考资料。</p>}
        </section>
        <section className="rag-drawer-section rag-evidence-topic">
          <h3>{automaticReport ? "自动评估六维判断" : "本次判断记录"}</h3>
          <div data-testid="rag-evidence-radar"><RagEvaluationRadar emptyQuestion={neutralEvaluation} key={`${automaticReport?.reportId ?? `${question}:${answer}`}:evidence`} judgments={checklistJudgments} dimensions={radarDimensions} /></div>
        </section>
        <section className="rag-drawer-section rag-evidence-topic">
          <h3>关键风险核验</h3>
          <div className="rag-gate-grid" data-testid="rag-evaluation-gate-grid">
            {displayGates.map((gate) => {
              const automaticGate = automaticReport?.judgments.gates.find((item) => item.id === gate.id);
              const gateLabel = RAG_GATES.find((item) => item.id === gate.id)?.label ?? gate.id;
              return <article data-testid="rag-evaluation-gate" className="rag-evidence rag-gate-card" key={gate.id}>
                <header><strong>{gateLabel}</strong><RagGateStatusOrb label={gateLabel} status={gate.status} /></header>
                <p>{gate.reason || "尚无核验记录"}</p>{automaticGate && <small>证据：{automaticGate.evidenceIds.join("、")}</small>}
              </article>;
            })}
          </div>
        </section>
        {automaticReport && <section className="rag-drawer-section rag-evidence-topic">
          <h3>不可变报告溯源</h3>
          <dl data-testid="rag-auto-evaluation-report" className="rag-evidence rag-provenance">
            <div><dt>报告 ID</dt><dd>{automaticReport.reportId}</dd></div>
            <div><dt>源问答任务 / 轮次</dt><dd>{automaticReport.sourceQaTaskId} / {automaticReport.sourceTurnId}</dd></div>
            <div><dt>问题 / 回答消息</dt><dd>{automaticReport.questionMessageId} / {automaticReport.answerMessageId}</dd></div>
            <div><dt>冻结知识</dt><dd>v{automaticReport.knowledgeBase.version} · {automaticReport.knowledgeBase.snapshotId} · {automaticReport.knowledgeBase.contentHash}</dd></div>
            <div><dt>输入 / Skill 哈希</dt><dd>{automaticReport.judgments.inputHash} / {automaticReport.evaluator.skillHash}</dd></div>
            <div><dt>完成时间</dt><dd>{new Date(automaticReport.completedAt).toLocaleString("zh-CN")}</dd></div>
          </dl>
        </section>}
        </div>
        <p className="rag-muted rag-evidence-scope-note">{automaticReport ? "自动结论绑定本次回答、服务端冻结知识、规则与模型版本；网站建设评估仍是独立流程。" : live ? "参考资料表示本次回答实际使用的材料；人工复核不会替代服务端自动评估。" : "预设评审只针对这些合成文本与快照；不证明真实服务已抵御注入、越权或其他攻击。"}</p>
      </>}
      {panel === "rules" && <><h3>六维 100 分</h3><p className="rag-formula">{displayRuleVersion === RAG_CHECKLIST_RULE_VERSION ? "总分由冻结检查项汇总；满足100%／部分满足50%／不满足0%" : "总分 = Σ（维度权重 × 等级 ÷ 4）"}</p>{RAG_DIMENSIONS.map((item) => <article className="rag-evidence" key={item.id}><header><strong>{item.label}</strong><b>{item.weight} 分</b></header><p>{item.question}</p></article>)}<h3>等级与结论</h3><p>{displayRuleVersion === RAG_CHECKLIST_RULE_VERSION ? "各类任务预先固定检查项、分值和适用性；同一缺陷只在主检查项扣分，可选建议不扣分。允许满分和同分，不人为制造差距。证据不足单列待核验。" : "0 不满足 · 1 少量满足 · 2 部分满足 · 3 基本满足 · 4 充分满足。等级必须附判断理由和证据定位。"}</p><p>{["rag-eval-1.3", RAG_CHECKLIST_RULE_VERSION].includes(displayRuleVersion) ? "分数仅作诊断，不设单独否决阈值。核心任务完成且证据完整、无重大风险时可用；有非关键问题时显示可用·待改进。重大风险或核心任务明确失败显示不可用·需修复，必要证据不足显示待核验。" : "历史规则：原始分 ≥90 优秀；≥80 可用；≥70 需要改进；低于 70 不可用。历史结论仍按原冻结规则解释。"}</p>{["rag-eval-1.3", RAG_CHECKLIST_RULE_VERSION].includes(displayRuleVersion) ? <><h3>重大风险与改进项</h3><p>核实建议不等于事实承诺，但其中的电话、操作和企业承诺仍须核验。只按当前任务判断必要信息，不要求无关扩展；来源缺失保留未知。评审覆盖率不代表回答正确率。</p></> : <p>当前展示历史规则与历史结论；新规则不会追溯改判此报告。</p>}<h3>关键风险优先于回答分数</h3><p>任一关键风险成立，该回答直接判为不可用；有风险待核验，不判为可用。此结论是质量建议，不阻止用户进入网站发布确认。</p>{RAG_GATES.map((item) => <article className="rag-evidence" key={item.id}><strong>{item.label}</strong><p>{item.description}</p></article>)}<h3>缺证据不计作通过</h3><p>未判定维度不删除、不补成满分。页面显示已核验权重覆盖率及数学上的可能得分范围；范围不是统计置信区间。不适用项须在正式测试计划中预先批准，当前页面不提供临时剔除。</p><h3>分数的使用边界</h3><p>单次回答分、企业 RAG 系统分与网站建设评估彼此独立。合成示例、单人自评和少量测试都不能替代正式代表集验收或独立复核。任务未完成或关键回答风险成立时，高分不改变该回答的质量结论；但评估结果不拥有网站发布权限。</p><h3>验收参数 · 初始默认值</h3><p>以下参数用于回答质量验收；调整时应记录原值与原因。</p>{RAG_ACCEPTANCE_PARAMS.map((item) => <article className="rag-evidence" key={item.label}><header><strong>{item.label}</strong></header><p>{item.value}</p></article>)}</>}
      {panel === "improve" && <RagImprovementPlan
        plan={buildRagImprovementPlan({
          sample: mode === "sample" ? activeCase : null,
          report: automaticReport,
          issues,
          complete: result.complete,
        })}
        readOnly={exampleReadOnly}
        onAdopt={value => updateAnswer(value, need, question)}
      />}
      {panel === "history" && <>
        {live && <><h3>服务端自动评估记录</h3><p className="rag-muted">以下记录来自服务端，绑定问答任务、轮次、冻结知识、规则与模型版本。完成后的报告不可被人工复核覆盖。</p>{serverHistory.length === 0 ? <p>{automaticLoading ? "正在读取已有自动评估…" : "当前回答暂无自动评估记录。页面加载不会自动发起付费评估。"}</p> : serverHistory.map((run, index) => { const score = presentEvaluationScore(run.report?.result.score, Boolean(run.report && reportVerdict(run.report) === "unusable")); return <article className="rag-evidence" key={run.operationId}><header><strong>{index === 0 ? "最新自动评估" : "历史自动评估"}</strong><span className={`rag-history-score${score.showScale ? "" : " is-unavailable"}`} aria-label={score.ariaLabel}>{score.text}</span></header><p>{automaticStatusLabels[run.status]}{run.report ? ` · ${presentRagSummary(run.report.result.summary)}` : run.error ? ` · ${run.error.message}` : ""}</p><small>操作 {run.operationId} · {new Date(run.createdAt).toLocaleString("zh-CN")}</small>{run.report && <details><summary>查看不可变报告信息</summary><p>报告：{run.report.reportId}</p><p>问答任务 / 轮次：{run.report.sourceQaTaskId} / {run.report.sourceTurnId}</p><p>知识快照：{run.report.knowledgeBase.snapshotId} · v{run.report.knowledgeBase.version}</p><p>评估依据已记录</p><p>六维 {run.report.judgments.dimensions.length} 项 · 风险门 {run.report.judgments.gates.length} 项 · 陈述 {run.report.judgments.claims.length} 项</p></details>}</article>; })}</>}
        <h3>{live ? "人工复核记录（辅助）" : "人工评审记录"}</h3>
        <p className="rag-muted">本地快照绑定问题、回答、知识版本和规则版本；修改回答不会覆盖旧记录。当前浏览器保存 {history.length}/30 条。{live ? "人工复核不改变服务端自动报告。" : ""}</p>
        {history.length === 0 ? <p>暂无已保存的人工评审。完成评审后在这里查看。</p> : history.map((record) => { const grade = record.ruleVersion === "rag-eval-1.2" ? scoreLegacyEvaluation(record) : record.ruleVersion === RAG_RULE_VERSION ? scoreEvaluation(record) : null; const sameAnswer = record.question === question && record.answer === answer && record.need === need; const score = presentEvaluationScore(grade?.score, grade?.verdict === "unusable"); return <article className="rag-evidence" key={record.id}><header><strong>{record.question}</strong><span className={`rag-history-score${score.showScale ? "" : " is-unavailable"}`} aria-label={score.ariaLabel}>{score.text}</span></header><p>{grade ? (record.ruleVersion === "rag-eval-1.2" ? legacyRagVerdictLabels : verdicts)[grade.verdict] : "历史规则暂不支持重新计算"} · {sameAnswer ? "与当前回答相同" : "历史快照，不适用于当前回答"}</p><small>{record.reviewer} · {new Date(record.time).toLocaleString("zh-CN")} · {record.knowledgeVersion}</small><details><summary>查看回答与判断</summary><p>{record.answer}</p>{record.dimensions.map((item) => <p key={item.id}>{RAG_DIMENSIONS.find((d) => d.id === item.id)?.label}：{item.level ?? "待判定"}/4 · {item.rationale}</p>)}</details></article>; })}
      </>}
  </>;
  const renderDrawerFooter = (panel: NonNullable<Drawer>) => panel === "evidence" || panel === "improve" ? null : panel === "review" ? exampleReadOnly ? null : <button className="sfp-button sfp-button--primary" disabled={!reviewDraftContext || !answer.trim() || !need.trim() || !reviewer.trim() || !confirmed} onClick={saveReview}>保存评审并计算</button> : panel === "answer" ? <button className="sfp-button sfp-button--primary" disabled={!questionEdit.trim() || !answerEdit.trim() || !needEdit.trim()} onClick={() => updateAnswer(answerEdit, needEdit, questionEdit)}>保存回答，重新评审</button> : <button className="sfp-button sfp-button--ghost" onClick={() => close()}>完成</button>;

  return <section className="sfp-root erag-root rag-eval-root" data-testid={live ? "enterprise-rag-live-root" : undefined}>
    <div ref={backgroundRef}>
      <header className="sfp-heading erag-heading" data-rag-entrance="heading"><div><h1>让回答真正满足用户需求</h1><p>用企业资料回答客户问题，核对回答依据，找到改进方向。</p></div><div className="rag-toolbar">{buildReportUrl ? <><a className="rag-report-link" href={buildReportUrl("rules", automaticCoordinate ?? undefined, exampleReadOnly ? activeCase?.id : undefined)} target="_blank" rel="noopener" aria-label="评分规则（在新标签页打开）">评分规则</a><a className="rag-report-link" href={buildReportUrl("records", automaticCoordinate ?? undefined, exampleReadOnly ? activeCase?.id : undefined)} target="_blank" rel="noopener" aria-label="评估记录（在新标签页打开）">评估记录 {recordedEvaluationCount > 0 ? `(${recordedEvaluationCount})` : ""}</a></> : <><button onClick={() => setDrawer("rules")}>评分规则</button><button onClick={() => setDrawer("history")}>评估记录 {recordedEvaluationCount > 0 ? `(${recordedEvaluationCount})` : ""}</button></>}</div></header>
      <div className="erag-layout">
        <div className="erag-left-column">
          <section className="sfp-panel erag-knowledge-card" data-rag-entrance="knowledge" data-rag-entrance-immediate={hasNewerPublication || undefined}><div className="erag-card-heading"><div><span className="erag-card-icon"><FileText size={18} /></span><strong>RAG 知识底座</strong></div></div>
            <div className="erag-stats"><div><strong>{live && !exampleReadOnly ? live.knowledgeBase ? 1 : 0 : previewKnowledgeCollectionCount}</strong><small>{live && !exampleReadOnly ? historicalKnowledge ? "任务冻结快照" : "发布快照" : "知识集合"}</small></div><div><strong>{live && !exampleReadOnly ? live.knowledgeBase?.documentCount ?? 0 : previewKnowledgeFragmentCount}</strong><small>{live && !exampleReadOnly ? "知识文档" : "示例知识片段"}</small></div><div><strong>{currentSources.length}</strong><small>当前来源</small></div></div>
            <div className="rag-knowledge-row"><span>{(!exampleReadOnly && live?.knowledgeBase?.sourceFileName) || <>知识版本：{knowledgeVersion}</>}</span><button type="button" className="rag-knowledge-link" onClick={() => openAnswerPanel("evidence", true)}>查看知识与依据</button></div>
          </section>
          <section className="sfp-panel erag-test-card" data-rag-entrance="chat" data-rag-entrance-immediate={Boolean(live?.busy) || undefined}><div className="erag-card-heading"><div><span className="erag-card-icon"><Bot size={18} /></span><strong>回答示例试用</strong></div><RagConversationHistory
              key={`${live ? "live" : "preview"}:${historyStorageKey}`}
              scopeKey={`${live ? "live" : "preview"}:${historyStorageKey}`}
              items={live ? live.conversationHistory?.items ?? [] : previewHistory.conversations.map(item => ({ id: item.id, title: item.previousTurns[0]?.question || item.question || item.input || "新问答", subtitle: item.caseId ? "合成示例" : undefined }))}
              activeId={live ? activeCase ? null : live.conversationHistory?.activeId : previewHistory.activeId}
              examples={live ? RAG_SAMPLE_CASES.map(item => ({ id: item.id, title: item.title })) : []}
              activeExampleId={exampleReadOnly ? activeCase?.id : undefined}
              onSelectExample={id => { const item = RAG_SAMPLE_CASES.find(item => item.id === id); if (!item) return false; selectCase(item); return true; }}
              onNew={startNewConversation}
              onSelect={live ? id => { setActiveCase(null); syncedLiveAnswer.current = ""; return live.conversationHistory?.onSelect(id) ?? false; } : selectPreviewConversation}
              onDelete={live ? live.conversationHistory?.onDelete ?? (() => false) : deletePreviewConversation}
              onOpen={live?.conversationHistory?.onOpen}
              busy={live ? Boolean(live.conversationHistory?.busy) : previewBusy}
              newDisabled={live ? Boolean(live.conversationHistory?.deletingId) : previewBusy}
              loading={live?.conversationHistory?.loading}
              error={live?.conversationHistory?.error}
              deletingId={live?.conversationHistory?.deletingId}
              historyDisabled={Boolean(live && !live.conversationHistory)}
            /></div>
            {!live && !previewHistory.storageAvailable && <p className="rag-chat-error" role="status">本地对话暂时无法保存，当前页面内仍可查看。</p>}
            <RagChat
              onEditAnswer={live ? undefined : openAnswer}
              previousTurns={exampleReadOnly ? [] : live ? live.previousTurns : previewPreviousTurns}
              scopeKey={live ? `${storageScopeKey ?? "live"}:${live.conversationId ?? "new"}:${live.taskId ?? "new"}` : `${storageScopeKey ?? "preview"}:${previewHistory.activeId}`}
              live={Boolean(live)}
              assistantName="Front Mind 企业助手"
              readOnly={exampleReadOnly}
              evaluationNotRequired={!exampleReadOnly && (live?.chat ? live.chat.evaluation === "not_required" : evaluationNotRequired)}
              selectedAnswerKey={exampleReadOnly ? `example:${activeCase?.id}` : live?.selectedAnswerKey}
              onSelectAnswer={key => live?.onSelectAnswer?.(key)}
              question={!exampleReadOnly && live?.chat ? live.chat.question : question}
              answer={!exampleReadOnly && live?.chat ? live.chat.answer : answer}
              completedAt={exampleReadOnly ? undefined : live ? live.chat?.completedAt ?? live.answerCompletedAt : previewCompletedAt}
              answerKey={exampleReadOnly ? `example:${activeCase?.id}` : live ? live.chat?.answerKey ?? liveAnswerKey : `${previewAnswerRevision}:${question}:${answer}`}
              sources={!exampleReadOnly && live?.chat ? live.chat.sources : currentSources}
              busy={Boolean(live?.busy) || previewBusy}
              running={Boolean(live?.running) || previewBusy}
              turnKey={live ? live.runningTurnId ?? live.questionId ?? "new" : previewAnswerIdentity}
              activity={live?.activity ?? previewActivity}
              steeringSupported={live ? live.steeringSupported : true}
              onSteer={live?.onSteer}
              onFollowup={live ? live.onFollowup : enqueuePreview}
              followups={live ? live.followups : previewQueue.items}
              followupsPaused={live ? live.followupsPaused : previewQueue.paused}
              onCancelFollowup={live ? live.onCancelFollowup : async id => { setPreviewQueues(old => ({ ...old, [previewQueueKey]: { ...previewQueue, items: previewQueue.items.filter(item => item.id !== id) } })); return true; }}
              onResumeFollowups={live ? live.onResumeFollowups : async () => { setPreviewQueues(old => ({ ...old, [previewQueueKey]: { ...previewQueue, paused: false } })); return true; }}
              onRetryFollowup={live?.onRetryFollowup}
              canEdit={!exampleReadOnly}
              canSubmit={!exampleReadOnly && canAsk && !previewBusy}
              input={exampleReadOnly ? "" : input}
              inputRef={questionInputRef}
              onInput={value => { inputRevision.current += 1; setInput(value); live?.onDraftInput?.(); }}
              onSubmit={submitQuestion}
              onStop={live ? live.onStop : async () => { setPreviewQueues(old => ({ ...old, [previewQueueKey]: { ...previewQueue, paused: true } })); cancelPreview(); setNotice(""); return true; }}
              onEvidence={key => { if (exampleReadOnly) { openAnswerPanel("evidence", true); return; } if (live?.selectedAnswerKey && key !== live.selectedAnswerKey) { pendingEvidenceSelection.current = key; live.onSelectAnswer?.(key); } else openAnswerPanel("evidence", true); }}
            />
            {!exampleReadOnly && (live?.notice || (!live?.busy && live?.pendingDispatchQuestion) || notice) && <p className="rag-inline-feedback" role="status">{live ? "暂时无法完成本次提交，内容已保留。" : notice}{live && <button type="button" disabled={live.busy} onClick={() => void (live.pendingDispatchQuestion ? live.onRetryPending() : submitQuestion())}>重试</button>}</p>}
          </section>
        </div>
        <div className="erag-evaluation-column">
          <RagEntranceReadyContext value={entranceReady("quality")}>
          <aside className="sfp-panel erag-evaluation-panel" data-rag-entrance="quality" data-rag-entrance-immediate={Boolean(live && (automaticBusy || automaticLoading || automaticRun?.status === "failed")) || undefined} role="region" aria-label="本轮回答质量">
          <div className="erag-evaluation-panel__heading">
            <span className="erag-card-icon rag-evaluation-header-icon" aria-hidden="true" data-testid="rag-evaluation-header-icon">
              <ChartNoAxesColumnIncreasing size={18} />
            </span>
            <h2>本轮回答质量</h2>
          </div>
          <div ref={overviewRef} className="rag-evaluation-overview" data-testid="rag-evaluation-overview" data-layout={overviewStacked ? "stacked" : "side-by-side"} data-two-lines={summaryTwoLines ? "true" : "false"}>
            <RagEvaluationGauge key={automaticReport?.reportId ?? `${question}:${answer}`} score={neutralEvaluation ? null : result.score} preciseScore={neutralEvaluation ? null : automaticReport ? automaticReport.result.score : calculatedResult.rawScore} unavailable={tone === "danger"} />
            <section ref={verdictRevealRef} className={`rag-verdict is-${tone}`} data-evaluation-state={neutralEvaluation ? "lifecycle" : "quality"} aria-label="当前评估摘要">
              <div className="rag-evaluation-summary-flow" data-testid="rag-evaluation-summary-flow">
                <h3 className="rag-evaluation-status-title" aria-label={displayVerdictLabel}>
                  <i className="rag-evaluation-status-orb" aria-hidden="true" data-testid="rag-evaluation-status-orb" style={{ opacity: neutralEvaluation ? 1 : revealOpacity(verdictRevealProgress, 0, verdictTitleText.length) }} />
                  <span className={`rag-evaluation-status-title-text${evaluationWaiting ? " rag-waiting-text" : ""}`} role={neutralEvaluation ? "status" : undefined}>{neutralEvaluation ? displayVerdictLabel : <RagProgressiveText graphemes={verdictTitleText} offset={0} total={verdictTitleText.length} progress={verdictRevealProgress} />}</span>
                </h3>
                <p className="rag-evaluation-summary-copy" data-testid="rag-evaluation-summary-copy">{neutralEvaluation ? evaluationSummary : <RagProgressiveText graphemes={verdictSummaryText} offset={0} total={verdictSummaryText.length} progress={verdictRevealProgress} />}{!automaticStarting && !automaticLoading && (evaluationFailed || automaticError) && <button className="rag-evaluation-read-retry" type="button" onClick={() => automaticRun?.status === "failed" ? void startAutomaticEvaluation() : (expectedReadOwner.current = { key: automaticCoordinateKey, since: Date.now() }, setAutomaticReadVersion(value => value + 1))}>重试</button>}</p>
              </div>
            <div className="rag-evaluation-supporting-meta" data-testid="rag-evaluation-supporting-meta" style={neutralEvaluation ? { visibility: "hidden" } : undefined} aria-hidden={neutralEvaluation || undefined}>
              <div className="rag-status-row rag-evaluation-metrics" data-testid="rag-evaluation-metrics">
                <ShieldCheck size={14} aria-hidden="true" data-testid="rag-evaluation-metric-shield" style={{ opacity: revealOpacity(verdictRevealProgress, 0, verdictMetricCount) }} />
                <span className="rag-evaluation-metric-copy">
                  <span><RagProgressiveText graphemes={verdictRiskText} offset={0} total={verdictMetricCount} progress={verdictRevealProgress} /></span>
                  <span><RagProgressiveText graphemes={verdictCoverageText} offset={verdictRiskText.length} total={verdictMetricCount} progress={verdictRevealProgress} /></span>
                </span>
              </div>
            </div>
            </section>
          </div>

          <RagEvaluationRadar emptyQuestion={neutralEvaluation} key={automaticReport?.reportId ?? `${question}:${answer}`} judgments={checklistJudgments} dimensions={radarDimensions} />
          <div className="rag-evaluation-actions" role="group" aria-label="回答评估详情">
            <button type="button" className="sfp-button sfp-button--ghost rag-evaluation-action" aria-haspopup="dialog" data-answer-panel-trigger="evidence" onClick={() => openAnswerPanel("evidence", true)}>回答依据</button>
            <button type="button" className="sfp-button sfp-button--ghost rag-evaluation-action" aria-haspopup="dialog" data-answer-panel-trigger="improve" disabled={evaluationNotRequired || !answer.trim() || hasPerfectScore} title={hasPerfectScore ? "当前回答已满分，无需优化" : undefined} onClick={() => openAnswerPanel("improve", true)}>优化方案</button>
            <button type="button" className="sfp-button sfp-button--ghost rag-evaluation-action" aria-haspopup="dialog" data-answer-panel-trigger="review" disabled={evaluationNotRequired || !answer.trim() || !need.trim()} onClick={() => openAnswerPanel("review", true)}>人工评审</button>
          </div>
          </aside>
          </RagEntranceReadyContext>
          <RagEntranceReadyContext value={entranceReady("task")}>
          <section className="sfp-panel rag-task-panel" data-rag-entrance="task" role="region" aria-label="客户任务结果" data-testid="rag-task-panel">
            <header className="rag-task-panel__heading">
              <div className="erag-evaluation-panel__heading">
                <span className="erag-card-icon" aria-hidden="true"><ClipboardCheck size={18} /></span>
                <h2>客户任务结果</h2>
              </div>
              <span className={`rag-case-status is-${taskStatus}${taskHasRisk ? " is-risk" : ""}`} data-testid="rag-task-status"><i className="rag-evaluation-status-orb" aria-hidden="true" />{taskStatusLabel}</span>
            </header>
            {mode === "sample" && activeCase && conversation ? <>
              <p className="rag-conversation__task"><strong>任务描述：</strong>{activeCase.conversation.task}</p>
              <RagTaskChecklist key={`${activeCase.id}:${JSON.stringify(activeCase.conversation.completionPoints)}`} points={activeCase.conversation.completionPoints} />
              <p className="rag-conversation__reason">{conversation.reason}</p>
              <ul className="rag-conversation__meta" aria-label="评估运行信息">
                <li data-testid="rag-conversation-meta-card">{RAG_CASE_MODE_LABELS[activeCase.mode]}</li>
                <li data-testid="rag-conversation-meta-card">{activeCase.set === "benchmark" ? "稳定基准集" : "扩展测试集"}</li>
                <li data-testid="rag-conversation-meta-card">规定运行 {activeCase.conversation.runsRequired} 次</li>
                {attributionLabel && <li className="is-attribution" data-testid="rag-conversation-meta-card">归因：{attributionLabel}</li>}
              </ul>
            </> : <p className="rag-conversation__reason">尚未绑定客户任务与必要完成点。单轮回答分数不能替代正式任务验收。</p>}
          </section>
          </RagEntranceReadyContext>
        </div>
      </div>
    </div>
    <RagAnswerWindows
      panels={visibleAnswerPanels}
      activePanel={visibleActivePanel}
      onActivate={openAnswerPanel}
      onClose={closeAnswerPanel}
      titles={drawerTitle}
      availability={{ evidence: true, improve: !evaluationNotRequired && Boolean(answer.trim()) && !hasPerfectScore, review: !evaluationNotRequired && Boolean(answer.trim() && need.trim()), answer: !live }}
      modalBlocked={drawer !== null}
      onModalChange={setSheetModal}
      renderBody={renderDrawerBody}
      renderFooter={renderDrawerFooter}
    />
    {drawer && <div className="rag-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside ref={dialogRef} className={`rag-drawer rag-drawer--${drawer}`} role="dialog" aria-modal="true" aria-labelledby="rag-drawer-title" tabIndex={-1}><header><div><h2 id="rag-drawer-title">{drawerTitle[drawer]}</h2></div><button aria-label="关闭评估面板" onClick={() => close()}><X size={20} /></button></header><div className="rag-drawer-body">{renderDrawerBody(drawer)}</div><footer>{renderDrawerFooter(drawer)}</footer></aside></div>}

  </section>;
}
export default EnterpriseRagPreview;
