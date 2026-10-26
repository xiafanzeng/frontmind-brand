---
name: frontmind-final-report-formatter
description: >
  S11 成品格式整理师。位于 S10 之后、合规检查和最终打包之前，负责保留每个分部的独立整页分隔页、
  取消正文机械强制分页、处理长卡片跨页、重新渲染 PDF，并通过空白页/稀疏页质量门（独立整页分隔页被自动豁免）。
---

# S11 成品格式整理师

## 一、定位

S11 只整理成品版式，不改写战略结论，不删减已经通过 S10 客户版过滤的有效正文。它是最终交付前的强制步骤，并必须保留 11 个分部的独立整页分隔页。上游报告头注、来源一级标题和已从客户版删除的内部模块不得被重新带回。

## 二、输入

- `S10_{brand}_AI智能品牌优化方案全景报告.html`
- `S10_{brand}_AI智能品牌优化方案全景报告.pdf`（可作为整理前基线）
- `S10_{brand}_全景报告数据.json`
- 官方两页封面/封底 PDF：`../S10.AI智能品牌优化方案全景报告生成师.skill/templates/frontmind_cover_front_back.pdf`，必须恰好 2 页 A4，SHA-256=`e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d`

## 三、强制动作

1. 清理空段落和空容器；
2. **保留每个分部的章节分隔页为独立整页**，正文从下一页开始；分隔页不压缩、不优化，不得合并为正文页首的一行小标题；
3. 取消每个 `.report-page` 的机械 `page-break-before: always`；
4. 默认让正文自然连续流动，仅封面、目录、经营层摘要和分隔页保留强制分页；
5. 长卡片、长证据块和长文本允许跨页，图表与短卡片保持整体；
6. 复核最终 HTML 不含任何上游来源文件的 `h1` 一级标题；来源正文直接承接客户版章节标题，不另显示阶段报告标题；
7. 删除旧 HTML 渐变封面的输出语义，保留由官方 PDF 第 1 页生成的客户 HTML 安全预览；重新渲染正文后拼接官方封面/封底；
8. 生成 `S11_{brand}_格式整理报告.json/.md`；
9. 真正的空白页必须为 0；除封面/封底外的稀疏页不得超过 2 页（独立整页分隔页被自动识别并豁免，不计入空白/稀疏）。
10. 保留 S4 差异化矩阵、S5 AI 可见性图和 S5.5 五维条形图；还必须保留语义资产审计下半部分的信源/引用分析图表与表格。趋势机会坐标图和竞品心智地图不得恢复；短图表不拆页，不得因压缩空白而删除图表。
11. 复核标题钩子位于“12 周内容编排”之后的小节中；不得把它重新拆成独立章节或分隔页。
12. 整节过滤“危机与错误信息回应模板”“下游注入规则”“重校触发条件”，并剥离来源局部标题编号；不得改动最终 11 个正式分部编号。
13. 对最终 PDF 做首尾视觉指纹校验：第 1 页匹配官方模板第 1 页，最后 1 页匹配官方模板第 2 页。仅有“PDF 已生成”或“拼接函数未报错”不能放行。
14. 独立信源/引用分析中的 Top 信源图必须使用 `data-citation-chart-group` / `data-citation-chart-item` 分页语义，并采用纵向 stacked 模式；不得拆开标题、图形与说明。S11 必须自动升级旧版普通 `chart-grid`，且通用压缩规则不得覆盖这组专属规则。
15. 每个排版候选生成后必须读取实际 PDF，确认 Top 信源图标题与说明同页。失败候选不得参与最优版本选择；结果写入必需的 `citation_chart_gate`，再由独立版面检查器复验。

## 四、执行命令

```bash
python3 Strategy_Workflow/S11.成品格式整理师.skill/scripts/format_panorama_report.py \
  --brand "{brand}" \
  --input-html "outputs/{brand}/04_final_report/S10_{brand}_AI智能品牌优化方案全景报告.html" \
  --output-html "outputs/{brand}/04_final_report/S10_{brand}_AI智能品牌优化方案全景报告.html" \
  --output-pdf "outputs/{brand}/04_final_report/S10_{brand}_AI智能品牌优化方案全景报告.pdf" \
  --cover-pdf "Strategy_Workflow/S10.AI智能品牌优化方案全景报告生成师.skill/templates/frontmind_cover_front_back.pdf" \
  --report-json "outputs/{brand}/04_final_report/S10_{brand}_全景报告数据.json" \
  --qa-json "outputs/{brand}/04_final_report/S11_{brand}_格式整理报告.json" \
  --qa-md "outputs/{brand}/04_final_report/S11_{brand}_格式整理报告.md"
```

