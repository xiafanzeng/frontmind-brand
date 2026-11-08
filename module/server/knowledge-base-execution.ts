import { randomUUID } from "node:crypto";
import { knowledgeProseSaveRecoveryCandidate } from "../contracts/knowledge-prose-recovery.js";
import { and, asc, eq } from "drizzle-orm";
import {
  generalExecutionActivity,
  type GeneralExecutionDto,
  type GeneralExecutionEntry,
  type ExecutionTurnState,
  type BusinessExecutionPhase,
  businessExecutionLabels,
  orderExecutionTimeline,
} from "@frontmind/module-contracts/execution";
import type { BrandSchema, KnowledgeBaseBuild } from "../schema/index.js";
import type { CoreSqlTable } from "../contracts/sql-table.js";
import type { ConversationTurn, Message } from "../contracts/core-records.js";
import type { AnyMySqlTable } from "drizzle-orm/mysql-core";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
export interface KnowledgeExecutionCore {
 agentEvents:AnyMySqlTable; conversationTurns:CoreSqlTable<ConversationTurn>; messages:CoreSqlTable<Message>; knowledgeBaseBuilds:BrandSchema["knowledgeBaseBuilds"];
 getDb():Promise<MySql2Database<any>|null>; enterpriseOwnerPredicate(table:any,userId:number):SQL;
 loadGeneralExecutions(db:any,ids:readonly string[]):Promise<Map<string,GeneralExecutionDto>>;
}
let agentEvents: KnowledgeExecutionCore["agentEvents"];
let conversationTurns: KnowledgeExecutionCore["conversationTurns"];
let knowledgeBaseBuilds: KnowledgeExecutionCore["knowledgeBaseBuilds"];
let messages: KnowledgeExecutionCore["messages"];
let getDb: KnowledgeExecutionCore["getDb"];
let enterpriseOwnerPredicate: KnowledgeExecutionCore["enterpriseOwnerPredicate"];
let loadGeneralExecutions: KnowledgeExecutionCore["loadGeneralExecutions"];
export function configureKnowledgeBaseExecutions(core: KnowledgeExecutionCore) { ({ agentEvents, conversationTurns, knowledgeBaseBuilds, messages, getDb, enterpriseOwnerPredicate, loadGeneralExecutions } = core); }

type ManusV2MessageEvent = Record<string, unknown> & {id:string;type:string;timestamp:number;providerOriginalRank?:number};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type ExecutionTurn = Pick<ConversationTurn, "id" | "userId" | "buildId" | "buildGeneration" | "expectedRevision" | "upstreamTaskId" | "errorCode" | "status" | "createdAt" | "startedAt" | "completedAt" | "metadata" | "operationType">;

/** The accepted business turn owns completion. A provider idle or a successful
 * tool result only describes activity inside that turn. */
