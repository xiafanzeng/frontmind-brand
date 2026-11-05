import KnowledgeOriginalDownloads from "./KnowledgeOriginalDownloads";
import type { KnowledgeBaseProgressDto } from "../../contracts/knowledge-base-public-progress";

export default function KnowledgeWorkbenchActions({
  progress,
  conversationId,
  resetRevision,
  disabled,
  onProgress,
  presentation = "full",
}: {
  progress: KnowledgeBaseProgressDto | null;
  conversationId: string;
  resetRevision: number;
  disabled?: boolean;
  onProgress: (progress: KnowledgeBaseProgressDto) => void;
  presentation?: "full" | "accept";
}) {
  if (!progress?.workbench || !progress.build.contentVersion || presentation === "accept") return null;
  return (
    <section className="knowledge-workbench-stage" aria-label="知识库工作稿">
      <div>
        <span className="knowledge-workbench-stage__eyebrow">工作稿</span>
        <p>可查看全部节点正文，并按当前节点逐个确认或修改。</p>
      </div>
      <div className="knowledge-workbench-stage__actions">
        <KnowledgeOriginalDownloads buildId={progress.build.id} generation={progress.workbench.generation} />
      </div>
    </section>
  );
}
