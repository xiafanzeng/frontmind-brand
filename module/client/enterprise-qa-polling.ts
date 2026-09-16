/** A completed persisted task is stable until the next explicit message starts
 * another execution. Refresh its final snapshot once, then release the timer. */
export function isQaTaskTerminal(status: string) {
  return ["completed", "failed", "error", "cancelled"].includes(status);
}
export function startEnterpriseQaPolling(input: {
  read(): Promise<{ status: string; purpose?: string }>;
  refresh(): Promise<unknown>;
  onError(error: unknown): void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    let continuePolling = true;
    try {
      const task = await input.read();
      if (stopped) return;
      if (task.purpose && task.purpose !== "enterprise_qa") {
        continuePolling = false;
        throw new Error("当前任务用途与企业问答不一致");
      }
      // Refresh first: even a terminal result must materialize its final answer.
      await input.refresh();
      continuePolling = !isQaTaskTerminal(task.status);
    } catch (error) {
      if (!stopped) input.onError(error);
    } finally {
      if (!stopped && continuePolling) timer = setTimeout(poll, 3000);
    }
  }
  void poll();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
