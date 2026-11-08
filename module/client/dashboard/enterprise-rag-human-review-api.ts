import type {
  EnterpriseRagHumanDimensionJudgment,
  EnterpriseRagHumanGateJudgment,
  EnterpriseRagHumanReviewCreateInput,
  EnterpriseRagHumanReviewCreateResult,
  EnterpriseRagHumanReviewDto,
  EnterpriseRagHumanVerdict,
  EnterpriseRagReviewAlignment,
  EnterpriseRagReviewContextDto,
  EnterpriseRagReviewDiff,
  EnterpriseRagReviewStatus,
} from "../../contracts/enterprise-rag-human-review";
import {
  ENTERPRISE_RAG_DIMENSION_IDS,
  ENTERPRISE_RAG_GATE_IDS,
  type EnterpriseRagDimensionId,
  type EnterpriseRagGateId,
} from "../../contracts/enterprise-rag-evaluation-run";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";

const BASE_ENDPOINT = "/api/modules/brand";
const VERDICTS = new Set<EnterpriseRagHumanVerdict>([
  "excellent", "usable", "improve", "unusable", "pending",
]);
const ALIGNMENTS = new Set<EnterpriseRagReviewAlignment>([
  "aligned", "human_more_positive", "human_more_negative", "mixed", "insufficient_information",
]);
const REVIEW_STATUSES = new Set<EnterpriseRagReviewStatus>([
  "aligned", "pending_analysis", "needs_reconciliation", "included_in_proposal",
  "insufficient_information", "not_adopted", "resolved_by_version",
]);
const GATE_STATUSES = new Set(["passed", "failed", "pending"] as const);
const DIMENSION_IDS = new Set<string>(ENTERPRISE_RAG_DIMENSION_IDS);
const GATE_IDS = new Set<string>(ENTERPRISE_RAG_GATE_IDS);

