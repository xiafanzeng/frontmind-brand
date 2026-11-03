// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diagnosticMonitorAttempts,
  diagnosticMonitorClient,
  diagnosticSampleFromResult,
  type DiagnosticMonitorAttempt,
} from "../server/diagnostic-monitor.js";

const questions = ["核心产品推荐", "测试品牌有什么缺点和问题？"] as const;
const attempt = (): DiagnosticMonitorAttempt => ({
  ...diagnosticMonitorAttempts("report-a", questions, ["doubao"])[0]!,
  taskId: "provider-task-1",
});
const answer = () => ({
  platform: "doubao",
  prompt: questions[0],
  status: "completed",
  answerContent: "测试品牌有相关产品。",
  rank: 1,
  citationList: [
    { title: "可信来源", url: "https://example.org/article", site: "媒体" },
  ],
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, code: 200, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("brand report monitoring identity", () => {
  it("freezes 30 distinct keys and reproduces only the same report's attempts", () => {
    const list = diagnosticMonitorAttempts("report-a", questions, [
      "doubao",
      "yuanbao",
      "qianwen",
    ]);
    expect(list).toHaveLength(30);
    expect(new Set(list.map((entry) => entry.consumerTaskId)).size).toBe(30);
    expect(
      list.every((entry) => /^[a-z0-9]{8,64}$/.test(entry.consumerTaskId)),
    ).toBe(true);
    expect(
      diagnosticMonitorAttempts("report-a", questions, [
        "doubao",
        "yuanbao",
        "qianwen",
      ]),
    ).toEqual(list);
    const other = diagnosticMonitorAttempts("report-b", questions, [
      "doubao",
      "yuanbao",
      "qianwen",
    ]);
    expect(
      other.every(
        (entry) =>
          !list.some(
            (original) => original.consumerTaskId === entry.consumerTaskId,
          ),
      ),
    ).toBe(true);
    expect(
      list
        .filter(
          (entry) =>
            entry.platform === "doubao" && entry.question === questions[0],
        )
        .map((entry) => entry.run),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts only the exact question/platform pair and freezes the original sample identity", () => {
    const current = attempt();
    const raw = { subTaskList: [answer()] };
    const snapshot = structuredClone(raw);
    expect(diagnosticSampleFromResult(current, "测试品牌", raw)).toMatchObject({
      id: current.consumerTaskId,
      platform: "doubao",
      question: questions[0],
      mentioned: true,
      rank: 1,
    });
    expect(raw).toEqual(snapshot);
    expect(() =>
      diagnosticSampleFromResult(current, "测试品牌", {
        subTaskList: [{ ...answer(), platform: "yuanbao" }],
      }),
    ).toThrow(/平台不一致/);
    expect(() =>
      diagnosticSampleFromResult(current, "测试品牌", {
        subTaskList: [{ ...answer(), prompt: "另一个问题" }],
      }),
    ).toThrow(/不同的问题/);
    expect(() =>
      diagnosticSampleFromResult(current, "测试品牌", {
        subTaskList: [answer(), answer()],
      }),
    ).toThrow(/平台不一致/);
  });

  it("does not fabricate missing answers, rankings, or unsafe citations", () => {
    const current = attempt();
    expect(() =>
      diagnosticSampleFromResult(current, "测试品牌", {
        subTaskList: [{ ...answer(), answerContent: "" }],
      }),
    ).toThrow(/有效回答/);
    expect(() =>
      diagnosticSampleFromResult(current, "测试品牌", {
        subTaskList: [{ ...answer(), status: "failed" }],
      }),
    ).toThrow(/有效回答/);
    const sample = diagnosticSampleFromResult(current, "测试品牌", {
      subTaskList: [
        {
          ...answer(),
          answerContent: "没有相关企业信息。",
          rank: undefined,
          citationList: [
            { title: "脚本", url: "javascript:alert(1)" },
            { title: "凭据URL", url: "https://user:secret@example.org" },
            { title: "真实链接", url: "https://example.org/evidence" },
          ],
        },
      ],
    });
    expect(sample.mentioned).toBe(false);
    expect(sample.rank).toBeNull();
    expect(sample.citations.map((entry) => entry.url)).toEqual([
      "https://example.org/evidence",
    ]);
  });

  it("uses supplier attribution for the configured enterprise when the answer contains only its short name", () => {
    const fullName = "东莞台心医院医疗美容科";
    const base = {
      ...answer(),
      rank: undefined,
      answerContent: "台心医院有相关服务，请核实当前项目。",
    };
    expect(
      diagnosticSampleFromResult(attempt(), fullName, {
        subTaskList: [{ ...base, mentionPosition: 2 }],
      }),
    ).toMatchObject({ mentioned: true, rank: 2 });
    expect(
      diagnosticSampleFromResult(attempt(), fullName, {
        subTaskList: [
          {
            ...base,
            keywordEvaluations: [
              {
                keyword: fullName,
                nature: "negative",
                context: "相关服务需要进一步核实",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ mentioned: true, rank: null });
  });

  it("does not infer aliases or borrow attribution from a different enterprise", () => {
    const fullName = "东莞台心医院医疗美容科";
    const base = {
      ...answer(),
      rank: undefined,
      answerContent: "台心医院有相关服务。",
      keywordEvaluations: [{ keyword: "其他医院", nature: "positive" }],
    };
    expect(
      diagnosticSampleFromResult(attempt(), fullName, { subTaskList: [base] }),
    ).toMatchObject({ mentioned: false, rank: null });
    expect(
      diagnosticSampleFromResult(attempt(), fullName, {
        subTaskList: [
          {
            ...base,
            keywordEvaluations: [{ keyword: "台心医院", nature: "positive" }],
          },
        ],
      }),
    ).toMatchObject({ mentioned: false, rank: null });
  });

  it("preserves observed sentiment and separates search references from actual citations", () => {
    const current = attempt();
    const sample = diagnosticSampleFromResult(current, "测试品牌", {
      subTaskList: [
        {
          ...answer(),
          keywordEvaluations: [
            {
              keyword: "测试品牌",
              nature: "negative",
              context: "平台的风险描述",
            },
            { keyword: "其他企业", nature: "positive", context: "无关评价" },
          ],
          referenceList: [
            { title: "检索参考", url: "https://example.org/search-only" },
          ],
        },
      ],
    });
    expect(sample).toMatchObject({
      sentiment: "negative",
      sentimentEvidence: ["平台的风险描述"],
      supplierTaskId: current.taskId,
    });
    expect(sample.citations).toHaveLength(1);
    expect(sample.references).toHaveLength(1);
    expect(sample.citations[0]?.url).not.toBe(sample.references?.[0]?.url);
    expect(Number.isFinite(Date.parse(sample.collectedAt!))).toBe(true);
  });

  it("prefers monitored-keyword ranking and rejects invalid numerical rankings", () => {
    const base = { ...answer(), answerContent: "相关企业信息。" };
    expect(
      diagnosticSampleFromResult(attempt(), "测试品牌", {
        subTaskList: [{ ...base, rank: 1, mentionPosition: "3" }],
      }),
    ).toMatchObject({ mentioned: true, rank: 3 });
    for (const rank of [0, -1, 1.5, "unknown", true])
      expect(
        diagnosticSampleFromResult(attempt(), "测试品牌", {
          subTaskList: [{ ...base, rank }],
        }),
      ).toMatchObject({ mentioned: false, rank: null });
  });
});

describe("host-owned diagnostic collection", () => {
  const binding = { contractVersion: "brand_single_sample_v1" as const, credentialId: "fixture", credentialVersion: 1, baseUrl: "https://provider.example/api/business/monitor" };
  const port = (request = vi.fn()) => ({ availability: () => ({ ready: true, binding, platforms: ["doubao"] }), request });
  it("does not submit without a configured host", async () => {
    const client = diagnosticMonitorClient();
    expect(client.configured).toBe(false);
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_NOT_CONFIGURED" });
  });
  it("submits one question and one platform with the persisted slot identity", async () => {
    const request = vi.fn().mockResolvedValue({ taskId: "provider-task-1" });
    const client = diagnosticMonitorClient(port(request), binding);
    await expect(client.submit(attempt(), "测试品牌")).resolves.toBe("provider-task-1");
    expect(request).toHaveBeenCalledWith(binding, "submit", { payload: {
      consumerTaskId: attempt().consumerTaskId, monitorKeywords: "测试品牌", monitorKeywordAliases: [], competitors: [],
      prompts: [questions[0]], platforms: [{ platform: "doubao", mode: "search", screenshot: 0 }],
    }});
  });
  it("accepts persisted bindings regardless of JSON key order", async () => {
    const request = vi.fn().mockResolvedValue({ taskId: "provider-task-1" });
    const reordered = Object.fromEntries(Object.entries(binding).reverse()) as typeof binding;
    await expect(diagnosticMonitorClient(port(request), reordered).submit(attempt(), "测试品牌")).resolves.toBe("provider-task-1");
  });
  it("blocks rotation before calling the provider", async () => {
    const request = vi.fn();
    const client = diagnosticMonitorClient(port(request), { ...binding, credentialVersion: 2 });
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_BINDING_CHANGED" });
    expect(request).not.toHaveBeenCalled();
  });
  it("does not invent a provider ID from an empty acceptance", async () => {
    const client = diagnosticMonitorClient(port(vi.fn().mockResolvedValue({})), binding);
    await expect(client.submit(attempt(), "测试品牌")).rejects.toMatchObject({ code: "MONITOR_SUBMISSION_UNKNOWN", ambiguous: true });
  });
  it("polls and stops only the original provider task", async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce({ status: "completed" }).mockResolvedValueOnce({ subTaskList: [answer()] }).mockResolvedValueOnce({});
    const client = diagnosticMonitorClient(port(request), binding);
    expect(await client.poll(attempt(), "测试品牌")).toBeNull();
    expect(await client.poll(attempt(), "测试品牌")).toMatchObject({ answer: answer().answerContent });
    await client.stop("provider-task-1");
    expect(request.mock.calls.map(call => call[1])).toEqual(["status", "status", "result", "stop"]);
    expect(request.mock.calls.every(call => call[2].taskId === "provider-task-1")).toBe(true);
  });
});
