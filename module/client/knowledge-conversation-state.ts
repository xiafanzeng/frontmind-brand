import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import { type EnterpriseQaAnswerMeta } from "@frontmind/module-ui/contracts/enterprise-qa-answer";
import { sanitizeBrandText } from "./lib/frontmind-api";
import { normalizeKnowledgeCollectionCopy } from "../contracts/knowledge-base-copy";
import type { KnowledgeBaseApprovedResourceDto, KnowledgeBaseContentAvailability, KnowledgeBaseContentState, KnowledgeBaseFailureClass, KnowledgeBaseFailureStage, KnowledgeBaseOperationType, KnowledgeBaseOperationState, KnowledgeBasePackageState, KnowledgeBaseProcessingPhase, KnowledgeBasePublicationState, KnowledgeBaseRecoveryAction, KnowledgeBaseSyncState, KnowledgeBaseTaskCreationState } from "../contracts/knowledge-base-public-progress";
import { customerSafeKnowledgeAssetLabel, customerSafeKnowledgeFilename } from "../server/knowledge-base-public-artifacts";
import { knowledgeBasePresentationMessagePublicId, knowledgeBaseUserMessagePublicId } from "../contracts/knowledge-base-message";
import { stripKnowledgeBaseProtocolPayloads, stripKnowledgeBaseReferenceAppendix } from "../contracts/knowledge-base-output";
import { uniquifyOrderedIds } from "./lib/ordered-id";
import type { GeneralChatDispatchMetadata } from "@frontmind/module-contracts/chat-dispatch";
import { type KnowledgeBaseObservationDto } from "./lib/knowledge-progress";

export interface Attachment {
  id: string;
  type: "file" | "image";
  name: string;
  fileId?: string; // from FrontMind Files API
  base64?: string; // for image/small file preview (data URL)
  blobUrl?: string; // in-memory blob URL for large files (not persisted to localStorage)
  file?: File;
  /** Absolute millisecond epoch after which the attachment must be re-uploaded. */
  expiresAt?: number;
  /** Authoritative expiry flag returned by the file service. */
  expired?: boolean;
}

export interface IntermediateStep {
  id: string;
  type: string; // "web_search_call" | "computer_call" | "code_interpreter_call" | "function_call" | "reasoning" | etc.
  label: string; // Human-readable label for display
  description?: string; // Optional description/summary text
  details?: string; // Additional details (e.g., search query, URL, code)
}

export interface StepGroup {
  id: string;
  title: string; // Group title (e.g., "搜集华为最新动态与数据")
  steps: IntermediateStep[];
  description?: string; // Optional description text between steps
}

export interface LocalMessage {
  enterpriseQaAnswer?: EnterpriseQaAnswerMeta;
  id: string;
  /** Server-owned conversation order. Browser timestamps are never authoritative. */
  serverSequence?: number;
  /** Stable provider output identity; the local id may be disambiguated per turn. */
  upstreamOutputId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  timestamp: number;
  outputFiles?: { fileUrl: string; fileName: string; mimeType: string }[];
  /** Inline base64 images embedded in assistant text (for display in MarkdownRenderer) */
  inlineImages?: { src: string; alt?: string }[];
  /** Per-response elapsed time in seconds (set when the response completes) */
  elapsedTime?: number;
  /** Timestamp when this response started being processed */
  responseStartedAt?: number;
  /** Intermediate steps (search, browse, code, reasoning) shown before this message */
  intermediateSteps?: IntermediateStep[];
  /** Grouped intermediate steps for display */
  stepGroups?: StepGroup[];
  /** Whether this is a steps-only placeholder (no text content yet) */
  isStepsPlaceholder?: boolean;
  /** The public model profile used for this message (e.g. "frontmind-lite") */
  modelName?: string;
  /** Server-approved knowledge-base projection metadata. Never inferred from raw output. */
  knowledgeBase?: {
    schemaVersion?: 1;
    kind: "pending_user" | "presentation" | "completion";
    buildId?: string;
    operationKey?: string;
    clientRequestId?: string;
    turnId?: string;
    presentationKey?: string;
    contentSha256?: string;
    generation?: number;
    revision?: number;
    leafId?: string | null;
    serverOwned?: boolean;
  };
  /** Server-authored durable projection of an ordinary Agent event. */
  generalChat?: {
    schemaVersion: 1;
    kind: "assistant_projection";
    isFinalAnswer?: boolean;
    turnId: string;
    agentTaskId: string;
    providerEventId: string;
    userMessageId?: string;
    userSequence?: number;
    rank?: number;
    serverOwned: true;
  };
  /** Browser-owned retry identity until Dashboard returns a task DTO. */
  generalChatDispatch?: GeneralChatDispatchMetadata;
}

export interface KnowledgeBaseClientNotice {
  errorKey: string;
  code?: string;
  message: string;
  severity: "info" | "warning" | "error";
  retryable: boolean;
  failureClass?: KnowledgeBaseFailureClass | null;
  recoveryAction?: KnowledgeBaseRecoveryAction | null;
  recoveryToken?: string;
  canRegenerate?: boolean;
  attachmentCount?: number;
  turnId?: string | null;
}

export interface KnowledgeBaseClientState {
  initialized: boolean;
  generation: number;
  stateEpoch: number;
  contentVersion?: number;
  /** Latest immutable receipt sequence accepted for display in this conversation. */
  displaySequence?: number;
  syncState?: KnowledgeBaseSyncState;
  processingPhase?: KnowledgeBaseProcessingPhase | null;
  runPhase?: KnowledgeBaseObservationDto["runPhase"];
  uploadStatusVersion?: number;
  uploadAttemptId?: string;
  contentState?: KnowledgeBaseContentState;
  packageState?: KnowledgeBasePackageState;
  publicationState?: KnowledgeBasePublicationState;
  contentAvailability?: KnowledgeBaseContentAvailability;
  operationState?: KnowledgeBaseOperationState;
  resetAllowed?: boolean;
  taskCreationState?: KnowledgeBaseTaskCreationState;
  failureStage?: KnowledgeBaseFailureStage | null;
  retainedCustomerAttachmentCount?: number;
  generatedSystemAttachmentCount?: number;
  settledAt?: number | null;
  activeTurnId: string | null;
  activeClientRequestId: string | null;
  /** Same-turn freshness fence; never compares unrelated turn clocks. */
  activeTurnUpdatedAt?: number;
  activeTurnMessageSequence?: number;
  activeTurnResetRevision?: number;
  activeTurnOperationType?: KnowledgeBaseOperationType;
  activeTurnAwaitingClientAttachments?: boolean;
  browserUpload?: import("../contracts/knowledge-base-upload-status").KnowledgeBaseBrowserUpload;
  activeTurnStagedAttachmentCount?: number;
  activeTurnExpectedAttachmentCount?: number;
  /** Provenance of the currently approved presentation; remains after the reservation is released. */
  presentationTurnId: string | null;
  interactionState: KnowledgeBaseObservationDto["interaction"]["interactionState"];
  canReply: boolean;
  presentationKey: string | null;
  revision: number | null;
  leafId: string | null;
  notice: KnowledgeBaseClientNotice | null;
}

