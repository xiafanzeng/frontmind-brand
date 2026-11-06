import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), search: "", headers: {} as Record<string, string> }));
vi.mock("wouter", () => ({ useSearch: () => mocks.search, Link: () => null }));
vi.mock("../host", () => ({ Home: () => null, AgentWorkbenchShell: () => null, deliveryProjectHeaders: () => mocks.headers, projectWorkspaceUrl: (path: string) => path }));
vi.mock("../conversation", () => ({ ConversationPurposeProvider: () => null, useConversation: () => ({}) }));
vi.mock("./ProjectAgentWorkbench", () => ({ default: () => null }));
vi.mock("../api-hooks", () => ({ trpc: {} }));

import { useEnterpriseQaKnowledgeSource } from "./EnterpriseQaWorkspace";

const healthy = { configured: true, provider: "xty_codex", knowledgeBase: { snapshotId: "knowledge-1", version: 4, sourceFileName: "knowledge.zip", documentCount: 3 } };
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function Probe({ taskId }: { taskId?: string }) {
  const { source } = useEnterpriseQaKnowledgeSource(taskId);
  const [draft, setDraft] = useState("");
  return <><input aria-label="待发送草稿" value={draft} onChange={event => setDraft(event.target.value)} /><output data-testid="source-state">{JSON.stringify(source)}</output></>;
}
const state = () => JSON.parse(screen.getByTestId("source-state").textContent!);

beforeEach(() => { mocks.fetch.mockReset(); mocks.search = ""; mocks.headers = {}; vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("enterprise QA knowledge source recovery", () => {
  it("automatically recovers from a transient 503 while preserving the unsent draft and making only configuration reads", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(reply({ error: { code: "MODULE_DATABASE_UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(reply(healthy));
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state()).toMatchObject({ loaded: true, failed: true });
    fireEvent.change(screen.getByRole("textbox", { name: "待发送草稿" }), { target: { value: "保留这条尚未发送的问题" } });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(state()).toMatchObject({ loaded: true, failed: false, knowledgeBase: healthy.knowledgeBase });
    expect((screen.getByRole("textbox", { name: "待发送草稿" }) as HTMLInputElement).value).toBe("保留这条尚未发送的问题");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.every(([path, init]) => String(path).startsWith("/api/frontmind/v2/runtime-config?") && init.method !== "POST")).toBe(true);
  });

  it("does not repeatedly retry a permanent source denial", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(reply({ error: { code: "TASK_NOT_FOUND" } }, 404));
    render(<Probe taskId="unavailable-task" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state()).toMatchObject({ loaded: true, failed: true, failureCode: "TASK_NOT_FOUND" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated transient recovery to two retries", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(async () => reply({ error: { code: "MODULE_DATABASE_UNAVAILABLE" } }, 503));
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(state()).toMatchObject({ loaded: true, failed: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the frozen source during a failed revalidation and clears the transient failure after recovery", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(reply(healthy))
      .mockResolvedValueOnce(reply({ error: { code: "MODULE_DATABASE_UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(reply(healthy));
    render(<Probe taskId="frozen-task" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByRole("textbox", { name: "待发送草稿" }), { target: { value: "冻结来源下的草稿" } });
    fireEvent(window, new Event("focus"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state()).toMatchObject({ failed: false, refreshFailed: true, knowledgeBase: healthy.knowledgeBase });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(state()).toMatchObject({ failed: false, knowledgeBase: healthy.knowledgeBase });
    expect(state().refreshFailed).not.toBe(true);
    expect((screen.getByRole("textbox", { name: "待发送草稿" }) as HTMLInputElement).value).toBe("冻结来源下的草稿");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels recovery for an old task after the selected task changes", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(reply({ error: { code: "MODULE_DATABASE_UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(reply({ ...healthy, knowledgeBase: { ...healthy.knowledgeBase, snapshotId: "knowledge-next" } }));
    const view = render(<Probe taskId="task-old" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state().failed).toBe(true);
    view.rerender(<Probe taskId="task-next" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.runOnlyPendingTimersAsync(); });
    expect(state()).toMatchObject({ failed: false, knowledgeBase: { snapshotId: "knowledge-next" } });
    expect(mocks.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/frontmind/v2/runtime-config?localTaskId=task-old", "/api/frontmind/v2/runtime-config?localTaskId=task-next",
    ]);
  });
});
