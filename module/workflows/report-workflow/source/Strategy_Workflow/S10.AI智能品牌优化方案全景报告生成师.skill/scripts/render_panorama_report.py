#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render S10 client-ready FrontMind panorama report.

本工作流 content-frontloaded edition uses the complete 本工作流 production workflow as the base and
absorbs the 本工作流 consulting-narrative rules: structure data first, rewrite into a
client-facing consulting story, show charts before raw tables, and block internal
workflow residue from final HTML/PDF.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))
from pdf_cover_contract import (  # noqa: E402
    official_cover_path,
    validate_official_cover,
    verify_final_cover,
)

try:
    import markdown  # type: ignore
except Exception:  # noqa: BLE001
    markdown = None


# ----------------------------- full-assembly gates -----------------------------
# 用户目标（修订）：最终《AI智能品牌优化方案全景报告》以“全文丰富组装模式”
# 完整承接 S1-S9.8 各阶段内容即可，**不再设任何字数 / 覆盖率 / 模块数硬门控**。
# 取消字数门的原因：硬性字数门会逼迫上游 Agent 为凑字数而反复扩写、填充
# “补充详细分析与执行细则”等无意义重复段落。现在的达标口径是：
#   1) Wide Research / 各 S 阶段已执行完成；
#   2) S1-S9.8 的核心产物已真实、完整地填入各自来源块；
#   3) 无中间产物残留、无占位符、无监控造假。
# 以下阈值全部设为 0（关闭门控），仅保留“结构存在性 + 防空壳 / 防灌水 / 防占位”
# 的非字数校验。相关实际数值仍会写入内部 JSON 仅作记录，不再用于阻断。
REQUIRED_SOURCE_COVERAGE = 0.0
REQUIRED_VISIBLE_TEXT_CHARS = 0
REQUIRED_CONTENT_MODULES = 0
REQUIRED_S8_QA_TREE_COVERAGE = 0.0
REQUIRED_S8_QA_MATRIX_COVERAGE = 0.0
REQUIRED_S8_CONTENT_CALENDAR_COVERAGE = 0.0
DEFAULT_MONITORING_REPEAT = 5


# ----------------------------- basic IO helpers -----------------------------

