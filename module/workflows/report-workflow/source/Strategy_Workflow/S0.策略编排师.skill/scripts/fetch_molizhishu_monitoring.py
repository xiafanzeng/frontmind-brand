#!/usr/bin/env python3
"""FrontMind S5.0 墨力指数 API 自动取数（本工作流 一键版）.

在暂停点 1（S4.8 固定双问题）获得用户确认后，自动完成：
1. 按 配置(molizhishu_api.json) 调用 墨力指数 business-api 提交监控任务：
   固定双问题 × N 平台 × 每问 R 次重复提问（默认 5）。
2. 轮询任务直至完成，拉取每条回答（answerContent / 排名 / citationList）。
3. 生成两份契约格式 .xlsx：
   - AI 问答监控表（每平台一 Sheet，A:D + 5 答案块）
   - 信源表（引用分析表：媒体统计 / 内容统计 / 详细表格 三层，天然对账）
4. 自动调用既有 import_monitoring_spreadsheet.py 与
   import_citation_analysis_spreadsheet.py 完成导入与自动确认，来源标记为
   molizhishu_api（真实 API 数据，simulated=false）。
5. 写入 S5.0 API 取数 manifest 供检查器与打包器核验。

用法：
  python3 fetch_molizhishu_monitoring.py \
    --brand "{brand_id}" --brand-name "{brand_name}" \
    --questions-json "outputs/{brand}/S4.8_{brand}_fixed_monitoring_questions.json" \
    --output-dir "outputs/{brand}/02_monitoring_data" \
    [--config molizhishu_api.json] [--no-auto-import]

安全红线：不模拟、不补造任何回答或引用；API 失败即失败并停止。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_ORIGIN = "https://business-api.molizhishu.com"
SUBMIT_PATH = "/api/business/monitor/task/batch/shared"
STATUS_PATH = "/api/business/monitor/task/status/{task_id}"
RESULT_PATH = "/api/business/monitor/task/result/{task_id}"
MODELS_PATH = "/api/business/system/models"

OVERSEAS_MODELS = {"chatgpt", "googleai", "bingai_overviews"}

# API modelCode -> 监控表 Sheet 名（importer 别名表可识别）
SHEET_NAME = {
    "doubao": "豆包",
    "yuanbao": "元宝",
    "baiduai": "百度文心",
    "wenxin": "百度文心",
    "qianwen": "通义千问",
    "deepseek": "DeepSeek",
    "kimi": "Kimi",
    "chatgpt": "ChatGPT",
    "googleai": "GoogleAI",
    "bingai_overviews": "必应AI",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def consumer_task_id(seed: str) -> str:
    return ("fm" + hashlib.sha256(seed.encode("utf-8")).hexdigest())[:64]


_RETRY_DELAYS = (3, 8, 15, 30)


def api_request(origin: str, token: str, method: str, path: str,
                body: dict[str, Any] | None = None, timeout: int = 30,
                _retries: int | None = None) -> Any:
    attempts = len(_RETRY_DELAYS) + 1 if _retries is None else _retries
    for attempt in range(1, attempts + 1):
        try:
            return _api_request_once(origin, token, method, path, body, timeout)
        except RuntimeError as exc:
            transient = "请求失败" in str(exc) or "timed out" in str(exc).lower()
            if not transient or attempt == attempts:
                raise
            delay = _RETRY_DELAYS[min(attempt - 1, len(_RETRY_DELAYS) - 1)]
            print(f"[RETRY] {path} 第{attempt}次失败（{str(exc)[:80]}），{delay}s 后重试")
            time.sleep(delay)
    raise RuntimeError("unreachable")


def _api_request_once(origin: str, token: str, method: str, path: str,
                      body: dict[str, Any] | None, timeout: int) -> Any:
    url = f"{origin}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "frontmind-workflow-s50/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        raise RuntimeError(f"墨力指数 API HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"墨力指数 API 请求失败: {exc}") from exc
    code = payload.get("code")
    ok_codes = (0, 200, "0", "200", "SUCCESS", "success")
    if payload.get("success") is False or (code is not None and code not in ok_codes):
        raise RuntimeError(f"墨力指数 API 拒绝请求: {payload.get('message') or payload}")
    return payload.get("data", payload)


def load_config(path: Path | None, brand: str) -> dict[str, Any]:
    candidates = [path] if path else [
        Path("molizhishu_api.json"),
        Path(f"outputs/{brand}/00_project_input/molizhishu_api.json"),
    ]
    for cand in candidates:
        if cand and cand.exists():
            cfg = json.loads(cand.read_text(encoding="utf-8"))
            cfg.setdefault("api_origin", DEFAULT_ORIGIN)
            cfg.setdefault("platforms", ["doubao", "yuanbao", "qianwen", "chatgpt", "googleai", "bingai_overviews"])
            cfg.setdefault("runs_per_question", 5)
            cfg.setdefault("mode", "search")
            cfg.setdefault("screenshot", 0)
            cfg.setdefault("poll_interval_seconds", 20)
            cfg.setdefault("poll_timeout_minutes", 45)
            return cfg
    raise RuntimeError(
        "未找到 molizhishu_api.json。请在 Workflow 根目录放置配置"
        "（api_key/platforms/runs_per_question），或回退到手动上传双表模式。")


def submit_question_run(origin: str, token: str, cfg: dict[str, Any],
                        brand: str, question: str, run: int) -> dict[str, Any]:
    platforms = [{"platform": p, "mode": cfg["mode"], "screenshot": int(cfg["screenshot"])}
                 for p in cfg["platforms"]]
    body: dict[str, Any] = {
        "monitorKeywords": cfg.get("monitor_keyword") or brand,  # 配置留空时以品牌名兜底
        "monitorKeywordAliases": list(cfg.get("monitor_keyword_aliases") or [])[:50],
        "competitors": [
            {"name": c["name"], "aliases": list(c.get("aliases") or [])}
            for c in (cfg.get("competitors") or [])[:50]
        ],
        "prompts": [question],
        "platforms": platforms,
        "consumerTaskId": consumer_task_id(f"{brand}|{question}|run{run}"),
    }
    region = str(cfg.get("region_code") or "").strip()
    if region:
        body["regionCode"] = [region]
    data = api_request(origin, token, "POST", SUBMIT_PATH, body)
    task_id = data.get("taskId") or data.get("id") or data.get("monitorTaskId")
    if not task_id:
        raise RuntimeError(f"提交响应缺少 taskId: {json.dumps(data, ensure_ascii=False)[:300]}")
    return {"taskId": str(task_id), "question": question, "run": run,
            "consumerTaskId": body["consumerTaskId"], "submit_raw": data}


def wait_task(origin: str, token: str, task_id: str, cfg: dict[str, Any]) -> str:
    deadline = time.time() + int(cfg["poll_timeout_minutes"]) * 60
    interval = int(cfg["poll_interval_seconds"])
    while time.time() < deadline:
        data = api_request(origin, token, "GET", STATUS_PATH.format(task_id=task_id))
        status = str(data.get("status") or "").lower()
        if status in ("completed", "success", "done", "failed", "error", "stopped"):
            return "completed" if status != "failed" and status != "error" else status
        time.sleep(interval)
    raise RuntimeError(f"任务 {task_id} 超过 {cfg['poll_timeout_minutes']} 分钟未完成")


def fetch_result(origin: str, token: str, task_id: str) -> list[dict[str, Any]]:
    data = api_request(origin, token, "GET", RESULT_PATH.format(task_id=task_id))
    for key in ("subTaskList", "results", "resultList", "subTasks", "list", "records", "items"):
        if isinstance(data, dict) and isinstance(data.get(key), list):
            return data[key]
    return [data] if isinstance(data, dict) else []


def collect_answers(items: list[dict[str, Any]], question: str, run: int,
                    answers: list[dict[str, Any]]) -> None:
    for it in items:
        if not isinstance(it, dict):
            continue
        answers.append({
            "question": str(it.get("prompt") or question),
            "intended_question": question,
            "run": run,
            "platform": str(it.get("platform") or ""),
            "subTaskId": str(it.get("subTaskId") or ""),
            "status": str(it.get("status") or ""),
            "answerContent": str(it.get("answerContent") or ""),
            "rank": it.get("rank") or it.get("mentionPosition"),
            "mentionPosition": it.get("mentionPosition"),
            "sentiment": it.get("sentiment"),
            "shareUrl": it.get("shareUrl") or "",
            "searchKeywords": it.get("searchKeywords") or [],
            "citations": it.get("citationList") or [],
            "time": str(it.get("time") or datetime.now().strftime("%Y-%m-%d")),
            "errorMessage": it.get("errorMessage") or "",
        })


def build_monitor_workbook(brand: str, answers: list[dict[str, Any]],
                           runs: int, out_path: Path) -> None:
    import openpyxl
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    platforms = sorted({a["platform"] for a in answers})
    for plat in platforms:
        sheet_name = SHEET_NAME.get(plat, plat)
        sh = wb.create_sheet(sheet_name)
        sh.append(["品牌名称", "问题核心词", "问题", "日期"]
                  + sum([[f"第{i}次", "", "", ""] for i in range(1, runs + 1)], []))
        sh.append(["", "", "", ""] + ["内容", "截图链接", "排名", "监控词排名"] * runs)
        questions = sorted({a["intended_question"] for a in answers if a["platform"] == plat})
        for q in questions:
            cells = [brand, brand, q, datetime.now().strftime("%Y-%m-%d")]
            for run in range(1, runs + 1):
                match = next((a for a in answers
                              if a["platform"] == plat and a["intended_question"] == q
                              and a["run"] == run), None)
                if match:
                    rank = match["rank"]
                    rank_text = "-" if rank is None else str(rank)
                    cells += [match["answerContent"], match["shareUrl"] or "", rank_text, "-"]
                else:
                    cells += ["", "", "-", "-"]
            sh.append(cells)
    wb.save(out_path)


def _domain_of(url: str) -> str:
    netloc = (url or "").split("//")[-1].split("/")[0].lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def build_citation_workbook(answers: list[dict[str, Any]], out_path: Path,
                             platform_display: dict[str, str]) -> dict[str, int]:
    import openpyxl
    from collections import Counter, defaultdict
    media_counter: Counter[tuple[str, str]] = Counter()
    content_counter: Counter[tuple[str, str, str, str]] = Counter()
    detail_rows: list[dict[str, str]] = []
    for a in answers:
        for c in a["citations"]:
            if not isinstance(c, dict):
                continue
            url = str(c.get("url") or c.get("link") or "")
            title = str(c.get("title") or c.get("name") or url)[:120]
            media = str(c.get("site") or c.get("mediaName") or c.get("media") or c.get("sourceName") or "未命名信源")
            domain = str(c.get("domain") or c.get("mediaUrl") or _domain_of(url) or "unknown")
            row = {
                "引用日期": a["time"][:10],
                "模型": platform_display.get(a["platform"], a["platform"]),
                "监控问题": a["intended_question"],
                "内容标题": title,
                "内容链接": url,
                "媒体名称": media,
                "媒体url": domain,
            }
            detail_rows.append(row)
            media_counter[(domain, media)] += 1
            content_counter[(title, url, media, domain)] += 1
    total = len(detail_rows)
    wb = openpyxl.Workbook()

    ws = wb.active
    ws.title = "媒体统计"
    ws.append(["引用排行", "媒体名称", "媒体url", "引用日期", "引用次数", "引用占比"])
    for i, ((domain, media), n) in enumerate(sorted(media_counter.items(), key=lambda kv: -kv[1]), 1):
        ws.append([float(i), media, domain,
                   datetime.now().strftime("%Y-%m-%d"), float(n), round(n / total, 4)])

    ws2 = wb.create_sheet("内容统计")
    ws2.append(["引用排行", "内容状态", "内容标题", "内容链接", "媒体名称", "媒体url",
                "引用日期", "引用次数", "引用占比"])
    for i, ((title, url, media, domain), n) in enumerate(sorted(content_counter.items(), key=lambda kv: -kv[1]), 1):
        ws2.append([float(i), "未监控", title, url, media, domain,
                    datetime.now().strftime("%Y-%m-%d"), float(n), round(n / total, 4)])

    ws3 = wb.create_sheet("详细表格")
    ws3.append(["引用日期", "模型", "监控问题", "内容标题", "内容链接", "媒体名称", "媒体url"])
    for r in detail_rows:
        ws3.append([r["引用日期"], r["模型"], r["监控问题"], r["内容标题"],
                    r["内容链接"], r["媒体名称"], r["媒体url"]])
    wb.save(out_path)
    return {"media_rows": len(media_counter), "content_rows": len(content_counter), "detail_rows": total}


def main() -> int:
    ap = argparse.ArgumentParser(description="FrontMind S5.0 墨力指数 API 自动取数")
    ap.add_argument("--brand", required=True)
    ap.add_argument("--brand-name", required=True)
    ap.add_argument("--questions-json", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--platforms", default=None,
                    help="监测平台编码，逗号分隔（覆盖配置/确认记录）。可用 --list-platforms 查看")
    ap.add_argument("--list-platforms", action="store_true",
                    help="仅列出 API 平台目录（国内/海外）后退出")
    ap.add_argument("--no-auto-import", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config, args.brand)
    token = cfg.get("api_key") or ""
    origin = cfg["api_origin"]
    if not token:
        raise RuntimeError("molizhishu_api.json 缺少 api_key")

    if args.list_platforms:
        models = api_request(origin, token, "GET", MODELS_PATH)
        catalog = models if isinstance(models, list) else []
        domestic = [m for m in catalog if str(m.get("modelCode")) not in OVERSEAS_MODELS and m.get("clientType") == "web"]
        overseas = [m for m in catalog if str(m.get("modelCode")) in OVERSEAS_MODELS]
        print("== 国内平台（web）==")
        for m in domestic:
            print(f"  {m.get('modelCode'):18s} {m.get('modelName')}")
        print("== 海外平台 ==")
        for m in overseas:
            print(f"  {m.get('modelCode'):18s} {m.get('modelName')}")
        print("== 移动端 ==")
        for m in catalog:
            if m.get("clientType") == "mobile":
                print(f"  {m.get('modelCode'):22s} {m.get('modelName')}")
        return 0

    # 平台优先级：CLI --platforms > S4.8 确认记录 meta.monitoring_platforms > config > 默认
    chosen = None
    if args.platforms:
        chosen = [x.strip() for x in args.platforms.split(",") if x.strip()]
    else:
        qdoc = json.loads(Path(args.questions_json).read_text(encoding="utf-8"))
        chosen = (qdoc.get("meta") or {}).get("monitoring_platforms")
    if chosen:
        cfg["platforms"] = chosen
        print(f"[PLATFORMS] 本次监测平台: {cfg['platforms']}")
    # 实时校验平台编码
    models = api_request(origin, token, "GET", MODELS_PATH)
    valid = {str(m.get("modelCode")) for m in (models if isinstance(models, list) else [])}
    unknown = [p for p in cfg["platforms"] if p not in valid]
    if unknown:
        raise RuntimeError(f"无效平台编码 {unknown}；可用编码: {sorted(valid)}（或运行 --list-platforms 查看）")
    overseas_picked = [p for p in cfg["platforms"] if p in OVERSEAS_MODELS]
    if overseas_picked and not str(cfg.get("region_code") or "").strip():
        print(f"[NOTE] 已选海外平台 {overseas_picked}：如提交报区域错误，请在 molizhishu_api.json 配置 region_code"
              f"（可用 /api/business/eip-edge/regions/overseas 查询可用区域）")

    questions_doc = json.loads(Path(args.questions_json).read_text(encoding="utf-8"))
    meta = questions_doc.get("meta") or {}
    confirmed = meta.get("confirmation_status") == "confirmed" \
        or meta.get("user_confirmation_present") is True
    if confirmed is not True:
        print("S4.8 固定双问题尚未获得用户确认，禁止自动取数。", file=sys.stderr)
        return 2
    questions = [q["question_text"] for q in questions_doc.get("questions", [])]
    if len(questions) != 2:
        print(f"期望固定双问题，实际 {len(questions)} 条", file=sys.stderr)
        return 2

    runs = int(cfg["runs_per_question"])
    out_dir = Path(args.output_dir)
    raw_dir = out_dir / "molizhishu_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    raw_dir = out_dir / "molizhishu_raw"
    state_path = raw_dir / f"S5_{args.brand}_fetch_state.json"
    tasks: list[dict[str, Any]] = []
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        tasks = state.get("tasks") or []
        print(f"[RESUME] 复用已提交任务 {len(tasks)} 个（consumerTaskId 幂等）")
    if not tasks:
        for q in questions:
            for run in range(1, runs + 1):
                t = submit_question_run(origin, token, cfg, args.brand, q, run)
                tasks.append(t)
                print(f"[SUBMIT] {q[:18]}… run{run} → taskId={t['taskId']}")
        raw_dir.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({"submitted_at": now_iso(),
                                          "tasks": [{"taskId": x["taskId"], "question": x["question"],
                                                     "run": x["run"], "consumerTaskId": x["consumerTaskId"]}
                                                    for x in tasks]}, ensure_ascii=False, indent=1),
                              encoding="utf-8")

    answers: list[dict[str, Any]] = []
    for t in tasks:
        final = wait_task(origin, token, t["taskId"], cfg)
        if final != "completed":
            print(f"[WARN] 任务 {t['taskId']} 终态={final}，保留真实失败状态", file=sys.stderr)
        items = fetch_result(origin, token, t["taskId"])
        collect_answers(items, t["question"], t["run"], answers)
        print(f"[RESULT] taskId={t['taskId']} items={len(items)}")

    raw_path = raw_dir / f"S5_{args.brand}_molizhishu_raw.json"
    raw_path.write_text(json.dumps({"fetched_at": now_iso(), "tasks": tasks, "answers": answers},
                                   ensure_ascii=False, indent=1), encoding="utf-8")

    platform_display = {"doubao": "豆包-网页版", "yuanbao": "元宝-网页版", "baiduai": "百度文心-网页版",
                        "wenxin": "百度文心-网页版", "qianwen": "通义千问-网页版",
                        "deepseek": "DeepSeek-网页版", "kimi": "Kimi-网页版", "chatgpt": "ChatGPT-网页版",
                        "googleai": "GoogleAI-网页版", "bingai_overviews": "必应AI-网页版"}
    monitor_xlsx = raw_dir / f"S5_{args.brand}_molizhishu_监控表.xlsx"
    citation_xlsx = raw_dir / f"S5_{args.brand}_molizhishu_信源表.xlsx"
    build_monitor_workbook(args.brand_name, answers, runs, monitor_xlsx)
    cite_stats = build_citation_workbook(answers, citation_xlsx, platform_display)

    manifest = {
        "stage_id": "S5.0",
        "stage_name": "墨力指数API自动取数",
        "brand": args.brand,
        "brand_name": args.brand_name,
        "data_origin": "molizhishu_api",
        "monitoring_data_source": "molizhishu_api",
        "simulated": False,
        "status": "done",
        "fetched_at": now_iso(),
        "api_origin": origin,
        "tasks": [{"taskId": t["taskId"], "question": t["question"], "run": t["run"]} for t in tasks],
        "answers_count": len(answers),
        "citation_stats": cite_stats,
        "generated_files": [str(monitor_xlsx), str(citation_xlsx), str(raw_path)],
        "script": "Strategy_Workflow/S0.策略编排师.skill/scripts/fetch_molizhishu_monitoring.py",
    }
    exec_dir = out_dir.parent / "_execution"
    exec_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = exec_dir / f"S5.0_{args.brand}_molizhishu_fetch_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[OK] 取数完成：answers={len(answers)} 引用三层={cite_stats}")
    print(f"[OK] manifest: {manifest_path}")

    if not args.no_auto_import:
        import subprocess
        base = Path(__file__).resolve().parents[3]
        q_json = str(Path(args.questions_json).resolve())
        out_abs = str(out_dir.resolve())
        monitor_abs = str(monitor_xlsx.resolve())
        citation_abs = str(citation_xlsx.resolve())
        main_product = (questions_doc.get("meta") or {}).get("main_product", "")
        cmds = [
            [sys.executable, str(base / "Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_monitoring_spreadsheet.py"),
             "--company-name", args.brand_name, "--brand-name", args.brand_name,
             "--main-product", main_product, "--questions-json", q_json,
             "--spreadsheet", monitor_abs, "--output-dir", out_abs,
             "--data-source", "molizhishu_api"],
            [sys.executable, str(base / "Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_citation_analysis_spreadsheet.py"),
             "--brand", args.brand, "--brand-name", args.brand_name,
             "--spreadsheet", citation_abs, "--output-dir", out_abs,
             "--data-source", "molizhishu_api"],
        ]
        for cmd in cmds:
            print("[IMPORT]", " ".join(cmd[-6:]))
            proc = subprocess.run(cmd, capture_output=True, text=True)
            print(proc.stdout[-1500:] or proc.stderr[-1500:])
            if proc.returncode != 0:
                print("导入失败，保留真实错误并停止。", file=sys.stderr)
                return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
