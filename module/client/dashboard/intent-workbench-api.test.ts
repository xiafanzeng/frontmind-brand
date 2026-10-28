import {afterEach, describe, expect, it, vi} from "vitest";
import {emptyIntentState, type IntentWorkspace} from "../../contracts/intent-workbench";
const scope = vi.hoisted(() => ({fetch: vi.fn(), assertActive: vi.fn(), headers: vi.fn((value: unknown) => value)}));
vi.mock("../lib/workspace-rest-scope", () => ({
  captureWorkspaceRestOperation: () => scope,
  forkWorkspaceRestOperation: (_operation: unknown, signal: AbortSignal) => ({
    ...scope, fetch: (input: RequestInfo | URL, init?: RequestInit) => scope.fetch(input, {...init, signal}),
  }),
}));
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
  it("宿主绑定流取消信号，45秒无响应后终止连接并回读原任务", async () => {
    vi.useFakeTimers();
    scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify(workspace("running"))))
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(workspace("succeeded"))));
    const waiting = liveIntentWorkbenchApi.waitForJob!("job", vi.fn());
    await vi.advanceTimersByTimeAsync(47_500);
    expect((await waiting).state.jobs![0].status).toBe("succeeded");
    expect(scope.fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it("网关返回 HTML 时显示接口、状态及格式，避免裸露 JSON 解析异常", async () => {
    vi.useFakeTimers();
    scope.fetch.mockImplementation(async () => new Response("<html>Bad gateway</html>", {status: 502, headers: {"content-type": "text/html"}}));
    const result = expect(liveIntentWorkbenchApi.observe()).rejects.toThrow(/非 JSON 数据（HTTP 502，text\/html，\/api\/modules\/brand\/intent）/);
    await vi.advanceTimersByTimeAsync(2000); await result;
    expect(scope.fetch).toHaveBeenCalledTimes(3);
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
  it("Load failed 自动重试读取两次，恢复后交付原工作区，不重发写入", async () => {
    vi.useFakeTimers();
    const result = workspace("succeeded");
    scope.fetch.mockRejectedValueOnce(new TypeError("Load failed")).mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    const reading = liveIntentWorkbenchApi.observe();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await reading).toEqual(result);
    expect(scope.fetch).toHaveBeenCalledTimes(3);
    scope.fetch.mockRejectedValueOnce(new TypeError("Load failed"));
    await expect(liveIntentWorkbenchApi.command({kind: "evaluate"})).rejects.toThrow("Load failed");
    expect(scope.fetch).toHaveBeenCalledTimes(4);
  });
  it("读取响应正文中断也可恢复；切换工作区时停止后续重试", async () => {
    vi.useFakeTimers();
    scope.fetch.mockResolvedValueOnce({text: () => Promise.reject(new TypeError("Load failed"))})
      .mockResolvedValueOnce(new Response(JSON.stringify(workspace("succeeded"))));
    const reading = liveIntentWorkbenchApi.observe();
    await vi.advanceTimersByTimeAsync(500);
    expect((await reading).state.jobs![0].status).toBe("succeeded");
    scope.fetch.mockRejectedValueOnce(new TypeError("Load failed"));
    const switched = liveIntentWorkbenchApi.observe();
    const assertion = expect(switched).rejects.toThrow("工作区已切换");
    await vi.advanceTimersByTimeAsync(0);
    scope.assertActive.mockImplementation(() => {throw new Error("工作区已切换");});
    await vi.advanceTimersByTimeAsync(500); await assertion;
    expect(scope.fetch).toHaveBeenCalledTimes(3);
  });
});
