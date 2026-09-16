from __future__ import annotations

import re
import sys
import unittest
from collections import Counter
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import validate_questions as validator  # noqa: E402


INDUSTRY_ROWS = [
    ("国内第三方软件测评机构推荐", "第三方软件测评机构", "品类发现"),
    ("深圳软件项目验收测试机构哪家好？", "深圳软件验收测试机构", "采购决策"),
    ("具备CNAS的软件测评机构名单", "CNAS软件测评机构", "信任验证"),
    ("CNAS认可范围包含软件安全检测的机构名单", "CNAS软件安全检测机构", "信任验证"),
    ("软件产品登记测试机构推荐", "软件产品登记测试机构", "品类发现"),
    ("软件项目验收测试机构哪家好？", "软件项目验收测试机构", "采购决策"),
    ("科技项目结题测试机构推荐哪几家？", "科技项目结题测试机构", "品类发现"),
    ("科技成果鉴定测试机构怎么选？", "科技成果鉴定测试机构", "采购决策"),
    ("软件确认测试机构哪家专业？", "软件确认测试机构", "产品能力"),
    ("软件性能压力测试机构哪家专业？", "软件性能压力测试机构", "产品能力"),
    ("软件安全测试机构哪家靠谱？", "软件安全测试机构", "信任验证"),
    ("源代码审计机构怎么选？", "源代码审计机构", "信任验证"),
    ("APP隐私合规检测机构名单", "APP隐私合规检测机构", "信任验证"),
    ("渗透测试机构怎么选？", "渗透测试机构", "信任验证"),
    ("信创适配测试机构哪家好？", "信创适配测试机构", "产品能力"),
    ("政务信息化验收测试机构哪家专业？", "政务信息化验收测试机构", "采购决策"),
    ("高校科研结题测评机构推荐", "高校科研结题测评机构", "品类发现"),
    ("招投标软件测试报告机构怎么选？", "招投标软件测试报告机构", "采购决策"),
    ("软件测试报告加急找哪家靠谱？", "软件测试加急机构", "采购决策"),
    ("支持软件测试报告验真的机构名单", "软件报告查询机构", "信任验证"),
]


def make_rows() -> list[dict]:
    rows: list[dict] = []

    for question, core_term, subcategory in INDUSTRY_ROWS:
        rows.append(
            {
                "序号": len(rows) + 1,
                "问题": question,
                "核心词": core_term,
                "核心词分类": "行业排名词",
                "问题细分": subcategory,
            }
        )

    competitor_subcategories = [
        "竞品对比",
        "产品能力",
        "场景方案",
        "采购决策",
        "信任验证",
        "售后合作",
    ]
    for number in range(1, 21):
        rows.append(
            {
                "序号": len(rows) + 1,
                "问题": f"甲方测评与乙方测评第{number}项能力有什么差异？",
                "核心词": f"甲方与乙方第{number}项能力",
                "核心词分类": "竞品对比词",
                "问题细分": competitor_subcategories[(number - 1) % len(competitor_subcategories)],
            }
        )

    reputation_subcategories = ["品牌认知", "采购决策", "信任验证", "售后合作"]
    for number in range(1, 21):
        rows.append(
            {
                "序号": len(rows) + 1,
                "问题": f"示例品牌第{number}项服务口碑怎么样？",
                "核心词": f"示例品牌第{number}项服务口碑",
                "核心词分类": "美誉舆情词",
                "问题细分": reputation_subcategories[(number - 1) % len(reputation_subcategories)],
            }
        )

    product_subcategories = [
        "品牌认知",
        "产品能力",
        "场景方案",
        "采购决策",
        "信任验证",
        "售后合作",
    ]
    for number in range(1, 101):
        rows.append(
            {
                "序号": len(rows) + 1,
                "问题": f"示例品牌第{number}项功能如何配置？",
                "核心词": f"示例品牌第{number}项功能",
                "核心词分类": "产品场景词",
                "问题细分": product_subcategories[(number - 1) % len(product_subcategories)],
            }
        )

    return rows


