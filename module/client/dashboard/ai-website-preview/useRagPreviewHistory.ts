import { useEffect, useMemo, useRef, useState } from "react";
import type { DimensionJudgment, GateJudgment } from "./rag-evaluation";
import type { RagCase } from "./rag-evaluation-cases";
import { peekRagPreviewFixtures } from "./rag-preview-fixture-loader";

/** Snapshot of the synthetic preview only; live conversations use their own service. */
export type RagPreviewConversationSnapshot = {
  previousTurns: Array<{ id: string; question: string; answer: string }>;
  question: string;
  answer: string;
  need: string;
  input: string;
  caseId: string | null;
  dimensions: DimensionJudgment[];
  gates: GateJudgment[];
  mode: "sample" | "manual";
  previewAnswerIdentity: string;
  completedAt: number;
  durationMs?: number;
};
export type RagPreviewConversation = RagPreviewConversationSnapshot & { id: string; updatedAt: number };

type HistoryState = { key: string; enabled: boolean; activeId: string; conversations: RagPreviewConversation[]; storageAvailable: boolean; seeded: boolean; seedPending: boolean };
const EMPTY_PREVIEW_CASES: readonly RagCase[] = [];
const STORAGE_PREFIX = "frontmind-rag-preview-conversations-v1";
export const ragPreviewHistoryStorageKey = (scope?: string) => `${STORAGE_PREFIX}.${encodeURIComponent(scope?.trim() || "preview")}`;
const createId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function isConversation(value: unknown): value is RagPreviewConversation {
  if (!value || typeof value !== "object") return false;
  const v = value as RagPreviewConversation;
  return typeof v.id === "string" && !!v.id && typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) &&
    (v.previousTurns === undefined || (Array.isArray(v.previousTurns) && v.previousTurns.every(turn => turn && typeof turn.id === "string" && typeof turn.question === "string" && typeof turn.answer === "string"))) &&
    typeof v.question === "string" && typeof v.answer === "string" && typeof v.need === "string" && typeof v.input === "string" &&
    (v.caseId === null || typeof v.caseId === "string") && (v.mode === "sample" || v.mode === "manual") &&
    typeof v.previewAnswerIdentity === "string" && typeof v.completedAt === "number" && Number.isFinite(v.completedAt) &&
    (v.durationMs === undefined || (typeof v.durationMs === "number" && Number.isFinite(v.durationMs))) &&
    Array.isArray(v.dimensions) && v.dimensions.every(d => d && typeof d.id === "string" && (d.level === null || (Number.isInteger(d.level) && d.level >= 0 && d.level <= 4)) && typeof d.rationale === "string" && typeof d.applicable === "boolean" && Array.isArray(d.evidenceIds) && d.evidenceIds.every(id => typeof id === "string")) &&
    Array.isArray(v.gates) && v.gates.every(g => g && typeof g.id === "string" && ["passed", "failed", "pending"].includes(g.status) && typeof g.reason === "string");
}
function seedSamples(conversations: RagPreviewConversation[], samples: readonly RagCase[]): RagPreviewConversation[] {
  const existingSampleIds = new Set(conversations.filter(item => item.mode === "sample" && item.caseId).map(item => item.caseId));
  const timestamp = Date.now();
  const additions: RagPreviewConversation[] = samples.filter(item => !existingSampleIds.has(item.id)).map(item => ({
    id: `sample:${item.id}`, updatedAt: timestamp, previousTurns: [], question: item.question, answer: item.answer, need: item.need,
    input: "", caseId: item.id, dimensions: item.dimensions.map(d => ({ ...d, evidenceIds: [...d.evidenceIds] })),
    gates: item.gates.map(g => ({ ...g })), mode: "sample", previewAnswerIdentity: `sample:${item.id}`, completedAt: timestamp,
  }));
  // A pre-existing user session may coincidentally use a reserved sample ID.
  const ids = new Set(conversations.map(item => item.id));
  return [...conversations, ...additions.map(item => ids.has(item.id) ? { ...item, id: createId() } : item)];
}
function load(key: string, enabled: boolean, samples: readonly RagCase[]): HistoryState {
  const empty: HistoryState = { key, enabled, activeId: createId(), conversations: [], storageAvailable: true, seeded: false, seedPending: false };
  if (!enabled) return empty;
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch {
    const conversations = seedSamples([], samples);
    return { ...empty, activeId: conversations[0]?.id ?? empty.activeId, conversations, seeded: true, storageAvailable: false };
  }
  let record: { activeId?: unknown; conversations: unknown[]; seeded?: unknown } = { conversations: [] };
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { conversations?: unknown }).conversations)) record = parsed as typeof record;
    } catch { /* Present a fresh preview; writes happen only after a user action. */ }
  }
  let conversations = record.conversations.filter(isConversation).map(item => ({ ...item, previousTurns: item.previousTurns ?? [] }));
  const wasSeeded = record.seeded === true;
  if (!wasSeeded) conversations = seedSamples(conversations, samples);
  const activeId = typeof record.activeId === "string" && record.activeId ? record.activeId : conversations[0]?.id ?? empty.activeId;
  return { ...empty, activeId, conversations, seeded: true, seedPending: !wasSeeded };
}
function snapshotCopy(snapshot: RagPreviewConversationSnapshot): RagPreviewConversationSnapshot {
  return { ...snapshot, previousTurns: (snapshot.previousTurns ?? []).map(turn => ({ ...turn })), dimensions: snapshot.dimensions.map(d => ({ ...d, evidenceIds: [...d.evidenceIds] })), gates: snapshot.gates.map(g => ({ ...g })) };
}

