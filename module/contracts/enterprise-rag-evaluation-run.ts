import { z } from "zod";

export const ENTERPRISE_RAG_EVALUATION_OPERATION_TYPE =
  "brand_rag_answer_evaluation";
export const ENTERPRISE_RAG_EVALUATION_CONTRACT_REVISION = 2;
export const ENTERPRISE_RAG_JUDGE_VERSION = "2.0.0";

export const ENTERPRISE_RAG_DIMENSION_IDS = [
  "intent",
  "correctness",
  "completeness",
  "citations",
  "clarity",
  "boundaries",
] as const;

export const ENTERPRISE_RAG_GATE_IDS = [
  "facts",
  "citations",
  "permissions",
  "safety",
  "unknown",
  "injection",
  "availability",
] as const;

export const ENTERPRISE_RAG_CLAIM_IDS = Array.from(
  { length: 30 },
  (_, index) => `claim-${index + 1}`,
);

export type EnterpriseRagDimensionId =
  (typeof ENTERPRISE_RAG_DIMENSION_IDS)[number];
export type EnterpriseRagGateId = (typeof ENTERPRISE_RAG_GATE_IDS)[number];

export type EnterpriseRagEvaluationSource = {
  id: string;
  title: string;
  kind: "published_knowledge" | "user_attachment";
  /** Whether this source was actually exposed as a reference on the answer. */
  citedByAnswer: boolean;
  /** Customer-visible frozen evidence. Null means the attachment body was not
   * available to this evaluator and must never be treated as verified. */
  content: string | null;
};

export type EnterpriseRagEvaluationFrozenInput = {
  schemaVersion: 1 | 2;
  /** New single-answer judgments must not claim full-conversation acceptance. */
  taskScope?: "single_turn";
  operationToken: string;
  inputHash: string;
  sourceQaTaskId: string;
  sourceTurnId: string;
  conversationId: string;
  questionMessageId: string;
  answerMessageId: string;
  question: string;
  answer: string;
  sources: EnterpriseRagEvaluationSource[];
  allowedEvidenceIds: string[];
  knowledgeBase: {
    snapshotId: string;
    version: number;
    sourceFileName: string;
    documentCount: number;
    contentHash: string;
  };
  evaluator: {
    skillId: "enterprise-rag-evaluation";
    skillVersion: string;
    ruleVersion: string;
    judgeVersion: "1.0.0" | "2.0.0";
  };
};

// Coordinates are capabilities and must retain their exact bytes. In
// particular, do not trim here: the alias decoder must see and reject a
// leading/trailing-space mutation instead of silently normalizing it.
const identifier = z.string().min(1).max(255);
const explanation = z.string().trim().min(1).max(2_000);
const evidenceIds = z.array(identifier).min(1).max(20);

const judgeOutputSchema = z
  .object({
    operationToken: identifier,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    dimensions: z
      .array(
        z
          .object({
            id: z.enum(ENTERPRISE_RAG_DIMENSION_IDS),
            level: z.number().int().min(0).max(4),
            rationale: explanation,
            evidenceIds,
          })
          .strict(),
      )
      .length(ENTERPRISE_RAG_DIMENSION_IDS.length),
    gates: z
      .array(
        z
          .object({
            id: z.enum(ENTERPRISE_RAG_GATE_IDS),
            status: z.enum(["passed", "failed"]),
            reason: explanation,
            evidenceIds,
          })
          .strict(),
      )
      .length(ENTERPRISE_RAG_GATE_IDS.length),
    claims: z
      .array(
        z
          .object({
            id: identifier,
            /** Exact contiguous answer text, not a paraphrase. */
            statement: z.string().trim().min(1).max(1_000),
            status: z.enum(["supported", "partial", "unsupported"]),
            sourceIds: z.array(identifier).max(20),
            rationale: explanation,
          })
          .strict(),
      )
      .min(1)
      .max(30),
    summary: explanation,
  })
  .strict();

