#!/usr/bin/env python3
"""Validate the final five-column question-universe JSON.

The public ``问题`` column stores a user search expression. An expression may
be either a complete question ending in one question mark or a natural search
phrase without terminal punctuation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path


FIELDS = {"序号", "问题", "核心词", "核心词分类", "问题细分"}
CATEGORY_ORDER = ["行业排名词", "竞品对比词", "美誉舆情词", "产品场景词"]
TARGETS = {
    "行业排名词": 20,
    "竞品对比词": 20,
    "美誉舆情词": 20,
    "产品场景词": 100,
}
SUBCATEGORIES = {
    "品牌认知",
    "品类发现",
    "产品能力",
    "竞品对比",
    "场景方案",
    "采购决策",
    "信任验证",
    "售后合作",
}
ALLOWED_SUBCATEGORIES = {
    "行业排名词": {"品类发现", "产品能力", "场景方案", "采购决策", "信任验证", "售后合作"},
    "竞品对比词": {"竞品对比", "产品能力", "场景方案", "采购决策", "信任验证", "售后合作"},
    "美誉舆情词": {"品牌认知", "采购决策", "信任验证", "售后合作"},
    "产品场景词": {"品牌认知", "产品能力", "场景方案", "采购决策", "信任验证", "售后合作"},
}

# Core terms describe answer objects. User-intent operators belong only in the
# search expression, not in the core term.
CORE_TERM_QUESTION_PATTERN = re.compile(
    r"怎么|如何|为什么|为何|是否|哪些|哪家|哪个好|怎么办|怎么解决|"
    r"推荐|值得考虑|哪家专业|哪家靠谱|对比|比较|区别|差异|优缺点|"
    r"排名|排行榜|榜单|名单|名录|吗$|呢$",
    re.IGNORECASE,
)
MEANINGFUL_NORMALIZATION_SYMBOLS = {"+", "#", "&"}
FORMULA_PREFIXES = ("=", "+", "-", "@")
FORBIDDEN_PROMISES = (
    "零风险",
    "百分百",
    "100%",
    "保证有效",
    "保证成功",
    "绝对安全",
    "稳赚不赔",
    "包治",
    "治愈",
    "包过",
    "必过",
)
ABSOLUTE_RANKING_PATTERN = re.compile(
    r"最好|最专业|最靠谱|最值得|第一|唯一|首家|永久|十大|排行榜|"
    r"(?:机构|品牌|公司|平台)排名|权威榜单|官方榜单|行业冠军|"
    r"top\s*(?:\d+|n)(?![a-z0-9])",
    re.IGNORECASE,
)
PROMOTIONAL_ASSERTION_PATTERN = re.compile(
    r"行业领先|全国领先|全球领先|顶级|最专业|首选|必选|公认第一|"
    r"官方指定|唯一指定|权威认证|值得信赖"
)

QUESTION_MARKS = ("？", "?")
TERMINAL_PUNCTUATION = tuple("。！!；;：:,，、…")
DANGLING_ENDINGS = ("的", "与", "和", "在", "对", "为", "把", "被", "从", "到")

SEARCH_PHRASE_INTENT_PATTERNS = {
    "行业排名词": re.compile(
        r"推荐|哪家好|哪家专业|哪家靠谱|值得考虑|怎么选|如何选|选哪家|"
        r"选哪个|名单|名录|有哪些|哪几家|排名"
    ),
    "竞品对比词": re.compile(
        r"对比|比较|区别|差异|哪家好|哪个好|怎么选|如何选|优缺点|"
        r"相比|还是|(?:和|与|vs|v\.s\.).*(?:哪家|哪个|对比|比较)",
        re.IGNORECASE,
    ),
    "美誉舆情词": re.compile(
        r"口碑|评价|认可度|可信度|专业度|可靠|靠谱|怎么样|体验|定位|"
        r"声誉|满意度|售后|响应|稳定|规范|透明|合理|行业地位"
    ),
    "产品场景词": re.compile(
        r"服务|功能|产品|项目|地区|区域|内容|能力|范围|价格|报价|收费|"
        r"流程|材料|周期|条件|教程|方法|资质|报告|接入|使用|复测|售后|"
        r"测试|检测|审计|方案|客户|对象|时效|发票|合同|验真|加急"
    ),
}

SEARCH_INTENT_STRIP_PATTERN = re.compile(
    r"哪家专业|哪家靠谱|哪家好|哪个好|怎么选择|如何选择|怎么选|如何选|"
    r"选哪家|选哪个|推荐哪几家|值得考虑|推荐|有哪些|哪几家|哪些|名单|"
    r"名录|排行榜|排名|对比|比较|有何不同|什么区别|区别|差异|优缺点|"
    r"怎么样|如何|靠谱吗|是否靠谱|吗|呢",
    re.IGNORECASE,
)

INDUSTRY_RECOMMENDATION_PATTERNS = (
    ("哪家专业", re.compile(r"哪家专业")),
    ("哪家靠谱", re.compile(r"哪家靠谱")),
    ("哪家好", re.compile(r"哪家好")),
    ("推荐", re.compile(r"推荐")),
    ("值得考虑", re.compile(r"值得考虑")),
)
INDUSTRY_SELECTION_PATTERN = re.compile(r"怎么选|如何选|选哪家|选哪个")
INDUSTRY_FACTUAL_LIST_PATTERN = re.compile(r"名单|名录|有哪些|哪几家|哪些")
INDUSTRY_TARGET_MIX = {
    "recommendation": 12,
    "selection": 4,
    "factual_list": 4,
}


def normalize_question(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    return "".join(
        char
        for char in normalized
        if not char.isspace()
        and (
            char in MEANINGFUL_NORMALIZATION_SYMBOLS
            or unicodedata.category(char)[0] not in {"P", "S", "Z"}
        )
    )


def visible_length(value: str) -> int:
    return sum(1 for char in value if not char.isspace())


def answer_signature(value: str) -> str:
    """Return a conservative answer-object signature for intent-tail dedupe."""

    normalized = unicodedata.normalize("NFKC", value).lower()
    normalized = SEARCH_INTENT_STRIP_PATTERN.sub("", normalized)
    return normalize_question(normalized)


def classify_industry_query(value: str) -> tuple[str | None, str | None]:
    """Classify one industry expression into the required 12/4/4 families."""

    for label, pattern in INDUSTRY_RECOMMENDATION_PATTERNS:
        if pattern.search(value):
            return "recommendation", label
    if INDUSTRY_SELECTION_PATTERN.search(value):
        return "selection", "selection"
    if INDUSTRY_FACTUAL_LIST_PATTERN.search(value):
        return "factual_list", "factual_list"
    return None, None


def classify_surface_form(
    question: str, category: str, core_term: str
) -> tuple[str, str | None]:
    """Return ``(surface_form, error_reason)`` for a search expression."""

    question_mark_count = sum(question.count(mark) for mark in QUESTION_MARKS)
    if question_mark_count:
        if question_mark_count == 1 and question.endswith(QUESTION_MARKS):
            return "full_question", None
        return "invalid", "问题 must contain at most one question mark, at the end"

    if any(mark in question for mark in TERMINAL_PUNCTUATION):
        return "invalid", "search phrase must not contain sentence punctuation"
    if question.endswith(DANGLING_ENDINGS):
        return "invalid", "search phrase ends with a dangling function word"

    intent_pattern = SEARCH_PHRASE_INTENT_PATTERNS.get(category)
    if intent_pattern is None or not intent_pattern.search(question):
        return "invalid", "search phrase lacks a category-appropriate search intent"

    if normalize_question(question) == normalize_question(core_term):
        return "invalid", "search phrase must not equal its 核心词"

    object_text = SEARCH_INTENT_STRIP_PATTERN.sub("", question)
    if visible_length(normalize_question(object_text)) < 4:
        return "invalid", "search phrase lacks a clear searchable object"

    if category == "竞品对比词":
        pair_pattern = re.compile(r".{2,}(?:和|与|vs|v\.s\.).{2,}", re.IGNORECASE)
        if not pair_pattern.search(question):
            return "invalid", "competitor search phrase must name at least two comparison objects"

    return "search_phrase", None


def load_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        rows = payload["rows"]
    elif isinstance(payload, dict) and isinstance(payload.get("questions"), list):
        rows = payload["questions"]
    else:
        raise ValueError("JSON must be an array or an object containing a rows/questions array")
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError("Every question row must be a JSON object")
    return rows


def validate(rows: list[dict]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if len(rows) != 160:
        errors.append(f"expected 160 rows, received {len(rows)}")

    normalized_seen: dict[str, int] = {}
    exact_seen: dict[str, int] = {}
    signature_seen: dict[str, int] = {}
    normalized_questions: list[tuple[int, str]] = []
    categories: Counter[str] = Counter()
    subcategories: Counter[str] = Counter()
    industry_families: Counter[str] = Counter()
    recommendation_patterns: Counter[str] = Counter()

    expected_categories: list[str] = []
    for category in CATEGORY_ORDER:
        expected_categories.extend([category] * TARGETS[category])

    for index, row in enumerate(rows, start=1):
        row_label = f"row {index}"
        keys = set(row)
        if keys != FIELDS:
            missing = sorted(FIELDS - keys)
            extra = sorted(keys - FIELDS)
            if missing:
                errors.append(f"{row_label}: missing fields {missing}")
            if extra:
                errors.append(f"{row_label}: unexpected fields {extra}")

        sequence = row.get("序号")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence != index:
            errors.append(f"{row_label}: 序号 must equal {index}")

        text_values: dict[str, str] = {}
        for field in ("问题", "核心词", "核心词分类", "问题细分"):
            raw_value = row.get(field)
            if not isinstance(raw_value, str):
                errors.append(f"{row_label}: {field} must be a string")
                text_values[field] = ""
            else:
                text_values[field] = raw_value.strip()

        question = text_values["问题"]
        core_term = text_values["核心词"]
        category = text_values["核心词分类"]
        subcategory = text_values["问题细分"]

        if not question:
            errors.append(f"{row_label}: 问题 is empty")
        else:
            length = visible_length(question)
            if length < 8 or length > 32:
                errors.append(f"{row_label}: 问题 visible length {length} is outside 8–32")
            if "，" in question or "," in question:
                errors.append(f"{row_label}: 问题 contains a comma")
            if "\n" in question or "\r" in question:
                errors.append(f"{row_label}: 问题 contains a line break")
            if question.startswith(FORMULA_PREFIXES):
                errors.append(f"{row_label}: 问题 begins with an unsafe spreadsheet formula prefix")

            surface_form, surface_error = classify_surface_form(question, category, core_term)
            if surface_error:
                errors.append(f"{row_label}: {surface_error}")

            matched_promises = [term for term in FORBIDDEN_PROMISES if term in question]
            if matched_promises:
                errors.append(
                    f"{row_label}: 问题 contains forbidden promise language {matched_promises}"
                )

            promotional_matches = PROMOTIONAL_ASSERTION_PATTERN.findall(question)
            if surface_form == "search_phrase" and promotional_matches:
                errors.append(
                    f"{row_label}: search phrase contains unsupported promotional assertion "
                    f"{promotional_matches}"
                )

            ranking_matches = ABSOLUTE_RANKING_PATTERN.findall(question)
            if ranking_matches:
                warnings.append(
                    f"{row_label}: review absolute ranking language {ranking_matches} for a "
                    "current objective scope, metric and source"
                )

            if question in exact_seen:
                errors.append(f"{row_label}: exact duplicate of row {exact_seen[question]}")
            else:
                exact_seen[question] = index

            normalized = normalize_question(question)
            if not normalized:
                errors.append(f"{row_label}: 问题 has no searchable content")
            elif normalized in normalized_seen:
                errors.append(
                    f"{row_label}: normalized duplicate of row {normalized_seen[normalized]}"
                )
            else:
                normalized_seen[normalized] = index
                normalized_questions.append((index, normalized))

            signature = answer_signature(question)
            if len(signature) >= 4:
                if signature in signature_seen:
                    errors.append(
                        f"{row_label}: answer-object duplicate of row "
                        f"{signature_seen[signature]} after removing intent wording"
                    )
                else:
                    signature_seen[signature] = index

            if category == "行业排名词":
                family, recommendation_pattern = classify_industry_query(question)
                if family is None:
                    errors.append(
                        f"{row_label}: industry expression must be recommendation, "
                        "selection or factual-list intent"
                    )
                else:
                    industry_families[family] += 1
                    if family == "recommendation" and recommendation_pattern:
                        recommendation_patterns[recommendation_pattern] += 1

        if not core_term:
            errors.append(f"{row_label}: 核心词 is empty")
        else:
            core_term_length = visible_length(core_term)
            if core_term_length < 2 or core_term_length > 24:
                errors.append(
                    f"{row_label}: 核心词 visible length {core_term_length} is outside 2–24"
                )
            if "\n" in core_term or "\r" in core_term:
                errors.append(f"{row_label}: 核心词 contains a line break")
            if core_term.startswith(FORMULA_PREFIXES):
                errors.append(f"{row_label}: 核心词 begins with an unsafe spreadsheet formula prefix")
            if "，" in core_term or "," in core_term:
                errors.append(f"{row_label}: 核心词 contains a comma")
            if "？" in core_term or "?" in core_term:
                errors.append(f"{row_label}: 核心词 must be a noun phrase, not a question")
            if CORE_TERM_QUESTION_PATTERN.search(core_term):
                errors.append(
                    f"{row_label}: 核心词 contains a question/action phrase instead of a noun phrase"
                )

        if category not in TARGETS:
            errors.append(f"{row_label}: invalid 核心词分类 {category!r}")
        else:
            categories[category] += 1
            if index <= len(expected_categories) and category != expected_categories[index - 1]:
                errors.append(
                    f"{row_label}: expected category {expected_categories[index - 1]!r}, received {category!r}"
                )

        if subcategory not in SUBCATEGORIES:
            errors.append(f"{row_label}: invalid 问题细分 {subcategory!r}")
        else:
            subcategories[subcategory] += 1
            if category in ALLOWED_SUBCATEGORIES and subcategory not in ALLOWED_SUBCATEGORIES[category]:
                errors.append(
                    f"{row_label}: 问题细分 {subcategory!r} is incompatible with {category!r}"
                )

    if rows:
        first_question = rows[0].get("问题", "")
        if not isinstance(first_question, str) or "推荐" not in first_question:
            errors.append("row 1: first industry expression must contain 推荐")
        if isinstance(first_question, str) and "有哪些" in first_question:
            errors.append("row 1: first industry expression must not use 有哪些")

    for family, expected in INDUSTRY_TARGET_MIX.items():
        actual = industry_families.get(family, 0)
        if actual != expected:
            errors.append(f"industry {family}: expected {expected}, received {actual}")

    if sum(recommendation_patterns.values()) == INDUSTRY_TARGET_MIX["recommendation"]:
        if len(recommendation_patterns) < 3:
            errors.append("industry recommendations must use at least 3 distinct wording patterns")
        if recommendation_patterns and max(recommendation_patterns.values()) > 6:
            label, count = recommendation_patterns.most_common(1)[0]
            errors.append(
                f"industry recommendation pattern {label!r} appears {count} times; maximum is 6"
            )

    for category in CATEGORY_ORDER:
        actual = categories.get(category, 0)
        expected = TARGETS[category]
        if actual != expected:
            errors.append(f"{category}: expected {expected}, received {actual}")

    uncovered = sorted(SUBCATEGORIES - set(subcategories))
    if uncovered:
        errors.append(
            "shared subcategories must each appear at least once; missing: "
            + ", ".join(uncovered)
        )

    for left_offset, (left_index, left_question) in enumerate(normalized_questions):
        if len(left_question) < 12:
            continue
        for right_index, right_question in normalized_questions[left_offset + 1 :]:
            if len(right_question) < 12:
                continue
            similarity = SequenceMatcher(None, left_question, right_question).ratio()
            if similarity >= 0.95:
                warnings.append(
                    "rows "
                    f"{left_index}/{right_index}: lexical near-duplicate similarity "
                    f"{similarity:.3f}; manually compare expected answers"
                )

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a final 160-row brand search-expression universe JSON."
    )
    parser.add_argument("json_path", type=Path)
    args = parser.parse_args()

    try:
        rows = load_rows(args.json_path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    errors, warnings = validate(rows)
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"FAILED: {len(errors)} error(s)", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "rows": len(rows),
                "categories": TARGETS,
                "subcategories": dict(sorted(Counter(row["问题细分"] for row in rows).items())),
                "warnings": len(warnings),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
