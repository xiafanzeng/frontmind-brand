import type {
  DiagnosticSample,
  KnowledgeBasis,
} from "../contracts/diagnostics.js";

type Evidence = { text: string; sampleId?: string; docPath?: string };

/** Stable, contiguous source fragments: the model selects evidence, never rewrites it. */
export function diagnosticEvidenceCatalog(
  samples: DiagnosticSample[],
  basis: KnowledgeBasis,
) {
  const catalog = new Map<string, Evidence>();
  const fragments = (
    text: string,
    prefix: string,
    source: Omit<Evidence, "text">,
  ) => {
    const excerpts: Array<{ id: string; text: string }> = [];
    for (const line of text.match(/[^\n。！？]+[。！？]?|[。！？]/gu) ?? []) {
      for (let start = 0; start < line.length; ) {
        let end = Math.min(start + 800, line.length);
        const last = line.charCodeAt(end - 1);
        if (end < line.length && last >= 0xd800 && last <= 0xdbff) end--;
        const text = line.slice(start, end).trim();
        start = end;
        if (!text) continue;
        const id = `@quote:${prefix}.${excerpts.length}`;
        excerpts.push({ id, text });
        catalog.set(id, { ...source, text });
      }
    }
    return excerpts;
  };
  return {
    catalog,
    knowledge: {
      ...basis,
      documents: basis.documents.map(({ content, ...d }, i) => ({
        ...d,
        excerpts: fragments(content, `K${i}`, { docPath: d.path }),
      })),
    },
    samples: samples.map(({ answer, ...s }, i) => ({
      ...s,
      excerpts: fragments(answer, `A${i}`, { sampleId: s.id }),
    })),
  };
}

export function resolveDiagnosticQuote(
  value: string,
  source: { sampleId?: string; docPath?: string },
  catalog: Map<string, Evidence>,
) {
  if (!value.startsWith("@quote:")) return value;
  const evidence = catalog.get(value);
  if (
    !evidence ||
    evidence.sampleId !== source.sampleId ||
    evidence.docPath !== source.docPath
  )
    throw new Error(
      `证据编号不属于当前来源：${JSON.stringify(source)}，id=${value}`,
    );
  return evidence.text;
}
