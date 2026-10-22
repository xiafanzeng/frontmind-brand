import {captureWorkspaceRestOperation} from "../lib/workspace-rest-scope";
import type {IntentWorkspace} from "../../contracts/intent-workbench";
export interface IntentWorkbenchApi {
  observe(): Promise<IntentWorkspace>;
  command(input: unknown): Promise<IntentWorkspace>;
  execute(input: unknown): Promise<IntentWorkspace>;
  rollback(input: unknown): Promise<IntentWorkspace>;
}
async function request(path: string, input?: unknown) {
  const operation = captureWorkspaceRestOperation();
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
};
