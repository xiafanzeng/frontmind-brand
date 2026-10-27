import {captureWorkspaceRestOperation, forkWorkspaceRestOperation} from "../lib/workspace-rest-scope";
import type {IntentWorkspace, IntentSkillJob} from "../../contracts/intent-workbench";
export interface IntentWorkbenchApi {
  observe(): Promise<IntentWorkspace>;
  command(input: unknown): Promise<IntentWorkspace>;
  execute(input: unknown): Promise<IntentWorkspace>;
  rollback(input: unknown): Promise<IntentWorkspace>;
  waitForJob?(jobId: string, onUpdate: (value: IntentWorkspace) => void): Promise<IntentWorkspace>;
}
async function request(path: string, input?: unknown, operation = captureWorkspaceRestOperation()) {
  operation.assertActive();
  const endpoint = `/api/modules/brand/intent${path}`;
  const response = await operation.fetch(endpoint, {
    method: input === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: operation.headers(input === undefined ? {} : {"Content-Type": "application/json"}),
    body: input === undefined ? undefined : JSON.stringify(input),
  }).catch(cause => {
    operation.assertActive();
    const detail = cause instanceof Error || cause instanceof DOMException ? `${cause.name}: ${cause.message}` : "网络异常";
    throw new Error(`优化工作台请求未完成（${endpoint}，${detail}），请重新读取。`);
  });
  let value: any;
  try {
    value = JSON.parse(await response.text());
  } catch (cause) {
    operation.assertActive();
    if (!(cause instanceof SyntaxError)) throw cause;
    const format = response.headers.get("content-type")?.split(";")[0] ?? "未知格式";
    throw new Error(`优化工作台接口返回非 JSON 数据（HTTP ${response.status}，${format}，${endpoint}）。请重新读取；若持续出现，请检查登录状态及服务网关。`);
  }
  operation.assertActive();
  if (!response.ok) {
    const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? value?.message;
    throw new Error(`${message ?? "优化工作台请求失败"}（HTTP ${response.status}，${endpoint}）`);
  }
  if (!value || !Number.isInteger(value.revision) || value.state?.version !== 1 ||
      !["questions", "evaluations", "plans", "todos", "receipts"].every(key => Array.isArray(value.state[key])) ||
      !Array.isArray(value.nodes))
    throw new Error(`优化工作台接口数据结构不正确（${endpoint}），请检查服务版本后重新读取。`);
  return value as IntentWorkspace;
}
export const liveIntentWorkbenchApi: IntentWorkbenchApi = {
  observe: () => request(""),
  command: input => request("/command", input),
  execute: input => request("/execute", input),
  rollback: input => request("/rollback", input),
  async waitForJob(jobId, onUpdate) {
    const operation = captureWorkspaceRestOperation();
    let snapshot = await request("", undefined, operation);
    onUpdate(snapshot);
    const initialJob = snapshot.state.jobs?.find(item => item.id === jobId);
    if (!initialJob) throw new Error("当前工作区的优化任务已变化，请重新读取");
    if (initialJob.status === "failed") throw new Error(initialJob.error ?? "模型生成失败，请重新评估");
    if (initialJob.status === "succeeded") return snapshot;
    // Use fetch rather than EventSource so the captured workspace headers and
    // cancellation signal apply to the entire stream.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    const streamController = new AbortController();
    const streamOperation = forkWorkspaceRestOperation(operation, streamController.signal);
    let idleTimer = setTimeout(() => streamController.abort(), 45_000);
    try {
      const response = await streamOperation.fetch(`/api/modules/brand/intent/stream?jobId=${encodeURIComponent(jobId)}`, {
        credentials: "same-origin", headers: operation.headers({Accept: "text/event-stream"}),
      });
      if (response.ok && response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          operation.assertActive();
          if (chunk.done) break;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => streamController.abort(), 45_000);
          buffer += decoder.decode(chunk.value, {stream: true}).replace(/\r\n/g, "\n");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (!frame.startsWith("event: progress\n")) continue;
            const job = JSON.parse(frame.split("\n").find(line => line.startsWith("data: "))!.slice(6)) as IntentSkillJob;
            if (job.id !== jobId) continue;
            snapshot = {...snapshot, state: {...snapshot.state, jobs: snapshot.state.jobs?.map(item => item.id === job.id ? job : item)}};
            onUpdate(snapshot);
            if (["succeeded", "failed"].includes(job.status)) {terminal = true; break;}
          }
          if (terminal) break;
        }
      }
    } catch {
      operation.assertActive();
      // Interrupted streams only fall back to reads; never repeat a command.
    } finally {
      clearTimeout(idleTimer);
      streamController.abort();
      if (reader) {await reader.cancel().catch(() => {}); reader.releaseLock();}
    }
    for (let attempt = 0; attempt < 800; attempt++) {
      if (!terminal) await new Promise(resolve => setTimeout(resolve, 2500));
      const workspace = await request("", undefined, operation);
      onUpdate(workspace);
      const job = workspace.state.jobs?.find(item => item.id === jobId);
      if (!job) throw new Error("当前工作区的优化任务已变化，请重新读取");
      if (job.status === "failed") throw new Error(job.error ?? "模型生成失败，请重新评估");
      if (job.status === "succeeded") return workspace;
    }
    throw new Error("模型任务仍在处理，可重新读取继续查看");
  },
};
