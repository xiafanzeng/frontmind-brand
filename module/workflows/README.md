# Brand 业务 Skill 与工作流源码

这些业务源码随 Brand 模块发布。成员可以直接在子仓的 `module/` 修改相应文件，提交并构建后供新任务使用。

| 业务 | 可修改的主要源码 | 构建与加载 |
| --- | --- | --- |
| 知识库 | `workflows/socratic-kb-builder/` 的 Skill、references、scripts 和资源；`server/knowledge-base-prompt-contract.ts`、`server/knowledge-base-turn-prompt.ts`、`server/knowledge-base-skill-runtime.ts` | `build-knowledge-base-workflow.mjs` 递归打包全部正常资源，生成内容哈希与 manifest；运行时读取该包 |
| 知识库规则 | `workflows/socratic-kb-builder/references/working-set-policy.json`、`server/knowledge-base-working-set-policy.ts` | 模块 build、typecheck、build:workflows 先生成对应 TS 规则，Python 校验器和服务端使用同一份策略来源 |
| 词库 | `workflows/generate-brand-question-universe/source/`、`frontmind-adapter-v1.0.0/`；`server/brand-question-universe-runtime.ts`、`server/brand-question-universe-service.ts` | 构建递归收集上游和 adapter 资源；上游未改时保留原 ZIP 字节，修改后生成新的内容地址归档 |
| 企业问答 | `contracts/enterprise-qa-answer.ts`、`server/enterprise-qa-context.ts`、`server/enterprise-qa-answer.ts`、`server/enterprise-qa-native-repair.ts` | 模块内业务规则同时用于本轮提示与结果校验；客户端共享相同结果结构 |
| AI 官网 | `server/siteops/manus-provider.ts`、`server/siteops/site-content-plan.ts`、`server/siteops/native-react-source.ts`、`contracts/siteops.ts` 等 | 当前 2.9 新任务读取模块内 Prompt、合同与执行代码；`build-siteops-workflows.mjs` 记录对应源码哈希 |
| 微信公众号／小红书内容包 | `workflows/siteops-wechat-package-v1.0.0/`、`workflows/siteops-xiaohongshu-package-v1.0.0/`；`workflows/build-siteops-social-workflows.mjs` | 构建递归收集 Skill、references、scripts 和资源，自动生成当前 ZIP 与 manifest；新任务由 `server/siteops/social-workflow-runtime.ts` 读取模块构建的内容地址包，执行入口仍为 `server/siteops/manus-provider.ts` |

## 本地构建

在 Brand 子仓根目录运行 `pnpm install --frozen-lockfile`，再运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。模块的构建入口会自动执行策略生成，无需访问主仓脚本。

知识库新增的 references、脚本与资源会自动进入归档。已有必需文件仍须存在且非空；符号链接和特殊文件不进入包，构建会报错；Python 缓存、依赖目录和常见缓存不打包。词库 adapter 同样收集新增资源，根 `MANIFEST.json` 由构建按实际资源生成。

单独更新或检查策略生成结果：

```sh
node workflows/generate-knowledge-base-working-set-policy.mjs
node workflows/generate-knowledge-base-working-set-policy.mjs --check
```

`server/knowledge-base-working-set-policy.generated.ts` 是生成文件，业务规则改在 JSON 原件。服务端协议或行为改变时，同时修改对应模块代码与定向测试。

## 版本与生效范围

社媒内容包目录的源 `MANIFEST.json` 保留原历史坐标，构建不改写；当前清单在 ZIP 中自动生成，由 `dist/workflows/siteops-social-current.json` 指向。无需手动维护新增资源的 hash。公众号三张封面和小红书九页图文的现行协议保持不变。

发布构建使用提交的模块 SHA 和 Core SHA。源码更改生成新的归档哈希，新任务采用该构建的版本；已开始任务继续使用其保存的旧版本和精确归档，不用新内容替换历史包。历史 AI 官网 2.6 等版本的 Skill 与 manifest 用于已冻结任务，当前 2.9 业务 Prompt 在上述模块代码中。

子域名发布后，Dashboard 主仓通过正常模块同步及发布采用这些业务更改。提交临时分支或只完成本地构建不会自动改变运行中的服务。
