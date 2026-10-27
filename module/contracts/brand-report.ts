import { z } from "zod";

export const BRAND_REPORT_SCHEMA_VERSION = "brand-report-v1" as const;
export const BRAND_REPORT_WORKFLOW_VERSION = "report-v3-web-html-2" as const;
export const BRAND_REPORT_STAGES = [
  { id: "S1", title: "品牌事实", description: "整理企业资料与公开证据" },
  { id: "S2", title: "营销图谱", description: "理解受众、场景与决策问题" },
  { id: "S3", title: "品类趋势", description: "研究市场变化与机会" },
  { id: "S4", title: "品牌定位", description: "比较竞品并明确核心产品" },
  { id: "S4.8", title: "核心产品与双问题", description: "根据研究形成一次确认的产品与问题卡片" },
  { id: "S5", title: "品牌诊断", description: "结合真实回答分析品牌可见性" },
  { id: "S5.5", title: "语义资产审计", description: "分析品牌资产与引用信源" },
  { id: "S6", title: "品牌话语体系", description: "形成有证据的表达与话术" },
  { id: "S7", title: "视觉符号体系", description: "明确视觉方向与应用规则" },
  { id: "S8", title: "问答与内容规划", description: "规划问答、内容日历与落地页" },
  { id: "S9", title: "业务赋能", description: "安排执行路线、协作与评估" },
  { id: "S9.8", title: "内容标题机会", description: "形成可以执行的内容选题" },
] as const;
export const brandReportStageIdSchema = z.enum(["S1", "S2", "S3", "S4", "S4.8", "S5", "S5.5", "S6", "S7", "S8", "S9", "S9.8"]);
export type BrandReportStageId = z.infer<typeof brandReportStageIdSchema>;

const publicUrl = z.string().url().max(4000).refine((value) => {
  const parsed = new URL(value);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}, "来源必须是 HTTP(S) 链接，且不包含登录凭据");
export const brandReportSourceSchema = z.object({ title: z.string().min(1).max(500), url: publicUrl });
export const brandReportStageSchema = z.object({
  id: brandReportStageIdSchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(4000),
  markdown: z.string().min(1).max(100000),
  sources: z.array(brandReportSourceSchema).min(1).max(100),
});
export type BrandReportStage = z.infer<typeof brandReportStageSchema>;

export const brandReportSampleSchema = z.object({
  id: z.string().min(1).max(200),
  platform: z.string().min(1).max(100),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(100000),
  mentioned: z.boolean(),
  sentiment: z.enum(["positive", "neutral", "negative", "unknown"]).optional(),
  sentimentEvidence: z.array(z.string().max(20000)).max(100).optional(),
  collectedAt: z.string().max(100).optional(),
  supplierTaskId: z.string().max(200).optional(),
  rank: z.number().int().positive().nullable(),
  citations: z.array(brandReportSourceSchema.extend({ site: z.string().max(500).optional() })).max(1000),
  references: z.array(brandReportSourceSchema.extend({ site: z.string().max(500).optional() })).max(1000).optional(),
});
export type BrandReportSample = z.infer<typeof brandReportSampleSchema>;