def read_text(path: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def load_json(path: Path | None) -> Any:
    if path is None or not path.exists() or path.stat().st_size == 0:
        return None
    try:
        return json.loads(read_text(path))
    except Exception:
        return None


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def e(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def find_file(work_dir: Path, pattern: str) -> Path | None:
    # 如果 pattern 包含 **，先尝试去掉 ** 前缀后作为简单文件名查找
    clean_pattern = pattern.lstrip('*').lstrip('/')
    if not clean_pattern:
        return None
    
    exact = work_dir / clean_pattern
    if exact.exists():
        return exact
    
    # 尝试在工作目录中用 glob 匹配（不用 rglob 避免 ** 问题）
    if ('*' in clean_pattern or '?' in clean_pattern) and '**' not in clean_pattern:
        candidates = list(work_dir.glob(clean_pattern))
        if candidates:
            return candidates[0]
    
    # 尝试模糊匹配前缀和后缀
    base_name = clean_pattern.split('/')[-1] if '/' in clean_pattern else clean_pattern
    parts = base_name.split('_', 2)
    if len(parts) >= 3 and parts[0].startswith('S') and '**' not in base_name:
        prefix = f"{parts[0]}_*"
        suffix = f"*_{parts[-1]}"
        fuzzy_pattern = f"{prefix}{suffix}"
        if '**' not in fuzzy_pattern:
            candidates = list(work_dir.glob(fuzzy_pattern))
            if candidates:
                return candidates[0]
    
    # 尝试在子目录中查找
    for sub in work_dir.iterdir():
        if sub.is_dir():
            if ('*' in base_name or '?' in base_name) and '**' not in base_name:
                candidates = list(sub.glob(base_name))
                if candidates:
                    return candidates[0]
            else:
                # 尝试用文件名匹配
                target = sub / base_name
                if target.exists():
                    return target
                for f in sub.rglob('*'):
                    if f.name == base_name:
                        return f
            
    return None


def find_first(work_dir: Path, patterns: list[str]) -> Path | None:
    for pat in patterns:
        p = find_file(work_dir, pat)
        if p:
            return p
    return None


# ----------------------------- PDF helpers ---------------------------------

def _configure_macos_weasyprint_libraries() -> None:
    """Let cffi resolve Homebrew Pango libraries when SIP hides DYLD paths."""
    if sys.platform != "darwin":
        return
    try:
        import cffi  # type: ignore
        if getattr(cffi.FFI, "_frontmind_homebrew_dlopen", False):
            return
        original_dlopen = cffi.FFI.dlopen
        library_dirs = [
            Path("/opt/homebrew/lib"),
            Path("/usr/local/lib"),
        ]

        def homebrew_dlopen(instance: Any, name: Any, *args: Any, **kwargs: Any) -> Any:
            try:
                return original_dlopen(instance, name, *args, **kwargs)
            except OSError:
                for directory in library_dirs:
                    candidate = directory / str(name)
                    if candidate.is_file():
                        return original_dlopen(instance, str(candidate), *args, **kwargs)
                raise

        cffi.FFI.dlopen = homebrew_dlopen
        setattr(cffi.FFI, "_frontmind_homebrew_dlopen", True)
    except Exception:
        return


def convert_html_to_pdf(html_path: Path, pdf_path: Path) -> tuple[bool, str]:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_target = pdf_path.resolve()
    try:
        _configure_macos_weasyprint_libraries()
        import weasyprint  # type: ignore
        weasyprint.HTML(filename=str(html_path.resolve())).write_pdf(str(pdf_target))
        return True, "weasyprint"
    except Exception as exc:  # noqa: BLE001
        last = f"weasyprint unavailable or failed: {exc}"
    wk = shutil.which("wkhtmltopdf")
    if wk:
        try:
            subprocess.run([wk, "--enable-local-file-access", str(html_path.resolve()), str(pdf_target)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return True, "wkhtmltopdf"
        except Exception as exc:  # noqa: BLE001
            last = f"wkhtmltopdf failed: {exc}"
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
        try:
            with tempfile.TemporaryDirectory(prefix="frontmind-chrome-") as chrome_profile:
                subprocess.run(
                    [
                        chrome, "--headless=new", "--disable-gpu", "--no-first-run",
                        "--no-default-browser-check", "--disable-background-networking",
                        "--allow-file-access-from-files", f"--user-data-dir={chrome_profile}",
                        "--print-to-pdf-no-header", f"--print-to-pdf={pdf_target}",
                        html_path.resolve().as_uri(),
                    ],
                    check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
                )
            if not pdf_target.exists() or pdf_target.stat().st_size == 0:
                raise RuntimeError("headless Chrome exited without producing a PDF")
            return True, "headless_chrome"
        except Exception as exc:  # noqa: BLE001
            last = f"headless chrome failed: {exc}"
    return False, last


def default_cover_pdf_path() -> Path:
    return official_cover_path()


def pdf_page_count(path: Path) -> int | None:
    try:
        from pypdf import PdfReader  # type: ignore
        return len(PdfReader(str(path)).pages)
    except Exception:  # noqa: BLE001
        pass
    try:
        import fitz  # type: ignore
        with fitz.open(str(path)) as doc:
            return int(doc.page_count)
    except Exception:  # noqa: BLE001
        pass
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        try:
            proc = subprocess.run([pdfinfo, str(path)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            match = re.search(r"^Pages:\s*(\d+)", proc.stdout, flags=re.M)
            if match:
                return int(match.group(1))
        except Exception:
            return None
    return None


def stitch_pdf_with_cover_pypdf(cover_pdf: Path, body_pdf: Path, final_pdf: Path, *, drop_body_first_page: bool = True) -> tuple[bool, str]:
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
        cover = PdfReader(str(cover_pdf))
        body = PdfReader(str(body_pdf))
        if len(cover.pages) < 2:
            return False, f"cover PDF must contain at least 2 pages, got {len(cover.pages)}"
        if len(body.pages) == 0:
            return False, "generated report PDF has 0 pages"
        writer = PdfWriter()
        writer.add_page(cover.pages[0])
        start_index = 1 if drop_body_first_page and len(body.pages) > 1 else 0
        for page in body.pages[start_index:]:
            writer.add_page(page)
        writer.add_page(cover.pages[1])
        final_pdf.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", dir=str(final_pdf.parent)) as tmp:
            tmp_path = Path(tmp.name)
            writer.write(tmp)
        tmp_path.replace(final_pdf)
        return True, f"pypdf stitched: cover page 1 + body pages {start_index + 1}-{len(body.pages)} + cover page 2"
    except Exception as exc:  # noqa: BLE001
        return False, f"pypdf stitching failed: {exc}"


def stitch_pdf_with_cover_fitz(cover_pdf: Path, body_pdf: Path, final_pdf: Path, *, drop_body_first_page: bool = True) -> tuple[bool, str]:
    try:
        import fitz  # type: ignore
        cover = fitz.open(str(cover_pdf))
        body = fitz.open(str(body_pdf))
        try:
            if cover.page_count < 2:
                return False, f"cover PDF must contain at least 2 pages, got {cover.page_count}"
            if body.page_count == 0:
                return False, "generated report PDF has 0 pages"
            start_index = 1 if drop_body_first_page and body.page_count > 1 else 0
            out = fitz.open()
            final_pdf.parent.mkdir(parents=True, exist_ok=True)
            try:
                out.insert_pdf(cover, from_page=0, to_page=0)
                if start_index <= body.page_count - 1:
                    out.insert_pdf(body, from_page=start_index, to_page=body.page_count - 1)
                out.insert_pdf(cover, from_page=1, to_page=1)
                with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", dir=str(final_pdf.parent)) as tmp:
                    tmp_path = Path(tmp.name)
                out.save(str(tmp_path))
                tmp_path.replace(final_pdf)
            finally:
                out.close()
            return True, f"PyMuPDF stitched: cover page 1 + body pages {start_index + 1}-{body.page_count} + cover page 2"
        finally:
            cover.close(); body.close()
    except Exception as exc:  # noqa: BLE001
        return False, f"PyMuPDF stitching failed: {exc}"


def stitch_pdf_with_cover_poppler(cover_pdf: Path, body_pdf: Path, final_pdf: Path, *, drop_body_first_page: bool = True) -> tuple[bool, str]:
    pdfseparate = shutil.which("pdfseparate")
    pdfunite = shutil.which("pdfunite")
    if not pdfseparate or not pdfunite:
        return False, "poppler fallback unavailable: pdfseparate/pdfunite not found"
    cover_pages = pdf_page_count(cover_pdf)
    body_pages = pdf_page_count(body_pdf)
    if cover_pages is None or body_pages is None:
        return False, "poppler fallback failed: could not determine PDF page counts"
    if cover_pages < 2 or body_pages == 0:
        return False, "cover/body page count invalid"
    start_page = 2 if drop_body_first_page and body_pages > 1 else 1
    final_pdf.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=str(final_pdf.parent)) as tmpdir_s:
            tmpdir = Path(tmpdir_s)
            cover_pattern = tmpdir / "cover-%d.pdf"
            body_pattern = tmpdir / "body-%d.pdf"
            subprocess.run([pdfseparate, "-f", "1", "-l", "2", str(cover_pdf), str(cover_pattern)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            parts = [tmpdir / "cover-1.pdf"]
            if start_page <= body_pages:
                subprocess.run([pdfseparate, "-f", str(start_page), "-l", str(body_pages), str(body_pdf), str(body_pattern)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                parts.extend(tmpdir / f"body-{i}.pdf" for i in range(start_page, body_pages + 1))
            parts.append(tmpdir / "cover-2.pdf")
            tmp_final = tmpdir / "stitched.pdf"
            subprocess.run([pdfunite, *[str(part) for part in parts], str(tmp_final)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            tmp_final.replace(final_pdf)
        return True, f"poppler stitched: cover page 1 + body pages {start_page}-{body_pages} + cover page 2"
    except Exception as exc:  # noqa: BLE001
        return False, f"poppler stitching failed: {exc}"


def stitch_pdf_with_front_back_cover(cover_pdf: Path, body_pdf: Path, final_pdf: Path, *, drop_body_first_page: bool = True) -> tuple[bool, str]:
    if not cover_pdf.exists():
        return False, f"cover PDF not found: {cover_pdf}"
    if not body_pdf.exists():
        return False, f"generated body PDF not found: {body_pdf}"
    attempts: list[str] = []
    for merger in (stitch_pdf_with_cover_pypdf, stitch_pdf_with_cover_fitz, stitch_pdf_with_cover_poppler):
        ok, message = merger(cover_pdf, body_pdf, final_pdf, drop_body_first_page=drop_body_first_page)
        attempts.append(message)
        if ok:
            return True, message
    return False, " | ".join(attempts)


# -------------------------- client-ready text filters ------------------------

TOKEN_REPLACEMENTS = {
    "S1": "品牌事实资料",
    "S2": "用户意图资料",
    "S3": "市场趋势判断",
    "S4": "品牌定位判断",
    "S5": "AI 可见性诊断",
    "S6": "话语资产",
    "S7": "视觉资产",
    "S8": "问答内容资产",
    "S9": "GEO 行动建议",
    "S10": "全景方案报告",
}

# Template terminology closure: preserve upstream analysis while converting old/research
# headings to the customer-facing vocabulary allowed by the S10 template. This
# prevents ad-hoc replacements and prevents content deletion caused by heading
# names that differ from the final template.
TEMPLATE_TERM_REPLACEMENTS = {
    "官网与第三方平台权重": "官网与第三方信源权重",
    "信源生态": "品牌信源覆盖",
    "高频引用来源": "高频引用信源",
    "信源建设缺口": "信源覆盖补齐优先级",
    "问题来源分布": "问题意图来源分布",
    "趋势机会气泡图": "趋势机会矩阵",
    "趋势机会图谱": "趋势机会矩阵",
    "数据来源、局限性与复盘机制": "数据依据与复盘机制",
    "资料缺口与后续补充建议": "资料完善与后续补充建议",
    "资料缺口": "资料完善方向",
    "后续数据补充计划": "后续数据完善计划",
    "定位验证": "定位证据验证",
    "Prompt 库概览": "Prompt 资产概览",
    "Prompt库概览": "Prompt 资产概览",
    "Prompt 库": "Prompt 资产",
    "Prompt库": "Prompt 资产",
    "落地页蓝图": "落地页结构建议",
    "内容日历概览": "内容日历展开",
    "问答树概览": "问答树展开",
    "五段问题路径": "五段式问题路径",
    "场景矩阵": "场景问题矩阵",
}


def normalize_template_terms(text: str) -> str:
    if not text:
        return ""
    out = text
    for src, dst in sorted(TEMPLATE_TERM_REPLACEMENTS.items(), key=lambda kv: -len(kv[0])):
        out = out.replace(src, dst)
    return out


INTERNAL_LINE_PATTERNS = [
    r"^\s*框架版本[:：].*$", r"^\s*生成时间[:：].*$", r"^\s*生成日期[:：].*$",
    r"^\s*双市场覆盖[:：].*$", r"^\s*监控问题口径[:：].*$", r"^\s*版本[:：]\s*v\d.*$",
    r"^\s*本节为重点内容节选.*$", r"^\s*完整资料随交付包保存.*$",
    r"^\s*基于S\d.*$", r"^\s*校验结果\s*$",
    r"^\s*action_id\s+.*$", r"^\s*#?\s*.*报告节选\s*$",
    # 移除了"数据来源"、"分析范围"、"分析方法"、"执行摘要"、"核心产出"、"关键发现"等容易误杀正常内容的模式
    # 这些模式可能会删除报告中合法的"数据来源"、"分析方法"等正式内容
    # 仅保留确定是内部工作流残留的模式
    # italic/footer signature lines such as: *S2 营销图谱专家 本工作流 | 生成时间：2026-06-15*
    r"^\s*[*_]*\s*S\d+(?:\.\d+)?[^\n]*\|[^\n]*$",
    r"^\s*[*_]+[^\n]*生成时间[^\n]*[*_]*\s*$",
    r"^\s*[*_]+[^\n]*\|[^\n]*[*_]+\s*$",
]

LOCAL_PATH_RE = re.compile(
    r"""(?ix)
    (?:file://[^\s`"'<>]+)
    |
    (?:(?<!https:)(?<!http:)/(?:Users|home|Volumes|private|tmp|var|root|workspace|mnt|opt|srv)/[^\s`"'<>]*)
    |
    (?:\b[A-Z]:[\\/][^\s`"'<>]*)
    """
)

SOURCE_ENVELOPE_LINE_RE = re.compile(
    r"""(?ix)^
    (?:
        FrontMind\b.*
        |
        (?:版本|日期|生成日期|生成时间|输入|原则|工作分支|执行分支|模式)\s*[:：｜|].*
    )
    $"""
)


def strip_local_path_lines(text: str) -> str:
    """Drop local filesystem path lines while preserving public http(s) sources."""
    if not text:
        return ""
    return "\n".join(line for line in text.splitlines() if not LOCAL_PATH_RE.search(line))


def _local_path_basename(value: str) -> str:
    cleaned = re.sub(r"^file:(?://)+", "", value.strip(), flags=re.I).rstrip("/\\")
    return re.split(r"[\\/]", cleaned)[-1]


def _sanitize_public_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if re.match(
                r"(?ix)^(?:file://|/(?:Users|home|Volumes|private|tmp|var|root|workspace|mnt|opt|srv)/|[A-Z]:[\\/])",
                key_text.strip(),
            ):
                key_text = _local_path_basename(key_text)
            elif LOCAL_PATH_RE.search(key_text):
                key_text = strip_local_path_lines(key_text)
            sanitized[key_text] = _sanitize_public_value(item)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_public_value(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_public_value(item) for item in value]
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if re.match(
        r"(?ix)^(?:file://|/(?:Users|home|Volumes|private|tmp|var|root|workspace|mnt|opt|srv)/|[A-Z]:[\\/])",
        stripped,
    ):
        return _local_path_basename(stripped)
    if LOCAL_PATH_RE.search(value):
        return strip_local_path_lines(value)
    return value


def public_report_data(data: dict[str, Any]) -> dict[str, Any]:
    """Return the minimal customer-safe report JSON projection.

    Raw monitoring answers, task metadata, stage source paths and workflow-only
    fields remain in the sibling ``_execution`` JSON and never enter the
    customer archive.
    """
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    manifest = data.get("source_manifest") if isinstance(data.get("source_manifest"), dict) else {}
    manifest_by_stage = manifest.get("by_stage") if isinstance(manifest.get("by_stage"), dict) else {}
    public_manifest: dict[str, list[dict[str, Any]]] = {}
    for stage, entries in manifest_by_stage.items():
        safe_entries: list[dict[str, Any]] = []
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                safe_entries.append({
                    key: entry.get(key)
                    for key in ("stage", "role", "filename", "size", "sha256")
                    if entry.get(key) is not None
                })
        if safe_entries:
            public_manifest[str(stage)] = safe_entries

    public = {
        "meta": {
            key: meta.get(key)
            for key in ("brand", "brand_id", "company_name", "main_product", "workflow_version")
            if meta.get(key) is not None
        },
        "monitoring_summary": data.get("monitoring_summary", {}),
        "source_manifest": {
            "by_stage": public_manifest,
            "total_files": manifest.get("total_files", sum(len(v) for v in public_manifest.values())),
        },
    }
    for key in (
        "source_quality_gate",
        "source_coverage_gate",
        "report_richness_gate",
        "template_compliance",
        "pdf_generation",
        "final_formatting",
    ):
        if key in data:
            public[key] = data[key]
    public = _sanitize_public_value(public)
    if not isinstance(public, dict):
        raise TypeError("public report data must be a mapping")
    serialized = json.dumps(public, ensure_ascii=False)
    if LOCAL_PATH_RE.search(serialized):
        raise ValueError("customer report data still contains a local absolute path")
    if re.search(
        r'"(?:taskId|subTaskId|reasoningProcess|recommended_business_actions|monitoring_records)"',
        serialized,
        flags=re.I,
    ):
        raise ValueError("customer report data still contains internal workflow fields")
    return public


def _envelope_text(line: str) -> str:
    value = re.sub(r"^\s*>\s?", "", line).strip()
    value = value.strip("*_` ")
    return value.strip()


def strip_source_document_envelope(text: str) -> str:
    """Remove each imported source document's H1 and adjacent workflow front matter."""
    if not text:
        return ""
    lines = strip_local_path_lines(text).splitlines()
    out: list[str] = []
    after_source_h1 = False
    for line in lines:
        stripped = line.strip()
        if re.match(r"^#(?!#)\s+\S", stripped):
            after_source_h1 = True
            continue
        plain = _envelope_text(line)
        if SOURCE_ENVELOPE_LINE_RE.match(plain):
            continue
        if after_source_h1:
            if not stripped or re.match(r"^(?:---+|\*\*\*+|___+)\s*$", stripped):
                continue
            if re.match(r"^>\s*", stripped):
                # Unknown blockquote directly under a source H1 is document metadata,
                # not client-facing analysis.
                continue
            after_source_h1 = False
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def _normalized_heading_title(line: str) -> str:
    title = re.sub(r"^\s*#{1,6}\s+", "", line).strip()
    title = re.sub(
        r"^(?:"
        r"\d+(?:\.\d+)*\s*[、.．]?\s*"
        r"|[一二三四五六七八九十百零〇]+\s*[、.．]\s*"
        r"|[（(]\s*(?:\d+|[一二三四五六七八九十百零〇]+)\s*[）)]\s*"
        r")",
        "",
        title,
    )
    return title.strip()


def _filter_markdown_sections(text: str, keep_heading: Any) -> str:
    """Keep selected H2 subtrees; H3+ content follows its owning H2."""
    if not text:
        return ""
    out: list[str] = []
    keep = False
    saw_h2 = False
    for line in text.splitlines():
        match = re.match(r"^\s*(##)(?!#)\s+\S", line)
        if match:
            saw_h2 = True
            keep = bool(keep_heading(_normalized_heading_title(line)))
            if keep:
                out.append(line)
            continue
        if not saw_h2:
            continue
        if keep:
            out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def _drop_markdown_sections(text: str, drop_heading: Any) -> str:
    """Drop selected heading subtrees without deleting sibling sections."""
    if not text:
        return ""
    out: list[str] = []
    skipping = False
    skip_level = 0
    for line in text.splitlines():
        level = _heading_level(line)
        if level:
            title = _normalized_heading_title(line)
            if skipping and level <= skip_level:
                skipping = False
            if drop_heading(title):
                skipping = True
                skip_level = level
                continue
        if not skipping:
            out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


_IMPORTED_HEADING_NUMBER_RE = re.compile(
    r"""
    ^
    (?:
        \d+(?:\.\d+)*\s*[、.．]?\s*
        |
        [一二三四五六七八九十百零〇]+\s*[、.．]\s*
        |
        [（(]\s*(?:\d+|[一二三四五六七八九十百零〇]+)\s*[）)]\s*
    )
    """,
    flags=re.X,
)


def _strip_imported_heading_numbers(text: str) -> str:
    """Remove source-local numbering from Markdown headings, preserving body text.

    The panorama template owns the final 11-part numbering. Imported S4/S6/S8
    documents may use unrelated local sequences (for example ``2.`` then
    ``5.``), so those prefixes must never reach customer-facing H2-H6 headings.
    """
    if not text:
        return ""
    cleaned_lines: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^(\s*#{2,6}\s+)(.+?)\s*$", line)
        if not match:
            cleaned_lines.append(line)
            continue
        prefix, title = match.groups()
        normalized = _IMPORTED_HEADING_NUMBER_RE.sub("", title, count=1).strip()
        cleaned_lines.append(prefix + (normalized or title.strip()))
    return "\n".join(cleaned_lines).strip()


def filter_customer_section_markdown(source_key: str, text: str) -> str:
    """Apply the final-report content policy to imported stage Markdown."""
    cleaned = strip_source_document_envelope(text)
    if source_key == "positioning":
        cleaned = _drop_markdown_sections(cleaned, lambda title: "心智地图" in title)
    elif source_key == "verbal":
        removed = {"句式模板", "危机与错误信息回应模板", "下游注入规则"}
        cleaned = _drop_markdown_sections(cleaned, lambda title: title in removed)
    elif source_key == "visual":
        cleaned = _drop_markdown_sections(
            cleaned,
            lambda title: (
                title == "重校触发条件"
                or title.startswith("CoT-")
                or "独立 Wide Research" in title
                or title in {"核心视觉母题与使用场景", "研究来源"}
            ),
        )
    elif source_key == "semantic":
        # These are internal data-quality/diagnostic views. They remain in the
        # structured citation-analysis JSON, but must not appear in the client
        # report's semantic-asset audit. This also strips stale S5.5 Markdown
        # produced by older workflow versions before the dedicated citation
        # module is appended below.
        cleaned = _drop_markdown_sections(
            cleaned,
            lambda title: (
                title in {"三层对账与集中度", "数据范围与集中度"}
                or title.startswith("模型引用量")
            ),
        )
    elif source_key == "qa_architecture":
        cleaned = _filter_markdown_sections(
            cleaned,
            lambda title: (
                "标准答案" in title
                or "固定双问题的标准口径" in title
                or title == "双主体信息架构"
            ),
        )
    elif source_key == "enablement":
        customer_sections = {
            "经营判断",
            "官网与结构化数据改造判断",
            "90天行动路线图",
            "合规与声誉治理",
            "衡量与复盘",
        }
        cleaned = _filter_markdown_sections(cleaned, lambda title: title in customer_sections)
    return _strip_imported_heading_numbers(cleaned)



# Historical versions removed whole subsections whose headings did not exist in the
# final template. That made reports look shallow and caused coverage failures. In
# the final workflow, old/research headings are normalized by
# normalize_template_terms(); no client-relevant subsection is deleted wholesale.
DEPRECATED_SECTION_PATTERNS: list[str] = []
_DEPRECATED_HEADING_RE = re.compile(r"a^")


def _heading_level(line: str) -> int:
    """Return a heading rank (smaller == higher level) or 0 if not a heading-like line."""
    s = line.strip()
    m = re.match(r"^(#{1,6})\s+\S", s)
    if m:
        return len(m.group(1))
    if re.match(r"^[一二三四五六七八九十]+[、.．]\s*\S", s):
        return 2
    if re.match(r"^\d+[、.．]\s*\S", s):
        return 3
    if re.match(r"^\d+\.\d+\s*\S", s):
        return 4
    if re.match(r"^[（(][一二三四五六七八九十0-9]+[）)]\s*\S", s):
        return 4
    if re.match(r"^\*\*[^*]+\*\*\s*$", s):
        return 4
    return 0


def drop_deprecated_sections(text: str) -> str:
    """Remove deprecated subsections and all their content up to the next sibling/parent heading."""
    if not text:
        return ""
    lines = text.splitlines()
    out: list[str] = []
    skipping = False
    skip_level = 0
    for line in lines:
        if skipping:
            lvl = _heading_level(line)
            # Stop skipping when we hit a heading at same or higher level (<= skip_level),
            # but only if it is NOT itself another deprecated heading.
            if lvl and lvl <= skip_level and not _DEPRECATED_HEADING_RE.search(line):
                skipping = False
                out.append(line)
                continue
            # A new deprecated heading restarts skipping at its own level.
            if _DEPRECATED_HEADING_RE.search(line):
                skip_level = _heading_level(line) or skip_level
                continue
            continue
        if _DEPRECATED_HEADING_RE.search(line):
            skipping = True
            skip_level = _heading_level(line) or 99
            continue
        out.append(line)
    cleaned = "\n".join(out)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def strip_internal_report_scaffolding(text: str) -> str:
    if not text:
        return ""
    # Remove private notes, code blocks and workflow-only identifiers before client rendering.
    text = re.sub(r"<!--\s*COT_START\s*-->.*?<!--\s*COT_END\s*-->", "", text, flags=re.S | re.I)
    text = re.sub(r"```(?:json)?\s*.*?```", "", text, flags=re.S | re.I)
    # Paths must be removed before S-prefixed filenames are neutralized; otherwise
    # only the private directory prefix remains visible in the client report.
    text = strip_source_document_envelope(text)
    text = re.sub(r"S\d+(?:\.\d+)?_[^\s\)）]+", "", text)
    text = normalize_template_terms(text)
    # Remove deprecated subsections (content calendar, 12-week plan, platform split,
    # landing-page blueprint, execution advice, etc.) before any further processing.
    # 注：缩小 drop_deprecated_sections 的影响范围，避免误杀正常内容
    text = drop_deprecated_sections(text)
    # Drop report-style H1 titles like "XXX报告 — 品牌" / "落地页蓝图 — 品牌" that leak
    # internal work-product names into the client report (the section divider already titles the page).
    text = re.sub(r"^\s*#{1,3}\s*[^\n]*(?:报告|蓝图|建议包|手册|诊断数据|评分卡|图谱)\s*[—\-–][^\n]*$", "", text, flags=re.M)
    # Strip S-prefixed work-product references such as "S8落地页蓝图显示" / "S7报告显示".
    text = re.sub(r"S\d+(?:\.\d+)?\s*(?=[\u4e00-\u9fff])", "", text)
    # Neutralize internal work-product names so the client report reads cleanly.
    # Compound phrases first, then single names, longest-first to avoid partial overlaps.
    product_name_map = {
        "品牌事实资料-问答内容资产": "全阶段策略资产",
        "品牌事实资料 视觉资产清单": "品牌视觉资产清单",
        "问答内容资产": "问答与内容资产",
        "业务赋能建议包": "业务赋能建议",
        "品牌事实资料": "品牌事实",
        "用户意图资料": "用户意图分析",
        "全景方案报告": "全景方案",
        "落地页蓝图": "落地页结构建议",
    }
    for src, dst in sorted(product_name_map.items(), key=lambda kv: -len(kv[0])):
        text = text.replace(src, dst)
    lines: list[str] = []
    for line in text.splitlines():
        raw = line.rstrip()
        s = raw.strip()
        if not s:
            lines.append("")
            continue
        # Drop placeholder-only or unfinished lines. These caused visible "……" filler in reports.
        if re.search(r"(?:…{2,}|\.{3,})", s):
            if len(s) <= 140 or re.match(r"^(?:[-•*]\s*)?(?:GEO_|[A-Z]{1,4}_|\d+[\.、])", s):
                continue
        if re.match(r"^(?:GEO_[A-Za-z0-9_]+|action_id)\b", s):
            continue
        if any(re.search(pat, s, flags=re.I) for pat in INTERNAL_LINE_PATTERNS):
            continue
        if re.search(r"(?:品牌知识库|品类趋势报告|定位分析报告|问答架构报告|业务赋能建议包)[:：]", s):
            continue
        if re.match(r"^#{1,4}\s*(?:一、)?(?:分析目标|方法论选择|资料缺口|后续数据补充计划|报告摘要|执行路线图)\s*$", s):
            continue
        if "None" == s or "以“None”" in s or "以\"None\"" in s:
            continue
        lines.append(raw)
    out = "\n".join(lines)
    out = out.replace("待补齐", "需客户补充")
    out = out.replace("待 S", "需补充")
    out = out.replace("None", "")
    # Remove trailing placeholder punctuation without creating artificial omissions.
    out = re.sub(r"[，,；;：:]?\s*(?:…{2,}|\.{3,})\s*$", "", out, flags=re.M)
    for token, repl in sorted(TOKEN_REPLACEMENTS.items(), key=lambda kv: -len(kv[0])):
        out = re.sub(rf"\b{token}(?:\.\d+)?\b", repl, out)
    # Final fallback neutralization: catch any residual internal product names
    # (including hyphen-joined compounds) that survived earlier passes.
    final_map = {
        "品牌事实资料-问答内容资产": "全阶段策略资产",
        "品牌事实资料-全部产出": "全阶段策略产出",
        "品牌事实资料-": "品牌事实与",
        "问答内容资产": "问答与内容资产",
        "品牌事实资料": "品牌事实",
        "用户意图资料": "用户意图分析",
    }
    for src, dst in sorted(final_map.items(), key=lambda kv: -len(kv[0])):
        out = out.replace(src, dst)
    out = normalize_template_terms(out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()



def client_excerpt(text: str, max_chars: int = 3200) -> str:
    # 本工作流: no truncation. Always return the FULL cleaned text so the client
    # report contains the complete original content; pages flow naturally.
    # `max_chars` is kept only for backward-compatible call signatures.
    cleaned = strip_internal_report_scaffolding(text)
    if not cleaned:
        return ""
    return cleaned


def client_md_to_html(text: str, max_chars: int = 3200) -> str:
    if not text or not text.strip():
        return "<p class='muted'>本模块当前缺少可直接进入客户报告的完整材料，建议在下一轮补齐事实与证据。</p>"
    
    cleaned = client_excerpt(text, max_chars=max_chars)
    if not cleaned:
        # Never reinsert raw source text: it may contain workflow metadata or
        # local filesystem paths removed by the client-safety sanitizer.
        return "<p class='muted'>本模块当前缺少可直接进入客户报告的完整材料，建议在下一轮补齐事实与证据。</p>"
    if markdown is not None:
        html_text = markdown.markdown(cleaned, extensions=["tables", "nl2br"])
    else:
        html_text = fallback_md_to_html(cleaned)
    return html_text


_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$")

def _inline_md(text: str) -> str:
    """Escape HTML then apply inline Markdown (bold/italic/code) safely."""
    s = e(text)
    s = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^\n*]+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"__([^\n_]+?)__", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^\n*]+?)\*(?![\w*])", r"<em>\1</em>", s)
    return s

def _split_table_row(line: str) -> list:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]

def fallback_md_to_html(cleaned: str) -> str:
    """Self-contained GFM-lite renderer used when python-markdown is absent.

    Supports: headings, GFM tables (thead/tbody + alignment), bold/italic/
    inline code, blockquotes, horizontal rules, ul/ol lists and paragraphs.
    HTML is escaped before inline transforms so raw source text can never
    inject markup.
    """
    lines = cleaned.splitlines()
    out = []
    i = 0
    list_tag = None

    def close_list():
        nonlocal list_tag
        if list_tag:
            out.append("</" + list_tag + ">")
            list_tag = None

    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        if not s:
            close_list()
            i += 1
            continue
        if "|" in s and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]):
            close_list()
            header = _split_table_row(s)
            aligns_raw = _split_table_row(lines[i + 1])
            aligns = []
            for a in aligns_raw:
                if a.startswith(":") and a.endswith(":"):
                    aligns.append("center")
                elif a.endswith(":"):
                    aligns.append("right")
                else:
                    aligns.append("left")
            rows = []
            j = i + 2
            while j < len(lines) and "|" in lines[j] and lines[j].strip():
                rows.append(_split_table_row(lines[j]))
                j += 1
            thead = "".join(
                '<th style="text-align:' + (aligns[k] if k < len(aligns) else "left") + '">' + _inline_md(c) + "</th>"
                for k, c in enumerate(header)
            )
            body = ""
            for r in rows:
                cells = "".join(
                    '<td style="text-align:' + (aligns[k] if k < len(aligns) else "left") + '">' + _inline_md(c) + "</td>"
                    for k, c in enumerate(r)
                )
                body += "<tr>" + cells + "</tr>"
            out.append("<table><thead><tr>" + thead + "</tr></thead><tbody>" + body + "</tbody></table>")
            i = j
            continue
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", s):
            close_list()
            out.append("<hr/>")
            i += 1
            continue
        if s.startswith("#### "):
            close_list(); out.append("<h4>" + _inline_md(s[5:]) + "</h4>"); i += 1; continue
        if s.startswith("### "):
            close_list(); out.append("<h4>" + _inline_md(s[4:]) + "</h4>"); i += 1; continue
        if s.startswith("## "):
            close_list(); out.append("<h3>" + _inline_md(s[3:]) + "</h3>"); i += 1; continue
        if s.startswith("# "):
            close_list(); out.append("<h3>" + _inline_md(s[2:]) + "</h3>"); i += 1; continue
        if s.startswith(">"):
            close_list()
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append("<blockquote>" + "<br/>".join(_inline_md(q) for q in quote if q) + "</blockquote>")
            continue
        m = re.match(r"^\d+[\.、]\s+(.*)$", s)
        if m:
            if list_tag != "ol":
                close_list(); out.append("<ol>"); list_tag = "ol"
            out.append("<li>" + _inline_md(m.group(1)) + "</li>")
            i += 1
            continue
        if s.startswith(("- ", "* ", "• ")):
            if list_tag != "ul":
                close_list(); out.append("<ul>"); list_tag = "ul"
            out.append("<li>" + _inline_md(s[2:].strip()) + "</li>")
            i += 1
            continue
        close_list()
        out.append("<p>" + _inline_md(s) + "</p>")
        i += 1
    close_list()
    return "\n".join(out)


def is_invalid_client_value(value: Any) -> bool:
    if value is None:
        return True
    s = str(value).strip()
    return s == "" or s.lower() == "none" or "待补齐" in s or "目标人群" == s or "目标品类" == s or "差异化价值" == s


def strip_inline_markdown(text: str) -> str:
    """Remove inline Markdown markers for plain-text (escaped) output paths.

    Use only for fields rendered through e() / direct text where Markdown is not
    interpreted, so raw **bold**, *italic*, `code`, __bold__, and leading "> "
    blockquote markers do not surface as literal characters.
    """
    if not text:
        return text
    text = re.sub(r"\*\*([^\n*]+?)\*\*", r"\1", text)
    text = re.sub(r"__([^\n_]+?)__", r"\1", text)
    text = re.sub(r"(?<![\w*])\*([^\n*]+?)\*(?![\w*])", r"\1", text)
    text = re.sub(r"`([^`\n]+?)`", r"\1", text)
    text = re.sub(r"^\s*>\s?", "", text, flags=re.M)
    return text.strip()


def clean_client_value(value: Any, fallback: str = "需客户补充") -> str:
    if is_invalid_client_value(value):
        return fallback
    cleaned = strip_internal_report_scaffolding(str(value))
    cleaned = strip_inline_markdown(cleaned)
    return cleaned or fallback


def clean_answer_for_display(value: Any) -> str:
    text = str(value if value is not None else "")
    text = re.sub(r"<div[^>]+class=[\"'][^\"']*media-video-grid[^\"']*[\"'][\s\S]*?</div>", "\n[平台返回相关视频/媒体卡片，原始 JSON 保留完整证据。]\n", text, flags=re.I)
    text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = strip_internal_report_scaffolding(text)
    text = strip_inline_markdown(text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or "当前未读取到可展示样本回答。"


# --------------------------- loading work products ---------------------------

STRATEGY_SOURCE_SPECS: dict[str, dict[str, Any]] = {
    "brand_facts": {"stage": "S1", "patterns": [f"S1_{{brand}}_品牌知识库.md", f"S1_{{brand}}_品牌事实图谱.md", "**/S1_*品牌知识库.md"]},
    "marketing": {"stage": "S2", "patterns": [f"S2_{{brand}}_营销图谱报告.md", f"S2_{{brand}}_营销图谱.md", "**/S2_*营销图谱*.md"]},
    "trends": {"stage": "S3", "patterns": [f"S3_{{brand}}_品类趋势报告.md", f"S3_{{brand}}_趋势报告.md", "**/S3_*趋势*.md"]},
    "positioning": {"stage": "S4", "patterns": [f"S4_{{brand}}_定位分析报告.md", f"S4_{{brand}}_品牌定位声明.md", "**/S4_*定位*.md"]},
    "diagnostic": {"stage": "S5", "patterns": [f"S5_{{brand}}_品牌诊断数据.md", f"S5_{{brand}}_Gap报告.md", "**/S5_*Gap报告.md", "**/S5_*品牌诊断*.md"]},
    "semantic": {"stage": "S5.5", "patterns": [f"S5.5_{{brand}}_语义资产审计报告.md", "**/S5.5_*语义资产*.md"]},
    "verbal": {"stage": "S6", "patterns": [f"S6_{{brand}}_话语手册.md", "**/S6_*话语*.md"]},
    "visual": {"stage": "S7", "patterns": [f"S7_{{brand}}_视觉符号体系报告.md", "**/S7_*视觉*.md"]},
    "qa_architecture": {"stage": "S8", "patterns": [f"S8_{{brand}}_问答报告.md", f"S8_{{brand}}_落地页蓝图.md", "**/S8_*问答*.md", "**/S8_*落地页*.md"]},
    "enablement": {"stage": "S9", "patterns": [f"S9_{{brand}}_业务赋能建议包.md", "**/S9_*赋能*.md", "**/S9_*建议*.md"]},
}


def _resolve_patterns(patterns: list[str], brand: str) -> list[str]:
    return [pat.format(brand=brand) for pat in patterns]


def load_strategy_sections_with_paths(work_dir: Path, brand: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Load each strategy source once, even when exact/fuzzy patterns hit the same file."""
    sections: dict[str, str] = {}
    paths_by_key: dict[str, list[str]] = {}
    for key, spec in STRATEGY_SOURCE_SPECS.items():
        chunks: list[str] = []
        seen: set[str] = set()
        resolved_paths: list[str] = []
        for pat in _resolve_patterns(list(spec.get("patterns", [])), brand):
            p = find_file(work_dir, pat)
            if not p:
                continue
            resolved = str(p.resolve())
            if resolved in seen:
                continue
            seen.add(resolved)
            text = filter_customer_section_markdown(key, read_text(p))
            if text.strip():
                chunks.append(text)
                resolved_paths.append(resolved)
        sections[key] = "\n\n".join(chunks)
        paths_by_key[key] = resolved_paths
    return sections, paths_by_key


def load_strategy_sections(work_dir: Path, brand: str) -> dict[str, str]:
    sections, _ = load_strategy_sections_with_paths(work_dir, brand)
    return sections


def load_structured_sources(work_dir: Path, brand: str) -> dict[str, Any]:
    paths = {
        "brand_facts_json": find_first(work_dir, [f"S1_{brand}_品牌事实图谱.json", f"**/S1_{brand}_品牌事实图谱.json", "**/S1_*事实图谱*.json", "**/S1_*品牌资产*.json"]),
        "visual_asset_manifest": find_first(work_dir, [f"S1_{brand}_视觉资产清单.json", f"**/S1_{brand}_视觉资产清单.json", "**/S1_*视觉资产清单*.json"]),
        "marketing_json": find_first(work_dir, [f"S2_{brand}_营销图谱.json", f"**/S2_{brand}_营销图谱.json", "**/S2_*营销*.json", "**/S2_*用户意图*.json"]),
        "trend_scorecard": find_first(work_dir, [f"S3_{brand}_趋势打分卡.json", f"**/S3_{brand}_趋势打分卡.json", "**/S3_*趋势打分*.json", "**/S3_*趋势*.json"]),
        "positioning_json": find_first(work_dir, [f"S4_{brand}_定位声明.json", f"**/S4_{brand}_定位声明.json", "**/S4_*定位声明*.json", "**/S4_*定位*.json"]),
        "diagnostic_json": find_first(work_dir, [f"S5_{brand}_品牌诊断数据.json", f"**/S5_{brand}_品牌诊断数据.json", "**/S5_*诊断数据*.json", "**/S5_*diagnosis*.json"]),
        "citation_analysis": find_first(work_dir, [f"S5_{brand}_引用分析数据.json", f"**/S5_{brand}_引用分析数据.json", "**/S5_*引用分析数据*.json"]),
        "semantic_scorecard": find_first(work_dir, [f"S5.5_{brand}_语义资产评分卡.json", f"**/S5.5_{brand}_语义资产评分卡.json", "**/S5.5_*评分卡*.json", "**/S5.5_*语义*.json"]),
        "verbal_tokens": find_first(work_dir, [f"S6_{brand}_话语token.json", f"**/S6_{brand}_话语token.json", "**/S6_*话语token*.json", "**/S6_*话语*.json"]),
        "visual_prompt_pack": find_first(work_dir, [f"S7_{brand}_视觉Prompt包.json", f"**/S7_{brand}_视觉Prompt包.json", "**/S7_*视觉Prompt*.json", "**/S7_*视觉*.json"]),
        "qa_tree": find_first(work_dir, [f"S8_{brand}_问答树.json", f"**/S8_{brand}_问答树.json", "**/S8_*问答树*.json"]),
        "qa_matrix": find_first(work_dir, [f"S8_{brand}_问答矩阵.json", f"**/S8_{brand}_问答矩阵.json", "**/S8_*问答矩阵*.json"]),
        "content_calendar": find_first(work_dir, [f"S8_{brand}_内容日历.json", f"**/S8_{brand}_内容日历.json", "**/S8_*内容日历*.json"]),
        "s9_enablement_md": find_first(work_dir, [f"S9_{brand}_业务赋能建议包.md", f"**/S9_{brand}_业务赋能建议包.md", "**/S9_*赋能*.md", "**/S9_*建议包*.md"]),
    }
    out: dict[str, Any] = {"paths": {k: str(v.resolve()) if v else None for k, v in paths.items()}}
    for key, path in paths.items():
        if key == "s9_enablement_md":
            out["s9_enablement_md_raw"] = read_text(path) if path else ""
        else:
            out[key] = load_json(path)
    return out


def _file_manifest_entry(path_value: str, role: str, stage: str) -> dict[str, Any] | None:
    path = Path(path_value)
    if not path.exists() or not path.is_file():
        return None
    raw = path.read_bytes()
    return {
        "stage": stage,
        "role": role,
        "path": str(path),
        "filename": path.name,
        "size": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def build_source_manifest(
    strategy_paths: dict[str, list[str]],
    structured_paths: dict[str, Any],
    monitoring_path: Path | None,
    title_hooks_path: Path | None,
) -> dict[str, Any]:
    key_stage = {key: str(spec.get("stage")) for key, spec in STRATEGY_SOURCE_SPECS.items()}
    structured_stage = {
        "brand_facts_json": "S1", "visual_asset_manifest": "S1", "marketing_json": "S2", "trend_scorecard": "S3",
        "positioning_json": "S4", "diagnostic_json": "S5", "citation_analysis": "S5.0", "semantic_scorecard": "S5.5",
        "verbal_tokens": "S6", "visual_prompt_pack": "S7", "qa_tree": "S8",
        "qa_matrix": "S8", "content_calendar": "S8", "s9_enablement_md": "S9",
    }
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key, values in strategy_paths.items():
        for value in values:
            entry = _file_manifest_entry(value, key, key_stage.get(key, key))
            if entry and entry["path"] not in seen:
                seen.add(entry["path"]); entries.append(entry)
    for key, value in structured_paths.items():
        if not value:
            continue
        entry = _file_manifest_entry(str(value), key, structured_stage.get(key, key))
        if entry and entry["path"] not in seen:
            seen.add(entry["path"]); entries.append(entry)
    for path, role, stage in ((monitoring_path, "monitoring_data", "S5.0"), (title_hooks_path, "title_hooks", "S9.8")):
        if path:
            entry = _file_manifest_entry(str(path.resolve()), role, stage)
            if entry and entry["path"] not in seen:
                seen.add(entry["path"]); entries.append(entry)
    by_stage: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        by_stage.setdefault(str(entry["stage"]), []).append(entry)
    return {"entries": entries, "by_stage": by_stage, "total_files": len(entries)}


def monitoring_summary(monitoring: dict[str, Any] | None) -> dict[str, Any]:
    if not monitoring:
        return {"expected_records": 0, "actual_records": 0, "successful_records": 0, "failed_records": 0}
    summary = monitoring.get("summary", {}) if isinstance(monitoring, dict) else {}
    if not isinstance(summary, dict):
        summary = {}
    records = monitoring.get("records", []) if isinstance(monitoring, dict) else []
    meta = monitoring.get("meta", {}) if isinstance(monitoring.get("meta", {}), dict) else {}
    platform_count = len(meta.get("platforms") or [])
    question_count = len(monitoring.get("questions") or []) or 2
    repeat = int(meta.get("repeat_per_question_platform") or DEFAULT_MONITORING_REPEAT)
    summary.setdefault("expected_records", question_count * platform_count * repeat)
    summary.setdefault("actual_records", len(records))
    summary.setdefault("successful_records", sum(1 for r in records if r.get("answerContent") and not r.get("errorMessage")))
    summary.setdefault("failed_records", max(0, int(summary.get("expected_records") or 0) - int(summary.get("successful_records") or 0)))
    return summary


# --------------------------- monitoring analysis -----------------------------

def platform_display(platform: Any) -> str:
    return {"deepseek": "DeepSeek", "doubao": "豆包", "qianwen": "通义千问", "kimi": "Kimi", "wenxin": "文心一言", "yuanbao": "腾讯元宝"}.get(str(platform or "").lower(), str(platform or "未知平台"))


def is_q1_record(rec: dict[str, Any]) -> bool:
    qid = str(rec.get("question_id") or "")
    qtext = str(rec.get("question_text") or rec.get("question") or "")
    return qid == "Q1_PRODUCT_RECOMMENDATION" or ("推荐" in qtext and "缺点" not in qtext and "问题" not in qtext)


def is_q2_record(rec: dict[str, Any]) -> bool:
    qid = str(rec.get("question_id") or "")
    qtext = str(rec.get("question_text") or rec.get("question") or "")
    return qid == "Q2_REPUTATION_ISSUE" or "缺点" in qtext or "问题" in qtext or "投诉" in qtext


def brand_tokens(brand: str, company_name: str = "") -> list[str]:
    tokens = {brand, brand.replace("_", " "), brand.replace("_", ""), brand.upper(), brand.lower()}
    if company_name:
        tokens.add(company_name)
        for part in re.split(r"[、,，;；/]+", company_name):
            part = part.strip()
            if part:
                tokens.add(part)
    return [t for t in tokens if t]


def brand_mentioned(answer: str, brand: str, company_name: str = "") -> bool:
    text_lower = answer.lower()
    for token in brand_tokens(brand, company_name):
        if token.lower() in text_lower:
            return True
    return False


def _explicit_bool_signal(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1", "是", "提及", "已提及"}:
            return True
        if normalized in {"false", "no", "n", "0", "否", "未提及", "-", "—"}:
            return False
    return None


def _positive_brand_rank(value: Any) -> bool:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value > 0
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or normalized in {"-", "—", "未进入排名", "未提及"}:
            return False
        match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)(?!\d)", normalized)
        return bool(match and float(match.group(1)) > 0)
    return False


def record_brand_mentioned(rec: dict[str, Any], brand: str, company_name: str = "") -> bool:
    """Use imported brand signals first; fall back to answer text only if absent."""
    structured_seen = False
    for key in ("brand_mentioned", "brandMentioned"):
        if key not in rec:
            continue
        structured_seen = True
        signal = _explicit_bool_signal(rec.get(key))
        if signal is not None:
            return signal

    for key in (
        "mention_rank",
        "brand_rank",
        "mentionRank",
        "brandRank",
        "spreadsheet_monitor_word_rank",
        "spreadsheet_ranking_text",
    ):
        if key not in rec:
            continue
        structured_seen = True
        if _positive_brand_rank(rec.get(key)):
            return True

    if structured_seen:
        return False
    return brand_mentioned(str(rec.get("answerContent") or ""), brand, company_name)


def build_platform_table(records: list[dict[str, Any]], brand: str, company_name: str = "", positioning_json: Any = None) -> str:
    grouped: dict[str, dict[str, Any]] = {}
    comp_aliases = build_competitor_aliases(positioning_json, brand)
    for rec in records:
        platform = str(rec.get("platform") or "unknown")
        row = grouped.setdefault(platform, {"platform": platform, "q1_total": 0, "q1_mentions": 0, "q1_comp_mentions": 0})
        answer = str(rec.get("answerContent") or "")
        if is_q1_record(rec):
            row["q1_total"] += 1
            if record_brand_mentioned(rec, brand, company_name):
                row["q1_mentions"] += 1
            comp_mentioned = False
            for canonical, aliases in comp_aliases.items():
                if any(a and a in answer for a in aliases):
                    comp_mentioned = True
                    break
            if comp_mentioned:
                row["q1_comp_mentions"] += 1
                
    if not grouped:
        return "<p class='muted'>当前未读取到平台监控记录。</p>"
    rows = ["<table><thead><tr><th>平台</th><th>品牌提及（正向推荐）</th><th>重点竞品命中回答数（正向推荐）</th><th>品牌可见度</th></tr></thead><tbody>"]
    for key in sorted(grouped):
        row = grouped[key]
        q1_total = row["q1_total"]
        if q1_total == 0:
            continue
        mentions = row["q1_mentions"]
        comp_mentions = row["q1_comp_mentions"]
        visibility = f"{round(mentions / q1_total * 100)}%"
        rows.append(f"<tr><td>{e(platform_display(row['platform']))}</td><td class='td-highlight'>{mentions} 次</td><td>{comp_mentions} 次</td><td class='td-good'>{visibility}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def monitoring_card_items(summary: dict[str, Any], records: list[dict[str, Any]]) -> str:
    total = str(summary.get("expected_records", 30))
    actual = str(summary.get("actual_records", len(records)))
    success = str(summary.get("successful_records", 0))
    failed = str(summary.get("failed_records", max(0, int(summary.get("expected_records", 30) or 30) - int(summary.get("successful_records", 0) or 0))))
    items = [(total, "应完成监控", "问题数×实际平台数×5次", "purple"), (actual, "实际记录", "表格导入", "blue"), (success, "成功记录", "可进入诊断", "green"), (failed, "失败/缺失", "需复测处理", "red")]
    return "".join(f"<div class='data-card card-{e(theme)}'><span class='number'>{e(value)}</span><span class='label'>{e(label)}</span><span class='sublabel'>{e(sub)}</span></div>" for value, label, sub, theme in items)


def render_monitoring_brief(summary: dict[str, Any], brand: str, product: str) -> str:
    return f"""
<div class='consulting-grid two'>
  <div class='insight-card'><h4>推荐可见度问题</h4><p><strong>{e(product)}推荐</strong></p><p>用于评估 AI 在品类推荐场景中是否主动提及或推荐 {e(brand)}。</p></div>
  <div class='insight-card'><h4>负向直问问题</h4><p><strong>{e(brand)}有什么缺点和问题？</strong></p><p>用于识别 AI 对品牌风险、疑虑和信任边界的描述，不计入推荐排名。</p></div>
</div>
"""


def fixed_questions_table(product: str, brand: str) -> str:
    return (
        "<table><thead><tr><th>监控问题</th><th>问题类型</th><th>咨询用途</th><th>指标口径</th></tr></thead><tbody>"
        f"<tr><td>{e(product)}推荐</td><td>推荐可见度</td><td>判断品类推荐场景中 {e(brand)} 是否被 AI 主动提及、推荐或被竞品替代</td><td class='td-good'>计入可见度、推荐和竞品占位</td></tr>"
        f"<tr><td>{e(brand)}有什么缺点和问题？</td><td>负向直问</td><td>判断 AI 对品牌风险、缺点、问题和信任边界的表达</td><td class='td-highlight'>不计入排名，仅做舆情与信任分析</td></tr>"
        "</tbody></table>"
    )


def extract_reputation_themes(records: list[dict[str, Any]], max_items: int = 8) -> list[str]:
    themes: list[str] = []
    keywords = [
        "价格", "费用", "售后", "质量", "服务", "投诉", "资质", "主体",
        "交付", "案例", "团队", "授权", "保密", "利益冲突", "信用",
        "知名度", "官网", "认证", "口碑", "品牌混淆", "信息不足",
    ]
    q2_answers = "\n".join(str(r.get("answerContent") or "") for r in records if is_q2_record(r))
    for kw in keywords:
        if kw in q2_answers and kw not in themes:
            themes.append(kw)
    return themes[:max_items]


def reference_label(ref: Any) -> str:
    if isinstance(ref, dict):
        for key in ["title", "name", "sourceName", "siteName", "url", "link"]:
            if ref.get(key):
                return str(ref.get(key))
        return json.dumps(ref, ensure_ascii=False)
    return str(ref or "")


def _source_counter(records: list[dict[str, Any]], field: str) -> Counter[str]:
    counter: Counter[str] = Counter()
    for rec in records:
        refs = rec.get(field) or []
        if not isinstance(refs, list):
            continue
        for ref in refs:
            label = reference_label(ref).strip()
            if label:
                counter[label[:110]] += 1
    return counter


def _source_frequency_table(counter: Counter[str], *, empty_text: str) -> str:
    if not counter:
        return f"<p class='muted'>{e(empty_text)}</p>"
    rows = []
    for idx, (label, count) in enumerate(counter.most_common(12), 1):
        rows.append(f"<tr><td>{idx}</td><td>{e(label)}</td><td>{count}</td></tr>")
    return "<table><thead><tr><th>序号</th><th>来源 / 标题</th><th>出现次数</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>"


def reference_table_html(records: list[dict[str, Any]]) -> str:
    """Render answer citations and retrieval-reference fields without conflating them."""
    citations = _source_counter(records, "citationList")
    references = _source_counter(records, "referenceList")
    return (
        "<h4>答案实际引用</h4>"
        + _source_frequency_table(citations, empty_text="本轮答案未返回可识别的实际引用。")
        + "<h4>检索参考来源</h4>"
        + _source_frequency_table(references, empty_text="本轮未返回可识别的检索参考来源。")
    )



def render_brand_source_coverage_html(records: list[dict[str, Any]]) -> str:
    """Render the customer-facing replacement for old “信源生态” sections.

    This is intentionally not a new source-stage-block; it is a decision module
    inside AI visibility diagnosis. Full raw answers and citation details remain
    in the separate monitoring PDF.
    """
    return (
        "<p>品牌信源覆盖用于判断 AI 回答在推荐或评价品牌时主要依赖哪些公开证据、哪些官网/第三方资料更容易被引用，以及后续 GEO 应优先补齐哪些可验证内容。</p>"
        "<h2>品牌信源覆盖与引用结构</h2>"
        + reference_table_html(records)
        + "<div class='key-finding'><strong>优化含义：</strong>如果引用集中在少数平台或缺少官网、权威媒体、案例页、资质页等可核验证据，应优先建设品牌事实页、比较页、FAQ 页和第三方证明材料，让 AI 在回答时有更稳定的引用依据。</div>"
    )



def render_sample_answers(records: list[dict[str, Any]], question_type: str, limit: int = 2) -> str:
    if question_type == "q2":
        selected = [r for r in records if is_q2_record(r) and r.get("answerContent")]
    else:
        selected = [r for r in records if is_q1_record(r) and r.get("answerContent")]
    if not selected:
        return "<p class='muted'>当前未读取到可展示样本回答。</p>"
    blocks: list[str] = []
    for rec in selected[:limit]:
        text = clean_answer_for_display(rec.get("answerContent") or "")
        blocks.append(f"<div class='strategy-box risk-sample'><h4>{e(platform_display(rec.get('platform')))}｜第 {e(rec.get('run_index'))} 次</h4><p>{e(text).replace(chr(10), '<br/>')}</p></div>")
    return "".join(blocks)


# ----------------------------- SVG charts ----------------------------------

def svg_bar_chart(labels: list[str], series: list[tuple[str, list[float]]], *, width: int = 640, height: int = 270) -> str:
    if not labels or not series:
        return "<p class='muted'>当前未读取到可视化数据。</p>"
    max_v = max([v for _, vals in series for v in vals] + [1])
    left, right, top, bottom = 52, 20, 28, 52
    plot_w = width - left - right
    plot_h = height - top - bottom
    group_w = plot_w / max(len(labels), 1)
    bar_w = max(8, group_w / (len(series) + 1) * 0.68)
    palette = ["#7A1FA2", "#A659C9", "#B58A2E", "#3D0A63"]
    parts = [f"<svg class='svg-chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<line x1='{left}' y1='{top + plot_h}' x2='{width - right}' y2='{top + plot_h}' stroke='#D8D8D8'/>")
    for i, label in enumerate(labels):
        gx = left + i * group_w + group_w * 0.15
        parts.append(f"<text x='{left + i * group_w + group_w/2}' y='{height-20}' text-anchor='middle' font-size='11' fill='#555'>{e(label)}</text>")
        for j, (name, vals) in enumerate(series):
            val = vals[i] if i < len(vals) else 0
            bh = 0 if max_v == 0 else (val / max_v) * plot_h
            x = gx + j * (bar_w + 4)
            y = top + plot_h - bh
            parts.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{bh:.1f}' rx='3' fill='{palette[j % len(palette)]}' opacity='.88'/>")
            parts.append(f"<text x='{x + bar_w/2:.1f}' y='{max(y-4, 12):.1f}' text-anchor='middle' font-size='10' fill='#3D0A63'>{int(val) if float(val).is_integer() else round(val,1)}</text>")
    lx = left
    for j, (name, _) in enumerate(series):
        parts.append(f"<rect x='{lx}' y='8' width='10' height='10' rx='2' fill='{palette[j % len(palette)]}'/><text x='{lx+14}' y='17' font-size='11' fill='#555'>{e(name)}</text>")
        lx += 96
    parts.append("</svg>")
    return "".join(parts)


def svg_donut(rate: float, label: str, *, width: int = 260, height: int = 220) -> str:
    rate = max(0.0, min(1.0, rate))
    cx, cy, r = width / 2, 95, 62
    circumference = 2 * math.pi * r
    dash = rate * circumference
    return f"""
<svg class='svg-chart donut' viewBox='0 0 {width} {height}' role='img'>
  <circle cx='{cx}' cy='{cy}' r='{r}' fill='none' stroke='#ECECEC' stroke-width='18'/>
  <circle cx='{cx}' cy='{cy}' r='{r}' fill='none' stroke='#7A1FA2' stroke-width='18' stroke-linecap='round' transform='rotate(-90 {cx} {cy})' stroke-dasharray='{dash:.1f} {circumference-dash:.1f}'/>
  <text x='{cx}' y='{cy-4}' text-anchor='middle' font-size='26' font-weight='700' fill='#7A1FA2'>{round(rate*100)}%</text>
  <text x='{cx}' y='{cy+22}' text-anchor='middle' font-size='12' fill='#555'>{e(label)}</text>
</svg>
"""


def svg_horizontal_bars(items: list[tuple[str, int]], *, width: int = 520, height: int = 260) -> str:
    if not items:
        return "<p class='muted'>当前未读取到竞品提及数据。</p>"
    max_v = max(v for _, v in items) or 1
    left, right, top, row_h = 120, 24, 24, 28
    height = max(height, top + row_h * len(items) + 24)
    plot_w = width - left - right
    parts = [f"<svg class='svg-chart' viewBox='0 0 {width} {height}' role='img'>"]
    for i, (name, val) in enumerate(items):
        y = top + i * row_h
        bw = plot_w * val / max_v
        parts.append(f"<text x='{left-8}' y='{y+17}' text-anchor='end' font-size='12' fill='#444'>{e(name)}</text>")
        parts.append(f"<rect x='{left}' y='{y}' width='{bw:.1f}' height='18' rx='5' fill='#A659C9' opacity='.82'/>")
        parts.append(f"<text x='{left + bw + 6:.1f}' y='{y+14}' font-size='11' fill='#555'>{val}</text>")
    parts.append("</svg>")
    return "".join(parts)


def render_semantic_dimension_chart_html(scorecard: Any) -> str:
    """Render BSAS dimension attainment as a compact horizontal bar chart."""
    if not isinstance(scorecard, dict):
        return ""
    dimensions = scorecard.get("dimensions")
    if not isinstance(dimensions, dict):
        return ""
    specs = [
        ("semantic_visibility", "语义可见度"),
        ("semantic_coherence", "语义一致性"),
        ("semantic_richness", "语义丰富度"),
        ("semantic_authority", "语义权威性"),
        ("competitive_advantage", "竞品占优度"),
    ]
    items: list[tuple[str, int]] = []
    detail_rows: list[str] = []
    for key, label in specs:
        value = dimensions.get(key)
        if not isinstance(value, dict):
            continue
        try:
            score = float(value.get("score"))
            max_score = float(value.get("max_score"))
        except (TypeError, ValueError):
            continue
        if max_score <= 0:
            continue
        attainment = max(0, min(100, round(score / max_score * 100)))
        items.append((label, attainment))
        detail_rows.append(
            f"<tr><td>{e(label)}</td><td>{score:g} / {max_score:g}</td><td>{attainment}%</td></tr>"
        )
    if len(items) < 3:
        return ""
    total = scorecard.get("bsas_total")
    grade = scorecard.get("grade")
    total_line = ""
    if total is not None:
        total_line = f"<div class='takeaway'><strong>BSAS 总分：</strong>{e(total)} / 100"
        if grade:
            total_line += f"（{e(grade)} 级）"
        total_line += "。图中按各维度满分归一化，便于比较短板，不改变原始权重。</div>"
    return (
        "<div class='chart-card semantic-dimension-chart' data-semantic-dimension-chart='true'>"
        "<h4>语义资产五维达成度</h4>"
        + svg_horizontal_bars(items, width=620, height=250)
        + "<p class='chart-caption'>条形长度为“维度得分 ÷ 该维度满分”，用于识别相对短板。</p>"
        + "<table class='compact-table'><thead><tr><th>维度</th><th>原始得分</th><th>达成度</th></tr></thead><tbody>"
        + "".join(detail_rows)
        + "</tbody></table>"
        + total_line
        + "</div>"
    )


def citation_analysis_is_ready(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}
    validation = value.get("validation") if isinstance(value.get("validation"), dict) else {}
    reconciliation = validation.get("reconciliation") if isinstance(validation.get("reconciliation"), dict) else {}
    summary = value.get("summary") if isinstance(value.get("summary"), dict) else {}
    try:
        totals = [
            int(reconciliation.get("media_citation_total")),
            int(reconciliation.get("content_citation_total")),
            int(reconciliation.get("question_record_count")),
        ]
    except (TypeError, ValueError):
        totals = []
    return bool(
        meta.get("data_source") in ("uploaded_citation_analysis_spreadsheet", "molizhishu_api")
        and meta.get("data_confirmation_status") == "confirmed"
        and str(meta.get("source_file") or "").strip()
        and str(meta.get("raw_extracted_file") or "").strip()
        and validation.get("passed") is True
        and reconciliation.get("passed") is True
        and len(totals) == 3
        and totals[0] > 0
        and len(set(totals)) == 1
        and int(summary.get("total_citations") or 0) == totals[0]
    )


def render_uploaded_citation_analysis_html(value: Any) -> str:
    """Render the upload-only citation module in the lower half of S5.5."""
    if not citation_analysis_is_ready(value):
        return ""
    summary = value.get("summary") or {}
    media_analysis = value.get("media_analysis") if isinstance(value.get("media_analysis"), dict) else {}
    content_analysis = value.get("content_analysis") if isinstance(value.get("content_analysis"), dict) else {}
    question_analysis = value.get("question_analysis") if isinstance(value.get("question_analysis"), dict) else {}
    top_sources = [item for item in (media_analysis.get("top_sources") or []) if isinstance(item, dict)]
    top_content = [item for item in (content_analysis.get("top_content") or []) if isinstance(item, dict)]
    top_questions = [item for item in (question_analysis.get("top_questions") or []) if isinstance(item, dict)]

    source_bars: list[tuple[str, int]] = []
    for item in top_sources[:10]:
        label = clean_client_value(item.get("media_name") or item.get("domain"), "未标注信源")
        if len(label) > 16:
            label = label[:15] + "…"
        try:
            count = int(item.get("citation_count") or 0)
        except (TypeError, ValueError):
            count = 0
        if count > 0:
            source_bars.append((label, count))

    chart_parts: list[str] = []
    if source_bars:
        chart_parts.append(
            "<div class='chart-card citation-chart-item' "
            "data-citation-chart-item='source'><h4>Top 10 高频引用信源</h4>"
            + svg_horizontal_bars(source_bars, width=620, height=330)
            + "<p class='chart-caption'>按引用次数排序；高频不自动等于权威或正面。</p></div>"
        )
    source_rows: list[str] = []
    for item in top_sources[:10]:
        source_rows.append(
            "<tr>"
            f"<td>{e(clean_client_value(item.get('domain'), '未标注域名'))}</td>"
            f"<td>{e(clean_client_value(item.get('media_name'), '未标注信源'))}</td>"
            f"<td>{e(item.get('citation_count') or 0)}</td>"
            f"<td>{e(item.get('citation_share_label') or '')}</td>"
            "</tr>"
        )
    content_rows: list[str] = []
    for item in top_content[:8]:
        content_rows.append(
            "<tr>"
            f"<td>{e(clean_client_value(item.get('article_title'), '未标注标题'))}</td>"
            f"<td>{e(clean_client_value(item.get('media_name'), '未标注信源'))}</td>"
            f"<td>{e(item.get('citation_count') or 0)}</td>"
            f"<td>{e(item.get('citation_share_label') or '')}</td>"
            "</tr>"
        )
    question_rows: list[str] = []
    for item in top_questions[:8]:
        question_rows.append(
            "<tr>"
            f"<td>{e(clean_client_value(item.get('name'), '未标注问题'))}</td>"
            f"<td>{e(item.get('citation_count') or 0)}</td>"
            "</tr>"
        )

    return (
        "<div class='citation-analysis-uploaded' data-citation-analysis='uploaded-spreadsheet'>"
        "<h2>品牌信源覆盖与引用结构</h2>"
        "<p>本模块来自用户单独上传并确认的引用分析表，位于语义资产审计下半部分。它分析 AI 使用了哪些信源和内容，不把引用频次直接解释为权威性或正面评价。</p>"
        + (
            "<div class='citation-chart-group "
            + (
                "citation-chart-group--paired"
                if len(chart_parts) == 2
                else "citation-chart-group--stacked"
            )
            + "' data-citation-chart-group='true' "
            "data-pagination-policy='keep-together'>"
            + "".join(chart_parts)
            + "</div>"
            if chart_parts
            else ""
        )
        + (
            "<h3>高频引用信源</h3><table class='compact-table'><thead><tr><th>域名</th><th>媒体名称</th><th>引用次数</th><th>引用占比</th></tr></thead><tbody>"
            + "".join(source_rows) + "</tbody></table>" if source_rows else ""
        )
        + (
            "<h3>高频引用内容</h3><table class='compact-table'><thead><tr><th>文章标题</th><th>媒体名称</th><th>引用次数</th><th>引用占比</th></tr></thead><tbody>"
            + "".join(content_rows) + "</tbody></table>" if content_rows else ""
        )
        + (
            "<h3>高频监控问题</h3><table class='compact-table'><thead><tr><th>监控问题</th><th>引用记录数</th></tr></thead><tbody>"
            + "".join(question_rows) + "</tbody></table>" if question_rows else ""
        )
        + "<h3>信源覆盖补齐优先级</h3>"
        "<ol><li>核验高频信源是否准确承载品牌事实、关键属性、案例与资质，不把高频误当作高质量。</li>"
        "<li>围绕高频问题建设稳定的官网事实页、FAQ、比较页与场景页，并补齐可复核的第三方证明。</li>"
        "<li>对覆盖较弱的重点问题复核内容完整性与可抓取性，避免把样本差异误判为品牌事实缺失。</li>"
        "<li>后续复测保持问题集和时间窗口一致，用高频信源、唯一内容覆盖与问题覆盖稳定性观察变化。</li></ol>"
        "</div>"
    )


SAFE_REPORT_IMAGE_RE = re.compile(r"^assets/[0-9a-f]{16,64}\.(?:png|jpe?g|webp)$", flags=re.I)
VISUAL_ROLE_LABELS = {
    "logo": "品牌 Logo",
    "homepage": "官网主视觉",
    "product": "代表性产品图",
    "case": "代表性案例图",
}
VISUAL_ROLE_CAPTIONS = {
    "logo": "用于校验品牌识别符号、字形与核心色彩。",
    "homepage": "用于校验品牌视觉层级、构图和常见图像语法。",
    "product": "用于校验产品呈现方式、材质表达与使用场景。",
    "case": "用于校验案例证据的视觉呈现与可信度线索。",
}


def render_visual_evidence_gallery_html(gallery: Any) -> str:
    """Render only prepared, report-relative, verified visual evidence assets."""
    assets = gallery.get("assets") if isinstance(gallery, dict) else None
    safe_assets: list[dict[str, Any]] = []
    if isinstance(assets, list):
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            src = str(asset.get("report_src") or "").strip()
            source_type = str(asset.get("source_type") or "").strip()
            if not SAFE_REPORT_IMAGE_RE.fullmatch(src):
                continue
            if source_type not in {"client", "official_website"}:
                continue
            safe_assets.append(asset)
            if len(safe_assets) == 3:
                break
    if not safe_assets:
        return (
            "<div class='visual-evidence-gap' data-visual-evidence-gallery='unavailable'>"
            "本轮未获取到可验证的客户提供或官网真实视觉资产，因此不使用第三方图片或 AI 概念图补位。"
            "</div>"
        )
    cards_html: list[str] = []
    for asset in safe_assets:
        role = str(asset.get("role") or "product")
        label = VISUAL_ROLE_LABELS.get(role, "视觉分析依据")
        caption = clean_client_value(
            asset.get("caption"),
            f"{label}：{VISUAL_ROLE_CAPTIONS.get(role, '用于支撑视觉资产判断。')}",
        )
        src = str(asset["report_src"])
        cards_html.append(
            "<figure class='visual-evidence-card'>"
            f"<div class='visual-evidence-media'><img src='{e(src)}' alt='{e(label)}'/></div>"
            "<figcaption class='visual-evidence-copy'>"
            f"<strong>{e(label)}</strong><p>{e(caption)}</p>"
            "</figcaption></figure>"
        )
    status = "ready" if len(safe_assets) == 3 else "partial"
    return (
        f"<div class='visual-evidence-gallery' data-visual-evidence-gallery='{status}'>"
        + "".join(cards_html)
        + "</div>"
    )


def _visual_source_type(item: dict[str, Any], manifest: dict[str, Any]) -> str | None:
    declared = str(item.get("source_type") or item.get("provided_by") or "").strip().lower()
    if declared in {"client", "client_upload", "client_provided", "客户提供", "用户上传"}:
        return "client"
    if declared in {"official", "official_website", "官网", "official_site"}:
        return "official_website"
    source_url = str(item.get("source_url") or "").strip()
    manifest_meta = manifest.get("meta") if isinstance(manifest.get("meta"), dict) else {}
    official_url = str(
        manifest_meta.get("official_url")
        or manifest_meta.get("source_url")
        or manifest_meta.get("website")
        or ""
    ).strip()
    source_host = (urlparse(source_url).hostname or "").lower()
    official_host = (urlparse(official_url).hostname or "").lower()
    if source_host and official_host and (
        source_host == official_host
        or source_host.endswith("." + official_host)
        or official_host.endswith("." + source_host)
    ):
        return "official_website"
    return None


def _resolve_safe_visual_path(work_dir: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        root = work_dir.resolve(strict=True)
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = root / path
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError):
        return None
    if not resolved.is_file() or resolved.stat().st_size <= 0 or resolved.stat().st_size > 25 * 1024 * 1024:
        return None
    return resolved


def _declared_hash_matches(path: Path, item: dict[str, Any]) -> bool:
    declared = str(item.get("sha256") or item.get("file_hash") or "").lower().strip()
    declared = declared.removeprefix("sha256:")
    if not re.fullmatch(r"[0-9a-f]{64}", declared):
        return True
    return hashlib.sha256(path.read_bytes()).hexdigest() == declared


def _rasterize_verified_image(source: Path, assets_dir: Path) -> tuple[str, str] | None:
    """Validate and re-encode a source image to a metadata-free report PNG."""
    assets_dir.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", dir=assets_dir, delete=False) as tmp:
            temp_path = Path(tmp.name)
        if source.suffix.lower() == ".svg":
            converted = False
            try:
                import cairosvg  # type: ignore
                cairosvg.svg2png(url=str(source), write_to=str(temp_path), output_width=1800)
                converted = True
            except Exception:
                converter = shutil.which("rsvg-convert")
                if converter:
                    subprocess.run(
                        [converter, "-w", "1800", "-o", str(temp_path), str(source)],
                        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    )
                    converted = True
                elif shutil.which("sips"):
                    subprocess.run(
                        ["sips", "-s", "format", "png", str(source), "--out", str(temp_path)],
                        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    )
                    converted = True
            if not converted:
                return None
        else:
            from PIL import Image, ImageOps  # type: ignore
            with Image.open(source) as probe:
                probe.verify()
            with Image.open(source) as image:
                image.seek(0)
                image = ImageOps.exif_transpose(image)
                if image.width < 32 or image.height < 32:
                    return None
                image.thumbnail((2400, 2400))
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA")
                image.save(temp_path, format="PNG", optimize=True)
        from PIL import Image  # type: ignore
        with Image.open(temp_path) as check:
            check.verify()
        raw = temp_path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        destination = assets_dir / f"{digest}.png"
        if destination.exists():
            temp_path.unlink(missing_ok=True)
        else:
            temp_path.replace(destination)
        return f"assets/{destination.name}", digest
    except Exception:
        return None
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _visual_manifest_candidates(manifest: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    assets = manifest.get("assets") if isinstance(manifest.get("assets"), dict) else {}
    enterprise = manifest.get("enterprise_photos") if isinstance(manifest.get("enterprise_photos"), dict) else {}
    groups: list[tuple[str, Any]] = [
        ("logo", assets.get("logos")),
        ("homepage", assets.get("screenshots")),
        ("homepage", assets.get("og_images")),
        ("homepage", assets.get("banners")),
    ]
    result: list[tuple[str, dict[str, Any]]] = []
    for role, values in groups:
        if isinstance(values, list):
            result.extend((role, item) for item in values if isinstance(item, dict))
    photos = enterprise.get("photos")
    if isinstance(photos, list):
        for item in photos:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or item.get("photo_type") or "").lower()
            result.append(("case" if "case" in category or "案例" in category else "product", item))
    return result


def prepare_visual_evidence_gallery(
    manifest: Any,
    work_dir: Path,
    report_dir: Path,
) -> dict[str, Any]:
    """Select, verify, and copy at most one real asset for each evidence role."""
    if not isinstance(manifest, dict):
        return {"status": "unavailable", "assets": []}
    prepared: list[dict[str, Any]] = []
    used_roles: set[str] = set()
    seen_source_paths: set[str] = set()
    for role, item in _visual_manifest_candidates(manifest):
        if role in used_roles:
            continue
        source_type = _visual_source_type(item, manifest)
        if source_type is None:
            continue
        source = _resolve_safe_visual_path(
            work_dir,
            item.get("local_path") or item.get("path") or item.get("file_path"),
        )
        if source is None or str(source) in seen_source_paths or not _declared_hash_matches(source, item):
            continue
        converted = _rasterize_verified_image(source, report_dir / "assets")
        if converted is None:
            continue
        report_src, digest = converted
        label = VISUAL_ROLE_LABELS.get(role, "视觉分析依据")
        prepared.append({
            "asset_id": str(item.get("asset_id") or digest[:16]),
            "role": role,
            "report_src": report_src,
            "source_type": source_type,
            "caption": f"{label}：{VISUAL_ROLE_CAPTIONS.get(role, '用于支撑视觉资产判断。')}",
            "sha256": digest,
        })
        used_roles.add(role)
        seen_source_paths.add(str(source))
        if len(prepared) == 3:
            break
    status = "ready" if len(prepared) == 3 else ("partial" if prepared else "unavailable")
    return {"status": status, "assets": prepared}


def build_competitor_aliases(positioning_json: Any, brand: str) -> dict[str, list[str]]:
    """Build aliases only from the current project's S4 positioning data."""
    canon: dict[str, list[str]] = {}

    def add(name: str, aliases: list[str] | None = None):
        name = (name or "").strip()
        if not name:
            return
        if brand and (name == brand or brand in name):
            return
        canon.setdefault(name, [])
        for a in (aliases or []):
            if a and a not in canon[name]:
                canon[name].append(a)
        if name not in canon[name]:
            canon[name].insert(0, name)

    # Current-project positioning competitors only. Generic industry defaults
    # would contaminate cross-industry visibility metrics.
    if isinstance(positioning_json, dict):
        mm = positioning_json.get("mind_map")
        if isinstance(mm, dict):
            for c in (mm.get("competitors") or []):
                if isinstance(c, dict):
                    add(str(c.get("name") or ""))
            for c in (mm.get("coordinates") or []):
                if isinstance(c, dict):
                    add(str(c.get("brand") or c.get("name") or ""))
        dm = positioning_json.get("differentiation_matrix")
        if isinstance(dm, dict):
            cs = dm.get("competitor_scores")
            if isinstance(cs, dict):
                for k in cs.keys():
                    add(str(k))
        profiles = positioning_json.get("competitor_profiles")
        if isinstance(profiles, list):
            for profile in profiles:
                if isinstance(profile, dict):
                    add(
                        str(profile.get("name") or profile.get("brand") or ""),
                        [
                            str(alias)
                            for alias in (profile.get("aliases") or [])
                            if alias
                        ],
                    )
        normalized = normalize_differentiation_matrix(positioning_json, brand)
        for name in normalized.get("competitors", []):
            add(str(name))
    return canon


def render_ai_visibility_charts(records: list[dict[str, Any]], summary: dict[str, Any], brand: str, company_name: str = "", positioning_json: Any = None) -> str:
    grouped: dict[str, dict[str, int]] = {}
    q1_total = 0
    q1_mentions = 0
    comp_aliases = build_competitor_aliases(positioning_json, brand)
    comp_counts: Counter[str] = Counter()
    for rec in records:
        platform = str(rec.get("platform") or "unknown")
        row = grouped.setdefault(platform, {"mentions": 0, "comp_mentions": 0})
        answer = str(rec.get("answerContent") or "")
        if is_q1_record(rec):
            q1_total += 1
            if record_brand_mentioned(rec, brand, company_name):
                row["mentions"] += 1
                q1_mentions += 1
            
            comp_mentioned = False
            for canonical, aliases in comp_aliases.items():
                if any(a and a in answer for a in aliases):
                    comp_counts[canonical] += 1
                    comp_mentioned = True
            if comp_mentioned:
                row["comp_mentions"] += 1
                
    labels = [platform_display(k) for k in sorted(grouped)]
    mentions = [grouped[k]["mentions"] for k in sorted(grouped)]
    comp_mentions = [grouped[k]["comp_mentions"] for k in sorted(grouped)]
    mention_rate = q1_mentions / q1_total if q1_total else 0
    comp_top = comp_counts.most_common(8)
    return f"""
<div class='chart-grid'>
  <div class='chart-card'><h4>品牌与重点竞品可见度对比</h4>{svg_bar_chart(labels, [('品牌提及', mentions), ('重点竞品命中回答数', comp_mentions)])}<p class='chart-caption'>各平台推荐可见度问题中，品牌提及与基于 S4 指定重点竞品词统计的命中回答数对比。</p></div>
  <div class='chart-card compact'><h4>品牌总体可见度</h4>{svg_donut(mention_rate, '可见度')}<p class='chart-caption'>{e(q1_mentions)} / {e(q1_total)} 条正向回答中提及本品牌。</p></div>
  <div class='chart-card'><h4>主要竞品占位</h4>{svg_horizontal_bars([(name, val) for name, val in comp_top])}<p class='chart-caption'>判断推荐心智主要被哪些竞品占据。</p></div>
</div>
"""


def render_monitoring_data_file_index(summary: dict[str, Any], records: list[dict[str, Any]], brand: str) -> str:
    files = [
        ("监控原始数据 JSON", "监控原始数据.json", "结构化记录，可用于复测与指标计算。"),
        ("品牌诊断报告 PDF", "品牌诊断报告.pdf", "可见性评分、竞品对比与诊断依据。"),
        ("Gap 分析报告 PDF", "Gap分析报告.pdf", "品牌与竞品之间的差距分析。"),
    ]
    cards_html = ["<div class='evidence-file-grid'>"]
    for title, fname, desc in files:
        cards_html.append(f"<div class='evidence-file-card'><strong>{e(title)}</strong><p>{e(desc)}</p><span>{e(fname)}</span></div>")
    cards_html.append("</div>")
    cards_html.append("<div class='key-finding'><strong>查阅说明：</strong>全景报告只呈现决策级指标与关键结论；逐条答案明细已并入本报告的证据章节，结构化监控记录随交付包归档，便于复测与指标计算。</div>")
    return "".join(cards_html)


# ----------------------------- trend rendering ------------------------------

TREND_CATEGORY_LABELS = {
    "macro": "宏观环境趋势", "technology": "技术趋势", "consumer": "消费趋势",
    "policy": "政策/合规趋势", "cultural_weak_signal": "文化弱信号",
}

LIFECYCLE_LABELS = {"emerging": "萌芽期", "growth": "成长期", "mature": "成熟期", "declining": "衰退期", "early_growth": "早期增长"}


def normalize_trends(scorecard: Any) -> list[dict[str, Any]]:
    if not isinstance(scorecard, dict):
        return []
    raw = scorecard.get("trends") or scorecard.get("trend_scores") or scorecard.get("items") or []
    if isinstance(raw, dict):
        raw = list(raw.values())
    trends = [t for t in raw if isinstance(t, dict)]
    for idx, t in enumerate(trends):
        t.setdefault("trend_id", t.get("id") or f"TR{idx+1:03d}")
        t.setdefault("name", t.get("trend_name") or t.get("title") or t.get("趋势") or f"趋势 {idx+1}")
    return trends


def trend_score(t: dict[str, Any]) -> float:
    for key in ["total_score", "weighted_total_score", "weighted_score", "score", "总分", "total"]:
        try:
            if t.get(key) is not None:
                return float(t.get(key))
        except Exception:
            continue
    scores = t.get("scores") if isinstance(t.get("scores"), dict) else {}
    vals = []
    for key in ["brand_fit", "growth_momentum", "competitive_whitespace", "time_window"]:
        try:
            if scores.get(key) is not None:
                vals.append(float(scores.get(key)))
        except Exception:
            pass
    return round(sum(vals) / len(vals), 2) if vals else 0.0



def trend_dim(t: dict[str, Any], key: str) -> Any:
    scores = t.get("scores") if isinstance(t.get("scores"), dict) else {}
    aliases = {
        "brand_fit": ["brand_fit", "品牌契合", "brand_fit_score", "brand_fit_score_10"],
        "growth_momentum": ["growth_momentum", "增长势能", "growth_score", "growth_momentum_score"],
        "competitive_whitespace": ["competitive_whitespace", "竞争空位", "whitespace_score", "competitive_whitespace_score"],
    }
    for k in aliases.get(key, [key]):
        if t.get(k) is not None:
            return t.get(k)
        if scores.get(k) is not None:
            return scores.get(k)
    return None


def trend_numeric_dim(t: dict[str, Any], key: str, fallback: float | None = None) -> float | None:
    v = trend_dim(t, key)
    try:
        if v is not None and str(v).strip() not in {"", "-"}:
            return float(v)
    except Exception:
        pass
    return fallback


def trend_display_dim(t: dict[str, Any], key: str) -> str:
    v = trend_dim(t, key)
    if v is None or str(v).strip() in {"", "-"}:
        if key == "growth_momentum":
            return f"{trend_score(t):.1f}（以总分代理）"
        if key == "competitive_whitespace":
            return "未单独评分"
        return "未单独评分"
    return str(v)


def trend_growth_for_chart(t: dict[str, Any]) -> float:
    return trend_numeric_dim(t, "growth_momentum", trend_score(t)) or trend_score(t)


def trend_fit_for_chart(t: dict[str, Any]) -> float:
    return trend_numeric_dim(t, "brand_fit", trend_score(t)) or trend_score(t)



def render_market_opportunity_summary(scorecard: Any, product: str, has_text: bool) -> str:
    trends = sorted(normalize_trends(scorecard), key=trend_score, reverse=True)
    top_names = [clean_client_value(t.get("name"), "未命名趋势") for t in trends[:3]]
    high = [t for t in trends if trend_score(t) >= 8.0] or trends[:3]
    category = clean_client_value(product, "核心品类")
    summary = "、".join(top_names) if top_names else "趋势材料尚需补充"
    return f"""
<div class='data-cards'>
  <div class='data-card card-purple'><span class='number'>{e(category)}</span><span class='label'>品类范围</span><span class='sublabel'>来自客户核心产品字段</span></div>
  <div class='data-card card-blue'><span class='number'>{len(trends)}</span><span class='label'>趋势池规模</span><span class='sublabel'>已纳入机会评估</span></div>
  <div class='data-card card-green'><span class='number'>{len(high)}</span><span class='label'>高优先机会</span><span class='sublabel'>进入定位与证据建设</span></div>
</div>
<div class='key-finding'><strong>趋势判断摘要：</strong>当前更值得优先转译为品牌叙事的机会包括 {e(summary)}。最终策略不只是罗列趋势，而是把高契合趋势转为品牌可占据的心智、内容主题和可信证据。</div>
"""



def render_trend_radar_html(scorecard: Any) -> str:
    trends = sorted(normalize_trends(scorecard), key=trend_score, reverse=True)
    if not trends:
        return "<p class='muted'>当前未读取到结构化趋势打分卡。</p>"
    rows = ["<table class='long-table'><thead><tr><th>趋势</th><th>类型/阶段</th><th>总分</th><th>品牌契合</th><th>增长势能</th><th>竞争空位</th><th>机会含义</th></tr></thead><tbody>"]
    for t in trends[:12]:
        typ = t.get("type") or t.get("category") or t.get("趋势类型") or ""
        life = t.get("lifecycle_stage") or t.get("stage") or t.get("阶段") or ""
        typ_label = TREND_CATEGORY_LABELS.get(str(typ), str(typ or "-"))
        life_label = LIFECYCLE_LABELS.get(str(life), str(life or "-"))
        opportunity = t.get("opportunity") or t.get("strategic_implication") or t.get("机会含义") or t.get("recommendation") or "需补充机会解释"
        rows.append(f"<tr><td><strong>{e(clean_client_value(t.get('name'), '未命名趋势'))}</strong></td><td>{e(typ_label)}<br/>{e(life_label)}</td><td class='td-purple'>{trend_score(t)}</td><td>{e(trend_display_dim(t, 'brand_fit'))}</td><td>{e(trend_display_dim(t, 'growth_momentum'))}</td><td>{e(trend_display_dim(t, 'competitive_whitespace'))}</td><td>{e(clean_client_value(opportunity, '需补充机会解释'))}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def classify_opportunities(scorecard: Any) -> dict[str, list[dict[str, Any]]]:
    trends = sorted(normalize_trends(scorecard), key=trend_score, reverse=True)
    if not trends:
        return {"P0 抢占": [], "P1 培育": [], "P2 观察": []}
    p0 = [t for t in trends if trend_score(t) >= 8.0]
    p1 = [t for t in trends if 7.2 <= trend_score(t) < 8.0]
    p2 = [t for t in trends if trend_score(t) < 7.2]
    if not p0 and trends:
        p0, p1, p2 = trends[:3], trends[3:7], trends[7:]
    return {"P0 抢占": p0, "P1 培育": p1, "P2 观察": p2}


def render_opportunity_priority_html(scorecard: Any) -> str:
    buckets = classify_opportunities(scorecard)
    rows = ["<table><thead><tr><th>优先级</th><th>趋势机会</th><th>战略处理方式</th></tr></thead><tbody>"]
    handling = {"P0 抢占": "立即写入定位叙事、官网核心页面、FAQ 和第三方证明材料建设", "P1 培育": "进入内容日历、案例包装、场景页和社媒话题", "P2 观察": "保留监测，不作为短期资源投入重点"}
    for bucket, items in buckets.items():
        names = "、".join(clean_client_value(t.get("name"), "未命名趋势") for t in items[:5]) or "资料仍需补充"
        rows.append(f"<tr><td class='td-purple'>{e(bucket)}</td><td>{e(names)}</td><td>{e(handling[bucket])}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)



def svg_trend_bubble_chart(trends: list[dict[str, Any]], *, width: int = 760, height: int = 430) -> str:
    """Opportunity map: X=brand fit, Y=growth momentum, bubble size=total score."""
    if not trends:
        return "<p class='muted'>当前未读取到足够趋势数据，建议先补齐趋势打分卡。</p>"
    left, right, top, bottom = 82, 38, 46, 76
    plot_w = width - left - right
    plot_h = height - top - bottom
    parts = [f"<svg class='svg-chart trend-bubble' viewBox='0 0 {width} {height}' role='img'>"]
    mid_x = left + plot_w * 0.7
    mid_y = top + plot_h - plot_h * 0.7
    parts.append(f"<rect x='{left}' y='{top}' width='{plot_w}' height='{plot_h}' rx='10' fill='#FBF7FD'/>")
    parts.append(f"<rect x='{mid_x}' y='{top}' width='{left+plot_w-mid_x}' height='{mid_y-top}' fill='#EAF8F0' opacity='.75'/>")
    parts.append(f"<rect x='{left}' y='{top}' width='{mid_x-left}' height='{mid_y-top}' fill='#FFF7E8' opacity='.65'/>")
    parts.append(f"<rect x='{mid_x}' y='{mid_y}' width='{left+plot_w-mid_x}' height='{top+plot_h-mid_y}' fill='#EFF7FF' opacity='.72'/>")
    for tick in range(0, 11, 2):
        x = left + plot_w * tick / 10
        y = top + plot_h - plot_h * tick / 10
        parts.append(f"<line x1='{x:.1f}' y1='{top}' x2='{x:.1f}' y2='{top+plot_h}' stroke='#E7DDEE' stroke-width='1'/>")
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{left+plot_w}' y2='{y:.1f}' stroke='#E7DDEE' stroke-width='1'/>")
        parts.append(f"<text x='{x:.1f}' y='{top+plot_h+20}' text-anchor='middle' font-size='10' fill='#667085'>{tick}</text>")
        parts.append(f"<text x='{left-12}' y='{y+3:.1f}' text-anchor='end' font-size='10' fill='#667085'>{tick}</text>")
    parts.append(f"<line x1='{left}' y1='{top+plot_h}' x2='{left+plot_w}' y2='{top+plot_h}' stroke='#57068C' stroke-width='1.4'/>")
    parts.append(f"<line x1='{left}' y1='{top}' x2='{left}' y2='{top+plot_h}' stroke='#57068C' stroke-width='1.4'/>")
    parts.append(f"<text x='{left + plot_w/2}' y='{height-25}' text-anchor='middle' font-size='13' fill='#57068C' font-weight='700'>品牌契合度</text>")
    parts.append(f"<text x='24' y='{top + plot_h/2}' text-anchor='middle' font-size='13' fill='#57068C' font-weight='700' transform='rotate(-90 24 {top + plot_h/2})'>增长势能</text>")
    parts.append(f"<text x='{mid_x+72}' y='{top+22}' text-anchor='middle' font-size='12' fill='#147A45' font-weight='700'>优先抢占</text>")
    parts.append(f"<text x='{left+96}' y='{top+22}' text-anchor='middle' font-size='12' fill='#B65C00' font-weight='700'>培育观察</text>")
    palette = ['#57068C', '#1B75BB', '#147A45', '#B65C00', '#C0392B', '#8B139C', '#2E7D32', '#1565C0']
    top_trends = sorted(trends, key=trend_score, reverse=True)[:10]
    for i, t in enumerate(top_trends):
        fit = max(0, min(10, trend_fit_for_chart(t)))
        growth = max(0, min(10, trend_growth_for_chart(t)))
        total = trend_score(t)
        x = left + plot_w * fit / 10
        y = top + plot_h - plot_h * growth / 10
        r = 10 + max(0, min(10, total)) * 1.65
        color = palette[i % len(palette)]
        label = clean_client_value(t.get('trend_id') or f'TR{i+1:02d}', f'TR{i+1:02d}')
        dx = 16 if i % 2 == 0 else -16
        anchor = 'start' if dx > 0 else 'end'
        parts.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='{r:.1f}' fill='{color}' opacity='.84' stroke='#fff' stroke-width='2'/>")
        parts.append(f"<text x='{x:.1f}' y='{y+4:.1f}' text-anchor='middle' font-size='9.5' font-weight='800' fill='#fff'>{e(label)}</text>")
        parts.append(f"<text x='{x+dx:.1f}' y='{y-r-5:.1f}' text-anchor='{anchor}' font-size='10' fill='#344054'>{e(round(total,2))}</text>")
    parts.append("</svg>")
    return "".join(parts)



def render_trend_opportunity_chart_html(scorecard: Any) -> str:
    trends = sorted(normalize_trends(scorecard), key=trend_score, reverse=True)
    if not trends:
        return ""
    legend_rows = []
    for t in trends[:6]:
        legend_rows.append(f"<tr><td>{e(clean_client_value(t.get('trend_id'), 'TR'))}</td><td>{e(clean_client_value(t.get('name'), '未命名趋势'))}</td><td>{trend_score(t)}</td></tr>")
    legend = "<table class='compact-table bubble-legend'><thead><tr><th>代码</th><th>趋势机会</th><th>总分</th></tr></thead><tbody>" + "".join(legend_rows) + "</tbody></table>"
    return f"""
<div class='chart-card bubble-card' data-trend-opportunity-chart='true'><h4>趋势机会矩阵</h4>{svg_trend_bubble_chart(trends)}<p class='chart-caption'>横轴为品牌契合度；纵轴优先读取增长势能，若上游未单独评分则以趋势总分代理；气泡大小代表总分。</p>{legend}</div>
"""


def render_positioning_mind_map_html(positioning_json: Any, brand: str) -> str:
    """Render a client-safe positioning mind map from S4 structured data
    (mind_map.brand_position + mind_map.competitors + identified_gap)."""
    if not isinstance(positioning_json, dict):
        return "<div class='key-finding'><strong>竞争卡位判断：</strong>当前定位资料仍需补充结构化心智地图。</div>"
    mind = positioning_json.get('mind_map') or positioning_json.get('positioning_map') or positioning_json.get('competitive_positioning')
    if not isinstance(mind, dict):
        stmt = positioning_statement(positioning_json, brand)
        diff = clean_client_value(stmt.get('differentiator') or stmt.get('full_statement'), '品牌差异化价值')
        return f"<div class='key-finding'><strong>竞争卡位判断：</strong>{e(brand)} 应围绕“{e(diff)}”建立统一竞争表达。</div>"
    # Build the point list from structured fields: brand_position + competitors
    points: list[dict[str, Any]] = []
    bp = mind.get('brand_position')
    if isinstance(bp, dict):
        points.append({'name': brand, 'x': bp.get('x', 5), 'y': bp.get('y', 5), 'is_brand': True})
    comps = mind.get('competitors')
    if isinstance(comps, list):
        for c in comps:
            if isinstance(c, dict):
                points.append({'name': c.get('name') or '竞品', 'x': c.get('x', 5), 'y': c.get('y', 5), 'is_brand': False})
    # Backward-compatible fallback to flat brands/points lists
    if not points:
        for item in (mind.get('brands') or mind.get('points') or []):
            if isinstance(item, dict):
                nm = item.get('name') or item.get('brand') or '竞品'
                points.append({'name': nm, 'x': item.get('x', item.get('x_score', 5)), 'y': item.get('y', item.get('y_score', 5)),
                               'is_brand': (str(nm).lower() == brand.lower() or brand.lower() in str(nm).lower())})
    if not points:
        return "<div class='key-finding'><strong>竞争卡位判断：</strong>当前结构化心智地图缺少品牌点位。</div>"
    width, height = 620, 340
    left, right, top, bottom = 74, 36, 32, 60
    plot_w = width - left - right
    plot_h = height - top - bottom
    x_label = mind.get('x_axis') if isinstance(mind.get('x_axis'), str) else ((mind.get('x_axis') or {}).get('label') if isinstance(mind.get('x_axis'), dict) else '维度 X')
    y_label = mind.get('y_axis') if isinstance(mind.get('y_axis'), str) else ((mind.get('y_axis') or {}).get('label') if isinstance(mind.get('y_axis'), dict) else '维度 Y')
    parts = [f"<svg class='svg-chart' viewBox='0 0 {width} {height}' role='img'>"]
    # quadrant shading: top-right is the opportunity gap
    parts.append(f"<rect x='{left+plot_w/2}' y='{top}' width='{plot_w/2}' height='{plot_h/2}' fill='#FAF6FD' opacity='.7'/>")
    for tick in range(0, 11, 2):
        x = left + plot_w * tick / 10
        y = top + plot_h - plot_h * tick / 10
        parts.append(f"<line x1='{x:.1f}' y1='{top}' x2='{x:.1f}' y2='{top+plot_h}' stroke='#F5ECFA'/>")
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{left+plot_w}' y2='{y:.1f}' stroke='#F5ECFA'/>")
    parts.append(f"<line x1='{left}' y1='{top+plot_h}' x2='{left+plot_w}' y2='{top+plot_h}' stroke='#C9A6E0'/>")
    parts.append(f"<line x1='{left}' y1='{top}' x2='{left}' y2='{top+plot_h}' stroke='#C9A6E0'/>")
    parts.append(f"<text x='{left+plot_w/2}' y='{height-16}' text-anchor='middle' font-size='11.5' fill='#7A1FA2'>{e(x_label)}</text>")
    parts.append(f"<text x='16' y='{top+plot_h/2}' text-anchor='middle' font-size='11.5' fill='#7A1FA2' transform='rotate(-90 16 {top+plot_h/2})'>{e(y_label)}</text>")
    gap = clean_client_value(mind.get('identified_gap'), '')
    if gap:
        parts.append(f"<text x='{left+plot_w*0.75:.1f}' y='{top+16:.1f}' text-anchor='middle' font-size='10' fill='#A659C9' font-weight='700'>机会空位</text>")
    for it in points[:12]:
        try:
            xs = float(it.get('x', 5)); ys = float(it.get('y', 5))
        except Exception:
            xs, ys = 5.0, 5.0
        x = left + plot_w * max(0, min(10, xs)) / 10
        y = top + plot_h - plot_h * max(0, min(10, ys)) / 10
        is_brand = bool(it.get('is_brand'))
        color = '#C0392B' if is_brand else '#8B139C'
        r = 11 if is_brand else 8
        parts.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='{r}' fill='{color}' opacity='{0.95 if is_brand else 0.8}' stroke='#fff' stroke-width='2'/>")
        fw = "800" if is_brand else "500"
        parts.append(f"<text x='{x+13:.1f}' y='{y+4:.1f}' font-size='10' font-weight='{fw}' fill='#33304A'>{e(it.get('name'))}</text>")
    parts.append('</svg>')
    cap = f"紫点为竞品、红点为 {e(brand)}；右上象限为尚未被充分占据的机会空位。"
    gap_line = f"<div class='takeaway' style='margin-top:8px'><strong>机会空位：</strong>{e(gap)}</div>" if gap else ''
    return f"<div class='chart-card'><h4>竞品心智地图</h4>{''.join(parts)}<p class='chart-caption'>{cap}</p>{gap_line}</div>"


def render_geo_roadmap_visual_html() -> str:
    steps = [
        ('0-30天', '事实与定位校准', '实体事实、定位句、证据链'),
        ('31-60天', '问答与证据建设', 'FAQ、比较页、场景页、第三方证明'),
        ('61-90天', '趋势叙事放大', '内容资产、案例、品类解释'),
        ('持续复盘', '监控与迭代', '固定问题复测与策略修正'),
    ]
    width, height = 720, 190
    start_x, gap, y = 80, 170, 82
    parts = [f"<svg class='svg-chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<line x1='{start_x}' y1='{y}' x2='{start_x + gap*3}' y2='{y}' stroke='#E6D8F2' stroke-width='4' stroke-linecap='round'/>")
    for i, (phase, title, desc) in enumerate(steps):
        x = start_x + gap * i
        parts.append(f"<circle cx='{x}' cy='{y}' r='24' fill='#8B139C' opacity='.92'/>")
        parts.append(f"<text x='{x}' y='{y+5}' text-anchor='middle' font-size='12' fill='#fff' font-weight='700'>{i+1}</text>")
        parts.append(f"<text x='{x}' y='{y-42}' text-anchor='middle' font-size='12' fill='#57068C' font-weight='700'>{e(phase)}</text>")
        parts.append(f"<text x='{x}' y='{y+52}' text-anchor='middle' font-size='12' fill='#333' font-weight='700'>{e(title)}</text>")
        parts.append(f"<text x='{x}' y='{y+70}' text-anchor='middle' font-size='10' fill='#666'>{e(desc)}</text>")
    parts.append('</svg>')
    return f"<div class='chart-card'><h4>90 天行动时间轴</h4>{''.join(parts)}<p class='chart-caption'>把 GEO 修复拆为“校准-建设-放大-复盘”四个阶段。</p></div>"


def render_geo_workflow_diagram_html() -> str:
    """读取并内嵌 GEO 业务流程图 SVG（放在报告最后一部分，替代原 90 天路线图）。
    SVG 作为模板资源文件随工作流一起交付，保证自包含、可编辑。"""
    svg_path = Path(__file__).resolve().parents[1] / "templates" / "geo_workflow_diagram.svg"
    svg = read_text(svg_path)
    if not svg.strip():
        return "<p class='muted'>GEO 业务流程图资源缺失。</p>"
    # 让 SVG 在 A4 页面内自适应宽度：强制 width:100%/height:auto，去掉原固定宽高。
    svg = re.sub(r"<svg\b", "<svg style='width:100%;height:auto;display:block'", svg, count=1)
    return (
        "<div class='geo-workflow-diagram' data-geo-workflow='true'>"
        + svg +
        "<p class='chart-caption'>GEO 业务流程：从策略洞察到持续迭代的客户可感知闭环。</p></div>"
    )


# -------------------------- positioning rendering ---------------------------

def extract_positioning_statement_from_text(text: str, brand: str) -> dict[str, Any]:
    cleaned = strip_internal_report_scaffolding(text)
    flat = re.sub(r"\s+", " ", cleaned)
    out: dict[str, Any] = {}
    m = re.search(r"对(.{4,80}?)而言[，,]\s*([^，。]{1,80}?)(?:\s+)?是(.{4,120}?品类)中[，,]\s*以[“\"]?(.{4,120}?)[”\"]?(?:的|重新|定义)(.{0,80}?)(?:。|$)", flat)
    if m:
        out["target_audience"] = m.group(1).strip()
        out["brand"] = m.group(2).strip() or brand
        out["category"] = m.group(3).strip()
        out["differentiator"] = m.group(4).strip()
        out["full_statement"] = m.group(0).strip(" 。") + "。"
    else:
        lines = [ln.strip() for ln in cleaned.splitlines() if "而言" in ln and "是" in ln and "品类" in ln]
        if lines:
            out["full_statement"] = lines[0]
    evidence: list[str] = []
    for line in cleaned.splitlines():
        s = line.strip(" -•\t")
        if re.match(r"^\d+[\.、]\s*", s):
            s = re.sub(r"^\d+[\.、]\s*", "", s)
            if 8 <= len(s) <= 160:
                evidence.append(s)
        elif any(kw in s for kw in [
            "市场份额", "资质", "机构代码", "专利", "认证", "案例",
            "团队", "服务", "技术", "经营", "信源", "证据",
        ]):
            if 8 <= len(s) <= 160:
                evidence.append(s)
    if evidence:
        out["evidence"] = evidence[:5]
    return out


def extract_value_triangle_from_text(text: str) -> dict[str, str]:
    cleaned = strip_internal_report_scaffolding(text)
    mapping = {"functional_value": ["功能价值", "Functional Value"], "emotional_value": ["情感价值", "Emotional Value"], "self_expression_value": ["自我表达价值", "Self-Expression Value", "Self Expression Value"]}
    out: dict[str, str] = {}
    for key, names in mapping.items():
        for name in names:
            m = re.search(rf"{re.escape(name)}\s*[:：]\s*([^\n]+)", cleaned, flags=re.I)
            if m:
                out[key] = m.group(1).strip(" -•\t")
                break
    return out


def enrich_positioning_data(pos_data: dict[str, Any] | None, s4_text: str, brand: str) -> dict[str, Any]:
    parsed_stmt = extract_positioning_statement_from_text(s4_text, brand)
    parsed_triangle = extract_value_triangle_from_text(s4_text)
    base: dict[str, Any] = dict(pos_data) if isinstance(pos_data, dict) else {}
    stmt = base.get("positioning_statement") if isinstance(base.get("positioning_statement"), dict) else {}
    stmt = dict(stmt) if isinstance(stmt, dict) else {}
    for key, value in parsed_stmt.items():
        if key == "evidence":
            old_ev = stmt.get("evidence") if isinstance(stmt.get("evidence"), list) else []
            if not old_ev:
                stmt["evidence"] = value
        elif is_invalid_client_value(stmt.get(key)):
            stmt[key] = value
    if is_invalid_client_value(stmt.get("brand")):
        stmt["brand"] = brand
    if not stmt.get("full_statement") and not any(is_invalid_client_value(stmt.get(k)) for k in ["target_audience", "category", "differentiator"]):
        stmt["full_statement"] = f"对{stmt['target_audience']}而言，{stmt.get('brand', brand)} 是{stmt['category']}中，以{stmt['differentiator']}形成差异化价值的选择。"
    base["positioning_statement"] = stmt
    triangle = base.get("value_triangle") if isinstance(base.get("value_triangle"), dict) else {}
    triangle = dict(triangle) if isinstance(triangle, dict) else {}
    for key, value in parsed_triangle.items():
        if is_invalid_client_value(triangle.get(key)):
            triangle[key] = value
    if triangle:
        base["value_triangle"] = triangle
    return base


def positioning_statement(positioning_json: Any, brand: str) -> dict[str, Any]:
    if not isinstance(positioning_json, dict):
        return {"brand": brand}
    stmt = positioning_json.get("positioning_statement") if isinstance(positioning_json.get("positioning_statement"), dict) else {}
    return stmt if isinstance(stmt, dict) else {"brand": brand}


def render_positioning_statement_card(positioning_json: Any, brand: str) -> str:
    stmt = positioning_statement(positioning_json, brand)
    fallback_statement = f"{brand} 应在核心品类中围绕清晰人群、品类归属、差异化价值和可验证证据链建立统一定位。"
    full = clean_client_value(stmt.get("full_statement"), fallback_statement)
    target = clean_client_value(stmt.get("target_audience"), "核心目标消费人群")
    category = clean_client_value(stmt.get("category"), "核心品类")
    diff = clean_client_value(stmt.get("differentiator"), "差异化价值主张")
    evidence = stmt.get("evidence") if isinstance(stmt.get("evidence"), list) else []
    if evidence:
        evidence_html = "<ul>" + "".join(f"<li>{e(clean_client_value(item, ''))}</li>" for item in evidence[:5] if clean_client_value(item, "")) + "</ul>"
    else:
        evidence_html = "<p>需进一步用官网事实、产品矩阵、资质、案例和第三方报道补齐可引用证据。</p>"
    return f"""
<div class='positioning-statement'>“{e(full)}”</div>
<table><thead><tr><th>定位要素</th><th>内容</th></tr></thead><tbody>
<tr><td>目标人群</td><td>{e(target)}</td></tr>
<tr><td>品类归属</td><td>{e(category)}</td></tr>
<tr><td>差异化价值</td><td>{e(diff)}</td></tr>
<tr><td>品牌</td><td>{e(clean_client_value(stmt.get('brand'), brand))}</td></tr>
</tbody></table>
<div class='key-finding'><strong>证据链方向：</strong>{evidence_html}</div>
"""


def render_value_triangle_table(positioning_json: Any) -> str:
    triangle = positioning_json.get("value_triangle") if isinstance(positioning_json, dict) and isinstance(positioning_json.get("value_triangle"), dict) else {}
    rows = [
        ("功能价值", clean_client_value(triangle.get("functional_value"), "用产品/服务解决用户的具体任务与使用问题"), "明确 AI 回答中的基础推荐理由"),
        ("情感价值", clean_client_value(triangle.get("emotional_value"), "建立选择品牌带来的心理感受、信任感和愉悦感"), "让品牌从功能选择进入情绪与信任语境"),
        ("自我表达价值", clean_client_value(triangle.get("self_expression_value"), "让选择品牌代表一种生活方式、身份标准或态度"), "帮助品牌形成更难被竞品替代的心智"),
    ]
    html_rows = ["<table><thead><tr><th>价值层</th><th>当前表达</th><th>咨询解读</th></tr></thead><tbody>"]
    for layer, value, comment in rows:
        html_rows.append(f"<tr><td class='td-purple'>{e(layer)}</td><td>{e(value)}</td><td>{e(comment)}</td></tr>")
    html_rows.append("</tbody></table>")
    return "".join(html_rows)


MATRIX_META_KEYS = {
    "dimension", "维度", "weight", "权重", "brand_score", "brand_value", "品牌表现",
    "competitor_scores", "competitor_value", "competitor_name", "comparison_target",
    "industry_average", "行业平均", "description", "data_source", "数据来源",
    "direction", "差异方向", "evidence", "notes", "note", "id", "dimension_id",
}


def _first_non_null(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None and mapping[key] != "":
            return mapping[key]
    return None


def normalize_differentiation_matrix(positioning_json: Any, brand: str | None = None) -> dict[str, Any]:
    """Normalize current flat, nested, and legacy pairwise S4 matrix shapes."""
    if not isinstance(positioning_json, dict):
        return {"brand": brand or "本品牌", "competitors": [], "rows": []}
    stmt = positioning_json.get("positioning_statement")
    stmt_brand = stmt.get("brand") if isinstance(stmt, dict) else None
    brand_name = str(brand or stmt_brand or positioning_json.get("brand") or "本品牌").strip()
    raw_matrix = positioning_json.get("differentiation_matrix")
    if not isinstance(raw_matrix, list):
        return {"brand": brand_name, "competitors": [], "rows": []}

    rows: list[dict[str, Any]] = []
    competitors: list[str] = []
    for raw in raw_matrix:
        if not isinstance(raw, dict):
            continue
        dimension = _first_non_null(raw, "dimension", "维度")
        brand_score = _first_non_null(raw, "brand_score", "brand_value", "品牌表现")
        if dimension is None or brand_score is None:
            continue

        competitor_scores: dict[str, Any] = {}
        nested = raw.get("competitor_scores")
        if isinstance(nested, dict):
            for name, value in nested.items():
                name_text = str(name).strip()
                if name_text and value is not None and value != "":
                    competitor_scores[name_text] = value
        else:
            # Canonical S4 rows use dynamic competitor names as top-level keys.
            for key, value in raw.items():
                if key in MATRIX_META_KEYS or value is None or value == "":
                    continue
                if isinstance(value, (dict, list, tuple, set)):
                    continue
                competitor_scores[str(key).strip()] = value

        legacy_competitor = _first_non_null(raw, "competitor_value", "industry_average", "行业平均")
        if not competitor_scores and legacy_competitor is not None:
            legacy_name = _first_non_null(raw, "competitor_name", "comparison_target") or "竞品/行业参照"
            competitor_scores[str(legacy_name).strip()] = legacy_competitor
        if not competitor_scores:
            continue

        for name in competitor_scores:
            if name not in competitors:
                competitors.append(name)
        rows.append({
            "dimension": dimension,
            "weight": _first_non_null(raw, "weight", "权重"),
            "brand_score": brand_score,
            "competitor_scores": competitor_scores,
            "description": _first_non_null(
                raw, "description", "data_source", "数据来源", "direction", "差异方向", "evidence"
            ),
        })
    return {"brand": brand_name or "本品牌", "competitors": competitors, "rows": rows}


def _matrix_cell(value: Any, fallback: str = "—") -> str:
    if value is None or value == "":
        return fallback
    return strip_inline_markdown(strip_internal_report_scaffolding(str(value))) or fallback


def render_differentiation_matrix_html(positioning_json: Any, brand: str | None = None) -> str:
    normalized = normalize_differentiation_matrix(positioning_json, brand)
    rows = normalized["rows"]
    competitors = normalized["competitors"]
    if not rows or not competitors:
        return "<p class='muted'>差异化矩阵缺少可渲染的竞品分值。</p>"

    include_weight = any(row.get("weight") is not None for row in rows)
    tables: list[str] = [
        "<div class='differentiation-matrix-group' data-differentiation-matrix='true'>"
    ]
    for offset in range(0, len(competitors), 3):
        competitor_group = competitors[offset:offset + 3]
        weight_head = "<th>权重</th>" if include_weight else ""
        competitor_head = "".join(f"<th>{e(name)}</th>" for name in competitor_group)
        tables.append(
            "<table class='long-table differentiation-matrix-table'><thead><tr>"
            f"<th>竞争维度</th>{weight_head}<th>{e(normalized['brand'])}（本品牌）</th>"
            f"{competitor_head}<th>判断依据</th></tr></thead><tbody>"
        )
        for row in rows:
            weight_cell = f"<td>{e(_matrix_cell(row.get('weight')))}</td>" if include_weight else ""
            competitor_cells = "".join(
                f"<td>{e(_matrix_cell(row['competitor_scores'].get(name)))}</td>"
                for name in competitor_group
            )
            tables.append(
                "<tr>"
                f"<td><strong>{e(_matrix_cell(row.get('dimension'), ''))}</strong></td>"
                f"{weight_cell}<td class='td-purple'>{e(_matrix_cell(row.get('brand_score')))}</td>"
                f"{competitor_cells}"
                f"<td class='muted' style='font-size:7.6pt'>{e(_matrix_cell(row.get('description')))}</td>"
                "</tr>"
            )
        tables.append("</tbody></table>")
    tables.append("</div>")
    return "".join(tables)


# --------------------------- QA tree / scene matrix rendering ------------------

INTENT_LABELS = {
    "informational": "信息型",
    "comparison": "对比型",
    "transactional": "交易型",
    "navigational": "导航型",
    "commercial": "商业意图",
}

STAGE_ORDER = ["awareness", "consideration", "decision", "usage", "advocacy"]
STAGE_CN = {
    "awareness": "认知",
    "consideration": "考虑",
    "decision": "决策",
    "usage": "使用",
    "advocacy": "推荐",
}


def render_qa_tree_overview_html(qa_tree: Any) -> str:
    """List every concrete question per stage (question + intent + follow-ups),
    instead of only stage counts."""
    if not isinstance(qa_tree, dict):
        return ""
    stages = qa_tree.get("question_stages")
    if not isinstance(stages, list) or not stages:
        return ""
    blocks: list[str] = []
    for st in stages:
        if not isinstance(st, dict):
            continue
        name_cn = clean_client_value(st.get("stage_name"), "")
        name_en = clean_client_value(st.get("stage_name_en"), "")
        questions = st.get("questions") if isinstance(st.get("questions"), list) else []
        rows = ["<table class='long-table qa-tree-table'><thead><tr><th style='width:46%'>核心问题</th><th style='width:14%'>意图类型</th><th style='width:40%'>典型追问</th></tr></thead><tbody>"]
        for q in questions:
            if not isinstance(q, dict):
                continue
            question = e(clean_client_value(q.get("question"), ""))
            intent = INTENT_LABELS.get(str(q.get("intent_type") or "").strip(), clean_client_value(q.get("intent_type"), "—"))
            fus = q.get("follow_ups") if isinstance(q.get("follow_ups"), list) else []
            fu_text = "；".join(e(clean_client_value(x, "")) for x in fus[:3]) or "—"
            rows.append(f"<tr><td><strong>{question}</strong></td><td>{e(intent)}</td><td class='muted'>{fu_text}</td></tr>")
        rows.append("</tbody></table>")
        count = len(questions)
        blocks.append(
            f"<div class='qa-stage-block'><h4 class='qa-stage-head'>"
            f"<span class='qa-stage-tag'>{e(name_cn)} · {e(name_en)}</span>"
            f"<span class='qa-stage-count'>{count} 个核心问题</span></h4>" + "".join(rows) + "</div>"
        )
    if not blocks:
        return ""
    return "<h3 class='block-title'>问答树概览：五阶段具体问题路径</h3>" + "".join(blocks)


def render_scene_matrix_html(qa_matrix: Any) -> str:
    """List every concrete QA item with stage / intent / priority / content-type /
    target platform and a standard-answer summary, instead of only counts."""
    if not isinstance(qa_matrix, dict):
        return ""
    # 兼容两种键名：标准 S8 schema 用 "questions"，早期版本用 "matrix"。
    # 优先 questions，回退 matrix，确保问答矩阵一定完整渲染进报告。
    rows_data = qa_matrix.get("questions")
    if not isinstance(rows_data, list) or not rows_data:
        rows_data = qa_matrix.get("matrix")
    if not isinstance(rows_data, list) or not rows_data:
        return ""
    content_type_cn = {
        "long_article": "长文",
        "short_post": "短帖",
        "faq": "FAQ",
        "comparison": "对比页",
        "qa": "问答",
        "video": "视频",
        "landing_page": "落地页",
        "list": "清单",
    }
    platform_cn = {
        "official_blog": "官网博客", "zhihu": "知乎", "wechat": "微信",
        "xiaohongshu": "小红书", "douyin": "抖音", "weibo": "微博",
        "baidu": "百度", "bilibili": "B站", "tieba": "贴吧",
    }
    rows = ["<table class='long-table scene-matrix-table'><thead><tr>"
            "<th style='width:34%'>具体问题</th><th style='width:9%'>阶段</th>"
            "<th style='width:9%'>意图</th><th style='width:7%'>优先级</th>"
            "<th style='width:13%'>内容形态</th><th style='width:28%'>目标平台</th>"
            "</tr></thead><tbody>"]
    for it in rows_data:
        if not isinstance(it, dict):
            continue
        q = e(clean_client_value(it.get("question"), ""))
        stage = STAGE_CN.get(str(it.get("question_stage") or "").strip(), clean_client_value(it.get("question_stage"), "—"))
        intent = INTENT_LABELS.get(str(it.get("intent_type") or "").strip(), clean_client_value(it.get("intent_type"), "—"))
        prio = e(clean_client_value(it.get("priority"), "—"))
        ct = it.get("content_type")
        ct_cn = content_type_cn.get(str(ct or "").strip(), clean_client_value(ct, "—"))
        tps = it.get("target_platform") if isinstance(it.get("target_platform"), list) else []
        tp_text = "、".join(platform_cn.get(str(p).strip(), str(p)) for p in tps[:4]) or "—"
        prio_cls = " class='td-p0'" if prio.upper() == "P0" else (" class='td-p1'" if prio.upper() == "P1" else "")
        rows.append(
            f"<tr><td><strong>{q}</strong></td><td>{e(stage)}</td><td>{e(intent)}</td>"
            f"<td{prio_cls}>{prio}</td><td>{e(ct_cn)}</td><td class='muted'>{e(tp_text)}</td></tr>"
        )
    rows.append("</tbody></table>")
    return "<h3 class='block-title'>问题优先级与内容承接矩阵</h3>" + "".join(rows)


def render_content_calendar_html(content_calendar: Any) -> str:
    """Render the complete S8 12-week content calendar into the client report."""
    if not isinstance(content_calendar, dict):
        return ""
    weeks = content_calendar.get("weeks")
    # 兼容多种结构：标准用 weeks[]；若没有 weeks，则尝试把顶层
    # items / content_items / calendar / list 作为单周处理，避免因结构差异而渲染不出。
    if not isinstance(weeks, list) or not weeks:
        flat = (content_calendar.get("items") or content_calendar.get("content_items")
                or content_calendar.get("calendar") or content_calendar.get("list"))
        if isinstance(flat, list) and flat:
            weeks = [{"week_number": idx + 1, "theme": "", "content_items": [it]} for idx, it in enumerate(flat) if isinstance(it, dict)]
    if not isinstance(weeks, list) or not weeks:
        return ""
    content_type_cn = {
        "long_article": "长文", "faq": "FAQ", "case_study": "案例",
        "comparison": "对比页", "whitepaper": "白皮书", "video_script": "视频脚本",
        "social_post": "社交短帖",
    }
    platform_cn = {
        "official_blog": "官网博客", "zhihu": "知乎", "wechat": "微信",
        "xiaohongshu": "小红书", "bilibili": "B站", "industry_media": "行业媒体",
        "github": "GitHub",
    }
    rows = [
        "<div data-content-calendar='true'><h3 class='block-title'>12 周内容编排</h3>",
        "<table class='long-table content-calendar-table'><thead><tr>",
        "<th style='width:8%'>周次</th><th style='width:16%'>主题</th>",
        "<th style='width:34%'>内容标题</th><th style='width:11%'>形态</th>",
        "<th style='width:13%'>平台</th><th style='width:10%'>问题阶段</th>",
        "<th style='width:8%'>优先级</th></tr></thead><tbody>",
    ]
    item_count = 0
    for week in weeks:
        if not isinstance(week, dict):
            continue
        week_number = clean_client_value(week.get("week_number"), "—")
        theme = clean_client_value(week.get("theme"), "—")
        items = week.get("content_items") if isinstance(week.get("content_items"), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_count += 1
            # 兼容多种字段名：标准 schema 用 title，早期/变体可能用 topic/action/name/标题。
            title = clean_client_value(
                item.get("title") or item.get("topic") or item.get("action")
                or item.get("name") or item.get("标题") or item.get("主题"), "—")
            content_type = content_type_cn.get(str(item.get("content_type") or ""), clean_client_value(item.get("content_type"), "—"))
            platform = platform_cn.get(str(item.get("target_platform") or ""), clean_client_value(item.get("target_platform"), "—"))
            stage_raw = str(item.get("question_stage") or "")
            stage = STAGE_CN.get(stage_raw, clean_client_value(stage_raw, "—"))
            priority_raw = str(item.get("priority") or "—")
            priority = {"high": "高", "medium": "中", "low": "低"}.get(priority_raw.lower(), priority_raw)
            rows.append(
                "<tr>"
                f"<td>W{e(str(week_number).zfill(2))}</td><td>{e(theme)}</td><td><strong>{e(title)}</strong></td>"
                f"<td>{e(content_type)}</td><td>{e(platform)}</td><td>{e(stage)}</td><td>{e(priority)}</td>"
                "</tr>"
            )
    rows.append("</tbody></table>")
    rows.append(f"<p class='muted'>共覆盖 {item_count} 条内容任务；每条任务均关联问答阶段与目标平台。</p></div>")
    return "".join(rows) if item_count else ""


# --------------------------- action rendering --------------------------------

def clean_json_like_text(text: str) -> str:
    return re.sub(r",\s*([}\]])", r"\1", text.strip())


def extract_json_object_around_key(text: str, key: str) -> dict[str, Any] | None:
    key_pos = text.find(key)
    if key_pos < 0:
        return None
    start = text.rfind("{", 0, key_pos)
    if start < 0:
        return None
    depth = 0; in_string = False; escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(clean_json_like_text(text[start:idx+1]))
                    return obj if isinstance(obj, dict) else None
                except Exception:
                    return None
    return None


def extract_recommended_actions(markdown_text: str) -> list[dict[str, Any]]:
    if not markdown_text:
        return []
    for block in re.findall(r"```json\s*(.*?)```", markdown_text, flags=re.S | re.I):
        try:
            obj = json.loads(clean_json_like_text(block))
        except Exception:
            obj = extract_json_object_around_key(block, "recommended_business_actions")
        if isinstance(obj, dict) and isinstance(obj.get("recommended_business_actions"), list):
            return [a for a in obj["recommended_business_actions"] if isinstance(a, dict)]
    obj = extract_json_object_around_key(markdown_text, "recommended_business_actions")
    if isinstance(obj, dict) and isinstance(obj.get("recommended_business_actions"), list):
        return [a for a in obj["recommended_business_actions"] if isinstance(a, dict)]
    return []


def render_recommended_actions_html(actions: list[dict[str, Any]]) -> str:
    if not actions:
        actions = [
            {"domain": "实体与事实资产", "title": "补齐品牌实体、核心产品、资质、案例与服务边界事实", "priority": "P0", "effect": "让 AI 有稳定、可验证、可引用的品牌事实底座"},
            {"domain": "定位与话语一致性", "title": "统一定位声明、证据链和推荐回答话语", "priority": "P0", "effect": "让 AI 识别品牌应该占据的心智位置"},
            {"domain": "问答内容资产", "title": "建设 FAQ、比较页、场景页和负向疑虑回应", "priority": "P1", "effect": "承接真实问题路径，提升高意图问答覆盖"},
            {"domain": "分发与引用路径", "title": "布局高频问题答案与第三方证明页面", "priority": "P1", "effect": "提升被 AI 引用和推荐时的可信证据密度"},
        ]
    rows = ["<table><thead><tr><th>建议域</th><th>行动标题</th><th>优先级</th><th>预期业务效果</th></tr></thead><tbody>"]
    action_domain_labels = {
        "GEO_A1_entity_facts": "实体与事实资产",
        "GEO_A2_ai_visibility": "AI 可见性监测",
        "GEO_A3_qa_assets": "问答与内容资产",
        "GEO_A4_positioning_language": "定位与话语一致性",
        "GEO_A5_site_schema": "官网与结构化数据",
        "GEO_A6_distribution_citations": "第三方信源与引用",
    }
    for a in actions[:10]:
        action_id = str(a.get("action_id") or "")
        domain = (
            a.get("domain")
            or a.get("建议域")
            or a.get("action_domain")
            or action_domain_labels.get(action_id)
            or "GEO 优化"
        )
        title = a.get("title") or a.get("行动标题") or a.get("action_title") or a.get("recommendation") or "行动建议"
        priority = a.get("priority") or a.get("优先级") or "P1"
        effect = a.get("expected_business_effect") or a.get("effect") or a.get("预期业务效果") or "提升 AI 可见性与转化承接能力"
        rows.append(f"<tr><td>{e(clean_client_value(domain, 'GEO 优化'))}</td><td>{e(clean_client_value(title, '行动建议'))}</td><td class='td-purple'>{e(priority)}</td><td>{e(clean_client_value(effect, '提升 AI 可见性与转化承接能力'))}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def render_geo_roadmap_html(actions: list[dict[str, Any]]) -> str:
    if actions:
        phase_by_priority = {"P0": "0-30 天", "P1": "31-60 天", "P2": "61-90 天"}
        html_rows = [
            "<div data-s9-roadmap='true'><table class='long-table'><thead><tr>",
            "<th style='width:12%'>阶段</th><th style='width:24%'>行动</th>",
            "<th style='width:24%'>证据与问题关联</th><th style='width:15%'>建议负责人</th>",
            "<th style='width:25%'>预期业务效果</th></tr></thead><tbody>",
        ]
        ordered = sorted(
            actions,
            key=lambda item: ({"P0": 0, "P1": 1, "P2": 2}.get(str(item.get("priority") or "P1").upper(), 1), str(item.get("action_id") or "")),
        )
        for action in ordered[:12]:
            priority = str(action.get("priority") or "P1").upper()
            phase = phase_by_priority.get(priority, "31-60 天")
            title = clean_client_value(action.get("title") or action.get("action_title"), "行动建议")
            reason = clean_client_value(action.get("reason"), "基于前述诊断证据安排")
            linked = action.get("problem_linked")
            if isinstance(linked, list) and linked:
                reason = f"关联问题：{'、'.join(str(x) for x in linked)}；{reason}"
            owner = clean_client_value(action.get("owner_hint"), "品牌/内容/技术协同")
            effect = clean_client_value(action.get("expected_business_effect") or action.get("effect"), "提升 AI 可见性与业务承接能力")
            html_rows.append(
                f"<tr><td><strong>{e(phase)}</strong><br><span class='muted'>{e(priority)}</span></td>"
                f"<td><strong>{e(title)}</strong></td><td>{e(reason)}</td><td>{e(owner)}</td><td>{e(effect)}</td></tr>"
            )
        html_rows.append(
            "<tr><td><strong>持续复盘</strong></td><td><strong>同题复测与内容迭代</strong></td>"
            "<td>沿用固定问题并扩展高优先问题池，跟踪品牌提及、引用来源与负向主题变化</td>"
            "<td>品牌策略与数据团队</td><td>形成诊断—修复—复测闭环</td></tr>"
        )
        html_rows.append("</tbody></table></div>")
        return "".join(html_rows)

    rows = [
        ("0-30 天", "校准事实与定位", "补齐实体事实、定位句、证据链和官网基础事实页", "让 AI 能正确识别品牌是谁、做什么、凭什么可信"),
        ("31-60 天", "建设问答与证据", "上线 FAQ/比较页/场景页，布局第三方可信证明", "让 AI 在高意图问题中有可引用答案和可信来源"),
        ("61-90 天", "放大趋势叙事", "围绕高优先趋势输出案例、观点和品类解释型内容", "让品牌在品类增长叙事中形成可持续占位"),
        ("持续复盘", "监控与迭代", "按同一固定问题和扩展问题池复测，跟踪提及、引用、舆情主题变化", "形成诊断-修复-复测闭环"),
    ]
    html_rows = ["<div data-s9-roadmap='true'><table><thead><tr><th>阶段</th><th>主题</th><th>关键动作</th><th>业务目标</th></tr></thead><tbody>"]
    for row in rows:
        html_rows.append("<tr>" + "".join(f"<td>{e(cell)}</td>" for cell in row) + "</tr>")
    html_rows.append("</tbody></table></div>")
    return "".join(html_rows)


def render_strategic_choices_html(scorecard: Any, positioning_json: Any) -> str:
    trends = sorted(normalize_trends(scorecard), key=trend_score, reverse=True)
    top_trend = clean_client_value(trends[0].get("name"), "高优先品类增长趋势") if trends else "高优先品类增长趋势"
    stmt = positioning_statement(positioning_json, "品牌")
    differentiator = clean_client_value(stmt.get("differentiator") or stmt.get("full_statement"), "清晰定位句与可验证差异化证据链")
    choices = [
        ("抢占品类增长叙事", f"围绕“{top_trend}”建立品类解释权", "把高优先趋势变成官网核心页、FAQ、案例和第三方证明材料的统一主题。", "市场机会"),
        ("固化差异化定位", f"以“{differentiator}”作为回答与传播的中心锚点", "所有可引用内容必须围绕同一定位句、证据链和价值三角展开。", "品牌定位"),
        ("补齐信任证据链", "用事实、案例、资质和客户场景支撑定位", "减少 AI 回答中的不确定、泛化和竞品替代，提升被引用时的可信度。", "品牌事实/AI 监控"),
        ("建设问题承接系统", "把用户问题转为可索引、可引用、可转化的答案资产", "用问答树、落地页和标题钩子承接高意图流量。", "问答内容/行动建议"),
    ]
    rows = ["<table><thead><tr><th>战略选择</th><th>咨询判断</th><th>落地含义</th><th>依据</th></tr></thead><tbody>"]
    for c in choices:
        rows.append("<tr>" + "".join(f"<td>{e(cell)}</td>" for cell in c) + "</tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def render_title_hooks_html(hooks: dict[str, Any] | None) -> str:
    items = []
    if isinstance(hooks, dict):
        items = hooks.get("title_hooks", [])
        if not items and hooks:
            # 尝试从其他可能的键中提取，或者如果它本身就是一个列表
            for k, v in hooks.items():
                if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict) and ("title" in v[0] or "title_hook" in v[0]):
                    items = v
                    break
    elif isinstance(hooks, list):
        items = hooks
        
    if not items:
        return (
            "<div class='title-hooks-subsection' data-title-hooks='true'>"
            "<h3>内容标题钩子</h3><p class='muted'>暂未生成标题建议。</p></div>"
        )
    rows = ["<table><thead><tr><th>类别</th><th>文章类型</th><th>标题建议</th><th>用途</th></tr></thead><tbody>"]
    for item in items[:16]:
        type_name = item.get("content_type") or item.get("content_type_name") or item.get("content_type_code") or "内容主题"
        group = item.get("content_group") or item.get("category") or "内容机会"
        title = item.get("title_hook") or item.get("title") or "标题建议"
        purpose = item.get("purpose") or item.get("expected_effect") or "提升搜索可见性与点击转化"
        rows.append(f"<tr><td>{e(clean_client_value(group, '内容机会'))}</td><td>{e(clean_client_value(type_name, '内容主题'))}</td><td>{e(clean_client_value(title, '标题建议'))}</td><td>{e(clean_client_value(purpose, '提升可见性'))}</td></tr>")
    rows.append("</tbody></table>")
    return (
        "<div class='title-hooks-subsection' data-title-hooks='true'>"
        "<h3>内容标题钩子</h3>"
        + "".join(rows)
        + "</div>"
    )


# ---------------------------- report rendering -------------------------------

def cards(items: list[tuple[str, str, str, str]]) -> str:
    out = ["<div class='data-cards'>"]
    for value, label, sublabel, theme in items:
        out.append(f"<div class='data-card card-{e(theme)}'><span class='number'>{e(value)}</span><span class='label'>{e(label)}</span><span class='sublabel'>{e(sublabel)}</span></div>")
    out.append("</div>")
    return "".join(out)


def toc_html() -> str:
    toc = [
        ("经营层摘要：结论、判断与优先级", ["核心结论", "判断链", "优先行动"]),
        ("第一部分：报告范围与诊断口径", ["诊断对象", "样本口径", "使用边界", "品牌事实"]),
        ("第二部分：市场趋势与品类机会", ["机会摘要", "优先级矩阵", "增长叙事"]),
        ("第三部分：品牌定位与竞争战略", ["定位声明", "价值三角", "差异化矩阵", "证据链"]),
        ("第四部分：用户意图与问题路径", ["意图分层", "问题路径", "承接路径"]),
        ("第五部分：问答架构与内容承接", ["标准答案", "12 周内容编排", "内容标题钩子"]),
        ("第六部分：AI 可见性诊断", ["固定问题", "平台表现", "可视化图表", "数据文件索引"]),
        ("第七部分：语义资产审计", ["语义评分", "实体关系", "补齐清单"]),
        ("第八部分：话语资产与视觉资产", ["话语 token", "真实视觉依据", "一致性"]),
        ("第九部分：风险管理", ["风险主题", "信任阻断", "修复方向"]),
        ("第十部分：GEO 战略选择", ["战略选择表", "优先行动", "设计原则"]),
        ("第十一部分：GEO 业务流程", ["策略洞察", "资产生产", "信源分发", "监控迭代"]),
    ]
    parts: list[str] = []
    for title, items in toc:
        parts.append("<div class='toc-section'>")
        parts.append(f"<div class='toc-item-main'>{e(title)}</div>")
        for item in items:
            parts.append(f"<div class='toc-item-sub'>{e(item)}</div>")
        parts.append("</div>")
    return "".join(parts)


def render_report_scope_block(summary: dict[str, Any], records: list[dict[str, Any]], brand: str, company_name: str, product: str) -> str:
    """本工作流: 删除四个卡片，改为简洁表格形式展示报告范围信息"""
    q1_count = len([r for r in records if is_q1_record(r)])
    q2_count = len([r for r in records if is_q2_record(r)])
    total_records = q1_count + q2_count
    platform_names = "、".join(platform_display(p) for p in sorted({str(r.get('platform')) for r in records if r.get('platform')})) or "本次监控平台"
    return f"""
<table class='config-table'>
<thead><tr><th>维度</th><th>口径说明</th></tr></thead>
<tbody>
<tr><td>诊断对象</td><td>{e(company_name)}（品牌名：{e(brand)}）—— 核心业务：{e(product)}</td></tr>
<tr><td>监测样本</td><td>共 {e(str(total_records))} 条 AI 回答（推荐题 {e(str(q1_count))} 条 + 负向直问 {e(str(q2_count))} 条），覆盖 {e(platform_names)}</td></tr>
<tr><td>报告范围</td><td>品牌事实、AI 可见度、市场机会、定位策略、内容资产、风险管理与 90 天行动路线图</td></tr>
<tr><td>使用边界</td><td>推荐题用于可见度和竞品占位分析；负向直问仅用于风险和信任边界分析，不混入排名指标</td></tr>
</tbody>
</table>
"""



def render_executive_summary(data: dict[str, Any], sections: dict[str, str], structured: dict[str, Any], actions: list[dict[str, Any]], themes: list[str]) -> str:
    brand = data["meta"]["brand"]
    product = data["meta"].get("main_product") or "核心产品"
    summary = data.get("monitoring_summary", {}) or {}
    records = data.get("monitoring_records", []) or []
    trend_scorecard = structured.get("trend_scorecard")
    trends = sorted(normalize_trends(trend_scorecard), key=trend_score, reverse=True)
    top_trends = "、".join(clean_client_value(t.get("name"), "未命名趋势") for t in trends[:3]) or "需补充趋势判断"
    positioning_json = structured.get("positioning_json")
    stmt = positioning_statement(positioning_json, brand)
    positioning = clean_client_value(stmt.get("full_statement") or stmt.get("differentiator"), "需进一步收口为客户可直接使用的定位句")
    q1_total = len([r for r in records if is_q1_record(r)])
    q1_mentions = len([r for r in records if is_q1_record(r) and record_brand_mentioned(r, brand, data["meta"].get("company_name") or "")])
    mention_rate = f"{round(q1_mentions / q1_total * 100)}%" if q1_total else "-"
    action_text = "、".join(clean_client_value(a.get("title") or a.get("行动标题") or a.get("action_title"), "行动建议") for a in actions[:3]) if actions else "校准事实与定位、建设问答与证据、放大趋势叙事"
    risk_text = "、".join(themes[:5]) if themes else "价格、售后、质量、服务、投诉等信任主题"
    return f"""
<div class='key-finding executive'><strong>本轮核心结论：</strong>{e(brand)} 的优化重点不是把监控结果简单罗列给客户，而是把“市场机会、品牌定位、AI 可见性、GEO 行动”压缩成一条可执行判断链：先确定 {e(product)} 所在品类的增长叙事，再把品牌差异化写成 AI 能识别、引用和推荐的内容资产。</div>
<div class='consulting-grid two'>
  <div class='insight-card'><h4>市场机会判断</h4><p>{e(top_trends)}</p></div>
  <div class='insight-card'><h4>定位策略判断</h4><p>{e(positioning)}</p></div>
  <div class='insight-card'><h4>AI 可见性口径</h4><p>推荐题品牌提及率：<strong>{e(mention_rate)}</strong>；完整记录 {e(summary.get('actual_records', len(records)))} 条，成功 {e(summary.get('successful_records', 0))} 条。</p></div>
  <div class='insight-card'><h4>优先行动方向</h4><p>{e(action_text)}</p></div>
</div>
<div class='warning-box'><strong>风险提示：</strong>负向直问中需要重点留意的主题为：{e(risk_text)}。该类问题只用于舆情和信任边界分析，不进入推荐排名指标。</div>
<div class='logic-flow'>
  <div class='flow-node'><strong>市场趋势</strong><span>判断增长机会</span></div>
  <div class='flow-arrow'>→</div>
  <div class='flow-node'><strong>品牌定位</strong><span>选择心智位置</span></div>
  <div class='flow-arrow'>→</div>
  <div class='flow-node'><strong>GEO 路线图</strong><span>转化为行动</span></div>
</div>
"""


# -------------------------- source quality gate -------------------------------

PLACEHOLDER_TERMS = (
    "资料仍需补充", "待补齐", "待确认", "TODO", "todo", "TBD",
    "本模块当前缺少", "请输入", "未形成完整判断"
)

# 该字典的键集合仍用于“哪些来源块应存在”的结构性校验；字数阈值全部置 0，
# 表示不再要求各 S 阶段来源达到某个最低字数（避免为凑字数而灌水）。
# 仅在某个来源完全为空时才会被判定为“空壳”。
SECTION_MIN_CHARS = {
    "brand_facts": 0,
    "marketing": 0,
    "trends": 0,
    "positioning": 0,
    "diagnostic": 0,
    "semantic": 0,
    "verbal": 0,
    "visual": 0,
    "qa_architecture": 0,
    "enablement": 0,
}

# 结构化 JSON 叶子节点“数量门”同样放宽为存在性（0 表示不再设数量门），
# 仅在完全为空时判空，避免为凑数量而编造条目。
STRUCTURED_MIN_LEAFS = {
    "brand_facts_json": 0,
    "marketing_json": 0,
    "trend_scorecard": 0,
    "positioning_json": 0,
    "diagnostic_json": 0,
    "semantic_scorecard": 0,
    "verbal_tokens": 0,
    "visual_prompt_pack": 0,
    "qa_tree": 0,
    "qa_matrix": 0,
    "content_calendar": 0,
}


def _is_placeholder_text(value: Any) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    if any(term in s for term in PLACEHOLDER_TERMS):
        return True
    compact = re.sub(r"[\s：:，,。.!！?？_-]+", "", s)
    return bool(re.fullmatch(r"(?:暂无|示例|示例内容|示例文本|示例数据|占位|占位符|占位内容|占位文本|待填写|待补充)", compact, flags=re.I))


def _count_effective_json_leafs(value: Any) -> int:
    if isinstance(value, dict):
        return sum(_count_effective_json_leafs(v) for v in value.values())
    if isinstance(value, list):
        return sum(_count_effective_json_leafs(v) for v in value)
    if value is None:
        return 0
    if isinstance(value, str):
        s = value.strip()
        if not s or _is_placeholder_text(s):
            return 0
    return 1


def _title_hook_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        preferred = value.get("title_hooks")
        if isinstance(preferred, list):
            return [item for item in preferred if isinstance(item, dict)]
        for candidate in value.values():
            if isinstance(candidate, list) and candidate and isinstance(candidate[0], dict):
                return [item for item in candidate if isinstance(item, dict)]
    return []


def _substantive_text(text: str) -> str:
    text = strip_internal_report_scaffolding(text or "")
    text = re.sub(r"^\s*#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", "", text)
    text = re.sub(r"[\s\W_]+", "", text)
    return text



def _looks_like_simulated_marker(value: Any) -> bool:
    text = json.dumps(value, ensure_ascii=False).lower() if not isinstance(value, str) else value.lower()
    markers = [
        "simulated", "simulation", "mock", "manual", "fake", "synthetic", "sample_records",
        "模拟", "仿真", "伪造", "构造监控", "人工构造", "公开回答数据", "模拟 ai 平台",
    ]
    return any(marker in text for marker in markers)



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
    molizhishu_api 均为合法监控数据来源，真实性红线不变。
    """
    declared = str(meta.get("monitoring_data_source") or "").lower()
    if declared == "uploaded_spreadsheet" and data_provenance.get("capture_method") == "uploaded_spreadsheet":
        return "uploaded_spreadsheet"
    if declared == "molizhishu_api" and data_provenance.get("capture_method") in ("molizhishu_api", None, ""):
        return "molizhishu_api"
    return "unknown"


def monitoring_source_note(data: dict[str, Any]) -> str:
    meta = data.get("monitoring_data_meta", {}) if isinstance(data.get("monitoring_data_meta"), dict) else {}
    data_provenance = data.get("monitoring_data_provenance", {}) if isinstance(data.get("monitoring_data_provenance"), dict) else {}
    source_kind = _monitoring_source_kind(meta, data_provenance)
    if source_kind == "uploaded_spreadsheet":
        return "AI 监控数据来自用户上传的 AI 问答监控表；信源数据来自用户上传的引用分析表，两表均已转换为标准 S5.0 数据文件。"
    if source_kind == "molizhishu_api":
        return "AI 监控与信源数据由墨力指数 business-api 自动采集（海外三平台实测，真实任务返回），已转换为标准 S5.0 数据文件。"
    return "S5.0 数据来源校验未通过。"


def validate_monitoring_uploaded_spreadsheet_provenance(data: dict[str, Any]) -> list[str]:
    """Require the two uploaded S5.0 spreadsheets and their provenance."""
    errors: list[str] = []
    source_files = data.get("source_files", {}) if isinstance(data.get("source_files"), dict) else {}
    monitoring_path_value = source_files.get("monitoring_data")
    if not monitoring_path_value:
        return ["[MONITORING_SOURCE] 缺少 S5.0 monitoring_data 来源文件，不能进入 S10"]
    monitoring_path = Path(str(monitoring_path_value))
    if not monitoring_path.exists():
        return [f"[MONITORING_SOURCE] S5.0 monitoring_data 文件不存在：{monitoring_path}"]
    try:
        monitoring = load_json(monitoring_path)
    except Exception as exc:  # noqa: BLE001
        return [f"[MONITORING_SOURCE] S5.0 monitoring_data JSON 无法解析：{exc}"]
    if not isinstance(monitoring, dict):
        return ["[MONITORING_SOURCE] S5.0 monitoring_data 根节点不是 object"]

    meta = monitoring.get("meta", {}) if isinstance(monitoring.get("meta"), dict) else {}
    summary = monitoring.get("summary", {}) if isinstance(monitoring.get("summary"), dict) else {}
    records = monitoring.get("records", []) if isinstance(monitoring.get("records"), list) else []
    data_provenance = meta.get("data_provenance", {}) if isinstance(meta.get("data_provenance"), dict) else {}

    if meta.get("simulated_data") is True or meta.get("mock_data") is True or meta.get("manual_records") is True:
        errors.append("[MONITORING_SOURCE] 监控数据被标记为 simulated/mock/manual")
    for field in ("question_set_source", "monitoring_data_source", "capture_method"):
        value = meta.get(field) or data_provenance.get(field)
        if value and _looks_like_simulated_marker(value):
            errors.append(f"[MONITORING_SOURCE] 监控数据来源字段疑似模拟：{field}={value}")
    workspace_value = source_files.get("workspace")
    workspace = Path(str(workspace_value)) if workspace_value else monitoring_path.parent.parent
    execution_dir = workspace / "_execution"
    monitoring_manifest = execution_dir / f"S5.0_{data.get('meta', {}).get('brand_id', '')}_monitoring_data_execution_manifest.json"
    citation_manifest = execution_dir / f"S5.0_{data.get('meta', {}).get('brand_id', '')}_citation_analysis_import_manifest.json"
    for manifest_path, label in (
        (monitoring_manifest, "AI 问答监控表导入 manifest"),
        (citation_manifest, "信源表（引用分析表）导入 manifest"),
    ):
        if not manifest_path.exists() or manifest_path.stat().st_size <= 0:
            errors.append(f"[MONITORING_SOURCE] 缺少 {label}")

    source_kind = _monitoring_source_kind(meta, data_provenance)
    if source_kind == "molizhishu_api":
        fetch_manifest_path = execution_dir / f"S5.0_{data.get('meta', {}).get('brand_id', '')}_molizhishu_fetch_manifest.json"
        if not fetch_manifest_path.exists() or fetch_manifest_path.stat().st_size <= 0:
            errors.append("[MONITORING_SOURCE] 缺少墨力指数取数 manifest")
        else:
            try:
                fetch_manifest = load_json(fetch_manifest_path)
            except Exception as exc:  # noqa: BLE001
                fetch_manifest = {}
                errors.append(f"[MONITORING_SOURCE] 取数 manifest 无法解析：{exc}")
            if fetch_manifest.get("data_origin") != "molizhishu_api":
                errors.append("[MONITORING_SOURCE] 取数 manifest data_origin 必须为 molizhishu_api")
            if fetch_manifest.get("simulated") is not False:
                errors.append("[MONITORING_SOURCE] 取数 manifest simulated 必须为 false")
    if source_kind == "uploaded_spreadsheet":
        if data_provenance.get("capture_method") != "uploaded_spreadsheet":
            errors.append("[MONITORING_SOURCE] 上传表格分支缺少 data_provenance.capture_method=uploaded_spreadsheet")
        if _resolve_existing_path(monitoring_path.parent, data_provenance.get("source_file")) is None:
            errors.append("[MONITORING_SOURCE] 上传表格源文件不存在或为空")
        if _resolve_existing_path(monitoring_path.parent, data_provenance.get("raw_extracted_file")) is None:
            errors.append("[MONITORING_SOURCE] 上传表格解析 raw JSON 不存在或为空")
        structured = data.get("structured_sources", {}) if isinstance(data.get("structured_sources"), dict) else {}
        citation_analysis = structured.get("citation_analysis")
        if not citation_analysis_is_ready(citation_analysis):
            errors.append(
                "[MONITORING_SOURCE] 必须包含已确认、含源文件和原始提取文件，且媒体/内容/问题明细三层对账通过的引用分析数据"
            )
        else:
            citation_meta = citation_analysis.get("meta", {}) if isinstance(citation_analysis.get("meta"), dict) else {}
            citation_source = _resolve_existing_path(monitoring_path.parent, citation_meta.get("source_file"))
            citation_raw = _resolve_existing_path(monitoring_path.parent, citation_meta.get("raw_extracted_file"))
            if citation_source is None:
                errors.append("[MONITORING_SOURCE] 引用分析上传源文件不存在或为空")
            if citation_raw is None:
                errors.append("[MONITORING_SOURCE] 引用分析原始提取 JSON 不存在或为空")
    elif source_kind == "unknown":
        errors.append("[MONITORING_SOURCE] S5.0 必须声明 monitoring_data_source=uploaded_spreadsheet 或 molizhishu_api")
    if meta.get("data_confirmation_status") != "confirmed":
        errors.append("[MONITORING_SOURCE] AI 问答监控表未随导入自动确认（data_confirmation_status != confirmed）")

    platforms = [str(p).lower() for p in (meta.get("platforms") or [])]
    if not platforms:
        errors.append("[MONITORING_SOURCE] 监控平台集合不能为空")
    repeat = int(meta.get("repeat_per_question_platform") or 0)
    if repeat != DEFAULT_MONITORING_REPEAT:
        errors.append(f"[MONITORING_SOURCE] 每平台每问题必须为 {DEFAULT_MONITORING_REPEAT} 次，当前 repeat={repeat}")
    expected = int(summary.get("expected_records") or 0)
    successful = int(summary.get("successful_records") or 0)
    partial_accepted = bool(
        meta.get("data_confirmation_status") == "confirmed"
        and meta.get("partial_accepted") is True
        and successful > 0
    )
    if expected <= 0:
        errors.append("[MONITORING_SOURCE] monitoring summary 缺少 expected_records")
    dynamic_expected = 2 * len(platforms) * repeat
    if expected != dynamic_expected:
        errors.append(f"[MONITORING_SOURCE] 监控样本量应按问题数×平台数×重复次数计算为 {dynamic_expected} 条，当前 expected_records={expected}")
    if expected and len(records) != expected:
        errors.append(f"[MONITORING_SOURCE] 监控记录数量不等于预期：actual={len(records)}, expected={expected}")
    if expected and successful <= 0:
        errors.append("[MONITORING_SOURCE] 监控数据没有任何成功答案")
    elif expected and successful != expected and not partial_accepted:
        errors.append(f"[MONITORING_SOURCE] 监控成功记录未达预期：successful={successful}, expected={expected}")
    if records:
        empty_answers = [idx for idx, rec in enumerate(records, 1) if isinstance(rec, dict) and not str(rec.get("answerContent") or "").strip()]
        if empty_answers and not partial_accepted:
            errors.append(f"[MONITORING_SOURCE] 存在空答案记录：count={len(empty_answers)}")
    return errors

def validate_source_file_quality(data: dict[str, Any]) -> list[str]:
    """Block S10 when upstream S files are empty shells.

    This prevents final PDFs that only show section titles such as "品牌 趋势报告".
    Non-pause S stages must be re-run until their JSON/MD files contain concrete analysis.
    """
    errors: list[str] = []
    errors.extend(validate_monitoring_uploaded_spreadsheet_provenance(data))
    sections = data.get("strategy_sections", {}) if isinstance(data.get("strategy_sections"), dict) else {}
    for key, min_chars in SECTION_MIN_CHARS.items():
        raw = str(sections.get(key) or "")
        body = _substantive_text(raw)
        # 不再设最低字数门（min_chars 已置 0）：仅在来源完全为空时报“空壳”。
        if len(body) == 0:
            errors.append(f"[SOURCE_QUALITY] {key} 源 Markdown 内容为空，需回到对应 S 阶段生成实质内容")
        # More than 35% placeholder lines is considered an empty shell.
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        placeholder_lines = [ln for ln in lines if _is_placeholder_text(ln)]
        if lines and len(placeholder_lines) / max(1, len(lines)) > 0.35:
            errors.append(f"[SOURCE_QUALITY] {key} 源文件占位内容过多，需补写具体分析")
        # Repeated report-title shell: e.g. "蛋仔医生 品类趋势报告" repeated.
        title_like = [ln for ln in lines if re.search(r"(报告|图谱|手册|建议)$", ln) and len(ln) <= 40]
        if len(lines) <= 8 and len(title_like) >= 2:
            errors.append(f"[SOURCE_QUALITY] {key} 仅包含标题/报告名，不能进入 S10")
        # S4 and S5 legitimately combine two distinct deliverables (statement +
        # analysis, diagnosis + Gap). Checking the concatenated text would count
        # intentional cross-file overlap as self-duplication, so duplicate ratios
        # are evaluated per physical file whenever multiple inputs exist.
        strategy_paths = ((data.get("source_files") or {}).get("strategy_sections") or {}).get(key, [])
        duplicate_inputs: list[list[str]] = []
        if isinstance(strategy_paths, list) and len(strategy_paths) > 1:
            for path_value in strategy_paths:
                try:
                    file_lines = [ln.strip() for ln in read_text(Path(path_value)).splitlines() if ln.strip()]
                except Exception:
                    file_lines = []
                duplicate_inputs.append(file_lines)
        else:
            duplicate_inputs.append(lines)
        for input_lines in duplicate_inputs:
            normalized_lines = [re.sub(r"[\s\W_]+", "", ln) for ln in input_lines]
            normalized_lines = [ln for ln in normalized_lines if len(ln) >= 8]
            if normalized_lines:
                duplicate_ratio = 1 - (len(set(normalized_lines)) / len(normalized_lines))
                if duplicate_ratio > 0.25:
                    errors.append(f"[SOURCE_QUALITY] {key} 单一源文件重复内容比例过高：{duplicate_ratio:.0%}")
                    break
        heading_count = sum(1 for ln in raw.splitlines() if re.match(r"^\s*#{1,6}\s+", ln))
        # 不再要求最低标题数；仅在完全没有任何标题且正文非空时提示。
        if heading_count == 0 and len(body) > 0:
            errors.append(f"[SOURCE_QUALITY] {key} 缺少基本章节结构（未检测到任何 Markdown 标题）")
    structured = data.get("structured_sources", {}) if isinstance(data.get("structured_sources"), dict) else {}
    for key, min_leafs in STRUCTURED_MIN_LEAFS.items():
        value = structured.get(key)
        leafs = _count_effective_json_leafs(value)
        # 不再设数量门（min_leafs 已置 0）：仅在结构化数据完全为空时报空。
        if leafs == 0:
            errors.append(f"[SOURCE_QUALITY] 结构化数据为空：{key}，需回到对应 S 阶段生成实质数据")
    normalized_matrix = normalize_differentiation_matrix(structured.get("positioning_json"))
    if not normalized_matrix.get("rows") or not normalized_matrix.get("competitors"):
        errors.append("[SOURCE_QUALITY] S4 差异化矩阵缺少有效维度或竞品分值，禁止生成空表")
    # S5.5 BSAS 评分卡结构硬门禁（v3）：文件存在但结构不合规时禁止静默跳过五维图。
    semantic_paths = structured.get("paths", {}) if isinstance(structured.get("paths"), dict) else {}
    scorecard_path = semantic_paths.get("semantic_scorecard")
    scorecard = structured.get("semantic_scorecard")
    if scorecard_path and (not isinstance(scorecard, dict) or not isinstance(scorecard.get("dimensions"), dict)
                           or not isinstance(scorecard.get("bsas_total"), (int, float))):
        errors.append(
            "[SOURCE_QUALITY] S5.5 语义资产评分卡结构不合规：必须符合 bsas_scorecard_schema.json"
            "（顶层 bsas_total/grade/dimensions{semantic_visibility…competitive_advantage 五键 dict}"
            "/competitive_benchmark/priority_actions/twelve_week_targets/source_intelligence"
            "/ranking_position_diagnostics）。自创五维结构会导致五维条形图与 BSAS 总分静默缺失，禁止渲染"
        )
    hooks = _title_hook_items(data.get("title_hooks"))
    valid_hooks = [item for item in hooks if str(item.get("title_hook") or item.get("title") or "").strip()]
    # 仅要求存在至少 1 条有效标题钩子（防空）；不再硬性要求 12 条数量门。
    if len(valid_hooks) == 0:
        errors.append("[SOURCE_QUALITY] S9.8 缺少有效标题钩子（至少需 1 条）")
    return errors


def source_block(source_key: str, body_html: str) -> str:
    return f"<div class='source-stage-block' data-source-key='{e(source_key)}'>{body_html}</div>"


def _coverage_normalize(text: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", "", text or "", flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"[\s\W_]+", "", text).lower()


def _source_block_texts(html_text: str, source_key: str) -> list[str]:
    """Return visible text for the exact source block, not for the whole report.

    Global matching could falsely pass when a source phrase appeared only in the
    executive summary or another stage. Restricting coverage to the block tagged
    with the same source key proves that the stage body itself was rendered.
    """
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(html_text, "html.parser")
        nodes = soup.select(f".source-stage-block[data-source-key='{source_key}']")
        return [node.get_text(" ", strip=True) for node in nodes]
    except Exception:
        pattern = re.compile(
            rf"<div\s+class=['\"]source-stage-block['\"]\s+data-source-key=['\"]{re.escape(source_key)}['\"]>([\s\S]*?)</div>",
            flags=re.I,
        )
        return [re.sub(r"<[^>]+>", " ", match) for match in pattern.findall(html_text)]


def _collect_structured_strings(value: Any, field_names: set[str]) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in field_names and isinstance(item, (str, int, float)):
                normalized = _coverage_normalize(str(item))
                if len(normalized) >= 6:
                    found.append(normalized)
            found.extend(_collect_structured_strings(item, field_names))
    elif isinstance(value, list):
        for item in value:
            found.extend(_collect_structured_strings(item, field_names))
    unique: list[str] = []
    seen: set[str] = set()
    for item in found:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def _coverage_anchors(source_text: str) -> list[str]:
    cleaned = client_excerpt(source_text or "")
    candidates: list[str] = []
    for line in cleaned.splitlines():
        line = re.sub(r"^\s*#{1,6}\s*|^\s*[-*+>]\s*", "", line).strip()
        if not line:
            continue
        for part in re.split(r"(?<=[。！？；;])|\|", line):
            norm = _coverage_normalize(part)
            if 12 <= len(norm) <= 180:
                candidates.append(norm)
    unique: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        if item not in seen:
            seen.add(item); unique.append(item)
    return unique[:120]


def validate_source_coverage(html_text: str, data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    sections = data.get("strategy_sections", {}) if isinstance(data.get("strategy_sections"), dict) else {}
    structured = data.get("structured_sources", {}) if isinstance(data.get("structured_sources"), dict) else {}
    report: dict[str, Any] = {}
    errors: list[str] = []

    for key in SECTION_MIN_CHARS:
        block_texts = _source_block_texts(html_text, key)
        block_visible = _coverage_normalize(" ".join(block_texts))
        anchors = _coverage_anchors(str(sections.get(key) or ""))
        matched = [anchor for anchor in anchors if anchor in block_visible]
        total_weight = sum(len(a) for a in anchors)
        matched_weight = sum(len(a) for a in matched)
        ratio = matched_weight / total_weight if total_weight else 0.0
        report[key] = {
            "block_count": len(block_texts),
            "block_text_chars": len(block_visible),
            "anchor_count": len(anchors),
            "matched_anchors": len(matched),
            "weighted_coverage": round(ratio, 4),
        }
        # 仅校验“来源块存在且唯一 + 来源块内有实质内容”；
        # 不再要求锚点数量或覆盖率百分比达标（覆盖率阈值已置 0）。
        if len(block_texts) != 1:
            errors.append(f"[SOURCE_COVERAGE] {key} 来源块数量异常：{len(block_texts)} != 1")
        elif len(block_visible) == 0:
            errors.append(f"[SOURCE_COVERAGE] {key} 来源块内容为空，该阶段内容未进入报告")

    expected_keys = set(SECTION_MIN_CHARS)
    actual_keys = set(re.findall(r"data-source-key=['\"]([^'\"]+)['\"]", html_text))
    missing_keys = sorted(expected_keys - actual_keys)
    unexpected_keys = sorted(actual_keys - expected_keys)
    report["source_block_inventory"] = {
        "expected_keys": sorted(expected_keys),
        "actual_keys": sorted(actual_keys),
        "missing_keys": missing_keys,
        "unexpected_keys": unexpected_keys,
    }
    if missing_keys:
        errors.append("[SOURCE_COVERAGE] 最终 HTML 缺少来源块：" + ", ".join(missing_keys))

    # The client report intentionally omits the question tree and priority matrix;
    # only the 12-week content calendar remains a required S8 structured artifact.
    s8_visible = _coverage_normalize(" ".join(_source_block_texts(html_text, "qa_architecture")))
    structured_specs = {
        "content_calendar_titles": (structured.get("content_calendar"), {"title", "topic", "action", "name", "标题", "主题"}, 12, REQUIRED_S8_CONTENT_CALENDAR_COVERAGE),
    }
    structured_report: dict[str, Any] = {}
    for name, (value, fields, minimum, min_ratio) in structured_specs.items():
        anchors = _collect_structured_strings(value, fields)
        matched = [anchor for anchor in anchors if anchor in s8_visible]
        ratio = len(matched) / len(anchors) if anchors else 0.0
        structured_report[name] = {
            "source_count": len(anchors),
            "rendered_count": len(matched),
            "coverage": round(ratio, 4),
        }
        # The calendar must render at least one generated item.
        if len(anchors) >= 1 and len(matched) == 0:
            errors.append(f"[SOURCE_COVERAGE] S8 {name} 已生成但未渲染进客户报告")
    report["s8_structured_coverage"] = structured_report

    hook_items = _title_hook_items(data.get("title_hooks"))
    visible = _coverage_normalize(html_text)
    rendered_hooks = 0
    for item in hook_items:
        title = item.get("title_hook") or item.get("title")
        if title and _coverage_normalize(str(title)) in visible:
            rendered_hooks += 1
    report["title_hooks"] = {"source_count": len(hook_items), "rendered_count": rendered_hooks}
    # 标题钩子：仅要求“已生成且至少渲染 1 条”；不再硬性要求 12 条数量门。
    if len(hook_items) >= 1 and rendered_hooks == 0:
        errors.append(f"[SOURCE_COVERAGE] S9.8 标题钩子已生成但未渲染进报告：source={len(hook_items)}, rendered={rendered_hooks}")

    if "data-content-calendar='true'" not in html_text and 'data-content-calendar="true"' not in html_text:
        errors.append("[SOURCE_COVERAGE] S8 内容日历未渲染到客户报告")
    if "data-title-hooks='true'" not in html_text and 'data-title-hooks="true"' not in html_text:
        errors.append("[SOURCE_COVERAGE] S9.8 内容标题钩子小节未渲染")
    calendar_pos = min(
        pos for pos in (
            html_text.find("data-content-calendar='true'"),
            html_text.find('data-content-calendar="true"'),
        ) if pos >= 0
    ) if "data-content-calendar" in html_text else -1
    hook_pos = min(
        pos for pos in (
            html_text.find("data-title-hooks='true'"),
            html_text.find('data-title-hooks="true"'),
        ) if pos >= 0
    ) if "data-title-hooks" in html_text else -1
    if calendar_pos >= 0 and hook_pos >= 0 and hook_pos <= calendar_pos:
        errors.append("[SOURCE_COVERAGE] 内容标题钩子必须紧接在 12 周内容编排之后")
    # S9 行动现在通过“优先行动清单”承接（RECOMMENDED_ACTIONS_TABLE），
    # 报告最后一部分改为 GEO 业务流程图（不再是 90 天路线图）。
    # 因此不再要求 data-s9-roadmap；仅在流程图未渲染时提示。
    if "data-geo-workflow='true'" not in html_text and 'data-geo-workflow="true"' not in html_text:
        errors.append("[SOURCE_COVERAGE] GEO 业务流程图未渲染到报告最后一部分")

    # ------------------------------------------------------------------
    # 结构件“有数据必渲染”完整性自检（不涉及字数，只看是否生成了对应可视化产物）。
    # 目的：抓住“上游有结构化数据，但因键名不符/渲染函数问题而没有进报告”的问题，
    # 例如问答矩阵键名 matrix/questions 不一致导致的表格缺失。
    def _has_rows(value: Any, keys: tuple[str, ...]) -> bool:
        if not isinstance(value, dict):
            return False
        for k in keys:
            v = value.get(k)
            if isinstance(v, list) and any(isinstance(x, dict) for x in v):
                return True
            if isinstance(v, list) and v:
                return True
        return False

    content_calendar = structured.get("content_calendar")
    trend_scorecard = structured.get("trend_scorecard")
    positioning_data = structured.get("positioning_json")
    semantic_scorecard = structured.get("semantic_scorecard")
    citation_analysis = structured.get("citation_analysis")
    visual_gallery = structured.get("visual_evidence_gallery")

    structure_render_report: dict[str, Any] = {}
    # 内容日历：有 weeks 或顶层 items/content_items 就必须渲染出 content-calendar-table
    if _has_rows(content_calendar, ("weeks", "items", "content_items", "calendar", "list")):
        rendered = "content-calendar-table" in html_text
        structure_render_report["content_calendar_table"] = rendered
        if not rendered:
            errors.append("[STRUCTURE_RENDER] S8 内容日历有数据但未渲染为内容日历表格")
    # 趋势打分卡：有 trends 就必须渲染出趋势表（机会含义列）
    if _has_rows(trend_scorecard, ("trends", "trend_scores", "items")):
        rendered = "机会含义" in html_text
        structure_render_report["trend_table"] = rendered
        if not rendered:
            errors.append("[STRUCTURE_RENDER] S3 趋势打分卡有数据但未渲染为趋势表")
    normalized_matrix = normalize_differentiation_matrix(positioning_data)
    matrix_rendered = (
        "data-differentiation-matrix='true'" in html_text
        or 'data-differentiation-matrix="true"' in html_text
    )
    structure_render_report["differentiation_matrix"] = matrix_rendered
    if not normalized_matrix.get("rows") or not normalized_matrix.get("competitors"):
        errors.append("[STRUCTURE_RENDER] S4 差异化矩阵缺少有效维度或竞品分值")
    elif not matrix_rendered:
        errors.append("[STRUCTURE_RENDER] S4 差异化矩阵有数据但未完整渲染")
    if isinstance(semantic_scorecard, dict) and isinstance(semantic_scorecard.get("dimensions"), dict):
        chart_rendered = "data-semantic-dimension-chart='true'" in html_text or 'data-semantic-dimension-chart="true"' in html_text
        structure_render_report["semantic_dimension_chart"] = chart_rendered
        if not chart_rendered:
            errors.append("[STRUCTURE_RENDER] S5.5 语义资产评分卡有维度数据但未渲染五维条形图")
    if citation_analysis_is_ready(citation_analysis):
        citation_rendered = "data-citation-analysis='uploaded-spreadsheet'" in html_text or 'data-citation-analysis="uploaded-spreadsheet"' in html_text
        structure_render_report["uploaded_citation_analysis"] = citation_rendered
        if not citation_rendered:
            errors.append("[STRUCTURE_RENDER] 已确认的上传引用分析数据未渲染进语义资产审计下半部分")
    gallery_assets = visual_gallery.get("assets") if isinstance(visual_gallery, dict) else []
    if isinstance(gallery_assets, list) and gallery_assets:
        gallery_rendered = "data-visual-evidence-gallery=" in html_text and "<img" in html_text
        structure_render_report["visual_evidence_gallery"] = gallery_rendered
        if not gallery_rendered:
            errors.append("[STRUCTURE_RENDER] 已验证的视觉资产未渲染为分析依据图片")
    report["structure_render"] = structure_render_report

    return report, errors


def render_html(data: dict[str, Any]) -> str:
    template_path = Path(__file__).resolve().parents[1] / "templates" / "panorama_report_template.html"
    if not template_path.exists():
        raise RuntimeError(f"Missing S10 template: {template_path}")
    template = template_path.read_text(encoding="utf-8")

    brand = data["meta"]["brand"]
    company_name = data["meta"].get("company_name") or brand
    product = data["meta"].get("main_product") or "核心产品"
    generated_at = data["meta"].get("generated_at") or datetime.now(timezone.utc).isoformat()
    summary = data.get("monitoring_summary", {}) or {}
    records = data.get("monitoring_records", []) or []
    raw_sections = data.get("strategy_sections", {}) or {}
    sections = {
        key: filter_customer_section_markdown(key, str(value or ""))
        for key, value in raw_sections.items()
    } if isinstance(raw_sections, dict) else {}
    structured = data.get("structured_sources", {}) or {}
    title_hooks = data.get("title_hooks")
    monitoring_meta = data.get("monitoring_data_meta", {}) if isinstance(data.get("monitoring_data_meta"), dict) else {}
    monitoring_data_provenance = data.get("monitoring_data_provenance", {}) if isinstance(data.get("monitoring_data_provenance"), dict) else {}
    monitoring_source_kind = _monitoring_source_kind(monitoring_meta, monitoring_data_provenance)

    trend_scorecard = structured.get("trend_scorecard")
    positioning_raw = sections.get("positioning", "")
    positioning_json = enrich_positioning_data(structured.get("positioning_json"), positioning_raw, brand)
    structured["positioning_json"] = positioning_json
    enablement_raw = sections.get("enablement", "")
    actions = extract_recommended_actions(structured.get("s9_enablement_md_raw") or enablement_raw)
    themes = extract_reputation_themes(records)
    theme_html = "<p class='muted'>当前负向直问样本未形成稳定风险主题，或有效回答不足。</p>" if not themes else "<p>本轮负向直问中较常出现的风险/问题主题包括：</p><p>" + " ".join(f"<span class='tag-negative'>{e(t)}</span>" for t in themes) + "</p>"

    cover_cards = "".join([
        f"<div class='cover-meta-item'><span class='value'>{e(summary.get('expected_records', 30))}</span><span class='label'>监控样本</span><span class='sublabel'>固定问题</span></div>",
        f"<div class='cover-meta-item'><span class='value'>{e(summary.get('successful_records', 0))}</span><span class='label'>成功记录</span><span class='sublabel'>真实答案</span></div>",
        "<div class='cover-meta-item'><span class='value'>趋势×定位</span><span class='label'>咨询主线</span><span class='sublabel'>先判断再行动</span></div>",
        "<div class='cover-meta-item'><span class='value'>90D</span><span class='label'>行动路线图</span><span class='sublabel'>GEO增长</span></div>",
    ])

    section_brand_facts = f"""
<p>{e(brand)} 的全景诊断以品牌事实为底座：哪些事实能支撑定位、问答和 AI 推荐，哪些信息需要补充为可公开引用的证据。</p>
{cards([(brand, '品牌/业务', company_name, 'purple'), (product, '核心品类', '用于推荐可见度问题', 'blue'), (str(summary.get('expected_records', 30)), '监控样本', '固定问题', 'green'), ('90天', '行动周期', '诊断-修复-复测', 'red')])}
<table class='config-table'><thead><tr><th>关键字段</th><th>当前口径</th><th>客户价值</th></tr></thead><tbody>
<tr><td>企业名称</td><td>{e(company_name)}</td><td>校准实体识别与可信证据主体</td></tr>
<tr><td>品牌名</td><td>{e(brand)}</td><td>用于 AI 提及、舆情直问和定位判断</td></tr>
<tr><td>核心产品/业务</td><td>{e(product)}</td><td>用于推荐场景与品类机会归因</td></tr>
<tr><td>最终策略主线</td><td>市场机会 × 品牌定位 × AI 可见性 × GEO 行动</td><td>把分析结论转为可执行增长路线图</td></tr>
</tbody></table>
<h2>品牌事实与可引用资产</h2>{source_block('brand_facts', client_md_to_html(sections.get('brand_facts', ''), 3600))}
"""

    # Cover scope needs a display-ready list of the actual monitored platforms.
    platform_names = "、".join(
        platform_display(p)
        for p in sorted({str(r.get("platform")) for r in records if r.get("platform")})
    ) or "本次监控平台"

    # Generate a negative summary table instead of full text samples
    neg_table_rows = []
    platforms = set(r.get("platform") for r in records if is_q2_record(r))
    for plat in sorted(platforms):
        p_records = [r for r in records if is_q2_record(r) and r.get("platform") == plat and r.get("answerContent")]
        if not p_records:
            continue
        # Extract themes/keywords specifically for this platform's answers
        p_themes = extract_reputation_themes(p_records, max_items=3)
        theme_tags = " ".join(f"<span class='tag-negative'>{e(t)}</span>" for t in p_themes)
        
        # Summarize the core negative outputs into a concise, clean sentence.
        # Clean markdown markers, drop list numbering / headings, then pick a
        # representative complete sentence (prefer one mentioning a negative theme).
        import re as _re
        raw_ans = clean_answer_for_display(p_records[0].get("answerContent", ""))
        # remove residual markdown heading/list/quote markers and inline emphasis
        flat = _re.sub(r"[#>*`]+", "", raw_ans)
        flat = _re.sub(r"\d+[\.、)]\s*", "", flat)
        # drop citation/reference bracket residues like [[1]], [1], 【1】, （来源…）
        flat = _re.sub(r"[\[\]【】]+", "", flat)
        flat = _re.sub(r"\s+", "", flat)
        # split into sentences on Chinese/After punctuation
        sentences = [s for s in _re.split(r"(?<=[。；！？])", flat) if len(s.strip()) >= 6]
        chosen = ""
        for s in sentences:
            if any(t in s for t in p_themes):
                chosen = s
                break
        if not chosen and sentences:
            chosen = sentences[0]
        if not chosen:
            chosen = flat
        core_output = chosen[:80] + "\u2026" if len(chosen) > 80 else chosen
        
        neg_table_rows.append(f"<tr><td>{e(platform_display(plat))}</td><td>{e(core_output)}</td><td>{theme_tags}</td></tr>")
    
    neg_table_html = ""
    if neg_table_rows:
        neg_table_html = "<table><thead><tr><th>AI平台</th><th>产品缺点类核心负面输出</th><th>负面关键词</th></tr></thead><tbody>" + "".join(neg_table_rows) + "</tbody></table>"
    else:
        neg_table_html = "<p class='muted'>本轮监控未捕获到明显的负面输出。</p>"

    reputation_body = f"""
<p>本部分只基于负向直问样本进行归因，不把缺点/问题类回答计入品牌推荐率或排名。咨询意义在于识别信任建立路径上的“阻断因素”，再把阻断因素转化为 FAQ、官网证据页和客服/运营修复任务。</p>
{theme_html}
<h2>平台负面输出总结</h2>
{neg_table_html}
<h2>风险回应方向</h2><div class='warning-box'>若 AI 回答出现品牌混淆、负面联想、官网缺失、资质不明或案例不足，应优先通过官网事实页、企业信息校准、权威证明补齐和 FAQ 回应矩阵进行修复。</div>
"""

    citation_body = ""

    method_note_html = (
        "<ul>"
        f"<li>{e(monitoring_source_note(data))}</li>"
        f"<li>监控问题固定为：{e(product)}推荐；{e(brand)}有什么缺点和问题？</li>"
        "<li>样本量按 2 个问题 × 本次实际平台数 × 每平台 5 次动态计算。</li>"
        "<li>推荐题用于产品推荐可见度、品牌提及与竞品占位；负向题仅用于风险和舆情分析。</li>"
        "<li>市场机会与定位判断是报告中的咨询核心：前者决定增长叙事方向，后者决定品牌心智位置与差异化证据链。</li>"
        "<li>AI 回答可能受平台、时间、联网结果和模型策略影响，报告结论用于品牌 GEO 优化参考，不等同于事实认证。</li>"
        "</ul>"
    )

    replacements = {
        "{{BRAND_NAME}}": e(brand),
        "{{REPORT_BRAND_LINE}}": "FrontMind · AI Search Visibility & Brand Strategy Consulting",
        "{{REPORT_DATE}}": e(generated_at[:10]),
        "{{REPORT_SCOPE}}": e(f"{company_name}｜{product}｜{platform_names}"),
        "{{KPI_CARDS}}": cover_cards,
        "{{TOC_ITEMS}}": toc_html(),
        "{{EXECUTIVE_SUMMARY}}": render_executive_summary(data, sections, structured, actions, themes),
        "{{REPORT_SCOPE_BLOCK}}": render_report_scope_block(summary, records, brand, company_name, product),
        "{{SECTION_BRAND_FACTS}}": section_brand_facts,
        "{{AI_MONITORING_BRIEF}}": render_monitoring_brief(summary, brand, product),

        "{{CORE_FINDING}}": e(f"本轮固定问题监控共应完成 {summary.get('expected_records', 30)} 条记录；推荐题用于可见度，负向题用于舆情风险，二者分流计算。"),
        "{{FIXED_QUESTIONS_TABLE}}": fixed_questions_table(product, brand),
        "{{AI_VISIBILITY_CHARTS}}": render_ai_visibility_charts(records, summary, brand, company_name, positioning_json),

        "{{MARKET_OPPORTUNITY_SUMMARY}}": render_market_opportunity_summary(trend_scorecard, product, bool(sections.get('trends'))),
        "{{TREND_RADAR_TABLE}}": render_trend_radar_html(trend_scorecard),
        "{{OPPORTUNITY_PRIORITY_TABLE}}": render_opportunity_priority_html(trend_scorecard),
        "{{POSITIONING_STATEMENT_CARD}}": render_positioning_statement_card(positioning_json, brand),
        "{{VALUE_TRIANGLE_TABLE}}": render_value_triangle_table(positioning_json),
        "{{DIFFERENTIATION_MATRIX}}": render_differentiation_matrix_html(positioning_json, brand),
        "{{STRATEGIC_CHOICES}}": render_strategic_choices_html(trend_scorecard, positioning_json),
        "{{RECOMMENDED_ACTIONS_TABLE}}": render_recommended_actions_html(actions),
        "{{GEO_WORKFLOW_DIAGRAM}}": render_geo_workflow_diagram_html(),
        "{{SECTION_MARKETING_ATLAS}}": source_block('marketing', client_md_to_html(sections.get('marketing', ''), 2800)),
        "{{SECTION_CATEGORY_TRENDS}}": source_block('trends', client_md_to_html(sections.get('trends', ''), 3600)),
        "{{SECTION_POSITIONING}}": source_block('positioning', client_md_to_html(positioning_raw, 3200)),
        "{{SECTION_DIAGNOSTIC}}": source_block('diagnostic', client_md_to_html(sections.get('diagnostic', ''), 3600)),
        "{{SEMANTIC_DIMENSION_CHART}}": render_semantic_dimension_chart_html(structured.get('semantic_scorecard')),
        "{{SECTION_SEMANTIC_ASSET}}": source_block('semantic', client_md_to_html(sections.get('semantic', ''), 3000)),
        "{{UPLOADED_CITATION_ANALYSIS}}": (
            render_uploaded_citation_analysis_html(structured.get('citation_analysis'))
            if monitoring_source_kind in ("uploaded_spreadsheet", "molizhishu_api")
            else ""
        ),
        "{{SECTION_VERBAL}}": source_block('verbal', client_md_to_html(sections.get('verbal', ''), 3000)),
        "{{VISUAL_EVIDENCE_GALLERY}}": render_visual_evidence_gallery_html(structured.get('visual_evidence_gallery')),
        "{{SECTION_VISUAL}}": source_block('visual', client_md_to_html(sections.get('visual', ''), 3000)),
        "{{SECTION_QA_ARCHITECTURE}}": source_block('qa_architecture', (
            (client_md_to_html(sections.get('qa_architecture', ''), 3800) if sections.get('qa_architecture', '').strip() else "")
            + render_content_calendar_html(structured.get('content_calendar'))
            + render_title_hooks_html(title_hooks)
        )),
        "{{QA_SCENE_MATRIX}}": "",
        "{{SECTION_ENABLEMENT}}": source_block('enablement', client_md_to_html(enablement_raw, 3600)),
        "{{REPUTATION_ANALYSIS}}": reputation_body,
        "{{METHOD_NOTE}}": method_note_html,
    }
    html_text = template
    for key, value in replacements.items():
        html_text = html_text.replace(key, value)
    html_text = normalize_template_terms(html_text)
    unresolved = sorted(set(re.findall(r"{{[A-Z0-9_]+}}", html_text)))
    if unresolved:
        raise ValueError(f"Unresolved template placeholders: {', '.join(unresolved)}")
    return html_text


def validate_panorama_template_compliance(html_text: str, data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required_terms = [
        "AI智能品牌优化方案", "目 录", "经营层摘要：结论、判断与优先级",
        "第一部分：报告范围与诊断口径", "第二部分：市场趋势与品类机会",
        "第三部分：品牌定位与竞争战略", "第四部分：用户意图与问题路径",
        "第五部分：问答架构与内容承接", "第六部分：AI 可见性诊断",
        "第七部分：语义资产审计", "第八部分：话语资产与视觉资产",
        "第九部分：风险管理", "第十部分：GEO 战略选择",
        "第十一部分：GEO 业务流程", "GEO 业务流程", "12 周内容编排",
        "data-content-calendar", "data-title-hooks", "data-differentiation-matrix",
        "data-geo-workflow", "divider-page",
    ]
    # Enforce that the asset sections are placed BEFORE the AI-visibility diagnosis,
    # and that GEO / roadmap / methodology are the final sections.
    order_anchors = [
        "第四部分：用户意图与问题路径",
        "第六部分：AI 可见性诊断",
        "第七部分：语义资产审计",
        "第九部分：风险管理",
        "第十部分：GEO 战略选择",
        "第十一部分：GEO 业务流程",
    ]
    positions = [html_text.find(a) for a in order_anchors]
    if all(p >= 0 for p in positions) and positions != sorted(positions):
        errors.append("S10 章节顺序错误：AI 可见性诊断、语义资产、风险管理之后须以 GEO 战略与业务流程收口")
    for term in required_terms:
        if term not in html_text:
            errors.append(f"S10 HTML 缺少客户版全景报告必需结构：{term}")
    unresolved = sorted(set(re.findall(r"{{[A-Z0-9_]+}}", html_text)))
    if unresolved:
        errors.append("S10 HTML 仍含未替换占位符：" + ", ".join(unresolved))
    visible = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html_text, flags=re.I)
    visible = re.sub(r"<[^>]+>", " ", visible)
    visible = html.unescape(re.sub(r"\s+", " ", visible)).strip()
    module_count = len(re.findall(r"<section[^>]+class=['\"][^'\"]*\breport-page\b", html_text, flags=re.I))
    # 模块数 / 客户可见正文字数门已取消（阈值均为 0，不再阻断）。
    # 仅在报告完全没有任何内容模块时提示（避免生成空报告）。
    if module_count == 0:
        errors.append("S10 报告未检测到任何内容模块（report-page=0）")
    divider_count = len(re.findall(r"<div[^>]+class=['\"][^'\"]*\bdivider-page\b", html_text, flags=re.I))
    if divider_count != 11:
        errors.append(f"S10 客户报告必须恰好包含 11 个章节分隔页：actual={divider_count}")
    expected_source_keys = set(SECTION_MIN_CHARS)
    source_keys = re.findall(r"data-source-key=['\"]([^'\"]+)['\"]", html_text)
    if len(source_keys) != len(expected_source_keys):
        errors.append(f"S10 来源正文块数量异常：actual={len(source_keys)}, expected={len(expected_source_keys)}")
    for key in sorted(expected_source_keys):
        count = source_keys.count(key)
        if count != 1:
            errors.append(f"S10 来源正文块必须且只能出现一次：{key}={count}")
    coverage_gate = data.get("source_coverage_gate", {}) if isinstance(data.get("source_coverage_gate"), dict) else {}
    if coverage_gate and not coverage_gate.get("passed"):
        errors.append("S10 源内容覆盖门未通过")
    forbidden_customer_terms = [
        "框架版本", "生成时间：", "生成日期：", "报告节选", "工作流证据地图",
        "以“None”", "以\"None\"", "待 S", "待补齐", "S1_", "S2_", "S3_", "S4_",
        "S5_", "S6_", "S7_", "S8_", "S9_", "reasoningProcess", "思考过程",
        "截图 有", "截图</th>", "COT_START", "COT_END", "暂无", "大容量运动潮酷水具",
        "官网与第三方平台权重", "信源生态", "高频引用来源", "信源建设缺口",
        "本页保留客户决策所需摘要", "数据来源、局限性与复盘机制", "……", "......",
        "GEO_A1:", "个核心问题", "问题优先级与内容承接矩阵", "30 条问题清单",
        "质量与风险闸门", "句式模板", "data-trend-opportunity-chart", "竞品心智地图",
        "危机与错误信息回应模板", "下游注入规则", "重校触发条件",
        "recommended_business_actions", "action_id", "CoT-0", "CoT-1", "CoT-2", "CoT-3",
        "第十部分：内容标题钩子",
    ]
    for term in forbidden_customer_terms:
        if term in html_text:
            errors.append(f"S10 客户版 HTML 出现中间产物/模板残留：{term}")
    if LOCAL_PATH_RE.search(html_text):
        errors.append("S10 客户版 HTML 出现本地绝对路径或 file:// 地址")
    if re.search(r"FrontMind[^\n<]{0,120}(?:工作流|输出)", visible, flags=re.I):
        errors.append("S10 客户版 HTML 出现 FrontMind 工作流来源头注")
    if re.search(r"(?:版本\s*[:：]\s*\d|输入\s*[:：]|原则\s*[:：]|工作分支\s*[:：])", visible):
        errors.append("S10 客户版 HTML 出现版本/输入/原则/工作分支等内部头注")
    if re.search(r"<div[^>]+class=['\"][^'\"]*\bsource-stage-block\b[^>]*>[\s\S]*?<h1\b", html_text, flags=re.I):
        errors.append("S10 来源正文块不得渲染来源文档 H1")
    if re.search(
        r"<h[2-6]\b[^>]*>\s*(?:\d+(?:\.\d+)*|[一二三四五六七八九十百零〇]+)"
        r"\s*[、.．]\s*",
        html_text,
        flags=re.I,
    ):
        errors.append("S10 客户版 HTML 仍包含来源稿局部标题编号，可能造成跳号")
    monitoring_sum = data.get("monitoring_summary", {}) if isinstance(data.get("monitoring_summary"), dict) else {}
    monitoring_meta = data.get("monitoring_data_meta", {}) if isinstance(data.get("monitoring_data_meta"), dict) else {}
    expected = int(monitoring_sum.get("expected_records") or 30)
    records = data.get("monitoring_records", []) or []
    partial_accepted = bool(
        data.get("monitoring_data_confirmation_status") == "confirmed"
        and monitoring_meta.get("partial_accepted") is True
        and int(monitoring_sum.get("successful_records") or 0) > 0
    )
    if records and len(records) != expected:
        errors.append(f"S10 读取的监控记录数量不等于预期：actual={len(records)}, expected={expected}")
    if records and int(monitoring_sum.get("successful_records") or 0) <= 0:
        errors.append("S10 不得基于零成功答案生成最终报告")
    elif records and int(monitoring_sum.get("successful_records") or 0) != expected and not partial_accepted:
        errors.append("S10 不得基于未完整成功的数据自动出最终报告；请先完成或明确处理监控数据")
    if data.get("monitoring_data_confirmation_status") != "confirmed":
        errors.append("S10 不得绕过 S5.0 导入确认：问题监控数据未随导入自动确认")
    data_provenance = data.get("monitoring_data_provenance", {}) if isinstance(data.get("monitoring_data_provenance"), dict) else {}
    source_kind = _monitoring_source_kind(monitoring_meta, data_provenance)
    has_citation_module = "data-citation-analysis='uploaded-spreadsheet'" in html_text or 'data-citation-analysis="uploaded-spreadsheet"' in html_text
    if source_kind == "uploaded_spreadsheet" and not has_citation_module:
        errors.append("S10 上传表格分支必须在语义资产审计下半部分渲染引用分析模块")
    if source_kind not in ("uploaded_spreadsheet", "molizhishu_api"):
        errors.append("S10 仅允许 monitoring_data_source=uploaded_spreadsheet 或 molizhishu_api")
    if has_citation_module and any(
        title in html_text
        for title in ("Top 10 高频引用信源", "各模型引用记录量")
    ):
        citation_group_count = len(
            re.findall(
                r"data-citation-chart-group=['\"]true['\"]",
                html_text,
                flags=re.I,
            )
        )
        citation_item_count = len(
            re.findall(
                r"data-citation-chart-item=['\"][^'\"]+['\"]",
                html_text,
                flags=re.I,
            )
        )
        if citation_group_count != 1:
            errors.append(
                "S10 引用分析图表必须且只能有一个不可拆分页组："
                f"actual={citation_group_count}"
            )
        if citation_item_count not in {1, 2}:
            errors.append(
                "S10 引用分析图表项数量异常："
                f"actual={citation_item_count}"
            )
        if not re.search(
            r"data-pagination-policy=['\"]keep-together['\"]",
            html_text,
            flags=re.I,
        ):
            errors.append("S10 引用分析图表组缺少 keep-together 分页策略")
    source_files = data.get("source_files", {}) if isinstance(data.get("source_files"), dict) else {}
    if not source_files.get("monitoring_data"):
        errors.append("S10 缺少 monitoring_data 来源文件")
    upload_provenance_errors = validate_monitoring_uploaded_spreadsheet_provenance(data)
    if upload_provenance_errors:
        errors.extend(upload_provenance_errors)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Render FrontMind S10 panorama report HTML/PDF.")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--company-name", default=None)
    parser.add_argument("--main-product", default="核心产品")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--out-html", required=True)
    parser.add_argument("--out-pdf", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--cover-pdf", default=None, help="Two-page front/back cover PDF. Default: templates/frontmind_cover_front_back.pdf")
    parser.add_argument("--keep-html-cover", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-cover-stitch", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.keep_html_cover or args.no_cover_stitch:
        print(
            "[BLOCKED] 客户报告必须使用唯一官方封面/封底，"
            "--keep-html-cover 与 --no-cover-stitch 已禁用。",
            file=sys.stderr,
        )
        return 2

    work_dir = Path(args.work_dir).resolve()
    out_json = Path(args.out_json)
    out_html = Path(args.out_html)
    out_pdf = Path(args.out_pdf)
    brand = args.brand
    company_name = args.company_name or brand
    monitoring_path = find_first(work_dir, [
        "监控原始数据.json",
        f"S5_{brand}_frontmind_monitoring_data.json",
        f"S5_{company_name}_frontmind_monitoring_data.json",
        f"S5_*_frontmind_monitoring_data.json",
    ])
    monitoring = load_json(monitoring_path)
    title_hooks_path = find_first(work_dir, [
        f"S9.8_{brand}_article_title_hooks.json",
        f"S9.8_{company_name}_article_title_hooks.json",
        f"S9.8_*_article_title_hooks.json",
        f"S9.8_{brand}_标题钩子.json",
        f"S9.8_{company_name}_标题钩子.json",
    ])
    title_hooks = load_json(title_hooks_path)
    records = (monitoring or {}).get("records", []) if isinstance(monitoring, dict) else []
    monitoring_meta = (monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}
    display_brand = str(monitoring_meta.get("brand_name") or brand)

    strategy_sections, strategy_source_paths = load_strategy_sections_with_paths(work_dir, brand)
    structured_sources = load_structured_sources(work_dir, brand)
    structured_sources["visual_evidence_gallery"] = prepare_visual_evidence_gallery(
        structured_sources.get("visual_asset_manifest"),
        work_dir,
        out_html.parent,
    )
    source_manifest = build_source_manifest(
        strategy_source_paths,
        structured_sources.get("paths", {}) if isinstance(structured_sources, dict) else {},
        monitoring_path,
        title_hooks_path,
    )
    data = {
        "meta": {"brand": display_brand, "brand_id": brand, "company_name": company_name, "main_product": args.main_product, "generated_at": datetime.now(timezone.utc).isoformat(), "workflow_version": "本工作流"},
        "monitoring_summary": monitoring_summary(monitoring),
        "monitoring_records": records,
        "monitoring_data_meta": ((monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}),
        "monitoring_data_provenance": (((monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}).get("data_provenance", {}) if isinstance(((monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}), dict) else {}),
        "monitoring_data_confirmation_status": ((monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}).get("data_confirmation_status"),
        "monitoring_partial_accepted": ((monitoring or {}).get("meta", {}) if isinstance(monitoring, dict) else {}).get("partial_accepted") is True,
        "strategy_sections": strategy_sections,
        "structured_sources": structured_sources,
        "title_hooks": title_hooks,
        "source_files": {
            "workspace": str(work_dir),
            "monitoring_data": str(monitoring_path) if monitoring_path else None,
            "title_hooks": str(title_hooks_path) if title_hooks_path else None,
            "strategy_sections": strategy_source_paths,
            "structured_sources": structured_sources.get("paths", {}) if isinstance(structured_sources, dict) else {},
        },
        "source_manifest": source_manifest,
    }

    internal_json = out_json.parent / "_execution" / f"{out_json.stem}_internal.json"

    def persist_report_data() -> None:
        save_json(internal_json, data)
        save_json(out_json, public_report_data(data))

    source_quality_errors = validate_source_file_quality(data)
    data["source_quality_gate"] = {"passed": not source_quality_errors, "errors": source_quality_errors}
    persist_report_data()
    if source_quality_errors:
        print("S10 上游源文件质量门未通过：" + "; ".join(source_quality_errors), file=sys.stderr)
        return 3
    rendered_html = render_html(data)
    coverage_report, coverage_errors = validate_source_coverage(rendered_html, data)
    data["source_coverage_gate"] = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": not coverage_errors,
        "sections": coverage_report,
        "errors": coverage_errors,
    }
    persist_report_data()
    if coverage_errors:
        print("S10 源内容覆盖门未通过：" + "; ".join(coverage_errors), file=sys.stderr)
        return 4
    template_errors = validate_panorama_template_compliance(rendered_html, data)
    visible_for_richness = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", rendered_html, flags=re.I)
    visible_for_richness = re.sub(r"<[^>]+>", " ", visible_for_richness)
    visible_for_richness = html.unescape(re.sub(r"\s+", " ", visible_for_richness)).strip()
    content_modules = len(re.findall(r"<section[^>]+class=['\"][^'\"]*\breport-page\b", rendered_html, flags=re.I))
    # 丰富度门已取消：仅记录实际字数 / 模块数，**不再作为阻断条件**。
    # （字数阈值均为 0，下面的比较永远不会触发；保留记录以便观察报告规模）
    richness_errors: list[str] = []  # 门控已移除，恒为空
    data["report_richness_gate"] = {
        "visible_text_chars": len(visible_for_richness),
        "content_modules": content_modules,
        "required_visible_text_chars": REQUIRED_VISIBLE_TEXT_CHARS,
        "required_content_modules": REQUIRED_CONTENT_MODULES,
        "assembly_mode": "full_rich_report_no_wordcount_gate",
        "gate_enforced": False,
        "passed": True,
        "errors": [],
    }
    data["template_compliance"] = {"target": "S10 panorama_report_template.html", "checked_at": datetime.now(timezone.utc).isoformat(), "passed": not template_errors, "errors": template_errors}
    persist_report_data()
    if template_errors:
        print("S10 全景报告未通过模板强校验：" + "; ".join(template_errors), file=sys.stderr)
        return 5

    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(rendered_html, encoding="utf-8")
    cover_pdf = Path(args.cover_pdf).expanduser() if args.cover_pdf else default_cover_pdf_path()
    if not cover_pdf.is_absolute():
        cover_pdf = (Path.cwd() / cover_pdf).resolve()
    cover_validation = validate_official_cover(cover_pdf)
    if not cover_validation.get("passed"):
        print(
            "S10 官方封面/封底强制校验失败："
            + "; ".join(cover_validation.get("errors") or []),
            file=sys.stderr,
        )
        return 6
    body_pdf = out_pdf.with_name(f"{out_pdf.stem}__body_without_external_cover.pdf")
    ok, renderer = convert_html_to_pdf(out_html, body_pdf)
    pdf_generation = {
        "html_to_pdf_success": ok,
        "renderer_or_error": renderer,
        "cover_stitching_enabled": True,
        "html_cover_removed_during_stitch": True,
        "cover_asset": cover_validation,
    }
    print(f"saved html: {out_html}")
    if not ok:
        data["pdf_generation"] = {**pdf_generation, "success": False}
        persist_report_data()
        print(f"PDF conversion failed: {renderer}")
        return 6
    body_pages = pdf_page_count(body_pdf)
    stitch_ok, stitch_message = stitch_pdf_with_front_back_cover(
        cover_pdf,
        body_pdf,
        out_pdf,
        drop_body_first_page=True,
    )
    cover_gate = (
        verify_final_cover(
            out_pdf,
            cover_pdf,
            body_pages=body_pages,
            dropped_html_cover_pages=1,
        )
        if stitch_ok and body_pages is not None
        else {
            **cover_validation,
            "passed": False,
            "front_match": False,
            "back_match": False,
            "page_count_formula_passed": False,
            "errors": [stitch_message],
        }
    )
    stitch_ok = bool(stitch_ok and cover_gate.get("passed"))
    data["pdf_generation"] = {
        **pdf_generation,
        "success": stitch_ok,
        "cover_stitching_success": stitch_ok,
        "cover_stitching_message": stitch_message,
        "cover_gate": cover_gate,
        "final_page_order": (
            "cover_pdf_page_1 + generated_report_body_without_html_cover "
            "+ cover_pdf_page_2"
        ),
    }
    persist_report_data()
    if stitch_ok:
        try:
            body_pdf.unlink(missing_ok=True)
        except Exception:
            pass
        print(f"saved pdf: {out_pdf} via {renderer}; {stitch_message}")
        return 0
    print(f"PDF cover stitching failed: {stitch_message}")
    print(f"body PDF kept for debugging: {body_pdf}")
    return 7


if __name__ == "__main__":
    raise SystemExit(main())
