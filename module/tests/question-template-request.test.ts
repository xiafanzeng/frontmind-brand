// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {requestQuestionTemplate} from "../server/question-template-request";

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

function upstreamAfter(delay: number) {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  const fetch = vi.fn((_url, init) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{"success":true,"data":[{"word":"综合医院"}]}')), delay);
    init.signal.addEventListener("abort", () => {clearTimeout(timer); reject(init.signal.reason);}, {once: true});
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("接受真实复现的30.216秒核心词响应，不在30秒丢弃成功结果", async () => {
  vi.useFakeTimers();
  const fetch = upstreamAfter(30_216);
  const pending = requestQuestionTemplate("https://business.molizhishu.com", "recommend-core-words", "test-token", {brand: "东莞台心医院"});
  await vi.advanceTimersByTimeAsync(30_216);
  expect(await (await pending).json()).toMatchObject({success: true, data: [{word: "综合医院"}]});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({brand: "东莞台心医院"});
});

it("推荐问题也允许超过30秒，2分钟后取消且不重复调用", async () => {
  vi.useFakeTimers();
  const fetch = upstreamAfter(130_000);
  const pending = requestQuestionTemplate("https://business.molizhishu.com", "recommend-questions", "test-token", {brand: "医院", coreWords: ["综合医院"]});
  const failed = expect(pending).rejects.toMatchObject({name: "TimeoutError"});
  await vi.advanceTimersByTimeAsync(119_999);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  expect(fetch).toHaveBeenCalledTimes(1);
});
