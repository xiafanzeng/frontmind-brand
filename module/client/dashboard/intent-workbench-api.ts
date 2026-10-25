import {captureWorkspaceRestOperation} from "../lib/workspace-rest-scope";
import type {IntentWorkspace} from "../../contracts/intent-workbench";
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
    for (let attempt = 0; attempt < 800; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2500));
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
