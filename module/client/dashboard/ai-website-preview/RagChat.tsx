import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, useId, type RefObject, type MouseEvent, type KeyboardEvent } from "react";
import { Check, Copy, Send, Sparkles, Square, SquarePen, X } from "lucide-react";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import { copyToClipboard } from "@frontmind/module-ui/lib/utils";
import { ragChatActivityRows, type RagChatActivity, type RagChatActivityRow } from "./rag-chat-activity";
import "./rag-chat.css";

export type RagChatSource = { id: string; title: string; kind?: string };
export type RagChatKnowledgeBase = {
  snapshotId: string;
  version: number;
  sourceFileName: string;
  documentCount: number;
  companyName?: string | null;
};
export type RagChatTurn = {
  /** Question identity retained for older conversation snapshots. */
  id: string;
  question: string;
  answer: string;
  answerKey?: string;
  answerId?: string;
  sources?: RagChatSource[];
  completedAt?: number;
  coordinate?: { sourceQaTaskId: string; turnId: string };
  evaluation?: "not_required";
  /** Frozen knowledge identity for server-authored local replies such as greetings. */
  knowledgeBase?: RagChatKnowledgeBase;
};
export type RagChatFollowup = { id: string; text: string; status: "queued" | "dispatching" | "failed"; error?: string };
export type RagStarterQuestions = {
  current?: { id: string; questions: string[] } | null;
  draft?: { id: string; questions: string[] } | null;
  phase?: "initial_loading" | "generating" | "activating_initial" | "ready" | "error";
  loading?: boolean;
  pending?: boolean;
  error?: string | null;
  revision?: number;
};

export const DEFAULT_RAG_STARTER_QUESTIONS = [
  "可以简单介绍一下你们吗？",
  "你们主要提供哪些产品或服务？",
  "我可以先了解哪些核心信息？",
] as const;

type Props = {
  scopeKey: string;
  live: boolean;
  assistantName: string;
  question: string;
  answer: string;
  previousTurns?: RagChatTurn[];
  answerKey: string;
  selectedAnswerKey?: string;
  onSelectAnswer?: (answerKey: string) => void;
  readOnly?: boolean;
  evaluationNotRequired?: boolean;
  completedAt?: number;
  startedAt?: number;
  durationMs?: number;
  sources: RagChatSource[];
  busy: boolean;
  running: boolean;
  canStop?: boolean;
  stopCapabilityReason?: string | null;
  /** Stable identity of the current business turn, including its supplements. */
  turnKey?: string;
  activity?: RagChatActivity[];
  steeringSupported?: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onInput: (value: string) => void;
  onSubmit: (questionOverride?: string) => Promise<boolean | void>;
  onStop: () => Promise<boolean>;
  onSteer?: (text: string) => Promise<boolean>;
  onFollowup?: (text: string) => Promise<boolean>;
  followups?: RagChatFollowup[];
  followupsPaused?: boolean;
  onCancelFollowup?: (id: string) => Promise<boolean>;
  onResumeFollowups?: () => Promise<boolean>;
  onRetryFollowup?: (id: string) => Promise<boolean>;
  starterQuestions?: RagStarterQuestions;
  /** Hides the welcome identity until its knowledge and first starter state settle. */
  welcomeLoading?: boolean;
  onConfirmStarterQuestions?: (questions: string[]) => Promise<boolean>;
  onRegenerateStarterQuestions?: () => Promise<boolean>;
  onDiscardStarterDraft?: () => Promise<boolean>;
  onOpenStarterSettings?: () => void;
  starterSettingsOpen?: boolean;
  onEvidence: (answerKey: string) => void;
  onEditAnswer?: () => void;
};

// Selecting a response or opening its assessment must not reparse chat history.
const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return <MarkdownRenderer content={content} className="rag-chat-markdown" allowCopy={false} />;
});

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function RagChatWelcomeSkeleton({ scopeKey }: { scopeKey: string }) {
  return <article key={`starter-guide-loading:${scopeKey}`} aria-label="正在加载企业助手" aria-busy="true" className="rag-chat-initial-answer rag-chat-welcome-skeleton">
    <div className="rag-chat-welcome-skeleton__body" role="status" aria-live="polite">
      <span className="rag-chat-sr-status">正在加载企业助手内容</span>
      <span className="rag-chat-welcome-skeleton__line is-title" aria-hidden="true" />
      <span className="rag-chat-welcome-skeleton__line is-copy" aria-hidden="true" />
      <span className="rag-chat-welcome-skeleton__line is-question-one" aria-hidden="true" />
      <span className="rag-chat-welcome-skeleton__line is-question-two" aria-hidden="true" />
      <span className="rag-chat-welcome-skeleton__line is-question-three" aria-hidden="true" />
    </div>
  </article>;
}

// Only a response to work observed in this mounted chat gets an entrance.
// Restored answers and unrelated renders remain fully visible.
function useAnswerTransition(scope: string, key: string, question: string, answer: string, waiting: boolean) {
  const reduced = useReducedMotion();
  const previousScope = useRef(scope);
  const awaited = useRef<string | null>(null);
  const seen = useRef(new Set(answer ? [key] : []));
  const [phase, setPhase] = useState("ready");
  useLayoutEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      awaited.current = null;
      seen.current = new Set(answer ? [key] : []);
      setPhase("ready");
    }
    if (waiting && !answer) {
      awaited.current = question;
      setPhase("waiting");
      return;
    }
    if (!answer) {
      setPhase("ready");
      return;
    }
    const animate = awaited.current === question && !seen.current.has(key) && !reduced;
    seen.current.add(key);
    awaited.current = null;
    if (!animate) {
      setPhase("ready");
      return;
    }
    setPhase("leaving");
    const leave = window.setTimeout(() => setPhase("revealing"), 120);
    const finish = window.setTimeout(() => setPhase("ready"), 360);
    return () => { window.clearTimeout(leave); window.clearTimeout(finish); };
  }, [scope, key, question, answer, waiting, reduced]);
  return phase;
}

