import {
  parseEvaluationResult,
  type EvaluationResult,
  type EvaluationStatus,
} from "./evaluation-skill-contract";

/**
 * Reports and decisions share one envelope so a publication acknowledgement can
 * commit its new report and decision with one localStorage write.
 */
export const EVALUATION_AUDIT_STORAGE_KEY =
  "frontmind.ai-website.evaluation-audit.v2";
export const EVALUATION_REPORT_STORAGE_KEY = EVALUATION_AUDIT_STORAGE_KEY;
export const PUBLISH_DECISION_STORAGE_KEY = EVALUATION_AUDIT_STORAGE_KEY;
export const MAX_STORED_EVALUATION_REPORTS = 30;
export const MAX_STORED_PUBLISH_DECISIONS = 30;

export interface EvaluationSubjectRef {
  kind: string;
  id: string;
  version: string;
}

export interface EvaluationReportSnapshot {
  reportId: string;
  createdAt: string;
  subject: EvaluationSubjectRef;
  result: EvaluationResult;
}

/**
 * A user's publication choice is an audit record, not part of an evaluator's
 * result. Report and risk IDs are explicit so a later result cannot silently
 * replace the evidence the user acknowledged.
 */
export interface PublishDecision {
  decisionId: string;
  createdAt: string;
  subject: EvaluationSubjectRef;
  action: "publish";
  mode: "follow_recommendation" | "accepted_risk";
  evaluationReportIds: string[];
  acknowledgedRiskIds: string[];
  riskAcknowledged: boolean;
  note: string | null;
}

export interface EvaluationReportQuery {
  skillId?: string;
  status?: EvaluationStatus;
  subjectKind?: string;
  subjectId?: string;
  subjectVersion?: string;
  relatedReportId?: string;
}

export interface PublishDecisionQuery {
  subjectKind?: string;
  subjectId?: string;
  subjectVersion?: string;
  evaluationReportId?: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type AuditEnvelope = {
  schemaVersion: 2;
  reports: EvaluationReportSnapshot[];
  decisions: PublishDecision[];
};

type AuditState = Pick<AuditEnvelope, "reports" | "decisions">;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function parseIdentifiers(value: unknown, maximum = 100): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isIdentifier(item) || seen.has(item)) return null;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function parseSubject(value: unknown): EvaluationSubjectRef | null {
  if (
    !isRecord(value) ||
    !isIdentifier(value.kind) ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.version)
  ) {
    return null;
  }
  return { kind: value.kind, id: value.id, version: value.version };
}

export function parseEvaluationReportSnapshot(
  value: unknown,
): EvaluationReportSnapshot | null {
  if (!isRecord(value)) return null;
  const subject = parseSubject(value.subject);
  const result = parseEvaluationResult(value.result);
  if (
    !isIdentifier(value.reportId) ||
    !isTimestamp(value.createdAt) ||
    !subject ||
    !result ||
    result.relatedReportIds.includes(value.reportId)
  ) {
    return null;
  }
  return {
    reportId: value.reportId,
    createdAt: new Date(value.createdAt).toISOString(),
    subject,
    result,
  };
}

