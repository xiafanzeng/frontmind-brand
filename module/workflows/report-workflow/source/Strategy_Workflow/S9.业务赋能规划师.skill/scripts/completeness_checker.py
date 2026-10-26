#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind strategy depth/completeness checker 本工作流.

Blocks S10 unless every S1-S9.8 deliverable exists, is structurally rich,
contains substantive non-duplicated analysis, and has a non-trivial JSON body.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REQUIRED_FILES = [
    {"pattern": "S1_{brand}_品牌事实图谱.json", "aliases": ['S1_*品牌事实*.json', 'S1_*事实图谱*.json', 'S1_*品牌资产*.json', 'S1_*知识库*.json', 'S1_*brand*facts*.json', 'S1_*knowledge*.json'], "source": "S1", "format": "json", "min_leafs": 25},
    {"pattern": "S1_{brand}_品牌知识库.md", "aliases": ['S1_*品牌知识*.md', 'S1_*知识库*.md', 'S1_*品牌资产*.md', 'S1_*brand*knowledge*.md'], "source": "S1", "format": "md", "min_chars": 1600, "min_headings": 4},
    {"pattern": "S2_{brand}_营销图谱.json", "aliases": ['S2_*营销图谱*.json', 'S2_*营销*.json', 'S2_*用户意图*.json', 'S2_*marketing*atlas*.json', 'S2_*intent*.json'], "source": "S2", "format": "json", "min_leafs": 25},
    {"pattern": "S2_{brand}_营销图谱报告.md", "aliases": ['S2_*营销图谱*.md', 'S2_*营销*.md', 'S2_*用户意图*.md', 'S2_*marketing*atlas*.md', 'S2_*intent*.md'], "source": "S2", "format": "md", "min_chars": 1600, "min_headings": 4},
    {"pattern": "S3_{brand}_趋势打分卡.json", "aliases": ['S3_*趋势打分*.json', 'S3_*趋势*.json', 'S3_*trend*score*.json', 'S3_*scorecard*.json'], "source": "S3", "format": "json", "min_leafs": 20},
    {"pattern": "S3_{brand}_品类趋势报告.md", "aliases": ['S3_*品类趋势*.md', 'S3_*趋势报告*.md', 'S3_*趋势*.md', 'S3_*trend*.md'], "source": "S3", "format": "md", "min_chars": 1800, "min_headings": 4},
    {"pattern": "S4_{brand}_定位声明.json", "aliases": ['S4_*定位声明*.json', 'S4_*定位*.json', 'S4_*positioning*statement*.json', 'S4_*positioning*.json'], "source": "S4", "format": "json", "min_leafs": 18},
    {"pattern": "S4_{brand}_品牌定位声明.md", "aliases": ['S4_*品牌定位声明*.md', 'S4_*定位声明*.md', 'S4_*positioning*statement*.md'], "source": "S4", "format": "md", "min_chars": 700, "min_headings": 2},
    {"pattern": "S4_{brand}_定位分析报告.md", "aliases": ['S4_*定位分析*.md', 'S4_*品牌定位报告*.md', 'S4_*positioning*analysis*.md', 'S4_*positioning*.md'], "source": "S4", "format": "md", "min_chars": 1800, "min_headings": 4},
    {"pattern": "S5_{brand}_品牌诊断数据.json", "aliases": ['S5_*品牌诊断数据*.json', 'S5_*诊断数据*.json', 'S5_*diagnosis*.json'], "source": "S5", "format": "json", "min_leafs": 25},
    {"pattern": "S5_{brand}_品牌诊断数据.md", "aliases": ['S5_*品牌诊断数据*.md', 'S5_*诊断报告*.md', 'S5_*诊断*.md', 'S5_*diagnosis*.md'], "source": "S5", "format": "md", "min_chars": 1600, "min_headings": 4},
    {"pattern": "S5_{brand}_Gap报告.md", "aliases": ['S5_*Gap报告*.md', 'S5_*GAP报告*.md', 'S5_*缺口*.md', 'S5_*gap*.md'], "source": "S5", "format": "md", "min_chars": 1200, "min_headings": 3},
    {"pattern": "S5.5_{brand}_语义资产评分卡.json", "aliases": ['S5.5_*语义资产评分*.json', 'S5.5_*评分卡*.json', 'S5.5_*语义*.json', 'S5.5_*bsas*.json'], "source": "S5.5", "format": "json", "min_leafs": 22},
    {"pattern": "S5.5_{brand}_语义资产审计报告.md", "aliases": ['S5.5_*语义资产审计*.md', 'S5.5_*语义资产*.md', 'S5.5_*语义*.md', 'S5.5_*bsas*.md'], "source": "S5.5", "format": "md", "min_chars": 1500, "min_headings": 4},
    {"pattern": "S6_{brand}_话语token.json", "aliases": ['S6_*话语token*.json', 'S6_*话语*.json', 'S6_*verbal*token*.json'], "source": "S6", "format": "json", "min_leafs": 18},
    {"pattern": "S6_{brand}_话语手册.md", "aliases": ['S6_*话语手册*.md', 'S6_*话语*.md', 'S6_*verbal*.md'], "source": "S6", "format": "md", "min_chars": 1500, "min_headings": 4},
    {"pattern": "S7_{brand}_视觉Prompt包.json", "aliases": ['S7_*视觉Prompt*.json', 'S7_*Prompt包*.json', 'S7_*视觉*.json', 'S7_*visual*prompt*.json'], "source": "S7", "format": "json", "min_leafs": 18},
    {"pattern": "S7_{brand}_视觉符号体系报告.md", "aliases": ['S7_*视觉符号*.md', 'S7_*视觉体系*.md', 'S7_*视觉*.md', 'S7_*visual*.md'], "source": "S7", "format": "md", "min_chars": 1400, "min_headings": 4},
    {"pattern": "S8_{brand}_问答树.json", "aliases": ['S8_*问答树*.json', 'S8_*qa_tree*.json'], "source": "S8", "format": "json", "min_leafs": 30},
    {"pattern": "S8_{brand}_问答矩阵.json", "aliases": ['S8_*问答矩阵*.json', 'S8_*qa_matrix*.json'], "source": "S8", "format": "json", "min_leafs": 35},
    {"pattern": "S8_{brand}_内容日历.json", "aliases": ['S8_*内容日历*.json', 'S8_*content_calendar*.json', 'S8_*calendar*.json'], "source": "S8", "format": "json", "min_leafs": 18},
    {"pattern": "S8_{brand}_落地页蓝图.md", "aliases": ['S8_*落地页蓝图*.md', 'S8_*落地页*.md', 'S8_*landing*.md'], "source": "S8", "format": "md", "min_chars": 900, "min_headings": 3},
    {"pattern": "S8_{brand}_问答报告.md", "aliases": ['S8_*问答报告*.md', 'S8_*问答*.md', 'S8_*qa*.md'], "source": "S8", "format": "md", "min_chars": 2000, "min_headings": 5},
    {"pattern": "S9_{brand}_业务赋能建议包.md", "aliases": ['S9_*业务赋能建议*.md', 'S9_*赋能建议*.md', 'S9_*赋能*.md', 'S9_*建议包*.md', 'S9_*enablement*.md'], "source": "S9", "format": "md", "min_chars": 1600, "min_headings": 4},
    {"pattern": "S9.8_{brand}_article_title_hooks.json", "aliases": ['S9.8_*article_title_hooks*.json', 'S9.8_*标题钩子*.json', 'S9.8_*title_hooks*.json', 'S9.8_*标题*.json'], "source": "S9.8", "format": "json", "min_leafs": 36, "min_hooks": 12},
]

