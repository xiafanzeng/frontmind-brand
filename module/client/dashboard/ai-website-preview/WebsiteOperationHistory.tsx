import { useRef, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@frontmind/module-ui/components/ui/alert-dialog";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import { userFacingErrorMessage } from "../../lib/user-facing-error";
import "./website-revision-tools.css";

const STEP_STATUS: Record<string, string> = {
  queued: "等待中", running: "进行中", succeeded: "已完成", failed: "失败",
  attention_required: "需处理", cancelled: "已取消",
};

function recordTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

type WebsiteRestartActionProps = {
  siteOps: SiteOpsConversationPanelProps;
  onResetAccepted?: () => void;
  triggerLabel?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  confirmLabel?: string;
  testId?: string;
};

/** A shared, explicitly confirmed entry point for starting a fresh SiteOps cycle. */
export function WebsiteRestartAction({
  siteOps,
  onResetAccepted,
  triggerLabel = "重新开始制作",
  dialogTitle = "重新开始制作",
  dialogDescription = "清理当前制作任务并从当前知识库重新开始。已经发布的网站继续运行；域名、备案和阿里云连接会保留。",
  confirmLabel = "确认重新开始",
  testId,
}: WebsiteRestartActionProps) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const observation = siteOps.observation;
  const rebuildRequest = observation?.rebuildRequest;
  const onAction = siteOps.onAction;
  if (!rebuildRequest?.allowed || !onAction) return null;

  const restart = async () => {
    if (busyRef.current || siteOps.interactionPending
      || !rebuildRequest.allowed || rebuildRequest.resetPending) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAction({ action: "request_rebuild", input: {} });
      onResetAccepted?.();
      setRestartOpen(false);
    } catch (failure) {
      setError(userFacingErrorMessage(failure, "重新开始未完成，请重试。"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const disabled = busy || siteOps.interactionPending || rebuildRequest.resetPending;
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={() => { setError(null); setRestartOpen(true); }}
      >
        {triggerLabel}
      </button>
      <AlertDialog open={restartOpen} onOpenChange={(open) => { if (!busyRef.current) setRestartOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="sfp-revision-error">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || !rebuildRequest.allowed}
              onClick={(event) => { event.preventDefault(); void restart(); }}
            >
              {busy ? "正在处理…" : confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A read-only timeline with an explicitly confirmed reset in the More menu. */
export function WebsiteOperationHistory({ siteOps, onResetAccepted }: { siteOps: SiteOpsConversationPanelProps; onResetAccepted?: () => void }) {
  const [limit, setLimit] = useState(20);
  const observation = siteOps.observation;
  if (!observation) return null;

  const entries = [
    ...observation.messages.map((message) => ({
      id: `message:${message.id}`, at: message.sentAt,
      label: message.role === "user" ? "你的操作" : "建站服务",
      content: message.content,
    })),
    ...(observation.executionSteps ?? []).map((step) => ({
      id: `step:${step.id}`, at: step.completedAt ?? step.startedAt,
      label: step.buildId
        ? `版本 ${observation.builds.find((build) => build.id === step.buildId)?.ordinal ?? "记录"}`
        : "执行记录",
      content: `${step.label} · ${STEP_STATUS[step.status] ?? step.status}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="sfp-website-history">
      <div className="sfp-website-history-toolbar">
        <span>建站记录</span>
        {observation.rebuildRequest.allowed && siteOps.onAction && (
          <details className="sfp-website-more">
            <summary><MoreHorizontal size={16} aria-hidden="true" /> 更多</summary>
            <div>
              <WebsiteRestartAction siteOps={siteOps} onResetAccepted={onResetAccepted} />
            </div>
          </details>
        )}
      </div>
      <details className="sfp-website-history-disclosure">
        <summary><span>操作记录</span><span>{entries.length} 条</span><ChevronDown size={15} aria-hidden="true" /></summary>
        {entries.length === 0 ? <p>暂无操作记录。</p> : (
          <ol>
            {entries.slice(0, limit).map((entry) => (
              <li key={entry.id}>
                <div><strong>{entry.label}</strong><time dateTime={entry.at}>{recordTime(entry.at)}</time></div>
                <p>{entry.content}</p>
              </li>
            ))}
          </ol>
        )}
        {entries.length > limit && <button type="button" className="sfp-revision-add" onClick={() => setLimit((current) => current + 20)}>查看更早记录</button>}
      </details>
    </div>
  );
}
