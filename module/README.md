# FrontMind 品牌建设与 AI 官网

公开仓库：https://github.com/xiafanzeng/frontmind-brand
开发域名：https://brand.frontmind.cn/

`module/` 对应主仓 `modules/brand/`；公开仓 `standalone/` 是独立启动壳，不合回 Dashboard。

## 业务代码

知识库、词库、企业问答、品牌跟踪、模板检索、建站、DNS、域名授权、网站产物和发布状态。页面在 `client/`，业务服务在 `server/`，表定义在 `schema/`，后台处理在 `worker/`，有效工作流在 `workflows/`（各目录按实际业务存在）。

重点入口：`server/siteops/`（阿里云/OAuth/DNS/部署/产物）、`server/twenty-first-service.ts`（模板 API）、`server/jenova-brand-tracking-client.ts` 和 `server/jenova-brand-tracking-service.ts`（跟踪请求/恢复）、`server/enterprise-qa-*.ts`（问答提示与校验）。

新增后端 API 从 **`server/http-api.ts`** 开始，挂在 `/api/modules/brand/`。此注册函数由真实开发环境和主仓共同装载；在本模块命名空间新增路径不需要修改主仓的逐接口允许清单。现有 API 地址保留。

## 开发方式

公开仓根目录执行 `pnpm install --frozen-lockfile`、`pnpm dev`；检查使用 `pnpm typecheck`、`pnpm test`、`pnpm build`。本地预览使用合成数据；真实保存、任务、上传下载和供应商调用在开发子域名检查。

先用 delivery skill 导出准确线上 SHA，交给 Pro 修改并返回 ZIP，再用 delivery skill 提交/部署子域名，验收后用 sync skill 合回主仓。见 [API 开发说明](API_DEVELOPMENT.md) 和 [Pro 交接规则](PRO_GUIDE.md)。

## 运行基础设施

主仓装配真实登录/租户或开发固定工作区、数据库连接、统一资金、文件存储和通用 AI 执行器。业务请求参数、状态机及结果解释由本模块维护。已有测试凭据在服务器配置，组员修改服务端调用代码后沿用它们，无需在本地拿 Key；新增供应商/新凭据仍需管理员配置服务器。服务端可读取注入环境，任何密钥都不得返回浏览器或写入公开 Git/ZIP。

开发入口可用、配置存在或本地测试通过，均不等于所有付费业务链路已验收；HANDOFF 必须记录实际检查范围。

## 固定模板目录初始化

模板源码、目录版本、执行准入和初始化命令均由本模块维护。成员可在本仓构建和初始化目录，无需 Core 数据库或供应商 Key。首次初始化下载冻结的公开源码、预览图与 #22 的媒体；已有完整 v2 缓存时复用前 32 项资产，保留 v2 目录供历史任务读取。

在公开仓根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build:business
pnpm --dir module exec playwright install chromium
pnpm --dir module catalog:ensure
pnpm --dir module catalog:check
```

`catalog:ensure` 调用编译后的 `dist/server/siteops/prepare-module-assets.js --ensure-ready --concurrency 1`。它在当前目录已就绪时只检查 manifest、完整性记录和文件状态并返回 `reused: true`；需要升级时才下载或构建。`catalog:check` 使用 `--check-active` 全量校验资产 SHA256，报告实际 active 版本、源码要求的版本和可执行模板数；校验失败时退出码为 1。两者都输出一行 JSON，可用于发布脚本。`--help` 返回 CLI 版本、能力和参数，不加载编译器。

本地默认资产路径是命令工作目录下的 `.frontmind-dashboard-assets/`。部署时必须把 `FRONTMIND_DASHBOARD_ASSET_DIR` 指向持久化资产目录；也可显式传入绝对路径：

```sh
node module/dist/server/siteops/prepare-module-assets.js --ensure-ready --root /absolute/path/to/assets --concurrency 1
node module/dist/server/siteops/prepare-module-assets.js --check-active --root /absolute/path/to/assets
```

初始化应在独立维护进程或容器中运行，建议至少 1536 MiB 内存、1 CPU、并发 1；不要放进 640 MiB 的 API 进程。受控 Vite 子进程的堆上限为 768 MiB，Chromium 还需要额外内存。Linux 容器需提前安装 Playwright Chromium 及系统依赖。

v3 有 35 个模板，分页为 `8 / 8 / 8 / 8 / 3`；v2 历史任务继续按 32 项、4 页读取。#22 与新增的 #33–35 必须全部通过受控 Vite 编译、静态检查和真实 Chromium 检查，目录才算就绪；其余模板保留预览并标明尚未准入。升级复用 #22 已验证的规范化源码，但重新生成当前版本的构建和浏览器检查结果。本地验收覆盖目录升级与三个新模板的真实编译/浏览器检查，不代表付费官网生成全链路已验收。
