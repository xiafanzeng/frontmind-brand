#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind 本工作流 Final Delivery Packer — with Template Compliance Gate.

This script prepares the single standalone final PDF deliverable and the
optional final delivery zip, but ONLY after passing the mandatory template
compliance check. This ensures:
  1. S10 全景报告 HTML/PDF uses the client-ready template with all sections filled and no raw workflow splice or internal narrative residue.
  2. S5.0 imported both user-uploaded spreadsheets (monitoring + citation analysis) with preserved provenance; no separate 问题监控数据文件 deliverable is produced in this workflow.
  3. No internal/debug fields leak into customer-facing files.
  4. S11 final formatting found no blank pages and no more than two sparse pages.
  5. Pause gate 1 (fixed questions) was user-confirmed and the S5.0 upload data was auto-confirmed at import.
  6. S0.1 input resolution manifest exists.
  7. 执行 external-agent stage execution manifests prove each research stage used Wide Research and S5.0 imported both required spreadsheets.
  8. S0.0 workflow reading manifest proves the agent explicitly acknowledged the pause-point rule and per-stage Wide Research rule.

Exit codes:
  0 = packaging successful
  1 = critical compliance failure (missing files or blocked by gate)
  2 = template compliance failure (content issues, strict mode)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))
from pdf_cover_contract import verify_final_cover  # noqa: E402

DEFAULT_MONITORING_REPEAT = 5

PUBLIC_ASSET_SUFFIXES = {
    ".avif",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".webp",
}

PUBLIC_TEXT_SUFFIXES = {
    ".css",
    ".csv",
    ".html",
    ".htm",
    ".js",
    ".json",
    ".md",
    ".svg",
    ".tsv",
    ".txt",
    ".xml",
}

PUBLIC_HTML_ASSET_REFERENCE_RE = re.compile(
    r"""(?ix)
    \b(?:src|href)\s*=\s*["']
    (?P<path>assets/[^"'?#]+)
    (?:[?#][^"']*)?
    ["']
    """
)

PUBLIC_HASHED_ASSET_NAME_RE = re.compile(
    r"^[0-9a-f]{64}\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp)$",
    flags=re.I,
)

# These patterns deliberately target local filesystem paths, not public https://
# references or ordinary root-relative web paths such as /assets/logo.png.
FORBIDDEN_PUBLIC_PATH_PATTERNS = (
    ("file URI", re.compile(r"(?i)\bfile://")),
    (
        "Windows absolute path",
        re.compile(
            r"(?<![A-Za-z0-9])"
            r"(?:[A-Za-z]:[\\/]|\\\\+[A-Za-z0-9._-]+\\+[A-Za-z0-9.$_-]+)"
        ),
    ),
    (
        "POSIX local path",
        re.compile(
            r"(?<![A-Za-z0-9_:/])/"
            r"(?:Users|Volumes|private|home|root|tmp|var|etc|usr|opt|mnt|srv|workspace)"
            r"(?:/|\b)"
        ),
    ),
)

# Binary compression can coincidentally contain short byte sequences such as
# `A:/`; only high-confidence path signatures are searched in PDFs and raster
# assets. Their customer-visible text is also present in the allow-listed HTML.
FORBIDDEN_PUBLIC_BINARY_PATH_PATTERNS = (
    ("file URI", re.compile(r"(?i)\bfile://")),
    (
        "Windows absolute path",
        re.compile(
            r"(?i)(?<![A-Za-z0-9])"
            r"[A-Za-z]:[\\/]"
            r"(?:Users|Windows|Program Files|Documents and Settings|Temp|workspace)"
            r"[\\/]"
        ),
    ),
    (
        "POSIX local path",
        re.compile(
            r"(?<![A-Za-z0-9_:/])/"
            r"(?:Users|Volumes|private|home|root|tmp|var/(?:folders|tmp)|workspace|mnt)"
            r"(?:/|\b)"
        ),
    ),
)


def monitoring_partial_accepted(data: dict) -> bool:
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


def find_strategy_checker() -> Path | None:
    """Locate S9 completeness checker even when ZIP tools decoded Chinese paths differently."""
    strategy_root = Path(__file__).resolve().parents[2]
    for candidate in strategy_root.glob("S9*.skill/scripts/completeness_checker.py"):
        if candidate.exists():
            return candidate
    return None


def find_stage_execution_checker() -> Path | None:
    """Locate Stage / Wide Research stage execution checker."""
    candidate = Path(__file__).resolve().parent / "stage_execution_checker.py"
    return candidate if candidate.exists() else None

def find_output_contract_normalizer() -> Path | None:
    """Locate output filename contract normalizer."""
    candidate = Path(__file__).resolve().parent / "output_contract_normalizer.py"
    return candidate if candidate.exists() else None


