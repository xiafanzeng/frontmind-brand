import type { DashboardAgentRuntimeStore, DashboardManagedRuntime, DashboardProviderIdentity, DashboardRuntimeRecord } from "@frontmind/module-contracts/managed-runtime";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { BrandKeywordPorts } from "./brand-keyword-ports.js";
type ZhipuRecord = Record<string, unknown>;
export interface KnowledgeNodeProviderApi {
 request(method:string,path:string,body?:unknown):Promise<ZhipuRecord>;
 create(path:string,body:ZhipuRecord):Promise<ZhipuRecord>;
 listAll(path:string,query?:Record<string,string>):Promise<ZhipuRecord[]>;
 sendMessage(sessionId:string,text:string):Promise<ZhipuRecord>;
}
export interface KnowledgeNodeProviderCore {
 getDb():Promise<MySql2Database<any>|null>;
 agentTasks:BrandKeywordPorts["agentTasks"];
 agentOperations:BrandKeywordPorts["agentOperations"];
 dashboardAgentRuntimeStore:DashboardAgentRuntimeStore;
 ZhipuManagedError:new(...args:any[])=>Error&{outcomeUnknown:boolean};
 zhipuResourceId(value:unknown):string;
 authorizeManagedAiCommand(input:{identity:DashboardProviderIdentity;localTaskId:string;operationId:string;sessionId:string;commandKey:string;model:string;effort:string}):Promise<void>;
 observeManagedAiUsage(input:{identity:DashboardProviderIdentity;localTaskId:string;operationId:string;sessionId:string;model:string;commands:DashboardManagedRuntime["commands"];events:ZhipuRecord[];session:ZhipuRecord}):Promise<{shouldInterrupt:boolean}>;
 rejectManagedAiCommand(input:{localTaskId:string;commandKey:string}):Promise<void>;
}
let getDb:KnowledgeNodeProviderCore["getDb"];
let agentTasks:KnowledgeNodeProviderCore["agentTasks"];
let agentOperations:KnowledgeNodeProviderCore["agentOperations"];
let dashboardAgentRuntimeStore:KnowledgeNodeProviderCore["dashboardAgentRuntimeStore"];
let ZhipuManagedError:KnowledgeNodeProviderCore["ZhipuManagedError"];
let zhipuResourceId:KnowledgeNodeProviderCore["zhipuResourceId"];
let authorizeManagedAiCommand:KnowledgeNodeProviderCore["authorizeManagedAiCommand"];
let observeManagedAiUsage:KnowledgeNodeProviderCore["observeManagedAiUsage"];
let rejectManagedAiCommand:KnowledgeNodeProviderCore["rejectManagedAiCommand"];
export function configureKnowledgeNodeProvider(core:KnowledgeNodeProviderCore){({getDb,agentTasks,agentOperations,dashboardAgentRuntimeStore,ZhipuManagedError,zhipuResourceId,authorizeManagedAiCommand,observeManagedAiUsage,rejectManagedAiCommand}=core);}
import {
  KNOWLEDGE_NODE_EDIT_MODEL,
  KNOWLEDGE_NODE_EDIT_SYSTEM,
  nodeEditSha256,
  parseKnowledgeNodeEditOutput,
} from "../contracts/knowledge-node-edit-contract.js";



import { and, desc, eq, isNull, or, sql } from "drizzle-orm";



/** Reuse only the empty editor resources from this credential version and
 * enterprise project. Sessions and commands themselves are always fresh. */
