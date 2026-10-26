---
name: frontmind-verbal-identity-architect
description: >
  S6 品牌话语体系（策略层第 6 位 / 品牌语言中枢）。输出可被 内容生成 直接 system-prompt
  注入的话语手册和机器可执行的话语 Token JSON。
  适用场景：S5 品牌诊断完成后触发。
---

# 品牌话语体系 (Verbal Identity Architect)

从品牌定位声明出发，构建完整的品牌语言体系——包括语调、词汇、句式和禁忌——并输出**人类可读的话语手册**和**机器可执行的话语 Token JSON**，供后续内容生产层 后续内容生成任务直接注入 system-prompt。

**上游**：`S4_{brand}_定位声明.json`（S4）+ `S5_{brand}_Gap报告.md`（S5）+ `S1_{brand}_品牌事实图谱.json`（S1）
**下游**：`S6_{brand}_话语手册.md` （PDF 由 S0 统一生成） + `S6_{brand}_话语token.json` → S7 视觉符号体系、S8 问答架构师、S9 业务赋能规划师、后续内容生成任务

---

## 标准输入输出文件

**输入文件**：

| 输入项 | 文件名规范 | 来源 | 必要性 |
| :--- | :--- | :--- | :--- |
| 品牌定位声明 | `S4_{brand}_定位声明.json` | S4 | **必须** |
| Gap 报告 | `S5_{brand}_Gap报告.md` | S5 | **必须** |
| 品牌事实图谱 | `S1_{brand}_品牌事实图谱.json` | S1 | **必须** |

**输出文件**：

| 输出物 | 文件名规范 | 格式 | 下游消费者 |
| :--- | :--- | :--- | :--- |
| 话语手册 | `S6_{brand}_话语手册.md` | Markdown | 操作者、客户、S7/S8/S9 |
| 话语手册 PDF | `S6_{brand}_话语手册.pdf` | PDF | 操作者、客户 |
| 话语 Token | `S6_{brand}_话语token.json` | JSON | 内容生成（system-prompt 注入）、S7、S8 |

---

## 绝对禁止事项

1. **禁止输出无实质内容的话语手册**：每个章节必须有具体的品牌化内容，不允许通用模板。
2. **禁止话语 Token 与定位声明脱节**：所有 token 必须可追溯到 S4 定位声明。
3. **禁止遗漏 Token JSON**：话语手册和 Token JSON 必须同时输出，缺一不可。
4. **禁止高频词少于 30 个**：高频词列表必须覆盖品牌核心概念、产品特性、价值主张。
5. **禁止禁用词少于 15 个**：禁用词必须包含竞品名、敏感词、空话词。

---

## 核心要求：思维链（CoT）与垂直行业语境

在构建话语体系时，必须在思考过程中显式输出以下思维链（CoT）：
1. **行业语境识别**：判断品牌所属的垂直行业，并提取该行业特有的"黑话"或"行话"。
2. **受众心智映射**：分析目标受众（如 C端小白 vs B端专家）对专业术语的接受度，决定语调的"降维"或"升维"策略。
3. **禁忌词推导**：结合《广告法》和行业红线，推导必须规避的敏感词汇。

**垂直行业特定话语逻辑（示例）**：
| 行业类型 | 语调倾向 | 高频词特征 | 典型禁用词/红线 |
| :--- | :--- | :--- | :--- |
| **SaaS / 软件** | 专业、赋能、降本增效 | 敏捷、闭环、全链路、开箱即用 | "绝对安全"、"永不宕机" |
| **电商 / 消费品** | 热情、共情、场景化 | 沉浸式、平替、氛围感、宝藏 | "最"、"极"、"国家级"（广告法红线） |
| **大健康 / 医疗** | 严谨、克制、科学 | 临床验证、靶点、依从性、循证 | "包治百病"、"根除"、"无副作用" |
| **ToB 制造 / 服务** | 务实、可靠、长期主义 | 产能、良率、交付周期、全生命周期 | "万能"、"零误差" |

---

## 核心概念：品牌话语体系四维模型

> **详细方法论**：参见 `references/verbal-identity-method.md`。

品牌话语体系 = **Tone（语调）** + **Vocabulary（词汇）** + **Syntax（句式）** + **Taboo（禁忌）**

| 维度 | 定义 | 输出形式 |
| :--- | :--- | :--- |
| Tone | 品牌说话的方式和态度 | 4 维度打分 + 语调描述 |
| Vocabulary | 品牌专属词汇库 | 高频词列表 + 品牌术语表 |
| Syntax | 品牌标准表达句式 | 句式模板 + 品牌谚语 |
| Taboo | 品牌绝对不使用的表达 | 禁用词列表 + Do/Don't 对照 |

---

## 工作流程

### Step 1：提取定位核心概念

从 S4 定位声明中提取构建话语体系的核心锚点：

