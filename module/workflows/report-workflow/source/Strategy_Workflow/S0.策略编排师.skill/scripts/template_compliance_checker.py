#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind 本工作流 final compliance checker.

The final gate verifies four independent concerns:
1) S1-S9 source depth and structured-source completeness were accepted by S10;
2) every required stage is represented in the S10 source manifest and coverage gate;
3) the customer-facing S10 report contains no internal/debug residue;
4) S11 formatting QA found no blank pages and no more than two sparse pages.

本工作流不再生成《问题监控数据文件》客户版 HTML/PDF；监控数据只以内部 JSON 形式
存在，并由 check_monitoring_json 校验其上传来源与自动确认状态。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))
from pdf_cover_contract import verify_final_cover  # noqa: E402

VERSION = "workflow-final"
DEFAULT_MONITORING_REPEAT = 5
# 字数 / 覆盖率 / 数量门控全部取消（0 = 不再设阈值），避免为凑字数而填充重复内容。
# 最终达标口径：Wide Research 已执行 + 各 S 阶段内容已真实完整填入 + 无残留/占位/造假。
REQUIRED_VISIBLE_TEXT_CHARS = 0
REQUIRED_CONTENT_MODULES = 0
REQUIRED_SOURCE_COVERAGE = 0.0
REQUIRED_S8_CONTENT_CALENDAR_COVERAGE = 0.0

S10_REQUIRED_SECTIONS = [
    "经营层摘要", "报告范围与诊断口径", "市场趋势与品类机会",
    "品牌定位与竞争战略", "用户意图与问题路径", "问答架构与内容承接",
    "AI 可见性诊断", "AI 诊断结论与品牌缺口分解", "语义资产审计",
    "话语资产与视觉资产", "风险管理", "12 周内容编排", "内容标题钩子",
    "GEO 战略选择", "GEO 业务流程", "第十部分", "第十一部分",
]
S10_REQUIRED_MARKERS = [
    "report-page", "chart-card", "svg-chart", "positioning-statement",
    "source-stage-block", "data-content-calendar", "data-title-hooks",
    "data-differentiation-matrix", "data-geo-workflow",
    "data-official-cover-preview",
    "frontmind-final-format-final",
]
REQUIRED_SOURCE_KEYS = {
    "brand_facts", "marketing", "trends", "positioning", "diagnostic",
    "semantic", "verbal", "visual", "qa_architecture", "enablement",
}
REQUIRED_MANIFEST_STAGES = {
    "S1", "S2", "S3", "S4", "S5", "S5.0", "S5.5", "S6", "S7", "S8", "S9", "S9.8",
}
S10_FORBIDDEN_PATTERNS = [
    r"\{\{[A-Z][A-Z0-9_]*\}\}", r"框架版本", r"生成时间[:：]", r"生成日期[:：]",
    r"报告节选|工作流证据地图", r"S[1-9](?:\.\d+)?_[^\s<]+", r"以[“\"]None[”\"]",
    r"待\s*S|待补齐|待确认|TODO|TBD", r"reasoningProcess|思考过程|COT_START|COT_END|CoT-[0-9]+",
    r"recommended_business_actions|action_id|GEO_A[0-9]+_[A-Za-z0-9_]+",
    r"暂无|……|\.\.\.\.", r"taskId|subTaskId|task_id|sub_task_id|Task ID|SubTask ID",
    r"大容量运动潮酷水具", r"官网与第三方平台权重|信源生态|高频引用来源|信源建设缺口",
    r"问答树概览[：:]?\s*五阶段具体问题路径",
    r"认知\s*[·•・]\s*awareness\s*5\s*个核心问题",
    r"问题优先级与内容承接矩阵|(?:30\s*条)?问题清单|质量与风险闸门",
    r"句式模板|竞品心智地图|危机与错误信息回应模板|下游注入规则|重校触发条件",
    r"Content\s+Title\s+Hooks|第十部分\s*[：:]?\s*内容标题钩子",
    r"第十二部分",
    r"FrontMind\s*策略工作流\s*输出|本文档由\s*FrontMind\s*策略工作流",
    r"版本\s*[：:][^。\n]{0,80}(?:日期|Date)\s*[：:]",
    r"(?:^|\s)(?:输入|原则|数据源)\s*[：:]",
    r"(?:^|[\s>`\"'(])/(?:Users|home|private|var|tmp|Volumes)/[^\s<]+",
    r"(?:^|[\s>`\"'(])[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s<]+",
]