export async function findKnowledgeNodeEditorResources(
  identity: DashboardProviderIdentity,
) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const project = identity.enterpriseProjectId
    ? identity.enterpriseProjectLegacyDefault
      ? or(
          eq(agentOperations.enterpriseProjectId, identity.enterpriseProjectId),
          isNull(agentOperations.enterpriseProjectId),
        )!
      : eq(agentOperations.enterpriseProjectId, identity.enterpriseProjectId)
    : isNull(agentOperations.enterpriseProjectId);
  const rows = await db
    .select({ runtime: agentTasks.providerRuntime })
    .from(agentTasks)
    .innerJoin(agentOperations, eq(agentOperations.id, agentTasks.operationId))
    .where(
      and(
        eq(agentOperations.scope, "managed_user"),
        eq(agentOperations.provider, identity.provider),
        eq(agentOperations.accountUserId, identity.accountUserId),
        eq(agentOperations.apiCredentialId, identity.credentialId),
        eq(agentOperations.credentialVersion, identity.credentialVersion),
        project,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${agentTasks.providerRuntime}, '$.dashboardManaged.intentId')) LIKE 'knowledge-node-edit:%'`,
      ),
    )
    .orderBy(desc(agentTasks.createdAt))
    .limit(20);
  for (const row of rows) {
    const runtime = row.runtime?.dashboardManaged as
      | DashboardManagedRuntime
      | undefined;
    if (
      runtime?.revision === 1 &&
      !runtime.sharedDefinitions &&
      runtime.model === "glm-5.3" &&
      runtime.effort === "low" &&
      runtime.agentId &&
      runtime.environmentId &&
      !runtime.deleted
    )
      return { agentId: runtime.agentId, environmentId: runtime.environmentId };
  }
  return null;
}

function eventText(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter(
          (item) => item?.type === "text" && typeof item.text === "string",
        )
        .map((item) => item.text)
        .join("")
    : "";
}

/** Unknown outcomes remain bound to the original intent and Session. */
export function isKnowledgeNodeEditPending(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {message?:string;code?:string;outcomeUnknown?:boolean};
  return candidate.outcomeUnknown === true || /UNCERTAIN|TIMEOUT|PENDING/.test(`${candidate.code ?? ""} ${candidate.message ?? ""}`);
}
function pendingError(message: "KNOWLEDGE_NODE_EDIT_SEND_UNCERTAIN" | "KNOWLEDGE_NODE_EDIT_PENDING", cause?: unknown) {
  return Object.assign(new Error(message), { code: message, cause });
}

/** A fresh, text-only Low session. Every POST is journalled before send, and
 * uncertain mutations are never replayed or upgraded to another model. */
export class KnowledgeNodeEditProvider {
  private readonly api: KnowledgeNodeProviderApi;
  private readonly store: DashboardAgentRuntimeStore;
  constructor(
    private readonly options: {

      identity: DashboardProviderIdentity;
      store?: DashboardAgentRuntimeStore;
      api: KnowledgeNodeProviderApi;
      authorize?: typeof authorizeManagedAiCommand;
      observe?: typeof observeManagedAiUsage;
      reject?: typeof rejectManagedAiCommand;
      pollMs?: number;
      deadlineMs?: number;
      reusableResources?: { agentId: string; environmentId: string } | null;
      sharedDefinitions?: { agentId: string; environmentId: string };
    },
  ) {
    this.api = options.api;
    this.store = options.store ?? dashboardAgentRuntimeStore;
  }
  private async read<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      const failure = error as { status?: number | null; outcomeUnknown?: boolean; code?: string };
      if (isKnowledgeNodeEditPending(error) || failure?.status === null ||
        [408, 425, 429].includes(failure?.status ?? 0) || (failure?.status ?? 0) >= 500 ||
        /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|NETWORK|FETCH_FAILED/.test(failure?.code ?? ""))
        throw pendingError("KNOWLEDGE_NODE_EDIT_PENDING", error);
      throw error;
    }
  }
  private async once(
    record: DashboardRuntimeRecord,
    key: string,
    body: unknown,
    action: () => Promise<string>,
    bind?: (
      runtime: DashboardManagedRuntime,
      id: string,
    ) => DashboardManagedRuntime,
  ) {
    const requestHash = nodeEditSha256(JSON.stringify(body));
    let permission = false;
    record = await this.store.mutate(
      this.options.identity,
      record.localTaskId,
      (runtime) => {
        const old = runtime.mutations[key];
        if (old) {
          if (old.requestHash !== requestHash)
            throw new Error("KNOWLEDGE_NODE_EDIT_REQUEST_CONFLICT");
          return runtime;
        }
        permission = true;
        return {
          ...runtime,
          mutations: {
            ...runtime.mutations,
            [key]: {
              requestHash,
              state: "sending",
              startedAt: new Date().toISOString(),
            },
          },
        };
      },
    );
    const old = record.runtime.mutations[key]!;
    if (old.state === "acknowledged" && old.resourceId) return old.resourceId;
    if (old.state === "rejected") throw new Error("KNOWLEDGE_NODE_EDIT_REQUEST_REJECTED");
    if (!permission) throw pendingError("KNOWLEDGE_NODE_EDIT_SEND_UNCERTAIN");
    try {
      const resourceId = await action();
      await this.store.mutate(
        this.options.identity,
        record.localTaskId,
        (runtime) => {
          const next = {
            ...runtime,
            mutations: {
              ...runtime.mutations,
              [key]: {
                ...runtime.mutations[key]!,
                state: "acknowledged" as const,
                resourceId,
              },
            },
          };
          return bind ? bind(next, resourceId) : next;
        },
      );
      return resourceId;
    } catch (error) {
      const rejected =
        error instanceof ZhipuManagedError && !error.outcomeUnknown;
      await this.store.mutate(
        this.options.identity,
        record.localTaskId,
        (runtime) => ({
          ...runtime,
          mutations: {
            ...runtime.mutations,
            [key]: {
              ...runtime.mutations[key]!,
              state: rejected ? "rejected" : "outcome_unknown",
            },
          },
        }),
      ).catch(persistenceError => {
        // The pre-send journal still fences this request when storing its
        // acknowledgement fails. Preserve that uncertainty for recovery.
        if (!rejected) throw pendingError("KNOWLEDGE_NODE_EDIT_SEND_UNCERTAIN", persistenceError);
        throw error;
      });
      if (!rejected) throw pendingError("KNOWLEDGE_NODE_EDIT_SEND_UNCERTAIN", error);
      throw error;
    }
  }
  async edit(input: {
    intentId: string;
    prompt: string;
    onSession: (sessionId: string) => Promise<void>;
    context?: NonNullable<DashboardManagedRuntime["editorContext"]>;
  }) {
    const model = this.options.identity.provider === "kimi" ? { id: "kimi-k3.1-pro", effort: "low" } : KNOWLEDGE_NODE_EDIT_MODEL;
    const record = await this.store.reserve({
      identity: this.options.identity,
      intentId: input.intentId,
      model: model.id,
      effort: "low",
    });
    // Freeze purpose and parent attribution alongside the same mutation journal.
    // An existing Session cannot acquire a different billing/business identity.
    if (input.context) record.runtime = (await this.store.mutate(this.options.identity, record.localTaskId, runtime => {
      if (runtime.editorContext && (["purpose","parentTurnId","nodeId","policyHash"] as const).some(key => runtime.editorContext![key] !== input.context![key]))
        throw new Error("KNOWLEDGE_NODE_EDIT_CONTEXT_CONFLICT");
      return runtime.editorContext ? runtime : {...runtime, editorContext: input.context};
    })).runtime;
    const context = record.runtime.editorContext;
    const agentBody = {
      name: `FrontMind node editor ${record.operationId}`,
      model,
      system: KNOWLEDGE_NODE_EDIT_SYSTEM,
      tools: [],
      skills: [],
      mcp_servers: [],
    };
    const reusable = this.options.sharedDefinitions ?? this.options.reusableResources;
    if (
      reusable &&
      !record.runtime.agentId &&
      !record.runtime.environmentId &&
      !record.runtime.mutations.agent &&
      !record.runtime.mutations.environment
    ) {
      record.runtime = (
        await this.store.mutate(
          this.options.identity,
          record.localTaskId,
          (runtime) => runtime.agentId || runtime.environmentId || runtime.mutations.agent || runtime.mutations.environment ? runtime : ({
            ...runtime,
            agentId: reusable.agentId,
            environmentId: reusable.environmentId,
            ...(this.options.sharedDefinitions ? { sharedDefinitions: true as const } : {}),
          }),
        )
      ).runtime;
    }
    const agentId =
      record.runtime.agentId ??
      (await this.once(
        record,
        "agent",
        agentBody,
        async () =>
          zhipuResourceId(await this.api.create("/v1/agents", agentBody)),
        (runtime, id) => ({ ...runtime, agentId: id }),
      ));
    const environmentBody = {
      name: `FrontMind node editor ${record.operationId}`,
      config: {
        type: "cloud",
        networking: {
          type: "limited",
          allowed_hosts: [],
          allow_package_managers: false,
          allow_mcp_servers: false,
        },
      },
    };
    const environmentId =
      record.runtime.environmentId ??
      (await this.once(
        record,
        "environment",
        environmentBody,
        async () =>
          zhipuResourceId(
            await this.api.create("/v1/environments", environmentBody),
          ),
        (runtime, id) => ({ ...runtime, environmentId: id }),
      ));
    const sessionBody = {
      agent: record.runtime.sharedDefinitions ? {
        type: "agent_with_overrides", id: agentId, model: agentBody.model, system: agentBody.system,
        tools: [], skills: [], mcp_servers: [],
      } : { type: "agent", id: agentId, version: 1 },
      environment_id: environmentId,
      title: context?.purpose === "node_prose" ? "知识节点文字整理" : context?.purpose === "progress_translation" ? "公开进展中文整理" : "知识节点文字修改",
      metadata: {
        frontmind_operation: record.operationId,
        frontmind_node_edit: "low_v1",
      },
      resources: [],
    };
    const sessionId = await this.once(
      record,
      "session",
      sessionBody,
      async () =>
        zhipuResourceId(await this.api.create("/v1/sessions", sessionBody)),
      (runtime, id) => ({ ...runtime, sessionId: id }),
    );
    await input.onSession(sessionId);
    const commandKey = "node-edit";
    const promptHash = nodeEditSha256(input.prompt);
    let current = await this.store.mutate(
      this.options.identity,
      record.localTaskId,
      (runtime) => {
        const old = runtime.commands.find(
          (command) => command.key === commandKey,
        );
        if (old) {
          if (old.providerPromptHash !== promptHash)
            throw new Error("KNOWLEDGE_NODE_EDIT_REQUEST_CONFLICT");
          return runtime;
        }
        return {
          ...runtime,
          commands: [
            ...runtime.commands,
            {
              key: commandKey,
              intentId: input.intentId,
              prompt: input.prompt,
              providerPromptHash: promptHash,
              attachments: [],
              beforeEventIds: [],
              beforeFileIds: [],
              createdAt: new Date().toISOString(),
            },
          ],
        };
      },
    );
    if (!current.runtime.commands[0]!.eventId) {
      // A lost send acknowledgement is reconciled by its exact text hash.
      const events = await this.read(() => this.api.listAll(
        `/v1/sessions/${sessionId}/events`,
        { order: "asc" },
      ));
      const matches = events.filter(
        (event) =>
          event.type === "user.message" &&
          nodeEditSha256(eventText(event.content)) === promptHash,
      );
      if (matches.length > 1)
        throw new Error("KNOWLEDGE_NODE_EDIT_COMMAND_AMBIGUOUS");
      let eventId = matches[0] ? zhipuResourceId(matches[0]) : undefined;
      if (!eventId) {
        // Refused funding proves the model command was never sent. Keep it
        // outside the transport fence so it cannot become an unknown send.
        if (!current.runtime.mutations.send)
          await (this.options.authorize ?? authorizeManagedAiCommand)({
            identity: this.options.identity,
            localTaskId: record.localTaskId,
            operationId: record.operationId,
            sessionId,
            commandKey,
            model: model.id,
            effort: "low",
          });
        try {
          eventId = await this.once(
            record,
            "send",
            { sessionId, promptHash },
            async () => {
              try {
                const response = await this.api.sendMessage(
                  sessionId,
                  input.prompt,
                );
                return zhipuResourceId((response.data as unknown[])[0]);
              } catch (error) {
                if (error instanceof ZhipuManagedError && !error.outcomeUnknown)
                  await (this.options.reject ?? rejectManagedAiCommand)({
                    localTaskId: record.localTaskId,
                    commandKey,
                  });
                throw error;
              }
            },
          );
        } catch (error) {
          // Reconciliation below may still see an acknowledged event after a
          // transport failure. It never sends the command a second time.
          if (
            !isKnowledgeNodeEditPending(error)
          )
            throw error;
        }
      }
      if (eventId)
        current = await this.store.mutate(
          this.options.identity,
          record.localTaskId,
          (runtime) => ({
            ...runtime,
            commands: runtime.commands.map((command) => ({
              ...command,
              eventId,
            })),
          }),
        );
    }
    const deadline = Date.now() + (this.options.deadlineMs ?? 10 * 60_000);
    do {
      const [session, events] = await this.read(() => Promise.all([
        this.api.request("GET", `/v1/sessions/${sessionId}`),
        this.api.listAll(`/v1/sessions/${sessionId}/events`, { order: "asc" }),
      ]));
      const accepted = events.filter(
        (event) =>
          event.type === "user.message" &&
          nodeEditSha256(eventText(event.content)) === promptHash,
      );
      if (accepted.length > 1)
        throw new Error("KNOWLEDGE_NODE_EDIT_COMMAND_AMBIGUOUS");
      if (accepted[0] && !current.runtime.commands[0]!.eventId) {
        const eventId = zhipuResourceId(accepted[0]);
        current = await this.store.mutate(
          this.options.identity,
          record.localTaskId,
          (runtime) => ({
            ...runtime,
            commands: runtime.commands.map((command) => ({
              ...command,
              eventId,
            })),
          }),
        );
      }
      const usage = await (this.options.observe ?? observeManagedAiUsage)({
        identity: this.options.identity,
        localTaskId: record.localTaskId,
        operationId: record.operationId,
        sessionId,
        model: model.id,
        commands: current.runtime.commands,
        events,
        session,
      });
      if (usage.shouldInterrupt) {
        await this.once(record, "interrupt", { sessionId }, async () => {
          await this.api.request("POST", `/v1/sessions/${sessionId}/events`, {
            events: [{ type: "user.interrupt" }],
          });
          return sessionId;
        });
        throw new Error("KNOWLEDGE_NODE_EDIT_BALANCE_EXHAUSTED");
      }
      if (
        events.some(
          (event) =>
            event.type === "agent.tool_use" ||
            event.type === "agent.mcp_tool_use",
        )
      )
        throw new Error("KNOWLEDGE_NODE_EDIT_TOOLS_FORBIDDEN");
      const sentAt = events.findIndex(
        (event) =>
          event.type === "user.message" &&
          nodeEditSha256(eventText(event.content)) === promptHash,
      );
      const output =
        sentAt >= 0
          ? events
              .slice(sentAt + 1)
              .filter((event) => event.type === "agent.message")
          : [];
      if (this.options.identity.provider !== "kimi" && events.some((event) => event.type === "session.error"))
        throw new Error("KNOWLEDGE_NODE_EDIT_PROVIDER_FAILED");
      if (this.options.identity.provider === "kimi" && session.status === "idle") {
        const lifecycle = sentAt < 0 ? undefined : [...events.slice(sentAt + 1)].reverse()
          .find(event => String(event.type).startsWith("session.status_"));
        const reason = lifecycle?.stop_reason as {type?:string} | undefined;
        if (lifecycle?.type !== "session.status_idle" || !reason?.type)
          throw pendingError("KNOWLEDGE_NODE_EDIT_PENDING");
        if (["interrupted", "user_interrupt", "canceled", "cancelled"].includes(reason.type))
          throw new Error("KNOWLEDGE_NODE_EDIT_TERMINATED");
        if (reason.type === "requires_action")
          throw new Error("KNOWLEDGE_NODE_EDIT_TOOLS_FORBIDDEN");
        if (["error", "failed", "provider_error"].includes(reason.type))
          throw new Error("KNOWLEDGE_NODE_EDIT_PROVIDER_FAILED");
        if (["max_tokens", "max_output_tokens", "token_limit", "length"].includes(reason.type))
          throw new Error("KNOWLEDGE_NODE_EDIT_OUTPUT_INVALID");
        if (reason.type !== "end_turn")
          throw pendingError("KNOWLEDGE_NODE_EDIT_PENDING");
      }
      if (session.status === "idle" && output.length) {
        if (output.length !== 1)
          throw new Error("KNOWLEDGE_NODE_EDIT_OUTPUT_INVALID");
        let contentMarkdown: string;
        try { contentMarkdown = parseKnowledgeNodeEditOutput(eventText(output[0]!.content)); }
        catch (cause) { throw Object.assign(new Error("KNOWLEDGE_NODE_EDIT_OUTPUT_INVALID"), {cause}); }
        return {
          sessionId,
          contentMarkdown,
        };
      }
      if (session.status === "terminated")
        throw new Error("KNOWLEDGE_NODE_EDIT_TERMINATED");
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.pollMs ?? 2_000),
      );
    } while (Date.now() < deadline);
    // A polling budget is not a provider failure. Leave the Session running;
    // the lease holder can resume this exact intent without another send.
    throw pendingError("KNOWLEDGE_NODE_EDIT_PENDING");
  }
}
