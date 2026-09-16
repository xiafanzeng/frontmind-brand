import type {AiBillingPause,DashboardManagedRuntime,DashboardAgentRuntimeStore} from "@frontmind/module-contracts/managed-runtime";
import type {KnowledgeCredential} from "./knowledge-http-ports.js";
import type {DashboardAgentClientOptions,DashboardAgentClient} from "./siteops/provider-ports.js";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { KnowledgeBaseRecoveryClaim } from "./knowledge-base-turn-service.js";
import type {BrandSchema} from "../schema/index.js";
import type {CoreSqlTable} from "../contracts/sql-table.js";
import type {ConversationTurn,Conversation} from "../contracts/core-records.js";
import type {MySql2Database} from "drizzle-orm/mysql2";
import type {AnyMySqlTable,AnyMySqlColumn} from "drizzle-orm/mysql-core";
import type {SQL} from "drizzle-orm";
type CoreTransportTable<Names extends string>=AnyMySqlTable & {[Key in Names]:AnyMySqlColumn};

export interface KnowledgeBillingCore {
 agentOperations:CoreTransportTable<"id"|"accountUserId"|"scope"|"provider"|"enterpriseProjectId">;agentTasks:CoreTransportTable<"operationId"|"providerRuntime">;conversationTurns:CoreSqlTable<ConversationTurn>;conversations:CoreSqlTable<Conversation>;knowledgeBaseBuilds:BrandSchema["knowledgeBaseBuilds"];
 AiBillingError:new(code:any)=>Error & {code:string};AiBillingPausedError:new(pause:AiBillingPause)=>Error & {code:string;pause:AiBillingPause};
 assertAiAccountFunds(userId:number):Promise<void>;registerAiUsageTask(taskId:string):Promise<unknown>;getDb():Promise<MySql2Database<any>|null>;
 getDecryptedCredentialForAccountById(userId:number,credentialId:string):Promise<KnowledgeCredential|null>;
 enterpriseOwnerPredicate(table:any,userId:number):SQL;enterpriseProjectPredicate(table:any):SQL;
 createDashboardAgentClient(options:DashboardAgentClientOptions):DashboardAgentClient;dashboardAgentRuntimeStore:Pick<DashboardAgentRuntimeStore,"mutate">;
 createBillingReconcileApi(credentialRef:string):{listAll(path:string,params:{order:"asc"}):Promise<Record<string,any>[]>};
}
let agentOperations: KnowledgeBillingCore["agentOperations"];
let agentTasks: KnowledgeBillingCore["agentTasks"];
let conversationTurns: KnowledgeBillingCore["conversationTurns"];
let conversations: KnowledgeBillingCore["conversations"];
let knowledgeBaseBuilds: KnowledgeBillingCore["knowledgeBaseBuilds"];
let AiBillingError: KnowledgeBillingCore["AiBillingError"];
let AiBillingPausedError: KnowledgeBillingCore["AiBillingPausedError"];
let assertAiAccountFunds: KnowledgeBillingCore["assertAiAccountFunds"];
let registerAiUsageTask: KnowledgeBillingCore["registerAiUsageTask"];
let getDb: KnowledgeBillingCore["getDb"];
let getDecryptedCredentialForAccountById: KnowledgeBillingCore["getDecryptedCredentialForAccountById"];
let enterpriseOwnerPredicate: KnowledgeBillingCore["enterpriseOwnerPredicate"];
let enterpriseProjectPredicate: KnowledgeBillingCore["enterpriseProjectPredicate"];
let createDashboardAgentClient: KnowledgeBillingCore["createDashboardAgentClient"];
let dashboardAgentRuntimeStore: KnowledgeBillingCore["dashboardAgentRuntimeStore"];
let createBillingReconcileApi: KnowledgeBillingCore["createBillingReconcileApi"];
export function configureKnowledgeBilling(core: KnowledgeBillingCore) { ({ agentOperations, agentTasks, conversationTurns, conversations, knowledgeBaseBuilds, AiBillingError, AiBillingPausedError, assertAiAccountFunds, registerAiUsageTask, getDb, getDecryptedCredentialForAccountById, enterpriseOwnerPredicate, enterpriseProjectPredicate, createDashboardAgentClient, dashboardAgentRuntimeStore, createBillingReconcileApi } = core); }


