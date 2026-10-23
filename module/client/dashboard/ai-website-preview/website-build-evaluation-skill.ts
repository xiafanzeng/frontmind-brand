import type { EvaluationResult, EvaluationSkill } from "./evaluation-skill-contract";

export const WEBSITE_BUILD_EVALUATION_SKILL_ID = "website-build-evaluation";
export const WEBSITE_BUILD_EVALUATION_SKILL_VERSION = "1.0.0";

export type WebsiteBuildEvaluationDimensionId =
  | "content-experience"
  | "facts-public-boundary"
  | "flow-release-clarity";

export type WebsiteBuildEvaluationCheckStatus =
  | "passed"
  | "partial"
  | "failed"
  | "pending"
  | "not_applicable";

export type WebsiteBuildEvaluationRiskSeverity = "low" | "medium" | "high" | "critical";

export interface WebsiteBuildEvaluationCheckDefinition {
  readonly id: string;
  readonly dimensionId: WebsiteBuildEvaluationDimensionId;
  readonly title: string;
  readonly description: string;
  readonly weight: number;
  readonly critical: boolean;
  readonly riskSeverity: WebsiteBuildEvaluationRiskSeverity;
}

export interface WebsiteBuildEvaluationDimensionDefinition {
  readonly id: WebsiteBuildEvaluationDimensionId;
  readonly label: string;
  readonly weight: number;
}

export const WEBSITE_BUILD_EVALUATION_DIMENSIONS = [
  { id: "content-experience", label: "网站内容与体验", weight: 40 },
  { id: "facts-public-boundary", label: "网站事实与公开边界", weight: 40 },
  { id: "flow-release-clarity", label: "流程与发布说明", weight: 20 },
] as const satisfies readonly WebsiteBuildEvaluationDimensionDefinition[];

/**
 * Website-only checks. Enterprise RAG quality is intentionally absent: a RAG
 * evaluation may be referenced through relatedReportIds, but it never earns or
 * removes points in this skill.
 */
export const WEBSITE_BUILD_EVALUATION_CHECKS = [
  {
    id: "website-content-structure",
    dimensionId: "content-experience",
    title: "版本、目标问题覆盖与信息结构",
    description: "网站版本、目标访客问题、栏目与正文结构有可追溯的检查证据。",
    weight: 20,
    critical: false,
    riskSeverity: "medium",
  },
  {
    id: "website-navigation-contact",
    dimensionId: "content-experience",
    title: "导航与联系入口",
    description: "逐页验证导航、返回路径和联系入口可达。",
    weight: 10,
    critical: false,
    riskSeverity: "medium",
  },
  {
    id: "website-responsive-accessibility",
    dimensionId: "content-experience",
    title: "窄屏与键盘可用性",
    description: "留存窄屏、键盘焦点、语义结构和可读性的检查证据。",
    weight: 10,
    critical: false,
    riskSeverity: "medium",
  },
  {
    id: "website-facts-evidence",
    dimensionId: "facts-public-boundary",
    title: "网站企业事实与证据",
    description: "网站静态页面中的身份、产品与能力声明绑定可追溯来源。",
    weight: 20,
    critical: true,
    riskSeverity: "critical",
  },
  {
    id: "website-public-boundary",
    dimensionId: "facts-public-boundary",
    title: "网站公开范围与来源呈现",
    description: "网站公开可见内容、访问范围和页面来源呈现经过核验。",
    weight: 20,
    critical: true,
    riskSeverity: "critical",
  },
  {
    id: "website-flow-recovery",
    dimensionId: "flow-release-clarity",
    title: "建站流程、反馈与失败恢复",
    description: "建设步骤、操作反馈和失败后的恢复路径经过走查。",
    weight: 15,
    critical: false,
    riskSeverity: "medium",
  },
  {
    id: "website-draft-release-state",
    dimensionId: "flow-release-clarity",
    title: "草稿、发布与正式生效说明",
    description: "页面清楚区分草稿确认、发布操作、部署成功与公开访问状态。",
    weight: 5,
    critical: true,
    riskSeverity: "high",
  },
] as const satisfies readonly WebsiteBuildEvaluationCheckDefinition[];

export type WebsiteBuildEvaluationCheckId = typeof WEBSITE_BUILD_EVALUATION_CHECKS[number]["id"];

