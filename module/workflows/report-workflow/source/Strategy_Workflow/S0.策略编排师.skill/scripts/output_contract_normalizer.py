#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Normalize FrontMind stage output filenames into the canonical contract.

The workflow allows agents to produce equivalent files with slightly different
names during Wide Research. This script closes the loop before pause gates,
completeness checking, S10 rendering and final packaging by copying compatible
aliases to the canonical filenames required by the downstream tools.

It never fabricates content. If no substantive source file exists, it fails and
points the operator back to the corresponding S stage.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXCLUDE_NAME_RE = re.compile(r"(__pycache__|\.pyc$|manifest|check|检查|复核|template|schema|raw|provenance|task_submit|task_result)", re.I)
PLACEHOLDER_RE = re.compile(r"(待补齐|待确认|TODO|TBD|示例内容|占位内容|placeholder)", re.I)


def registry_path() -> Path:
    return Path(__file__).resolve().parents[2] / "shared" / "stage-output-registry.json"


def load_registry() -> dict[str, Any]:
    return json.loads(registry_path().read_text(encoding="utf-8"))


def format_path(template: str, brand: str) -> str:
    return template.replace("{brand}", brand)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def substantive_chars(path: Path) -> int:
    if path.suffix.lower() not in {".md", ".txt", ".html"}:
        return path.stat().st_size
    text = read_text(path)
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"^\s*#{1,6}\s+.*$", "", text, flags=re.M)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", "", text)
    return len(re.sub(r"[\s\W_]+", "", text))


def json_leafs(value: Any) -> int:
    if isinstance(value, dict):
        return sum(json_leafs(v) for v in value.values())
    if isinstance(value, list):
        return sum(json_leafs(v) for v in value)
    if value is None:
        return 0
    if isinstance(value, str) and (not value.strip() or PLACEHOLDER_RE.search(value)):
        return 0
    return 1


def validate_candidate(path: Path, fmt: str) -> tuple[bool, str, int]:
    if not path.exists() or not path.is_file() or path.stat().st_size <= 0:
        return False, "missing_or_empty", 0
    suffix = path.suffix.lower().lstrip(".")
    if fmt and fmt not in {"html"} and suffix != fmt.lower():
        # pdf/html/txt are checked mostly by suffix/size; json/md must match exactly.
        return False, f"suffix_mismatch:{suffix}!={fmt}", 0
    if EXCLUDE_NAME_RE.search(path.name) and "S5.0" not in path.name:
        return False, "excluded_by_name", 0
    if fmt == "json":
        try:
            data = json.loads(read_text(path))
        except Exception as exc:  # noqa: BLE001
            return False, f"invalid_json:{exc}", 0
        leafs = json_leafs(data)
        if leafs <= 0:
            return False, "empty_json", 0
        return True, "ok", leafs
    if fmt == "md":
        chars = substantive_chars(path)
        if chars < 120:
            return False, f"md_too_short:{chars}", chars
        return True, "ok", chars
    # pdf/html/txt and other customer deliverables: non-empty is enough here.
    return True, "ok", int(path.stat().st_size)


def resolve_file(workspace: Path, candidate: str) -> Path:
    p = Path(candidate)
    if p.is_absolute():
        return p
    direct = Path(candidate)
    if direct.exists():
        return direct
    parts = list(p.parts)
    if workspace.name in parts:
        idx = parts.index(workspace.name)
        suffix = parts[idx + 1:]
        if suffix:
            return workspace.joinpath(*suffix)
    return workspace / candidate


def manifest_candidates(workspace: Path, brand: str, stage: str, fmt: str, role: str) -> list[Path]:
    out: list[Path] = []
    manifest_names = [
        f"{stage}_{brand}_wide_research_manifest.json",
        f"{stage}_{brand}_monitoring_data_execution_manifest.json",
        f"{stage}_{brand}_citation_analysis_import_manifest.json",
        f"{stage}_{brand}_input_resolution_manifest.json",
    ]
    for name in manifest_names:
        for manifest in (workspace / "_execution").glob(name):
            try:
                data = json.loads(read_text(manifest))
            except Exception:
                continue
            files = data.get("generated_files") or []
            if not isinstance(files, list):
                continue
            for item in files:
                path = resolve_file(workspace, str(item))
                if path.suffix.lower().lstrip(".") == fmt.lower() or fmt in {"html", "pdf", "txt"}:
                    out.append(path)
    return out


def glob_candidates(workspace: Path, patterns: list[str], fmt: str) -> list[Path]:
    out: list[Path] = []
    for pat in patterns:
        pat = pat.replace("**/", "")
        for p in workspace.rglob(pat):
            if p.is_file() and p.suffix.lower().lstrip(".") == fmt.lower():
                out.append(p)
    return out


def score_candidate(path: Path, canonical_name: str, role: str, fmt: str) -> int:
    score = 0
    name = path.name.lower()
    canonical_lower = canonical_name.lower()
    if path.name == canonical_name:
        score += 10000
    for token in re.split(r"[_\-.\s]+", canonical_lower):
        if token and token in name:
            score += 20
    for token in re.split(r"[_\-.\s]+", role.lower()):
        if token and token in name:
            score += 10
    if any(bad in name for bad in ["raw", "manifest", "check", "检查", "复核", "template", "schema"]):
        score -= 200
    try:
        if fmt == "json":
            ok, _, metric = validate_candidate(path, fmt)
            score += metric if ok else -500
        elif fmt == "md":
            score += min(substantive_chars(path), 5000) // 10
        else:
            score += min(path.stat().st_size, 2_000_000) // 1000
    except Exception:
        score -= 500
    return score