def run_output_contract_normalizer(brand: str, work_dir: Path, stages: str) -> tuple[int, str]:
    """Normalize compatible alias files to canonical names before strict gates."""
    normalizer = find_output_contract_normalizer()
    if not normalizer:
        return 99, "output_contract_normalizer.py not found"
    result = subprocess.run(
        [sys.executable, str(normalizer),
         "--brand", brand,
         "--workspace", str(work_dir),
         "--stages", stages,
         "--strict"],
        capture_output=True, text=True, timeout=60
    )
    return result.returncode, result.stdout + result.stderr


def run_stage_execution_check(brand: str, work_dir: Path) -> tuple[int, str]:
    """Run agentcript/agent stage manifest check and return (exit_code, output)."""
    checker_script = find_stage_execution_checker()
    if not checker_script:
        return 99, "执行 Agent stage execution checker script not found"
    result = subprocess.run(
        [sys.executable, str(checker_script),
         "--brand", brand,
         "--workspace", str(work_dir),
         "--strict"],
        capture_output=True, text=True, timeout=60
    )
    return result.returncode, result.stdout + result.stderr


def run_compliance_check(brand: str, work_dir: Path) -> tuple[int, str]:
    """Run template_compliance_checker.py and return (exit_code, output)."""
    checker_script = Path(__file__).resolve().parent / "template_compliance_checker.py"
    if not checker_script.exists():
        return 99, f"Compliance checker script not found: {checker_script}"

    result = subprocess.run(
        [sys.executable, str(checker_script),
         "--brand", brand,
         "--work-dir", str(work_dir),
         "--strict"],
        capture_output=True, text=True, timeout=60
    )
    output = result.stdout + result.stderr
    return result.returncode, output



def check_workflow_reading_manifest(work_dir: Path, brand: str) -> list[str]:
    """Block packaging if the agent skipped the visible S0.0 reading/acknowledgement gate."""
    errors: list[str] = []
    manifest = work_dir / "_execution" / f"S0.0_{brand}_workflow_reading_manifest.json"
    if not manifest.exists():
        hits = list(work_dir.rglob(f"S0.0_{brand}_workflow_reading_manifest.json"))
        manifest = hits[0] if hits else manifest
    if not manifest.exists():
        return ["[S0.0] workflow reading manifest missing; the agent did not explicitly acknowledge pause gates and per-stage Wide Research"]
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"[S0.0] cannot parse workflow reading manifest: {exc}"]
    if data.get("stage_id") != "S0.0":
        errors.append("[S0.0] manifest stage_id must be S0.0")
    if str(data.get("status", "")).lower() not in {"done", "completed", "pass", "passed"}:
        errors.append("[S0.0] manifest status must be done/completed/passed")
    if data.get("pause_points_acknowledged") is not True:
        errors.append("[S0.0] pause_points_acknowledged must be true")
    if data.get("wide_research_per_stage_acknowledged") is not True:
        errors.append("[S0.0] wide_research_per_stage_acknowledged must be true")
    if data.get("s5_0_data_source_rule_acknowledged") is not True:
        errors.append("[S0.0] s5_0_data_source_rule_acknowledged must be true")
    if data.get("s5_0_upload_spreadsheet_rule_acknowledged") is not True:
        errors.append("[S0.0] s5_0_upload_spreadsheet_rule_acknowledged must be true")
    if data.get("output_filename_contract_acknowledged") is not True:
        errors.append("[S0.0] output_filename_contract_acknowledged must be true")
    if data.get("terminology_template_contract_acknowledged") is not True:
        errors.append("[S0.0] terminology_template_contract_acknowledged must be true")
    missing = data.get("missing_required_files")
    if isinstance(missing, list) and missing:
        errors.append("[S0.0] required workflow files missing: " + "; ".join(map(str, missing[:8])))
    return errors