export function knowledgeExecutionTurnState(input: {
  build: KnowledgeBaseBuild;
  turn: ExecutionTurn;
  latestTurnId?: string;
  timeline: readonly GeneralExecutionEntry[];
  observedAt: number;
}): ExecutionTurnState {
  const { build, turn, observedAt } = input;
  const metadata = turn.metadata ?? {};
  const prose = record(metadata.proseEditing);
  const nodes = Object.values(record(prose.nodes)).map(record);
  const ownsBuild = build.activeTurnId === turn.id || (!build.activeTurnId && input.latestTurnId === turn.id);
  const phaseEvent = orderExecutionTimeline(input.timeline.filter(entry => entry.turnId === turn.id))
    .reverse().find(entry => entry.phase || (entry.kind === "status" && entry.publicSummaryPhase));
  const phase = phaseEvent?.phase ?? (phaseEvent?.kind === "status" ? phaseEvent.publicSummaryPhase : undefined) ?? "researching";
  const base: ExecutionTurnState = {
    buildId: build.id,
    state: "unknown", phase, label: "正在同步状态",
    startedAt: turn.createdAt.getTime(),
    observedAt, generation: build.generation, stateEpoch: build.stateEpoch,
    ...(nodes.length ? { totalNodes: nodes.length, processedNodes: nodes.filter(node => node.state === "ready").length } : {}),
  };
  const state = (next: Partial<ExecutionTurnState>): ExecutionTurnState => ({ ...base, ...next });
  if (ownsBuild && knowledgeProseSaveRecoveryCandidate({build, turn}))
    return state({ state: "waiting", phase: "saving_knowledge_nodes", label: "内容保存待重试", proseRetryable: true, completedAt: turn.completedAt?.getTime() });
  if (turn.status === "cancelled") return state({ state: "cancelled", label: "已停止", completedAt: turn.completedAt?.getTime() });
  if (turn.status === "failed") return state({ state: "failed", label: "执行失败", completedAt: turn.completedAt?.getTime() });
  if (turn.status === "completed") {
    if (ownsBuild && ["preparing", "retrying"].includes(build.packageStatus))
      return state({ state: "running", phase: "publishing_knowledge", label: "正在发布" });
    if (ownsBuild && build.packageStatus === "attention_required")
      return state({ state: "waiting", phase: "publishing_knowledge", label: "发布待重试", completedAt: turn.completedAt?.getTime() });
    if (ownsBuild && build.status === "published" && build.publishedSnapshotId && build.packageStatus === "ready")
      return state({ state: "completed", phase: "knowledge_published", label: "已发布", completedAt: Math.max(turn.completedAt?.getTime() ?? 0, build.publishedAt?.getTime() ?? 0) || undefined });
    if (ownsBuild && ["confirming", "ready_to_publish"].includes(build.status))
      return state({ state: "completed", phase: turn.operationType === "revise" ? "knowledge_revision_saved" : "awaiting_knowledge_review", label: turn.operationType === "revise" ? "修改已保存，待更新" : "已生成，待确认", completedAt: turn.completedAt?.getTime() });
    return state({ state: "completed", phase: "saving_knowledge_nodes", label: "本轮已保存", completedAt: turn.completedAt?.getTime() });
  }
  if (!ownsBuild) return base;
  if (["AI_BALANCE_PAUSED", "AI_COST_PENDING"].includes(build.protocolErrorCode ?? ""))
    return state({ state: "waiting", label: build.protocolErrorCode === "AI_BALANCE_PAUSED" ? "等待补充额度" : "等待用量结算" });
  if (prose.state === "failed") return state({ state: "waiting", phase: "editing_knowledge_prose", label: nodes.some(node => /BALANCE|INSUFFICIENT/i.test(String(node.errorCode ?? ""))) ? "余额不足，充值后继续文字整理" : "文字整理待重试", proseRetryable: true });
  if (record(metadata.nodeEditRecovery).state === "pending")
    return state({ state: "waiting", phase: prose.state === "ready" ? "saving_knowledge_nodes" : "editing_knowledge_prose", label: prose.state === "ready" ? "文字已整理，等待恢复保存" : "文字整理结果待确认，正在恢复" });
  if (nodes.some(node => node.state === "submitted" && Boolean(node.errorCode)))
    return state({ state: "waiting", phase: "editing_knowledge_prose", label: nodes.some(node => node.state === "submitted" && /UNCERTAIN/.test(String(node.errorCode ?? "")) && !node.sessionId) ? "整理请求结果待确认，正在核对原请求" : "文字整理结果待确认，正在恢复" });
  if (record(metadata.materializedResultRead).lastErrorKind === "knowledge_prose_pending" && nodes.length > 0 && nodes.every(node => node.state === "ready"))
    return state({ state: "waiting", phase: "saving_knowledge_nodes", label: "文字已整理，等待恢复保存" });
  if (["pending", "running"].includes(String(prose.state)))
    return state({ state: "running", phase: "editing_knowledge_prose", label: "正在整理文字" });
  if (record(metadata.recovery).nodeEditMode === "low_v1" && prose.state !== "ready")
    return state({ state: "running", phase: "editing_knowledge_prose", label: "正在整理节点文字" });
  if (metadata.awaitingClientAttachments === true)
    return state({ state: "waiting", phase: "uploading", label: "等待资料上传" });
  const recovery = String(metadata.recoveryAction ?? "");
  if (["awaiting_input", "top_up", "update_credential", "retry_request", "contact_support"].includes(recovery))
    return state({ state: "waiting", label: ({ awaiting_input: "等待补充输入", top_up: "等待补充额度", update_credential: "等待更新连接", retry_request: "等待重试", contact_support: "需要处理" } as Record<string, string>)[recovery]! });
  if (prose.state === "ready" || record(metadata.materializedResultDiagnostics).resultProcessingStage)
    return state({ state: "running", phase: "validating_knowledge_output", label: "正在校验并保存内容" });
  if (turn.status === "queued") return state({ state: "running", phase: "dispatching", label: "等待执行" });
  return state({ state: "running", label: businessExecutionLabels[phase] });
}

