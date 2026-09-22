import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  reset: undefined as any, resetError: false, progress: undefined as any,
  conversation: undefined as any, node: vi.fn(), home: vi.fn(), create: vi.fn(),
  refetchReset: vi.fn(), refetchProgress: vi.fn(), setActive: vi.fn(),
  clear: vi.fn(), setProgress: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../host', () => ({
  useRuntimeContext: () => ({ enabled: true, accountId: 1, workspaceId: 'test' }),
  projectResourceUrl: (x: string) => x, getUnsavedWorkspaceDrafts: () => [],
  Home: (props: any) => { m.home(props); return <textarea aria-label="修订草稿" />; },
  AgentWorkbenchShell: (props: any) => <div>{props.main}{props.auxiliary}</div>,
}));
vi.mock('../conversation', () => ({
  setWorkbenchTaskQuery: vi.fn(),
  useConversation: () => ({
    state: { conversations: [m.conversation] }, activeConversation: m.conversation,
    hydrated: true, loading: false, syncError: null, createConversation: m.create,
    setActive: m.setActive, discardKnowledgeBaseConversationsLocally: () => [],
    refreshConversationsAfterDiscard: m.refresh, refreshConversations: m.refresh,
    clearSyncError: vi.fn(), updateStatus: vi.fn(),
  }),
}));
vi.mock('../api-hooks', () => ({
  trpc: { useUtils: () => ({ workspace: {
    knowledge: { clear: m.clear }, knowledgeProgress: { setData: m.setProgress, invalidate: m.refresh },
    portal: { invalidate: m.refresh }, dashboard: { invalidate: m.refresh },
    brandQuestionUniverse: { observe: { invalidate: m.refresh } },
  } }), workspace: {
    knowledge: { useQuery: () => ({ data: { snapshot: null }, refetch: m.refresh }) },
    knowledgeReset: {
      status: { useQuery: () => ({ data: m.reset, isError: m.resetError, refetch: m.refetchReset }) },
      reset: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    knowledgeProgress: { useQuery: () => ({ data: { progress: m.progress }, refetch: m.refetchProgress }) },
  } },
}));
vi.mock('../lib/knowledge-base-upload-manager', () => ({ useRetireKnowledgeUploads: () => vi.fn() }));
vi.mock('../lib/workspace-rest-scope', () => ({ captureWorkspaceRestOperation: vi.fn() }));
vi.mock('../lib/knowledge-snapshot', () => ({ syncKnowledgeBaseArchiveFromOutput: vi.fn() }));
vi.mock('./KnowledgeNodeWorkspace', () => ({ default: (props: any) => { m.node(props); return <div data-testid="nodes" />; } }));
vi.mock('./KnowledgeBaseViewer', () => ({ default: () => null }));
vi.mock('./KnowledgeWorkspaceStatus', () => ({ default: () => null }));
vi.mock('./KnowledgeNodeConversation', () => ({ default: () => null }));
vi.mock('./KnowledgePublicExecution', () => ({ default: () => null }));
vi.mock('./KnowledgeWorkbenchActions', () => ({ default: () => null }));
vi.mock('./KnowledgeImageLibrary', () => ({ default: () => null, PreviewKnowledgeImageLibrary: () => null }));
import Panel from './EmbeddedKnowledgeBasePanel';

beforeEach(() => {
  vi.clearAllMocks();
  m.reset = { revision: 0, hasKnowledge: true, canReset: true };
  m.resetError = false;
  m.conversation = { id: 'kb', title: '企业知识库构建', status: 'awaiting_input', messages: [], createdAt: 1, updatedAt: 2 };
  m.progress = { build: { id: 'build', conversationId: 'kb', revision: 0, contentVersion: 2, updatedAt: 2 },
    branches: [], packageAllowed: false, workbench: { generation: 3, stateEpoch: 4, phase: 'initial' } };
});
afterEach(cleanup);
const panel = () => <Panel page="build" mode="workspace" workbench onPageChange={vi.fn()} />;

describe('knowledge workbench recovery', () => {
  it('keeps the same draft DOM during a failed background status read, then unlocks on recovery', async () => {
    const view = render(panel());
    const input = await screen.findByRole('textbox', { name: '修订草稿' }) as HTMLTextAreaElement;
    input.value = '不能丢失的修订';
    m.resetError = true;
    view.rerender(panel());
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('不能丢失的修订');
    expect(screen.getByRole('status').textContent).toContain('已保留当前内容');
    expect(m.home.mock.lastCall?.[0].knowledgeEditingBlocked).toBe(true);
    m.resetError = false;
    view.rerender(panel());
    expect(screen.getByRole('textbox')).toBe(input);
    expect(m.home.mock.lastCall?.[0].knowledgeEditingBlocked).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('does not create a conversation before the first reset state is available', () => {
    m.reset = undefined; m.resetError = true;
    render(panel());
    expect(screen.getByText('知识库状态读取失败')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([undefined, 1])('reads nodes at the server build generation while the cached conversation has %s', async (generation) => {
    if (generation !== undefined) m.conversation.knowledgeBase = { generation };
    render(panel());
    await waitFor(() => expect(m.node.mock.lastCall?.[0]).toMatchObject({ conversationId: 'kb', generation: 3 }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it('does not turn complete progress observations into a reset-status polling loop', async () => {
    render(panel());
    await screen.findByRole('textbox');
    act(() => {
      for (let n = 0; n < 10; n++) window.dispatchEvent(new CustomEvent('frontmind:knowledge-progress-updated', {
        detail: { progress: m.progress, generation: 3, stateEpoch: 4 },
      }));
    });
    expect(m.refetchReset).not.toHaveBeenCalled();
    expect(m.refetchProgress).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new CustomEvent('frontmind:knowledge-progress-updated')));
    expect(m.refetchReset).toHaveBeenCalledTimes(1);
  });
});