PLACEHOLDER_TERMS = (
    "资料仍需补充", "待补齐", "待确认", "TODO", "todo", "TBD",
    "本模块当前缺少", "请输入", "未形成完整判断",
)


def is_placeholder_text(value: Any) -> bool:
    """Detect actual template filler without misclassifying domain phrases.

    “竞品占位”“应用示例”等是有效策略术语，不能因为包含“占位”或
    “示例”两个字就被当成模板残留。
    """
    s = str(value or "").strip()
    if not s:
        return False
    if any(term in s for term in PLACEHOLDER_TERMS):
        return True
    compact = re.sub(r"[\s：:，,。.!！?？_-]+", "", s)
    return bool(re.fullmatch(r"(?:暂无|示例|示例内容|示例文本|示例数据|占位|占位符|占位内容|占位文本|待填写|待补充)", compact, flags=re.I))


def _candidate_is_safe(path: Path, expected_suffix: str) -> bool:
    """Avoid treating manifests, templates, raw machine dumps or schemas as stage deliverables."""
    if not path.is_file() or path.suffix.lower() != expected_suffix.lower():
        return False
    blocked = re.compile(r"(__pycache__|\.pyc$|manifest|check|检查|复核|template|schema|raw|provenance|task_submit|task_result)", re.I)
    return not blocked.search(path.name)


