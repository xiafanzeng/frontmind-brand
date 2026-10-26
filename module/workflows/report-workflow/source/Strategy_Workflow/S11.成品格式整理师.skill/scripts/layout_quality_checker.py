#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone layout QA gate for a formatted FrontMind panorama report."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from format_panorama_report import (  # noqa: E402
    FORMAT_MARKER,
    analyze_pdf,
    citation_chart_pagination_contract_errors,
    official_cover_path,
    verify_citation_chart_pdf_layout,
    verify_final_cover,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="FrontMind S11 layout quality checker 本工作流")
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--html")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--cover-pdf",
        default=str(official_cover_path()),
        help="Approved two-page official cover PDF.",
    )
    parser.add_argument("--max-sparse-pages", type=int, default=2)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    pdf = Path(args.pdf)
    html = Path(args.html) if args.html else None
    cover_pdf = Path(args.cover_pdf)
    output = Path(args.output)
    errors: list[str] = []
    warnings: list[str] = []
    if not pdf.exists() or pdf.stat().st_size == 0:
        errors.append(f"PDF 不存在或为空：{pdf}")
        analysis = {"page_count": 0, "blank_pages": [], "sparse_pages": []}
        cover_gate = {
            "required": True,
            "passed": False,
            "front_match": False,
            "back_match": False,
            "errors": ["final report PDF is missing or empty"],
        }
    else:
        analysis = analyze_pdf(pdf)
        final_pages = int(analysis.get("page_count") or 0)
        cover_gate = verify_final_cover(
            pdf,
            cover_pdf,
            body_pages=max(final_pages - 2, 0),
            dropped_html_cover_pages=0,
        )
        if not cover_gate.get("passed"):
            errors.extend(
                f"正式封面/封底门禁：{message}"
                for message in (cover_gate.get("errors") or ["unknown cover failure"])
            )
        # 注：analyze_pdf 已将“独立整页分隔页”从 blank/sparse 中排除，
        # 因此这里不会因分隔页留白而误报。
        if analysis.get("blank_pages"):
            errors.append(f"存在空白页：{analysis['blank_pages']}")
        # 稀疏页降级为提示：本质是“内容量偏少”，与字数门同源，按用户要求不再阻断。
        if len(analysis.get("sparse_pages", [])) > args.max_sparse_pages:
            warnings.append(f"稀疏页较多（仅提示，不阻断）：{analysis['sparse_pages']} > {args.max_sparse_pages}")
    marker_found = False
    source_stage_h1_absent = False
    html_cover_replaced = False
    citation_chart_gate = {
        "required": True,
        "passed": False,
        "mode": None,
        "item_pages": {},
        "paired_same_page": None,
        "errors": ["required citation chart group has not been verified"],
    }
    if html:
        if not html.exists():
            errors.append(f"HTML 不存在：{html}")
        else:
            text = html.read_text(encoding="utf-8", errors="ignore")
            marker_found = FORMAT_MARKER in text
            if not marker_found:
                errors.append("HTML 未发现 S11 格式整理标记")
            source_stage_h1_absent = re.search(r"<h1\b", text, flags=re.I) is None
            if not source_stage_h1_absent:
                errors.append("客户报告仍包含上游来源文件的 h1 一级标题")
            front_preview_count = len(
                re.findall(
                    r"data-official-cover-preview=[\"']front[\"']",
                    text,
                    flags=re.I,
                )
            )
            back_preview_count = len(
                re.findall(
                    r"data-official-cover-preview=[\"']back[\"']",
                    text,
                    flags=re.I,
                )
            )
            if front_preview_count != 1 or back_preview_count != 1:
                errors.append(
                    "客户 HTML 必须各包含一个正式封面与封底预览："
                    f"front={front_preview_count}, back={back_preview_count}"
                )
            legacy_cover_present = bool(re.search(
                r"class=[\"'][^\"']*\bcover-page\b",
                text,
                flags=re.I,
            ))
            if legacy_cover_present:
                errors.append("客户 HTML 仍包含已被替换的旧动态封面")
            html_cover_replaced = (
                front_preview_count == 1
                and back_preview_count == 1
                and not legacy_cover_present
            )
            visible = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", text, flags=re.I)
            visible = re.sub(r"<[^>]+>", " ", visible)
            visible = re.sub(r"\s+", " ", visible)
            removed_patterns = [
                r"问答树概览[：:]?\s*五阶段具体问题路径",
                r"认知\s*[·•・]\s*awareness\s*5\s*个核心问题",
                r"问题优先级与内容承接矩阵|(?:30\s*条)?问题清单|质量与风险闸门",
                r"句式模板|竞品心智地图|危机与错误信息回应模板|下游注入规则|重校触发条件",
                r"CoT-[0-9]+|recommended_business_actions|action_id|GEO_A[0-9]+_[A-Za-z0-9_]+",
                r"Content\s+Title\s+Hooks|第十部分\s*[：:]?\s*内容标题钩子",
                r"第十二部分",
                r"FrontMind\s*策略工作流\s*输出|本文档由\s*FrontMind\s*策略工作流",
                r"版本\s*[：:][^。]{0,80}(?:日期|Date)\s*[：:]",
                r"(?:^|\s)(?:输入|原则|数据源)\s*[：:]",
            ]
            for pattern in removed_patterns:
                if re.search(pattern, visible, flags=re.I):
                    errors.append(f"客户报告包含已禁止内容：{pattern}")
            if re.search(
                r"<h[2-6]\b[^>]*>\s*(?:\d+(?:\.\d+)*|[一二三四五六七八九十百]+)"
                r"\s*[、.．]\s*",
                text,
                flags=re.I,
            ):
                errors.append("客户报告仍包含来源稿局部标题编号，可能造成跳号")
            if "data-trend-opportunity-chart" in text:
                errors.append("客户报告仍包含已删除的趋势机会坐标图")
            for marker in (
                "data-content-calendar",
                "data-title-hooks",
                "data-differentiation-matrix",
                "data-geo-workflow",
            ):
                if marker not in text:
                    errors.append(f"客户报告缺少结构标记：{marker}")
            for message in citation_chart_pagination_contract_errors(text):
                errors.append(f"引用分析分页契约：{message}")
            if pdf.exists() and pdf.stat().st_size > 0:
                citation_chart_gate = verify_citation_chart_pdf_layout(text, pdf)
                if not citation_chart_gate.get("passed"):
                    errors.extend(
                        f"引用分析 PDF 分页门禁：{message}"
                        for message in (
                            citation_chart_gate.get("errors")
                            or ["unknown citation chart pagination failure"]
                        )
                    )
            calendar_pos = text.find("data-content-calendar")
            hooks_pos = text.find("data-title-hooks")
            geo_pos = text.find("data-geo-workflow")
            if min(calendar_pos, hooks_pos, geo_pos) >= 0 and not (calendar_pos < hooks_pos < geo_pos):
                errors.append("内容标题钩子必须紧随 12 周内容编排，并位于 GEO 战略/流程之前")
            divider_count = len(re.findall(r"class=[\"'][^\"']*\bdivider-page\b", text, flags=re.I))
            if divider_count != 11:
                errors.append(f"正式分部分隔页必须为 11 个，实际为 {divider_count}")
            if re.search(
                r"(?:^|[\s>`\"'(])/(?:Users|home|private|var|tmp|Volumes)/[^\s<]+"
                r"|(?:^|[\s>`\"'(])[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s<]+",
                text,
                flags=re.I,
            ):
                errors.append("客户报告包含本地绝对路径")
            if "page-break-before:always; position:relative" in text and FORMAT_MARKER not in text:
                errors.append("仍保留机械逐页分页且未被 S11 覆盖")
    cover_gate["html_cover_replaced"] = html_cover_replaced
    cover_gate["html_preview_passed"] = html_cover_replaced
    cover_gate["passed"] = bool(cover_gate.get("passed") and html_cover_replaced)
    if not html_cover_replaced:
        cover_gate.setdefault("errors", []).append(
            "customer HTML official front/back preview contract failed"
        )
    payload = {
        "version": "workflow-final",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "pdf": str(pdf),
        "html": str(html) if html else None,
        "format_marker_found": marker_found,
        "source_stage_h1_absent": source_stage_h1_absent,
        "cover_gate": cover_gate,
        "citation_chart_gate": citation_chart_gate,
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "sparse_pages_enforced": False,
        "analysis": analysis,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    for warn in warnings:
        print("[WARN]", warn)
    for err in errors:
        print("[ERROR]", err)
    if errors and args.strict:
        return 2
    print(f"[{'PASS' if not errors else 'WARN'}] layout QA: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
