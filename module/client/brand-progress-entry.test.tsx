import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  calls: [] as string[],
  router: async (_url: string, _init?: RequestInit) =>
    new Response("{}", { status: 404 }),
}));
vi.mock("./host.js", () => ({
  captureWorkspaceRestOperation: () => ({
    signal: new AbortController().signal,
    assertActive() {},
    fetch: (url: string, init?: RequestInit) => {
      h.calls.push(`${init?.method ?? "GET"} ${url}`);
      return h.router(url, init);
    },
  }),
}));
import { judgeOutputSchema } from "../contracts/response-logic-judge";
import { fingerprintLogic } from "../contracts/response-logic-evaluation";
import BrandResponseLogicEntry from "./BrandResponseLogicEntry";
import { __resetBrandRecordsStoreForTests } from "./response-logic-brand-adapter";
const question = "企业如何选择知识管理系统？";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const draft = {
  concern: "关注权限与维护",
  conclusion: "按场景试用",
  facts: "参考官方材料",
  boundaries: "不保证效果",
  pending: "",
  references: "",
  images: [],
  attachments: [],
};
const record = {
  id: "r-progress",
  questionId: "q-progress",
  groupId: "brand-intent",
  groupTitle: "品牌意图优化",
  question,
  intent: "",
  summary: "",
  conversationId: "conv-progress",
  draft,
  revision: 3,
  version: 0,
  createdAt: 1,
  updatedAt: 1,
};
const execution = {
  schemaVersion: 1,
  taskId: "t-progress",
  coverage: "partial",
  timeline: [
    {
      id: "e-progress",
      kind: "status",
      status: "running",
      turnId: "t-progress:1",
      userSequence: 1,
      timestamp: 1000,
      rank: 1,
    },
  ],
};
const validJudge = judgeOutputSchema.parse({
  kind: "judge-evaluation",
  dimensions: {
    relevance: { score: 85, band: "mostly_relevant", findings: [] },
    completeness: {
      score: 75,
      coverage: [
        { field: "concern", status: "covered", findings: [] },
        { field: "conclusion", status: "covered", findings: [] },
        { field: "facts", status: "partial", findings: [] },
        { field: "boundaries", status: "partial", findings: [] },
      ],
      findings: [],
    },
    actionability: {
      score: 67,
      subMetrics: [
        {
          key: "content_specificity",
          score: 75,
          band: "mostly_actionable",
          findings: [],
        },
        {
          key: "evidence_guidance",
          score: 60,
          band: "moderately_actionable",
          findings: [],
        },
        {
          key: "structure_guidance",
          score: 65,
          band: "moderately_actionable",
          findings: [],
        },
      ],
      findings: [],
    },
    boundaryRisk: {
      score: 63,
      risks: [
        { key: "unverified_ranking", status: "controlled", findings: [] },
        { key: "absolute_claim", status: "controlled", findings: [] },
        { key: "effect_promise", status: "uncontrolled", findings: [] },
        { key: "unverified_comparison", status: "undetected", findings: [] },
        { key: "unsupported_fact", status: "partial", findings: [] },
        { key: "missing_precondition", status: "not_applicable", findings: [] },
      ],
      findings: [],
    },
  },
  overallAssessment: "整体回应了选型问题。",
});

