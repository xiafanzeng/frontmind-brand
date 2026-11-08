import "./knowledge-conversation.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import BrandConversationMessage from "./BrandConversationMessage";
import { EmptyConversationHint } from "./KnowledgeStarter";
import { useKnowledgeBaseStarter } from "../lib/useKnowledgeBaseStarter";
import {
  useKnowledgeBaseUploadBatch,
  useKnowledgeBaseUploadField,
} from "../lib/knowledge-base-upload-manager";
import KnowledgeBaseManagedUploadRecovery from "./KnowledgeBaseManagedUploadRecovery";
import { sanitizeKnowledgeBaseOutputMessages, knowledgeBaseMessageIdentity } from "../knowledge-conversation-state";
import {
  ChatInput,
  useConversation,
  useRuntimeContext,
  type BrandHomeProps,
} from "../host";
import KnowledgeWorkspaceStatus from "./KnowledgeWorkspaceStatus";
import { knowledgeBaseNoticeRecoveryMode } from "../lib/knowledge-notice";
import { KNOWLEDGE_BASE_RESET_REQUEST_EVENT, reconcileKnowledgeBaseObservation } from "../lib/knowledge-progress";
import { Button } from "@frontmind/module-ui/components/ui/button";
import { KnowledgeExecutionActivity } from "./KnowledgeExecutionActivity";
import { KnowledgeDraftComposerStatus } from "./KnowledgeDraftNodeWorkspace";
import { generalExecutionSlots } from "../lib/general-execution-display";
import { finalReplyIds } from "../lib/final-reply";
import { conversationExecutionTimings } from "../lib/execution-duration";
import { ExecutionDivider } from "./ExecutionDuration";
import {
  isLocalKnowledgeConfirmation,
  knowledgeExecutionItems,
} from "../lib/knowledge-execution-presentation";
export { default as KnowledgeComposer } from "./KnowledgeComposer";

const readingPositions = new Map<string, { top: number; presentationId?: string }>();

