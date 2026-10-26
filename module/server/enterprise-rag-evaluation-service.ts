import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Request } from "express";
import JSZip from "jszip";
import { z } from "zod";
import {
  ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION,
  ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE,
  ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA,
  ENTERPRISE_RAG_JUDGE_VERSION,
  type EnterpriseRagEvaluationFrozenInput,
  type EnterpriseRagEvaluationReport,
  type EnterpriseRagEvaluationRunDto,
  validateEnterpriseRagJudgeOutput,
} from "../contracts/enterprise-rag-evaluation-run.js";
import { parseEnterpriseQaAnswerMeta } from "../contracts/enterprise-qa-answer.js";
import {
  ENTERPRISE_RAG_EVALUATION_SKILL_ID,
  ENTERPRISE_RAG_EVALUATION_SKILL_VERSION,
  enterpriseRagEvaluationSkill,
} from "../client/dashboard/ai-website-preview/enterprise-rag-evaluation-skill.js";
import { runEvaluationSkill } from "../client/dashboard/ai-website-preview/evaluation-skill-contract.js";
import { RAG_RULE_VERSION } from "../client/dashboard/ai-website-preview/rag-evaluation.js";
import { enterpriseQaDocumentCatalog } from "./enterprise-qa-answer.js";
import type { ModuleHttpCore } from "./http-api.js";
import { intentHash, intentSkillPorts } from "./intent-skill-runtime.js";

const SOURCE_QA_CONTRACT = "dashboard.general-chat";
const SOURCE_QA_CONTRACT_REVISION = 2;
const RUNTIME_KEY = "enterpriseRagEvaluation";
const RESULT_EVENT_TYPE = "enterprise_rag_evaluation_report";
const MAX_EXECUTION_MS = 30 * 60_000;
const LEASE_MS = 120_000;
const RESULT_SYNC_GRACE_MS = 120_000;

const startSchema = z.object({
  clientRequestId: z.string().uuid(),
  sourceQaTaskId: z.string().uuid(),
  turnId: z.string().uuid(),
}).strict();

const latestSchema = z.object({
  sourceQaTaskId: z.string().uuid(),
  turnId: z.string().uuid(),
}).strict();

type RunPhase = EnterpriseRagEvaluationRunDto["status"];
type RuntimeError = { code: string; message: string };
type RuntimeState = {
  schemaVersion: 1;
  sourceQaTaskId: string;
  sourceTurnId: string;
  input: EnterpriseRagEvaluationFrozenInput;
  skill: string;
  skillHash: string;
  credentialId: string;
  credentialVersion: number;
  upstreamEffort: string | null;
  phase: RunPhase;
  createdAt: string;
  lease?: { owner: string; expiresAt: number };
  createClaimedAt?: number;
  terminalObservedAt?: number;
  repair?: {
    intentId: string;
    claimedAt: number;
    sentAt?: number;
    reason: string;
    baselineEventIds: string[];
  };
  error?: RuntimeError;
};

type OwnedOperation = { operation: any; task: any };

export class EnterpriseRagEvaluationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "EnterpriseRagEvaluationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function resultRows(result: any): any[] {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function iso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function providerTimestampMs(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) return Date.now();
  return timestamp < 1_000_000_000_000 ? Math.round(timestamp * 1_000) : Math.round(timestamp);
}

function evaluatorInputHash(input: EnterpriseRagEvaluationFrozenInput) {
  const { operationToken: _operationToken, inputHash: _inputHash, ...frozen } = input;
  return intentHash(frozen);
}

function runtimeFromTask(task: any): RuntimeState {
  const container = jsonRecord(task?.providerRuntime);
  const value = container?.[RUNTIME_KEY];
  if (!isRecord(value)) {
    throw new EnterpriseRagEvaluationError(
      "EVALUATION_CONTEXT_INVALID",
      "评估任务上下文不完整，请重新发起评估。",
    );
  }
  const input = value.input as EnterpriseRagEvaluationFrozenInput | undefined;
  const phase = value.phase;
  if (
    value.schemaVersion !== 1 ||
    typeof value.sourceQaTaskId !== "string" ||
    typeof value.sourceTurnId !== "string" ||
    !input ||
    input.schemaVersion !== 1 ||
    input.sourceQaTaskId !== value.sourceQaTaskId ||
    input.sourceTurnId !== value.sourceTurnId ||
    typeof input.operationToken !== "string" ||
    typeof input.inputHash !== "string" ||
    evaluatorInputHash(input) !== input.inputHash ||
    typeof value.skill !== "string" ||
    typeof value.skillHash !== "string" ||
    intentHash(value.skill) !== value.skillHash ||
    typeof value.credentialId !== "string" ||
    !Number.isSafeInteger(value.credentialVersion) ||
    (value.upstreamEffort !== null && typeof value.upstreamEffort !== "string") ||
    ![
      "queued",
      "uploading",
      "create_unknown",
      "running",
      "result_pending",
      "completed",
      "failed",
    ].includes(String(phase)) ||
    typeof value.createdAt !== "string"
  ) {
    throw new EnterpriseRagEvaluationError(
      "EVALUATION_CONTEXT_INVALID",
      "评估任务快照校验失败，请重新发起评估。",
    );
  }
  return structuredClone(value) as RuntimeState;
}

function runtimeContainer(task: any, runtime: RuntimeState) {
  return {
    ...(jsonRecord(task?.providerRuntime) ?? {}),
    [RUNTIME_KEY]: runtime,
  };
}

function reportFromPayload(
  payload: unknown,
  runtime: RuntimeState,
): EnterpriseRagEvaluationReport | null {
  const record = jsonRecord(payload);
  const report = record?.kind === RESULT_EVENT_TYPE ? record.report : null;
  if (
    !isRecord(report) ||
    typeof report.reportId !== "string" ||
    report.sourceQaTaskId !== runtime.sourceQaTaskId ||
    report.sourceTurnId !== runtime.sourceTurnId ||
    report.conversationId !== runtime.input.conversationId ||
    !isRecord(report.result) ||
    !isRecord(report.judgments)
  ) return null;
  return structuredClone(report) as EnterpriseRagEvaluationReport;
}

