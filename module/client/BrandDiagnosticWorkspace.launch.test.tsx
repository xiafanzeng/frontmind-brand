// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DIAGNOSTIC_CATEGORIES } from "../contracts/diagnostics";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./host", () => ({ captureWorkspaceRestOperation: () => ({ assertActive() {}, headers: (headers: any) => headers, fetch: mock.fetch }) }));
import BrandDiagnosticWorkspace from "./BrandDiagnosticWorkspace";
const root = "/api/modules/brand/diagnostics";
const run = () => ({ id: "test-run", revision: 1, version: 1, phase: "draft", subject: "测试学校", subjectScope: "", createdAt: "2026-11-03T00:00:00Z", basis: { snapshotId: "snapshot", kind: "working_set", companyName: "测试学校", version: 1, confirmed: 0, total: 30, contentHash: "hash" },
  platforms: ["doubao", "yuanbao", "qianwen"], questions: DIAGNOSTIC_CATEGORIES.map((category, i) => ({ category, text: `测试问题${i}？`, source: "recommended", validation: { accepted: true, reason: "已校验" } })),
  recommendations: [{ category: "industry_ranking", text: "广西有哪些轨道交通职业学校？", rationale: "不应展示的理由", evidenceRefs: ["private/path.md"] }], attempts: [], results: {}, activity: { assessments: {}, audits: {} }, expectedSamples: 60, completedSamples: 0 });
const workspace = { knowledge: { ready: true, status: "confirming", message: "工作稿可用", bases: [], companyName: "测试学校", confirmed: 0, total: 30 }, initialRunId: "test-run", platforms: [{ id: "doubao", label: "豆包" }, { id: "yuanbao", label: "元宝" }, { id: "qianwen", label: "千问" }], collection: { ready: true, platforms: ["doubao", "yuanbao", "qianwen"] } };
function reply(data: any, ok = true) { return { ok, json: async () => data }; }
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/?diagnosis=test-run"); mock.fetch.mockReset(); });
afterEach(cleanup);
describe("diagnostic launch feedback", () => {
  it("shows only candidate questions and reports launch failure beside the button", async () => {
    mock.fetch.mockImplementation(async (url: string) => url === root ? reply(workspace) : url.endsWith("/start") ? reply({ error: { message: "正式采集凭据未就绪" } }, false) : reply(run()));
    render(<BrandDiagnosticWorkspace />);
    const start = await screen.findByRole("button", { name: /开始采集并诊断/ });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText("不应展示的理由")).toBeNull();
    expect(screen.queryByLabelText("推荐知识依据")).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(document.querySelector("#diagnostic-collection")?.textContent).toContain("正式采集凭据未就绪"));
    expect(mock.fetch.mock.calls.filter(([url]) => url.endsWith("/start"))).toHaveLength(1);
  });
  it("recovers an accepted launch after a lost response without posting twice", async () => {
    let accepted = false;
    mock.fetch.mockImplementation(async (url: string) => {
      if (url === root) return reply(workspace);
      if (url.endsWith("/start")) { accepted = true; throw new TypeError("Network interrupted"); }
      return reply({ ...run(), ...(accepted ? { phase: "collecting", confirmedAt: "2026-11-03T00:00:00Z", attempts: Array.from({ length: 60 }, (_, i) => ({ id: `slot-${i}`, category: DIAGNOSTIC_CATEGORIES[Math.floor(i / 15)], platform: ["doubao", "yuanbao", "qianwen"][Math.floor(i / 5) % 3], run: i % 5 + 1, status: "queued" })) } : {}) });
    });
    render(<BrandDiagnosticWorkspace />);
    const start = await screen.findByRole("button", { name: /开始采集并诊断/ });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start); fireEvent.click(start);
    await screen.findByText("0 / 60");
    expect(document.querySelector("#diagnostic-collection")?.textContent).toContain("待提交 60");
    expect(mock.fetch.mock.calls.filter(([url]) => url.endsWith("/start"))).toHaveLength(1);
  });
});
