import { createHash } from "node:crypto";

export type CollectedSample = {
  id: string;
  platform: string;
  question: string;
  answer: string;
  mentioned: boolean;
  rank: number | null;
  citations: Array<{ title: string; url: string; site?: string }>;
  references?: Array<{ title: string; url: string; site?: string }>;
  sourceObservability?: {
    citations: "returned" | "not_returned" | "unknown";
    references: "returned" | "not_returned" | "unknown";
  };
  sentiment?: "positive" | "neutral" | "negative" | "unknown";
  sentimentEvidence?: string[];
  collectedAt?: string;
  supplierTaskId?: string;
};
export type DiagnosticMonitorAttempt = {
  consumerTaskId: string;
  question: string;
  platform: string;
  run: number;
  status: "queued" | "submitting" | "submitted" | "completed" | "failed";
  taskId?: string;
  submittedAt?: string;
  nextPollAt?: number;
  error?: string;
  sample?: CollectedSample;
};
export class DiagnosticMonitorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ambiguous = false,
  ) {
    super(message);
  }
}
export function diagnosticMonitorAttempts(
  reportId: string,
  questions: readonly string[],
  platforms: readonly string[],
) {
  return questions.flatMap((question) =>
    platforms.flatMap((platform) =>
      Array.from({ length: 5 }, (_, run) => ({
        consumerTaskId: `fm${createHash("sha256")
          .update(
            JSON.stringify([
              "brand-diagnostic-v1",
              reportId,
              question,
              platform,
              run,
            ]),
          )
          .digest("hex")}`.slice(0, 64),
        question,
        platform,
        run: run + 1,
        status: "queued" as const,
      })),
    ),
  );
}
const record = (v: any): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const items = (v: any): any[] =>
  Array.isArray(v)
    ? v
    : ([
        "subTaskList",
        "results",
        "resultList",
        "subTasks",
        "list",
        "records",
        "items",
      ]
        .map((k) => v?.[k])
        .find(Array.isArray) ?? []);
