import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneralChatDispatchMetadata } from "@frontmind/module-contracts/chat-dispatch";
import type { EnterpriseQaQueuedFollowupReceipt as QueuedReply, EnterpriseQaFollowupItem as EnterpriseQaFollowup, EnterpriseQaFollowupSnapshot as FollowupSnapshot } from "@frontmind/module-contracts/enterprise-qa-experience";
import { brandHost, useConversation } from "./host";
import type { Conversation, LocalMessage } from "./conversation-types";
import type { TaskResponse } from "./lib/frontmind-api";
import {
  enterpriseQaLocalReplyWithKnowledgeSchema,
  type EnterpriseQaLocalReplyWithKnowledge as LocalReply,
} from "./lib/enterprise-qa-local-reply";
import { readEnterpriseQaSteering, type EnterpriseQaSteering } from "./enterprise-qa-steering";
import {
  isQaTaskTerminal,
  startEnterpriseQaPolling,
} from "./enterprise-qa-polling";
import { latestBrowserOwnedUnresolvedGeneralChatDispatch } from "./lib/general-chat-dispatch-state";

type QaTask = {
  object?: "frontmind.local_task";
  id: string;
  purpose?: string;
  status: string;
  error?: { message?: string };
  knowledgeBase?: TaskResponse["knowledgeBase"];
  steering?: EnterpriseQaSteering;
  canStop?: boolean;
  stopCapabilityReason?: string | null;
};

type TaskStopCapability = { taskId: string; canStop: boolean; reason: string | null };