def normalize_outputs(brand: str, workspace: Path, stages: set[str] | None, check_only: bool) -> tuple[dict[str, Any], int]:
    reg = load_registry()
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    copied = 0
    ok_count = 0
    workspace.mkdir(parents=True, exist_ok=True)
    for spec in reg.get("outputs", []):
        stage = str(spec.get("stage"))
        if stages and stage not in stages:
            continue
        required = bool(spec.get("required"))
        canonical_rel = format_path(str(spec.get("canonical")), brand)
        canonical = workspace / canonical_rel
        fmt = str(spec.get("format") or canonical.suffix.lower().lstrip("."))
        aliases = [format_path(str(x), brand) for x in spec.get("aliases") or []]
        record: dict[str, Any] = {
            "stage": stage,
            "role": spec.get("role"),
            "required": required,
            "canonical": str(canonical),
            "status": "missing",
            "source": None,
            "message": "",
        }
        ok, reason, metric = validate_candidate(canonical, fmt)
        if ok:
            record.update({"status":"ok", "source":str(canonical), "metric":metric})
            ok_count += 1
            records.append(record)
            continue
        candidates: list[Path] = []
        candidates.extend(manifest_candidates(workspace, brand, stage, fmt, str(spec.get("role") or "")))
        candidates.extend(glob_candidates(workspace, aliases, fmt))
        # exact canonical anywhere else under workspace
        candidates.extend([p for p in workspace.rglob(Path(canonical_rel).name) if p.is_file()])
        # de-duplicate and drop canonical itself
        uniq: dict[str, Path] = {}
        for p in candidates:
            try:
                rp = str(p.resolve())
            except Exception:
                rp = str(p)
            if rp == str(canonical.resolve()):
                continue
            uniq[rp] = p
        valid: list[tuple[int, Path, int]] = []
        rejected: list[str] = []
        for p in uniq.values():
            ok2, reason2, metric2 = validate_candidate(p, fmt)
            if ok2:
                valid.append((score_candidate(p, canonical.name, str(spec.get("role") or ""), fmt), p, metric2))
            else:
                rejected.append(f"{p.name}:{reason2}")
        if valid:
            valid.sort(key=lambda x: x[0], reverse=True)
            _, best, metric = valid[0]
            if not check_only:
                canonical.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(best, canonical)
                copied += 1
                record.update({"status":"copied_from_alias", "source":str(best), "metric":metric, "message":"已复制为标准文件名"})
            else:
                record.update({"status":"alias_available", "source":str(best), "metric":metric, "message":"检查模式：发现可规范化别名"})
            ok_count += 1
        else:
            record.update({"status":"missing", "message":"未找到可验证的标准文件或别名", "rejected":rejected[:8]})
            if required:
                errors.append(f"{stage} 缺失标准产物：{canonical_rel}")
        records.append(record)
    payload = {
        "brand": brand,
        "workspace": str(workspace),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "stages_filter": sorted(stages) if stages else "all",
        "check_only": check_only,
        "passed": not errors,
        "ok_or_normalized": ok_count,
        "copied": copied,
        "errors": errors,
        "records": records,
    }
    return payload, 0 if not errors else 2


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# {payload['brand']} 标准产物文件名规范化报告",
        "",
        f"> 结果：{'通过' if payload['passed'] else '未通过'}  ",
        f"> 已复制规范化：{payload['copied']} 个  ",
        f"> 时间：{payload['checked_at']}",
        "",
        "| 阶段 | 角色 | 标准文件 | 状态 | 来源 |",
        "|---|---|---|---|---|",
    ]
    for rec in payload["records"]:
        src = rec.get("source") or "—"
        lines.append(f"| {rec.get('stage')} | {rec.get('role')} | `{Path(str(rec.get('canonical'))).name}` | {rec.get('status')} | `{src}` |")
    if payload.get("errors"):
        lines += ["", "## 阻断问题", ""]
        lines.extend(f"- {err}" for err in payload["errors"])
    lines += ["", "## 使用规则", "", "- 如果状态为 copied_from_alias，说明已有等价阶段文件已复制为标准文件名，不代表重新写了内容。", "- 如果缺失，必须回到对应 S 阶段补做 Wide Research，或重新导入 S5.0 要求的 AI 问答监控表与信源表（引用分析表）；不得手写浅层文件充数。"]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize FrontMind stage output filenames to canonical contract.")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--stages", default="", help="Comma-separated stage IDs, e.g. S1,S2,S3,S4 or S1,S2,S3,S4,S5,S5.5,S6,S7,S8,S9,S9.8")
    parser.add_argument("--output-json", default=None)
    parser.add_argument("--output-md", default=None)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    stages = {s.strip() for s in args.stages.split(",") if s.strip()} or None
    workspace = Path(args.workspace)
    payload, code = normalize_outputs(args.brand, workspace, stages, args.check_only)
    out_json = Path(args.output_json) if args.output_json else workspace / "_execution" / f"S0_{args.brand}_output_contract_normalization.json"
    out_md = Path(args.output_md) if args.output_md else workspace / "_execution" / f"S0_{args.brand}_output_contract_normalization.md"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    out_md.write_text(render_markdown(payload), encoding="utf-8")
    print(f"output contract normalization: {'PASS' if payload['passed'] else 'FAIL'}")
    print(f"json: {out_json}")
    print(f"md: {out_md}")
    if payload.get("errors"):
        for err in payload["errors"]:
            print("  - " + err)
    return code if args.strict else 0


if __name__ == "__main__":
    raise SystemExit(main())
