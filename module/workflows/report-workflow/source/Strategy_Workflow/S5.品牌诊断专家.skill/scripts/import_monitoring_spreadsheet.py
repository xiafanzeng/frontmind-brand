#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import user-uploaded monitoring spreadsheet into the canonical S5.0 data shape.

This is the only S5.0 monitoring-data path. It converts a user-uploaded XLSX
shaped like the reference table into the canonical downstream files:

  S5_{brand}_frontmind_monitoring_data.json
  S5_{brand}_frontmind_monitoring_raw.json

本工作流不再生成《问题监控数据文件》客户版产物（HTML/PDF/MD/TXT），也不再设置
数据确认暂停点：两份上传表格导入并通过固定范围/一致性校验后，本脚本自动写入
data_confirmation_status=confirmed，随后直接进入 S5 品牌诊断与后续流程，直至
最终全景报告，无需用户再次确认。

Expected spreadsheet layout:
- one sheet per monitored AI platform, e.g. DeepSeek / 百度文心 / 腾讯元宝 / 豆包;
- row 1 + row 2 are headers;
- columns A:D = 品牌名称 / 问题核心词 / 问题 / 日期;
- each answer block has 4 columns: 内容 / 截图链接 / 排名 / 监控词排名;
- default repeat is inferred from answer blocks, normally 5.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from monitoring_evidence_helpers import (
    get_selected_monitoring_data_source,
    is_question_set_confirmed,
    load_json,
    now_iso,
    question_confirmation_error,
    save_json,
)

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

PLATFORM_ALIASES = {
    "deepseek": "deepseek",
    "deep seek": "deepseek",
    "深度求索": "deepseek",
    "豆包": "doubao",
    "doubao": "doubao",
    "字节豆包": "doubao",
    "通义千问": "qianwen",
    "通义": "qianwen",
    "千问": "qianwen",
    "qianwen": "qianwen",
    "tongyi": "qianwen",
    "通义qianwen": "qianwen",
    "百度文心": "wenxin",
    "文心一言": "wenxin",
    "文心": "wenxin",
    "ernie": "wenxin",
    "腾讯元宝": "yuanbao",
    "元宝": "yuanbao",
    "yuanbao": "yuanbao",
    "kimi": "kimi",
    "月之暗面": "kimi",
}

PLATFORM_DISPLAY = {
    "deepseek": "DeepSeek",
    "doubao": "豆包",
    "qianwen": "通义千问",
    "wenxin": "百度文心",
    "yuanbao": "腾讯元宝",
    "kimi": "Kimi",
}

# Platforms are discovered from the uploaded workbook. Known aliases are
# normalized above; any other non-empty sheet name is preserved as a platform.
DEFAULT_REPEAT_PER_QUESTION_PLATFORM = 5
REQUIRED_QUESTION_IDS = {"Q1_PRODUCT_RECOMMENDATION", "Q2_REPUTATION_ISSUE"}

RANKING_HINTS = ("推荐", "哪家", "有哪些", "排名", "榜单", "供应商", "品牌", "brand", "top", "best")
REPUTATION_HINTS = ("缺点", "问题", "不足", "弊端", "负面", "投诉", "风险", "口碑", "舆情", "靠谱吗", "评价")


def _norm_text(value: Any) -> str:
    return re.sub(r"[\s\u3000\W_]+", "", str(value or "").lower())


def _question_norm_variants(value: Any) -> set[str]:
    """Return tolerant, still-safe variants for comparing confirmed questions.

    Uploaded spreadsheets may use a small wording variant such as
    "汽车总装助力机械手品牌推荐" while S4.8 generated
    "汽车总装助力机械手推荐". That should pass. A different product/category
    (for example "数据安全软件推荐" vs "汽车总装助力机械手品牌推荐") must fail
    because it would corrupt the downstream report.
    """
    base = _norm_text(value)
    variants = {base} if base else set()
    if base:
        variants.add(base.replace("品牌", ""))
        variants.add(base.replace("品类", ""))
        variants.add(base.replace("品牌推荐", "推荐"))
        variants.add(base.replace("品类推荐", "推荐"))
    return {v for v in variants if v}