const gradedJudgeOutputSchema = judgeOutputSchema.extend({
  schemaVersion: z.literal(2),
  dimensions: z.array(judgeOutputSchema.shape.dimensions.element.extend({
    level: z.number().int().min(0).max(4).nullable(),
  })).length(ENTERPRISE_RAG_DIMENSION_IDS.length),
  gates: z.array(judgeOutputSchema.shape.gates.element.extend({
    status: z.enum(["passed", "failed", "pending"]),
  })).length(ENTERPRISE_RAG_GATE_IDS.length),
  claims: z.array(judgeOutputSchema.shape.claims.element.extend({
    kind: z.enum(["fact", "advice", "uncertainty"]),
    relevance: z.enum(["core", "supporting"]),
    status: z.enum(["supported", "partial", "unsupported", "contradicted", "unverifiable", "not_applicable"]),
  })).min(1).max(30),
  task: z.object({
    status: z.enum(["completed", "failed", "undetermined"]),
    rationale: explanation,
    evidenceIds,
  }).strict(),
  findings: z.array(z.object({
    id: z.string().regex(/^finding-([1-9]|[12][0-9]|30)$/u),
    kind: z.enum(["fact", "condition", "citation", "task", "privacy", "safety", "injection", "evidence", "expression"]),
    severity: z.enum(["critical", "improvement", "undetermined"]),
    summary: explanation,
    impact: explanation,
    claimIds: z.array(identifier).max(30),
    evidenceIds,
    dimensionIds: z.array(z.enum(ENTERPRISE_RAG_DIMENSION_IDS)).min(1).max(6),
  }).strict()).max(30),
}).strict();

export type EnterpriseRagGradedJudgeOutput = z.infer<typeof gradedJudgeOutputSchema>;
export function isGradedRagJudgment(value: EnterpriseRagJudgeOutput): value is EnterpriseRagGradedJudgeOutput {
  return "schemaVersion" in value && value.schemaVersion === 2;
}
function parseJudgeOutput(value: unknown, input: EnterpriseRagEvaluationFrozenInput): EnterpriseRagJudgeOutput {
  return input.schemaVersion === 2 ? gradedJudgeOutputSchema.parse(value) : judgeOutputSchema.parse(value);
}

export const ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA = z.toJSONSchema(
  judgeOutputSchema,
  { target: "draft-7" },
);

/** Bind the provider-facing schema to this immutable evaluation snapshot.
 *
 * Draft-7 cannot express a cross-field reference from evidenceIds to the
 * claims declared in the same object. New runs therefore reserve claim-1 to
 * claim-30 as claim coordinates in the wire schema, while the semantic
 * validator below still requires every referenced claim to exist and pass all
 * frozen-answer/source checks. The legacy static schema remains exported so
 * already-running operations can keep using the exact schema they started
 * with.
 */
export function enterpriseRagJudgeWireSchema(
  input: EnterpriseRagEvaluationFrozenInput,
) {
  const schema = structuredClone(input.schemaVersion === 2 ? z.toJSONSchema(gradedJudgeOutputSchema, { target: "draft-7" }) : ENTERPRISE_RAG_JUDGE_WIRE_SCHEMA) as Record<
    string,
    any
  >;
  const properties = schema.properties as Record<string, any>;
  properties.operationToken.enum = [input.operationToken];
  properties.inputHash.enum = [input.inputHash];

  const frozenEvidenceIds = Array.from(new Set(input.allowedEvidenceIds));
  const claimIds = ENTERPRISE_RAG_CLAIM_IDS.filter(
    (id) => !frozenEvidenceIds.includes(id),
  );
  const judgmentEvidenceIds = [...frozenEvidenceIds, ...claimIds];
  for (const key of ["dimensions", "gates"] as const) {
    properties[key].items.properties.evidenceIds.items.enum =
      judgmentEvidenceIds;
  }
  if (input.schemaVersion === 2) {
    properties.task.properties.evidenceIds.items.enum = judgmentEvidenceIds;
    const findings = properties.findings.items.properties;
    findings.evidenceIds.items.enum = judgmentEvidenceIds;
    findings.claimIds.items.enum = claimIds;
  }

  const claims = properties.claims.items.properties as Record<string, any>;
  claims.id.enum = claimIds;
  const frozenEvidence = new Set(frozenEvidenceIds);
  const sourceIds = Array.from(
    new Set(
      input.sources
        .map(({ id }) => id)
        .filter((id) => frozenEvidence.has(id)),
    ),
  );
  if (sourceIds.length) {
    claims.sourceIds.items.enum = sourceIds;
  } else {
    claims.sourceIds.maxItems = 0;
  }
  return schema;
}

export type EnterpriseRagJudgeOutput = z.infer<typeof judgeOutputSchema> | EnterpriseRagGradedJudgeOutput;

export type EnterpriseRagEvidenceAliasBinding = {
  alias: string;
  canonicalId: string;
  kind: "question" | "answer" | "source" | "evidence";
};

/** Frozen provider-facing ID projection. The model never needs to transcribe
 * long storage identifiers, while every accepted alias remains an exact,
 * server-owned capability for one canonical frozen ID. */
export type EnterpriseRagEvidenceAliasContract = {
  revision: "evidence-alias-v1";
  bindings: EnterpriseRagEvidenceAliasBinding[];
};