export const brandReportMonitoringSchema = z.object({
  confirmedAt: z.string().min(1),
  questions: z.tuple([z.string().min(1), z.string().min(1)]),
  platforms: z.array(z.string().min(1)).min(1).max(15),
  samples: z.array(brandReportSampleSchema).min(1).max(1000),
});
export const brandReportBriefingSlideSchema = z.object({
  title: z.string().min(1).max(120),
  lead: z.string().max(2000),
  bullets: z.array(z.string().min(1).max(6000)).min(1).max(20),
  sourceStageIds: z.array(brandReportStageIdSchema).min(1),
});
export const BRAND_REPORT_BRIEFING_ROSTER = [
  "整体判断", "GEO 与品牌机会", "现状诊断", "总体策略", "品牌定义与叙事", "需求与决策占位",
  "信任与风险回应", "权威信源建设", "三个月行动", "六个月规划", "成效看板", "服务与协作", "行动总结",
] as const;
export const brandReportDocumentSchema = z.object({
  schemaVersion: z.literal(BRAND_REPORT_SCHEMA_VERSION),
  brandName: z.string().min(1).max(300),
  generatedAt: z.string().min(1),
  overview: z.string().min(1).max(6000),
  stages: z.array(brandReportStageSchema).length(BRAND_REPORT_STAGES.length),
  monitoring: brandReportMonitoringSchema,
  briefingSlides: z.array(brandReportBriefingSlideSchema).length(13),
}).superRefine((document, ctx) => {
  const ids = new Set(document.stages.map((stage) => stage.id));
  if (ids.size !== document.stages.length) ctx.addIssue({ code: "custom", path: ["stages"], message: "研究阶段不能重复" });
  for (const stage of BRAND_REPORT_STAGES) {
    if (!ids.has(stage.id)) ctx.addIssue({ code: "custom", path: ["stages"], message: `缺少 ${stage.id} ${stage.title}` });
  }
  const { questions, platforms, samples } = document.monitoring;
  if (new Set(questions).size !== 2) ctx.addIssue({ code: "custom", path: ["monitoring", "questions"], message: "必须确认两个不同的监测问题" });
  if (new Set(platforms).size !== platforms.length) ctx.addIssue({ code: "custom", path: ["monitoring", "platforms"], message: "平台不能重复" });
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) ctx.addIssue({ code: "custom", path: ["monitoring", "samples"], message: "采集记录不能重复" });
  for (const sample of samples) {
    if (!questions.includes(sample.question) || !platforms.includes(sample.platform)) ctx.addIssue({ code: "custom", path: ["monitoring", "samples"], message: "采集记录不属于已确认的问题与平台" });
  }
  for (const platform of platforms) for (const question of questions) {
    if (samples.filter((sample) => sample.platform === platform && sample.question === question).length !== 5) {
      ctx.addIssue({ code: "custom", path: ["monitoring", "samples"], message: `${platform} 每个已确认问题必须有 5 条完整采集记录` });
    }
  }
});
export type BrandReportDocument = z.infer<typeof brandReportDocumentSchema>;

export function validateBrandReportDocument(input: unknown): BrandReportDocument {
  return brandReportDocumentSchema.parse(input);
}

export const BRAND_REPORT_PLATFORM_LABELS: Record<string, string> = {
  doubao: "豆包", yuanbao: "元宝", qianwen: "千问", deepseek: "DeepSeek", kimi: "Kimi",
  chatgpt: "ChatGPT", googleai: "Google AI", bingai_overviews: "必应 AI", baiduai: "百度文心", quark: "夸克",
};

/** Both HTML reports derive every measured number from this frozen sample set.
 * Q2 deliberately never enters visibility or rank denominators. */
