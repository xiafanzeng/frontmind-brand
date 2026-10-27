import { captureWorkspaceRestOperation } from "./response-logic-runtime-host.js";
import { RESPONSE_LOGIC_API_BASE } from "./response-logic-api-base.js";

export type ResponseLogicQuestionContext = {
  questionId: string;
  question: string;
  intent: string;
  workspaceRevision: number;
};

/**
 * Read the caller's CURRENT question text/intent through the authenticated
 * module endpoint (Brand ledger resolver server-side). Used by the workbench
 * freshness check: `null` means the question no longer resolves for this
 * workspace; transport/server errors throw so the caller can treat the
 * context as unverified instead of silently trusting stale data.
 */
export async function fetchResponseLogicQuestionContext(input: {
  questionId: string;
  signal?: AbortSignal;
}): Promise<ResponseLogicQuestionContext | null> {
  const rest = captureWorkspaceRestOperation(input.signal);
  const query = new URLSearchParams({ questionId: input.questionId });
  let response: Response;
  try {
    response = await rest.fetch(
      `${RESPONSE_LOGIC_API_BASE}/question-context?${query.toString()}`,
      { method: "GET", credentials: "include", headers: { Accept: "application/json" } },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("读取最新问题失败，请检查网络后重试");
  }
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null) as
    | { questionId?: unknown; question?: unknown; intent?: unknown; workspaceRevision?: unknown; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `读取最新问题失败（${response.status}）`);
  }
  if (typeof payload?.questionId !== "string" || typeof payload?.question !== "string") {
    throw new Error("最新问题响应格式无效，请稍后重试");
  }
  return {
    questionId: payload.questionId,
    question: payload.question,
    intent: typeof payload.intent === "string" ? payload.intent : "",
    workspaceRevision: Number.isFinite(payload.workspaceRevision) ? Number(payload.workspaceRevision) : 0,
  };
}
