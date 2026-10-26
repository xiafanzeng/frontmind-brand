#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind S10 customer-report compliance checker 本工作流.

This checker validates the pre-S11 S10 HTML. It deliberately evaluates
content depth and stage coverage rather than enforcing a mechanical page count.
Final whitespace/page-density checks are owned by S11.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# 字数 / 模块数门控已取消（0 = 不再设阈值），避免为凑字数而填充重复内容。
REQUIRED_VISIBLE_TEXT_CHARS = 0
REQUIRED_CONTENT_MODULES = 0

REQUIRED_SECTIONS = [
    "经营层摘要",
    "报告范围与诊断口径",
    "市场趋势与品类机会",
    "品牌定位与竞争战略",
    "用户意图与问题路径",
    "问答架构与内容承接",
    "AI 可见性诊断",
    "AI 诊断结论与品牌缺口分解",
    "语义资产审计",
    "话语资产与视觉资产",
    "风险管理",
    "12 周内容编排",
    "内容标题钩子",
    "GEO 战略选择",
    "GEO 业务流程",
    "第十部分",
    "第十一部分",
]
REQUIRED_MARKERS = [
    "report-page", "chart-card", "svg-chart", "positioning-statement", "source-stage-block",
    "data-content-calendar", "data-title-hooks", "data-geo-workflow",
    "data-semantic-dimension-chart", "data-differentiation-matrix",
]
REQUIRED_SOURCE_KEYS = {
    "brand_facts", "marketing", "trends", "positioning", "diagnostic",
    "semantic", "verbal", "visual", "qa_architecture", "enablement",
}
FORBIDDEN_PATTERNS = [
    (r"\{\{[A-Z0-9_]+\}\}", "未替换占位符"),
    (r"框架版本[：:]", "框架版本声明"),
    (r"生成时间[：:]\s*\d{4}", "生成时间戳"),
    (r"生成日期[：:]\s*\d{4}", "生成日期戳"),
    (r"双市场覆盖[：:]", "内部覆盖口径声明"),
    (r"报告节选|本页保留客户决策所需摘要|完整原文请见", "截断/节选提示"),
    (r"工作流证据地图", "工作流证据地图"),
    (r"S[1-9](?:\.\d+)?_[^\s<]+", "上游文件名"),
    (r"(?<![A-Za-z])None(?![A-Za-z])", "None 空值残留"),
    (r"待补齐|待确认|待\s*S|TODO|TBD", "模板/待办残留"),
    (r"……|\.\.\.\.", "省略号/占位填充"),
    (r"taskId|subTaskId|task_id|sub_task_id|Task ID|SubTask ID", "内部任务 ID"),
    (r"reasoningProcess|COT_START|COT_END|思考过程|CoT-[0-9]+", "推理/内部字段"),
    (r"recommended_business_actions|action_id|GEO_A[0-9]+_[A-Za-z0-9_]+", "内部行动字段"),
    (r"大容量运动潮酷水具", "跨客户样例字段"),
    (r"官网与第三方平台权重|信源生态|高频引用来源|信源建设缺口", "未按术语与模板字段闭环规范化的旧章节名"),
    (r"趋势机会气泡图|趋势机会图谱", "未按术语与模板字段闭环规范化的趋势图旧名"),
    (r"数据来源、局限性与复盘机制", "未按术语与模板字段闭环规范化的旧章节名"),
    (r"问题来源分布", "已删除问题来源块"),
    (r"资料缺口与后续补充建议", "已删除资料缺口章节"),
    (r"定位验证|Prompt\s*库概览", "已删除内容块"),
    (r"截图\s*</th>|截图\s*有", "截图索引表"),
    (r"问答树概览[：:]?\s*五阶段具体问题路径", "已删除的完整问答树"),
    (r"认知\s*[·•・]\s*awareness\s*5\s*个核心问题", "已删除的认知问题清单"),
    (r"问题优先级与内容承接矩阵", "已删除的问题承接矩阵"),
    (r"(?:30\s*条)?问题清单|质量与风险闸门", "已删除的问题清单/内部闸门"),
    (r"句式模板", "已删除的话语手册句式模板"),
    (r"竞品心智地图", "已删除的竞品心智地图"),
    (r"data-trend-opportunity-chart", "已删除的趋势机会坐标图"),
    (r"Content\s+Title\s+Hooks", "已删除的标题钩子独立分隔页"),
    (r"第十部分\s*[：:]?\s*内容标题钩子", "已删除的标题钩子独立章节"),
    (r"第十二部分", "报告必须收口为 11 个正式分部"),
    (r"FrontMind\s*策略工作流\s*输出", "内部报告头注"),
    (r"版本\s*[：:][^。\n]{0,80}(?:日期|Date)\s*[：:]", "内部版本/日期头注"),
    (r"(?:^|\s)(?:输入|原则|数据源)\s*[：:]", "内部输入/原则/数据源头注"),
    (r"本文档由\s*FrontMind\s*策略工作流", "内部生成说明"),
    (r"(?:^|[\s>`\"'(])/(?:Users|home|private|var|tmp|Volumes)/[^\s<]+", "本地绝对路径"),
    (r"(?:^|[\s>`\"'(])[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s<]+", "Windows 本地绝对路径"),
]


