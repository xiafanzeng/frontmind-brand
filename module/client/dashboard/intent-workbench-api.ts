import {captureWorkspaceRestOperation, forkWorkspaceRestOperation} from "../lib/workspace-rest-scope";
import type {IntentWorkspace, IntentSkillJob} from "../../contracts/intent-workbench";
import {findSavedIntentPlan,intentPlanSnapshot,intentQuestionSnapshot} from "../../contracts/intent-workbench";
export interface IntentWorkbenchApi {
  observe(): Promise<IntentWorkspace>;
  command(input: unknown): Promise<IntentWorkspace>;
  execute(input: unknown): Promise<IntentWorkspace>;
  rollback(input: unknown): Promise<IntentWorkspace>;
  control?(input: {jobId: string; action: "pause" | "resume"}): Promise<IntentWorkspace>;
  waitForJob?(jobId: string, onUpdate: (value: IntentWorkspace) => void, signal?: AbortSignal): Promise<IntentWorkspace>;
}
class IntentRequestError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?:number) {super(message);}
}
export const isRejectedIntentRequest=(cause:unknown)=>cause instanceof IntentRequestError&&Boolean(cause.status&&cause.status>=400&&cause.status<500&&cause.status!==408);
const temporaryStatus = (status: number) => [502, 503, 504].includes(status);
async function requestOnce(path: string, input: unknown, operation: ReturnType<typeof captureWorkspaceRestOperation>) {
  operation.assertActive();
  const endpoint = `/api/modules/brand/intent${path}`;
  const response = await operation.fetch(endpoint, {
    method: input === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: operation.headers(input === undefined ? {} : {"Content-Type": "application/json","Prefer":"respond-async"}),
    body: input === undefined ? undefined : JSON.stringify(input),
  }).catch(cause => {
    operation.assertActive();
    const detail = cause instanceof Error || cause instanceof DOMException ? `${cause.name}: ${cause.message}` : "网络异常";
    throw new IntentRequestError(`优化工作台请求未完成（${endpoint}，${detail}）。连接中断或服务暂时无响应，请重新读取；已提交任务会继续保留。`,
      cause instanceof TypeError || (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)));
  });
  let value: any;
  try {
    value = JSON.parse(await response.text());
  } catch (cause) {
    operation.assertActive();
    if (!(cause instanceof SyntaxError)) {
      throw new IntentRequestError(`优化工作台响应读取中断（${endpoint}），请重新读取；已提交任务会继续保留。`, cause instanceof TypeError);
    }
    const format = response.headers.get("content-type")?.split(";")[0] ?? "未知格式";
    throw new IntentRequestError(`优化工作台接口返回非 JSON 数据（HTTP ${response.status}，${format}，${endpoint}）。请重新读取；若持续出现，请检查登录状态及服务网关。`, temporaryStatus(response.status));
  }
  operation.assertActive();
  if (!response.ok) {
    const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? value?.message;
    throw new IntentRequestError(`${message ?? "优化工作台请求失败"}（HTTP ${response.status}，${endpoint}）`, temporaryStatus(response.status),response.status);
  }
  if (!value || !Number.isInteger(value.revision) || value.state?.version !== 1 ||
      !["questions", "evaluations", "plans", "todos", "receipts"].every(key => Array.isArray(value.state[key])) ||
      !Array.isArray(value.nodes))
    throw new Error(`优化工作台接口数据结构不正确（${endpoint}），请检查服务版本后重新读取。`);
  return value as IntentWorkspace;
}
async function request(path: string, input?: unknown, operation = captureWorkspaceRestOperation()) {
  const guarded=input&&typeof input==="object"?input as Record<string,unknown>:undefined;
  if(guarded&&(guarded.expectedQuestions||guarded.expectedPlan||guarded.expectedPlans)){
    const current=await request("",undefined,operation);
    if((current.commandVersion??1)<2){
      // Rolling upgrades/local live previews can still reach the old strict API.
      // Check the same entity snapshot, then retain that server's global CAS.
      const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
      if(Array.isArray(guarded.expectedQuestions)&&guarded.expectedQuestions.some((expected:any)=>{
        const question=current.state.questions.find(item=>item.id===expected.id);
        return !question||stable(intentQuestionSnapshot(question))!==stable(expected);
      }))throw new Error("所选问题已修改，请重新读取并确认后再提交。");
      const plans=guarded.expectedPlans??(guarded.expectedPlan?[guarded.expectedPlan]:[]);
      if(Array.isArray(plans)&&plans.some((expected:any)=>{
        const plan=findSavedIntentPlan(current.state,expected.questionId);
        return !plan||stable(intentPlanSnapshot(plan))!==stable(expected);
      }))throw new Error("所选方案已修改，请重新读取并核对；草稿已保留。");
      const {expectedQuestions:_questions,expectedPlan:_plan,expectedPlans:_plans,...legacy}=guarded;
      input={...legacy,expectedRevision:current.revision};
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {return await requestOnce(path, input, operation);}
    catch (cause) {
      operation.assertActive();
      // Retry reads in the same workspace only. An unanswered POST may already
      // have committed; its recovery must first observe the durable ledger.
      if (input !== undefined || !(cause instanceof IntentRequestError) || !cause.retryable || attempt >= 2) throw cause;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1500));
      operation.assertActive();
    }
  }
}
export const liveIntentWorkbenchApi: IntentWorkbenchApi = {
  observe: () => request(""),
  command: input => request("/command", input),
  execute: input => request("/execute", input),
  rollback: input => request("/rollback", input),
  control: input => request("/control", input),
  async waitForJob(jobId, onUpdate, signal) {
    const captured = captureWorkspaceRestOperation();
    const operation = signal ? forkWorkspaceRestOperation(captured, signal) : captured;
    let snapshot = await request("", undefined, operation);
    onUpdate(snapshot);
    const initialJob = snapshot.state.jobs?.find(item => item.id === jobId);
    if (!initialJob) throw new Error("当前工作区的优化任务已变化，请重新读取");
    if (initialJob.status === "failed") throw new Error(initialJob.error ?? "模型生成失败，请重新评估");
    if (["succeeded", "paused"].includes(initialJob.status)) return snapshot;
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
            // A job-only stream cannot carry concurrent catalog/draft revisions.
            // Read the ledger before publishing an update to the whole page.
            snapshot = await request("", undefined, operation);
            onUpdate(snapshot);
            if (["succeeded", "failed", "paused"].includes(job.status)) {terminal = true; break;}
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
    const streamedJob = snapshot.state.jobs?.find(item => item.id === jobId);
    if (terminal && streamedJob?.status === "failed") throw new Error(streamedJob.error ?? "模型生成失败，请重新评估");
    if (terminal && streamedJob && ["succeeded", "paused"].includes(streamedJob.status)) return snapshot;
    for (let attempt = 0; attempt < 800; attempt++) {
      if (!terminal) await new Promise(resolve => setTimeout(resolve, 2500));
      const workspace = await request("", undefined, operation);
      onUpdate(workspace);
      const job = workspace.state.jobs?.find(item => item.id === jobId);
      if (!job) throw new Error("当前工作区的优化任务已变化，请重新读取");
      if (job.status === "failed") throw new Error(job.error ?? "模型生成失败，请重新评估");
      if (["succeeded", "paused"].includes(job.status)) return workspace;
    }
    throw new Error("模型任务仍在处理，可重新读取继续查看");
  },
};
