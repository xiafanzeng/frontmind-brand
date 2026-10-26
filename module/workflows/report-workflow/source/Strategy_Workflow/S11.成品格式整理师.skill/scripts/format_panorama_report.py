#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind S11 final report formatter 本工作流.

Compacts S10 HTML without deleting substantive content, renders the final PDF,
stitches the official front/back cover, and emits a layout QA report.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from pdf_cover_contract import (  # noqa: E402
    official_cover_path,
    validate_official_cover,
    verify_final_cover,
)

FORMAT_MARKER = "frontmind-final-format-final"

BASE_OVERRIDE = r"""
<style id="frontmind-final-format-final">
@page { size:A4; margin:10mm 11mm 12mm 11mm; }
html, body { orphans:3; widows:3; }
body { font-size:9.2pt !important; line-height:1.52 !important; }
code { font-family:inherit !important; font-size:.96em !important; }
p { margin-bottom:4px !important; }
ul, ol { margin-top:2px !important; margin-bottom:5px !important; }
.cover-page { page-break-after:always !important; break-after:page !important; }
.official-cover-preview {
  width:210mm; min-height:297mm; margin:0 auto 8mm; padding:0;
  display:flex; align-items:center; justify-content:center; background:#fff;
}
.official-cover-preview img { width:100%; height:auto; display:block; object-fit:contain; }
@media print { .official-cover-preview { display:none !important; } }
.toc-page { page-break-before:auto !important; break-before:auto !important; page-break-after:always !important; break-after:page !important; }
.executive-page { page-break-before:auto !important; break-before:auto !important; page-break-after:always !important; break-after:page !important; }
/* 分隔页（section divider）必须单独占一整页，不得被压缩成一行小标题并入正文。
   此处以 !important 覆盖，保证最终成品中每个分部都有独立分隔页，
   正文从下一页开始。按用户要求：分隔页不进行优化和压缩。 */
.divider-page {
  page-break-before:always !important; break-before:page !important;
  page-break-after:always !important; break-after:page !important;
  page-break-inside:avoid !important; break-inside:avoid !important;
  min-height:250mm !important; height:250mm !important;
  display:flex !important; flex-direction:column !important;
  justify-content:center !important; align-items:flex-start !important;
  padding:0 18mm !important; margin:0 !important;
  border-bottom:0 !important;
  overflow:hidden !important;
}
.divider-no { position:static !important; font-size:64pt !important; font-weight:900 !important; margin:0 0 6mm !important; max-width:none !important; }
.divider-en { margin:0 0 3mm !important; font-size:11pt !important; letter-spacing:2.2px !important; max-width:none !important; }
.divider-title { max-width:none !important; width:auto !important; font-size:26pt !important; line-height:1.25 !important; }
.divider-gold { width:64px !important; height:4px !important; margin:6mm 0 !important; }
.divider-desc { max-width:150mm !important; width:auto !important; font-size:10.5pt !important; line-height:1.7 !important; }
/* 分隔页之后的正文始终从新一页开始 */
.divider-page + .report-page { page-break-before:always !important; break-before:page !important; }
.report-page {
  page-break-before:auto !important; break-before:auto !important;
  min-height:0 !important; height:auto !important;
  margin:0 0 5mm !important; padding:0 !important;
}
.report-page + .report-page { margin-top:3mm !important; }
.page-title { margin:0 0 6px !important; padding:8px 14px !important; break-after:avoid !important; page-break-after:avoid !important; }
.page-kicker { margin-bottom:6px !important; }
h2 { margin:8px 0 5px !important; break-after:avoid !important; page-break-after:avoid !important; }
h3 { margin:7px 0 4px !important; break-after:avoid !important; page-break-after:avoid !important; }
table { margin:4px 0 6px !important; page-break-inside:auto !important; break-inside:auto !important; }
thead { display:table-header-group !important; }
tr { break-inside:avoid !important; page-break-inside:avoid !important; }
.key-finding, .warning-box, .strategy-box, .insight-card, .evidence-file-card, .source-stage-block {
  break-inside:auto !important; page-break-inside:auto !important;
}
.chart-card, .data-cards, .logic-flow, .positioning-statement { break-inside:avoid !important; page-break-inside:avoid !important; }
.allow-split { break-inside:auto !important; page-break-inside:auto !important; }
.data-cards { gap:6px !important; margin:5px 0 7px !important; }
.data-card { padding:7px 6px !important; }
.chart-grid { gap:8px !important; margin:7px 0 9px !important; }
.chart-card { padding:9px !important; }
.citation-chart-group {
  display:flex !important; gap:8px !important; align-items:stretch !important;
  margin:7px 0 9px !important;
}
.citation-chart-group--paired {
  break-before:auto !important; page-break-before:auto !important;
  break-inside:avoid !important; page-break-inside:avoid !important;
}
.citation-chart-group--paired > .citation-chart-item {
  flex:1 1 0 !important; min-width:0 !important;
}
.citation-chart-group--paired > .citation-chart-item:first-child {
  flex-grow:1.35 !important;
}
.citation-chart-group--stacked {
  display:block !important;
  break-inside:auto !important; page-break-inside:auto !important;
}
.citation-chart-group--stacked > .citation-chart-item {
  width:100% !important; margin:0 0 7px !important;
}
.citation-chart-item {
  break-inside:avoid !important; page-break-inside:avoid !important;
  overflow:hidden !important;
}
.consulting-grid { gap:6px !important; margin:5px 0 7px !important; }
.insight-card, .strategy-box { padding:7px 9px !important; margin:4px 0 6px !important; }
.empty-after-format { display:none !important; }
</style>
"""

AGGRESSIVE_OVERRIDE = r"""
<style id="frontmind-final-format-final-aggressive">
@page { margin:9mm 10mm 11mm 10mm; }
body { font-size:9pt !important; line-height:1.48 !important; }
/* 即使在更激进的压缩模式下，分隔页仍必须保持独立整页，不被压缩。 */
.divider-page { min-height:250mm !important; height:250mm !important; padding:0 18mm !important; margin:0 !important; page-break-before:always !important; break-before:page !important; page-break-after:always !important; break-after:page !important; }
.divider-page + .report-page { page-break-before:always !important; break-before:page !important; }
.report-page { margin-bottom:3mm !important; }
.chart-card, .data-cards, .logic-flow, .positioning-statement,
.key-finding, .warning-box, .strategy-box, .insight-card, .evidence-file-card {
  break-inside:auto !important; page-break-inside:auto !important;
}
/* Citation charts are a semantic pair. The generic aggressive compaction rule
   above must never fragment either card or separate the pair across pages. */
.citation-chart-group--paired, .citation-chart-item {
  break-inside:avoid !important; page-break-inside:avoid !important;
}
.citation-chart-group--paired {
  break-before:auto !important; page-break-before:auto !important;
}
.citation-chart-group--stacked {
  display:block !important;
  break-inside:auto !important; page-break-inside:auto !important;
}
</style>
"""