const evidenceAliasContractSchema = z.object({
  revision: z.literal("evidence-alias-v1"),
  bindings: z.array(z.object({
    alias: identifier,
    canonicalId: identifier,
    kind: z.enum(["question", "answer", "source", "evidence"]),
  }).strict()).min(1).max(10_000),
}).strict();

const EVIDENCE_ALIAS_CAPACITY = 10_000;

/** Encode every base-36 coordinate as three equal symbols in a fixed slot.
 * Two generated aliases therefore differ by at least three substitutions.
 * The deletion-signature check below additionally proves that no two members
 * of the concrete codebook are related by one deletion plus one insertion, so
 * every single-character insertion/deletion/substitution has at most one
 * legal alias candidate. */
const EVIDENCE_ALIAS_KIND_CODE: Record<
  EnterpriseRagEvidenceAliasBinding["kind"],
  string
> = {
  question: "QQQ",
  answer: "AAA",
  source: "SSS",
  evidence: "EEE",
};

function evidenceAlias(
  index: number,
  kind: EnterpriseRagEvidenceAliasBinding["kind"],
) {
  if (!Number.isInteger(index) || index < 0 || index >= EVIDENCE_ALIAS_CAPACITY) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结证据数量超出评估传输合同容量",
    );
  }
  const coordinate = index.toString(36).toUpperCase().padStart(3, "0");
  return `rag-${EVIDENCE_ALIAS_KIND_CODE[kind]}-${
    [...coordinate].map((symbol) => symbol.repeat(3)).join("-")
  }`;
}

function assertEvidenceAliasSeparation(
  bindings: readonly EnterpriseRagEvidenceAliasBinding[],
) {
  const deletionOwners = new Map<string, string>();
  for (const [bindingIndex, binding] of bindings.entries()) {
    if (binding.alias !== evidenceAlias(bindingIndex, binding.kind)) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估传输别名不符合防误码编码",
      );
    }
    for (let index = 0; index < binding.alias.length; index += 1) {
      const signature =
        binding.alias.slice(0, index) + binding.alias.slice(index + 1);
      const owner = deletionOwners.get(signature);
      if (owner && owner !== binding.alias) {
        throw new EnterpriseRagEvaluationValidationError(
          "评估传输别名未满足单字符错误隔离",
        );
      }
      deletionOwners.set(signature, binding.alias);
    }
  }
}

export function createEnterpriseRagEvidenceAliasContract(
  input: EnterpriseRagEvaluationFrozenInput,
): EnterpriseRagEvidenceAliasContract {
  const canonicalIds = input.allowedEvidenceIds;
  if (canonicalIds.length > EVIDENCE_ALIAS_CAPACITY) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结证据数量超出评估传输合同容量",
    );
  }
  const canonicalSet = new Set(canonicalIds);
  if (canonicalSet.size !== canonicalIds.length) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结证据标识重复，不能创建评估传输合同",
    );
  }
  if (canonicalIds.some((id) => ENTERPRISE_RAG_CLAIM_IDS.includes(id))) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结证据标识与评估陈述坐标冲突，不能创建评估传输合同",
    );
  }
  const questionId = `question:${input.questionMessageId}`;
  const answerId = `answer:${input.answerMessageId}`;
  if (!canonicalSet.has(questionId) || !canonicalSet.has(answerId)) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结问题或回答证据缺失，不能创建评估传输合同",
    );
  }
  const sourceIds = input.sources.map(({ id }) => id);
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !canonicalSet.has(id))
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "冻结来源与证据白名单不一致，不能创建评估传输合同",
    );
  }

  const bindings: EnterpriseRagEvidenceAliasBinding[] = [];
  const bind = (
    canonicalId: string,
    kind: EnterpriseRagEvidenceAliasBinding["kind"],
  ) => {
    bindings.push({
      alias: evidenceAlias(bindings.length, kind),
      canonicalId,
      kind,
    });
  };
  bind(questionId, "question");
  bind(answerId, "answer");
  for (const sourceId of sourceIds) bind(sourceId, "source");
  const alreadyBound = new Set(bindings.map(({ canonicalId }) => canonicalId));
  for (const canonicalId of canonicalIds) {
    if (alreadyBound.has(canonicalId)) continue;
    bind(canonicalId, "evidence");
    alreadyBound.add(canonicalId);
  }
  const aliases = new Set(bindings.map(({ alias }) => alias));
  const reserved = new Set([...canonicalIds, ...ENTERPRISE_RAG_CLAIM_IDS]);
  if (
    aliases.size !== bindings.length ||
    bindings.length !== canonicalIds.length ||
    bindings.some(({ alias }) =>
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(alias) || reserved.has(alias)
    )
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估传输别名发生冲突",
    );
  }
  assertEvidenceAliasSeparation(bindings);
  return { revision: "evidence-alias-v1", bindings };
}

