import type { DashboardAgentClient } from './siteops/provider-ports.js';
import { KNOWLEDGE_NODE_EDIT_SYSTEM, parseKnowledgeNodeEditOutput } from '../contracts/knowledge-node-edit-contract.js';

/** Keeps the node-edit output contract in the module; Core injects execution. */
export class KnowledgeNodeAgentEditor {
  constructor(private createClient: (intentId: string) => DashboardAgentClient,
    private options: { pollMs?: number; deadlineMs?: number } = {}) {}
  async edit(input: {intentId:string; prompt:string; onSession(id:string):Promise<void>}) {
    const client = this.createClient(input.intentId);
    // Creation is idempotent on the durable intent, including a resumed edit.
    const task = await client.createTask({prompt: `${KNOWLEDGE_NODE_EDIT_SYSTEM}\n\n${input.prompt}`, title:'Knowledge node edit'});
    await input.onSession(task.taskId);
    const deadline = Date.now() + (this.options.deadlineMs ?? 180_000);
    while (Date.now() < deadline) {
      const detail = await client.taskDetail(task.taskId);
      if (['error','failed','cancelled'].includes(detail.status)) throw new Error('KNOWLEDGE_NODE_EDIT_PROVIDER_FAILED');
      if (['stopped','completed'].includes(detail.status)) {
        const events = await client.listAllMessages({taskId: task.taskId, order:'asc'});
        const message = [...events].reverse().find(event => event.type === 'assistant_message');
        const content = (message?.assistant_message as {content?:string}|undefined)?.content;
        if (!content) throw new Error('KNOWLEDGE_NODE_EDIT_OUTPUT_MISSING');
        return {sessionId: task.taskId, contentMarkdown:parseKnowledgeNodeEditOutput(content)};
      }
      await new Promise(resolve => setTimeout(resolve, this.options.pollMs ?? 1_000));
    }
    throw new Error('KNOWLEDGE_NODE_EDIT_PENDING');
  }
}