`--cover-pdf` 可显式指向上述固定文件，但不得指向其他模板；若省略，S11 必须自动定位上述固定文件并执行同样的页数、A4、SHA 和首尾指纹校验。禁止以省略参数为由返回 `no external cover` 或直接复制正文 PDF。

随后必须再运行独立质检：

```bash
python3 Strategy_Workflow/S11.成品格式整理师.skill/scripts/layout_quality_checker.py \
  --pdf "outputs/{brand}/04_final_report/S10_{brand}_AI智能品牌优化方案全景报告.pdf" \
  --html "outputs/{brand}/04_final_report/S10_{brand}_AI智能品牌优化方案全景报告.html" \
  --output "outputs/{brand}/04_final_report/S11_{brand}_格式整理复核.json" \
  --strict
```

## 五、禁止事项

- 禁止通过删除正文来降低页数；
- 禁止把字号缩小到 8pt 以下作为主要压缩手段；
- 禁止裁切内容、图表或表格；
- 禁止保留或重新生成 `.source-stage-block h1` 来源一级标题；
- 禁止把分隔页压缩、优化或与正文合并；分隔页必须保留为独立整页；
- 禁止把问答树问题清单、问题优先级与内容承接矩阵、质量与风险闸门、句式模板、趋势机会坐标图或竞品心智地图重新带回客户报告；
- 禁止把“危机与错误信息回应模板”“下游注入规则”“重校触发条件”重新带回客户报告；
- 禁止出现阶段输出头注、输入/原则/数据源说明或本地绝对路径；
- 禁止使用或接受 `--no-cover-stitch`、`--keep-html-cover`、`no external cover`、双封面、缺封底或非官方封面模板；
- S11 未通过时，`final_delivery_packer.py` 必须阻断。

## 六、封面契约与通过条件

- S11 的默认行为不是“有封面就拼、没有就跳过”，而是“始终要求固定官方模板”。
- QA JSON 与 `S10_{brand}_全景报告数据.json.final_formatting` 必须包含 `cover_contract`：`passed=true`、模板文件名与 SHA、`asset_pages=2`、`a4=true`、`front_match=true`、`back_match=true`、`page_count_formula_passed=true`、`html_cover_replaced=true`。
- QA JSON 与 `S10_{brand}_全景报告数据.json.final_formatting` 还必须包含 `citation_chart_gate`，且须为 `required=true`、`passed=true`、`mode="stacked"`。
- `passed=true` 必须同时满足：无真正空白页、结构门通过、封面契约通过、引用图表分页门通过。`cover_stitch="no external cover"`、封面契约缺失、引用图表门缺失或任一必需值不为真时，必须 `passed=false`。
- 独立 `layout_quality_checker.py --strict` 必须重新读取最终 PDF，验证首尾指纹并复算引用图表页码，不能只复用 S11 自报结果。

## 最终交付硬要求：全景报告 PDF 是主交付物

最终交付不能只返回 ZIP。ZIP 只是可选归档包，不能替代客户可读的全景报告 PDF。本工作流不生成《问题监控数据文件》PDF。

完成 S10/S11 和全部质量门后，必须将以下 PDF 作为独立文件/独立附件返回：

1. `{brand_id}_AI智能品牌优化方案全景报告.pdf`

`FrontMind_{brand_id}_AI全景报告交付包.zip` 只能作为第二个可选归档附件。若最终只返回 ZIP，视为交付失败，必须补充导出并上传全景报告 PDF。


## 内容保护硬规则

S11 面对长报告时，只能做版式整理、空白压缩、分页优化和 PDF 重渲染。不得删除已通过 S10 客户版过滤的正文、差异化矩阵、日历、行动项或标题钩子；不得为了减少页数把内容改写为摘要。若页面变多，优先保留有效内容完整性。
