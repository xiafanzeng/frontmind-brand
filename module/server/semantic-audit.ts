import type { DiagnosticCategory, DiagnosticSample, KnowledgeBasis } from "../contracts/diagnostics.js";
import {
  semanticAuditOutputSchema, SEMANTIC_AUDIT_METRICS, SEMANTIC_AUDIT_DIMENSIONS,
  SEMANTIC_AUDIT_VERSION, type SemanticAuditResult, type SemanticAuditMetric,
} from "../contracts/semantic-audit.js";
import { diagnosticEvidenceCatalog, resolveDiagnosticQuote } from "./diagnostic-evidence.js";

const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
export function validateSemanticAudit(
  value: unknown,
  input: { category: DiagnosticCategory; samples: DiagnosticSample[]; knowledge: KnowledgeBasis; plannedSamples: number },
  meta: Pick<SemanticAuditResult, "inputHash" | "skillVersion" | "generatedAt" | "model" | "fallback">,
): SemanticAuditResult {
  const result = semanticAuditOutputSchema.parse(value);
  const { samples, knowledge, plannedSamples, category } = input;
  if (!plannedSamples || samples.length > plannedSamples) throw new Error("审计样本范围无效");
  const aliases = new Map(samples.map((s, i) => [`A${i}`, s.id]));
  const canonical = (id: string) => aliases.get(id) ?? id;
  const ids = result.checkedSampleIds.map(canonical);
  if (result.category !== category || ids.length !== samples.length || new Set(ids).size !== samples.length || samples.some((s) => !ids.includes(s.id)))
    throw new Error("语义审计必须检查且仅检查本题全部样本");
  if (new Set(result.metrics.map((m) => m.id)).size !== 12 || new Set(result.findings.map((f) => f.dimension)).size !== 5)
    throw new Error("语义审计指标或维度重复");
  const { catalog } = diagnosticEvidenceCatalog(samples, knowledge);
  const metrics: SemanticAuditMetric[] = result.metrics.map((m) => {
    const definition = SEMANTIC_AUDIT_METRICS.find((x) => x.id === m.id)!;
    if ((m.status === "scored") !== (m.value !== null)) throw new Error(`${m.id} 的评分状态和值不一致`);
    for (const ref of m.knowledgeRefs) {
      const doc = knowledge.documents.find((d) => d.path === ref.docPath);
      ref.excerpt = resolveDiagnosticQuote(ref.excerpt, { docPath: ref.docPath }, catalog);
      if (!doc || !normalize(doc.content).includes(normalize(ref.excerpt))) throw new Error(`${m.id} 的知识证据不属于冻结原文`);
    }
    for (const ref of m.answerRefs) {
      ref.sampleId = canonical(ref.sampleId);
      const sample = samples.find((s) => s.id === ref.sampleId);
      ref.excerpt = resolveDiagnosticQuote(ref.excerpt, { sampleId: ref.sampleId }, catalog);
      if (!sample || !normalize(sample.answer).includes(normalize(ref.excerpt))) throw new Error(`${m.id} 的回答证据不属于本题原文`);
    }
    if (m.value !== null) {
      if (!m.answerRefs.length) throw new Error(`${m.id} 缺少回答依据`);
      if (!["answer_depth", "authoritative_support", "independent_support"].includes(m.id) && !m.knowledgeRefs.length)
        throw new Error(`${m.id} 缺少知识评价基准`);
      if (m.value > 0 && !m.satisfied.trim()) throw new Error(`${m.id} 缺少满足证据说明`);
      if (m.value < 1 && !m.limitations.trim()) throw new Error(`${m.id} 缺少缺口或反证说明`);
      if (["verified_differences", "difference_accuracy"].includes(m.id)) {
        if (!["industry_ranking", "competitor_comparison"].includes(category)) throw new Error("本题竞争维度不适用，必须返回 null");
        if (!m.knowledgeRefs.some((ref) => knowledge.documents.some((d) => d.path === ref.docPath && ["verified_authoritative", "supported_third_party"].includes(d.evidenceStatus ?? ""))))
          throw new Error("竞争比较没有独立核实的知识基准，必须返回 null");
      }
      if (["authoritative_support", "independent_support"].includes(m.id)) {
        // A provider URL/title is not a saved source body. An explicit, fully
        // observed absence may be scored zero; unknown provenance cannot.
        const explicitAbsence = samples.every((s) => s.sourceObservability?.citations === "returned" && s.citations.length === 0);
        if (!(m.value === 0 && explicitAbsence))
          throw new Error("未保存可核验的引用来源正文；权威与独立支持必须为 null。只有全部明确无引用时可记 0");
      }
    } else if (!m.limitations.trim()) throw new Error(`${m.id} 不可评分时必须说明限制`);
    return { ...m, ...definition, score: m.value === null ? null : m.value * definition.weight, method: "model" };
  });
  const sampleDefinition = SEMANTIC_AUDIT_METRICS.find((m) => m.id === "sample_coverage")!;
  metrics.push({ ...sampleDefinition, status: "scored", value: samples.length / plannedSamples,
    score: Math.round(samples.length / plannedSamples * sampleDefinition.weight * 100) / 100,
    method: "calculated", explanation: `${samples.length}/${plannedSamples} 份有效回答，由服务端计算`,
    satisfied: `${samples.length} 份回答已保存`, limitations: samples.length < plannedSamples ? "样本尚未齐全" : "",
    knowledgeRefs: [], answerRefs: [],
  });
  metrics.sort((a, b) => SEMANTIC_AUDIT_METRICS.findIndex((m) => m.id === a.id) - SEMANTIC_AUDIT_METRICS.findIndex((m) => m.id === b.id));
  return {
    ...meta, category, schemaVersion: 1, scoringVersion: SEMANTIC_AUDIT_VERSION,
    samples: samples.length, plannedSamples, metrics,
    dimensions: SEMANTIC_AUDIT_DIMENSIONS.map((d) => {
      const items = metrics.filter((m) => m.dimension === d.id);
      const assessed = items.filter((m) => m.value !== null).length;
      return { ...d, assessed, total: items.length,
        score: assessed === items.length ? items.reduce((n, m) => n + m.score!, 0) : null,
        status: assessed === items.length ? "scored" : items.every((m) => m.status === "not_applicable") ? "not_applicable" : "insufficient",
        finding: result.findings.find((f) => f.dimension === d.id)!.text,
      };
    }),
  };
}
