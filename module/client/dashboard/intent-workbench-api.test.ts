import {afterEach, describe, expect, it, vi} from "vitest";
import {emptyIntentState, type IntentWorkspace} from "../../contracts/intent-workbench";
const scope = vi.hoisted(() => ({fetch: vi.fn(), assertActive: vi.fn(), headers: vi.fn((value: unknown) => value)}));
vi.mock("../lib/workspace-rest-scope", () => ({captureWorkspaceRestOperation: () => scope}));
import {liveIntentWorkbenchApi} from "./intent-workbench-api";

const workspace = (status: string): IntentWorkspace => ({
  revision: 1, nodes: [], preview: false, state: {...emptyIntentState(), jobs: [{
    id: "job", status, error: "证据不正确",
  } as any]},
});
afterEach(() => {vi.useRealTimers(); vi.clearAllMocks(); scope.assertActive.mockReset();});
describe("优化任务轮询", () => {
  it("成功时交付模型完成状态", async () => {
    vi.useFakeTimers(); const result = workspace("succeeded");
    scope.fetch.mockResolvedValue({ok: true, json: async () => result});
    const update = vi.fn();
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", update);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await waiting).toEqual(result);
    expect(update).toHaveBeenCalledWith(result);
  });
  it("模型失败时保留服务端状态并给出错误", async () => {
    vi.useFakeTimers(); const result = workspace("failed");
    scope.fetch.mockResolvedValue({ok: true, json: async () => result});
    const update = vi.fn();
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", update);
    const assertion = expect(waiting).rejects.toThrow("证据不正确");
    await vi.advanceTimersByTimeAsync(2500); await assertion;
    expect(update).toHaveBeenCalledWith(result);
  });
  it("工作区切换后在下一次请求前终止轮询", async () => {
    vi.useFakeTimers();
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", vi.fn());
    scope.assertActive.mockImplementation(() => {throw new Error("工作区已切换");});
    const assertion = expect(waiting).rejects.toThrow("工作区已切换");
    await vi.advanceTimersByTimeAsync(2500); await assertion;
    expect(scope.fetch).not.toHaveBeenCalled();
  });
});
