import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {configureIntentWorkspaceHost} from "./response-logic-runtime-host";
import {useJudgeEvaluation} from "./use-judge-evaluation";
import {TASK_POLL_INTERVAL_MS} from "./task-lifecycle";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: {"content-type": "application/json"},
});
const started = (taskId: string, attempt = 0) => response(200, {
  taskId, attempt, recordRevision: 3, sourceFingerprint: "fingerprint", knowledgeFingerprint: "none",
});
function setup(errorCode = "RESPONSE_LOGIC_JUDGE_TASK_FAILED") {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce(started("original"))
    .mockResolvedValueOnce(response(422, {error: {code: errorCode, message: "评估未完成"}}))
    .mockResolvedValueOnce(started("retry", 1));
  configureIntentWorkspaceHost({captureRestOperation: signal => ({
    signal: signal ?? new AbortController().signal, assertActive() {}, fetch,
  })} as unknown as Parameters<typeof configureIntentWorkspaceHost>[0]);
  const hook = renderHook(() => useJudgeEvaluation({questionId: "q", recordRevision: 3, sourceFingerprint: "fingerprint"}));
  return {...hook, fetch};
}
afterEach(() => {cleanup(); vi.useRealTimers();});

describe("Judge explicit retry dispatch", () => {
  it("sends one retry intent only after a terminal failure and an explicit click", async () => {
    const {result, fetch} = setup();
    await act(async () => {await result.current.start();});
    await act(async () => {await vi.advanceTimersByTimeAsync(TASK_POLL_INTERVAL_MS);});
    expect(result.current.state).toMatchObject({phase: "failed", taskId: "original"});
    await act(async () => {
      await Promise.all([result.current.start({retry: true}), result.current.start({retry: true})]);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({
      questionId: "q", expectedRevision: 3, retry: {taskId: "original", attempt: 0},
    });
    expect(result.current.state).toMatchObject({phase: "running", taskId: "retry"});
  });

  it("normal reopening after failure restores the task without asking for a new attempt", async () => {
    const {result, fetch} = setup();
    await act(async () => {await result.current.start();});
    await act(async () => {await vi.advanceTimersByTimeAsync(TASK_POLL_INTERVAL_MS);});
    await act(async () => {await result.current.start();});
    expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({questionId: "q", expectedRevision: 3});
  });

  it.each(["JUDGE_TRANSPORT_FAILED", "JUDGE_TIMEOUT", "JUDGE_RESPONSE_INVALID"])("does not request a paid retry after %s", async errorCode => {
    const {result, fetch} = setup(errorCode);
    await act(async () => {await result.current.start();});
    await act(async () => {await vi.advanceTimersByTimeAsync(TASK_POLL_INTERVAL_MS);});
    await act(async () => {await result.current.start({retry: true});});
    expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({questionId: "q", expectedRevision: 3});
  });
});