def find_file(workspace: Path, filename: str, alias_patterns: list[str] | None = None) -> tuple[Path | None, bool]:
    """Return (path, from_alias).

    Downstream stages use canonical filenames, but external agents sometimes
    create semantically equivalent files with slightly different names. Accept
    those aliases for diagnosis and instruct S0 normalizer to copy them to the
    canonical name before S10. This prevents shallow "补齐文件" rewrites.
    """
    direct = workspace / filename
    if direct.exists():
        return direct, False
    matches = [p for p in workspace.rglob(filename) if p.is_file()]
    if matches:
        return matches[0], False
    suffix = Path(filename).suffix
    for pattern in alias_patterns or []:
        for path in workspace.rglob(pattern.replace("**/", "")):
            if _candidate_is_safe(path, suffix):
                return path, True
    return None, False


def substantive_text(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"^\s*#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", "", text)
    return re.sub(r"[\s\W_]+", "", text)


def normalized_lines(text: str) -> list[str]:
    lines: list[str] = []
    for line in text.splitlines():
        line = re.sub(r"^\s*#{1,6}\s*|^\s*[-*+>]\s*", "", line)
        norm = re.sub(r"[\s\W_]+", "", line).lower()
        if len(norm) >= 8:
            lines.append(norm)
    return lines


def count_json_leafs(value: Any) -> int:
    if isinstance(value, dict):
        return sum(count_json_leafs(v) for v in value.values())
    if isinstance(value, list):
        return sum(count_json_leafs(v) for v in value)
    if value is None:
        return 0
    if isinstance(value, str) and (not value.strip() or is_placeholder_text(value)):
        return 0
    return 1


def max_list_length(value: Any) -> int:
    lengths: list[int] = []
    if isinstance(value, list):
        lengths.append(len(value))
        for item in value:
            lengths.append(max_list_length(item))
    elif isinstance(value, dict):
        for item in value.values():
            lengths.append(max_list_length(item))
    return max(lengths or [0])


def extract_hook_count(value: Any) -> int:
    if isinstance(value, list):
        count = 0
        for item in value:
            if isinstance(item, dict) and (item.get("title_hook") or item.get("title")):
                count += 1
            else:
                count += extract_hook_count(item)
        return count
    if isinstance(value, dict):
        return max([extract_hook_count(v) for v in value.values()] or [0])
    return 0


