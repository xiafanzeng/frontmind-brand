/** Historical prefix retained so existing scoped RAG audits remain readable. */
export const EVALUATION_SCOPE_PREFIX = "frontmind.rag.scope.v1";

export function scopedEvaluationStorage(scopeKey?: string) {
  if (!scopeKey?.trim()) return undefined;
  const prefix = `${EVALUATION_SCOPE_PREFIX}:${encodeURIComponent(scopeKey.trim())}:`;
  return {
    getItem: (key: string) => localStorage.getItem(`${prefix}${key}`),
    setItem: (key: string, value: string) =>
      localStorage.setItem(`${prefix}${key}`, value),
  } satisfies Pick<Storage, "getItem" | "setItem">;
}
