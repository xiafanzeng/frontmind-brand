---
name: frontmind-report-workflow-main-final
description: >
  FrontMind 通用全景报告工作流主入口。本工作流将执行核心显性化：先阅读流程与唯一的暂停点（S4.8 固定双问题确认，S5.0 之后不再设数据确认暂停点）；
  每个研究型 S 阶段必须调用 Wide Research 并落盘文件；S5.0 只能通过墨力指数 API 自动取数生成并导入两份数据表格（AI 问答监控表与信源表），路径B手动上传已移除；
  S10 深度嵌入 S1-S9.8，S11 做成品格式整理后才允许交付。
---

# FrontMind 全景报告工作流主入口 — 本工作流

## 0. 外部 Agent 先读规则

当用户上传本 Workflow ZIP 并给出企业名称时，Agent 的第一任务不是生成报告，而是读取执行规程。必须先读：

1. `00_先读我_全景报告最高原则.md`
2. `全景报告一键执行提示词.md`
3. 本文件
4. `00.FrontMind总控路由.skill/SKILL.md`
5. `Master_Control/FrontMind_Master_Control.md`
6. `Strategy_Workflow/S0.策略编排师.skill/SKILL.md`
7. `Strategy_Workflow/shared/core-execution-principles.md`
8. `Strategy_Workflow/shared/wide-research-execution-contract.md`

## 1. 两条最高原则

### 原则 1：先阅读流程和暂停点逻辑

Workflow 不是参考资料，而是执行规程。未到暂停点不得越过，未获用户明确确认不得继续。

- 暂停点 1（唯一暂停点）：S4.8 固定双问题生成后，必须让用户明确确认固定双问题。数据来源固定为墨力指数 API 自动取数（唯一路径）；**监测平台默认国内三平台（豆包·元宝·千问），仅当项目输入或用户启动时明确指定其他平台/海外平台时按指定执行并记录**；确认脚本带 `--platforms`（默认 doubao,yuanbao,qianwen）。确认前不得取数导入。
- S5.0 不设数据确认暂停点：用户确认固定双问题后，`fetch_molizhishu_monitoring.py` 自动取数（2 问 × 平台 × 5 次）、生成两份契约 `.xlsx` 并自动导入；通过固定范围/三层对账校验即自动确认（`data_confirmation_status=confirmed`），随后直接连续执行 S5-S11 直至最终全景报告。部分监控数据仅在用户明确接受后使用 `import_monitoring_spreadsheet.py --allow-partial-records` 写入 `partial_accepted=true`。

第一轮最多执行到暂停点 1。若 Agent 直接说“现在开始生成最终报告”，即为执行失败。

### 原则 2：每个研究型 S 阶段都必须调用 Wide Research

Wide Research 不是一次性并行研究。S1、S2、S3、S4、S5、S5.5、S6、S7、S8、S9、S9.8 必须逐阶段独立调用 Wide Research、生成阶段文件，并写入 `_execution/{stage_id}_{brand_id}_wide_research_manifest.json`。

聊天里说“研究完成”不算完成；必须有文件和 manifest。

## 2. 绝对禁令

- 不得跳过 S0.1-S9.8 直接生成报告。
- 不得把流程简化为“并行研究完成，若干子任务成功，现在生成最终报告”。
- S5.0 不得模拟、仿真、手工构造或用 Wide Research 代替监控数据；来源只能是墨力指数 API 自动取数生成的两份真实数据表格（路径B手动上传已移除）。
- 禁止出现“模拟 AI 平台对两个固定问题的回答数据”。
- 不得绑定固定客户、固定竞品、固定行业或固定结论；每次从项目输入区生成 `brand_name` / `brand_id`。
- 不得在最终报告中泄露内部字段、文件名、任务 ID、推理字段、占位符或调试信息。

S5.0 正确做法只有一种，且必须在暂停点 1 获得用户确认：

- API 自动取数（唯一路径）：运行 `fetch_molizhishu_monitoring.py`（带 `--platforms`，默认 doubao,yuanbao,qianwen）自动提交任务、轮询取回、生成契约格式监控表与信源表两份 `.xlsx`，并自动调用 `import_monitoring_spreadsheet.py` 与 `import_citation_analysis_spreadsheet.py`（`--data-source molizhishu_api`）完成导入与自动确认；表格格式遵循 `uploaded-monitoring-spreadsheet-contract.md` 与 `uploaded-citation-analysis-spreadsheet-contract.md`（作为格式契约）。任一环节失败都必须停止并保留真实错误。

## 3. 强制执行链路

```text
S0.1 输入解析与补全计划
→ S0.0 Workflow 阅读与双核心原则确认
→ S1 Wide Research 品牌事实
→ S2 Wide Research 营销图谱
→ S3 Wide Research 市场趋势
→ S4 Wide Research 品牌定位
→ S4.8 固定双问题
→【暂停点 1：用户确认问题】
→ S5.0 数据导入（唯一路径）：墨力指数 API 自动取数（molizhishu_api，fetch_molizhishu_monitoring.py 一键生成并导入；平台默认国内三平台）。导入即自动确认
→ S5 Wide Research 品牌诊断
→ S5.5 Wide Research 语义资产审计
→ S6 Wide Research 话语体系
→ S7 Wide Research 视觉符号
→ S8 Wide Research 问答树 / 问答矩阵 / 内容日历
→ S9 Wide Research 业务赋能
→ S9.8 Wide Research 标题钩子
→ stage_execution_checker
→ completeness_checker
→ S10 全景报告深度整合与来源覆盖检查
→ S11 成品格式整理与空白页检查
→ final_delivery_packer
→ S12 GEO 汇报 PPT（速境版形式，ppt-master quick-generate，13 页，逐页视觉质检）
```

## 4. 通用输入规则

