import type { DimensionJudgment, GateJudgment } from "./rag-evaluation";

export type RagReviewRecord = {
  id: string;
  question: string;
  answer: string;
  need: string;
  reviewer: string;
  time: string;
  ruleVersion: string;
  knowledgeVersion: string;
  dimensions: DimensionJudgment[];
  gates: GateJudgment[];
};

const HISTORY_KEY = "frontmind-rag-reviews-v1";

/** Keep the original key contract; callers derive scope from authenticated context. */
export function enterpriseRagHistoryStorageKey(scopeKey?: string) {
  return scopeKey?.trim()
    ? `${HISTORY_KEY}.${encodeURIComponent(scopeKey.trim())}`
    : HISTORY_KEY;
}

function isReviewRecord(item: unknown): item is RagReviewRecord {
  if (!item || typeof item !== "object") return false;
  const record = item as RagReviewRecord;
  return typeof record.id === "string" && typeof record.question === "string" &&
    typeof record.answer === "string" && typeof record.need === "string" &&
    typeof record.reviewer === "string" && typeof record.time === "string" &&
    typeof record.ruleVersion === "string" && /^rag-eval-\d+\.\d+$/u.test(record.ruleVersion) &&
    typeof record.knowledgeVersion === "string" && Array.isArray(record.dimensions) &&
    record.dimensions.every(d => d && typeof d.id === "string" && typeof d.rationale === "string" && Array.isArray(d.evidenceIds)) &&
    Array.isArray(record.gates) && record.gates.every(g => g && typeof g.reason === "string" && typeof g.id === "string");
}

export type RagReviewHistoryRead = {
  records: RagReviewRecord[];
  status: "ready" | "invalid" | "unavailable";
  discarded: number;
};

export function readRagReviewHistory(storageKey: string): RagReviewHistoryRead {
  let raw: string | null;
  try { raw = localStorage.getItem(storageKey); }
  catch { return { records: [], status: "unavailable", discarded: 0 }; }
  try {
    const data: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(data)) return { records: [], status: "invalid", discarded: 0 };
    const valid = data.filter(isReviewRecord);
    return { records: valid.slice(0, 30), status: valid.length === data.length ? "ready" : "invalid", discarded: data.length - valid.length };
  } catch { return { records: [], status: "invalid", discarded: 0 }; }
}

/** Original page behavior: malformed or unavailable storage never prevents review. */
export function loadRagReviewHistory(storageKey: string): RagReviewRecord[] {
  return readRagReviewHistory(storageKey).records;
}