/** Mutations are explicit: the caller saves the displayed snapshot before switching. */
export function useRagPreviewHistory(scopeKey?: string, enabled = true, startFresh = false, fixtures?: readonly RagCase[]) {
  const key = ragPreviewHistoryStorageKey(scopeKey);
  const samples = fixtures ?? peekRagPreviewFixtures()?.cases ?? EMPTY_PREVIEW_CASES;
  // Reopening a workspace starts a new draft; persisted conversations remain
  // available only through an explicit history selection.
  const initial = useMemo(() => {
    const loaded = load(key, enabled, samples);
    return startFresh ? { ...loaded, activeId: createId() } : loaded;
  }, [key, enabled, startFresh, samples]);
  const current = useRef(initial);
  const [view, setView] = useState(initial);
  if (current.current.key !== key || current.current.enabled !== enabled) current.current = initial;
  const state = view.key === key && view.enabled === enabled ? view : current.current;
  useEffect(() => { if (view.key !== key || view.enabled !== enabled) setView(current.current); }, [key, enabled, view.key, view.enabled]);

  const commit = (next: HistoryState) => {
    next = { ...next, seedPending: false };
    if (next.enabled) {
      try { localStorage.setItem(next.key, JSON.stringify({ activeId: next.activeId, conversations: next.conversations, seeded: next.seeded })); next = { ...next, storageAvailable: true }; }
      catch { next = { ...next, storageAvailable: false }; }
    }
    current.current = next;
    setView(next);
  };
  useEffect(() => { if (current.current.key === key && current.current.enabled && current.current.seedPending) commit(current.current); }, [key, enabled]);
  const save = (snapshot: RagPreviewConversationSnapshot, expectedActiveId = current.current.activeId): boolean => {
    const old = current.current;
    if (!old.enabled || expectedActiveId !== old.activeId || !(snapshot.question.trim() || snapshot.answer.trim() || snapshot.input.trim())) return false;
    const existing = old.conversations.find(item => item.id === old.activeId);
    const copy = snapshotCopy(snapshot);
    // Avoid moving an unchanged session to the top merely because the user opened history.
    if (existing) {
      const { id: _id, updatedAt: _time, ...previous } = existing;
      if (JSON.stringify(previous) === JSON.stringify(copy)) return true;
    }
    const entry: RagPreviewConversation = { ...copy, id: old.activeId, updatedAt: Date.now() };
    commit({ ...old, conversations: [entry, ...old.conversations.filter(item => item.id !== old.activeId)] });
    return true;
  };
  const create = (): string => {
    const old = current.current;
    const activeId = createId();
    if (old.enabled) commit({ ...old, activeId });
    return activeId;
  };
  const select = (id: string): RagPreviewConversation | null => {
    const old = current.current;
    const found = old.enabled ? old.conversations.find(item => item.id === id) : undefined;
    if (!found) return null;
    if (old.activeId !== id) commit({ ...old, activeId: id });
    return { ...snapshotCopy(found), id: found.id, updatedAt: found.updatedAt };
  };
  const remove = (id: string): { wasActive: boolean; next: RagPreviewConversation | null } => {
    const old = current.current;
    if (!old.enabled || !old.conversations.some(item => item.id === id)) return { wasActive: false, next: null };
    const conversations = old.conversations.filter(item => item.id !== id);
    const wasActive = id === old.activeId;
    const next = wasActive ? conversations[0] ?? null : null;
    commit({ ...old, conversations, activeId: wasActive ? next?.id ?? createId() : old.activeId });
    return { wasActive, next: next ? { ...snapshotCopy(next), id: next.id, updatedAt: next.updatedAt } : null };
  };
  return { conversations: state.conversations, activeId: state.activeId, activeSnapshot: state.conversations.find(item => item.id === state.activeId) ?? null, storageAvailable: state.storageAvailable, save, create, select, remove };
}