export interface WebsiteBuildEvaluationJudgment {
  readonly checkId: WebsiteBuildEvaluationCheckId;
  readonly status: WebsiteBuildEvaluationCheckStatus;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
}

export interface WebsiteBuildEvaluationInput {
  readonly judgments: readonly WebsiteBuildEvaluationJudgment[];
  /** References only. Their scores and recommendations never affect this result. */
  readonly relatedReportIds?: readonly string[];
}

export type WebsiteBuildEvaluationOutput = EvaluationResult;

type ResolvedCheck = {
  readonly definition: WebsiteBuildEvaluationCheckDefinition;
  readonly status: WebsiteBuildEvaluationCheckStatus;
  readonly summary: string;
  readonly evidenceIds: string[];
  readonly evidenceBacked: boolean;
};

const STATUS_COEFFICIENT: Record<Exclude<WebsiteBuildEvaluationCheckStatus, "not_applicable">, number> = {
  passed: 1,
  partial: 0.5,
  failed: 0,
  pending: 0,
};
const VALID_CHECK_STATUSES = new Set<WebsiteBuildEvaluationCheckStatus>([
  "passed",
  "partial",
  "failed",
  "pending",
  "not_applicable",
]);

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const rounded = (value: number) => Math.round(value * 100) / 100;

function uniqueNonempty(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter(nonempty).map((value) => value.trim())));
}

function pendingCheck(definition: WebsiteBuildEvaluationCheckDefinition): ResolvedCheck {
  return {
    definition,
    status: "pending",
    summary: "尚未提供判断与证据。",
    evidenceIds: [],
    evidenceBacked: false,
  };
}

function resolveChecks(input: WebsiteBuildEvaluationInput): { checks: ResolvedCheck[]; invalidInput: boolean } {
  const judgments = Array.isArray(input?.judgments) ? input.judgments : [];
  const knownIds = new Set<string>(WEBSITE_BUILD_EVALUATION_CHECKS.map(({ id }) => id));
  let invalidInput = judgments.some((judgment) => !judgment || !knownIds.has(judgment.checkId));

  const checks = WEBSITE_BUILD_EVALUATION_CHECKS.map((definition): ResolvedCheck => {
    const matches = judgments.filter((judgment) => judgment?.checkId === definition.id);
    if (matches.length === 0) return pendingCheck(definition);
    if (matches.length !== 1) {
      invalidInput = true;
      return pendingCheck(definition);
    }

    const judgment = matches[0];
    if (
      !VALID_CHECK_STATUSES.has(judgment.status) ||
      typeof judgment.summary !== "string" ||
      !Array.isArray(judgment.evidenceIds)
    ) {
      invalidInput = true;
      return pendingCheck(definition);
    }
    const summary = nonempty(judgment.summary) ? judgment.summary.trim() : "";
    const evidenceIds = uniqueNonempty(judgment.evidenceIds);
    if (judgment.status === "not_applicable") {
      // Version 1.0 has a fixed 100-point website scope. Allowing callers to
      // remove arbitrary weights would make dimension totals contradict the
      // overall normalized score, so N/A is rejected until a locked scope
      // policy is introduced in a future version.
      invalidInput = true;
      return {
        definition,
        status: "pending",
        summary: "当前版本采用固定评分范围，不接受临时标记为不适用。",
        evidenceIds,
        evidenceBacked: false,
      };
    }

    const evidenceBacked = summary.length > 0 && evidenceIds.length > 0;
    if (!evidenceBacked || judgment.status === "pending") {
      return {
        definition,
        status: "pending",
        summary: summary || "判断依据待补充。",
        evidenceIds,
        evidenceBacked: false,
      };
    }

    return { definition, status: judgment.status, summary, evidenceIds, evidenceBacked: true };
  });

  return { checks, invalidInput };
}

function dimensionStatus(checks: readonly ResolvedCheck[]): WebsiteBuildEvaluationCheckStatus {
  const applicable = checks.filter(({ status }) => status !== "not_applicable");
  if (applicable.length === 0) return "not_applicable";
  if (applicable.some(({ status }) => status === "pending")) return "pending";
  if (applicable.some(({ status }) => status === "failed")) return "failed";
  if (applicable.some(({ status }) => status === "partial")) return "partial";
  return "passed";
}