type Feedback = "up" | "down" | null;
// A separated cuff keeps the small filled gesture legible at toolbar size.
function FeedbackGlyph({ value, filled = false, hidden = false }: { value: Feedback; filled?: boolean; hidden?: boolean }) {
  const overlapMaskId = useId();
  const outline = "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z";
  const hand = filled
    ? <><path d="m9 10 3-7a2.6 2.6 0 0 1 2.9 3.3L14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7a2 2 0 0 1-1.9 1.4H9Z" /><rect x="2" y="10" width="4" height="11" rx="1" /></>
    : <><path d="M7 10v12" /><path d={outline} /></>;
  return <svg className={hidden ? "rag-chat-rating-glyph is-hidden" : "rag-chat-rating-glyph"} data-gesture={value ?? "both"} width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {value ? <g transform={value === "down" ? "rotate(180 12 12)" : undefined}>{hand}</g> : <>
      <defs><mask id={overlapMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <g transform="scale(.72)"><path className="rag-chat-overlap-clearance" d={outline} fill="black" stroke="black" /></g>
      </mask></defs>
      <g mask={`url(#${overlapMaskId})`}><g transform="translate(7 7) scale(.72) rotate(180 12 12)">{hand}</g></g>
      <g transform="scale(.72)">{hand}</g>
    </>}
  </svg>;
}
function ReadAloudGlyph({ hidden }: { hidden: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" className={hidden ? "rag-chat-speaker-glyph is-hidden" : "rag-chat-speaker-glyph"} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <g transform="translate(11 12) scale(.62 .84) translate(-11 -12)">
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </g>
  </svg>;
}
function ReadAloudStopGlyph({ hidden }: { hidden: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" className={hidden ? "rag-chat-speech-stop is-hidden" : "rag-chat-speech-stop"} fill="currentColor" stroke="none" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm-2.5 4.5v5h5v-5h-5Z" />
  </svg>;
}
function feedbackId(value: string) {
  // Keep question/answer text out of storage keys; this is only a UI preference ID.
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
function readFeedback(scope: string): Record<string, "up" | "down"> {
  try {
    const value = JSON.parse(localStorage.getItem(`frontmind-rag-feedback-v1:${scope}`) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

const completionTimeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const completionDateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });
const CompletionTime = memo(function CompletionTime({ value }: { value?: number }) {
  const completed = value !== undefined && Number.isFinite(value) ? new Date(value) : null;
  if (!completed || !Number.isFinite(completed.getTime())) return null;
  const label = completionTimeFormat.format(completed);
  const digits = label.replace(/\s*[AP]M$/, "");
  return <time className="rag-chat-completed" dateTime={completed.toISOString()} title={`${completionDateFormat.format(completed)} ${label}`} aria-label={`回答完成于 ${label}`}><span className="rag-chat-completed-digits">{digits}</span>{label.slice(digits.length)}</time>;
});

function StarterGuideTools({ scopeKey, text, completedAt, onEditAnswer, starterSettingsAvailable, starterSettingsDisabled, starterSettingsOpen, onOpenStarterSettings, onError }: {
  scopeKey: string;
  text: string;
  completedAt: number;
  onEditAnswer?: () => void;
  starterSettingsAvailable?: boolean;
  starterSettingsDisabled?: boolean;
  starterSettingsOpen?: boolean;
  onOpenStarterSettings?: () => void;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const feedbackBox = useRef<HTMLDivElement>(null);
  const feedbackTrigger = useRef<HTMLButtonElement>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const canSpeak = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  useEffect(() => {
    const stored = readFeedback(scopeKey)[feedbackId("welcome")];
    setCopied(false); setFeedback(stored === "up" || stored === "down" ? stored : null); setFeedbackOpen(false); setSpeaking(false);
    window.clearTimeout(timer.current);
    if (speech.current) { speech.current = null; window.speechSynthesis?.cancel(); }
    return () => { window.clearTimeout(timer.current); if (speech.current) { speech.current = null; window.speechSynthesis?.cancel(); } };
  }, [scopeKey]);
  useEffect(() => {
    if (!feedbackOpen) return;
    const menu = feedbackBox.current;
    menu?.querySelector<HTMLButtonElement>(`[aria-checked="true"]`)?.focus();
    if (!menu?.contains(document.activeElement) || document.activeElement === feedbackTrigger.current) menu?.querySelector<HTMLButtonElement>(`[role="menuitemradio"]`)?.focus();
    const outside = (event: PointerEvent) => { if (!menu?.contains(event.target as Node)) setFeedbackOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [feedbackOpen]);
  const copy = async () => {
    if (!await copyToClipboard(text)) { onError("复制失败，请选择正文后复制。"); return; }
    setCopied(true); window.clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const rate = (value: "up" | "down") => {
    const next = feedback === value ? null : value;
    setFeedback(next); setFeedbackOpen(false); feedbackTrigger.current?.focus();
    const records = readFeedback(scopeKey), key = feedbackId("welcome");
    delete records[key]; if (next) records[key] = next;
    try { localStorage.setItem(`frontmind-rag-feedback-v1:${scopeKey}`, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-100)))); } catch { /* Keep this tab usable. */ }
  };
  const readAloud = () => {
    if (!canSpeak) return;
    if (speech.current) { speech.current = null; window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u3400-\u9fff]/u.test(text) ? "zh-CN" : "en-US";
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));
    utterance.voice = voices.find(voice => voice.localService) ?? voices[0] ?? null;
    const finish = () => { if (speech.current === utterance) { speech.current = null; setSpeaking(false); } };
    utterance.onend = finish;
    utterance.onerror = event => { if (speech.current !== utterance) return; finish(); if (event.error !== "interrupted" && event.error !== "canceled") onError("朗读暂时不可用，请稍后重试。"); };
    speech.current = utterance; setSpeaking(true); onError("");
    try { window.speechSynthesis.speak(utterance); } catch { finish(); onError("朗读暂时不可用，请稍后重试。"); }
  };
  const feedbackLabel = feedback === "up" ? "已赞，修改评价" : feedback === "down" ? "已踩，修改评价" : "评价回答";
  const speechLabel = !canSpeak ? "当前浏览器暂不支持朗读" : speaking ? "停止朗读" : "朗读";
  return <div className="rag-chat-answer-tools" role="group" aria-label="回答操作">
    <button type="button" className="rag-chat-tool rag-chat-copy" data-copied={copied || undefined} onClick={() => void copy()} aria-label={copied ? "已复制" : "复制回答"} aria-describedby={copied ? undefined : `${id}-copy`}><span className="rag-chat-icon-stack" aria-hidden="true"><Copy size={14} className={copied ? "rag-chat-copy-glyph is-hidden" : "rag-chat-copy-glyph"} /><Check size={14} className={copied ? undefined : "is-hidden"} /></span><span className="rag-chat-tool-tip" id={`${id}-copy`} role="tooltip"><span className="rag-chat-tip-copy">复制</span></span></button>
    <div className="rag-chat-feedback" ref={feedbackBox} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); setFeedbackOpen(false); feedbackTrigger.current?.focus(); }
      if (event.key === "Tab") setFeedbackOpen(false);
      if (feedbackOpen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); const choices = Array.from(feedbackBox.current?.querySelectorAll<HTMLButtonElement>(`[role="menuitemradio"]`) ?? []); const current = choices.indexOf(document.activeElement as HTMLButtonElement); const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + 1) % choices.length; choices[target]?.focus(); }
    }}>
      <button ref={feedbackTrigger} type="button" className="rag-chat-tool rag-chat-feedback-trigger" data-rating={feedback ?? undefined} data-popup-open={feedbackOpen || undefined} aria-label={feedbackLabel} aria-haspopup="menu" aria-expanded={feedbackOpen} aria-controls={`${id}-rating-menu`} aria-describedby={`${id}-rating`} onClick={() => setFeedbackOpen(value => !value)}><span className="rag-chat-icon-stack" aria-hidden="true"><FeedbackGlyph value={null} hidden={feedback !== null} /><FeedbackGlyph value="up" filled hidden={feedback !== "up"} /><FeedbackGlyph value="down" filled hidden={feedback !== "down"} /></span><span className="rag-chat-tool-tip" id={`${id}-rating`} role="tooltip"><span className="rag-chat-tip-copy">{feedbackLabel}</span></span></button>
      <div className="rag-chat-rating-menu" id={`${id}-rating-menu`} role="menu" aria-label="评价回答" aria-hidden={!feedbackOpen} inert={!feedbackOpen} data-open={feedbackOpen}><button type="button" role="menuitemradio" aria-checked={feedback === "up"} aria-label="有帮助" title={feedback === "up" ? "取消赞" : "有帮助"} onClick={() => rate("up")}><FeedbackGlyph value="up" filled={feedback === "up"} /></button><button type="button" role="menuitemradio" aria-checked={feedback === "down"} aria-label="没有帮助" title={feedback === "down" ? "取消踩" : "没有帮助"} onClick={() => rate("down")}><FeedbackGlyph value="down" filled={feedback === "down"} /></button></div>
    </div>
    <button type="button" className="rag-chat-tool rag-chat-speech" aria-label={speaking ? "停止朗读" : "朗读"} aria-pressed={speaking} aria-disabled={!canSpeak} aria-describedby={`${id}-speech`} onClick={readAloud}><span className="rag-chat-icon-stack" aria-hidden="true"><ReadAloudGlyph hidden={speaking} /><ReadAloudStopGlyph hidden={!speaking} /></span><span className="rag-chat-tool-tip" id={`${id}-speech`} role="tooltip"><span className="rag-chat-tip-copy">{speechLabel}</span></span></button>
    {starterSettingsAvailable ? <button type="button" className="rag-chat-tool rag-chat-edit" data-answer-panel-trigger="starter" disabled={starterSettingsDisabled} aria-label="设置预设问题" aria-haspopup="dialog" aria-expanded={starterSettingsOpen} aria-describedby={`${id}-starter-settings`} onPointerDown={event => event.currentTarget.setPointerCapture?.(event.pointerId)} onClick={onOpenStarterSettings}><span className="rag-chat-icon-stack" aria-hidden="true"><SquarePen size={14} /></span><span className="rag-chat-tool-tip" id={`${id}-starter-settings`} role="tooltip"><span className="rag-chat-tip-copy">设置预设问题</span></span></button> : onEditAnswer && <button type="button" className="rag-chat-tool rag-chat-edit" data-answer-panel-trigger="answer" aria-label="编辑回答" aria-describedby={`${id}-edit`} onClick={onEditAnswer}><span className="rag-chat-icon-stack" aria-hidden="true"><SquarePen size={14} /></span><span className="rag-chat-tool-tip" id={`${id}-edit`} role="tooltip"><span className="rag-chat-tip-copy">编辑回答</span></span></button>}
    <CompletionTime value={completedAt} />
  </div>;
}

