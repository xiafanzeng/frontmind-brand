---
name: frontmind-brand-diagnostician-fixed-question-monitor
description: >
  S5 品牌诊断专家（固定双问题 + S5.0 监控数据版）。读取 S5.0 由墨力指数 API 自动取数生成的 AI 问答监控表与信源表导入的标准监控回答，
  进行 AI 可见度、推荐表现、舆情风险、信源引用、竞品占位与定位 Gap 诊断。
---

# S5 品牌诊断专家 — 固定双问题监控数据版

S5 的职责是：基于 **S4.8 固定双问题** 和 **S5.0 标准问题监控数据**，输出品牌在 AI 搜索中的真实表现、负向直问舆情风险、信源结构、竞品占位和定位 Gap。

---

## 一、上游输入

| 输入物 | 文件名 | 来源 | 必要性 |
|---|---|---|---|
| 固定双问题 | `S4.8_{brand}_fixed_monitoring_questions.json` | S4.8 | 必须 |
| 标准问题监控数据 | `S5_{brand}_frontmind_monitoring_data.json` | S5.0 AI 问答监控表导入 | 必须 |
| 原始数据汇总 | `S5_{brand}_frontmind_monitoring_raw.json` | S5.0 AI 问答监控表解析 raw | 必须 |
| 独立引用分析数据 | `S5_{brand}_引用分析数据.json` | S5.0 信源表（引用分析表）导入 | 必须 |
| 品牌事实图谱 | `S1_{brand}_品牌事实图谱.json` | S1 | 必须 |
| 定位声明 | `S4_{brand}_定位声明.json` | S4 | 必须 |

S5 **不得**使用以下内容作为题源：

```text
S2.probes
S2.representative_questions
S2.recommended_questions
S2.monitoring_questions
S2 生成的任何代表题或推荐题
```

S2 只作为用户意图和营销场景背景，不作为监控问题来源。

---

## 二、S5.0 API 自动取数导入（v3 唯一路径）

用户在暂停点 1 确认固定问题后，运行 `fetch_molizhishu_monitoring.py` 自动生成两份用途不同的 `.xlsx` 并自动导入（无需上传任何文件）：

1. AI 问答监控表；
2. 信源表（独立引用分析表）。

先导入 AI 问答监控表：

```bash
python3 Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_monitoring_spreadsheet.py \
  --company-name "{company_name}" \
  --brand-name "{brand_name}" \
  --main-product "{main_product}" \
  --questions-json "S4.8_{brand}_fixed_monitoring_questions.json" \
  --spreadsheet "{uploaded_xlsx_path}" \
  --output-dir "outputs/{brand}/02_monitoring_data"
```

表格结构必须符合 `references/uploaded-monitoring-spreadsheet-contract.md`：每个 AI 平台一个 sheet，A:D 为品牌/核心词/问题/日期，每个答案块包含“内容、截图链接、排名、监控词排名”。脚本会把表格转成标准监控 JSON 与 raw JSON（本工作流不再生成《问题监控数据文件》客户版 HTML/PDF/MD/TXT），不影响后续 S5-S11。

再导入独立引用分析表：

```bash
python3 Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_citation_analysis_spreadsheet.py \
  --brand "{brand_id}" \
  --brand-name "{brand_name}" \
  --spreadsheet "{uploaded_citation_analysis_xlsx_path}" \
  --output-dir "outputs/{brand}/02_monitoring_data"
```

信源表必须符合 `references/uploaded-citation-analysis-spreadsheet-contract.md`，包含媒体、内容、问题引用三层数据，并满足三层引用总量对账。

API 取数路径不得补造空缺答案或引用记录；若任一环节失败、sheet/问题/答案块不完整或引用三层无法对账，必须输出真实错误并停止。两个文件均导入并通过校验后自动写入 `data_confirmation_status=confirmed`（本工作流不设数据确认暂停点），随后直接进入 S5 及后续阶段，直至最终全景报告。


---

## 三、输出文件

| 输出物 | 文件名 | 格式 |
|---|---|---|
| 品牌诊断数据 | `S5_{brand}_品牌诊断数据.json` | JSON |
| 品牌诊断报告 | `S5_{brand}_品牌诊断数据.md` | Markdown |
| Gap 报告 | `S5_{brand}_Gap报告.md` | Markdown |


### 3.1 监控数据保留形式（本工作流）

本工作流已取消《问题监控数据文件》客户版产物（HTML/PDF/MD/TXT 及对应模板契约均已移除）。S5.0 导入只保留：

- `S5_{brand}_frontmind_monitoring_data.json`：完整标准监控数据（含逐条答案、引用、排名）；
- `S5_{brand}_frontmind_monitoring_raw.json`：上传表格解析 raw（截图链接只保留在此内部文件）。

逐条答案明细的诊断结论与代表性证据由 S5 诊断报告和 S10 全景报告承载；监控 JSON 仅供内部诊断、S5.5 审计与 S10 渲染使用，不作为客户交付物。

