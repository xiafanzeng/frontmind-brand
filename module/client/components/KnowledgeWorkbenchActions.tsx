import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { KnowledgeBaseProgressDto } from "../../contracts/knowledge-base-public-progress";
import { useConversation } from "../conversation";
import { captureWorkspaceRestOperation } from "../lib/workspace-rest-scope";
import { Button } from "@frontmind/module-ui/components/ui/button";

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
  const { commitKnowledgeBaseObservation } = useConversation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const lock = useRef(false);
  if (!progress?.workbench || !progress.build.contentVersion) return null;
  const coordinates = {
    conversationId,
    expectedGeneration: progress.workbench.generation,
    expectedRevision: progress.build.revision,
    expectedStateEpoch: progress.workbench.stateEpoch,
    expectedContentVersion: progress.build.contentVersion,
    expectedResetRevision: resetRevision,
  };
  const initial = progress.workbench.phase === "initial";
  const available =
    progress.contentAvailability === "complete" &&
    !progress.build.awaitingResponseSince;
  const accept = async () => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(coordinates);
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    const rest = captureWorkspaceRestOperation();
    try {
      const response = await rest.fetch(
        "/api/knowledge-base/initial-draft/accept",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...coordinates,
            clientRequestId: attempt.current.id,
          }),
        },
      );
      const result = await response.json();
      rest.assertActive();
      if (result.observation) {
        commitKnowledgeBaseObservation(conversationId, result.observation);
        if (result.observation.progress)
          onProgress(result.observation.progress);
      }
      if (!response.ok)
        throw new Error(
          result.error?.message ?? "开始逐节点核验暂未完成，请重试",
        );
    } catch (error) {
      if (!rest.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "开始逐节点核验暂未完成，请重试",
        );
    } finally {
      lock.current = false;
      if (!rest.signal.aborted) setPending(false);
    }
  };
  if (presentation === "accept" && !initial) return null;
  return (
    <section
      className="knowledge-workbench-stage"
      aria-label={initial ? "知识库初稿确认" : "知识库编辑阶段"}
    >
      <div>
        <span className="knowledge-workbench-stage__eyebrow">
          {initial ? "初稿审阅" : "工作稿"}
        </span>
        <p>
          {initial
            ? "初稿已按知识节点组织。开始后可逐个确认、跳过预填或让 AI 修改，首轮全部完成后自动发布知识库。"
            : "从右侧选择节点，在弹窗中编辑与重新核验。后续修改完成后，更新知识库以启用新版本。"}
        </p>
      </div>
      <div className="knowledge-workbench-stage__actions">
        {initial && (
          <Button onClick={accept} disabled={!available || disabled || pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {pending ? "正在准备…" : "开始逐节点核验"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="knowledge-workbench-stage__error">
          {error}
        </p>
      )}
    </section>
  );
}