export function calculateBrandReportMetrics(monitoring: BrandReportDocument["monitoring"]) {
  const rate = (count: number, total: number) => total ? count / total * 100 : 0;
  const metrics = (samples: BrandReportSample[]) => {
    const ranked = samples.filter(sample => sample.mentioned && sample.rank !== null);
    const mentions = samples.filter(sample => sample.mentioned).length;
    const firstRecommendations = ranked.filter(sample => sample.rank === 1).length;
    const top3 = ranked.filter(sample => sample.rank! <= 3).length;
    const top5 = ranked.filter(sample => sample.rank! <= 5).length;
    return { samples: samples.length, mentions, mentionRate: rate(mentions, samples.length),
      firstRecommendations, firstRecommendationRate: rate(firstRecommendations, samples.length),
      top3, top3Rate: rate(top3, samples.length), top5, top5Rate: rate(top5, samples.length),
      rankedSamples: ranked.length, averageRank: ranked.length ? ranked.reduce((sum, sample) => sum + sample.rank!, 0) / ranked.length : null,
      rankDistribution: [
        { label: "第 1 位", count: firstRecommendations },
        { label: "第 2–3 位", count: ranked.filter(sample => sample.rank! >= 2 && sample.rank! <= 3).length },
        { label: "第 4–5 位", count: ranked.filter(sample => sample.rank! >= 4 && sample.rank! <= 5).length },
        { label: "第 6–10 位", count: ranked.filter(sample => sample.rank! >= 6 && sample.rank! <= 10).length },
        { label: "第 11 位及以后", count: ranked.filter(sample => sample.rank! >= 11).length },
        { label: "提及但无位次", count: samples.filter(sample => sample.mentioned && sample.rank === null).length },
        { label: "未提及", count: samples.filter(sample => !sample.mentioned).length },
      ],
      citations: samples.reduce((sum, sample) => sum + sample.citations.length, 0),
    };
  };
  const ranking = monitoring.samples.filter(sample => sample.question === monitoring.questions[0]);
  const reputation = monitoring.samples.filter(sample => sample.question === monitoring.questions[1]);
  const sources = new Map<string, { url: string; title: string; site: string; references: number; questions: string[]; platforms: string[] }>();
  const domains = new Map<string, { site: string; references: number; articles: Set<string>; platforms: Set<string> }>();
  for (const sample of monitoring.samples) for (const source of sample.citations) {
    const question = sample.question === monitoring.questions[0] ? "Q1" : "Q2";
    const current = sources.get(source.url);
    if (current) { current.references += 1; if (!current.questions.includes(question)) current.questions.push(question); if (!current.platforms.includes(sample.platform)) current.platforms.push(sample.platform); }
    else sources.set(source.url, { url: source.url, title: source.title, site: source.site || new URL(source.url).hostname, references: 1, questions: [question], platforms: [sample.platform] });
    const host = new URL(source.url).hostname.replace(/^www\./, "");
    const domain = domains.get(host) ?? { site: host, references: 0, articles: new Set<string>(), platforms: new Set<string>() };
    domain.references += 1; domain.articles.add(source.url); domain.platforms.add(sample.platform); domains.set(host, domain);
  }
  return {
    ...metrics(ranking), samples: monitoring.samples.length, rankingSamples: ranking.length,
    citations: monitoring.samples.reduce((sum, sample) => sum + sample.citations.length, 0),
    referenceRecords: monitoring.samples.reduce((sum, sample) => sum + (sample.references?.length ?? 0), 0),
    platforms: monitoring.platforms.map(platform => ({ platform, label: BRAND_REPORT_PLATFORM_LABELS[platform] ?? platform, ...metrics(ranking.filter(sample => sample.platform === platform)) })),
    reputation: { samples: reputation.length, negative: reputation.filter(sample => sample.sentiment === "negative").length, positive: reputation.filter(sample => sample.sentiment === "positive").length, neutral: reputation.filter(sample => sample.sentiment === "neutral").length, unclassified: reputation.filter(sample => !sample.sentiment || sample.sentiment === "unknown").length, mentioned: reputation.filter(sample => sample.mentioned).length,
      platforms: monitoring.platforms.map(platform => ({ platform, label: BRAND_REPORT_PLATFORM_LABELS[platform] ?? platform, samples: reputation.filter(sample => sample.platform === platform).length, negative: reputation.filter(sample => sample.platform === platform && sample.sentiment === "negative").length, positive: reputation.filter(sample => sample.platform === platform && sample.sentiment === "positive").length, neutral: reputation.filter(sample => sample.platform === platform && sample.sentiment === "neutral").length, unclassified: reputation.filter(sample => sample.platform === platform && (!sample.sentiment || sample.sentiment === "unknown")).length, citations: reputation.filter(sample => sample.platform === platform).reduce((sum, sample) => sum + sample.citations.length, 0) })) },
    topSources: [...sources.values()].sort((a, b) => b.references - a.references || a.url.localeCompare(b.url)),
    domains: [...domains.values()].map(domain => ({ ...domain, articles: domain.articles.size, platforms: [...domain.platforms] })).sort((a, b) => b.references - a.references || a.site.localeCompare(b.site)),
  };
}