---

## 四、绝对禁止事项

1. **禁止模拟/伪造/构造监控数据**：禁止编造 AI 回答、引用来源或任务状态；禁止“模拟 AI 平台对两个固定问题的回答数据”。必须运行 `import_monitoring_spreadsheet.py` 和 `import_citation_analysis_spreadsheet.py`，分别导入用户提供的两份真实 `.xlsx`。
2. 禁止 mock/sample records 替代上传表格。
3. 禁止用 S2 题库作为监控问题来源。
4. 禁止把 Q2 品牌缺点问题计入 AI 可见度、排名、Top3/Top5、平均位次。
5. 禁止因为表格存在空缺而补假数据；必须保留失败记录和失败原因。
6. 禁止在 S5 中生成最终全景 HTML；最终报告由 S10 生成。
7. **如果任一上传表格脚本执行失败（exit code ≠ 0），必须向用户报告失败原因并请求指导，绝不得自行编造数据代替。**

---

## 五、核心诊断口径

### 5.1 问题分流

| 问题 ID | 问题类型 | 指标口径 |
|---|---|---|
| Q1_PRODUCT_RECOMMENDATION | product_recommendation | 计入 AI 可见度、推荐率、排名、竞品位次 |
| Q2_REPUTATION_ISSUE | reputation_issue | 只计入舆情风险、缺点问题、回应建议，不计入排名 |

### 5.2 样本范围

S5 必须从 `S5_{brand}_frontmind_monitoring_data.json` 读取：

```json
{
  "summary": {
    "expected_records": "2 × 实际平台数 × 5",
    "actual_records": "实际记录数",
    "successful_records": 0,
    "failed_records": 0
  },
  "records": []
}
```

默认最终交付必须使用“成功记录数/动态预期记录数”全部完整答案。若成功记录不足按 2 个问题 × 实际平台数 × 5 次计算的预期数量，默认返回真实错误并停止，请用户重新上传完整表格；仅当用户明确接受 partial 数据时，才使用 `import_monitoring_spreadsheet.py --allow-partial-records` 在导入时写入 `meta.partial_accepted=true` 后继续。报告必须说明：

```text
应完成多少条
实际完成多少条
成功多少条
失败多少条
失败平台/问题/原因
用户已接受 partial 数据的确认文本
```

若成功记录为 0，S5 不得继续诊断，应输出表格不完整说明并要求重新运行 S5.0。

---

## 六、必须输出的诊断模块

S5 报告至少包含：

1. **监控口径说明**：固定双问题、平台、重复次数、成功/失败记录。
2. **AI 推荐可见度分析**：仅基于 Q1，判断 AI 是否推荐品牌、推荐位置、竞品占位。
3. **平台表现对比**：对本次实际监控平台的回答差异、稳定性和推荐倾向进行比较。
4. **负向直问舆情分析**：仅基于 Q2，总结 AI 对品牌缺点、问题、风险、信任边界的描述。
5. **信源与引用分析**：S5 仍分别统计 AI 问答监控中的 `citationList` 与 `referenceList`，不得混为同一指标；信源表的独立引用分析不得塞进 AI 可见性章节，而应交给 S5.5，在语义资产审计下半部分展开。
6. **定位 Gap 分析**：AI 实际回答与 S4 定位的差距。
7. **竞品占位分析**：Q1 中被推荐的竞品、相对位置、推荐理由。
8. **GEO 机会与修复建议**：内容、官网、信源、话语、问答架构方向建议。

---

## 七、`S5_{brand}_品牌诊断数据.json` 推荐结构

```json
{
  "meta": {
    "brand": "品牌名",
    "company_name": "企业全称",
    "main_product": "核心产品",
    "data_source": "molizhishu_api",
    "question_policy": "fixed_two_questions"
  },
  "sample_scope": {
    "expected_records": "2 × 实际平台数 × 5",
    "actual_records": "实际记录数",
    "successful_records": "成功记录数",
    "failed_records": 0,
    "platforms": ["deepseek", "wenxin", "yuanbao", "doubao"],
    "questions": [
      {
        "question_id": "Q1_PRODUCT_RECOMMENDATION",
        "question_text": "{核心产品}推荐",
        "ranking_metric_eligible": true
      },
      {
        "question_id": "Q2_REPUTATION_ISSUE",
        "question_text": "{品牌名}有什么缺点和问题？",
        "ranking_metric_eligible": false
      }
    ]
  },
  "visibility_diagnostics": {
    "q1_only": true,
    "brand_mention_rate": 0,
    "brand_recommendation_rate": 0,
    "average_rank": null,
    "top3_rate": 0,
    "platform_breakdown": []
  },
  "reputation_issue_diagnostics": {
    "q2_only": true,
    "negative_themes": [],
    "risk_level": "low/medium/high/unknown",
    "response_recommendations": []
  },
  "citation_source_diagnostics": {
    "top_sources": [],
    "source_frequency": [],
    "source_gap_notes": []
  },
  "ranking_position_diagnostics": {
    "per_question_rank_matrix": []
  },
  "gap_analysis": [],
  "limitations": []
}
```

