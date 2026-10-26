#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-render file check and auto-linking script for S10 panorama report.

本工作流 blocks S10 when upstream S files are missing, empty, or placeholder-only.
It may still copy compatible fallback files to expected names, but copied files
must pass the same substantive-content gate.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

PLACEHOLDER_TERMS = ("资料仍需补充", "待补齐", "待确认", "TODO", "todo", "TBD", "本模块当前缺少")
DEFAULT_MONITORING_REPEAT = 5


def monitoring_partial_accepted(data: dict) -> bool:
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    return bool(
        meta.get("data_confirmation_status") == "confirmed"
        and meta.get("partial_accepted") is True
        and int(summary.get("successful_records") or 0) > 0
    )


def is_placeholder_text(value: str) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    if any(term in s for term in PLACEHOLDER_TERMS):
        return True
    compact = re.sub(r"[\s：:，,。.!！?？_-]+", "", s)
    return bool(re.fullmatch(r"(?:暂无|示例|示例内容|示例文本|示例数据|占位|占位符|占位内容|占位文本|待填写|待补充)", compact, flags=re.I))


def substantive_len(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="ignore")
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"^\s*#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", "", text)
    text = re.sub(r"[\s\W_]+", "", text)
    return len(text)


def validate_file(path: Path, expected_name: str) -> list[str]:
    errors: list[str] = []
    if not path.exists():
        return [f"[MISSING] {expected_name}"]
    if path.stat().st_size == 0:
        return [f"[EMPTY] {expected_name}"]
    if path.suffix.lower() == ".json":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            return [f"[INVALID_JSON] {expected_name}: {exc}"]
        if data in ({}, []):
            errors.append(f"[EMPTY_JSON] {expected_name}")
    elif path.suffix.lower() == ".md":
        raw = path.read_text(encoding="utf-8", errors="ignore")
        body_len = substantive_len(path)
        # 最低字数门已彻底取消：只要不是完全空（有任何实质正文）即通过。
        # 避免为凑字数而填充重复内容；只有完全空壳才拦。
        if body_len < 1:
            errors.append(f"[EMPTY] {expected_name}: 有效正文为空")
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        if lines:
            ph = [ln for ln in lines if is_placeholder_text(ln)]
            if len(ph) / max(1, len(lines)) > 0.35:
                errors.append(f"[PLACEHOLDER_HEAVY] {expected_name}: 占位内容过多")
            title_like = [ln for ln in lines if re.search(r"(报告|图谱|手册|建议)$", ln) and len(ln) <= 40]
            if len(lines) <= 8 and len(title_like) >= 2:
                errors.append(f"[TITLE_ONLY] {expected_name}: 仅包含标题/报告名")
    return errors




def _resolve_existing_path(base: Path, value: object) -> Path | None:
    if not value:
        return None
    p = Path(str(value))
    candidates = [p]
    if not p.is_absolute():
        candidates.append(base / p)
    for candidate in candidates:
        if candidate.exists() and candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    return None


def _monitoring_source_kind(meta: dict, data_provenance: dict) -> str:
    """Return the supported S5.0 source when canonical markers agree.

    本工作流一键版契约（molizhishu-api-contract.md）：uploaded_spreadsheet 与
    molizhishu_api 均为合法监控数据来源；两者都必须保留真实数据来源标记。
    """
    declared = str(meta.get("monitoring_data_source") or "").lower()
    if declared == "uploaded_spreadsheet" and data_provenance.get("capture_method") == "uploaded_spreadsheet":
        return "uploaded_spreadsheet"
    if declared == "molizhishu_api" and data_provenance.get("capture_method") in ("molizhishu_api", None, ""):
        return "molizhishu_api"
    return "unknown"