const safeUrl = (value: unknown) => {
  try {
    const u = new URL(String(value));
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
};
const positiveRank = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
const exactKeyword = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase()
    : "";

export function diagnosticSampleFromResult(
  attempt: DiagnosticMonitorAttempt,
  brandName: string,
  raw: unknown,
): CollectedSample {
  const data = record(raw);
  const all = items(raw);
  const candidates = (all.length ? all : [data]).filter(
    (v) => v.platform === attempt.platform,
  );
  if (candidates.length !== 1)
    throw new DiagnosticMonitorError(
      "SAMPLE_MISMATCH",
      "采集结果与本轮平台不一致，未写入诊断。",
    );
  const v = record(candidates[0]);
  const question = String(v.prompt ?? v.question ?? attempt.question);
  if (question !== attempt.question)
    throw new DiagnosticMonitorError(
      "QUESTION_MISMATCH",
      "采集返回了不同的问题，未写入诊断。",
    );
  const answer = String(v.answerContent ?? v.answer ?? v.content ?? "").trim();
  if (
    !answer ||
    ["failed", "error", "cancelled"].includes(String(v.status).toLowerCase())
  )
    throw new DiagnosticMonitorError(
      "SAMPLE_FAILED",
      "本条采集未取得有效回答。",
    );
  // mentionPosition is the supplier's monitored-keyword field. Generic rank is a
  // compatibility fallback only; a missing or non-positive rank is never made up.
  const rank = positiveRank(v.mentionPosition) ?? positiveRank(v.rank);
  const evaluations = items(v.keywordEvaluations).filter(
    (entry) => exactKeyword(entry?.keyword) === exactKeyword(brandName),
  );
  const keywordMatched = evaluations.some((entry) =>
    ["positive", "neutral", "negative"].includes(
      String(entry?.nature ?? "").toLowerCase(),
    ),
  );
  // Each request contains exactly this enterprise as monitorKeywords. Use the
  // supplier's explicit attribution even when its answer uses an abbreviation;
  // never infer an unknown alias or count another enterprise's evaluation.
  const mentioned =
    rank !== null ||
    keywordMatched ||
    answer.toLocaleLowerCase().includes(brandName.toLocaleLowerCase());
  const citations = items(v.citationList ?? v.citations)
    .map((c) => ({
      title: String(c.title ?? c.name ?? "引用来源"),
      url: safeUrl(c.url ?? c.link),
      site: String(c.media ?? c.site ?? c.domain ?? ""),
    }))
    .filter((c) => c.url);
  const references = items(v.referenceList ?? v.references)
    .map((c) => ({
      title: String(c.title ?? c.name ?? "检索参考"),
      url: safeUrl(c.url ?? c.link),
      site: String(c.media ?? c.site ?? c.domain ?? ""),
    }))
    .filter((c) => c.url);
  const natures = [
    ...new Set(
      evaluations
        .map((entry) => String(entry.nature ?? "").toLowerCase())
        .filter((value) => ["positive", "neutral", "negative"].includes(value)),
    ),
  ];
  const sentiment =
    natures.length === 1
      ? (natures[0] as "positive" | "neutral" | "negative")
      : "unknown";
  return {
    id: attempt.consumerTaskId,
    platform: attempt.platform,
    question: attempt.question,
    answer,
    mentioned,
    rank,
    citations,
    references,
    sourceObservability: {
      citations: Array.isArray(v.citationList ?? v.citations) && citations.length === (v.citationList ?? v.citations).length ? "returned" : (v.citationList ?? v.citations) == null ? "not_returned" : "unknown",
      references: Array.isArray(v.referenceList ?? v.references) && references.length === (v.referenceList ?? v.references).length ? "returned" : (v.referenceList ?? v.references) == null ? "not_returned" : "unknown",
    },
    sentiment,
    sentimentEvidence: evaluations
      .map((entry) => String(entry.context ?? "").trim())
      .filter(Boolean),
    collectedAt: new Date().toISOString(),
    supplierTaskId: attempt.taskId,
  };
}

/** Host-owned transport: credentials never cross the module or browser boundary. */
export type DiagnosticCollectionBinding = {
  contractVersion: "brand_single_sample_v1";
  credentialId: string;
  credentialVersion: number;
  baseUrl: string;
};
export function sameDiagnosticCollectionBinding(a: DiagnosticCollectionBinding, b?: DiagnosticCollectionBinding): boolean {
  return !!b && a.contractVersion === b.contractVersion && a.credentialId === b.credentialId &&
    a.credentialVersion === b.credentialVersion && a.baseUrl === b.baseUrl;
}
export interface DiagnosticCollectionPort {
  availability(): { ready: boolean; reason?: string; platforms: string[]; binding?: DiagnosticCollectionBinding };
  request(binding: DiagnosticCollectionBinding, method: "submit" | "status" | "result" | "stop", input: { taskId?: string; payload?: {
    monitorKeywords: string; monitorKeywordAliases: string[]; competitors: string[];
    prompts: string[]; platforms: Array<{ platform: string; mode: "search"; screenshot: 0 }>;
    consumerTaskId: string;
  } }): Promise<unknown>;
}
export function diagnosticMonitorClient(port?: DiagnosticCollectionPort, binding?: DiagnosticCollectionBinding) {
  const available = port?.availability();
  const selected = binding ?? available?.binding;
  async function request(method: "submit" | "status" | "result" | "stop", input: Parameters<DiagnosticCollectionPort["request"]>[2]) {
    if (!port || !selected || !available?.ready)
      throw new DiagnosticMonitorError("MONITOR_NOT_CONFIGURED", available?.reason ?? "诊断采集服务尚未配置，请联系维护人员。");
    if (!sameDiagnosticCollectionBinding(selected, available.binding))
      throw new DiagnosticMonitorError("MONITOR_BINDING_CHANGED", "采集配置已变更，正在等待核对原任务配置；已有回答已保留。");
    return port.request(selected, method, input);
  }
  return {
    configured: !!available?.ready && !!selected,
    async submit(a: DiagnosticMonitorAttempt, brandName: string) {
      const raw = await request("submit", { payload: {
        monitorKeywords: brandName,
        monitorKeywordAliases: [],
        competitors: [],
        prompts: [a.question],
        platforms: [{ platform: a.platform, mode: "search", screenshot: 0 }],
        consumerTaskId: a.consumerTaskId,
      } });
      const data = record(raw);
      const id = String(data.taskId ?? data.id ?? data.monitorTaskId ?? "");
      if (!id)
        throw new DiagnosticMonitorError(
          "MONITOR_SUBMISSION_UNKNOWN",
          "采集提交结果尚未确认，将保留原任务标识。",
          true,
        );
      return id;
    },
    async stop(taskId: string) { await request("stop", { taskId }); },
    async poll(a: DiagnosticMonitorAttempt, brandName: string) {
      if (!a.taskId)
        throw new DiagnosticMonitorError(
          "MONITOR_TASK_MISSING",
          "采集任务标识不存在。",
        );
      const state = record(await request("status", { taskId: a.taskId }));
      const status = String(
        state.status ?? state.taskStatus ?? "",
      ).toLowerCase();
      if (["failed", "error", "cancelled"].includes(status))
        throw new DiagnosticMonitorError(
          "MONITOR_FAILED",
          "采集服务已确认本条任务失败，已保存其他结果，请联系维护人员处理失败样本。",
        );
      if (
        !["completed", "success", "done", "finished", "stopped"].includes(
          status,
        )
      )
        return null;
      return diagnosticSampleFromResult(
        a,
        brandName,
        await request("result", { taskId: a.taskId }),
      );
    },
  };
}
