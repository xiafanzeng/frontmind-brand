# 品牌建设：能力与验收记录

## 记录基线

- 模块：`brand`。
- 审阅的业务源码：[`83c19bc35439512d703f91b44d529c6fa2834df3`](https://github.com/xiafanzeng/frontmind-brand/tree/83c19bc35439512d703f91b44d529c6fa2834df3)。
- 整理日期：2026-09-16。本清单记录已执行检查与仍待补充的验收。
- 开发域名：[brand.frontmind.cn](https://brand.frontmind.cn)。实际运行版本以 `/api/version` 的 `moduleSha` 和 `coreSha` 为准。

“源码已包含”“本地检查通过”“真实业务验收通过”分别记录，不能互相替代。文档合并不会更新正在运行的镜像。

## 能力清单

| 能力 | 源码能力 | 主要源码 | 本地验证 | 真实业务验收 |
|---|---|---|---|---|
| 资料与知识库 | 已包含：材料上传、持久化、进度与快照读取、文件及成果下载接口。 | `module/client/components/EmbeddedKnowledgeBasePanel.tsx`；`module/server/knowledge-base-upload-api.ts`；`module/server/knowledge-snapshot-service.ts` | 见下方本地检查；不据此推定真实业务通过。 | 上传、保存、刷新、下载待验收。 |
| 知识构建与恢复 | 已包含：知识构建、确认、结束、恢复 worker、历史来源和产物绑定；按工作流哈希读取原归档。 | `module/server/knowledge-base-execution.ts`；`module/server/knowledge-base-recovery-worker.ts`；`module/server/knowledge-base-skill-runtime.ts`；`module/workflows/socratic-kb-builder/` | 见下方本地检查；不据此推定真实业务通过。 | 真实供应商构建、人工确认和中断恢复未验收。 |
| 知识节点维护 | 已包含：节点工作区、手工编辑、AI 编辑、重置及快照服务。 | `module/server/knowledge-node-manual-edit-service.ts`；`module/server/knowledge-node-edit-service.ts`；`module/server/knowledge-base-reset-service.ts` | 见下方本地检查；不据此推定真实业务通过。 | 编辑持久化和重置待验收；AI 编辑未做付费执行。 |
| 品牌词库 | 已包含：词表展示、词库生成业务、任务处理和所属工作流。 | `module/client/dashboard/ManagedKeywordTables.tsx`；`module/server/brand-question-universe-service.ts`；`module/worker/keywords.ts`；`module/workflows/generate-brand-question-universe/` | 见下方本地检查；不据此推定真实业务通过。 | 词库读取和保存待验收；供应商生成未验收。 |
| 企业问答 | 已包含：企业问答页面和对应业务会话入口。 | `module/client/dashboard/EnterpriseQaWorkspace.tsx`；`module/server/conversations.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实问答生成和刷新恢复未验收。 |
| 已有 SiteOps 建站链路 | 已包含：建站会话、状态机、构建、worker 和静态公司站工作流源码。 | `module/client/dashboard/siteops/`；`module/server/siteops/`；`module/workflows/react-static-company-site-workflow-v2.6.0/` | 见下方本地检查；不据此推定真实业务通过。 | 真实生成、产物发布和客户域名发布均未验收；需要供应商配置及指定测试目标。 |
| AI 官网草稿设置 | 已包含：保留原有草稿设置、预览分析和部件配置页面。 | `module/client/dashboard/knowledge-frontend/KnowledgeFrontendSettings.tsx` | 见下方本地检查；不据此推定真实业务通过。 | 按旧功能现状提供，不计为新增完成的真实建站能力。 |

## 已完成的本地检查

名称修改基线完成 frozen install、typecheck、35 项 Vitest 测试、1 项工作流版本 Node 测试和完整 build。随后草稿归属与会话稳定性修复完成 typecheck、完整 build 及 34 项 focused 回归，覆盖空草稿经真实 HTTP router 保存后读取、多组件挂载、同值通知、历史任务恢复和显式启动查询。两组测试有重叠，不将其相加为测试总数。

本轮修改包均经过 delivery skill 的路径检查、准确基线候选和隔离三方合并，没有未解决冲突。以上测试使用本地或合成场景，不产生真实供应商任务。

## 开发域名实际验收记录

| 范围 | 已有证据与待完成项 |
|---|---|
| 目标版本页面 | 待当前修复镜像部署并复验。旧版本首页的空草稿轮询 / 恢复循环验收未通过；当前源码已修复草稿持久化、动作引用及重复加载。 |
| 普通保存与刷新 | 空知识草稿与企业问答草稿已有本地真实 HTTP router 回归；子域名资料保存、刷新、节点编辑和下载仍待实测。 |
| 供应商流程 | 知识构建、企业问答生成、词库生成、AI 节点编辑、真实 SiteOps 生成和域名发布均未真实执行。 |

后续部署应重新记录实际两个 SHA，并对变更交互复验。停用的 worker 不记为任务执行通过；旧版本结果不直接作为新镜像验收。公开文档只记录检查结论，不包含账号凭据、私有路径、业务记录正文或运行数据。

## 仍保留的能力边界

AI 官网的草稿设置、预览分析与部件配置按原能力提供，不计为新增完成的真实建站链路。已有 SiteOps 状态机和工作流源码不等于该环境已完成真实生成与发布。

## 运行与公开范围

`module/` 包含公开业务源码、业务依赖和所属工作流，`standalone/` 包含独立壳与合成预览，`vendor/` 由主仓维护并按版本下发。`pnpm dev` 明确显示“本地预览”，不连接真实测试数据库或付费供应商。真实持久化、后台任务、授权文件和供应商连接由私有 Core 运行入口提供。

开发域名进入固定测试工作区；子仓不实现产品登录、成员、租户或通用智能体。主仓注入真实用户和工作区上下文，并按需提供跨模块入口。独立模块保留自己的输入流程。

普通 ZIP 导入、CI 和页面检查不触发付费生成、监控采集、媒体外发或客户域名发布。没有供应商配置、指定测试目标或额度时，明确记录未配置或未执行；不以合成预览替代真实验收。

## 下一轮修改

先让 `frontmind-module-delivery` 读取开发域名 `/api/version` 并导出精确线上源码、完整 SHA 和交接模板。`main` 可能含尚未上线的文档或代码，不能直接当线上基线。

Pro 按 [PRO_GUIDE.md](https://github.com/xiafanzeng/frontmind-brand/blob/main/PRO_GUIDE.md) 返回 ZIP 后，delivery skill 在隔离工作树中合并、验证并部署指定子域名。验收后使用 `frontmind-module-sync` 合回业务源码；独立壳、预览数据和开发门禁不回灌主仓。源码同步不自动部署生产 Dashboard。
