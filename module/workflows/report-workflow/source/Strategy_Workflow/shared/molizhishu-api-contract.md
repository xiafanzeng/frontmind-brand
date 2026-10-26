# S5.0 墨力指数 API 自动取数契约（本工作流 一键版）

目标：除"暂停点 1 确认固定双问题"外，全程无需用户上传任何文件——监控与信源数据由
墨力指数 business-api 自动采集、自动转成契约格式、自动导入并自动确认，随后连跑
S5→S11 出 PDF，再由 S12 出 GEO 汇报 PPT。

## 1. 配置

Workflow 根目录 `molizhishu_api.json`（已预置可用 Key，可自行更换）：

```json
{
  "api_origin": "https://business-api.molizhishu.com",
  "api_key": "<Bearer Token>",
  "platforms": ["doubao", "yuanbao", "qianwen"],
  "runs_per_question": 5,
  "mode": "search",
  "screenshot": 0,
  "poll_interval_seconds": 20,
  "poll_timeout_minutes": 45,
  "monitor_keyword_aliases": [],
  "competitors": []
}
```

- **监测平台必须由用户在暂停点 1 显式选择，禁止替用户默认**：确认脚本在选择 `molizhishu_api` 来源时**必须**同时传入 `--platforms <逗号分隔编码>`，缺失即报错终止。推荐向用户展示的选项组：国内三平台 豆包(doubao)·元宝(yuanbao)·千问(qianwen) ／ 国内扩展（deepseek/kimi/baiduai/quark/douyinai/xiaohongshu 等）／ 海外三平台 ChatGPT(chatgpt)·Google AI(googleai)·必应 AI(bingai_overviews) ／ 全量六平台（国内三+海外三）。海外平台已实测可免 region 直连提交；如个别任务报区域错误，在配置加 `region_code`（美国138/日本169/香港223/新加坡224）。编码以 `GET /api/business/system/models` 实时为准，`--list-platforms` 打印目录：

| 国内（web） | 编码 | | 海外 | 编码 |
| --- | --- | --- | --- | --- |
| 豆包 | doubao | | ChatGPT | chatgpt |
| 元宝 | yuanbao | | Google AI | googleai |
| 千问 | qianwen | | 必应 AI OverViews | bingai_overviews |
| DeepSeek | deepseek | | | |
| Kimi | kimi | | 另有移动端：doubao_mobile / yuanbao_mobile / qianwen_mobile / deepseek_mobile / xiaohongshu_mobile / douyin_mobile / baidu_mobile | |
| 百度文心 | baiduai | | | |
| 夸克 | quark | | | |
| 抖音AI | douyinai | | | |
| 微博智搜 | weibo_zhisou | | | |
| 小红书 | xiaohongshu | | | |
| 蚂蚁阿福 | antafu | | | |

- 覆盖方式（优先级从高到低，一般无需使用）：`fetch_molizhishu_monitoring.py --platforms ...` > 确认脚本 `--platforms` 写入的 `S4.8 meta.monitoring_platforms` > `molizhishu_api.json` 的 `platforms`（默认上述六平台）。无效编码会在提交前被实时目录拦截。
- 海外平台（chatgpt/googleai/bingai_overviews）如报区域错误，在 `molizhishu_api.json` 配 `region_code`（`GET /api/business/eip-edge/regions/overseas` 查询）。
- `runs_per_question` 默认 5，与监控表契约"每平台每问题 5 答案块"对齐。

## 2. 执行命令（暂停点 1 确认后）

确认脚本需带 API 来源：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/confirm_fixed_monitoring_questions.py \
  --in-json "outputs/{brand}/S4.8_{brand}_fixed_monitoring_questions.json" \
  --confirmed-by "用户" \
  --confirmation-text "确认以上两类 AI 监控问题，通过墨力指数API自动取数，监测平台选择：<用户点名的平台范围>" \
  --monitoring-data-source molizhishu_api \
  --platforms "doubao,yuanbao,qianwen"
```

自动取数（提交→轮询→取结果→生成两份契约 xlsx→自动调用两个导入器；`--platforms` 与确认记录一致）：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/fetch_molizhishu_monitoring.py \
  --brand "{brand_id}" --brand-name "{brand_name}" \
  --questions-json "outputs/{brand}/S4.8_{brand}_fixed_monitoring_questions.json" \
  --output-dir "outputs/{brand}/02_monitoring_data" \
  --platforms "doubao,yuanbao,qianwen"
```

产物：
- `02_monitoring_data/molizhishu_raw/S5_{brand}_molizhishu_监控表.xlsx`（契约宽表：每平台一 Sheet + 5 答案块）
- `02_monitoring_data/molizhishu_raw/S5_{brand}_molizhishu_信源表.xlsx`（媒体统计/内容统计/详细表格 三层，构造即对账）
- `02_monitoring_data/molizhishu_raw/S5_{brand}_molizhishu_raw.json`（原始答案与引用留档）
- `_execution/S5.0_{brand}_molizhishu_fetch_manifest.json`（`data_origin=molizhishu_api`、`simulated=false`、taskId 清单）

导入器以 `--data-source molizhishu_api` 运行，全部下游 manifest/JSON 标记该来源；
`stage_execution_checker` 与 `final_delivery_packer` 自 v3 起仅接受
`molizhishu_api` 两种合法来源，`simulated=false` 红线不变。

## 3. API 要点（源自 frontmind-system monitoring-provider-moli 实测）

- 认证：`Authorization: Bearer <api_key>`；信封 `{success, code, message, data}`。
- 提交：`POST /api/business/monitor/task/batch/shared`，body 含 `prompts[]`、
  `platforms[]({platform,mode,screenshot})`、`monitorKeywords`、`competitors`、`consumerTaskId`（幂等键，8-64 位字母数字）。
- 轮询：`GET /api/business/monitor/task/status/{taskId}` → `status=completed`。
- 结果：`GET /api/business/monitor/task/result/{taskId}` → `subTaskList[]`，每项含
  `answerContent`、`rank`/`mentionPosition`、`sentiment`、`shareUrl`、`searchKeywords`、
  `citationList[]({title,url,site})`。`site` 为媒体名，域名从 URL 提取。
- 余额：`GET /api/reconciliation/balance`。

## 4. 失败与回退

- 任何 API 失败（提交/超时/部分失败）都**保留真实错误并停止**，不模拟、不补造；
- ~~回退路径~~：路径B手动上传已于 v3 移除；API 失败时保留真实错误并停止，不得改用手工上传或补造数据。
- 部分子任务失败时：重跑取数脚本（consumerTaskId 幂等）或改用 `runs_per_question` 降配后重试；不接受用 Wide Research 或手写数据替代。
