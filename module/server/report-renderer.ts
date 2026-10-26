import PptxGenJSModule from "pptxgenjs";
// pptxgenjs 4 publishes CJS-shaped declarations beside its ESM constructor.
const PptxGenJS = PptxGenJSModule as unknown as typeof import("pptxgenjs").default;
import {
  BRAND_REPORT_BRIEFING_ROSTER,
  BRAND_REPORT_STAGES,
  calculateBrandReportMetrics,
  validateBrandReportDocument,
  type BrandReportDocument,
} from "../contracts/brand-report.js";

export { validateBrandReportDocument } from "../contracts/brand-report.js";

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const percentage = (value: number) => `${value.toFixed(1)}%`;

function link(value: string, label: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return escapeHtml(label);
    return `<a href="${escapeHtml(url.href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
  } catch { return escapeHtml(label); }
}

/** Deliberately renders a small, safe Markdown vocabulary; raw HTML is always text. */
export function renderBrandReportMarkdown(markdown: string): string {
  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length) { blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; }
    if (items.length) { blocks.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`); items = []; }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("```") || line.startsWith("~~~")) {
      flush(); const delimiter = line.slice(0, 3); const code: string[] = [];
      while (++index < lines.length && !lines[index]!.trim().startsWith(delimiter)) code.push(lines[index]!);
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
      flush(); const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      const headings = cells(line); index += 1; const rows: string[][] = [];
      while (index + 1 < lines.length && lines[index + 1]!.includes("|") && lines[index + 1]!.trim()) rows.push(cells(lines[++index]!));
      blocks.push(`<div class="table-scroll"><table><thead><tr>${headings.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flush(); const level = Math.min(4, heading[1]!.length + 1); blocks.push(`<h${level}>${inline(heading[2]!)}</h${level}>`); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flush(); blocks.push("<hr>"); continue; }
    const item = /^(?:[-*+]\s+|\d+[.)、]\s*)(.+)$/.exec(line);
    if (item) { if (paragraph.length) flush(); items.push(item[1]!); continue; }
    if (items.length) flush();
    if (line.startsWith(">")) { flush(); blocks.push(`<blockquote>${inline(line.replace(/^>\s*/, ""))}</blockquote>`); continue; }
    paragraph.push(line);
  }
  flush(); return blocks.join("\n");
}

const css = `
:root{color-scheme:light;--blue:#1f70c2;--ink:#132238;--muted:#64748b;--line:#dde5ef;--paper:#fff;--wash:#f3f7fc}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.8 "Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif}a{color:var(--blue);overflow-wrap:anywhere}a:hover{text-decoration:underline}main{max-width:1160px;margin:0 auto;padding:40px 28px 64px}.masthead{border-top:5px solid var(--blue);padding:36px;background:var(--paper);border-radius:0 0 16px 16px;margin-bottom:24px}.brand{font-size:12px;letter-spacing:.18em;font-weight:700;color:var(--blue)}h1{font-size:32px;line-height:1.4;margin:14px 0 8px}h2{font-size:24px;line-height:1.5;margin:0 0 18px}h3{font-size:19px;line-height:1.6;margin:24px 0 12px}h4{font-size:16px;margin:20px 0 10px}p{margin:12px 0;overflow-wrap:anywhere}small,.muted{color:var(--muted)}.section{background:#fff;border:1px solid var(--line);border-radius:14px;padding:30px;margin:24px 0;break-inside:auto}.section-number{display:inline-block;background:#e7f1ff;color:var(--blue);font-size:12px;padding:3px 10px;border-radius:5px;margin-bottom:12px;font-weight:700}.lead{font-size:17px;color:#384c67;margin:10px 0 22px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}.metric{border:1px solid var(--line);border-radius:10px;padding:18px;background:#f8fbff}.metric strong{display:block;font-size:30px;color:var(--blue);line-height:1.5}.metric span{font-size:13px;color:var(--muted)}.method{padding:14px 18px;border-left:3px solid #82b6ee;background:#f2f7fd;font-size:13px;color:#46617e}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}th{text-align:left;background:#edf4fd;color:#31506f}td,th{border-bottom:1px solid var(--line);padding:11px 12px;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.bar-row{display:grid;grid-template-columns:90px 1fr 65px;gap:14px;align-items:center;margin:16px 0;font-size:14px}.bar-track{background:#eaf0f8;border-radius:5px;height:18px;overflow:hidden}.bar{background:var(--blue);height:100%;border-radius:5px}.sources{border-top:1px solid var(--line);margin-top:28px;padding-top:16px;font-size:12px}.sources ol{padding-left:22px}.sources li{margin:7px 0}.toc{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.toc a{border:1px solid var(--line);padding:10px 14px;border-radius:7px;text-decoration:none;font-size:14px}.pill{display:inline-block;color:var(--blue);background:#e7f1ff;border-radius:6px;padding:2px 9px;margin-right:8px;font-size:12px}.actions{position:sticky;top:0;background:rgba(243,247,252,.96);z-index:3;padding:12px 0;display:flex;gap:12px;font-size:13px}.actions a{padding:7px 14px;border:1px solid #a8c8ed;border-radius:7px;background:#fff;text-decoration:none}.slide{break-inside:avoid}.slide ul{padding-left:24px}.slide li{margin:15px 0;overflow-wrap:anywhere}.evidence{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px;margin-top:20px}blockquote{border-left:3px solid #bdd5f1;margin:14px 0;padding:8px 18px;background:#f8fbff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:15px;border-radius:6px}code{font-family:ui-monospace,monospace;font-size:.9em}hr{border:0;border-top:1px solid var(--line);margin:22px 0}details{border-top:1px solid var(--line);padding:13px 0}summary{cursor:pointer;font-weight:600}footer{color:var(--muted);font-size:12px;text-align:center;padding-top:20px}.sample-answer{white-space:pre-wrap;font-size:13px;line-height:1.8}
@media(max-width:700px){main{padding:20px 12px}.masthead,.section{padding:22px 18px}h1{font-size:26px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.toc{grid-template-columns:1fr}.bar-row{grid-template-columns:65px 1fr 55px;gap:8px}.metric strong{font-size:25px}}
@media print{@page{size:A4;margin:16mm 14mm}body{background:white;font-size:10pt;line-height:1.7}main{max-width:none;padding:0}.actions,.no-print{display:none}.masthead{padding:16mm 8mm;min-height:190mm;border-radius:0;break-after:page}.section{border:0;border-radius:0;padding:0;margin:0;break-before:page}.section h2{font-size:21pt}.metric{padding:10px}.metric strong{font-size:22pt}.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.slide{break-before:page;break-inside:auto}.table-scroll{overflow:visible}a{color:inherit;text-decoration:none}.toc{grid-template-columns:1fr 1fr}.sources{break-inside:auto}details{display:block}details>*{display:block}summary{display:none}h2,h3,h4{break-after:avoid}}
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main>${body}<footer>FrontMind · 品牌研究与 GEO 报告</footer></main></body></html>`;
}

function metricsHtml(document: BrandReportDocument) {
  const metrics = calculateBrandReportMetrics(document.monitoring);
  return `<div class="metrics"><div class="metric"><strong>${metrics.samples}</strong><span>实际采集回答</span></div><div class="metric"><strong>${percentage(metrics.mentionRate)}</strong><span>品牌提及率</span></div><div class="metric"><strong>${percentage(metrics.firstRecommendationRate)}</strong><span>首位出现占比</span></div><div class="metric"><strong>${metrics.citations}</strong><span>引用记录</span></div></div><div class="method">指标来自本轮已确认的两个问题；每个平台、每个问题采集 5 次。提及率 = 提及品牌的回答数 ÷ 全部回答数；首位出现占比 = 供应商返回品牌排序为 1 的回答数 ÷ 全部回答数。仅反映出现顺序，不代表正面评价或推荐。未提供排名的回答不计为首位。该样本反映本轮采集情况，不代表平台整体表现。</div>`;
}

function platformHtml(document: BrandReportDocument) {
  const metrics = calculateBrandReportMetrics(document.monitoring);
  return `<h3>各平台品牌提及情况</h3>${metrics.platforms.map((platform) => `<div class="bar-row"><span>${escapeHtml(platform.label)}</span><div class="bar-track"><div class="bar" style="width:${platform.mentionRate.toFixed(4)}%"></div></div><strong>${percentage(platform.mentionRate)}</strong></div>`).join("")}<div class="table-scroll"><table><thead><tr><th>平台</th><th>回答数</th><th>提及回答</th><th>首位出现</th><th>引用记录</th></tr></thead><tbody>${metrics.platforms.map((platform) => `<tr><td>${escapeHtml(platform.label)}</td><td>${platform.samples}</td><td>${platform.mentions}</td><td>${platform.firstRecommendations}</td><td>${platform.citations}</td></tr>`).join("")}</tbody></table></div>`;
}

function sourceHtml(document: BrandReportDocument) {
  const metrics = calculateBrandReportMetrics(document.monitoring);
  return `<h3>高频引用信源</h3>${metrics.topSources.length ? `<div class="table-scroll"><table><thead><tr><th>来源</th><th>引用内容</th><th>引用次数</th></tr></thead><tbody>${metrics.topSources.slice(0, 20).map((source) => `<tr><td>${escapeHtml(source.site)}</td><td>${link(source.url, source.title)}</td><td>${source.references}</td></tr>`).join("")}</tbody></table></div>` : "<p class=\"muted\">本轮回答未返回引用链接；报告不据此推断平台没有引用信源。</p>"}`;
}

function header(document: BrandReportDocument, subtitle: string) {
  return `<header class="masthead"><div class="brand">FRONTMIND / BRAND INTELLIGENCE</div><h1>${escapeHtml(document.brandName)}</h1><h2>${escapeHtml(subtitle)}</h2><p class="muted">生成时间：${escapeHtml(document.generatedAt)} · 数据确认：${escapeHtml(document.monitoring.confirmedAt)}</p><p class="lead">${escapeHtml(document.overview)}</p></header>`;
}

export function renderPanoramaHtml(input: BrandReportDocument): string {
  const document = validateBrandReportDocument(input);
  const ordered = BRAND_REPORT_STAGES.map((stage) => document.stages.find((entry) => entry.id === stage.id)!);
  const sections = ordered.map((stage, index) => `<section class="section" id="stage-${stage.id.replaceAll(".", "-")}"><span class="section-number">第 ${index + 1} 部分</span><h2>${escapeHtml(stage.title)}</h2><p class="lead">${escapeHtml(stage.summary)}</p>${stage.id === "S5" ? `${metricsHtml(document)}${platformHtml(document)}` : ""}${stage.id === "S5.5" ? sourceHtml(document) : ""}<div class="report-copy">${renderBrandReportMarkdown(stage.markdown)}</div><div class="sources"><strong>本部分研究来源</strong><ol>${stage.sources.map((source) => `<li>${link(source.url, source.title)}</li>`).join("")}</ol></div></section>`).join("");
  const sampleAppendix = `<section class="section" id="evidence"><span class="section-number">数据附录</span><h2>本轮采集与引用明细</h2><p class="method">以下保留采集返回的原始回答。回答中的观点是平台返回内容，不能直接视为核实事实。研究结论应结合正文来源与企业事实判断。</p>${document.monitoring.samples.map((sample, index) => `<details><summary>${index + 1}. ${escapeHtml(sample.platform)} · ${escapeHtml(sample.question)}</summary><div class="sample-answer">${escapeHtml(sample.answer)}</div><p class="muted">品牌提及：${sample.mentioned ? "有" : "无"}；排名：${sample.rank ?? "未提供"}</p>${sample.citations.length ? `<ul>${sample.citations.map((source) => `<li>${link(source.url, source.title)}</li>`).join("")}</ul>` : "<p class=\"muted\">此回答未返回引用链接。</p>"}</details>`).join("")}</section>`;
  return page(`${document.brandName} · 全景报告`, `${header(document, "AI 智能品牌优化全景报告")}<nav class="section"><h2>报告目录</h2><div class="toc">${ordered.map((stage, index) => `<a href="#stage-${stage.id.replaceAll(".", "-")}">${index + 1}. ${escapeHtml(stage.title)}</a>`).join("")}<a href="#evidence">采集与引用明细</a></div></nav>${sections}${sampleAppendix}`);
}

type BriefingPage = { topicIndex: number; title: string; lead: string; bullets: string[]; sourceStageIds: string[]; continuation: boolean };
const weight = (text: string) => [...text].reduce((sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 1 : 0.55), 0);
function splitText(text: string, limit: number): string[] {
  const result: string[] = []; let current = "";
  for (const character of text) {
    if (current && weight(current + character) > limit) { result.push(current); current = ""; }
    current += character;
  }
  if (current) result.push(current);
  return result;
}

/** Long narrative gets continuation pages, never truncated or squeezed into unreadable type. */
export function planBrandReportBriefing(document: BrandReportDocument): BriefingPage[] {
  return document.briefingSlides.flatMap((slide, topicIndex) => {
    const chunks = slide.bullets.flatMap((bullet) => splitText(bullet, 130));
    const leadChunks = splitText(slide.lead, 150);
    const firstLead = leadChunks.shift() ?? "";
    const pending = [...leadChunks, ...chunks];
    const pages: BriefingPage[] = [];
    let next = 0;
    do {
      const continuation = pages.length > 0;
      const bullets: string[] = []; let available = continuation ? 440 : topicIndex === 10 ? 130 : 300;
      while (next < pending.length && bullets.length < 4) {
        const current = pending[next]!;
        if (bullets.length && weight(current) > available) break;
        bullets.push(current); available -= weight(current) + 28; next += 1;
      }
      pages.push({ topicIndex, title: slide.title, lead: continuation ? "" : firstLead, bullets, sourceStageIds: slide.sourceStageIds, continuation });
    } while (next < pending.length);
    return pages;
  });
}

export function renderBriefingHtml(input: BrandReportDocument): string {
  const document = validateBrandReportDocument(input);
  const pages = planBrandReportBriefing(document);
  return page(`${document.brandName} · 汇报报告`, `${header(document, "GEO 汇报报告")}<nav class="actions"><a href="#diagnosis">查看诊断数据</a><a href="#briefing">查看汇报方案</a></nav><section class="section" id="diagnosis"><span class="section-number">本轮实测</span><h2>品牌诊断总览</h2>${metricsHtml(document)}${platformHtml(document)}${sourceHtml(document)}<h3>监测问题</h3><ol>${document.monitoring.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol></section><section class="section" id="briefing"><h2>汇报方案</h2><p class="muted">以下汇报与可下载的 PPTX 使用同一份数据和内容。规划中的目标、预算与时间安排均为建议，以实际执行和复测结果为准。</p></section>${pages.map((slide, index) => `<section class="section slide"><span class="section-number">${String(index + 1).padStart(2, "0")} / ${pages.length} · ${escapeHtml(BRAND_REPORT_BRIEFING_ROSTER[slide.topicIndex]!)}${slide.continuation ? " · 续" : ""}</span><h2>${escapeHtml(slide.title)}</h2>${slide.lead ? `<p class="lead">${escapeHtml(slide.lead)}</p>` : ""}${[0, 2, 10, 12].includes(slide.topicIndex) && !slide.continuation ? metricsHtml(document) : ""}${slide.topicIndex === 10 && !slide.continuation ? platformHtml(document) : ""}<ul>${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul><div class="evidence">研究依据：${slide.sourceStageIds.map((id) => escapeHtml(document.stages.find((stage) => stage.id === id)?.title ?? id)).join(" · ")}</div></section>`).join("")}`);
}

export async function renderBriefingPptx(input: BrandReportDocument): Promise<Buffer> {
  const document = validateBrandReportDocument(input);
  const pages = planBrandReportBriefing(document);
  const metrics = calculateBrandReportMetrics(document.monitoring);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "FrontMind"; pptx.subject = "GEO 汇报报告"; pptx.title = `${document.brandName} · GEO 汇报报告`;
  pptx.company = "FrontMind";
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" };
  pages.forEach((page, index) => {
    const slide = pptx.addSlide(); slide.background = { color: "F3F7FC" };
    const addText: typeof slide.addText = (text, options) => slide.addText(text, { fontFace: "Microsoft YaHei", lang: "zh-CN", ...options });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: 7.5, fill: { color: "1F70C2" }, line: { color: "1F70C2" } });
    addText(`FRONTMIND  /  ${document.brandName}`, { x: 0.58, y: 0.25, w: 11.8, h: 0.32, fontSize: 10, color: "1F70C2", bold: true, margin: 0 });
    addText(`${BRAND_REPORT_BRIEFING_ROSTER[page.topicIndex]}${page.continuation ? " · 续" : ""}`, { x: 0.62, y: 0.8, w: 11.9, h: 0.3, fontSize: 11, color: "64748B", margin: 0 });
    addText(page.title, { x: 0.6, y: 1.16, w: 12, h: 1.0, fontSize: weight(page.title) > 65 ? 22 : 28, color: "132238", bold: true, breakLine: false, fit: "shrink", margin: 0, valign: "middle" });
    const showMetrics = [0, 2, 10, 12].includes(page.topicIndex) && !page.continuation;
    let y = 2.3;
    if (showMetrics) {
      const values = [[String(metrics.samples), "采集回答"], [percentage(metrics.mentionRate), "品牌提及率"], [percentage(metrics.firstRecommendationRate), "首位出现占比"], [String(metrics.citations), "引用记录"]];
      values.forEach(([value, label], position) => {
        const x = 0.62 + position * 3.05;
        slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 2.86, h: 0.83, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "DDE5EF", width: 0.7 } });
        addText(value!, { x: x + 0.13, y: y + 0.08, w: 2.6, h: 0.35, fontSize: 24, color: "1F70C2", bold: true, margin: 0 });
        addText(label!, { x: x + 0.13, y: y + 0.52, w: 2.6, h: 0.18, fontSize: 10, color: "64748B", margin: 0 });
      }); y += 1.0;
    }
    const chartPage = page.topicIndex === 10 && !page.continuation;
    if (chartPage) {
      slide.addChart(pptx.ChartType.bar, [{ name: "品牌提及率", labels: metrics.platforms.map((platform) => platform.label), values: metrics.platforms.map((platform) => Number(platform.mentionRate.toFixed(1))) }], {
        x: 7.12, y: 3.43, w: 5.45, h: 3.08, barDir: "bar", showLegend: false, showTitle: false,
        showValue: true, dataLabelFormatCode: '0.0"%"', dataLabelColor: "1F70C2", dataLabelPosition: "outEnd",
        catAxisLabelFontFace: "Microsoft YaHei", catAxisLabelFontSize: 11,
        valAxisLabelFontFace: "Microsoft YaHei", valAxisLabelFontSize: 9,
        valAxisMinVal: 0, valAxisMaxVal: 100, valAxisMajorUnit: 25, chartColors: ["1F70C2"],
      });
    }
    const content = [...(page.lead ? [page.lead] : []), ...page.bullets];
    const usableHeight = 6.75 - y;
    const textLines = content.reduce((sum, text) => sum + Math.ceil(weight(text) / (chartPage ? 25 : 49)) + 0.8, 0);
    const fontSize = textLines > usableHeight / 0.3 ? 15 : 17;
    const runs = content.map((text, position) => ({ text: `${position === 0 && page.lead ? "" : "• "}${text}`, options: { breakLine: true, paraSpaceAfterPt: 10, bold: position === 0 && Boolean(page.lead) } }));
    addText(runs, { x: 0.67, y, w: chartPage ? 6.05 : 11.9, h: usableHeight, fontSize, color: "384C67", margin: 0.04, valign: "top", fit: "shrink", breakLine: false });
    slide.addShape(pptx.ShapeType.line, { x: 0.62, y: 7.06, w: 12, h: 0, line: { color: "DDE5EF", width: 0.6 } });
    addText(`${page.sourceStageIds.join(" / ")} · 规划目标为建议值，以复测为准`, { x: 0.62, y: 7.13, w: 10.4, h: 0.19, fontSize: 8, color: "64748B", margin: 0 });
    addText(`${index + 1} / ${pages.length}`, { x: 11.65, y: 7.12, w: 0.9, h: 0.21, fontSize: 9, color: "64748B", margin: 0, align: "right" });
    slide.addNotes(`品牌：${document.brandName}\n生成时间：${document.generatedAt}\n${page.title}\n${page.lead}\n${page.bullets.join("\n")}\n研究依据：${page.sourceStageIds.join(", ")}\n指标口径：提及或首位回答数除以本轮全部采集回答数。首位仅指供应商返回的出现顺序，不代表正面评价或推荐。\n${page.sourceStageIds.flatMap((id) => document.stages.find((stage) => stage.id === id)?.sources.map((source) => `${source.title}: ${source.url}`) ?? []).join("\n")}`);
  });
  const bytes = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer);
}
