// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BRAND_REPORT_STAGES, calculateBrandReportMetrics, validateBrandReportDocument, type BrandReportDocument } from "../contracts/brand-report.js";
import { planBrandReportBriefing, renderBrandReportMarkdown, renderBriefingHtml, renderPanoramaHtml, customerReportMarkdown } from "../server/report-renderer.js";

function fixture(): BrandReportDocument {
  return {
    schemaVersion: "brand-report-v1", brandName: "测试企业 <script>alert(1)</script>", generatedAt: "2026-10-26T00:00:00Z", overview: "这是一份来自本轮真实输入的研究概述。",
    stages: BRAND_REPORT_STAGES.map((stage) => ({ id: stage.id, title: stage.title, summary: `${stage.title}的阶段判断`, markdown: `## ${stage.title}\n\n本阶段完整结论。\n\n- 建议和证据。\n\n| 项目 | 说明 |\n| --- | --- |\n| 品牌 | 已核实资料 |`, sources: [{ title: "公开资料", url: "https://example.org/source" }] })),
    monitoring: { confirmedAt: "2026-10-25T20:00:00Z", questions: ["产品推荐", "品牌有什么缺点和问题？"], platforms: ["doubao"], samples: Array.from({ length: 10 }, (_, index) => ({ id: `sample-${index}`, platform: "doubao", question: index < 5 ? "产品推荐" : "品牌有什么缺点和问题？", answer: `原始回答 ${index}`, mentioned: index < 3, rank: index === 0 ? 1 : null, citations: index < 2 ? [{ title: "来源", url: "https://example.org/article", site: "案例媒体" }] : [] })) },
    briefingSlides: Array.from({ length: 13 }, (_, index) => ({ title: `第 ${index + 1} 个判断`, lead: "建议结合本轮证据决定后续动作。", bullets: ["明确企业身份与核心产品。", "保留来源和复测记录。"], sourceStageIds: ["S1"] })),
  };
}