```python
import json

with open(f"S4_{brand}_定位声明.json", "r") as f:
    positioning = json.load(f)

# 提取核心概念
target_audience = positioning["positioning_statement"]["target_audience"]
category = positioning["positioning_statement"]["category"]
differentiator = positioning["positioning_statement"]["differentiator"]
functional_value = positioning["value_triangle"]["functional_value"]
emotional_value = positioning["value_triangle"]["emotional_value"]
self_expression = positioning["value_triangle"]["self_expression_value"]
```

同时从 S5 Gap 报告中提取话语维度的偏差，作为修复方向。

### Step 2：构建 Messaging House

Messaging House（信息屋）是话语体系的结构骨架：

```
┌─────────────────────────────────────────────┐
│              品牌核心信息（一根梁）              │
│    "{differentiator} 的 {category} 品牌"      │
├─────────┬─────────────┬─────────────────────┤
│  支柱 1  │    支柱 2    │       支柱 3        │
│ 功能价值  │   情感价值   │    自我表达价值      │
│ {func}   │  {emotion}  │    {self_expr}      │
├─────────┴─────────────┴─────────────────────┤
│              证据砖（Evidence Bricks）          │
│  案例 A │ 数据 B │ 资质 C │ 评测 D │ 奖项 E   │
└─────────────────────────────────────────────┘
```

每根支柱下必须有 3-5 个关键信息点，每个信息点必须有对应的证据砖。

### Step 3：定义 Tone of Voice

使用 4 维度语调光谱，每个维度 1-5 分：

| 维度 | 极端 A（1 分） | 极端 B（5 分） | 品牌打分 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| 正式度 | Formal（正式） | Casual（随意） | {1-5} | {说明} |
| 严肃度 | Serious（严肃） | Funny（幽默） | {1-5} | {说明} |
| 尊重度 | Respectful（尊敬） | Irreverent（不羁） | {1-5} | {说明} |
| 热情度 | Matter-of-fact（客观） | Enthusiastic（热情） | {1-5} | {说明} |

每个维度的打分必须基于 S4 定位声明和目标人群特征，并给出打分理由。

语调描述示例：
> "我们的语调是**专业但不冰冷**的。像一位经验丰富的行业顾问，用数据说话但不忘关怀。我们避免过度营销的浮夸，也避免学术论文的枯燥。"

### Step 4：编写品牌谚语

品牌谚语是品牌最核心的 3-5 条表达，要求朗朗上口、可记忆、可传播：

| 编号 | 谚语 | 使用场景 | 对应支柱 |
| :--- | :--- | :--- | :--- |
| P1 | {品牌口号} | 所有对外传播 | 核心梁 |
| P2 | {功能价值金句} | 产品介绍/技术文档 | 支柱 1 |
| P3 | {情感价值金句} | 品牌故事/用户沟通 | 支柱 2 |
| P4 | {行业地位金句} | 行业活动/媒体采访 | 支柱 3 |
| P5 | {用户证言金句} | 案例展示/社交媒体 | 证据砖 |

### Step 5：构建 Do / Don't 清单

至少 10 对 Do / Don't 对照：

| 编号 | Do（推荐表达） | Don't（禁止表达） | 原因 |
| :--- | :--- | :--- | :--- |
| 1 | "我们帮助客户实现..." | "我们是最好的..." | 避免空洞自夸 |
| 2 | "基于 XX 数据..." | "众所周知..." | 用证据替代断言 |
| 3 | "XX 技术赋能..." | "颠覆性的..." | 避免过度营销 |
| 4 | "{品牌名}" | "{竞品名}" | 不提竞品 |
| 5 | "为 {目标人群} 设计" | "适合所有人" | 聚焦目标人群 |
| 6 | ... | ... | ... |
| 7 | ... | ... | ... |
| 8 | ... | ... | ... |
| 9 | ... | ... | ... |
| 10 | ... | ... | ... |

### Step 6：抽取话语 Token JSON

将以上所有内容结构化为机器可执行的 JSON 文件：

```json
{
  "meta": {
    "brand": "{brand}",
    "version": "1.0",
    "generated_at": "2026-04-27",
    "source_positioning": "S4_{brand}_定位声明.json"
  },
  "tone_tokens": {
    "formal_casual": 2,
    "serious_funny": 2,
    "respectful_irreverent": 1,
    "matter_of_fact_enthusiastic": 3,
    "tone_description": "专业严谨但不冰冷，数据驱动但有温度"
  },
  "messaging_house": {
    "core_message": "...",
    "pillar_1": { "name": "功能价值", "key_points": ["...", "...", "..."] },
    "pillar_2": { "name": "情感价值", "key_points": ["...", "...", "..."] },
    "pillar_3": { "name": "自我表达", "key_points": ["...", "...", "..."] },
    "evidence_bricks": ["案例A", "数据B", "资质C", "评测D", "奖项E"]
  },
  "high_freq_words": [
    "品牌核心词1", "品牌核心词2", "产品特性词1", "产品特性词2",
    "价值主张词1", "技术术语1", "行业术语1", "..."
  ],
  "banned_words": [
    "竞品名A", "竞品名B", "颠覆性", "最好的", "众所周知",
    "独一无二", "无与伦比", "..."
  ],
  "sentence_patterns": [
    "作为{category}领域的{differentiator}，{brand}为{target}提供{value}。",
    "基于{evidence}，{brand}已帮助{number}+客户实现{outcome}。",
    "{brand}的{product}通过{technology}，让{target}能够{benefit}。",
    "在{scenario}场景下，{brand}是{target}的{positioning}选择。",
    "从{starting_point}到{end_point}，{brand}全程陪伴{target}的{question_path}。"
  ],
  "slogan_candidates": [
    { "text": "...", "scenario": "全场景", "pillar": "core" },
    { "text": "...", "scenario": "产品介绍", "pillar": "pillar_1" },
    { "text": "...", "scenario": "品牌故事", "pillar": "pillar_2" }
  ],
  "do_dont_pairs": [
    { "do": "...", "dont": "...", "reason": "..." }
  ]
}
```