export function validateEnterpriseRagEvidenceAliasContract(
  input: EnterpriseRagEvaluationFrozenInput,
  value: unknown,
): EnterpriseRagEvidenceAliasContract {
  const parsed = evidenceAliasContractSchema.safeParse(value);
  if (!parsed.success) {
    throw new EnterpriseRagEvaluationValidationError("评估传输合同缺失");
  }
  const expected = createEnterpriseRagEvidenceAliasContract(input);
  if (
    parsed.data.bindings.length !== expected.bindings.length ||
    parsed.data.bindings.some((binding, index) => {
      const frozen = expected.bindings[index];
      return !frozen ||
        binding.alias !== frozen.alias ||
        binding.canonicalId !== frozen.canonicalId ||
        binding.kind !== frozen.kind;
    })
  ) {
    throw new EnterpriseRagEvaluationValidationError("评估传输合同与冻结证据不一致");
  }
  return structuredClone(expected);
}

export function enterpriseRagAliasedInput(
  input: EnterpriseRagEvaluationFrozenInput,
  contract: EnterpriseRagEvidenceAliasContract,
): EnterpriseRagEvaluationFrozenInput {
  const frozen = validateEnterpriseRagEvidenceAliasContract(input, contract);
  const aliases = new Map(
    frozen.bindings.map(({ canonicalId, alias }) => [canonicalId, alias]),
  );
  return {
    ...structuredClone(input),
    sources: input.sources.map((source) => ({
      ...structuredClone(source),
      id: aliases.get(source.id)!,
    })),
    allowedEvidenceIds: input.allowedEvidenceIds.map((id) => aliases.get(id)!),
  };
}

export function enterpriseRagAliasedJudgeWireSchema(
  input: EnterpriseRagEvaluationFrozenInput,
  contract: EnterpriseRagEvidenceAliasContract,
) {
  return enterpriseRagJudgeWireSchema(enterpriseRagAliasedInput(input, contract));
}

export class EnterpriseRagEvaluationValidationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "semantic"
      | "unauthorized_identifier"
      | "repairable_identifier" = "semantic",
  ) {
    super(message);
    this.name = "EnterpriseRagEvaluationValidationError";
  }
}

export type EnterpriseRagJudgeValidationOptions = {
  /** Reserved claim coordinates for a bound schema. Null preserves the legacy
   * contract, where judgments may cite only frozen input evidence. */
  allowedClaimIds?: readonly string[] | null;
};

function exactOrderedIds(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function isSingleIdentifierEdit(left: string, right: string) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits === 1;
}

