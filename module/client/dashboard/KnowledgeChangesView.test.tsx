import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {emptyIntentState, type IntentChange, type IntentNode, type IntentReceipt} from "../../contracts/intent-workbench";
import type {IntentWorkbenchApi} from "./intent-workbench-api";

vi.mock("../host", () => ({
  useWorkspaceDraftGuard: vi.fn(), projectWorkspaceUrl: (path: string) => path,
  requestWorkspaceNavigation: vi.fn(),
}));
vi.mock("./ManagedKeywordTables", () => ({default: () => null}));
vi.mock("@frontmind/module-ui/components/MarkdownRenderer", () => ({default: ({content}: {content: string}) => <p>{content}</p>}));
import IntentWorkbench from "./IntentWorkbench";

const node = (id: string, content: string): IntentNode => ({
  id, title: `节点${id}`, branch: "品牌资料", content, verified: true, editable: true,
});
const change = (id: string, status: IntentChange["status"] = "succeeded"): IntentChange => ({
  questionId: "q1", status,
  action: {id: `action-${id}`, kind: "node", nodeId: id, selected: true,
    title: `补充节点${id}`, source: "已核验资料", before: "保留正文\n旧口径", after: "保留正文\n新口径"},
});
beforeEach(() => {Element.prototype.scrollIntoView = vi.fn();});
afterEach(cleanup);

async function openChanges(changes: IntentChange[], nodes: IntentNode[] = [], status: IntentReceipt["status"] = "completed") {
  const receipt: IntentReceipt = {id: "receipt-1", status, createdAt: "2026-10-24T13:58:15Z",
    changes, before: [], after: []};
  const api: IntentWorkbenchApi = {
    observe: vi.fn(async () => ({revision: 1, preview: false, nodes,
      state: {...emptyIntentState(), receipts: [receipt]}})),
    command: vi.fn(), execute: vi.fn(), rollback: vi.fn(),
  };
  render(<IntentWorkbench api={api} initialView="list" keywordProps={{} as any}/>);
  fireEvent.click(await screen.findByRole("button", {name: /历史记录/}));
  fireEvent.click(await screen.findByRole("button", {name: "查看执行记录"}));
  fireEvent.click(await screen.findByRole("button", {name: "查看知识库变更"}));
  expect(api.command).not.toHaveBeenCalled();
  expect(api.execute).not.toHaveBeenCalled();
  expect(api.rollback).not.toHaveBeenCalled();
  return api;
}

it("执行记录进入知识变更时优先展示实际修改节点的逐行diff", async () => {
  await openChanges([change("changed")], [node("unrelated", "无关节点正文"), node("changed", "保留正文\n新口径")]);
  const diff = screen.getByLabelText("逐行内容差异");
  expect(within(diff).getByText("旧口径")).toBeTruthy();
  expect(within(diff).getByText("新口径")).toBeTruthy();
  expect(diff.querySelector(".remove pre")?.textContent).toBe("旧口径");
  expect(diff.querySelector(".add pre")?.textContent).toBe("新口径");
  expect(screen.queryByText("无关节点正文")).toBeNull();
});

it("历史节点已移除且执行已撤销时，仍展示原前后快照而不借用其他节点", async () => {
  await openChanges([change("2.1", "reverted")], [node("other", "当前其他正文")], "reverted");
  expect(screen.getByLabelText("逐行内容差异")).toBeTruthy();
  expect(screen.getByText(/当前知识库已无此节点/)).toBeTruthy();
  expect(screen.getByText(/本次修改已撤销/)).toBeTruthy();
  expect(screen.getByRole("button", {name: "当前正文"})).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", {name: "前后全文"}));
  const snapshots = document.querySelectorAll(".iw-snapshot-grid pre");
  expect([...snapshots].map(item => item.textContent)).toEqual(["保留正文\n旧口径", "保留正文\n新口径"]);
  expect(screen.queryByText("当前其他正文")).toBeNull();
});

it("仅修改问题和创建资料待办时明确提示无正文变更，不制造正文diff", async () => {
  const question = {...change("question"), action: {...change("question").action, kind: "question" as const, nodeId: null}};
  const todo = {...change("todo"), action: {...change("todo").action, kind: "todo" as const, nodeId: null}};
  await openChanges([question, todo], [node("other", "当前正文不应被当作diff")]);
  expect(screen.getByRole("heading", {name: "本次未修改知识库正文"})).toBeTruthy();
  expect(screen.getByText(/问题操作 1 项/)).toBeTruthy();
  expect(screen.queryByLabelText("逐行内容差异")).toBeNull();
  expect(screen.queryByText("当前正文不应被当作diff")).toBeNull();
});

it("正文写入失败时不把方案中的after当作已完成的diff", async () => {
  await openChanges([{...change("failed", "failed"), error: "节点发生冲突"}], [], "partial");
  expect(screen.getByRole("heading", {name: "本次未成功修改知识库正文"})).toBeTruthy();
  expect(screen.getByText(/节点发生冲突/)).toBeTruthy();
  expect(screen.queryByLabelText("逐行内容差异")).toBeNull();
});

it("切换本次不同变更节点仍默认展示diff，当前正文另行查看", async () => {
  await openChanges([change("a"), {...change("b"), action: {...change("b").action, before: "B旧文", after: "B新文"}}],
    [node("a", "之后又修改的当前正文"), node("b", "B新文")]);
  expect(screen.getByText(/当前节点已有后续变化/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "当前正文"}));
  expect(screen.getByText("之后又修改的当前正文")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: /节点b/}));
  const diff = screen.getByLabelText("逐行内容差异");
  expect(within(diff).getByText("B旧文")).toBeTruthy();
  expect(within(diff).getByText("B新文")).toBeTruthy();
  expect(screen.getByRole("button", {name: "变更对比"}).getAttribute("aria-pressed")).toBe("true");
});