export interface Conversation {
  id: string;
  title: string;
  purpose?: "enterprise_qa" | "content_production";
  /** Workbench subagent ownership; absent on legacy general conversations. */
  workbenchAgentId?: string;
  workbench?: import("@frontmind/module-ui/contracts/workbench-task").WorkbenchTaskState;
  messages: LocalMessage[];
  /** Server-derived boundary for provider tasks owned outside ordinary chat. */
  executionKind?: "general_chat_v2" | "response_logic";
  execution?: GeneralExecutionDto;
  taskId?: string; // Upstream task ID
  previousResponseId?: string;
  status:
    | "idle"
    | "running"
    | "pending"
    | "awaiting_input"
    | "completed"
    | "error"
    | "failed";
  taskUrl?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number; // Task start timestamp
  completedAt?: number; // Task completion timestamp
  /**
   * Bug 3 fix: Track the total number of output items from the API after each
   * turn completes. Since the FrontMind API returns the SAME response ID for
   * multi-turn conversations and accumulates output items, this lets us
   * slice only new items on the next turn: output.slice(lastKnownOutputLength).
   */
  lastKnownOutputLength?: number;
  /** IDs of messages that were manually deleted by the user (to prevent re-appearing from polling) */
  deletedMessageIds?: string[];
  /**
   * Fingerprint of the API key that created this conversation.
   * Used to prevent cross-key task continuation.
   * Format: "sk-a...b1c2" (first 4 + last 4 chars of the key).
   */
  apiKeyFingerprint?: string;
  /** Authoritative KB UI state. It is refreshed from the server observation. */
  knowledgeBase?: KnowledgeBaseClientState;
}

export function repairConversationMessageIds(
  messages: readonly LocalMessage[],
): LocalMessage[] {
  const repairedMessages = uniquifyOrderedIds(messages);
  const repairedAttachments = uniquifyOrderedIds(
    repairedMessages.flatMap((message) => message.attachments ?? []),
  );
  let attachmentIndex = 0;

  return repairedMessages.map((message) => {
    if (!message.attachments?.length) return message;
    const nextAttachments = repairedAttachments.slice(
      attachmentIndex,
      attachmentIndex + message.attachments.length,
    );
    attachmentIndex += message.attachments.length;
    if (
      nextAttachments.every(
        (attachment, index) => attachment === message.attachments![index],
      )
    )
      return message;
    return { ...message, attachments: nextAttachments };
  });
}

export function isServerOwnedKnowledgeBaseMessage(message: LocalMessage) {
  return message.knowledgeBase?.serverOwned === true;
}

export function stableKnowledgeBaseMessageId(key: string) {
  return knowledgeBasePresentationMessagePublicId(key);
}

export function observationActiveTurnId(observation: KnowledgeBaseObservationDto) {
  return observation.activeTurn?.id ?? null;
}

export function approvedKnowledgeBasePresentationMatches(
  observation: KnowledgeBaseObservationDto,
) {
  const presentation = observation.approvedPresentation;
  return Boolean(
    presentation &&
      presentation.visibleMarkdown.trim() &&
      presentation.turnId &&
      (presentation.messageSequence === undefined ||
        Number.isSafeInteger(presentation.messageSequence)),
  );
}

export function knowledgeObservationIsStale(
  current: KnowledgeBaseClientState | undefined,
  observation: KnowledgeBaseObservationDto,
) {
  if (!current) return false;
  if (!current.initialized) return false;
  if (observation.generation < current.generation) return true;
  if (observation.generation > current.generation) return false;
  if (observation.stateEpoch < current.stateEpoch) return true;
  if (observation.stateEpoch > current.stateEpoch) return false;
  const observedActiveTurn = observation.activeTurn;
  if (observedActiveTurn?.id === current.activeTurnId && (observedActiveTurn.uploadStatusVersion ?? current.uploadStatusVersion ?? 0) < (current.uploadStatusVersion ?? 0)) return true;
  if (
    observedActiveTurn &&
    current.activeTurnId === observedActiveTurn.id &&
    Number.isFinite(current.activeTurnUpdatedAt) &&
    observedActiveTurn.updatedAt < current.activeTurnUpdatedAt!
  ) {
    return true;
  }
  if (
    observedActiveTurn &&
    current.activeTurnId &&
    current.activeTurnId !== observedActiveTurn.id &&
    Number.isSafeInteger(current.activeTurnMessageSequence) &&
    Number.isSafeInteger(observedActiveTurn.messageSequence) &&
    observedActiveTurn.messageSequence! < current.activeTurnMessageSequence!
  ) {
    return true;
  }
  // A same-coordinate observation is still authoritative. It must be allowed
  // to repair optimistic browser-only state (for example running ->
  // awaiting_input after a 422) even when the durable build itself did not
  // advance stateEpoch. Only a strictly older monotonic coordinate is stale.
  return false;
}

export function acceptedDisplaySequence(messages: readonly LocalMessage[]) {
  return messages.reduce(
    (latest, message) =>
      isServerOwnedKnowledgeBaseMessage(message) &&
      (message.knowledgeBase?.kind === "presentation" ||
        message.knowledgeBase?.kind === "completion") &&
      Number.isSafeInteger(message.serverSequence)
        ? Math.max(latest, message.serverSequence!)
        : latest,
    0,
  );
}