# 分隔页独有的英文大写特征词（只出现在 divider-en，正文页不出现）。
DIVIDER_EN_MARKERS = (
    "DIAGNOSTIC LENS", "CATEGORY OPPORTUNITY", "COMPETITIVE STRATEGY",
    "QUESTION PATH", "CONTENT COVERAGE", "VISIBILITY DIAGNOSIS",
    "SEMANTIC ASSET AUDIT", "VISUAL ASSETS", "RISK MANAGEMENT",
    "GEO STRATEGY", "BUSINESS WORKFLOW",
)
# 分隔页的中文分部标题集合。
DIVIDER_ZH_TITLES = (
    "报告范围与诊断口径", "市场趋势与品类机会", "品牌定位与竞争战略",
    "用户意图与问题路径", "问答架构与内容承接", "语义资产审计",
    "话语资产与视觉资产", "风险管理",
    "GEO 战略选择", "GEO 业务流程", "AI 可见性诊断",
)


def _looks_like_divider_page(raw_text: str) -> bool:
    """判断某页是否为“独立整页分隔页”。

    分隔页按设计大量留白，只有编号/中英文标题/一句描述，
    不应被当作缺陷的空白页或稀疏页。正文页虽也含同名中文标题，
    但文字远超 220 字符，且不含分隔页独有的英文大写短语。
    """
    if not raw_text:
        return False
    compact = re.sub(r"\s+", "", raw_text)
    # 正文页内容多；分隔页文字很少。超过阈值直接判定为非分隔页。
    if len(compact) > 260:
        return False
    # 仅依据分隔页独有的英文大写短语判定（这些只出现在 divider-en，
    # 正文页不出现）。注意：PDF 提取文本可能丢失单词间的空格
    # （如 "SEMANTIC ASSET AUDIT" 被提取为 "SEMANTICASSETAUDIT"），
    # 所以比对时对两边都去除空白后再匹配，以保证稳健命中。
    # 不再用“编号+中文标题”回退分支，以免误伤极短正文页。
    upper_compact = compact.upper()
    return any(re.sub(r"\s+", "", marker).upper() in upper_compact for marker in DIVIDER_EN_MARKERS)


@dataclass
class PageMetric:
    page: int
    text_chars: int
    drawings: int
    images: int
    vertical_coverage: float
    blank: bool
    sparse: bool
    is_divider: bool = False


def _inject_before_head_end(html_text: str, css: str) -> str:
    if "</head>" in html_text:
        return html_text.replace("</head>", css + "\n</head>", 1)
    return css + html_text


def _ensure_base_href(html_text: str, base_href: str | None) -> str:
    if not base_href or re.search(r"<base\b", html_text, flags=re.I):
        return html_text
    tag = f'<base href="{base_href}">'
    if re.search(r"<head[^>]*>", html_text, flags=re.I):
        return re.sub(r"(<head[^>]*>)", r"\1\n" + tag, html_text, count=1, flags=re.I)
    return tag + html_text


def _remove_base_href(html_text: str) -> str:
    """Remove local render-only base tags from customer-facing HTML."""
    return re.sub(r"<base\b[^>]*>", "", html_text, flags=re.I)


def _augment_opening_tag(
    opening_tag: str,
    *,
    classes: tuple[str, ...] = (),
    attributes: dict[str, str] | None = None,
) -> str:
    """Add idempotent classes/data attributes to one HTML opening tag."""
    attributes = attributes or {}
    match = re.search(
        r"\bclass\s*=\s*(?P<quote>[\"'])(?P<value>.*?)(?P=quote)",
        opening_tag,
        flags=re.I | re.S,
    )
    if match:
        current = match.group("value").split()
        for value in classes:
            if value not in current:
                current.append(value)
        replacement = f"class={match.group('quote')}{' '.join(current)}{match.group('quote')}"
        opening_tag = (
            opening_tag[: match.start()]
            + replacement
            + opening_tag[match.end() :]
        )
    elif classes:
        opening_tag = re.sub(
            r">(\s*)$",
            " class=\"" + " ".join(classes) + r"\">\1",
            opening_tag,
            count=1,
        )
    for name, value in attributes.items():
        if re.search(rf"\b{re.escape(name)}\s*=", opening_tag, flags=re.I):
            continue
        opening_tag = re.sub(
            r">(\s*)$",
            f' {name}="{html.escape(value, quote=True)}">' + r"\1",
            opening_tag,
            count=1,
        )
    return opening_tag


def _upgrade_legacy_citation_charts_html(html_text: str) -> str:
    """Migrate old generic citation grids without requiring BeautifulSoup."""
    if not re.search(
        r"data-citation-analysis=[\"']uploaded-spreadsheet[\"']",
        html_text,
        flags=re.I,
    ):
        return html_text

    item_specs = (
        ("source", "Top 10 高频引用信源"),
        ("model", "各模型引用记录量"),
    )
    upgraded = html_text
    for role, title in item_specs:
        pattern = re.compile(
            r"(?P<open><(?:div|section)\b"
            r"(?=[^>]*\bclass\s*=\s*[\"'][^\"']*\bchart-card\b[^\"']*[\"'])"
            r"[^>]*>)"
            r"(?P<tail>\s*<h4[^>]*>\s*"
            + re.escape(title)
            + r"\s*</h4>)",
            flags=re.I,
        )

        def replace_item(match: re.Match[str], item_role: str = role) -> str:
            opening = _augment_opening_tag(
                match.group("open"),
                classes=("citation-chart-item",),
                attributes={"data-citation-chart-item": item_role},
            )
            return opening + match.group("tail")

        upgraded = pattern.sub(replace_item, upgraded, count=1)

    if re.search(
        r"data-citation-chart-group=[\"']true[\"']",
        upgraded,
        flags=re.I,
    ):
        return upgraded

    item_count = len(
        re.findall(
            r"data-citation-chart-item=[\"'](?:source|model)[\"']",
            upgraded,
            flags=re.I,
        )
    )
    if item_count == 0:
        return upgraded
    mode_class = (
        "citation-chart-group--paired"
        if item_count == 2
        else "citation-chart-group--stacked"
    )
    group_pattern = re.compile(
        r"(?P<open><(?:div|section)\b"
        r"(?=[^>]*\bclass\s*=\s*[\"'][^\"']*\b(?:chart-grid|citation-chart-grid)\b[^\"']*[\"'])"
        r"[^>]*>)"
        r"(?=\s*<(?:div|section)\b[^>]*"
        r"data-citation-chart-item=[\"'](?:source|model)[\"'])",
        flags=re.I,
    )

    def replace_group(match: re.Match[str]) -> str:
        return _augment_opening_tag(
            match.group("open"),
            classes=("citation-chart-group", mode_class),
            attributes={
                "data-citation-chart-group": "true",
                "data-pagination-policy": "keep-together",
            },
        )

    return group_pattern.sub(replace_group, upgraded, count=1)