export function createEnterpriseRagEvaluationService(
  core: ModuleHttpCore,
  request: Request,
) {
  const context = core.context(request);
  const model = intentSkillPorts();
  const actor = (request as Request & {
    frontmindUser?: { id: number; role: string };
  }).frontmindUser;

  function assertActor() {
    if (!actor || actor.id !== context.actorUserId) {
      throw new EnterpriseRagEvaluationError(
        "ACTOR_INVALID",
        "当前账号无权操作此企业工作区。",
        403,
      );
    }
    model.assertActorAllowed(actor);
  }

  async function database() {
    return core.database();
  }

  const projectCondition = (column: any) =>
    sql`${column} <=> ${context.enterpriseProjectId}`;

  async function findOwnedOperation(
    operationId: string,
    executor?: any,
  ): Promise<OwnedOperation | undefined> {
    const db = executor ?? await database();
    return (await db
      .select({ operation: model.agentOperations, task: model.agentTasks })
      .from(model.agentOperations)
      .innerJoin(
        model.agentTasks,
        eq(model.agentTasks.operationId, model.agentOperations.id),
      )
      .where(and(
        eq(model.agentOperations.id, operationId),
        eq(model.agentOperations.scope, "managed_user"),
        eq(model.agentOperations.accountUserId, context.accountUserId),
        projectCondition(model.agentOperations.enterpriseProjectId),
        eq(model.agentOperations.operationType, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractName, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractRevision, ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION),
      ))
      .limit(1))[0] as OwnedOperation | undefined;
  }

  async function readReport(owned: OwnedOperation, runtime: RuntimeState) {
    const db = await database();
    const row = (await db
      .select({ id: model.agentEvents.id, payload: model.agentEvents.normalizedPayload })
      .from(model.agentEvents)
      .where(and(
        eq(model.agentEvents.taskId, owned.task.id),
        eq(model.agentEvents.eventType, RESULT_EVENT_TYPE),
      ))
      .orderBy(desc(model.agentEvents.providerTimestampMs), desc(model.agentEvents.id))
      .limit(1))[0];
    const report = reportFromPayload(row?.payload, runtime);
    if (!report || report.reportId !== row?.id) return null;
    try {
      const judgments = validateEnterpriseRagJudgeOutput(report.judgments, runtime.input);
      const expectedResult = await runEvaluationSkill(enterpriseRagEvaluationSkill, {
        dimensions: judgments.dimensions.map((item) => ({
          id: item.id,
          level: item.level as 0 | 1 | 2 | 3 | 4,
          rationale: item.rationale,
          evidenceIds: item.evidenceIds,
          applicable: true,
        })),
        gates: judgments.gates.map((item) => ({
          id: item.id,
          status: item.status,
          reason: item.reason,
        })),
        relatedReportIds: [],
      });
      const expectedEvaluator = {
        ...runtime.input.evaluator,
        provider: String(owned.operation.provider),
        model: String(owned.operation.upstreamModel),
        effort: runtime.upstreamEffort,
        skillHash: runtime.skillHash,
        outputHash: intentHash(judgments),
      };
      if (
        report.questionMessageId !== runtime.input.questionMessageId ||
        report.answerMessageId !== runtime.input.answerMessageId ||
        report.questionHash !== sha256(runtime.input.question) ||
        report.answerHash !== sha256(runtime.input.answer) ||
        intentHash(report.knowledgeBase) !== intentHash(runtime.input.knowledgeBase) ||
        intentHash(report.evaluator) !== intentHash(expectedEvaluator) ||
        intentHash(report.result) !== intentHash(expectedResult) ||
        !Number.isFinite(Date.parse(report.createdAt)) ||
        !Number.isFinite(Date.parse(report.completedAt))
      ) return null;
      return report;
    } catch {
      return null;
    }
  }

  async function dto(owned: OwnedOperation): Promise<EnterpriseRagEvaluationRunDto> {
    const runtime = runtimeFromTask(owned.task);
    const report = runtime.phase === "completed"
      ? await readReport(owned, runtime)
      : null;
    if (runtime.phase === "completed" && !report) {
      throw new EnterpriseRagEvaluationError(
        "EVALUATION_REPORT_MISSING",
        "评估任务已完成，但不可变报告不存在，请联系维护人员。",
        503,
      );
    }
    return {
      operationId: owned.operation.id,
      sourceQaTaskId: runtime.sourceQaTaskId,
      turnId: runtime.sourceTurnId,
      status: runtime.phase,
      createdAt: iso(owned.operation.createdAt ?? runtime.createdAt),
      updatedAt: iso(owned.operation.updatedAt ?? runtime.createdAt),
      report,
      error: runtime.error ?? null,
    };
  }

  async function resolveFrozenInput(
    sourceQaTaskId: string,
    sourceTurnId: string,
    operationToken: string,
  ): Promise<EnterpriseRagEvaluationFrozenInput> {
    const db = await database();
    const source = (await db
      .select({ operation: model.agentOperations, task: model.agentTasks })
      .from(model.agentTasks)
      .innerJoin(
        model.agentOperations,
        eq(model.agentOperations.id, model.agentTasks.operationId),
      )
      .where(and(
        eq(model.agentTasks.id, sourceQaTaskId),
        eq(model.agentOperations.scope, "managed_user"),
        eq(model.agentOperations.accountUserId, context.accountUserId),
        projectCondition(model.agentOperations.enterpriseProjectId),
        eq(model.agentOperations.operationType, SOURCE_QA_CONTRACT),
        eq(model.agentOperations.contractName, SOURCE_QA_CONTRACT),
        eq(model.agentOperations.contractRevision, SOURCE_QA_CONTRACT_REVISION),
        eq(model.agentOperations.status, "succeeded"),
      ))
      .limit(1))[0] as OwnedOperation | undefined;
    // The core normalizes successful general chat in agent_operations while
    // preserving the provider's raw terminal spelling (for example stopped).
    // The exact completed turn and server-owned final answer are validated
    // below, so never reject a valid source by coupling to that raw spelling.
    if (!source) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_NOT_FOUND",
        "找不到可评估的已完成企业问答。",
        404,
      );
    }

    const purpose = jsonRecord(source.task.providerRuntime)?.generalPurpose;
    if (!isRecord(purpose)) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答缺少冻结知识上下文，不能生成可信评估。",
      );
    }
    const knowledgeBase = isRecord(purpose.knowledgeBase)
      ? purpose.knowledgeBase
      : null;
    const knowledgeText = purpose.knowledgeText;
    if (
      purpose.revision !== 1 ||
      purpose.purpose !== "enterprise_qa" ||
      purpose.answerContractVersion !== 1 ||
      purpose.accountUserId !== context.accountUserId ||
      (purpose.enterpriseProjectId ?? null) !== context.enterpriseProjectId ||
      !knowledgeBase ||
      typeof knowledgeText !== "string" ||
      typeof knowledgeBase.snapshotId !== "string" ||
      !Number.isSafeInteger(knowledgeBase.version) ||
      Number(knowledgeBase.version) < 1 ||
      typeof knowledgeBase.sourceFileName !== "string" ||
      !knowledgeBase.sourceFileName.trim() ||
      !Number.isSafeInteger(knowledgeBase.documentCount) ||
      typeof knowledgeBase.contentHash !== "string" ||
      sha256(knowledgeText) !== knowledgeBase.contentHash
    ) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答冻结知识校验失败，不能生成可信评估。",
      );
    }

    let catalog: ReturnType<typeof enterpriseQaDocumentCatalog>;
    try {
      catalog = enterpriseQaDocumentCatalog(purpose as any);
    } catch {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答冻结知识无法读取，不能生成可信评估。",
      );
    }
    if (catalog.length !== Number(knowledgeBase.documentCount)) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答冻结知识文档数量不一致，不能生成可信评估。",
      );
    }

    const turnRows = resultRows(await db.execute(sql`
      SELECT id, conversationId, upstreamTaskId, operationType, status
      FROM conversation_turns
      WHERE id = ${sourceTurnId}
        AND upstreamTaskId = ${sourceQaTaskId}
        AND userId = ${context.accountUserId}
        AND enterpriseProjectId <=> ${context.enterpriseProjectId}
        AND operationType = 'general_chat_v2'
        AND status = 'completed'
      LIMIT 2
    `));
    if (turnRows.length !== 1) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_TURN_NOT_FOUND",
        "找不到与该问答任务绑定的已完成对话轮次。",
        404,
      );
    }
    const turn = turnRows[0];
    const messageRows = resultRows(await db.execute(sql`
      SELECT id, conversationId, turnId, role, content, sequence, metadata
      FROM messages
      WHERE turnId = ${sourceTurnId}
        AND userId = ${context.accountUserId}
        AND deletedAt IS NULL
      ORDER BY sequence ASC, id ASC
    `));
    const users = messageRows.filter((row) => row.role === "user");
    const assistants = messageRows.filter((row) => {
      if (row.role !== "assistant") return false;
      const generalChat = jsonRecord(row.metadata)?.generalChat;
      return isRecord(generalChat) &&
        generalChat.schemaVersion === 1 &&
        generalChat.kind === "assistant_projection" &&
        generalChat.serverOwned === true &&
        generalChat.isFinalAnswer === true &&
        generalChat.turnId === sourceTurnId &&
        generalChat.agentTaskId === sourceQaTaskId;
    });
    if (users.length !== 1 || assistants.length !== 1) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_MESSAGES_INVALID",
        "该轮企业问答没有唯一的用户问题和最终回答。",
      );
    }
    const questionMessage = users[0];
    const answerMessage = assistants[0];
    if (
      questionMessage.conversationId !== turn.conversationId ||
      answerMessage.conversationId !== turn.conversationId ||
      questionMessage.turnId !== sourceTurnId ||
      answerMessage.turnId !== sourceTurnId ||
      typeof questionMessage.content !== "string" ||
      !questionMessage.content.trim() ||
      typeof answerMessage.content !== "string" ||
      !answerMessage.content.trim()
    ) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_MESSAGES_INVALID",
        "该轮企业问答的消息绑定不完整。",
      );
    }
    const generalChat = jsonRecord(answerMessage.metadata)?.generalChat as
      | Record<string, unknown>
      | undefined;
    const conversationPrefix = String(turn.conversationId).includes(":")
      ? String(turn.conversationId).slice(0, String(turn.conversationId).indexOf(":") + 1)
      : "";
    const publicQuestionMessageId = conversationPrefix &&
      String(questionMessage.id).startsWith(conversationPrefix)
      ? String(questionMessage.id).slice(conversationPrefix.length)
      : String(questionMessage.id);
    if (
      (typeof generalChat?.userMessageId === "string" &&
        generalChat.userMessageId !== questionMessage.id &&
        generalChat.userMessageId !== publicQuestionMessageId) ||
      (Number.isSafeInteger(generalChat?.userSequence) &&
        Number(generalChat?.userSequence) !== Number(questionMessage.sequence))
    ) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_MESSAGES_INVALID",
        "该轮企业问答的最终回答未绑定到指定问题。",
      );
    }

    const answerMeta = parseEnterpriseQaAnswerMeta(
      jsonRecord(answerMessage.metadata)?.enterpriseQaAnswer,
    );
    if (!answerMeta) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_ANSWER_META_INVALID",
        "该企业回答缺少可核验的结构化来源。",
      );
    }
    const catalogById = new Map(catalog.map((document) => [document.documentId, document]));
    const rawInputFiles = purpose.inputFiles ?? [];
    if (!Array.isArray(rawInputFiles)) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答冻结附件清单无法读取，不能生成可信评估。",
      );
    }
    const inputFiles = rawInputFiles.map((value) => {
      const file = isRecord(value) ? value : null;
      if (
        !file ||
        typeof file.localAssetId !== "string" ||
        !file.localAssetId ||
        typeof file.filename !== "string" ||
        !file.filename
      ) {
        throw new EnterpriseRagEvaluationError(
          "SOURCE_QA_CONTEXT_INVALID",
          "企业问答冻结附件清单无法读取，不能生成可信评估。",
        );
      }
      return { localAssetId: file.localAssetId, filename: file.filename };
    });
    const filesById = new Map(inputFiles.map((file) =>
      [file.localAssetId, file.filename] as const));
    if (filesById.size !== inputFiles.length || catalogById.size !== catalog.length) {
      throw new EnterpriseRagEvaluationError(
        "SOURCE_QA_CONTEXT_INVALID",
        "企业问答冻结来源标识重复，不能生成可信评估。",
      );
    }
    const citedSourceIds = new Set<string>();
    const seenAnswerSources = new Set<string>();
    for (const sourceRef of answerMeta.sources) {
      const sourceKey = `${sourceRef.kind}:${sourceRef.id}`;
      if (seenAnswerSources.has(sourceKey)) {
        throw new EnterpriseRagEvaluationError(
          "SOURCE_ANSWER_META_INVALID",
          "该企业回答包含重复来源，不能生成可信评估。",
        );
      }
      seenAnswerSources.add(sourceKey);
      if (sourceRef.kind === "published_knowledge") {
        const document = catalogById.get(sourceRef.id);
        if (!document || document.title !== sourceRef.title) {
          throw new EnterpriseRagEvaluationError(
            "SOURCE_ANSWER_META_INVALID",
            "该企业回答引用的冻结知识来源无法核验。",
          );
        }
      } else if (filesById.get(sourceRef.id) !== sourceRef.title) {
        throw new EnterpriseRagEvaluationError(
          "SOURCE_ANSWER_META_INVALID",
          "该企业回答引用的用户附件无法核验。",
        );
      }
      citedSourceIds.add(sourceRef.id);
    }
    const allSourceIds = new Set<string>();
    const sources = [
      ...catalog.map((document) => ({
        id: document.documentId,
        title: document.title,
        kind: "published_knowledge" as const,
        citedByAnswer: citedSourceIds.has(document.documentId),
        content: document.content,
      })),
      ...inputFiles.map((file) => ({
        id: file.localAssetId,
        title: file.filename,
        kind: "user_attachment" as const,
        citedByAnswer: citedSourceIds.has(file.localAssetId),
        // The source task records authorization and filename, not a durable
        // frozen attachment body. Never imply that its claims were verified.
        content: null,
      })),
    ];
    for (const sourceItem of sources) {
      if (allSourceIds.has(sourceItem.id)) {
        throw new EnterpriseRagEvaluationError(
          "SOURCE_QA_CONTEXT_INVALID",
          "企业问答冻结来源标识冲突，不能生成可信评估。",
        );
      }
      allSourceIds.add(sourceItem.id);
    }

    const base = {
      schemaVersion: 1 as const,
      sourceQaTaskId,
      sourceTurnId,
      conversationId: String(turn.conversationId),
      questionMessageId: String(questionMessage.id),
      answerMessageId: String(answerMessage.id),
      question: questionMessage.content,
      answer: answerMessage.content,
      sources,
      allowedEvidenceIds: [
        `question:${questionMessage.id}`,
        `answer:${answerMessage.id}`,
        ...sources.map((sourceRef) => sourceRef.id),
      ],
      knowledgeBase: {
        snapshotId: String(knowledgeBase.snapshotId),
        version: Number(knowledgeBase.version),
        sourceFileName: String(knowledgeBase.sourceFileName),
        documentCount: Number(knowledgeBase.documentCount),
        contentHash: String(knowledgeBase.contentHash),
      },
      evaluator: {
        skillId: ENTERPRISE_RAG_EVALUATION_SKILL_ID as "enterprise-rag-evaluation",
        skillVersion: ENTERPRISE_RAG_EVALUATION_SKILL_VERSION,
        ruleVersion: RAG_RULE_VERSION,
        judgeVersion: ENTERPRISE_RAG_JUDGE_VERSION as "1.0.0",
      },
    };
    const inputHash = intentHash(base);
    return { ...base, operationToken, inputHash };
  }

  async function prepare() {
    await model.assertServiceCapability(context.accountUserId, "globalKeywords");
    const [status, credential] = await Promise.all([
      model.getApiCredentialStatus(context.accountUserId),
      model.getDecryptedCredentialForUser(context.accountUserId),
    ]);
    if (
      !credential ||
      status.status !== "active" ||
      !status.verifiedAt ||
      credential.status !== "active" ||
      !credential.verifiedAt ||
      credential.version !== status.version
    ) {
      throw new EnterpriseRagEvaluationError(
        "MODEL_UNAVAILABLE",
        "请先配置并验证当前账户的模型 API。",
        503,
      );
    }
    const skill = await readFile(
      new URL("../workflows/evaluate-enterprise-rag/SKILL.md", import.meta.url),
      "utf8",
    );
    return { credential, skill, skillHash: intentHash(skill) };
  }

  async function mutateRuntime<T>(
    taskId: string,
    mutate: (runtime: RuntimeState, task: any, tx: any) => Promise<T> | T,
  ) {
    const db = await database();
    return db.transaction(async (tx: any) => {
      let query = tx
        .select()
        .from(model.agentTasks)
        .where(eq(model.agentTasks.id, taskId))
        .limit(1);
      if (typeof query.for === "function") query = query.for("update");
      const task = (await query)[0];
      if (!task) {
        throw new EnterpriseRagEvaluationError(
          "EVALUATION_NOT_FOUND",
          "评估任务不存在。",
          404,
        );
      }
      const runtime = runtimeFromTask(task);
      const result = await mutate(runtime, task, tx);
      await tx
        .update(model.agentTasks)
        .set({ providerRuntime: runtimeContainer(task, runtime), updatedAt: new Date() })
        .where(eq(model.agentTasks.id, taskId));
      return result;
    });
  }

  async function acquire(owned: OwnedOperation) {
    const owner = randomUUID();
    let acquired: RuntimeState | null = null;
    await mutateRuntime(owned.task.id, (runtime) => {
      if (
        runtime.phase === "completed" ||
        runtime.phase === "failed" ||
        (runtime.lease?.expiresAt ?? 0) > Date.now()
      ) return;
      runtime.lease = { owner, expiresAt: Date.now() + LEASE_MS };
      acquired = structuredClone(runtime);
    });
    return acquired ? { owner, runtime: acquired as RuntimeState } : null;
  }

  async function updatePhase(
    owned: OwnedOperation,
    owner: string,
    phase: RunPhase,
    providerTaskId?: string,
    providerRequestId?: string | null,
  ) {
    await mutateRuntime(owned.task.id, async (runtime, _task, tx) => {
      if (runtime.lease?.owner !== owner || runtime.lease.expiresAt < Date.now()) {
        throw new EnterpriseRagEvaluationError(
          "EVALUATION_LEASE_CHANGED",
          "评估任务执行权已变化，请重新读取。",
        );
      }
      runtime.phase = phase;
      runtime.lease.expiresAt = Date.now() + LEASE_MS;
      delete runtime.error;
      if (phase === "create_unknown") runtime.createClaimedAt = Date.now();
      await tx
        .update(model.agentOperations)
        .set({
          status: phase === "result_pending" ? "result_pending" : "running",
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(model.agentOperations.id, owned.operation.id));
      await tx
        .update(model.agentTasks)
        .set({
          providerState: phase,
          ...(providerTaskId ? { providerTaskId } : {}),
          ...(providerRequestId ? { providerRequestId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(model.agentTasks.id, owned.task.id));
    });
  }

  async function fail(
    owned: OwnedOperation,
    owner: string,
    error: RuntimeError,
    attentionRequired = false,
  ) {
    await mutateRuntime(owned.task.id, async (runtime, _task, tx) => {
      if (runtime.lease?.owner !== owner) return;
      runtime.phase = "failed";
      runtime.error = error;
      delete runtime.lease;
      await tx
        .update(model.agentOperations)
        .set({
          status: attentionRequired ? "attention_required" : "failed",
          errorCode: error.code,
          updatedAt: new Date(),
        })
        .where(eq(model.agentOperations.id, owned.operation.id));
      await tx
        .update(model.agentTasks)
        .set({ providerState: "failed", updatedAt: new Date() })
        .where(eq(model.agentTasks.id, owned.task.id));
    });
  }

  async function clearLease(owned: OwnedOperation, owner: string) {
    await mutateRuntime(owned.task.id, (runtime) => {
      if (runtime.lease?.owner === owner) delete runtime.lease;
    });
  }

  async function persistedClient(owned: OwnedOperation, runtime: RuntimeState) {
    const credential = await model.getDecryptedCredentialForAccountById(
      context.accountUserId,
      runtime.credentialId,
    );
    if (!credential || credential.version !== runtime.credentialVersion) {
      throw new EnterpriseRagEvaluationError(
        "MODEL_CREDENTIAL_UNAVAILABLE",
        "原评估任务使用的模型凭据已不可用，请检查账户 API 配置。",
      );
    }
    if (
      evaluatorInputHash(runtime.input) !== runtime.input.inputHash ||
      intentHash(runtime.skill) !== runtime.skillHash ||
      owned.operation.requestHash !== runtime.input.inputHash ||
      owned.operation.apiCredentialId !== runtime.credentialId ||
      owned.operation.credentialVersion !== runtime.credentialVersion ||
      owned.operation.schemaHash !== intentHash(ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA)
    ) {
      throw new EnterpriseRagEvaluationError(
        "EVALUATION_CONTEXT_INVALID",
        "评估任务快照校验失败，请重新发起评估。",
      );
    }
    return {
      client: model.createCredentialAgentClient(credential, {
        accountUserId: context.accountUserId,
        operationId: owned.operation.id,
        localTaskId: owned.task.id,
        intentId: owned.operation.id,
      }),
      repairClient: (intentId: string) => model.createCredentialAgentClient(
        credential,
        {
          accountUserId: context.accountUserId,
          operationId: owned.operation.id,
          localTaskId: owned.task.id,
          intentId,
        },
      ),
    };
  }

  async function uploadSkill(
    owned: OwnedOperation,
    runtime: RuntimeState,
    client: any,
  ) {
    const zip = new JSZip();
    zip.file("SKILL.md", runtime.skill);
    zip.file("input.json", JSON.stringify(runtime.input));
    const uploaded = await client.uploadFile({
      filename: "evaluate-enterprise-rag.skill.zip",
      bytes: await zip.generateAsync({ type: "nodebuffer" }),
      contentType: "application/zip",
      observer: {
        onCandidateCreated: async ({ fileId }: { fileId: string }) =>
          model.recordUpstreamResource({
            userId: context.accountUserId,
            apiCredentialId: runtime.credentialId,
            kind: "file",
            upstreamId: fileId,
          }),
      },
    });
    return [{
      file_id: uploaded.fileId,
      filename: "evaluate-enterprise-rag.skill.zip",
    }];
  }

  async function publishReport(
    owned: OwnedOperation,
    owner: string,
    runtime: RuntimeState,
    judgments: ReturnType<typeof validateEnterpriseRagJudgeOutput>,
    providerEvent: { id: string; timestamp: number },
  ) {
    const result = await runEvaluationSkill(enterpriseRagEvaluationSkill, {
      dimensions: judgments.dimensions.map((item) => ({
        id: item.id,
        level: item.level as 0 | 1 | 2 | 3 | 4,
        rationale: item.rationale,
        evidenceIds: item.evidenceIds,
        applicable: true,
      })),
      gates: judgments.gates.map((item) => ({
        id: item.id,
        status: item.status,
        reason: item.reason,
      })),
      relatedReportIds: [],
    });
    if (result.status !== "completed" || result.coverage !== 100) {
      throw new EnterpriseRagEvaluationError(
        "EVALUATION_SCORE_INVALID",
        "企业 RAG 评分 Skill 未生成完整结果。",
      );
    }
    const reportId = randomUUID();
    const completedAt = new Date().toISOString();
    const report: EnterpriseRagEvaluationReport = {
      reportId,
      sourceQaTaskId: runtime.sourceQaTaskId,
      sourceTurnId: runtime.sourceTurnId,
      conversationId: runtime.input.conversationId,
      questionMessageId: runtime.input.questionMessageId,
      answerMessageId: runtime.input.answerMessageId,
      questionHash: sha256(runtime.input.question),
      answerHash: sha256(runtime.input.answer),
      knowledgeBase: runtime.input.knowledgeBase,
      evaluator: {
        ...runtime.input.evaluator,
        provider: String(owned.operation.provider),
        model: String(owned.operation.upstreamModel),
        effort: runtime.upstreamEffort,
        skillHash: runtime.skillHash,
        outputHash: intentHash(judgments),
      },
      judgments,
      result,
      createdAt: iso(owned.operation.createdAt ?? runtime.createdAt),
      completedAt,
    };
    const db = await database();
    await db.transaction(async (tx: any) => {
      let query = tx
        .select()
        .from(model.agentTasks)
        .where(eq(model.agentTasks.id, owned.task.id))
        .limit(1);
      if (typeof query.for === "function") query = query.for("update");
      const task = (await query)[0];
      const current = runtimeFromTask(task);
      if (current.lease?.owner !== owner || current.lease.expiresAt < Date.now()) {
        throw new EnterpriseRagEvaluationError(
          "EVALUATION_LEASE_CHANGED",
          "评估任务执行权已变化，请重新读取。",
        );
      }
      const existing = (await tx
        .select({ payload: model.agentEvents.normalizedPayload })
        .from(model.agentEvents)
        .where(and(
          eq(model.agentEvents.taskId, owned.task.id),
          eq(model.agentEvents.eventType, RESULT_EVENT_TYPE),
        ))
        .limit(1))[0];
      if (existing) {
        const persisted = reportFromPayload(existing.payload, current);
        if (!persisted || persisted.evaluator.outputHash !== report.evaluator.outputHash) {
          throw new EnterpriseRagEvaluationError(
            "EVALUATION_REPORT_CONFLICT",
            "评估任务已有不一致的不可变报告，请联系维护人员。",
          );
        }
      } else {
        await tx.insert(model.agentEvents).values({
          id: reportId,
          taskId: owned.task.id,
          providerEventId: `report:${intentHash(providerEvent.id).slice(0, 48)}`,
          eventType: RESULT_EVENT_TYPE,
          providerTimestampMs: providerTimestampMs(providerEvent.timestamp),
          normalizedPayload: { kind: RESULT_EVENT_TYPE, report },
        });
      }
      current.phase = "completed";
      delete current.error;
      delete current.lease;
      await tx
        .update(model.agentOperations)
        .set({ status: "succeeded", errorCode: null, updatedAt: new Date() })
        .where(eq(model.agentOperations.id, owned.operation.id));
      await tx
        .update(model.agentTasks)
        .set({
          providerRuntime: runtimeContainer(task, current),
          providerState: "completed",
          lastMessageSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(model.agentTasks.id, owned.task.id));
    });
  }

  async function advance(owned: OwnedOperation) {
    const claim = await acquire(owned);
    if (!claim) return;
    const { owner } = claim;
    let runtime = claim.runtime;
    let phase = runtime.phase;
    let leaveLease = false;
    let repairDispatch = false;
    try {
      const clients = await persistedClient(owned, runtime);
      const client = clients.client;
      const freshOwned = await findOwnedOperation(owned.operation.id);
      if (!freshOwned) return;
      owned = freshOwned;
      if (phase === "queued" || phase === "uploading") {
        if (Date.now() - Date.parse(runtime.createdAt) > MAX_EXECUTION_MS) {
          throw new EnterpriseRagEvaluationError(
            "EVALUATION_TIMEOUT",
            "评估模型任务超时，请查看账户任务记录后重新评估。",
          );
        }
        await updatePhase(owned, owner, "uploading");
        phase = "uploading";
        const attachments = await uploadSkill(owned, runtime, client);
        await updatePhase(owned, owner, "create_unknown");
        phase = "create_unknown";
        const created = await client.createTask({
          title: owned.task.title,
          prompt: `解压附件并完整读取 SKILL.md，严格按流程评估 input.json。只返回符合结构化输出 schema 的 JSON。\nFRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({ operationToken: runtime.input.operationToken })}`,
          attachments,
          agentProfile: owned.operation.upstreamModel,
          locale: "zh-CN",
          interactiveMode: false,
          structuredOutputSchema: ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA,
        });
        await updatePhase(
          owned,
          owner,
          "running",
          created.taskId,
          created.requestId,
        );
        await model.recordUpstreamResource({
          userId: context.accountUserId,
          apiCredentialId: runtime.credentialId,
          kind: "task",
          upstreamId: created.taskId,
        });
        return;
      }

      let providerTaskId = owned.task.providerTaskId as string | null;
      if (phase === "create_unknown" && !providerTaskId) {
        const found = await client.findCreatedTask({
          title: owned.task.title,
          operationToken: runtime.input.operationToken,
          createdAfterSeconds: Math.floor(Date.parse(runtime.createdAt) / 1000) - 60,
          createdBeforeSeconds: Math.floor(Date.now() / 1000) + 60,
        });
        if (found.matches.length > 1) {
          throw new EnterpriseRagEvaluationError(
            "EVALUATION_CREATE_AMBIGUOUS",
            "发现多个同标识评估任务，请人工核对账户任务记录。",
          );
        }
        if (!found.unique) {
          if (Date.now() - (runtime.createClaimedAt ?? Date.parse(runtime.createdAt)) > RESULT_SYNC_GRACE_MS) {
            throw new EnterpriseRagEvaluationError(
              "EVALUATION_CREATE_UNKNOWN",
              "评估任务创建结果无法确认；系统不会重复创建，请核对账户任务记录。",
            );
          }
          return;
        }
        providerTaskId = String(found.unique.id);
        await updatePhase(owned, owner, "running", providerTaskId);
        phase = "running";
        await model.recordUpstreamResource({
          userId: context.accountUserId,
          apiCredentialId: runtime.credentialId,
          kind: "task",
          upstreamId: providerTaskId,
        });
      }
      if (!providerTaskId) return;

      const allEvents: Array<{
        id: string;
        type: string;
        timestamp: number;
        [key: string]: any;
      }> = await client.listAllMessages({ taskId: providerTaskId, order: "asc" });
      const baseline = new Set(runtime.repair?.baselineEventIds ?? []);
      const events = allEvents.filter((event) => !baseline.has(event.id));
      const resultEvent = model
        .orderManusV2EventsByProviderRank(events, "newest_first")
        .find((event: any) => event.type === "structured_output_result");
      let invalidResult: string | undefined;
      let judgments: ReturnType<typeof validateEnterpriseRagJudgeOutput> | undefined;
      if (resultEvent) {
        try {
          const classified = model.classifyManusV2StructuredResultEnvelope(
            resultEvent.structured_output_result,
          );
          if (classified.kind !== "accepted") {
            throw new EnterpriseRagEvaluationError(
              "EVALUATION_RESULT_INVALID",
              "模型未返回有效结构化结果。",
            );
          }
          judgments = validateEnterpriseRagJudgeOutput(classified.value, runtime.input);
        } catch (error) {
          invalidResult = error instanceof z.ZodError
            ? "模型输出字段不符合评估结构"
            : error instanceof Error
              ? error.message
              : "模型结果无法验证";
        }
      }
      if (resultEvent && judgments) {
        await publishReport(owned, owner, runtime, judgments, resultEvent);
        leaveLease = true;
        return;
      }

      const state = model.latestManusV2TaskState(events) ??
        (await client.taskDetail(providerTaskId)).status;
      if (["error", "failed", "cancelled"].includes(state)) {
        throw new EnterpriseRagEvaluationError(
          state === "cancelled" ? "EVALUATION_CANCELLED" : "EVALUATION_PROVIDER_FAILED",
          state === "cancelled"
            ? "评估模型任务已取消，未写入评分。"
            : "评估模型执行异常，未写入评分；请查看任务记录后重试。",
        );
      }
      if (["finished", "completed", "stopped"].includes(state)) {
        const final = model
          .orderManusV2EventsByProviderRank(events, "newest_first")
          .find((event: any) =>
            event.type === "assistant_message" &&
            typeof event.assistant_message?.content === "string" &&
            event.assistant_message.content.trim()) as any;
        if (final && !invalidResult) {
          let raw = String(final.assistant_message.content).trim();
          const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(raw);
          if (fence) raw = fence[1]!.trim();
          try {
            judgments = validateEnterpriseRagJudgeOutput(
              JSON.parse(raw),
              runtime.input,
            );
            await publishReport(owned, owner, runtime, judgments, {
              id: final.id,
              timestamp: final.timestamp,
            });
            leaveLease = true;
            return;
          } catch (error) {
            invalidResult = error instanceof SyntaxError
              ? "模型最终 JSON 语法错误"
              : error instanceof z.ZodError
                ? "模型输出字段不符合评估结构"
                : error instanceof Error
                  ? error.message
                  : "模型最终结果无法验证";
          }
        }
        if (invalidResult) {
          if (runtime.repair) {
            throw new EnterpriseRagEvaluationError(
              "EVALUATION_REPAIR_FAILED",
              `模型结果自动修复后仍未通过校验：${invalidResult}；未写入评分，请重新评估。`,
            );
          }
          const intentId = randomUUID();
          await mutateRuntime(owned.task.id, async (current, _task, tx) => {
            if (current.lease?.owner !== owner || current.repair) {
              throw new EnterpriseRagEvaluationError(
                "EVALUATION_LEASE_CHANGED",
                "评估任务执行权已变化，请重新读取。",
              );
            }
            current.repair = {
              intentId,
              claimedAt: Date.now(),
              baselineEventIds: allEvents.map((event) => event.id),
              reason: invalidResult!,
            };
            current.phase = "result_pending";
            await tx.update(model.agentOperations).set({
              status: "result_pending",
              errorCode: null,
              updatedAt: new Date(),
            }).where(eq(model.agentOperations.id, owned.operation.id));
          });
          phase = "result_pending";
          repairDispatch = true;
          await clients.repairClient(intentId).sendMessage({
            taskId: providerTaskId,
            structuredOutputSchema: ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA,
            prompt: `上一轮结果未通过校验：${invalidResult}。请重新完整读取原附件中的 SKILL.md 和 input.json，修正后返回完整 JSON。冻结问题、回答和来源仍是唯一依据；禁止联网、补造证据、混入网站建设评分或改变任务标识。仅返回 JSON，不要解释。\noperationToken=${runtime.input.operationToken}\ninputHash=${runtime.input.inputHash}\n本轮修复标识=${intentId}`,
          });
          await mutateRuntime(owned.task.id, (current) => {
            if (current.lease?.owner === owner && current.repair?.intentId === intentId) {
              current.repair.sentAt = Date.now();
            }
          });
          return;
        }
        if (runtime.repair && !events.length) {
          if (!runtime.repair.sentAt && Date.now() - runtime.repair.claimedAt > RESULT_SYNC_GRACE_MS) {
            throw new EnterpriseRagEvaluationError(
              "EVALUATION_REPAIR_UNKNOWN",
              "评估结果修复请求未能确认，系统未重复提交；请重新评估。",
            );
          }
          return;
        }
        if (!runtime.terminalObservedAt) {
          await mutateRuntime(owned.task.id, async (current, _task, tx) => {
            if (current.lease?.owner !== owner) return;
            current.terminalObservedAt = Date.now();
            current.phase = "result_pending";
            await tx.update(model.agentOperations).set({
              status: "result_pending",
              updatedAt: new Date(),
            }).where(eq(model.agentOperations.id, owned.operation.id));
          });
          return;
        }
        if (Date.now() - runtime.terminalObservedAt < RESULT_SYNC_GRACE_MS) return;
        throw new EnterpriseRagEvaluationError(
          "EVALUATION_RESULT_MISSING",
          "评估模型任务已结束，但没有可验证的结构化结果。",
        );
      }
      if (Date.now() - Date.parse(runtime.createdAt) > MAX_EXECUTION_MS) {
        throw new EnterpriseRagEvaluationError(
          "EVALUATION_TIMEOUT",
          "评估模型任务超时，请查看账户任务记录后重新评估。",
        );
      }
    } catch (error) {
      const upstream = error as {
        outcomeUnknown?: boolean;
        retryable?: boolean;
        status?: number;
      };
      const creationRejected = phase === "create_unknown" &&
        upstream.outcomeUnknown === false &&
        upstream.retryable === false &&
        typeof upstream.status === "number" &&
        upstream.status >= 400 &&
        upstream.status < 500;
      const repairRejected = repairDispatch &&
        upstream.outcomeUnknown === false &&
        upstream.retryable === false &&
        typeof upstream.status === "number" &&
        upstream.status >= 400 &&
        upstream.status < 500;
      const known = error instanceof EnterpriseRagEvaluationError || error instanceof z.ZodError;
      if (
        ((phase === "running" || phase === "result_pending") && !repairRejected && !known) ||
        (phase === "create_unknown" && !creationRejected && !known) ||
        (phase === "uploading" && upstream.retryable)
      ) return;
      const runtimeError: RuntimeError = error instanceof z.ZodError
        ? { code: "EVALUATION_RESULT_INVALID", message: "模型输出字段格式不正确，请重新评估。" }
        : error instanceof EnterpriseRagEvaluationError
          ? { code: error.code, message: error.message }
          : repairRejected
            ? { code: "EVALUATION_REPAIR_REJECTED", message: "模型服务拒绝结果修复请求，未写入评分；请检查账户 API 后重新评估。" }
            : creationRejected
              ? { code: "EVALUATION_CREATE_REJECTED", message: "模型服务拒绝创建评估任务，请检查账户 API 配置和任务记录。" }
              : { code: "EVALUATION_UNAVAILABLE", message: "评估模型调用未完成，请检查账户任务记录。" };
      await fail(owned, owner, runtimeError, phase === "create_unknown" && !creationRejected);
      leaveLease = true;
    } finally {
      if (!leaveLease) await clearLease(owned, owner);
    }
  }

  async function start(value: unknown) {
    assertActor();
    const input = startSchema.parse(value);
    const existing = await findOwnedOperation(input.clientRequestId);
    if (existing) {
      const runtime = runtimeFromTask(existing.task);
      if (
        runtime.sourceQaTaskId !== input.sourceQaTaskId ||
        runtime.sourceTurnId !== input.turnId
      ) {
        throw new EnterpriseRagEvaluationError(
          "IDEMPOTENCY_CONFLICT",
          "本次评估请求标识已用于其他问答。",
        );
      }
      await advance(existing);
      return dto((await findOwnedOperation(input.clientRequestId))!);
    }

    // A client can legitimately retry with a fresh UUID after losing the POST
    // response. Coordinate-level dedupe prevents a second paid provider task.
    const activeCoordinate = await findActiveCoordinate(
      input.sourceQaTaskId,
      input.turnId,
    );
    if (activeCoordinate) {
      await advance(activeCoordinate);
      return dto((await findOwnedOperation(activeCoordinate.operation.id))!);
    }

    let prepared: Awaited<ReturnType<typeof prepare>>;
    try {
      prepared = await prepare();
    } catch (error) {
      if (error instanceof EnterpriseRagEvaluationError) throw error;
      throw new EnterpriseRagEvaluationError(
        "MODEL_UNAVAILABLE",
        "当前评估模型服务不可用，请检查服务权限与 API 配置。",
        503,
      );
    }
    const operationToken = `brand-rag-evaluation:${input.clientRequestId}`;
    const frozen = await resolveFrozenInput(
      input.sourceQaTaskId,
      input.turnId,
      operationToken,
    );
    const runtime: RuntimeState = {
      schemaVersion: 1,
      sourceQaTaskId: input.sourceQaTaskId,
      sourceTurnId: input.turnId,
      input: frozen,
      skill: prepared.skill,
      skillHash: prepared.skillHash,
      credentialId: prepared.credential.id,
      credentialVersion: prepared.credential.version,
      upstreamEffort: prepared.credential.upstreamEffort,
      phase: "queued",
      createdAt: new Date().toISOString(),
    };
    const taskId = randomUUID();
    const db = await database();
    let concurrent: OwnedOperation | undefined;
    await db.transaction(async (tx: any) => {
      await model.lockAccountRecord(tx, context.accountUserId);
      await model.lockCustomerProjectBusinessWrite(tx, context.accountUserId, actor);
      concurrent = await findActiveCoordinate(
        input.sourceQaTaskId,
        input.turnId,
        tx,
      );
      if (concurrent) return;
      const collision = (await tx
        .select({ operation: model.agentOperations, task: model.agentTasks })
        .from(model.agentOperations)
        .innerJoin(
          model.agentTasks,
          eq(model.agentTasks.operationId, model.agentOperations.id),
        )
        .where(eq(model.agentOperations.id, input.clientRequestId))
        .limit(1))[0] as OwnedOperation | undefined;
      if (collision) {
        const replay =
          collision.operation.scope === "managed_user" &&
          collision.operation.accountUserId === context.accountUserId &&
          (collision.operation.enterpriseProjectId ?? null) === context.enterpriseProjectId &&
          collision.operation.operationType === ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE &&
          collision.operation.contractName === ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE &&
          collision.operation.contractRevision === ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION
            ? runtimeFromTask(collision.task)
            : null;
        if (
          !replay ||
          replay.sourceQaTaskId !== input.sourceQaTaskId ||
          replay.sourceTurnId !== input.turnId
        ) {
          throw new EnterpriseRagEvaluationError(
            "IDEMPOTENCY_CONFLICT",
            "本次评估请求标识已用于其他操作。",
          );
        }
        return;
      }
      await tx.insert(model.agentOperations).values({
        id: input.clientRequestId,
        enterpriseProjectId: context.enterpriseProjectId,
        provider: prepared.credential.provider,
        scope: "managed_user",
        accountUserId: context.accountUserId,
        presalesProjectId: null,
        operationType: ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE,
        idempotencyKeyHash: intentHash([
          ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE,
          context.accountUserId,
          context.enterpriseProjectId,
          input.clientRequestId,
        ]),
        requestHash: frozen.inputHash,
        contractName: ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE,
        contractRevision: ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION,
        schemaHash: intentHash(ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA),
        apiCredentialId: prepared.credential.id,
        credentialVersion: prepared.credential.version,
        publicProfile: prepared.credential.agentProfile,
        upstreamModel: prepared.credential.upstreamModel,
        status: "queued",
      });
      await tx.insert(model.agentTasks).values({
        id: taskId,
        operationId: input.clientRequestId,
        providerTaskId: null,
        providerRequestId: null,
        createMarker: operationToken,
        title: `FrontMind RAG evaluation ${input.clientRequestId}`,
        providerState: "queued",
        providerRuntime: { [RUNTIME_KEY]: runtime },
        resultDeadlineAt: new Date(Date.now() + MAX_EXECUTION_MS),
      });
    });
    if (concurrent) {
      await advance(concurrent);
      return dto((await findOwnedOperation(concurrent.operation.id))!);
    }
    const reserved = await findOwnedOperation(input.clientRequestId);
    if (!reserved) {
      throw new EnterpriseRagEvaluationError(
        "EVALUATION_RESERVATION_FAILED",
        "评估任务未能保存，请稍后重试。",
        503,
      );
    }
    await advance(reserved);
    return dto((await findOwnedOperation(input.clientRequestId))!);
  }

  async function observe(operationId: string) {
    assertActor();
    const parsed = z.string().uuid().parse(operationId);
    const owned = await findOwnedOperation(parsed);
    if (!owned) {
      throw new EnterpriseRagEvaluationError(
        "EVALUATION_NOT_FOUND",
        "评估任务不存在。",
        404,
      );
    }
    await advance(owned);
    return dto((await findOwnedOperation(parsed))!);
  }

  async function findActiveCoordinate(
    sourceQaTaskId: string,
    sourceTurnId: string,
    executor?: any,
  ): Promise<OwnedOperation | undefined> {
    const db = executor ?? await database();
    const candidates = await db
      .select({ operation: model.agentOperations, task: model.agentTasks })
      .from(model.agentOperations)
      .innerJoin(
        model.agentTasks,
        eq(model.agentTasks.operationId, model.agentOperations.id),
      )
      .where(and(
        eq(model.agentOperations.scope, "managed_user"),
        eq(model.agentOperations.accountUserId, context.accountUserId),
        projectCondition(model.agentOperations.enterpriseProjectId),
        eq(model.agentOperations.operationType, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractName, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractRevision, ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION),
        // attention_required means an upstream create may have succeeded while
        // its response was lost. It remains a paid-task dedupe fence even
        // though the public runtime is terminal failed.
        inArray(model.agentOperations.status, ["queued", "running", "result_pending", "attention_required"]),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${model.agentTasks.providerRuntime}, '$.enterpriseRagEvaluation.sourceQaTaskId')) = ${sourceQaTaskId}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${model.agentTasks.providerRuntime}, '$.enterpriseRagEvaluation.sourceTurnId')) = ${sourceTurnId}`,
      ))
      .orderBy(desc(model.agentOperations.createdAt), desc(model.agentOperations.id))
      .limit(5) as OwnedOperation[];
    return candidates.find((candidate) =>
      candidate.operation.status === "attention_required" ||
      !["completed", "failed"].includes(runtimeFromTask(candidate.task).phase));
  }

  async function ownedHistory(sourceQaTaskId: string, sourceTurnId: string) {
    const db = await database();
    return await db
      .select({ operation: model.agentOperations, task: model.agentTasks })
      .from(model.agentOperations)
      .innerJoin(
        model.agentTasks,
        eq(model.agentTasks.operationId, model.agentOperations.id),
      )
      .where(and(
        eq(model.agentOperations.scope, "managed_user"),
        eq(model.agentOperations.accountUserId, context.accountUserId),
        projectCondition(model.agentOperations.enterpriseProjectId),
        eq(model.agentOperations.operationType, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractName, ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE),
        eq(model.agentOperations.contractRevision, ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${model.agentTasks.providerRuntime}, '$.enterpriseRagEvaluation.sourceQaTaskId')) = ${sourceQaTaskId}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${model.agentTasks.providerRuntime}, '$.enterpriseRagEvaluation.sourceTurnId')) = ${sourceTurnId}`,
      ))
      .orderBy(desc(model.agentOperations.createdAt), desc(model.agentOperations.id))
      .limit(20) as OwnedOperation[];
  }

  async function latest(sourceQaTaskId: string, turnId: string) {
    assertActor();
    const input = latestSchema.parse({ sourceQaTaskId, turnId });
    const active = await findActiveCoordinate(input.sourceQaTaskId, input.turnId);
    if (active) {
      await advance(active);
    }
    const history = await ownedHistory(input.sourceQaTaskId, input.turnId);
    const projected = await Promise.all(history.map(dto));
    return { latest: projected[0] ?? null, history: projected };
  }

  return { start, observe, latest };
}