export async function loadCompletedKnowledgeBaseSummaryTurn(input: {
  userId: number;
  buildId: string;
  generation: number;
  turnId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [turn] = await db
    .select({ id: conversationTurns.id, upstreamTaskId: conversationTurns.upstreamTaskId,
      completedAt: conversationTurns.completedAt, metadata: conversationTurns.metadata })
    .from(conversationTurns)
    .where(and(
      enterpriseOwnerPredicate(conversationTurns, input.userId),
      eq(conversationTurns.id, input.turnId),
      eq(conversationTurns.buildId, input.buildId),
      eq(conversationTurns.buildGeneration, input.generation),
      eq(conversationTurns.status, "completed"),
    ))
    .limit(1);
  // WMA owns native public text. Even when the current account credential is
  // XTY, a completed native turn must never enter the paid summary backfill lane.
  if ((turn?.metadata?.nativeKnowledgeProvider as { provider?: string } | undefined)?.provider === "tencent_wma") return null;
  return turn?.upstreamTaskId ? { ...turn, upstreamTaskId: turn.upstreamTaskId } : null;
}

/** Called by the existing, leased knowledge worker; it never starts another provider poller. */
export async function persistKnowledgeBaseExecution(input: {
  userId: number;
  buildId: string;
  generation: number;
  turnId: string;
  events: readonly ManusV2MessageEvent[];
  completedSummaryTaskId?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const [build] = await tx
      .select()
      .from(knowledgeBaseBuilds)
      .where(
        and(
          enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
          eq(knowledgeBaseBuilds.id, input.buildId),
          eq(knowledgeBaseBuilds.generation, input.generation),
          ...(input.completedSummaryTaskId ? [] : [eq(knowledgeBaseBuilds.activeTurnId, input.turnId)]),
        ),
      )
      .limit(1)
      .for("update");
    if (!build || build.executionMode === "reset_retired") return; // Reset or a newer turn invalidates all late work.
    const [turn] = await tx
      .select({
        id: conversationTurns.id,
        sequence: messages.sequence,
        messageId: messages.id,
        status: conversationTurns.status,
        upstreamTaskId: conversationTurns.upstreamTaskId,
      })
      .from(conversationTurns)
      .innerJoin(
        messages,
        and(
          eq(messages.turnId, conversationTurns.id),
          eq(messages.role, "user"),
        ),
      )
      .where(
        and(
          enterpriseOwnerPredicate(conversationTurns, input.userId),
          eq(conversationTurns.id, input.turnId),
          eq(conversationTurns.buildId, input.buildId),
          eq(conversationTurns.buildGeneration, input.generation),
        ),
      )
      .limit(1);
    if (!turn) return;
    if (input.completedSummaryTaskId && (turn.status !== "completed" || turn.upstreamTaskId !== input.completedSummaryTaskId)) return;
    for (const [index, event] of input.events.entries()) {
      const activity = generalExecutionActivity(event.executionActivity);
      if (!activity) continue;
      if (input.completedSummaryTaskId && (activity.kind !== "status" || activity.status !== "thinking" ||
        (!activity.publicSummarySourceHash && !(activity.publicSummaryOrigin === "provider_native" && activity.publicSummaryProvider === "kimi" &&
          ["analysis", "operation"].includes(activity.publicSummaryKind ?? ""))))) continue;
      const timestamp = Number(event.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < 0) continue;
      const normalizedPayload = {
        kind: "provider_event",
        type: event.type,
        knowledgeGeneration: input.generation,
        providerOriginalRank: event.providerOriginalRank ?? index,
        executionTurn: {
          id: turn.id,
          userSequence: turn.sequence,
          userMessageId: turn.messageId,
        },
        executionActivity:
          activity.kind === "tool_result" && activity.callId
            ? { ...activity, callId: `kb:${input.turnId}:${activity.callId}` }
            : activity,
      };
      // Include the turn in the event key because each materialized revision owns a new session.
      const providerEventId = `kb:${input.turnId}:${event.id}`;
      await tx
        .insert(agentEvents)
        .values({
          id: randomUUID(),
          taskId: input.buildId,
          providerEventId,
          eventType: "knowledge_execution",
          providerTimestampMs: timestamp,
          normalizedPayload,
        })
        .onDuplicateKeyUpdate({
          set: { normalizedPayload, providerTimestampMs: timestamp },
        });
    }
  });
}

