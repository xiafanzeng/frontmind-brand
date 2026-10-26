#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FrontMind Workflow Reading Guard.

Creates an auditable S0.0 manifest stating that the agent has read the workflow
entry files and acknowledged the non-negotiable execution principles:
  1) read the workflow and obey the single pause point (Pause 1, fixed
     questions + upload commitment) before S5.0; S5.0 has no separate
     data-confirmation pause — both uploaded spreadsheets are imported and
     auto-confirmed, then the run continues straight to the final report;
  2) every research S stage must run Wide Research and write files/manifests;
  3) every stage output must follow the canonical filename contract or be normalized before downstream gates.

This script does not replace real reading by the agent. It provides a small,
explicit gate so later checkers can block one-shot report generation when the
S0.0 acknowledgement was skipped.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VERSION = "workflow-final"

REQUIRED_FILES = [
    "00_先读我_全景报告最高原则.md",
    "全景报告一键执行提示词.md",
    "SKILL.md",
    "00.FrontMind总控路由.skill/SKILL.md",
    "Master_Control/FrontMind_Master_Control.md",
    "Strategy_Workflow/S0.策略编排师.skill/SKILL.md",
    "Strategy_Workflow/shared/project-input-contract.md",
    "Strategy_Workflow/shared/core-execution-principles.md",
    "Strategy_Workflow/shared/wide-research-execution-contract.md",
    "Strategy_Workflow/shared/全链路标准产物文件清单.md",
    "Strategy_Workflow/shared/stage-output-registry.json",
    "Strategy_Workflow/shared/术语与模板字段闭环契约.md",
]


