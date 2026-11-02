import "./knowledge-conversation.css";
import { useEffect, useRef } from "react";
import BrandConversationMessage from "./BrandConversationMessage";
import { EmptyConversationHint } from "./KnowledgeStarter";
import { useKnowledgeBaseStarter } from "../lib/useKnowledgeBaseStarter";
import { useKnowledgeBaseUploadBatch } from "../lib/knowledge-base-upload-manager";
import { sanitizeKnowledgeBaseOutputMessages } from "../knowledge-conversation-state";
import {
  ChatInput,
  useConversation,
  useRuntimeContext,
  type BrandHomeProps,
} from "../host";
import KnowledgeWorkspaceStatus from "./KnowledgeWorkspaceStatus";
import { GeneralExecutionActivity } from "./GeneralExecutionActivity";
import { generalExecutionSlots } from "../lib/general-execution-display";
import { finalReplyIds } from "../lib/final-reply";
import { conversationExecutionTimings } from "../lib/execution-duration";
import { ExecutionDivider } from "./ExecutionDuration";
import {
  isLocalKnowledgeConfirmation,
  knowledgeExecutionItems,
} from "../lib/knowledge-execution-presentation";
export { default as KnowledgeComposer } from "./KnowledgeComposer";

/** Public knowledge build/conversation UI, shared by main and module domains. */
export default function KnowledgeConversation(props: BrandHomeProps) {
  const context = useConversation();
  const runtime = useRuntimeContext();
  const conversation = context.activeConversation;
  const scope = `${context.workbenchScopeKey ?? runtime.workspaceId}:${runtime.accountId}:${conversation?.id ?? "new"}`;
  const batch = useKnowledgeBaseUploadBatch(
    `${scope}:${props.knowledgeBaseResetRevision ?? 0}`,
    `${scope}:`,
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
  const slots = generalExecutionSlots(
    messages,
    conversation?.execution,
    running,
  );
  const copyable = finalReplyIds(messages, conversation?.execution, running);
  const timings = conversation
    ? conversationExecutionTimings(conversation, messages)
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
  useEffect(() => {
    if (!presentationId) return;
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
      element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation?.id, presentationId]);

  const renderMessage = (message: (typeof messages)[number]) => (
    <article
      key={message.id}
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
      <GeneralExecutionActivity
        items={knowledgeExecutionItems(
          slots.before.get(message.id),
          localTurns,
        )}
        thinkingDisplay="inline"
        hideSuccessfulResults
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
            isLocalKnowledgeConfirmation(message)
              ? undefined
              : timings.get(message.id)
          }
        />
      )}
      <GeneralExecutionActivity
        items={knowledgeExecutionItems(slots.after.get(message.id), localTurns)}
        placement="after"
        thinkingDisplay="inline"
        hideSuccessfulResults
      />
    </article>
  );
  const firstNodeIndex = messages.findIndex(
    (message) => message.knowledgeBase?.kind === "presentation",
  );
  const foldResearch = !running && firstNodeIndex > 0;
  if (!context.hydrated)
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
  return (
    <section
      className="brand-knowledge-conversation"
      aria-label="知识库构建与恢复"
    >
      {context.syncError && <p role="alert">{context.syncError}</p>}
      {!hasStarted && !props.knowledgeBaseProgress ? (
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
          <ChatInput {...props} operatorWorkspace syncKnowledgeBaseSnapshot />
        </>
      )}
    </section>
  );
}