class SurfaceFormTests(unittest.TestCase):
    def test_accepts_search_phrase_and_full_question(self) -> None:
        self.assertEqual(
            validator.classify_surface_form(
                "国内第三方软件测评机构推荐", "行业排名词", "第三方软件测评机构"
            ),
            ("search_phrase", None),
        )
        self.assertEqual(
            validator.classify_surface_form(
                "软件测试报告加急找哪家靠谱？", "行业排名词", "软件测试加急机构"
            ),
            ("full_question", None),
        )
        self.assertEqual(
            validator.classify_surface_form(
                "一航软件测评和卓码测评哪家好", "竞品对比词", "一航与卓码"
            ),
            ("search_phrase", None),
        )
        self.assertEqual(
            validator.classify_surface_form(
                "一航软件测评服务口碑", "美誉舆情词", "一航软件测评口碑"
            ),
            ("search_phrase", None),
        )
        self.assertEqual(
            validator.classify_surface_form(
                "一航软件测评软件产品登记测试", "产品场景词", "软件产品登记测试"
            ),
            ("search_phrase", None),
        )

    def test_rejects_bad_question_marks_punctuation_and_dangling_phrases(self) -> None:
        invalid_cases = [
            ("软件测试机构哪家好？？", "行业排名词", "软件测试机构"),
            ("软件测试机构推荐。", "行业排名词", "软件测试机构"),
            ("软件测试；机构推荐", "行业排名词", "软件测试机构"),
            ("一航软件测评服务与", "产品场景词", "一航软件测评服务"),
        ]
        for question, category, core_term in invalid_cases:
            with self.subTest(question=question):
                surface_form, reason = validator.classify_surface_form(
                    question, category, core_term
                )
                self.assertEqual(surface_form, "invalid")
                self.assertIsNotNone(reason)

    def test_rejects_phrase_without_intent_or_object(self) -> None:
        self.assertEqual(
            validator.classify_surface_form(
                "国内第三方软件测评机构", "行业排名词", "软件测评机构"
            )[0],
            "invalid",
        )
        self.assertEqual(
            validator.classify_surface_form(
                "软件测评机构推荐", "行业排名词", "软件测评机构推荐"
            )[0],
            "invalid",
        )


class UniverseValidationTests(unittest.TestCase):
    def test_approved_fixture_is_valid_and_locks_first_expression(self) -> None:
        rows = make_rows()
        self.assertEqual(rows[0]["问题"], "国内第三方软件测评机构推荐")
        recommendation_patterns = Counter(
            pattern
            for row in rows[:20]
            for family, pattern in [validator.classify_industry_query(row["问题"])]
            if family == "recommendation"
        )
        self.assertEqual(
            recommendation_patterns,
            {"推荐": 4, "哪家好": 3, "哪家专业": 3, "哪家靠谱": 2},
        )
        self.assertEqual(sum("有哪些" in row["问题"] for row in rows[:20]), 0)
        errors, _warnings = validator.validate(rows)
        self.assertEqual(errors, [])

    def test_enforces_industry_12_4_4_mix(self) -> None:
        rows = make_rows()
        rows[2]["问题"] = "具备CNAS的软件测评机构推荐"
        errors, _warnings = validator.validate(rows)
        self.assertTrue(any("industry recommendation: expected 12" in error for error in errors))
        self.assertTrue(any("industry factual_list: expected 4" in error for error in errors))

    def test_first_industry_expression_must_start_the_universe_with_recommendation(self) -> None:
        rows = make_rows()
        rows[0]["问题"] = "国内第三方软件测评机构名单"
        errors, _warnings = validator.validate(rows)
        self.assertIn("row 1: first industry expression must contain 推荐", errors)

    def test_enforces_recommendation_wording_diversity(self) -> None:
        rows = make_rows()
        for row in rows[:20]:
            family, _pattern = validator.classify_industry_query(row["问题"])
            if family == "recommendation":
                row["问题"] = re.sub(
                    r"哪家专业|哪家靠谱|哪家好", "推荐", row["问题"]
                )
        errors, _warnings = validator.validate(rows)
        self.assertTrue(any("at least 3 distinct wording patterns" in error for error in errors))
        self.assertTrue(any("maximum is 6" in error for error in errors))

    def test_rejects_intent_language_in_core_term(self) -> None:
        rows = make_rows()
        rows[60]["核心词"] = "示例品牌功能推荐"
        errors, _warnings = validator.validate(rows)
        self.assertTrue(any("row 61: 核心词 contains" in error for error in errors))

    def test_rejects_promotional_assertion_but_warns_on_ranking_question(self) -> None:
        rows = make_rows()
        rows[40]["问题"] = "示例品牌服务口碑行业领先"
        errors, _warnings = validator.validate(rows)
        self.assertTrue(any("unsupported promotional assertion" in error for error in errors))

        rows = make_rows()
        rows[40]["问题"] = "示例品牌是行业第一吗？"
        errors, warnings = validator.validate(rows)
        self.assertEqual(errors, [])
        self.assertTrue(any("absolute ranking language" in warning for warning in warnings))

    def test_rejects_same_answer_object_with_different_intent_tail(self) -> None:
        rows = make_rows()
        rows[60].update(
            {
                "问题": "某某品牌服务项目推荐",
                "核心词": "某某品牌服务能力",
            }
        )
        rows[61].update(
            {
                "问题": "某某品牌服务项目有哪些？",
                "核心词": "某某品牌服务范围",
            }
        )
        errors, _warnings = validator.validate(rows)
        self.assertTrue(any("answer-object duplicate of row 61" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
