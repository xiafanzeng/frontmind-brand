import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const h = vi.hoisted(() => ({router: async (_url: string, _init?: RequestInit) => new Response("{}", {status: 404})}));
vi.mock("./host.js", () => ({captureWorkspaceRestOperation: () => ({signal: new AbortController().signal, assertActive() {}, fetch: (url: string, init?: RequestInit) => h.router(url, init)})}));
import BrandResponseLogicEntry from "./BrandResponseLogicEntry";
import {__resetBrandRecordsStoreForTests} from "./response-logic-brand-adapter";
import {fingerprintLogic} from "../contracts/response-logic-evaluation";
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});
const original = {concern: "原稿关注点", conclusion: "原稿结论", facts: "原稿依据", boundaries: "原稿边界", pending: "待核验", references: "", images: [], attachments: []};
const candidate = {concern: "新稿关注点", conclusion: "新稿结论", facts: "新稿依据", boundaries: "新稿边界"};
const question = "如何选择知识管理系统？";
const props = {question: {id: "q-regen", question, category: "选型", subdivision: "", tableId: "table-test", rowIndex: 0, sourceRevision: null}, onBack() {}, visual: {Button: (p: any) => <button {...p}/>}, toast: {success() {}, error() {}}};
let record: any;
let posts: {url: string; body: any}[];
let completed: boolean;
let existing: boolean;
let saveFails: boolean;
beforeEach(() => {
  __resetBrandRecordsStoreForTests(); sessionStorage.clear(); posts = []; completed = false; existing = false; saveFails = false;
  HTMLDialogElement.prototype.showModal = function () {this.setAttribute("open", "");};
  HTMLDialogElement.prototype.close = function () {this.removeAttribute("open");};
  record = {id: "rec-regen", questionId: "q-regen", groupId: "brand-intent", groupTitle: "品牌意图优化", question, intent: "", summary: "", conversationId: "conv-regen", draft: structuredClone(original), revision: 3, version: 0, createdAt: 1, updatedAt: 1};
  h.router = async (url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); posts.push({url, body});
      if (url.endsWith("/regeneration")) {existing = true; return response({taskId: "new-draft-task", attempt: 0, recordRevision: record.revision});}
      if (saveFails) return response({error: {code: "RESPONSE_LOGIC_REVISION_CONFLICT", message: "其他窗口已修改草稿"}}, 409);
      record = {...record, draft: body.draft, revision: record.revision + 1}; return response({record});
    }
    if (url.includes("question-context")) return response({questionId: record.questionId, question, intent: "", workspaceRevision: 1});
    if (url.includes("/regeneration/recovery?")) return response(existing ? {status: "found", taskId: "new-draft-task", attempt: 0, recordRevision: record.revision, sourceFingerprint: fingerprintLogic(record.draft)} : {status: "none"});
    if (url.includes("/regeneration/tasks/")) return response(completed ? {status: "completed", taskId: "new-draft-task", recordRevision: record.revision, resultId: "result-new", source: "structured_output", structuredDraft: candidate} : {status: "running", taskId: "new-draft-task"}, completed ? 200 : 202);
    if (url.includes("/recovery?")) return response({status: "none"});
    return response({records: [record]});
  };
});
afterEach(() => {cleanup(); sessionStorage.clear();});
async function confirmGeneration() {
  const trigger = await screen.findByRole("button", {name: "重新生成应答逻辑"});
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", {name: "开始重新生成"}));
}
describe("real Brand regeneration entry, HTTP boundary only", () => {
  it("offers regeneration beside retry on Judge failure and preserves the draft", async () => {
    const base = h.router;
    h.router = async (url, init) => {
      if (url.includes("/judge/recovery?")) return response({status: "found", taskId: "failed-judge", attempt: 0, recordRevision: 3, sourceFingerprint: fingerprintLogic(original)});
      if (url.includes("/judge/tasks/")) return response({error: {code: "JUDGE_EVIDENCE_EXCERPT_INVALID", message: "评估引用未在原文找到"}}, 422);
      return base(url, init);
    };
    render(<BrandResponseLogicEntry {...props}/>);
    fireEvent.click(await screen.findByRole("button", {name: "查看四维评估"}));
    await screen.findByRole("button", {name: "重新发起评估"});
    const failedStage = document.querySelector(".rl-task-stage.is-failed");
    expect(failedStage?.textContent).toContain("校验评估结果并返回");
    await confirmGeneration();
    await waitFor(() => expect(posts.filter(p => p.url.endsWith("/regeneration"))).toHaveLength(1));
    expect(record.draft).toEqual(original);
    expect(screen.queryByText("LLM 语义评估未完成")).toBeNull();
  });
  it("cancels without dispatch and keeps all four current sections", async () => {
    render(<BrandResponseLogicEntry {...props}/>);
    const button = await screen.findByRole("button", {name: "重新生成应答逻辑"});
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("当前草稿会保留")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", {name: "取消"}));
    fireEvent.click(within(dialog).getByRole("button", {name: "取消"}));
    expect(posts).toEqual([]);
    for (const value of Object.values(candidate)) expect(screen.queryByText(value)).toBeNull();
    expect(screen.getByDisplayValue(original.boundaries)).toBeTruthy();
  });
  it("preserves the draft through completion and reload, adopts all four only on confirmation", async () => {
    let view = render(<BrandResponseLogicEntry {...props}/>);
    await confirmGeneration();
    await waitFor(() => expect(posts.filter(p => p.url.endsWith("/regeneration"))).toHaveLength(1));
    expect(record.draft).toEqual(original);
    expect((screen.getByDisplayValue(original.concern).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    completed = true; view.unmount(); view = render(<BrandResponseLogicEntry {...props}/>);
    const review = await screen.findByRole("region", {name: "重新生成的新稿对照"}, {timeout: 6000});
    for (const value of Object.values(candidate)) expect(within(review).getByText(value)).toBeTruthy();
    expect(record.draft).toEqual(original);
    expect(posts).toHaveLength(1);
    fireEvent.click(within(review).getByRole("button", {name: "采用新稿到草稿"}));
    await waitFor(() => expect(record.draft).toEqual({...original, ...candidate}));
    expect(posts.at(-1)?.body).toMatchObject({expectedRevision: 3, publish: false});
    expect(posts.filter(p => p.url.endsWith("/regeneration"))).toHaveLength(1);
  }, 12000);
  it("keeps the current draft when a candidate is discarded or adoption conflicts", async () => {
    existing = true; completed = true;
    render(<BrandResponseLogicEntry {...props}/>);
    const review = await screen.findByRole("region", {name: "重新生成的新稿对照"});
    saveFails = true;
    fireEvent.click(within(review).getByRole("button", {name: "采用新稿到草稿"}));
    await screen.findByText("其他窗口已修改草稿");
    expect(record.draft).toEqual(original);
    fireEvent.click(within(review).getByRole("button", {name: "保留当前稿"}));
    expect(screen.queryByRole("region", {name: "重新生成的新稿对照"})).toBeNull();
    expect(screen.getByDisplayValue(original.boundaries)).toBeTruthy();
  });
  it("does not dispatch a second task when the start response is lost", async () => {
    const base = h.router;
    h.router = async (url, init) => {
      if (url.endsWith("/regeneration") && init?.method === "POST") {
        await base(url, init); throw new TypeError("network lost");
      }
      return base(url, init);
    };
    let view = render(<BrandResponseLogicEntry {...props}/>); await confirmGeneration();
    await screen.findByRole("button", {name: "恢复查询"});
    completed = true; view.unmount(); view = render(<BrandResponseLogicEntry {...props}/>);
    await screen.findByRole("region", {name: "重新生成的新稿对照"});
    expect(posts.filter(p => p.url.endsWith("/regeneration"))).toHaveLength(1);
    expect(record.draft).toEqual(original);
  });
  it("reconciles a lost adoption response using GET without repeating the save", async () => {
    existing = true; completed = true;
    const base = h.router;
    h.router = async (url, init) => {
      const result = await base(url, init);
      if (init?.method === "POST" && url.endsWith("/response-logic")) throw new TypeError("response lost after commit");
      return result;
    };
    render(<BrandResponseLogicEntry {...props}/>);
    fireEvent.click(await screen.findByRole("button", {name: "采用新稿到草稿"}));
    await screen.findByDisplayValue(candidate.boundaries);
    expect(posts).toHaveLength(1);
    expect(record.draft).toEqual({...original, ...candidate});
  });
});
