import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {and, eq} from "drizzle-orm";
import JSZip from "jszip";
import {z} from "zod";
import type {BrandKeywordPorts, BrandKeywordCredential} from "./brand-keyword-ports.js";
import type {IntentNode, IntentQuestion, IntentSkillJob, IntentEvaluation, IntentPlan} from "../contracts/intent-workbench.js";
import {projectKnowledgeBaseCustomerMarkdown} from "../contracts/knowledge-base-materialized-contract.js";

let ports: BrandKeywordPorts | undefined;
export class IntentSkillRuntimeError extends Error {}
/** Installed by the existing authenticated keyword service composition root. */
export function registerIntentSkillPorts(core: BrandKeywordPorts) {ports = core;}
export function intentSkillPorts() {
  if (!ports) throw new IntentSkillRuntimeError("优化模型服务尚未装配");
  return ports;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** MySQL JSON may reorder object keys; task pins must survive a durable round trip. */
export const intentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export type IntentSkillInput = {
  kind: "evaluate" | "plan"; operationToken: string; inputHash: string;
  selectedQuestions: IntentQuestion[]; candidates: IntentQuestion[]; nodes: IntentNode[];
  skill: string;
};
const text = z.string().trim().min(1).max(2000);
const score = z.number().int().min(0).max(100);
const resultSchema = z.object({
  operationToken: text, inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  evaluations: z.array(z.object({
    questionId: text, value: score, support: score,
    dimensions: z.array(z.object({label: text, score, reason: text}).strict()).length(6),
    points: z.array(z.object({
      title: text, terms: z.array(text).max(20), status: z.enum(["supported", "partial", "missing"]),
      nodeId: text.nullable(), evidence: z.string().max(4000), issue: text,
    }).strict()).min(1).max(12),
    findings: z.array(text).max(20),
  }).strict()).min(1).max(160),
  plans: z.array(z.object({
    questionId: text, actions: z.array(z.object({
      kind: z.enum(["question", "node", "todo"]), title: text, nodeId: text.nullable(),
      after: z.string().trim().min(1).max(300000), source: text,
    }).strict()).min(1).max(3),
  }).strict()).max(160),
}).strict();
export const INTENT_WIRE_SCHEMA = z.toJSONSchema(resultSchema, {target: "draft-7"});
const dimensionLabels = ["意图明确度", "品牌关联度", "决策相关度", "问题清晰度", "内容独特度", "知识支撑初评"];
export function validateIntentSkillResult(value: unknown, input: IntentSkillInput, job: IntentSkillJob) {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 4 * 1024 * 1024) throw new IntentSkillRuntimeError("模型结果超过大小限制");
  const parsed = resultSchema.parse(value);
  if (parsed.operationToken !== input.operationToken || parsed.inputHash !== job.inputHash) throw new IntentSkillRuntimeError("模型结果不属于本次任务");
  const expected = intentHash(input.selectedQuestions.map(q => q.id).sort());
  const idsMatch = (items: {questionId: string}[]) => intentHash(items.map(item => item.questionId).sort()) === expected;
  if (!idsMatch(parsed.evaluations) || (input.kind === "plan" ? !idsMatch(parsed.plans) : parsed.plans.length !== 0)) throw new IntentSkillRuntimeError("模型结果未完整覆盖所选问题");
  const evaluations: IntentEvaluation[] = parsed.evaluations.map(item => {
    const points = item.points.map(point => {
      const node = input.nodes.find(node => node.id === point.nodeId);
      if (point.status === "missing") {
        if (point.nodeId !== null || point.evidence !== "") throw new IntentSkillRuntimeError("缺失要点不得携带虚假证据");
      } else if (!node || !point.evidence.trim() || !node.content.includes(point.evidence) ||
        (point.status === "supported" && (!node.verified || /待补|待核|待确认|尚未|缺少|暂无/.test(point.evidence)))) {
        throw new IntentSkillRuntimeError("模型引用没有可验证的知识原文");
      }
      return {...point, nodeTitle: node ? `${node.branch} / ${node.title}` : null};
    });
    const support = Math.round(points.reduce((sum, p) => sum + ({supported: 100, partial: 50, missing: 0}[p.status]), 0) / points.length);
    if (item.dimensions.some((d, index) => d.label !== dimensionLabels[index]) ||
      item.support !== support || item.dimensions[5].score !== support ||
      item.value !== Math.round(item.dimensions.reduce((sum, d) => sum + d.score, 0) / 6)) throw new IntentSkillRuntimeError("模型评分与评分口径不一致");
    return {...item, points, method: "skill_v1", evaluatedAt: new Date().toISOString(),
      provenance: {operationId: job.id, inputHash: job.inputHash, skillHash: job.skillHash, model: job.model}};
  });
  const plans: IntentPlan[] = parsed.plans.map(plan => {
    if (new Set(plan.actions.map(a => a.kind)).size !== plan.actions.length) throw new IntentSkillRuntimeError("方案包含重复动作");
    const question = input.selectedQuestions.find(q => q.id === plan.questionId)!;
    return {questionId: plan.questionId, inputHash: job.inputHash, actions: plan.actions.map(action => {
      const node = input.nodes.find(node => node.id === action.nodeId);
      if (action.kind === "node" ? !node?.editable : action.nodeId !== null) throw new IntentSkillRuntimeError("方案目标节点不可编辑");
      if (action.kind === "question" && action.after.length > 500) throw new IntentSkillRuntimeError("优化问题超过长度限制");
      return {...action, id: `${job.id}:${question.id}:${action.kind}`, selected: action.kind !== "node",
        before: action.kind === "node" ? node!.content : action.kind === "question" ? question.question : "",
        after: action.kind === "node" ? projectKnowledgeBaseCustomerMarkdown({leafTitle: node!.title, markdown: action.after}) : action.after};
    })};
  });
  return {evaluations, plans};
}
export async function prepareIntentSkill(accountUserId: number) {
  const core = intentSkillPorts();
  await core.assertServiceCapability(accountUserId, "globalKeywords");
  const [status, credential] = await Promise.all([core.getApiCredentialStatus(accountUserId), core.getDecryptedCredentialForUser(accountUserId)]);
  if (!credential || status.status !== "active" || !status.verifiedAt || credential.status !== "active" ||
    !credential.verifiedAt || credential.version !== status.version) throw new IntentSkillRuntimeError("请先配置并验证当前账户的模型 API");
  // Same provider-mode selection Core's keyword credential chain applies: when
  // the XTY runner is requested, dispatch must use the xty_codex service
  // identity — fail explicitly rather than silently falling back to a zhipu
  // credential. Under the mode the resolver itself returns the XTY identity,
  // so this guard only fires if that contract ever drifts.
  const xtyRequested = process.env.FRONTMIND_MODULE_PROVIDER_MODE === "xty_openai_agents" ||
    process.env.FRONTMIND_AGENT_PROVIDER_MODE === "xty_openai_agents";
  if (xtyRequested && (credential as {provider?: unknown}).provider !== "xty_codex") {
    throw new IntentSkillRuntimeError("当前部署要求使用 XTY 模型运行器，但解析到的凭据不是 XTY 服务身份，已停止优化任务。");
  }
  // Both source and dist/server resolve a shipped Skill, never a host cwd.
  const skill = await readFile(new URL("../workflows/optimize-intent/SKILL.md", import.meta.url), "utf8");
  return {credential, skill, skillHash: intentHash(skill)};
}
export async function reserveIntentSkill(tx: any, job: IntentSkillJob, input: IntentSkillInput,
  credential: BrandKeywordCredential, accountUserId: number, projectId: string | null) {
  const core = intentSkillPorts();
  await core.lockAccountRecord(tx, accountUserId);
  await tx.insert(core.agentOperations).values({
    id: job.id, enterpriseProjectId: projectId, provider: credential.provider, scope: "managed_user",
    accountUserId, presalesProjectId: null, operationType: "brand_intent_optimization",
    idempotencyKeyHash: intentHash([accountUserId, projectId, job.id]), requestHash: job.inputHash,
    contractName: "brand_intent_optimization", contractRevision: 1, schemaHash: intentHash(INTENT_WIRE_SCHEMA),
    apiCredentialId: credential.id, credentialVersion: credential.version, publicProfile: credential.agentProfile,
    upstreamModel: credential.upstreamModel, status: "queued",
  });
  await tx.insert(core.agentTasks).values({
    id: job.taskId, operationId: job.id, providerTaskId: null, providerRequestId: null,
    createMarker: input.operationToken, title: `FrontMind intent ${job.id}`, providerState: "queued",
    providerRuntime: {input},
  });
}
export async function intentSkillClient(job: IntentSkillJob, accountUserId: number, db: any) {
  const core = intentSkillPorts();
  const credential = await core.getDecryptedCredentialForAccountById(accountUserId, job.credentialId);
  if (!credential || credential.version !== job.credentialVersion) throw new IntentSkillRuntimeError("原任务模型凭据已不可用，请检查账户 API 配置");
  const task = (await db.select().from(core.agentTasks).where(and(eq(core.agentTasks.id, job.taskId), eq(core.agentTasks.operationId, job.id))).limit(1))[0];
  if (!task?.providerRuntime?.input) throw new IntentSkillRuntimeError("任务快照已不存在");
  const input = task.providerRuntime.input as IntentSkillInput;
  const {operationToken: _token, inputHash: _hash, ...frozen} = input;
  if (input.inputHash !== job.inputHash || intentHash(frozen) !== job.inputHash || intentHash(input.skill) !== job.skillHash)
    throw new IntentSkillRuntimeError("任务知识或 Skill 快照校验失败");
  return {core, task, input,
    repairClient: (intentId: string) => core.createCredentialAgentClient(credential,
      {accountUserId, operationId: job.id, localTaskId: job.taskId, intentId}),
    client: core.createCredentialAgentClient(credential, {accountUserId, operationId: job.id, localTaskId: job.taskId, intentId: job.id})};
}
export async function uploadIntentSkill(client: any, core: BrandKeywordPorts, job: IntentSkillJob, input: IntentSkillInput, accountUserId: number) {
  const zip = new JSZip();
  zip.file("SKILL.md", input.skill);
  const {skill: _skill, ...data} = input;
  zip.file("input.json", JSON.stringify(data));
  const uploaded = await client.uploadFile({
    filename: "optimize-intent.skill.zip", bytes: await zip.generateAsync({type: "nodebuffer"}),
    contentType: "application/zip", observer: {onCandidateCreated: async ({fileId}: {fileId: string}) =>
      core.recordUpstreamResource({userId: accountUserId, apiCredentialId: job.credentialId, kind: "file", upstreamId: fileId})},
  });
  return [{file_id: uploaded.fileId, filename: "optimize-intent.skill.zip"}];
}