export function persistedDisplaySequence(conversation: Conversation) {
  const stateSequence = conversation.knowledgeBase?.displaySequence;
  return Math.max(
    Number.isSafeInteger(stateSequence) && stateSequence! >= 0
      ? stateSequence!
      : 0,
    acceptedDisplaySequence(conversation.messages),
  );
}

export function observationDisplaySequence(observation: KnowledgeBaseObservationDto) {
  if (observation.displaySequence !== undefined) {
    return observation.displaySequence;
  }
  const presentationSequence =
    observation.approvedPresentation?.messageSequence;
  return Number.isSafeInteger(presentationSequence) &&
    presentationSequence! >= 0
    ? presentationSequence!
    : 0;
}

export function observationRevision(observation: KnowledgeBaseObservationDto) {
  return (
    observation.approvedPresentation?.revision ??
    observation.interaction.progress?.build.revision ??
    observation.progress?.build.revision ??
    -1
  );
}

export function observationAdvancesDurableClientCoordinate(
  current: KnowledgeBaseClientState | undefined,
  messages: readonly LocalMessage[],
  observation: KnowledgeBaseObservationDto,
) {
  const observedRevision = observationRevision(observation);
  if (current?.initialized) {
    if (observation.generation !== current.generation) {
      return observation.generation > current.generation;
    }
    if (observation.stateEpoch !== current.stateEpoch) {
      return observation.stateEpoch > current.stateEpoch;
    }
    const currentRevision = current.revision ?? -1;
    // stateEpoch refinements at the same presentation may update processing
    // metadata, but they cannot authorize lower receipt history to replace
    // the immutable body already rendered by the browser.
    if (observedRevision > currentRevision) return true;
    if (observedRevision <= currentRevision) return false;
  }

  const persisted = messages
    .filter(
      (message) =>
        isServerOwnedKnowledgeBaseMessage(message) &&
        message.knowledgeBase?.kind === "presentation",
    )
    .reduce(
      (latest, message) => {
        const candidate = {
          generation: message.knowledgeBase?.generation ?? -1,
          revision: message.knowledgeBase?.revision ?? -1,
        };
        return candidate.generation > latest.generation ||
          (candidate.generation === latest.generation &&
            candidate.revision > latest.revision)
          ? candidate
          : latest;
      },
      { generation: -1, revision: -1 },
    );
  return (
    observation.generation > persisted.generation ||
    (observation.generation === persisted.generation &&
      observedRevision > persisted.revision)
  );
}

export function observationPrecedesPersistedKnowledgeBaseHistory(
  messages: readonly LocalMessage[],
  observation: KnowledgeBaseObservationDto,
) {
  const persisted = messages
    .filter(
      (message) =>
        isServerOwnedKnowledgeBaseMessage(message) &&
        message.knowledgeBase?.kind === "presentation",
    )
    .reduce(
      (latest, message) => {
        const candidate = {
          generation: message.knowledgeBase?.generation ?? -1,
          revision: message.knowledgeBase?.revision ?? -1,
        };
        return candidate.generation > latest.generation ||
          (candidate.generation === latest.generation &&
            candidate.revision > latest.revision)
          ? candidate
          : latest;
      },
      { generation: -1, revision: -1 },
    );
  if (observation.generation < persisted.generation) return true;
  const observedRevision =
    observation.approvedPresentation?.revision ??
    observation.interaction.progress?.build.revision ??
    -1;
  return (
    observation.generation === persisted.generation &&
    observedRevision < persisted.revision
  );
}

export function knowledgeBasePresentationMessage(
  observation: KnowledgeBaseObservationDto,
): LocalMessage | null {
  const presentation = observation.approvedPresentation;
  if (!presentation || !approvedKnowledgeBasePresentationMatches(observation)) {
    return null;
  }
  // A cached observation from the previous response contract may still carry
  // `filename` and the coordinate-bearing legacy URL for one rollout cycle.
  // New server projections always carry `caption` and an opaque URL; in that
  // shape filename is never consulted or copied into alt text.
  type CompatibleApprovedResource = Omit<
    KnowledgeBaseApprovedResourceDto,
    "kind" | "caption"
  > & {
    kind: KnowledgeBaseApprovedResourceDto["kind"] | "working_set_evidence";
    caption?: string;
    filename?: string;
  };
  const resources = (presentation.resources ??
    []) as CompatibleApprovedResource[];
  const resourceCaption = (resource: CompatibleApprovedResource) => {
    const caption = customerSafeKnowledgeAssetLabel(resource.caption);
    if (caption) return caption;
    return resource.kind === "logo" ? "企业官方主 Logo" : "知识库配图";
  };
  const inlineImages = resources
    .map((resource) => ({
      src: resource.sameOriginUrl,
      alt: resourceCaption(resource),
      mimeType: resource.mimeType,
      kind: resource.kind,
    }))
    .filter(
      (resource) =>
        resource.src.startsWith("/") &&
        (resource.mimeType.startsWith("image/") ||
          /image|logo/i.test(resource.kind)),
    )
    .map(({ src, alt }) => ({ src, alt }));
  const evidenceFiles = resources
    .filter(
      (resource) =>
        resource.kind === "working_set_evidence" &&
        resource.sameOriginUrl.startsWith("/"),
    )
    .map((resource) => ({
      fileUrl: resource.sameOriginUrl,
      fileName: customerSafeKnowledgeFilename(
        resource.filename,
        "知识库参考资料.txt",
      ),
      mimeType: resource.mimeType,
    }));

  return {
    id: stableKnowledgeBaseMessageId(presentation.presentationKey),
    serverSequence: presentation.messageSequence,
    role: "assistant",
    content: sanitizeKnowledgeBaseCustomerMarkdown(
      presentation.visibleMarkdown,
    ),
    timestamp: presentation.acceptedAt ?? Date.now(),
    inlineImages: inlineImages.length > 0 ? inlineImages : undefined,
    outputFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined,
    knowledgeBase: {
      schemaVersion: 1,
      kind: "presentation",
      buildId: (observation.progress ?? observation.interaction.progress)?.build
        .id,
      operationKey: observation.activeTurn?.operationKey,
      turnId: presentation.turnId,
      presentationKey: presentation.presentationKey,
      generation: presentation.generation ?? observation.generation,
      revision: presentation.revision,
      leafId: presentation.leafId,
      serverOwned: true,
    },
  };
}

