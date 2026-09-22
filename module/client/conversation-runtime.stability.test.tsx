import { useEffect } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrandConversationRuntime, type BrandConversationClient } from './conversation-runtime';
import type { Conversation, KnowledgeBaseClientState } from './conversation-types';

const runtimes: ReturnType<typeof createBrandConversationRuntime>[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function draft(id = 'draft'): Conversation {
  return { id, title: '企业知识库构建', workbenchAgentId: 'knowledge', messages: [], status: 'idle', createdAt: 1, updatedAt: 1 };
}
function knowledgeState(initialized: boolean): KnowledgeBaseClientState {
  return {
    initialized, generation: 0, stateEpoch: 0, activeTurnId: null,
    activeClientRequestId: null, presentationTurnId: null,
    interactionState: 'awaiting_input', canReply: false, presentationKey: null,
    revision: null, leafId: null, notice: null,
  };
}
function setup(records: Conversation[]) {
  const client: BrandConversationClient = {
    list: vi.fn(async () => records), sync: vi.fn(async () => {}),
    // Keep the read pending to inspect wake requests without provider effects.
    observe: vi.fn(() => new Promise<never>(() => {})),
  };
  const runtime = createBrandConversationRuntime(client, 'knowledge', 'stability');
  runtimes.push(runtime);
  return { client, runtime };
}

describe('brand conversation runtime stability', () => {
  it('keeps action-dependent selection effects stable and ignores same-value writes', async () => {
    const { runtime } = setup([draft()]);
    const selectionEffect = vi.fn();
    let renders = 0;
    const { result } = renderHook(() => {
      const context = runtime.useConversation();
      renders += 1;
      useEffect(() => {
        selectionEffect();
        // Limit the regression fixture itself; the old runtime repeated this
        // effect on every setActive/clearSyncError notification.
        if (selectionEffect.mock.calls.length < 10) {
          context.setActive('draft');
          context.clearSyncError();
        }
      }, [context.hydrated, context.setActive, context.clearSyncError]);
      return context;
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(selectionEffect).toHaveBeenCalledTimes(2);
    const before = renders;
    act(() => { result.current.setActive('draft'); result.current.clearSyncError(); });
    expect(renders).toBe(before);
    const actions = Object.entries(result.current).filter(([, value]) => typeof value === 'function');
    act(() => result.current.updateTitle('draft', '资料草稿'));
    await act(() => result.current.flushConversation('draft'));
    for (const [name, action] of actions) expect(result.current[name as keyof typeof result.current]).toBe(action);
    expect(selectionEffect).toHaveBeenCalledTimes(2);
  });

  it('hydrates once across consumers and remounts while allowing an explicit refresh', async () => {
    const { runtime, client } = setup([draft()]);
    const first = renderHook(() => runtime.useConversation());
    await waitFor(() => expect(first.result.current.hydrated).toBe(true));
    const second = renderHook(() => runtime.useConversation());
    second.unmount();
    const remounted = renderHook(() => runtime.useConversation());
    expect(remounted.result.current.loading).toBe(false);
    expect(client.list).toHaveBeenCalledTimes(1);
    await act(() => remounted.result.current.refreshConversations());
    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it('never reconciles an empty named draft during hydration, refresh, focus or reconnect', async () => {
    const { runtime, client } = setup([
      draft(), { ...draft('uninitialized'), knowledgeBase: knowledgeState(false) },
      { ...draft('optimistic'), messages: [{ id: 'pending', role: 'user', content: '尚未提交', timestamp: 2, knowledgeBase: { kind: 'pending_user', clientRequestId: 'unsent', serverOwned: false } }] },
    ]);
    const { result } = renderHook(() => runtime.useConversation());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(() => runtime.refresh());
    act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    expect(client.observe).not.toHaveBeenCalled();
    expect(result.current.state.conversations).toHaveLength(3);
    expect(client.sync).not.toHaveBeenCalled();
  });

  it.each([
    ['initialized build', { knowledgeBase: knowledgeState(true) }],
    ['legacy provider task', { taskId: 'legacy-task' }],
    ['legacy response', { previousResponseId: 'legacy-response' }],
    ['server-owned build message', { messages: [{ id: 'approved', role: 'assistant', content: '已保存的构建', timestamp: 2, knowledgeBase: { kind: 'presentation', buildId: 'build-1', serverOwned: true } }] }],
  ] satisfies Array<[string, Partial<Conversation>]>)('restores %s without relying on its title', async (_label, evidence) => {
    const { runtime, client } = setup([{ ...draft('history'), title: '历史资料', ...evidence }]);
    const { result } = renderHook(() => runtime.useConversation());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(client.observe).toHaveBeenCalledTimes(1);
    expect(client.observe).toHaveBeenCalledWith('history', expect.any(AbortSignal));
  });

  it('preserves explicit register and wake after a successful start', async () => {
    const { runtime, client } = setup([draft()]);
    const { result } = renderHook(() => runtime.useConversation());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.registerKnowledgeBaseConversation('draft'));
    expect(client.observe).not.toHaveBeenCalled();
    act(() => result.current.wakeKnowledgeBaseConversation('draft'));
    expect(client.observe).toHaveBeenCalledTimes(1);
    expect(client.observe).toHaveBeenCalledWith('draft', expect.any(AbortSignal));
  });
});

it('clears a transient observation error when the same active build recovers', async () => {
  const { runtime, client } = setup([{ ...draft('recovering'), taskId: 'task' }]);
  vi.mocked(client.observe).mockRejectedValueOnce(new Error('短暂网络错误')).mockResolvedValue({
    generation: 0, stateEpoch: 1, interaction: { interactionState: 'failed', progress: null },
  } as any);
  const { result } = renderHook(() => runtime.useConversation());
  await waitFor(() => expect(result.current.syncError).toBe('短暂网络错误'));
  act(() => result.current.wakeKnowledgeBaseConversation('recovering'));
  await waitFor(() => expect(result.current.syncError).toBeNull());
});

it('does not surface a historic task failure as the active workspace error', async () => {
  const { runtime, client } = setup([draft('active'), { ...draft('old'), taskId: 'old-task' }]);
  vi.mocked(client.observe).mockRejectedValue(Object.assign(new Error('旧任务不可用'), { status: 403 }));
  const { result } = renderHook(() => runtime.useConversation());
  await waitFor(() => expect(result.current.hydrated).toBe(true));
  expect(result.current.activeConversation?.id).toBe('active');
  expect(result.current.syncError).toBeNull();
});
