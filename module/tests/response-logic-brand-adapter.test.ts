import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createBrandResponseLogicHost, __resetBrandRecordsStoreForTests } from "../client/response-logic-brand-adapter";
import { RESPONSE_LOGIC_API_BASE } from "../client/response-logic-api-base";

type CapturedCall = { input: string; init?: RequestInit };

function createHarness() {
  const calls: CapturedCall[] = [];
  let respond: () => Promise<Response> = async () =>
    ({ ok: true, status: 200, json: async () => ({ records: [] }) }) as unknown as Response;
  const capture = () => ({
    signal: new AbortController().signal,
    assertActive: () => {},
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return respond();
    },
  });
  const noop = () => null;
  const host = createBrandResponseLogicHost({
    captureRestOperation: capture as never,
    visual: {
      Button: noop as never,
      FilePreview: noop as never,
      ImagePreview: noop as never,
      BusinessExecutionActivity: noop as never,
    },
    toast: { success: vi.fn(), error: vi.fn() },
  });
  return {
    calls,
    setResponse: (impl: () => Promise<Response>) => { respond = impl; },
    host,
  };
}

describe("brand response-logic adapter REST wiring", () => {
  it("lists records through the module namespace via a reactive query hook", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ records: [{ questionId: "t:1" }] }) }) as unknown as Response);

    const { result } = renderHook(() =>
      harness.host.trpc.workspace.responseLogic.useQuery(undefined, { refetchInterval: 0 }),
    );

    // Initial render: loading (no data yet, fetch pending)
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    // After the fetch resolves, the store notifies and the hook re-renders
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ records: [{ questionId: "t:1" }] });

    // The request went to the module namespace
    const listCall = harness.calls.find(call => call.input === RESPONSE_LOGIC_API_BASE);
    expect(listCall).toBeDefined();
    expect(listCall?.init?.method).toBe("GET");
  });

  it("exposes a working useUtils with setData (fixes the white-screen crash)", () => {
    const harness = createHarness();
    const utils = harness.host.trpc.useUtils();
    expect(utils).toBeDefined();
    expect(utils.workspace).toBeDefined();
    expect(utils.workspace.responseLogic).toBeDefined();
    expect(typeof utils.workspace.responseLogic.setData).toBe("function");

    // setData applies the updater and does not throw
    utils.workspace.responseLogic.setData(undefined, () => ({ records: [{ questionId: "x" }] }));
  });

  it("saves records through the module namespace and calls onSuccess", async () => {
    const harness = createHarness();
    const record = { questionId: "t:1", revision: 2 };
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ record }) }) as unknown as Response);
    const onSuccess = vi.fn();
    const mutation = harness.host.trpc.workspace.saveResponseLogic.useMutation({ onSuccess });
    const saved = await mutation.mutateAsync({ questionId: "t:1" });
    expect(saved).toEqual({ record });
    expect(onSuccess).toHaveBeenCalledWith({ record });
    expect(harness.calls[0].input).toBe(RESPONSE_LOGIC_API_BASE);
    expect(harness.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(harness.calls[0].init?.body))).toEqual({ questionId: "t:1" });
  });

  it("starts generation tasks at the module namespace /start route", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ task: { id: "task-1", operationRevision: 1 }, startedAt: 1, knowledgeVersion: 1 }) }) as unknown as Response);
    const task = await harness.host.createResponseLogicTask(
      [{ role: "user", content: "请生成应答逻辑" }],
      {
        questionId: "t:1",
        groupId: "brand-intent",
        groupTitle: "品牌意图优化",
        question: "问题",
        intent: "",
        summary: "",
        draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] },
        operationRevision: 1,
        conversationId: "conv-1",
      } as never,
    );
    expect(task).toEqual({ id: "task-1", operationRevision: 1 });
    expect(harness.calls[0].input).toBe(`${RESPONSE_LOGIC_API_BASE}/start`);
    expect(harness.calls[0].init?.method).toBe("POST");
  });

  it("converts string messages to userMessage (fixes the 400 INVALID_RESPONSE_LOGIC_INPUT)", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ task: { id: "t", operationRevision: 1 }, startedAt: 1, knowledgeVersion: 1 }) }) as unknown as Response);
    await harness.host.createResponseLogicTask(
      [{ role: "user", content: "生成应答逻辑" }, { role: "user", content: "补充要求" }],
      { questionId: "q1", groupId: "g", groupTitle: "T", question: "Q", intent: "", summary: "",
        draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] },
        conversationId: "c1" } as never,
    );
    const body = JSON.parse(String(harness.calls[0].init?.body));
    expect(body.userMessage).toBe("生成应答逻辑\n补充要求");
    expect(body.messages).toBeUndefined();
  });

  it("converts content-block messages to userMessage + attachments matching the server attachmentSchema", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ task: { id: "t" }, startedAt: 1, knowledgeVersion: 1 }) }) as unknown as Response);
    await harness.host.createResponseLogicTask(
      [{ role: "user", content: [
        { type: "input_text", text: "请按资料生成" },
        { type: "input_file", file_id: "asset_abc123", filename: "资料.pdf", mime_type: "application/pdf" },
        { type: "input_text", text: "重点关注医保" },
        { type: "input_image", image_url: "https://example.com/img.png" },
      ]}],
      { questionId: "q1", groupId: "g", groupTitle: "T", question: "Q", intent: "", summary: "",
        draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] },
        conversationId: "c1" } as never,
    );
    const body = JSON.parse(String(harness.calls[0].init?.body));
    expect(body.userMessage).toBe("请按资料生成\n重点关注医保");
    expect(body.attachments).toEqual([
      { file_id: "asset_abc123", filename: "资料.pdf", mime_type: "application/pdf" },
    ]);
  });

  it("handles empty messages without crashing or sending [object Object]", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ task: { id: "t" }, startedAt: 1, knowledgeVersion: 1 }) }) as unknown as Response);
    await harness.host.createResponseLogicTask(
      [{ role: "user", content: [] }],
      { questionId: "q1", groupId: "g", groupTitle: "T", question: "Q", intent: "", summary: "",
        draft: { concern: "", conclusion: "", facts: "", pending: "", boundaries: "", references: "", images: [], attachments: [] },
        conversationId: "c1" } as never,
    );
    const body = JSON.parse(String(harness.calls[0].init?.body));
    expect(body.userMessage).toBe("");
    expect(body.attachments).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("[object Object]");
  });

  it("sends a request body that passes the real server responseLogicStartSchema", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ task: { id: "t" }, startedAt: 1, knowledgeVersion: 1 }) }) as unknown as Response);
    await harness.host.createResponseLogicTask(
      [{ role: "user", content: [
        { type: "input_text", text: "请生成" },
        { type: "input_file", file_id: "asset_xyz", filename: "doc.pdf", mime_type: "application/pdf" },
      ]}],
      { questionId: "q1", groupId: "g", groupTitle: "T", question: "Q", intent: "I", summary: "S",
        draft: { concern: "c", conclusion: "c", facts: "f", pending: "", boundaries: "b", references: "", images: [], attachments: [] },
        conversationId: "conv-1", operationRevision: 1 } as never,
    );
    // Rebuild the server's start schema from the same exported contract schemas
    // the server uses, so we validate against the real shape.
    const { z: zod } = await import("zod");
    const { responseLogicQuestionSchema, responseLogicDraftSchema } = await import("../contracts/response-logic.js");
    const attachmentSchema = zod.object({
      file_id: zod.string().max(255).refine((v: string) => v.trim().length > 0),
      filename: zod.string().trim().min(1).max(512),
      mime_type: zod.string().trim().min(1).max(255).optional(),
    });
    const startSchema = responseLogicQuestionSchema.extend({
      conversationId: zod.string().trim().min(1).max(191),
      taskId: zod.string().trim().min(1).max(255).optional(),
      operationRevision: zod.number().int().positive().optional(),
      userMessage: zod.string().max(200_000),
      draft: responseLogicDraftSchema,
      attachments: zod.array(attachmentSchema).max(50).default([]),
    });
    const body = JSON.parse(String(harness.calls[0].init?.body));
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Schema failures:", JSON.stringify(parsed.error.issues.map((i: { path: (string|number)[]; message: string }) => ({ path: i.path.join("."), message: i.message })), null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it("uploads materials with the Core v2 local-asset contract", async () => {
    const harness = createHarness();
    const content = "hello upload!";
    const file = new File([content], "材料 图.png", { type: "image/png" });
    harness.setResponse(async () =>
      ({
        ok: true,
        status: 201,
        json: async () => ({
          localAssetId: "asset_abc123",
          filename: "服务端名.png",
          bytes: content.length,
          expiresAt: 1_900_000_000_000,
        }),
      }) as unknown as Response);
    const uploaded = await harness.host.uploadChatLocalAsset(
      file,
      undefined,
      { filename: "中文 材料.png", mimeType: "image/png" },
    );
    expect(uploaded).toEqual({
      fileId: "asset_abc123",
      filename: "服务端名.png",
      sizeBytes: content.length,
      expiresAt: 1_900_000_000_000,
    });
    expect(harness.calls).toHaveLength(1);
    const call = harness.calls[0];
    expect(call.input).toBe("/api/frontmind/v2/assets");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(file);
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["X-FrontMind-Mime"]).toBe("image/png");
    expect(headers["X-FrontMind-Filename"]).toBe(encodeURIComponent("中文 材料.png"));
    expect(headers["X-FrontMind-Size"]).toBe(String(content.length));
  });

  it("surfaces server upload errors and rejects non-local asset ids", async () => {
    const harness = createHarness();
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    harness.setResponse(async () =>
      ({ ok: false, status: 413, json: async () => ({ error: { message: "文件超出大小限制" } }) }) as unknown as Response);
    await expect(harness.host.uploadChatLocalAsset(file)).rejects.toThrow("文件超出大小限制");

    harness.setResponse(async () =>
      ({ ok: true, status: 201, json: async () => ({ localAssetId: "task_9" }) }) as unknown as Response);
    await expect(harness.host.uploadChatLocalAsset(file)).rejects.toThrow("材料上传失败（201）");
  });

  it("shows an error state when the query fails (not a white screen)", async () => {
    __resetBrandRecordsStoreForTests();
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: false, status: 503, json: async () => ({ error: { message: "服务不可用" } }) }) as unknown as Response);

    const { result } = renderHook(() =>
      harness.host.trpc.workspace.responseLogic.useQuery(undefined, { refetchInterval: 0 }),
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("503");
    expect(result.current.data).toBeUndefined();
  });
});
