// Recommendations are generated synchronously upstream. Real core-word responses
// can exceed 30 seconds; keep this bounded below the gateway's 300-second limit.
export const QUESTION_TEMPLATE_TIMEOUT_MS = 120_000;

export function requestQuestionTemplate(origin: string, path: string, token: string, body: unknown) {
  return fetch(`${origin}/api/business/question-templates/${path}`, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json"},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(QUESTION_TEMPLATE_TIMEOUT_MS),
  });
}