const summaryTails = new Map<string, Promise<void>>();
const summaryTailKey = (input: { userId: number; buildId: string; generation: number; turnId: string }) =>
  `${input.userId}:${input.buildId}:${input.generation}:${input.turnId}`;
type SavedProcessSummaries = { events: readonly ManusV2MessageEvent[]; pending: boolean };
/** Execution-side reads only. Late summary insertion never changes a turn or its knowledge. */
export function collectKnowledgeBaseSummaryTail(input: {
  userId: number; buildId: string; generation: number; turnId: string; taskId: string;
  read: () => Promise<SavedProcessSummaries>;
  durationMs?: number; intervalMs?: number;
  persist?: typeof persistKnowledgeBaseExecution;
}) {
  const key = summaryTailKey(input);
  if (summaryTails.has(key)) return summaryTails.get(key)!;
  const deadline = Date.now() + Math.min(input.durationMs ?? 75_000, 1_250_000);
  const work = (async () => {
    do {
      try {
        const observation = await input.read();
        await (input.persist ?? persistKnowledgeBaseExecution)({ userId: input.userId, buildId: input.buildId,
          generation: input.generation, turnId: input.turnId, completedSummaryTaskId: input.taskId, events: observation.events });
        if (!observation.pending) return;
      } catch { /* Provider reads are recoverable and never block the completed business task. */ }
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, input.intervalMs ?? 3000); timer.unref?.(); });
    } while (Date.now() < deadline);
  })().finally(() => summaryTails.delete(key));
  summaryTails.set(key, work);
  return work;
}

/** Recover saved public records after a Dashboard restart. Kimi may resume its
 * already journalled translation intents; it never reconstructs private reasoning.
 * Other providers retain their original, bounded summary completion window. */
export async function restoreKnowledgeBaseSummaryTail(input: {
  userId: number; buildId: string; generation: number; turnId: string;
  resumePending?: boolean;
  read: (taskId: string) => Promise<SavedProcessSummaries>;
}, dependencies: {
  loadTurn?: typeof loadCompletedKnowledgeBaseSummaryTurn;
  persist?: typeof persistKnowledgeBaseExecution;
  now?: () => number;
} = {}) {
  if (summaryTails.has(summaryTailKey(input))) return false;
  const turn = await (dependencies.loadTurn ?? loadCompletedKnowledgeBaseSummaryTurn)(input);
  if (!turn?.upstreamTaskId) return false;
  const taskId = turn.upstreamTaskId;
  const read = () => input.read(taskId);
  const saved = await read();
  const persist = dependencies.persist ?? persistKnowledgeBaseExecution;
  await persist({ ...input, completedSummaryTaskId: taskId, events: saved.events });
  const elapsed = (dependencies.now ?? Date.now)() - Number(turn.completedAt);
  const remaining = input.resumePending ? 1_250_000 : Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(0, 75_000 - elapsed) : 0;
  if (saved.pending && remaining > 0) {
    void collectKnowledgeBaseSummaryTail({ ...input, taskId, read, persist, durationMs: remaining });
  }
  return saved.events.length > 0;
}