def _clean_with_bs4(html_text: str) -> str:
    html_text = _upgrade_legacy_citation_charts_html(html_text)
    try:
        from bs4 import BeautifulSoup  # type: ignore
    except Exception:
        return html_text
    soup = BeautifulSoup(html_text, "html.parser")
    if soup.body:
        soup.body["data-final-formatted"] = "本工作流"

    # Backward compatibility: reports produced before the citation pagination
    # contract used a generic ``chart-grid``. Upgrade only the upload-specific
    # citation module, based on its stable chart titles, before any generic
    # compaction rule can mark the cards as splittable.
    for module in soup.select('[data-citation-analysis="uploaded-spreadsheet"]'):
        citation_cards: dict[str, Any] = {}
        for heading in module.select("h4"):
            title = heading.get_text(" ", strip=True)
            role = {
                "Top 10 高频引用信源": "source",
                "各模型引用记录量": "model",
            }.get(title)
            if not role:
                continue
            card = heading.find_parent(
                lambda tag: tag.name in {"div", "section"}
                and "chart-card" in (tag.get("class") or [])
            )
            if card is None:
                continue
            card_classes = list(card.get("class") or [])
            if "citation-chart-item" not in card_classes:
                card_classes.append("citation-chart-item")
            card["class"] = card_classes
            card["data-citation-chart-item"] = role
            citation_cards[role] = card

        cards = list(citation_cards.values())
        if not cards:
            continue
        group = cards[0].parent
        if group is None or any(card.parent is not group for card in cards):
            continue
        group_classes = [
            value
            for value in list(group.get("class") or [])
            if value not in {
                "citation-chart-group--paired",
                "citation-chart-group--stacked",
            }
        ]
        if "citation-chart-group" not in group_classes:
            group_classes.append("citation-chart-group")
        group_classes.append(
            "citation-chart-group--paired"
            if len(cards) == 2
            else "citation-chart-group--stacked"
        )
        group["class"] = group_classes
        group["data-citation-chart-group"] = "true"
        group["data-pagination-policy"] = "keep-together"

    for node in soup.select("p, div, section"):
        # Keep visual/chart containers even when text is empty.
        classes = set(node.get("class", []))
        # 白名单：可视化/装饰类容器即使无文本也不能隐藏。
        # 特别是 divider-gold（分隔页金色装饰线，靠 background 显示的空 div），
        # 否则会被误判为空元素而隐藏，导致分隔页金线消失。
        if classes.intersection({"svg-chart", "chart-card", "cover-page", "divider-page",
                                 "divider-gold", "cover-divider", "toc-subtitle-line"}):
            continue
        if not node.get_text(" ", strip=True) and not node.find(["img", "svg", "table"]):
            node["class"] = list(classes | {"empty-after-format"})
    for node in soup.select(".strategy-box, .insight-card, .evidence-file-card, .key-finding, .warning-box, .chart-card"):
        if len(node.get_text(" ", strip=True)) > 700:
            classes = set(node.get("class", []))
            if "citation-chart-item" in classes:
                continue
            node["class"] = list(classes | {"allow-split"})
    # Ensure the executive summary receives an intentional page break after it.
    pages = soup.select("section.report-page")
    for page in pages:
        title = page.select_one(".page-title")
        if title and "经营层摘要" in title.get_text(" ", strip=True):
            classes = set(page.get("class", []))
            page["class"] = list(classes | {"executive-page"})
            break
    return str(soup)


def prepare_html(html_text: str, aggressive: bool = False, base_href: str | None = None) -> str:
    html_text = re.sub(r"<style[^>]+id=[\"']frontmind-final-format-final(?:-aggressive)?[\"'][\s\S]*?</style>", "", html_text, flags=re.I)
    html_text = _remove_base_href(html_text)
    html_text = _clean_with_bs4(html_text)
    html_text = _inject_before_head_end(html_text, BASE_OVERRIDE)
    if aggressive:
        html_text = _inject_before_head_end(html_text, AGGRESSIVE_OVERRIDE)
    return html_text


def citation_chart_pagination_contract_errors(html_text: str) -> list[str]:
    """Validate the mandatory keep-together contract for citation charts."""
    if not re.search(
        r"data-citation-analysis=[\"']uploaded-spreadsheet[\"']",
        html_text,
        flags=re.I,
    ):
        return ["客户报告缺少必需的信源/引用分析模块"]
    chart_titles_present = any(
        title in html_text
        for title in ("Top 10 高频引用信源", "各模型引用记录量")
    )
    group_count = len(
        re.findall(
            r"data-citation-chart-group=[\"']true[\"']",
            html_text,
            flags=re.I,
        )
    )
    item_count = len(
        re.findall(
            r"data-citation-chart-item=[\"'][^\"']+[\"']",
            html_text,
            flags=re.I,
        )
    )
    errors: list[str] = []
    if chart_titles_present and group_count != 1:
        errors.append(
            f"引用分析图表必须且只能有一个不可拆分页组：actual={group_count}"
        )
    if group_count == 1:
        if item_count not in {1, 2}:
            errors.append(f"引用分析图表项数量异常：actual={item_count}")
        if not re.search(
            r"data-pagination-policy=[\"']keep-together[\"']",
            html_text,
            flags=re.I,
        ):
            errors.append("引用分析图表组缺少 keep-together 分页策略")
        if not re.search(
            r"class=[\"'][^\"']*\bcitation-chart-group--(?:paired|stacked)\b",
            html_text,
            flags=re.I,
        ):
            errors.append("引用分析图表组缺少 paired/stacked 布局模式")
    return errors


