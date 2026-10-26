# S5.0 用户上传监控数据表格契约

用户在暂停点 1 确认固定双问题并上传表格后，必须使用本契约把真实 AI 问答监控表转成下游标准 S5.0 产物，不得改写答案或补造记录。本工作流不再生成《问题监控数据文件》客户版产物，也不设数据确认暂停点：导入并通过校验即自动确认，随后直接连跑 S5-S11。

本契约只描述第一份表格。还必须按 `uploaded-citation-analysis-spreadsheet-contract.md` 接收并导入第二份信源表（引用分析表）；两份文件均须为 `.xlsx`，缺一不可。

**API 自动取数路径（本工作流 一键版）**：`fetch_molizhishu_monitoring.py` 会从墨力指数 API 采集真实数据并生成符合本契约的两份 xlsx（监控表 Sheet 名用平台显示名如 豆包/元宝/百度文心），随后以 `--data-source molizhishu_api` 调用本契约的导入器。此时"上传"语义由 API 落盘文件替代，`simulated=false` 与全部质量门不变。详见 `../../shared/molizhishu-api-contract.md`。

## 1. 适用场景

用户必须在暂停点 1 后明确确认：

```text
确认以上两类 AI 监控问题，按默认国内三平台（豆包、元宝、千问）执行
```

收到 `.xlsx` 后，运行：

```bash
python3 Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_monitoring_spreadsheet.py \
  --company-name "{company_name}" \
  --brand-name "{brand_name}" \
  --main-product "{main_product}" \
  --questions-json "outputs/{brand_id}/.../S4.8_{brand_id}_fixed_monitoring_questions.json" \
  --spreadsheet "{uploaded_xlsx_path}" \
  --output-dir "outputs/{brand_id}/02_monitoring_data"
```

AI 问答监控表导入通过后，还必须运行 `import_citation_analysis_spreadsheet.py`。两份表格均导入并通过校验后自动确认（`data_confirmation_status=confirmed`），直接进入 S5 及后续阶段；本工作流没有数据确认暂停点。

## 2. 表格结构

参考用户上传的表格：

- 每个 AI 平台一个 sheet；平台不设固定白名单，可使用 `DeepSeek`、`百度文心`、`腾讯元宝`、`豆包` 等名称，也支持其他非空平台名称。
- 第 1–2 行为表头。
- A:D 固定为：`品牌名称`、`问题核心词`、`问题`、`日期`。
- 从 E 列开始，每 4 列为一个答案块：`内容`、`截图链接`、`排名`、`监控词排名`。
- 固定 5 个答案块，即每个平台每个问题 5 次；总样本按 2 个问题 × 实际平台数 × 5 次动态计算。
- 每行对应一个监控问题；问题必须与 S4.8 暂停点 1 已确认的固定双问题一致。允许“品牌推荐/推荐”等极小措辞差异，但不得只按问题类型强行匹配不同产品或不同问题。

## 3. 输出不变原则

AI 问答监控表导入必须生成以下标准核心产物（本工作流已移除《问题监控数据文件》客户版 HTML/PDF/MD/TXT 与确认单）：

```text
S5_{brand}_frontmind_monitoring_data.json
S5_{brand}_frontmind_monitoring_raw.json
_execution/S5.0_{brand}_monitoring_data_execution_manifest.json
```

## 4. 字段映射

| 表格字段 | Canonical JSON 字段 |
|---|---|
| sheet 名 | `record.platform` / `record.platform_display_name` |
| 问题 | `record.question_text`，匹配 `questions[].question_text` |
| 内容 | `record.answerContent` |
| 日期 | `record.time` |
| 排名 / 监控词排名 | `record.rank` / `record.position` / `record.brand_rank` / `record.mention_rank` |
| 截图链接 | 只进 raw 内部 JSON；任何客户可见产物不展示、不下载、不索引 |

监控 JSON/raw 仅内部使用；进入 S10 的监控证据必须先清洁，禁止出现截图页、截图 URL、原始工作表行或上传表格解析细节。

## 5. 质量门

双表导入必须通过以下质量门：

- 默认必须 `expected_records == actual_records == successful_records`，预期数按 2 个问题 × 实际平台数 × 5 次动态计算。导入脚本在校验通过后自动写入 `data_confirmation_status=confirmed` 和 `partial_accepted=false`；仅当用户明确接受 partial 数据并使用 `--allow-partial-records` 时写入 `partial_accepted=true`。即使 partial 被接受，固定双问题与每平台每问题 5 个 slot 的结构仍必须保留。
- `simulated_data=false`、`mock_data=false`、`manual_records=false`。
- `data_provenance.capture_method=uploaded_spreadsheet`。
- `data_provenance.source_file` 和 `data_provenance.raw_extracted_file` 必须存在且非空。
- 本工作流不设数据确认暂停点：导入成功即自动确认并直接连跑 S5-S11；导入失败或数据不完整时默认返回真实错误并停止，请用户重新上传。
