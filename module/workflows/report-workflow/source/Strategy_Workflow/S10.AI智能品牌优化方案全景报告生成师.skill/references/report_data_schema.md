# S10 全景报告数据 JSON 结构 — 本工作流 深度、覆盖与版面质量版

本工作流的原则是：**结构化 JSON 与完整清洗后的 Markdown 共同作为主输入；S10 必须证明每一阶段内容进入对应章节，S11 再完成成品排版。** S5.0 的问答监控数据与独立信源/引用分析数据必须分别由两个表格上传并确认。客户正文只呈现咨询结论、图表与行动建议，不呈现内部文件名、哈希、阶段编号、任务状态或推理过程。

## 报告逻辑链

```text
经营层摘要
→ 报告范围与诊断口径
→ 市场趋势与品类机会
→ 品牌定位与竞争战略
→ 品牌诊断与 AI 可见性
→ 用户意图与 12 周内容编排
→ 同章内容标题钩子
→ 语义/话语/视觉资产
→ 风险管理
→ GEO 战略选择
→ GEO 业务流程
→ S11 成品格式整理
```

## 核心 JSON 结构

```json
{
  "meta": {
    "brand": "品牌名",
    "company_name": "企业名称",
    "main_product": "核心产品/核心业务",
    "generated_at": "ISO-8601",
    "workflow_version": "本工作流"
  },
  "monitoring_summary": {
    "expected_records": "2 × 实际平台数 × 5",
    "actual_records": "实际记录数",
    "successful_records": "成功记录数",
    "failed_records": 0
  },
  "monitoring_records": [],
  "monitoring_data_source": "molizhishu_api",
  "monitoring_data_confirmation_status": "confirmed",
  "monitoring_partial_accepted": false,
  "strategy_sections": {
    "brand_facts": "S1 完整清洗正文",
    "marketing": "S2 完整清洗正文",
    "trends": "S3 完整清洗正文",
    "positioning": "S4 定位声明与分析正文",
    "diagnostic": "S5 诊断数据与 Gap 正文",
    "semantic": "S5.5 语义资产正文",
    "verbal": "S6 话语资产正文",
    "visual": "S7 视觉资产正文",
    "qa_architecture": "S8 问答报告正文",
    "enablement": "S9 业务赋能建议正文"
  },
  "structured_sources": {
    "paths": {},
    "brand_facts_json": {},
    "marketing_json": {},
    "trend_scorecard": {},
    "positioning_json": {},
    "diagnostic_json": {},
    "citation_analysis": {
      "meta": {
        "data_source": "uploaded_citation_analysis_spreadsheet",
        "data_confirmation_status": "confirmed"
      },
      "validation": {
        "passed": true,
        "reconciliation": {"passed": true}
      }
    },
    "semantic_scorecard": {},
    "verbal_tokens": {},
    "visual_prompt_pack": {},
    "qa_tree": {},
    "qa_matrix": {},
    "content_calendar": {},
    "s9_enablement_md_raw": "包含 recommended_business_actions 的 S9 Markdown"
  },
  "title_hooks": {
    "meta": {},
    "title_hooks": []
  },
  "source_files": {},
  "source_manifest": {
    "entries": [
      {
        "stage": "S1",
        "role": "brand_facts",
        "path": "绝对或工作区路径",
        "filename": "文件名",
        "size": 1234,
        "sha256": "64 位摘要"
      }
    ],
    "by_stage": {},
    "total_files": 0
  },
  "source_quality_gate": {
    "passed": true,
    "errors": []
  },
  "source_coverage_gate": {
    "checked_at": "ISO-8601",
    "passed": true,
    "sections": {
      "brand_facts": {
        "block_count": 1,
        "anchor_count": 0,
        "matched_anchors": 0,
        "weighted_coverage": 1.0
      },
      "s8_structured_coverage": {
        "content_calendar_titles": {"source_count": 12, "rendered_count": 12, "coverage": 1.0}
      },
      "title_hooks": {"source_count": 12, "rendered_count": 12},
      "structure_render": {
        "content_calendar": true,
        "title_hooks_after_calendar": true,
        "differentiation_matrix": true
      }
    },
    "errors": []
  },
  "template_compliance": {
    "passed": true,
    "errors": []
  },
  "report_richness_gate": {
    "visible_text_chars": 0,
    "content_modules": 0,
    "required_visible_text_chars": 0,
    "required_content_modules": 0,
    "gate_enforced": false,
    "passed": true,
    "errors": []
  },
  "pdf_generation": {
    "success": true,
    "cover_contract": {
      "passed": true,
      "template_filename": "frontmind_cover_front_back.pdf",
      "template_sha256": "e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d",
      "asset_pages": 2,
      "a4": true,
      "html_cover_replaced": true,
      "front_match": true,
      "back_match": true,
      "page_count_formula_passed": true
    }
  },
  "final_formatting": {
    "passed": true,
    "before_page_count": 0,
    "after_page_count": 0,
    "source_stage_h1_absent": true,
    "citation_chart_gate": {
      "required": true,
      "passed": true,
      "mode": "paired",
      "paired_same_page": true
    },
    "cover_contract": {
      "passed": true,
      "template_filename": "frontmind_cover_front_back.pdf",
      "template_sha256": "e37c51f793649fcf561c80d80b4b80ae1f70c470ec8a6956523b1795f369872d",
      "asset_pages": 2,
      "a4": true,
      "front_match": true,
      "back_match": true,
      "page_count_formula_passed": true,
      "html_cover_replaced": true
    },
    "analysis": {
      "blank_pages": [],
      "sparse_pages": []
    }
  }
}
```

