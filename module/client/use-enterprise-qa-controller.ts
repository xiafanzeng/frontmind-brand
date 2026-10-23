import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneralChatDispatchMetadata } from "@frontmind/module-contracts/chat-dispatch";
import { brandHost, useConversation } from "./host";
import type { Conversation, LocalMessage } from "./conversation-types";
import type { TaskResponse } from "./lib/frontmind-api";
import {
  isQaTaskTerminal,
  startEnterpriseQaPolling,
} from "./enterprise-qa-polling";

type QaTask = {
  id: string;
  purpose?: string;
  status: string;
  error?: { message?: string };
  knowledgeBase?: TaskResponse["knowledgeBase"];
};

type QaKnowledgeBase = NonNullable<TaskResponse["knowledgeBase"]>;

function validKnowledgeBase(value: unknown): value is QaKnowledgeBase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<QaKnowledgeBase>;
  return (
    typeof candidate.snapshotId === "string" &&
    Boolean(candidate.snapshotId.trim()) &&
    Number.isInteger(candidate.version) &&
    Number(candidate.version) > 0 &&
    typeof candidate.sourceFileName === "string" &&
    Number.isInteger(candidate.documentCount) &&
    Number(candidate.documentCount) > 0
  );
}

function conversationStatus(value: string): Conversation["status"] {
  if (value === "cancelled") return "completed";
  return [
    "running",
    "pending",
    "awaiting_input",
    "completed",
    "error",
    "failed",
  ].includes(value)
    ? (value as Conversation["status"])
    : "idle";
}

/** Shared enterprise-QA transport used by both the classic chat and the
 * designed RAG workbench. It keeps the durable conversation/task protocol in
 * one place so a visual shell cannot accidentally create a second QA path. */
