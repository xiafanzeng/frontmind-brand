import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneralChatDispatchMetadata } from "@frontmind/module-contracts/chat-dispatch";
import { brandHost, useConversation } from "./host";
import type { Conversation, LocalMessage } from "./conversation-types";
import type { TaskResponse } from "./lib/frontmind-api";
import { readEnterpriseQaSteering, type EnterpriseQaSteering } from "./enterprise-qa-steering";
import {
  isQaTaskTerminal,
  startEnterpriseQaPolling,
} from "./enterprise-qa-polling";

type QaTask = {
  id: string;
  purpose?: string;
  status: string;
  error?: { message?: string };
  execution?: TaskResponse["execution"];
  knowledgeBase?: TaskResponse["knowledgeBase"];
  steering?: EnterpriseQaSteering;
};

type QaKnowledgeBase = NonNullable<TaskResponse["knowledgeBase"]>;
type SteeringSnapshot = {
  conversationId: string; taskId: string; userId: string; value: EnterpriseQaSteering;
};
type ExecutionSnapshot = {
  conversationId: string; taskId: string; userId: string;
  execution?: TaskResponse["execution"];
};

function ownsQaSnapshot(
  conversation: Conversation | null | undefined,
  snapshot: Pick<ExecutionSnapshot, "conversationId" | "taskId" | "userId">,
) {
  return conversation?.id === snapshot.conversationId &&
    (conversation.previousResponseId ?? conversation.taskId) === snapshot.taskId &&
    conversation.messages.findLast(message => message.role === "user")?.id === snapshot.userId;
}

