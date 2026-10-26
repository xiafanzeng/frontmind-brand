#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mark S4.8 fixed monitoring questions as user-confirmed for the required S5.0 dual-table upload."""
from __future__ import annotations
import argparse, json, re
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def infer_source(text: str) -> str | None:
    value = str(text or "").lower()
    if "上传" in value or "表格" in value or "xlsx" in value or "spreadsheet" in value:
        return "molizhishu_api" if any(k in text for k in ("墨力指数", "api自动取数", "api 取数")) else "uploaded_spreadsheet"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Confirm S4.8 fixed monitoring questions before S5.0 dual-table upload.")
    parser.add_argument("--in-json", required=True)
    parser.add_argument("--out-json", default=None, help="Default: overwrite --in-json")
    parser.add_argument("--confirmed-by", default="user")
    parser.add_argument("--confirmation-text", default="", help="User reply. Must explicitly confirm uploaded spreadsheets.")
    parser.add_argument("--monitoring-data-source", choices=["molizhishu_api"], default="molizhishu_api")
    parser.add_argument("--platforms", default="doubao,yuanbao,qianwen", help="监测平台编码，逗号分隔；默认国内三平台 doubao,yuanbao,qianwen（仅当项目输入明确指定其他平台时覆盖）；写入 meta.monitoring_platforms")
    args = parser.parse_args()
    in_path = Path(args.in_json); out_path = Path(args.out_json) if args.out_json else in_path
    data = json.loads(in_path.read_text(encoding="utf-8"))
    questions = data.get("questions") or []
    if len(questions) != 2:
        raise SystemExit("fixed monitoring questions must contain exactly 2 questions")
    ids = {q.get("question_id") for q in questions}
    if ids != {"Q1_PRODUCT_RECOMMENDATION", "Q2_REPUTATION_ISSUE"}:
        raise SystemExit(f"unexpected question ids: {ids}")
    source = args.monitoring_data_source or infer_source(args.confirmation_text)
    if source not in ("uploaded_spreadsheet", "molizhishu_api"):
        raise SystemExit(
            "Pause 1 confirmation must explicitly confirm the S5.0 data source: "
            "`确认以上两类 AI 监控问题，我将上传数据表格` 或 "
            "`确认以上两类 AI 监控问题，通过墨力指数API自动取数`."
        )
    if source == "molizhishu_api" and not (args.platforms or "").strip():
        raise SystemExit(
            "Pause 1 platform gate: monitoring platforms are a business decision and must be "
            "explicitly selected by the user at pause point 1. Re-run with --platforms "
            "(e.g. --platforms doubao,yuanbao,qianwen for 国内三平台; --list-platforms on "
            "fetch_molizhishu_monitoring.py prints the full catalog). 禁止默认六平台。"
        )
    default_text = "确认以上两类 AI 监控问题，我将上传数据表格"
    confirmation_text = args.confirmation_text or default_text
    meta = data.setdefault("meta", {})
    ts = now_iso()
    meta.update({
        "confirmation_status": "confirmed",
        "requires_user_confirmation_before_s5_0": False,
        "confirmed_at": ts,
        "confirmed_by": args.confirmed_by,
        "confirmation_text": confirmation_text,
        "monitoring_data_source_choice": source,
        "selected_monitoring_data_source": source,
        **({"monitoring_platforms": [x.strip() for x in args.platforms.split(",") if x.strip()]}
           if args.platforms else {}),
        "confirmation_gate": {
            "gate_id": "PAUSE_1_FIXED_QUESTIONS_CONFIRMED",
            "status": "confirmed",
            "confirmed_at": ts,
            "selected_monitoring_data_source": source,
            "rule": "S5.0 may run only after the user confirms the required dual-table upload."
        },
        "upload_branch_required_inputs": ["AI 问答监控表.xlsx", "信源表（引用分析表）.xlsx"],
        "citation_analysis_required": True,
    })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"confirmed fixed monitoring questions with source={source}: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