/** Public knowledge build/conversation UI, shared by main and module domains. */
export default function KnowledgeConversation(props: BrandHomeProps) {
  const context = useConversation();
  const runtime = useRuntimeContext();
  const conversation = context.activeConversation;
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState("");
  const { hydrated, registerKnowledgeBaseConversation, wakeKnowledgeBaseConversation } = context;
  const hasKnownBuild = Boolean(
    props.knowledgeBaseProgress || conversation?.taskId ||
    conversation?.knowledgeBase?.initialized || conversation?.knowledgeBase?.activeTurnId ||
    conversation?.messages.some(message => message.knowledgeBase?.serverOwned === true),
  );
  useEffect(() => {
    if (!hydrated || !conversation?.id) return;
    registerKnowledgeBaseConversation(conversation.id);
    if (hasKnownBuild) wakeKnowledgeBaseConversation(conversation.id);
    // The enterprise conversation runtime owns polling across page changes.
  }, [hydrated, conversation?.id, hasKnownBuild, registerKnowledgeBaseConversation, wakeKnowledgeBaseConversation]);
  const scope = `${context.workbenchScopeKey ?? runtime.workspaceId}:${runtime.accountId}:${conversation?.id ?? "new"}`;
  const batch = useKnowledgeBaseUploadBatch(
    `${scope}:${props.knowledgeBaseResetRevision ?? 0}`,
    `${scope}:`,
  );
  const [locallyStarting] = useKnowledgeBaseUploadField(batch, "isStarting", false);
  const [localBatchStartedAt] = useKnowledgeBaseUploadField<number | null>(
    batch,
    "batchStartedAt",
    null,
  );
  const start = useKnowledgeBaseStarter(batch);
  const messages = sanitizeKnowledgeBaseOutputMessages(
    conversation?.messages ?? [],
  ).map((message) => props.messageProjection?.(message) ?? message);
  const running = Boolean(
    conversation && ["running", "pending"].includes(conversation.status),
  );
  const localTurns = new Set(
    messages
      .filter(isLocalKnowledgeConfirmation)
      .flatMap((message) =>
        message.knowledgeBase?.turnId ? [message.knowledgeBase.turnId] : [],
      ),
  );
  const displayedExecution = conversation?.execution ?? (
    props.knowledgeBaseProgress?.build.conversationId === conversation?.id
      ? props.knowledgeBaseProgress?.execution
      : undefined
  );
  const slots = generalExecutionSlots(messages, displayedExecution, running);
  const draftPreview = props.knowledgeBaseProgress?.branches.some(branch => branch.leaves.length > 0)
    ? undefined : props.knowledgeBaseProgress?.draftPreview;
  const copyable = finalReplyIds(messages, displayedExecution, running);
  const timings = conversation
    ? conversationExecutionTimings({ ...conversation, execution: displayedExecution }, messages)
    : new Map();
  const viewport = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const currentPresentation = messages.findLast(
    (message) =>
      message.knowledgeBase?.kind === "presentation" &&
      message.knowledgeBase.presentationKey ===
        conversation?.knowledgeBase?.presentationKey,
  );
  const presentationId = currentPresentation?.id;
  const readingKey = `${scope}:${props.knowledgeBaseProgress?.build.id ?? messages.findLast(message => message.knowledgeBase?.buildId)?.knowledgeBase?.buildId ?? "pending"}:${props.knowledgeBaseResetRevision ?? 0}:${conversation?.knowledgeBase?.generation ?? props.knowledgeBaseProgress?.workbench?.generation ?? "unknown"}`;
  useLayoutEffect(() => {
    const saved = readingPositions.get(readingKey);
    if (saved && viewport.current) viewport.current.scrollTop = saved.top;
  }, [readingKey]);
  useEffect(() => {
    if (!presentationId || readingPositions.get(readingKey)?.presentationId === presentationId) return;
    const frame = requestAnimationFrame(() => {
      const element = messageElements.current.get(presentationId);
      const container = viewport.current;
      if (!element || !container) return;
      const top =
        container.scrollTop +
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        16;
      container.scrollTop = Math.max(0, top);
      readingPositions.set(readingKey, { top: container.scrollTop, presentationId });
      element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [readingKey, presentationId]);

  const renderMessage = (message: (typeof messages)[number]) => (
    <article
      key={knowledgeBaseMessageIdentity(message)}
      tabIndex={-1}
      ref={(element) => {
        if (element) messageElements.current.set(message.id, element);
        else messageElements.current.delete(message.id);
      }}
      data-reading-anchor={message.id}
      className={`brand-knowledge-message brand-knowledge-message--${message.role}`}
    >
      {props.inlineBlocks
        ?.filter(
          (block) =>
            block.anchor.messageId === message.id &&
            block.placement === "before",
        )
        .map((block) => (
          <div key={block.id}>{block.content}</div>
        ))}
      <KnowledgeExecutionActivity
        turnStates={displayedExecution?.turnStates} turnHistory={displayedExecution?.turnHistory}
        items={knowledgeExecutionItems(
          slots.before.get(message.id),
          localTurns,
        )}
      />
      <BrandConversationMessage
        message={message}
        allowCopy={copyable.has(message.id)}
      >
        {props.inlineBlocks
          ?.filter(
            (block) =>
              block.anchor.messageId === message.id &&
              block.placement === "after",
          )
          .map((block) => (
            <div key={block.id}>{block.content}</div>
          ))}
      </BrandConversationMessage>
      {message.role === "user" && (
        <ExecutionDivider
          timing={
            isLocalKnowledgeConfirmation(message) || slots.after.get(message.id)?.some(item => displayedExecution?.turnStates?.[item.turnId])
              ? undefined
              : timings.get(message.id)
          }
        />
      )}
      <KnowledgeExecutionActivity
        turnStates={displayedExecution?.turnStates} turnHistory={displayedExecution?.turnHistory}
        items={knowledgeExecutionItems(slots.after.get(message.id), localTurns)}
        placement="after"
      />
    </article>
  );
  const firstNodeIndex = messages.findIndex(
    (message) => message.knowledgeBase?.kind === "presentation",
  );
  const foldResearch = !running && firstNodeIndex > 0;
  if (!context.hydrated && !hasKnownBuild && !messages.length)
    return (
      <p role="status">
        {context.loading
          ? "正在恢复知识库任务…"
          : (context.syncError ?? "知识库任务未加载")}
        <button onClick={() => void context.refreshConversations()}>
          重新读取
        </button>
      </p>
    );
  const hasStarted =
    conversation?.knowledgeBase?.initialized ||
    running ||
    messages.some((message) => message.knowledgeBase?.kind === "pending_user");
  const knowledge = conversation?.knowledgeBase;
  const notice = knowledge?.notice;
  const recoveryMode = notice ? knowledgeBaseNoticeRecoveryMode(notice) : "none";
  async function rereadKnowledge() {
    if (!conversation || rechecking) return;
    setRechecking(true);
    setRecheckError("");
    try {
      const observation = await reconcileKnowledgeBaseObservation({ conversationId: conversation.id });
      context.commitKnowledgeBaseObservation(conversation.id, observation);
      wakeKnowledgeBaseConversation(conversation.id);
    } catch (error) {
      setRecheckError(error instanceof Error ? error.message : "暂时无法读取任务状态");
    } finally {
      setRechecking(false);
    }
  }
  const keepLocalStarter = locallyStarting || (
    localBatchStartedAt !== null &&
    knowledge?.activeTurnOperationType === "start" &&
    knowledge.activeTurnAwaitingClientAttachments
  );
  const recoverStart =
    !keepLocalStarter &&
    knowledge?.activeTurnOperationType === "start" &&
    knowledge.activeTurnAwaitingClientAttachments &&
    knowledge.activeTurnId && knowledge.activeClientRequestId
      ? {
          turnId: knowledge.activeTurnId,
          clientRequestId: knowledge.activeClientRequestId,
          resetRevision: props.knowledgeBaseResetRevision ?? knowledge.activeTurnResetRevision ?? 0,
        }
      : null;
  return (
    <section
      className="brand-knowledge-conversation"
      aria-label="知识库构建与恢复"
    >
      {context.syncError && <p role="alert">{context.syncError}</p>}
      {keepLocalStarter || (!hasStarted && !hasKnownBuild && !messages.length && !props.knowledgeBaseProgress) ? (
        <EmptyConversationHint
          uploadScopeKey={scope}
          resetRevision={props.knowledgeBaseResetRevision ?? 0}
          eligible={!props.knowledgeEditingBlocked}
          companyName=""
          companyConfigured={false}
          companyLoading={false}
          inline
          onDirtyChange={props.onComposerDirtyChange}
          onStartKnowledgeBase={start}
          onBatchCancelled={(revision) =>
            conversation
              ? props.onKnowledgeBaseBatchCancelled?.(conversation.id, revision)
              : undefined
          }
        />
      ) : (
        <>
          <div
            ref={viewport}
            onScroll={(event) => {
              readingPositions.set(readingKey, { top: event.currentTarget.scrollTop, presentationId });
              if (readingPositions.size > 100) readingPositions.delete(readingPositions.keys().next().value!);
            }}
            className="brand-knowledge-transcript"
            data-testid="chat-messages-viewport"
          >
            {foldResearch && (
              <details className="brand-knowledge-research-history">
                <summary>初始资料采集与知识构建过程</summary>
                {messages.slice(0, firstNodeIndex).map(renderMessage)}
              </details>
            )}
            {(foldResearch ? messages.slice(firstNodeIndex) : messages).map(
              renderMessage,
            )}
            {props.conversationFooter}
          </div>
          {props.knowledgeBaseProgress && (
            <KnowledgeWorkspaceStatus progress={props.knowledgeBaseProgress} />
          )}
          {notice && (
            <div className="knowledge-workspace-status" data-testid="knowledge-base-notice">
              <p role={notice.severity === "error" ? "alert" : "status"}>{notice.message}</p>
              {knowledge?.retainedCustomerAttachmentCount ? (
                <p>{knowledge.retainedCustomerAttachmentCount} 个客户附件已保留</p>
              ) : null}
              {recoveryMode === "reconcile" && (
                <Button variant="outline" size="sm" disabled={rechecking} onClick={() => void rereadKnowledge()}>
                  {rechecking ? "正在读取任务状态…" : notice.recoveryAction === "top_up" ? "补充额度后继续" : "检查当前任务状态"}
                </Button>
              )}
              {(recoveryMode === "reset" || recoveryMode === "logo_repair") && (
                <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(KNOWLEDGE_BASE_RESET_REQUEST_EVENT))}>
                  重置后重新上传
                </Button>
              )}
              {recheckError && <p role="alert">{recheckError}</p>}
            </div>
          )}
          {recoverStart && conversation ? (
            <KnowledgeBaseManagedUploadRecovery
              operationType="start"
              conversationId={conversation.id}
              turnId={recoverStart.turnId}
              clientRequestId={recoverStart.clientRequestId}
              expectedResetRevision={recoverStart.resetRevision}
              onObservation={observation =>
                context.commitKnowledgeBaseObservation(conversation.id, observation)
              }
              onRecovered={() => context.wakeKnowledgeBaseConversation(conversation.id)}
            />
          ) : draftPreview ? (
            <KnowledgeDraftComposerStatus preview={draftPreview} authority={displayedExecution?.turnStates?.[draftPreview.turnId]} />
          ) : (
            <ChatInput {...props} operatorWorkspace syncKnowledgeBaseSnapshot />
          )}
        </>
      )}
    </section>
  );
}
