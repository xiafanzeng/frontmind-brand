#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate external-agent stage execution manifests.

This checker verifies that the external agent followed the visible phase gates:
S0.0 read/acknowledged the workflow and the single pause point, S0.1 resolved
project input, each research stage ran as a separately auditable Wide Research
task, the Pause 1 fixed questions were user-confirmed, and S5.0 imported both
required user-uploaded spreadsheets with preserved provenance and a reconciled
citation-analysis dataset. S5.0 has no separate data-confirmation pause: the
importers auto-write data_confirmation_status=confirmed once both workbooks
pass their scope/reconciliation checks, and this checker verifies that.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RESEARCH_STAGES = [
    ("S1", "品牌事实"),
    ("S2", "营销图谱"),
    ("S3", "品类趋势"),
    ("S4", "品牌定位"),
    ("S5", "品牌诊断"),
    ("S5.5", "语义资产审计"),
    ("S6", "话语体系"),
    ("S7", "视觉符号"),
    ("S8", "问答架构"),
    ("S9", "业务赋能"),
    ("S9.8", "标题钩子"),
]

DEFAULT_MONITORING_REPEAT = 5

FORBIDDEN_MARKERS = re.compile(
    r"模拟|仿真|手工构造|公开信息构造|mock|simulate|simulated|simulation|manual\s*record|sample|placeholder",
    flags=re.I,
)


def read_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None, "JSON root must be an object"
        return data, None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def monitoring_partial_accepted(data: dict[str, Any] | None) -> bool:
    """Return true only for an import-accepted partial-data exception.

    partial_accepted is written by import_monitoring_spreadsheet.py at import
    time (--allow-partial-records, used only after the user explicitly accepts
    partial data); there is no separate confirmation step anymore.
    """
    if not isinstance(data, dict):
        return False
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    return bool(
        meta.get("data_confirmation_status") == "confirmed"
        and meta.get("partial_accepted") is True
        and int(summary.get("successful_records") or 0) > 0
    )


def load_monitoring_data(workspace: Path, brand: str) -> dict[str, Any] | None:
    candidates = list(workspace.rglob(f"S5_{brand}_frontmind_monitoring_data.json"))
    if not candidates:
        return None
    data, _ = read_json(candidates[0])
    return data


def load_citation_analysis(workspace: Path, brand: str) -> tuple[dict[str, Any] | None, Path | None]:
    candidates = list(workspace.rglob(f"S5_{brand}_引用分析数据.json"))
    if not candidates:
        return None, None
    data, _ = read_json(candidates[0])
    return data, candidates[0]


def resolve_file(workspace: Path, candidate: str) -> Path:
    p = Path(candidate)
    if p.is_absolute():
        return p
    direct = Path(candidate)
    if direct.exists():
        return direct
    # Manifests often store paths as outputs/{brand_id}/... while checker
    # receives workspace=outputs/{brand_id}. Resolve that form as well.
    parts = list(p.parts)
    if workspace.name in parts:
        idx = parts.index(workspace.name)
        suffix = parts[idx + 1:]
        if suffix:
            candidate_inside_workspace = workspace.joinpath(*suffix)
            if candidate_inside_workspace.exists():
                return candidate_inside_workspace
    return workspace / candidate