LEGACY_HTML_COVER_RE = re.compile(
    r"""<(?P<tag>section|div)\b
        (?=[^>]*\bclass=["'][^"']*\bcover-page\b[^"']*["'])
        [^>]*>""",
    flags=re.I | re.X,
)

OFFICIAL_HTML_COVER_RE = re.compile(
    r"""<section\b(?=[^>]*\bdata-official-cover-preview=["'][^"']+["'])[^>]*>
        [\s\S]*?
        </section>""",
    flags=re.I | re.X,
)


def _remove_legacy_cover_block(html_text: str) -> tuple[str, int]:
    """Remove one legacy cover element, including nested div children."""
    matches = list(LEGACY_HTML_COVER_RE.finditer(html_text))
    if len(matches) != 1:
        return html_text, len(matches)
    start_match = matches[0]
    tag_name = start_match.group("tag")
    tag_re = re.compile(rf"</?{re.escape(tag_name)}\b[^>]*>", flags=re.I)
    depth = 0
    for match in tag_re.finditer(html_text, start_match.start()):
        token = match.group(0)
        if token.startswith("</"):
            depth -= 1
            if depth == 0:
                return (
                    html_text[: start_match.start()] + html_text[match.end() :],
                    1,
                )
        elif not token.rstrip().endswith("/>"):
            depth += 1
    raise RuntimeError("旧动态封面 HTML 标签未闭合，无法安全替换")


