---
name: frontmind-strategy-orchestrator-final
description: >
  S0 策略编排师。负责 S0.1 输入解析、S0.0 阅读确认、双暂停点、逐阶段 Wide Research、
  S5.0 API 自动取数导入（molizhishu_api 唯一路径）、S10/S11 质量门和最终打包。
---

# S0 策略编排师 — 本工作流

## 一、S0 的首要职责

S0 是唯一调度入口。不得把流程简化为“研究一下，然后直接生成最终报告”。S0 必须把以下两条规则作为最高优先级：

1. **先阅读流程和暂停点逻辑。** 本工作流只有暂停点 1；第一轮最多执行到暂停点 1，S5.0 双表导入并自动确认后直接连跑。
2. **每个研究型 S 阶段都调用 Wide Research 并落盘文件。** S1、S2、S3、S4、S5、S5.5、S6、S7、S8、S9、S9.8 不能合并成一次并行研究。

S5.0 是监控数据来源阶段，不得 Wide Research 替代，不得模拟；只能通过墨力指数 API 自动取数生成“AI 问答监控表”和“信源表（引用分析表）”两份 `.xlsx` 并自动导入（路径B手动上传已于 v3 移除），缺一不可。监测平台默认国内三平台（豆包·元宝·千问），仅当项目输入或用户启动时明确指定其他平台/海外平台时按指定执行并记录。

## 二、执行顺序

```text
S0.1 输入解析与补全计划
→ S0.0 Workflow 阅读与双核心原则确认
→ S1 Wide Research 品牌事实
→ S2 Wide Research 营销图谱
→ S3 Wide Research 品类趋势
→ S4 Wide Research 品牌定位
→ output_contract_normalizer 规范 S1-S4 标准文件名
→ S4.8 固定双问题
→【暂停点 1】
→ S5.0 墨力指数 API 自动取数生成双表并自动导入（平台默认国内三平台），导入即自动确认（无数据确认暂停点）
→ S5 Wide Research 品牌诊断
→ S5.5 Wide Research 语义资产审计
→ S6 Wide Research 话语体系
→ S7 Wide Research 视觉符号
→ S8 Wide Research 问答架构
→ S9 Wide Research 业务赋能
→ S9.8 Wide Research 标题钩子
→ output_contract_normalizer 规范 S1-S9.8 标准文件名
→ stage_execution_checker
→ completeness_checker
→ S10 全景报告整合
→ S11 成品格式整理
→ final_delivery_packer
```

## 三、标准输入、最小输入与推断

企业名称是唯一必填项。官方网站、行业/品类、核心产品/服务、目标市场/地区、竞争对手和用户备注均可缺失。缺失不代表流程失败，而是进入 S0.1 输入解析与 S1/S3/S4 Wide Research 补全任务。

`brand_name` 用于报告正文；`brand_id` 用于 outputs 路径、脚本 `--brand`、文件名和 manifest。

## 四、S0.1 输入解析

进入 S1 前必须完成 S0.1：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/project_input_resolver.py \
  --input "outputs/{brand_id}/00_project_input/project_input_raw.txt" \
  --output-root "outputs"
```

S0.1 必须输出：

```text
outputs/{brand_id}/00_project_input/S0.1_{brand_id}_输入解析与补全计划.json
outputs/{brand_id}/00_project_input/S0.1_{brand_id}_输入解析与补全计划.md
outputs/{brand_id}/_execution/S0.1_{brand_id}_input_resolution_manifest.json
```

对缺失字段的“自行判断”只能表示：由 S1/S3/S4 基于 Wide Research、可靠来源、候选对比和置信度说明进行补全。不得凭模型常识、历史案例或固定模板直接填充。

## 五、S0.0 Workflow 阅读确认

获得 `brand_id` 后，必须完成 S0.0：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/workflow_reading_guard.py \
  --brand "{brand_id}" \
  --brand-name "{brand_name}" \
  --workflow-root "." \
  --workspace "outputs/{brand_id}"
```

S0.0 必须输出：

```text
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.json
outputs/{brand_id}/_execution/S0.0_{brand_id}_workflow_reading_manifest.md
```

该 manifest 必须确认：暂停点规则（唯一暂停点 1 + S5.0 自动确认连跑）、逐阶段 Wide Research、S5.0 仅允许 API 自动取数规则（平台默认国内三平台）。

## 六、暂停点

### 暂停点 1：固定问题确认

进入前必须完成并落盘 S1-S4 的规定 JSON/Markdown 和 Wide Research manifest。S4.8 生成：

```text
Q1：{核心产品}推荐
Q2：{品牌名}有什么缺点和问题？
```

用户未明确回复确认（含数据来源选择；API 路径还必须含监测平台范围的显式选择——`--platforms` 必传，默认国内三平台（除非项目输入明确指定其他平台/海外平台））前，不得调用 S5.0。

### S5.0 之后：无数据确认暂停点，直接连跑

S5.0 数据导入双路径：

- **墨力指数 API 自动取数（v3 起唯一路径）**：确认脚本带 `--monitoring-data-source molizhishu_api --platforms doubao,yuanbao,qianwen`（默认国内三平台；仅项目输入明确指定时覆盖）后，运行 `fetch_molizhishu_monitoring.py`（同传 `--platforms`）——自动提交 2 问 × N 平台 × 5 次任务、轮询、生成契约格式两份 xlsx 并以 `--data-source molizhishu_api` 自动调用两个导入器。详见 `../shared/molizhishu-api-contract.md`。

两路径均要求信源表三层对账通过、`simulated=false`。信源表必须通过“媒体引用次数合计 = 内容引用次数合计 = 问题引用明细行数”的三层对账。