export function useEnterpriseQaController({ preview = false } = {}) {
  const context = useConversation();
  const contextRef = useRef(context);
  contextRef.current = context;
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [responseKnowledge, setResponseKnowledge] = useState<{
    conversationId: string;
    taskId: string;
    knowledgeBase: QaKnowledgeBase;
  } | null>(null);
  const lock = useRef(false);
  const active = context.activeConversation;

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const rest = brandHost().captureWorkspaceRestOperation();
      const response = await rest.fetch(path, {
        credentials: "same-origin",
        ...init,
      });
      const value = await response.json();
      rest.assertActive();
      if (!response.ok) {
        throw new Error(
          value.error?.message ??
            value.message ??
            value.error ??
            `请求失败 (${response.status})`,
        );
      }
      return value;
    },
    [],
  );

  useEffect(() => {
    if (
      preview ||
      !active?.taskId ||
      active.purpose !== "enterprise_qa" ||
      isQaTaskTerminal(active.status)
    ) {
      return;
    }
    const taskId = active.taskId;
    const conversationId = active.id;
    return startEnterpriseQaPolling({
      read: () =>
        request<QaTask>(
          `/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}`,
        ),
      refresh: async () => {
        if (contextRef.current.activeConversation?.id === conversationId) {
          await contextRef.current.refreshConversations();
        }
      },
      onError: (error) =>
        setNotice(error instanceof Error ? error.message : String(error)),
    });
  }, [preview, active?.id, active?.taskId, active?.status, request]);

  const send = useCallback(
    async (text: string, attachments: File[] = []) => {
      const conversation = contextRef.current.activeConversation;
      if (lock.current || !conversation || !text.trim()) return false;
      if (preview) {
        setNotice(
          "本地预览不调用企业问答供应商；请在开发子域名验证真实回答与引用。",
        );
        return false;
      }
      if (conversation.purpose !== "enterprise_qa") {
        setNotice("请先选择企业问答任务");
        return false;
      }
      lock.current = true;
      setSending(true);
      setNotice("");
      try {
        let pending = conversation.messages.findLast(
          (message) => message.role === "user" && message.generalChatDispatch,
        );
        if (pending && pending.content !== text) {
          throw new Error("上一条消息尚未确认，请先重试该消息。");
        }
        if (!pending) {
          if (
            attachments.length > 32 ||
            attachments.some((file) => file.size > 64 * 1024 * 1024)
          ) {
            throw new Error("附件最多32份，每份不超过64MB。");
          }
          const uploaded: Array<{
            localAssetId: string;
            filename: string;
            expiresAt: number;
          }> = [];
          for (const file of attachments) {
            uploaded.push(
              await request<{
                localAssetId: string;
                filename: string;
                expiresAt: number;
              }>("/api/frontmind/v2/assets", {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-FrontMind-Mime": file.type || "application/octet-stream",
                  "X-FrontMind-Filename": encodeURIComponent(file.name),
                  "X-FrontMind-Size": String(file.size),
                },
                body: file,
              }),
            );
          }
          const clientRequestId = crypto.randomUUID();
          const dispatch: GeneralChatDispatchMetadata = {
            schemaVersion: 1,
            kind: "pending_user",
            clientRequestId,
            providerPrompt: text.trim(),
            localAssetIds: [
              ...new Set(uploaded.map((file) => file.localAssetId)),
            ].sort(),
            localTaskId: conversation.taskId ?? null,
            modelProfile: conversation.taskId ? null : "frontmind-base",
            ...(!conversation.taskId ? { purpose: "enterprise_qa" } : {}),
          };
          pending = {
            id: clientRequestId,
            role: "user",
            content: text.trim(),
            timestamp: Date.now(),
            attachments: uploaded.map((file) => ({
              id: file.localAssetId,
              type: "file" as const,
              name: file.filename,
              fileId: file.localAssetId,
              expiresAt: file.expiresAt,
            })),
            generalChatDispatch: dispatch,
          } satisfies LocalMessage;
          contextRef.current.addMessage(conversation.id, pending);
        }
        if (!(await contextRef.current.flushConversation(conversation.id))) {
          throw new Error("输入尚未保存，已保留本次消息，请重试。");
        }
        const dispatch = pending.generalChatDispatch!;
        const result = await request<QaTask>(
          `/api/frontmind/v2/tasks${
            dispatch.localTaskId
              ? `/${encodeURIComponent(dispatch.localTaskId)}/messages`
              : ""
          }`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: conversation.id,
              clientRequestId: dispatch.clientRequestId,
              prompt: dispatch.providerPrompt,
              localAssetIds: dispatch.localAssetIds,
              ...(!dispatch.localTaskId
                ? {
                    modelProfile: dispatch.modelProfile,
                    purpose: "enterprise_qa",
                  }
                : {}),
            }),
          },
        );
        if (result.purpose && result.purpose !== "enterprise_qa") {
          throw new Error("返回任务不属于企业问答");
        }
        if (validKnowledgeBase(result.knowledgeBase)) {
          setResponseKnowledge({
            conversationId: conversation.id,
            taskId: result.id,
            knowledgeBase: result.knowledgeBase,
          });
        }
        contextRef.current.updateStatus(
          conversation.id,
          conversationStatus(result.status),
          {
            taskId: result.id,
            previousResponseId: result.id,
            executionKind: "general_chat_v2",
          },
        );
        contextRef.current.settleGeneralChatDispatch(
          conversation.id,
          pending.id,
        );
        if (!(await contextRef.current.flushConversation(conversation.id))) {
          throw new Error("回答已开始，任务绑定尚未保存；请刷新恢复原任务。");
        }
        await contextRef.current.refreshConversations();
        return true;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        lock.current = false;
        setSending(false);
      }
    },
    [preview, request],
  );

  const stop = useCallback(async () => {
    const conversation = contextRef.current.activeConversation;
    if (!conversation?.taskId) return false;
    try {
      await request(
        `/api/frontmind/v2/tasks/${encodeURIComponent(conversation.taskId)}/stop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      await contextRef.current.refreshConversations();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [request]);

  const running = ["running", "pending"].includes(active?.status ?? "");
  const pendingMessage = active?.messages.findLast(
    (message) => message.role === "user" && Boolean(message.generalChatDispatch),
  );
  const retryPending = useCallback(async () => {
    const pending = contextRef.current.activeConversation?.messages.findLast(
      (message) => message.role === "user" && Boolean(message.generalChatDispatch),
    );
    return pending ? send(pending.content, []) : false;
  }, [send]);
  const activeTaskId = active?.previousResponseId ?? active?.taskId;
  const responseKnowledgeBase =
    responseKnowledge &&
    responseKnowledge.conversationId === active?.id &&
    responseKnowledge.taskId === activeTaskId
      ? responseKnowledge.knowledgeBase
      : null;
  return {
    context,
    active,
    sending,
    running,
    busy: sending || running,
    notice,
    pendingDispatch: pendingMessage?.generalChatDispatch
      ? { messageId: pendingMessage.id, question: pendingMessage.content }
      : null,
    retryPending,
    responseKnowledgeBase,
    send,
    stop,
  };
}

