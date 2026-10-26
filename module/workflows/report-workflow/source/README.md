# FrontMind Report Workflow 通用复用 / Agent 清晰执行版（v3 最终版）

> 适用：任意企业、任意行业、任意竞品输入。企业名称是唯一必填项。
> **v3（2026-10-12）**：S5.0 路径B手动上传已移除（墨力指数 API 自动取数为唯一路径）；监测平台默认国内三平台（豆包·元宝·千问，仅项目输入明确指定时覆盖）；S5.5 BSAS 评分卡结构改为硬门禁（schema 校验 + S10 阻断渲染）。详见 `00_修复说明_2026-10-12_v3.md`。

## 重点解决的问题

此前的质量门较多，但在执行 Agent 中仍可能被理解为“先做一次 Wide Research，再自由生成最终报告”。原因是：

1. 暂停点和 S5.0 数据来源规则分散在多个文件里，Agent 容易把它们当作后置合规要求，而不是前置流程边界；
2. “Wide Research 阶段 manifest”描述较多，Agent 容易误解为一次并行研究，而不是每个 S 阶段都要独立调用；
3. 用户只给企业名称和备注时，Agent 会倾向于用自己的计划填补流程，而不是先执行 S0.1 和暂停点逻辑。

本工作流将核心规则前置到 ZIP 根目录：

```text
00_先读我_全景报告最高原则.md
全景报告一键执行提示词.md
全景报告极简启动提示词.md
```

并新增 S0.0 Workflow 阅读确认门，后续检查与最终打包会验证该 manifest。

## 本版本两大新能力（一键版）

1. **S5.0 墨力指数 API 自动取数（v3 起唯一路径）**：暂停点 1 确认双问题后，`fetch_molizhishu_monitoring.py` 自动提交监控任务（2 问 × **默认国内三平台** × 5 次：豆包·元宝·千问；仅当项目输入或用户启动时明确指定其他平台/海外平台时用 `--platforms` 覆盖，`--list-platforms` 查全目录）→轮询→拉取答案与 citationList→生成契约格式监控表/信源表两份 xlsx→自动导入并自动确认（来源标记 `molizhishu_api`）。除确认两个问题外**无需上传任何文件**。配置见 `molizhishu_api.json`，契约见 `Strategy_Workflow/shared/molizhishu-api-contract.md`；**路径B手动上传双表已于 v3 移除**。
2. **S12 GEO 汇报 PPT**：PDF 交付后自动追加 PPT 环节，参考已交付（速境版）13 页形式，用 ppt-master quick-generate（断言式标题 + data-journalism 风格，SVG→原生可编辑 PPTX，1280×720），含中文字体加固与逐页视觉质检脚本，交付 `FrontMind_{brand}_GEO整体汇报方案.pptx` 到工作区根目录。见 `Strategy_Workflow/S12.GEO汇报PPT生成师.skill/SKILL.md`。

## 两条最高原则

1. **先阅读流程和暂停点逻辑，作为最高原则。**  
   本工作流只有暂停点 1；第一轮最多执行到暂停点 1，未确认问题前不得执行 S5.0 取数；S5.0 API 取数导入并自动确认后直接连跑 S5-S11。

2. **流程中的每个研究型 S 阶段都必须调用 Wide Research。**  
   S1、S2、S3、S4、S5、S5.5、S6、S7、S8、S9、S9.8 各自独立 Wide Research、各自落盘 Markdown/JSON、各自写 manifest。

S5.0 是例外：不做 Wide Research；只能导入墨力指数 API 自动生成的两份 `.xlsx`（AI 问答监控表 + 信源表/引用分析表，格式契约见 S5 技能 references）。两份表格缺一不可，且不能模拟。

## 推荐 执行 Agent 用法

### 最简用法

上传 ZIP 后，复制 `全景报告极简启动提示词.md` 中的短提示词，替换企业名称即可。

```text
企业名称：{brand_name}
用户备注：{user_notes_or_none}
报告语言：中文
```

### 完整用法

复制 `全景报告一键执行提示词.md` 的完整提示词，把【项目输入区】替换成本次客户信息。

没有官网、行业、产品、市场、竞品也可以运行，写“未提供/待调研”即可。缺失项由 S1/S3/S4 Wide Research 有证据补全，不能凭模型常识补写。

## 正确的第一轮行为

当用户只提供企业名称和备注时，Agent 应执行：

```text
解压并阅读 Workflow
→ S0.1 输入解析与补全计划
→ S0.0 Workflow 阅读与双核心原则确认
→ S1 Wide Research + 文件 + manifest
→ S2 Wide Research + 文件 + manifest
→ S3 Wide Research + 文件 + manifest
→ S4 Wide Research + 文件 + manifest
→ S4.8 固定双问题
→ 停在暂停点 1 等待确认
```

正确回复必须包含：

```text
我已识别到本工作流只有暂停点 1（固定双问题确认）。本轮只执行到暂停点 1，不会执行 S5.0 API 取数导入，也不会生成最终报告；API 取数导入确认后将直接连跑到最终报告。
```

## 错误信号

出现以下话术，代表 Agent 没有按 Workflow 执行：

```text
并行研究完成，10 个研究子任务全部成功，现在开始生成最终报告。
已完成 S1-S4 Wide Research，现在开始生成最终全景报告。
模拟 AI 平台对两个固定问题的回答数据。
由于 API 取数失败，我将基于公开信息构造监控记录。
```


## S5.0 数据获取（API 唯一路径）