export function parsePublishDecision(value: unknown): PublishDecision | null {
  if (!isRecord(value)) return null;
  const subject = parseSubject(value.subject);
  const evaluationReportIds = parseIdentifiers(value.evaluationReportIds);
  const acknowledgedRiskIds = parseIdentifiers(value.acknowledgedRiskIds);
  const mode = value.mode;
  const riskAcknowledged = value.riskAcknowledged;
  if (
    !isIdentifier(value.decisionId) ||
    !isTimestamp(value.createdAt) ||
    !subject ||
    value.action !== "publish" ||
    (mode !== "follow_recommendation" && mode !== "accepted_risk") ||
    evaluationReportIds === null ||
    acknowledgedRiskIds === null ||
    typeof riskAcknowledged !== "boolean" ||
    (value.note !== null &&
      (typeof value.note !== "string" || value.note.length > 2_000)) ||
    (mode === "follow_recommendation" &&
      (riskAcknowledged || acknowledgedRiskIds.length > 0)) ||
    (mode === "accepted_risk" && !riskAcknowledged)
  ) {
    return null;
  }
  return {
    decisionId: value.decisionId,
    createdAt: new Date(value.createdAt).toISOString(),
    subject,
    action: "publish",
    mode,
    evaluationReportIds,
    acknowledgedRiskIds,
    riskAcknowledged,
    note: value.note,
  };
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function newestFirst<Item extends { createdAt: string }>(left: Item, right: Item) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function uniqueById<Item>(items: Item[], id: (item: Item) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = id(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function readAuditState(storage: StorageLike | null): AuditState {
  const parsed = readJson(storage, EVALUATION_AUDIT_STORAGE_KEY);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 2 ||
    !Array.isArray(parsed.reports) ||
    !Array.isArray(parsed.decisions)
  ) {
    return { reports: [], decisions: [] };
  }

  let reports = uniqueById(
    parsed.reports
      .map(parseEvaluationReportSnapshot)
      .filter((item): item is EvaluationReportSnapshot => item !== null)
      .sort(newestFirst),
    (item) => item.reportId,
  );
  // Corrupted/dangling reports are not usable snapshots. Removing them may make
  // another report dangling, so resolve to a fixed point.
  while (true) {
    const reportIds = new Set(reports.map((report) => report.reportId));
    const next = reports.filter((report) =>
      report.result.relatedReportIds.every((reportId) => reportIds.has(reportId)),
    );
    if (next.length === reports.length) break;
    reports = next;
  }
  const reportMap = new Map(reports.map((report) => [report.reportId, report]));
  const decisions = uniqueById(
    parsed.decisions
      .map(parsePublishDecision)
      .filter((item): item is PublishDecision => item !== null)
      .filter((decision) => decisionMatchesReports(decision, reportMap))
      .sort(newestFirst),
    (item) => item.decisionId,
  ).slice(0, MAX_STORED_PUBLISH_DECISIONS);
  return { reports, decisions };
}

function writeAuditState(storage: StorageLike | null, state: AuditState) {
  const envelope: AuditEnvelope = {
    schemaVersion: 2,
    reports: state.reports,
    decisions: state.decisions,
  };
  return writeJson(storage, EVALUATION_AUDIT_STORAGE_KEY, envelope);
}

function mergeReports(
  current: readonly EvaluationReportSnapshot[],
  incoming: readonly EvaluationReportSnapshot[],
) {
  const reports = new Map(current.map((report) => [report.reportId, report]));
  for (const report of incoming) {
    const existing = reports.get(report.reportId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(report)) return null;
    reports.set(report.reportId, existing ?? report);
  }
  return [...reports.values()].sort(newestFirst);
}

function collectReportClosure(
  seedIds: Iterable<string>,
  reports: ReadonlyMap<string, EvaluationReportSnapshot>,
) {
  const collected = new Set<string>();
  const pending = [...seedIds];
  while (pending.length > 0) {
    const reportId = pending.pop()!;
    if (collected.has(reportId)) continue;
    const report = reports.get(reportId);
    if (!report) return null;
    collected.add(reportId);
    pending.push(...report.result.relatedReportIds);
  }
  return collected;
}

function decisionMatchesReports(
  decision: PublishDecision,
  reports: ReadonlyMap<string, EvaluationReportSnapshot>,
) {
  if (decision.evaluationReportIds.length === 0) return false;
  const selected = decision.evaluationReportIds.map((reportId) => reports.get(reportId));
  if (selected.some((report) => !report)) return false;
  if (!selected.some((report) =>
    report?.subject.kind === decision.subject.kind &&
    report.subject.id === decision.subject.id &&
    report.subject.version === decision.subject.version,
  )) return false;
  const riskIds = new Set(
    selected.flatMap((report) => report?.result.risks.map((risk) => risk.id) ?? []),
  );
  return decision.acknowledgedRiskIds.every((riskId) => riskIds.has(riskId));
}

/**
 * Keep every report needed by a retained decision. In addition, keep at most 30
 * independent report roots (plus their explicit dependencies). This separates
 * report-history retention from the reports required to reconstruct an audit.
 */
function retainReports(
  candidates: readonly EvaluationReportSnapshot[],
  decisions: readonly PublishDecision[],
  forcedRootIds: ReadonlySet<string>,
  droppedRootIds: ReadonlySet<string>,
) {
  const reports = new Map(candidates.map((report) => [report.reportId, report]));
  for (const report of candidates) {
    if (report.result.relatedReportIds.some((reportId) => !reports.has(reportId))) {
      return null;
    }
  }

  const protectedIds = collectReportClosure(
    decisions.flatMap((decision) => decision.evaluationReportIds),
    reports,
  );
  if (!protectedIds) return null;

  const forcedUnprotected = [...forcedRootIds].filter((reportId) => !protectedIds.has(reportId));
  if (forcedUnprotected.length > MAX_STORED_EVALUATION_REPORTS) return null;
  const extraRootIds: string[] = [...forcedUnprotected];
  for (const report of candidates) {
    if (
      extraRootIds.length >= MAX_STORED_EVALUATION_REPORTS ||
      protectedIds.has(report.reportId) ||
      forcedRootIds.has(report.reportId) ||
      droppedRootIds.has(report.reportId)
    ) continue;
    extraRootIds.push(report.reportId);
  }

  const retainedIds = collectReportClosure(
    [...protectedIds, ...extraRootIds],
    reports,
  );
  if (!retainedIds) return null;
  return candidates.filter((report) => retainedIds.has(report.reportId));
}

function nextDecisions(
  current: readonly PublishDecision[],
  decision: PublishDecision,
) {
  const existing = current.find((item) => item.decisionId === decision.decisionId);
  if (existing) {
    return JSON.stringify(existing) === JSON.stringify(decision)
      ? [...current]
      : null;
  }
  const decisions = uniqueById(
    [decision, ...current].sort(newestFirst),
    (item) => item.decisionId,
  ).slice(0, MAX_STORED_PUBLISH_DECISIONS);
  return decisions.some((item) => item.decisionId === decision.decisionId)
    ? decisions
    : null;
}

function reportsReleasedByEvictedDecisions(
  previous: readonly PublishDecision[],
  next: readonly PublishDecision[],
  reports: ReadonlyMap<string, EvaluationReportSnapshot>,
) {
  const retainedDecisionIds = new Set(next.map((decision) => decision.decisionId));
  const evictedRoots = previous
    .filter((decision) => !retainedDecisionIds.has(decision.decisionId))
    .flatMap((decision) => decision.evaluationReportIds);
  const evictedClosure = collectReportClosure(evictedRoots, reports) ?? new Set<string>();
  const retainedClosure = collectReportClosure(
    next.flatMap((decision) => decision.evaluationReportIds),
    reports,
  ) ?? new Set<string>();
  return new Set([...evictedClosure].filter((reportId) => !retainedClosure.has(reportId)));
}

export function listEvaluationReports(
  storage?: StorageLike | null,
): EvaluationReportSnapshot[] {
  return readAuditState(resolveStorage(storage)).reports;
}

export function saveEvaluationReport(
  value: EvaluationReportSnapshot,
  storage?: StorageLike | null,
) {
  const report = parseEvaluationReportSnapshot(value);
  const selectedStorage = resolveStorage(storage);
  if (!report || !selectedStorage) return false;
  const current = readAuditState(selectedStorage);
  const existing = current.reports.find((item) => item.reportId === report.reportId);
  if (existing) return JSON.stringify(existing) === JSON.stringify(report);
  const candidates = mergeReports(current.reports, [report]);
  if (!candidates) return false;
  const retained = retainReports(
    candidates,
    current.decisions,
    new Set([report.reportId]),
    new Set(),
  );
  if (!retained || !retained.some((item) => item.reportId === report.reportId)) {
    return false;
  }
  return writeAuditState(selectedStorage, { reports: retained, decisions: current.decisions });
}

export function getEvaluationReportById(
  reportId: string,
  storage?: StorageLike | null,
) {
  if (!isIdentifier(reportId)) return null;
  return (
    listEvaluationReports(storage).find((item) => item.reportId === reportId) ??
    null
  );
}

export function findLatestEvaluationReport(
  query: EvaluationReportQuery,
  storage?: StorageLike | null,
) {
  return (
    listEvaluationReports(storage).find((report) => {
      if (query.skillId && report.result.skillId !== query.skillId) return false;
      if (query.status && report.result.status !== query.status) return false;
      if (query.subjectKind && report.subject.kind !== query.subjectKind)
        return false;
      if (query.subjectId && report.subject.id !== query.subjectId) return false;
      if (
        query.subjectVersion &&
        report.subject.version !== query.subjectVersion
      )
        return false;
      if (
        query.relatedReportId &&
        !report.result.relatedReportIds.includes(query.relatedReportId)
      )
        return false;
      return true;
    }) ?? null
  );
}

/** Resolve only the report IDs explicitly frozen into the selected snapshot. */
export function getRelatedEvaluationReports(
  reportOrId: EvaluationReportSnapshot | string,
  storage?: StorageLike | null,
) {
  const report =
    typeof reportOrId === "string"
      ? getEvaluationReportById(reportOrId, storage)
      : parseEvaluationReportSnapshot(reportOrId);
  if (!report) return [];
  const reports = new Map(
    listEvaluationReports(storage).map((item) => [item.reportId, item]),
  );
  return report.result.relatedReportIds.flatMap((id) => {
    const related = reports.get(id);
    return related ? [related] : [];
  });
}

export function listPublishDecisions(
  storage?: StorageLike | null,
): PublishDecision[] {
  return readAuditState(resolveStorage(storage)).decisions;
}

export function savePublishDecision(
  value: PublishDecision,
  storage?: StorageLike | null,
) {
  const decision = parsePublishDecision(value);
  const selectedStorage = resolveStorage(storage);
  if (!decision || !selectedStorage) return false;
  const current = readAuditState(selectedStorage);
  const reports = new Map(current.reports.map((report) => [report.reportId, report]));
  if (!decisionMatchesReports(decision, reports)) return false;
  const decisions = nextDecisions(current.decisions, decision);
  if (!decisions) return false;
  const dropped = reportsReleasedByEvictedDecisions(current.decisions, decisions, reports);
  const retained = retainReports(current.reports, decisions, new Set(), dropped);
  if (!retained) return false;
  return writeAuditState(selectedStorage, { reports: retained, decisions });
}

/** Atomically persist new report snapshots and the decision that references them. */
export function savePublishDecisionWithReports(
  value: {
    decision: PublishDecision;
    reports: EvaluationReportSnapshot[];
  },
  storage?: StorageLike | null,
) {
  const decision = parsePublishDecision(value.decision);
  const incomingReports = value.reports.map(parseEvaluationReportSnapshot);
  const selectedStorage = resolveStorage(storage);
  if (
    !decision ||
    !selectedStorage ||
    incomingReports.some((report) => report === null)
  ) return false;
  const reportsToSave = incomingReports as EvaluationReportSnapshot[];
  if (new Set(reportsToSave.map((report) => report.reportId)).size !== reportsToSave.length) {
    return false;
  }

  const current = readAuditState(selectedStorage);
  const candidates = mergeReports(current.reports, reportsToSave);
  if (!candidates) return false;
  const reportMap = new Map(candidates.map((report) => [report.reportId, report]));
  if (!decisionMatchesReports(decision, reportMap)) return false;
  const decisions = nextDecisions(current.decisions, decision);
  if (!decisions) return false;
  const dropped = reportsReleasedByEvictedDecisions(current.decisions, decisions, reportMap);
  const forced = new Set(reportsToSave.map((report) => report.reportId));
  const retained = retainReports(candidates, decisions, forced, dropped);
  if (!retained || reportsToSave.some((report) =>
    !retained.some((item) => item.reportId === report.reportId),
  )) return false;
  return writeAuditState(selectedStorage, { reports: retained, decisions });
}

export function getPublishDecisionById(
  decisionId: string,
  storage?: StorageLike | null,
) {
  if (!isIdentifier(decisionId)) return null;
  return (
    listPublishDecisions(storage).find(
      (item) => item.decisionId === decisionId,
    ) ?? null
  );
}

export function findLatestPublishDecision(
  query: PublishDecisionQuery,
  storage?: StorageLike | null,
) {
  return (
    listPublishDecisions(storage).find((decision) => {
      if (query.subjectKind && decision.subject.kind !== query.subjectKind)
        return false;
      if (query.subjectId && decision.subject.id !== query.subjectId)
        return false;
      if (
        query.subjectVersion &&
        decision.subject.version !== query.subjectVersion
      )
        return false;
      if (
        query.evaluationReportId &&
        !decision.evaluationReportIds.includes(query.evaluationReportId)
      )
        return false;
      return true;
    }) ?? null
  );
}
