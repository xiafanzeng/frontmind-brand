import type {
  EnterpriseRagEvaluationHistoryDto,
  EnterpriseRagEvaluationRunDto,
  EnterpriseRagEvaluationStartInput,
} from "../../contracts/enterprise-rag-evaluation-run";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { parseEvaluationResult } from "./ai-website-preview/evaluation-skill-contract";

const ENDPOINT = "/api/modules/brand/rag-evaluations";

export type EnterpriseRagEvaluationCoordinate = {
  sourceQaTaskId: string;
  turnId: string;
};

function errorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  const nested = record.error;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return typeof (nested as Record<string, unknown>).message === "string"
    ? ((nested as Record<string, unknown>).message as string)
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isReport(value: unknown): boolean {
  const report = record(value);
  const knowledgeBase = record(report?.knowledgeBase);
  const evaluator = record(report?.evaluator);
  const judgments = record(report?.judgments);
  const result = parseEvaluationResult(report?.result);
  const graded = judgments?.schemaVersion === 2;
  return Boolean(
    report &&
      typeof report.reportId === "string" &&
      typeof report.sourceQaTaskId === "string" &&
      typeof report.sourceTurnId === "string" &&
      typeof report.questionMessageId === "string" &&
      typeof report.answerMessageId === "string" &&
      typeof report.completedAt === "string" &&
      knowledgeBase &&
      typeof knowledgeBase.snapshotId === "string" &&
      typeof knowledgeBase.contentHash === "string" &&
      evaluator &&
      typeof evaluator.skillVersion === "string" &&
      typeof evaluator.ruleVersion === "string" &&
      typeof evaluator.model === "string" &&
      judgments &&
      Array.isArray(judgments.dimensions) &&
      judgments.dimensions.length === 6 &&
      Array.isArray(judgments.gates) &&
      judgments.gates.length === 7 &&
      Array.isArray(judgments.claims) &&
      judgments.claims.length > 0 &&
      result &&
      result.skillId === evaluator.skillId && result.version === evaluator.skillVersion &&
      (graded || result.answerVerdict === undefined) &&
      (result.status === "completed" || (graded && result.status === "pending")) &&
      (!graded || (evaluator.ruleVersion === "rag-eval-1.3" && result.answerVerdict !== undefined && record(judgments.task) && Array.isArray(judgments.findings) && judgments.findings.every((value: unknown) => {
        const finding = record(value);
        return finding && typeof finding.id === "string" && typeof finding.summary === "string" && typeof finding.impact === "string" && ["critical", "improvement", "undetermined"].includes(String(finding.severity)) && Array.isArray(finding.claimIds) && Array.isArray(finding.evidenceIds) && Array.isArray(finding.dimensionIds);
      }))) &&
      (result.score === null || typeof result.score === "number") &&
      typeof result.coverage === "number" &&
      typeof result.summary === "string" &&
      Array.isArray(result.dimensions) &&
      result.dimensions.length === 6 &&
      Array.isArray(result.risks),
  );
}

function isRun(value: unknown): value is EnterpriseRagEvaluationRunDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.operationId === "string" &&
    typeof run.sourceQaTaskId === "string" &&
    typeof run.turnId === "string" &&
    [
      "queued",
      "uploading",
      "create_unknown",
      "running",
      "result_pending",
      "completed",
      "failed",
    ].includes(String(run.status)) &&
    typeof run.createdAt === "string" &&
    typeof run.updatedAt === "string" &&
    (run.report === null || isReport(run.report)) &&
    (run.error === null ||
      (typeof record(run.error)?.code === "string" &&
        typeof record(run.error)?.message === "string"))
  );
}

function parseRun(value: unknown): EnterpriseRagEvaluationRunDto {
  if (!isRun(value)) {
    throw new Error("自动评估接口返回的数据结构不正确，请刷新后重试。");
  }
  return value;
}

async function request(
  path: string,
  input?: unknown,
): Promise<unknown> {
  const operation = captureWorkspaceRestOperation();
  operation.assertActive();
  const response = await operation
    .fetch(`${ENDPOINT}${path}`, {
      method: input === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: operation.headers(
        input === undefined ? {} : { "Content-Type": "application/json" },
      ),
      body: input === undefined ? undefined : JSON.stringify(input),
    })
    .catch((cause: unknown) => {
      operation.assertActive();
      const detail =
        cause instanceof Error || cause instanceof DOMException
          ? `${cause.name}: ${cause.message}`
          : "网络异常";
      throw new Error(`自动评估请求未完成（${detail}），请稍后重试。`);
    });
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text || "null");
  } catch {
    throw new Error(
      `自动评估接口返回非 JSON 数据（HTTP ${response.status}），请刷新后重试。`,
    );
  }
  operation.assertActive();
  if (!response.ok) {
    throw new Error(
      `${errorMessage(value) ?? "自动评估请求失败"}（HTTP ${response.status}）`,
    );
  }
  return value;
}

export const liveEnterpriseRagEvaluationApi = {
  async latest(
    coordinate: EnterpriseRagEvaluationCoordinate,
  ): Promise<EnterpriseRagEvaluationHistoryDto> {
    const query = new URLSearchParams(coordinate);
    const value = await request(`?${query.toString()}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("自动评估历史接口返回的数据结构不正确，请刷新后重试。");
    }
    const result = value as Record<string, unknown>;
    const latest = result.latest === null ? null : parseRun(result.latest);
    if (!Array.isArray(result.history)) {
      throw new Error("自动评估历史接口返回的数据结构不正确，请刷新后重试。");
    }
    return {
      latest,
      history: result.history.map(parseRun),
    };
  },

  async start(
    input: EnterpriseRagEvaluationStartInput,
  ): Promise<EnterpriseRagEvaluationRunDto> {
    return parseRun(await request("", input));
  },

  async observe(operationId: string): Promise<EnterpriseRagEvaluationRunDto> {
    return parseRun(await request(`/${encodeURIComponent(operationId)}`));
  },
};