function latestSteering(previous: SteeringSnapshot | null, next: SteeringSnapshot) {
  return previous && previous.conversationId === next.conversationId && previous.taskId === next.taskId &&
    previous.userId === next.userId && previous.value.turnId === next.value.turnId && previous.value.revision > next.value.revision
    ? previous : next;
}

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
export function useEnterpriseQaController({ preview = false, evaluationIntent, activeConversationId }: { preview?: boolean; evaluationIntent?: "enterprise_rag_once"; activeConversationId?: string | null } = {}) {
  const context = useConversation();
  const contextRef = useRef(context);
  const selectedActive = activeConversationId === undefined ? context.activeConversation : context.state.conversations.find(item => item.id === activeConversationId) ?? null;
  contextRef.current = { ...context, activeConversation: selectedActive };
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [responseKnowledge, setResponseKnowledge] = useState<{
    conversationId: string;
    taskId: string;
    knowledgeBase: QaKnowledgeBase;
  } | null>(null);
  const lock = useRef(false);
  const steerLock = useRef<string | null>(null);
  const steerRequests = useRef(new Map<string, string>());
  const [steeringState, setSteering] = useState<SteeringSnapshot | null>(null);
  const [executionState, setExecution] = useState<ExecutionSnapshot | null>(null);
  const active = selectedActive;
  const activeUserId = active?.messages.findLast(message => message.role === "user")?.id;

  useEffect(() => {
    setNotice("");
  }, [active?.id]);

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

  const rememberExecution = useCallback((task: QaTask, owner: Pick<ExecutionSnapshot, "conversationId" | "taskId" | "userId">, dispatchTaskId?: string | null) => {
    const current = contextRef.current.activeConversation;
    // updateStatus may not have rendered the new task binding yet when its
    // dispatch receipt arrives, so accept only that request's previous binding.
    const dispatchOwner = dispatchTaskId !== undefined && current?.id === owner.conversationId &&
      (current.previousResponseId ?? current.taskId ?? null) === dispatchTaskId &&
      current.messages.findLast(message => message.role === "user")?.id === owner.userId;
    if (task.id !== owner.taskId || (task.purpose && task.purpose !== "enterprise_qa") ||
      (!ownsQaSnapshot(current, owner) && !dispatchOwner)) return;
    const execution = task.execution?.schemaVersion === 1 && task.execution.taskId === owner.taskId &&
      Array.isArray(task.execution.timeline) ? task.execution : undefined;
    setExecution(previous => ({
      ...owner,
      execution: execution ?? (previous && previous.conversationId === owner.conversationId &&
        previous.taskId === owner.taskId && previous.userId === owner.userId ? previous.execution : undefined),
    }));
  }, []);

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
    const userId = activeUserId;
    let currentPoll = true;
    const stopPolling = startEnterpriseQaPolling({
      read: async () => {
        const result = await request<QaTask>(
          `/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}`,
        );
        const current = contextRef.current.activeConversation;
        const value = readEnterpriseQaSteering(result.steering);
        if (currentPoll && userId) rememberExecution(result, { conversationId, taskId, userId });
        if (currentPoll && value && userId && current?.id === conversationId &&
          (current.previousResponseId ?? current.taskId) === taskId &&
          current.messages.findLast(message => message.role === "user")?.id === userId) {
          setSteering(previous => latestSteering(previous, { conversationId, taskId, userId, value }));
        }
        return result;
      },
      refresh: async () => {
        if (currentPoll && contextRef.current.activeConversation?.id === conversationId) {
          await contextRef.current.refreshConversations();
        }
      },
      onError: (error) =>
        setNotice(error instanceof Error ? error.message : String(error)),
    });
    return () => { currentPoll = false; stopPolling(); };
  }, [preview, active?.id, active?.taskId, active?.status, activeUserId, request, rememberExecution]);

  const send = useCallback(
    async (text: string, attachments: File[] = [], newConversation?: Conversation) => {
      const conversation = newConversation ?? contextRef.current.activeConversation;
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
          const dispatch: GeneralChatDispatchMetadata & { evaluationIntent?: "enterprise_rag_once" } = {
            schemaVersion: 1,
            kind: "pending_user",
            ...(evaluationIntent ? { evaluationIntent } : {}),
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
        const dispatch = pending.generalChatDispatch! as GeneralChatDispatchMetadata & { evaluationIntent?: "enterprise_rag_once" };
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
              ...(dispatch.evaluationIntent ? { evaluationIntent: dispatch.evaluationIntent } : {}),
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
        rememberExecution(result, { conversationId: conversation.id, taskId: result.id, userId: pending.id }, dispatch.localTaskId ?? null);
        contextRef.current.settleGeneralChatDispatch(
          conversation.id,
          pending.id,
        );
        const steering = readEnterpriseQaSteering(result.steering);
        if (steering) setSteering(previous => latestSteering(previous, { conversationId: conversation.id, taskId: result.id, userId: pending.id, value: steering }));
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
    [preview, request, evaluationIntent, rememberExecution],
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

  const executionSnapshot = executionState && ownsQaSnapshot(active, executionState) ? executionState : null;
  const execution = executionSnapshot?.execution ?? active?.execution;
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
  const steering = steeringState && steeringState.conversationId === active?.id &&
    steeringState.taskId === activeTaskId && steeringState.userId === activeUserId ? steeringState.value : null;
  const steer = useCallback(async (text: string) => {
    const conversation = contextRef.current.activeConversation;
    const value = text.trim();
    const taskId = conversation?.previousResponseId ?? conversation?.taskId;
    const userId = conversation?.messages.findLast(message => message.role === "user")?.id;
    if (!conversation || !taskId || !userId || !value || preview) return false;
    if (!steering?.supported || steeringState?.conversationId !== conversation.id ||
      steeringState.userId !== userId || !["running", "pending"].includes(conversation.status)) {
      throw new Error("当前回答暂不支持本轮补充，输入内容已保留。");
    }
    const turnId = steering.turnId;
    const owner = JSON.stringify([conversation.id, taskId, turnId, userId]);
    if (steerLock.current === owner) return false;
    const identity = JSON.stringify([conversation.id, taskId, turnId, value]);
    const clientRequestId = steerRequests.current.get(identity) ?? crypto.randomUUID();
    steerRequests.current.set(identity, clientRequestId);
    steerLock.current = owner;
    const stillCurrent = () => {
      const current = contextRef.current.activeConversation;
      return current?.id === conversation.id && (current.previousResponseId ?? current.taskId) === taskId &&
        current.messages.findLast(message => message.role === "user")?.id === userId;
    };
    try {
      const result = readEnterpriseQaSteering(await request<unknown>(
        `/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}/steer`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversation.id, expectedTurnId: turnId, clientRequestId, text: value }),
        },
      ));
      if (!stillCurrent()) return false;
      if (!result || result.turnId !== turnId || !result.supplements.some(part => part.clientRequestId === clientRequestId && part.text === value)) {
        throw new Error("补充尚未确认，内容已保留，请重试。");
      }
      setSteering(previous => latestSteering(previous, { conversationId: conversation.id, taskId, userId, value: result }));
      steerRequests.current.delete(identity);
      // A refresh failure cannot turn an acknowledged supplement into a duplicate submission.
      void contextRef.current.refreshConversations().catch(() => undefined);
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      throw error;
    } finally {
      if (steerLock.current === owner) steerLock.current = null;
    }
  }, [preview, request, steering, steeringState]);
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
    execution,
    steering,
    steer,
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