export type EnterpriseRagHumanReviewApiError = Error & {
  retryable?: boolean;
  outcomeUnknown?: boolean;
  status?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function apiMessage(value: unknown): string | null {
  const outer = record(value);
  return text(outer?.message) ?? text(record(outer?.error)?.message);
}

function finiteScore(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function finiteLevel(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4
    ? value
    : undefined;
}

function humanLevel(value: unknown): 0 | 1 | 2 | 3 | 4 | null | undefined {
  const level = finiteLevel(value);
  return level === null || (level !== undefined && Number.isInteger(level))
    ? level as 0 | 1 | 2 | 3 | 4 | null
    : undefined;
}

function parseReviewer(value: unknown): { userId: number; displayName: string } | null {
  const candidate = record(value);
  const displayName = text(candidate?.displayName);
  return candidate && Number.isInteger(candidate.userId) && Number(candidate.userId) >= 0 && displayName
    ? { userId: Number(candidate.userId), displayName }
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) return null;
  return [...value] as string[];
}

function parseDimensions(value: unknown): EnterpriseRagHumanDimensionJudgment[] | null {
  if (!Array.isArray(value) || value.length !== ENTERPRISE_RAG_DIMENSION_IDS.length) return null;
  const parsed: EnterpriseRagHumanDimensionJudgment[] = [];
  for (const item of value) {
    const candidate = record(item);
    const id = candidate?.id;
    const level = humanLevel(candidate?.level);
    const evidenceIds = stringArray(candidate?.evidenceIds);
    if (!candidate || typeof id !== "string" || !DIMENSION_IDS.has(id) || level === undefined ||
        typeof candidate.rationale !== "string" || evidenceIds === null || typeof candidate.applicable !== "boolean") return null;
    parsed.push({ id: id as EnterpriseRagDimensionId, level, rationale: candidate.rationale, evidenceIds, applicable: candidate.applicable });
  }
  return new Set(parsed.map(item => item.id)).size === ENTERPRISE_RAG_DIMENSION_IDS.length ? parsed : null;
}

function parseGates(value: unknown): EnterpriseRagHumanGateJudgment[] | null {
  if (!Array.isArray(value) || value.length !== ENTERPRISE_RAG_GATE_IDS.length) return null;
  const parsed: EnterpriseRagHumanGateJudgment[] = [];
  for (const item of value) {
    const candidate = record(item);
    const id = candidate?.id;
    const status = candidate?.status;
    if (!candidate || typeof id !== "string" || !GATE_IDS.has(id) || !GATE_STATUSES.has(status as never) || typeof candidate.reason !== "string") return null;
    parsed.push({ id: id as EnterpriseRagGateId, status: status as EnterpriseRagHumanGateJudgment["status"], reason: candidate.reason });
  }
  return new Set(parsed.map(item => item.id)).size === ENTERPRISE_RAG_GATE_IDS.length ? parsed : null;
}

function parseDiff(value: unknown): EnterpriseRagReviewDiff | null {
  const candidate = record(value);
  const alignment = candidate?.alignment;
  if (!candidate || typeof alignment !== "string" || !ALIGNMENTS.has(alignment as EnterpriseRagReviewAlignment) ||
      !Array.isArray(candidate.dimensions) || !Array.isArray(candidate.gates)) return null;
  const dimensions: EnterpriseRagReviewDiff["dimensions"] = [];
  for (const value of candidate.dimensions) {
    const item = record(value);
    const aiLevel = humanLevel(item?.aiLevel);
    const nextHumanLevel = humanLevel(item?.humanLevel);
    if (!item || typeof item.id !== "string" || !DIMENSION_IDS.has(item.id) || aiLevel === undefined || nextHumanLevel === undefined) return null;
    dimensions.push({ id: item.id as EnterpriseRagDimensionId, aiLevel, humanLevel: nextHumanLevel });
  }
  const gates: EnterpriseRagReviewDiff["gates"] = [];
  for (const value of candidate.gates) {
    const item = record(value);
    if (!item || typeof item.id !== "string" || !GATE_IDS.has(item.id) ||
        !GATE_STATUSES.has(item.aiStatus as never) || !GATE_STATUSES.has(item.humanStatus as never)) return null;
    gates.push({ id: item.id as EnterpriseRagGateId, aiStatus: item.aiStatus as EnterpriseRagHumanGateJudgment["status"], humanStatus: item.humanStatus as EnterpriseRagHumanGateJudgment["status"] });
  }
  if (new Set(dimensions.map(item => item.id)).size !== dimensions.length ||
      new Set(gates.map(item => item.id)).size !== gates.length) return null;
  let overall: EnterpriseRagReviewDiff["overall"];
  if (candidate.overall !== undefined) {
    const item = record(candidate.overall);
    const aiScore = finiteScore(item?.aiScore);
    const humanScore = finiteScore(item?.humanScore);
    if (!item || typeof item.aiVerdict !== "string" || !VERDICTS.has(item.aiVerdict as EnterpriseRagHumanVerdict) ||
        typeof item.humanVerdict !== "string" || !VERDICTS.has(item.humanVerdict as EnterpriseRagHumanVerdict) ||
        aiScore === undefined || humanScore === undefined) return null;
    overall = { aiVerdict: item.aiVerdict as EnterpriseRagHumanVerdict, aiScore, humanVerdict: item.humanVerdict as EnterpriseRagHumanVerdict, humanScore };
  }
  return { alignment: alignment as EnterpriseRagReviewAlignment, ...(overall ? { overall } : {}), dimensions, gates };
}

function parseReview(value: unknown): EnterpriseRagHumanReviewDto {
  const candidate = record(value);
  const reviewer = parseReviewer(candidate?.reviewer);
  const snapshot = record(candidate?.snapshot);
  const dimensions = parseDimensions(candidate?.dimensions);
  const gates = parseGates(candidate?.gates);
  const diff = parseDiff(candidate?.diff);
  const humanScore = finiteScore(candidate?.humanScore);
  if (!candidate || !text(candidate.id) || !text(candidate.clientRequestId) || !text(candidate.operationId) || !text(candidate.reportId) ||
      !reviewer || !snapshot || typeof snapshot.question !== "string" || typeof snapshot.answer !== "string" ||
      typeof snapshot.need !== "string" || typeof snapshot.knowledgeVersion !== "string" ||
      !text(candidate.createdAt) || !Number.isFinite(Date.parse(String(candidate.createdAt))) ||
      !(candidate.supersedesReviewId === null || text(candidate.supersedesReviewId)) ||
      typeof candidate.humanVerdict !== "string" || !VERDICTS.has(candidate.humanVerdict as EnterpriseRagHumanVerdict) ||
      humanScore === undefined || typeof candidate.alignment !== "string" || !ALIGNMENTS.has(candidate.alignment as EnterpriseRagReviewAlignment) ||
      typeof candidate.status !== "string" || !REVIEW_STATUSES.has(candidate.status as EnterpriseRagReviewStatus) ||
      !dimensions || !gates || !diff || diff.alignment !== candidate.alignment) {
    throw new Error("人工评审接口返回的数据结构不正确，请刷新后重试。");
  }
  return {
    id: candidate.id as string,
    clientRequestId: candidate.clientRequestId as string,
    operationId: candidate.operationId as string,
    reportId: candidate.reportId as string,
    reviewer,
    createdAt: candidate.createdAt as string,
    supersedesReviewId: candidate.supersedesReviewId as string | null,
    snapshot: {
      question: snapshot.question,
      answer: snapshot.answer,
      need: snapshot.need,
      knowledgeVersion: snapshot.knowledgeVersion,
    },
    humanVerdict: candidate.humanVerdict as EnterpriseRagHumanVerdict,
    humanScore,
    alignment: candidate.alignment as EnterpriseRagReviewAlignment,
    status: candidate.status as EnterpriseRagReviewStatus,
    dimensions,
    gates,
    diff,
  };
}

function parseReviewList(value: unknown, operationId: string, reportId?: string): EnterpriseRagHumanReviewDto[] {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.reviews)) {
    throw new Error("人工评审记录接口返回的数据结构不正确，请刷新后重试。");
  }
  const reviews = candidate.reviews.map(parseReview);
  if (reviews.some(review => review.operationId !== operationId || (reportId !== undefined && review.reportId !== reportId))) {
    throw new Error("人工评审记录与当前回答不匹配，请刷新后重试。");
  }
  return reviews.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function parseContext(value: unknown, expectedOperationId: string): EnterpriseRagReviewContextDto {
  const candidate = record(value);
  const reviewer = parseReviewer(candidate?.reviewer);
  const ai = record(candidate?.ai);
  const aiScore = finiteScore(ai?.score);
  if (!candidate || !text(candidate.operationId) || !text(candidate.reportId) || typeof candidate.canReview !== "boolean" ||
      !(candidate.reason === null || typeof candidate.reason === "string") || !reviewer || !ai ||
      typeof ai.verdict !== "string" || !VERDICTS.has(ai.verdict as EnterpriseRagHumanVerdict) || aiScore === undefined ||
      !Array.isArray(ai.dimensions) || ai.dimensions.length !== ENTERPRISE_RAG_DIMENSION_IDS.length ||
      !Array.isArray(ai.gates) || ai.gates.length !== ENTERPRISE_RAG_GATE_IDS.length || !Array.isArray(candidate.reviews)) {
    throw new Error("人工评审上下文接口返回的数据结构不正确，请刷新后重试。");
  }
  const dimensions: EnterpriseRagReviewContextDto["ai"]["dimensions"] = [];
  for (const value of ai.dimensions) {
    const item = record(value); const level = humanLevel(item?.level);
    if (!item || typeof item.id !== "string" || !DIMENSION_IDS.has(item.id) || level === undefined) throw new Error("人工评审上下文接口返回的数据结构不正确，请刷新后重试。");
    dimensions.push({ id: item.id as EnterpriseRagDimensionId, level });
  }
  const gates: EnterpriseRagReviewContextDto["ai"]["gates"] = [];
  for (const value of ai.gates) {
    const item = record(value);
    if (!item || typeof item.id !== "string" || !GATE_IDS.has(item.id) || !GATE_STATUSES.has(item.status as never)) throw new Error("人工评审上下文接口返回的数据结构不正确，请刷新后重试。");
    gates.push({ id: item.id as EnterpriseRagGateId, status: item.status as EnterpriseRagHumanGateJudgment["status"] });
  }
  if (candidate.operationId !== expectedOperationId ||
      new Set(dimensions.map(item => item.id)).size !== ENTERPRISE_RAG_DIMENSION_IDS.length ||
      new Set(gates.map(item => item.id)).size !== ENTERPRISE_RAG_GATE_IDS.length) {
    throw new Error("人工评审上下文与当前回答不匹配，请刷新后重试。");
  }
  const reviews = parseReviewList({ reviews: candidate.reviews }, candidate.operationId as string, candidate.reportId as string);
  return {
    operationId: candidate.operationId as string,
    reportId: candidate.reportId as string,
    canReview: candidate.canReview,
    reason: candidate.reason as string | null,
    reviewer,
    ai: { verdict: ai.verdict as EnterpriseRagHumanVerdict, score: aiScore, dimensions, gates },
    reviews,
  };
}