def visible_text(html_text: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html_text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def source_keys(html_text: str) -> set[str]:
    return set(re.findall(r"data-source-key=[\"']([^\"']+)[\"']", html_text, flags=re.I))


def check_html(html_text: str, strict: bool = False) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    text = visible_text(html_text)

    for term in REQUIRED_SECTIONS:
        if term not in html_text:
            errors.append(f"[MISSING_SECTION] {term}")
    for marker in REQUIRED_MARKERS:
        if marker not in html_text:
            errors.append(f"[MISSING_MARKER] {marker}")
    if re.search(r"<h1\b", html_text, flags=re.I):
        errors.append("[SOURCE_TITLE] 客户报告不得保留上游来源文件的 h1 一级标题")
    if "data-trend-opportunity-chart" in html_text:
        errors.append("[REMOVED_MODULE] 客户报告仍包含已删除的趋势机会坐标图")

    calendar_pos = html_text.find("data-content-calendar")
    hooks_pos = html_text.find("data-title-hooks")
    geo_pos = html_text.find("data-geo-workflow")
    if min(calendar_pos, hooks_pos, geo_pos) >= 0 and not (calendar_pos < hooks_pos < geo_pos):
        errors.append("[SECTION_ORDER] 内容标题钩子必须紧随 12 周内容编排，并位于 GEO 战略/流程之前")

    for pattern, desc in FORBIDDEN_PATTERNS:
        m = re.search(pattern, text, flags=re.I)
        if m:
            sample = m.group(0)[:80]
            (errors if strict else warnings).append(f"[FORBIDDEN] {desc}: {sample}")

    # 字数门已取消：仅在正文完全为空时提示。
    if len(text) == 0:
        errors.append("[EMPTY_BODY] 客户可见正文为空")

    modules = len(re.findall(r"<section[^>]+class=[\"'][^\"']*\breport-page\b", html_text, flags=re.I))
    # 模块数门已取消：仅在完全没有内容模块时提示。
    if modules == 0:
        errors.append("[NO_MODULES] 未检测到任何 report-page 内容模块")

    keys = source_keys(html_text)
    missing_keys = sorted(REQUIRED_SOURCE_KEYS - keys)
    if missing_keys:
        errors.append("[SOURCE_COVERAGE] 缺少来源正文块：" + ", ".join(missing_keys))
    key_list = re.findall(r"data-source-key=[\"']([^\"']+)[\"']", html_text, flags=re.I)
    for key in sorted(REQUIRED_SOURCE_KEYS):
        count = key_list.count(key)
        if count != 1:
            errors.append(f"[SOURCE_COVERAGE] 来源正文块必须且只能出现一次：{key}={count}")

    chart_count = len(re.findall(r"class=[\"'][^\"']*\bchart-card\b", html_text, flags=re.I))
    svg_count = len(re.findall(r"class=[\"'][^\"']*\bsvg-chart\b", html_text, flags=re.I))
    if chart_count < 4 or svg_count < 4:
        warnings.append(f"[FEW_CHARTS] chart-card={chart_count}, svg-chart={svg_count}；建议各 >=4")

    # 分隔页（section divider）现在按设计应该独立成页，每个分部一张，不再与正文共页。
    # 这里只做轻量提示，不作为质量门。
    divider_count = len(re.findall(r"class=[\"'][^\"']*\bdivider-page\b", html_text, flags=re.I))
    if divider_count != 11:
        errors.append(f"[SECTION_COUNT] 正式分部分隔页必须为 11 个，实际为 {divider_count}")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="FrontMind S10 template compliance checker 本工作流")
    parser.add_argument("--html", required=True, help="Rendered S10 HTML path")
    parser.add_argument("--strict", action="store_true", help="Treat forbidden content as blocking errors")
    args = parser.parse_args()
    path = Path(args.html)
    if not path.exists():
        print(f"[ERROR] HTML not found: {path}", file=sys.stderr)
        return 1
    html_text = path.read_text(encoding="utf-8", errors="ignore")
    errors, warnings = check_html(html_text, strict=args.strict)
    print("FrontMind S10 Template Compliance Check 本工作流")
    print(f"File: {path}")
    print(f"HTML: {len(html_text):,} chars; visible: {len(visible_text(html_text)):,} chars")
    for warning in warnings:
        print("[WARN]", warning)
    if errors:
        for error in errors:
            print("[ERROR]", error)
        return 2
    print("[PASS] S10 HTML passed depth/coverage-oriented 本工作流 checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