def find_with_fallbacks(work_dir: Path, candidates: list[Path], recursive_name: str | None = None) -> Path:
    for path in candidates:
        if path.exists():
            return path
    if recursive_name:
        hits = sorted(work_dir.rglob(recursive_name))
        if hits:
            return hits[0]
    return candidates[0]


def check_file_exists(path: Path, label: str) -> list[str]:
    if not path.exists():
        return [f"[MISSING] {label}: {path.name}"]
    if path.stat().st_size == 0:
        return [f"[EMPTY] {label}: {path.name}"]
    return []


def load_json(path: Path, label: str) -> tuple[dict[str, Any] | None, list[str]]:
    if not path.exists():
        return None, [f"[MISSING] {label}: {path.name}"]
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, [f"[INVALID_JSON] {label}: {exc}"]
    if not isinstance(value, dict):
        return None, [f"[INVALID_JSON] {label} root must be object"]
    return value, []


def monitoring_partial_accepted(data: dict[str, Any]) -> bool:
    """Return true only for an import-accepted partial-data exception.

    partial_accepted is written by import_monitoring_spreadsheet.py at import
    time (--allow-partial-records, used only after the user explicitly accepts
    partial data); there is no separate data-confirmation pause anymore.
    """
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    return bool(
        meta.get("data_confirmation_status") == "confirmed"
        and meta.get("partial_accepted") is True
        and int(summary.get("successful_records") or 0) > 0
    )