def validate_uploaded_monitoring_files(work_dir: Path, brand: str) -> list[str]:
    """Early S10 gate for the two mandatory uploaded spreadsheets."""
    candidates = [
        work_dir / f"S5_{brand}_frontmind_monitoring_data.json",
        work_dir / "02_monitoring_data" / f"S5_{brand}_frontmind_monitoring_data.json",
    ]
    hits = [p for p in candidates if p.exists()]
    if not hits:
        hits = sorted(work_dir.rglob(f"S5_{brand}_frontmind_monitoring_data.json"))
    if not hits:
        return ["[MONITORING_MISSING] 缺少 S5.0 monitoring_data JSON"]
    path = hits[0]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"[MONITORING_INVALID_JSON] {path.name}: {exc}"]
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    records = data.get("records", []) if isinstance(data.get("records"), list) else []
    errors: list[str] = []
    data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}
    provenance_values = [
        str(meta.get("monitoring_data_source") or ""),
        str(data_provenance.get("capture_method") or ""),
    ]
    forbidden_blob = " ".join(provenance_values).lower()
    if any(term in forbidden_blob for term in ["simulated", "mock", "fake", "synthetic", "模拟", "仿真", "构造监控", "公开回答数据"]):
        errors.append("[MONITORING_FORBIDDEN] monitoring meta/provenance 疑似模拟或构造")
    if meta.get("simulated_data") is True or meta.get("mock_data") is True or meta.get("manual_records") is True:
        errors.append("[MONITORING_FORBIDDEN] monitoring JSON 标记为 simulated/mock/manual")

    execution_dir = work_dir / "_execution"
    monitoring_manifest_path = execution_dir / f"S5.0_{brand}_monitoring_data_execution_manifest.json"
    if not monitoring_manifest_path.exists():
        errors.append("[MONITORING_UPLOAD_MANIFEST_MISSING] 缺少 AI 问答监控表导入 manifest")
    else:
        try:
            monitoring_manifest = json.loads(monitoring_manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            monitoring_manifest = {}
            errors.append(f"[MONITORING_UPLOAD_MANIFEST_INVALID] AI 问答监控表导入 manifest 无法解析：{exc}")
        if monitoring_manifest.get("monitoring_data_source") not in ("uploaded_spreadsheet", "molizhishu_api"):
            errors.append("[MONITORING_UPLOAD_MANIFEST_INVALID] monitoring_data_source 必须为 uploaded_spreadsheet 或 molizhishu_api")
        if monitoring_manifest.get("used_uploaded_spreadsheet") is not True and monitoring_manifest.get("monitoring_data_source") != "molizhishu_api":
            errors.append("[MONITORING_UPLOAD_MANIFEST_INVALID] used_uploaded_spreadsheet 必须为 true（molizhishu_api 来源除外）")
        manifest_provenance = monitoring_manifest.get("source_provenance_files")
        if not isinstance(manifest_provenance, list) or len(manifest_provenance) < 2:
            errors.append("[MONITORING_UPLOAD_PROVENANCE] 问答表 manifest 必须同时登记源 XLSX 与 raw JSON")
        else:
            suffixes = {Path(str(item)).suffix.lower() for item in manifest_provenance}
            if ".xlsx" not in suffixes or ".json" not in suffixes:
                errors.append("[MONITORING_UPLOAD_PROVENANCE] 问答表 provenance 必须包含 .xlsx 与 .json")
            for item in manifest_provenance:
                if _resolve_existing_path(work_dir, item) is None:
                    errors.append(f"[MONITORING_UPLOAD_PROVENANCE] provenance 文件不存在：{item}")

    citation_manifest_path = execution_dir / f"S5.0_{brand}_citation_analysis_import_manifest.json"
    if not citation_manifest_path.exists():
        errors.append("[CITATION_UPLOAD_MANIFEST_MISSING] 缺少信源表（引用分析表）导入 manifest")
    else:
        try:
            citation_manifest = json.loads(citation_manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            citation_manifest = {}
            errors.append(f"[CITATION_UPLOAD_MANIFEST_INVALID] 引用分析导入 manifest 无法解析：{exc}")
        if citation_manifest.get("monitoring_data_source") not in ("uploaded_spreadsheet", "molizhishu_api"):
            errors.append("[CITATION_UPLOAD_MANIFEST_INVALID] 引用分析 manifest 数据源必须为 uploaded_spreadsheet 或 molizhishu_api")
        if citation_manifest.get("used_uploaded_citation_spreadsheet") is not True and citation_manifest.get("monitoring_data_source") != "molizhishu_api":
            errors.append("[CITATION_UPLOAD_MANIFEST_INVALID] used_uploaded_citation_spreadsheet 必须为 true（molizhishu_api 来源除外）")

    source_kind = _monitoring_source_kind(meta, data_provenance)
    if source_kind == "uploaded_spreadsheet":
        if data_provenance.get("capture_method") != "uploaded_spreadsheet":
            errors.append("[MONITORING_UPLOAD_REQUIRED] 上传表格分支缺少 data_provenance.capture_method=uploaded_spreadsheet")
        if _resolve_existing_path(path.parent, data_provenance.get("source_file")) is None:
            errors.append("[MONITORING_UPLOAD_SOURCE_MISSING] 缺少上传表格源文件")
        if _resolve_existing_path(path.parent, data_provenance.get("raw_extracted_file")) is None:
            errors.append("[MONITORING_UPLOAD_RAW_MISSING] 缺少上传表格解析 raw JSON")
        citation_hits = sorted(work_dir.rglob(f"S5_{brand}_引用分析数据.json"))
        if not citation_hits:
            errors.append("[CITATION_UPLOAD_MISSING] 上传表格分支缺少独立引用分析数据")
        else:
            citation_path = citation_hits[0]
            try:
                citation = json.loads(citation_path.read_text(encoding="utf-8"))
            except Exception as exc:
                citation = {}
                errors.append(f"[CITATION_UPLOAD_INVALID] 引用分析 JSON 无法解析：{exc}")
            citation_meta = citation.get("meta", {}) if isinstance(citation.get("meta"), dict) else {}
            citation_validation = citation.get("validation", {}) if isinstance(citation.get("validation"), dict) else {}
            reconciliation = citation_validation.get("reconciliation", {}) if isinstance(citation_validation.get("reconciliation"), dict) else {}
            citation_summary = citation.get("summary", {}) if isinstance(citation.get("summary"), dict) else {}
            if citation_meta.get("data_source") != "uploaded_citation_analysis_spreadsheet":
                errors.append("[CITATION_UPLOAD_SOURCE] 引用分析数据源必须为 uploaded_citation_analysis_spreadsheet")
            if citation_meta.get("data_confirmation_status") != "confirmed":
                errors.append("[CITATION_UPLOAD_UNCONFIRMED] 上传引用分析数据未随导入自动确认（data_confirmation_status != confirmed）")
            if citation_validation.get("passed") is not True or reconciliation.get("passed") is not True:
                errors.append("[CITATION_UPLOAD_RECONCILIATION] 引用分析三层数据未通过对账")
            try:
                totals = [
                    int(reconciliation.get("media_citation_total")),
                    int(reconciliation.get("content_citation_total")),
                    int(reconciliation.get("question_record_count")),
                ]
            except (TypeError, ValueError):
                totals = []
            if len(totals) != 3 or totals[0] <= 0 or len(set(totals)) != 1:
                errors.append("[CITATION_UPLOAD_RECONCILIATION] 媒体、内容、问题明细三层总量不一致")
            elif int(citation_summary.get("total_citations") or 0) != totals[0]:
                errors.append("[CITATION_UPLOAD_RECONCILIATION] summary.total_citations 与三层对账不一致")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("source_file")) is None:
                errors.append("[CITATION_UPLOAD_SOURCE_MISSING] 引用分析源 XLSX 不存在")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("raw_extracted_file")) is None:
                errors.append("[CITATION_UPLOAD_RAW_MISSING] 引用分析原始提取 JSON 不存在")
    elif source_kind == "molizhishu_api":
        fetch_manifest_path = execution_dir / f"S5.0_{brand}_molizhishu_fetch_manifest.json"
        if not fetch_manifest_path.exists():
            errors.append("[MONITORING_API_FETCH_MANIFEST_MISSING] 缺少墨力指数取数 manifest")
        else:
            try:
                fetch_manifest = json.loads(fetch_manifest_path.read_text(encoding="utf-8"))
            except Exception as exc:
                fetch_manifest = {}
                errors.append(f"[MONITORING_API_FETCH_MANIFEST_INVALID] 取数 manifest 无法解析：{exc}")
            if fetch_manifest.get("data_origin") != "molizhishu_api":
                errors.append("[MONITORING_API_FETCH_MANIFEST_INVALID] 取数 manifest data_origin 必须为 molizhishu_api")
            if fetch_manifest.get("simulated") is not False:
                errors.append("[MONITORING_API_FETCH_MANIFEST_INVALID] 取数 manifest simulated 必须为 false")
    else:
        errors.append("[MONITORING_SOURCE_UNKNOWN] S5.0 必须声明 monitoring_data_source=uploaded_spreadsheet 或 molizhishu_api")
    if meta.get("data_confirmation_status") != "confirmed":
        errors.append("[MONITORING_UPLOAD_UNCONFIRMED] AI 问答监控表未随导入自动确认（data_confirmation_status != confirmed）")

    platforms = [str(p).lower() for p in (meta.get("platforms") or [])]
    if not platforms:
        errors.append("[MONITORING_SCOPE] 监控平台集合不能为空")
    repeat = int(meta.get("repeat_per_question_platform") or 0)
    if repeat != DEFAULT_MONITORING_REPEAT:
        errors.append(f"[MONITORING_SCOPE] 每平台每问题必须为 {DEFAULT_MONITORING_REPEAT} 次，当前 repeat={repeat}")
    expected = int(summary.get("expected_records") or 0)
    successful = int(summary.get("successful_records") or 0)
    partial_accepted = monitoring_partial_accepted(data)
    dynamic_expected = 2 * len(platforms) * repeat
    if expected != dynamic_expected:
        errors.append(f"[MONITORING_SCOPE] expected_records 应按问题数×平台数×重复次数计算为 {dynamic_expected}，当前为 {expected}")
    if not expected or len(records) != expected:
        errors.append(f"[MONITORING_INCOMPLETE] 监控记录未完整成功：records={len(records)}, successful={successful}, expected={expected}")
    if successful <= 0:
        errors.append("[MONITORING_INCOMPLETE] 监控数据没有任何成功答案")
    elif expected and successful != expected and not partial_accepted:
        errors.append(f"[MONITORING_INCOMPLETE] 监控成功记录不足：successful={successful}, expected={expected}")
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(description="Check and auto-link upstream files for S10 rendering.")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--work-dir", required=True)
    args = parser.parse_args()

    work_dir = Path(args.work_dir)
    brand = args.brand
    if not work_dir.exists():
        print(f"Error: Work directory {work_dir} does not exist.")
        return 1

    expected_files = {
        f"S1_{brand}_品牌事实图谱.json": [f"**/S1_*品牌事实*.json", f"**/S1_*事实图谱*.json", f"**/S1_*品牌资产*.json", f"**/S1_*知识库*.json", f"**/S1_*brand*facts*.json"],
        f"S1_{brand}_品牌知识库.md": [f"**/S1_*品牌知识*.md", f"**/S1_*知识库*.md", f"**/S1_*品牌资产*.md", f"**/S1_*brand*knowledge*.md"],
        f"S2_{brand}_营销图谱.json": [f"**/S2_*营销图谱*.json", f"**/S2_*营销*.json", f"**/S2_*用户意图*.json", f"**/S2_*marketing*atlas*.json"],
        f"S2_{brand}_营销图谱报告.md": [f"**/S2_*营销图谱*.md", f"**/S2_*营销*.md", f"**/S2_*用户意图*.md", f"**/S2_*marketing*atlas*.md"],
        f"S3_{brand}_趋势打分卡.json": [f"**/S3_*趋势打分*.json", f"**/S3_*趋势*.json", f"**/S3_*trend*score*.json", f"**/S3_*scorecard*.json"],
        f"S3_{brand}_品类趋势报告.md": [f"**/S3_*品类趋势*.md", f"**/S3_*趋势报告*.md", f"**/S3_*趋势*.md", f"**/S3_*trend*.md"],
        f"S4_{brand}_定位声明.json": [f"**/S4_*定位声明*.json", f"**/S4_*定位*.json", f"**/S4_*positioning*statement*.json"],
        f"S4_{brand}_品牌定位声明.md": [f"**/S4_*品牌定位声明*.md", f"**/S4_*定位声明*.md", f"**/S4_*positioning*statement*.md"],
        f"S4_{brand}_定位分析报告.md": [f"**/S4_*定位分析*.md", f"**/S4_*品牌定位报告*.md", f"**/S4_*positioning*analysis*.md", f"**/S4_*positioning*.md"],
        f"S5_{brand}_品牌诊断数据.json": [f"**/S5_*品牌诊断数据*.json", f"**/S5_*诊断数据*.json", f"**/S5_*diagnosis*.json"],
        f"S5_{brand}_品牌诊断数据.md": [f"**/S5_*品牌诊断数据*.md", f"**/S5_*诊断报告*.md", f"**/S5_*诊断*.md", f"**/S5_*diagnosis*.md"],
        f"S5_{brand}_Gap报告.md": [f"**/S5_*Gap报告*.md", f"**/S5_*GAP报告*.md", f"**/S5_*缺口*.md", f"**/S5_*gap*.md"],
        f"S5.5_{brand}_语义资产评分卡.json": [f"**/S5.5_*语义资产评分*.json", f"**/S5.5_*评分卡*.json", f"**/S5.5_*语义*.json", f"**/S5.5_*bsas*.json"],
        f"S5.5_{brand}_语义资产审计报告.md": [f"**/S5.5_*语义资产审计*.md", f"**/S5.5_*语义资产*.md", f"**/S5.5_*语义*.md", f"**/S5.5_*bsas*.md"],
        f"S6_{brand}_话语token.json": [f"**/S6_*话语token*.json", f"**/S6_*话语*.json", f"**/S6_*verbal*token*.json"],
        f"S6_{brand}_话语手册.md": [f"**/S6_*话语手册*.md", f"**/S6_*话语*.md", f"**/S6_*verbal*.md"],
        f"S7_{brand}_视觉Prompt包.json": [f"**/S7_*视觉Prompt*.json", f"**/S7_*Prompt包*.json", f"**/S7_*视觉*.json", f"**/S7_*visual*prompt*.json"],
        f"S7_{brand}_视觉符号体系报告.md": [f"**/S7_*视觉符号*.md", f"**/S7_*视觉体系*.md", f"**/S7_*视觉*.md", f"**/S7_*visual*.md"],
        f"S8_{brand}_问答树.json": [f"**/S8_*问答树*.json", f"**/S8_*qa_tree*.json"],
        f"S8_{brand}_问答矩阵.json": [f"**/S8_*问答矩阵*.json", f"**/S8_*qa_matrix*.json"],
        f"S8_{brand}_内容日历.json": [f"**/S8_*内容日历*.json", f"**/S8_*content_calendar*.json", f"**/S8_*calendar*.json"],
        f"S8_{brand}_落地页蓝图.md": [f"**/S8_*落地页蓝图*.md", f"**/S8_*落地页*.md", f"**/S8_*landing*.md"],
        f"S8_{brand}_问答报告.md": [f"**/S8_*问答报告*.md", f"**/S8_*问答*.md", f"**/S8_*qa*.md"],
        f"S9_{brand}_业务赋能建议包.md": [f"**/S9_*业务赋能建议*.md", f"**/S9_*赋能建议*.md", f"**/S9_*赋能*.md", f"**/S9_*建议包*.md", f"**/S9_*enablement*.md"],
        f"S9.8_{brand}_article_title_hooks.json": [f"**/S9.8_*article_title_hooks*.json", f"**/S9.8_*标题钩子*.json", f"**/S9.8_*title_hooks*.json", f"**/S9.8_*标题*.json"],
    }

    errors: list[str] = []
    errors.extend(validate_uploaded_monitoring_files(work_dir, brand))
    linked_count = 0
    print(f"Checking files for brand: {brand} in {work_dir}")
    for expected_name, fallback_patterns in expected_files.items():
        expected_path = work_dir / expected_name
        if not expected_path.exists():
            found = False
            for pattern in fallback_patterns:
                candidates = [p for p in work_dir.rglob(pattern) if p.is_file()]
                if candidates:
                    source_path = candidates[0]
                    try:
                        shutil.copy2(source_path, expected_path)
                        print(f"  [FIXED] Created {expected_name} from {source_path}")
                        linked_count += 1
                        found = True
                        break
                    except Exception as exc:
                        errors.append(f"[COPY_ERROR] {expected_name}: {exc}")
            if not found:
                errors.append(f"[MISSING] {expected_name}")
                continue
        file_errors = validate_file(expected_path, expected_name)
        if file_errors:
            errors.extend(file_errors)
            print(f"  [BAD] {expected_name}")
        else:
            print(f"  [OK] {expected_name}")

    print(f"\nSummary: {linked_count} files auto-fixed, {len(errors)} blocking issues.")
    if errors:
        print("\n[BLOCKED] S10 pre-render source gate failed:")
        for err in errors:
            print("  - " + err)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