def declared_file(workspace: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    path = resolve_file(workspace, value.strip())
    if path.exists() and path.is_file() and path.stat().st_size > 0:
        return path
    return None


def citation_reconciliation_issues(
    citation: dict[str, Any],
    workspace: Path,
    *,
    require_confirmation: bool,
) -> tuple[list[str], list[str]]:
    """Validate the citation workbook, its retained source evidence and all three totals."""
    issues: list[str] = []
    existing: list[str] = []
    meta = citation.get("meta", {}) if isinstance(citation.get("meta"), dict) else {}
    validation = citation.get("validation", {}) if isinstance(citation.get("validation"), dict) else {}
    reconciliation = validation.get("reconciliation", {}) if isinstance(validation.get("reconciliation"), dict) else {}
    summary = citation.get("summary", {}) if isinstance(citation.get("summary"), dict) else {}

    if meta.get("data_source") != "uploaded_citation_analysis_spreadsheet":
        issues.append("引用分析数据 data_source 必须为 uploaded_citation_analysis_spreadsheet")
    if require_confirmation and meta.get("data_confirmation_status") != "confirmed":
        issues.append("引用分析数据未随导入自动确认（data_confirmation_status != confirmed）")
    if validation.get("passed") is not True or reconciliation.get("passed") is not True:
        issues.append("上传引用分析数据未通过三层对账")

    totals: list[int] = []
    for field in ("media_citation_total", "content_citation_total", "question_record_count"):
        try:
            totals.append(int(reconciliation.get(field)))
        except (TypeError, ValueError):
            issues.append(f"引用分析三层对账缺少有效 {field}")
    if len(totals) == 3:
        if totals[0] <= 0 or len(set(totals)) != 1:
            issues.append(
                "引用分析三层对账不一致："
                f"media={totals[0]}, content={totals[1]}, question={totals[2]}"
            )
        try:
            total_citations = int(summary.get("total_citations"))
        except (TypeError, ValueError):
            total_citations = 0
        if total_citations != totals[0]:
            issues.append(
                "引用分析 summary.total_citations 与三层对账不一致："
                f"summary={total_citations}, reconciled={totals[0]}"
            )

    for field, label in (
        ("source_file", "引用分析上传源 XLSX"),
        ("raw_extracted_file", "引用分析原始提取 JSON"),
    ):
        path = declared_file(workspace, meta.get(field))
        if path is None:
            issues.append(f"{label} 不存在或为空")
        else:
            existing.append(str(path))
    return issues, existing


def contains_forbidden(value: Any) -> bool:
    """Search forbidden markers in free-text values, not in schema keys.

    Keys such as ``simulated`` are valid when their value is ``false``.
    """
    if isinstance(value, dict):
        return any(contains_forbidden(v) for v in value.values())
    if isinstance(value, list):
        return any(contains_forbidden(v) for v in value)
    if isinstance(value, str):
        return bool(FORBIDDEN_MARKERS.search(value))
    return False


def check_generated_files(workspace: Path, files: Any) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    existing: list[str] = []
    if not isinstance(files, list) or not files:
        return ["generated_files 为空或不是数组"], []
    for item in files:
        if not isinstance(item, str) or not item.strip():
            missing.append(f"非法 generated_files 项：{item!r}")
            continue
        path = resolve_file(workspace, item.strip())
        if path.exists() and path.is_file() and path.stat().st_size > 0:
            existing.append(str(path))
        else:
            missing.append(item)
    return missing, existing



def check_workflow_reading(workspace: Path, brand: str) -> dict[str, Any]:
    stage_id = "S0.0"
    path = workspace / "_execution" / f"{stage_id}_{brand}_workflow_reading_manifest.json"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": "Workflow 阅读与双核心原则确认",
        "manifest": str(path),
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    if not path.exists():
        result["issues"].append("缺失 S0.0 workflow reading manifest；代理尚未显式确认暂停点规则和逐阶段 Wide Research 规则")
        return result
    data, err = read_json(path)
    if err or data is None:
        result["issues"].append(f"manifest 解析失败：{err}")
        return result
    if data.get("stage_id") != stage_id:
        result["issues"].append(f"stage_id 不一致：{data.get('stage_id')!r} != {stage_id!r}")
    if data.get("pause_points_acknowledged") is not True:
        result["issues"].append("pause_points_acknowledged 必须为 true")
    if data.get("wide_research_per_stage_acknowledged") is not True:
        result["issues"].append("wide_research_per_stage_acknowledged 必须为 true")
    if data.get("s5_0_data_source_rule_acknowledged") is not True:
        result["issues"].append("s5_0_data_source_rule_acknowledged 必须为 true")
    if data.get("s5_0_upload_spreadsheet_rule_acknowledged") is not True:
        result["issues"].append("s5_0_upload_spreadsheet_rule_acknowledged 必须为 true")
    if data.get("output_filename_contract_acknowledged") is not True:
        result["issues"].append("output_filename_contract_acknowledged 必须为 true；必须确认标准产物文件名闭环")
    if data.get("terminology_template_contract_acknowledged") is not True:
        result["issues"].append("terminology_template_contract_acknowledged 必须为 true；必须确认术语与模板字段闭环")
    if str(data.get("status", "")).lower() not in {"done", "completed", "pass", "passed"}:
        result["issues"].append("status 必须为 done/completed/passed")
    missing = data.get("missing_required_files")
    if isinstance(missing, list) and missing:
        result["issues"].append("必读 Workflow 文件缺失：" + "; ".join(map(str, missing[:8])))
    result["generated_existing"] = [str(path)] if path.exists() else []
    result["passed"] = not result["issues"]
    return result


def check_pause_confirmations(workspace: Path, brand: str) -> dict[str, Any]:
    stage_id = "PAUSE_GATES"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": "暂停点用户确认与 S5.0 双表导入确认",
        "manifest": "S4.8 questions JSON + S5.0 monitoring JSON",
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    q_files = list(workspace.rglob(f"S4.8_{brand}_fixed_monitoring_questions.json"))
    if not q_files:
        result["issues"].append("缺失 S4.8 固定双问题 JSON，无法证明暂停点 1")
    else:
        q_path = q_files[0]
        result["generated_existing"].append(str(q_path))
        data, err = read_json(q_path)
        if err or data is None:
            result["issues"].append(f"S4.8 JSON 解析失败：{err}")
        else:
            meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
            status = data.get("confirmation_status") or meta.get("confirmation_status")
            if status != "confirmed":
                result["issues"].append("暂停点 1 未确认：confirmation_status != confirmed")
    m_files = list(workspace.rglob(f"S5_{brand}_frontmind_monitoring_data.json"))
    if not m_files:
        result["issues"].append("缺失 S5.0 monitoring JSON，无法证明双表导入")
    else:
        m_path = m_files[0]
        result["generated_existing"].append(str(m_path))
        data, err = read_json(m_path)
        if err or data is None:
            result["issues"].append(f"S5.0 monitoring JSON 解析失败：{err}")
        else:
            meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
            if meta.get("data_confirmation_status") != "confirmed":
                result["issues"].append("S5.0 监控数据未随导入自动确认：data_confirmation_status != confirmed（import_monitoring_spreadsheet.py 正常导入应写入 confirmed）")
            if str(meta.get("monitoring_data_source") or "").lower() != "molizhishu_api":
                result["issues"].append("S5.0 仅允许 monitoring_data_source=molizhishu_api（路径B手动上传已移除，API 自动取数为唯一路径）")
            data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}
            if data_provenance.get("capture_method") != "molizhishu_api":
                result["issues"].append("AI 问答监控表缺少合法 data_provenance.capture_method（应为 molizhishu_api）")
            for field, label in (
                ("source_file", "AI 问答监控表上传源 XLSX"),
                ("raw_extracted_file", "AI 问答监控表原始提取 JSON"),
            ):
                provenance_path = declared_file(workspace, data_provenance.get(field))
                if provenance_path is None:
                    result["issues"].append(f"{label} 不存在或为空")
                else:
                    result["generated_existing"].append(str(provenance_path))

            citation, citation_path = load_citation_analysis(workspace, brand)
            if citation is None or citation_path is None:
                result["issues"].append("缺少独立信源表（引用分析表）数据，S5.0 不得放行")
            else:
                result["generated_existing"].append(str(citation_path))
                citation_issues, citation_existing = citation_reconciliation_issues(
                    citation,
                    workspace,
                    require_confirmation=True,
                )
                result["issues"].extend(citation_issues)
                result["generated_existing"].extend(citation_existing)
    result["passed"] = not result["issues"]
    return result

