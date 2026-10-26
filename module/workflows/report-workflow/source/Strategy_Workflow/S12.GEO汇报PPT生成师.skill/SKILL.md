---
name: frontmind-geo-report-ppt-generator
description: >
  S12 GEO 整体汇报方案 PPT 生成师。在 S10/S11 全景报告 PDF 交付后，参考已交付
  （速境版）的 13 页形式，用 ppt-master quick-generate 流程产出
  FrontMind_{brand}_GEO整体汇报方案.pptx（1280×720 原生可编辑），并完成逐页视觉质检。
---

# S12 GEO 整体汇报方案 PPT 生成师

## 一、触发与前置

- 触发时机：S11 通过 + final_delivery_packer 成功之后（PDF 主交付已存在）。
- 输入：`S10_{brand}_全景报告数据.json`、S5/S5.5 诊断 JSON、S9 行动建议、S7 视觉 Prompt 包（真实色值）、S1 事实图谱。
- 参考交付：`references/FrontMind_速境Speediance_GEO整体汇报方案.pptx`（13 页结构范本）。
- 制作工具：ppt-master skill（https://github.com/hugohe3/ppt-master）。
  - 定位方式（按序）：① 环境变量 `PPT_MASTER_SKILL_DIR`；② `<本Workflow根>/../ppt-master-work/ppt-master/skills/ppt-master`；③ 全局 `~/ppt-master/skills/ppt-master`；④ 都没有则 `git clone https://github.com/hugohe3/ppt-master` 后使用 `skills/ppt-master`。
  - 必须走 `attribution_guard.py` → `workflows/routing.md` → `workflows/profiles/quick-generate.md` 的 quick-generate 路由。

## 二、13 页结构（与参考版逐页对齐）

```text
1 封面（hero 数字 = 提及率 基线→90天；四诉求卡）
2 GEO 认知（搜索迁移 / GEO vs SEO / 品类为何先被重构 / 三平台性格）
3 现状诊断（5 KPI 磁贴 + 风险卡 + 信源分层条形）
4 总体策略（一条主线三阶段 + 四诉求映射 + 七步执行链）
5 模块一 品牌定义权与叙事统一（诉求①）
6 模块二 线索挖掘与办事/购买占位（诉求②）
7 模块三 舆情防御与信任修复（诉求③）
8 模块四 权威背书体系曝光（诉求④）
9 里程碑 3 个月（W1-4/W5-8/W9-12 + 六项量化指标表）
10 里程碑 6 个月（BSAS 五维爬坡 + 平台扩容 + 目标带）
11 成效看板（三平台提及率分组柱状图 + 五条监测纪律 + 深色指标带）
12 服务与协作（七步泳道 + 服务五项 + 企业侧角色）
13 总结（诊断/路线/承诺/行动 + 核心数字回顾）
```

## 三、硬性口径

1. **KPI 全篇一致**：封面 hero 数字 = 里程碑表 = 总结页 = 看板图表数据，全部取自 S5/S5.5 实测基线；目标值注明"方案设定值，以复测为准"。
2. **配色**：品牌 VI 色系（S7 约束模式真实提取色优先），避免与已交付方案撞色（速境=绿色系）。已知已用色系：速境绿、人才中心红蓝、仟源/安护通/博士科技各版——新项目先看工作区根目录已交付 PPT。
3. **合规**：竞品描述中性客观；无"唯一/第一/最"等广告法绝对化用语；已核事实与企业自述分层（自述标"需核验后引用"）；食品/医疗类注明合规红线；目标均注明"方案设定值，以复测为准"。
4. **有基线企业**用 现状实测→3个月→6个月；**无基线新品牌**改用"从零到一"口径（三源上线/实体认知率/信源数从 0 起步），6 个月目标定低并在页面注明口径。
5. 无图片素材时注明"无图片素材，用纯编辑排版+图标"；有素材则封面照片打底/模块页产品图/字标水印。

## 四、执行流程（quick-generate）

1. `project_manager.py init <项目名> --quick-generate`；`source_to_md.py` 转换 S10 PDF 为源 Markdown 后 `import-sources`。
2. 读规划批量参考（plan-core / canvas-formats / visual-styles 索引等），冻结 13 页 roster（画布 1280×720，`lang="zh-CN"`）。
3. `icon_sync.py` 同步 tabler-outline 图标池；`text_measure.py calibrate` 校准 title/body/kpi/annotation 四角色。
4. 逐页手写 SVG（断言式标题 + data-journalism 风格；≥7 页时 P05 后跑 early 门）。
5. `svg_quality_checker.py <proj> --quick-generate --canonical-authoring --stage final --json` 必须 0 errors。
6. `svg_to_pptx.py <proj> --quick-generate --no-notes -o <草稿>.pptx`。
7. **字体加固**：`python3 scripts/pptx_font_hardening.py <草稿>.pptx <成品>.pptx`（主题引用→显式 YaHei、noAutofit、TextBox 增高；缺这步 LibreOffice/WPS 中文空白或裁断）。
8. **逐页视觉质检**：`python3 scripts/render_pptx_pages.py <成品>.pptx <qc_dir> --dpi 100`，对 13 张 PNG 逐页检查文字溢出/重叠/乱码/错位/对比度（可交付给视觉评审代理）。发现问题→改 SVG→重复 5-7；全过才算完成。
9. 成品命名 `FrontMind_{brand_name}_GEO整体汇报方案.pptx`，交付到**工作区根目录**（与全景报告 PDF 并列）。

## 五、产出与 manifest

```text
工作区根目录/FrontMind_{brand}_GEO整体汇报方案.pptx        （主交付）
outputs/{brand}/_execution/S12_{brand}_ppt_execution_manifest.json
```

manifest 必含：`stage_id=S12`、`tool=ppt-master quick-generate`、`pages=13`、`kpi_source`（S5/S5.5 文件路径）、`qc_rounds`（视觉质检轮次与结论）、`final_pptx`（绝对路径）、`status=done`。

## 六、禁止事项

- 禁止跳过视觉质检直接交付；
- 禁止 KPI 口径与全景报告不一致；
- 禁止使用广告法绝对化用语；
- 禁止在字体加固前的导出件上交付（中文渲染不达标）。
