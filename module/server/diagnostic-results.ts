import {
  assessmentSchema,
  recommendationSchema,
  validationSchema,
  DIAGNOSTIC_CATEGORIES,
  type DiagnosticAssessment,
  type DiagnosticCategory,
  type DiagnosticSample,
  type KnowledgeBasis,
  type DiagnosticMetric,
  type DiagnosticBreakdown,
  DIAGNOSTIC_PLATFORMS,
} from "../contracts/diagnostics.js";
const normalized = (v: string) =>
  v.normalize("NFKC").replace(/\s+/g, " ").trim();
const quoted = (source: string, value: string) =>
  !!value.trim() && normalized(source).includes(normalized(value));
export function validateRecommendations(value: unknown, basis: KnowledgeBasis) {
  const result = recommendationSchema.parse(value);
  const seen = new Set<string>();
  for (const category of DIAGNOSTIC_CATEGORIES)
    if (result.questions.filter((q) => q.category === category).length > 5)
      throw new Error("每类候选不得超过五题");
  for (const q of result.questions) {
    if (seen.has(normalized(q.text))) throw new Error("候选问题重复");
    seen.add(normalized(q.text));
    for (const p of q.evidenceRefs)
      if (!basis.documents.some((d) => d.path === p))
        throw new Error("候选依据不在知识版本中");
  }
  return result.questions;
}
export function validateQuestionDecisions(
  value: unknown,
  questions: Array<{ category: DiagnosticCategory; text: string }>,
  basis: KnowledgeBasis,
) {
  const result = validationSchema.parse(value);
  if (
    result.decisions.length !== questions.length ||
    new Set(result.decisions.map((q) => q.category)).size !== questions.length
  )
    throw new Error("校验未覆盖全部题目");
  for (const q of result.decisions) {
    if (!questions.some((x) => x.category === q.category && x.text === q.text))
      throw new Error("校验改写了问题");
    if (q.accepted && !q.evidenceRefs.length)
      throw new Error("通过校验的题目缺少知识依据");
    for (const p of q.evidenceRefs)
      if (!basis.documents.some((d) => d.path === p))
        throw new Error("校验依据不在知识版本中");
  }
  return result.decisions;
}
export function validateAssessment(
  value: unknown,
  category: DiagnosticCategory,
  samples: DiagnosticSample[],
  basis: KnowledgeBasis,
): DiagnosticAssessment {
  const a = assessmentSchema.parse(value);
  if (
    a.category !== category ||
    a.answers.length !== samples.length ||
    new Set(a.answers.map((x) => x.sampleId)).size !== samples.length
  )
    throw new Error("诊断未完整对应本题样本");
  const sample = (id: string) => {
    const s = samples.find((s) => s.id === id);
    if (!s) throw new Error("诊断引用了其他样本");
    return s;
  };
  const checkQuote = (id: string, quote: string) => {
    if (!quoted(sample(id).answer, quote))
      throw new Error("回答证据不是采集原文");
  };
  const checkKnowledge = (
    docPath: string | null,
    kbExcerpt: string | null,
    required: boolean,
  ) => {
    if (!docPath || !kbExcerpt) {
      if (required || docPath || kbExcerpt) throw new Error("缺少成对知识依据");
      return;
    }
    const d = basis.documents.find((d) => d.path === docPath);
    if (!d || !quoted(d.content, kbExcerpt))
      throw new Error("知识依据不是冻结版本原文");
  };
  for (const t of a.topics) {
    checkKnowledge(t.docPath, t.kbExcerpt, t.verdict !== "unverifiable");
    if (t.verdict !== "omitted" && !t.answerRefs.length)
      throw new Error("判断缺少回答依据");
    for (const r of t.answerRefs) checkQuote(r.sampleId, r.excerpt);
  }
  if (
    new Set(a.topics.map((t) => normalized(t.topic))).size !== a.topics.length
  )
    throw new Error("诊断要点重复");
  for (const item of a.answers) {
    sample(item.sampleId);
  }
  if (a.category === "industry_ranking")
    for (const x of a.answers) {
      if (x.mentioned) checkQuote(x.sampleId, x.mentionEvidence);
      if (x.recommended) {
        if (!x.mentioned || x.attribution !== "subject")
          throw new Error("非本主体不能计为推荐");
        checkQuote(x.sampleId, x.recommendationEvidence);
      }
      if (x.rank !== null && !x.recommended)
        throw new Error("未推荐样本不能有排名");
      for (const c of x.competitors) {
        checkQuote(x.sampleId, c.excerpt);
        if (!quoted(c.excerpt, c.name)) throw new Error("竞品名称缺少原文支持");
      }
    }
  if (a.category === "competitor_comparison")
    for (const x of a.answers) {
      if (x.preference !== "unspecified")
        checkQuote(x.sampleId, x.preferenceEvidence);
      for (const d of x.dimensions) checkQuote(x.sampleId, d.excerpt);
    }
  if (a.category === "reputation")
    for (const x of a.answers) {
      if (x.sentiment !== "unknown")
        checkQuote(x.sampleId, x.sentimentEvidence);
      for (const r of x.risks) checkQuote(x.sampleId, r.excerpt);
    }
  if (a.category === "product_scenario") {
    const seenPoints = new Set<string>();
    const seenEvidence = new Set<string>();
    for (const point of a.knowledgeCoverage) {
      checkKnowledge(point.docPath, point.kbExcerpt, true);
      const key = `${point.docPath}:${normalized(point.kbExcerpt)}`;
      if (seenPoints.has(normalized(point.point)) || seenEvidence.has(key))
        throw new Error("知识覆盖要点重复，不能按不同回答重复建立同一要点");
      seenPoints.add(normalized(point.point));
      seenEvidence.add(key);
      if (
        point.answers.length !== samples.length ||
        new Set(point.answers.map((x) => x.sampleId)).size !== samples.length
      )
        throw new Error("每个知识要点必须逐份判读全部回答，不能只给代表性摘录");
      for (const item of point.answers) {
        sample(item.sampleId);
        if (item.covered) checkQuote(item.sampleId, item.excerpt);
        else if (item.excerpt.trim())
          throw new Error("未覆盖的回答不能同时提供覆盖摘录");
      }
    }
    for (const x of a.answers)
      for (const c of x.claims) {
        checkQuote(x.sampleId, c.excerpt);
        checkKnowledge(c.docPath, c.kbExcerpt, c.verdict !== "unverifiable");
      }
  }
  return a;
}
export function diagnosticMetrics(a: DiagnosticAssessment): DiagnosticMetric[] {
  const n = a.answers.length;
  const rate = (
    id: string,
    label: string,
    ids: string[],
    denominator = n,
  ): DiagnosticMetric => ({
    id,
    label,
    value: denominator
      ? Math.round((ids.length / denominator) * 1000) / 10
      : null,
    denominator,
    unit: "%",
    sampleIds: [...new Set(ids)],
  });
  const count = (
    id: string,
    label: string,
    ids: string[],
  ): DiagnosticMetric => ({
    id,
    label,
    value: ids.length,
    unit: "份",
    sampleIds: ids,
  });
  if (a.category === "industry_ranking") {
    const eligible = a.answers.filter((x) => x.attribution === "subject");
    const ranked = eligible.filter((x) => x.recommended && x.rank !== null);
    return [
      rate(
        "mention",
        "主体提及率",
        eligible.filter((x) => x.mentioned).map((x) => x.sampleId),
      ),
      rate(
        "recommend",
        "实际推荐率",
        eligible.filter((x) => x.recommended).map((x) => x.sampleId),
      ),
      ...([1, 3, 5] as const).map((k) =>
        rate(
          `top${k}`,
          k === 1 ? "首位推荐率" : `Top${k} 推荐率`,
          ranked.filter((x) => x.rank! <= k).map((x) => x.sampleId),
        ),
      ),
      {
        id: "average_rank",
        label: "有效平均位次",
        value: ranked.length
          ? Math.round(
              (ranked.reduce((n, x) => n + x.rank!, 0) / ranked.length) * 100,
            ) / 100
          : null,
        denominator: ranked.length,
        unit: "位" as const,
        sampleIds: ranked.map((x) => x.sampleId),
      },
      count(
        "attribution_pending",
        "主体归属待核",
        a.answers
          .filter(
            (x) =>
              x.attribution === "parent_only" || x.attribution === "uncertain",
          )
          .map((x) => x.sampleId),
      ),
    ];
  }
  if (a.category === "competitor_comparison")
    return [
      rate(
        "dimension_coverage",
        "比较维度有覆盖的回答",
        a.answers.filter((x) => x.dimensions.length).map((x) => x.sampleId),
      ),
      ...(
        [
          ["subject", "明确倾向本主体"],
          ["competitor", "明确倾向比较对象"],
          ["balanced", "双方各有适用"],
          ["unspecified", "未明确偏好"],
        ] as const
      ).map(([key, label]) =>
        rate(
          key,
          label,
          a.answers.filter((x) => x.preference === key).map((x) => x.sampleId),
        ),
      ),
    ];
  if (a.category === "reputation")
    return (
      [
        ["positive", "正面"],
        ["neutral", "中性"],
        ["negative", "负面"],
        ["mixed", "混合"],
        ["unknown", "无法判断"],
      ] as const
    ).map(([key, label]) =>
      rate(
        key,
        label,
        a.answers.filter((x) => x.sentiment === key).map((x) => x.sampleId),
      ),
    );
  const claims = a.answers.flatMap((x) =>
    x.claims.map((c) => ({ ...c, sampleId: x.sampleId })),
  );
  const verified = claims.filter((x) => x.verdict !== "unverifiable");
  const knowledgeTopics = a.knowledgeCoverage;
  const coverage = knowledgeTopics.filter((t) =>
    t.answers.some((x) => x.covered),
  );
  return [
    {
      id: "coverage",
      label: "相关要点覆盖",
      value: knowledgeTopics.length
        ? Math.round((coverage.length / knowledgeTopics.length) * 1000) / 10
        : null,
      denominator: knowledgeTopics.length,
      unit: "%",
      sampleIds: [
        ...new Set(
          coverage.flatMap((t) =>
            t.answers.filter((x) => x.covered).map((r) => r.sampleId),
          ),
        ),
      ],
    },
    rate(
      "supported",
      "可对照主张中与知识一致",
      verified.filter((c) => c.verdict === "supported").map((c) => c.sampleId),
      verified.length,
    ),
    {
      id: "contradicted",
      label: "与知识冲突的主张",
      value: claims.filter((c) => c.verdict === "contradicted").length,
      unit: "项",
      sampleIds: [
        ...new Set(
          claims
            .filter((c) => c.verdict === "contradicted")
            .map((c) => c.sampleId),
        ),
      ],
    },
    {
      id: "unverifiable",
      label: "无法核验的主张",
      value: claims.filter((c) => c.verdict === "unverifiable").length,
      unit: "项",
      sampleIds: [
        ...new Set(
          claims
            .filter((c) => c.verdict === "unverifiable")
            .map((c) => c.sampleId),
        ),
      ],
    },
    {
      id: "omitted",
      label: "遗漏知识要点",
      value: knowledgeTopics.length
        ? knowledgeTopics.filter((t) => !t.answers.some((x) => x.covered))
            .length
        : null,
      unit: "项",
      sampleIds: [],
    },
  ];
}

