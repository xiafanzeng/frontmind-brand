// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { BRAND_REPORT_STAGES, calculateBrandReportMetrics, validateBrandReportDocument, type BrandReportDocument } from "../contracts/brand-report.js";
import { planBrandReportBriefing, renderBrandReportMarkdown, renderBriefingHtml, renderBriefingPptx, renderPanoramaHtml } from "../server/report-renderer.js";

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
    expect(metrics).toMatchObject({ samples: 10, mentions: 3, mentionRate: 30, firstRecommendations: 1, firstRecommendationRate: 10, citations: 2 });
    expect(metrics.topSources).toHaveLength(1);
    expect(metrics.topSources[0]?.references).toBe(2);
    expect(renderPanoramaHtml(input)).toContain("30.0%");
    expect(renderBriefingHtml(input)).toContain("30.0%");
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

  it("preserves the entire long briefing in continuation pages", () => {
    const input = fixture(); input.briefingSlides[0]!.bullets = ["长段落。".repeat(100), "第二段".repeat(100), "最后一句必须保留。"];
    const pages = planBrandReportBriefing(input);
    expect(pages.length).toBeGreaterThan(13);
    expect(pages.filter((page) => page.topicIndex === 0).flatMap((page) => page.bullets).join("")).toBe(input.briefingSlides[0]!.bullets.join(""));
    expect(renderBriefingHtml(input)).toContain("最后一句必须保留。");
  });

  it("renders editable PPTX text with the same baseline and source notes", async () => {
    const input = fixture();
    const pptx = await renderBriefingPptx(input);
    const archive = await JSZip.loadAsync(pptx);
    const slideFiles = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideFiles).toHaveLength(13);
    const firstSlide = await archive.file("ppt/slides/slide1.xml")!.async("string");
    expect(firstSlide).toContain("30.0%");
    expect(firstSlide).toContain("第 1 个判断");
    expect(firstSlide).toContain("Microsoft YaHei");
    const notes = await archive.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notes).toContain("https://example.org/source");
    expect(firstSlide).not.toContain("<script>");
  });

  it("keeps Markdown tables and code readable without accepting raw HTML", () => {
    const html = renderBrandReportMarkdown("# 标题\n\n| 名称 | 值 |\n| --- | --- |\n| 样本 | 30 |\n\n```html\n<script>unsafe()</script>\n```\n\n- 第一条\n- 第二条");
    expect(html).toContain("<table>"); expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;"); expect(html).toContain("<li>第二条</li>");
  });
});
