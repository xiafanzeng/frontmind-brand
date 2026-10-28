export const EVALUATION_STATUSES = [
  "not_run",
  "pending",
  "completed",
  "failed",
] as const;

export const EVALUATION_RECOMMENDATIONS = [
  "recommended",
  "publish_with_risk",
  "not_recommended",
] as const;

export const EVALUATION_DIMENSION_STATUSES = [
  "passed",
  "partial",
  "failed",
  "pending",
  "not_applicable",
] as const;

export const EVALUATION_RISK_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];
export type EvaluationRecommendation =
  (typeof EVALUATION_RECOMMENDATIONS)[number];
export type EvaluationDimensionStatus =
  (typeof EVALUATION_DIMENSION_STATUSES)[number];
export type EvaluationRiskSeverity =
  (typeof EVALUATION_RISK_SEVERITIES)[number];

export interface EvaluationDimension {
  id: string;
  label: string;
  status: EvaluationDimensionStatus;
  score: number | null;
  maxScore: number;
  summary: string;
  evidenceIds: string[];
}

export interface EvaluationRisk {
  id: string;
  severity: EvaluationRiskSeverity;
  title: string;
  summary: string;
  evidenceIds: string[];
}

/**
 * One evaluator's advisory result. Publication authority deliberately does not
 * cross this contract: callers may use the recommendation to inform a user,
 * but must make and persist a publication decision separately.
 */
export interface EvaluationResult {
  answerVerdict?: "usable" | "usable_with_improvements" | "unusable" | "pending";
  skillId: string;
  version: string;
  status: EvaluationStatus;
  score: number | null;
  coverage: number;
  recommendation: EvaluationRecommendation;
  summary: string;
  dimensions: EvaluationDimension[];
  risks: EvaluationRisk[];
  /** Explicit immutable report references only; never infer a relation by recency. */
  relatedReportIds: string[];
}

/** A Skill is executable code, not just metadata or a prompt document. */
export interface EvaluationSkill<Input> {
  readonly skillId: string;
  readonly version: string;
  evaluate(input: Input): EvaluationResult | Promise<EvaluationResult>;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/u;
const forbiddenPublicationFields = new Set([
  "canPublish",
  "canConfirm",
  "publishAllowed",
  "blockingRelease",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isText(value: unknown, maximum = 4_096): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function parseIdentifiers(value: unknown, maximum = 100): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const identifiers: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isIdentifier(item) || seen.has(item)) return null;
    seen.add(item);
    identifiers.push(item);
  }
  return identifiers;
}

function parseEvidenceReferences(value: unknown, maximum = 100): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const references: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const reference = item.trim();
    if (!reference || reference.length > 512 || seen.has(reference)) return null;
    seen.add(reference);
    references.push(reference);
  }
  return references;
}

function parseDimension(value: unknown): EvaluationDimension | null {
  if (!isRecord(value)) return null;
  const score = value.score;
  const maxScore = value.maxScore;
  const evidenceIds = parseEvidenceReferences(value.evidenceIds);
  if (
    !isIdentifier(value.id) ||
    !isText(value.label, 240) ||
    !value.label.trim() ||
    !isOneOf(value.status, EVALUATION_DIMENSION_STATUSES) ||
    !isFiniteRange(maxScore, 0.000_001, 100) ||
    (score !== null && !isFiniteRange(score, 0, maxScore)) ||
    (value.status === "not_applicable" && score !== null) ||
    !isText(value.summary) ||
    evidenceIds === null
  ) {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    status: value.status,
    score,
    maxScore,
    summary: value.summary,
    evidenceIds,
  };
}

function parseRisk(value: unknown): EvaluationRisk | null {
  if (!isRecord(value)) return null;
  const evidenceIds = parseEvidenceReferences(value.evidenceIds);
  if (
    !isIdentifier(value.id) ||
    !isOneOf(value.severity, EVALUATION_RISK_SEVERITIES) ||
    !isText(value.title, 240) ||
    !value.title.trim() ||
    !isText(value.summary) ||
    evidenceIds === null
  ) {
    return null;
  }
  return {
    id: value.id,
    severity: value.severity,
    title: value.title,
    summary: value.summary,
    evidenceIds,
  };
}

