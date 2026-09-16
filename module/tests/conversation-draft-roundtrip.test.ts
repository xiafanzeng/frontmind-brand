import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import express from "express";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { createBrandConversationRuntime, type BrandConversationClient } from "../client/conversation-runtime";
import type { Conversation } from "../client/conversation-types";
import { createBrandConversationRouter, type BrandConversationSnapshot } from "../server/conversations";

it("recovers an empty question draft in a fresh runtime and can save or delete it", async () => {
  const records = new Map<string, BrandConversationSnapshot>();
  const app = express();
  app.use(express.json());
  app.use(createBrandConversationRouter({
    list: async () => [...records.values()],
    save: async (_request, value) => {
      // Core stores the workbench identity, while purpose appears only after
      // a dispatch/task exists. Exercise that draft transport contract here.
      const { purpose: _purpose, ...stored } = value;
      records.set(value.id, structuredClone(stored));
    },
    delete: async (_request, id) => { records.delete(id); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client: BrandConversationClient = {
    list: async purpose => {
      const response = await fetch(`${url}/conversations?purpose=${purpose}`);
      if (!response.ok) throw new Error(`List failed: ${response.status}`);
      return (await response.json()).conversations as Conversation[];
    },
    sync: async (purpose, conversations, deletedIds = []) => {
      const response = await fetch(`${url}/conversations/sync`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose, conversations, deletedIds }),
      });
      if (!response.ok) throw new Error(`Sync failed: ${response.status}`);
    },
    observe: vi.fn(async () => { throw new Error("No provider call expected"); }),
  };
  const first = createBrandConversationRuntime(client, "enterprise_qa", "workspace");
  let refreshed: ReturnType<typeof createBrandConversationRuntime> | undefined;
  try {
    const initial = renderHook(() => first.useConversation());
    await waitFor(() => expect(initial.result.current.hydrated).toBe(true));
    let id = "";
    act(() => { id = initial.result.current.createConversation(); });
    await act(async () => { await initial.result.current.flushConversation(id); });
    expect(records.get(id)).toMatchObject({ id, workbenchAgentId: "enterprise-qa", messages: [] });
    expect(records.get(id)).not.toHaveProperty("purpose");
    initial.unmount();
    first.dispose();

    refreshed = createBrandConversationRuntime(client, "enterprise_qa", "workspace");
    const reloaded = renderHook(() => refreshed!.useConversation());
    await waitFor(() => expect(reloaded.result.current.hydrated).toBe(true));
    expect(reloaded.result.current.activeConversation).toMatchObject({
      id, purpose: "enterprise_qa", workbenchAgentId: "enterprise-qa", messages: [],
    });
    act(() => reloaded.result.current.updateTitle(id, "保留的空草稿"));
    await act(async () => { await reloaded.result.current.flushConversation(id); });
    await act(async () => { await reloaded.result.current.refreshConversations(); });
    expect(reloaded.result.current.activeConversation).toMatchObject({ id, title: "保留的空草稿" });
    act(() => reloaded.result.current.deleteConversation(id));
    await waitFor(() => expect(reloaded.result.current.state.conversations).toEqual([]));
    expect(records.size).toBe(0);
    expect(client.observe).not.toHaveBeenCalled();
  } finally {
    cleanup();
    first.dispose();
    refreshed?.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
