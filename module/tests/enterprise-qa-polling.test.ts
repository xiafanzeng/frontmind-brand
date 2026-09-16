import { afterEach, describe, expect, it, vi } from "vitest";
import { startEnterpriseQaPolling } from "../client/enterprise-qa-polling";
afterEach(() => vi.useRealTimers());
describe("enterprise QA task polling", () => {
  it("refreshes the final answer once and stops polling terminal tasks", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce({ status: "running", purpose: "enterprise_qa" }).mockResolvedValue({ status: "completed", purpose: "enterprise_qa" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startEnterpriseQaPolling({ read, refresh, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(12000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });
  it("discards in-flight responses when the selected conversation changes", async () => {
    vi.useFakeTimers();
    let resolve!: (task: { status: string }) => void;
    const refresh = vi.fn();
    const stop = startEnterpriseQaPolling({ read: () => new Promise(done => { resolve = done; }), refresh, onError: vi.fn() });
    stop(); resolve({ status: "running" });
    await vi.advanceTimersByTimeAsync(12000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