export function applyKnowledgeBaseObservation(
  conversation: Conversation,
  observation: KnowledgeBaseObservationDto,
): Conversation {
  const currentDisplaySequence = persistedDisplaySequence(conversation);
  const advancesDurableCoordinate = observationAdvancesDurableClientCoordinate(
    conversation.knowledgeBase,
    conversation.messages,
    observation,
  );
  if (
    (!advancesDurableCoordinate &&
      currentDisplaySequence > 0 &&
      observationDisplaySequence(observation) < currentDisplaySequence) ||
    knowledgeObservationIsStale(conversation.knowledgeBase, observation) ||
    observationPrecedesPersistedKnowledgeBaseHistory(
      conversation.messages,
      observation,
    )
  ) {
    return conversation;
  }

  const activeTurnId = observationActiveTurnId(observation);
  const activeClientRequestId = observation.activeTurn?.clientRequestId ?? null;
  const presentationClientRequestId =
    observation.approvedPresentation?.clientRequestId ?? null;
  const completedTurn = observation.completedTurn ?? null;
  const presentation = knowledgeBasePresentationMessage(observation);
  const presentationMatches = Boolean(presentation);
  const interactionState = observation.interaction.interactionState;
  const nextStatus: Conversation["status"] =
    interactionState === "awaiting_input"
      ? presentationMatches && observation.interaction.canReply
        ? "awaiting_input"
        : "running"
      : interactionState === "ready_to_publish" ||
          interactionState === "published"
        ? "completed"
        : interactionState === "failed"
          ? "error"
          : interactionState === "queued"
            ? "pending"
            : "running";

  let messages = conversation.messages;
  let presentationUserIndex = -1;
  if (activeTurnId && activeClientRequestId) {
    messages = messages.map((message) => {
      if (
        message.role !== "user" ||
        message.knowledgeBase?.kind !== "pending_user" ||
        message.knowledgeBase.clientRequestId !== activeClientRequestId
      ) {
        return message;
      }
      return {
        ...message,
        id: knowledgeBaseUserMessagePublicId(activeTurnId),
        serverSequence:
          observation.activeTurn?.messageSequence ?? message.serverSequence,
        knowledgeBase: {
          ...message.knowledgeBase,
          schemaVersion: 1,
          buildId: (observation.progress ?? observation.interaction.progress)
            ?.build.id,
          operationKey: observation.activeTurn?.operationKey,
          turnId: activeTurnId,
          generation: observation.generation,
          revision: observation.activeTurn?.expectedRevision ?? undefined,
          leafId: observation.activeTurn?.expectedLeafId ?? null,
          serverOwned: true,
        },
      };
    });
    if (presentation?.knowledgeBase?.turnId === activeTurnId) {
      presentationUserIndex = messages.findIndex(
        (message) =>
          message.role === "user" &&
          message.knowledgeBase?.clientRequestId === activeClientRequestId &&
          message.knowledgeBase?.turnId === activeTurnId,
      );
    }
  }
  if (completedTurn) {
    messages = messages.map((message) => {
      if (
        message.role !== "user" ||
        message.knowledgeBase?.kind !== "pending_user" ||
        message.knowledgeBase.clientRequestId !== completedTurn.clientRequestId
      ) {
        return message;
      }
      return {
        ...message,
        id: knowledgeBaseUserMessagePublicId(completedTurn.turnId),
        serverSequence: completedTurn.messageSequence,
        knowledgeBase: {
          ...message.knowledgeBase,
          schemaVersion: 1,
          buildId: (observation.progress ?? observation.interaction.progress)
            ?.build.id,
          turnId: completedTurn.turnId,
          generation: observation.generation,
          serverOwned: true,
        },
      };
    });
  }
  if (presentation && !activeClientRequestId && presentationClientRequestId) {
    const pendingIndex = messages.findIndex(
      (message) =>
        message.role === "user" &&
        message.knowledgeBase?.kind === "pending_user" &&
        message.knowledgeBase.clientRequestId === presentationClientRequestId,
    );
    if (pendingIndex >= 0) {
      const pending = messages[pendingIndex]!;
      messages = messages.map((message, index) =>
        index === pendingIndex
          ? {
              ...pending,
              id: knowledgeBaseUserMessagePublicId(
                presentation.knowledgeBase!.turnId!,
              ),
              serverSequence:
                observation.approvedPresentation?.requestMessageSequence ??
                pending.serverSequence,
              knowledgeBase: {
                ...pending.knowledgeBase!,
                schemaVersion: 1,
                buildId: (
                  observation.progress ?? observation.interaction.progress
                )?.build.id,
                turnId: presentation.knowledgeBase!.turnId,
                generation: observation.generation,
                revision: observation.approvedPresentation?.revision,
                leafId: observation.approvedPresentation?.leafId,
                serverOwned: true,
              },
            }
          : message,
      );
      presentationUserIndex = pendingIndex;
    }
  }
  if (presentation) {
    if (presentationUserIndex < 0) {
      presentationUserIndex = messages.findIndex(
        (message) =>
          message.role === "user" &&
          message.knowledgeBase?.serverOwned === true &&
          message.knowledgeBase.turnId === presentation.knowledgeBase?.turnId,
      );
    }
    const existingPresentationIndex = messages.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.knowledgeBase?.presentationKey ===
          presentation.knowledgeBase?.presentationKey,
    );
    if (existingPresentationIndex >= 0) {
      messages = messages.map((message, index) =>
        index === existingPresentationIndex
          ? {
              ...presentation,
              // Re-observing the same immutable presentation must not assign
              // it a fresh Date.now() and move it below a newer optimistic
              // request while the provider outcome is still unknown. A later
              // durable sequence may refine ordering; otherwise retain the
              // first-render position.
              timestamp: message.timestamp,
              serverSequence:
                presentation.serverSequence ?? message.serverSequence,
            }
          : message,
      );
    } else if (presentationUserIndex >= 0) {
      messages = [
        ...messages.slice(0, presentationUserIndex + 1),
        presentation,
        ...messages.slice(presentationUserIndex + 1),
      ];
    } else {
      // A released observation without a matching request identity may be an
      // older presentation observed after a network-unknown POST. Keep every
      // optimistic message unbound; never guess that the last pending message
      // produced it. A presentation not already in local history can still be
      // appended as authoritative server content without claiming any request.
      messages = [...messages, presentation];
    }
  }
  // Observation commits and later cloud hydration must produce the same
  // ordering in the same render. In particular, do not briefly append the
  // approved current node after a newer optimistic request and wait for a
  // subsequent history fetch to repair it.
  messages = mergeServerOwnedKnowledgeBaseMessages([], messages);
  const displaySequence = Math.max(
    currentDisplaySequence,
    acceptedDisplaySequence(messages),
    observationDisplaySequence(observation),
  );

  const protectedMessageIds = new Set(
    messages
      .filter(isServerOwnedKnowledgeBaseMessage)
      .map((message) => message.id),
  );

  const serverAwaitsBrowserAttachments =
    observation.activeTurn?.awaitingClientAttachments ??
    observation.activeTurn?.requiresAttachmentReselection ??
    false;
  const legacyDeferredUploadNoticeCodes = new Set([
    "KNOWLEDGE_BASE_START_INCOMPLETE",
    "KNOWLEDGE_BASE_REVISION_UPLOAD_INCOMPLETE",
    "KNOWLEDGE_BASE_ATTACHMENTS_REQUIRED",
  ]);
  // Old servers synthesized reset-required notices from a normal reserve ->
  // stage window. The current-page File attempt owns that distinction; an
  // active awaiting turn is neutral upload progress, never a server terminal.
  const rawNotice =
    serverAwaitsBrowserAttachments &&
    observation.notice?.code &&
    legacyDeferredUploadNoticeCodes.has(observation.notice.code)
      ? null
      : observation.notice;
  const noticeKey = rawNotice?.key;
  const noticeCode =
    typeof rawNotice?.code === "string" &&
    /^[A-Z0-9_:-]{1,128}$/u.test(rawNotice.code)
      ? rawNotice.code
      : undefined;
  const noticeAttachmentCount = Number(rawNotice?.attachmentCount);
  const noticeRecoveryToken =
    typeof rawNotice?.recoveryToken === "string" &&
    /^[a-f0-9]{64}$/u.test(rawNotice.recoveryToken)
      ? rawNotice.recoveryToken
      : undefined;
  const notice =
    rawNotice?.message && noticeKey
      ? {
          errorKey: noticeKey,
          ...(noticeCode ? { code: noticeCode } : {}),
          message: sanitizeBrandText(rawNotice.message),
          severity: rawNotice.severity ?? ("error" as const),
          retryable: rawNotice.retryable === true,
          failureClass: rawNotice.failureClass ?? null,
          recoveryAction: rawNotice.recoveryAction ?? null,
          ...(noticeRecoveryToken
            ? { recoveryToken: noticeRecoveryToken }
            : {}),
          // Missing means an old server, never implicit permission to create
          // another paid model task.
          canRegenerate: rawNotice.canRegenerate === true,
          ...(Number.isSafeInteger(noticeAttachmentCount) &&
          noticeAttachmentCount >= 0 &&
          noticeAttachmentCount <= 1_000
            ? { attachmentCount: noticeAttachmentCount }
            : {}),
          turnId: rawNotice.turnId,
        }
      : null;

  return {
    ...conversation,
    messages,
    status: nextStatus,
    execution: observation.execution ?? observation.interaction.progress?.execution ?? (observation.generation === conversation.knowledgeBase?.generation ? conversation.execution : undefined),
    taskId:
      observation.authoritativeTaskId === null
        ? undefined
        : (observation.authoritativeTaskId ?? conversation.taskId),
    previousResponseId:
      observation.authoritativeTaskId === null
        ? undefined
        : (observation.authoritativeTaskId ?? conversation.previousResponseId),
    deletedMessageIds: conversation.deletedMessageIds?.filter(
      (messageId) => !protectedMessageIds.has(messageId),
    ),
    completedAt:
      nextStatus === "completed" || nextStatus === "error"
        ? Date.now()
        : undefined,
    knowledgeBase: {
      initialized: true,
      generation: observation.generation,
      stateEpoch: observation.stateEpoch,
      contentVersion:
        observation.interaction.progress?.build.contentVersion ??
        conversation.knowledgeBase?.contentVersion ??
        0,
      displaySequence,
      syncState: observation.syncState,
      processingPhase: observation.processingPhase ?? conversation.knowledgeBase?.processingPhase,
      runPhase: observation.runPhase ?? conversation.knowledgeBase?.runPhase,
      uploadStatusVersion: observation.activeTurn?.uploadStatusVersion ?? conversation.knowledgeBase?.uploadStatusVersion,
      uploadAttemptId: observation.activeTurn?.uploadAttemptId ?? conversation.knowledgeBase?.uploadAttemptId,
      contentState: observation.contentState,
      packageState: observation.packageState,
      publicationState: observation.publicationState,
      contentAvailability:
        observation.contentAvailability ??
        observation.interaction.progress?.contentAvailability,
      operationState:
        observation.operationState ??
        observation.interaction.progress?.operationState,
      resetAllowed:
        observation.resetAllowed ??
        observation.interaction.progress?.resetAllowed,
      taskCreationState:
        observation.taskCreationState ??
        observation.interaction.progress?.taskCreationState,
      failureStage:
        observation.failureStage ??
        observation.interaction.progress?.failureStage,
      retainedCustomerAttachmentCount:
        observation.retainedCustomerAttachmentCount ??
        observation.interaction.progress?.retainedCustomerAttachmentCount,
      generatedSystemAttachmentCount:
        observation.generatedSystemAttachmentCount ??
        observation.interaction.progress?.generatedSystemAttachmentCount,
      settledAt:
        observation.settledAt ?? observation.interaction.progress?.settledAt,
      activeTurnId,
      activeClientRequestId,
      activeTurnUpdatedAt: observation.activeTurn?.updatedAt,
      activeTurnMessageSequence: observation.activeTurn?.messageSequence,
      activeTurnResetRevision: observation.activeTurn?.resetRevision,
      activeTurnOperationType: observation.activeTurn?.operationType,
      browserUpload: observation.activeTurn?.browserUpload,
      activeTurnAwaitingClientAttachments:
        observation.activeTurn?.awaitingClientAttachments ??
        observation.activeTurn?.requiresAttachmentReselection ??
        false,
      activeTurnStagedAttachmentCount:
        observation.activeTurn?.stagedAttachmentCount ?? 0,
      activeTurnExpectedAttachmentCount:
        observation.activeTurn?.expectedAttachmentCount ?? 0,
      presentationTurnId:
        observation.approvedPresentation?.turnId ??
        conversation.knowledgeBase?.presentationTurnId ??
        null,
      interactionState,
      canReply:
        interactionState === "awaiting_input" &&
        presentationMatches &&
        observation.interaction.canReply,
      presentationKey:
        observation.approvedPresentation?.presentationKey ?? null,
      revision:
        observation.approvedPresentation?.revision ??
        observation.interaction.progress?.build.revision ??
        null,
      leafId:
        observation.approvedPresentation?.leafId ??
        observation.interaction.progress?.build.currentLeafId ??
        null,
      notice,
    },
    updatedAt: Date.now(),
  };
}

