import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RagConversationHistory } from "./RagConversationHistory";

const nativeElementMatches = Element.prototype.matches;
beforeEach(() => { sessionStorage.clear(); vi.spyOn(Element.prototype, "matches").mockImplementation(function(this: Element, selector) {
  if (selector === ":modal" || selector === ":fullscreen") return false;
  return nativeElementMatches.call(this, selector);
}); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });
const items = [{ id: "one", title: "企业能力介绍" }, { id: "two", title: "部署要求" }, { id: "running", title: "正在回答", disabled: true }];
const props = () => ({ scopeKey: "test-scope", items, activeId: "one", onNew: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onOpen: vi.fn() });
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
  return await screen.findByRole("dialog", { name: "历史问答" });
}
describe("conversation history", () => {
  it("locks only the deleting conversation while keeping new, other histories and examples available", async () => {
    const callbacks = props();
    const onSelectExample = vi.fn(async () => true);
    render(<RagConversationHistory {...callbacks} deletingId="one" newDisabled={false} examples={[{ id: "example", title: "能力示例" }]} onSelectExample={onSelectExample} />);
    const create = screen.getByRole("button", { name: "新建问答" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create);
    expect(callbacks.onNew).toHaveBeenCalledOnce();
    const dialog = await open();
    const deleting = within(dialog).getByRole("button", { name: "企业能力介绍" }) as HTMLButtonElement;
    expect(deleting.disabled).toBe(true);
    expect(deleting.hasAttribute("title")).toBe(false);
    expect(within(dialog).queryByText("正在删除此对话")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "部署要求" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(dialog).getByRole("button", { name: "能力示例 示例" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "部署要求" }));
    await waitFor(() => expect(callbacks.onSelect).toHaveBeenCalledWith("two"));
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("allows an explicitly enabled New action while busy history rows remain locked", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} busy newDisabled={false} />);
    const create = screen.getByRole("button", { name: "新建问答" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create);
    expect(callbacks.onNew).toHaveBeenCalledOnce();
    const dialog = await open();
    expect((within(dialog).getByRole("button", { name: "部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "删除部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "部署要求" }));
    expect(callbacks.onSelect).not.toHaveBeenCalled(); expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("keeps examples readable while history loads, with separate selection and no delete action", async () => {
    const callbacks = props();
    const onSelectExample = vi.fn();
    const examples = [{ id: "example-capability", title: "能力介绍示例" }, { id: "example-risk", title: "风险判断示例" }];
    render(<RagConversationHistory {...callbacks} loading examples={examples} activeExampleId="example-capability" onSelectExample={onSelectExample} />);
    expect((screen.getByRole("button", { name: "新建问答" }) as HTMLButtonElement).disabled).toBe(false);
    const dialog = await open();
    expect(within(dialog).getByRole("status", { name: "正在加载历史问答" }).textContent).toBe("");
    expect(within(dialog).queryByText("正在加载历史问答…")).toBeNull();
    const section = within(dialog).getByRole("region", { name: "预览问答" });
    expect(within(section).getAllByText("示例")).toHaveLength(2);
    expect(within(section).queryByRole("button", { name: /^删除/ })).toBeNull();
    const active = within(section).getByRole("button", { name: "能力介绍示例 示例" });
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.closest("li")?.getAttribute("data-active")).toBe("true");
    expect(active.querySelector("svg")).toBeNull();
    const next = within(section).getByRole("button", { name: "风险判断示例 示例" });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    expect(onSelectExample).toHaveBeenCalledWith("example-risk");
    expect(callbacks.onSelect).not.toHaveBeenCalled(); expect(callbacks.onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "新建问答" }));
    expect(callbacks.onNew).toHaveBeenCalledOnce();
  });

  it("keeps examples available when real-history loading fails", async () => {
    const callbacks = props(); const onSelectExample = vi.fn();
    render(<RagConversationHistory {...callbacks} error="读取历史失败" examples={[{ id: "example", title: "能力示例" }]} onSelectExample={onSelectExample} />);
    const dialog = await open();
    expect(within(dialog).getByRole("alert").textContent).toBe("读取历史失败");
    const example = within(dialog).getByRole("button", { name: "能力示例 示例" });
    expect((example as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(example); expect(onSelectExample).toHaveBeenCalledWith("example");
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it.each(["false", "rejection"])("keeps the popover open after an asynchronous example selection %s", async outcome => {
    const callbacks = props();
    let finish!: (value: boolean) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject; });
    const onSelectExample = vi.fn(() => pending);
    render(<RagConversationHistory {...callbacks} examples={[{ id: "example", title: "能力示例" }]} onSelectExample={onSelectExample} />);
    const dialog = await open();
    const choice = within(dialog).getByRole("button", { name: "能力示例 示例" });
    fireEvent.click(choice);
    expect(onSelectExample).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "历史问答" })).toBe(dialog);
    expect((choice as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { if (outcome === "false") finish(false); else fail(new Error("读取示例失败")); });
    expect(screen.getByRole("dialog", { name: "历史问答" })).toBe(dialog);
    expect((choice as HTMLButtonElement).disabled).toBe(false);
    if (outcome === "rejection") expect(within(dialog).getByRole("alert").textContent).toContain("暂时无法打开示例");
    expect(callbacks.onSelect).not.toHaveBeenCalled(); expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("keeps example selection when closing commits deletion of the active real conversation", async () => {
    const callbacks = props(); callbacks.onDelete.mockResolvedValue(true);
    const onSelectExample = vi.fn(async () => true);
    render(<RagConversationHistory {...callbacks} examples={[{ id: "example", title: "能力示例" }]} onSelectExample={onSelectExample} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "能力示例 示例" }));
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("one"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
    expect(onSelectExample).toHaveBeenCalledWith("example");
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(onSelectExample.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onDelete.mock.invocationCallOrder[0]);
    expect(sessionStorage.length).toBe(0);
  });
  it("opens history without switching or deleting, selects a session and closes", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    const active = within(dialog).getByRole("button", { name: "企业能力介绍" });
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.closest("li")?.getAttribute("data-active")).toBe("true");
    expect(active.querySelector("svg")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "部署要求" }));
    await waitFor(() => expect(callbacks.onSelect).toHaveBeenCalledWith("two"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
  });
  it("stages deletions without deleting, permits undo, then commits only on close", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "撤销删除部署要求" })).toBeTruthy();
    expect(within(dialog).queryByText(/已删除|待删除/)).toBeNull();
    expect(dialog.innerHTML).not.toMatch(/已删除|待删除/);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "撤销删除部署要求" }));
    expect(within(dialog).getByRole("button", { name: "删除部署要求" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("two"));
  });

  it("lets staged deletion override the active-row background while preserving selection semantics", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    const active = within(dialog).getByRole("button", { name: "企业能力介绍" });
    expect(active.closest("li")?.getAttribute("data-active")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    const staged = within(dialog).getByRole("button", { name: "撤销删除企业能力介绍" });
    expect(staged.closest("li")?.hasAttribute("data-active")).toBe(false);
    expect(within(dialog).queryByRole("button", { name: "企业能力介绍" })).toBeNull();
  });

  it("turns multi-selection into reversible visual changes and ignores selection alone", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "多选" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "选择企业能力介绍" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "多选" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "选择企业能力介绍" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "选择部署要求" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除所选" }));
    expect(within(dialog).getByRole("button", { name: "撤销删除企业能力介绍" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "撤销删除部署要求" })).toBeTruthy();
    expect(within(dialog).queryByText(/已删除|待删除/)).toBeNull();
    expect(dialog.innerHTML).not.toMatch(/已删除|待删除/);
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "撤销删除企业能力介绍" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(1));
    expect(callbacks.onDelete).toHaveBeenCalledWith("two");
  });

  it("returns focus to the restored row action after undoing a multi-select stage", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "多选" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "选择企业能力介绍" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除所选" }));
    expect(within(dialog).getByRole("button", { name: "多选" })).toBeTruthy();
    const undo = within(dialog).getByRole("button", { name: "撤销删除企业能力介绍" });
    fireEvent.click(undo);
    const restored = await within(dialog).findByRole("button", { name: "删除企业能力介绍" });
    await waitFor(() => expect(document.activeElement).toBe(restored));
  });

  it("submits at most three confirmed deletions concurrently", async () => {
    const resolvers: Array<(value: boolean) => void> = [];
    const callbacks = props();
    callbacks.items = Array.from({ length: 5 }, (_, index) => ({ id: `item-${index}`, title: `对话${index}` }));
    callbacks.onDelete.mockImplementation(() => new Promise<boolean>(resolve => { resolvers.push(resolve); }));
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "多选" }));
    for (const checkbox of within(dialog).getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除所选" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(3));
    await act(async () => { resolvers.shift()?.(true); });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(4));
    await act(async () => { while (resolvers.length) resolvers.shift()?.(true); });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(5));
    await act(async () => { while (resolvers.length) resolvers.shift()?.(true); });
  });

  it("preserves failed deletions and reports them on reopen", async () => {
    const callbacks = props(); callbacks.onDelete.mockResolvedValue(false);
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("two"));
    const reopened = await open();
    expect((await within(reopened).findByRole("alert")).textContent).toContain("未删除");
    expect(within(reopened).getByRole("button", { name: "部署要求" })).toBeTruthy();
    expect(within(reopened).getByText(/删除结果未确认/)).toBeTruthy();
    fireEvent.click(within(reopened).getByRole("button", { name: "关闭提示" }));
    expect(sessionStorage.length).toBe(0);
  });

  it.each(["active_turn", "unanswered_dispatch", "pending_followup", "protected_resource", "sync_failed"] as const)("keeps confirmed %s failures out of recovery storage and exposes an in-place retry", async reason => {
    const callbacks = props();
    callbacks.onDelete.mockResolvedValue({ ok: false, reason, message: "该对话仍在回答中。" });
    const view = render(<RagConversationHistory {...callbacks} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("two"));
    dialog = await open();
    expect(within(dialog).getByText("该对话仍在回答中。")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "重试删除部署要求" })).toBeTruthy();
    expect(within(dialog).queryByText(/删除结果未确认/)).toBeNull();
    expect(sessionStorage.length).toBe(0);
    view.unmount();
    render(<RagConversationHistory {...props()} />);
    const remounted = await open();
    expect(within(remounted).queryByText(/删除结果未确认/)).toBeNull();
  });

  it("blocks staging a second batch while a submitted or uncertain batch remains", async () => {
    let finish!: (value: boolean) => void;
    const callbacks = props();
    callbacks.onDelete.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<RagConversationHistory {...callbacks} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(1));
    dialog = await open();
    expect((within(dialog).getByRole("button", { name: "多选" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "删除部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(false); });
    await waitFor(() => expect(within(dialog).getByText(/删除结果未确认/)).toBeTruthy());
    expect((within(dialog).getByRole("button", { name: "多选" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "删除部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the active conversation visible until confirmed deletion settles", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("one"));
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  it("deletes a staged active conversation last when all available rows are staged", async () => {
    const callbacks = props(); callbacks.items = items.slice(0, 2);
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(2));
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(new Set(callbacks.onDelete.mock.calls.map(call => call[0]))).toEqual(new Set(["one", "two"]));
  });

  it("selects the requested survivor before committing staged deletions", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "部署要求" }));
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("one"));
    expect(callbacks.onSelect).toHaveBeenCalledOnce();
    expect(callbacks.onSelect).toHaveBeenCalledWith("two");
    expect(callbacks.onSelect.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onDelete.mock.invocationCallOrder[0]);
  });

  it("never commits staged actions when unmounted while the popover is open", async () => {
    const callbacks = props();
    const view = render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    view.unmount();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("retains unfinished closed-popover deletions for explicit recovery after unmount", async () => {
    let finish: (result: boolean) => void = () => {};
    const callbacks = props();
    callbacks.onDelete.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const view = render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(callbacks.onDelete).toHaveBeenCalledWith("two");
    expect(sessionStorage.length).toBe(1);
    view.unmount();
    finish(false);
    const nextCallbacks = props();
    render(<RagConversationHistory {...nextCallbacks} />);
    const reopened = await open();
    expect(within(reopened).getByText(/删除结果未确认/)).toBeTruthy();
    expect(nextCallbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(reopened).getByRole("button", { name: "关闭提示" }));
    expect(sessionStorage.length).toBe(0);
  });

  it("reconciles already-removed IDs after the authoritative list loads", async () => {
    sessionStorage.setItem("frontmind-rag-pending-deletions-v1.test-scope", JSON.stringify(["one", "two"]));
    const callbacks = props();
    const view = render(<RagConversationHistory {...callbacks} items={[]} loading />);
    expect(JSON.parse(sessionStorage.getItem("frontmind-rag-pending-deletions-v2.test-scope")!).ids).toEqual(["one", "two"]);
    view.rerender(<RagConversationHistory {...callbacks} items={[items[1]]} />);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("frontmind-rag-pending-deletions-v2.test-scope")!).ids).toEqual(["two"]));
    const dialog = await open();
    expect(within(dialog).getByText(/有 1 条删除结果未确认/)).toBeTruthy();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("isolates pending deletions by workspace scope", async () => {
    sessionStorage.setItem("frontmind-rag-pending-deletions-v1.other-scope", JSON.stringify(["one"]));
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    expect(within(dialog).queryByText(/删除结果未确认/)).toBeNull();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("discards visual staging when the workspace scope changes", async () => {
    const callbacks = props();
    const view = render(<RagConversationHistory {...callbacks} scopeKey="scope-a" items={[{ id: "old", title: "旧空间对话" }]} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除旧空间对话" }));
    expect(within(dialog).getByRole("button", { name: "撤销删除旧空间对话" })).toBeTruthy();
    view.rerender(<RagConversationHistory {...callbacks} scopeKey="scope-b" items={[{ id: "new", title: "新空间对话" }]} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
    dialog = await open();
    expect(within(dialog).getByRole("button", { name: "新空间对话" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /撤销删除/ })).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("keeps an old scope worker and recovery record out of the new scope UI", async () => {
    let finish!: (value: boolean) => void;
    const callbacks = props();
    callbacks.onDelete.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const view = render(<RagConversationHistory {...callbacks} scopeKey="scope-a" items={[{ id: "old", title: "旧空间对话" }]} />);
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除旧空间对话" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("old"));
    view.rerender(<RagConversationHistory {...callbacks} scopeKey="scope-b" items={[{ id: "new", title: "新空间对话" }]} />);
    await act(async () => { finish(false); });
    dialog = await open();
    expect(within(dialog).getByRole("button", { name: "新空间对话" })).toBeTruthy();
    expect(within(dialog).queryByText(/删除结果未确认/)).toBeNull();
    expect(sessionStorage.getItem("frontmind-rag-pending-deletions-v2.scope-b")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem("frontmind-rag-pending-deletions-v2.scope-a")!).ids).toEqual(["old"]);
  });

  it("lets history open while busy but prevents changing or deleting running conversations", async () => {
    const callbacks = props();
    const { rerender } = render(<RagConversationHistory {...callbacks} busy />);
    expect((screen.getByRole("button", { name: "新建问答" }) as HTMLButtonElement).disabled).toBe(true);
    let dialog = await open();
    expect((within(dialog).getByRole("button", { name: "部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "删除部署要求" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<RagConversationHistory {...callbacks} />);
    dialog = screen.getByRole("dialog", { name: "历史问答" });
    expect((within(dialog).getByRole("button", { name: "正在回答" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "删除正在回答" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "部署要求" }) as HTMLButtonElement).disabled).toBe(false);
  });
});


it("allows selecting a running conversation while only its deletion is disabled", async () => {
  const callbacks=props();
  render(<RagConversationHistory {...callbacks} items={[{id:"running",title:"后台回答",deletingDisabled:true},{id:"idle",title:"旧对话"}]} />);
  const dialog=await open();
  expect(within(dialog).getByRole("button",{name:"后台回答"}).hasAttribute("disabled")).toBe(false);
  expect(within(dialog).getByRole("button",{name:"删除后台回答"}).hasAttribute("disabled")).toBe(true);
  expect(within(dialog).getByRole("button",{name:"删除旧对话"}).hasAttribute("disabled")).toBe(false);
  expect(within(dialog).queryByText("当前回答完成后可切换或删除对话。")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button",{name:"后台回答"}));
  await waitFor(() => expect(callbacks.onSelect).toHaveBeenCalledWith("running"));
});