async function requestOnce(
  operation: ReturnType<typeof captureWorkspaceRestOperation>,
  path: string,
  method: "GET" | "POST",
  input?: unknown,
): Promise<unknown> {
  operation.assertActive();
  let response: Response;
  try {
    response = await operation.fetch(`${BASE_ENDPOINT}${path}`, {
      method,
      credentials: "same-origin",
      headers: operation.headers(method === "POST" ? { "Content-Type": "application/json" } : {}),
      body: method === "POST" ? JSON.stringify(input) : undefined,
    });
  } catch (cause) {
    operation.assertActive();
    const error = Object.assign(new Error("暂时无法连接人工评审服务，请稍后重试。"), {
      retryable: true,
      outcomeUnknown: method === "POST",
    }) as EnterpriseRagHumanReviewApiError;
    throw error;
  }
  let body: unknown;
  try { body = JSON.parse(await response.text() || "null"); }
  catch {
    throw Object.assign(new Error("暂时无法读取人工评审结果，请稍后重试。"), {
      retryable: response.status >= 500,
      outcomeUnknown: method === "POST" && response.ok,
      status: response.status,
    }) as EnterpriseRagHumanReviewApiError;
  }
  operation.assertActive();
  if (!response.ok) {
    throw Object.assign(new Error(apiMessage(body) ?? "人工评审请求失败，请稍后重试。"), {
      retryable: response.status >= 500 || response.status === 408 || response.status === 429,
      outcomeUnknown: method === "POST" && (response.status >= 500 || response.status === 408 || response.status === 429),
      status: response.status,
    }) as EnterpriseRagHumanReviewApiError;
  }
  return body;
}

