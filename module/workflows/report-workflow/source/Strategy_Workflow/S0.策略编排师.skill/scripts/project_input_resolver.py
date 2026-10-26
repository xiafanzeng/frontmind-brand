#!/usr/bin/env python3
"""FrontMind 本工作流 Project Input Resolver.

Normalises sparse project input before S1. The script does not perform web
research. It creates a structured missing-information plan so S1/S3/S4 can
complete the optional fields through Wide Research with evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

VERSION = "workflow-final"

FIELD_ALIASES = {
    "brand_name": ["企业名称", "品牌名称", "公司名称", "brand_name", "brand", "company", "company_name"],
    "official_site": ["官方网站", "官网", "网站", "official_site", "official_website", "website", "url"],
    "industry_category": ["所在行业/品类", "行业/品类", "行业", "品类", "industry", "category", "industry_category"],
    "main_product_service": ["核心产品/服务", "核心产品", "核心服务", "产品服务", "main_product", "main_service", "main_product_service"],
    "target_market": ["目标市场/地区", "目标市场", "地区", "市场", "target_market", "market", "region"],
    "competitors": ["竞争对手", "竞品", "对手", "competitors", "competition"],
    "user_notes": ["用户备注", "备注", "补充说明", "需求", "user_notes", "notes", "brief"],
    "report_language": ["报告语言", "语言", "report_language", "language"],
}

CHINESE_LABEL_TO_FIELD = {
    alias.lower(): field
    for field, aliases in FIELD_ALIASES.items()
    for alias in aliases
}

UNKNOWN_TOKENS = {
    "", "未知", "未提供", "待调研", "待研究", "n/a", "na", "none", "null",
    "无", "不清楚", "暂缺", "留空", "待补充", "unknown", "not provided",
    "tbd", "待定", "-", "—", "_",
}

OPTIONAL_FIELDS = [
    "official_site",
    "industry_category",
    "main_product_service",
    "target_market",
    "competitors",
    "user_notes",
    "report_language",
]

FIELD_LABELS = {
    "brand_name": "企业名称",
    "official_site": "官方网站",
    "industry_category": "所在行业/品类",
    "main_product_service": "核心产品/服务",
    "target_market": "目标市场/地区",
    "competitors": "竞争对手",
    "user_notes": "用户备注",
    "report_language": "报告语言",
}

RESEARCH_PLAN = {
    "official_site": {
        "stage": "S1",
        "method": "Wide Research 识别候选官网、官方公告/社媒、权威资料并交叉验证",
        "pause_if": "出现多个高相似企业或官网候选，且无法用来源消歧",
    },
    "industry_category": {
        "stage": "S1/S3",
        "method": "根据主营业务、产品/服务、收入来源、市场报道和行业资料推断一级行业与细分品类",
        "pause_if": "行业跨度过大且会影响报告框架",
    },
    "main_product_service": {
        "stage": "S1/S4",
        "method": "提炼最适合作为固定问题 Q1 的核心产品/服务对象，并在暂停点 1 让用户确认",
        "pause_if": "存在多个完全不同的核心业务对象且无法排序",
    },
    "target_market": {
        "stage": "S1/S3",
        "method": "根据官网地区、业务布局、财报/新闻、门店/服务范围识别核心市场与延展市场",
        "pause_if": "地理市场会显著改变竞品集但资料冲突",
    },
    "competitors": {
        "stage": "S4",
        "method": "识别 3-5 个高相关竞品、标杆或替代方案，标记为 workflow_researched",
        "pause_if": "用户备注要求特定对标但品牌名称不完整或存在同名冲突",
    },
    "user_notes": {
        "stage": "S4/S5/S8/S9/S10",
        "method": "若为空，则采用默认目标：AI 搜索可见性、语义资产、问答架构和业务转化",
        "pause_if": "不需要暂停",
    },
    "report_language": {
        "stage": "S0.1",
        "method": "默认中文",
        "pause_if": "不需要暂停",
    },
}


def is_unknown(value: Any) -> bool:
    if value is None:
        return True
    s = str(value).strip()
    if not s:
        return True
    lowered = s.lower().strip()
    if lowered in UNKNOWN_TOKENS:
        return True
    # Treat unreplaced placeholders as missing.
    if re.fullmatch(r"\{[^{}]+\}", s):
        return True
    if "or_unknown" in lowered or "未提供" in lowered or "待调研" in lowered:
        return True
    return False


def safe_brand_id(brand_name: str) -> str:
    brand = brand_name.strip()
    # Preserve CJK, letters, numbers, underscore and hyphen.
    brand = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", brand, flags=re.UNICODE)
    brand = re.sub(r"_+", "_", brand).strip("_")
    return brand or "brand"


def parse_text(raw: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    lines = [line.rstrip() for line in raw.splitlines()]
    freeform: List[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Supports Chinese colon and ASCII colon.
        if "：" in stripped:
            key, value = stripped.split("：", 1)
        elif ":" in stripped:
            key, value = stripped.split(":", 1)
        else:
            freeform.append(stripped)
            continue
        key_norm = key.strip().lower()
        field = CHINESE_LABEL_TO_FIELD.get(key_norm)
        if field:
            data[field] = value.strip()
        else:
            freeform.append(stripped)
    if freeform and "user_notes" not in data:
        data["user_notes"] = "\n".join(freeform)
    return data


def parse_input(path: Path) -> Tuple[Dict[str, Any], str]:
    raw = path.read_text(encoding="utf-8")
    stripped = raw.strip()
    if stripped.startswith("{"):
        try:
            obj = json.loads(stripped)
            data: Dict[str, Any] = {}
            for key, value in obj.items():
                field = CHINESE_LABEL_TO_FIELD.get(str(key).strip().lower(), key)
                if field in FIELD_LABELS:
                    data[field] = value
            return data, raw
        except json.JSONDecodeError:
            pass
    return parse_text(raw), raw


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def build_markdown(result: Dict[str, Any]) -> str:
    known = result["known_inputs"]
    missing = result["missing_optional_fields"]
    plan = result["supplement_plan"]
    lines = [
        f"# S0.1 输入解析与补全计划 — {result['brand_name']}",
        "",
        f"- Workflow 版本：{VERSION}",
        f"- brand_name：{result['brand_name']}",
        f"- brand_id：{result['brand_id']}",
        f"- 生成时间：{result['created_at']}",
        "",
        "## 已知输入",
        "",
    ]
    if known:
        for field, value in known.items():
            lines.append(f"- {FIELD_LABELS.get(field, field)}：{value}")
    else:
        lines.append("- 暂无除企业名称外的有效输入。")
    lines.extend(["", "## 待研究补全项", ""])
    if missing:
        for field in missing:
            meta = RESEARCH_PLAN[field]
            lines.append(f"- {FIELD_LABELS[field]}：由 {meta['stage']} 补全；方法：{meta['method']}")
    else:
        lines.append("- 无。")
    lines.extend(["", "## 补全执行要求", ""])
    for item in plan:
        lines.append(f"### {item['field_label']}")
        lines.append(f"- 负责阶段：{item['stage']}")
        lines.append(f"- 研究方法：{item['method']}")
        lines.append(f"- 暂停条件：{item['pause_if']}")
        lines.append("")
    lines.extend([
        "## 歧义与暂停规则",
        "",
        "- 若同名企业过多、官网候选冲突、核心业务对象无法唯一确认，必须先暂停向用户确认。",
        "- 不得把缺失字段直接写入最终 PDF。",
        "- 缺失项的补全必须带来源、置信度和不确定性说明。",
    ])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve sparse FrontMind project input before S1.")
    parser.add_argument("--input", required=True, help="Path to raw project input text or JSON.")
    parser.add_argument("--output-root", default="outputs", help="Root output directory. Default: outputs")
    parser.add_argument("--brand-id", default=None, help="Optional explicit brand_id override.")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] input file not found: {input_path}", file=sys.stderr)
        return 2

    data, raw = parse_input(input_path)
    brand_name_raw = data.get("brand_name")
    if is_unknown(brand_name_raw):
        print("[ERROR] 企业名称/brand_name is required. Pause and ask the user before starting S1.", file=sys.stderr)
        return 2

    brand_name = str(brand_name_raw).strip()
    brand_id = args.brand_id.strip() if args.brand_id else safe_brand_id(brand_name)

    normalised: Dict[str, Optional[str]] = {"brand_name": brand_name}
    known_inputs: Dict[str, str] = {"brand_name": brand_name}
    missing_optional: List[str] = []

    for field in OPTIONAL_FIELDS:
        value = data.get(field)
        if field == "report_language" and is_unknown(value):
            value = "中文"
        if is_unknown(value):
            normalised[field] = None
            missing_optional.append(field)
        else:
            value_str = str(value).strip()
            normalised[field] = value_str
            known_inputs[field] = value_str

    supplement_plan: List[Dict[str, str]] = []
    for field in missing_optional:
        meta = RESEARCH_PLAN[field]
        supplement_plan.append({
            "field": field,
            "field_label": FIELD_LABELS[field],
            "stage": meta["stage"],
            "method": meta["method"],
            "pause_if": meta["pause_if"],
        })

    created_at = datetime.now(timezone.utc).isoformat()
    result: Dict[str, Any] = {
        "version": VERSION,
        "created_at": created_at,
        "brand_name": brand_name,
        "brand_id": brand_id,
        "raw_input_file": str(input_path),
        "normalised_inputs": normalised,
        "known_inputs": known_inputs,
        "missing_optional_fields": missing_optional,
        "supplement_plan": supplement_plan,
        "minimum_input_satisfied": True,
        "must_pause_before_s1": False,
        "ambiguity_policy": {
            "same_name_companies": "pause_if_unresolved_after_S1_candidate_scan",
            "official_site_conflict": "pause_if_multiple_high_confidence_candidates",
            "core_product_conflict": "confirm_at_pause_point_1_before_S5_0",
        },
        "notes": [
            "S0.1 does not perform external research; it only creates the missing-information plan.",
            "Optional missing fields must be completed by S1/S3/S4 Wide Research with sources and confidence.",
            "Do not carry 未提供/待调研 placeholders into the final customer PDF.",
        ],
    }

    brand_root = Path(args.output_root) / brand_id
    project_dir = brand_root / "00_project_input"
    execution_dir = brand_root / "_execution"
    ensure_dir(project_dir)
    ensure_dir(execution_dir)

    raw_out = project_dir / "project_input_raw.txt"
    raw_out.write_text(raw, encoding="utf-8")

    json_path = project_dir / f"S0.1_{brand_id}_输入解析与补全计划.json"
    md_path = project_dir / f"S0.1_{brand_id}_输入解析与补全计划.md"
    manifest_path = execution_dir / f"S0.1_{brand_id}_input_resolution_manifest.json"

    result["generated_files"] = [str(json_path), str(md_path), str(manifest_path), str(raw_out)]
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(build_markdown(result), encoding="utf-8")

    manifest = {
        "version": VERSION,
        "stage_id": "S0.1",
        "brand_name": brand_name,
        "brand_id": brand_id,
        "used_wide_research": False,
        "status": "done",
        "created_at": created_at,
        "input_file": str(input_path),
        "generated_files": [str(json_path), str(md_path), str(raw_out)],
        "missing_optional_fields": missing_optional,
        "handoff_to_stages": sorted({item["stage"] for item in supplement_plan}),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "brand_name": brand_name,
        "brand_id": brand_id,
        "missing_optional_fields": missing_optional,
        "json": str(json_path),
        "markdown": str(md_path),
        "manifest": str(manifest_path),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
