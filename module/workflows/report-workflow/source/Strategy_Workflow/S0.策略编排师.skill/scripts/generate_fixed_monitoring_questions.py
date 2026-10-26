#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate fixed two monitoring questions and a user-confirmation sheet.

本工作流 enforces mandatory Pause 1: S5.0 may not import the required two spreadsheets
until these questions are explicitly confirmed by the user.
"""
from __future__ import annotations
import argparse, json, re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COMPANY_SUFFIX_RE = re.compile(r"(有限责任公司|股份有限公司|集团有限公司|科技有限公司|技术有限公司|有限公司|集团|公司)$")
CITY_PREFIX_RE = re.compile(r"^(中国|广东省|广东|深圳市|深圳|东莞市|东莞|北京市|北京|上海市|上海|广州市|广州|浙江省|江苏省|山东省|河南省|河北省)")

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def guess_brand_name(company_name: str) -> str:
    text = CITY_PREFIX_RE.sub("", company_name.strip())
    text = COMPANY_SUFFIX_RE.sub("", text)
    return text[:8] if len(text) > 8 else text

def build_questions(company_name: str, brand_name: str, main_product: str) -> dict[str, Any]:
    brand = brand_name.strip() or guess_brand_name(company_name)
    product = main_product.strip() or "核心产品"
    return {
        "meta": {
            "company_name": company_name,
            "brand_name": brand,
            "main_product": product,
            "question_set_source": "fixed_rule_based",
            "workflow_version": "本工作流",
            "created_at": now_iso(),
            "confirmation_status": "pending_user_confirmation",
            "requires_user_confirmation_before_s5_0": True,
            "confirmation_instruction": "暂停点 1：请用户确认这两类固定 AI 监控问题。数据来源固定为墨力指数 API 自动取数（唯一路径，手动双表上传已移除）；监测平台默认国内三平台（豆包·元宝·千问）——仅当项目输入或用户在启动时明确指定其他平台/海外平台时按指定执行，并在确认单中记录实际平台范围。确认后 fetch_molizhishu_monitoring.py 自动取数、自动生成两份契约表格并自动导入连跑，无需上传任何文件。",
            "notes": [
                "S2 营销图谱不生成监控问题；本文件由 S4.8 固定规则生成。",
                "Q1 用于产品/品类推荐可见度；Q2 用于品牌舆情风险，不计入排名/可见度。",
                "本工作流要求，S5.0 执行前必须由用户确认本文件的问题文本；数据来源固定为墨力指数 API，平台范围默认国内三平台（除非项目输入明确指定）。",
            ]
        },
        "questions": [
            {"question_id": "Q1_PRODUCT_RECOMMENDATION", "question_text": f"{product}推荐", "question_type": "product_recommendation", "purpose": "测试行业产品推荐时，AI 是否推荐到该品牌。", "ranking_metric_eligible": True},
            {"question_id": "Q2_REPUTATION_ISSUE", "question_text": f"{brand}有什么缺点和问题？", "question_type": "reputation_issue", "purpose": "测试品牌舆情、缺点、问题、风险和信任边界。", "ranking_metric_eligible": False}
        ]
    }

def render_confirmation_md(data: dict[str, Any]) -> str:
    meta = data.get("meta", {})
    q1, q2 = data.get("questions", [{}, {}])[:2]
    return f"""# S4.8 固定 AI 监控问题确认单

企业名称：{meta.get('company_name', '')}
品牌名：{meta.get('brand_name', '')}
核心产品/业务：{meta.get('main_product', '')}
生成时间：{meta.get('created_at', '')}

## 待确认问题

1. Q1｜产品/品类推荐问题：`{q1.get('question_text', '')}`
   - 用途：测试行业产品推荐时，AI 是否推荐到该品牌。
   - 指标口径：计入 AI 可见度、推荐、排名、Top3/Top5 和平均位次。

2. Q2｜品牌舆情风险问题：`{q2.get('question_text', '')}`
   - 用途：测试品牌缺点、问题、风险和信任边界。
   - 指标口径：只进入舆情/风险分析，不计入排名、Top3/Top5 或平均位次。

## 暂停点 1：用户确认要求

请向用户展示以上两类固定问题，并等待用户明确回复后继续。
用户必须明确回复：

- `确认以上两类 AI 监控问题，按默认国内三平台（豆包、元宝、千问）执行`（仅当项目输入或用户启动时已明确指定其他平台/海外平台，才替换为实际平台范围）

数据来源固定为墨力指数 API 自动取数（唯一路径，手动双表上传已移除）：确认后自动提交 2 问 × 所选平台 × 5 次任务，轮询取回答案与引用，生成两份契约表格并自动导入；通过固定范围/三层对账校验后自动确认（data_confirmation_status=confirmed），直接连续执行至最终全景报告（本工作流不设数据确认暂停点，全程无需上传任何文件）。

如用户指出品牌名或核心产品不准确，只能修正品牌名/核心产品文本后重新生成本确认单；不得新增第三类监控问题，也不得让 S2 代表题替代固定双问题。
"""

def main() -> int:
    parser = argparse.ArgumentParser(description="Generate fixed two monitoring questions and a confirmation sheet.")
    parser.add_argument("--company-name", required=True)
    parser.add_argument("--brand-name", default="")
    parser.add_argument("--main-product", default="")
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-confirmation-md", default=None)
    args = parser.parse_args()
    data = build_questions(args.company_name, args.brand_name, args.main_product)
    out = Path(args.out_json); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved fixed questions: {out}")
    if args.out_confirmation_md:
        md = Path(args.out_confirmation_md); md.parent.mkdir(parents=True, exist_ok=True)
        md.write_text(render_confirmation_md(data), encoding="utf-8")
        print(f"saved question confirmation sheet: {md}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
