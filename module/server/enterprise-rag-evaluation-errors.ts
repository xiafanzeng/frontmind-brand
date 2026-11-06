import { z } from "zod";
import { randomUUID } from "node:crypto";
import { EnterpriseRagEvaluationError } from "./enterprise-rag-evaluation-service.js";

const databaseCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR",
  "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_PARSE_ERROR",
]);

/** Never include messages, SQL, request parameters or provider payloads in logs. */
export function ragEvaluationErrorDiagnostic(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && databaseCodes.has(record.code)) {
      return { causeType: "database", causeCode: record.code };
    }
    if (record.message === "MODULE_DATABASE_UNAVAILABLE") {
      return { causeType: "database", causeCode: "MODULE_DATABASE_UNAVAILABLE" };
    }
    current = record.cause;
  }
  return { causeType: error instanceof z.ZodError ? "validation" : error instanceof EnterpriseRagEvaluationError ? "evaluation" : "runtime" };
}

export function presentRagEvaluationError(error: unknown) {
  const diagnostic = ragEvaluationErrorDiagnostic(error);
  if (diagnostic.causeType === "database") {
    return { status: 503, code: "RAG_DATABASE_UNAVAILABLE", message: "评估服务暂时无法读取数据，请稍后重试。", diagnostic };
  }
  if (error instanceof EnterpriseRagEvaluationError) {
    return { status: error.status, code: error.code, message: error.message, diagnostic };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, code: "INVALID_INPUT", message: "提交内容格式不正确。", diagnostic };
  }
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.statusCode ?? record.status);
  if (status === 401 || status === 403) {
    return { status, code: "RAG_ACCESS_DENIED", message: "当前账号无权读取或执行此评估。", diagnostic };
  }
  return { status: 503, code: "RAG_EVALUATION_UNAVAILABLE", message: "评估服务暂不可用，请稍后重试。", diagnostic };
}

export function recordRagEvaluationError(error: unknown, action: "start" | "history" | "observe") {
  const requestId = randomUUID();
  const failure = presentRagEvaluationError(error);
  if (failure.status >= 500) {
    console.error("[EnterpriseRagEvaluation] request_failed", {
      requestId, action, status: failure.status, code: failure.code, ...failure.diagnostic,
    });
  }
  return { ...failure, requestId };
}