## 必须可视化或完整呈现的内容

| 内容 | 推荐组件 |
|---|---|
| AI 可见性 | KPI 卡片 + 平台图表 + 品牌提及率 + 竞品占位 |
| 趋势优先级 | 评分表 + 机会摘要 + 优先级表（不生成坐标图） |
| 竞品卡位 | 带 `data-differentiation-matrix` 标记的真实差异化矩阵 |
| 语义资产 | BSAS 五维达成度条形图 + 维度明细 |
| 品牌信源覆盖（必需） | Top 信源条形图 + 高频内容/问题表；不展示三层对账/集中度 KPI 与模型引用量 |
| 品牌诊断 | S5 诊断结果 + Gap 结论 |
| 内容规划 | 完整 12 周内容日历 + 紧随其后的内容标题钩子小节 |
| GEO 落地 | 优先行动清单 + GEO 业务流程图 |

## 阻断规则

- 任一标准阶段文件缺失、深度不足、重复率过高或占位内容过多时，必须回到对应阶段；
- 每个来源块必须唯一且块内非空（覆盖率仅记录，**不再作为阈值阈断**）；
- S8 问答树/问答矩阵保留为内部输入；内容日历和 S9.8 钩子已生成即应渲染，且钩子必须紧随日历；
- S4 有差异化矩阵数据时必须渲染实际品牌/竞品值并输出 `data-differentiation-matrix` 标记；
- 不允许输出 `None`、`待补齐`、`暂无`、内部文件名、任务 ID 或推理过程；
- 不允许输出来源 `h1`、阶段输出头注、版本/日期/输入/原则/数据源说明、本地绝对路径或明确删除项；
- “危机与错误信息回应模板”“下游注入规则”“重校触发条件”必须按来源标题边界整节删除；保留的来源局部标题须剥离编号，最终正式分部编号不变；
- **字数/模块数门控已取消**：不再要求客户可见正文达 24000 字符或模块达 18 个；只要内容真实进入报告即可；
- S11 未通过空白页/稀疏页复核时，不得最终打包（独立整页分隔页被自动豁免）。
- 缺少已确认、三层对账通过的 `citation_analysis`，或未在语义资产审计下半部分渲染时必须阻断。
- 官方模板必须是固定 SHA 的 2 页 A4 `frontmind_cover_front_back.pdf`。客户 HTML 必须用官方第 1 页预览替换旧 HTML 封面；禁止 `--no-cover-stitch`、`--keep-html-cover`。最终 PDF 首尾视觉指纹必须分别匹配模板第 1/2 页。
