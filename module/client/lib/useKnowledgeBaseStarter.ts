import {useCallback} from "react";
import {toast} from "sonner";
import {useConversation,captureWorkspaceRestOperation,notifyUsageChanged} from "../host";
import type {Attachment} from "../conversation-types";
import type {KnowledgeBaseUploadBatch} from "./knowledge-base-upload-manager";
import {assertChatAttachmentSizes} from "./attachment-files";
import {buildKnowledgeBaseStarterAttachmentManifest,projectKnowledgeBaseStarterRequest,shouldRecoverKnowledgeBaseStartFailure,uploadErrorMessage,uploadWasCancelled,type DeepReportStartInput,type KnowledgeBaseStarterLifecycle,type KnowledgeBaseStarterStartOutcome} from "../components/KnowledgeStarter";
export function useKnowledgeBaseStarter(starterBatch:KnowledgeBaseUploadBatch){
 const {flushConversation,activeConversation,addMessage,commitKnowledgeBaseObservation,registerKnowledgeBaseConversation,settleKnowledgeBaseStartFailure,updateStatus,updateTitle,wakeKnowledgeBaseConversation}=useConversation();
  return useCallback(
    async (
      {
        companyName,
        companyWebsite,
        operatorNotes,
        files,
      }: DeepReportStartInput,
      incomingLifecycle: KnowledgeBaseStarterLifecycle,
    ): Promise<KnowledgeBaseStarterStartOutcome> => {
      const operation = captureWorkspaceRestOperation(
        incomingLifecycle.signal,
        undefined,
        { detached: true },
      );
      const lifecycle = { ...incomingLifecycle, signal: operation.signal };
      operation.assertActive();
      if (!activeConversation) {
        throw new Error("当前知识库会话不可用，请刷新后重试");
      }

      const conversationId = activeConversation.id;
      if(!await flushConversation(conversationId))throw new Error("当前知识库会话尚未保存，请重试。");
      const responseStartedAt = lifecycle.startedAt;
      const clientRequestId = lifecycle.clientRequestId;
      const expectedResetRevision = lifecycle.expectedResetRevision;
      let dispatchAttempted = false;
      let preparedMessageAttachments: Attachment[] = [];

      try {
        assertChatAttachmentSizes(files);
        const itemIds = files.map(
          (_file, index) =>
            lifecycle.fileItemIds?.[index] || `${clientRequestId}:${index + 1}`,
        );
        const attachmentManifest =
          await buildKnowledgeBaseStarterAttachmentManifest(
            files,
            itemIds,
            lifecycle.signal,
          );
        const result = await starterBatch.submit({
          kind: "start",
          conversationId,
          clientRequestId,
          expectedResetRevision,
          companyName,
          companyWebsite,
          operatorNotes,
          manifest: attachmentManifest,
          files: files.map((file, index) => ({
            file,
            itemId: itemIds[index]!,
            ordinal: index + 1,
          })),
          onReservation: (reserved) =>
            lifecycle.onReservation?.({
              conversationId,
              turnId: reserved.reservation.turnId,
              clientRequestId,
              expectedResetRevision,
              uploadAttemptId: reserved.reservation.uploadAttemptId,
            }),
          onObservation: (observation) =>
            commitKnowledgeBaseObservation(conversationId, observation),
          onPhase: (phase) => {
            lifecycle.onBatchPhase(
              phase === "dispatching" ? "starting" : "uploading",
            );
            if (phase === "dispatching") dispatchAttempted = true;
          },
          onFile: (itemId, file, event) =>
            lifecycle.onFileUpdate(itemId, file, event),
        });
        const reserved = result;
        const messageAttachments: Attachment[] = files.map((file, index) => ({
          id: `att-${responseStartedAt}-${index + 1}`,
          type: "file",
          name: file.name,
          fileId: result.receipts.get(itemIds[index]!)?.fileId,
          file,
          expiresAt: result.receipts.get(itemIds[index]!)?.expiresAt,
          expired: false,
        }));
        preparedMessageAttachments = messageAttachments;
        const data = { task: result.response, startedAt: responseStartedAt };
        operation.assertActive();
        const observation = result.response.knowledgeObservation;
        // `/start/reserve` already supplied the durable acknowledgement. The
        // dispatch endpoint need not echo the legacy reservationCreated flag
        // or a provider task id; its 2xx only releases the existing turn.
        const acceptedObservation =
          observation ?? reserved.knowledgeObservation;

        projectKnowledgeBaseStarterRequest({
          lifecycle,
          conversationId,
          responseStartedAt,
          messageAttachments,
          registerConversation: registerKnowledgeBaseConversation,
          addConversationMessage: addMessage,
          updateConversationTitle: updateTitle,
        });

        const taskStartedAt = data.startedAt || responseStartedAt;
        if (acceptedObservation) {
          commitKnowledgeBaseObservation(conversationId, acceptedObservation);
        } else {
          // Compatibility while the server fleet rolls forward. Never project
          // data.task.output for KB; the coordinator will obtain the approved
          // DTO. A durable reservation may be acknowledged before a provider
          // task id exists, so the task fields are optional in this window.
          updateStatus(
            conversationId,
            "running",
            data.task?.id
              ? {
                  taskId: data.task.id,
                  previousResponseId: data.task.id,
                  startedAt: taskStartedAt,
                }
              : { startedAt: taskStartedAt },
          );
        }
        wakeKnowledgeBaseConversation(conversationId);

        toast.success("已开始构建企业知识库", {
          description:
            "资料已上传完成，正在启动知识库调研。调研和整理可能需要 30 分钟左右。",
          duration: 3200,
        });

        notifyUsageChanged();
        lifecycle.onBatchPhase("completed");
        return { status: "accepted" };
      } catch (error: any) {
        const errorMessage = uploadErrorMessage(error);
        const resetRevisionChanged =
          error?.code === "KNOWLEDGE_BASE_RESET_REVISION_CHANGED";
        if (uploadWasCancelled(error, lifecycle.signal)) {
          lifecycle.onBatchPhase("failed");
          toast.info("上传已停止", {
            description: "已完成的文件会保留，继续时只上传未完成资料。",
          });
          throw error;
        } else if (errorMessage.includes("不能超过 100 MB")) {
          lifecycle.onBatchPhase("failed");
          toast.error("文件过大", { description: errorMessage });
          throw error;
        } else if (resetRevisionChanged) {
          lifecycle.onBatchPhase("failed");
          toast.info("知识库已完成重置", {
            description:
              "本次旧资料提交已停止，请在新的空白构建中重新选择资料。",
          });
          throw error;
        } else if (
          !shouldRecoverKnowledgeBaseStartFailure(dispatchAttempted, error)
        ) {
          if (dispatchAttempted) {
            settleKnowledgeBaseStartFailure(conversationId, clientRequestId);
          }
          toast.error(dispatchAttempted ? "启动失败" : "上传失败", {
            description: errorMessage,
          });
          lifecycle.onBatchPhase("failed");
          throw error;
        } else {
          projectKnowledgeBaseStarterRequest({
            lifecycle,
            conversationId,
            responseStartedAt,
            messageAttachments: preparedMessageAttachments,
            registerConversation: registerKnowledgeBaseConversation,
            addConversationMessage: addMessage,
            updateConversationTitle: updateTitle,
          });
          updateStatus(conversationId, "running", {
            startedAt: responseStartedAt,
          });
          wakeKnowledgeBaseConversation(conversationId);
          toast.warning("正在恢复启动结果", {
            description:
              "请求结果暂时未知，系统正在核对服务端是否已受理，不会重复创建知识库任务。",
          });
          lifecycle.onBatchPhase("recovering");
          return { status: "recovering" };
        }
      }
    },
    [
      activeConversation,
      addMessage,
      commitKnowledgeBaseObservation,
      registerKnowledgeBaseConversation,
      settleKnowledgeBaseStartFailure,
      updateStatus,
      updateTitle,
      wakeKnowledgeBaseConversation,
    ],
  );

}