async function read(path: string): Promise<unknown> {
  const operation = captureWorkspaceRestOperation();
  for (let attempt = 0; ; attempt += 1) {
    try { return await requestOnce(operation, path, "GET"); }
    catch (error) {
      const candidate = error as EnterpriseRagHumanReviewApiError;
      if (!candidate.retryable || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 400 : 1200));
    }
  }
}

export const liveEnterpriseRagHumanReviewApi = {
  async context(operationId: string): Promise<EnterpriseRagReviewContextDto> {
    return parseContext(await read(`/rag-evaluations/${encodeURIComponent(operationId)}/review-context`), operationId);
  },

  async list(operationId: string): Promise<EnterpriseRagHumanReviewDto[]> {
    return parseReviewList(await read(`/rag-evaluations/${encodeURIComponent(operationId)}/reviews`), operationId);
  },

  async submit(input: EnterpriseRagHumanReviewCreateInput): Promise<EnterpriseRagHumanReviewCreateResult> {
    const operation = captureWorkspaceRestOperation();
    const value = record(await requestOnce(operation, "/rag-evaluation-reviews", "POST", input));
    const diff = parseDiff(value?.diff);
    if (!value || !diff) throw new Error("人工评审接口返回的数据结构不正确，请刷新后重试。");
    const review = parseReview(value.review);
    if (review.operationId !== input.operationId || review.reportId !== input.reportId ||
        review.clientRequestId !== input.clientRequestId || review.diff.alignment !== diff.alignment) {
      throw new Error("人工评审结果与当前提交不匹配，请刷新后重试。");
    }
    return { review, diff };
  },
};
