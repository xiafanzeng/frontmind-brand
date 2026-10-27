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
    scope.fetch.mockResolvedValue(new Response(JSON.stringify(result)));
    const update = vi.fn();
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", update);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await waiting).toEqual(result);
    expect(update).toHaveBeenCalledWith(result);
  });
  it("模型失败时保留服务端状态并给出错误", async () => {
    vi.useFakeTimers(); const result = workspace("failed");
    scope.fetch.mockResolvedValue(new Response(JSON.stringify(result)));
    const update = vi.fn();
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", update);
    const assertion = expect(waiting).rejects.toThrow("证据不正确");
    await vi.advanceTimersByTimeAsync(2500); await assertion;
    expect(update).toHaveBeenCalledWith(result);
  });
  it("工作区切换后在下一次请求前终止轮询", async () => {
    vi.useFakeTimers();
    scope.assertActive.mockImplementation(() => {throw new Error("工作区已切换");});
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", vi.fn());
    const assertion = expect(waiting).rejects.toThrow("工作区已切换");
    await vi.advanceTimersByTimeAsync(2500); await assertion;
    expect(scope.fetch).not.toHaveBeenCalled();
  });
  it("跨数据块接收事件流，结束后回读完整结果且不重复提交", async () => {
    const running = workspace("running"), result = workspace("succeeded");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({start(controller) {
      const frame = `event: progress\ndata: ${JSON.stringify(result.state.jobs![0])}\n\n`;
      controller.enqueue(encoder.encode(frame.slice(0, 15)));
      controller.enqueue(encoder.encode(frame.slice(15))); controller.close();
    }});
    scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify(running)))
      .mockResolvedValueOnce(new Response(stream, {headers: {"content-type": "text/event-stream"}}))
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    const update = vi.fn();
    expect(await liveIntentWorkbenchApi.waitForJob!("job", update)).toEqual(result);
    expect(scope.fetch.mock.calls.map(call => call[0])).toEqual([
      "/api/modules/brand/intent", "/api/modules/brand/intent/stream?jobId=job", "/api/modules/brand/intent",
    ]);
    expect(update).toHaveBeenLastCalledWith(result);
  });
  it("断流后仅轮询原任务并恢复完整结果", async () => {
    vi.useFakeTimers();
    scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify(workspace("running"))))
      .mockRejectedValueOnce(new Error("stream disconnected"))
      .mockResolvedValueOnce(new Response(JSON.stringify(workspace("succeeded"))));
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", vi.fn());
    await vi.advanceTimersByTimeAsync(2500);
    expect((await waiting).state.jobs![0].status).toBe("succeeded");
    expect(scope.fetch.mock.calls.every(call => !call[1]?.method || call[1].method === "GET")).toBe(true);
  });
  it("网关返回 HTML 时显示接口、状态及格式，避免裸露 JSON 解析异常", async () => {
    scope.fetch.mockResolvedValue(new Response("<html>Bad gateway</html>", {status: 502, headers: {"content-type": "text/html"}}));
    await expect(liveIntentWorkbenchApi.observe()).rejects.toThrow(/非 JSON 数据（HTTP 502，text\/html，\/api\/modules\/brand\/intent）/);
  });
  it("保留真实服务错误并附带状态，拒绝错误的成功数据结构", async () => {
    scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify({error: {message: "请先配置模型账户"}}), {status: 409}));
    await expect(liveIntentWorkbenchApi.command({kind: "evaluate"})).rejects.toThrow(/请先配置模型账户（HTTP 409/);
    scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify({revision: 1})));
    await expect(liveIntentWorkbenchApi.observe()).rejects.toThrow("数据结构不正确");
  });
  it("浏览器请求异常保留名称与接口，便于定位 pattern 报错", async () => {
    scope.fetch.mockRejectedValueOnce(new DOMException("The string did not match the expected pattern.", "SyntaxError"));
    await expect(liveIntentWorkbenchApi.observe()).rejects.toThrow(/请求未完成.*\/api\/modules\/brand\/intent.*SyntaxError: The string/);
  });
});