export interface KnowledgeBaseReplySnapshot {
  generation: number;
  stateEpoch: number;
  contentVersion: number;
  revision: number;
  leafId: string;
  presentationKey: string;
  presentationTurnId: string;
}

export function currentKnowledgeBaseReplySnapshot(
  conversation: Conversation | null | undefined,
): KnowledgeBaseReplySnapshot | null {
  const knowledgeBase = conversation?.knowledgeBase;
  if (
    !conversation ||
    conversation.status !== "awaiting_input" ||
    !knowledgeBase?.canReply ||
    knowledgeBase.revision === null ||
    !knowledgeBase.leafId ||
    !knowledgeBase.presentationKey ||
    !knowledgeBase.presentationTurnId
  ) {
    return null;
  }
  const message = conversation.messages.find(
    (candidate) =>
      candidate.role === "assistant" &&
      candidate.content.trim() &&
      candidate.knowledgeBase?.kind === "presentation" &&
      candidate.knowledgeBase.turnId === knowledgeBase.presentationTurnId &&
      candidate.knowledgeBase.presentationKey ===
        knowledgeBase.presentationKey &&
      candidate.knowledgeBase.generation === knowledgeBase.generation &&
      candidate.knowledgeBase.revision === knowledgeBase.revision &&
      candidate.knowledgeBase.leafId === knowledgeBase.leafId,
  );
  if (!message) return null;
  return {
    generation: knowledgeBase.generation,
    stateEpoch: knowledgeBase.stateEpoch,
    contentVersion: knowledgeBase.contentVersion ?? 0,
    revision: knowledgeBase.revision,
    leafId: knowledgeBase.leafId,
    presentationKey: knowledgeBase.presentationKey,
    presentationTurnId: knowledgeBase.presentationTurnId,
  };
}

