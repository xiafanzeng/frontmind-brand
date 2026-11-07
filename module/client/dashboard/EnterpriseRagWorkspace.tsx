import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "../conversation-types";
import { normalizeRagEpochMilliseconds, ragLiveTurns } from "./ai-website-preview/rag-live-turns";
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
import { hasUnresolvedGeneralChatDispatch } from "../lib/general-chat-dispatch-state";
import { useRagStarterQuestions } from "./rag-starter-questions-api";

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

function conversationDeletionBlocked(conversation: Conversation) {
  if (hasUnresolvedGeneralChatDispatch(conversation.messages)) return true;
  if (conversation.status !== "running" && conversation.status !== "pending") return false;
  // Old website-assistant rows can retain a running scalar after the server
  // final is already present. Only an actually unanswered latest turn remains locked.
  return !ragLiveTurns(conversation, false).at(-1)?.answer;
}

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
  const starterQuestions = useRagStarterQuestions(true);
  const creating = useRef(false);
  const pendingDelete = useRef<{ id: string; wasActive: boolean; resolve: (ok: boolean) => void } | null>(null);
  const deletingIdRef = useRef<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<{ key: string; explicit: boolean } | null>(() => ({ key: `draft:${crypto.randomUUID()}`, explicit: true }));
  const [draftAdoptedFrom, setDraftAdoptedFrom] = useState<string>();
  const [selectedAnswerKey, setSelectedAnswerKey] = useState<string | null>(null);
  const controller = useEnterpriseQaController({ evaluationIntent: "enterprise_rag_once", activeConversationId: newDraft ? null : undefined });
  const active = controller.active;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const activeIdRef = useRef(active?.id ?? null);
  useEffect(() => {
    // The host clears an active row while acknowledging its deletion. Keep
    // the last explicit selection until the removal effect can choose the
    // successor; explicit history/new-draft navigation updates this ref
    // synchronously and therefore remains authoritative during that window.
    if (active?.id) activeIdRef.current = active.id;
    else if (!pendingDelete.current) activeIdRef.current = null;
  }, [active?.id]);
  useEffect(() => () => {
    pendingDelete.current?.resolve(false);
    pendingDelete.current = null;
    deletingIdRef.current = null;
  }, []);
  const conversations = workspace.state.conversations.filter(item =>
    item.purpose === "enterprise_qa" || (!item.purpose && item.workbenchAgentId === "enterprise-qa"),
  ).sort((a, b) =>
    (normalizeRagEpochMilliseconds(b.updatedAt) ?? Number.NEGATIVE_INFINITY) -
    (normalizeRagEpochMilliseconds(a.updatedAt) ?? Number.NEGATIVE_INFINITY));
  const historyBusy = false;
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
    if (creating.current) return;
    activeIdRef.current = null;
    setNewDraft({ key: `draft:${crypto.randomUUID()}`, explicit: true });
    setDraftAdoptedFrom(undefined);
    setSelectedAnswerKey(null);
    const url = new URL(location.href); url.searchParams.delete("workbenchTask");
    history.replaceState(history.state, "", url);
  }, []);

  // The host deletion API reports errors via syncError and changes the list
  // only after the server confirms removal. Keep the selection until then.
  useEffect(() => {
    const pending = pendingDelete.current;
    if (!pending) return;
    if (workspace.syncError) {
      pendingDelete.current = null;
      deletingIdRef.current = null;
      setDeletingId(null);
      pending.resolve(false);
      return;
    }
    if (conversations.some(item => item.id === pending.id)) return;
    pendingDelete.current = null;
    deletingIdRef.current = null;
    setDeletingId(null);
    if (!pending.wasActive || activeIdRef.current !== pending.id) {
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
      activeIdRef.current = null;
      setNewDraft({ key: `draft:${crypto.randomUUID()}`, explicit: true });
      setDraftAdoptedFrom(undefined);
      setSelectedAnswerKey(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("workbenchTask");
      window.history.replaceState(window.history.state, "", url);
    }
    pending.resolve(true);
  }, [workspace.state.conversations, workspace.activeConversation, workspace.syncError]);

  // Opening or refreshing this page always starts at an independent blank draft.
  // History hydration never becomes a navigation action.
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.delete("workbenchTask");
    history.replaceState(history.state, "", url);
  }, []);
  useEffect(() => { if (workspace.activeConversation) creating.current = false; }, [workspace.activeConversation]);
  useEffect(() => { setSelectedAnswerKey(null); }, [active?.id]);

  const turns = ragLiveTurns(active, controller.running);
  const currentTurn = turns.at(-1);
  const selectedTurn = turns.find(turn => turn.answerKey === selectedAnswerKey && turn.answer && turn.evaluation !== "not_required") ?? currentTurn;
  const selectedTaskId = selectedTurn?.taskId;
  const { source: otherAnswerSource } = useEnterpriseQaKnowledgeSource(selectedTaskId, Boolean(selectedTaskId && selectedTaskId !== localTaskId));
  const reviewSource = selectedTaskId === localTaskId ? taskSource : otherAnswerSource;
  const localReplyKnowledge = selectedTurn?.knowledgeBase ?? null;
  const reviewKnowledge = selectedTaskId
    ? selectedTaskId === localTaskId ? knowledgeBase : reviewSource.knowledgeBase
    : localReplyKnowledge ?? (newDraft ? currentPublication.knowledgeBase : null);
  const userMessage = active?.messages.findLast(message => message.role === "user");
  const knowledgeForTurn = (turn: (typeof turns)[number]) => turn.knowledgeBase
    ?? (turn.taskId && turn.taskId === localTaskId ? boundTaskKnowledgeBase : null)
    ?? (turn.answerKey === selectedTurn?.answerKey ? reviewKnowledge : null)
    ?? undefined;
  const presentedCurrentTurn = currentTurn
    ? { ...currentTurn, knowledgeBase: knowledgeForTurn(currentTurn) }
    : undefined;
  const previousTurns = turns.slice(0, -1).map(turn => ({
    ...turn,
    knowledgeBase: knowledgeForTurn(turn),
  }));
  const conversationReady = Boolean(newDraft || active?.purpose === "enterprise_qa");
  const conversationKnowledgeReady = localTaskId
    ? Boolean(boundTaskKnowledgeBase)
    : allowConversationCreation;
  const canCompose = conversationReady && conversationKnowledgeReady;

  const steering = controller.steering;
  const persistedQuestion = userMessage?.content || "";
  // A different device may have appended more input before this client receives
  // its last task poll. Never mask that longer, server-persisted canonical input.
  const effectiveQuestion = steering?.effectiveQuestion &&
    !persistedQuestion.startsWith(`${steering.effectiveQuestion}\n\n补充：`)
    ? steering.effectiveQuestion : persistedQuestion;
  const live: EnterpriseRagLiveRuntime = {
    loaded: selectedTaskId ? reviewSource.loaded || Boolean(reviewKnowledge) : localReplyKnowledge ? true : loaded,
    failed: selectedTaskId ? reviewSource.failed && !reviewKnowledge : localReplyKnowledge ? false : failed,
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
    knowledgeBinding: selectedTurn?.answer && !selectedTaskId
      ? localReplyKnowledge ? "frozen_task" : "historical_unknown"
      : selectedTaskId ? reviewKnowledge ? "frozen_task" : "historical_unknown" : knowledgeBinding,
    conversationId: newDraft?.key ?? active?.id ?? new URL(location.href).searchParams.get("workbenchTask") ?? undefined,
    draftAdoptedFrom,
    onDraftInput: () => { if (newDraft && !newDraft.explicit) setNewDraft({ ...newDraft, explicit: true }); },
    taskId: selectedTurn?.taskId,
    turnId: selectedTurn?.turnId,
    conversationReady,
    canCompose,
    canSend: canCompose && !controller.busy && !controller.pendingDispatch,
    question: selectedTurn?.question ?? "",
    questionId: selectedTurn?.questionId,
    answer: selectedTurn?.answer ?? "",
    previousTurns,
    answerId: selectedTurn?.answerId,
    answerCompletedAt: selectedTurn?.completedAt,
    evaluationNotRequired: selectedTurn?.evaluation === "not_required",
    selectedAnswerKey: selectedTurn?.answerKey,
    onSelectAnswer: key => { if (turns.some(turn => turn.answerKey === key && turn.answer && turn.evaluation !== "not_required")) setSelectedAnswerKey(key); },
    chat: { question: effectiveQuestion, answer: presentedCurrentTurn?.answer ?? "", answerKey: presentedCurrentTurn?.answerKey ?? `draft:${newDraft?.key ?? active?.id ?? "new"}`, sources: presentedCurrentTurn?.sources ?? [], completedAt: presentedCurrentTurn?.completedAt, evaluation: presentedCurrentTurn?.evaluation, knowledgeBase: presentedCurrentTurn?.knowledgeBase ?? (newDraft ? currentPublication.knowledgeBase : undefined) },
    sources: (selectedTurn?.sources ?? []) as EnterpriseRagLiveRuntime["sources"],
    busy: controller.busy,
    running: controller.running,
    runningTurnId: steering?.turnId ?? active?.execution?.timeline.findLast(entry => entry.userMessageId === userMessage?.id || userMessage?.serverSequence !== undefined && entry.userSequence === userMessage.serverSequence)?.turnId,
    steeringSupported: steering?.supported === true,
    onSteer: controller.steer,
    onFollowup: controller.enqueueFollowup,
    followups: (controller.followups ?? []).flatMap(item => item.status === "completed" || item.status === "cancelled" ? [] : [{id:item.id,text:item.text,status:item.status,error:item.error}]),
    followupsPaused: controller.followupsPaused,
    onCancelFollowup: controller.cancelFollowup,
    onResumeFollowups: controller.resumeFollowups,
    onRetryFollowup: controller.retryFollowup,
    activity: ragLiveActivity({ execution: active?.execution, questionId: userMessage?.id, questionSequence: userMessage?.serverSequence, turnId: steering?.turnId, running: controller.running }),
    pendingDispatchQuestion: controller.pendingDispatch?.question,
    notice: controller.notice || workspace.syncError || undefined,
    onAsk: async (question) => {
      if (!canCompose) return false;
      setSelectedAnswerKey(null);
      if (!newDraft) return controller.send(question, []);
      if (creating.current) return false;
      creating.current = true;
      try {
        const id = workspaceRef.current.createConversation({ title: "企业问答", reuseEmpty: false, purpose: "enterprise_qa", workbenchAgentId: "enterprise-qa" });
        const now = Date.now();
        const draft: Conversation = { id, title: "企业问答", purpose: "enterprise_qa", workbenchAgentId: "enterprise-qa", messages: [], status: "idle", createdAt: now, updatedAt: now };
        setDraftAdoptedFrom(newDraft.key); setNewDraft(null); setWorkbenchTaskQuery(id);
        const submission = controller.send(question, [], draft);
        creating.current = false;
        return await submission;
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
    starterQuestions: {
      current: starterQuestions.data?.current
        ? { id: starterQuestions.data.current.id, questions: starterQuestions.data.current.questions }
        : null,
      draft: starterQuestions.data?.draft
        ? { id: starterQuestions.data.draft.id, questions: starterQuestions.data.draft.questions }
        : null,
      pending: starterQuestions.data?.pending ?? false,
      error: starterQuestions.data?.error ?? starterQuestions.error?.message ?? null,
      revision: starterQuestions.data?.revision ?? 0,
    },
    onConfirmStarterQuestions: async questions => {
      await starterQuestions.confirm(questions);
      return true;
    },
    onRegenerateStarterQuestions: async () => {
      await starterQuestions.regenerate();
      return true;
    },
    onDiscardStarterDraft: async () => {
      await starterQuestions.discard();
      return true;
    },
    conversationHistory: {
      items: conversations.map(item => {
        const firstQuestion = item.messages.find(message => message.role === "user" && message.content.trim())?.content;
        const title = (!item.title || item.title === "企业问答") && firstQuestion ? firstQuestion.replace(/\s+/gu, " ").trim() : item.title || "新问答";
        const updatedAt = normalizeRagEpochMilliseconds(item.updatedAt);
        return { id: item.id, title, subtitle: updatedAt !== undefined ? new Date(updatedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : undefined,
          deletingDisabled: conversationDeletionBlocked(item) };
      }),
      activeId: newDraft ? null : active?.id,
      loading: !workspace.hydrated || workspace.loading,
      error: workspace.syncError || undefined,
      busy: historyBusy,
      deletingId,
      onOpen: () => { void workspace.refreshConversations(); },
      onSelect: (id: string) => {
        if (deletingIdRef.current === id) return false;
        const item = workspaceRef.current.state.conversations.find(candidate => candidate.id === id && (candidate.purpose === "enterprise_qa" || (!candidate.purpose && candidate.workbenchAgentId === "enterprise-qa")));
        if (!item) return false;
        setNewDraft(null); setDraftAdoptedFrom(undefined); setSelectedAnswerKey(null);
        activeIdRef.current = id;
        workspaceRef.current.setActive(id);
        setWorkbenchTaskQuery(id);
        return true;
      },
      onDelete: (id: string) => {
        const item = workspaceRef.current.state.conversations.find(candidate => candidate.id === id && (candidate.purpose === "enterprise_qa" || (!candidate.purpose && candidate.workbenchAgentId === "enterprise-qa")));
        if (!item || (id === activeIdRef.current && controller.pendingDispatch) || conversationDeletionBlocked(item) || pendingDelete.current) return Promise.resolve(false);
        return new Promise<boolean>(resolve => {
          workspaceRef.current.clearSyncError();
          pendingDelete.current = { id, wasActive: id === activeIdRef.current, resolve };
          deletingIdRef.current = id;
          setDeletingId(id);
          const fail = () => {
            if (pendingDelete.current?.id !== id) return;
            pendingDelete.current = null;
            deletingIdRef.current = null;
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