/** Owned, current-generation evidence only; old conversations are never reconstructed. */
export async function loadKnowledgeBaseExecution(input: {
  userId: number;
  buildId: string;
  generation: number;
  phase?: string | null;
  executor?: any;
  includeFullHistory?: boolean;
}): Promise<GeneralExecutionDto | undefined> {
  const db = input.executor ?? (await getDb());
  if (!db) return undefined;
  const [build] = await db
    .select()
    .from(knowledgeBaseBuilds)
    .where(
      and(
        enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
        eq(knowledgeBaseBuilds.id, input.buildId),
        eq(knowledgeBaseBuilds.generation, input.generation),
      ),
    )
    .limit(1);
  if (!build || build.executionMode === "reset_retired") return undefined;
  const turns = await db
    .select({
      id: conversationTurns.id,
      userId: conversationTurns.userId,
      buildId: conversationTurns.buildId,
      buildGeneration: conversationTurns.buildGeneration,
      expectedRevision: conversationTurns.expectedRevision,
      errorCode: conversationTurns.errorCode,
      sequence: messages.sequence,
      messageId: messages.id,
      status: conversationTurns.status,
      createdAt: conversationTurns.createdAt,
      startedAt: conversationTurns.startedAt,
      completedAt: conversationTurns.completedAt,
      upstreamTaskId: conversationTurns.upstreamTaskId,
      metadata: conversationTurns.metadata,
      operationType: conversationTurns.operationType,
    })
    .from(conversationTurns)
    .innerJoin(
      messages,
      and(eq(messages.turnId, conversationTurns.id), eq(messages.role, "user")),
    )
    .where(
      and(
        enterpriseOwnerPredicate(conversationTurns, input.userId),
        eq(conversationTurns.buildId, build.id),
        eq(conversationTurns.buildGeneration, input.generation),
      ),
    )
    .orderBy(asc(messages.sequence));
  const execution = (await loadGeneralExecutions(db, [build.id])).get(
    build.id,
  )!;
  const ownedTurns = new Set(turns.map((turn: { id: string }) => turn.id));
  const timeline = execution.timeline.filter((entry) =>
    ownedTurns.has(entry.turnId),
  );
  const observedAt = Date.now();
  // Local confirmations are hidden from the execution transcript. Keep the
  // current build outcome on the latest visible AI turn after confirmation.
  const latestTurnId = [...turns].reverse().find(turn => turn.operationType !== "local_confirm")?.id;
  const turnStates: NonNullable<GeneralExecutionDto["turnStates"]> = {};
  for (const turn of turns) {
    const authority = knowledgeExecutionTurnState({ build, turn, latestTurnId, timeline, observedAt });
    turnStates[turn.id] = authority;
    const base = {
      turnId: turn.id,
      userMessageId: turn.messageId,
      userSequence: turn.sequence,
    };
    const upload = turn.metadata?.browserUpload as
      | { status?: string; lastHeartbeatAt?: number; lastProgressAt?: number }
      | undefined;
    const awaiting = turn.metadata?.awaitingClientAttachments === true;
    // The reserved user turn is a real preparation event. Its identity and time
    // remain stable across refreshes and merge into the same model run.
    timeline.push({
      ...base,
      runId: build.id,
      id: `kb:${turn.id}:reserved`,
      timestamp: turn.createdAt.getTime(),
      rank: -100,
      kind: "status",
      phase: "uploading",
      label: businessExecutionLabels.uploading,
      status:
        upload?.status === "cancelled"
          ? "cancelled"
          : awaiting
            ? "waiting"
            : "ended",
    });
    if (awaiting && upload?.lastHeartbeatAt) {
      const age = Date.now() - upload.lastHeartbeatAt;
      const stalled =
        Date.now() - (upload.lastProgressAt ?? upload.lastHeartbeatAt) > 30_000;
      if (age > 60_000 || stalled)
        timeline.push({
          ...base,
          runId: build.id,
          id: `kb:${turn.id}:connection`,
          timestamp: upload.lastHeartbeatAt,
          rank: -99,
          kind: "status",
          status: "waiting",
          publicSummary:
            age > 60_000
              ? "浏览器连接已中断，已收到的资料已保留。"
              : "当前连接没有进展，可检查网络后继续。",
        });
    }
    if (
      ["completed", "failed", "cancelled"].includes(turn.status) &&
      turn.completedAt
    ) {
      timeline.push({
        ...base,
        id: `kb:${turn.id}:finished`,
        timestamp: turn.completedAt.getTime(),
        rank: Number.MAX_SAFE_INTEGER,
        kind: "status",
        runId: build.id,
        ...(turn.status === "completed" || authority.proseRetryable ? { phase: authority.phase, label: authority.label } : {}),
        status:
          authority.proseRetryable
            ? "waiting"
            : turn.status === "completed"
            ? "ended"
            : turn.status === "cancelled"
              ? "cancelled"
              : "error",
      });
    }
  }
  const ordered = orderExecutionTimeline(timeline);
  for (const [index, item] of ordered.entries()) {
    if (item.kind !== "status" || !item.phase || item.status !== "running")
      continue;
    const next = ordered
      .slice(index + 1)
      .find((entry) =>
        entry.turnId === item.turnId &&
        entry.kind === "status" &&
        (entry.phase || entry.id === `kb:${item.turnId}:finished`),
      );
    if (next) {
      // Provider activity happens inside the business stage. A busy/thinking
      // event or tool result cannot prove that research or normalization ended.
      item.status = next.kind === "status" &&
        (next.status === "error" || next.status === "cancelled")
        ? next.status : "ended";
      // MySQL historical timestamps have second precision; never show negative duration.
      item.finishedAt = Math.max(item.timestamp, next.timestamp);
    }
  }
  // Long public paragraphs stay intact; the progress poll only transports the
  // latest bounded window. Authority above was derived from the full turn.
  const readable = ordered.filter(entry => entry.kind !== "status" || entry.status !== "thinking" || Boolean(entry.publicSummary));
  const turnHistory: NonNullable<GeneralExecutionDto["turnHistory"]> = {};
  const retained = new Set<string>();
  for (const turn of turns) {
    const entries = readable.filter(entry => entry.turnId === turn.id && entry.kind !== "message");
    const page = input.includeFullHistory ? entries : entries.slice(-48);
    for (const entry of page) retained.add(entry.id);
    turnHistory[turn.id] = {totalEntries:entries.length,hasMore:page.length < entries.length,oldestEntryId:page[0]?.id,
      pendingPublicRecords:entries.filter(entry => entry.kind === "status" && entry.publicSummaryTranslation === "pending").length};
  }
  return {
    ...execution,
    turnStates,
    runId: build.id,
    phase: input.phase ?? undefined,
    coverage:
      execution.coverage === "complete"
        ? "complete"
        : timeline.length
          ? "partial"
          : "unavailable",
    timeline: readable.filter(entry => entry.kind === "message" || retained.has(entry.id)),
    turnHistory,
  };
}