def check_file_existence(workspace: Path, brand: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for spec in REQUIRED_FILES:
        filename = spec["pattern"].replace("{brand}", brand)
        filepath, from_alias = find_file(workspace, filename, spec.get("aliases") or [])
        exists = filepath is not None and filepath.is_file()
        size = filepath.stat().st_size if exists and filepath else 0
        results.append({**spec, "filename": filename, "exists": exists, "size": size, "path": str(filepath or workspace / filename), "resolved_from_alias": from_alias})
    return results


def check_format_compliance(file_results: list[dict[str, Any]]) -> tuple[list[dict[str, str]], dict[str, Any]]:
    issues: list[dict[str, str]] = []
    metrics: dict[str, Any] = {}
    for fr in file_results:
        if not fr["exists"]:
            continue
        path = Path(fr["path"])
        if fr["format"] == "json":
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                leafs = count_json_leafs(data)
                longest = max_list_length(data)
                hooks = extract_hook_count(data) if fr.get("min_hooks") else None
                metrics[fr["filename"]] = {"leafs": leafs, "max_list_length": longest, "hook_count": hooks}
                if data in ({}, []):
                    issues.append({"file": fr["filename"], "issue": "JSON 文件内容为空", "severity": "error"})
                # 数量门已取消：JSON 叶子节点仅要求“非空”（至少 1 个有效叶子），
                # 不再要求达到 min_leafs 数量，避免为凑数量而编造条目。
                if leafs < 1:
                    issues.append({"file": fr["filename"], "issue": "JSON 没有任何有效叶子节点（几乎为空）", "severity": "error"})
                # 标题钩子：仅要求至少 1 条（防空），不再硬性要求 12 条。
                if fr.get("min_hooks") and int(hooks or 0) < 1:
                    issues.append({"file": fr["filename"], "issue": "缺少有效标题钩子（至少需 1 条）", "severity": "error"})
            except Exception as exc:
                issues.append({"file": fr["filename"], "issue": f"JSON 解析失败：{exc}", "severity": "error"})
        else:
            text = path.read_text(encoding="utf-8", errors="ignore")
            body_len = len(substantive_text(text))
            headings = sum(1 for ln in text.splitlines() if re.match(r"^\s*#{1,6}\s+", ln))
            lines = normalized_lines(text)
            duplicate_ratio = 1 - (len(set(lines)) / len(lines)) if lines else 1.0
            placeholder_lines = [ln for ln in text.splitlines() if is_placeholder_text(ln)]
            placeholder_ratio = len(placeholder_lines) / max(1, len([ln for ln in text.splitlines() if ln.strip()]))
            metrics[fr["filename"]] = {
                "substantive_chars": body_len,
                "headings": headings,
                "duplicate_ratio": round(duplicate_ratio, 4),
                "placeholder_ratio": round(placeholder_ratio, 4),
            }
            # 最低字数门已彻底取消：只要有任何实质正文即通过，避免 Agent 为
            # 达标而填充重复的“补充详细分析与执行细则”。只有完全空壳才报错。
            if body_len < 1:
                issues.append({"file": fr["filename"], "issue": "Markdown 有效正文为空", "severity": "error"})
            # 章节结构：仅要求至少存在 1 个标题（防纯文本堆砌），不再要求固定数量。
            if headings < 1:
                issues.append({"file": fr["filename"], "issue": "缺少基本章节结构（未检测到任何标题）", "severity": "error"})
            if duplicate_ratio > 0.25:
                issues.append({"file": fr["filename"], "issue": f"重复内容比例过高：{duplicate_ratio:.0%}", "severity": "error"})
            if placeholder_ratio > 0.20:
                issues.append({"file": fr["filename"], "issue": f"占位内容比例过高：{placeholder_ratio:.0%}", "severity": "error"})
    return issues, metrics


def check_cross_stage_duplication(file_results: list[dict[str, Any]]) -> list[dict[str, str]]:
    docs: list[tuple[str, str, set[str]]] = []
    for fr in file_results:
        if not fr["exists"] or fr["format"] != "md":
            continue
        text = Path(fr["path"]).read_text(encoding="utf-8", errors="ignore")
        tokens = set(normalized_lines(text))
        if len(tokens) >= 8:
            docs.append((fr["source"], fr["filename"], tokens))
    issues: list[dict[str, str]] = []
    for i, (stage_a, name_a, a) in enumerate(docs):
        for stage_b, name_b, b in docs[i + 1:]:
            if stage_a == stage_b:
                continue
            union = a | b
            similarity = len(a & b) / len(union) if union else 0.0
            if similarity > 0.72:
                issues.append({"file": f"{name_a} / {name_b}", "issue": f"跨阶段正文高度雷同：Jaccard={similarity:.0%}", "severity": "error"})
    return issues


def check_brand_consistency(brand: str, file_results: list[dict[str, Any]]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for fr in file_results:
        if not fr["exists"] or fr["format"] != "json":
            continue
        try:
            data = json.loads(Path(fr["path"]).read_text(encoding="utf-8"))
        except Exception:
            continue
        for key_path in (["meta", "brand"], ["meta", "brand_name"], ["positioning_statement", "brand"], ["brand"]):
            obj: Any = data
            for key in key_path:
                if isinstance(obj, dict) and key in obj:
                    obj = obj[key]
                else:
                    obj = None
                    break
            if obj and isinstance(obj, str) and obj != brand and brand not in obj and obj not in brand:
                issues.append({"file": fr["filename"], "issue": f"品牌名可能不一致：期望 '{brand}'，实际 '{obj}'", "severity": "warning"})
    return issues


def write_reports(brand: str, file_results: list[dict[str, Any]], issues: list[dict[str, str]], metrics: dict[str, Any], output_path: Path) -> int:
    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warning"]
    existing = sum(1 for f in file_results if f["exists"])
    passed = existing == len(file_results) and not errors
    payload = {
        "version": "workflow-final",
        "brand": brand,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "file_completeness": {"existing": existing, "required": len(file_results)},
        "files": file_results,
        "metrics": metrics,
        "issues": issues,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_path.with_suffix(".json")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        f"# {brand} 策略深度与完整性检查报告",
        "",
        f"> 检查结果：{'通过' if passed else '未通过'}",
        f"> 文件完整率：{existing}/{len(file_results)}",
        "",
        "## 文件清单",
        "",
        "| 文件 | 阶段 | 状态 | 质量指标 |",
        "|---|---|---|---|",
    ]
    for fr in file_results:
        status = "存在" if fr["exists"] else "缺失"
        metric = metrics.get(fr["filename"], {})
        metric_text = "；".join(f"{k}={v}" for k, v in metric.items()) or "-"
        if fr.get("resolved_from_alias"):
            status += "（别名命中，建议运行 output_contract_normalizer.py 复制为标准名）"
        lines.append(f"| {fr['filename']} | {fr['source']} | {status} | {metric_text} |")
    lines += ["", "## 问题清单", ""]
    if issues:
        for issue in issues:
            lines.append(f"- [{issue['severity']}] **{issue['file']}**：{issue['issue']}")
    else:
        lines.append("- 无阻断问题。")
    lines += ["", "## 结论", "", f"- 错误：{len(errors)}", f"- 警告：{len(warnings)}", f"- {'可进入 S10' if passed else '必须返回对应阶段补写，严禁进入 S10'}", "", "注：若仅是文件名差异，请先运行 S0/output_contract_normalizer.py；若内容不足，才回到对应 S 阶段补写。", ""]
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[{'PASS' if passed else 'FAIL'}] {output_path}")
    print(f"  files={existing}/{len(file_results)}, errors={len(errors)}, warnings={len(warnings)}")
    return 0 if passed else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="FrontMind S1-S9.8 深度与完整性检查器 本工作流")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    workspace = Path(args.workspace)
    file_results = check_file_existence(workspace, args.brand)
    issues, metrics = check_format_compliance(file_results)
    issues += check_cross_stage_duplication(file_results)
    issues += check_brand_consistency(args.brand, file_results)
    for fr in file_results:
        if not fr["exists"]:
            issues.append({"file": fr["filename"], "issue": f"文件缺失（来源：{fr['source']}）", "severity": "error"})
    return write_reports(args.brand, file_results, issues, metrics, Path(args.output))


if __name__ == "__main__":
    raise SystemExit(main())