export type RagStarterSettingsProps = {
  scopeKey: string;
  live: boolean;
  canEdit: boolean;
  starterQuestions?: RagStarterQuestions;
  onConfirmStarterQuestions?: (questions: string[]) => Promise<boolean>;
  onRegenerateStarterQuestions?: () => Promise<boolean>;
  onDiscardStarterDraft?: () => Promise<boolean>;
  onClose: () => void;
};

export function RagStarterSettings(props: RagStarterSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const serverCurrent = props.starterQuestions?.current;
  const hasServerCurrent = serverCurrent?.questions?.length === 3;
  const draft = props.starterQuestions?.draft?.questions?.length === 3 ? props.starterQuestions.draft.questions : null;
  const initialDraft = !hasServerCurrent ? draft : null;
  const current = hasServerCurrent ? serverCurrent.questions : props.live ? initialDraft ?? [] : [...DEFAULT_RAG_STARTER_QUESTIONS];
  const editableQuestions = draft ?? current;
  const autoActivating = props.starterQuestions?.phase === "activating_initial";
  const disabled = saving || autoActivating || Boolean(props.starterQuestions?.loading) || !props.canEdit;
  const revisionKey = JSON.stringify([
    props.scopeKey,
    props.starterQuestions?.current?.id,
    props.starterQuestions?.draft?.id,
    props.starterQuestions?.revision,
  ]);

  useEffect(() => {
    setEditing(false);
    setEdits([]);
    setSaving(false);
    setActionError("");
  }, [revisionKey]);

  const beginEdit = () => {
    setEdits([...editableQuestions]);
    setActionError("");
    setEditing(true);
  };
  const confirm = async () => {
    if (!props.onConfirmStarterQuestions || disabled) return;
    const questions = (editing ? edits : editableQuestions).map(value => value.trim());
    if (questions.length !== 3 || questions.some(value => !value) || new Set(questions).size !== 3) {
      setActionError("请保留三条不重复的问题后再确认。");
      return;
    }
    setSaving(true); setActionError("");
    try {
      const saved = await props.onConfirmStarterQuestions(questions);
      if (!saved) setActionError("预设问题未能保存，请重试。");
      else { setEditing(false); props.onClose(); }
    } catch {
      setActionError("预设问题未能保存，请重试。");
    } finally { setSaving(false); }
  };
  const regenerate = async () => {
    if (!props.onRegenerateStarterQuestions || disabled || props.starterQuestions?.pending) return;
    setSaving(true); setActionError("");
    try {
      if (!await props.onRegenerateStarterQuestions()) setActionError("暂时无法生成新问题，请重试。");
    } catch { setActionError("暂时无法生成新问题，请重试。"); }
    finally { setSaving(false); }
  };
  const discard = async () => {
    if (!props.onDiscardStarterDraft || !draft || disabled) return;
    setSaving(true); setActionError("");
    try {
      if (!await props.onDiscardStarterDraft()) setActionError("草稿未能取消，请重试。");
    } catch { setActionError("草稿未能取消，请重试。"); }
    finally { setSaving(false); }
  };
  const notice = initialDraft
    ? autoActivating ? "首次问题已生成，正在自动启用。" : "首次问题已生成。"
    : draft
      ? "新问题草稿已生成，确认后才会替换当前问题。"
      : hasServerCurrent
        ? null
        : "正在准备预设问题。";
  const hasEditableQuestions = editableQuestions.length === 3;

  return <section className="rag-chat-starter-settings" aria-label="预设问题设置">
    {notice && <p className="rag-chat-starter-settings__notice">{notice}</p>}
    {!editing && hasEditableQuestions && <ol className="rag-chat-starters__preview" aria-label="待确认的预设问题">
      {editableQuestions.map((question, index) => <li key={`${index}:${question}`}>{question}</li>)}
    </ol>}
    {editing && <div className="rag-chat-starters__editor" aria-label="编辑预设问题">
      {edits.map((value, index) => <label key={index}><span>问题 {index + 1}</span><input value={value} disabled={saving || !props.canEdit} onChange={event => { const next = event.currentTarget.value; setEdits(currentEdits => currentEdits.map((item, itemIndex) => itemIndex === index ? next : item)); }} /></label>)}
    </div>}
    <div className="rag-chat-starters__actions">
      {props.onConfirmStarterQuestions && !editing && hasEditableQuestions && <button type="button" className="is-secondary" disabled={disabled} onClick={beginEdit}>编辑问题</button>}
      {props.onRegenerateStarterQuestions && <button type="button" className="is-secondary" disabled={disabled || props.starterQuestions?.pending} onClick={() => void regenerate()}>换一批</button>}
      {props.onDiscardStarterDraft && draft && !editing && hasServerCurrent && <button type="button" className="is-ghost" disabled={disabled} onClick={() => void discard()}>取消</button>}
      {editing && <button type="button" className="is-ghost" disabled={saving} onClick={() => { setEditing(false); setActionError(""); }}>取消</button>}
      {props.onConfirmStarterQuestions && (draft || editing) && <button type="button" className="is-primary" disabled={disabled} onClick={() => void confirm()}>确认使用</button>}
    </div>
    {(props.starterQuestions?.pending || props.starterQuestions?.phase === "generating") && <p className="rag-chat-starters__status rag-waiting-text" role="status">正在生成新的预设问题…</p>}
    {autoActivating && <p className="rag-chat-starters__status rag-waiting-text" role="status">正在启用预设问题…</p>}
    {(actionError || props.starterQuestions?.error) && <p className="rag-chat-starters__status" role="alert">{actionError || props.starterQuestions?.error}</p>}
  </section>;
}

