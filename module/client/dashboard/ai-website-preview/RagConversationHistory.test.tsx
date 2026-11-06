import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("opens history without switching or deleting, selects a session and closes", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "企业能力介绍" }).getAttribute("aria-current")).toBe("true");
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
    expect(within(dialog).getByText("已删除")).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "撤销删除部署要求" }));
    expect(within(dialog).getByRole("button", { name: "删除部署要求" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("two"));
  });

  it("preserves failed deletions and reports them on reopen", async () => {
    const callbacks = props(); callbacks.onDelete.mockResolvedValue(false);
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除部署要求" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("two"));
    const reopened = await open();
    expect((await within(reopened).findByRole("alert")).textContent).toContain("未能删除");
    expect(within(reopened).getByRole("button", { name: "部署要求" })).toBeTruthy();
    expect(within(reopened).getByText(/删除未完成/)).toBeTruthy();
    fireEvent.click(within(reopened).getByRole("button", { name: "取消待删除" }));
    expect(sessionStorage.length).toBe(0);
  });

  it("switches away from a staged active conversation before deleting it", async () => {
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除企业能力介绍" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith("one"));
    expect(callbacks.onSelect).toHaveBeenCalledWith("two");
    expect(callbacks.onSelect.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onDelete.mock.invocationCallOrder[0]);
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
    expect(callbacks.onDelete.mock.calls.map(call => call[0])).toEqual(["two", "one"]);
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
    expect(within(reopened).getByText(/删除未完成/)).toBeTruthy();
    expect(nextCallbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(reopened).getByRole("button", { name: "取消待删除" }));
    expect(sessionStorage.length).toBe(0);
  });

  it("reconciles already-removed IDs after the authoritative list loads", async () => {
    sessionStorage.setItem("frontmind-rag-pending-deletions-v1.test-scope", JSON.stringify(["one", "two"]));
    const callbacks = props();
    const view = render(<RagConversationHistory {...callbacks} items={[]} loading />);
    expect(JSON.parse(sessionStorage.getItem("frontmind-rag-pending-deletions-v1.test-scope")!)).toEqual(["one", "two"]);
    view.rerender(<RagConversationHistory {...callbacks} items={[items[1]]} />);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("frontmind-rag-pending-deletions-v1.test-scope")!)).toEqual(["two"]));
    const dialog = await open();
    expect(within(dialog).getByText(/有 1 条对话删除未完成/)).toBeTruthy();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it("isolates pending deletions by workspace scope", async () => {
    sessionStorage.setItem("frontmind-rag-pending-deletions-v1.other-scope", JSON.stringify(["one"]));
    const callbacks = props();
    render(<RagConversationHistory {...callbacks} />);
    const dialog = await open();
    expect(within(dialog).queryByText(/删除未完成/)).toBeNull();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
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