def prepare_cover_preview_assets(cover_pdf: Path, report_dir: Path) -> tuple[str, str]:
    """Rasterize the approved cover pages for safe customer-HTML previews."""
    cover_validation = validate_official_cover(cover_pdf)
    if not cover_validation.get("passed"):
        raise RuntimeError(
            "官方封面资产未通过校验：" + "; ".join(cover_validation.get("errors") or [])
        )
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise RuntimeError("生成客户 HTML 封面预览需要 pdftoppm")
    assets_dir = report_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    report_sources: list[str] = []
    with tempfile.TemporaryDirectory(prefix="frontmind-cover-preview-", dir=str(report_dir)) as temp_dir:
        prefix = Path(temp_dir) / "cover"
        subprocess.run(
            [
                renderer,
                "-f",
                "1",
                "-l",
                "2",
                "-png",
                "-r",
                "144",
                str(cover_pdf),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        rendered = sorted(Path(temp_dir).glob("cover-*.png"))
        if len(rendered) != 2:
            raise RuntimeError(f"官方封面 HTML 预览应为 2 张，实际为 {len(rendered)} 张")
        for page in rendered:
            payload = page.read_bytes()
            digest = hashlib.sha256(payload).hexdigest()
            destination = assets_dir / f"{digest}.png"
            if not destination.exists():
                shutil.copy2(page, destination)
            report_sources.append(f"assets/{destination.name}")
    return report_sources[0], report_sources[1]


def replace_legacy_cover_with_previews(
    html_text: str,
    front_src: str,
    back_src: str,
) -> str:
    """Replace the temporary S10 cover with official front/back HTML previews."""
    without_existing_previews, previous_preview_count = OFFICIAL_HTML_COVER_RE.subn(
        "", html_text
    )
    body_html, legacy_cover_count = _remove_legacy_cover_block(
        without_existing_previews
    )
    if legacy_cover_count != 1 and previous_preview_count != 2:
        raise RuntimeError(
            "客户 HTML 必须包含且仅包含一个可替换的旧封面，或一对既有官方封面预览"
        )
    for source in (front_src, back_src):
        if not re.fullmatch(r"assets/[0-9a-f]{64}\.png", source):
            raise RuntimeError("官方封面 HTML 预览必须使用内容哈希相对路径")

    front = (
        "<section class='official-cover-preview' "
        "data-official-cover-preview='front' data-report-page-role='front-cover'>"
        f"<img src='{front_src}' alt='FrontMind 正式封面'/></section>"
    )
    back = (
        "<section class='official-cover-preview' "
        "data-official-cover-preview='back' data-report-page-role='back-cover'>"
        f"<img src='{back_src}' alt='FrontMind 正式封底'/></section>"
    )
    if re.search(r"<body\b[^>]*>", body_html, flags=re.I):
        body_html = re.sub(
            r"(<body\b[^>]*>)",
            lambda match: match.group(1) + "\n" + front,
            body_html,
            count=1,
            flags=re.I,
        )
    else:
        body_html = front + body_html
    if re.search(r"</body\s*>", body_html, flags=re.I):
        body_html = re.sub(
            r"</body\s*>",
            back + "\n</body>",
            body_html,
            count=1,
            flags=re.I,
        )
    else:
        body_html += back
    return body_html


def _configure_macos_weasyprint_libraries() -> None:
    if sys.platform != "darwin":
        return
    try:
        import cffi  # type: ignore
        if getattr(cffi.FFI, "_frontmind_homebrew_dlopen", False):
            return
        original_dlopen = cffi.FFI.dlopen

        def homebrew_dlopen(instance: Any, name: Any, *args: Any, **kwargs: Any) -> Any:
            try:
                return original_dlopen(instance, name, *args, **kwargs)
            except OSError:
                for directory in (Path("/opt/homebrew/lib"), Path("/usr/local/lib")):
                    candidate = directory / str(name)
                    if candidate.is_file():
                        return original_dlopen(instance, str(candidate), *args, **kwargs)
                raise

        cffi.FFI.dlopen = homebrew_dlopen
        setattr(cffi.FFI, "_frontmind_homebrew_dlopen", True)
    except Exception:
        return


def render_pdf(html_path: Path, pdf_path: Path, base_url: Path | None = None) -> str:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        _configure_macos_weasyprint_libraries()
        from weasyprint import HTML  # type: ignore
        HTML(filename=str(html_path), base_url=str(base_url) if base_url else None).write_pdf(str(pdf_path))
        return "weasyprint"
    except Exception as exc:
        wk = shutil.which("wkhtmltopdf")
        import subprocess
        if wk:
            subprocess.run([wk, "--enable-local-file-access", str(html_path), str(pdf_path)], check=True)
            return "wkhtmltopdf"
        chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
        if not chrome:
            for candidate in (
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ):
                if Path(candidate).is_file():
                    chrome = candidate
                    break
        if chrome:
            with tempfile.TemporaryDirectory(prefix="frontmind-chrome-") as chrome_profile:
                subprocess.run([
                    chrome, "--headless=new", "--disable-gpu", "--no-first-run",
                    "--no-default-browser-check", "--disable-background-networking",
                    "--allow-file-access-from-files", f"--user-data-dir={chrome_profile}",
                    f"--print-to-pdf={pdf_path.resolve()}", html_path.resolve().as_uri(),
                ], check=True, timeout=90)
            if not pdf_path.exists() or pdf_path.stat().st_size == 0:
                raise RuntimeError("headless Chrome exited without producing a PDF")
            return "headless_chrome"
        raise RuntimeError(f"PDF 渲染失败，且无 wkhtmltopdf/Chrome 回退：{exc}") from exc


def stitch_cover(cover_pdf: Path | None, body_pdf: Path, output_pdf: Path, drop_html_cover: bool) -> str:
    if cover_pdf is None:
        raise RuntimeError("正式成品必须提供官方两页封面/封底 PDF")
    cover_validation = validate_official_cover(cover_pdf)
    if not cover_validation.get("passed"):
        raise RuntimeError(
            "官方封面资产未通过校验：" + "; ".join(cover_validation.get("errors") or [])
        )
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
        cover = PdfReader(str(cover_pdf))
        body = PdfReader(str(body_pdf))
        if len(cover.pages) != 2:
            raise RuntimeError("外部封面 PDF 必须恰好 2 页")
        writer = PdfWriter()
        writer.add_page(cover.pages[0])
        start = 1 if drop_html_cover and len(body.pages) > 1 else 0
        for page in body.pages[start:]:
            writer.add_page(page)
        writer.add_page(cover.pages[1])
        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        with output_pdf.open("wb") as f:
            writer.write(f)
        return f"pypdf: cover + body[{start}:] + back"
    except Exception:
        try:
            import fitz  # type: ignore
            cover = fitz.open(str(cover_pdf)); body = fitz.open(str(body_pdf)); out = fitz.open()
            start = 1 if drop_html_cover and body.page_count > 1 else 0
            out.insert_pdf(cover, from_page=0, to_page=0)
            if body.page_count > start:
                out.insert_pdf(body, from_page=start, to_page=body.page_count - 1)
            out.insert_pdf(cover, from_page=1, to_page=1)
            out.save(str(output_pdf))
            out.close(); body.close(); cover.close()
            return f"PyMuPDF: cover + body[{start}:] + back"
        except Exception:
            pdfseparate = shutil.which("pdfseparate")
            pdfunite = shutil.which("pdfunite")
            if not pdfseparate or not pdfunite:
                raise RuntimeError("封面拼接失败：缺少 pypdf、PyMuPDF 或 Poppler pdfseparate/pdfunite")
            with tempfile.TemporaryDirectory(prefix="frontmind-cover-stitch-") as temp_dir:
                temp = Path(temp_dir)
                cover_pattern = temp / "cover-%d.pdf"
                subprocess.run(
                    [
                        pdfseparate,
                        "-f",
                        "1",
                        "-l",
                        "2",
                        str(cover_pdf),
                        str(cover_pattern),
                    ],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=45,
                )
                parts = [temp / "cover-1.pdf"]
                start = 1 if drop_html_cover and pdf_page_count(body_pdf) > 1 else 0
                if start:
                    body_pattern = temp / "body-%d.pdf"
                    body_pages = pdf_page_count(body_pdf)
                    subprocess.run(
                        [
                            pdfseparate,
                            "-f",
                            "2",
                            "-l",
                            str(body_pages),
                            str(body_pdf),
                            str(body_pattern),
                        ],
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=60,
                    )
                    parts.extend(temp / f"body-{page}.pdf" for page in range(2, body_pages + 1))
                else:
                    parts.append(body_pdf)
                parts.append(temp / "cover-2.pdf")
                subprocess.run(
                    [pdfunite, *(str(part) for part in parts), str(output_pdf)],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=90,
                )
            return f"poppler: official front + body[{start}:] + official back"


def pdf_page_count(path: Path) -> int:
    try:
        from pypdf import PdfReader  # type: ignore
        return len(PdfReader(str(path)).pages)
    except Exception:
        try:
            import fitz  # type: ignore
            with fitz.open(str(path)) as doc:
                return doc.page_count
        except Exception:
            pdfinfo = shutil.which("pdfinfo")
            if not pdfinfo:
                raise RuntimeError("PDF page-count requires pypdf, PyMuPDF, or pdfinfo")
            result = subprocess.run(
                [pdfinfo, str(path)], check=True, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            )
            match = re.search(r"^Pages:\s*(\d+)\s*$", result.stdout, flags=re.M)
            if not match:
                raise RuntimeError("pdfinfo did not return a page count")
            return int(match.group(1))


def analyze_pdf(pdf_path: Path, ignore_first_last: bool = True) -> dict[str, Any]:
    """Measure page density from real content rather than page-wide backgrounds.

    WeasyPrint emits a white page-size drawing on most pages and a footer near
    the bottom. Counting those made half-empty pages look fully occupied. This
    implementation removes those artifacts and computes the union of visible
    text/drawing/image vertical intervals.
    """
    try:
        import fitz  # type: ignore
    except Exception as exc:
        pdftotext = shutil.which("pdftotext")
        if not pdftotext:
            return {"available": False, "error": str(exc), "page_count": pdf_page_count(pdf_path), "metrics": [], "blank_pages": [], "sparse_pages": [], "divider_pages": []}
        result = subprocess.run(
            [pdftotext, "-layout", str(pdf_path), "-"], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        page_count = pdf_page_count(pdf_path)
        page_texts = result.stdout.split("\f")
        if page_texts and not page_texts[-1].strip():
            page_texts.pop()
        page_texts.extend([""] * max(0, page_count - len(page_texts)))
        metrics: list[PageMetric] = []
        blank_pages: list[int] = []
        sparse_pages: list[int] = []
        divider_pages: list[int] = []
        for index in range(page_count):
            page_no = index + 1
            raw_text = page_texts[index] if index < len(page_texts) else ""
            compact = re.sub(r"\s+", "", raw_text)
            ignored = ignore_first_last and page_count >= 2 and page_no in {1, page_count}
            divider = _looks_like_divider_page(raw_text)
            blank = (not ignored) and (not divider) and len(compact) < 25
            sparse = (not ignored) and (not divider) and (not blank) and len(compact) < 420
            metrics.append(PageMetric(page_no, len(compact), 0, 0, 0.0, blank, sparse, divider))
            if blank:
                blank_pages.append(page_no)
            if sparse:
                sparse_pages.append(page_no)
            if divider:
                divider_pages.append(page_no)
        return {
            "available": True,
            "backend": "poppler-text",
            "page_count": page_count,
            "metrics": [asdict(metric) for metric in metrics],
            "blank_pages": blank_pages,
            "sparse_pages": sparse_pages,
            "divider_pages": divider_pages,
        }

    def merge_coverage(intervals: list[tuple[float, float]], page_height: float) -> float:
        clean = sorted((max(0.0, a), min(page_height, b)) for a, b in intervals if b > a)
        merged: list[list[float]] = []
        for a, b in clean:
            if not merged or a > merged[-1][1] + 1.0:
                merged.append([a, b])
            else:
                merged[-1][1] = max(merged[-1][1], b)
        return sum(b - a for a, b in merged) / page_height if page_height else 0.0

    metrics: list[PageMetric] = []
    blank_pages: list[int] = []
    sparse_pages: list[int] = []
    divider_pages: list[int] = []
    with fitz.open(str(pdf_path)) as doc:
        page_count = doc.page_count
        for idx, page in enumerate(doc):
            page_no = idx + 1
            page_h = float(page.rect.height or 1.0)
            page_w = float(page.rect.width or 1.0)
            raw_text = page.get_text("text") or ""
            text = re.sub(r"\s+", "", raw_text)
            drawings_data = page.get_drawings() or []
            images_data = page.get_images(full=True) or []
            intervals: list[tuple[float, float]] = []

            for block in page.get_text("blocks") or []:
                if len(block) < 5:
                    continue
                x0, y0, x1, y1, block_text = block[:5]
                compact = re.sub(r"\s+", "", str(block_text or ""))
                # Ignore the repeated pagination footer, which otherwise makes
                # the vertical span appear to cover the whole page.
                if float(y0) > page_h * 0.90 and ("FrontMind" in compact or len(compact) < 90):
                    continue
                if x1 > x0 and y1 > y0:
                    intervals.append((float(y0), float(y1)))

            for drawing in drawings_data:
                rect = drawing.get("rect")
                if not rect or rect.height <= 1 or rect.y0 >= page_h * 0.92:
                    continue
                fill = drawing.get("fill")
                near_white = bool(fill) and all(float(c) > 0.95 for c in fill)
                page_background = rect.width > page_w * 0.85 and rect.height > page_h * 0.75 and near_white
                if page_background:
                    continue
                intervals.append((float(rect.y0), float(rect.y1)))

            seen_xrefs: set[int] = set()
            for image in images_data:
                xref = int(image[0])
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                try:
                    rects = page.get_image_rects(xref)
                except Exception:
                    rects = []
                for rect in rects:
                    if rect.y0 < page_h * 0.92:
                        intervals.append((float(rect.y0), float(rect.y1)))

            vertical = max(0.0, min(1.0, merge_coverage(intervals, page_h)))
            ignored = ignore_first_last and page_count >= 2 and page_no in {1, page_count}
            # 识别“独立整页分隔页”：这类页面按设计就是大量留白、只有分部
            # 编号/中英文标题/一句描述，不应被当作缺陷的空白页/稀疏页。
            # 特征：页面文字较少，且包含分隔页独有的“SCOPE & ... LENS / 报告范围
            # 与诊断口径”等分部标题词，或同时出现大号编号 + 分部标题。
            is_divider_page = _looks_like_divider_page(raw_text)
            blank = (not ignored) and (not is_divider_page) and len(text) < 25 and vertical < 0.04 and len(images_data) == 0
            sparse = (not ignored) and (not is_divider_page) and (not blank) and len(text) < 420 and vertical < 0.32
            metric = PageMetric(page_no, len(text), len(drawings_data), len(images_data), round(vertical, 4), blank, sparse, is_divider_page)
            metrics.append(metric)
            if blank:
                blank_pages.append(page_no)
            if sparse:
                sparse_pages.append(page_no)
            if is_divider_page:
                divider_pages.append(page_no)
    return {
        "available": True,
        "page_count": len(metrics),
        "metrics": [asdict(m) for m in metrics],
        "blank_pages": blank_pages,
        "sparse_pages": sparse_pages,
        "divider_pages": divider_pages,
    }


def _pdf_page_texts(pdf_path: Path) -> list[str]:
    """Extract page-separated text for layout-marker validation."""
    try:
        import fitz  # type: ignore

        with fitz.open(str(pdf_path)) as doc:
            return [page.get_text("text") or "" for page in doc]
    except Exception:
        pdftotext = shutil.which("pdftotext")
        if not pdftotext:
            raise RuntimeError(
                "引用图表分页校验需要 PyMuPDF 或 pdftotext"
            )
        result = subprocess.run(
            [pdftotext, "-layout", str(pdf_path), "-"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
        )
        pages = result.stdout.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()
        return pages


def verify_citation_chart_pdf_layout(
    html_text: str,
    pdf_path: Path,
) -> dict[str, Any]:
    """Require each citation chart title/caption pair to remain on one PDF page."""
    group_present = bool(
        re.search(
            r"data-citation-chart-group=[\"']true[\"']",
            html_text,
            flags=re.I,
        )
    )
    result: dict[str, Any] = {
        "required": True,
        "passed": group_present,
        "mode": None,
        "item_pages": {},
        "paired_same_page": None,
        "errors": [],
    }
    if not group_present:
        result["errors"].append("required citation chart group is missing")
        return result
    if "citation-chart-group--paired" in html_text:
        result["mode"] = "paired"
    elif "citation-chart-group--stacked" in html_text:
        result["mode"] = "stacked"
    else:
        result["passed"] = False
        result["errors"].append("citation chart group has no layout mode")
        return result

    item_specs = {
        "source": (
            "Top 10 高频引用信源",
            "按引用次数排序；高频不自动等于权威或正面",
        ),
        "model": (
            "各模型引用记录量",
            # In a two-column PDF, ``pdftotext -layout`` may interleave the
            # left chart's labels inside the final clause of this caption.
            # This unique leading clause remains contiguous and still proves
            # that the model-chart caption stayed with its title.
            "模型引用量受问题量、监测周期和采样范围影响",
        ),
    }
    present_items = [
        key
        for key in item_specs
        if re.search(
            rf"data-citation-chart-item=[\"']{key}[\"']",
            html_text,
            flags=re.I,
        )
    ]
    try:
        page_texts = [
            re.sub(r"\s+", "", page_text)
            for page_text in _pdf_page_texts(pdf_path)
        ]
    except Exception as exc:  # noqa: BLE001
        result["passed"] = False
        result["errors"].append(f"citation chart PDF text validation failed: {exc}")
        return result

    item_pages: dict[str, int] = {}
    for key in present_items:
        title, caption = item_specs[key]
        title_key = re.sub(r"\s+", "", title)
        caption_key = re.sub(r"\s+", "", caption)
        title_pages = [
            index + 1
            for index, page_text in enumerate(page_texts)
            if title_key in page_text
        ]
        caption_pages = [
            index + 1
            for index, page_text in enumerate(page_texts)
            if caption_key in page_text
        ]
        common_pages = sorted(set(title_pages) & set(caption_pages))
        result["item_pages"][key] = {
            "title_pages": title_pages,
            "caption_pages": caption_pages,
            "complete_pages": common_pages,
        }
        if len(common_pages) != 1:
            result["errors"].append(
                f"{key} citation chart title/caption are not intact on one page"
            )
        else:
            item_pages[key] = common_pages[0]

    if result["mode"] == "paired":
        same_page = (
            len(item_pages) == len(present_items)
            and len(set(item_pages.values())) == 1
        )
        result["paired_same_page"] = same_page
        if not same_page:
            result["errors"].append(
                "paired citation charts are not complete on the same PDF page"
            )
    result["passed"] = not result["errors"]
    return result


def score_analysis(analysis: dict[str, Any]) -> tuple[int, int, int]:
    return (len(analysis.get("blank_pages", [])), len(analysis.get("sparse_pages", [])), int(analysis.get("page_count", 9999)))


def write_qa(qa_json: Path, qa_md: Path | None, payload: dict[str, Any]) -> None:
    qa_json.parent.mkdir(parents=True, exist_ok=True)
    qa_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if qa_md:
        before = payload.get("before_page_count")
        after = payload.get("analysis", {}).get("page_count")
        blank = payload.get("analysis", {}).get("blank_pages", [])
        sparse = payload.get("analysis", {}).get("sparse_pages", [])
        lines = [
            f"# {payload.get('brand')} 全景报告格式整理报告",
            "",
            f"> 结果：{'通过' if payload.get('passed') else '未通过'}",
            f"> 整理前页数：{before if before is not None else '未读取'}",
            f"> 整理后页数：{after}",
            "",
            "## 版面质量",
            "",
            f"- 空白页：{blank or '无'}",
            f"- 稀疏页：{sparse or '无'}",
            f"- 分隔页（独立整页，不计入空白/稀疏）：{payload.get('analysis', {}).get('divider_pages') or '无'}",
            f"- 使用模式：{payload.get('selected_mode')}",
            f"- 渲染器：{payload.get('renderer')}",
            f"- 封面拼接：{payload.get('cover_stitch')}",
            f"- 正式封面校验：{'通过' if payload.get('cover_gate', {}).get('front_match') else '未通过'}",
            f"- 正式封底校验：{'通过' if payload.get('cover_gate', {}).get('back_match') else '未通过'}",
            f"- HTML 旧封面移除：{'是' if payload.get('cover_gate', {}).get('legacy_cover_removed') else '否'}",
            f"- 引用图表分页校验：{'通过' if payload.get('citation_chart_gate', {}).get('passed') else '未通过'}",
            "",
            "## 整理动作",
            "",
            "- 每个分部的章节分隔页独立成页，正文从下一页开始；分隔页不压缩、不优化；",
            "- 取消正文的机械逐页分页，仅保留封面、目录、经营层摘要和分隔页的强制分页；",
            "- 长卡片允许跨页，图表和短卡片保持整体；",
            "- 清理空段落并收紧页边距、段落与组件间距（不涉及分隔页）。",
        ]
        qa_md.parent.mkdir(parents=True, exist_ok=True)
        qa_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def update_report_json(path: Path | None, payload: dict[str, Any]) -> None:
    if not path:
        return
    data: dict[str, Any] = {}
    if path.exists():
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                data = parsed
        except Exception:
            data = {}
    data["final_formatting"] = payload
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="FrontMind S11 成品格式整理师 本工作流")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--input-html", required=True)
    parser.add_argument("--output-html", required=True)
    parser.add_argument("--output-pdf", required=True)
    parser.add_argument(
        "--cover-pdf",
        default=str(official_cover_path()),
        help="Approved two-page official cover PDF; defaults to the bundled asset.",
    )
    parser.add_argument("--report-json")
    parser.add_argument("--qa-json", required=True)
    parser.add_argument("--qa-md")
    parser.add_argument("--max-sparse-pages", type=int, default=2)
    args = parser.parse_args()

    input_html = Path(args.input_html).resolve()
    output_html = Path(args.output_html).resolve()
    output_pdf = Path(args.output_pdf).resolve()
    cover_pdf = Path(args.cover_pdf).resolve()
    report_json = Path(args.report_json).resolve() if args.report_json else None
    qa_json = Path(args.qa_json).resolve()
    qa_md = Path(args.qa_md).resolve() if args.qa_md else None

    if not input_html.exists():
        print(f"[ERROR] HTML 不存在：{input_html}")
        return 2
    if input_html.parent != output_html.parent:
        print("[ERROR] S11 输入和输出 HTML 必须位于同一报告目录，以保持相对资产路径安全。")
        return 2
    cover_validation = validate_official_cover(cover_pdf)
    if not cover_validation.get("passed"):
        print("[ERROR] 官方封面/封底未通过强制校验：")
        for error in cover_validation.get("errors") or []:
            print(f"  - {error}")
        return 2

    before_page_count = pdf_page_count(output_pdf) if output_pdf.exists() else None
    original = input_html.read_text(encoding="utf-8", errors="ignore")

    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    try:
        front_preview, back_preview = prepare_cover_preview_assets(
            cover_pdf,
            output_html.parent,
        )
        customer_html = replace_legacy_cover_with_previews(
            original,
            front_preview,
            back_preview,
        )
        customer_html = _upgrade_legacy_citation_charts_html(customer_html)
        citation_contract_errors = citation_chart_pagination_contract_errors(
            customer_html
        )
        if citation_contract_errors:
            raise RuntimeError("; ".join(citation_contract_errors))
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] 正式封面/封底 HTML 替换失败：{exc}")
        return 2

    candidates: list[dict[str, Any]] = []
    rejected_citation_candidates: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="frontmind_s11_", dir=str(output_pdf.parent)) as tmp_s:
        tmp = Path(tmp_s)
        for mode, aggressive in (("balanced", False), ("aggressive", True)):
            if aggressive and candidates and len(candidates[0]["analysis"].get("blank_pages", [])) == 0 and len(candidates[0]["analysis"].get("sparse_pages", [])) <= args.max_sparse_pages:
                break
            base_href = output_html.parent.resolve().as_uri().rstrip("/") + "/"
            html_text = prepare_html(customer_html, aggressive=aggressive)
            render_html_text = _ensure_base_href(html_text, base_href)
            html_path = tmp / f"{mode}.html"
            body_pdf = tmp / f"{mode}_body.pdf"
            final_pdf = tmp / f"{mode}_final.pdf"
            html_path.write_text(render_html_text, encoding="utf-8")
            renderer = render_pdf(html_path, body_pdf, base_url=output_html.parent)
            body_pages = pdf_page_count(body_pdf)
            cover_note = stitch_cover(cover_pdf, body_pdf, final_pdf, drop_html_cover=False)
            cover_gate = verify_final_cover(
                final_pdf,
                cover_pdf,
                body_pages=body_pages,
                dropped_html_cover_pages=0,
            )
            if not cover_gate.get("passed"):
                raise RuntimeError(
                    "最终 PDF 封面/封底校验失败："
                    + "; ".join(cover_gate.get("errors") or [])
                )
            citation_chart_gate = verify_citation_chart_pdf_layout(
                html_text,
                final_pdf,
            )
            if not citation_chart_gate.get("passed"):
                rejected_citation_candidates.append({
                    "mode": mode,
                    "errors": citation_chart_gate.get("errors") or [],
                })
                continue
            analysis = analyze_pdf(final_pdf)
            candidates.append({
                "mode": mode, "html": html_text, "pdf": final_pdf,
                "renderer": renderer, "cover": cover_note, "analysis": analysis,
                "cover_gate": cover_gate,
                "citation_chart_gate": citation_chart_gate,
            })
        if not candidates:
            print(
                "[ERROR] 所有 S11 排版候选均未通过引用图表分页门禁："
                + json.dumps(rejected_citation_candidates, ensure_ascii=False)
            )
            return 3
        selected = min(candidates, key=lambda c: score_analysis(c["analysis"]))
        output_html.write_text(selected["html"], encoding="utf-8")
        shutil.copy2(selected["pdf"], output_pdf)

    analysis = selected["analysis"]
    # 达标判定只看“真正的空白页”（排版 bug）；
    # 稀疏页本质上是“内容量偏少导致页面偏空”，与字数门同源，
    # 按用户要求不再作为阻断条件，仅作为提示/记录（避免逼迫为填页而扩写）。
    # 独立整页分隔页已在 analyze_pdf 中被排除出 blank/sparse。
    blank_pages = analysis.get("blank_pages", [])
    sparse_pages = analysis.get("sparse_pages", [])
    selected_cover_gate = dict(selected["cover_gate"])
    selected_cover_gate.update({
        "legacy_cover_removed": LEGACY_HTML_COVER_RE.search(selected["html"]) is None,
        "html_front_marker_count": len(
            re.findall(
                r"data-official-cover-preview=[\"']front[\"']",
                selected["html"],
                flags=re.I,
            )
        ),
        "html_back_marker_count": len(
            re.findall(
                r"data-official-cover-preview=[\"']back[\"']",
                selected["html"],
                flags=re.I,
            )
        ),
    })
    html_cover_ok = (
        selected_cover_gate["legacy_cover_removed"]
        and selected_cover_gate["html_front_marker_count"] == 1
        and selected_cover_gate["html_back_marker_count"] == 1
    )
    selected_cover_gate["html_cover_replaced"] = html_cover_ok
    selected_cover_gate["html_preview_passed"] = html_cover_ok
    selected_cover_gate["passed"] = bool(
        selected_cover_gate.get("passed") and html_cover_ok
    )
    if not html_cover_ok:
        selected_cover_gate.setdefault("errors", []).append(
            "customer HTML official front/back preview contract failed"
        )
    selected_citation_chart_gate = dict(selected["citation_chart_gate"])
    passed = (
        len(blank_pages) == 0
        and selected_cover_gate["passed"]
        and selected_citation_chart_gate.get("passed") is True
    )
    sparse_warning = len(sparse_pages) > args.max_sparse_pages
    payload = {
        "version": "workflow-final",
        "brand": args.brand,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "blank_pages_block": True,
        "sparse_pages_enforced": False,
        "sparse_warning": sparse_warning,
        "before_page_count": before_page_count,
        "after_page_count": analysis.get("page_count"),
        "selected_mode": selected["mode"],
        "renderer": selected["renderer"],
        "cover_stitch": selected["cover"],
        "cover_gate": selected_cover_gate,
        "citation_chart_gate": selected_citation_chart_gate,
        "rejected_citation_candidates": rejected_citation_candidates,
        "format_marker": FORMAT_MARKER,
        "max_sparse_pages": args.max_sparse_pages,
        "analysis": analysis,
    }
    write_qa(qa_json, qa_md, payload)
    update_report_json(report_json, payload)
    print(f"[{'PASS' if passed else 'FAIL'}] S11 格式整理完成：{output_pdf}")
    print(f"  pages: {before_page_count} -> {analysis.get('page_count')}")
    print(f"  blank: {analysis.get('blank_pages', [])}; sparse: {analysis.get('sparse_pages', [])}")
    if sparse_warning:
        print(f"  [提示] 检测到 {len(sparse_pages)} 个稀疏页（仅提示，不阻断）：{sparse_pages}\n"
              f"        稀疏通常意味着部分页面内容较少；若希望更紧凑可补充对应 S 阶段内容，但不必为填页而扩写。")
    return 0 if passed else 3


if __name__ == "__main__":
    raise SystemExit(main())
