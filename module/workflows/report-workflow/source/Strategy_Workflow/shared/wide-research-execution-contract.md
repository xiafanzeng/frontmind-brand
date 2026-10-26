# 执行 Agent / 外部代理 Wide Research 执行契约 — 通用复用版 本工作流

本契约用于防止外部代理把 FrontMind Workflow 误执行为“自由研究 + 直接出报告”。当 Workflow 在 执行 Agent 或其他带有 Wide Research 的代理中运行时，本契约为强制规则，适用于任意企业、任意行业、任意竞品组合。


## 0A. 两条最高原则（先于全部表格）

1. **先阅读流程和暂停点逻辑。** Agent 必须先生成 S0.0 workflow reading manifest；本工作流只有暂停点 1，第一轮最多执行到暂停点 1；未确认暂停点不得越过，S5.0 双表导入后自动确认并直接连跑。
2. **每个研究型 S 阶段都必须调用 Wide Research。** Wide Research 必须按 S 阶段独立执行，不能合并成一次并行研究。

S5.0 是例外：只能通过墨力指数 API 自动取数生成并导入两份 `.xlsx`（AI 问答监控表 + 信源表/引用分析表）；两份表格缺一不可，不能模拟，也不能用 Wide Research 替代（路径B手动上传已移除；平台默认国内三平台）。

## 0B. S0.0 Workflow 阅读 manifest

获得 brand_id 后，必须写入：

```text
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.json
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.md
```

该 manifest 必须确认：`pause_points_acknowledged=true`、`wide_research_per_stage_acknowledged=true`、`s5_0_data_source_rule_acknowledged=true`。

## 0. 通用输入变量

每次项目必须先建立以下变量：

| 变量 | 含义 | 要求 |
|---|---|---|
| `brand_name` | 企业或品牌展示名称 | 必填；用于报告正文 |
| `brand_id` | 文件与脚本安全名 | 必填；用于 outputs 路径、脚本 `--brand`、文件名和 manifest |
| `official_site` | 官方网站 | 可未知；未知时由 S1 Wide Research 补全 |
| `industry_or_category` | 行业/品类 | 可未知；未知时由 S1/S3 推断 |
| `main_product` | 核心产品/服务 | 可未知；未知时由 S1/S4 推断，并用于固定问题 Q1 |
| `target_market` | 目标市场/地区 | 可未知；未知时由 S1/S3 推断核心市场与延展市场 |
| `competitors` | 指定竞品或替代方案 | 可未知；未知时由 S4 识别 3-5 个高相关对象 |
| `user_notes` | 用户备注/战略诉求 | 可为空；非空时必须进入 S4、S5、S8、S9、S10 |

`brand_id` 只允许中文、英文、数字、下划线和短横线；空格、斜杠、冒号等特殊符号必须替换为下划线。所有示例中的 `{brand_id}` 必须替换为实际值，不得保留花括号。

## 1. 基本原则

1. Workflow 是执行规程，不是参考资料。代理必须按 S0.1、S0.0、S1-S11 阶段落盘产物、运行脚本、经过暂停点和质量门。
1A. 企业名称是唯一必填项；其他输入缺失时，不得中断或臆测，必须由 S0.1 生成补全计划，并由 S1/S3/S4 Wide Research 有证据补齐。
2. 研究型阶段必须使用 Wide Research；聊天回复中的“已完成研究”不等于阶段完成。
3. 每个阶段必须有可审计文件输出，且最终 S10 必须从这些文件读取内容并计算来源覆盖率。
4. S5.0 问题监控不是研究型阶段，必须由墨力指数 API 自动取数生成并导入 AI 问答监控表与信源表（引用分析表）两份 `.xlsx`，Wide Research 不能替代真实监控或引用数据。
5. 任一阶段缺失文件、缺失 manifest、缺失 S5.0 API 取数来源证明、S5.5 BSAS 评分卡不符合 bsas_scorecard_schema 结构 或质量门失败，必须停下修复，禁止直接生成 PDF。
6. 不得把任何客户、行业、竞品或网址写死进 Workflow；每次只能从项目输入区与 Wide Research 结果中取得本次对象。

## 2. 阶段执行方式