type QaKnowledgeBase = NonNullable<TaskResponse["knowledgeBase"]>;
type SteeringSnapshot = {
  conversationId: string; taskId: string; userId: string; value: EnterpriseQaSteering;
};

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
  const [, redraw] = useState(0);
  const sendingOwners = useRef(new Set<string>());
  const notices = useRef(new Map<string, string>());
  const pollNotices = useRef(new Map<string, string>());
  const queueVersions = useRef(new Map<string, number>());
  const responseKnowledges = useRef(new Map<string, {taskId: string; knowledgeBase: QaKnowledgeBase}>());
  const taskStopCapabilities = useRef(new Map<string, TaskStopCapability>());
  const followupStates = useRef(new Map<string, FollowupSnapshot>());
  const followupRequests = useRef(new Map<string, string>());
  const followupLocks = useRef(new Set<string>());
  const setOwnerNotice = (id: string, message: string) => { notices.current.set(id, message); redraw(value => value + 1); };
  const steerLock = useRef<string | null>(null);
  const steerRequests = useRef(new Map<string, string>());
  const [steeringState, setSteering] = useState<SteeringSnapshot | null>(null);
  const active = selectedActive;
  const activeUserId = active?.messages.findLast(message => message.role === "user")?.id;

  const rememberTaskStopCapability = (conversationId: string, task: QaTask) => {
    const next: TaskStopCapability = {
      taskId: task.id,
      canStop: task.canStop === true,
      reason: typeof task.stopCapabilityReason === "string" && task.stopCapabilityReason.trim()
        ? task.stopCapabilityReason.trim()
        : null,
    };
    const previous = taskStopCapabilities.current.get(conversationId);
    if (previous?.taskId === next.taskId && previous.canStop === next.canStop && previous.reason === next.reason) return;
    taskStopCapabilities.current.set(conversationId, next);
    redraw(value => value + 1);
  };

  const sending = Boolean(active && sendingOwners.current.has(active.id));
  const notice = active ? notices.current.get(active.id) ?? "" : "";

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

  // Standalone and Dashboard both keep all owned running conversations alive.
  const polling = useRef(new Map<string, () => void>());
  useEffect(() => {
    const expected = new Set<string>();
    if (!preview && !brandHost().generalChatBackgroundPolling) for (const conversation of context.state.conversations) {
      if (conversation.purpose !== "enterprise_qa" || !conversation.taskId || isQaTaskTerminal(conversation.status) || conversation.status === "idle") continue;
      const taskId = conversation.taskId, conversationId = conversation.id;
      const userId = conversation.messages.findLast(message => message.role === "user")?.id;
      const key = JSON.stringify([conversationId, taskId, userId]); expected.add(key);
      if (polling.current.has(key)) continue;
      polling.current.set(key, startEnterpriseQaPolling({
        read: async () => {
          const result = await request<QaTask>(`/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}`);
          rememberTaskStopCapability(conversationId, result);
          if (pollNotices.current.delete(conversationId)) redraw(value => value + 1);
          const current = contextRef.current.state.conversations.find(item => item.id === conversationId);
          const value = readEnterpriseQaSteering(result.steering);
          if (value && userId && current && (current.previousResponseId ?? current.taskId) === taskId && current.messages.findLast(message => message.role === "user")?.id === userId)
            setSteering(previous => latestSteering(previous, { conversationId, taskId, userId, value }));
          return result;
        },
        refresh: () => contextRef.current.refreshConversations(),
        onError: error => { pollNotices.current.set(conversationId, error instanceof Error ? error.message : String(error)); redraw(value => value + 1); },
      }));
    }
    for (const [key, stop] of polling.current) if (!expected.has(key)) { stop(); polling.current.delete(key); }
  });
  useEffect(() => () => { polling.current.forEach(stop => stop()); polling.current.clear(); }, []);

  const queuePath = (id: string) => `/api/frontmind/v2/enterprise-qa/conversations/${encodeURIComponent(id)}/followups`;
  const readFollowups = useCallback(async (id: string) => {
    const version = queueVersions.current.get(id) ?? 0;
    const hadPending = Boolean(followupStates.current.get(id)?.items.length);
    const snapshot = await request<FollowupSnapshot>(queuePath(id));
    if (!Array.isArray(snapshot.items)) throw new Error("暂时无法读取待发送内容。");
    if ((queueVersions.current.get(id) ?? 0) === version) {
      followupStates.current.set(id, snapshot); redraw(value => value + 1);
      if (hadPending || snapshot.items.length) await contextRef.current.refreshConversations().catch(() => undefined);
    } return snapshot;
  }, [request]);
  useEffect(() => {
    if (preview || !evaluationIntent || !active?.id) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const id = active.id;
    const poll = async () => {
      try { await readFollowups(id); } catch { /* Existing queue stays visible during a transient read failure. */ }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    void poll(); return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [preview, evaluationIntent, active?.id, readFollowups]);
  const enqueueFollowup = useCallback(async (text: string) => {
    const conversation = contextRef.current.activeConversation, value = text.trim();
    if (!conversation || !value || preview) return false;
    const id = conversation.id, identity = JSON.stringify([id, value]);
    if (followupLocks.current.has(id)) return false;
    const clientRequestId = followupRequests.current.get(identity) ?? crypto.randomUUID();
    followupRequests.current.set(identity, clientRequestId); followupLocks.current.add(id);
    queueVersions.current.set(id, (queueVersions.current.get(id) ?? 0) + 1);
    try {
      if (!(await contextRef.current.flushConversation(id))) throw new Error("暂时无法保存本次输入。");
      const {item} = await request<{item: EnterpriseQaFollowup}>(queuePath(id), {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({clientRequestId, text:value}),
      });
      if (!item?.id) throw new Error("待发送内容尚未确认，请重试。");
      const previous = followupStates.current.get(id) ?? {items: [], paused: false};
      followupStates.current.set(id, {...previous, items: [...previous.items.filter(entry => entry.id !== item.id), item]});
      followupRequests.current.delete(identity);
      void readFollowups(id).catch(() => undefined); return true;
    } catch { return false; }
    finally { followupLocks.current.delete(id); redraw(value => value + 1); }
  }, [preview, request, readFollowups]);
  const changeFollowups = useCallback(async (action: string) => {
    const id = contextRef.current.activeConversation?.id; if (!id || preview) return false;
    queueVersions.current.set(id, (queueVersions.current.get(id) ?? 0) + 1);
    try {
      const snapshot = await request<FollowupSnapshot>(`${queuePath(id)}/${action}`, {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
      followupStates.current.set(id, snapshot); redraw(value => value + 1);
      await contextRef.current.refreshConversations().catch(() => undefined); return true;
    } catch { return false; }
  }, [preview, request]);

  const send = useCallback(
    async (text: string, attachments: File[] = [], newConversation?: Conversation) => {
      const conversation = newConversation && typeof newConversation.id === "string" && Array.isArray(newConversation.messages)
        ? newConversation : contextRef.current.activeConversation;
      if (!conversation || !text.trim() || sendingOwners.current.has(conversation.id)) return false;
      if (preview) {
        setOwnerNotice(conversation.id,
          "本地预览不调用企业问答供应商；请在开发子域名验证真实回答与引用。",
        );
        return false;
      }
      if (conversation.purpose !== "enterprise_qa") {
        setOwnerNotice(conversation.id, "请先选择企业问答任务");
        return false;
      }
      const ownedPending = latestBrowserOwnedUnresolvedGeneralChatDispatch(conversation.messages);
      if (!ownedPending && evaluationIntent && !attachments.length && (["running", "pending"].includes(conversation.status) || (followupStates.current.get(conversation.id)?.items.some(item => ["queued", "dispatching", "failed"].includes(item.status)) ?? false))) return enqueueFollowup(text);
      sendingOwners.current.add(conversation.id); redraw(value => value + 1);
      setOwnerNotice(conversation.id, "");
      try {
        let pending = latestBrowserOwnedUnresolvedGeneralChatDispatch(conversation.messages);
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
        const result = await request<QaTask | LocalReply | QueuedReply>(
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
        if (result.object === "frontmind.queued_followup") {
          if (result.conversationId !== conversation.id || result.userMessageId !== pending.id || !result.item?.id) throw new Error("待发送内容身份尚未确认，请重试读取。");
          // The server atomically moved this unsent draft behind an earlier
          // cross-tab enqueue. Never create another queue item for its receipt.
          contextRef.current.settleQueuedGeneralChatDispatch?.(conversation.id, pending.id);
          queueVersions.current.set(conversation.id, (queueVersions.current.get(conversation.id) ?? 0) + 1);
          const previous = followupStates.current.get(conversation.id) ?? {items:[],paused:false};
          followupStates.current.set(conversation.id, {items:[...previous.items.filter(item => item.id !== result.item.id), result.item],paused:previous.paused || result.item.paused});
          redraw(value => value + 1);
          await contextRef.current.refreshConversations().catch(() => undefined);
          void readFollowups(conversation.id).catch(() => undefined);
          return true;
        }
        if (result.object === "frontmind.local_reply") {
          const marker = enterpriseQaLocalReplyWithKnowledgeSchema.safeParse(result.enterpriseQaLocalReply);
          if (result.conversationId !== conversation.id || result.userMessageId !== pending.id || result.evaluation !== "not_required" || !marker.success || marker.data.turnId !== result.turnId || marker.data.answerMessageId !== result.answerMessageId || marker.data.userMessageId !== result.userMessageId) throw new Error("回复身份尚未确认，请重试读取。");
          contextRef.current.addMessage(conversation.id, {
            id: result.answerMessageId, role: "assistant", content: result.content, timestamp: result.completedAt,
            enterpriseQaLocalReply: marker.data,
          });
          contextRef.current.settleGeneralChatDispatch(conversation.id, pending.id);
          contextRef.current.updateStatus(conversation.id, "completed");
          // The server already committed the reply. A browser snapshot failure
          // must never turn its acknowledgement into another send attempt.
          try { await contextRef.current.flushConversation(conversation.id); } catch { /* Refresh restores the committed server reply. */ }
          await contextRef.current.refreshConversations().catch(() => undefined); return true;
        }
        const task = result;
        if (task.purpose && task.purpose !== "enterprise_qa") {
          throw new Error("返回任务不属于企业问答");
        }
        if (validKnowledgeBase(task.knowledgeBase)) {
          responseKnowledges.current.set(conversation.id, { taskId: task.id, knowledgeBase: task.knowledgeBase });
        }
        rememberTaskStopCapability(conversation.id, task);
        contextRef.current.updateStatus(
          conversation.id,
          conversationStatus(task.status),
          {
            taskId: task.id,
            previousResponseId: task.id,
            executionKind: "general_chat_v2",
          },
        );
        contextRef.current.settleGeneralChatDispatch(
          conversation.id,
          pending.id,
        );
        const steering = readEnterpriseQaSteering(task.steering);
        if (steering) setSteering(previous => latestSteering(previous, { conversationId: conversation.id, taskId: task.id, userId: pending.id, value: steering }));
        if (!(await contextRef.current.flushConversation(conversation.id))) {
          throw new Error("回答已开始，任务绑定尚未保存；请刷新恢复原任务。");
        }
        await contextRef.current.refreshConversations().catch(() => undefined);
        return true;
      } catch (error) {
        setOwnerNotice(conversation.id, error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        sendingOwners.current.delete(conversation.id); redraw(value => value + 1);
      }
    },
    [preview, request, evaluationIntent, enqueueFollowup, readFollowups],
  );

  const stop = useCallback(async () => {
    const conversation = contextRef.current.activeConversation;
    const taskId = conversation?.previousResponseId ?? conversation?.taskId;
    const capability = conversation ? taskStopCapabilities.current.get(conversation.id) : undefined;
    if (!conversation || !taskId || capability?.taskId !== taskId || capability.canStop !== true) {
      if (conversation) setOwnerNotice(conversation.id, capability?.reason || "当前回答暂不支持停止。");
      return false;
    }
    try {
      if (evaluationIntent) {
        queueVersions.current.set(conversation.id, (queueVersions.current.get(conversation.id) ?? 0) + 1);
        const snapshot = await request<FollowupSnapshot>(`${queuePath(conversation.id)}/pause`, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        followupStates.current.set(conversation.id, snapshot); redraw(value => value + 1);
      }
      await request(
        `/api/frontmind/v2/tasks/${encodeURIComponent(taskId)}/stop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      await contextRef.current.refreshConversations();
      return true;
    } catch (error) {
      return false;
    }
  }, [request, evaluationIntent]);

  const running = ["running", "pending"].includes(active?.status ?? "");
  const pendingMessage = active
    ? latestBrowserOwnedUnresolvedGeneralChatDispatch(active.messages)
    : undefined;
  const retryPending = useCallback(async () => {
    const messages = contextRef.current.activeConversation?.messages;
    const pending = messages
      ? latestBrowserOwnedUnresolvedGeneralChatDispatch(messages)
      : undefined;
    return pending ? send(pending.content, []) : false;
  }, [send]);
  const activeTaskId = active?.previousResponseId ?? active?.taskId;
  useEffect(() => {
    // Standalone polling already reads the task DTO above. Dashboard delegates
    // that polling to the host, so it needs this narrow read after a refresh.
    if (preview || !brandHost().generalChatBackgroundPolling || !running || !active?.id || !activeTaskId) return;
    if (taskStopCapabilities.current.get(active.id)?.taskId === activeTaskId) return;
    let cancelled = false;
    void request<QaTask>(`/api/frontmind/v2/tasks/${encodeURIComponent(activeTaskId)}`)
      .then(task => { if (!cancelled) rememberTaskStopCapability(active.id, task); })
      .catch(() => { /* Unknown capability remains fail-closed. */ });
    return () => { cancelled = true; };
  }, [preview, running, active?.id, activeTaskId, request]);
  const activeStopCapability = active ? taskStopCapabilities.current.get(active.id) : undefined;
  const canStop = Boolean(
    running && activeTaskId && activeStopCapability?.taskId === activeTaskId && activeStopCapability?.canStop,
  );
  const stopCapabilityReason = canStop
    ? null
    : running
      ? activeStopCapability?.taskId === activeTaskId && activeStopCapability?.reason
        ? activeStopCapability.reason
        : "正在确认当前回答是否支持停止。"
      : "回答已结束，无需停止。";
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
      return false;
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
  const responseKnowledge = active ? responseKnowledges.current.get(active.id) : undefined;
  const responseKnowledgeBase = responseKnowledge?.taskId === activeTaskId ? responseKnowledge?.knowledgeBase ?? null : null;
  const followups = active ? followupStates.current.get(active.id) : undefined;
  return {
    context,
    followups: followups?.items ?? [], followupsPaused: followups?.paused ?? false,
    enqueueFollowup,
    cancelFollowup: (id: string) => changeFollowups(`${encodeURIComponent(id)}/cancel`),
    resumeFollowups: () => changeFollowups("resume"),
    retryFollowup: (id: string) => changeFollowups(`${encodeURIComponent(id)}/retry`),
    active,
    sending,
    running,
    canStop,
    stopCapabilityReason,
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

