#!/usr/bin/env python3
"""Shared official front/back cover contract for FrontMind report PDFs."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


OFFICIAL_COVER_FILENAME = "frontmind_cover_front_back.pdf"
OFFICIAL_COVER_SHA256 = "e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d"
OFFICIAL_COVER_PAGE_COUNT = 2
A4_WIDTH_POINTS = 595.0
A4_HEIGHT_POINTS = 842.0
A4_TOLERANCE_POINTS = 3.0


def official_cover_path() -> Path:
    strategy_root = Path(__file__).resolve().parents[1]
    return (
        strategy_root
        / "S10.AI智能品牌优化方案全景报告生成师.skill"
        / "templates"
        / OFFICIAL_COVER_FILENAME
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _pdfinfo(path: Path) -> dict[str, Any]:
    executable = shutil.which("pdfinfo")
    if not executable:
        raise RuntimeError("pdfinfo is required for the official cover contract")
    result = subprocess.run(
        [executable, str(path)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    pages_match = re.search(r"^Pages:\s*(\d+)\s*$", result.stdout, flags=re.M)
    size_match = re.search(
        r"^Page size:\s*([0-9.]+)\s+x\s+([0-9.]+)\s+pts",
        result.stdout,
        flags=re.M,
    )
    encrypted_match = re.search(r"^Encrypted:\s*(\S+)", result.stdout, flags=re.M)
    if not pages_match or not size_match:
        raise RuntimeError("pdfinfo did not return page count and page size")
    return {
        "pages": int(pages_match.group(1)),
        "width": float(size_match.group(1)),
        "height": float(size_match.group(2)),
        "encrypted": (encrypted_match.group(1).lower() if encrypted_match else "unknown"),
    }


def _is_a4(width: float, height: float) -> bool:
    portrait = (
        abs(width - A4_WIDTH_POINTS) <= A4_TOLERANCE_POINTS
        and abs(height - A4_HEIGHT_POINTS) <= A4_TOLERANCE_POINTS
    )
    landscape = (
        abs(height - A4_WIDTH_POINTS) <= A4_TOLERANCE_POINTS
        and abs(width - A4_HEIGHT_POINTS) <= A4_TOLERANCE_POINTS
    )
    return portrait or landscape


def validate_official_cover(path: Path | str | None = None) -> dict[str, Any]:
    cover = Path(path).resolve() if path is not None else official_cover_path().resolve()
    result: dict[str, Any] = {
        "required": True,
        "passed": False,
        "template_filename": OFFICIAL_COVER_FILENAME,
        "template_sha256": None,
        "asset_pages": 0,
        "a4": False,
        "errors": [],
    }
    if not cover.exists() or not cover.is_file() or cover.stat().st_size <= 0:
        result["errors"].append("official front/back cover PDF is missing or empty")
        return result
    try:
        digest = _sha256(cover)
        info = _pdfinfo(cover)
    except Exception as exc:  # noqa: BLE001
        result["errors"].append(f"official cover cannot be validated: {exc}")
        return result

    result["template_sha256"] = digest
    result["asset_pages"] = info["pages"]
    result["a4"] = _is_a4(info["width"], info["height"])
    if digest != OFFICIAL_COVER_SHA256:
        result["errors"].append("official cover SHA-256 does not match the bundled approved asset")
    if info["pages"] != OFFICIAL_COVER_PAGE_COUNT:
        result["errors"].append(
            f"official cover must contain exactly {OFFICIAL_COVER_PAGE_COUNT} pages"
        )
    if not result["a4"]:
        result["errors"].append("official cover pages must be A4")
    if info["encrypted"] not in {"no", "unknown"}:
        result["errors"].append("official cover PDF must not be encrypted")
    result["passed"] = not result["errors"]
    return result


def page_visual_fingerprint(path: Path | str, page_number: int) -> str:
    """Render one page at a fixed resolution and hash normalized RGB pixels."""
    pdf = Path(path).resolve()
    info = _pdfinfo(pdf)
    if page_number < 1 or page_number > int(info["pages"]):
        raise ValueError(f"page {page_number} is outside 1..{info['pages']}")
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise RuntimeError("pdftoppm is required for visual cover verification")

    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="frontmind-cover-fingerprint-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            [
                renderer,
                "-f",
                str(page_number),
                "-l",
                str(page_number),
                "-singlefile",
                "-png",
                "-r",
                "72",
                str(pdf),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
        )
        rendered = prefix.with_suffix(".png")
        with Image.open(rendered) as image:
            normalized = image.convert("RGB")
            payload = (
                f"{normalized.width}x{normalized.height}:RGB:".encode("ascii")
                + normalized.tobytes()
            )
    return hashlib.sha256(payload).hexdigest()


def verify_final_cover(
    final_pdf: Path | str,
    cover_pdf: Path | str | None = None,
    *,
    body_pages: int | None = None,
    dropped_html_cover_pages: int | None = None,
) -> dict[str, Any]:
    final_path = Path(final_pdf).resolve()
    cover_path = (
        Path(cover_pdf).resolve() if cover_pdf is not None else official_cover_path().resolve()
    )
    asset = validate_official_cover(cover_path)
    result: dict[str, Any] = {
        **asset,
        "front_match": False,
        "back_match": False,
        "front_fingerprint": None,
        "back_fingerprint": None,
        "body_pages": body_pages,
        "dropped_html_cover_pages": dropped_html_cover_pages,
        "final_pages": 0,
        "page_count_formula_passed": None,
    }
    if not asset["passed"]:
        return result
    if not final_path.exists() or not final_path.is_file() or final_path.stat().st_size <= 0:
        result["errors"].append("final report PDF is missing or empty")
        result["passed"] = False
        return result
    try:
        final_info = _pdfinfo(final_path)
        final_pages = int(final_info["pages"])
        if final_pages < 3:
            raise RuntimeError("final report must contain front cover, body, and back cover")
        expected_front = page_visual_fingerprint(cover_path, 1)
        expected_back = page_visual_fingerprint(cover_path, 2)
        actual_front = page_visual_fingerprint(final_path, 1)
        actual_back = page_visual_fingerprint(final_path, final_pages)
        result["front_fingerprint"] = actual_front
        result["back_fingerprint"] = actual_back
        result["front_match"] = actual_front == expected_front
        result["back_match"] = actual_back == expected_back
        result["final_pages"] = final_pages
        if body_pages is not None and dropped_html_cover_pages is not None:
            expected_pages = (
                int(body_pages)
                - int(dropped_html_cover_pages)
                + OFFICIAL_COVER_PAGE_COUNT
            )
            result["page_count_formula_passed"] = final_pages == expected_pages
        if not result["front_match"]:
            result["errors"].append("final PDF first page is not the approved official cover")
        if not result["back_match"]:
            result["errors"].append("final PDF last page is not the approved official back cover")
        if result["page_count_formula_passed"] is False:
            result["errors"].append("final PDF page count does not match cover/body assembly")
    except Exception as exc:  # noqa: BLE001
        result["errors"].append(f"final cover verification failed: {exc}")
    result["passed"] = not result["errors"]
    return result