def _questions_compatible(sheet_question: Any, confirmed_question: Any) -> bool:
    a = _question_norm_variants(sheet_question)
    b = _question_norm_variants(confirmed_question)
    if not a or not b:
        return False
    for x in a:
        for y in b:
            if x == y or x in y or y in x:
                return True
    return False


def _plain_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _safe_name(text: Any) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", str(text or ""))
    return text[:120].strip("_") or "item"


def _col_to_index(col: str) -> int:
    value = 0
    for ch in col.upper():
        if not ("A" <= ch <= "Z"):
            continue
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return value - 1


def _cell_ref_to_pos(ref: str) -> tuple[int, int]:
    match = re.match(r"([A-Za-z]+)(\d+)", ref or "")
    if not match:
        return 0, 0
    return int(match.group(2)) - 1, _col_to_index(match.group(1))


def _xml_text(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(node.itertext())


def _load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        raw = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    values: list[str] = []
    for si in root.findall(f"{{{NS_MAIN}}}si"):
        values.append(_xml_text(si))
    return values


def _load_sheet_targets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map: dict[str, str] = {}
    for rel in rels.findall(f"{{{NS_PACKAGE_REL}}}Relationship"):
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target") or ""
        if not rid:
            continue
        if target.startswith("/"):
            path = target.lstrip("/")
        elif target.startswith("xl/"):
            path = target
        else:
            path = "xl/" + target.lstrip("/")
        rel_map[rid] = path
    result: list[tuple[str, str]] = []
    for sheet in workbook.findall(f".//{{{NS_MAIN}}}sheet"):
        name = sheet.attrib.get("name") or "Sheet"
        rid = sheet.attrib.get(f"{{{NS_REL}}}id")
        target = rel_map.get(rid or "")
        if target:
            result.append((name, target))
    return result


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return _xml_text(cell.find(f"{{{NS_MAIN}}}is"))
    value_node = cell.find(f"{{{NS_MAIN}}}v")
    raw = value_node.text if value_node is not None else ""
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except Exception:
            return raw
    if cell_type == "b":
        return raw == "1"
    if cell_type in {"str", "e"}:
        return raw
    # Keep numeric/date-looking values as text to avoid changing evidence values.
    return raw


def _read_sheet_rows(zf: zipfile.ZipFile, target: str, shared_strings: list[str]) -> dict[int, list[Any]]:
    root = ET.fromstring(zf.read(target))
    rows: dict[int, list[Any]] = {}
    for row in root.findall(f".//{{{NS_MAIN}}}row"):
        r_attr = row.attrib.get("r")
        row_index = int(r_attr) - 1 if r_attr and r_attr.isdigit() else len(rows)
        values: list[Any] = []
        for cell in row.findall(f"{{{NS_MAIN}}}c"):
            ref = cell.attrib.get("r") or ""
            _, col_index = _cell_ref_to_pos(ref)
            while len(values) <= col_index:
                values.append(None)
            values[col_index] = _cell_value(cell, shared_strings)
        while values and values[-1] in (None, ""):
            values.pop()
        rows[row_index] = values
    return rows


def load_xlsx_tables(path: Path) -> list[dict[str, Any]]:
    if not path.exists() or path.suffix.lower() != ".xlsx":
        raise RuntimeError(f"上传数据表格必须是有效 .xlsx 文件: {path}")
    tables: list[dict[str, Any]] = []
    with zipfile.ZipFile(path) as zf:
        shared = _load_shared_strings(zf)
        for sheet_name, target in _load_sheet_targets(zf):
            rows = _read_sheet_rows(zf, target, shared)
            tables.append({"sheet_name": sheet_name, "target": target, "rows": rows})
    if not tables:
        raise RuntimeError("上传数据表格未读取到任何 sheet。")
    return tables


def infer_platform(sheet_name: str) -> tuple[str, str]:
    raw = str(sheet_name or "").strip()
    low = raw.lower()
    for key, canonical in PLATFORM_ALIASES.items():
        if key.lower() in low:
            return canonical, PLATFORM_DISPLAY.get(canonical, raw)
    canonical = _safe_name(raw).lower() or "unknown"
    return canonical, raw or canonical


def _cell(row: list[Any], idx: int) -> str:
    return _plain_text(row[idx]) if idx < len(row) else ""


def detect_answer_blocks(row1: list[Any], row2: list[Any]) -> list[dict[str, int]]:
    blocks: list[dict[str, int]] = []
    max_cols = max(len(row1), len(row2))
    for col in range(4, max_cols):
        sub = _cell(row2, col)
        head = _cell(row1, col)
        if sub in {"内容", "答案内容", "回答内容", "answerContent"} or ("答案" in head and not sub):
            blocks.append({"content": col, "screenshot": col + 1, "ranking": col + 2, "monitor_rank": col + 3})
    if not blocks and max_cols > 4:
        for col in range(4, max_cols, 4):
            blocks.append({"content": col, "screenshot": col + 1, "ranking": col + 2, "monitor_rank": col + 3})
    # Deduplicate accidental hits inside the same answer block.
    deduped: list[dict[str, int]] = []
    seen: set[int] = set()
    for block in blocks:
        start = block["content"]
        if start in seen:
            continue
        seen.add(start)
        deduped.append(block)
    return deduped


def parse_rank(value: Any) -> int | None:
    text = _plain_text(value)
    if not text or text in {"-", "—", "–", "无", "未提及", "null", "None"}:
        return None
    if re.fullmatch(r"\d+(?:\.0+)?", text):
        rank = int(float(text))
        return rank if rank > 0 else None
    match = re.search(r"第\s*(\d+)\s*名", text)
    if not match:
        match = re.search(r"(?:rank|排名|位次|位置)\D{0,8}(\d+)", text, flags=re.I)
    if not match:
        match = re.search(r"(\d+)\s*名", text)
    if match:
        rank = int(match.group(1))
        return rank if rank > 0 else None
    return None


def _question_type_from_text(question_text: str) -> tuple[str, bool]:
    q = str(question_text or "")
    has_reputation = any(k.lower() in q.lower() for k in REPUTATION_HINTS)
    has_ranking = any(k.lower() in q.lower() for k in RANKING_HINTS)
    if has_reputation and not has_ranking:
        return "reputation_issue", False
    if has_ranking:
        return "product_recommendation", True
    return "general_visibility", True


def normalize_questions(questions: list[dict[str, Any]], fallback_rows: list[str]) -> list[dict[str, Any]]:
    if questions:
        normalized = []
        for idx, q in enumerate(questions, 1):
            q = dict(q)
            qtext = _plain_text(q.get("question_text") or q.get("question") or q.get("query"))
            qid = _plain_text(q.get("question_id") or q.get("id")) or ("Q1_PRODUCT_RECOMMENDATION" if idx == 1 else "Q2_REPUTATION_ISSUE" if idx == 2 else f"Q{idx:02d}")
            qtype, eligible = _question_type_from_text(qtext)
            q.setdefault("question_id", qid)
            q.setdefault("question_text", qtext)
            q.setdefault("question_type", q.get("intent_type") or qtype)
            q.setdefault("ranking_metric_eligible", bool(eligible))
            normalized.append(q)
        return normalized
    # Fallback exists only for emergency import, but normal S5.0 should use S4.8 questions.
    generated: list[dict[str, Any]] = []
    for idx, text in enumerate(fallback_rows, 1):
        qtype, eligible = _question_type_from_text(text)
        qid = "Q1_PRODUCT_RECOMMENDATION" if idx == 1 and eligible else "Q2_REPUTATION_ISSUE" if not eligible else f"Q{idx:02d}"
        generated.append({"question_id": qid, "question_text": text, "question_type": qtype, "ranking_metric_eligible": eligible})
    return generated


def match_question(row_question: str, questions: list[dict[str, Any]], row_order: int) -> dict[str, Any] | None:
    norm_row = _norm_text(row_question)
    if not norm_row:
        return None
    # Primary path: exact / near-exact question text match. This preserves the
    # Pause 1 contract and prevents importing answers for a different product.
    for q in questions:
        if _questions_compatible(row_question, q.get("question_text")):
            return q

    # If no confirmed questions exist (emergency fallback only), infer by intent.
    if not questions:
        return None

    # Keep a tiny tolerance for row order only when the text is still compatible
    # with the corresponding confirmed fixed question. Do NOT fall back merely by
    # type/eligibility; that would allow a recommendation answer for another
    # product to be mislabeled as the confirmed S4.8 question.
    if 0 <= row_order < len(questions) and _questions_compatible(row_question, questions[row_order].get("question_text")):
        return questions[row_order]
    return None


def parse_spreadsheet_records(
    *,
    data_source: str = "uploaded_spreadsheet",
    spreadsheet_path: Path,
    questions: list[dict[str, Any]],
    company_name: str,
    brand_name: str,
    main_product: str,
) -> tuple[list[dict[str, Any]], list[str], int, dict[str, Any]]:
    tables = load_xlsx_tables(spreadsheet_path)
    fallback_questions: list[str] = []
    # First pass: collect row question texts for fallback and determine answer block count.
    max_repeat = 0
    for table in tables:
        rows = table["rows"]
        row1 = rows.get(0, [])
        row2 = rows.get(1, [])
        blocks = detect_answer_blocks(row1, row2)
        max_repeat = max(max_repeat, len(blocks))
        for row_num in sorted(k for k in rows if k >= 2):
            question_text = _cell(rows[row_num], 2)
            if question_text and _norm_text(question_text) not in {_norm_text(x) for x in fallback_questions}:
                fallback_questions.append(question_text)
    questions = normalize_questions(questions, fallback_questions)
    repeat = max_repeat or 5

    parsed_by_platform: dict[str, dict[str, Any]] = {}
    raw_sheets: list[dict[str, Any]] = []
    platform_order: list[str] = []
    for table in tables:
        sheet_name = table["sheet_name"]
        platform, platform_display = infer_platform(sheet_name)
        if platform not in platform_order:
            platform_order.append(platform)
        rows = table["rows"]
        row1 = rows.get(0, [])
        row2 = rows.get(1, [])
        blocks = detect_answer_blocks(row1, row2)
        if not blocks:
            raw_sheets.append({"sheet_name": sheet_name, "platform": platform, "error": "未识别到答案块"})
            continue
        q_rows: dict[str, dict[str, Any]] = {}
        raw_rows: list[dict[str, Any]] = []
        data_row_order = 0
        for row_num in sorted(k for k in rows if k >= 2):
            row = rows[row_num]
            if not any(_cell(row, idx) for idx in range(min(len(row), 8))):
                continue
            row_brand = _cell(row, 0)
            keyword = _cell(row, 1)
            question_text = _cell(row, 2)
            date_text = _cell(row, 3)
            if not question_text:
                continue
            q = match_question(question_text, questions, data_row_order)
            data_row_order += 1
            if not q:
                raw_rows.append({"excel_row": row_num + 1, "question_text": question_text, "status": "unmatched_question"})
                continue
            answers: list[dict[str, Any]] = []
            for answer_index, block in enumerate(blocks, 1):
                content = _cell(row, block["content"])
                screenshot_link = _cell(row, block["screenshot"])
                ranking_text = _cell(row, block["ranking"])
                monitor_rank_text = _cell(row, block["monitor_rank"])
                rank = parse_rank(monitor_rank_text) or parse_rank(ranking_text)
                answers.append({
                    "answer_index": answer_index,
                    "content": content,
                    "screenshot_link_present": bool(screenshot_link),
                    "screenshot_link_internal": screenshot_link,
                    "ranking_text": ranking_text,
                    "monitor_word_rank": monitor_rank_text,
                    "parsed_rank": rank,
                })
            qid = str(q.get("question_id") or "")
            q_rows[qid] = {
                "excel_row": row_num + 1,
                "row_brand_name": row_brand,
                "question_core_keyword": keyword,
                "question_text_in_sheet": question_text,
                "date": date_text,
                "answers": answers,
            }
            raw_rows.append({
                "excel_row": row_num + 1,
                "row_brand_name": row_brand,
                "question_core_keyword": keyword,
                "question_text": question_text,
                "date": date_text,
                "matched_question_id": qid,
                "answers": answers,
            })
        parsed_by_platform[platform] = {"sheet_name": sheet_name, "platform_display": platform_display, "q_rows": q_rows}
        raw_sheets.append({"sheet_name": sheet_name, "platform": platform, "platform_display": platform_display, "answer_blocks": len(blocks), "rows": raw_rows})

    records: list[dict[str, Any]] = []
    for platform in platform_order:
        pdata = parsed_by_platform.get(platform) or {}
        q_rows = pdata.get("q_rows") or {}
        sheet_name = pdata.get("sheet_name") or platform
        platform_display = pdata.get("platform_display") or PLATFORM_DISPLAY.get(platform, platform)
        for q in questions:
            qid = str(q.get("question_id") or "")
            qtext = _plain_text(q.get("question_text"))
            qtype, inferred_eligible = _question_type_from_text(qtext)
            eligible = bool(q.get("ranking_metric_eligible", inferred_eligible))
            row_info = q_rows.get(qid)
            answers = (row_info or {}).get("answers") or []
            for run_index in range(1, repeat + 1):
                ans = answers[run_index - 1] if run_index - 1 < len(answers) else {}
                content = _plain_text(ans.get("content"))
                rank = ans.get("parsed_rank")
                status = "completed" if content else "missing"
                error = "" if content else "Uploaded spreadsheet did not provide answer content for this expected slot."
                record: dict[str, Any] = {
                    "company_name": company_name,
                    "brand_name": brand_name,
                    "main_product": main_product,
                    "question_id": qid,
                    "question_text": qtext,
                    "question_type": q.get("question_type") or qtype,
                    "ranking_metric_eligible": eligible,
                    "platform": platform,
                    "platform_display_name": platform_display,
                    "run_index": run_index,
                    "mode": data_source,
                    "screenshot": 0,
                    "status": status,
                    "answerContent": content,
                    "referenceList": [],
                    "citationList": [],
                    "errorMessage": error,
                    "time": _plain_text((row_info or {}).get("date")) or now_iso(),
                    "source_format": data_source,
                    "source_sheet": sheet_name,
                    "source_row_number": (row_info or {}).get("excel_row"),
                    "source_answer_block": run_index,
                    "spreadsheet_ranking_text": _plain_text(ans.get("ranking_text")),
                    "spreadsheet_monitor_word_rank": _plain_text(ans.get("monitor_word_rank")),
                    "brand_mentioned": bool(rank or (brand_name and brand_name in content) or (brand_name and brand_name in _plain_text(ans.get("ranking_text"))))
                }
                if rank is not None:
                    # Keep several historical field names so downstream ranking helpers can read the uploaded data without a separate adapter.
                    record.update({"rank": rank, "position": rank, "brand_rank": rank, "mention_rank": rank})
                records.append(record)
    raw = {
        "source_file": str(spreadsheet_path),
        "parsed_at": now_iso(),
        "layout_contract": {
            "sheet_role": "one_sheet_per_ai_platform",
            "row_role": "one_row_per_monitoring_question",
            "answer_block_columns": ["内容", "截图链接", "排名", "监控词排名"],
            "customer_pdf_screenshot_policy": "screenshot_links_are_kept_only_in_raw_internal_json_and_not_rendered",
        },
        "questions": questions,
        "sheets": raw_sheets,
    }
    return records, platform_order, repeat, raw


def validate_uploaded_monitoring_scope(
    *,
    records: list[dict[str, Any]],
    platforms: list[str],
    repeat: int,
    questions: list[dict[str, Any]],
    raw_import: dict[str, Any],
    allow_partial_records: bool = False,
) -> list[str]:
    """Strict scope/content gate for the upload-table branch.

    The platform set is intentionally open and is derived from the workbook.
    Question identity and five-answer-block completeness remain strict.
    """
    errors: list[str] = []
    qids = {str(q.get("question_id") or "") for q in questions}
    if len(questions) != 2 or qids != REQUIRED_QUESTION_IDS:
        errors.append(f"上传表格必须对应 S4.8 固定双问题，当前 question_ids={sorted(qids)}")

    if not platforms:
        errors.append("上传表格至少需要一个有效的 AI 平台 sheet")
    if repeat != DEFAULT_REPEAT_PER_QUESTION_PLATFORM:
        errors.append(f"上传表格每平台每问题必须有 {DEFAULT_REPEAT_PER_QUESTION_PLATFORM} 个答案块，当前检测为 {repeat}")

    sheets = raw_import.get("sheets") if isinstance(raw_import, dict) else []
    matched_by_platform: dict[str, set[str]] = {p: set() for p in platforms}
    for sheet in sheets if isinstance(sheets, list) else []:
        if not isinstance(sheet, dict):
            continue
        platform = str(sheet.get("platform") or "")
        if platform in matched_by_platform and int(sheet.get("answer_blocks") or 0) != DEFAULT_REPEAT_PER_QUESTION_PLATFORM:
            errors.append(f"{PLATFORM_DISPLAY.get(platform, platform)} sheet 答案块数量必须为 {DEFAULT_REPEAT_PER_QUESTION_PLATFORM}，当前为 {sheet.get('answer_blocks')}")
        for row in sheet.get("rows") or []:
            if not isinstance(row, dict):
                continue
            if row.get("status") == "unmatched_question":
                errors.append(f"{sheet.get('sheet_name')} 第 {row.get('excel_row')} 行问题与暂停点 1 确认问题不一致：{row.get('question_text')}")
            qid = str(row.get("matched_question_id") or "")
            if platform in matched_by_platform and qid:
                matched_by_platform[platform].add(qid)
    for platform in platforms:
        missing_qids = sorted(REQUIRED_QUESTION_IDS - matched_by_platform.get(platform, set()))
        if missing_qids:
            errors.append(f"{PLATFORM_DISPLAY.get(platform, platform)} sheet 缺少固定问题行：{', '.join(missing_qids)}")

    expected_records = len(REQUIRED_QUESTION_IDS) * len(platforms) * DEFAULT_REPEAT_PER_QUESTION_PLATFORM
    if len(records) != expected_records:
        errors.append(f"上传表格应生成 {expected_records} 条记录，当前为 {len(records)} 条")
    if not allow_partial_records:
        empty_records = [r for r in records if not _plain_text(r.get("answerContent"))]
        if empty_records:
            errors.append(f"上传表格存在 {len(empty_records)} 条空答案；不得补造记录，请用户重新上传完整表格")
    return errors


def _copy_source_spreadsheet(src: Path, raw_dir: Path, brand: str) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    dest = raw_dir / f"S5_{brand}_uploaded_monitoring_spreadsheet{src.suffix.lower()}"
    try:
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
    except Exception:
        shutil.copyfile(src, dest)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description="Import uploaded XLSX monitoring data into canonical S5.0 files.")
    parser.add_argument("--company-name", required=True)
    parser.add_argument("--brand-name", required=True)
    parser.add_argument("--main-product", required=True)
    parser.add_argument("--questions-json", required=True)
    parser.add_argument("--spreadsheet", required=True, help="User-uploaded XLSX shaped like the monitoring data table reference.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--skip-question-confirmation-check", action="store_true", help="Emergency/debug only. Normal workflow must not use this.")
    parser.add_argument("--data-source", default="uploaded_spreadsheet", choices=["uploaded_spreadsheet", "molizhishu_api"], help="数据来源标签（API自动取数用 molizhishu_api）")
    parser.add_argument("--allow-partial-records", action="store_true", help="Import incomplete records and mark partial_accepted=true. Use only after the user explicitly accepts partial data; a full re-upload is always preferred.")
    args = parser.parse_args()

    brand = args.brand_name
    questions_data = load_json(args.questions_json)
    questions = questions_data.get("questions", []) if isinstance(questions_data, dict) else []
    if not args.skip_question_confirmation_check and not is_question_set_confirmed(questions_data):
        print(question_confirmation_error(questions_data), file=sys.stderr)
        return 7
    if not args.skip_question_confirmation_check and get_selected_monitoring_data_source(questions_data) not in ("uploaded_spreadsheet", args.data_source):
        print(
            "暂停点 1 尚未明确确认上传数据表格，禁止导入。"
            "请先确认固定双问题并明确回复将上传数据表格。",
            file=sys.stderr,
        )
        return 8

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = out_dir / "spreadsheet_monitor_raw"
    spreadsheet_path = Path(args.spreadsheet)
    copied_spreadsheet = _copy_source_spreadsheet(spreadsheet_path, raw_dir, brand)

    try:
        records, platforms, repeat, raw_import = parse_spreadsheet_records(
            data_source=args.data_source,
            spreadsheet_path=spreadsheet_path,
            questions=questions,
            company_name=args.company_name,
            brand_name=brand,
            main_product=args.main_product,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"上传监控数据表格解析失败: {exc}", file=sys.stderr)
        return 4

    scope_errors = validate_uploaded_monitoring_scope(
        records=records,
        platforms=platforms,
        repeat=repeat,
        questions=questions or raw_import.get("questions") or [],
        raw_import=raw_import,
        allow_partial_records=args.allow_partial_records,
    )
    if scope_errors:
        raw_import["scope_validation_errors"] = scope_errors
        raw_import_path = raw_dir / f"S5_{brand}_uploaded_spreadsheet_rows.json"
        save_json(raw_import_path, raw_import)
        print("上传监控数据表格未通过固定范围/问题一致性校验：" + "; ".join(scope_errors), file=sys.stderr)
        return 5

    expected = len(REQUIRED_QUESTION_IDS) * len(platforms) * DEFAULT_REPEAT_PER_QUESTION_PLATFORM
    successful = sum(1 for r in records if r.get("answerContent") and not r.get("errorMessage"))
    failed = max(0, expected - successful)
    partial_accepted = bool(successful < expected and args.allow_partial_records)
    confirmed_at = now_iso()
    raw_import["copied_source_file"] = str(copied_spreadsheet)
    raw_import_path = raw_dir / f"S5_{brand}_uploaded_spreadsheet_rows.json"
    save_json(raw_import_path, raw_import)

    data = {
        "meta": {
            "company_name": args.company_name,
            "brand_name": brand,
            "main_product": args.main_product,
            "created_at": now_iso(),
            "question_set_source": "fixed_rule_based",
            "platforms": platforms,
            "mode": args.data_source,
            "screenshot": 0,
            "repeat_per_question_platform": repeat,
            "strict_monitoring_scope": "2_fixed_questions_x_dynamic_platforms_x_5_repeats",
            "monitoring_data_source": args.data_source,
            "source_is_user_provided_file": True,
            "simulated_data": False,
            "mock_data": False,
            "manual_records": False,
            "data_provenance": {
                "capture_method": args.data_source,
                "capture_script": "import_monitoring_spreadsheet.py",
                "source_file": str(copied_spreadsheet),
                "raw_extracted_file": str(raw_import_path),
                "source_layout": "sheet_per_platform_two_header_rows_answer_blocks",
            },
            "requires_user_interaction": False,
            "requires_user_confirmation_before_s5": False,
            "data_confirmation_status": "confirmed",
            "partial_accepted": partial_accepted,
            "partial_records_for_review": successful < expected,
            "data_confirmed_at": confirmed_at,
            "data_confirmed_by": "auto_import_gate",
            "data_confirmation_gate": {
                "gate_id": "S5_0_UPLOAD_DATA_IMPORTED",
                "status": "confirmed",
                "confirmed_at": confirmed_at,
                "rule": "本工作流不设数据确认暂停点：两份上传表格导入并通过固定范围/一致性校验即自动确认，直接进入 S5 品牌诊断及后续流程。",
            },
        },
        "summary": {
            "expected_records": expected,
            "actual_records": len(records),
            "successful_records": successful,
            "failed_records": failed,
            "screenshot_records": 0,
            "platform_count": len(platforms),
            "question_count": len(questions or raw_import.get("questions") or []),
            "all_failed": successful == 0,
            "monitoring_data_source": args.data_source,
        },
        "questions": questions or raw_import.get("questions") or [],
        "records": records,
    }

    data_path = out_dir / f"S5_{brand}_frontmind_monitoring_data.json"
    raw_path = out_dir / f"S5_{brand}_frontmind_monitoring_raw.json"
    save_json(data_path, data)
    save_json(raw_path, raw_import)

    failure_details = [
        {
            "platform": r.get("platform"),
            "question_id": r.get("question_id"),
            "question_text": r.get("question_text"),
            "run_index": r.get("run_index"),
            "errorMessage": r.get("errorMessage") or "未返回有效答案",
        }
        for r in records
        if not (r.get("answerContent") and not r.get("errorMessage"))
    ]

    workspace_for_manifest = out_dir
    if out_dir.name.lower() in {"02_monitoring", "02_monitoring_data", "monitoring", "s5_monitoring"}:
        workspace_for_manifest = out_dir.parent
    exec_dir = workspace_for_manifest / "_execution"
    exec_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "stage_id": "S5.0",
        "stage_name": "上传表格问题监控数据导入",
        "brand": brand,
        "company_name": args.company_name,
        "main_product": args.main_product,
        "monitoring_data_source": args.data_source,
        "used_uploaded_spreadsheet": args.data_source == "uploaded_spreadsheet",
        "used_molizhishu_api": args.data_source == "molizhishu_api",
        "simulated": False,
        "status": "done" if successful > 0 else "failed",
        "script": "Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_monitoring_spreadsheet.py",
        "generated_files": [
            str(data_path),
            str(raw_path),
        ],
        "source_provenance_files": [str(copied_spreadsheet), str(raw_import_path)],
        "summary": data.get("summary", {}),
        "data_confirmation_status": "confirmed",
        "partial_accepted": partial_accepted,
        "created_at": confirmed_at,
    }
    save_json(exec_dir / f"S5.0_{brand}_monitoring_data_execution_manifest.json", manifest)

    print(json.dumps(data["summary"], ensure_ascii=False, indent=2))
    for item in failure_details:
        print(
            f"[WARN] 缺失答案：{item.get('platform')} | {item.get('question_text')} | 第 {item.get('run_index')} 次：{item.get('errorMessage')}",
            file=sys.stderr,
        )
    if successful == 0:
        print("上传数据表格未生成任何有效答案记录；下游 S5 应停止并要求用户重新上传。", file=sys.stderr)
        return 4
    print(
        "[AUTO_CONFIRMED] S5.0 上传表格监控数据已导入并自动确认（本工作流不设数据确认暂停点）。"
        "请继续导入信源表（引用分析表）；两表导入完成后直接进入 S5 品牌诊断与后续流程，直至最终全景报告。",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