def check_input_resolution(workspace: Path, brand: str) -> dict[str, Any]:
    stage_id = "S0.1"
    path = workspace / "_execution" / f"{stage_id}_{brand}_input_resolution_manifest.json"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": "输入解析与补全计划",
        "manifest": str(path),
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    if not path.exists():
        result["issues"].append("缺失 S0.1 input resolution manifest")
        return result
    data, err = read_json(path)
    if err or data is None:
        result["issues"].append(f"manifest 解析失败：{err}")
        return result
    if data.get("stage_id") != stage_id:
        result["issues"].append(f"stage_id 不一致：{data.get('stage_id')!r} != {stage_id!r}")
    if data.get("brand_id") not in (brand, None, "") and brand not in str(data.get("brand_id")):
        result["issues"].append(f"brand_id 不一致：{data.get('brand_id')!r} != {brand!r}")
    if str(data.get("status", "")).lower() not in {"done", "completed", "pass", "passed"}:
        result["issues"].append("status 必须为 done/completed/passed")
    missing, existing = check_generated_files(workspace, data.get("generated_files"))
    if missing:
        result["issues"].append("generated_files 缺失或不存在：" + "; ".join(missing[:8]))
    result["generated_existing"] = existing
    result["passed"] = not result["issues"]
    return result


