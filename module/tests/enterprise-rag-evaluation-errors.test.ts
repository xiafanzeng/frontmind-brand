import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { automaticRagEvaluationEnabled, automaticRagEvaluationOperationId } from "../server/enterprise-rag-automatic-evaluation";
import { presentRagEvaluationError, ragEvaluationErrorDiagnostic, recordRagEvaluationError } from "../server/enterprise-rag-evaluation-errors";

describe("RAG 服务错误与自动执行身份", () => {
  it("嵌套数据库错误保留可诊断代码但不泄漏 SQL、账号、凭据或问题", () => {
    const secret = "PRIVATE-question-api-key-user-id";
    const error = new Error(`Failed query ${secret}`, { cause: Object.assign(new Error(secret), { code: "ECONNREFUSED" }) });
    expect(presentRagEvaluationError(error)).toMatchObject({ status: 503, code: "RAG_DATABASE_UNAVAILABLE" });
    expect(ragEvaluationErrorDiagnostic(error)).toEqual({ causeType: "database", causeCode: "ECONNREFUSED" });
    expect(JSON.stringify(presentRagEvaluationError(error))).not.toContain(secret);
    expect(presentRagEvaluationError({ statusCode: 403, message: secret })).toMatchObject({ status: 403, code: "RAG_ACCESS_DENIED" });
    expect(presentRagEvaluationError(new Error(secret)).message).not.toContain(secret);
    expect(presentRagEvaluationError(z.string().safeParse(1).error)).toMatchObject({ status: 400, code: "INVALID_INPUT" });
  });

  it("失败日志只包含脱敏诊断字段，并返回同一个关联编号", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const privateValue = "PRIVATE-question-key-account";
      const error = new Error(privateValue, { cause: Object.assign(new Error(privateValue), { code: "ECONNREFUSED", sql: privateValue }) });
      const result = recordRagEvaluationError(error, "history");
      expect(log).toHaveBeenCalledWith("[EnterpriseRagEvaluation] request_failed", {
        requestId: result.requestId, action: "history", status: 503,
        code: "RAG_DATABASE_UNAVAILABLE", causeType: "database", causeCode: "ECONNREFUSED",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateValue);
      expect(z.string().uuid().parse(result.requestId)).toBe(result.requestId);
    } finally { log.mockRestore(); }
  });

  it("只有明确正式执行模式允许调用；身份按答案和工作区隔离", () => {
    expect(automaticRagEvaluationEnabled({})).toBe(false);
    expect(automaticRagEvaluationEnabled({ FRONTMIND_RAG_AUTO_EVALUATION_MODE: "mock" })).toBe(false);
    expect(automaticRagEvaluationEnabled({ FRONTMIND_RAG_AUTO_EVALUATION_MODE: "live" })).toBe(true);
    const input = { accountUserId: 42, enterpriseProjectId: "project-a", sourceQaTaskId: "task", turnId: "turn", answerMessageId: "answer", answerHash: "hash" };
    const id = automaticRagEvaluationOperationId(input);
    expect(z.string().uuid().parse(id)).toBe(id);
    expect(automaticRagEvaluationOperationId({ ...input })).toBe(id);
    for (const patch of [{ accountUserId: 43 }, { enterpriseProjectId: "project-b" }, { turnId: "turn-b" }, { answerHash: "hash-b" }]) {
      expect(automaticRagEvaluationOperationId({ ...input, ...patch })).not.toBe(id);
    }
  });
});
