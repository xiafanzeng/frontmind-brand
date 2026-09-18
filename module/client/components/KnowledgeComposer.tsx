import BusinessChatInput from "@frontmind/module-ui/components/BusinessChatInput";
import type { BusinessComposerRuntime } from "@frontmind/module-ui/components/business-composer-runtime";
import type { Conversation } from "../conversation-types";
import type { KnowledgeBaseObservationDto } from "../lib/knowledge-progress";
import { KNOWLEDGE_BASE_LOGO_PROVENANCE_REQUIRED_NOTICE_CODE } from "../lib/knowledge-progress";
import { currentKnowledgeBaseReplySnapshot } from "../knowledge-conversation-state";
import { useConversation, useWorkspaceDraftGuard, captureWorkspaceRestOperation, type BrandChatInputProps } from "../host";
import { useKnowledgeComposerSender } from "../lib/useKnowledgeComposerSender";
import { formatKnowledgeBaseUploadBytes } from "../lib/knowledge-base-upload-manager";
import { chatAttachmentSizeError } from "../lib/attachment-files";
import KnowledgeBaseManagedUploadRecovery from "./KnowledgeBaseManagedUploadRecovery";

const runtime: BusinessComposerRuntime<unknown, unknown, Conversation, KnowledgeBaseObservationDto> = {
  useConversation, currentKnowledgeBaseReplySnapshot, useSendMessage: useKnowledgeComposerSender,
  useChatSubmission: () => null, useWorkspaceDraftGuard, captureWorkspaceRestOperation,
  consumePendingFrontMindBuildDraft: () => "", GeneralAgentRuntimeBadge: () => null,
  KnowledgeBaseManagedUploadRecovery, generalSuggestions: [],
  formatKnowledgeBaseUploadBytes, chatAttachmentSizeError,
  knowledgeLogoNoticeCode: KNOWLEDGE_BASE_LOGO_PROVENANCE_REQUIRED_NOTICE_CODE,
};
/** Same input component as Dashboard, with only the knowledge dispatch adapter supplied here. */
export default function KnowledgeComposer(props: BrandChatInputProps) {
  return <BusinessChatInput {...props} operatorWorkspace syncKnowledgeBaseSnapshot runtime={runtime} />;
}