def check_research_manifest(workspace: Path, brand: str, stage_id: str, stage_name: str) -> dict[str, Any]:
    path = workspace / "_execution" / f"{stage_id}_{brand}_wide_research_manifest.json"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": stage_name,
        "manifest": str(path),
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    if not path.exists():
        result["issues"].append("缺失 Wide Research manifest")
        return result
    data, err = read_json(path)
    if err or data is None:
        result["issues"].append(f"manifest 解析失败：{err}")
        return result
    if data.get("stage_id") != stage_id:
        result["issues"].append(f"stage_id 不一致：{data.get('stage_id')!r} != {stage_id!r}")
    if data.get("brand") not in (brand, None, "") and brand not in str(data.get("brand")):
        result["issues"].append(f"brand 不一致：{data.get('brand')!r} != {brand!r}")
    if data.get("used_wide_research") is not True:
        result["issues"].append("used_wide_research 必须为 true")
    if str(data.get("status", "")).lower() not in {"done", "completed", "pass", "passed"}:
        result["issues"].append("status 必须为 done/completed/passed")
    if not isinstance(data.get("research_queries"), list) or not data.get("research_queries"):
        result["issues"].append("research_queries 不能为空")
    if not isinstance(data.get("external_sources"), list) or not data.get("external_sources"):
        result["issues"].append("external_sources 不能为空")
    missing, existing = check_generated_files(workspace, data.get("generated_files"))
    if missing:
        result["issues"].append("generated_files 缺失或不存在：" + "; ".join(missing[:8]))
    result["generated_existing"] = existing
    if contains_forbidden(data):
        result["issues"].append("manifest 含模拟/mock/manual/sample/placeholder 等禁用标记")
    result["passed"] = not result["issues"]
    return result