API 自动生成的两份表格导入并通过固定范围/三层对账校验后，脚本自动写入 `data_confirmation_status=confirmed`，随后直接连续执行 S5-S11 直至最终全景报告，不等待用户再次确认、无需上传任何文件，也不生成《问题监控数据文件》客户版产物。部分监控数据仅在用户明确接受后，由 `import_monitoring_spreadsheet.py --allow-partial-records` 写入 `partial_accepted=true`；引用分析三层对账失败不允许绕过。

S0 在进入监控阶段时不得提示“模拟 AI 平台对两个固定问题的回答数据”，不得 mock、sample、manual record 或重建监控答案。任一表格缺失、解析失败或引用三层对账失败时，必须返回真实错误并停止。

## 七、每个研究型阶段的 Wide Research 要求

必须读取 `Strategy_Workflow/shared/wide-research-execution-contract.md`。

强制要求：

- S1、S2、S3、S4、S5、S5.5、S6、S7、S8、S9、S9.8 必须使用 Wide Research 子任务；
- 每个研究型阶段必须写入 `_execution/{stage_id}_{brand_id}_wide_research_manifest.json`；
- 每个阶段必须输出该阶段规定的 Markdown / JSON 文件；
- 不能只在聊天里说“完成研究”；
- S5.0 必须写入 `_execution/S5.0_{brand_id}_monitoring_data_execution_manifest.json` 和 `_execution/S5.0_{brand_id}_citation_analysis_import_manifest.json`，且 manifest 必须明确 `monitoring_data_source=molizhishu_api`。


## 七A、标准产物文件名闭环

必须读取 `Strategy_Workflow/shared/全链路标准产物文件清单.md`。每个阶段必须优先使用标准文件名；如果执行 Agent 已经产出等价文件但命名不同，必须先运行规范化脚本复制为标准文件名，不得重新写浅层文件充数。

暂停点 1 前运行：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/output_contract_normalizer.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --stages S1,S2,S3,S4 \
  --strict
```

进入 S10 前运行：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/output_contract_normalizer.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --stages S1,S2,S3,S4,S5,S5.5,S6,S7,S8,S9,S9.8 \
  --strict
```

`completeness_checker.py` 是 S9.8 完成后的全量质量门，不得在 S5 前提前运行；S5 前只允许使用 normalizer 处理 S1-S4 文件名闭环。

## 八、进入 S10 前检查

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/output_contract_normalizer.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --stages S1,S2,S3,S4,S5,S5.5,S6,S7,S8,S9,S9.8 \
  --strict

python3 Strategy_Workflow/S0.策略编排师.skill/scripts/stage_execution_checker.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --strict

python3 Strategy_Workflow/S9.业务赋能规划师.skill/scripts/completeness_checker.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --output "outputs/{brand_id}/S9_{brand_id}_策略完整性检查.md"
```

返回非零时，必须回到对应阶段补写；严禁强行进入 S10。

## 九、S10 强制规则

S10 必须读取并登记所有来源文件，不能只“参考”阶段结论：

- S1-S4：正文和结构化 JSON；
- S5：品牌诊断数据、诊断正文与 Gap 报告；
- S5.5-S7：语义、话语、视觉正文与 JSON；
- S8：问答树、问答矩阵、内容日历和问答报告；
- S9：业务赋能建议，进入行动清单和路线图；
- S9.8：至少 12 条标题钩子。

`S10_{brand_id}_全景报告数据.json` 中的 `source_quality_gate`、`source_coverage_gate`、`template_compliance` 必须全部通过。

## 十、S11 强制规则

S10 完成后必须执行 S11 格式整理和 `layout_quality_checker.py`。S11 只调整版式，不删减已通过覆盖门的内容。空白页必须为 0，稀疏页最多 2 页。

## 十一A、S12 GEO 汇报 PPT（打包后执行）

`final_delivery_packer` 成功后，按 `Strategy_Workflow/S12.GEO汇报PPT生成师.skill/SKILL.md` 执行：ppt-master quick-generate 13 页（1280×720），KPI 与全景报告全篇一致，中文字体加固（pptx_font_hardening.py）+ 逐页视觉质检（render_pptx_pages.py），交付 `FrontMind_{brand}_GEO整体汇报方案.pptx` 到工作区根目录，并写 `_execution/S12_{brand}_ppt_execution_manifest.json`。

## 十一、最终打包

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/final_delivery_packer.py \
  --brand "{brand_id}" \
  --work-dir "outputs/{brand_id}" \
  --out-zip "outputs/{brand_id}/FrontMind_{brand_id}_AI全景报告交付包.zip"
```

禁止生产交付时使用 `--skip-compliance` 或 `--skip-gate-check`。

## 十二、第一轮必须输出的状态句

```text
我已识别到本工作流只有暂停点 1。本轮只执行到暂停点 1，不会执行 S5.0 的 API 取数导入，也不会生成最终报告；API 取数导入确认后将直接连跑到最终报告。
```

## 最终交付硬要求：全景报告 PDF 是主交付物

最终交付不能只返回 ZIP。ZIP 只是可选归档包，不能替代客户可读的全景报告 PDF。本工作流不生成《问题监控数据文件》PDF。

完成 S10/S11 和全部质量门后，必须将以下 PDF 作为独立文件/独立附件返回：

1. `{brand_id}_AI智能品牌优化方案全景报告.pdf`

`FrontMind_{brand_id}_AI全景报告交付包.zip` 只能作为第二个可选归档附件。若最终只返回 ZIP，视为交付失败，必须补充导出并上传全景报告 PDF。