function identifierRepairCandidate(
  invalid: string,
  allowed: ReadonlySet<string>,
) {
  const candidates = [...allowed].filter((candidate) =>
    /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(candidate) &&
    !candidate.startsWith("claim-") &&
    isSingleIdentifierEdit(invalid, candidate)
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function identifierRepairHint(
  invalid: string,
  allowed: ReadonlySet<string>,
) {
  const candidate = identifierRepairCandidate(invalid, allowed);
  return candidate
    ? `；唯一一处字符编辑可达的合法 ID 是 ${JSON.stringify(candidate)}`
    : "";
}

/** Decode only exact frozen aliases. Unknown, approximate, or canonical IDs
 * fail closed before the canonical semantic validator is reached. */
export function decodeEnterpriseRagAliasedJudgeOutput(
  value: unknown,
  input: EnterpriseRagEvaluationFrozenInput,
  contract: EnterpriseRagEvidenceAliasContract,
): EnterpriseRagJudgeOutput {
  const parsed = parseJudgeOutput(value, input);
  const frozen = validateEnterpriseRagEvidenceAliasContract(input, contract);
  const canonicalByAlias = new Map(
    frozen.bindings.map(({ alias, canonicalId }) => [alias, canonicalId]),
  );
  const sourceAliases = new Set(
    frozen.bindings.filter(({ kind }) => kind === "source").map(({ alias }) => alias),
  );
  const evidenceAliases = new Set(frozen.bindings.map(({ alias }) => alias));
  const invalidAliases: Array<{
    path: string;
    label: string;
    candidate?: string;
  }> = [];
  const decode = (
    id: string,
    allowed: ReadonlySet<string>,
    path: string,
    label: string,
  ) => {
    if (!allowed.has(id)) {
      invalidAliases.push({
        path,
        label,
        candidate: identifierRepairCandidate(id, allowed),
      });
      return id;
    }
    return canonicalByAlias.get(id)!;
  };
  const decoded = {
    ...parsed,
    dimensions: parsed.dimensions.map((item, itemIndex) => ({
      ...item,
      evidenceIds: item.evidenceIds.map((id, evidenceIndex) =>
        ENTERPRISE_RAG_CLAIM_IDS.includes(id)
          ? id
          : decode(
              id,
              evidenceAliases,
              `dimensions[${itemIndex}].evidenceIds[${evidenceIndex}]`,
              "评估模型引用了未授权证据别名",
            )
      ),
    })),
    gates: parsed.gates.map((item, itemIndex) => ({
      ...item,
      evidenceIds: item.evidenceIds.map((id, evidenceIndex) =>
        ENTERPRISE_RAG_CLAIM_IDS.includes(id)
          ? id
          : decode(
              id,
              evidenceAliases,
              `gates[${itemIndex}].evidenceIds[${evidenceIndex}]`,
              "评估模型引用了未授权证据别名",
            )
      ),
    })),
    claims: parsed.claims.map((claim, claimIndex) => ({
      ...claim,
      sourceIds: claim.sourceIds.map((id, sourceIndex) =>
        decode(
          id,
          sourceAliases,
          `claims[${claimIndex}].sourceIds[${sourceIndex}]`,
          "评估陈述引用了未授权来源别名",
        )
      ),
    })),
  };
  if (isGradedRagJudgment(parsed)) {
    Object.assign(decoded, {
      task: { ...parsed.task, evidenceIds: parsed.task.evidenceIds.map((id, index) => ENTERPRISE_RAG_CLAIM_IDS.includes(id) ? id : decode(id, evidenceAliases, `task.evidenceIds[${index}]`, "任务引用了未授权证据别名")) },
      findings: parsed.findings.map((finding, index) => ({ ...finding,
        evidenceIds: finding.evidenceIds.map((id, evidenceIndex) => ENTERPRISE_RAG_CLAIM_IDS.includes(id) ? id : decode(id, evidenceAliases, `findings[${index}].evidenceIds[${evidenceIndex}]`, "问题引用了未授权证据别名")),
      })),
    });
  }
  if (invalidAliases.length) {
    const groups = new Map<string, {
      label: string;
      candidate?: string;
      paths: string[];
    }>();
    for (const issue of invalidAliases) {
      const key = `${issue.label}\u0000${issue.candidate ?? ""}`;
      const group = groups.get(key) ?? {
        label: issue.label,
        candidate: issue.candidate,
        paths: [],
      };
      group.paths.push(issue.path);
      groups.set(key, group);
    }
    const details = [...groups.values()].map((group) =>
      `${group.label}：${group.paths.join("、")} 不在冻结传输白名单中` +
      (group.candidate
        ? `；这些路径唯一一处字符编辑可达的合法 ID 是 ${JSON.stringify(group.candidate)}`
        : "；这些路径没有唯一的单字符合法候选")
    ).join("；");
    const repairable = invalidAliases.every(({ candidate }) => Boolean(candidate));
    throw new EnterpriseRagEvaluationValidationError(
      `${details}。不得复制上一轮这些字段的值；必须从冻结传输白名单逐字选择`,
      repairable ? "repairable_identifier" : "unauthorized_identifier",
    );
  }
  return decoded as EnterpriseRagJudgeOutput;
}

/** Validate the model's semantic coordinates before the existing deterministic
 * enterprise-rag-evaluation Skill is allowed to calculate a score. */
function validateGradedJudgments(
  value: EnterpriseRagGradedJudgeOutput,
  allowedEvidence: Set<string>,
  sources: Map<string, EnterpriseRagEvaluationSource>,
) {
  const fail = (message: string): never => { throw new EnterpriseRagEvaluationValidationError(message); };
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) fail(`${label}重复`);
  };
  const checkEvidence = (ids: string[]) => {
    unique(ids, "证据 ID");
    if (ids.some(id => !allowedEvidence.has(id))) fail("分级评估引用了未授权证据");
  };
  const gateByKind = { fact: "facts", condition: "facts", citation: "citations", task: "availability", privacy: "permissions", safety: "safety", injection: "injection", evidence: "unknown", expression: "availability" } as const;
  const claims = new Map(value.claims.map(claim => [claim.id, claim]));
  unique(value.findings.map(finding => finding.id), "问题 ID");
  checkEvidence(value.task.evidenceIds);
  for (const finding of value.findings) {
    checkEvidence(finding.evidenceIds);
    unique(finding.claimIds, "问题陈述 ID"); unique(finding.dimensionIds, "问题维度 ID");
    if (finding.claimIds.some(id => !claims.has(id))) fail("问题关联了不存在的陈述");
    if (finding.severity === "critical" && ["evidence", "expression"].includes(finding.kind)) fail("证据未知或表达问题不能直接升级为重大风险");
    if (finding.severity !== "undetermined" && finding.dimensionIds.some(id => value.dimensions.find(dimension => dimension.id === id)?.level === 4)) fail("已确认问题与对应维度满分矛盾");
    if (finding.severity === "critical" && ["fact", "citation"].includes(finding.kind) && !finding.claimIds.length) fail("重大事实或引用风险必须定位回答原句");
    if (finding.severity === "critical" && finding.kind === "fact" && !finding.claimIds.some(id => {
      const claim = claims.get(id);
      return claim?.kind === "fact" && claim.relevance === "core" && ["partial", "unsupported", "contradicted"].includes(claim.status);
    })) fail("重大事实风险必须对应核心事实缺口，不能把已充分支持的事实或核实建议升级为事实错误");
  }
  for (const dimension of value.dimensions) {
    const findings = value.findings.filter(finding => finding.dimensionIds.includes(dimension.id));
    if (dimension.level === null && !findings.some(finding => finding.severity === "undetermined")) fail("未判定维度缺少待补证项");
    if (dimension.level !== null && dimension.level < 4 && !findings.length) fail("扣分项缺少对应问题或改进理由");
  }
  for (const gate of value.gates) {
    const findings = value.findings.filter(finding => gateByKind[finding.kind] === gate.id);
    const critical = findings.some(finding => finding.severity === "critical");
    const unknown = findings.some(finding => finding.severity === "undetermined");
    const expected = critical ? "failed" : unknown ? "pending" : "passed";
    if (gate.status !== expected) fail("风险状态与问题严重程度不一致");
  }
  const taskFindings = value.findings.filter(finding => finding.kind === "task");
  if (value.task.status === "failed" && !taskFindings.some(finding => finding.severity === "critical")) fail("核心任务失败必须记录重大问题");
  if (value.task.status === "undetermined" && !taskFindings.some(finding => finding.severity === "undetermined")) fail("核心任务未知必须保留待核验");
  if (value.task.status === "completed" && taskFindings.some(finding => finding.severity !== "improvement")) fail("任务完成状态与问题记录矛盾");
  for (const claim of value.claims) {
    const findings = value.findings.filter(finding => finding.claimIds.includes(claim.id));
    unique(claim.sourceIds, "陈述来源 ID");
    if (claim.kind === "fact" && claim.status === "not_applicable") fail("事实陈述不能免除依据核验");
    if (claim.kind !== "fact" && claim.status !== "not_applicable") fail("建议与未知说明中的事实必须拆分核验");
    if (claim.status === "not_applicable" && claim.sourceIds.length) fail("非事实说明不应伪装成已核验事实");
    if (claim.status === "partial" && !claim.sourceIds.length) fail("部分支持必须定位实际支持的正文，不能用部分支持掩盖无依据事实");
    if (claim.status === "contradicted" && (!claim.sourceIds.length || claim.sourceIds.some(id => !sources.get(id)?.content))) fail("事实矛盾必须有可读取的反证");
    if (["partial", "unsupported", "contradicted", "unverifiable"].includes(claim.status) && !findings.length) fail("证据问题必须记录影响及严重程度");
    if (claim.status === "unverifiable" && !findings.some(finding => finding.severity === "undetermined")) fail("无法核验的陈述不能当作已确认正确或错误");
    if (claim.status === "unsupported" && ![...sources.values()].some(source => source.content)) fail("没有可读取的来源正文，不能确认事实无支持；应保留无法核验");
    if (claim.kind === "fact" && claim.relevance === "core" && ["unsupported", "contradicted"].includes(claim.status) && !findings.some(finding => finding.severity === "critical" && ["fact", "condition"].includes(finding.kind))) fail("无依据或矛盾的核心事实不能降级为轻微问题");
    if (claim.status === "partial" && claim.sourceIds.some(id => !sources.get(id)?.content) && !findings.some(finding => finding.severity === "undetermined")) fail("来源正文缺失必须保留未知");
    if (claim.kind === "fact" && claim.sourceIds.some(id => sources.get(id)?.citedByAnswer !== true) && !findings.some(finding => finding.kind === "citation")) fail("依据未展示为引用时须保留引用改进或风险项");
  }
}

