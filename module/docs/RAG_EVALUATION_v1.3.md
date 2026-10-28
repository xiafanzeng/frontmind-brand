# 企业 RAG 单次评估 rag-eval-1.3

本轮将非关键问题从重大业务/安全风险中分开：核心任务完成、证据充分且无重大风险时可用，有改进项则显示“可用·待改进”。六维及聚合分数仅作诊断，低分不单独否决，高分不抵消重大风险。

## 合同与恢复

|冻结输入 schema / operation revision|规则|Skill / Judge|评分实现|
|---|---|---|---|
|1 / 1|rag-eval-1.2|1.0.0 / 1.0.0|`rag-evaluation-legacy.ts`、`enterprise-rag-evaluation-skill-legacy.ts`|
|2 / 2|rag-eval-1.3|2.0.0 / 2.0.0|当前 `rag-evaluation.ts`、`enterprise-rag-evaluation-skill.ts`|

新输入冻结 `taskScope=single_turn`。v2 输出包含陈述类别、核心/辅助关系、证据状态、task 和 findings。陈述须定位回答原句；问题记录严重程度、实际影响、证据与扣分维度。事实、核实建议和未知说明区分处理；建议中的事实须拆开核验。

`findings.severity` 为 critical / improvement / undetermined。未读正文不能确认为支持，空审计或凭空将充分支持的事实升级为重大事实错误会被拒绝。部分支持和普通引用展示缺陷不一律阻断；核心事实缺口、必要条件、安全和权限风险继续严格。

评估任务 `run.status=completed` 代表执行已经完成，报告内 `result.status=pending` 和 `answerVerdict=pending` 代表质量仍待核验；两者可以并存。前端按服务端 `answerVerdict` 展示，不从分数另算新结论。未知事项不触发无意义格式修复重试。

旧 static/bound/alias schema、冻结 Skill 和旧评分函数均保留；历史报告不追溯改判。未知版本拒绝套用当前规则。未来升版必须继续按冻结版本分派，不能直接用最新函数重算旧报告。

## 本地验证

固定 pnpm 10.4.1，先按锁文件安装，再执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm --dir module test
```

测试使用本机模拟服务，不需真实模型。受限环境须允许测试监听本机回环端口。并发资源紧张时，在 module 目录将 Vitest 调整为 `vitest run --config vitest.config.ts --maxWorkers=4 --minWorkers=1`，保留全部测试和原超时。

合成样例、六维分数、浏览器备注和少量固定测试均不代替正式多轮/版本验收。此改动不授予发布权限，不实现访客展示前保护，不修改 Core 多轮接入。真实模型校准及开发域名部署仍待授权。

## 2026-10-28 发布授权

用户已明确授权将本轮更新发布至 brand.frontmind.cn 企业 RAG 页面。前文“部署待授权”描述最初本地开发阶段；本次发布仍不包含付费模型复评或 Dashboard 生产发布。历史报告保留，当前页面明确展示新规则与历史报告版本。
