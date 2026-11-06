import { z } from "zod";
import { responseLogicStructuredDraftSchema } from "../contracts/response-logic.js";
import { responseLogicRecoverySchema, readResponseLogicExecution } from "../contracts/response-logic-progress.js";
import { captureWorkspaceRestOperation } from "./response-logic-runtime-host.js";
import { RESPONSE_LOGIC_API_BASE } from "./response-logic-api-base.js";
import { useResponseLogicTask } from "./use-response-logic-task.js";

export const canRetryRegeneration = (code?: string) => code === "REGENERATION_TASK_FAILED" || code === "REGENERATION_OUTPUT_INVALID";
const pointerSchema = z.object({taskId: z.string().min(1), attempt: z.number().int().min(0).max(100), recordRevision: z.number().int().positive()}).strict();
const candidateSchema = z.object({status: z.literal("completed"), taskId: z.string().min(1), recordRevision: z.number().int().positive(), resultId: z.string().min(1), source: z.enum(["structured_output", "assistant_markdown"]), structuredDraft: responseLogicStructuredDraftSchema, execution: z.unknown().optional()}).strict();
export type RegeneratedCandidate = z.infer<typeof candidateSchema>;
async function request(path: string, signal?: AbortSignal, body?: unknown): Promise<any> {
  let response: Response;
  try {
    response = await captureWorkspaceRestOperation(signal).fetch(`${RESPONSE_LOGIC_API_BASE}/regeneration${path}`, {
      method: body ? "POST" : "GET", credentials: "include", signal,
      headers: body ? {"Content-Type": "application/json"} : {Accept: "application/json"},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw Object.assign(new Error("无法确认任务状态，请恢复查询。"), {status: 0, code: "REGENERATION_TRANSPORT_FAILED"});
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message ?? "重新生成请求未完成"), {status: response.status, code: payload?.error?.code ?? "REGENERATION_REQUEST_FAILED"});
  return payload;
}
function invalidResponse(): never {
  throw Object.assign(new Error("无法确认重新生成响应，请恢复查询。"), {status: 502, code: "REGENERATION_RESPONSE_INVALID"});
}
export function useResponseLogicRegeneration(input: {
  questionId: string; recordIdentity?: string; recordRevision: number;
  sourceFingerprint: string; questionBasis: string; scope: string; enabled: boolean;
}) {
  const query = new URLSearchParams({questionId: input.questionId, expectedRevision: String(input.recordRevision)});
  return useResponseLogicTask<RegeneratedCandidate>({
    flow: "regeneration", enabled: input.enabled && input.recordRevision > 0,
    contextKey: JSON.stringify([input.scope, input.recordIdentity, input.questionId, input.recordRevision, input.sourceFingerprint, input.questionBasis]),
    canRetryFailure: canRetryRegeneration, allowRestartCompleted: true,
    recover: async signal => {
      let payload: unknown;
      try { payload = await request(`/recovery?${query}`, signal); }
      catch (error) {
        const e = error as {status?: number; code?: string};
        if (e.status === 404 && e.code === "REGENERATION_REQUEST_FAILED") return {status: "unavailable", reason: "unsupported"};
        throw error;
      }
      const parsed = responseLogicRecoverySchema.safeParse(payload);
      if (!parsed.success) return invalidResponse();
      if (parsed.data.status === "found" && (parsed.data.recordRevision !== input.recordRevision || parsed.data.sourceFingerprint !== input.sourceFingerprint)) return {status: "none"};
      return parsed.data;
    },
    start: async (retry, signal) => {
      const parsed = pointerSchema.safeParse(await request("", signal, {questionId: input.questionId, expectedRevision: input.recordRevision, ...(retry ? {retry} : {})}));
      if (!parsed.success || parsed.data.recordRevision !== input.recordRevision) return invalidResponse();
      return parsed.data;
    },
    poll: async (taskId, signal, attempt = 0) => {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/status?${query}&attempt=${attempt}`, signal);
      if (payload?.taskId !== taskId) return invalidResponse();
      const execution = readResponseLogicExecution(payload.execution, taskId);
      if (payload.status === "running") return {status: "running", execution};
      const parsed = candidateSchema.safeParse(payload);
      if (!parsed.success || parsed.data.recordRevision !== input.recordRevision) return invalidResponse();
      return {status: "completed", result: parsed.data, execution};
    },
  });
}
