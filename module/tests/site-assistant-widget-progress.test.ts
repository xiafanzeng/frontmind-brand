// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TextDecoder, TextEncoder} from "node:util";
import {ReadableStream} from "node:stream/web";
import {TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE} from "../server/siteops/site-assistant-widget.js";

const encoder = new TextEncoder();
const configResponse = {ok: true, json: async () => ({knowledgeBase: {version: 1}})};
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  (window as unknown as {__FRONTMIND_ASSISTANT__: unknown}).__FRONTMIND_ASSISTANT__ = {
    apiBase: "https://brand.frontmind.cn", name: "企业助手",
  };
  new Function(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE)();
  (document.querySelector(".fm-assistant-launcher") as HTMLButtonElement).click();
}

function send(question = "请查找服务资料") {
  const input = document.querySelector(".fm-assistant-input") as HTMLTextAreaElement;
  input.value = question;
  document.querySelector(".fm-assistant-form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
}

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  vi.stubGlobal("TextDecoder", TextDecoder);
  fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(configResponse);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public website assistant progress", () => {
  it("renders real progress from split UTF-8 frames, then clears waiting and restores input", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start(controller) { stream = controller; }});
    fetchMock.mockResolvedValueOnce({status: 200, headers: {get: () => "application/x-ndjson"}, body});
    mount();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    send();
    expect(document.querySelector(".fm-assistant-progress")?.textContent).toContain("正在处理问题");
    expect(document.querySelector(".fm-assistant-progress-time")?.textContent).toContain("已等待");
    expect((document.querySelector(".fm-assistant-send") as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls[1]![1].headers.accept).toBe("application/x-ndjson");

    const progress = encoder.encode(JSON.stringify({type: "progress", schemaVersion: 1, activities: [
      {label: "检索文本", status: "running"}, {label: "private provider reasoning", status: "completed"},
    ]}) + "\n");
    // Split in the middle of a multibyte Chinese character as well as a JSON line.
    const split = progress.indexOf(0xe6) + 1;
    stream.enqueue(progress.slice(0, split));
    stream.enqueue(progress.slice(split));
    await vi.waitFor(() => expect(document.querySelector(".fm-assistant-progress-steps")?.textContent).toContain("正在检索文本"));
    expect(document.body.textContent).not.toContain("private provider reasoning");

    stream.enqueue(encoder.encode(JSON.stringify({type: "answer", schemaVersion: 1, session: "public-session", answer: {text: "已找到服务资料。", sources: []}}) + "\n"));
    stream.close();
    await vi.waitFor(() => expect(document.querySelector(".fm-assistant-answer")?.textContent).toContain("已找到服务资料"));
    expect(document.querySelector(".fm-assistant-progress")).toBeNull();
    expect((document.querySelector(".fm-assistant-input") as HTMLTextAreaElement).disabled).toBe(false);
    expect((document.querySelector(".fm-assistant-send") as HTMLButtonElement).disabled).toBe(false);
    expect(JSON.parse(sessionStorage.getItem("fm-assistant:https://brand.frontmind.cn/api/public/site-assistant")!).transcript).toHaveLength(2);
  });

  it("clears waiting on a streamed error and permits the next question", async () => {
    const body = new ReadableStream<Uint8Array>({start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({type: "error", schemaVersion: 1, session: "public-session", error: {code: "ASSISTANT_UNAVAILABLE", message: "请稍后重试。"}})));
      controller.close();
    }});
    fetchMock.mockResolvedValueOnce({status: 200, headers: {get: () => "application/x-ndjson"}, body});
    fetchMock.mockResolvedValueOnce({status: 200, headers: {get: () => "application/json"}, json: async () => ({answer: {text: "下一轮正常回答。", sources: []}})});
    mount(); send();
    await vi.waitFor(() => expect(document.querySelector(".fm-assistant-error")?.textContent).toContain("请稍后重试"));
    expect(document.querySelector(".fm-assistant-progress")).toBeNull();
    await vi.waitFor(() => expect((document.querySelector(".fm-assistant-send") as HTMLButtonElement).disabled).toBe(false));
    send("再试一次");
    await vi.waitFor(() => expect(document.querySelector(".fm-assistant-answer")?.textContent).toContain("下一轮正常回答"));
  });

  it("treats a truncated stream as failure and clears its elapsed timer", async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start(controller) { stream = controller; }});
    fetchMock.mockResolvedValueOnce({status: 200, headers: {get: () => "application/x-ndjson"}, body});
    mount(); send();
    await vi.advanceTimersByTimeAsync(2100);
    expect(document.querySelector(".fm-assistant-progress-time")?.textContent).toContain("2 秒");
    expect(document.querySelector(".fm-assistant-progress-steps")?.textContent).toBe("");
    stream.enqueue(encoder.encode('{"type":"progress","schemaVersion":1,"activities":[]'));
    stream.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".fm-assistant-error")?.textContent).toContain("网络连接失败");
    expect(document.querySelector(".fm-assistant-progress")).toBeNull();
    expect((document.querySelector(".fm-assistant-send") as HTMLButtonElement).disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an unanswered request at the deadline and releases busy state", async () => {
    vi.useFakeTimers();
    let aborted = false;
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    }));
    mount(); send();
    await vi.advanceTimersByTimeAsync(170000);
    expect(aborted).toBe(true);
    expect(document.querySelector(".fm-assistant-progress")).toBeNull();
    expect(document.querySelector(".fm-assistant-error")?.textContent).toContain("回答等待超时");
    expect((document.querySelector(".fm-assistant-input") as HTMLTextAreaElement).disabled).toBe(false);
    expect((document.querySelector(".fm-assistant-send") as HTMLButtonElement).disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
