import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./host", () => ({
  captureWorkspaceRestOperation: () => ({
    fetch: mock.fetch,
    assertActive: () => {},
    headers: (v: any) => v,
  }),
}));
import BrandDiagnosticWorkspace from "./BrandDiagnosticWorkspace";
import {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_LABELS,
} from "../contracts/diagnostics";
const id = "b1f96519-c17d-4841-a996-dd3e34cc04d3";
const makeRun = () => ({
  id,
  revision: 0,
  phase: "draft",
  subject: "测试医院（医学美容科）",
  subjectScope: "医学美容科",
  basis: { version: 1, snapshotId: "snapshot" },
  questions: [],
  platforms: ["doubao", "yuanbao", "qianwen"],
  recommendations: [],
  activity: { assessments: {}, audits: {} },
  attempts: [],
  results: {},
  events: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expectedSamples: 60,
  completedSamples: 0,
});
let run: any, ready: boolean;
beforeEach(() => {
  ready = true;
  run = makeRun();
  localStorage.clear();
  history.replaceState({}, "", "/?view=diagnostics");
  mock.fetch.mockReset();
  mock.fetch.mockImplementation(async (path: string, init: any) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (path.endsWith("/diagnostics"))
      return {
        ok: true,
        json: async () => ({
          knowledge: {
            ready,
            status: ready ? "ready" : "confirming",
            companyName: "测试医院",
            version: 1,
            snapshotId: "snapshot",
            message: ready ? "全部节点已确认" : "仍有 2 项待确认",
          },
          platforms: [
            { id: "doubao", label: "豆包" },
            { id: "yuanbao", label: "元宝" },
            { id: "qianwen", label: "千问" },
          ],
          runs: [],
        }),
      };
    if (path.endsWith("/knowledge")) return { ok: true, json: async () => [] };
    if (path.endsWith("/retry")) run.phase = run.confirmedAt ? "collecting" : "draft";
    if (path.endsWith("/draft")) {
      run.questions = body.questions;
      run.platforms = body.platforms;
      run.revision++;
    }
    if (path.endsWith("/validate"))
      run.questions = run.questions.map((q: any) => ({
        ...q,
        validation: {
          accepted: true,
          reason: "符合本类问题要求",
          inputHash: "test",
        },
      }));
    if (path.endsWith("/start")) {
      run.phase = "collecting";
      run.confirmedAt = new Date().toISOString();
    }
    if (path.endsWith("/semantic-audits"))
      for (const category of body.categories)
        run.activity.audits[category] = { status: "running" };
    if (path.includes("/answers/"))
      return {
        ok: true,
        json: async () => ({
          id: "sample1",
          platform: "doubao",
          run: 1,
          answer: "这里只在展开后出现的原始回答",
          citations: [],
          references: [],
        }),
      };
    return { ok: true, json: async () => structuredClone(run) };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("single-page diagnostic interaction", () => {
  it("clears a transient read failure after a successful poll without hiding action errors", async () => {
    let poll: (() => void) | undefined;
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, delay: number) => {
      if (delay === 4000) poll = fn;
      return interval(fn, delay);
    }) as any);
    mock.fetch.mockRejectedValueOnce(new Error("暂时读取失败"));
    render(<BrandDiagnosticWorkspace />);
    expect((await screen.findByRole("alert")).textContent).toContain("暂时读取失败");
    await act(async () => { poll!(); });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    mock.fetch.mockRejectedValueOnce(new Error("提交被拒绝"));
    fireEvent.click(screen.getByRole("button", { name: /推荐/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("提交被拒绝");
    await act(async () => { poll!(); });
    expect(screen.getByRole("alert").textContent).toContain("提交被拒绝");
  });
  function withSavedResult() {
    run.phase = "completed";
    run.confirmedAt = new Date().toISOString();
    run.results.reputation = {
      assessment: {
        category: "reputation",
        summary: "本题口碑表达存在需要核验的边界。",
        answers: [],
        topics: [
          {
            topic: "科室服务边界",
            verdict: "supported",
            docPath: "scope.md",
            kbExcerpt: "科室提供相关服务",
            answerRefs: [{ sampleId: "sample1", excerpt: "科室服务相关摘录" }],
            explanation: "该表述与当前知识一致。",
          },
        ],
      },
      metrics: [],
      samples: 15,
      model: "gpt-6.1-sol",
      fallback: false,
      breakdown: {
        platforms: [],
        ranks: [],
        risks: [],
        coverage: [],
        sources: [],
        drilldowns: [],
      },
    };
    run.attempts = [1, 2].map((index) => ({
      id: `sample${index}`,
      category: "reputation",
      platform: "doubao",
      run: index,
      status: "completed",
      hasAnswer: true,
    }));
    history.replaceState({}, "", `/?diagnosis=${id}`);
  }

  it("adds only a semantic audit to saved answers and can stop it after the old task completed", async () => {
    withSavedResult();
    render(<BrandDiagnosticWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: "复用回答，补充语义评估" }),
    );
    await screen.findByRole("button", { name: "停止本轮" });
    expect(
      mock.fetch.mock.calls.filter(([url]) => url.endsWith("/semantic-audits")),
    ).toHaveLength(1);
    const auditRequest = mock.fetch.mock.calls.find(([url]) =>
      url.endsWith("/semantic-audits"),
    )!;
    expect(JSON.parse(auditRequest[1].body)).toEqual({
      categories: ["reputation"],
    });
    expect(
      mock.fetch.mock.calls.some(([url]) =>
        /\/(start|recommend|validate)$/.test(url),
      ),
    ).toBe(false);
    expect(
      document
        .getElementById("diagnostic-knowledge")!
        .compareDocumentPosition(
          document.getElementById("diagnostic-results")!,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "知识库对照" })).toHaveLength(
      1,
    );
  });

  it("restores a knowledge-evidence drilldown without loading unrelated full answers", async () => {
    withSavedResult();
    history.replaceState(
      {},
      "",
      `/?diagnosis=${id}&question=reputation&metric=topic%3A0`,
    );
    render(<BrandDiagnosticWorkspace />);
    await screen.findByRole("button", { name: /豆包 · 第 1 次/ });
    expect(screen.queryByRole("button", { name: /豆包 · 第 2 次/ })).toBeNull();
    expect(
      mock.fetch.mock.calls.some(([url]) => url.includes("/answers/")),
    ).toBe(false);
  });

  it("shows the active recovery instead of a superseded failure", async () => {
    run.phase = "analyzing";
    run.confirmedAt = new Date().toISOString();
    run.activity.assessments.reputation = { status: "running" };
    run.jobs = [
      {
        status: "failed",
        model: "gpt-6.1-sol",
        kind: "assess",
        category: "reputation",
      },
    ];
    run.events = [
      { at: new Date().toISOString(), message: "不应显示的内部事件" },
    ];
    history.replaceState({}, "", `/?diagnosis=${id}`);
    render(<BrandDiagnosticWorkspace />);
    await screen.findByText("正在分析");
    expect(screen.queryByText("诊断未完成")).toBeNull();
    expect(
      screen.queryByText(
        /查看执行记录|更新时间|gpt-6.1-sol|不应显示的内部事件/,
      ),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复未完成诊断" })).toBeNull();
  });

  it("restores the task URL when returning to an unsaved local question draft", async () => {
    localStorage.setItem(
      "brand-diagnostic-draft",
      JSON.stringify({
        runId: id,
        subjectScope: "医学美容科",
        platforms: ["doubao", "yuanbao", "qianwen"],
        questions: [
          {
            category: "product_scenario",
            text: "我的未保存问题",
            source: "custom",
          },
        ],
      }),
    );
    render(<BrandDiagnosticWorkspace />);
    await waitFor(() =>
      expect(new URLSearchParams(location.search).get("diagnosis")).toBe(id),
    );
    expect(
      (screen.getByLabelText("产品场景问题") as HTMLTextAreaElement).value,
    ).toBe("我的未保存问题");
    expect(mock.fetch.mock.calls.some(([url]) => url.endsWith("/drafts"))).toBe(
      false,
    );
  });
  it("blocks question selection until knowledge is confirmed", async () => {
    ready = false;
    const onOpenKnowledge = vi.fn();
    render(<BrandDiagnosticWorkspace onOpenKnowledge={onOpenKnowledge} />);
    await screen.findByText("仍有 2 项待确认");
    expect(screen.queryByLabelText("行业排名问题")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /开始采集/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "前往智能知识库" }),
    );
    expect(onOpenKnowledge).toHaveBeenCalledOnce();
  });
  it("resumes the same initial diagnosis and retains unsaved questions after stopping", async () => {
    run.phase = "stopped";
    localStorage.setItem(
      "brand-diagnostic-draft",
      JSON.stringify({
        runId: id,
        subjectScope: "医学美容科",
        platforms: ["doubao", "yuanbao", "qianwen"],
        questions: [
          {
            category: "product_scenario",
            text: "保留这道自定义问题",
            source: "custom",
          },
        ],
      }),
    );
    render(<BrandDiagnosticWorkspace />);
    const button = await screen.findByRole("button", {
      name: "继续本次初诊",
    });
    expect(
      (screen.getByLabelText("产品场景问题") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    fireEvent.click(button);
    expect(
      (screen.getByLabelText("产品场景问题") as HTMLTextAreaElement).value,
    ).toBe("保留这道自定义问题");
    await waitFor(() => expect(
      (screen.getByLabelText("产品场景问题") as HTMLTextAreaElement).disabled,
    ).toBe(false));
    expect(new URLSearchParams(location.search).get("diagnosis")).toBe(id);
    expect(mock.fetch.mock.calls.some(([url]) => url.endsWith("/start"))).toBe(
      false,
    );
  });
  it("supports all four custom questions, freezes 60 slots at one start action, and invalidates edits", async () => {
    render(<BrandDiagnosticWorkspace />);
    await screen.findByLabelText("行业排名问题");
    for (const c of DIAGNOSTIC_CATEGORIES)
      fireEvent.change(screen.getByLabelText(`${DIAGNOSTIC_LABELS[c]}问题`), {
        target: { value: `这是${DIAGNOSTIC_LABELS[c]}的自定义问题？` },
      });
    fireEvent.click(screen.getByRole("button", { name: /保存并校验/ }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /开始采集/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByText("份真实回答 · 4 题 × 3 平台 × 5 次")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("行业排名问题"), {
      target: { value: "相关地区有哪些合适的机构推荐？" },
    });
    expect(
      (screen.getByRole("button", { name: /开始采集/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /保存并校验/ }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /开始采集/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /开始采集/ }));
    await screen.findByRole("button", { name: /停止本轮/ });
    expect(
      mock.fetch.mock.calls.filter(([url]) => url.endsWith("/start")),
    ).toHaveLength(1);
    expect(
      mock.fetch.mock.calls
        .filter(([url]) => url.endsWith("/draft"))
        .every(([, init]) =>
          JSON.parse(init.body).questions.every((q: any) => !q.validation),
        ),
    ).toBe(true);
  });
  it("loads full answers only after selection and restores the selected answer from URL", async () => {
    run.phase = "collecting";
    run.confirmedAt = new Date().toISOString();
    run.attempts = [
      {
        id: "sample1",
        category: "industry_ranking",
        platform: "doubao",
        run: 1,
        status: "completed",
        hasAnswer: true,
      },
    ];
    history.replaceState({}, "", `/?diagnosis=${id}&question=industry_ranking`);
    render(<BrandDiagnosticWorkspace />);
    await screen.findByRole("button", { name: /豆包 · 第 1 次/ });
    expect(
      mock.fetch.mock.calls.some(([url]) => url.includes("/answers/")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /豆包 · 第 1 次/ }));
    await screen.findByText("这里只在展开后出现的原始回答");
    expect(new URLSearchParams(location.search).get("answer")).toBe("sample1");
    cleanup();
    render(<BrandDiagnosticWorkspace />);
    await screen.findByText("这里只在展开后出现的原始回答");
    fireEvent.click(screen.getByRole("button", { name: "关闭回答详情" }));
    expect(screen.queryByText("这里只在展开后出现的原始回答")).toBeNull();
    expect(new URLSearchParams(location.search).get("answer")).toBeNull();
  });
});