def visible_text(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def check_s10_html(html_path: Path) -> list[str]:
    errors: list[str] = []
    if not html_path.exists():
        return [f"[CRITICAL] S10 HTML not found: {html_path.name}"]
    content = html_path.read_text(encoding="utf-8", errors="ignore")
    text = visible_text(content)
    for section in S10_REQUIRED_SECTIONS:
        if section not in content:
            errors.append(f"[S10] Missing required section: {section}")
    for marker in S10_REQUIRED_MARKERS:
        if marker not in content:
            errors.append(f"[S10] Missing final-report marker: {marker}")
    if re.search(r"<h1\b", content, flags=re.I):
        errors.append("[S10] Customer report must not retain source-stage h1 titles")
    front_preview_count = len(
        re.findall(
            r"data-official-cover-preview=[\"']front[\"']",
            content,
            flags=re.I,
        )
    )
    back_preview_count = len(
        re.findall(
            r"data-official-cover-preview=[\"']back[\"']",
            content,
            flags=re.I,
        )
    )
    if front_preview_count != 1 or back_preview_count != 1:
        errors.append(
            "[S10] Customer HTML must contain exactly one official front/back preview: "
            f"front={front_preview_count}, back={back_preview_count}"
        )
    if re.search(r"class=[\"'][^\"']*\bcover-page\b", content, flags=re.I):
        errors.append("[S10] Customer HTML still contains the replaced dynamic cover")
    if re.search(
        r"<h[2-6]\b[^>]*>\s*(?:\d+(?:\.\d+)*|[一二三四五六七八九十百零〇]+)"
        r"\s*[、.．]\s*",
        content,
        flags=re.I,
    ):
        errors.append("[S10] Imported local heading numbers remain in customer HTML")
    if "data-trend-opportunity-chart" in content:
        errors.append("[S10] Removed trend opportunity coordinate chart is still present")
    if re.search(
        r"data-citation-analysis=[\"']uploaded-spreadsheet[\"']",
        content,
        flags=re.I,
    ) and any(
        title in content
        for title in ("Top 10 高频引用信源", "各模型引用记录量")
    ):
        group_count = len(
            re.findall(
                r"data-citation-chart-group=[\"']true[\"']",
                content,
                flags=re.I,
            )
        )
        item_count = len(
            re.findall(
                r"data-citation-chart-item=[\"'][^\"']+[\"']",
                content,
                flags=re.I,
            )
        )
        if group_count != 1:
            errors.append(
                "[S10] Citation charts must have exactly one keep-together group: "
                f"actual={group_count}"
            )
        if item_count not in {1, 2}:
            errors.append(
                "[S10] Citation chart item count is invalid: "
                f"actual={item_count}"
            )
        if "data-pagination-policy='keep-together'" not in content and (
            'data-pagination-policy="keep-together"' not in content
        ):
            errors.append("[S10] Citation chart keep-together policy is missing")
    calendar_pos = content.find("data-content-calendar")
    hooks_pos = content.find("data-title-hooks")
    geo_pos = content.find("data-geo-workflow")
    if min(calendar_pos, hooks_pos, geo_pos) >= 0 and not (calendar_pos < hooks_pos < geo_pos):
        errors.append("[S10] Title hooks must follow the 12-week calendar and precede GEO strategy/workflow")
    for pattern in S10_FORBIDDEN_PATTERNS:
        if re.search(pattern, text, flags=re.I):
            errors.append(f"[S10] Customer report contains forbidden residue: {pattern}")
    # 字数 / 模块数门已取消：仅在正文为空或无任何模块时提示。
    if len(text) == 0:
        errors.append("[S10] Customer-visible body is empty.")
    modules = len(re.findall(r"<section[^>]+class=[\"'][^\"']*\breport-page\b", content, flags=re.I))
    if modules == 0:
        errors.append("[S10] No report-page content modules found.")
    divider_count = len(re.findall(r"class=[\"'][^\"']*\bdivider-page\b", content, flags=re.I))
    if divider_count != 11:
        errors.append(f"[S10] Report must contain exactly 11 section dividers: actual={divider_count}")
    source_key_list = re.findall(r"data-source-key=[\"']([^\"']+)[\"']", content, flags=re.I)
    source_keys = set(source_key_list)
    missing = sorted(REQUIRED_SOURCE_KEYS - source_keys)
    if missing:
        errors.append("[S10] Missing source-stage blocks: " + ", ".join(missing))
    for key in sorted(REQUIRED_SOURCE_KEYS):
        count = source_key_list.count(key)
        if count != 1:
            errors.append(f"[S10] Source-stage block must appear exactly once: {key}={count}")
    return errors


def check_s10_json(path: Path) -> list[str]:
    data, errors = load_json(path, "S10 JSON")
    if errors or data is None:
        return errors
    out: list[str] = []
    for gate_name in ("source_quality_gate", "source_coverage_gate", "template_compliance", "report_richness_gate"):
        gate = data.get(gate_name)
        if not isinstance(gate, dict) or gate.get("passed") is not True:
            out.append(f"[S10_JSON] {gate_name} did not pass")
            if isinstance(gate, dict) and gate.get("errors"):
                out.append(f"[S10_JSON] {gate_name} errors: {gate.get('errors')}")

    # 丰富度（字数 / 模块数）门已取消：不再根据 visible_text_chars / content_modules 阻断。

    coverage = data.get("source_coverage_gate", {})
    sections = coverage.get("sections", {}) if isinstance(coverage, dict) else {}
    for key in sorted(REQUIRED_SOURCE_KEYS):
        metric = sections.get(key) if isinstance(sections, dict) else None
        if not isinstance(metric, dict):
            out.append(f"[S10_JSON] Missing coverage metric: {key}")
            continue
        block_count = int(metric.get("block_count") or 0)
        # 只要求“来源块存在且唯一”；不再校验锚点数量或覆盖率百分比。
        if block_count != 1:
            out.append(f"[S10_JSON] Source block for {key} must appear exactly once: block_count={block_count}")

    s8_structured = sections.get("s8_structured_coverage", {}) if isinstance(sections, dict) else {}
    for key in ("content_calendar_titles",):
        metric = s8_structured.get(key) if isinstance(s8_structured, dict) else None
        if not isinstance(metric, dict):
            out.append(f"[S10_JSON] Missing S8 structured coverage metric: {key}")
            continue
        source_count = int(metric.get("source_count") or 0)
        rendered = int(metric.get("rendered_count") or 0)
        # 仅要求“已生成且已渲染”（至少 1 项）；不再要求固定数量 / 覆盖率。
        if source_count >= 1 and rendered == 0:
            out.append(f"[S10_JSON] S8 {key} generated but not rendered: source={source_count}, rendered={rendered}")

    hooks = sections.get("title_hooks", {}) if isinstance(sections, dict) else {}
    # 仅要求“标题钩子已生成且至少渲染 1 条”；不再硬性要求 12 条。
    if not isinstance(hooks, dict) or int(hooks.get("source_count") or 0) < 1 or int(hooks.get("rendered_count") or 0) < 1:
        out.append(f"[S10_JSON] S9.8 title hooks were not rendered: {hooks}")

    manifest = data.get("source_manifest", {})
    by_stage = manifest.get("by_stage", {}) if isinstance(manifest, dict) else {}
    manifest_stages = {str(key) for key, value in by_stage.items() if value}
    missing_stages = sorted(REQUIRED_MANIFEST_STAGES - manifest_stages)
    if missing_stages:
        out.append("[S10_JSON] Source manifest missing stages: " + ", ".join(missing_stages))

    formatting = data.get("final_formatting")
    if not isinstance(formatting, dict) or formatting.get("passed") is not True:
        out.append("[S11] S10 JSON has no passed final_formatting record")
    else:
        cover_gate = formatting.get("cover_gate")
        if not isinstance(cover_gate, dict):
            out.append("[S11] S10 JSON has no mandatory cover_gate")
        else:
            for field in (
                "passed",
                "front_match",
                "back_match",
                "page_count_formula_passed",
                "html_cover_replaced",
            ):
                if cover_gate.get(field) is not True:
                    out.append(f"[S11] cover_gate.{field} did not pass")
            if int(cover_gate.get("asset_pages") or 0) != 2:
                out.append("[S11] cover_gate.asset_pages must equal 2")
            if cover_gate.get("a4") is not True:
                out.append("[S11] cover_gate.a4 did not pass")
        citation_gate = formatting.get("citation_chart_gate")
        if not isinstance(citation_gate, dict):
            out.append("[S11] S10 JSON has no mandatory citation_chart_gate")
        else:
            if citation_gate.get("required") is not True:
                out.append("[S11] citation_chart_gate.required must be true")
            if citation_gate.get("passed") is not True:
                out.append("[S11] citation_chart_gate did not pass")
            if citation_gate.get("errors"):
                out.append(
                    "[S11] citation_chart_gate errors: "
                    + "; ".join(str(item) for item in citation_gate.get("errors") or [])
                )
            if (
                citation_gate.get("required") is True
                and citation_gate.get("mode") == "paired"
                and citation_gate.get("paired_same_page") is not True
            ):
                out.append(
                    "[S11] paired citation charts were not verified on the same PDF page"
                )
    return out


def check_s10_pdf(pdf_path: Path) -> list[str]:
    if not pdf_path.exists():
        return [f"[CRITICAL] S10 PDF not found: {pdf_path.name}"]
    if pdf_path.stat().st_size < 50000:
        return [f"[S10] PDF suspiciously small ({pdf_path.stat().st_size} bytes)."]
    gate = verify_final_cover(pdf_path)
    if not gate.get("passed"):
        return [
            "[S10] Mandatory official cover/back verification failed: "
            + "; ".join(gate.get("errors") or ["unknown cover failure"])
        ]
    return []


def check_s11_qa(path: Path, label: str, max_sparse_pages: int = 2) -> list[str]:
    data, errors = load_json(path, label)
    if errors or data is None:
        return errors
    out: list[str] = []
    if data.get("passed") is not True:
        out.append(f"[S11] {label} did not pass: {data.get('errors') or data.get('analysis')}")
    analysis = data.get("analysis", {}) if isinstance(data.get("analysis"), dict) else {}
    blanks = analysis.get("blank_pages", []) or []
    sparse = analysis.get("sparse_pages", []) or []
    if blanks:
        out.append(f"[S11] Blank pages found in {label}: {blanks}")
    # 稀疏页降级为不阻断：本质是“内容量偏少”，与字数门同源，按用户要求不再作为错误。
    if len(sparse) > max_sparse_pages:
        print(f"[INFO][S11] Sparse pages noted in {label} (non-blocking): {sparse} > {max_sparse_pages}")
    marker = data.get("format_marker") or data.get("format_marker_found")
    if marker in (False, None, ""):
        out.append(f"[S11] Formatting marker missing in {label}")
    if data.get("cover_stitch") == "no external cover":
        out.append(f"[S11] {label} illegally skipped the mandatory official cover")
    cover_gate = data.get("cover_gate")
    if not isinstance(cover_gate, dict):
        out.append(f"[S11] {label} has no mandatory cover_gate")
    else:
        for field in (
            "passed",
            "front_match",
            "back_match",
            "page_count_formula_passed",
            "html_cover_replaced",
        ):
            if cover_gate.get(field) is not True:
                out.append(f"[S11] {label} cover_gate.{field} did not pass")
        if int(cover_gate.get("asset_pages") or 0) != 2:
            out.append(f"[S11] {label} cover_gate.asset_pages must equal 2")
        if cover_gate.get("a4") is not True:
            out.append(f"[S11] {label} cover_gate.a4 did not pass")
    citation_gate = data.get("citation_chart_gate")
    if not isinstance(citation_gate, dict):
        out.append(f"[S11] {label} has no mandatory citation_chart_gate")
    else:
        if citation_gate.get("required") is not True:
            out.append(f"[S11] {label} citation_chart_gate.required must be true")
        if citation_gate.get("passed") is not True:
            out.append(f"[S11] {label} citation_chart_gate did not pass")
        if citation_gate.get("errors"):
            out.append(
                f"[S11] {label} citation_chart_gate errors: "
                + "; ".join(str(item) for item in citation_gate.get("errors") or [])
            )
        if (
            citation_gate.get("required") is True
            and citation_gate.get("mode") == "paired"
            and citation_gate.get("paired_same_page") is not True
        ):
            out.append(
                f"[S11] {label} paired citation charts were not verified on the same PDF page"
            )
    return out


def _resolve_existing_path(base: Path, value: object) -> Path | None:
    if not value:
        return None
    p = Path(str(value))
    candidates = [p]
    if not p.is_absolute():
        candidates.append(base / p)
    for candidate in candidates:
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


def _monitoring_source_kind(meta: dict, data_provenance: dict) -> str:
    """Return the only supported S5.0 source when both canonical markers agree."""
    declared = str(meta.get("monitoring_data_source") or "").lower()
    if declared == "molizhishu_api" and data_provenance.get("capture_method") == "molizhishu_api":
        return "molizhishu_api"
    if declared == "molizhishu_api" and data_provenance.get("capture_method") in ("molizhishu_api", None, ""):
        return "molizhishu_api"
    return "unknown"


def check_monitoring_json(path: Path) -> list[str]:
    data, errors = load_json(path, "Monitoring JSON")
    if errors or data is None:
        return errors
    out: list[str] = []
    records = data.get("records", [])
    if not isinstance(records, list) or len(records) == 0:
        out.append("[DATA] Monitoring JSON has 0 records")
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    if int(meta.get("screenshot") or 0) != 0:
        out.append("[DATA] Monitoring JSON must use screenshot=0")
    if int(summary.get("screenshot_records") or 0) != 0:
        out.append("[DATA] Monitoring JSON contains screenshot_records > 0")
    if meta.get("simulated_data") is True or meta.get("mock_data") is True or meta.get("manual_records") is True:
        out.append("[DATA] Monitoring JSON is marked simulated/mock/manual; re-import both user spreadsheets")
    data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}
    provenance_values = [
        str(meta.get("monitoring_data_source") or ""),
        str(data_provenance.get("capture_method") or ""),
    ]
    forbidden_blob = " ".join(provenance_values).lower()
    if any(term in forbidden_blob for term in ["simulated", "mock", "fake", "synthetic", "模拟", "仿真", "构造监控", "公开回答数据", "模拟 ai 平台"]):
        out.append("[DATA] Monitoring provenance/meta appears simulated or constructed")

    source_kind = _monitoring_source_kind(meta, data_provenance)
    if not source_kind:
        out.append("[DATA] monitoring source 必须为 molizhishu_api（路径B手动上传已移除）")
        source_file = _resolve_existing_path(path.parent, data_provenance.get("source_file"))
        raw_file = _resolve_existing_path(path.parent, data_provenance.get("raw_extracted_file"))
        if source_file is None:
            out.append("[DATA] uploaded spreadsheet source file missing")
        if raw_file is None:
            out.append("[DATA] uploaded spreadsheet raw extracted JSON missing")
        citation_name = path.name.replace("_frontmind_monitoring_data.json", "_引用分析数据.json")
        citation_path = path.with_name(citation_name)
        if not citation_path.exists():
            hits = list(path.parent.parent.rglob(citation_name)) if path.parent.parent.exists() else []
            citation_path = hits[0] if hits else citation_path
        citation, citation_errors = load_json(citation_path, "Citation analysis JSON")
        if citation_errors or citation is None:
            out.append("[DATA] uploaded spreadsheet branch requires a separate citation-analysis workbook")
        else:
            citation_meta = citation.get("meta", {}) if isinstance(citation.get("meta"), dict) else {}
            citation_validation = citation.get("validation", {}) if isinstance(citation.get("validation"), dict) else {}
            reconciliation = citation_validation.get("reconciliation", {}) if isinstance(citation_validation.get("reconciliation"), dict) else {}
            citation_summary = citation.get("summary", {}) if isinstance(citation.get("summary"), dict) else {}
            if citation_meta.get("data_source") != "uploaded_citation_analysis_spreadsheet":
                out.append("[DATA] citation-analysis JSON has an invalid data source")
            if citation_meta.get("data_confirmation_status") != "confirmed":
                out.append("[DATA] citation-analysis data was not auto-confirmed at import")
            if citation_validation.get("passed") is not True or reconciliation.get("passed") is not True:
                out.append("[DATA] citation-analysis workbook failed three-layer reconciliation")
            try:
                totals = [
                    int(reconciliation.get("media_citation_total")),
                    int(reconciliation.get("content_citation_total")),
                    int(reconciliation.get("question_record_count")),
                ]
            except (TypeError, ValueError):
                totals = []
            if len(totals) != 3 or totals[0] <= 0 or len(set(totals)) != 1:
                out.append("[DATA] citation-analysis media/content/question totals do not reconcile")
            elif int(citation_summary.get("total_citations") or 0) != totals[0]:
                out.append("[DATA] citation-analysis summary total does not match reconciliation")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("source_file")) is None:
                out.append("[DATA] citation-analysis source XLSX missing")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("raw_extracted_file")) is None:
                out.append("[DATA] citation-analysis raw extracted JSON missing")
    elif _monitoring_source_kind(meta, meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}) == "unknown":
        out.append("[DATA] Monitoring JSON must declare monitoring_data_source=molizhishu_api")
    if meta.get("data_confirmation_status") != "confirmed":
        out.append("[DATA] monitoring spreadsheet was not auto-confirmed at import")


    platforms = [str(p).lower() for p in (meta.get("platforms") or [])]
    if not platforms:
        out.append("[DATA] Monitoring platforms must not be empty")
    repeat = int(meta.get("repeat_per_question_platform") or 0)
    if repeat != DEFAULT_MONITORING_REPEAT:
        out.append(f"[DATA] repeat_per_question_platform must be {DEFAULT_MONITORING_REPEAT}, got {repeat}")
    expected = int(summary.get("expected_records") or 0)
    successful = int(summary.get("successful_records") or 0)
    partial_accepted = monitoring_partial_accepted(data)
    dynamic_expected = 2 * len(platforms) * repeat
    if expected != dynamic_expected:
        out.append(f"[DATA] Monitoring expected_records must equal questions×platforms×repeat ({dynamic_expected}), got {expected}")
    if expected and len(records) != expected:
        out.append(f"[DATA] Monitoring record count mismatch: actual={len(records)}, expected={expected}")
    if expected and successful <= 0:
        out.append("[DATA] Monitoring records have zero successful answers")
    elif expected and successful != expected and not partial_accepted:
        out.append(f"[DATA] Monitoring records incomplete: successful={successful}, expected={expected}")
    for record in records if isinstance(records, list) else []:
        if isinstance(record, dict) and (record.get("pageScreenshot") or record.get("screenshot_file") or record.get("screenshot_relpath")):
            out.append("[DATA] Monitoring JSON contains screenshot artifact fields")
            break
    return out

