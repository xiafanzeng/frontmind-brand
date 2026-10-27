import { useCallback, useEffect, useRef, useState } from "react";
import type { ResponseLogicQuestionContext } from "./response-logic-question-context-client.js";

export type QuestionFreshnessState = {
  /** The question basis the workbench currently works from. */
  basis: string;
  /** The server's latest basis differs from the one in use. */
  stale: boolean;
  /** The question no longer resolves for this workspace (deleted/inaccessible). */
  deleted: boolean;
  /** Latest verified server snapshot, when one was read successfully. */
  latest: ResponseLogicQuestionContext | null;
  /** Non-404 read failure: the context is UNVERIFIED, never "confirmed fresh". */
  checkError: string | null;
};

export function questionBasisOf(question: string, intent?: string | null): string {
  return `${question}\u0000${intent ?? ""}`;
}

const DEFAULT_CHECK_INTERVAL_MS = 30_000;

/**
 * Detects question edits committed elsewhere (e.g. another tab) by reading
 * the authenticated question-context endpoint when the page becomes visible,
 * gains focus, or on a low-frequency timer while it stays visible.
 *
 * The exposed `basis` is what the judge/optimization context keys must bind
 * to: adopting the latest question (applyLatest) changes it, which resets
 * those state machines and drops stale results, candidates and task ids.
 * Read failures surface as checkError — an unverified context is treated as
 * blocked, never as confirmed valid.
 */
export function useQuestionFreshness(input: {
  questionId: string;
  currentBasis: string;
  fetchContext: (args: { questionId: string; signal?: AbortSignal }) => Promise<ResponseLogicQuestionContext | null>;
  checkIntervalMs?: number;
}): QuestionFreshnessState & {
  applyLatest: () => void;
  checkNow: () => Promise<boolean>;
} {
  const [state, setState] = useState<QuestionFreshnessState>({
    basis: input.currentBasis,
    stale: false,
    deleted: false,
    latest: null,
    checkError: null,
  });
  const basisRef = useRef(state.basis);
  basisRef.current = state.basis;

  const checkNow = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    let outcome: ResponseLogicQuestionContext | null;
    try {
      outcome = await input.fetchContext({ questionId: input.questionId, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      setState(previous => ({ ...previous, checkError: error instanceof Error ? error.message : "读取最新问题失败" }));
      return false;
    }
    if (outcome === null) {
      setState(previous => ({ ...previous, stale: true, deleted: true, latest: null, checkError: null }));
      return false;
    }
    const latestBasis = questionBasisOf(outcome.question, outcome.intent);
    setState(previous => ({
      ...previous,
      latest: outcome,
      deleted: false,
      checkError: null,
      stale: latestBasis !== basisRef.current,
    }));
    return latestBasis === basisRef.current;
  }, [input.fetchContext, input.questionId]);

  const applyLatest = useCallback(() => {
    setState(previous => {
      if (!previous.latest) return previous;
      return {
        ...previous,
        basis: questionBasisOf(previous.latest.question, previous.latest.intent),
        stale: false,
        deleted: false,
        checkError: null,
      };
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const runCheck = () => { void checkNow(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") runCheck();
    };
    window.addEventListener("focus", runCheck);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") runCheck();
    }, input.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);
    runCheck();
    return () => {
      controller.abort();
      window.removeEventListener("focus", runCheck);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [checkNow, input.checkIntervalMs]);

  return { ...state, applyLatest, checkNow };
}