const props = {
  question: { id: "q-progress", question, category: "选型", subdivision: "", tableId: "table-test", rowIndex: 0, sourceRevision: null },
  onBack() {},
  visual: { Button: (p: any) => <button {...p} /> },
  toast: { success() {}, error() {} },
};
beforeEach(() => {
  __resetBrandRecordsStoreForTests();
  sessionStorage.clear();
  h.calls = [];
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
describe("real Brand entry progress (only HTTP mocked)", () => {
  it("restores a server task with no browser hint through the real entry without POST", async () => {
    h.router = async (url) => {
      if (url.includes("/recovery?"))
        return response({
          status: "found",
          taskId: "t-progress",
          attempt: 0,
          recordRevision: 3,
          sourceFingerprint: fingerprintLogic(draft),
        });
      if (url.includes("/judge/tasks/"))
        return response(
          { status: "running", taskId: "t-progress", execution },
          202,
        );
      if (url.includes("question-context"))
        return response({
          questionId: record.questionId,
          question,
          intent: "",
          workspaceRevision: 1,
        });
      return response({ records: [record] });
    };
    render(<BrandResponseLogicEntry {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "查看四维评估" }),
    );
    await screen.findByRole("region", { name: "任务阶段" });
    await waitFor(() =>
      expect(h.calls.some((c) => c.includes("/judge/tasks/"))).toBe(true),
    );
    expect(h.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });
  it("restores a generation task and presents stages without creating a new task", async () => {
    h.router = async (url) =>
      url.includes("/tasks/")
        ? response(
            {
              status: "running",
              taskId: "t-progress",
              operationRevision: 3,
              model: "frontmind-pro",
              execution,
            },
            202,
          )
        : url.includes("question-context")
          ? response({
              questionId: "q-generation",
              question,
              intent: "",
              workspaceRevision: 1,
            })
          : response({
              records: [
                {
                  ...record,
                  questionId: "q-generation",
                  lastTaskId: "t-progress",
                  draft: {
                    ...draft,
                    concern: "",
                    conclusion: "",
                    facts: "",
                    boundaries: "",
                  },
                },
              ],
            });
    render(
      <BrandResponseLogicEntry
        {...props}
        question={{ ...props.question, id: "q-generation" }}
      />,
    );
    await screen.findByRole("region", { name: "任务阶段" });
    expect(screen.getByText("分析资料并生成四段应答逻辑")).toBeTruthy();
    expect(h.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect(
      Array.from(document.querySelectorAll("textarea")).every((e) =>
        e.matches(":disabled"),
      ),
    ).toBe(true);
  });
  it("passes Judge progress through the real client/hook and restores with GET after remount", async () => {
    h.router = async (url, init) =>
      url.includes("/recovery?")
        ? response({ status: "none" })
        : url.includes("question-context")
          ? response({
              questionId: record.questionId,
              question,
              intent: "",
              workspaceRevision: 1,
            })
          : url.includes("/judge/tasks/")
            ? response(
                { status: "running", taskId: "t-progress", execution },
                202,
              )
            : url.includes("/evaluation/judge") && init?.method === "POST"
              ? response({
                  taskId: "t-progress",
                  attempt: 0,
                  recordRevision: 3,
                  sourceFingerprint: "server",
                  knowledgeFingerprint: "none",
                })
              : response({ records: [record] });
    let view = render(<BrandResponseLogicEntry {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "查看四维评估" }),
    );
    await waitFor(() =>
      expect(h.calls.some((c) => c.startsWith("POST"))).toBe(true),
    );
    await screen.findByRole("region", { name: "任务阶段" });
    await waitFor(
      () => expect(h.calls.some((c) => c.includes("/judge/tasks/"))).toBe(true),
      { timeout: 5000 },
    );
    expect(screen.queryByText(/四项独立评分，不设综合分/)).toBeNull();
    view.unmount();
    const posts = h.calls.filter((c) => c.startsWith("POST")).length;
    const gets = h.calls.filter((c) => c.includes("/judge/tasks/")).length;
    view = render(<BrandResponseLogicEntry {...props} />);
    await waitFor(
      () =>
        expect(
          h.calls.filter((c) => c.includes("/judge/tasks/")).length,
        ).toBeGreaterThan(gets),
      { timeout: 5000 },
    );
    expect(h.calls.filter((c) => c.startsWith("POST")).length).toBe(posts);
  });
  it("restores the optimizer through the real Brand entry without adopting the candidate", async () => {
    const qid = "q-optimizer";
    let complete = false;
    const candidate = {
      kind: "judge-optimization",
      summary: "真实契约样例摘要",
      optimizedDraft: {
        concern: draft.concern,
        conclusion: draft.conclusion,
        facts: draft.facts,
        boundaries: draft.boundaries,
      },
      changes: [{ field: "concern", summary: "样例修改原因", evidence: [] }],
    };
    h.router = async (url, init) => {
      if (url.includes("/recovery?")) return response({ status: "none" });
      if (url.includes("question-context"))
        return response({
          questionId: qid,
          question,
          intent: "",
          workspaceRevision: 1,
        });
      if (url.includes("/judge/tasks/"))
        return response({
          status: "completed",
          judgeVersion: "1",
          recordRevision: 3,
          sourceFingerprint: "server",
          evaluatedAt: "2026-11-05T00:00:00.000Z",
          judge: validJudge,
        });
      if (url.includes("/evaluation/judge") && init?.method === "POST")
        return response({
          taskId: "judge-full-path",
          attempt: 0,
          recordRevision: 3,
          sourceFingerprint: "server",
          knowledgeFingerprint: "none",
        });
      if (url.includes("/optimization/tasks/"))
        return complete
          ? response({
              status: "completed",
              optimizerVersion: "1",
              recordRevision: 3,
              sourceFingerprint: "server",
              judgeTaskId: "judge-full-path",
              knowledgeFingerprint: "none",
              evaluatedAt: "2026-11-05T00:00:00.000Z",
              optimization: candidate,
            })
          : response(
              {
                status: "running",
                execution: { ...execution, taskId: "optimizer-full-path" },
              },
              202,
            );
      if (url.endsWith("/optimization") && init?.method === "POST")
        return response({
          taskId: "optimizer-full-path",
          recordRevision: 3,
          sourceFingerprint: "server",
          judgeTaskId: "judge-full-path",
          knowledgeFingerprint: "none",
        });
      return response({ records: [{ ...record, questionId: qid }] });
    };
    const entry = () => (
      <BrandResponseLogicEntry
        {...props}
        question={{ ...props.question, id: qid }}
      />
    );
    let view = render(entry());
    fireEvent.click(
      await screen.findByRole("button", { name: "查看四维评估" }),
    );
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "生成优化方案 →" },
        { timeout: 5000 },
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "生成优化版本" }),
    );
    await screen.findByRole("region", { name: "任务阶段" });
    await waitFor(
      () =>
        expect(h.calls.some((c) => c.includes("/optimization/tasks/"))).toBe(
          true,
        ),
      { timeout: 5000 },
    );
    const posts = h.calls.filter((c) => c.startsWith("POST")).length;
    complete = true;
    view.unmount();
    view = render(entry());
    await waitFor(() =>
      expect(
        h.calls.filter((c) => c.includes("/optimization/tasks/")).length,
      ).toBeGreaterThan(1),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "查看四维评估" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "生成优化方案 →" }),
    );
    await screen.findByText("真实契约样例摘要");
    expect(h.calls.filter((c) => c.startsWith("POST")).length).toBe(posts);
    expect(h.calls.some((c) => /adopt|^PUT|^PATCH/.test(c))).toBe(false);
    expect(
      screen.getByRole("button", { name: "采用选中项到草稿" }),
    ).toBeTruthy();
  }, 12000);
});
