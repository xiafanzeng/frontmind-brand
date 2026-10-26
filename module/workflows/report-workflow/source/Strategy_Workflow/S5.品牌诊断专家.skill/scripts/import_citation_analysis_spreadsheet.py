#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import the required user-uploaded citation-analysis workbook.

The workbook is separate from the AI-answer monitoring workbook. It contains
three reconciled layers: media, content and question-level citation records.
This is the required second spreadsheet in S5.0.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from import_monitoring_spreadsheet import load_xlsx_tables


TABLE_SPECS: dict[str, dict[str, set[str]]] = {
    "media": {
        "domain": {"域名", "媒体url", "媒体URL", "mediaurl", "domain"},
        "media_name": {"媒体名称", "媒体", "信源名称", "来源名称"},
        "citation_count": {"引用次数", "引用量", "citationcount", "citations"},
        "citation_share": {"引用占比", "引用比例", "citationshare", "share"},
    },
    "content": {
        "article_title": {"文章标题", "内容标题", "标题"},
        "media_name": {"媒体名称", "媒体", "信源名称", "来源名称"},
        "media_domain": {"媒体url", "媒体URL", "媒体域名", "域名", "mediaurl"},
        "article_url": {"文章url", "文章URL", "文章链接", "内容链接", "url"},
        "citation_count": {"引用次数", "引用量", "citationcount", "citations"},
        "citation_share": {"引用占比", "引用比例", "citationshare", "share"},
    },
    "question": {
        "model": {"模型", "ai模型", "AI模型", "平台", "model"},
        "question": {"监控问题", "问题", "query", "question"},
        "article_title": {"文章标题", "内容标题", "标题"},
        "article_url": {"文章链接", "文章url", "文章URL", "内容链接", "url"},
        "media_name": {"媒体名称", "媒体", "信源名称", "来源名称"},
        "citation_date": {"引用日期", "日期", "citationdate", "date"},
    },
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def norm(value: Any) -> str:
    return re.sub(r"[\s\u3000_:/（）()\-]+", "", str(value or "")).lower()


def plain(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def safe_name(value: str) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", value or "")
    return text.strip("_")[:100] or "brand"


def parse_count(value: Any) -> int:
    text = plain(value).replace(",", "")
    if not text:
        raise ValueError("引用次数为空")
    try:
        number = float(text)
    except ValueError as exc:
        raise ValueError(f"引用次数不是数字：{text}") from exc
    if number < 0 or not number.is_integer():
        raise ValueError(f"引用次数必须是非负整数：{text}")
    return int(number)


def parse_share(value: Any) -> float:
    text = plain(value).replace(",", "")
    if not text:
        raise ValueError("引用占比为空")
    is_percent = text.endswith("%")
    try:
        number = float(text.rstrip("%"))
    except ValueError as exc:
        raise ValueError(f"引用占比不是数字：{text}") from exc
    share = number / 100 if is_percent or number > 1 else number
    if not 0 <= share <= 1:
        raise ValueError(f"引用占比超出 0–100%：{text}")
    return share


def row_values(rows: dict[int, list[Any]], row_index: int) -> list[Any]:
    return rows.get(row_index, [])


def detect_table(table: dict[str, Any]) -> tuple[str, int, dict[str, int]] | None:
    rows = table.get("rows") if isinstance(table.get("rows"), dict) else {}
    for row_index in sorted(rows)[:12]:
        row = row_values(rows, row_index)
        normalized_headers = [norm(cell) for cell in row]
        candidates: list[tuple[str, int, dict[str, int]]] = []
        for table_type, spec in TABLE_SPECS.items():
            mapping: dict[str, int] = {}
            for field, aliases in spec.items():
                alias_norms = {norm(alias) for alias in aliases}
                hit = next((idx for idx, header in enumerate(normalized_headers) if header in alias_norms), None)
                if hit is not None:
                    mapping[field] = hit
            if len(mapping) == len(spec):
                candidates.append((table_type, row_index, mapping))
        if candidates:
            return max(candidates, key=lambda item: len(TABLE_SPECS[item[0]]))
    return None


def cell(row: list[Any], index: int) -> str:
    return plain(row[index]) if index < len(row) else ""


def parse_workbook(path: Path) -> dict[str, Any]:
    detected: dict[str, tuple[dict[str, Any], int, dict[str, int]]] = {}
    for table in load_xlsx_tables(path):
        match = detect_table(table)
        if match is None:
            continue
        table_type, header_row, mapping = match
        if table_type in detected:
            raise RuntimeError(f"引用分析表重复识别到 {table_type} 类型 Sheet。")
        detected[table_type] = (table, header_row, mapping)

    missing = [name for name in TABLE_SPECS if name not in detected]
    if missing:
        raise RuntimeError("引用分析表缺少必需 Sheet/表头类型：" + "、".join(missing))

    media_rows: list[dict[str, Any]] = []
    content_rows: list[dict[str, Any]] = []
    question_rows: list[dict[str, Any]] = []
    validation_errors: list[str] = []
    missing_labels: Counter[str] = Counter()

    for table_type, (table, header_row, mapping) in detected.items():
        rows = table.get("rows") if isinstance(table.get("rows"), dict) else {}
        for row_index in sorted(rows):
            if row_index <= header_row:
                continue
            row = row_values(rows, row_index)
            if not any(plain(value) for value in row):
                continue
            sheet_name = plain(table.get("sheet_name"))
            try:
                if table_type == "media":
                    item = {
                        "domain": cell(row, mapping["domain"]).lower(),
                        "media_name": cell(row, mapping["media_name"]),
                        "citation_count": parse_count(cell(row, mapping["citation_count"])),
                        "citation_share": parse_share(cell(row, mapping["citation_share"])),
                    }
                    if not item["domain"]:
                        raise ValueError("域名为空")
                    if not item["media_name"]:
                        item["media_name"] = item["domain"]
                        missing_labels["媒体引用分析.媒体名称"] += 1
                    media_rows.append(item)
                elif table_type == "content":
                    item = {
                        "article_title": cell(row, mapping["article_title"]),
                        "media_name": cell(row, mapping["media_name"]),
                        "media_domain": cell(row, mapping["media_domain"]).lower(),
                        "article_url": cell(row, mapping["article_url"]),
                        "citation_count": parse_count(cell(row, mapping["citation_count"])),
                        "citation_share": parse_share(cell(row, mapping["citation_share"])),
                    }
                    if not item["article_url"] or not item["media_domain"]:
                        raise ValueError("文章 URL 或媒体域名为空")
                    if not item["article_title"]:
                        item["article_title"] = item["article_url"]
                        missing_labels["内容引用分析.文章标题"] += 1
                    if not item["media_name"]:
                        item["media_name"] = item["media_domain"]
                        missing_labels["内容引用分析.媒体名称"] += 1
                    content_rows.append(item)
                else:
                    item = {
                        "model": cell(row, mapping["model"]),
                        "question": cell(row, mapping["question"]),
                        "article_title": cell(row, mapping["article_title"]),
                        "article_url": cell(row, mapping["article_url"]),
                        "media_name": cell(row, mapping["media_name"]),
                        "citation_date": cell(row, mapping["citation_date"]),
                    }
                    if not item["model"] or not item["question"] or not item["article_url"] or not item["citation_date"]:
                        raise ValueError("模型、监控问题、文章链接或引用日期为空")
                    if not item["article_title"]:
                        item["article_title"] = item["article_url"]
                        missing_labels["问题引用分析.文章标题"] += 1
                    if not item["media_name"]:
                        item["media_name"] = domain_from_url(item["article_url"]) or "未标注信源"
                        missing_labels["问题引用分析.媒体名称"] += 1
                    question_rows.append(item)
            except ValueError as exc:
                validation_errors.append(f"{sheet_name} 第 {row_index + 1} 行：{exc}")

    if validation_errors:
        preview = "；".join(validation_errors[:12])
        suffix = f"；另有 {len(validation_errors) - 12} 条" if len(validation_errors) > 12 else ""
        raise RuntimeError("引用分析表字段校验失败：" + preview + suffix)
    if not media_rows or not content_rows or not question_rows:
        raise RuntimeError("引用分析表三层数据均必须包含至少 1 条有效记录。")

    return {
        "media_rows": media_rows,
        "content_rows": content_rows,
        "question_rows": question_rows,
        "normalization_warnings": [
            f"{field} 有 {count} 行为空，标准化数据已使用域名或文章链接作为展示标签。"
            for field, count in sorted(missing_labels.items())
        ],
        "sheet_mapping": {
            key: {
                "sheet_name": plain(value[0].get("sheet_name")),
                "header_row": value[1] + 1,
                "columns": value[2],
            }
            for key, value in detected.items()
        },
    }


def share_label(value: float) -> str:
    return f"{value * 100:.2f}%"


def domain_from_url(value: str) -> str:
    try:
        return (urlparse(value).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def top_counter(rows: list[dict[str, Any]], key: str, limit: int) -> list[dict[str, Any]]:
    counter = Counter(plain(row.get(key)) or "（空）" for row in rows)
    return [{"name": name, "citation_count": count} for name, count in counter.most_common(limit)]


def build_analysis(parsed: dict[str, Any], *, brand: str, brand_name: str, source_path: Path, source_copy: Path, raw_path: Path, top_limit: int) -> dict[str, Any]:
    media_rows = parsed["media_rows"]
    content_rows = parsed["content_rows"]
    question_rows = parsed["question_rows"]
    media_total = sum(item["citation_count"] for item in media_rows)
    content_total = sum(item["citation_count"] for item in content_rows)
    question_total = len(question_rows)
    media_share_sum = sum(item["citation_share"] for item in media_rows)
    content_share_sum = sum(item["citation_share"] for item in content_rows)
    content_urls = {item["article_url"] for item in content_rows if item["article_url"]}
    question_urls = {item["article_url"] for item in question_rows if item["article_url"]}
    dates = sorted(item["citation_date"] for item in question_rows if item["citation_date"])
    sorted_media = sorted(media_rows, key=lambda item: item["citation_count"], reverse=True)
    sorted_content = sorted(content_rows, key=lambda item: item["citation_count"], reverse=True)

    reconciliation_errors: list[str] = []
    if media_total != content_total or media_total != question_total:
        reconciliation_errors.append(
            f"三层引用总量不一致：媒体={media_total}，内容={content_total}，问题明细={question_total}"
        )
    if reconciliation_errors:
        raise RuntimeError("引用分析表对账失败：" + "；".join(reconciliation_errors))

    top5_count = sum(item["citation_count"] for item in sorted_media[:5])
    top10_count = sum(item["citation_count"] for item in sorted_media[:10])
    top_content_10_count = sum(item["citation_count"] for item in sorted_content[:10])
    sha256 = hashlib.sha256(source_path.read_bytes()).hexdigest()
    warnings: list[str] = list(parsed.get("normalization_warnings") or [])
    if not 0.98 <= media_share_sum <= 1.02:
        warnings.append(
            f"媒体引用占比列合计为 {share_label(media_share_sum)}；报告将以引用次数重新计算占比。"
        )
    if not 0.98 <= content_share_sum <= 1.02:
        warnings.append(
            f"内容引用占比列合计为 {share_label(content_share_sum)}；大量低频内容可能因百分比显示精度被四舍五入，报告将以引用次数重新计算占比。"
        )
    if content_urls != question_urls:
        warnings.append(
            f"内容层与问题层唯一文章 URL 集合不完全一致：内容层={len(content_urls)}，问题层={len(question_urls)}"
        )

    def media_item(item: dict[str, Any]) -> dict[str, Any]:
        computed_share = item["citation_count"] / question_total
        return {
            **item,
            "reported_citation_share": item["citation_share"],
            "citation_share": round(computed_share, 8),
            "citation_share_label": share_label(computed_share),
        }

    def content_item(item: dict[str, Any]) -> dict[str, Any]:
        computed_share = item["citation_count"] / question_total
        return {
            **item,
            "reported_citation_share": item["citation_share"],
            "citation_share": round(computed_share, 8),
            "citation_share_label": share_label(computed_share),
        }

    return {
        "meta": {
            "brand": brand,
            "brand_name": brand_name,
            "data_source": "uploaded_citation_analysis_spreadsheet",
            "analysis_enabled_for_report": True,
            "report_section_target": "AI语义资产审计下半部分",
            "data_confirmation_status": "confirmed",
            "requires_user_confirmation_before_s5": False,
            "data_confirmed_at": now_iso(),
            "data_confirmed_by": "auto_import_gate",
            "data_confirmation_gate": {
                "gate_id": "S5_0_UPLOAD_DATA_IMPORTED",
                "status": "confirmed",
                "rule": "本工作流不设数据确认暂停点：引用分析表导入并通过三层对账即自动确认，与监控表导入共同放行 S5 及后续流程。",
            },
            "imported_at": now_iso(),
            "source_file": str(source_copy),
            "source_file_name": source_path.name,
            "source_sha256": sha256,
            "raw_extracted_file": str(raw_path),
            "simulated": False,
        },
        "validation": {
            "passed": True,
            "sheet_mapping": parsed["sheet_mapping"],
            "warnings": warnings,
            "reconciliation": {
                "passed": True,
                "media_citation_total": media_total,
                "content_citation_total": content_total,
                "question_record_count": question_total,
                "media_share_sum": round(media_share_sum, 6),
                "content_share_sum": round(content_share_sum, 6),
                "content_unique_url_count": len(content_urls),
                "question_unique_url_count": len(question_urls),
                "unique_url_sets_match": content_urls == question_urls,
            },
        },
        "summary": {
            "total_citations": question_total,
            "media_count": len(media_rows),
            "content_row_count": len(content_rows),
            "unique_article_url_count": len(content_urls),
            "model_count": len({item["model"] for item in question_rows}),
            "question_count": len({item["question"] for item in question_rows}),
            "citation_date_start": dates[0] if dates else "",
            "citation_date_end": dates[-1] if dates else "",
            "top5_source_concentration": round(top5_count / question_total, 6),
            "top10_source_concentration": round(top10_count / question_total, 6),
            "top10_content_concentration": round(top_content_10_count / question_total, 6),
        },
        "media_analysis": {
            "top_sources": [media_item(item) for item in sorted_media[:top_limit]],
        },
        "content_analysis": {
            "top_content": [content_item(item) for item in sorted_content[:top_limit]],
        },
        "model_analysis": {
            "citation_volume_by_model": top_counter(question_rows, "model", top_limit),
        },
        "question_analysis": {
            "top_questions": top_counter(question_rows, "question", top_limit),
            "top_media_names": top_counter(question_rows, "media_name", top_limit),
        },
        "interpretation_guardrails": [
            "引用次数代表被使用频率，不自动等于权威性、正面评价或事实正确。",
            "模型引用量受问题量、监测周期和平台采样范围影响，跨模型比较必须披露样本口径。",
            "仅凭域名或媒体名称不得擅自判定官方、权威、正面或负面。",
        ],
    }


def markdown_table(items: list[dict[str, Any]], columns: list[tuple[str, str]], limit: int = 10) -> str:
    headers = [label for _, label in columns]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for item in items[:limit]:
        values = [plain(item.get(key)).replace("|", "｜") for key, _ in columns]
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def render_markdown(data: dict[str, Any]) -> str:
    summary = data["summary"]
    media = data["media_analysis"]["top_sources"]
    content = data["content_analysis"]["top_content"]
    models = data["model_analysis"]["citation_volume_by_model"]
    questions = data["question_analysis"]["top_questions"]
    warnings = data["validation"].get("warnings") or []
    concentration = float(summary["top10_source_concentration"])
    if concentration >= 0.7:
        concentration_note = "Top 10 信源承载了较高比例的引用，应优先降低对少数信源的结构性依赖。"
    elif concentration >= 0.45:
        concentration_note = "引用集中度处于中间水平，应在保留强信源的同时扩充可验证的第三方来源。"
    else:
        concentration_note = "信源分布相对分散，下一步重点应从数量扩张转向可信度与内容质量治理。"
    lines = [
        f"# {data['meta']['brand_name']} 引用分析导入摘要",
        "",
        "> 本文件是上传表格的导入与对账摘要，供 S5.5 语义资产审计消费；不替代最终客户报告。",
        "",
        "## 一、数据范围与对账",
        "",
        f"- 总引用记录：{summary['total_citations']:,}",
        f"- 信源域名/媒体汇总行：{summary['media_count']:,}",
        f"- 内容汇总行：{summary['content_row_count']:,}",
        f"- 唯一文章 URL：{summary['unique_article_url_count']:,}",
        f"- 模型数 / 监控问题数：{summary['model_count']} / {summary['question_count']}",
        f"- 引用日期范围：{summary['citation_date_start']} 至 {summary['citation_date_end']}",
        "- 三层对账：媒体引用次数合计 = 内容引用次数合计 = 问题引用明细行数",
        "",
        "## 二、品牌信源覆盖与引用结构",
        "",
        f"- Top 5 信源集中度：{summary['top5_source_concentration']:.1%}",
        f"- Top 10 信源集中度：{summary['top10_source_concentration']:.1%}",
        f"- Top 10 内容集中度：{summary['top10_content_concentration']:.1%}",
        f"- 结构判断：{concentration_note}",
        "",
        "### 高频引用信源",
        "",
        markdown_table(media, [("domain", "域名"), ("media_name", "媒体名称"), ("citation_count", "引用次数"), ("citation_share_label", "引用占比")]),
        "",
        "### 高频引用内容",
        "",
        markdown_table(content, [("article_title", "文章标题"), ("media_name", "媒体名称"), ("citation_count", "引用次数"), ("citation_share_label", "引用占比")]),
        "",
        "### 模型引用量",
        "",
        markdown_table(models, [("name", "模型"), ("citation_count", "引用记录数")]),
        "",
        "### 高频监控问题",
        "",
        markdown_table(questions, [("name", "监控问题"), ("citation_count", "引用记录数")]),
        "",
        "## 三、信源覆盖补齐优先级",
        "",
        "1. 先核验 Top 信源是否准确承载品牌事实、关键属性、案例与资质，不把高频误当作高质量。",
        "2. 对高频问题建设稳定的官网事实页、FAQ、比较页与场景页，并补齐可复核的第三方证明材料。",
        "3. 针对引用量低或缺失的模型复核问题覆盖和内容可抓取性，避免把样本差异误判为模型偏好。",
        "4. 复测时保持问题集、模型集和时间窗口一致，用集中度、唯一内容覆盖与跨模型引用稳定性观察变化。",
        "",
        "## 四、解释边界",
        "",
    ]
    lines.extend(f"- {item}" for item in data["interpretation_guardrails"])
    if warnings:
        lines.extend(["", "## 五、导入警告", ""])
        lines.extend(f"- {item}" for item in warnings)
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Import the required citation-analysis workbook for S5.0.")
    parser.add_argument("--brand", required=True, help="Safe brand_id used in file names.")
    parser.add_argument("--brand-name", default="", help="Customer-facing brand name.")
    parser.add_argument("--spreadsheet", required=True)
    parser.add_argument("--data-source", default="uploaded_spreadsheet", choices=["uploaded_spreadsheet", "molizhishu_api"], help="数据来源标签（API自动取数用 molizhishu_api）")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--top-limit", type=int, default=20)
    args = parser.parse_args()

    brand = safe_name(args.brand)
    brand_name = args.brand_name.strip() or args.brand
    source_path = Path(args.spreadsheet).resolve()
    output_dir = Path(args.output_dir).resolve()
    execution_dir = output_dir.parent / "_execution"
    uploaded_dir = output_dir / "uploaded_sources"
    output_dir.mkdir(parents=True, exist_ok=True)
    execution_dir.mkdir(parents=True, exist_ok=True)
    uploaded_dir.mkdir(parents=True, exist_ok=True)

    parsed = parse_workbook(source_path)
    source_copy = uploaded_dir / f"S5_{brand}_citation_analysis_source.xlsx"
    if source_path != source_copy:
        shutil.copy2(source_path, source_copy)
    raw_path = output_dir / f"S5_{brand}_引用分析原始提取.json"
    raw_payload = {
        "meta": {
            "brand": brand,
            "brand_name": brand_name,
            "source_file": str(source_copy),
            "source_file_name": source_path.name,
            "imported_at": now_iso(),
            "simulated": False,
        },
        **parsed,
    }
    raw_path.write_text(json.dumps(raw_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    analysis = build_analysis(
        parsed,
        brand=brand,
        brand_name=brand_name,
        source_path=source_path,
        source_copy=source_copy,
        raw_path=raw_path,
        top_limit=max(10, min(args.top_limit, 100)),
    )
    data_path = output_dir / f"S5_{brand}_引用分析数据.json"
    md_path = output_dir / f"S5_{brand}_引用分析导入摘要.md"
    confirmation_path = output_dir / f"S5_{brand}_citation_analysis_confirmation.json"
    data_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(analysis), encoding="utf-8")
    confirmation_path.write_text(json.dumps({
        "gate_id": "S5_0_UPLOAD_DATA_IMPORTED",
        "status": "confirmed",
        "data_confirmation_status": "confirmed",
        "data_confirmed_by": "auto_import_gate",
        "citation_analysis_data": str(data_path),
        "summary": analysis["summary"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    generated_files = [str(path) for path in (data_path, raw_path, md_path, confirmation_path, source_copy)]
    manifest_path = execution_dir / f"S5.0_{brand}_citation_analysis_import_manifest.json"
    manifest_path.write_text(json.dumps({
        "stage_id": "S5.0",
        "role": "citation_analysis_import",
        "status": "done",
        "monitoring_data_source": args.data_source,
        "used_uploaded_spreadsheet": args.data_source == "uploaded_spreadsheet",
        "used_molizhishu_api": args.data_source == "molizhishu_api",
        "used_uploaded_citation_spreadsheet": True,
        "simulated": False,
        "script": str(Path(__file__).resolve()),
        "source_file": str(source_copy),
        "source_sha256": analysis["meta"]["source_sha256"],
        "reconciliation": analysis["validation"]["reconciliation"],
        "generated_files": generated_files,
        "completed_at": now_iso(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "status": "done",
        "data": str(data_path),
        "raw": str(raw_path),
        "summary": str(md_path),
        "manifest": str(manifest_path),
        "auto_confirmed": True,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