Token JSON 必须通过 `scripts/token_validator.py` 校验。

### Step 7：渲染话语手册 Markdown（强制要求；PDF 由 S0 仅在 S10 全景报告完成后按显式运行参数统一生成；默认跳过，不等待用户确认）


基于 `templates/verbal_handbook_template.md` 模板，填充所有内容生成话语手册：

```bash
# 校验 Token JSON
python3 S6.品牌话语体系.skill/scripts/token_validator.py S6_{brand}_话语token.json

# 不生成 PDF；PDF 由 S0 仅在 S10 全景报告完成后按显式运行参数统一生成；默认跳过，不等待用户确认
```

---


---

## 产出交付规则（本工作流 新增）

**产出交付规则（本工作流 覆盖）**：本节点不是全局暂停点时，必须把所有 JSON/MD/资产文件真实落盘并通过校验，但不得在对话框发送附件或展开正文；完成后静默交回 S0 继续。只有 S4.8 固定问题确认、S5.0 监控数据确认和最终交付允许面向用户发送文件。

## 校验闸门

| 序号 | 校验条件 | 不达标动作 |
| :--- | :--- | :--- |
| 1 | Tone 4 维度全部有打分（1-5 分） | 打回补充 |
| 2 | Messaging House 三根支柱均有 ≥ 3 个关键信息点 | 打回补充 |
| 3 | 品牌谚语 ≥ 3 条 | 打回补充 |
| 4 | Do/Don't ≥ 10 对 | 打回补充 |
| 5 | 高频词 ≥ 30 个 | 打回补充 |
| 6 | 禁用词 ≥ 15 个 | 打回补充 |
| 7 | 句式模板 ≥ 5 条 | 打回补充 |
| 8 | Token JSON 通过 schema 校验 | 修复后重新校验 |
| 9 | **`S6_{brand}_话语手册.md` 存在且非空；PDF 不作为 S6 完成条件** | **强制打回重做** |

---

## 子文件引用

| 文件路径 | 用途 | 引用时机 |
| :--- | :--- | :--- |
| `references/verbal-identity-method.md` | 话语体系构建的完整方法论 | Step 1-5 |
| `templates/verbal_handbook_template.md` | 话语手册输出模板 | Step 7 |
| `templates/verbal_token_schema.json` | 话语 Token JSON Schema | Step 6 校验 |
| `scripts/token_validator.py` | Token JSON 校验器 | Step 6-7 |

---

## 下游注入说明

### 后续内容生成任务如何使用话语 Token

内容生成 在生成每篇文章时，必须将话语 Token JSON 作为 system-prompt 的一部分注入：

```python
# 内容生成 加载话语 Token
with open(f"S6_{brand}_话语token.json", "r") as f:
    tokens = json.load(f)

# 构建增强 system prompt
system_prompt = f"""
你是 {brand} 的品牌内容撰写专家。

【语调要求】
{tokens["tone_tokens"]["tone_description"]}
正式度：{tokens["tone_tokens"]["formal_casual"]}/5
热情度：{tokens["tone_tokens"]["matter_of_fact_enthusiastic"]}/5

【必须使用的高频词】
{", ".join(tokens["high_freq_words"][:20])}

【禁止使用的词汇】
{", ".join(tokens["banned_words"])}

【标准句式参考】
{chr(10).join(tokens["sentence_patterns"])}
"""
```

内容生成 完成文章后，必须计算话语 Token 命中率（≥ 70% 才放行）。


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

当本 Workflow 在 外部 Agent 中运行时，`S6` 不得只用模型常识或聊天总结完成，必须独立调用 Wide Research，并将本阶段资料检索、证据来源、分析结论和规定产物落盘。

完成 `S6` 后必须写入：

```text
outputs/{brand_id}/_execution/S6_{brand_id}_wide_research_manifest.json
```

manifest 必须包含：

```json
{
  "stage_id": "S6",
  "used_wide_research": true,
  "status": "done",
  "research_queries": ["..."],
  "external_sources": [{"title": "...", "url": "...", "used_for": "..."}],
  "generated_files": ["..."],
  "evidence_notes": "..."
}
```

若本阶段没有 Wide Research manifest，S10 前的 `stage_execution_checker.py --strict` 必须阻断。不得用“并行研究完成”替代本阶段文件。