function parseUniqueRecords<Item>(
  value: unknown,
  parser: (item: unknown) => Item | null,
  maximum = 100,
): Item[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed: Item[] = [];
  const identifiers = new Set<string>();
  for (const item of value) {
    const result = parser(item);
    const id = isRecord(result) ? result.id : undefined;
    if (!result || !isIdentifier(id) || identifiers.has(id)) return null;
    identifiers.add(id);
    parsed.push(result);
  }
  return parsed;
}

/** Parse untrusted or persisted evaluator output into a detached value. */
export function parseEvaluationResult(value: unknown): EvaluationResult | null {
  if (!isRecord(value)) return null;
  if (value.answerVerdict !== undefined && !isOneOf(value.answerVerdict, ["usable", "usable_with_improvements", "unusable", "pending"] as const)) return null;
  if ([...forbiddenPublicationFields].some((field) => field in value)) {
    return null;
  }
  const dimensions = parseUniqueRecords(value.dimensions, parseDimension);
  const risks = parseUniqueRecords(value.risks, parseRisk);
  const relatedReportIds = parseIdentifiers(value.relatedReportIds);
  if (
    !isIdentifier(value.skillId) ||
    !isIdentifier(value.version) ||
    !isOneOf(value.status, EVALUATION_STATUSES) ||
    (value.score !== null && !isFiniteRange(value.score, 0, 100)) ||
    !isFiniteRange(value.coverage, 0, 100) ||
    !isOneOf(value.recommendation, EVALUATION_RECOMMENDATIONS) ||
    !isText(value.summary) ||
    dimensions === null ||
    risks === null ||
    relatedReportIds === null
  ) {
    return null;
  }
  const stateIsConsistent = value.status === "not_run"
    ? value.score === null && value.coverage === 0 && value.recommendation === "not_recommended"
    : value.status === "failed"
      ? value.score === null && value.recommendation === "not_recommended"
      : value.status === "completed"
        ? value.score !== null && value.coverage === 100 && dimensions.every(({ status }) => status !== "pending")
        : value.recommendation !== "recommended";
  const recommendationIsConsistent = value.recommendation !== "recommended" ||
    risks.every(({ severity }) => severity !== "high" && severity !== "critical");
  if (!stateIsConsistent || !recommendationIsConsistent) return null;
  if (value.answerVerdict === "usable" && (value.status !== "completed" || value.recommendation !== "recommended" || risks.length > 0)) return null;
  if (value.answerVerdict === "usable_with_improvements" && (value.status !== "completed" || value.recommendation !== "publish_with_risk" || risks.some(risk => risk.severity === "critical" || risk.severity === "high"))) return null;
  if (value.answerVerdict === "pending" && (value.status === "completed" || value.recommendation === "recommended")) return null;
  if (value.answerVerdict === "unusable" && value.recommendation !== "not_recommended") return null;
  return {
    ...(value.answerVerdict === undefined ? {} : { answerVerdict: value.answerVerdict as EvaluationResult["answerVerdict"] }),
    skillId: value.skillId,
    version: value.version,
    status: value.status,
    score: value.score,
    coverage: value.coverage,
    recommendation: value.recommendation,
    summary: value.summary,
    dimensions,
    risks,
    relatedReportIds,
  };
}

/**
 * Execute a Skill and enforce its declared identity and the shared result
 * boundary before any result is rendered or persisted.
 */
export async function runEvaluationSkill<Input>(
  skill: EvaluationSkill<Input>,
  input: Input,
): Promise<EvaluationResult> {
  if (!isIdentifier(skill.skillId) || !isIdentifier(skill.version)) {
    throw new Error("Evaluation Skill identity is invalid");
  }
  const result = parseEvaluationResult(await skill.evaluate(input));
  if (!result) throw new Error("Evaluation Skill returned an invalid result");
  if (result.skillId !== skill.skillId || result.version !== skill.version) {
    throw new Error("Evaluation Skill result identity does not match the Skill");
  }
  return result;
}
