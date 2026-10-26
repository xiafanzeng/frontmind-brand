#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for the upload-only S5.0 monitoring data import.

This module now contains only local JSON persistence and the Pause 1
spreadsheet-source checks. Customer-facing monitoring-file rendering and PDF
conversion were removed together with the 问题监控数据文件 deliverable; S5.0
imports write the canonical monitoring JSON directly and auto-confirm it.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_REPEAT_PER_QUESTION_PLATFORM = 5

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path: str | Path, data: Any) -> None:
    """Atomically persist a JSON value."""
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(
        f".{output.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        try:
            directory_fd = os.open(output.parent, os.O_RDONLY)
        except OSError:
            directory_fd = None
        if directory_fd is not None:
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        if temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass


def get_selected_monitoring_data_source(
    questions_data: dict[str, Any],
) -> str | None:
    """Return the upload-only S5.0 source recorded at Pause 1."""
    meta = questions_data.get("meta", {}) if isinstance(questions_data, dict) else {}
    gate = meta.get("confirmation_gate") or {}
    raw = (
        meta.get("monitoring_data_source_choice")
        or meta.get("selected_monitoring_data_source")
        or gate.get("monitoring_data_source_choice")
        or gate.get("selected_monitoring_data_source")
    )
    value = str(raw or "").strip().lower()
    if value in {
        "uploaded_spreadsheet",
        "spreadsheet",
        "xlsx",
        "upload",
        "uploaded_table",
        "上传表格",
        "数据表格",
    }:
        return "uploaded_spreadsheet"
    if value in {"molizhishu_api", "molizhishu", "api", "api_auto", "api自动取数"}:
        return "molizhishu_api"
    return None


def is_question_set_confirmed(questions_data: dict[str, Any]) -> bool:
    meta = questions_data.get("meta", {}) if isinstance(questions_data, dict) else {}
    gate = meta.get("confirmation_gate") or {}
    confirmed = (
        meta.get("confirmation_status") == "confirmed"
        or gate.get("status") == "confirmed"
    )
    return bool(
        confirmed
        and get_selected_monitoring_data_source(questions_data)
        in ("uploaded_spreadsheet", "molizhishu_api")
    )


def question_confirmation_error(questions_data: dict[str, Any]) -> str:
    meta = questions_data.get("meta", {}) if isinstance(questions_data, dict) else {}
    brand = meta.get("brand_name") or "品牌"
    product = meta.get("main_product") or "核心产品"
    return (
        "S4.8 固定双问题尚未通过用户确认暂停点，或暂停点 1 未明确确认上传数据表格，禁止生成监控数据。"
        f"当前问题应为：Q1={product}推荐；Q2={brand}有什么缺点和问题？。"
        "请先向用户展示确认单，并在用户明确回复 "
        "`确认以上两类 AI 监控问题，我将上传数据表格` 后运行 "
        "confirm_fixed_monitoring_questions.py。"
    )

