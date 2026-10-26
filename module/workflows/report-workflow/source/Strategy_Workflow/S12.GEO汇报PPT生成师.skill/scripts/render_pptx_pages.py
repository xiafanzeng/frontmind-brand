#!/usr/bin/env python3
"""S12 PPTX 逐页渲染质检图（本工作流）.

用本机 LibreOffice 将 PPTX 转 PDF 再逐页转 PNG，供视觉质检使用。

前置（仅需一次）：LibreOffice 看不到系统 CJK 字体时，把系统字体复制到其用户字体目录：
  mkdir -p "$HOME/Library/Application Support/LibreOffice/4/user/fonts"
  cp "/System/Library/Fonts/Hiragino Sans GB.ttc" "$HOME/Library/Application Support/LibreOffice/4/user/fonts/"

用法：python3 render_pptx_pages.py <deck.pptx> <out_dir> [--dpi 100] [--pages 1-13]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SOFFICE_CANDIDATES = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
]


def find_soffice() -> str:
    for cand in SOFFICE_CANDIDATES:
        if "/" in cand and Path(cand).exists():
            return cand
        if shutil.which(cand):
            return cand
    raise SystemExit("未找到 LibreOffice（soffice）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pptx")
    ap.add_argument("out_dir")
    ap.add_argument("--dpi", type=int, default=100)
    ap.add_argument("--pages", default=None, help="如 8 或 1-13；默认全部")
    args = ap.parse_args()

    pptx = Path(args.pptx).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    soffice = find_soffice()

    subprocess.run([soffice, "--headless", "--convert-to", "pdf",
                    str(pptx), "--outdir", str(out_dir)],
                   check=True, capture_output=True, timeout=300)
    pdf = out_dir / (pptx.stem + ".pdf")
    if not pdf.exists():
        raise SystemExit(f"PDF 未生成：{pdf}")

    cmd = ["pdftoppm", "-png", "-r", str(args.dpi)]
    if args.pages:
        first, dash, last = args.pages.partition("-")
        if dash:
            cmd += ["-f", first, "-l", last]
        else:
            cmd += ["-f", args.pages, "-l", args.pages]
    cmd += [str(pdf), str(out_dir / "page")]
    subprocess.run(cmd, check=True, timeout=300)

    pages = sorted(out_dir.glob("page-*.png"))
    print(f"[OK] 渲染 {len(pages)} 页 → {out_dir}")
    for p in pages:
        print(" ", p.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