def check_monitoring_upload_manifest(workspace: Path, brand: str) -> dict[str, Any]:
    """Validate the upload-only S5.0 monitoring and citation manifests."""
    stage_id = "S5.0"
    path = workspace / "_execution" / f"{stage_id}_{brand}_monitoring_data_execution_manifest.json"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": "S5.0 双表上传导入",
        "manifest": str(path),
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    if not path.exists():
        result["issues"].append("缺失 S5.0 monitoring data execution manifest")
        return result
    data, err = read_json(path)
    if err or data is None:
        result["issues"].append(f"manifest 解析失败：{err}")
        return result
    monitoring_data = load_monitoring_data(workspace, brand)
    partial_accepted = monitoring_partial_accepted(monitoring_data)
    if data.get("stage_id") != stage_id:
        result["issues"].append(f"stage_id 不一致：{data.get('stage_id')!r} != {stage_id!r}")
    if data.get("simulated") not in (False, 0, "false", "False"):
        result["issues"].append("simulated 必须为 false")
    status = str(data.get("status", "")).lower()
    allowed_statuses = {"done", "completed", "pass", "passed"}
    if partial_accepted:
        allowed_statuses.add("completed_with_issues")
    if status not in allowed_statuses:
        result["issues"].append("status 必须为 done/completed/passed；仅用户已接受的 partial 可使用 completed_with_issues")
    source = str(data.get("monitoring_data_source") or "").lower()
    script = str(data.get("script", ""))
    if source != "molizhishu_api":
        result["issues"].append("S5.0 manifest 必须声明 monitoring_data_source=molizhishu_api（路径B手动上传已移除）")
    if data.get("used_molizhishu_api") is not True:
        result["issues"].append("S5.0 manifest 必须声明 used_molizhishu_api=true")
    if "import_monitoring_spreadsheet.py" not in script:
        result["issues"].append("S5.0 manifest script 必须指向 import_monitoring_spreadsheet.py")
    prov = data.get("source_provenance_files") or []
    if not isinstance(prov, list) or len(prov) < 2:
        result["issues"].append("AI 问答监控表 source_provenance_files 必须同时包含源 XLSX 与 raw JSON")
    else:
        prov_missing, prov_existing = check_generated_files(workspace, prov)
        if prov_missing:
            result["issues"].append("AI 问答监控表 source_provenance_files 缺失或不存在：" + "; ".join(prov_missing[:8]))
        suffixes = {Path(item).suffix.lower() for item in prov if isinstance(item, str)}
        if ".xlsx" not in suffixes or ".json" not in suffixes:
            result["issues"].append("AI 问答监控表 provenance 必须包含一份 .xlsx 源文件和一份 .json raw 文件")
        result["generated_existing"].extend(prov_existing)

    citation_manifest = workspace / "_execution" / f"S5.0_{brand}_citation_analysis_import_manifest.json"
    if not citation_manifest.exists():
        result["issues"].append("缺少独立信源表（引用分析表）导入 manifest")
    else:
        citation_manifest_data, citation_manifest_error = read_json(citation_manifest)
        if citation_manifest_error or citation_manifest_data is None:
            result["issues"].append(f"引用分析导入 manifest 解析失败：{citation_manifest_error}")
        else:
            if citation_manifest_data.get("monitoring_data_source") != "molizhishu_api":
                result["issues"].append("引用分析导入 manifest 必须声明 monitoring_data_source=molizhishu_api（路径B手动上传已移除）")
            if citation_manifest_data.get("used_uploaded_citation_spreadsheet") is not True:
                result["issues"].append("引用分析导入 manifest 必须声明 used_uploaded_citation_spreadsheet=true")
            if citation_manifest_data.get("simulated") not in (False, 0, "false", "False"):
                result["issues"].append("引用分析导入 manifest 必须声明 simulated=false")
            reconciliation = citation_manifest_data.get("reconciliation", {}) if isinstance(citation_manifest_data.get("reconciliation"), dict) else {}
            manifest_totals = [
                reconciliation.get("media_citation_total"),
                reconciliation.get("content_citation_total"),
                reconciliation.get("question_record_count"),
            ]
            try:
                normalized_totals = [int(value) for value in manifest_totals]
            except (TypeError, ValueError):
                normalized_totals = []
            if (
                reconciliation.get("passed") is not True
                or len(normalized_totals) != 3
                or normalized_totals[0] <= 0
                or len(set(normalized_totals)) != 1
            ):
                result["issues"].append("引用分析导入 manifest 未通过媒体/内容/问题明细三层对账")
            citation_missing, citation_existing = check_generated_files(workspace, citation_manifest_data.get("generated_files"))
            if citation_missing:
                result["issues"].append("引用分析导入 generated_files 缺失或不存在：" + "; ".join(citation_missing[:8]))
            result["generated_existing"].extend(citation_existing)

    citation, citation_path = load_citation_analysis(workspace, brand)
    if citation is None or citation_path is None:
        result["issues"].append("缺少信源表（引用分析表）标准 JSON")
    else:
        result["generated_existing"].append(str(citation_path))
        citation_issues, citation_existing = citation_reconciliation_issues(
            citation,
            workspace,
            require_confirmation=True,
        )
        result["issues"].extend(citation_issues)
        result["generated_existing"].extend(citation_existing)

    if monitoring_data is None:
        result["issues"].append("缺少 AI 问答监控表标准 JSON")
    else:
        monitoring_meta = monitoring_data.get("meta", {}) if isinstance(monitoring_data.get("meta"), dict) else {}
        if str(monitoring_meta.get("monitoring_data_source") or "").lower() not in ("uploaded_spreadsheet", "molizhishu_api"):
            result["issues"].append("AI 问答监控表 JSON 必须声明合法 monitoring_data_source")
        monitoring_provenance = monitoring_meta.get("data_provenance", {}) if isinstance(monitoring_meta.get("data_provenance"), dict) else {}
        if monitoring_provenance.get("capture_method") not in ("uploaded_spreadsheet", "molizhishu_api"):
            result["issues"].append("AI 问答监控表 JSON 缺少合法数据 provenance")
        for field, label in (
            ("source_file", "AI 问答监控表上传源 XLSX"),
            ("raw_extracted_file", "AI 问答监控表原始提取 JSON"),
        ):
            provenance_path = declared_file(workspace, monitoring_provenance.get(field))
            if provenance_path is None:
                result["issues"].append(f"{label} 不存在或为空")
            else:
                result["generated_existing"].append(str(provenance_path))
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    expected = int(summary.get("expected_records") or 0)
    successful = int(summary.get("successful_records") or 0)
    platform_count = int(summary.get("platform_count") or 0)
    question_count = int(summary.get("question_count") or 0)
    platforms = data.get("platforms") or data.get("meta", {}).get("platforms") or []
    effective_platform_count = platform_count or len(platforms)
    dynamic_expected = 2 * effective_platform_count * DEFAULT_MONITORING_REPEAT
    if effective_platform_count <= 0:
        result["issues"].append("S5.0 监控平台集合不能为空")
    if expected != dynamic_expected:
        result["issues"].append(f"S5.0 summary.expected_records 应按问题数×平台数×重复次数计算为 {dynamic_expected}，当前为 {expected}")
    if successful <= 0:
        result["issues"].append("S5.0 summary.successful_records 不得为 0")
    elif successful != dynamic_expected and not partial_accepted:
        result["issues"].append(f"S5.0 summary.successful_records 应为 {dynamic_expected}，当前为 {successful}")
    if question_count not in (0, 2):
        result["issues"].append(f"S5.0 summary.question_count 必须为 2，当前为 {question_count}")
    missing, existing = check_generated_files(workspace, data.get("generated_files"))
    if missing:
        result["issues"].append("generated_files 缺失或不存在：" + "; ".join(missing[:8]))
    result["generated_existing"] = list(dict.fromkeys(result["generated_existing"] + existing))
    if contains_forbidden(data):
        result["issues"].append("S5.0 manifest 含模拟/mock/sample/placeholder 等禁用标记")
    result["passed"] = not result["issues"]
    return result