export function validateEnterpriseRagJudgeOutput(
  value: unknown,
  input: EnterpriseRagEvaluationFrozenInput,
  options: EnterpriseRagJudgeValidationOptions = {},
): EnterpriseRagJudgeOutput {
  const expected = input.schemaVersion === 2
    ? { skillVersion: "2.0.0", judgeVersion: "2.0.0", ruleVersion: "rag-eval-1.3" }
    : { skillVersion: "1.0.0", judgeVersion: "1.0.0", ruleVersion: "rag-eval-1.2" };
  if (![1, 2].includes(input.schemaVersion) || Object.entries(expected).some(([key, version]) => input.evaluator[key as keyof typeof expected] !== version)) {
    throw new EnterpriseRagEvaluationValidationError("不支持或混用了冻结评估版本，不能套用当前规则");
  }
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 512 * 1024) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型结果超过大小限制",
    );
  }
  const parsed = parseJudgeOutput(value, input);
  if (
    parsed.operationToken !== input.operationToken ||
    parsed.inputHash !== input.inputHash
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型结果不属于本次任务",
    );
  }
  if (
    !exactOrderedIds(
      parsed.dimensions.map(({ id }) => id),
      ENTERPRISE_RAG_DIMENSION_IDS,
    ) ||
    !exactOrderedIds(
      parsed.gates.map(({ id }) => id),
      ENTERPRISE_RAG_GATE_IDS,
    )
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "评估模型没有按锁定顺序完整返回评分项",
    );
  }
  const frozenEvidence = new Set(input.allowedEvidenceIds);
  const allowedClaimIds = options.allowedClaimIds === null
    ? null
    : new Set(options.allowedClaimIds ?? ENTERPRISE_RAG_CLAIM_IDS);
  const allowedSources = new Map(input.sources.map((source) => [source.id, source]));
  const claimIds = new Set<string>();
  for (const [claimIndex, claim] of parsed.claims.entries()) {
    if (claimIds.has(claim.id)) {
      throw new EnterpriseRagEvaluationValidationError("评估陈述标识重复");
    }
    if (allowedClaimIds && frozenEvidence.has(claim.id)) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估陈述标识与冻结证据冲突",
      );
    }
    if (allowedClaimIds && !allowedClaimIds.has(claim.id)) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估陈述标识不在允许范围",
      );
    }
    claimIds.add(claim.id);
    if (!input.answer.includes(claim.statement)) {
      throw new EnterpriseRagEvaluationValidationError(
        "评估陈述不是回答中的连续原文",
      );
    }
    const invalidSourceIndex = claim.sourceIds.findIndex(
      (id) => !allowedSources.has(id) || !frozenEvidence.has(id),
    );
    if (invalidSourceIndex >= 0) {
      const invalidSourceId = claim.sourceIds[invalidSourceIndex]!;
      const allowedSourceIds = new Set(
        [...allowedSources.keys()].filter((id) => frozenEvidence.has(id)),
      );
      const repairHint = identifierRepairHint(invalidSourceId, allowedSourceIds);
      throw new EnterpriseRagEvaluationValidationError(
        `评估陈述引用了未授权来源：claims[${claimIndex}].sourceIds[${invalidSourceIndex}] 不在冻结白名单中` +
          `${repairHint}。不得复制上一轮该字段的值；必须在所有字段中重新从冻结白名单逐字选择，且重新核对来源正文；无法确认来源时使用空数组并按无来源重新评定`,
        repairHint ? "repairable_identifier" : "unauthorized_identifier",
      );
    }
    if (
      claim.status === "supported" &&
      (!claim.sourceIds.length ||
        claim.sourceIds.some((id) => !allowedSources.get(id)?.content))
    ) {
      throw new EnterpriseRagEvaluationValidationError(
        "充分支持的陈述缺少可读取的冻结来源",
      );
    }
    if (claim.status === "unsupported" && claim.sourceIds.length) {
      throw new EnterpriseRagEvaluationValidationError(
        "无支持陈述不得附带来源",
      );
    }
  }
  const allowedJudgmentEvidence = new Set([
    ...frozenEvidence,
    ...(allowedClaimIds ? claimIds : []),
  ]);
  const judgmentItems = [
    ...parsed.dimensions.map((item, index) => ({ item, path: `dimensions[${index}]` })),
    ...parsed.gates.map((item, index) => ({ item, path: `gates[${index}]` })),
  ];
  for (const { item, path } of judgmentItems) {
    const invalidEvidenceIndex = item.evidenceIds.findIndex(
      (id) => !allowedJudgmentEvidence.has(id),
    );
    if (invalidEvidenceIndex >= 0) {
      const invalidEvidenceId = item.evidenceIds[invalidEvidenceIndex]!;
      const repairHint = identifierRepairHint(invalidEvidenceId, frozenEvidence);
      throw new EnterpriseRagEvaluationValidationError(
        `评估模型引用了未授权证据：${path}.evidenceIds[${invalidEvidenceIndex}] 不在冻结白名单中` +
          `${repairHint}。不得复制上一轮该字段的值；必须在所有字段中重新从冻结白名单逐字选择`,
        repairHint ? "repairable_identifier" : "unauthorized_identifier",
      );
    }
  }
  if (isGradedRagJudgment(parsed)) {
    validateGradedJudgments(parsed, allowedJudgmentEvidence, allowedSources);
    return parsed;
  }
  const dimensions = new Map(parsed.dimensions.map((item) => [item.id, item]));
  const gates = new Map(parsed.gates.map((item) => [item.id, item]));
  const hasUnsupportedClaim = parsed.claims.some(
    ({ status }) => status === "unsupported",
  );
  const hasPartialClaim = parsed.claims.some(({ status }) => status === "partial");
  const hasUncitedClaimEvidence = parsed.claims.some((claim) =>
    claim.sourceIds.some((id) => allowedSources.get(id)?.citedByAnswer !== true),
  );
  if (
    hasUnsupportedClaim &&
    (gates.get("facts")?.status !== "failed" ||
      gates.get("citations")?.status !== "failed" ||
      (dimensions.get("correctness")?.level ?? 4) > 2 ||
      (dimensions.get("citations")?.level ?? 4) > 2)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "无支持陈述与事实、引用门禁或评分不一致",
    );
  }
  if (
    hasPartialClaim &&
    (gates.get("citations")?.status !== "failed" ||
      (dimensions.get("correctness")?.level ?? 4) >= 4 ||
      (dimensions.get("citations")?.level ?? 4) >= 4)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "部分支持陈述与引用门禁或评分不一致",
    );
  }
  if (
    hasUncitedClaimEvidence &&
    (gates.get("citations")?.status !== "failed" ||
      (dimensions.get("citations")?.level ?? 4) > 2)
  ) {
    throw new EnterpriseRagEvaluationValidationError(
      "陈述依据未被回答引用，但引用门禁或评分仍标记为通过",
    );
  }
  return parsed;
}

