import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import { enterpriseQaProgress } from "../../../contracts/enterprise-qa-progress";
import type { RagChatActivity } from "./rag-chat-activity";

/** Only actual, current-turn public execution evidence becomes chat progress. */
export function ragLiveActivity(input: {
  execution?: GeneralExecutionDto; questionId?: string; questionSequence?: number; turnId?: string; running: boolean;
}): RagChatActivity[] {
  return enterpriseQaProgress(input);
}