def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# {payload['brand']} Stage / Wide Research 阶段执行检查报告",
        "",
        f"> 检查结果：{'通过' if payload['passed'] else '未通过'}",
        f"> 检查时间：{payload['checked_at']}",
        "",
        "| 阶段 | Manifest | 结果 | 问题 |",
        "|---|---|---|---|",
    ]
    for item in payload["stages"]:
        issues = "；".join(item.get("issues") or []) or "无"
        lines.append(f"| {item['stage_id']} {item['stage_name']} | `{item['manifest']}` | {'通过' if item['passed'] else '未通过'} | {issues} |")
    lines.extend([
        "",
        "## 规则",
        "",
        "- S0.0 必须有 Workflow 阅读、双核心原则、文件名闭环和术语模板闭环确认 manifest。",
        "- S0.1 必须有输入解析与补全计划 manifest。",
        "- S1、S2、S3、S4、S5、S5.5、S6、S7、S8、S9、S9.8 必须有独立 Wide Research manifest。",
        "- S5.0 必须有双表上传 manifest；monitoring_data_source 只能是 uploaded_spreadsheet。",
        "- 暂停点 1 必须有用户确认状态；S5.0 不设数据确认暂停点，两份表格导入并通过校验即自动写入 data_confirmation_status=confirmed。",
        "- AI 问答监控表与信源表（引用分析表）的源 XLSX、raw JSON 和 generated_files 必须真实存在且非空。",
    ])
    return "\n".join(lines) + "\n"


