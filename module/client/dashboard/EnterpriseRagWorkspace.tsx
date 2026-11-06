import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "../conversation-types";
import { ragLiveTurns } from "./ai-website-preview/rag-live-turns";
import {
  brandHost,
  ConversationPurposeProvider,
  projectWorkspaceUrl,
  setWorkbenchTaskQuery,
  useConversation,
} from "../host";
import { useEnterpriseQaController } from "../use-enterprise-qa-controller";
import {
  EnterpriseQaSourceNote,
  enterpriseQaProviderLabel,
  type EnterpriseQaSourceState,
  useEnterpriseQaKnowledgeSource,
} from "./EnterpriseQaWorkspace";
import ProjectAgentWorkbench from "./ProjectAgentWorkbench";
import { ragLiveActivity } from "./ai-website-preview/rag-live-activity";
import {
  EnterpriseRagPreview,
  type EnterpriseRagLiveRuntime,
} from "./ai-website-preview/EnterpriseRagPreview";

import type { RagReportUrlBuilder } from "./ai-website-preview/rag-report-navigation";

export type EnterpriseRagWorkspaceProps = {
  workbench?: boolean;
  projectId?: string;
  storageScopeKey?: string;
  onOpenWebsite?: () => void;
  onOpenWebsiteAssistant?: () => void;
  websiteEntryLabel?: string;
  buildReportUrl?: RagReportUrlBuilder;
};

type EnterpriseRagLiveWorkspaceProps = EnterpriseRagWorkspaceProps & {
  currentPublication: EnterpriseQaSourceState;
  retryCurrentPublication: () => void;
  allowConversationCreation: boolean;
};

