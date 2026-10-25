import {afterEach, describe, expect, it, vi} from "vitest";
vi.mock("./workspace-rest-scope", () => ({captureWorkspaceRestOperation: vi.fn()}));
import {KnowledgePublicationRejectedError, syncKnowledgeBaseArchiveFromOutput} from "./knowledge-snapshot";

const run = (fetch: ReturnType<typeof vi.fn>) => syncKnowledgeBaseArchiveFromOutput({
  conversationId: "conversation",
  operation: {fetch, assertActive: vi.fn(), signal: new AbortController().signal} as any,
});
afterEach(() => vi.restoreAllMocks());

describe("knowledge publication result certainty", () => {
  it("preserves a rejected enterprise binding error without publishing an update event", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {message: "知识库包绑定企业与当前账号不一致"},
    }), {status: 400}));
    const dispatch = vi.spyOn(window, "dispatchEvent");
    await expect(run(fetch)).rejects.toMatchObject({
      name: "KnowledgePublicationRejectedError", message: "知识库包绑定企业与当前账号不一致",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("keeps a transport failure uncertain and never resubmits the publication", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(run(fetch)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps server errors uncertain because a snapshot may already have committed", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", {status: 500}));
    try {
      await run(fetch);
      throw new Error("Expected request failure");
    } catch (error) {
      expect(error).not.toBeInstanceOf(KnowledgePublicationRejectedError);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads an accepted update to completion without sending another POST", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({expectedBuildId: "build", expectedRevision: 49, expectedContentVersion: 1}), {status: 202}))
      .mockResolvedValueOnce(new Response(JSON.stringify({progress: {build: {id: "build", revision: 49, contentVersion: 1, status: "published"}}})));
    await expect(run(fetch)).resolves.toBe(true);
    expect(fetch.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["POST", "GET"]);
  });
});