def check_bsas_scorecard(workspace: Path, brand: str) -> dict[str, Any]:
    """S5.5 BSAS 评分卡结构硬门禁（workflow v3）。

    防止执行 Agent 自创评分结构导致 S10 五维图与总分静默缺失：
    评分卡必须符合 Strategy_Workflow/S5.5.品牌语义资产审计师.skill/templates/bsas_scorecard_schema.json。
    """
    stage_id = "S5.5-BSAS"
    result: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_name": "BSAS 评分卡结构合规（schema 硬门禁）",
        "manifest": f"S5.5_{brand}_语义资产评分卡.json",
        "passed": False,
        "issues": [],
        "generated_existing": [],
    }
    files = list(workspace.rglob(f"S5.5_{brand}_语义资产评分卡.json"))
    if not files:
        result["issues"].append("缺失 S5.5 语义资产评分卡 JSON；必须按 bsas_scorecard_schema.json 结构产出（bsas_total/grade/dimensions 五维/ranking_position_diagnostics 等九个必填字段）")
        return result
    path = files[0]
    result["generated_existing"].append(str(path))
    data, err = read_json(path)
    if err or data is None:
        result["issues"].append(f"评分卡解析失败：{err}")
        return result

    required_top = ["meta", "bsas_total", "grade", "dimensions", "competitive_benchmark",
                    "priority_actions", "twelve_week_targets", "source_intelligence", "ranking_position_diagnostics"]
    for key in required_top:
        if key not in data:
            result["issues"].append(f"评分卡缺失顶层必填字段：{key}（必须符合 bsas_scorecard_schema.json）")

    dims = data.get("dimensions")
    canonical = {
        "semantic_visibility": 30, "semantic_coherence": 20, "semantic_richness": 20,
        "semantic_authority": 15, "competitive_advantage": 15,
    }
    if not isinstance(dims, dict):
        result["issues"].append("dimensions 必须是对象（dict），键为 semantic_visibility/semantic_coherence/semantic_richness/semantic_authority/competitive_advantage；自创五维结构不被 S10 渲染")
    else:
        for key, max_score in canonical.items():
            dim = dims.get(key)
            if not isinstance(dim, dict):
                result["issues"].append(f"dimensions 缺失或非法：{key}")
                continue
            if dim.get("max_score") != max_score:
                result["issues"].append(f"dimensions.{key}.max_score 必须为 {max_score}")
            score = dim.get("score")
            if not isinstance(score, (int, float)) or not (0 <= score <= max_score):
                result["issues"].append(f"dimensions.{key}.score 必须为 0-{max_score} 的数值")
            if not isinstance(dim.get("sub_indicators"), dict) or not dim.get("sub_indicators"):
                result["issues"].append(f"dimensions.{key}.sub_indicators 必须为非空对象（各子指标含 score/max_score/raw_value/calculation_basis）")
        if len(dims) != len(canonical):
            extra = set(map(str, dims.keys())) - set(canonical)
            if extra:
                result["issues"].append(f"dimensions 含非规范键（将被 S10 忽略）：{sorted(extra)[:5]}")

    total = data.get("bsas_total")
    if isinstance(total, (int, float)) and isinstance(dims, dict):
        dim_sum = sum(dims.get(k, {}).get("score", 0) if isinstance(dims.get(k), dict) else 0 for k in canonical)
        if abs(dim_sum - total) > 0.1:
            result["issues"].append(f"五维得分之和（{dim_sum}）必须等于 bsas_total（{total}）")
        band = "A" if total >= 80 else "B" if total >= 60 else "C" if total >= 40 else "D" if total >= 20 else "E"
        if data.get("grade") != band:
            result["issues"].append(f"grade 与总分不符：总分 {total} 应为 {band} 级")
    elif not isinstance(total, (int, float)):
        result["issues"].append("bsas_total 必须为 0-100 的数值")

    # 复用 S5.5 技能自带校验器（竞品基准≥3、优先行动≥3 等）
    try:
        skill_scripts = Path(__file__).resolve().parents[2] / "S5.5.品牌语义资产审计师.skill" / "scripts"
        if str(skill_scripts) not in sys.path:
            sys.path.insert(0, str(skill_scripts))
        from bsas_calculator import validate_scorecard  # noqa: PLC0415
        ok, issues = validate_scorecard(data)
        if not ok:
            result["issues"].extend(f"bsas_calculator 校验：{i}" for i in issues)
    except Exception as exc:  # noqa: BLE001
        result["issues"].append(f"bsas_calculator 校验器加载失败：{exc}")

    result["passed"] = not result["issues"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Check 执行 Stage Wide Research manifests and S5.0 monitoring data source manifest.")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", default=None)
    parser.add_argument("--output-md", default=None)
    parser.add_argument("--strict", action="store_true", help="Return non-zero on failure.")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    stages = [check_workflow_reading(workspace, args.brand), check_input_resolution(workspace, args.brand)]
    stages.extend(check_research_manifest(workspace, args.brand, sid, name) for sid, name in RESEARCH_STAGES)
    stages.insert(6, check_monitoring_upload_manifest(workspace, args.brand))  # after S4 / before S5
    stages.append(check_bsas_scorecard(workspace, args.brand))  # S5.5 BSAS schema 硬门禁（v3）
    stages.append(check_pause_confirmations(workspace, args.brand))
    passed = all(item["passed"] for item in stages)
    payload = {
        "version": "workflow-final",
        "brand": args.brand,
        "workspace": str(workspace),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "stages": stages,
    }

    out_json = Path(args.output_json) if args.output_json else workspace / "_execution" / f"S0_{args.brand}_stage_execution_check.json"
    out_md = Path(args.output_md) if args.output_md else workspace / "_execution" / f"S0_{args.brand}_stage_execution_check.md"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    out_md.write_text(render_markdown(payload), encoding="utf-8")

    print(f"stage execution check: {'PASS' if passed else 'FAIL'}")
    print(f"json: {out_json}")
    print(f"md: {out_md}")
    if args.strict and not passed:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