export function RagChat(props: Props) {
  const { inputRef } = props;
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [steering, setSteering] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [consumedStarterQuestions, setConsumedStarterQuestions] = useState<string[]>([]);
  const [questionEntrance, setQuestionEntrance] = useState<{ id: number; text: string } | null>(null);
  const [, setPinnedGuideRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyTipSuppressed, setCopyTipSuppressed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackBox = useRef<HTMLDivElement>(null);
  const feedbackTrigger = useRef<HTMLButtonElement>(null);
  const [speaking, setSpeaking] = useState(false);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const markdownRef = useRef<HTMLDivElement>(null);
  const [welcomeCompletedAt, setWelcomeCompletedAt] = useState(() => Date.now());
  const tooltipId = useId();
  const canSpeak = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  const submitLock = useRef(false);
  const stopLock = useRef(false);
  const steerLock = useRef(false);
  const inputRevision = useRef(0);
  const latestInput = useRef(props.input);
  if (latestInput.current !== props.input) { latestInput.current = props.input; inputRevision.current += 1; }
  const runKey = JSON.stringify([props.scopeKey, props.turnKey ?? props.question]);
  const currentRunKey = useRef(runKey);
  currentRunKey.current = runKey;
  const steerGeneration = useRef(0);
  const composing = useRef(false);
  const generation = useRef(0);
  const questionEntranceSequence = useRef(0);
  const pendingQuestionEntrances = useRef<Array<{ id: number; text: string }>>([]);
  const activeScopeKey = useRef(props.scopeKey);
  const pendingGuideTransfer = useRef<{ entranceId: number; fromScope: string; text: string } | null>(null);
  const pinnedGuideScopes = useRef<Set<string>>(new Set());
  const actionKey = props.answerKey || props.turnKey || props.question || "current";
  const currentAnswerKey = useRef(actionKey);
  currentAnswerKey.current = actionKey;
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = props.busy || submitting;
  const waiting = busy && !props.answer;
  const phase = useAnswerTransition(props.scopeKey, props.answerKey, props.question, props.answer, waiting);
  const latestActivity = useRef<{ runKey: string; rows: RagChatActivityRow[] }>({ runKey, rows: [] });
  const activityRows = ragChatActivityRows(props.activity);
  if (waiting) latestActivity.current = { runKey, rows: activityRows };
  const visibleActivity = waiting ? activityRows : latestActivity.current.runKey === runKey ? latestActivity.current.rows : [];
  const serverStarterCurrent = props.starterQuestions?.current;
  const hasServerStarterCurrent = serverStarterCurrent?.questions?.length === 3;
  const starterDraft = props.starterQuestions?.draft?.questions?.length === 3
    ? props.starterQuestions.draft.questions
    : null;
  // The very first generated set is immediately usable while the client
  // promotes that same durable draft to `current`. Once a current set exists,
  // later drafts remain private to the settings window until confirmation.
  const initialStarterDraft = !hasServerStarterCurrent ? starterDraft : null;
  const starterCurrent = hasServerStarterCurrent
    ? serverStarterCurrent.questions
    : props.live ? initialStarterDraft ?? [] : [...DEFAULT_RAG_STARTER_QUESTIONS];
  const starterManagementDisabled = Boolean(props.live && !props.canEdit);
  const starterCurrentKey = JSON.stringify([
    props.scopeKey,
    props.starterQuestions?.current?.id ?? (!hasServerStarterCurrent ? props.starterQuestions?.draft?.id : undefined),
    starterCurrent,
  ]);
  const askedStarterQuestions = new Set([
    props.question.trim(),
    ...(props.previousTurns ?? []).map(turn => turn.question.trim()),
  ].filter(Boolean));
  const remainingStarterQuestions = starterCurrent.filter(question => !consumedStarterQuestions.includes(question) && !askedStarterQuestions.has(question));
  const initialConversationGuide = !props.readOnly && !stopped && !props.question && !props.answer && !(props.previousTurns?.length);
  const showStarterWelcome = initialConversationGuide && !waiting && !props.welcomeLoading;
  const pendingGuideCarry = activeScopeKey.current !== props.scopeKey
    && pendingGuideTransfer.current?.fromScope === activeScopeKey.current
    && pendingGuideTransfer.current.text === props.question.trim()
    && pendingQuestionEntrances.current.some(item => item.id === pendingGuideTransfer.current?.entranceId && item.text === props.question.trim());
  const showStarterGuide = initialConversationGuide || pinnedGuideScopes.current.has(props.scopeKey) || pendingGuideCarry;
  const showCurrentReply = Boolean(props.question || props.answer || waiting || stopped);
  const turnAssistantName = (turn: RagChatTurn) => {
    if (!props.live) return props.assistantName;
    const companyName = turn.knowledgeBase?.companyName?.trim();
    return companyName ? `${companyName} AI 助手` : "企业知识助手";
  };
  const welcomeText = `你好！我是${/^[A-Za-z]/u.test(props.assistantName) ? " " : ""}${props.assistantName}，很高兴为你服务。`;
  const emptyResponseText = stopped
    ? "已停止回答。"
    : props.live
      ? "你好！你可以直接输入问题，我会根据已发布的企业资料为你查找答案。"
      : "你好！有什么可以帮你？";

  useEffect(() => { setConsumedStarterQuestions([]); }, [starterCurrentKey]);
  useLayoutEffect(() => { if (showStarterWelcome) setWelcomeCompletedAt(Date.now()); }, [props.scopeKey, showStarterWelcome]);

  useLayoutEffect(() => {
    if (props.onFollowup) return;
    steerGeneration.current += 1;
    steerLock.current = false;
    setSteering(false);
  }, [runKey, Boolean(props.onFollowup)]);

  useLayoutEffect(() => {
    const previousScope = activeScopeKey.current;
    const transfer = pendingGuideTransfer.current;
    const incomingQuestion = props.question.trim();
    const carryNewConversation = previousScope !== props.scopeKey
      && transfer?.fromScope === previousScope
      && transfer.text === incomingQuestion
      && pendingQuestionEntrances.current.some(item => item.id === transfer.entranceId && item.text === incomingQuestion);
    activeScopeKey.current = props.scopeKey;
    if (carryNewConversation) {
      pendingGuideTransfer.current = null;
      const next = new Set(pinnedGuideScopes.current);
      next.delete(previousScope);
      next.add(props.scopeKey);
      pinnedGuideScopes.current = next;
      setPinnedGuideRevision(current => current + 1);
      return;
    }
    generation.current += 1;
    pendingQuestionEntrances.current = [];
    pendingGuideTransfer.current = null;
    setQuestionEntrance(null);
    submitLock.current = false;
    stopLock.current = false;
    steerLock.current = false;
    setSubmitting(false); setStopping(false); setSteering(false); setStopped(false); setError("");
  }, [props.scopeKey]);
  useEffect(() => () => { generation.current += 1; }, []);
  useLayoutEffect(() => {
    const text = props.question.trim();
    const index = pendingQuestionEntrances.current.findIndex(item => item.text === text);
    if (text && index >= 0) {
      const [entrance] = pendingQuestionEntrances.current.splice(index, 1);
      if (pendingGuideTransfer.current?.entranceId === entrance.id) pendingGuideTransfer.current = null;
      setQuestionEntrance(entrance);
      return;
    }
    setQuestionEntrance(current => current?.text === text ? current : null);
  }, [props.scopeKey, props.question]);
  useEffect(() => {
    setCopied(false);
    setCopyTipSuppressed(false);
    setError("");
    window.clearTimeout(copyTimer.current);
    const stored = readFeedback(props.scopeKey)[feedbackId(actionKey)];
    setFeedbackOpen(false);
    setFeedback(stored === "up" || stored === "down" ? stored : null);
    setSpeaking(false);
    if (speech.current) { speech.current = null; window.speechSynthesis?.cancel(); }
    return () => {
      window.clearTimeout(copyTimer.current);
      if (speech.current) { speech.current = null; window.speechSynthesis?.cancel(); }
    };
  }, [props.scopeKey, actionKey]);
  useEffect(() => {
    if (!feedbackOpen) return;
    const menu = feedbackBox.current;
    menu?.querySelector<HTMLButtonElement>(`[aria-checked="true"]`)?.focus();
    if (!menu?.contains(document.activeElement) || document.activeElement === feedbackTrigger.current) menu?.querySelector<HTMLButtonElement>(`[role="menuitemradio"]`)?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) setFeedbackOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [feedbackOpen]);
  useEffect(() => { if (busy) setStopped(false); }, [busy]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      const style = getComputedStyle(input);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const max = parseFloat(style.lineHeight) * 5 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + border;
      input.style.height = `${Math.min(input.scrollHeight + border, max)}px`;
      input.style.overflowY = input.scrollHeight + border > max ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [props.input, inputRef]);

  const stageQuestionEntrance = (text: string) => {
    const entrance = { id: ++questionEntranceSequence.current, text: text.trim() };
    pendingQuestionEntrances.current = [...pendingQuestionEntrances.current.slice(-31), entrance];
    return entrance.id;
  };
  const cancelQuestionEntrance = (id: number) => {
    pendingQuestionEntrances.current = pendingQuestionEntrances.current.filter(item => item.id !== id);
  };
  const pinGuideForEntrance = (entranceId: number, text: string) => {
    if (!initialConversationGuide) return false;
    const scopeKey = props.scopeKey;
    pendingGuideTransfer.current = { entranceId, fromScope: scopeKey, text: text.trim() };
    if (!pinnedGuideScopes.current.has(scopeKey)) {
      const next = new Set(pinnedGuideScopes.current);
      next.add(scopeKey);
      pinnedGuideScopes.current = next;
      setPinnedGuideRevision(current => current + 1);
    }
    return true;
  };
  const cancelGuideForEntrance = (entranceId: number, scopeKey: string) => {
    if (pendingGuideTransfer.current?.entranceId === entranceId) pendingGuideTransfer.current = null;
    if (!pinnedGuideScopes.current.has(scopeKey)) return;
    const next = new Set(pinnedGuideScopes.current);
    next.delete(scopeKey);
    pinnedGuideScopes.current = next;
    setPinnedGuideRevision(current => current + 1);
  };
  const submit = async (questionOverride?: string): Promise<boolean> => {
    const submitted = questionOverride?.trim() || props.input.trim();
    if (props.readOnly || submitLock.current || busy || props.running || !props.canSubmit || !submitted) return false;
    submitLock.current = true;
    const current = generation.current;
    const entranceId = stageQuestionEntrance(submitted);
    const guideScope = props.scopeKey;
    const pinnedGuide = pinGuideForEntrance(entranceId, submitted);
    setSubmitting(true); setStopped(false); setError("");
    try {
      const accepted = await props.onSubmit(questionOverride?.trim() || undefined);
      if (accepted === false) {
        cancelQuestionEntrance(entranceId);
        if (pinnedGuide) cancelGuideForEntrance(entranceId, guideScope);
      }
      return accepted !== false && current === generation.current;
    } catch {
      cancelQuestionEntrance(entranceId);
      if (pinnedGuide) cancelGuideForEntrance(entranceId, guideScope);
      return false;
    } finally {
      if (current === generation.current) { submitLock.current = false; setSubmitting(false); }
    }
  };
  const submitStarter = async (starter: string) => {
    if (props.running) {
      const send = props.onFollowup ?? (props.steeringSupported ? props.onSteer : undefined);
      if (!send || steerLock.current || stopping) return;
      steerLock.current = true;
      const current = generation.current;
      const currentSteer = steerGeneration.current;
      const submittedRun = runKey;
      const isCurrent = () => current === generation.current && (props.onFollowup || (currentSteer === steerGeneration.current && submittedRun === currentRunKey.current));
      const entranceId = stageQuestionEntrance(starter);
      setSteering(true); setError("");
      try {
        const accepted = await send(starter);
        if (!accepted) cancelQuestionEntrance(entranceId);
        else if (isCurrent()) setConsumedStarterQuestions(items => items.includes(starter) ? items : [...items, starter]);
      } catch { cancelQuestionEntrance(entranceId); /* Keep the starter available for a later retry. */ }
      finally { if (isCurrent()) { steerLock.current = false; setSteering(false); } }
      return;
    }
    if (!await submit(starter)) return;
    setConsumedStarterQuestions(current => current.includes(starter) ? current : [...current, starter]);
  };
  const stop = async () => {
    if (stopLock.current || steerLock.current || !props.running) return;
    stopLock.current = true;
    const current = generation.current;
    setStopping(true); setError("");
    try {
      const ok = await props.onStop();
      if (current === generation.current) {
        setStopped(ok);
        if (!ok) setError("未能停止回答，请重试。");
      }
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "未能停止回答，请重试。");
    } finally {
      if (current === generation.current) { stopLock.current = false; setStopping(false); }
    }
  };
  const steer = async () => {
    if (props.readOnly || steerLock.current || stopping || !props.running || !props.input.trim()) return;
    const send = props.onFollowup ?? (props.steeringSupported ? props.onSteer : undefined);
    if (!send) return;
    steerLock.current = true;
    const current = generation.current;
    const currentSteer = steerGeneration.current;
    const submittedRun = runKey;
    const value = props.input;
    const entranceId = stageQuestionEntrance(value);
    const isCurrent = () => current === generation.current && (props.onFollowup || (currentSteer === steerGeneration.current && submittedRun === currentRunKey.current));
    props.onInput("");
    latestInput.current = "";
    const clearedRevision = ++inputRevision.current;
    const restore = () => {
      if (inputRevision.current === clearedRevision && latestInput.current === "") props.onInput(value);
    };
    setSteering(true); setError("");
    try {
      const accepted = await send(value.trim());
      if (!isCurrent()) return;
      if (!accepted) { cancelQuestionEntrance(entranceId); restore(); setError("问题未能加入待发送，请重试。"); }
    } catch (failure) {
      cancelQuestionEntrance(entranceId);
      if (isCurrent()) { restore(); setError("问题未能加入待发送，请重试。"); }
    } finally {
      if (isCurrent()) { steerLock.current = false; setSteering(false); }
    }
  };
  const copy = async () => {
    setCopyTipSuppressed(true);
    const current = generation.current;
    const key = actionKey;
    const ok = await copyToClipboard(props.answer || emptyResponseText);
    if (current !== generation.current || key !== currentAnswerKey.current) return;
    // Answer changes reset this feedback through the effect above.
    if (!ok) { setError("复制失败，请选择正文后复制。"); return; }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { if (key === currentAnswerKey.current) setCopied(false); }, 2000);
  };

  const rate = (value: "up" | "down") => {
    const next = feedback === value ? null : value;
    setFeedback(next);
    setFeedbackOpen(false);
    feedbackTrigger.current?.focus();
    const records = readFeedback(props.scopeKey);
    const id = feedbackId(actionKey);
    delete records[id];
    if (next) records[id] = next;
    try { localStorage.setItem(`frontmind-rag-feedback-v1:${props.scopeKey}`, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-100)))); }
    catch { /* Keep the current tab usable when storage is unavailable. */ }
  };
  const readAloud = () => {
    if (!canSpeak) return;
    if (speech.current) {
      speech.current = null;
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = props.answer ? markdownRef.current?.innerText || markdownRef.current?.textContent || "" : emptyResponseText;
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = /[\u3400-\u9fff]/u.test(text) ? "zh-CN" : "en-US";
    utterance.lang = lang;
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    const voice = voices.find(voice => voice.localService) ?? voices[0];
    if (voice) utterance.voice = voice;
    const finish = () => {
      if (speech.current !== utterance) return;
      speech.current = null; setSpeaking(false);
    };
    utterance.onend = finish;
    utterance.onerror = event => {
      if (speech.current !== utterance) return;
      finish();
      if (event.error !== "interrupted" && event.error !== "canceled") setError("朗读暂时不可用，请稍后重试。");
    };
    speech.current = utterance;
    setError(""); setSpeaking(true);
    try { window.speechSynthesis.speak(utterance); }
    catch { finish(); setError("朗读暂时不可用，请稍后重试。"); }
  };
  const copyLabel = "复制";
  const feedbackLabel = feedback === "up" ? "已赞，修改评价" : feedback === "down" ? "已踩，修改评价" : "评价回答";
  const speechLabel = !canSpeak ? "当前浏览器暂不支持朗读" : speaking ? "停止朗读" : "朗读";

  const answerTools = (completedAt?: number) => <div className="rag-chat-answer-tools" role="group" aria-label="回答操作">
    <button type="button" className="rag-chat-tool rag-chat-copy" data-copied={copied || undefined} data-tooltip-suppressed={copyTipSuppressed || undefined} onPointerLeave={() => setCopyTipSuppressed(false)} onBlur={() => setCopyTipSuppressed(false)} onClick={() => void copy()} aria-label={copied ? "已复制" : "复制回答"} aria-describedby={copied ? undefined : `${tooltipId}-copy`}><span className="rag-chat-icon-stack" aria-hidden="true"><Copy size={14} className={copied ? "rag-chat-copy-glyph is-hidden" : "rag-chat-copy-glyph"} /><Check size={14} className={copied ? undefined : "is-hidden"} /></span><span className="rag-chat-tool-tip" id={`${tooltipId}-copy`} role="tooltip"><span className="rag-chat-tip-copy" key={copyLabel}>{copyLabel}</span></span></button>
    <div className="rag-chat-feedback" ref={feedbackBox} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setFeedbackOpen(false); feedbackTrigger.current?.focus(); }
      if (event.key === "Tab") setFeedbackOpen(false);
      if (feedbackOpen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const choices = Array.from(feedbackBox.current?.querySelectorAll<HTMLButtonElement>(`[role="menuitemradio"]`) ?? []);
        const index = choices.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + 1) % choices.length;
        choices[target]?.focus();
      }
    }}>
      <button ref={feedbackTrigger} type="button" className="rag-chat-tool rag-chat-feedback-trigger" data-rating={feedback ?? undefined} data-popup-open={feedbackOpen || undefined} aria-label={feedbackLabel} aria-haspopup="menu" aria-expanded={feedbackOpen} aria-controls={`${tooltipId}-rating-menu`} aria-describedby={`${tooltipId}-rating`} onClick={() => setFeedbackOpen(value => !value)}>
        <span className="rag-chat-icon-stack" aria-hidden="true"><FeedbackGlyph value={null} hidden={feedback !== null} /><FeedbackGlyph value="up" filled hidden={feedback !== "up"} /><FeedbackGlyph value="down" filled hidden={feedback !== "down"} /></span>
        <span className="rag-chat-tool-tip" id={`${tooltipId}-rating`} role="tooltip"><span className="rag-chat-tip-copy" key={feedbackLabel}>{feedbackLabel}</span></span>
      </button>
      <div className="rag-chat-rating-menu" id={`${tooltipId}-rating-menu`} role="menu" aria-label="评价回答" aria-hidden={!feedbackOpen} inert={!feedbackOpen} data-open={feedbackOpen}>
        <button type="button" role="menuitemradio" aria-checked={feedback === "up"} aria-label="有帮助" title={feedback === "up" ? "取消赞" : "有帮助"} onClick={() => rate("up")}><FeedbackGlyph value="up" filled={feedback === "up"} /></button>
        <button type="button" role="menuitemradio" aria-checked={feedback === "down"} aria-label="没有帮助" title={feedback === "down" ? "取消踩" : "没有帮助"} onClick={() => rate("down")}><FeedbackGlyph value="down" filled={feedback === "down"} /></button>
      </div>
    </div>
    <button type="button" className="rag-chat-tool rag-chat-speech" aria-label={speaking ? "停止朗读" : "朗读"} aria-pressed={speaking} aria-disabled={!canSpeak} aria-describedby={`${tooltipId}-speech`} onClick={readAloud}><span className="rag-chat-icon-stack" aria-hidden="true"><ReadAloudGlyph hidden={speaking} /><ReadAloudStopGlyph hidden={!speaking} /></span><span className="rag-chat-tool-tip" id={`${tooltipId}-speech`} role="tooltip"><span className="rag-chat-tip-copy" key={speechLabel}>{speechLabel}</span></span></button>
    {props.onEditAnswer && <button type="button" className="rag-chat-tool rag-chat-edit" data-answer-panel-trigger="answer" aria-label="编辑回答" aria-describedby={`${tooltipId}-edit`} onClick={props.onEditAnswer}><span className="rag-chat-icon-stack" aria-hidden="true"><SquarePen size={14} /></span><span className="rag-chat-tool-tip" id={`${tooltipId}-edit`} role="tooltip"><span className="rag-chat-tip-copy">编辑回答</span></span></button>}
    <CompletionTime value={completedAt} />
  </div>;

  const selectAnswer = (event: MouseEvent<HTMLElement>, key: string) => {
    if (!props.onSelectAnswer || !key) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    if ((event.target as Element).closest("button,a,input,textarea,select,[role='menu']")) return;
    props.onSelectAnswer(key);
  };
  const selectAnswerByKeyboard = (event: KeyboardEvent<HTMLElement>, key: string) => {
    if (!props.onSelectAnswer || !key || event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    props.onSelectAnswer(key);
  };
  const showWait = waiting || phase === "leaving";
  const stopAction = props.running && !props.input.trim() && props.canStop === true;
  const stopUnavailable = props.running && !props.input.trim() && props.canStop !== true;
  const stopUnavailableReason = props.stopCapabilityReason?.trim() || "正在确认当前回答是否支持停止。";
  const followupAvailable = Boolean(props.onFollowup || (props.steeringSupported && props.onSteer));
  const starterButtons = (questions: readonly string[], label: string, entrance = false) => <div className={`rag-chat-starters__questions${entrance ? " is-entrance" : ""}`} role="group" aria-label={label}>
    {questions.map(starter => <button key={starter} type="button" disabled={steering || stopping || (props.running ? !followupAvailable : !props.canSubmit || busy)} onClick={() => void submitStarter(starter)}>{starter}</button>)}
  </div>;
  const canManageStarters = Boolean(props.onConfirmStarterQuestions || props.onRegenerateStarterQuestions || props.onDiscardStarterDraft);
  return <>
    <div className="erag-test-thread rag-chat" aria-label="企业助手问答">
      {props.onSelectAnswer && <span id={`${tooltipId}-select`} className="rag-chat-sr-status">按 Enter 或空格查看此回答的评估。</span>}
      {showStarterGuide && (props.welcomeLoading ? <RagChatWelcomeSkeleton scopeKey={props.scopeKey} /> : <article key={`starter-guide:${props.scopeKey}`} aria-label="企业助手欢迎" className="rag-chat-initial-answer">
        <header><Sparkles size={16} aria-hidden="true" /><strong>{props.assistantName}</strong></header>
        <div className="rag-chat-response">
          <div className="rag-chat-welcome" data-testid="rag-starter-welcome">
            <p className={`rag-chat-welcome-copy${showStarterWelcome ? " is-entrance" : ""}`}>{welcomeText}</p>
            {remainingStarterQuestions.length > 0 && <section className="rag-chat-starters" aria-label="常见问题">
              {starterButtons(remainingStarterQuestions, props.live ? "当前预设问题" : "常见问题", showStarterWelcome)}
            </section>}
            <StarterGuideTools scopeKey={props.scopeKey} text={welcomeText} completedAt={welcomeCompletedAt} starterSettingsAvailable={canManageStarters} starterSettingsDisabled={starterManagementDisabled} starterSettingsOpen={props.starterSettingsOpen} onOpenStarterSettings={props.onOpenStarterSettings} onEditAnswer={props.onEditAnswer} onError={setError} />
          </div>
        </div>
      </article>)}
      {props.previousTurns?.map(turn => {
        const key = turn.answerKey ?? turn.answerId ?? turn.id;
        const selectable = Boolean(props.onSelectAnswer && turn.evaluation !== "not_required");
        return <Fragment key={turn.id}>
        <p className="erag-user-message">{turn.question}</p>
        {turn.answer && <article aria-label="历史回答" className={selectable ? "rag-chat-selectable-answer" : undefined} data-answer-key={key} data-selected={selectable && props.selectedAnswerKey === key || undefined} aria-current={selectable && props.selectedAnswerKey === key ? "true" : undefined} tabIndex={selectable ? 0 : undefined} aria-describedby={selectable ? `${tooltipId}-select` : undefined} onClick={event => { if (selectable) selectAnswer(event, key); }} onKeyDown={event => { if (selectable) selectAnswerByKeyboard(event, key); }}>
          <header><Sparkles size={16} aria-hidden="true" /><strong>{turnAssistantName(turn)}</strong></header>
          <div className="rag-chat-response"><ChatMarkdown content={turn.answer} /></div>
          {Boolean(turn.sources?.length) && <div className="erag-citations">{turn.sources!.map((source, index) => <button type="button" key={`${source.kind ?? "source"}:${source.id}`} onClick={event => { event.stopPropagation(); props.onEvidence(key); }}>[{index + 1}] {source.title}</button>)}</div>}
          {turn.completedAt !== undefined && <div className="rag-chat-answer-tools"><CompletionTime value={turn.completedAt} /></div>}
        </article>}
      </Fragment>;
      })}
      {props.question && <p key={questionEntrance?.text === props.question.trim() ? `sent:${questionEntrance.id}` : "current"} className={`erag-user-message${questionEntrance?.text === props.question.trim() ? " rag-chat-user-message--sent" : ""}`}>{props.question}</p>}
      {showCurrentReply && <article aria-label="企业助手回复" aria-busy={waiting} className={props.answer && props.onSelectAnswer && !props.evaluationNotRequired ? "rag-chat-selectable-answer" : undefined} data-answer-key={props.answerKey || undefined} data-selected={Boolean(!props.evaluationNotRequired && props.answer && props.selectedAnswerKey === props.answerKey) || undefined} aria-current={!props.evaluationNotRequired && props.answer && props.selectedAnswerKey === props.answerKey ? "true" : undefined} tabIndex={!props.evaluationNotRequired && props.answer && props.onSelectAnswer ? 0 : undefined} aria-describedby={!props.evaluationNotRequired && props.answer && props.onSelectAnswer ? `${tooltipId}-select` : undefined} onClick={event => { if (props.answer && !props.evaluationNotRequired) selectAnswer(event, props.answerKey); }} onKeyDown={event => { if (props.answer && !props.evaluationNotRequired) selectAnswerByKeyboard(event, props.answerKey); }}>
        <header><Sparkles size={16} aria-hidden="true" /><strong>{props.assistantName}</strong></header>
        <div className="rag-chat-response" data-phase={phase}>
          {showWait && <div className="rag-chat-wait" data-testid="rag-chat-wait" role="status" aria-live="polite">
            {visibleActivity.length ? visibleActivity.map(item => <div key={item.id} className={`rag-chat-activity is-${item.status}`} data-activity-status={item.status}><span>{item.text}</span></div>) : <span>正在处理…</span>}
          </div>}
          {props.answer ? <div className="rag-chat-answer" data-testid={props.live ? "rag-answer" : "rag-preview-answer"}>
            <div ref={markdownRef}><ChatMarkdown content={props.answer} /></div>
            {props.sources.length > 0 && <div className="erag-citations">{props.sources.map((source, index) => <button type="button" data-testid={props.live ? "rag-source" : undefined} key={`${source.kind ?? "source"}:${source.id}`} onClick={event => { event.stopPropagation(); props.onEvidence(props.answerKey); }}>[{index + 1}] {source.title}</button>)}</div>}
            {answerTools(props.completedAt)}
          </div> : !waiting && <div className="rag-chat-empty-response" data-testid={props.live ? "rag-answer" : undefined}>
            <p className="rag-chat-empty">{emptyResponseText}</p>
            {answerTools(props.completedAt ?? welcomeCompletedAt)}
          </div>}
        </div>
        <span className="rag-chat-sr-status" role="status">{props.answer ? "回答已完成" : stopped ? "已停止回答" : ""}</span>
      </article>}
    </div>
    {!props.readOnly && <RagFollowupQueue key={props.scopeKey} items={props.followups ?? []} paused={props.followupsPaused} onCancel={props.onCancelFollowup} onResume={props.onResumeFollowups} onRetry={props.onRetryFollowup} />}
    {error && <p className="rag-chat-error" role="alert">{error}</p>}
    <form className="erag-composer rag-chat-composer" onSubmit={event => { event.preventDefault(); void (props.running ? steer() : submit()); }}>
      <textarea ref={inputRef} className="rag-chat-input" rows={1} data-testid={props.live ? "rag-question-input" : undefined} aria-label={props.live ? "输入企业 RAG 问题" : "输入企业 RAG 预览问题"} placeholder={props.readOnly ? "预览问答" : props.running ? "继续输入，当前回答完成后发送" : props.live ? "输入访客问题，基于已发布知识回答" : "输入访客问题，或选择上方预览问题"} value={props.input} disabled={props.readOnly || !props.canEdit} onChange={event => { inputRevision.current += 1; latestInput.current = event.currentTarget.value; props.onInput(event.currentTarget.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void (props.running ? steer() : submit()); }
      }} />
      <button className="rag-chat-send" data-testid={props.live ? "rag-submit" : undefined} type={stopAction ? "button" : "submit"} disabled={props.readOnly || stopUnavailable || (stopAction ? stopping || steering : props.running ? !props.input.trim() || !followupAvailable || steering || stopping : busy || !props.canSubmit || !props.input.trim())} onClick={stopAction ? () => void stop() : undefined} aria-label={stopAction ? stopping ? "正在停止回答" : "停止回答" : stopUnavailable ? stopUnavailableReason : steering ? "正在加入待发送" : props.live ? "发送问题" : "试用问题"} aria-describedby={stopUnavailable ? `${tooltipId}-stop-unavailable` : undefined} title={stopAction ? "停止回答" : stopUnavailable ? stopUnavailableReason : "发送问题"}>{stopAction ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}</button>
      {stopUnavailable && <span id={`${tooltipId}-stop-unavailable`} className="rag-chat-sr-status">{stopUnavailableReason}</span>}
    </form>
  </>;
}