暂停点 1 必须等待用户确认固定双问题（数据来源固定为 API 自动取数，平台默认国内三平台）：

```text
确认以上两类 AI 监控问题，按默认国内三平台（豆包、元宝、千问）执行
```

确认后运行 `fetch_molizhishu_monitoring.py`（自动提交→轮询→生成以下两份契约表格→自动导入）：

1. AI 问答监控表：由 `import_monitoring_spreadsheet.py` 自动导入，按有效平台 Sheet 动态识别平台并校验固定双问题与每平台 5 次答案块；
2. 信源表（引用分析表）：由 `import_citation_analysis_spreadsheet.py` 自动导入，识别媒体/内容/问题三层数据并校验三层引用总量对账。

两份表格均通过校验后自动写入 `data_confirmation_status=confirmed`（本工作流不设数据确认暂停点），随后直接连续执行 S5-S11 直至最终全景报告，全程无需上传任何文件。S5.0 不再生成《问题监控数据文件》客户版产物，监控数据只保留内部 JSON 供诊断与 S10 使用。

信源引用分析最终放在 S5.5 语义资产审计下半部分。

## 关键命令

S0.1：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/project_input_resolver.py \
  --input "outputs/{brand_id}/00_project_input/project_input_raw.txt" \
  --output-root "outputs"
```

S0.0：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/workflow_reading_guard.py \
  --brand "{brand_id}" \
  --brand-name "{brand_name}" \
  --workflow-root "." \
  --workspace "outputs/{brand_id}"
```

S10 前：

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

最终打包：

```bash
python3 Strategy_Workflow/S0.策略编排师.skill/scripts/final_delivery_packer.py \
  --brand "{brand_id}" \
  --work-dir "outputs/{brand_id}" \
  --out-zip "outputs/{brand_id}/FrontMind_{brand_id}_AI全景报告交付包.zip"
```

禁止使用 `--skip-compliance` 或 `--skip-gate-check` 交付生产结果。

## 最终报告质量

S10 必须读取 S1-S9.8 阶段文件，并按客户版规则选择性组装。图表采用“有真实结构化数据才渲染”的规则：保留差异化矩阵、AI 可见性图、语义五维条形图与 Top 信源条形图，并呈现高频问题及代表性信源/内容表格；三层对账/集中度 KPI 与模型引用量不进入客户报告。趋势机会坐标图和竞品心智地图不进入客户报告。S11 必须做成品格式整理，真正的空白页为 0，稀疏页最多 2 页；11 个正式分部各有独立整页分隔页，该类页面被自动豁免，不计入空白/稀疏页。

### 官方封面、封底与客户版标题清洗硬门

- 唯一官方封面文件为 `Strategy_Workflow/S10.AI智能品牌优化方案全景报告生成师.skill/templates/frontmind_cover_front_back.pdf`。它必须恰好为 2 页 A4，固定 SHA-256 为 `e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d`；第 1 页是封面，第 2 页是封底。
- S10/S11 生产执行禁止使用 `--no-cover-stitch` 或 `--keep-html-cover`。客户 HTML 必须以官方 PDF 第 1 页生成的安全相对路径预览替换旧 HTML 渐变封面；最终 PDF 只保留一张官方封面，并在末页追加官方封底。
- S11 即使未显式传入 `--cover-pdf`，也必须自动定位并强制使用上述官方文件。文件缺失、页数/尺寸/SHA 不符、拼接失败或 HTML 旧封面未被替换，均须阻断。
- 最终 PDF 必须通过首尾视觉指纹门禁：第 1 页与官方第 1 页一致，最后一页与官方第 2 页一致。仅检查“PDF 存在、非空或页数正常”不算通过。
- 客户报告还必须整节过滤“危机与错误信息回应模板”“下游注入规则”“重校触发条件”。来源正文保留的局部标题须剥离 `11.`、`3.2`、`一、`、`（一）` 等源文档编号，但不得改动最终报告的“第一部分”至“第十一部分”正式章节编号。

## 最终组装报告不得漏掉 S 阶段内容

S10 最终《AI智能品牌优化方案全景报告》必须完整承接获准展示的阶段内容，不能只写浅层摘要，也不能用“详见附件”替代正文。问答树/问答矩阵保留为内部输入，客户正文完整呈现 12 周内容编排，并在其后同章放置内容标题钩子。

> **字数门控已取消**：不再设置“90% 阶段覆盖率、36000 字符正文、24 个内容模块”等任何字数/覆盖率/模块数硬门。达标口径：Wide Research 已执行、获准展示的真实内容已完整填入、差异化矩阵有真实数据、无删除项回流、无来源 `h1`/内部头注/绝对路径/占位/造假/重复灌水。S11 只能整理格式，不能删减已通过客户版过滤的内容。

## 最终交付硬要求：全景报告 PDF 是主交付物

最终交付不能只返回 ZIP。ZIP 只是可选归档包，不能替代客户可读的全景报告 PDF。本工作流不生成《问题监控数据文件》PDF。

完成 S10/S11 和全部质量门后，必须将以下 PDF 作为独立文件/独立附件返回：

1. `{brand_id}_AI智能品牌优化方案全景报告.pdf`

`FrontMind_{brand_id}_AI全景报告交付包.zip` 只能作为第二个可选归档附件。若最终只返回 ZIP，视为交付失败，必须补充导出并上传全景报告 PDF。


## 术语与模板字段闭环

所有上游研究术语进入最终报告前，必须按 `Strategy_Workflow/shared/术语与模板字段闭环契约.md` 统一成客户版术语。术语规范化不得删除阶段内容。
