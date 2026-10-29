# Brand Apple 视觉系统实施记录

## 范围

本次改动仅适用于 `Brand` 模块的八个一级页面：

- `reports`
- `knowledge`
- `keywords`
- `intent`
- `response-logic`
- `enterprise-qa`
- `website`
- `website-settings`

所有适配都通过 `ModuleWorkspace` 内的 `.fm-brand-theme[data-brand-page]` 边界生效。从 Portal 渲染到 `body` 的知识库和网站设置弹窗使用 `.fm-brand-portal-theme` 恢复同一套令牌。本次没有改动其他模块、公共官网、服务端合同或数据库。

## 已实施的系统常量

- 字体：`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif`
- 主题色：FrontMind 紫 `#7542B0`
- 间距：8px 基础网格
- 圆角：卡片 20px、控件 12px、小元素 8px
- Material：`rgba(255, 255, 255, 0.72)`、`blur(20px) saturate(180%)`、`0.5px` 边界
- 动效：`300ms cubic-bezier(0.25, 0.1, 0.25, 1)`
- 主要点击目标：至少 44px
- Focus：FrontMind 紫 3px 外环
- 页面级入场：50ms 错峰，支持 `prefers-reduced-motion`

## RAG 仪表盘

仪表盘使用已确认的单色方案，不改变评分数据和阈值：

- 120 × 80 SVG 视口，半径 34，240° 圆弧
- 圆弧线宽 9，圆点半径 4.5，扣除圆半径 8，可见间距 3.5
- 分数依 0–100 真实映射，67 保持真实位置
- 中央分数上移 1 个 SVG 单位，整体上移 1px
- `0` 和 `100` 对称向内各收 0.5 个 SVG 单位
- 状态圆点与文字间距 16px
- 圆点使用 `#7542B0`，圆弧使用中性灰
- 不包含四色圆弧、悬停分数、长按浮层或范围提示
- 缺失、非有限或超出 0–100 的值不渲染圆点，也不会被夹成伪有效分数

## 静态审计结果

### 字体

`module/client/brand-apple-theme.css` 内没有 `Inter`、`Roboto`、`Helvetica`、`Arial` 或 `Open Sans`。被迁移页面根节点和 QA 管理品牌区都显式覆盖为系统字体栈。客户站点预览中由模板决定的衬线字体不属于 Brand 管理外壳，保持原样。代码和运行 ID 仍使用等宽字体。

### 颜色边界

旧的局部 CSS 仍包含蓝色默认值，但在 `website-settings` 主题边界中已由更高特异度的 FrontMind 紫适配器覆盖。这些旧值需要保留，以免改变不在本次范围内的独立预览。

客户站点的 `--sfp-site-accent`、`--sfp-widget-accent`、`--awp-site-accent`、`--aqwp-widget-color` 和 `--portal-accent` 仍由运行时选择值控制；Brand 紫只覆盖管理界面。

### 动效

管理界面的新增 transition 全部使用统一动效令牌。保留两类例外：

- 进度 spinner 的线性旋转，它表示真实进度而不是装饰转场；
- 客户网站预览画布的局部宽度过渡，它被明确排除在 Brand 管理控件适配器之外。

### Inline style

`ModuleWorkspace` 中的静态后备按钮样式已改为共享 class。保留的 inline style 都依赖运行时数据：

- 客户选择的网站、助手、导航、页脚和背景颜色；
- 图表点位、评分环角度和进度宽度；
- 用户上传的背景图；
- 可展开导航的实时旋转状态。

### 8px 网格例外

下列值不是页面布局间距，因此保留：

- 0.5px Material 边界、3px focus 环和 4px 非对称聊天气泡角；
- RAG SVG 的 1px 光学位移、3.5 间隙、4.5 半径、9 线宽和 13.5px 端点字号；
- 图标、进度条和 SVG 坐标；
- 24px 的开关视觉轨道，按钮使用伪元素扩展为 44px 点击目标。

## 已完成的本地验证

- RAG 定向回归：6 个测试文件，65 项通过
- 建站和网站设置定向回归：6 个测试文件，42 项通过
- 主题边界与路由定向回归：2 个测试文件，16 项通过；浏览器发现的知识库旧控件尺寸修正后，主题合同单测 8 项再次通过
- 根项目 `pnpm typecheck` 通过
- Node workflow 合同测试：25 / 25 通过
- 完整 Vitest：100 个测试文件通过，909 项通过，2 项按仓库配置跳过
- `pnpm build` 通过；Vite 仅报告既有的第三方 `use client` 与大 chunk 提示
- `git diff --check` 通过

浏览器使用当前工作树自己的 Vite preview fixture，实际验证了 1280 × 900、1024 × 768 和 400 × 844 三档：

- `reports`、`knowledge`、`keywords`、`intent`、`response-logic`、`enterprise-qa`、`website` 均能进入各自主题边界；
- 三档均未出现页面级横向溢出；
- 1024px 和 400px 下，除 checkbox / radio 以及由伪元素扩展点击区的开关轨道外，可见普通按钮和输入控件没有低于 44px；
- 应答逻辑通过“词库 → 优化清单 → 进入应答逻辑”的真实本地预览路径验证；
- `website-settings` 是宿主内部页面，不在 standalone 导航中；其路由 props、主题边界、Portal class 和 600px 断点由组件回归与主题合同测试验证。

`accept:ai-website` 已用本地 URL 和系统 Chrome 启动，但该脚本只接受真实宿主上下文中的 `enterprise-rag-live-root` / `website-builder-live-root`。仓库的 Vite 开发入口明确固定为 preview fixture，因此脚本在 live-root 断言处停止；没有启用付费参数，也没有生成、修订、重置、删除或发布网站。这是本地运行模式边界，不以修改产品代码绕过。

## 交付边界

本文档记录的都是当前工作树内的本地工程验证。它不表示代码已推送、合并、部署或在生产环境验收。