export async function loadKnowledgeBaseExecutionHistory(input: {
  userId:number;buildId:string;generation:number;turnId:string;beforeId?:string;
}) {
  const execution = await loadKnowledgeBaseExecution({...input,includeFullHistory:true});
  const authority = execution?.turnStates?.[input.turnId];
  if (!execution || !authority) return null;
  const entries = execution.timeline.filter(entry => entry.turnId === input.turnId && entry.kind !== "message");
  const end = input.beforeId ? entries.findIndex(entry => entry.id === input.beforeId) : entries.length;
  if (end < 0) throw new Error("EXECUTION_HISTORY_CURSOR_EXPIRED");
  const start = Math.max(0,end - 48);
  const page = entries.slice(start,end);
  return {buildId:input.buildId,turnId:input.turnId,generation:authority.generation,stateEpoch:authority.stateEpoch,
    entries:page,totalEntries:entries.length,hasMore:start>0,oldestEntryId:page[0]?.id};
}

/** First occurrence of a real local stage, under the worker's existing lease. */
export async function persistKnowledgeBaseStage(input: {
  userId: number;
  buildId: string;
  generation: number;
  turnId: string;
  phase: BusinessExecutionPhase;
  rank: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const [build] = await tx
      .select({
        id: knowledgeBaseBuilds.id,
        mode: knowledgeBaseBuilds.executionMode,
      })
      .from(knowledgeBaseBuilds)
      .where(
        and(
          enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
          eq(knowledgeBaseBuilds.id, input.buildId),
          eq(knowledgeBaseBuilds.generation, input.generation),
          eq(knowledgeBaseBuilds.activeTurnId, input.turnId),
        ),
      )
      .limit(1)
      .for("update");
    if (!build || build.mode === "reset_retired") return;
    const [turn] = await tx
      .select({
        id: conversationTurns.id,
        sequence: messages.sequence,
        messageId: messages.id,
      })
      .from(conversationTurns)
      .innerJoin(
        messages,
        and(
          eq(messages.turnId, conversationTurns.id),
          eq(messages.role, "user"),
        ),
      )
      .where(
        and(
          enterpriseOwnerPredicate(conversationTurns, input.userId),
          eq(conversationTurns.id, input.turnId),
          eq(conversationTurns.buildId, input.buildId),
          eq(conversationTurns.buildGeneration, input.generation),
        ),
      )
      .limit(1);
    if (!turn) return;
    const providerEventId = `kb:${input.turnId}:stage:${input.phase}`;
    await tx
      .insert(agentEvents)
      .values({
        id: randomUUID(),
        taskId: input.buildId,
        providerEventId,
        eventType: "knowledge_execution",
        providerTimestampMs: Date.now(),
        normalizedPayload: {
          kind: "business_event",
          knowledgeGeneration: input.generation,
          businessPhase: input.phase,
          providerOriginalRank: input.rank,
          executionTurn: {
            id: turn.id,
            userSequence: turn.sequence,
            userMessageId: turn.messageId,
          },
          executionActivity: { kind: "status", status: "running" },
        },
      })
      .onDuplicateKeyUpdate({ set: { providerEventId } }); // Keep the first timestamp.
  });
}
