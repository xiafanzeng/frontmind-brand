#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate one title hook per customer-facing content opportunity type."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_text(path: str | None) -> str:
    if not path or not Path(path).exists():
        return ""
    return Path(path).read_text(encoding="utf-8", errors="ignore")


def build_hooks(brand: str, product: str) -> list[dict[str, Any]]:
    """Create one customer-facing hook title per content opportunity type."""
    specs = [
        # A 类：GEO 优化文章
        ("A1", "A 类", "品牌聚合推荐 / 品牌全景解析", f"{product}推荐：{brand}等品牌的能力、场景与选择标准全景解析", "承接产品推荐型问题，建立品牌在品类推荐中的基础认知。", "P0"),
        ("A2", "A 类", "行业测评解析", f"{product}怎么选？从行业测评维度看{brand}的适配场景", "用测评维度解释行业格局、品牌能力和用户判断标准。", "P1"),
        ("A3", "A 类", "场景解决方案", f"哪些场景适合选择{brand}？{product}应用问题与解决方案拆解", "围绕用户真实场景，说明品牌可承接的问题和方案边界。", "P0"),
        ("A4", "A 类", "技术科普", f"{product}是什么？核心原理、技术指标与{brand}的应用说明", "降低技术理解门槛，强化品牌与核心技术关键词的关联。", "P1"),
        ("A5", "A 类", "品宣 / 品牌故事", f"{brand}怎么样？从企业实力、核心产品到品牌信任度的全景介绍", "承接品牌查询型问题，建立企业事实和品牌故事基础。", "P0"),
        ("A6", "A 类", "选型指南", f"选择{product}前要看什么？一份面向采购决策的{brand}选型指南", "服务采购、技术和管理决策，提升被推荐与被比较时的可信度。", "P0"),
        ("A7", "A 类", "避坑指南", f"选择{product}有哪些常见坑？结合{brand}场景的风险识别清单", "承接风险规避型搜索，提前回应用户顾虑。", "P1"),
        ("A8", "A 类", "用户案例 / 成功故事", f"{brand}的{product}适合哪些客户？典型场景、交付价值与验证方式", "补足案例和成效证据，强化转化信任。", "P1"),
        ("A9", "A 类", "行业趋势 / 洞察", f"{product}行业正在发生什么变化？从趋势看{brand}的机会与挑战", "将品牌嵌入行业趋势和政策语境，提升中长期认知。", "P2"),
        ("A10", "A 类", "FAQ / 常见问题", f"关于{brand}和{product}，用户最常问的 20 个问题", "以问答结构覆盖 AI 搜索和用户常见疑问。", "P1"),
        ("A11", "A 类", "How-to / 教程", f"{product}如何落地？从需求判断到实施验证的{brand}操作指南", "面向使用、落地和实施阶段，补足步骤型内容。", "P2"),
        ("A12", "A 类", "数据报告", f"{product}行业数据报告：市场需求、竞争格局与{brand}的机会分析", "以数据密集内容增强权威性，适合后续深度资产。", "P2"),
        # B 类：权威长内容
        ("B1", "B 类", "行业白皮书", f"{product}行业白皮书：需求变化、技术路径与品牌机会", "建立行业思想领导力，为后续内容提供引用锚点。", "P2"),
        ("B2", "B 类", "技术文档", f"{brand}{product}技术说明：核心结构、参数边界与应用条件", "展示技术专业性，适合工程、采购和方案评估。", "P1"),
        ("B3", "B 类", "Case Study / 客户成功案例", f"{brand}{product}案例研究：从问题背景到交付结果的完整复盘", "用案例证明交付能力，但必须有真实案例事实支撑。", "conditional"),
        ("B4", "B 类", "用例分析", f"{brand}{product}用例分析：不同场景下的应用价值与限制", "按用例拆解方案适配性，适合复杂决策场景。", "P2"),
        # C 类：媒体与公关
        ("C1a", "C 类", "事件型新闻稿", f"{brand}发布{product}相关动态：围绕技术、服务或市场动作的事件报道", "用于企业事件传播，需有真实事件。", "conditional"),
        ("C1b", "C 类", "品牌深度新闻稿", f"{brand}深度报道：从核心业务、技术能力到行业价值", "建立媒体可引用的品牌全景信息，是首轮权威背书内容。", "P0"),
        ("C2", "C 类", "媒体背书稿", f"第三方视角看{brand}：{product}赛道中的能力与差异化", "以第三方报道口吻提升可信度。", "P1"),
        ("C3", "C 类", "行业评论稿", f"{product}行业趋势观察：{brand}如何理解下一阶段需求变化", "承接行业观点和趋势表达，适合媒体与公众号。", "P2"),
        ("C4", "C 类", "危机公关稿", f"关于{brand}相关问题的事实说明与改进回应", "仅在出现负面舆情、误解或公开争议时启用。", "conditional"),
        # D 类：知识权威与信息矫正
        ("D1", "D 类", "百科词条新建", f"{brand}百科词条建设：企业事实、主营业务与核心产品标准口径", "当品牌缺少百科入口时，作为知识权威基建方向。", "conditional"),
        ("D2", "D 类", "百科词条优化", f"{brand}百科词条优化：补齐企业事实、产品信息与参考来源", "当已有词条不完整或过时时，用于修正和补充。", "conditional"),
        ("D3", "D 类", "企业信息平台矫正", f"{brand}企业信息平台矫正清单：名称、地址、联系方式与主营业务统一", "解决 AI 引用中的企业实体信息不一致问题。", "conditional"),
    ]
    return [
        {
            "content_type_id": content_type_id,
            "content_group": content_group,
            "content_type_name": content_type_name,
            "title_hook": title_hook,
            "purpose": purpose,
            "recommended_priority": priority,
        }
        for content_type_id, content_group, content_type_name, title_hook, purpose, priority in specs
    ]


def render_md(data: dict[str, Any]) -> str:
    lines = [f"# {data['meta']['brand_name']} 内容机会标题钩子", ""]
    lines.append("> 本文件汇总本轮报告建议优先建设的内容主题与标题钩子。")
    lines.append("> 标题钩子用于帮助品牌快速判断后续内容布局方向。")
    lines.append("")
    current_group = None
    for item in data["title_hooks"]:
        if item["content_group"] != current_group:
            current_group = item["content_group"]
            lines.append(f"## {current_group}")
            lines.append("")
        lines.append(f"### {item['content_type_id']} {item['content_type_name']}")
        lines.append("")
        lines.append(f"**标题钩子：** {item['title_hook']}")
        lines.append("")
        lines.append(f"**用途：** {item['purpose']}")
        lines.append("")
        lines.append(f"**建议优先级：** {item['recommended_priority']}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate customer-facing content opportunity title hooks.")
    parser.add_argument("--brand-name", required=True)
    parser.add_argument("--main-product", required=True)
    parser.add_argument("--s5-json", default=None)
    parser.add_argument("--s9-md", default=None)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-md", required=True)
    args = parser.parse_args()

    data = {
        "meta": {
            "brand_name": args.brand_name,
            "main_product": args.main_product,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": "content_opportunity_title_hooks",
            "content_type_policy": "A/B/C/D_content_opportunity_system",
        },
        "title_hooks": build_hooks(args.brand_name, args.main_product),
        "source_context": {
            "s5_json": args.s5_json,
            "s9_md": args.s9_md,
        },
    }
    Path(args.out_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_json).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.out_md).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_md).write_text(render_md(data), encoding="utf-8")
    print(f"saved title hooks: {args.out_json}, {args.out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