---

## 八、信源分析要求

必须读取每条记录中的，并保持两类来源的语义边界：

```text
referenceList（检索到的全部参考来源）
citationList（答案实际使用的引用）
answerContent 中显式提到的媒体/官网/平台
```

输出：

```text
高频信源
被 AI 引用的平台类型
官网是否被引用
第三方企业信息平台是否被引用
问答/媒体/百科/视频/行业平台是否被引用
信源缺口
```

实际信源不足时按实际数量输出，不得凑数。

---

## 九、下游关系

S5 输出供以下节点使用：

```text
S5.5：语义资产评分
S6：话语体系修复
S7：视觉方向辅助
S8：问答架构和内容路径
S9：业务赋能规划
S9.8：标题钩子生成
S10：最终全景报告
```

本版无后续内容生产层，因此 S5 不再服务 S9 信源建设建议编排。


## 本工作流 监控数据文件说明

本工作流已移除《问题监控数据文件》客户版产物及其模板契约（`problem_monitoring_data_template.html`、`problem-monitoring-data-template-contract.md`、`qiju-style-monitoring-file-contract.md`）。S5.0 只生成标准监控 JSON 与 raw JSON；截图链接只保留在内部 raw 文件，任何客户可见产物不得出现截图 URL、taskId/subTaskId 或上传表格解析细节。


## 本工作流 启动前硬性闸门

S5 品牌诊断启动前必须检查：

```json
{
  "meta": {"data_confirmation_status": "confirmed", "partial_accepted": false}
}
```

`data_confirmation_status=confirmed` 由 S5.0 导入脚本在校验通过后自动写入（本工作流不设数据确认暂停点，也不再有 `pending_user_confirmation` 状态）。若监控 JSON 缺失该确认标记或 `monitoring_data_source != molizhishu_api`，S5 必须停止。默认要求动态预期答案全部完成；部分完成只在 `data_confirmation_status=confirmed`、`partial_accepted=true` 且成功答案数大于 0 时允许继续。
**非暂停点声明（本工作流）**：S5 诊断阶段完成后只落盘源文件并回传 S0 继续执行，不向对话框发送阶段附件；唯一的用户暂停点是暂停点 1（S4.8 固定双问题确认 + 上传承诺）。

### 内部数据字段边界

监控 JSON/raw 仅供内部诊断使用；其中 taskId、subTaskId、任务状态、截图 URL、mode=、screenshot=、轮询日志、proxy、headers、reasoningProcess、recommendedQuestions、mediaContent、callbackUrl、region_code 等内部字段不得进入任何客户可见产物。进入 S10 的监控证据必须先完成清洁。


## 本工作流 源文件质量底线

- 本节点必须生成详细、具体、可供 S10 读取的结构化 JSON 与 Markdown 源文件。
- 禁止只写标题、空表、空数组、空对象、模板占位、品牌名重复或“资料仍需补充/待补齐/暂无/TODO”。
- 若关键事实不足，必须基于已采集资料给出可追溯的阶段性判断，并在文件中列出缺口与下一步补证动作，不能产出空文件。
- 非暂停节点只落盘不对话框输出；由 S0 在最终交付中统一打包。

## 本工作流 来源深度与 S10 覆盖契约（强制）

本节点的所有输出必须遵循 `../shared/source-depth-and-coverage-contract.md`。除本节点既有 schema/方法要求外，还必须满足该契约规定的有效正文、结构层级、JSON 丰富度、占位/重复比例和文件命名要求。

产物不仅要“存在”，还必须能够被 S10 的 `source_manifest` 登记并通过 `source_coverage_gate`。禁止仅输出摘要、标题壳、空数组或与其他阶段高度雷同的通用文字；未达到门槛时应在本阶段补写，而不是把缺口留给 S10。

---

## 本工作流 Agent 执行硬规则：本阶段必须 Wide Research

当本 Workflow 在 外部 Agent 中运行时，`S5` 不得只用模型常识或聊天总结完成，必须独立调用 Wide Research，并将本阶段资料检索、证据来源、分析结论和规定产物落盘。

完成 `S5` 后必须写入：

```text
outputs/{brand_id}/_execution/S5_{brand_id}_wide_research_manifest.json
```

manifest 必须包含：

```json
{
  "stage_id": "S5",
  "used_wide_research": true,
  "status": "done",
  "research_queries": ["..."],
  "external_sources": [{"title": "...", "url": "...", "used_for": "..."}],
  "generated_files": ["..."],
  "evidence_notes": "..."
}
```

若本阶段没有 Wide Research manifest，S10 前的 `stage_execution_checker.py --strict` 必须阻断。不得用“并行研究完成”替代本阶段文件。