const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
async function database() {
  const db = await getDb();
  if (!db) throw new AiBillingError("AI_BILLING_DATABASE_UNAVAILABLE");
  return db;
}
export async function assertKnowledgeBaseDispatchFunds(
  userId: number,
  turnId: string,
) {
  const db = await database();
  const [turn] = await db
    .select({ metadata: conversationTurns.metadata })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, turnId),
        enterpriseOwnerPredicate(conversationTurns, userId),
      ),
    )
    .limit(1);
  if (!turn) throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
  const recovery = record(record(turn.metadata).recovery);
  if (
    recovery.kind === "start" ||
    (recovery.nodeEditMode === "low_v1" &&
      String(recovery.userMessage ?? "").trim())
  )
    await assertAiAccountFunds(userId);
}
async function owned(
  tx: any,
  input: { userId: number; buildId: string; turnId?: string },
) {
  const [build] = await tx
    .select()
    .from(knowledgeBaseBuilds)
    .where(
      and(
        eq(knowledgeBaseBuilds.id, input.buildId),
        enterpriseOwnerPredicate(knowledgeBaseBuilds, input.userId),
      ),
    )
    .limit(1)
    .for("update");
  if (
    !build?.activeTurnId ||
    (input.turnId && build.activeTurnId !== input.turnId)
  )
    throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
  const [turn] = await tx
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, build.activeTurnId),
        enterpriseOwnerPredicate(conversationTurns, input.userId),
        eq(conversationTurns.buildGeneration, build.generation),
      ),
    )
    .limit(1)
    .for("update");
  if (!turn) throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
  return { build, turn };
}
async function transportForTurn(tx: any, userId: number, turn: any) {
  const [row] = await tx
    .select({ task: agentTasks, operation: agentOperations })
    .from(agentTasks)
    .innerJoin(agentOperations, eq(agentOperations.id, agentTasks.operationId))
    .where(
      and(
        eq(agentOperations.accountUserId, userId),
        eq(agentOperations.scope, "managed_user"),
        eq(agentOperations.provider, "zhipu"),
        enterpriseProjectPredicate(agentOperations.enterpriseProjectId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${agentTasks.providerRuntime}, '$.dashboardManaged.intentId')) = ${turn.id}`,
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
  return row;
}

/** The durable financial marker proves whether any user command was sent. */
export async function pauseKnowledgeBaseForBilling(
  claim: KnowledgeBaseRecoveryClaim,
  error: unknown,
) {
  if (
    !(error instanceof AiBillingError) ||
    ![
      "AI_BALANCE_INSUFFICIENT",
      "AI_BALANCE_PAUSED",
      "AI_COST_PENDING",
    ].includes(error.code)
  )
    return false;
  const db = await database();
  await db.transaction(async (tx) => {
    const { build, turn } = await owned(tx, {
      userId: claim.turn.userId,
      buildId: claim.turn.buildId,
      turnId: claim.turn.id,
    });
    const { task } = await transportForTurn(tx, claim.turn.userId, turn);
    const runtime = record(task.providerRuntime);
    const managed = runtime.dashboardManaged as DashboardManagedRuntime;
    const pause = runtime.billingPause as AiBillingPause | undefined;
    if (!pause || !managed || managed.sessionId !== pause.sessionId)
      throw error;
    const metadata = record(turn.metadata);
    if (
      metadata.aiBillingPause?.pausedAt === pause.pausedAt &&
      turn.status === "failed"
    )
      return;
    if (
      metadata.leaseOwnerHash !==
      createHash("sha256").update(claim.leaseToken).digest("hex")
    )
      throw new AiBillingError("AI_RESUME_PENDING");
    if (!["queued", "running"].includes(turn.status))
      throw new AiBillingError("AI_RESUME_PENDING");
    const before = managed.commands.find(
      (command) => command.key === pause.commandKey,
    );
    if (
      pause.stage === "before_send" &&
      (!before || before.eventId || managed.mutations[`message:${before.key}`])
    )
      throw new AiBillingError("AI_RESUME_PENDING");
    if (pause.stage === "after_send" && turn.upstreamTaskId !== pause.sessionId)
      throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
    const now = new Date();
    const code =
      pause.reason === "balance" ? "AI_BALANCE_PAUSED" : "AI_COST_PENDING";
    const message =
      pause.reason === "balance"
        ? "账户余额不足，任务已中断。已保存内容和原任务保留，充值后点击继续。"
        : "任务费用正在核对，已保存内容和原任务保留。";
    await tx
      .update(conversationTurns)
      .set({
        status: "failed",
        errorCode: code,
        errorMessage: message,
        completedAt: now,
        leaseExpiresAt: null,
        metadata: {
          ...metadata,
          dispatchState: "failed",
          failureClass: "requires_user_fix",
          recoveryAction:
            pause.reason === "balance" ? "top_up" : "contact_support",
          canRegenerate: false,
          aiBillingPause: {
            ...pause,
            taskId: task.id,
            previousBuildStatus: build.status,
          },
        },
        updatedAt: now,
      })
      .where(eq(conversationTurns.id, turn.id));
    await tx
      .update(knowledgeBaseBuilds)
      .set({
        status: "protocol_error",
        protocolErrorCode: code,
        protocolError: message,
        awaitingResponseSince: null,
        stateEpoch: build.stateEpoch + 1,
        updatedAt: now,
      })
      .where(eq(knowledgeBaseBuilds.id, build.id));
    await tx
      .update(conversations)
      .set({
        status: "awaiting_input",
        updatedAt: now,
        version: sql`${conversations.version}+1`,
      })
      .where(
        and(
          eq(conversations.id, turn.conversationId),
          enterpriseOwnerPredicate(conversations, claim.turn.userId),
        ),
      );
  });
  return true;
}

/** A repeated resume request reconciles one frozen command; it never sends a second copy. */
export async function continueKnowledgeBaseAfterRecharge(
  input: {
    userId: number;
    buildId: string;
    turnId: string;
    requestId: string;
  },
  dependencies: {
    resolveCredential?: typeof getDecryptedCredentialForAccountById;
    createClient?: typeof createDashboardAgentClient;
    createApi?: typeof createBillingReconcileApi;
    store?: typeof dashboardAgentRuntimeStore;
  } = {},
) {
  await assertAiAccountFunds(input.userId);
  const db = await database();
  const selection = await db
    .transaction(async (tx) => {
      const { build, turn } = await owned(tx, input);
      const metadata = record(turn.metadata);
      const { task, operation } = await transportForTurn(
        tx,
        input.userId,
        turn,
      );
      if (!metadata.aiBillingPause) {
        if (metadata.aiBillingResumed === true)
          return { already: true as const, turn, task, operation };
        throw new AiBillingError("AI_RESUME_PENDING");
      }
      const pause = metadata.aiBillingPause as AiBillingPause & {
        previousBuildStatus: string;
        taskId: string;
        resumeRequestId?: string;
        leaseUntil?: number;
      };
      if (pause.taskId !== task.id)
        throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
      if (
        pause.reason === "cost" &&
        record(record(task.providerRuntime).billingPause).reason === "cost"
      )
        throw new AiBillingError("AI_COST_PENDING");
      if ((pause.leaseUntil ?? 0) > Date.now())
        throw new AiBillingError("AI_RESUME_PENDING");
      const managed = record(task.providerRuntime)
        .dashboardManaged as DashboardManagedRuntime;
      const priorIntent =
        pause.resumeRequestId &&
        `knowledge-billing-resume:${turn.id}:${pause.resumeRequestId}`;
      const priorCommand = managed.commands.find(
        (command) => command.intentId === priorIntent,
      );
      const priorRejected =
        priorCommand &&
        !priorCommand.eventId &&
        managed.mutations[`message:${priorCommand.key}`]?.state === "rejected";
      // Only an explicitly new click can replace a definitely rejected request.
      // Unknown acknowledgements retain the original intent across clicks/restarts.
      if (priorRejected && input.requestId === pause.resumeRequestId)
        throw new AiBillingError("AI_RESUME_REJECTED");
      const requestId = priorRejected
        ? input.requestId
        : (pause.resumeRequestId ?? input.requestId);
      await tx
        .update(conversationTurns)
        .set({
          metadata: {
            ...metadata,
            aiBillingPause: {
              ...pause,
              resumeRequestId: requestId,
              leaseUntil: Date.now() + 60000,
            },
          },
        })
        .where(eq(conversationTurns.id, turn.id));
      return {
        already: false as const,
        build,
        turn,
        task,
        operation,
        pause,
        requestId,
      };
    })
    .catch(async (error) => {
      if (error instanceof AiBillingError && error.code === "AI_COST_PENDING") {
        const [turn] = await db
          .select({ metadata: conversationTurns.metadata })
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.id, input.turnId),
              enterpriseOwnerPredicate(conversationTurns, input.userId),
            ),
          )
          .limit(1);
        const taskId = record(record(turn?.metadata).aiBillingPause).taskId;
        if (typeof taskId === "string") await registerAiUsageTask(taskId);
      }
      throw error;
    });
  const credential = await (
    dependencies.resolveCredential ?? getDecryptedCredentialForAccountById
  )(input.userId, selection.operation.apiCredentialId);
  if (
    !credential ||
    credential.version !== selection.operation.credentialVersion
  )
    throw new AiBillingError("AI_CREDENTIAL_UNAVAILABLE");
  if (selection.already)
    return { turnId: selection.turn.id, credential, already: true };
  try {
    const managed = record(selection.task.providerRuntime)
      .dashboardManaged as DashboardManagedRuntime;
    if (!managed || managed.sessionId !== selection.pause.sessionId)
      throw new AiBillingError("AI_BILLING_TASK_OWNERSHIP");
    const identity = {
      provider: "zhipu" as const,
      accountUserId: input.userId,
      credentialId: credential.id,
      credentialVersion: credential.version,
      enterpriseProjectId: selection.operation.enterpriseProjectId ?? null,
    };
    if (
      selection.pause.stage === "after_send" ||
      selection.turn.upstreamTaskId
    ) {
      const pending =
        selection.pause.stage === "before_send"
          ? managed.commands.find(
              (command) => command.key === selection.pause.commandKey,
            )
          : undefined;
      const intentId =
        pending?.intentId ??
        `knowledge-billing-resume:${selection.turn.id}:${selection.requestId}`;
      const command = managed.commands.find(
        (command) => command.intentId === intentId,
      );
      if (
        command &&
        !command.eventId &&
        managed.mutations[`message:${command.key}`]
      ) {
        const api =
          dependencies.createApi?.(credential.credentialRef) ??
          createBillingReconcileApi(credential.credentialRef);
        const events = await api.listAll(
          `/v1/sessions/${managed.sessionId}/events`,
          { order: "asc" },
        );
        const candidates = events.filter(
          (event) =>
            event.type === "user.message" &&
            event.processed_at &&
            !command.beforeEventIds.includes(String(event.id)) &&
            createHash("sha256")
              .update(
                typeof event.content === "string"
                  ? event.content
                  : Array.isArray(event.content)
                    ? event.content
                        .filter((block: any) => block.type === "text")
                        .map((block: any) => block.text)
                        .join("\n")
                    : "",
              )
              .digest("hex") === command.providerPromptHash,
        );
        if (candidates.length !== 1)
          throw new AiBillingError("AI_RESUME_PENDING");
        await (dependencies.store ?? dashboardAgentRuntimeStore).mutate(
          identity,
          selection.task.id,
          (runtime) => ({
            ...runtime,
            commands: runtime.commands.map((item) =>
              item.key === command.key
                ? { ...item, eventId: String(candidates[0]!.id) }
                : item,
            ),
            mutations: {
              ...runtime.mutations,
              [`message:${command.key}`]: {
                ...runtime.mutations[`message:${command.key}`]!,
                state: "acknowledged",
                resourceId: String(candidates[0]!.id),
              },
            },
          }),
        );
      } else if (!command?.eventId) {
        await (dependencies.createClient ?? createDashboardAgentClient)({
          ...identity,
          credentialRef: credential.credentialRef,
          intentId,
          localTaskId: selection.task.id,
          operationId: selection.operation.id,
          model: managed.model,
          effort: managed.effort,
        }).sendMessage({
          taskId: managed.sessionId!,
          prompt:
            "用户已确认继续，请从本次中断处继续原任务。保持原有工作流、输出文件名、业务约束和用户确认点，不重复已完成的工作。",
        });
      }
    }
    await db.transaction(async (tx) => {
      const { build, turn } = await owned(tx, input);
      const metadata = record(turn.metadata);
      const pause = metadata.aiBillingPause;
      if (!pause || pause.resumeRequestId !== selection.requestId)
        throw new AiBillingError("AI_RESUME_PENDING");
      const next: Record<string, any> = {
        ...metadata,
        dispatchState: "recovering",
        failureClass: null,
        recoveryAction: null,
        canRegenerate: false,
        aiBillingResumed: true,
      };
      delete next.aiBillingPause;
      delete next.leaseOwnerHash;
      if (
        selection.pause.stage === "before_send" &&
        !selection.turn.upstreamTaskId
      ) {
        next.createAttemptState = "not_sent";
        next.providerAttemptState = "not_sent";
        delete next.dispatchingAt;
      } else {
        next.createAttemptState = "acknowledged";
        next.providerAttemptState = "output_pending";
      }
      const now = new Date();
      await tx
        .update(conversationTurns)
        .set({
          status: "queued",
          errorCode: null,
          errorMessage: null,
          completedAt: null,
          leaseExpiresAt: null,
          metadata: next,
          updatedAt: now,
        })
        .where(eq(conversationTurns.id, turn.id));
      await tx
        .update(knowledgeBaseBuilds)
        .set({
          status:
            selection.pause.previousBuildStatus === "confirming"
              ? "confirming"
              : "researching",
          protocolErrorCode: null,
          protocolError: null,
          awaitingResponseSince: now,
          stateEpoch: build.stateEpoch + 1,
          updatedAt: now,
        })
        .where(eq(knowledgeBaseBuilds.id, build.id));
      await tx
        .update(conversations)
        .set({
          status: "running",
          completedAt: null,
          updatedAt: now,
          version: sql`${conversations.version}+1`,
        })
        .where(
          and(
            eq(conversations.id, turn.conversationId),
            enterpriseOwnerPredicate(conversations, input.userId),
          ),
        );
    });
    return { turnId: selection.turn.id, credential, already: false };
  } finally {
    await db
      .transaction(async (tx) => {
        const { turn } = await owned(tx, input);
        const metadata = record(turn.metadata);
        if (metadata.aiBillingPause?.resumeRequestId === selection.requestId)
          await tx
            .update(conversationTurns)
            .set({
              metadata: {
                ...metadata,
                aiBillingPause: { ...metadata.aiBillingPause, leaseUntil: 0 },
              },
            })
            .where(eq(conversationTurns.id, turn.id));
      })
      .catch(() => undefined);
  }
}