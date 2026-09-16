import KnowledgeBillingResume from "./KnowledgeBillingResume";
import type { KnowledgeBaseProgressDto } from "../../contracts/knowledge-base-public-progress";
import { KNOWLEDGE_BASE_RESET_REQUEST_EVENT } from "../lib/knowledge-progress";
import { Button } from "@frontmind/module-ui/components/ui/button";
import {
  KNOWLEDGE_DRAFT_READY_COPY,
  KNOWLEDGE_UPDATE_ATTENTION_COPY,
} from "../../contracts/knowledge-base-copy";

export default function KnowledgeWorkspaceStatus({ progress }: { progress: KnowledgeBaseProgressDto | null }) {
  if (!progress) return null;
  const partial = progress.contentAvailability === "partial" || progress.resultQuality?.completeness === "partial";
  const reset = progress.operationState === "reset_required" || partial || progress.build.status === "protocol_error";
  const running = ["creating", "waiting_output", "normalizing"].includes(progress.operationState ?? "") || progress.build.awaitingResponseSince != null;
  const current = progress.branches.flatMap((branch) => branch.leaves).find((leaf) => leaf.id === progress.build.currentLeafId);
  const firstPublication = progress.build.hasPublishedSnapshot === false;
  const message = reset
    ? partial ? "内容不完整，已保留的节点可预览。请确认重置后重新上传资料。" : "当前构建无法继续，请确认重置后重新上传资料并创建全新任务。"
    : progress.billingPause ? null
    : progress.packageState === "attention_required" ? firstPublication ? "首次发布未完成，工作稿已保存。请点击“重试首次发布”继续。" : KNOWLEDGE_UPDATE_ATTENTION_COPY
    : firstPublication && progress.build.status === "ready_to_publish" ? "首轮知识库已完成，正在自动发布。发布成功后可供后续任务使用。"
    : progress.packageState === "preparing" || progress.packageState === "retrying" || progress.build.status === "published" ? null
    : (progress.updateAllowed ?? progress.packageAllowed) || progress.build.status === "ready_to_publish" ? KNOWLEDGE_DRAFT_READY_COPY
    // Routine execution belongs in the conversation's public execution
    // timeline. Keeping it out of this strip avoids a redundant status row.
    : running ? null
    : progress.build.status === "failed" ? "本轮已停止。可以重新读取状态，或确认重置后开始全新任务。"
    : current ? `请处理当前节点：${current.title}` : null;
  if (!message && !progress.billingPause) return null;
  return <div className="knowledge-workspace-status" aria-live="polite">
    {progress.billingPause && <KnowledgeBillingResume key={progress.billingPause.turnId} buildId={progress.build.id} turnId={progress.billingPause.turnId} reason={progress.billingPause.reason} />}
    {message && <p role={reset || progress.build.status === "failed" ? "status" : undefined}>{message}</p>}
    {reset && <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(KNOWLEDGE_BASE_RESET_REQUEST_EVENT))}>重置后重新上传</Button>}
  </div>;
}
