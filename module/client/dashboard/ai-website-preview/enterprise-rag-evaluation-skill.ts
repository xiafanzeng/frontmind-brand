import type { EvaluationResult, EvaluationSkill } from "./evaluation-skill-contract.js";
import {
  RAG_DIMENSIONS,
  RAG_GATES,
  RAG_RULE_VERSION,
  scoreEvaluation,
  type EvaluationInput,
} from "./rag-evaluation.js";

export const ENTERPRISE_RAG_EVALUATION_SKILL_ID = "enterprise-rag-evaluation";
export const ENTERPRISE_RAG_EVALUATION_SKILL_VERSION = "1.0.0";

export interface EnterpriseRagEvaluationInput extends EvaluationInput {
  /** Immutable report references only; they do not change this evaluation. */
  relatedReportIds?: readonly string[];
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const uniqueIds = (values: readonly string[] | undefined) =>
  Array.from(new Set((values ?? []).filter(nonempty).map((value) => value.trim())));

function evaluateEnterpriseRag(input: EnterpriseRagEvaluationInput): EvaluationResult {
  const dimensionsInput = Array.isArray(input?.dimensions) ? input.dimensions : [];
  const gatesInput = Array.isArray(input?.gates) ? input.gates : [];
  const knownDimensionIds = new Set<string>(RAG_DIMENSIONS.map(({ id }) => id));
  const knownGateIds = new Set<string>(RAG_GATES.map(({ id }) => id));
  const duplicateDimensionIds = RAG_DIMENSIONS
    .filter(({ id }) => dimensionsInput.filter((item) => item?.id === id).length > 1)
    .map(({ id }) => id);
  const duplicateGateIds = RAG_GATES
    .filter(({ id }) => gatesInput.filter((item) => item?.id === id).length > 1)
    .map(({ id }) => id);
  const unknownDimensionIds = uniqueIds(dimensionsInput
    .filter((item) => !item || !knownDimensionIds.has(item.id))
    .map((item) => nonempty(item?.id) ? item.id : "missing-id"));
  const unknownGateIds = uniqueIds(gatesInput
    .filter((item) => !item || !knownGateIds.has(item.id))
    .map((item) => nonempty(item?.id) ? item.id : "missing-id"));
  const configurationIssues = [
    duplicateDimensionIds.length > 0 ? `重复维度：${duplicateDimensionIds.join("、")}` : "",
    unknownDimensionIds.length > 0 ? `未知维度：${unknownDimensionIds.join("、")}` : "",
    duplicateGateIds.length > 0 ? `重复门禁：${duplicateGateIds.join("、")}` : "",
    unknownGateIds.length > 0 ? `未知门禁：${unknownGateIds.join("、")}` : "",
  ].filter(nonempty);
  const scored = scoreEvaluation({ dimensions: dimensionsInput, gates: gatesInput });
  const hasAnyJudgment = configurationIssues.length > 0 || dimensionsInput.some((item) =>
    item?.applicable === false || item?.level !== null || nonempty(item?.rationale) || (Array.isArray(item?.evidenceIds) && item.evidenceIds.some(nonempty)),
  ) || gatesInput.some((item) => item?.status !== "pending" || nonempty(item?.reason));

  const dimensions = RAG_DIMENSIONS.map((definition) => {
    const matches = dimensionsInput.filter((item) => item?.id === definition.id);
    const judgment = matches.length === 1 ? matches[0] : undefined;
    const earned = scored.earnedByDimension[definition.id];
    const status = judgment?.applicable === false && nonempty(judgment.rationale)
      ? "not_applicable" as const
      : earned === null
        ? "pending" as const
        : (judgment?.level ?? 0) >= 4
          ? "passed" as const
          : (judgment?.level ?? 0) >= 2
            ? "partial" as const
            : "failed" as const;
    return {
      id: definition.id,
      label: definition.label,
      status,
      score: earned,
      maxScore: definition.weight,
      summary: judgment?.rationale.trim() || "尚未提供判断依据。",
      evidenceIds: uniqueIds(judgment?.evidenceIds),
    };
  });

  const gateRisks = RAG_GATES.flatMap((definition) => {
    const matches = gatesInput.filter((item) => item?.id === definition.id);
    const failed = matches.find((item) => item.status === "failed");
    const judgment = failed ?? (matches.length === 1 ? matches[0] : undefined);
    if (matches.length === 1 && judgment?.status === "passed") return [];
    const pending = !failed;
    return [{
      id: `risk-rag-${definition.id}`,
      severity: pending ? "high" as const : "critical" as const,
      title: `${definition.label}${pending ? "待核验" : "存在关键风险"}`,
      summary: nonempty(judgment?.reason) ? judgment.reason.trim() : definition.description,
      evidenceIds: [],
    }];
  });
  const risks: EvaluationResult["risks"] = [
    ...(configurationIssues.length > 0 ? [{
      id: "risk-rag-evaluation-input",
      severity: "critical" as const,
      title: "企业 RAG 评估输入配置异常",
      summary: `${configurationIssues.join("；")}。请修正输入后重新评估。`,
      evidenceIds: [],
    }] : []),
    ...gateRisks,
  ];

  const status = !hasAnyJudgment
    ? "not_run" as const
    : scored.complete
      ? "completed" as const
      : "pending" as const;
  const hasCriticalRisk = risks.some(({ severity }) => severity === "critical");
  const recommendation = hasCriticalRisk || scored.gateStatus === "failed" || scored.rawScore === null || scored.rawScore < 70
    ? "not_recommended" as const
    : !scored.complete || scored.rawScore < 85 || risks.length > 0
      ? "publish_with_risk" as const
      : "recommended" as const;
  const summary = status === "not_run"
    ? "企业 RAG 评估尚未执行；结果仅用于回答质量建议。"
    : recommendation === "recommended"
      ? "当前回答质量达到建议目标；发布决定仍由用户单独确认。"
      : recommendation === "publish_with_risk"
        ? "回答仍有待改进或补证项；可在了解风险后自行决定是否发布。"
        : "回答存在重要质量风险，当前不建议发布；该建议不会取消发布选择。";

  return {
    skillId: ENTERPRISE_RAG_EVALUATION_SKILL_ID,
    version: ENTERPRISE_RAG_EVALUATION_SKILL_VERSION,
    status,
    score: status === "not_run" ? null : scored.score,
    coverage: scored.coverage,
    recommendation,
    summary: `${summary}（规则 ${RAG_RULE_VERSION}）`,
    dimensions,
    risks,
    relatedReportIds: uniqueIds(input?.relatedReportIds),
  };
}

export const enterpriseRagEvaluationSkill = {
  skillId: ENTERPRISE_RAG_EVALUATION_SKILL_ID,
  version: ENTERPRISE_RAG_EVALUATION_SKILL_VERSION,
  evaluate: evaluateEnterpriseRag,
} satisfies EvaluationSkill<EnterpriseRagEvaluationInput>;