企业名称是唯一必填项。官网、行业、核心产品、目标市场、竞品和备注均可缺失。缺失项不得凭模型常识补写，必须先由 S0.1 规划，再由 S1/S3/S4 Wide Research 有证据地补全。

- `brand_name`：报告正文展示名。
- `brand_id`：输出目录、文件名、脚本参数和 manifest 使用的安全名。

## 5. 启动命令门

输入解析：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/project_input_resolver.py \
  --input "outputs/{brand_id}/00_project_input/project_input_raw.txt" \
  --output-root "outputs"
```

阅读确认：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/workflow_reading_guard.py \
  --brand "{brand_id}" \
  --brand-name "{brand_name}" \
  --workflow-root "." \
  --workspace "outputs/{brand_id}"
```

## 6. 进入 S10 前的硬检查

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/stage_execution_checker.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --strict

python3 Strategy_Workflow/S9.业务赋能规划师.skill/scripts/completeness_checker.py \
  --brand "{brand_id}" \
  --workspace "outputs/{brand_id}" \
  --output "outputs/{brand_id}/S9_{brand_id}_策略完整性检查.md"
```

检查失败必须回到对应 S 阶段补做 Wide Research、补落盘文件或重新导入 S5.0 双表数据。不得硬写 PDF。

## 7. S10 / S11 / 交付

S10 必须读取 S1-S9.8 阶段文件，并按客户版规则选择性组装：S5 诊断正文、S8 的 12 周内容日历、S9 行动建议和 S9.8 标题钩子必须进入报告；问答树/问答矩阵保留为内部输入，不在客户正文展开。标题钩子紧随日历，作为同章小节。**字数/覆盖率门控已取消**：只要各阶段来源块存在、非空、获准展示的内容已真实进入报告即可，不再因覆盖率/字数不足而阻断 PDF。

信源表的独立引用分析必须放在 S5.5 语义资产审计下半部分。S10 应使用真实上游数据生成差异化矩阵、语义五维条形图、AI 可见性图和 Top 信源条形图，并呈现高频问题及代表性信源/内容表格。三层对账/集中度 KPI 与模型引用量不进入客户报告。趋势机会坐标图与竞品心智地图不进入客户报告，缺数据时不得放占位图。

官方封面模板固定为 `Strategy_Workflow/S10.AI智能品牌优化方案全景报告生成师.skill/templates/frontmind_cover_front_back.pdf`，必须恰好为 2 页 A4，SHA-256 必须为 `e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d`。S10/S11 禁止使用 `--no-cover-stitch` 或 `--keep-html-cover`；客户 HTML 必须用官方第 1 页的安全预览替换旧 HTML 封面。S11 未显式传入封面路径时也必须自动使用该模板，并在最终 PDF 中形成“官方封面 → 正文 → 官方封底”。最终第 1 页和最后 1 页必须分别通过与模板第 1/2 页的视觉指纹比对；任一不符即阻断。

S11 必须做格式整理，真正的空白页为 0，稀疏页最多 2 页，不能通过删除正文或过度缩小字号达标；11 个分部的章节分隔页各自独立占一整页，该类页面被自动豁免，不计入空白/稀疏页。最终 HTML/PDF 不得渲染 `.source-stage-block h1`、上游报告标题、阶段输出头注、版本/日期/输入/原则/数据源说明或本地绝对路径；还必须整节过滤“危机与错误信息回应模板”“下游注入规则”“重校触发条件”。保留的来源局部标题须去除源文档编号，不得影响最终 11 个正式分部编号。

最终只能使用：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/final_delivery_packer.py \
  --brand "{brand_id}" \
  --work-dir "outputs/{brand_id}" \
  --out-zip "outputs/{brand_id}/FrontMind_{brand_id}_AI全景报告交付包.zip"
```

禁止生产交付时使用 `--skip-compliance` 或 `--skip-gate-check`。

## 8. 最后再次强调

```text
1. 先阅读流程和暂停点逻辑，作为最高原则。本工作流只有暂停点 1；API 取数导入确认后直接连跑到最终报告。
2. 每个研究型 S 阶段都要调用 Wide Research，并产出该 S 阶段文件与 manifest。
```

## 最终组装报告不得漏掉 S 阶段内容

S10 最终《AI智能品牌优化方案全景报告》必须采用“全文丰富组装模式”：S1-S9.8 的核心产物都要完整进入客户可读章节，不能只写浅层摘要，也不能用“详见附件”替代正文。各阶段内容都必须完整承接。

> **字数门控已取消**：不再设置“90% 阶段覆盖率、36000 字符正文、24 个内容模块”等任何字数/覆盖率/模块数硬门。达标口径：Wide Research 已执行、各 S 阶段真实内容已完整填入、无残留/占位/造假/重复灌水。S11 只能整理格式，不能删内容，且必须保留每个分部的独立整页分隔页。

## 最终交付硬要求：全景报告 PDF 是主交付物

最终交付不能只返回 ZIP。ZIP 只是可选归档包，不能替代客户可读的全景报告 PDF。本工作流不生成《问题监控数据文件》PDF；S5.0 由 API 自动生成两份表格并导入供诊断使用。

完成 S10/S11 和全部质量门后，必须将以下 PDF 作为独立文件/独立附件返回：

1. `{brand_id}_AI智能品牌优化方案全景报告.pdf`

`FrontMind_{brand_id}_AI全景报告交付包.zip` 只能作为第二个可选归档附件。若最终只返回 ZIP，视为交付失败，必须补充导出并上传全景报告 PDF。


## 术语与模板字段闭环

所有上游研究术语进入最终报告前，必须按 `Strategy_Workflow/shared/术语与模板字段闭环契约.md` 统一成客户版术语。术语规范化不得删除阶段内容。