function EnterpriseRagLiveWorkspace({
  currentPublication,
  retryCurrentPublication,
  allowConversationCreation,
  projectId,
  storageScopeKey,
  onOpenWebsite,
  onOpenWebsiteAssistant,
  websiteEntryLabel,
  buildReportUrl,
}: EnterpriseRagLiveWorkspaceProps) {
  const workspace = useConversation();
  const creating = useRef(false);
  const pendingDelete = useRef<{ id: string; wasActive: boolean; resolve: (ok: boolean) => void } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<{ key: string; explicit: boolean } | null>(() => new URL(location.href).searchParams.has("workbenchTask") ? null : { key: `draft:${crypto.randomUUID()}`, explicit: false });
  const [draftAdoptedFrom, setDraftAdoptedFrom] = useState<string>();
  const [selectedAnswerKey, setSelectedAnswerKey] = useState<string | null>(null);
  const controller = useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once", activeConversationId: newDraft ? null : undefined });
  const active = controller.active;
  const execution = controller.execution ?? active?.execution;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const activeIdRef = useRef(active?.id ?? null);
  const blockedRef = useRef(false);
  blockedRef.current = controller.busy || Boolean(controller.pendingDispatch);
  useEffect(() => { activeIdRef.current = active?.id ?? null; }, [active?.id]);
  useEffect(() => () => { pendingDelete.current?.resolve(false); pendingDelete.current = null; }, []);
  const conversations = workspace.state.conversations.filter(item =>
    item.purpose === "enterprise_qa" || (!item.purpose && item.workbenchAgentId === "enterprise-qa"),
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const historyBusy = controller.busy || Boolean(controller.pendingDispatch) || Boolean(deletingId);
  const localTaskId = active?.previousResponseId ?? active?.taskId ?? null;
  const { source: taskSource, retry: retryTaskSource } =
    useEnterpriseQaKnowledgeSource(localTaskId, Boolean(localTaskId));
  const responseKnowledgeBase = controller.responseKnowledgeBase;
  const boundTaskKnowledgeBase = localTaskId
    ? responseKnowledgeBase ?? taskSource.knowledgeBase ?? null
    : null;
  const knowledgeBase = localTaskId
    ? boundTaskKnowledgeBase
    : currentPublication.knowledgeBase ?? null;
  const loaded = localTaskId
    ? Boolean(responseKnowledgeBase) || taskSource.loaded
    : currentPublication.loaded;
  const failed = localTaskId
    ? !responseKnowledgeBase && taskSource.failed
    : currentPublication.failed;
  const knowledgeBinding: EnterpriseRagLiveRuntime["knowledgeBinding"] =
    localTaskId
      ? knowledgeBase || !loaded
        ? "frozen_task"
        : "historical_unknown"
      : "current_publication";
  const selectedSource = localTaskId ? taskSource : currentPublication;
  const navigateWithinWorkspace = (path: string) =>
    brandHost().requestWorkspaceNavigation(() => {
      window.location.assign(projectWorkspaceUrl(path));
    });
  const openWebsite =
    onOpenWebsite ?? (() => navigateWithinWorkspace("/?view=website"));
  const openWebsiteAssistant =
    onOpenWebsiteAssistant ??
    (() => navigateWithinWorkspace("/?view=website&step=design"));

  const startNewConversation = useCallback(() => {
    if (controller.busy || pendingDelete.current || creating.current) return;
    setNewDraft({ key: `draft:${crypto.randomUUID()}`, explicit: true });
    setDraftAdoptedFrom(undefined);
    setSelectedAnswerKey(null);
    const url = new URL(location.href); url.searchParams.delete("workbenchTask");
    history.replaceState(history.state, "", url);
  }, [controller.busy]);

  // The host deletion API reports errors via syncError and changes the list
  // only after the server confirms removal. Keep the selection until then.
  useEffect(() => {
    const pending = pendingDelete.current;
    if (!pending) return;
    if (workspace.syncError) {
      pendingDelete.current = null;
      setDeletingId(null);
      pending.resolve(false);
      return;
    }
    if (conversations.some(item => item.id === pending.id)) return;
    pendingDelete.current = null;
    setDeletingId(null);
    if (!pending.wasActive || (workspace.activeConversation && workspace.activeConversation.id !== pending.id)) {
      pending.resolve(true);
      return;
    }
    const next = conversations[0];
    if (next) {
      // setActive updates the host asynchronously from React's perspective;
      // prevent the following auto-create effect from racing that update.
      creating.current = true;
      activeIdRef.current = next.id;
      workspace.setActive(next.id);
      setWorkbenchTaskQuery(next.id);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("workbenchTask");
      window.history.replaceState(window.history.state, "", url);
    }
    pending.resolve(true);
  }, [workspace.state.conversations, workspace.activeConversation, workspace.syncError]);

  useEffect(() => {
    if (workspace.hydrated && newDraft && !newDraft.explicit && conversations.length) setNewDraft(null);
  }, [workspace.hydrated, newDraft, conversations.length]);
  useEffect(() => { if (workspace.activeConversation) creating.current = false; }, [workspace.activeConversation]);
  useEffect(() => { setSelectedAnswerKey(null); }, [active?.id]);

  const turns = ragLiveTurns(active && execution !== active.execution ? { ...active, execution } : active, controller.running);
  const currentTurn = turns.at(-1);
  const selectedTurn = turns.find(turn => turn.answerKey === selectedAnswerKey && turn.answer) ?? currentTurn;
  const selectedTaskId = selectedTurn?.taskId;
  const { source: otherAnswerSource } = useEnterpriseQaKnowledgeSource(selectedTaskId, Boolean(selectedTaskId && selectedTaskId !== localTaskId));
  const reviewSource = selectedTaskId === localTaskId ? taskSource : otherAnswerSource;
  const reviewKnowledge = selectedTaskId ? selectedTaskId === localTaskId ? knowledgeBase : reviewSource.knowledgeBase : newDraft ? currentPublication.knowledgeBase : null;
  const userMessage = active?.messages.findLast(message => message.role === "user");
  const previousTurns = turns.slice(0, -1);

  const steering = controller.steering;
  const persistedQuestion = userMessage?.content || "";
  // A different device may have appended more input before this client receives
  // its last task poll. Never mask that longer, server-persisted canonical input.
  const effectiveQuestion = steering?.effectiveQuestion &&
    !persistedQuestion.startsWith(`${steering.effectiveQuestion}\n\n补充：`)
    ? steering.effectiveQuestion : persistedQuestion;
  const live: EnterpriseRagLiveRuntime = {
    loaded: selectedTaskId ? reviewSource.loaded || Boolean(reviewKnowledge) : loaded,
    failed: selectedTaskId ? reviewSource.failed && !reviewKnowledge : failed,
    refreshFailed: Boolean(
      selectedSource.refreshFailed || currentPublication.refreshFailed,
    ),
    failureCode: selectedSource.failureCode,
    configured: selectedSource.configured,
    providerLabel:
      localTaskId && !taskSource.loaded
        ? "任务绑定模型"
        : enterpriseQaProviderLabel(selectedSource.provider),
    knowledgeBase: reviewKnowledge ?? null,
    currentKnowledgeBase: currentPublication.knowledgeBase ?? null,
    knowledgeBinding: selectedTurn?.answer && !selectedTaskId ? "historical_unknown" : selectedTaskId ? reviewKnowledge ? "frozen_task" : "historical_unknown" : knowledgeBinding,
    conversationId: newDraft?.key ?? active?.id ?? new URL(location.href).searchParams.get("workbenchTask") ?? undefined,
    draftAdoptedFrom,
    onDraftInput: () => { if (newDraft && !newDraft.explicit) setNewDraft({ ...newDraft, explicit: true }); },
    taskId: selectedTurn?.taskId,
    turnId: selectedTurn?.turnId,
    conversationReady: Boolean(newDraft || active?.purpose === "enterprise_qa"),
    canSend: !controller.busy && !controller.pendingDispatch && Boolean(newDraft || active?.purpose === "enterprise_qa"),
    question: selectedTurn?.question ?? "",
    questionId: selectedTurn?.questionId,
    answer: selectedTurn?.answer ?? "",
    previousTurns,
    answerId: selectedTurn?.answerId,
    answerCompletedAt: selectedTurn?.completedAt,
    selectedAnswerKey: selectedTurn?.answerKey,
    onSelectAnswer: key => { if (turns.some(turn => turn.answerKey === key && turn.answer)) setSelectedAnswerKey(key); },
    chat: { question: effectiveQuestion, answer: currentTurn?.answer ?? "", answerKey: currentTurn?.answerKey ?? `draft:${newDraft?.key ?? active?.id ?? "new"}`, sources: currentTurn?.sources ?? [], completedAt: currentTurn?.completedAt },
    sources: (selectedTurn?.sources ?? []) as EnterpriseRagLiveRuntime["sources"],
    busy: controller.busy,
    running: controller.running,
    runningTurnId: steering?.turnId ?? execution?.timeline.findLast(entry => entry.userMessageId === userMessage?.id || userMessage?.serverSequence !== undefined && entry.userSequence === userMessage.serverSequence)?.turnId,
    steeringSupported: steering?.supported === true,
    onSteer: controller.steer,
    activity: ragLiveActivity({ execution, questionId: userMessage?.id, questionSequence: userMessage?.serverSequence, turnId: steering?.turnId, running: controller.running }),
    pendingDispatchQuestion: controller.pendingDispatch?.question,
    notice: controller.notice || workspace.syncError || undefined,
    onAsk: async (question) => {
      setSelectedAnswerKey(null);
      if (!newDraft) return controller.send(question, []);
      if (creating.current) return false;
      creating.current = true;
      try {
        const id = workspaceRef.current.createConversation({ title: "企业问答", reuseEmpty: false, purpose: "enterprise_qa", workbenchAgentId: "enterprise-qa" });
        const now = Date.now();
        const draft: Conversation = { id, title: "企业问答", purpose: "enterprise_qa", workbenchAgentId: "enterprise-qa", messages: [], status: "idle", createdAt: now, updatedAt: now };
        setDraftAdoptedFrom(newDraft.key); setNewDraft(null); setWorkbenchTaskQuery(id);
        return await controller.send(question, [], draft);
      } finally { creating.current = false; }
    },
    onRetryPending: controller.retryPending,
    onStop: controller.stop,
    onRetryKnowledge: () => {
      retryCurrentPublication();
      if (localTaskId) retryTaskSource();
    },
    onStartNewConversation: startNewConversation,
    onOpenKnowledge: () => navigateWithinWorkspace("/?view=knowledge"),
    conversationHistory: {
      items: conversations.map(item => {
        const firstQuestion = item.messages.find(message => message.role === "user" && message.content.trim())?.content;
        const title = (!item.title || item.title === "企业问答") && firstQuestion ? firstQuestion.replace(/\s+/gu, " ").trim() : item.title || "新问答";
        return { id: item.id, title, subtitle: Number.isFinite(item.updatedAt) ? new Date(item.updatedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : undefined,
          disabled: item.status === "running" || item.status === "pending" };
      }),
      activeId: newDraft ? null : active?.id,
      loading: !workspace.hydrated || workspace.loading,
      error: workspace.syncError || undefined,
      busy: historyBusy,
      deletingId,
      onOpen: () => { void workspace.refreshConversations(); },
      onSelect: (id: string) => {
        const item = workspaceRef.current.state.conversations.find(candidate => candidate.id === id && (candidate.purpose === "enterprise_qa" || (!candidate.purpose && candidate.workbenchAgentId === "enterprise-qa")));
        if (blockedRef.current || pendingDelete.current || !item || item.status === "running" || item.status === "pending") return false;
        setNewDraft(null); setDraftAdoptedFrom(undefined); setSelectedAnswerKey(null);
        activeIdRef.current = id;
        workspaceRef.current.setActive(id);
        setWorkbenchTaskQuery(id);
        return true;
      },
      onDelete: (id: string) => {
        const item = workspaceRef.current.state.conversations.find(candidate => candidate.id === id && (candidate.purpose === "enterprise_qa" || (!candidate.purpose && candidate.workbenchAgentId === "enterprise-qa")));
        if (blockedRef.current || !item || item.status === "running" || item.status === "pending" || pendingDelete.current) return Promise.resolve(false);
        return new Promise<boolean>(resolve => {
          workspaceRef.current.clearSyncError();
          pendingDelete.current = { id, wasActive: id === activeIdRef.current, resolve };
          setDeletingId(id);
          const fail = () => {
            if (pendingDelete.current?.id !== id) return;
            pendingDelete.current = null;
            setDeletingId(null);
            resolve(false);
          };
          try {
            const result = workspaceRef.current.deleteConversation(id);
            if (result && typeof result.then === "function") void result.then(ok => { if (!ok) fail(); }, fail);
          } catch { fail(); }
        });
      },
    },
  };

  return (
    <EnterpriseRagPreview
      onOpenWebsite={openWebsite}
      onOpenWebsiteAssistant={openWebsiteAssistant}
      websiteEntryLabel={websiteEntryLabel}
      buildReportUrl={buildReportUrl}
      storageScopeKey={
        storageScopeKey ?? workspace.workbenchScopeKey ?? projectId
      }
      live={live}
    />
  );
}

/** The designed RAG surface backed by the same durable enterprise-QA task
 * transport and frozen published knowledge version as the classic chat. */
export default function EnterpriseRagWorkspace({
  workbench = false,
  projectId = "account",
  ...props
}: EnterpriseRagWorkspaceProps) {
  const { source: currentPublication, retry: retryCurrentPublication } =
    useEnterpriseQaKnowledgeSource();
  const publicationReady = Boolean(
    currentPublication.loaded &&
      !currentPublication.failed &&
      currentPublication.configured === true &&
      currentPublication.provider &&
      currentPublication.knowledgeBase,
  );
  const main = (
    <EnterpriseRagLiveWorkspace
      {...props}
      projectId={projectId}
      currentPublication={currentPublication}
      retryCurrentPublication={retryCurrentPublication}
      allowConversationCreation={publicationReady}
    />
  );

  if (workbench) {
    return (
      <ProjectAgentWorkbench
        projectId={projectId}
        purpose="enterprise_qa"
        main={main}
        autoCreate={false}
        canCreateConversation={publicationReady}
      >
        <EnterpriseQaSourceNote
          currentPublication={currentPublication}
          onRetryPublication={retryCurrentPublication}
        />
      </ProjectAgentWorkbench>
    );
  }
  return (
    <ConversationPurposeProvider purpose="enterprise_qa">
      {main}
    </ConversationPurposeProvider>
  );
}

