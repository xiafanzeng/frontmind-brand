import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  responseLogicRecoveryKey,
  useResponseLogicTask,
} from "./use-response-logic-task";
import {
  MAX_TASK_POLL_ATTEMPTS,
  TASK_POLL_INTERVAL_MS,
} from "./task-lifecycle";

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});
const running = () => Promise.resolve({ status: "running" as const });
const error = (status: number, code: string) =>
  Object.assign(new Error("测试错误"), { status, code });

describe("task recovery and stale response isolation", () => {
  it("recovers from the server with empty browser storage without creating a task", async () => {
    const start = vi.fn(),
      poll = vi
        .fn()
        .mockResolvedValue({ status: "completed", result: "candidate" });
    const recover = vi
      .fn()
      .mockResolvedValue({
        status: "found",
        taskId: "server-task",
        attempt: 1,
      });
    const hook = renderHook(() =>
      useResponseLogicTask({
        flow: "optimizer",
        contextKey: "server",
        start,
        poll,
        recover,
      }),
    );
    await act(async () => {});
    expect(hook.result.current.state).toMatchObject({
      phase: "completed",
      taskId: "server-task",
      result: "candidate",
    });
    expect(start).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledWith("server-task", expect.any(AbortSignal));
  });
  it("queries after a lost creation response and never treats no match as permission to restart", async () => {
    const recover = vi.fn().mockResolvedValue({ status: "none" });
    const start = vi
        .fn()
        .mockRejectedValue(error(504, "START_OUTCOME_UNKNOWN")),
      poll = vi.fn(running);
    const hook = renderHook(() =>
      useResponseLogicTask({
        flow: "judge",
        contextKey: "lost",
        start,
        poll,
        recover,
      }),
    );
    await act(async () => {});
    await act(async () => {
      await hook.result.current.start();
    });
    await act(async () => {
      hook.result.current.resume();
    });
    expect(hook.result.current.state.phase).toBe("uncertain");
    recover.mockResolvedValue({
      status: "found",
      taskId: "created-but-lost",
      attempt: 0,
    });
    await act(async () => {
      hook.result.current.resume();
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "running",
      taskId: "created-but-lost",
    });
    expect(start).toHaveBeenCalledOnce();
  });
  it("waits for initial recovery before an explicit start, and suppresses concurrent starts", async () => {
    let done!: (value: { status: "none" }) => void;
    const recover = vi.fn(
      () =>
        new Promise<{ status: "none" }>((resolve) => {
          done = resolve;
        }),
    );
    const start = vi.fn().mockResolvedValue({ taskId: "new", attempt: 0 });
    const hook = renderHook(() =>
      useResponseLogicTask({
        flow: "judge",
        contextKey: "pending",
        start,
        poll: vi.fn(running),
        recover,
      }),
    );
    let first!: Promise<void>, second!: Promise<void>;
    act(() => {
      first = hook.result.current.start();
      second = hook.result.current.start();
    });
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      done({ status: "none" });
      await Promise.all([first, second]);
    });
    expect(start).toHaveBeenCalledOnce();
  });
  it("does not let a late recovery response overwrite a new context", async () => {
    let done!: (value: {
      status: "found";
      taskId: string;
      attempt: number;
    }) => void;
    const recover = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            done = resolve;
          }),
      )
      .mockResolvedValue({ status: "none" });
    const start = vi.fn(),
      poll = vi.fn(running);
    const hook = renderHook(
      ({ context }) =>
        useResponseLogicTask({
          flow: "judge",
          contextKey: context,
          start,
          poll,
          recover,
        }),
      { initialProps: { context: "old" } },
    );
    hook.rerender({ context: "new" });
    await act(async () => {
      done({ status: "found", taskId: "old", attempt: 0 });
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "idle",
      activeContext: "new",
      taskId: null,
    });
    expect(start).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });
  it("recovers an optimizer candidate by query only, without starting or adopting", async () => {
    sessionStorage.setItem(
      responseLogicRecoveryKey("optimizer", "q:3:fp:judge"),
      JSON.stringify({ taskId: "saved", attempt: 0 }),
    );
    const start = vi.fn();
    const poll = vi
      .fn()
      .mockResolvedValue({ status: "completed", result: "candidate" });
    const hook = renderHook(() =>
      useResponseLogicTask({
        flow: "optimizer",
        contextKey: "q:3:fp:judge",
        start,
        poll,
      }),
    );
    await act(async () => {});
    expect(hook.result.current.state).toMatchObject({
      phase: "completed",
      taskId: "saved",
      result: "candidate",
    });
    expect(start).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
    await act(async () => {
      await hook.result.current.start();
    });
    expect(start).not.toHaveBeenCalled();
  });
  it("drops a late task creation response after switching question or revision", async () => {
    let resolve!: (value: { taskId: string; attempt: number }) => void;
    const start = vi.fn(
      () =>
        new Promise<{ taskId: string; attempt: number }>((r) => {
          resolve = r;
        }),
    );
    const poll = vi.fn(running);
    const hook = renderHook(
      ({ context }) =>
        useResponseLogicTask({
          flow: "judge",
          contextKey: context,
          start,
          poll,
        }),
      { initialProps: { context: "old" } },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.start();
    });
    hook.rerender({ context: "new" });
    await act(async () => {
      resolve({ taskId: "old-task", attempt: 0 });
      await pending;
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "idle",
      activeContext: "new",
      taskId: null,
    });
    expect(
      sessionStorage.getItem(responseLogicRecoveryKey("judge", "old")),
    ).toBe('{"creationUnconfirmed":true}');
    expect(
      sessionStorage.getItem(responseLogicRecoveryKey("judge", "new")),
    ).toBeNull();
    expect(poll).not.toHaveBeenCalled();
  });
  it("drops an old poll result after changing the draft fingerprint", async () => {
    sessionStorage.setItem(
      responseLogicRecoveryKey("judge", "old-fp"),
      JSON.stringify({ taskId: "old-task", attempt: 0 }),
    );
    let resolve!: (value: { status: "completed"; result: string }) => void;
    const poll = vi.fn(
      () =>
        new Promise<{ status: "completed"; result: string }>((r) => {
          resolve = r;
        }),
    );
    const hook = renderHook(
      ({ context }) =>
        useResponseLogicTask({
          flow: "judge",
          contextKey: context,
          start: vi.fn(),
          poll,
        }),
      { initialProps: { context: "old-fp" } },
    );
    hook.rerender({ context: "new-fp" });
    await act(async () => {
      resolve({ status: "completed", result: "old result" });
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "idle",
      result: null,
      activeContext: "new-fp",
    });
  });
  it("keeps a transport failure uncertain and resumes the same task on online", async () => {
    const start = vi.fn().mockResolvedValue({ taskId: "same", attempt: 0 });
    const poll = vi
      .fn()
      .mockRejectedValueOnce(error(0, "TRANSPORT_FAILED"))
      .mockResolvedValue({ status: "completed", result: "verified" });
    const hook = renderHook(() =>
      useResponseLogicTask({ flow: "judge", contextKey: "q", start, poll }),
    );
    await act(async () => {
      await Promise.all([
        hook.result.current.start(),
        hook.result.current.start(),
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TASK_POLL_INTERVAL_MS);
    });
    expect(hook.result.current.state.phase).toBe("uncertain");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "completed",
      taskId: "same",
    });
    expect(start).toHaveBeenCalledOnce();
    expect(poll.mock.calls.map((c) => c[0])).toEqual(["same", "same"]);
  });
  it("does not create a second task after a start response is lost", async () => {
    const start = vi
      .fn()
      .mockRejectedValue(error(504, "START_OUTCOME_UNKNOWN"));
    const poll = vi.fn(running);
    const hook = renderHook(() =>
      useResponseLogicTask({
        flow: "judge",
        contextKey: "unknown",
        start,
        poll,
      }),
    );
    await act(async () => {
      await hook.result.current.start();
      await hook.result.current.start({ retry: true });
    });
    expect(hook.result.current.state).toMatchObject({
      phase: "uncertain",
      taskId: null,
    });
    expect(start).toHaveBeenCalledOnce();
    expect(poll).not.toHaveBeenCalled();
    hook.unmount();
    const restored = renderHook(() =>
      useResponseLogicTask({
        flow: "judge",
        contextKey: "unknown",
        start,
        poll,
      }),
    );
    await act(async () => {
      await restored.result.current.start();
    });
    expect(restored.result.current.state.phase).toBe("uncertain");
    expect(start).toHaveBeenCalledOnce();
  });
  it("removes a forbidden recovery hint without issuing a start", async () => {
    const key = responseLogicRecoveryKey("judge", "q");
    sessionStorage.setItem(
      key,
      JSON.stringify({ taskId: "foreign", attempt: 0 }),
    );
    const start = vi.fn(),
      poll = vi.fn().mockRejectedValue(error(403, "FORBIDDEN"));
    const hook = renderHook(() =>
      useResponseLogicTask({ flow: "judge", contextKey: "q", start, poll }),
    );
    await act(async () => {});
    expect(hook.result.current.state.phase).toBe("failed");
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
  it.each([
    ["judge", "JUDGE_TIMEOUT"],
    ["optimizer", "OPTIMIZATION_TIMEOUT"],
  ] as const)(
    "preserves the %s timeout code while leaving the task uncertain",
    async (flow, code) => {
      const start = vi.fn().mockResolvedValue({ taskId: "slow", attempt: 0 }),
        poll = vi.fn(running);
      const hook = renderHook(() =>
        useResponseLogicTask({ flow, contextKey: "slow", start, poll }),
      );
      await act(async () => {
        await hook.result.current.start();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          MAX_TASK_POLL_ATTEMPTS * TASK_POLL_INTERVAL_MS,
        );
      });
      expect(hook.result.current.state).toMatchObject({
        phase: "uncertain",
        errorCode: code,
        taskId: "slow",
      });
      expect(start).toHaveBeenCalledOnce();
    },
  );
});