function RagFollowupQueue({ items, paused, onCancel, onResume, onRetry }: {
  items: RagChatFollowup[];
  paused?: boolean;
  onCancel?: (id: string) => Promise<boolean>;
  onResume?: () => Promise<boolean>;
  onRetry?: (id: string) => Promise<boolean>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const action = async (id: string, run: () => Promise<boolean>) => {
    if (pending) return;
    setPending(id); setError("");
    try { if (!await run() && mounted.current) setError("操作未完成，请重试。"); }
    catch { if (mounted.current) setError("操作未完成，请重试。"); }
    finally { if (mounted.current) setPending(null); }
  };
  if (!items.length) return null;
  return <section className="rag-chat-queue" aria-label="待发送问题">
    <header><span>{paused ? "发送已暂停" : `待发送 ${items.length}`}</span>{paused && onResume && <button type="button" disabled={Boolean(pending)} onClick={() => void action("resume", onResume)}>继续发送</button>}</header>
    <ul>{items.map(item => <li key={item.id} aria-busy={item.status === "dispatching" || pending === item.id}>
      <span className="rag-chat-queue__text">{item.text}</span>
      {item.status === "dispatching" && <span className="rag-chat-queue__state">发送中</span>}
      {item.status === "failed" && onRetry && <button type="button" disabled={Boolean(pending)} onClick={() => void action(item.id, () => onRetry(item.id))}>重试</button>}
      {onCancel && item.status !== "dispatching" && <button type="button" className="rag-chat-queue__cancel" aria-label={`取消发送${item.text}`} disabled={Boolean(pending)} onClick={() => void action(item.id, () => onCancel(item.id))}><X size={14} aria-hidden="true" /></button>}
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
