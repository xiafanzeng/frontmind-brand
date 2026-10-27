// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMonitorAttempts, reportMonitorClient, reportSampleFromResult, type ReportMonitorAttempt } from "../server/report-monitor.js";

const questions = ["核心产品推荐", "测试品牌有什么缺点和问题？"] as const;
const attempt = (): ReportMonitorAttempt => ({ ...reportMonitorAttempts("report-a", questions, ["doubao"])[0]!, taskId: "provider-task-1" });
const answer = () => ({ platform: "doubao", prompt: questions[0], status: "completed", answerContent: "测试品牌有相关产品。", rank: 1, citationList: [{ title: "可信来源", url: "https://example.org/article", site: "媒体" }] });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, code: 200, data }), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("brand report monitoring identity", () => {
  it("freezes 30 distinct keys and reproduces only the same report's attempts", () => {
    const list = reportMonitorAttempts("report-a", questions, ["doubao", "yuanbao", "qianwen"]);
    expect(list).toHaveLength(30);
    expect(new Set(list.map((entry) => entry.consumerTaskId)).size).toBe(30);
    expect(list.every((entry) => /^[a-z0-9]{8,64}$/.test(entry.consumerTaskId))).toBe(true);
    expect(reportMonitorAttempts("report-a", questions, ["doubao", "yuanbao", "qianwen"])).toEqual(list);
    const other = reportMonitorAttempts("report-b", questions, ["doubao", "yuanbao", "qianwen"]);
    expect(other.every((entry) => !list.some((original) => original.consumerTaskId === entry.consumerTaskId))).toBe(true);
    expect(list.filter((entry) => entry.platform === "doubao" && entry.question === questions[0]).map((entry) => entry.run)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts only the exact question/platform pair and freezes the original sample identity", () => {
    const current = attempt(); const raw = { subTaskList: [answer()] };
    const snapshot = structuredClone(raw);
    expect(reportSampleFromResult(current, "测试品牌", raw)).toMatchObject({ id: current.consumerTaskId, platform: "doubao", question: questions[0], mentioned: true, rank: 1 });
    expect(raw).toEqual(snapshot);
    expect(() => reportSampleFromResult(current, "测试品牌", { subTaskList: [{ ...answer(), platform: "yuanbao" }] })).toThrow(/平台不一致/);
    expect(() => reportSampleFromResult(current, "测试品牌", { subTaskList: [{ ...answer(), prompt: "另一个问题" }] })).toThrow(/不同的问题/);
    expect(() => reportSampleFromResult(current, "测试品牌", { subTaskList: [answer(), answer()] })).toThrow(/平台不一致/);
  });

  it("does not fabricate missing answers, rankings, or unsafe citations", () => {
    const current = attempt();
    expect(() => reportSampleFromResult(current, "测试品牌", { subTaskList: [{ ...answer(), answerContent: "" }] })).toThrow(/有效回答/);
    expect(() => reportSampleFromResult(current, "测试品牌", { subTaskList: [{ ...answer(), status: "failed" }] })).toThrow(/有效回答/);
    const sample = reportSampleFromResult(current, "测试品牌", { subTaskList: [{ ...answer(), answerContent: "没有相关企业信息。", rank: undefined, citationList: [{ title: "脚本", url: "javascript:alert(1)" }, { title: "凭据URL", url: "https://user:secret@example.org" }, { title: "真实链接", url: "https://example.org/evidence" }] }] });
    expect(sample.mentioned).toBe(false); expect(sample.rank).toBeNull();
    expect(sample.citations.map((entry) => entry.url)).toEqual(["https://example.org/evidence"]);
  });

  it("uses supplier attribution for the configured enterprise when the answer contains only its short name", () => {
    const fullName = "东莞台心医院医疗美容科";
    const base = { ...answer(), rank: undefined, answerContent: "台心医院有相关服务，请核实当前项目。" };
    expect(reportSampleFromResult(attempt(), fullName, { subTaskList: [{ ...base, mentionPosition: 2 }] })).toMatchObject({ mentioned: true, rank: 2 });
    expect(reportSampleFromResult(attempt(), fullName, { subTaskList: [{ ...base, keywordEvaluations: [{ keyword: fullName, nature: "negative", context: "相关服务需要进一步核实" }] }] })).toMatchObject({ mentioned: true, rank: null });
  });

  it("does not infer aliases or borrow attribution from a different enterprise", () => {
    const fullName = "东莞台心医院医疗美容科";
    const base = { ...answer(), rank: undefined, answerContent: "台心医院有相关服务。", keywordEvaluations: [{ keyword: "其他医院", nature: "positive" }] };
    expect(reportSampleFromResult(attempt(), fullName, { subTaskList: [base] })).toMatchObject({ mentioned: false, rank: null });
    expect(reportSampleFromResult(attempt(), fullName, { subTaskList: [{ ...base, keywordEvaluations: [{ keyword: "台心医院", nature: "positive" }] }] })).toMatchObject({ mentioned: false, rank: null });
  });

  it("preserves observed sentiment and separates search references from actual citations", () => {
    const current = attempt();
    const sample = reportSampleFromResult(current, "测试品牌", {subTaskList: [{...answer(),
      keywordEvaluations: [{keyword: "测试品牌", nature: "negative", context: "平台的风险描述"}, {keyword: "其他企业", nature: "positive", context: "无关评价"}],
      referenceList: [{title: "检索参考", url: "https://example.org/search-only"}],
    }]});
    expect(sample).toMatchObject({sentiment: "negative", sentimentEvidence: ["平台的风险描述"], supplierTaskId: current.taskId});
    expect(sample.citations).toHaveLength(1); expect(sample.references).toHaveLength(1);
    expect(sample.citations[0]?.url).not.toBe(sample.references?.[0]?.url);
    expect(Number.isFinite(Date.parse(sample.collectedAt!))).toBe(true);
  });

  it("prefers monitored-keyword ranking and rejects invalid numerical rankings", () => {
    const base = { ...answer(), answerContent: "相关企业信息。" };
    expect(reportSampleFromResult(attempt(), "测试品牌", { subTaskList: [{ ...base, rank: 1, mentionPosition: "3" }] })).toMatchObject({ mentioned: true, rank: 3 });
    for (const rank of [0, -1, 1.5, "unknown", true]) expect(reportSampleFromResult(attempt(), "测试品牌", { subTaskList: [{ ...base, rank }] })).toMatchObject({ mentioned: false, rank: null });
  });
});

describe("brand report provider failures and recovery", () => {
  it("requires configured credentials before any network request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const client = reportMonitorClient({});
    expect(client.configured).toBe(false);
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("submits the frozen key and one sample only, preserving it across an uncertain retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new DOMException("timeout", "TimeoutError")).mockResolvedValueOnce(json({ taskId: "provider-task-1" }));
    vi.stubGlobal("fetch", fetcher);
    const client = reportMonitorClient({ MOLI_API_TOKEN: "fixture-only-token", MOLI_API_ORIGIN: "https://provider.example/" });
    const current = attempt();
    await expect(client.submit(current, "测试品牌")).rejects.toMatchObject({ code: "MONITOR_NETWORK", ambiguous: true });
    await expect(client.submit(current, "测试品牌")).resolves.toBe("provider-task-1");
    const first = JSON.parse(fetcher.mock.calls[0]![1].body); const second = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ consumerTaskId: current.consumerTaskId, prompts: [questions[0]], platforms: [{ platform: "doubao", mode: "search", screenshot: 0 }] });
    expect(fetcher.mock.calls[0]![0]).toBe("https://provider.example/api/business/monitor/task/batch/shared");
  });

  it.each([500, 503])("treats HTTP %i during submission as ambiguous without exposing upstream contents", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: "sensitive upstream details must not escape" }), { status })));
    const client = reportMonitorClient({ MOLI_API_TOKEN: "fixture-only-token" });
    const error = await client.submit(attempt(), "测试品牌").catch((value) => value);
    expect(error).toMatchObject({ code: "MONITOR_REJECTED", ambiguous: true });
    expect(error.message).not.toContain("sensitive"); expect(error.message).not.toContain("fixture-only-token");
  });

  it("does not guess a successful task ID from an invalid or empty response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("invalid-json", { status: 200 })).mockResolvedValueOnce(json({}));
    vi.stubGlobal("fetch", fetcher);
    const client = reportMonitorClient({ MOLI_API_TOKEN: "fixture-only-token" });
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_RESPONSE", ambiguous: true });
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_SUBMISSION_UNKNOWN", ambiguous: true });
  });

  it("polls the persisted provider task without submitting any replacement", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ status: "running" })).mockResolvedValueOnce(json({ status: "completed" })).mockResolvedValueOnce(json({ subTaskList: [answer()] }));
    vi.stubGlobal("fetch", fetcher);
    const client = reportMonitorClient({ MOLI_API_TOKEN: "fixture-only-token" });
    await expect(client.poll(attempt(), "测试品牌")).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client.poll(attempt(), "测试品牌")).resolves.toMatchObject({ id: attempt().consumerTaskId, answer: answer().answerContent });
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
    expect(fetcher.mock.calls[2]![0]).toContain("/result/provider-task-1");
  });

  it("keeps terminal failure and polling transport failure distinct from success", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ status: "failed" })).mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    vi.stubGlobal("fetch", fetcher);
    const client = reportMonitorClient({ MOLI_API_TOKEN: "fixture-only-token" });
    await expect(client.poll(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_FAILED", ambiguous: false });
    await expect(client.poll(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_NETWORK", ambiguous: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
