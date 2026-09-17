import { Fragment, useEffect, useRef } from "react";
import {
  sanitizeKnowledgeBaseOutputMessages,
  useConversation,
  type LocalMessage,
} from "../conversation";
import type { KnowledgeBaseProgressDto } from "../../contracts/knowledge-base-public-progress";
import ChatInput from "./ChatInput";
import { finalReplyIds } from "../lib/final-reply";
import BrandConversationMessage from "./BrandConversationMessage";
import { toast } from "sonner";
import KnowledgePublicExecution from "./KnowledgePublicExecution";
import { GeneralExecutionActivity } from "./GeneralExecutionActivity";
import { ExecutionDivider } from "./ExecutionDuration";
import { conversationExecutionTimings } from "../lib/execution-duration";
import { generalExecutionSlots } from "../lib/general-execution-display";

export function knowledgeNodeConversationMessages(
  messages: LocalMessage[],
  leafId: string,
  generation: number,
  buildId: string,
  initialIds: Set<string>,
) {
  const completionIndex = messages.findIndex((message) =>
    message.knowledgeBase?.serverOwned === true &&
    message.knowledgeBase.kind === "completion" &&
    message.knowledgeBase.buildId === buildId &&
    message.knowledgeBase.generation === generation,
  );
  if (completionIndex < 0) return [];
  const completion = messages[completionIndex];
  return sanitizeKnowledgeBaseOutputMessages(
    messages.filter((message, index) => {
      const afterFirstReview = message.serverSequence !== undefined && completion.serverSequence !== undefined
        ? message.serverSequence > completion.serverSequence
        : index > completionIndex;
      return afterFirstReview && (
        (message.knowledgeBase?.leafId === leafId &&
          message.knowledgeBase.buildId === buildId &&
          message.knowledgeBase.generation === generation) ||
        // Keep a request submitted in this node visible before its receipt arrives.
        (!initialIds.has(message.id) && message.role === "user" &&
          message.knowledgeBase?.kind === "pending_user" &&
          typeof message.knowledgeBase.clientRequestId === "string" &&
          message.knowledgeBase.leafId === undefined &&
          message.knowledgeBase.generation === undefined)
      );
    }),
  );
}

/** Reuses the original turn/attachment coordinator with only this node's edits. */
export default function KnowledgeNodeConversation({
  conversationId,
  leafId,
  title,
  progress,
  resetRevision,
  disabled,
  onDirtyChange,
}: {
  conversationId: string;
  leafId: string;
  title: string;
  progress: KnowledgeBaseProgressDto;
  resetRevision: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const {
    activeConversation,
    registerKnowledgeBaseConversation,
    wakeKnowledgeBaseConversation,
  } = useConversation();
  const initialIds = useRef(
    new Set(activeConversation?.messages.map((message) => message.id)),
  );
  const matches = activeConversation?.id === conversationId;
  useEffect(() => {
    if (!matches) return;
    registerKnowledgeBaseConversation(conversationId);
    wakeKnowledgeBaseConversation(conversationId);
  }, [
    conversationId,
    matches,
    registerKnowledgeBaseConversation,
    wakeKnowledgeBaseConversation,
  ]);
  if (!matches) return null;
  const messages = knowledgeNodeConversationMessages(
    activeConversation.messages,
    leafId,
    progress.workbench?.generation ??
      activeConversation.knowledgeBase?.generation ??
      0,
    progress.build.id,
    initialIds.current,
  );
  const knowledge = activeConversation.knowledgeBase;
  const turnId = knowledge?.activeTurnId ?? knowledge?.presentationTurnId;
  const assistant = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        turnId &&
        message.knowledgeBase?.turnId === turnId,
    );
  const running =
    ["creating", "waiting_output", "normalizing"].includes(
      knowledge?.operationState ?? "",
    ) && knowledge?.leafId === leafId;
  const copyableIds = finalReplyIds(messages, activeConversation.execution, running);
  const displayedExecution = activeConversation.execution ?? progress.execution;
  const executionTimings = conversationExecutionTimings({ ...activeConversation, execution: displayedExecution }, messages);
  const executionSlots = generalExecutionSlots(messages, displayedExecution, running);
  const hasTimeline = Boolean(displayedExecution?.timeline.length);
  const execution = (
    <KnowledgePublicExecution
      phase={knowledge?.processingPhase}
      runPhase={knowledge?.runPhase}
      operationState={knowledge?.operationState}
    />
  );
  const notice = knowledge?.leafId === leafId ? knowledge?.notice : null;
  return (
    <section
      className="knowledge-node-conversation"
      aria-label={`修改节点：${title}`}
    >
      <p className="knowledge-node-conversation__intro">
        描述这个节点需要怎样修改，生成结果会保留在当前工作稿中。
      </p>
      {messages.map((message) => (
        <Fragment key={message.id}>
          <GeneralExecutionActivity items={executionSlots.before.get(message.id)} />
          {!hasTimeline && message.id === assistant?.id && execution}
          <BrandConversationMessage message={message} allowCopy={copyableIds.has(message.id)}>
            {copyableIds.has(message.id) && <button type="button" aria-label="复制完整回答" onClick={() => {
              void navigator.clipboard.writeText(message.content).then(() => toast.success("已复制"), () => toast.error("复制失败，请重试"));
            }}>复制回答</button>}
          </BrandConversationMessage>
          {message.role === "user" && <ExecutionDivider timing={executionTimings.get(message.id)} />}
          <GeneralExecutionActivity items={executionSlots.after.get(message.id)} placement="after" />
        </Fragment>
      ))}
      {!hasTimeline && !assistant && running && execution}
      {notice && (
        <p role={notice.severity === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      )}
      <ChatInput
        composerScope={`knowledge-node:${progress.build.id}:${progress.workbench?.generation ?? knowledge?.generation ?? 0}:${leafId}`}
        fixedAgentProfile="frontmind-pro"
        syncKnowledgeBaseSnapshot
        operatorWorkspace
        knowledgeBaseProgress={progress}
        knowledgeBaseResetRevision={resetRevision}
        knowledgeEditingBlocked={
          disabled || progress.build.currentLeafId !== leafId
        }
        onComposerDirtyChange={onDirtyChange}
      />
    </section>
  );
}