export type EnterpriseRagEvaluationResultPayload = {
  answerVerdict?: "usable" | "usable_with_improvements" | "unusable" | "pending";
  skillId: string;
  version: string;
  status: "not_run" | "pending" | "completed" | "failed";
  score: number | null;
  coverage: number;
  recommendation:
    | "recommended"
    | "publish_with_risk"
    | "not_recommended";
  summary: string;
  dimensions: Array<{
    id: string;
    label: string;
    status: "passed" | "partial" | "failed" | "pending" | "not_applicable";
    score: number | null;
    maxScore: number;
    summary: string;
    evidenceIds: string[];
  }>;
  risks: Array<{
    id: string;
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    summary: string;
    evidenceIds: string[];
  }>;
  relatedReportIds: string[];
};

export type EnterpriseRagEvaluationReport = {
  reportId: string;
  sourceQaTaskId: string;
  sourceTurnId: string;
  conversationId: string;
  questionMessageId: string;
  answerMessageId: string;
  questionHash: string;
  answerHash: string;
  knowledgeBase: EnterpriseRagEvaluationFrozenInput["knowledgeBase"];
  evaluator: EnterpriseRagEvaluationFrozenInput["evaluator"] & {
    provider: string;
    model: string;
    effort: string | null;
    skillHash: string;
    outputHash: string;
  };
  judgments: EnterpriseRagJudgeOutput;
  result: EnterpriseRagEvaluationResultPayload;
  createdAt: string;
  completedAt: string;
};

export type EnterpriseRagEvaluationRunDto = {
  operationId: string;
  sourceQaTaskId: string;
  turnId: string;
  status:
    | "queued"
    | "uploading"
    | "create_unknown"
    | "running"
    | "result_pending"
    | "completed"
    | "failed";
  createdAt: string;
  updatedAt: string;
  report: EnterpriseRagEvaluationReport | null;
  error: { code: string; message: string } | null;
};

export type EnterpriseRagEvaluationStartInput = {
  clientRequestId: string;
  sourceQaTaskId: string;
  turnId: string;
};

export type EnterpriseRagEvaluationHistoryDto = {
  latest: EnterpriseRagEvaluationRunDto | null;
  history: EnterpriseRagEvaluationRunDto[];
};