def safe_rel(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except Exception:  # noqa: BLE001
        return str(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create S0.0 workflow reading manifest for FrontMind 本工作流.")
    parser.add_argument("--brand", required=True, help="brand_id, not display brand_name")
    parser.add_argument("--workflow-root", default=".", help="Root path of the unzipped workflow")
    parser.add_argument("--workspace", required=True, help="outputs/{brand_id}")
    parser.add_argument("--brand-name", default="", help="Optional display brand name")
    args = parser.parse_args()

    workflow_root = Path(args.workflow_root).resolve()
    workspace = Path(args.workspace).resolve()
    execution_dir = workspace / "_execution"
    execution_dir.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    file_rows: list[dict[str, Any]] = []
    for rel in REQUIRED_FILES:
        path = workflow_root / rel
        exists = path.exists() and path.is_file() and path.stat().st_size > 0
        if not exists:
            missing.append(rel)
        file_rows.append({
            "path": rel,
            "exists": exists,
            "size_bytes": path.stat().st_size if exists else 0,
        })

    status = "done" if not missing else "blocked"
    created_at = datetime.now(timezone.utc).isoformat()
    manifest_path = execution_dir / f"S0.0_{args.brand}_workflow_reading_manifest.json"
    md_path = execution_dir / f"S0.0_{args.brand}_workflow_reading_manifest.md"

    payload: dict[str, Any] = {
        "version": VERSION,
        "stage_id": "S0.0",
        "stage_name": "Workflow 阅读与双核心原则确认",
        "brand": args.brand,
        "brand_name": args.brand_name or args.brand,
        "status": status,
        "created_at": created_at,
        "workflow_root": str(workflow_root),
        "required_files": file_rows,
        "missing_required_files": missing,
        "pause_points_acknowledged": True,
        "pause_point_count": 1,
        "pause_point_1": {
            "after": "S4.8 固定双问题生成",
            "required_user_choices": ["确认以上两类 AI 监控问题，按默认国内三平台（豆包、元宝、千问）执行"],
            "monitoring_platform_default": ["doubao", "yuanbao", "qianwen"],
            "monitoring_platform_override_rule": "仅当项目输入或用户启动时明确指定其他平台/海外平台时覆盖默认；覆盖范围必须写入确认记录",
            "blocked_until_confirmed": "S5.0 墨力指数 API 自动取数",
        },
        "s5_0_no_data_pause_rule": "S5.0 不设数据确认暂停点：用户在暂停点 1 确认固定双问题后，fetch_molizhishu_monitoring.py 自动取数（2 问 × 平台 × 5 次）、生成两份契约表格并自动导入，通过固定范围/三层对账校验即自动写入 data_confirmation_status=confirmed，随后直接连续执行 S5-S11 直至最终全景报告，不再等待用户确认，全程无需上传任何文件。",
        "wide_research_per_stage_acknowledged": True,
        "wide_research_stages": ["S1", "S2", "S3", "S4", "S5", "S5.5", "S6", "S7", "S8", "S9", "S9.8"],
        "s5_0_data_source_rule_acknowledged": True,
        "s5_0_data_source_choice_acknowledged": True,
        "s5_0_upload_spreadsheet_rule_acknowledged": True,
        "output_filename_contract_acknowledged": True,
        "terminology_template_contract_acknowledged": True,
        "s5_0_data_source_rule": "S5.0 唯一数据路径为墨力指数 API 自动取数（monitoring_data_source=molizhishu_api；路径B手动上传已移除）：运行 fetch_molizhishu_monitoring.py 自动提交任务、轮询、生成契约格式监控表与信源表并自动调用 import_monitoring_spreadsheet.py 与 import_citation_analysis_spreadsheet.py（--data-source molizhishu_api）完成导入与自动确认，留存两表源文件与对应原始提取文件，完成引用三层对账。",
        "s5_0_platform_default_rule": "监测平台默认国内三平台（doubao/yuanbao/qianwen）；仅当项目输入或用户启动时明确指定其他平台/海外平台时按指定执行，并将实际平台范围写入确认记录（meta.monitoring_platforms）。",
        "s5_0_upload_spreadsheet_rule": "S5.0 由 API 自动生成两份契约表格并导入；任一表生成失败、格式错误、来源证明缺失或媒体引用次数合计、内容引用次数合计、问题引用明细行数三层对账失败则停止，不得补造。",
        "output_filename_contract": "每个 S 阶段必须优先使用 shared/全链路标准产物文件清单.md 的 canonical 文件名；命名差异先运行 output_contract_normalizer.py，不得新写浅层文件充数。",
        "terminology_template_contract": "上游术语进入最终报告前必须按 shared/术语与模板字段闭环契约.md 规范化；只改客户版术语，不删除正文、表格、证据或行动建议。",
        "forbidden_one_shot_behavior": [
            "直接从 S1-S4 跳到最终报告",
            "并行研究完成后立即生成最终报告",
            "用 Wide Research 或模型常识代替 S5.0 监控数据",
            "模拟 AI 平台对两个固定问题的回答数据",
        ],
        "generated_files": [str(manifest_path), str(md_path)],
    }

    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        f"# S0.0 Workflow 阅读与双核心原则确认 — {args.brand}",
        "",
        f"> 状态：{'通过' if status == 'done' else '阻断'}",
        f"> 生成时间：{created_at}",
        "",
        "## 已确认的最高原则",
        "",
        "1. 必须先阅读 Workflow 与暂停点逻辑；本工作流只有暂停点 1（S4.8 固定双问题确认），未到暂停点不得自行越过，第一轮最多执行至暂停点 1。",
        "2. 每个研究型 S 阶段必须独立调用 Wide Research，写入阶段文件与 manifest；S5.0 的唯一数据路径是墨力指数 API 自动取数（molizhishu_api），平台默认国内三平台（仅项目输入明确指定时覆盖），且不得模拟数据。",
        "3. 每个阶段必须遵守标准产物文件名闭环；命名差异先规范化已有等价文件，不能重写浅层补丁。",
        "4. 每个阶段术语必须遵守模板字段闭环；术语不一致时只做规范化映射，不能删掉该段内容。",
        "",
        "## 暂停点规则",
        "",
        "- 暂停点 1：S4.8 固定双问题生成后，等待用户明确回复 `确认以上两类 AI 监控问题，按默认国内三平台（豆包、元宝、千问）执行`（项目输入已指定其他平台时替换为实际平台范围）。",
        "- S5.0 不设数据确认暂停点：API 自动取数生成的两份契约表格导入并通过固定范围/三层对账校验即自动确认（data_confirmation_status=confirmed），随后直接连续执行 S5-S11 直至最终全景报告交付，无需用户再次确认，全程无需上传文件。",
        "",
        "## 必读文件检查",
        "",
        "| 文件 | 状态 |",
        "|---|---|",
    ]
    for row in file_rows:
        lines.append(f"| `{row['path']}` | {'存在' if row['exists'] else '缺失'} |")
    if missing:
        lines.extend(["", "## 阻断原因", ""])
        for item in missing:
            lines.append(f"- 缺失：`{item}`")
    md_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": status == "done",
        "status": status,
        "manifest": str(manifest_path),
        "markdown": str(md_path),
        "missing_required_files": missing,
    }, ensure_ascii=False, indent=2))
    return 0 if status == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
