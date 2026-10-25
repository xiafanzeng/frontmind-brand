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
  const response = await operation.fetch(`/api/modules/brand/intent${path}`, {
    method: input === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: operation.headers(input === undefined ? {} : {"Content-Type": "application/json"}),
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const value = await response.json();
  operation.assertActive();
  if (!response.ok) throw new Error(value.error?.message ?? "优化工作台请求失败");
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