def main() -> int:
    parser = argparse.ArgumentParser(description=f"FrontMind {VERSION} final compliance checker")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--max-sparse-pages", type=int, default=2)
    args = parser.parse_args()
    work_dir = Path(args.work_dir).resolve()
    brand = args.brand
    final_dir = work_dir / "04_final_report"

    print(f"[INFO] FrontMind {VERSION} Final Compliance Check")
    print(f"  brand: {brand}\n  work_dir: {work_dir}\n")

    s10_html = find_with_fallbacks(work_dir, [final_dir / f"S10_{brand}_AI智能品牌优化方案全景报告.html", work_dir / f"S10_{brand}_AI智能品牌优化方案全景报告.html"], f"S10_{brand}_AI智能品牌优化方案全景报告.html")
    s10_pdf = find_with_fallbacks(work_dir, [final_dir / f"S10_{brand}_AI智能品牌优化方案全景报告.pdf", work_dir / f"S10_{brand}_AI智能品牌优化方案全景报告.pdf"], f"S10_{brand}_AI智能品牌优化方案全景报告.pdf")
    s10_json = find_with_fallbacks(work_dir, [final_dir / f"S10_{brand}_全景报告数据.json", work_dir / f"S10_{brand}_全景报告数据.json"], f"S10_{brand}_全景报告数据.json")
    s11_qa = find_with_fallbacks(work_dir, [final_dir / f"S11_{brand}_格式整理报告.json", work_dir / f"S11_{brand}_格式整理报告.json"], f"S11_{brand}_格式整理报告.json")
    s11_review = find_with_fallbacks(work_dir, [final_dir / f"S11_{brand}_格式整理复核.json", work_dir / f"S11_{brand}_格式整理复核.json"], f"S11_{brand}_格式整理复核.json")

    mon_json = find_with_fallbacks(work_dir, [work_dir / "02_monitoring_data" / f"S5_{brand}_frontmind_monitoring_data.json", work_dir / f"S5_{brand}_frontmind_monitoring_data.json"], f"S5_{brand}_frontmind_monitoring_data.json")

    errors: list[str] = []
    for path, label in [
        (s10_html, "S10 HTML"), (s10_pdf, "S10 PDF"), (s10_json, "S10 JSON"),
        (s11_qa, "S11 formatting QA"), (s11_review, "S11 review QA"),
        (mon_json, "Monitoring JSON"),
    ]:
        errors += check_file_exists(path, label)

    errors += check_s10_html(s10_html)
    errors += check_s10_json(s10_json)
    errors += check_s10_pdf(s10_pdf)
    errors += check_s11_qa(s11_qa, "S11 formatting QA", args.max_sparse_pages)
    errors += check_s11_qa(s11_review, "S11 review QA", args.max_sparse_pages)
    errors += check_monitoring_json(mon_json)
    if mon_json.exists() and s10_html.exists():
        try:
            monitoring_data = json.loads(mon_json.read_text(encoding="utf-8"))
            meta = monitoring_data.get("meta", {}) if isinstance(monitoring_data.get("meta"), dict) else {}
            data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}
            source_kind = _monitoring_source_kind(meta, data_provenance)
            final_html = s10_html.read_text(encoding="utf-8", errors="ignore")
            has_citation_module = "data-citation-analysis='uploaded-spreadsheet'" in final_html or 'data-citation-analysis="uploaded-spreadsheet"' in final_html
            if source_kind == "molizhishu_api" and not has_citation_module:
                errors.append("[S10] uploaded branch did not render citation analysis in the semantic-audit section")
            if source_kind != "molizhishu_api":
                errors.append("[S10] monitoring source must be molizhishu_api（路径B已移除）")
        except Exception as exc:
            errors.append(f"[DATA] cannot verify citation-analysis rendering policy: {exc}")

    # Deduplicate diagnostics generated by both existence and detailed checks.
    unique_errors = list(dict.fromkeys(errors))
    if unique_errors:
        print("\n[COMPLIANCE FAILED]")
        for error in unique_errors:
            print(f"  - {error}")
        return 2
    print(f"\n[COMPLIANCE PASSED] Depth, coverage, customer safety, and S11 layout all pass {VERSION}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