/** All chart values and evidence filters are computed from validated answer records. */
export function diagnosticBreakdown(
  a: DiagnosticAssessment,
  samples: DiagnosticSample[],
  subject: string,
): DiagnosticBreakdown {
  const result: DiagnosticBreakdown = {
    platforms: [],
    ranks: [],
    risks: [],
    coverage: [],
    sources: [],
    drilldowns: [],
  };
  const add = (id: string, label: string, sampleIds: string[]) => {
    const ids = [...new Set(sampleIds)];
    result.drilldowns.push({ id, label, sampleIds: ids });
    return ids;
  };
  for (const platform of [...new Set(samples.map((s) => s.platform))]) {
    const ids = new Set(
      samples.filter((s) => s.platform === platform).map((s) => s.id),
    );
    const subset = {
      ...a,
      answers: a.answers.filter((x) => ids.has(x.sampleId)),
      topics: a.topics.map((t) => ({
        ...t,
        answerRefs: t.answerRefs.filter((r) => ids.has(r.sampleId)),
      })),
      ...(a.category === "product_scenario"
        ? {
            knowledgeCoverage: a.knowledgeCoverage.map((t) => ({
              ...t,
              answers: t.answers.filter((x) => ids.has(x.sampleId)),
            })),
          }
        : {}),
    } as DiagnosticAssessment;
    const metrics = diagnosticMetrics(subset).map((m) => ({
      ...m,
      id: `platform:${platform}:${m.id}`,
    }));
    const label =
      DIAGNOSTIC_PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
    for (const m of metrics) add(m.id, `${label} · ${m.label}`, m.sampleIds);
    result.platforms.push({ id: platform, label, samples: ids.size, metrics });
  }
  if (a.category === "industry_ranking") {
    const ranks = new Map<string, Map<string, number | null>>();
    ranks.set(subject, new Map());
    for (const x of a.answers) {
      if (x.mentioned && x.attribution === "subject")
        ranks.get(subject)!.set(x.sampleId, x.recommended ? x.rank : null);
      for (const c of x.competitors) {
        // One brand can be named several times in an answer; never multiply that sample.
        const values = ranks.get(c.name) ?? new Map();
        if (!values.has(x.sampleId)) values.set(x.sampleId, c.rank);
        ranks.set(c.name, values);
      }
    }
    for (const [name, values] of ranks) {
      const ranked = [...values.values()].filter(
        (r): r is number => r !== null,
      );
      const averageRank = ranked.length
        ? Math.round(
            (ranked.reduce((n, r) => n + r, 0) / ranked.length) * 100,
          ) / 100
        : null;
      const id = `rank:${result.ranks.length}`;
      result.ranks.push({
        id,
        name,
        mentions: values.size,
        averageRank,
        rankedSamples: ranked.length,
        barPercent: 0,
        sampleIds: add(id, `${name} · 位次与提及依据`, [...values.keys()]),
      });
    }
    const max = Math.max(1, ...result.ranks.map((r) => r.averageRank ?? 0));
    for (const r of result.ranks)
      r.barPercent =
        r.averageRank === null
          ? 0
          : Math.round((r.averageRank / max) * 1000) / 10;
    result.ranks.sort(
      (x, y) => (x.averageRank ?? Infinity) - (y.averageRank ?? Infinity),
    );
  }
  if (a.category === "reputation") {
    const risks = new Map<string, Set<string>>();
    for (const x of a.answers)
      for (const risk of x.risks) {
        const ids = risks.get(risk.theme) ?? new Set();
        ids.add(x.sampleId);
        risks.set(risk.theme, ids);
      }
    for (const [theme, ids] of risks) {
      const id = `risk:${result.risks.length}`;
      result.risks.push({
        id,
        theme,
        count: ids.size,
        denominator: a.answers.length,
        sampleIds: add(id, `风险主题：${theme}`, [...ids]),
      });
    }
  }
  for (const [i, topic] of a.topics.entries()) {
    const id = `topic:${i}`;
    add(
      id,
      `知识对照：${topic.topic}`,
      topic.answerRefs.map((r) => r.sampleId),
    );
  }
  if (a.category === "product_scenario")
    for (const [i, point] of a.knowledgeCoverage.entries()) {
      const id = `coverage:${i}`,
        missingId = `coverage-missing:${i}`;
      const ids = add(
        id,
        `要点覆盖：${point.point}`,
        point.answers.filter((x) => x.covered).map((x) => x.sampleId),
      );
      const missingSampleIds = add(
        missingId,
        `未覆盖要点：${point.point}`,
        point.answers.filter((x) => !x.covered).map((x) => x.sampleId),
      );
      result.coverage.push({
        id,
        missingId,
        missingSampleIds,
        topic: point.point,
        verdict: ids.length ? "covered" : "omitted",
        sampleIds: ids,
        platforms: result.platforms.map((p) => ({
          platform: p.id,
          denominator: p.samples,
          count: samples.filter(
            (s) => s.platform === p.id && ids.includes(s.id),
          ).length,
        })),
      });
    }
  const sources = new Map<
    string,
    {
      url: string;
      title: string;
      kind: "citation" | "reference";
      ids: Set<string>;
    }
  >();
  for (const sample of samples)
    for (const kind of ["citation", "reference"] as const) {
      for (const source of kind === "citation"
        ? sample.citations
        : (sample.references ?? [])) {
        const key = `${kind}:${source.url}`;
        const entry = sources.get(key) ?? {
          url: source.url,
          title: source.title || source.url,
          kind,
          ids: new Set(),
        };
        entry.ids.add(sample.id);
        sources.set(key, entry);
      }
    }
  for (const entry of sources.values()) {
    const id = `source:${result.sources.length}`;
    result.sources.push({
      id,
      url: entry.url,
      title: entry.title,
      kind: entry.kind,
      count: entry.ids.size,
      sampleIds: add(
        id,
        `${entry.kind === "citation" ? "实际引用" : "检索参考"}：${entry.title}`,
        [...entry.ids],
      ),
    });
  }
  result.sources.sort((x, y) => y.count - x.count);
  return result;
}
