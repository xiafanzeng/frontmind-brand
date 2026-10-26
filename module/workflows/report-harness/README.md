# Brand 报告 Harness

从用户提供的 `FrontMind_DeepSeek_Harness_v1.1.0` 运行方式适配，使用官方 `@deepseek-ai/dsh-sdk-client` 与 `dsh-llm-pi-ai`，均固定 `0.2.0-rc.2`。没有复用旧包的 XTY 网关、Content Python bridge 或本地全权限命令工具。

服务器只需为 Brand 注入 `REPORT_DEEPSEEK_API_KEY`。模型固定为 `deepseek-flash`，接口固定为 `https://api.deepseek.com/v1`。API Key 只进入专用运行进程，不进入工作文档、提示词、前端或公开仓库。SDK host 要求 Node 24；Linux x64 使用模块的 `node-linux-x64@24.13.1` 可选依赖，现有主程序仍可运行 Node 22。仅在已由部署配置准备了其他受信 Node 24 路径时设置 `REPORT_HARNESS_NODE_BIN`。

每份报告最多一个活动 host，同一服务最多两个。报告目录下保存独立 HOME、TMP、DSH session 与阶段输入。正常阶段复用同一 SDK 会话；空闲 15 分钟关闭，停止或完成也关闭。官方 SDK 不支持跨进程恢复同一个会话；明确的恢复操作建立新会话，从保存的输入与已完成阶段继续，并留下恢复事件，不隐式重跑已完成监测。

仅注册六个受控工具：列出报告资料、分页读资料、搜索公开网页、抓取公开网页、保存中间分析、保存阶段 JSON。没有 shell、宿主文件浏览或业务 API 调用工具。公开检索使用 Bing 网页，无第三方收费搜索 API；搜索被验证码或网络阻断时返回真实失败，不补造来源。网页获取使用 HTTPS GET、公开 IPv4 校验、固定解析地址、重定向逐跳校验与大小限制。

前端事件来自 SDK 的真实 `session.event`：`tool/call.data.callId` 配对 `tool/result.data.message.toolCallId`。只保留正文、动作参数、工具回执与有限 token 用量，不把原始 stream、reasoning 或 provider 元数据交给前端。SDK 的正文事件在一个模型步骤完成时送出；工具开始和完成事件及时送出。只有 `turn/end.reason.kind === completed` 才接收结果，随后验证阶段结构；最多一次同会话修复。

`work/` 文档列表返回所有正常文件及短预览、字节数、截断标识；全文经单独受控读取。DSH 内部会话、配置、环境变量不在此列表中。

离线检验：`node --test module/tests/report-harness.test.mjs`。其中包含真实官方 SDK 初始化（零模型请求），以及仅连接本机 mock 模型的工具执行、事件配对和会话复用。此测试不调用官方付费模型或任何业务 API；它不等于真实完整报告验收。