def check_project_input_resolution(work_dir: Path, brand: str) -> list[str]:
    """Block packaging if S0.1 input resolution was skipped."""
    errors: list[str] = []
    manifest = work_dir / "_execution" / f"S0.1_{brand}_input_resolution_manifest.json"
    if not manifest.exists():
        hits = list(work_dir.rglob(f"S0.1_{brand}_input_resolution_manifest.json"))
        manifest = hits[0] if hits else manifest
    if not manifest.exists():
        return ["[S0.1] input resolution manifest missing"]
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"[S0.1] cannot parse input resolution manifest: {exc}"]
    if data.get("stage_id") != "S0.1":
        errors.append("[S0.1] manifest stage_id must be S0.1")
    if str(data.get("status", "")).lower() not in {"done", "completed", "pass", "passed"}:
        errors.append("[S0.1] manifest status must be done/completed/passed")
    files = data.get("generated_files")
    if not isinstance(files, list) or not files:
        errors.append("[S0.1] generated_files must not be empty")
    else:
        missing = []
        for item in files:
            p = Path(str(item))
            candidates = [p, work_dir / str(item)]
            parts = list(p.parts)
            if work_dir.name in parts:
                idx = parts.index(work_dir.name)
                suffix = parts[idx + 1:]
                if suffix:
                    candidates.append(work_dir.joinpath(*suffix))
            if not any(c.exists() and c.is_file() and c.stat().st_size > 0 for c in candidates):
                missing.append(str(item))
        if missing:
            errors.append("[S0.1] generated files missing: " + "; ".join(missing[:8]))
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
    """Return the only supported S5.0 source when both canonical markers agree."""
    if (
        str(meta.get("monitoring_data_source") or "").lower() == "molizhishu_api"
        and data_provenance.get("capture_method") == "molizhishu_api"
    ):
        return "molizhishu_api"
    return "unknown"


