import { useCallback, useEffect, useRef } from "react";
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
import {
  EnterpriseRagPreview,
  type EnterpriseRagLiveRuntime,
} from "./ai-website-preview/EnterpriseRagPreview";

export type EnterpriseRagWorkspaceProps = {
  workbench?: boolean;
  projectId?: string;
  storageScopeKey?: string;
  onOpenWebsite?: () => void;
  onOpenWebsiteAssistant?: () => void;
  websiteEntryLabel?: string;
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
}: EnterpriseRagLiveWorkspaceProps) {
  const workspace = useConversation();
  const creating = useRef(false);
  const controller = useEnterpriseQaController();
  const active = controller.active;
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
    (() => navigateWithinWorkspace("/?view=website&step=assistant"));

  const startNewConversation = useCallback(() => {
    if (
      !allowConversationCreation ||
      controller.busy ||
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

  useEffect(() => {
    if (
      !allowConversationCreation ||
      !workspace.hydrated ||
      workspace.activeConversation ||
      creating.current
    )
      return;
    startNewConversation();
  }, [
    allowConversationCreation,
    workspace.hydrated,
    workspace.activeConversation,
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
    active?.execution,
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
    taskId: localTaskId ?? undefined,
    conversationReady: Boolean(active?.purpose === "enterprise_qa"),
    question: userMessage?.content ?? "",
    questionId: userMessage?.id,
    answer: answerMessage?.content ?? "",
    answerId: answerMessage?.id,
    sources: answerMessage?.enterpriseQaAnswer?.sources ?? [],
    busy: controller.busy,
    running: controller.running,
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
  };

  return (
    <EnterpriseRagPreview
      onOpenWebsite={openWebsite}
      onOpenWebsiteAssistant={openWebsiteAssistant}
      websiteEntryLabel={websiteEntryLabel}
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

