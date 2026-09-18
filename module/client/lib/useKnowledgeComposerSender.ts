import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ComposerAttachmentAttempt, ComposerSender, ComposerSendOptions, ComposerUploadProgress } from "@frontmind/module-ui/components/business-composer-runtime";
import { captureWorkspaceRestOperation, useConversation, useRuntimeContext } from "../host";
import { currentKnowledgeBaseReplySnapshot } from "../knowledge-conversation-state";
import { buildKnowledgeBaseStarterAttachmentManifest } from "../components/KnowledgeStarter";
import { cancelKnowledgeBaseTurnAttachments, createKnowledgeBaseTurnTask, type Message, type KnowledgeBaseAttachmentManifestItem } from "./frontmind-api";
import { useKnowledgeBaseUploadBatch, useKnowledgeBaseUploadField } from "./knowledge-base-upload-manager";
import type { KnowledgeBaseObservationDto } from "./knowledge-progress";

type Command = {
  key: string; id: string; conversationId: string; text: string; files: File[];
  options: ComposerSendOptions; snapshot: NonNullable<ReturnType<typeof currentKnowledgeBaseReplySnapshot>>;
  manifest?: KnowledgeBaseAttachmentManifestItem[]; turnId?: string;
};

/** Knowledge-only dispatch for the public host. The original input UI owns drafts/IME/coordinates. */
export function useKnowledgeComposerSender(resetRevision = 0): ComposerSender {
  const context = useConversation();
  const runtime = useRuntimeContext();
  const conversation = context.activeConversation;
  const [discardRevision, setDiscardRevision] = useState(0);
  const prefix = `composer:${context.workbenchScopeKey ?? runtime.workspaceId}:${runtime.accountId}:${conversation?.id ?? "new"}:`;
  const batch = useKnowledgeBaseUploadBatch(`${prefix}${resetRevision}:${discardRevision}`, prefix);
  const frozen = batch.ref<Command | null>("command", null);
  const busy = batch.ref("busy", false);
  const [uploadProgress, setProgress] = useKnowledgeBaseUploadField<ComposerUploadProgress | null>(batch, "uploadProgress", null);
  const [attempt, setAttempt] = useKnowledgeBaseUploadField<ComposerAttachmentAttempt | null>(batch, "attachmentAttempt", null);

  const execute = useCallback(async (command: Command) => {
    if (busy.current) return false;
    busy.current = true;
    const managed = command.files.length ? batch.beginAttempt() : null;
    const operation = managed?.operation ?? captureWorkspaceRestOperation();
    const observe = (observation: KnowledgeBaseObservationDto) => context.commitKnowledgeBaseObservation(command.conversationId, observation);
    const coordinates = {
      conversationId: command.conversationId, clientRequestId: command.id,
      expectedResetRevision: command.options.knowledgeBaseExpectedResetRevision ?? resetRevision,
      expectedGeneration: command.snapshot.generation, expectedRevision: command.snapshot.revision,
      expectedStateEpoch: command.snapshot.stateEpoch, expectedContentVersion: command.snapshot.contentVersion,
      expectedLeafId: command.snapshot.leafId, expectedPresentationKey: command.snapshot.presentationKey,
    };
    try {
      if (!await context.flushConversation(command.conversationId)) throw new Error("云端任务尚未保存，请重试后再提交。");
      operation.assertActive();
      const input: Message[] = [{role: "user", content: [{type: "input_text", text: command.text.trim() || "请读取补充资料并更新当前节点。"}]}];
      context.registerKnowledgeBaseConversation(command.conversationId);
      if (!conversation?.messages.some(message => message.knowledgeBase?.clientRequestId === command.id)) {
        context.addMessage(command.conversationId, {id: `knowledge-pending:${command.id}`, role: "user", content: command.text.trim(), timestamp: Date.now(), responseStartedAt: Date.now(), knowledgeBase: {kind: "pending_user", clientRequestId: command.id}, attachments: command.files.map((file,index) => ({id: `${command.id}:${index}`, name: file.name, type: "file", file}))});
      }
      let response;
      if (command.files.length) {
        setAttempt({conversationId: command.conversationId, clientRequestId: command.id, turnId: command.turnId, generation: command.snapshot.generation, resetRevision: coordinates.expectedResetRevision, phase: "hashing"});
        command.manifest ??= await buildKnowledgeBaseStarterAttachmentManifest(command.files, command.files.map((_file,index) => `${command.id}:${index+1}`), operation.signal);
        const result = await batch.submit({
          kind: "revise", ...coordinates, turnId: command.turnId, input, manifest: command.manifest,
          files: command.files.map((file,index) => ({file, itemId: `${command.id}:${index+1}`, ordinal: index+1})),
          onObservation: observe,
          onReservation: ({reservation}) => {command.turnId = reservation.turnId;setAttempt(value => value ? {...value, turnId: reservation.turnId} : value);},
          onPhase: phase => setAttempt(value => value ? {...value, phase: phase === "reserved" ? "reserving" : phase} : value),
          onFile: (itemId,file,event) => {
            const progress = batch.progress();
            const percent = Math.round((event.loadedBytes ?? 0) / Math.max(1,file.size) * 100);
            setProgress({conversationId: command.conversationId, currentFileIndex: command.manifest!.findIndex(item => item.itemId === itemId), totalFiles: command.files.length, currentFileName: file.name, currentFilePercent: percent, overallPercent: progress.percent, totalBytes: progress.totalBytes, uploadedBytes: progress.uploadedBytes, confirmedFiles: progress.confirmedFiles, phase: percent === 100 && event.stage !== "uploaded" ? "verifying" : "uploading"});
          },
        });
        response = result.response;
      } else {
        response = await createKnowledgeBaseTurnTask(input, {...coordinates, submissionKind: command.options.submissionKind}, operation.signal);
      }
      if (response.adoptedClientRequestId && response.adoptedClientRequestId !== command.id) context.rollbackPendingKnowledgeBaseTurn(command.conversationId, command.id);
      if (response.knowledgeObservation) observe(response.knowledgeObservation);
      context.wakeKnowledgeBaseConversation(command.conversationId);
      frozen.current = null;
      setAttempt(null);
      return true;
    } catch (cause) {
      const observation = (cause as {knowledgeObservation?: KnowledgeBaseObservationDto})?.knowledgeObservation;
      if (observation) observe(observation);
      const message = cause instanceof Error ? cause.message : "提交未完成，请重新核对状态。";
      if (command.files.length) setAttempt(value => value ? {...value, phase: "failed_retryable", lastError: message} : value);
      if (!operation.signal.aborted) toast.error("本轮提交未完成", {description: message});
      context.wakeKnowledgeBaseConversation(command.conversationId);
      return false;
    } finally {
      if (managed) batch.finishAttempt(managed.controller);
      setProgress(null);
      busy.current = false;
    }
  }, [batch,busy,context,conversation,frozen,resetRevision,setAttempt,setProgress]);

  const sendMessage = useCallback(async (text: string, files: File[], options: ComposerSendOptions = {}) => {
    const snapshot = currentKnowledgeBaseReplySnapshot(conversation);
    if (!conversation || !snapshot || busy.current) return false;
    const key = JSON.stringify([conversation.id,resetRevision,snapshot,text,files.map(file => [file.name,file.size,file.lastModified])]);
    if (frozen.current && frozen.current.key !== key) {
      toast.error("上一轮提交结果尚未确认", {description: "请先核对知识库状态，再提交新的修改。"});
      context.wakeKnowledgeBaseConversation(conversation.id);
      return false;
    }
    const command = frozen.current ?? {key,id: crypto.randomUUID(),conversationId: conversation.id,text,files: [...files],options: {...options},snapshot};
    frozen.current = command;
    return execute(command);
  }, [busy,context,conversation,execute,frozen,resetRevision]);

  return {
    sendMessage, uploadProgress, knowledgeBaseAttachmentAttempt: attempt,
    stopKnowledgeBaseAttachmentAttempt: () => batch.stop(),
    async continueKnowledgeBaseAttachmentAttempt() {
      const command = frozen.current;
      if (!command || busy.current) return false;
      try {
        if (command.turnId) await batch.resume();
        return execute(command);
      } catch (cause) {toast.error(cause instanceof Error ? cause.message : "继续上传未完成，请重试");return false;}
    },
    discardKnowledgeBaseAttachmentAttempt() {
      const command = frozen.current;
      if (!command || busy.current) return;
      void (async () => {
        try {
          if (command.turnId) {
            const cancelled = await cancelKnowledgeBaseTurnAttachments({conversationId: command.conversationId, turnId: command.turnId, clientRequestId: command.id, expectedResetRevision: command.options.knowledgeBaseExpectedResetRevision ?? resetRevision});
            if (cancelled.knowledgeObservation) context.commitKnowledgeBaseObservation(command.conversationId, cancelled.knowledgeObservation);
          }
          frozen.current = null; setAttempt(null);
          setDiscardRevision(value => value + 1);
          context.rollbackPendingKnowledgeBaseTurn(command.conversationId, command.id);
          context.wakeKnowledgeBaseConversation(command.conversationId);
        } catch (cause) {toast.error(cause instanceof Error ? cause.message : "放弃上传未完成，请重试");}
      })();
    },
  };
}