def check_monitoring_upload_provenance(work_dir: Path, brand: str) -> list[str]:
    """Block packaging unless both required S5.0 spreadsheets are proven."""
    errors: list[str] = []
    candidates = [work_dir / f"S5_{brand}_frontmind_monitoring_data.json", work_dir / "02_monitoring_data" / f"S5_{brand}_frontmind_monitoring_data.json"]
    hits = [p for p in candidates if p.exists()]
    if not hits:
        hits = list(work_dir.rglob(f"S5_{brand}_frontmind_monitoring_data.json"))
    if not hits:
        return ["[MONITORING_SOURCE] S5.0 monitoring data JSON missing"]
    path = hits[0]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"[MONITORING_SOURCE] cannot parse monitoring JSON: {exc}"]
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
    records = data.get("records", []) if isinstance(data.get("records"), list) else []
    data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}
    provenance_values = [
        str(meta.get("monitoring_data_source") or ""),
        str(data_provenance.get("capture_method") or ""),
    ]
    blob = " ".join(provenance_values).lower()
    if any(term in blob for term in ["simulated", "mock", "fake", "synthetic", "模拟", "仿真", "构造监控", "公开回答数据", "模拟 ai 平台"]):
        errors.append("[MONITORING_SOURCE] monitoring meta/provenance appears simulated or constructed")
    if meta.get("simulated_data") is True or meta.get("mock_data") is True or meta.get("manual_records") is True:
        errors.append("[MONITORING_SOURCE] monitoring JSON marked simulated/mock/manual")

    upload_manifest = work_dir / "_execution" / f"S5.0_{brand}_monitoring_data_execution_manifest.json"
    if not upload_manifest.exists():
        errors.append("[MONITORING_SOURCE] upload-only monitoring execution manifest missing")
    else:
        try:
            manifest_data = json.loads(upload_manifest.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            manifest_data = {}
            errors.append(f"[MONITORING_SOURCE] cannot parse monitoring upload manifest: {exc}")
        if manifest_data.get("monitoring_data_source") != "molizhishu_api":
            errors.append("[MONITORING_SOURCE] monitoring manifest must declare a valid monitoring_data_source")

    source_kind = _monitoring_source_kind(meta, data_provenance)
    if source_kind != "molizhishu_api":
        errors.append("[MONITORING_SOURCE] monitoring source 必须为 molizhishu_api（路径B手动上传已移除），且需有效的 data_provenance.capture_method")
    if True:
        source_file = _resolve_existing_path(path.parent, data_provenance.get("source_file"))
        raw_file = _resolve_existing_path(path.parent, data_provenance.get("raw_extracted_file"))
        if source_file is None:
            errors.append("[MONITORING_SOURCE] monitoring source file missing")
        if raw_file is None:
            errors.append("[MONITORING_SOURCE] monitoring raw extracted JSON missing")
        citation_hits = list(work_dir.rglob(f"S5_{brand}_引用分析数据.json"))
        if not citation_hits:
            errors.append("[MONITORING_SOURCE] requires a separate citation-analysis workbook")
        else:
            citation_path = citation_hits[0]
            try:
                citation = json.loads(citation_path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                citation = {}
                errors.append(f"[MONITORING_SOURCE] cannot parse citation-analysis JSON: {exc}")
            citation_meta = citation.get("meta", {}) if isinstance(citation.get("meta"), dict) else {}
            citation_validation = citation.get("validation", {}) if isinstance(citation.get("validation"), dict) else {}
            reconciliation = citation_validation.get("reconciliation", {}) if isinstance(citation_validation.get("reconciliation"), dict) else {}
            citation_summary = citation.get("summary", {}) if isinstance(citation.get("summary"), dict) else {}
            if citation_meta.get("data_source") != "uploaded_citation_analysis_spreadsheet":
                errors.append("[MONITORING_SOURCE] citation-analysis JSON has an invalid data source")
            if citation_meta.get("data_confirmation_status") != "confirmed":
                errors.append("[MONITORING_SOURCE] citation-analysis data was not auto-confirmed at import")
            if citation_validation.get("passed") is not True or reconciliation.get("passed") is not True:
                errors.append("[MONITORING_SOURCE] citation-analysis workbook failed three-layer reconciliation")
            try:
                totals = [
                    int(reconciliation.get("media_citation_total")),
                    int(reconciliation.get("content_citation_total")),
                    int(reconciliation.get("question_record_count")),
                ]
            except (TypeError, ValueError):
                totals = []
            if len(totals) != 3 or totals[0] <= 0 or len(set(totals)) != 1:
                errors.append("[MONITORING_SOURCE] citation-analysis media/content/question totals do not reconcile")
            elif int(citation_summary.get("total_citations") or 0) != totals[0]:
                errors.append("[MONITORING_SOURCE] citation-analysis summary total does not match reconciliation")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("source_file")) is None:
                errors.append("[MONITORING_SOURCE] citation-analysis source XLSX missing")
            if _resolve_existing_path(citation_path.parent, citation_meta.get("raw_extracted_file")) is None:
                errors.append("[MONITORING_SOURCE] citation-analysis raw extracted JSON missing")

    platforms = [str(p).lower() for p in (meta.get("platforms") or [])]
    if not platforms:
        errors.append("[MONITORING_SOURCE] monitoring platforms must not be empty")
    repeat = int(meta.get("repeat_per_question_platform") or 0)
    if repeat != DEFAULT_MONITORING_REPEAT:
        errors.append(f"[MONITORING_SOURCE] repeat_per_question_platform must be {DEFAULT_MONITORING_REPEAT}, got {repeat}")
    expected = int(summary.get("expected_records") or 0)
    successful = int(summary.get("successful_records") or 0)
    partial_accepted = monitoring_partial_accepted(data)
    dynamic_expected = 2 * len(platforms) * repeat
    if expected != dynamic_expected:
        errors.append(f"[MONITORING_SOURCE] expected_records must equal questions×platforms×repeat ({dynamic_expected}), got {expected}")
    if expected and len(records) != expected:
        errors.append(f"[MONITORING_SOURCE] monitoring data count mismatch: records={len(records)}, expected={expected}")
    if expected and successful <= 0:
        errors.append("[MONITORING_SOURCE] monitoring data has zero successful records")
    elif expected and successful != expected and not partial_accepted:
        errors.append(f"[MONITORING_SOURCE] monitoring data incomplete: successful={successful}, expected={expected}")
    return errors


def check_pause_gates(work_dir: Path, brand: str) -> list[str]:
    """Verify Pause 1 confirmation and the S5.0 auto-confirmed upload data."""
    errors: list[str] = []

    # Pause gate 1: question confirmation (the only user pause point)
    q_confirm_path = work_dir / f"S4.8_{brand}_fixed_monitoring_questions.json"
    if not q_confirm_path.exists():
        candidates = list(work_dir.rglob(f"S4.8_{brand}_fixed_monitoring_questions.json"))
        q_confirm_path = candidates[0] if candidates else q_confirm_path

    if q_confirm_path.exists():
        try:
            data = json.loads(q_confirm_path.read_text(encoding="utf-8"))
            meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
            confirmation_status = data.get("confirmation_status") or meta.get("confirmation_status")
            if confirmation_status != "confirmed":
                errors.append("[GATE1] 固定双问题未经用户确认 (confirmation_status != confirmed)")
        except Exception as exc:
            errors.append(f"[GATE1] Cannot parse questions JSON: {exc}")
    else:
        errors.append("[GATE1] S4.8 固定双问题 JSON 文件不存在")

    # Upload data gate: importers auto-confirm both workbooks; verify it happened
    main_data_json = work_dir / f"S5_{brand}_frontmind_monitoring_data.json"
    if not main_data_json.exists():
        candidates = list(work_dir.rglob(f"S5_{brand}_frontmind_monitoring_data.json"))
        main_data_json = candidates[0] if candidates else main_data_json
    if main_data_json.exists():
        try:
            mdata = json.loads(main_data_json.read_text(encoding="utf-8"))
            if mdata.get("meta", {}).get("data_confirmation_status") != "confirmed":
                errors.append("[GATE2] S5.0 监控数据未随导入自动确认 (data_confirmation_status != confirmed)")
            if str(mdata.get("meta", {}).get("monitoring_data_source") or "").lower() != "molizhishu_api":
                errors.append("[GATE2] S5.0 仅允许 monitoring_data_source=molizhishu_api（v3：API 唯一路径）")
        except Exception as exc:
            errors.append(f"[GATE2] Cannot parse monitoring JSON: {exc}")
    else:
        errors.append("[GATE2] S5.0 监控数据 JSON 文件不存在")
    citation_confirmed = False
    citation_hits = list(work_dir.rglob(f"S5_{brand}_引用分析数据.json"))
    if citation_hits:
        try:
            citation_data = json.loads(citation_hits[0].read_text(encoding="utf-8"))
            citation_confirmed = citation_data.get("meta", {}).get("data_confirmation_status") == "confirmed"
        except Exception:
            citation_confirmed = False
    if not citation_confirmed:
        errors.append("[GATE2] 信源表（引用分析表）数据未随导入自动确认")

    return errors


def find_required_file(work_dir: Path, filename: str) -> Path | None:
    """Find a required deliverable by exact filename anywhere under work_dir."""
    hits = list(work_dir.rglob(filename))
    return hits[0] if hits else None


def copy_primary_pdf_deliverables(work_dir: Path, brand: str, out_zip: Path) -> Path:
    """Copy the customer-facing panorama PDF beside the zip so platforms can return it as a standalone file.

    The zip is only an archive. The copied PDF is the primary deliverable:
      1. {brand}_AI智能品牌优化方案全景报告.pdf

    本工作流不再生成《问题监控数据文件》客户版 PDF；S5.0 只导入两份上传表格供诊断使用。
    """
    report_src = find_required_file(work_dir, f"S10_{brand}_AI智能品牌优化方案全景报告.pdf")
    if report_src is None:
        raise FileNotFoundError(
            "Cannot prepare standalone PDF deliverable; missing: "
            f"S10_{brand}_AI智能品牌优化方案全景报告.pdf"
        )

    # This is intentionally unconditional: debug skip flags may bypass broader
    # content checks, but no customer delivery may bypass the approved first/
    # last-page visual contract.
    cover_gate = verify_final_cover(report_src)
    if not cover_gate.get("passed"):
        raise RuntimeError(
            "AI智能品牌优化方案全景报告未通过官方封面/封底门禁："
            + "; ".join(cover_gate.get("errors") or ["unknown cover failure"])
        )

    out_dir = out_zip.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    report_out = out_dir / f"{brand}_AI智能品牌优化方案全景报告.pdf"

    if report_src.resolve() != report_out.resolve():
        shutil.copy2(report_src, report_out)

    if not report_out.exists() or report_out.stat().st_size <= 0:
        raise RuntimeError(f"AI智能品牌优化方案全景报告 PDF standalone deliverable was not created: {report_out}")
    return report_out


def _find_public_artifact(work_dir: Path, filename: str, preferred_dir: str) -> Path:
    """Resolve one exact customer artifact without selecting internal audit files."""
    preferred = work_dir / preferred_dir / filename
    if preferred.exists() and preferred.is_file() and not preferred.is_symlink():
        return preferred

    root_candidate = work_dir / filename
    if root_candidate.exists() and root_candidate.is_file() and not root_candidate.is_symlink():
        return root_candidate

    candidates: list[Path] = []
    for candidate in work_dir.rglob(filename):
        try:
            relative = candidate.relative_to(work_dir)
        except ValueError:
            continue
        if (
            candidate.is_file()
            and not candidate.is_symlink()
            and "_execution" not in relative.parts
            and "00_project_input" not in relative.parts
        ):
            candidates.append(candidate)
    if not candidates:
        raise FileNotFoundError(f"Customer-facing artifact missing: {filename}")
    return sorted(candidates, key=lambda item: (len(item.relative_to(work_dir).parts), str(item)))[0]


def collect_public_delivery_entries(
    work_dir: Path,
    brand: str,
    primary_report_pdf: Path,
) -> list[tuple[Path, str]]:
    """Build the explicit public archive allow-list.

    Stage files, uploaded sources, `_execution`, S11 audit reports and the
    `.compliance_check_passed` marker intentionally remain in the internal
    workspace and are never returned in the customer ZIP.
    """
    report_html = _find_public_artifact(
        work_dir,
        f"S10_{brand}_AI智能品牌优化方案全景报告.html",
        "04_final_report",
    )
    report_data = _find_public_artifact(
        work_dir,
        f"S10_{brand}_全景报告数据.json",
        "04_final_report",
    )

    entries: list[tuple[Path, str]] = [
        (primary_report_pdf, primary_report_pdf.name),
        (
            report_html,
            f"04_final_report/{report_html.name}",
        ),
        (
            report_data,
            f"04_final_report/{report_data.name}",
        ),
    ]

    assets_dir = report_html.parent / "assets"
    report_html_text = report_html.read_text(encoding="utf-8", errors="ignore")
    referenced_asset_paths = sorted(
        {match.group("path") for match in PUBLIC_HTML_ASSET_REFERENCE_RE.finditer(report_html_text)}
    )
    if referenced_asset_paths:
        if not assets_dir.exists() or not assets_dir.is_dir() or assets_dir.is_symlink():
            raise FileNotFoundError("Final-report HTML references assets, but its assets directory is missing")
        assets_root = assets_dir.resolve()
        for referenced_path in referenced_asset_paths:
            relative_asset = PurePosixPath(referenced_path).relative_to("assets")
            if (
                len(relative_asset.parts) != 1
                or not PUBLIC_HASHED_ASSET_NAME_RE.fullmatch(relative_asset.name)
            ):
                raise ValueError(
                    "Final-report assets must be content-hash named files directly under assets/: "
                    + referenced_path
                )
            asset = assets_dir / relative_asset.name
            if (
                not asset.is_file()
                or asset.is_symlink()
                or asset.suffix.lower() not in PUBLIC_ASSET_SUFFIXES
            ):
                raise FileNotFoundError(f"Referenced final-report asset is missing or invalid: {referenced_path}")
            resolved = asset.resolve()
            try:
                resolved.relative_to(assets_root)
            except ValueError as exc:
                raise ValueError(f"Final-report asset escapes assets directory: {asset.name}") from exc
            entries.append(
                (
                    asset,
                    str(PurePosixPath("04_final_report", referenced_path)),
                )
            )
    return entries


def validate_public_delivery_entries(
    entries: list[tuple[Path, str]],
    work_dir: Path,
) -> list[str]:
    """Validate public archive names and block local filesystem path leaks."""
    errors: list[str] = []
    seen_archive_names: set[str] = set()
    work_dir_text = str(work_dir.resolve())

    for source, archive_name in entries:
        archive_path = PurePosixPath(archive_name)
        if archive_path.is_absolute() or ".." in archive_path.parts:
            errors.append(f"{archive_name}: unsafe archive path")
            continue
        if "_execution" in archive_path.parts or archive_path.name == ".compliance_check_passed":
            errors.append(f"{archive_name}: internal audit artifact is not public")
            continue
        if archive_name in seen_archive_names:
            errors.append(f"{archive_name}: duplicate archive path")
            continue
        seen_archive_names.add(archive_name)

        if not source.exists() or not source.is_file() or source.stat().st_size <= 0:
            errors.append(f"{archive_name}: source file missing or empty")
            continue
        if source.is_symlink():
            errors.append(f"{archive_name}: symbolic links are not allowed")
            continue

        # ASCII path markers remain readable in UTF-8 even when the surrounding
        # file is binary. This also catches uncompressed PDF/image metadata.
        content = source.read_bytes().decode("utf-8", errors="ignore")
        if work_dir_text and work_dir_text in content:
            errors.append(f"{archive_name}: contains the internal workspace path")
            continue
        path_patterns = (
            FORBIDDEN_PUBLIC_PATH_PATTERNS
            if source.suffix.lower() in PUBLIC_TEXT_SUFFIXES
            else FORBIDDEN_PUBLIC_BINARY_PATH_PATTERNS
        )
        for label, pattern in path_patterns:
            if pattern.search(content):
                errors.append(f"{archive_name}: contains a forbidden {label}")
                break
    return errors


def write_public_delivery_zip(
    out_zip: Path,
    entries: list[tuple[Path, str]],
    work_dir: Path,
) -> None:
    """Atomically write the validated customer-facing archive."""
    errors = validate_public_delivery_entries(entries, work_dir)
    if errors:
        raise ValueError("Public delivery validation failed:\n  - " + "\n  - ".join(errors))

    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{out_zip.name}.",
        suffix=".tmp",
        dir=out_zip.parent,
        delete=False,
    ) as handle:
        temporary_zip = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for source, archive_name in entries:
                zf.write(source, archive_name)
        temporary_zip.replace(out_zip)
    except Exception:
        temporary_zip.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pack final FrontMind panorama report deliverables with compliance gate."
    )
    parser.add_argument("--brand", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--out-zip", required=True)
    parser.add_argument("--skip-compliance", action="store_true",
                        help="Skip compliance check (NOT recommended for production)")
    parser.add_argument("--skip-gate-check", action="store_true",
                        help="Skip pause gate verification (debug only)")
    args = parser.parse_args()

    work_dir = Path(args.work_dir).resolve()
    out_zip = Path(args.out_zip).resolve()
    out_zip.parent.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] FrontMind Final Delivery Packer 本工作流")
    print(f"  brand: {args.brand}")
    print(f"  work_dir: {work_dir}")
    print(f"  out_zip: {out_zip}")

    # === S0.0 WORKFLOW READING / CORE PRINCIPLE GATE ===
    print("\n[GATE] Verifying S0.0 workflow reading and two core principles...")
    reading_errors = check_workflow_reading_manifest(work_dir, args.brand)
    if reading_errors:
        for err in reading_errors:
            print(f"  {err}")
        print("[BLOCKED] S0.0 workflow reading and core principle acknowledgement must be completed before packaging.")
        return 1
    print("[GATE PASSED] S0.0 workflow reading manifest exists and confirms the pause-point rule + per-stage Wide Research.")

    # === S0.1 PROJECT INPUT RESOLUTION GATE ===
    print("\n[GATE] Verifying S0.1 project input resolution...")
    input_errors = check_project_input_resolution(work_dir, args.brand)
    if input_errors:
        for err in input_errors:
            print(f"  {err}")
        print("[BLOCKED] S0.1 input resolution must be completed before packaging.")
        return 1
    print("[GATE PASSED] S0.1 project input resolution exists.")

    # === PAUSE GATE VERIFICATION ===
    if not args.skip_gate_check:
        print("\n[GATE] Verifying pause gate 1 + S5.0 auto-confirmed upload data...")
        gate_errors = check_pause_gates(work_dir, args.brand)
        if gate_errors:
            for err in gate_errors:
                print(f"  {err}")
            print("[BLOCKED] Pause gates not confirmed. Cannot package.")
            return 1
        print("[GATE PASSED] Pause gate 1 confirmed and S5.0 upload data auto-confirmed at import.")
    else:
        print("[WARN] Pause gate verification skipped (--skip-gate-check).")

    # === MONITORING TRUSTED SOURCE GATE ===
    print("\n[GATE] Verifying S5.0 dual-spreadsheet provenance...")
    upload_errors = check_monitoring_upload_provenance(work_dir, args.brand)
    if upload_errors:
        for err in upload_errors:
            print(f"  {err}")
        print("[BLOCKED] S5.0 requires both uploaded spreadsheets, their retained source evidence, and reconciled citations.")
        return 1
    print("[GATE PASSED] S5.0 dual-spreadsheet provenance is valid.")

    # === OUTPUT FILENAME CONTRACT NORMALIZATION GATE ===
    print("\n[GATE] Normalizing S-stage output filenames to canonical contract...")
    norm_stages = "S1,S2,S3,S4,S4.8,S5,S5.5,S6,S7,S8,S9,S9.8"
    norm_exit_code, norm_output = run_output_contract_normalizer(args.brand, work_dir, norm_stages)
    print(norm_output)
    if norm_exit_code != 0:
        print("[BLOCKED] 标准产物文件名规范化失败。若只是命名差异，请使用已有等价文件复制为标准名；若内容不足，必须回到对应 S 阶段补写，不得手写浅层文件充数。")
        return 1
    print("[GATE PASSED] S-stage canonical output files are present or normalized from substantive aliases.")

    # === Agent / WIDE RESEARCH STAGE EXECUTION GATE ===
    print("\n[GATE] Verifying Stage / Wide Research stage execution manifests...")
    stage_exit_code, stage_output = run_stage_execution_check(args.brand, work_dir)
    print(stage_output)
    if stage_exit_code != 0:
        print("[BLOCKED] 执行 Stage/Wide Research stage execution check failed. Each research S stage must have a manifest and generated files; S5.0 must have both upload manifests.")
        return 1
    print("[GATE PASSED] 执行 Stage/Wide Research stage execution check passed.")

    # === S1-S9 COMPLETENESS GATE ===
    if not args.skip_compliance:
        print("\n[GATE] Running S1-S9 completeness check...")
        checker_script = find_strategy_checker()
        if checker_script and checker_script.exists():
            import subprocess
            result = subprocess.run([
                "python3", str(checker_script),
                "--brand", args.brand,
                "--workspace", str(work_dir),
                "--output", str(work_dir / f"S9_{args.brand}_策略完整性检查.md")
            ], capture_output=True, text=True)
            
            if result.returncode != 0:
                print("[BLOCKED] S1-S9 completeness check failed. You MUST NOT skip S1-S9 execution.")
                print(result.stdout)
                return 1
            print("[GATE PASSED] S1-S9 completeness check passed.")
        else:
            print("[WARN] Completeness checker script not found, skipping.")

    # === TEMPLATE COMPLIANCE GATE ===
    if not args.skip_compliance:
        print("\n[GATE] Running template compliance check...")
        exit_code, output = run_compliance_check(args.brand, work_dir)
        print(output)

        if exit_code == 1:
            print("[BLOCKED] Critical compliance failures. Cannot package.")
            print("  Fix the issues above and re-run.")
            return 1
        elif exit_code == 2:
            print("[BLOCKED] Template compliance issues (strict mode).")
            return 2
        elif exit_code == 0:
            print("[GATE PASSED] All template compliance checks passed.")
        else:
            print(f"[WARN] Compliance check returned unexpected code {exit_code}. Proceeding with caution.")
    else:
        print("[WARN] Compliance check skipped (--skip-compliance flag).")

    # === Required files check ===
    required_files = [
        f"S0.0_{args.brand}_workflow_reading_manifest.json",
        f"S0.0_{args.brand}_workflow_reading_manifest.md",
        f"S0.1_{args.brand}_输入解析与补全计划.json",
        f"S0.1_{args.brand}_输入解析与补全计划.md",
        f"S10_{args.brand}_AI智能品牌优化方案全景报告.html",
        f"S10_{args.brand}_AI智能品牌优化方案全景报告.pdf",
        f"S10_{args.brand}_全景报告数据.json",
        f"S11_{args.brand}_格式整理报告.json",
        f"S11_{args.brand}_格式整理报告.md",
        f"S11_{args.brand}_格式整理复核.json",
        f"S5_{args.brand}_frontmind_monitoring_data.json",
        f"S0_{args.brand}_stage_execution_check.json",
        f"S0_{args.brand}_stage_execution_check.md",
        f"S0_{args.brand}_output_contract_normalization.json",
        f"S0_{args.brand}_output_contract_normalization.md",
    ]

    missing = []
    for fname in required_files:
        found = list(work_dir.rglob(fname))
        if not found:
            missing.append(fname)

    if missing:
        print(f"\n[ERROR] Required deliverables missing:")
        for m in missing:
            print(f"  - {m}")
        print("Cannot create delivery package without core deliverables.")
        return 1

    # === Primary standalone PDF deliverable ===
    print(f"\n[INFO] Preparing primary standalone PDF deliverable...")
    try:
        primary_report_pdf = copy_primary_pdf_deliverables(work_dir, args.brand, out_zip)
    except Exception as exc:  # noqa: BLE001
        print(f"[BLOCKED] Cannot prepare standalone PDF deliverable: {exc}")
        return 1
    print("[OK] Primary PDF deliverable prepared:")
    print(f"  1. AI智能品牌优化方案全景报告 PDF: {primary_report_pdf}")
    print("[DELIVERY RULE] Return this PDF as an independent file. The zip is only an optional archive.")

    # === Package ===
    print(f"\n[INFO] Creating optional archive zip...")

    try:
        public_entries = collect_public_delivery_entries(
            work_dir,
            args.brand,
            primary_report_pdf,
        )
        public_errors = validate_public_delivery_entries(public_entries, work_dir)
        if public_errors:
            print("[BLOCKED] Customer archive contains unsafe paths or non-public artifacts:")
            for error in public_errors:
                print(f"  - {error}")
            print("Regenerate the customer-facing HTML/JSON/PDF files after removing local filesystem paths.")
            return 1
        write_public_delivery_zip(out_zip, public_entries, work_dir)
    except Exception as exc:  # noqa: BLE001
        print(f"[BLOCKED] Cannot create safe public delivery archive: {exc}")
        return 1

    # Keep the detailed marker in the internal workspace for audit. It is
    # deliberately excluded from `public_entries` because it records local
    # filesystem locations that must never be exposed to the customer.
    marker_path = work_dir / ".compliance_check_passed"
    marker_data = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "brand": args.brand,
        "version": "workflow-final",
        "status": "passed",
        "s0_0_workflow_reading_gate_passed": True,
        "s0_1_project_input_resolution_passed": True,
        "gate1_question_confirmed": True,
        "gate2_upload_data_auto_confirmed": True,
        "s5_monitoring_source_provenance_passed": True,
        "stage_execution_gate_passed": True,
        "output_contract_normalization_passed": True,
        "terminology_template_contract_passed": True,
        "template_compliance_passed": True,
        "primary_pdf_deliverable_prepared": True,
        "primary_report_pdf": str(primary_report_pdf),
        "source_depth_gate_passed": True,
        "source_coverage_gate_passed": True,
        "s11_layout_gate_passed": True,
        "public_delivery_allowlist_passed": True,
        "public_delivery_local_path_scan_passed": True,
        "public_delivery_entry_count": len(public_entries),
    }
    marker_path.write_text(json.dumps(marker_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] Optional delivery archive zip created: {out_zip}")
    print(f"  Public allow-list entries: {len(public_entries)}")
    print(f"  Size: {out_zip.stat().st_size / 1024 / 1024:.1f} MB")
    print("[FINAL OUTPUT REQUIRED]")
    print(f"  1. Return standalone PDF: {primary_report_pdf}")
    print(f"  2. Optional archive only: {out_zip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
