# FrontMind 本地帮助中心模板

本目录存放 FrontMind 自制（curated）的静态站点模板源码。每个子目录是一个自包含的
Vite React 模板，通过 `static-template-catalog-manifest.ts` 注册进固定模板目录，
源码与预览图钉扎（pin）在本仓库的固定 commit 上，由种子脚本从 GitHub 拉取并完成
受控准入。

## 排版与配色分离

同一套排版支持多种配色。配色通过根节点的 `data-palette` 属性切换，全部颜色都定义
在 `src/index.css` 顶部的调色板块中，业务样式只引用变量：

- `:root, [data-palette="azure"]` —— 默认配色（蔚蓝）
- `[data-palette="warm" | "navy" | "forest" | "plum"]` —— 其余命名配色

每个调色板同时导出系统蓝图四色变量（`--canvas` / `--ink` / `--accent` /
`--muted`），物化运行时可以直接覆盖这四个变量实现客户级调色。

模板内 `src/content.ts` 的 `siteMeta.palette` 决定默认配色；`App.tsx` 把它挂到根
节点。切换配色只需改这一个字段。

## 模板清单

| 目录 | 排版 | 默认配色 | 适用场景 |
| --- | --- | --- | --- |
| `helpcenter-search` | 搜索中心式：大标题搜索区 + 分类卡片 + 热门文章 + FAQ | azure | 面向客户的服务支持门户 |
| `helpcenter-docs` | 侧边栏文档式：左侧分类导航 + 分组文章 + 右侧本页目录 | navy | 层级较深的产品文档站 |
| `helpcenter-minimal` | 极简单栏式：杂志式文章列表 + 紧凑 FAQ | forest | 内容量少的轻量帮助页 |

内容模型（分类 / 文章 / FAQ / 联系方式）在三套排版之间保持同构，同一知识库可以
零成本切换排版与配色。

## 约束

- 只依赖 `react` / `react-dom`，禁止其他运行时依赖（受控构建的依赖闭包限制）。
- 禁止任何远程资源引用（图片、字体、脚本）；图形一律内联 SVG。
- 入口固定为 `src/App.tsx`，`src/main.tsx` 仅作 CSS 追踪引导，会被受控壳替换。
- JSX 使用 automatic 运行时，无需 `import React`。
- `package.json` 必须保持惰性（无安装脚本），版本由受控构建统一改写。

## 新增一个自制模板

1. 复制一套现有排版目录，调整结构与内容模型，补齐 5 套配色块。
2. 用 1200px 宽的整页截图作为预览图，放到 `previews/` 下。
3. 在 `static-template-catalog-manifest.ts` 追加一行：源指向本仓库（owner
   `xiafanzeng` / repo `frontmind-brand`），`sourceCommitSha` 填包含模板与预览图
   的已推送 commit，`sourceSubdirectory` 指向模板目录，`previewUrl` 使用该 commit
   的 raw.githubusercontent.com 链接。
4. 提升目录版本常量并同步 `ENTRY_COUNT` / `PAGE_COUNT`，跑
   `siteops:seed-template-catalog` 重新物化；FrontMind 自制条目会自动进入完整准入
   通道（见 `static-template-execution-admission.ts` 的 curated 判定）。
