import {
  BRAND_REPORT_BRIEFING_ROSTER,
  BRAND_REPORT_STAGES,
  BRAND_REPORT_PLATFORM_LABELS,
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
  const inline = (value: string): string => value.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g).map(part => {
    const match = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (match) return link(match[2]!, match[1]!);
    return escapeHtml(part).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  }).join("");
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
      flush(); const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
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
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.8 "Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif}a{color:var(--blue);overflow-wrap:anywhere}a:hover{text-decoration:underline}main{max-width:1160px;margin:0 auto;padding:40px 28px 64px}.masthead{border-top:5px solid var(--blue);padding:36px;background:var(--paper);border-radius:0 0 16px 16px;margin-bottom:24px}.brand{font-size:12px;letter-spacing:.18em;font-weight:700;color:var(--blue)}h1{font-size:32px;line-height:1.4;margin:14px 0 8px}h2{font-size:24px;line-height:1.5;margin:0 0 18px}h3{font-size:19px;line-height:1.6;margin:24px 0 12px}h4{font-size:16px;margin:20px 0 10px}p{margin:12px 0;overflow-wrap:anywhere}small,.muted{color:var(--muted)}.section{background:#fff;border:1px solid var(--line);border-radius:14px;padding:30px;margin:24px 0;break-inside:auto}.section-number{display:inline-block;background:#e7f1ff;color:var(--blue);font-size:12px;padding:3px 10px;border-radius:5px;margin-bottom:12px;font-weight:700}.lead{font-size:17px;color:#384c67;margin:10px 0 22px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}.metric{border:1px solid var(--line);border-radius:10px;padding:18px;background:#f8fbff}.metric strong{display:block;font-size:30px;color:var(--blue);line-height:1.5}.metric span{font-size:13px;color:var(--muted)}.method{padding:14px 18px;border-left:3px solid #82b6ee;background:#f2f7fd;font-size:13px;color:#46617e}.table-scroll{overflow-x:auto;max-width:100%;overscroll-behavior-x:contain}table{min-width:580px}.report-copy{min-width:0}.actions{flex-wrap:wrap}.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.data-note{font-size:13px;color:#64748b}.risk{border-left:3px solid #d49346;background:#fff8eb;padding:14px 18px}.back-link{font-size:12px}.section{scroll-margin-top:90px}.toc{scroll-margin-top:75px}summary{overflow-wrap:anywhere}.sources li{overflow-wrap:anywhere}.bar-row>span{overflow-wrap:anywhere}.sample-answer{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}th{text-align:left;background:#edf4fd;color:#31506f}td,th{border-bottom:1px solid var(--line);padding:11px 12px;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.bar-row{display:grid;grid-template-columns:90px 1fr 65px;gap:14px;align-items:center;margin:16px 0;font-size:14px}.bar-track{background:#eaf0f8;border-radius:5px;height:18px;overflow:hidden}.bar{background:var(--blue);height:100%;border-radius:5px}.sources{border-top:1px solid var(--line);margin-top:28px;padding-top:16px;font-size:12px}.sources ol{padding-left:22px}.sources li{margin:7px 0}.toc{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.toc a{border:1px solid var(--line);padding:10px 14px;border-radius:7px;text-decoration:none;font-size:14px}.pill{display:inline-block;color:var(--blue);background:#e7f1ff;border-radius:6px;padding:2px 9px;margin-right:8px;font-size:12px}.actions{position:sticky;top:0;background:rgba(243,247,252,.96);z-index:3;padding:12px 0;display:flex;gap:12px;font-size:13px}.actions a{padding:7px 14px;border:1px solid #a8c8ed;border-radius:7px;background:#fff;text-decoration:none}.slide{break-inside:avoid}.slide ul{padding-left:24px}.slide li{margin:15px 0;overflow-wrap:anywhere}.evidence{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px;margin-top:20px}blockquote{border-left:3px solid #bdd5f1;margin:14px 0;padding:8px 18px;background:#f8fbff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:15px;border-radius:6px}code{font-family:ui-monospace,monospace;font-size:.9em}hr{border:0;border-top:1px solid var(--line);margin:22px 0}details{border-top:1px solid var(--line);padding:13px 0}summary{cursor:pointer;font-weight:600}footer{color:var(--muted);font-size:12px;text-align:center;padding-top:20px}.sample-answer{white-space:pre-wrap;font-size:13px;line-height:1.8}
@media(max-width:700px){.summary-grid{grid-template-columns:1fr}.actions{position:static}main{padding:20px 12px}.masthead,.section{padding:22px 18px}h1{font-size:26px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.toc{grid-template-columns:1fr}.bar-row{grid-template-columns:65px 1fr 55px;gap:8px}.metric strong{font-size:25px}}
@media print{@page{size:A4;margin:16mm 14mm}body{background:white;font-size:10pt;line-height:1.7}main{max-width:none;padding:0}.actions,.no-print{display:none}.masthead{padding:16mm 8mm;min-height:190mm;border-radius:0;break-after:page}.section{border:0;border-radius:0;padding:0;margin:0;break-before:page}.section h2{font-size:21pt}.metric{padding:10px}.metric strong{font-size:22pt}.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.slide{break-before:page;break-inside:auto}.table-scroll{overflow:visible}a{color:inherit;text-decoration:none}.toc{grid-template-columns:1fr 1fr}.sources{break-inside:auto}details{display:block}details>*{display:block}summary{display:none}h2,h3,h4{break-after:avoid}}
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main>${body}<footer>FrontMind · 品牌研究与 GEO 报告</footer></main></body></html>`;
}

function table(headings: string[], rows: string[][]) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的数据表"><table><thead><tr>${headings.map(value => `<th scope="col">${escapeHtml(value)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function metricsHtml(document: BrandReportDocument) {
  const m = calculateBrandReportMetrics(document.monitoring);
  return `<div class="metrics" data-measured-baseline><div class="metric"><strong>${m.samples}</strong><span>本轮真实回答 · Q1 ${m.rankingSamples} / Q2 ${m.reputation.samples}</span></div><div class="metric"><strong>${percentage(m.mentionRate)}</strong><span>Q1 品牌提及率 · ${m.mentions}/${m.rankingSamples}</span></div><div class="metric"><strong>${percentage(m.top3Rate)}</strong><span>Q1 前三出现率 · ${m.top3}/${m.rankingSamples}</span></div><div class="metric"><strong>${m.citations}</strong><span>实际引用记录 · ${m.topSources.length} 篇唯一链接</span></div></div><p class="method"><strong>Q1 本次场景：${escapeHtml(document.monitoring.questions[0])}</strong><br>以下可见度与位次仅反映此问题场景，不能外推为品牌、部门或全企业的总体排名。实测基线：每问题、每平台 5 次。可见度、首位、前三与前五指标仅使用 Q1；Q2 是点名品牌的风险询问，不计入排名。这里的“出现”表示供应商返回的品牌提及与位次，不等同于正面推荐。所有方案目标均需后续复测验证。</p>`;
}
function bars(rows: Array<{label:string;count:number}>, total:number, suffix = "份") {
  return rows.map(row => `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar-track" role="img" aria-label="${escapeHtml(row.label)}：${row.count}${suffix}"><div class="bar" style="width:${total ? (row.count / total * 100).toFixed(4) : 0}%"></div></div><strong>${row.count}${suffix}</strong></div>`).join("");
}
function platformHtml(document: BrandReportDocument) {
  const m = calculateBrandReportMetrics(document.monitoring);
  return `<h3>本次 Q1 场景的位次分布</h3><p class="method">采集问题：<strong>${escapeHtml(document.monitoring.questions[0])}</strong>。以下位次和平台对照仅适用于这个问题，不代表其他产品、部门整体或全企业排名。</p><div class="summary-grid"><div>${bars(m.rankDistribution, m.rankingSamples)}</div><div><p>首位出现率：<strong>${percentage(m.firstRecommendationRate)}</strong>（${m.firstRecommendations}/${m.rankingSamples}）</p><p>前三出现率：<strong>${percentage(m.top3Rate)}</strong>（${m.top3}/${m.rankingSamples}）</p><p>前五出现率：<strong>${percentage(m.top5Rate)}</strong>（${m.top5}/${m.rankingSamples}）</p><p>已返回位次的平均值：<strong>${m.averageRank === null ? "无可计算位次" : m.averageRank.toFixed(2)}</strong> · 有位次回答 ${m.rankedSamples} 份</p><p class="data-note">未提及与“提及但无位次”分别保留；不将缺失位次记成 0 或末位。没有竞品结构化排名时，不生成虚构的竞品榜单。</p></div></div><h3>分类对照：按采集平台比较 Q1</h3>${m.platforms.map(platform => `<div class="bar-row"><span>${escapeHtml(platform.label)}</span><div class="bar-track" role="img" aria-label="${escapeHtml(platform.label)} Q1 提及率 ${percentage(platform.mentionRate)}"><div class="bar" style="width:${platform.mentionRate.toFixed(4)}%"></div></div><strong>${percentage(platform.mentionRate)}</strong></div>`).join("")}${table(["平台", "Q1 样本", "提及", "首位", "前三", "前五", "平均位次"], m.platforms.map(platform => [escapeHtml(platform.label), String(platform.samples), `${platform.mentions} · ${percentage(platform.mentionRate)}`, `${platform.firstRecommendations} · ${percentage(platform.firstRecommendationRate)}`, `${platform.top3} · ${percentage(platform.top3Rate)}`, `${platform.top5} · ${percentage(platform.top5Rate)}`, platform.averageRank === null ? "未返回" : platform.averageRank.toFixed(2)]))}<p class="data-note">分类维度为本轮实际采集平台与问题类型。供应商未提供可复核的内容分类位次，故不把整体位次重新包装成“分类最高排名”。</p>`;
}
function reputationHtml(document: BrandReportDocument) {
  const m = calculateBrandReportMetrics(document.monitoring).reputation;
  return `<h3>Q2 舆情、风险与信任</h3><p class="lead">${escapeHtml(document.monitoring.questions[1])}</p><div class="risk">Q2 共 ${m.samples} 份真实回答。以下情感标签取自供应商对本次监测主体的明确评估；它们是平台回答的分类，不是对企业事实的裁定。未分类回答保留为未分类，不推算为中性。风险主题、上下文与核验建议见品牌诊断正文。</div>${table(["平台", "Q2 样本", "正面标签", "中性标签", "负面标签", "未分类", "实际引用"], m.platforms.map(platform => [escapeHtml(platform.label), String(platform.samples), String(platform.positive), String(platform.neutral), String(platform.negative), String(platform.unclassified), String(platform.citations)]))}<p class="data-note">问题本身包含品牌名，因此 Q2 品牌出现不能证明自然可见度；负面标签也不代表平台确认相关指控属实。原始回答及供应商评估依据保留在采集明细。</p>`;
}
function sourceHtml(document: BrandReportDocument) {
  const m = calculateBrandReportMetrics(document.monitoring);
  return `<h3>信源洞察：引用分布与内容明细</h3><p>本轮实际引用 ${m.citations} 条，涉及 ${m.topSources.length} 篇唯一链接、${m.domains.length} 个域名；另保留 ${m.referenceRecords} 条检索参考记录。实际引用和检索参考分别统计。</p>${m.domains.length ? `${bars(m.domains.slice(0, 12).map(domain => ({label:domain.site,count:domain.references})), Math.max(...m.domains.map(domain => domain.references)), "次")}${table(["信源域名", "实际引用次数", "唯一文章", "覆盖平台"], m.domains.map(domain => [escapeHtml(domain.site), String(domain.references), String(domain.articles), domain.platforms.map(platform => escapeHtml(BRAND_REPORT_PLATFORM_LABELS[platform] ?? platform)).join("、")]))}${table(["高频信源内容", "来源", "引用次数", "问题", "平台"], m.topSources.map(source => [link(source.url, source.title), escapeHtml(source.site), String(source.references), source.questions.join(" / "), source.platforms.map(platform => escapeHtml(BRAND_REPORT_PLATFORM_LABELS[platform] ?? platform)).join("、")]))}` : '<p class="data-note">采集接口未返回实际引用链接；这不能证明平台没有参考外部信息，也不足以计算品牌信源覆盖率。</p>'}<p class="method">信源分类按可验证的域名和采集平台组织。域名、引用频次均不直接等同于权威性，信源内容是否支持品牌主张需逐项核查。未读取文章全文时，不宣称文章提及本品，也不计算“本品文章引用占比”。</p>`;
}
function methodHtml(document: BrandReportDocument) {
  const m = calculateBrandReportMetrics(document.monitoring);
  return `<h3>指标解释与研究边界</h3>${table(["指标", "计算口径", "解释边界"], [
    ["Q1 提及率", `提及主体的 Q1 回答数 / ${m.rankingSamples} 份 Q1 回答`, "反映本轮样本；不代表平台整体市场份额"],
    ["首位 / 前三 / 前五", "满足对应位次的 Q1 回答数 / Q1 成功回答数", "使用供应商品牌排序；不混入 Q2，不把缺失值当作排名"],
    ["平均位次", `Q1 有有效位次的排序之和 / ${m.rankedSamples} 份有位次回答`, "仅在已返回有效位次样本内计算，必须结合提及率阅读"],
    ["Q2 风险标签", "仅取供应商对监测主体的情感评估及原文依据", "不是已核实的医疗、经营或舆情事实"],
    ["实际引用", "citationList 中的来源记录；唯一文章按 URL 去重", "重复引用计次数；referenceList 仅作检索参考"],
    ["方案目标", "研究建议中提出的 3 / 6 个月目标", "方案设定值，以后续复测验证；不冒充实测提升"],
  ])}<p class="data-note">研究正文中的观点分为可核查事实、依据资料的推断与方案建议。对资料不足的事项保留核验动作；不以旧报告、示例或其他主体数据补齐本轮指标。</p>`;
}
function header(document: BrandReportDocument, subtitle: string) {
  return `<header class="masthead" id="top"><div class="brand">FRONTMIND / BRAND INTELLIGENCE</div><h1>${escapeHtml(document.brandName)}</h1><h2>${escapeHtml(subtitle)}</h2><p class="muted">生成时间：${escapeHtml(document.generatedAt)} · 数据确认：${escapeHtml(document.monitoring.confirmedAt)}</p><p class="lead">${escapeHtml(document.overview)}</p></header>`;
}
const stageAnchor = (id:string) => `stage-${id.replaceAll(".", "-")}`;
/** Strip only explicitly internal sections; retain all customer-facing research. */
export function customerReportMarkdown(markdown:string, stageId:string) {
  const lines=markdown.replace(/\r\n?/g,"\n").split("\n"), output:string[]=[];let excludedLevel=0;
  for(const line of lines){const heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading){const level=heading[1]!.length;if(excludedLevel&&level<=excludedLevel)excludedLevel=0;
      const title=heading[2]!.replace(/^\s*(?:[（(]?[一二三四五六七八九十百0-9]+[）).、：:]\s*)?/, "").replace(/\*\*/g, "").trim();
      if(/^(危机与错误信息回应模板|下游注入规则|重校触发条件)$/.test(title) || (stageId==='S8'&&/问答树|问答矩阵|标准答案/.test(heading[2]!))){excludedLevel=level;continue;}}
    if(!excludedLevel)output.push(line);
  }return output.join("\n");
}
function sampleAppendix(document: BrandReportDocument) {
  return `<section class="section" id="evidence"><span class="section-number">数据附录</span><h2>本轮采集与引用明细</h2><p class="method">回答中的观点是平台返回内容，不能直接视为核实事实。点击任一条查看全文、实际引用与检索参考。Q1 用于排名，Q2 用于风险与信任。</p>${document.monitoring.samples.map((sample, index) => `<details id="sample-${index+1}"><summary>${index + 1}. ${sample.question === document.monitoring.questions[0] ? "Q1 推荐" : "Q2 风险"} · ${escapeHtml(BRAND_REPORT_PLATFORM_LABELS[sample.platform] ?? sample.platform)} · ${escapeHtml(sample.question)}</summary><div class="sample-answer">${escapeHtml(sample.answer)}</div><p class="muted">主体提及：${sample.mentioned ? "有" : "无"}；${sample.question === document.monitoring.questions[0] ? `供应商位次：${sample.rank ?? "未返回"}` : "风险类问题，不计排名"}${sample.collectedAt ? `；采集时间：${escapeHtml(sample.collectedAt)}` : ""}</p>${sample.sentiment && sample.sentiment !== "unknown" ? `<p>供应商情感标签：${escapeHtml(({positive:"正面",neutral:"中性",negative:"负面"} as const)[sample.sentiment])}</p>${(sample.sentimentEvidence??[]).map(evidence=>`<blockquote>${escapeHtml(evidence)}</blockquote>`).join("")}` : ""}<h4>实际引用</h4>${sample.citations.length ? `<ul>${sample.citations.map(source => `<li>${link(source.url, source.title)}</li>`).join("")}</ul>` : '<p class="muted">此回答未返回实际引用链接。</p>'}${sample.references?.length ? `<h4>检索参考（未计入实际引用）</h4><ul>${sample.references.map(source=>`<li>${link(source.url,source.title)}</li>`).join("")}</ul>` : ""}</details>`).join("")}<a class="back-link" href="#top">返回报告开头</a></section>`;
}
export function renderPanoramaHtml(input: BrandReportDocument): string {
  const document = validateBrandReportDocument(input);
  const order=["S1","S2","S3","S4","S5","S5.5","S6","S7","S8","S9.8","S9"];
  const ordered=order.map(id=>document.stages.find(stage=>stage.id===id)!);
  const sections = ordered.map((stage, index) => `<section class="section" id="${stageAnchor(stage.id)}"><span class="section-number">第 ${index + 1} 部分</span><h2>${escapeHtml(stage.title)}</h2><p class="lead">${escapeHtml(stage.summary)}</p>${stage.id === "S5" ? `${metricsHtml(document)}${platformHtml(document)}${reputationHtml(document)}` : ""}${stage.id === "S5.5" ? sourceHtml(document) : ""}<div class="report-copy source-stage-block" data-source-stage="${stage.id}">${renderBrandReportMarkdown(customerReportMarkdown(stage.markdown,stage.id))}</div><div class="sources"><strong>本部分研究来源</strong><ol>${stage.sources.map(source => `<li>${link(source.url, source.title)}</li>`).join("")}</ol></div><a class="back-link" href="#contents">返回目录</a></section>`).join("");
  return page(`${document.brandName} · 全景报告`, `${header(document, "AI 智能品牌优化全景报告")}<nav class="actions" aria-label="报告快速导航"><a href="#contents">报告目录</a><a href="#stage-S5">诊断与排名</a><a href="#evidence">原始采集</a><a href="#methods">指标解释</a></nav><nav class="section" id="contents" aria-label="报告目录"><h2>报告目录</h2><div class="toc">${ordered.map((stage, index) => `<a href="#${stageAnchor(stage.id)}">${index + 1}. ${escapeHtml(stage.title)}</a>`).join("")}<a href="#methods">研究范围与指标解释</a><a href="#evidence">采集与引用明细</a></div></nav><section class="section" id="methods"><h2>本轮研究范围与数据口径</h2><p>研究主体：<strong>${escapeHtml(document.brandName)}</strong>。关联企业或母体机构的资料仅作相关背景，不自动外推为研究主体能力。</p><ol>${document.monitoring.questions.map((question,index)=>`<li>Q${index+1}：${escapeHtml(question)}</li>`).join("")}</ol>${methodHtml(document)}</section>${sections}${sampleAppendix(document)}`);
}
/** HTML sections grow naturally; there are no fixed page bounds or truncated bullets. */
export function planBrandReportBriefing(document: BrandReportDocument) {
  return document.briefingSlides.map((slide, topicIndex) => ({ ...slide, topicIndex, continuation: false }));
}
export function renderBriefingHtml(input: BrandReportDocument): string {
  const document = validateBrandReportDocument(input);
  const sections = planBrandReportBriefing(document);
  return page(`${document.brandName} · 汇报报告`, `${header(document, "GEO 整体汇报报告")}<nav class="actions" aria-label="汇报快速导航"><a href="#contents">汇报目录</a><a href="#diagnosis">诊断数据</a><a href="#sources">信源洞察</a><a href="#evidence">原始回答</a></nav><nav class="section" id="contents" aria-label="汇报目录"><h2>汇报路线</h2><div class="toc">${sections.map(section=>`<a href="#topic-${section.topicIndex}">${section.topicIndex+1}. ${escapeHtml(BRAND_REPORT_BRIEFING_ROSTER[section.topicIndex]!)}</a>`).join("")}<a href="#methods">指标解释</a><a href="#evidence">采集明细</a></div><p class="method">两份报告使用同一批冻结的真实回答。实测值、研究推断和方案目标分别阅读；3 / 6 个月目标是方案设定值，需以后续复测验证。</p></nav>${sections.map(section => `<section class="section slide" id="topic-${section.topicIndex}"><span class="section-number">${String(section.topicIndex+1).padStart(2,"0")} · ${escapeHtml(BRAND_REPORT_BRIEFING_ROSTER[section.topicIndex]!)}</span><h2>${escapeHtml(section.title)}</h2>${section.lead ? `<p class="lead">${escapeHtml(section.lead)}</p>` : ""}${[0,10,12].includes(section.topicIndex) ? metricsHtml(document) : ""}${section.topicIndex===2 ? `<div id="diagnosis">${metricsHtml(document)}${platformHtml(document)}</div>` : ""}${section.topicIndex===6 ? reputationHtml(document) : ""}${section.topicIndex===7 ? `<div id="sources">${sourceHtml(document)}</div>` : ""}<div class="report-copy">${section.bullets.map(bullet => renderBrandReportMarkdown(bullet)).join("")}</div><div class="evidence">研究依据：${section.sourceStageIds.map(id=>escapeHtml(document.stages.find(stage=>stage.id===id)?.title??id)).join(" · ")}</div><a class="back-link" href="#contents">返回汇报目录</a></section>`).join("")}<section class="section" id="methods">${methodHtml(document)}</section>${sampleAppendix(document)}`);
}