describe("report data and delivery", () => {
  it("computes identical measured KPI baselines from frozen answers", () => {
    const input = validateBrandReportDocument(fixture());
    const metrics = calculateBrandReportMetrics(input.monitoring);
    expect(metrics).toMatchObject({ samples: 10, rankingSamples: 5, mentions: 3, mentionRate: 60, firstRecommendations: 1, firstRecommendationRate: 20, citations: 2 });
    expect(metrics.topSources).toHaveLength(1);
    expect(metrics.topSources[0]?.references).toBe(2);
    expect(renderPanoramaHtml(input)).toContain("60.0%");
    expect(renderBriefingHtml(input)).toContain("60.0%");
  });

  it("rejects incomplete research and incomplete or duplicate monitoring", () => {
    const missingStage = fixture(); missingStage.stages[1] = missingStage.stages[0]!;
    expect(() => validateBrandReportDocument(missingStage)).toThrow("缺少 S2");
    const partial = fixture(); partial.monitoring.samples.pop();
    expect(() => validateBrandReportDocument(partial)).toThrow("5 条完整采集记录");
    const repeated = fixture(); repeated.monitoring.samples[1]!.id = repeated.monitoring.samples[0]!.id;
    expect(() => validateBrandReportDocument(repeated)).toThrow("采集记录不能重复");
  });

  it("never executes generated HTML or external scripts in downloadable reports", () => {
    const input = fixture();
    input.stages[0]!.markdown = '<img src="https://attacker.invalid/log" onerror="alert(1)">\n\n[unsafe](javascript:alert(1))';
    const html = renderPanoramaHtml(input);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<img src="https://attacker.invalid');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('href="javascript:');
    expect(() => validateBrandReportDocument({ ...input, stages: input.stages.map((stage) => ({ ...stage, sources: [{ title: "bad", url: "javascript:alert(1)" }] })) })).toThrow();
  });

  it("preserves the entire long briefing in naturally growing HTML sections", () => {
    const input = fixture(); input.briefingSlides[0]!.bullets = ["长段落。".repeat(100), "第二段".repeat(100), "最后一句必须保留。"];
    const pages = planBrandReportBriefing(input);
    expect(pages).toHaveLength(13);
    expect(pages.filter((page) => page.topicIndex === 0).flatMap((page) => page.bullets).join("")).toBe(input.briefingSlides[0]!.bullets.join(""));
    expect(renderBriefingHtml(input)).toContain("最后一句必须保留。");
  });

  it("excludes Q2 from every visibility and ranking metric while preserving risk and source evidence", () => {
    const input=fixture();
    input.monitoring.samples.filter(sample=>sample.question===input.monitoring.questions[1]).forEach(sample=>{
      sample.mentioned=true;sample.rank=1;sample.sentiment="negative";sample.sentimentEvidence=["供应商返回的风险上下文"];
      sample.references=[{title:"检索参考",url:"https://reference.example.org/search"}];
    });
    const metrics=calculateBrandReportMetrics(input.monitoring);
    expect(metrics).toMatchObject({rankingSamples:5,mentionRate:60,firstRecommendationRate:20,top3Rate:20,top5Rate:20,averageRank:1,referenceRecords:5,reputation:{samples:5,negative:5}});
    expect(metrics.platforms[0]).toMatchObject({samples:5,mentions:3,firstRecommendations:1});
    expect(metrics.citations).toBe(2);expect(metrics.topSources).toHaveLength(1);
    for(const html of [renderPanoramaHtml(input),renderBriefingHtml(input)]){
      expect(html).toContain("60.0%");expect(html).toContain("Q2 舆情、风险与信任");
      expect(html).toContain("供应商返回的风险上下文");expect(html).toContain("检索参考（未计入实际引用）");
      expect(html).toContain('id="methods"');expect(html).toContain('id="evidence"');
      expect(html).not.toContain("PPTX");expect(html).not.toContain(".pdf");
    }
  });

  it("preserves unranked mentions separately from nonmentions and never invents missing ranks",()=>{
    const input=fixture();input.monitoring.samples[0]!.rank=null;
    const metrics=calculateBrandReportMetrics(input.monitoring);
    expect(metrics.averageRank).toBeNull();expect(metrics.rankDistribution.find(bin=>bin.label==='提及但无位次')?.count).toBe(3);
    expect(metrics.rankDistribution.find(bin=>bin.label==='未提及')?.count).toBe(2);
    expect(renderPanoramaHtml(input)).toContain('无可计算位次');
  });

  it("keeps research bodies, citations and valid navigation in both outputs",()=>{
    const input=fixture();input.stages.find(stage=>stage.id==='S8')!.markdown+='\n\n日历完整正文末尾';
    const panorama=renderPanoramaHtml(input),briefing=renderBriefingHtml(input);
    expect(panorama).toContain('日历完整正文末尾');
    expect(panorama.indexOf('id="stage-S8"')).toBeLessThan(panorama.indexOf('id="stage-S9-8"'));
    expect(panorama.indexOf('id="stage-S9-8"')).toBeLessThan(panorama.indexOf('id="stage-S9"'));
    expect(panorama).not.toContain('data-source-stage="S4.8"');
    for(const html of [panorama,briefing]){
      const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for(const match of html.matchAll(/href="#([^"]+)"/g))expect(ids).toContain(match[1]);
      expect(html).toContain('max-width:100%');expect(html).toContain('@media(max-width:700px)');
    }
  });

  it("filters only specified internal sections and preserves the following customer content",()=>{
    const text='## 已核实事实\n必须保留\n## 下游注入规则\n不得外显\n### 内部细节\n也隐藏\n## 行动安排\n继续保留';
    expect(customerReportMarkdown(text,'S6')).toContain('必须保留');expect(customerReportMarkdown(text,'S6')).toContain('继续保留');
    expect(customerReportMarkdown(text,'S6')).not.toContain('不得外显');
    expect(customerReportMarkdown('## 危机与错误信息回应模板的研究发现\n客户可读研究','S6')).toContain('客户可读研究');
    expect(customerReportMarkdown('## 三、下游注入规则\n内部规则','S6')).not.toContain('内部规则');
    expect(customerReportMarkdown('## 问答树\n内部树\n## 12周内容日历\n逐周日历','S8')).not.toContain('内部树');
  });

  it("keeps Markdown tables and code readable without accepting raw HTML", () => {
    const html = renderBrandReportMarkdown("# 标题\n\n| 名称 | 值 |\n| --- | --- |\n| 样本 | 30 |\n\n```html\n<script>unsafe()</script>\n```\n\n- 第一条\n- 第二条");
    expect(html).toContain("<table>"); expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;"); expect(html).toContain("<li>第二条</li>");
  });
});