| 阶段 | 是否必须 Wide Research | 是否必须 S5.0 可信数据来源 | 说明 |
|---|---:|---:|---|
| S0.1 输入解析与补全计划 | 否 | 否 | 解析最小输入、生成缺失项清单、分配 S1/S3/S4 补全任务；不做最终结论 |
| S0.0 Workflow 阅读确认 | 否 | 否 | 显式确认已读取流程、暂停点规则（唯一暂停点 1 + S5.0 自动确认连跑）、逐阶段 Wide Research 和 S5.0 API 取数规则（molizhishu_api 唯一路径） |
| S1 品牌事实 | 是 | 否 | 官网、公告、投资者资料/产品资料、业务结构、品牌资产证据；补全官网、核心业务、基础身份 |
| S2 营销图谱 | 是 | 否 | 受众、场景、意图、问题路径、转化阻力 |
| S3 品类趋势 | 是 | 否 | 行业趋势、AI 搜索趋势、政策/技术/渠道/需求变化；补全行业/品类和目标市场 |
| S4 品牌定位 | 是 | 否 | 指定或研究识别竞品对比、心智空位和定位判断；补全竞品与固定问题 Q1 核心对象 |
| S4.8 固定双问题 | 否 | 否 | 由脚本或固定规则生成，必须等待用户确认 |
| S5.0 问题监控 | 否 | 是 | 运行 `fetch_molizhishu_monitoring.py` 自动取数（平台默认国内三平台）并自动调用两个导入器完成双表导入 |
| S5 品牌诊断 | 是 | 否 | 基于真实监控数据 + Wide Research 补充分析，不得补假数据 |
| S5.5 语义资产 | 是 | 否 | 实体、属性、关系、AI 可读性、语义资产缺口 |
| S6 话语体系 | 是 | 否 | 证据化表达、核心 token、禁用表达、场景化话术 |
| S7 视觉符号 | 是 | 否 | 视觉母题、AI 图像 prompt 包、跨平台视觉规则 |
| S8 问答架构 | 是 | 否 | 问答树、问答矩阵、内容日历、落地页蓝图 |
| S9 业务赋能 | 是 | 否 | 90 天行动、组织协同、KPI、风险和依赖 |
| S9.8 标题钩子 | 是 | 否 | 至少 12 条可执行标题钩子 |
| S10 报告生成 | 否 | 否 | 读取 S1-S9.8 文件，渲染全景报告并计算覆盖率 |
| S11 格式整理 | 否 | 否 | 只做版面压缩、空白页检查和最终 PDF 重渲染 |

## 2A. S0.1 输入解析 manifest

S0.1 不属于研究型阶段，不要求 Wide Research，但必须落盘输入解析与补全计划。S0.0 也不属于研究型阶段，但必须落盘 Workflow 阅读确认 manifest：

```text
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.json
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.md
```

S0.1 必须落盘：

```text
outputs/{brand_id}/00_project_input/S0.1_{brand_id}_输入解析与补全计划.json
outputs/{brand_id}/00_project_input/S0.1_{brand_id}_输入解析与补全计划.md
outputs/{brand_id}/_execution/S0.1_{brand_id}_input_resolution_manifest.json
```

S0.1 必须列明：已知输入、缺失字段、每个缺失字段由哪个阶段补全、建议检索方向、是否存在需要暂停确认的歧义。S0.1 不得直接输出最终行业判断、竞品结论或报告观点。

## 3. Wide Research manifest

每个研究型阶段完成后，必须写入：

```text
outputs/{brand_id}/_execution/{stage_id}_{brand_id}_wide_research_manifest.json
```

最低结构：

```json
{
  "stage_id": "S1",
  "stage_name": "品牌事实",
  "brand": "{brand_id}",
  "brand_name": "{brand_name}",
  "used_wide_research": true,
  "status": "done",
  "research_queries": ["..."],
  "external_sources": [
    {"title": "...", "url": "...", "source_type": "official|news|report|search|other", "used_for": "..."}
  ],
  "generated_files": ["outputs/{brand_id}/S1_{brand_id}_品牌事实图谱.json", "outputs/{brand_id}/S1_{brand_id}_品牌知识库.md"],
  "evidence_notes": "本阶段如何使用资料、如何处理不确定性、哪些结论进入下游。"
}
```

要求：

