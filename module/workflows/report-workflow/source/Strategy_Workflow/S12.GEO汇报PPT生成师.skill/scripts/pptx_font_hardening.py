#!/usr/bin/env python3
"""S12 PPTX 中文字体与文本框加固（本工作流）.

对 svg_to_pptx 导出的原生 PPTX 做三件事（均为本项目实测验证过的修复）：
1. Slide 运行属性中的主题字体引用（+mn-lt/+mn-ea/+mn-cs/+mj-*）替换为显式
   "Microsoft YaHei"——LibreOffice/WPS 不解析运行级主题引用，会渲染成空白中文。
2. <a:spAutoFit/> → <a:noAutofit/>，防止查看器自动改写文本框高度导致错位。
3. 仅对 TextBox 形状把行框 cy×1.55 增高，为 CJK 行高留冗余，防止"半字裁断"。

用法：python3 pptx_font_hardening.py <input.pptx> <output.pptx> [--font "Microsoft YaHei"]
"""
from __future__ import annotations

import argparse
import os
import re
import zipfile


def harden(src: str, dst: str, font: str) -> int:
    zin = zipfile.ZipFile(src)
    zf = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
    patched_slides = 0

    def fix_slide_xml(t: str) -> str:
        nonlocal patched_slides
        changed = False
        for ref in ("+mn-lt", "+mn-ea", "+mn-cs", "+mj-lt", "+mj-ea", "+mj-cs"):
            new = t.replace(f'typeface="{ref}"', f'typeface="{font}"')
            if new != t:
                changed = True
                t = new
        if "<a:spAutoFit/>" in t:
            changed = True
            t = t.replace("<a:spAutoFit/>", "<a:noAutofit/>")

        def fix_sp(m: re.Match[str]) -> str:
            sp = m.group(0)
            if 'name="TextBox' not in sp:
                return sp
            return re.sub(
                r'<a:ext cx="(\d+)" cy="(\d+)"/>',
                lambda mm: f'<a:ext cx="{mm.group(1)}" cy="{int(int(mm.group(2)) * 1.55)}"/>',
                sp,
            )

        new = re.sub(r"<p:sp>.*?</p:sp>", fix_sp, t, flags=re.S)
        if new != t:
            changed = True
            t = new
        if changed:
            patched_slides += 1
        return t

    for item in zin.namelist():
        data = zin.read(item)
        if re.fullmatch(r"ppt/slides/slide\d+\.xml", item):
            text = data.decode("utf-8")
            text = fix_slide_xml(text)
            data = text.encode("utf-8")
        zf.writestr(item, data)
    zf.close()
    zin.close()
    return patched_slides


def main() -> int:
    ap = argparse.ArgumentParser(description="S12 PPTX 字体与文本框加固")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--font", default="Microsoft YaHei")
    args = ap.parse_args()
    if os.path.abspath(args.input) == os.path.abspath(args.output):
        raise SystemExit("输入输出不能是同一文件")
    n = harden(args.input, args.output, args.font)
    print(f"[OK] 加固完成：{n} 个 slide 被修补 → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