function evaluateWebsiteBuild(input: WebsiteBuildEvaluationInput): WebsiteBuildEvaluationOutput {
  const { checks, invalidInput } = resolveChecks(input);
  const relatedReportIds = uniqueNonempty(input?.relatedReportIds);
  const applicable = checks.filter(({ status }) => status !== "not_applicable");
  const applicableWeight = applicable.reduce((sum, { definition }) => sum + definition.weight, 0);
  const judged = applicable.filter(({ evidenceBacked, status }) => evidenceBacked && status !== "pending");
  const judgedWeight = judged.reduce((sum, { definition }) => sum + definition.weight, 0);
  const earnedWeight = applicable.reduce((sum, { definition, status, evidenceBacked }) => {
    if (!evidenceBacked || status === "not_applicable") return sum;
    return sum + definition.weight * STATUS_COEFFICIENT[status];
  }, 0);
  const coverage = applicableWeight > 0 ? rounded(100 * judgedWeight / applicableWeight) : 0;
  const score = invalidInput || applicableWeight === 0
    ? null
    : rounded(100 * earnedWeight / applicableWeight);

  const dimensions = WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension) => {
    const dimensionChecks = checks.filter(({ definition }) => definition.dimensionId === dimension.id);
    const earned = dimensionChecks.reduce((sum, { definition, status, evidenceBacked }) => {
      if (!evidenceBacked || status === "not_applicable") return sum;
      return sum + definition.weight * STATUS_COEFFICIENT[status];
    }, 0);
    const judgedCount = dimensionChecks.filter(({ evidenceBacked, status }) => evidenceBacked && status !== "pending" && status !== "not_applicable").length;
    const pendingCount = dimensionChecks.filter(({ status }) => status === "pending").length;
    return {
      id: dimension.id,
      label: dimension.label,
      status: dimensionStatus(dimensionChecks),
      score: rounded(earned),
      maxScore: dimension.weight,
      summary: `${judgedCount}/${dimensionChecks.length} 项已有证据判定${pendingCount > 0 ? `，${pendingCount} 项待补证` : ""}。`,
      evidenceIds: uniqueNonempty(dimensionChecks.flatMap(({ evidenceIds }) => evidenceIds)),
    };
  });

  const risks = checks
    .filter(({ definition, status }) => definition.critical && status !== "passed" && status !== "not_applicable")
    .map(({ definition, status, summary, evidenceIds }) => ({
      id: `risk-${definition.id}`,
      severity: status === "failed" ? definition.riskSeverity : "high" as const,
      title: `${definition.title}${status === "pending" ? "待核验" : "存在风险"}`,
      summary,
      evidenceIds,
    }));
  if (invalidInput || applicableWeight === 0) {
    risks.unshift({
      id: "risk-website-evaluation-input",
      severity: "critical",
      title: "网站评估输入无效",
      summary: "检查项存在未知、重复或无有效适用范围的记录，请修正输入后重新评估。",
      evidenceIds: [],
    });
  }

  const noJudgments = checks.every(({ status }) => status === "pending");
  const status = invalidInput || applicableWeight === 0
    ? "failed"
    : noJudgments
      ? "not_run"
      : coverage < 100
        ? "pending"
        : "completed";
  const hasCriticalRisk = risks.some(({ severity }) => severity === "critical");
  const recommendation = hasCriticalRisk || score === null || score < 70
    ? "not_recommended"
    : coverage < 100 || score < 85 || risks.length > 0
      ? "publish_with_risk"
      : "recommended";
  const summary = status === "not_run"
    ? "网站建设评估尚未执行；可按需评估，结果仅提供质量建议。"
    : status === "failed"
      ? "网站建设评估输入无效，当前无法形成可信的质量分。"
      : recommendation === "recommended"
        ? "网站检查已完成，当前质量结果建议发布。"
        : recommendation === "publish_with_risk"
          ? "网站仍有待补证或改进项，可在了解风险后发布。"
          : "网站存在重要质量风险，当前不建议发布；该建议不会代替发布决定。";

  return {
    skillId: WEBSITE_BUILD_EVALUATION_SKILL_ID,
    version: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
    status,
    score: status === "not_run" ? null : score,
    coverage,
    recommendation,
    summary,
    dimensions,
    risks,
    relatedReportIds,
  };
}

export const websiteBuildEvaluationSkill = {
  skillId: WEBSITE_BUILD_EVALUATION_SKILL_ID,
  version: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
  evaluate: evaluateWebsiteBuild,
} satisfies EvaluationSkill<WebsiteBuildEvaluationInput>;