- `used_wide_research` 必须为 `true`；
- `status` 必须为 `done`；
- `generated_files` 不能为空，且文件必须真实存在；
- `external_sources` 不得为空；
- 不得使用 `mock`、`simulate`、`manual`、`sample`、`placeholder` 等标记伪装为研究完成；
- `brand` 字段必须等于脚本使用的 `brand_id`。


## 3A. 标准产物文件名闭环

所有阶段的 `generated_files` 必须优先列出 `shared/全链路标准产物文件清单.md` 中的 canonical 文件名。Agent 可以保留自己生成的别名文件，但不得只留下别名。

如果已经产出等价文件但命名不同，必须运行：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/output_contract_normalizer.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --stages S1,S2,S3,S4,S5,S5.5,S6,S7,S8,S9,S9.8 \
  --strict
```

该脚本只复制/规范化已有等价内容，不会生成新观点。若脚本失败，必须回到对应 S 阶段补写；不得人工写一个短文件骗过文件名检查。

## 4. S5.0 monitoring data source manifest

S5.0 必须写入：

```text
outputs/{brand_id}/_execution/S5.0_{brand_id}_monitoring_data_execution_manifest.json
```

该 manifest 的 `monitoring_data_source` 只能是 `molizhishu_api`（API 唯一路径）。监控表导入 manifest 最低结构：

```json
{
  "stage_id": "S5.0",
  "stage_name": "API取数问题监控数据导入",
  "brand": "{brand_id}",
  "brand_name": "{brand_name}",
  "monitoring_data_source": "molizhishu_api",
  "used_molizhishu_api": true,
  "simulated": false,
  "status": "done",
  "script": "Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_monitoring_spreadsheet.py",
  "generated_files": ["outputs/{brand_id}/.../S5_{brand_id}_frontmind_monitoring_data.json", "outputs/{brand_id}/.../S5_{brand_id}_frontmind_monitoring_raw.json"],
  "source_provenance_files": ["outputs/{brand_id}/02_monitoring_data/molizhishu_raw/S5_{brand_id}_molizhishu_监控表.xlsx", "outputs/{brand_id}/02_monitoring_data/molizhishu_raw/S5_{brand_id}_molizhishu_raw.json"]
}
```

同时必须写入信源表（引用分析表）导入 manifest：

```text
outputs/{brand_id}/_execution/S5.0_{brand_id}_citation_analysis_import_manifest.json
```

最低结构：

```json
{
  "stage_id": "S5.0",
  "stage_name": "API取数引用分析数据导入",
  "brand": "{brand_id}",
  "brand_name": "{brand_name}",
  "monitoring_data_source": "molizhishu_api",
  "used_molizhishu_api": true,
  "simulated": false,
  "status": "done",
  "script": "Strategy_Workflow/S5.品牌诊断专家.skill/scripts/import_citation_analysis_spreadsheet.py",
  "reconciliation_passed": true,
  "generated_files": [
    "outputs/{brand_id}/02_monitoring_data/S5_{brand_id}_引用分析数据.json",
    "outputs/{brand_id}/02_monitoring_data/S5_{brand_id}_引用分析原始提取.json",
    "outputs/{brand_id}/02_monitoring_data/S5_{brand_id}_引用分析导入摘要.md",
    "outputs/{brand_id}/02_monitoring_data/S5_{brand_id}_citation_analysis_confirmation.json",
    "outputs/{brand_id}/02_monitoring_data/uploaded_sources/S5_{brand_id}_citation_analysis_source.xlsx"
  ]
}
```

## 5. 检查命令

进入 S10 前必须运行：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/stage_execution_checker.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --strict
```

检查失败时，不得进入 S10。必须回到缺失的 S 阶段补做 Wide Research、补落盘文件或重新运行 S5.0 双表导入。

## 6. 禁止外部代理话术

以下话术代表流程没有正确执行，必须纠正：

```text
并行研究已完成，若干研究子任务全部成功，现在开始生成最终报告。
我将根据 Workflow 的内置规则撰写最终报告。
模拟 AI 平台对两个固定问题的回答数据。
由于 API 取数失败，我将基于公开信息整理监控记录。
我已经参考 S1-S9 的内容生成报告。
```

正确话术应当包含：阶段编号、使用 Wide Research 或 S5.0 监控数据来源的证明、文件路径、检查命令和质量门状态。
