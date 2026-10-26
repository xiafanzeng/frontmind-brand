// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createBrandResponseLogicHost } from "../client/response-logic-brand-adapter";
import { RESPONSE_LOGIC_API_BASE } from "../client/response-logic-api-base";

type CapturedCall = { input: string; init?: RequestInit };

function createHarness() {
  const calls: CapturedCall[] = [];
  let respond: () => Promise<Response> = async () =>
    ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;
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
    setResponse: (impl: () => Promise<Response>) => {
      respond = impl;
    },
    host,
  };
}

describe("brand response-logic adapter REST wiring", () => {
  it("lists records through the module namespace", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ records: [] }) }) as unknown as Response);
    const query = harness.host.trpc.workspace.responseLogic.useQuery();
    const result = await query.refetch();
    expect(harness.calls.length).toBeGreaterThanOrEqual(1);
    const call = harness.calls[harness.calls.length - 1];
    expect(call.input).toBe(RESPONSE_LOGIC_API_BASE);
    expect(call.init?.method).toBe("GET");
    expect(result.data).toEqual({ records: [] });
  });

  it("saves records through the module namespace", async () => {
    const harness = createHarness();
    const record = { questionId: "t:1", revision: 2 };
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ record }) }) as unknown as Response);
    const mutation = harness.host.trpc.workspace.saveResponseLogic.useMutation();
    const saved = await mutation.mutateAsync({ questionId: "t:1" });
    expect(saved).toEqual({ record });
    expect(harness.calls[0].input).toBe(RESPONSE_LOGIC_API_BASE);
    expect(harness.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(harness.calls[0].init?.body))).toEqual({ questionId: "t:1" });
  });

  it("starts generation tasks at the module namespace /start route", async () => {
    const harness = createHarness();
    harness.setResponse(async () =>
      ({ ok: true, status: 200, json: async () => ({ id: "task-1", operationRevision: 1 }) }) as unknown as Response);
    const task = await harness.host.createResponseLogicTask([], {
      questionId: "t:1",
      groupId: "brand-intent",
      groupTitle: "品牌意图优化",
      question: "问题",
      intent: "",
      summary: "",
      draft: null,
      operationRevision: 1,
    } as never);
    expect(task).toEqual({ id: "task-1", operationRevision: 1 });
    expect(harness.calls[0].input).toBe(`${RESPONSE_LOGIC_API_BASE}/start`);
    expect(harness.calls[0].init?.method).toBe("POST");
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
});
