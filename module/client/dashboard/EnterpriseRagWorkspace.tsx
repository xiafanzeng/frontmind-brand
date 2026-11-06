import { useCallback, useEffect, useRef, useState } from "react";
import { finalReplyIds } from "../lib/final-reply";
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
  const controller = useEnterpriseQaController();
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
    if (
      !allowConversationCreation ||
      controller.busy ||
      pendingDelete.current ||
      creating.current
    )
      return;
    creating.current = true;
    const conversationId = workspace.createConversation({
      title: "企业问答",
      reuseEmpty: false,
      purpose: "enterprise_qa",
      workbenchAgentId: "enterprise-qa",
    });
    setWorkbenchTaskQuery(conversationId);
  }, [allowConversationCreation, controller.busy, workspace]);

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
    if (
      !allowConversationCreation ||
      !workspace.hydrated ||
      workspace.activeConversation ||
      pendingDelete.current ||
      creating.current
    )
      return;
    if (conversations.length) {
      creating.current = true;
      workspace.setActive(conversations[0].id);
      setWorkbenchTaskQuery(conversations[0].id);
      return;
    }
    startNewConversation();
  }, [
    allowConversationCreation,
    workspace.hydrated,
    workspace.activeConversation,
    workspace.state.conversations,
    startNewConversation,
  ]);
  useEffect(() => {
    if (workspace.activeConversation) creating.current = false;
  }, [workspace.activeConversation]);

  const messages = active?.messages ?? [];
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const finalIds = finalReplyIds(
    messages,
    execution,
    controller.running,
  );
  const answerIndex = messages.findLastIndex(
    (message, index) =>
      index > lastUserIndex &&
      message.role === "assistant" &&
      finalIds.has(message.id),
  );
  const userMessage = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const answerMessage = answerIndex >= 0 ? messages[answerIndex] : undefined;
  const previousTurns = messages.flatMap((message, index) => {
    if (message.role !== "user" || index >= lastUserIndex || !message.content.trim()) return [];
    const nextUser = messages.findIndex((candidate, position) => position > index && candidate.role === "user");
    const final = messages.slice(index + 1, nextUser < 0 ? undefined : nextUser).findLast(candidate =>
      candidate.role === "assistant" && finalIds.has(candidate.id) && !candidate.isStepsPlaceholder && Boolean(candidate.content.trim()) &&
      (!candidate.generalChat?.userMessageId || candidate.generalChat.userMessageId === message.id),
    );
    return [{ id: message.id, question: message.content, answer: final?.content ?? "" }];
  });
  const steering = controller.steering;
  const persistedQuestion = userMessage?.content || "";
  // A different device may have appended more input before this client receives
  // its last task poll. Never mask that longer, server-persisted canonical input.
  const effectiveQuestion = steering?.effectiveQuestion &&
    !persistedQuestion.startsWith(`${steering.effectiveQuestion}\n\n补充：`)
    ? steering.effectiveQuestion : persistedQuestion;
  const live: EnterpriseRagLiveRuntime = {
    loaded,
    failed,
    refreshFailed: Boolean(
      selectedSource.refreshFailed || currentPublication.refreshFailed,
    ),
    failureCode: selectedSource.failureCode,
    configured: selectedSource.configured,
    providerLabel:
      localTaskId && !taskSource.loaded
        ? "任务绑定模型"
        : enterpriseQaProviderLabel(selectedSource.provider),
    knowledgeBase,
    currentKnowledgeBase: currentPublication.knowledgeBase ?? null,
    knowledgeBinding,
    conversationId: active?.id,
    taskId: localTaskId ?? undefined,
    turnId: answerMessage?.generalChat?.turnId,
    conversationReady: Boolean(active?.purpose === "enterprise_qa"),
    question: effectiveQuestion,
    questionId: userMessage?.id,
    answer: answerMessage?.content ?? "",
    previousTurns,
    answerId: answerMessage?.id,
    answerCompletedAt: answerMessage?.timestamp,
    questionStartedAt: userMessage?.timestamp,
    answerDurationMs: answerMessage && userMessage && Number.isFinite(answerMessage.timestamp) && Number.isFinite(userMessage.timestamp) && answerMessage.timestamp >= userMessage.timestamp
      ? answerMessage.timestamp - userMessage.timestamp
      : undefined,
    sources: answerMessage?.enterpriseQaAnswer?.sources ?? [],
    busy: controller.busy,
    running: controller.running,
    runningTurnId: steering?.turnId ?? execution?.timeline.findLast(entry => entry.userMessageId === userMessage?.id || userMessage?.serverSequence !== undefined && entry.userSequence === userMessage.serverSequence)?.turnId,
    steeringSupported: steering?.supported === true,
    onSteer: controller.steer,
    activity: ragLiveActivity({ execution, questionId: userMessage?.id, questionSequence: userMessage?.serverSequence, turnId: steering?.turnId, running: controller.running }),
    pendingDispatchQuestion: controller.pendingDispatch?.question,
    notice: controller.notice || workspace.syncError || undefined,
    onAsk: (question) => controller.send(question, []),
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
      activeId: active?.id,
      loading: !workspace.hydrated || workspace.loading,
      error: workspace.syncError || undefined,
      busy: historyBusy,
      deletingId,
      onOpen: () => { void workspace.refreshConversations(); },
      onSelect: (id: string) => {
        const item = workspaceRef.current.state.conversations.find(candidate => candidate.id === id && (candidate.purpose === "enterprise_qa" || (!candidate.purpose && candidate.workbenchAgentId === "enterprise-qa")));
        if (blockedRef.current || pendingDelete.current || !item || item.status === "running" || item.status === "pending") return false;
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