export function currentKnowledgeBasePresentationReady(
  conversation: Conversation | null | undefined,
  revision: number | undefined,
  leafId: string | null | undefined,
) {
  const snapshot = currentKnowledgeBaseReplySnapshot(conversation);
  return Boolean(
    snapshot && snapshot.revision === revision && snapshot.leafId === leafId,
  );
}

export function knowledgeBaseMessageIdentity(message: LocalMessage) {
  const metadata = message.knowledgeBase;
  if (!metadata) return `id:${message.id}`;
  if (metadata.presentationKey) {
    return `presentation:${metadata.presentationKey}`;
  }
  if (metadata.kind === "pending_user" && metadata.clientRequestId) {
    return `request:${metadata.clientRequestId}:${metadata.kind}`;
  }
  if (metadata.turnId) return `turn:${metadata.turnId}:${metadata.kind}`;
  if (metadata.clientRequestId) {
    return `request:${metadata.clientRequestId}:${metadata.kind}`;
  }
  return `id:${message.id}`;
}

export function knowledgeBaseMessageVersion(message: LocalMessage) {
  return [
    message.knowledgeBase?.generation ?? -1,
    message.knowledgeBase?.revision ?? -1,
    message.timestamp,
  ] as const;
}

export function knowledgeBaseMessageIsAtLeastAsNew(
  candidate: LocalMessage,
  current: LocalMessage,
) {
  if (
    candidate.serverSequence !== undefined ||
    current.serverSequence !== undefined
  ) {
    if (candidate.serverSequence === undefined) return false;
    if (current.serverSequence === undefined) return true;
  }
  const left = knowledgeBaseMessageVersion(candidate);
  const right = knowledgeBaseMessageVersion(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function retainKnowledgeBaseUserAttachments(
  preferred: LocalMessage,
  fallback: LocalMessage,
) {
  if (
    preferred.role !== "user" ||
    preferred.knowledgeBase?.kind !== "pending_user" ||
    fallback.knowledgeBase?.kind !== "pending_user" ||
    !fallback.attachments?.length
  ) {
    return preferred;
  }
  if (!preferred.attachments?.length) {
    return preferred;
  }

  const usedFallbackIndexes = new Set<number>();
  const attachments = preferred.attachments.map((authoritativeAttachment) => {
    // Browser bytes are capabilities, not display metadata. Reattach them
    // only when the authoritative message names the exact same opaque
    // upstream file ID. ID/name/index similarity is never sufficient.
    if (
      !authoritativeAttachment.fileId ||
      !authoritativeAttachment.fileId.trim()
    ) {
      return authoritativeAttachment;
    }
    const fallbackIndex = fallback.attachments!.findIndex(
      (candidate, candidateIndex) =>
        !usedFallbackIndexes.has(candidateIndex) &&
        candidate.fileId === authoritativeAttachment.fileId,
    );

    if (fallbackIndex < 0) return authoritativeAttachment;
    usedFallbackIndexes.add(fallbackIndex);
    const browserAttachment = fallback.attachments![fallbackIndex]!;
    return {
      ...authoritativeAttachment,
      ...(authoritativeAttachment.file === undefined &&
      browserAttachment.file !== undefined
        ? { file: browserAttachment.file }
        : {}),
      ...(authoritativeAttachment.blobUrl === undefined &&
      browserAttachment.blobUrl !== undefined
        ? { blobUrl: browserAttachment.blobUrl }
        : {}),
      ...(authoritativeAttachment.base64 === undefined &&
      browserAttachment.base64 !== undefined
        ? { base64: browserAttachment.base64 }
        : {}),
    };
  });
  return { ...preferred, attachments };
}

export function compareHydratedMessageOrder(left: LocalMessage, right: LocalMessage) {
  const leftIsServerOwned = isServerOwnedKnowledgeBaseMessage(left);
  const rightIsServerOwned = isServerOwnedKnowledgeBaseMessage(right);
  const leftIsOptimisticKnowledgeBase =
    Boolean(left.knowledgeBase) && !leftIsServerOwned;
  const rightIsOptimisticKnowledgeBase =
    Boolean(right.knowledgeBase) && !rightIsServerOwned;

  if (
    left.serverSequence !== undefined &&
    right.serverSequence !== undefined &&
    left.serverSequence !== right.serverSequence
  ) {
    return left.serverSequence - right.serverSequence;
  }

  // A durable sequence proves the server row predates the unbound browser
  // request. Legacy/equivalent observations may omit that sequence; in that
  // case preserve the already-rendered array order instead of comparing a
  // projection-time Date.now() with the optimistic message timestamp.
  if (leftIsServerOwned && rightIsOptimisticKnowledgeBase) {
    return left.serverSequence !== undefined ? -1 : 0;
  }
  if (rightIsServerOwned && leftIsOptimisticKnowledgeBase) {
    return right.serverSequence !== undefined ? 1 : 0;
  }
  if (leftIsServerOwned && rightIsServerOwned) {
    const leftGeneration = left.knowledgeBase?.generation ?? -1;
    const rightGeneration = right.knowledgeBase?.generation ?? -1;
    if (leftGeneration !== rightGeneration) {
      return leftGeneration - rightGeneration;
    }
    const leftRevision = left.knowledgeBase?.revision ?? -1;
    const rightRevision = right.knowledgeBase?.revision ?? -1;
    if (leftRevision !== rightRevision) return leftRevision - rightRevision;
    if (left.knowledgeBase?.kind !== right.knowledgeBase?.kind) {
      const sameTurn =
        Boolean(left.knowledgeBase?.turnId) &&
        left.knowledgeBase?.turnId === right.knowledgeBase?.turnId;

      // The start request and its first presentation share a revision and a
      // turn, so the request comes first. Once a presentation is visible, the
      // next confirmation also carries that presentation's revision but owns
      // a new turn; in that case the presentation must stay before the request
      // that advances it. Sorting every pending message first temporarily put
      // 1.2 below the confirmation for 1.2, allowing 1.3 to render above 1.2
      // until a later hydration happened to rebuild the history.
      type KnowledgeBaseMessageKind = NonNullable<
        LocalMessage["knowledgeBase"]
      >["kind"];
      const leftKind = left.knowledgeBase?.kind;
      const rightKind = right.knowledgeBase?.kind;
      if (!leftKind || !rightKind) return 0;
      const kindRank = (kind: KnowledgeBaseMessageKind) =>
        kind === "pending_user" ? 0 : kind === "presentation" ? 1 : 2;
      if (sameTurn) {
        return kindRank(leftKind) - kindRank(rightKind);
      }
      // A presentation belongs before the next turn's pending request; the
      // completion receipt is terminal and remains last at its revision.
      const crossTurnRank = (kind: KnowledgeBaseMessageKind) =>
        kind === "presentation" ? 0 : kind === "pending_user" ? 1 : 2;
      return crossTurnRank(leftKind) - crossTurnRank(rightKind);
    }
  }
  return left.timestamp - right.timestamp;
}

export function mergeServerOwnedKnowledgeBaseMessages(
  localMessages: readonly LocalMessage[],
  remoteMessages: readonly LocalMessage[],
) {
  const merged: LocalMessage[] = [];
  const identityToIndex = new Map<string, number>();
  const idToIndex = new Map<string, number>();
  for (const remoteMessage of remoteMessages) {
    const identity = knowledgeBaseMessageIdentity(remoteMessage);
    const existingIndex =
      identityToIndex.get(identity) ?? idToIndex.get(remoteMessage.id);
    if (existingIndex === undefined) {
      identityToIndex.set(identity, merged.length);
      idToIndex.set(remoteMessage.id, merged.length);
      merged.push(remoteMessage);
      continue;
    }
    const existing = merged[existingIndex]!;
    if (
      (isServerOwnedKnowledgeBaseMessage(remoteMessage) &&
        !isServerOwnedKnowledgeBaseMessage(existing)) ||
      (isServerOwnedKnowledgeBaseMessage(remoteMessage) &&
        knowledgeBaseMessageIsAtLeastAsNew(remoteMessage, existing))
    ) {
      merged[existingIndex] = retainKnowledgeBaseUserAttachments(
        remoteMessage,
        existing,
      );
      identityToIndex.set(identity, existingIndex);
      idToIndex.set(remoteMessage.id, existingIndex);
    } else {
      merged[existingIndex] = retainKnowledgeBaseUserAttachments(
        existing,
        remoteMessage,
      );
    }
  }
  for (const localMessage of localMessages) {
    const identity = knowledgeBaseMessageIdentity(localMessage);
    const existingIndex =
      identityToIndex.get(identity) ?? idToIndex.get(localMessage.id);
    if (!isServerOwnedKnowledgeBaseMessage(localMessage)) {
      // An observation/list response can win the race with the browser's
      // optimistic promotion. Copy only the upload chips onto the exact
      // accepted request identity; never append or authorize the local row.
      if (
        existingIndex !== undefined &&
        isServerOwnedKnowledgeBaseMessage(merged[existingIndex]!)
      ) {
        merged[existingIndex] = retainKnowledgeBaseUserAttachments(
          merged[existingIndex]!,
          localMessage,
        );
      }
      continue;
    }
    if (existingIndex === undefined) {
      identityToIndex.set(identity, merged.length);
      idToIndex.set(localMessage.id, merged.length);
      merged.push(localMessage);
      continue;
    }
    const existing = merged[existingIndex]!;
    if (
      !isServerOwnedKnowledgeBaseMessage(existing) ||
      knowledgeBaseMessageIsAtLeastAsNew(localMessage, existing)
    ) {
      merged[existingIndex] = retainKnowledgeBaseUserAttachments(
        localMessage,
        existing,
      );
      identityToIndex.set(identity, existingIndex);
      idToIndex.set(localMessage.id, existingIndex);
    } else {
      merged[existingIndex] = retainKnowledgeBaseUserAttachments(
        existing,
        localMessage,
      );
    }
  }
  return repairConversationMessageIds(
    merged
      .map((message, order) => ({ message, order }))
      .sort(
        (left, right) =>
          compareHydratedMessageOrder(left.message, right.message) ||
          left.order - right.order,
      )
      .map(({ message }) => message),
  );
}

export function mergeKnowledgeBaseHydration(
  local: Conversation | undefined,
  remote: Conversation,
): Conversation {
  if (!local) return remote;
  const protectedRemoteMessages = mergeServerOwnedKnowledgeBaseMessages(
    local.messages,
    remote.messages,
  );
  const protectedRemoteMessageIds = new Set(
    protectedRemoteMessages
      .filter(isServerOwnedKnowledgeBaseMessage)
      .map((message) => message.id),
  );
  const remoteWithProtectedHistory = {
    ...remote,
    execution: remote.execution ?? (remote.knowledgeBase?.generation === local.knowledgeBase?.generation ? local.execution : undefined),
    messages: protectedRemoteMessages,
    deletedMessageIds: remote.deletedMessageIds?.filter(
      (messageId) => !protectedRemoteMessageIds.has(messageId),
    ),
  };
  if (!local.knowledgeBase?.initialized) return remoteWithProtectedHistory;
  const localState = local.knowledgeBase;
  const remoteState = remote.knowledgeBase;
  const localDisplaySequence = persistedDisplaySequence(local);
  const remoteDisplaySequence = persistedDisplaySequence(
    remoteWithProtectedHistory,
  );
  const remoteDisplaySequenceIsOlder =
    localDisplaySequence > 0 && remoteDisplaySequence < localDisplaySequence;
  const localRevision = localState.revision ?? -1;
  const remoteRevision = remoteState?.revision ?? -1;
  const coordinatesMatch = Boolean(
    remoteState?.initialized &&
      remoteState.generation === localState.generation &&
      remoteState.stateEpoch === localState.stateEpoch &&
      remoteRevision === localRevision,
  );
  const remoteIsNewer = Boolean(
    remoteState?.initialized &&
      (remoteState.generation > localState.generation ||
        (remoteState.generation === localState.generation &&
          remoteState.stateEpoch > localState.stateEpoch) ||
        (remoteState.generation === localState.generation &&
          remoteState.stateEpoch === localState.stateEpoch &&
          remoteRevision > localRevision) ||
        (coordinatesMatch &&
          !remoteDisplaySequenceIsOlder &&
          remoteDisplaySequence > localDisplaySequence)),
  );
  if (remoteIsNewer) return remoteWithProtectedHistory;

  // A list request may have started before an observation commit. Preserve the
  // locally accepted server projection until the coordinator supplies a newer
  // epoch; a stale cloud snapshot must not blank or rewind the current node.
  const protectedLocalMessages = mergeServerOwnedKnowledgeBaseMessages(
    remote.messages,
    local.messages,
  );
  const protectedLocalMessageIds = new Set(
    protectedLocalMessages
      .filter(isServerOwnedKnowledgeBaseMessage)
      .map((message) => message.id),
  );
  return {
    ...remote,
    messages: protectedLocalMessages,
    status: local.status,
    taskId: local.taskId,
    previousResponseId: local.previousResponseId,
    taskUrl: undefined,
    startedAt: local.startedAt,
    completedAt: local.completedAt,
    knowledgeBase: localState,
    execution: local.execution ?? remote.execution,
    deletedMessageIds: local.deletedMessageIds?.filter(
      (messageId) => !protectedLocalMessageIds.has(messageId),
    ),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

export function sanitizeKnowledgeBaseOutputMessages(
  messages: LocalMessage[],
): LocalMessage[] {
  return messages
    .map(
      ({
        intermediateSteps: _intermediateSteps,
        stepGroups: _stepGroups,
        isStepsPlaceholder: _isStepsPlaceholder,
        ...message
      }) => ({
        ...message,
        content: sanitizeKnowledgeBaseCustomerMarkdown(message.content),
        inlineImages: message.inlineImages?.filter((image) =>
          isManagedKnowledgeBaseImageSource(image.src),
        ),
      }),
    )
    .filter(
      (message) =>
        Boolean(message.content.trim()) ||
        Boolean(message.outputFiles?.length) ||
        Boolean(message.inlineImages?.length),
    );
}

export const EXTERNAL_IMAGE_ASSET_URL =
  /https?:\/\/[^\s<>"')\]]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s<>"')\]]*)?/gi;

export function isManagedKnowledgeBaseImageSource(src: string): boolean {
  const normalized = String(src || "").trim();
  return (
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ||
    normalized.startsWith("/api/frontmind/") ||
    normalized.startsWith("/api/dashboard/knowledge/assets/") ||
    normalized.startsWith("/api/knowledge-base/")
  );
}

export function sanitizeKnowledgeBaseCustomerMarkdown(text: string): string {
  if (!text) return "";

  return normalizeKnowledgeCollectionCopy(
    stripKnowledgeBaseReferenceAppendix(
      stripKnowledgeBaseProtocolPayloads(text),
    ),
  )
    .replace(
      /!\[([^\]\n]*)]\(\s*<?(https?:\/\/[^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/gi,
      (_match, alt: string) => (alt.trim() ? `配图：${alt.trim()}` : ""),
    )
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, "")
    .replace(
      /\[([^\]\n]+)]\(\s*<?(https?:\/\/[^)\s>]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^)\s>]*)?)>?(?:\s+["'][^"']*["'])?\s*\)/gi,
      "$1",
    )
    .replace(EXTERNAL_IMAGE_ASSET_URL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
