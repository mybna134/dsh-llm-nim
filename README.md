# dsh-llm-nvidia-completions

为 DeepSeek Harness 的自定义 Provider 协议增加 `nvidia-completions` 协议，对接 NVIDIA NIM 的 OpenAI 兼容 chat-completions 端点（`https://integrate.api.nvidia.com/v1/chat/completions`），从而支持 `moonshotai/kimi-k3` 等模型。

## 特性

- 注册 `nvidia-completions` provider 路由
- fetch + SSE 流式调用（对齐 `@deepseek-ai/dsh-llm-deepseek` 的传输实现）
- 支持 `reasoning_effort`（`off`/`low`/`high`/`max`），并把 wire 上的 `reasoning_content` 翻译为 harness 的 `reasoning` 内容块
- 支持视觉输入（`image_url`，base64 data URL inline，无需 Files API）
- 支持工具调用（`tool_calls` 增量）
- 可由 harness 采样参数驱动的 `temperature`（默认 1）与固定 `seed`（默认 0），对齐 NVIDIA 示例
- 可配置的模型目录、上下文窗口、输出上限、采样温度、random seed 与空闲超时
- 自带 Web 设置页（`dsh.client` bundle）：在 Settings 面板注册「Nvidia NIM」页，可视化配置 provider 与模型目录
- 上游未发送 `[DONE]` 就断流时，按已收到的 `finish_reason`（或已产出的内容）收尾定型，不丢弃已收到的内容；仅在完全没有终止信息时才失败，且该失败默认可重试

## 配置

本插件在 Web 设置面板（Settings）注册一个独立的「**Nvidia NIM**」设置页，可图形化配置下列内容（写入 `llm-nvidia-completions:` settings 段，API key 走 credentials）：

- **Provider**：API key（`NVIDIA_API_KEY`）、`baseURL`、默认推理强度、默认采样温度、默认 `top_p`、随机种子、单次输出上限、默认上下文窗口
- **模型目录**：增删改模型，每项含 `id`/显示名称/描述/上下文窗口/最大输出 token/`topP`/输入模态（text、image）

模型页面（Settings → Models）也会自动出现 `nvidia-completions` provider。也可以用环境变量：

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `NVIDIA_API_KEY` | NVIDIA NIM API 密钥 | — |
| `NVIDIA_BASE_URL` | 覆盖端点 | `https://integrate.api.nvidia.com/v1` |

settings 命名空间 `llm-nvidia-completions` 下的可配置项：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `baseURL` | 接口 base URL | `https://integrate.api.nvidia.com/v1` |
| `defaultReasoningEffort` | 默认推理强度 | `max` |
| `defaultTemperature` | 默认采样温度 | `1` |
| `defaultTopP` | 默认核采样 top_p | `1` |
| `seed` | 固定随机种子 | `0` |
| `maxTokens` | 单次输出上限 | `16384` |
| `defaultContextWindow` | 默认上下文窗口 | `256000` |
| `models` | 模型目录（每个模型含 `id`/`name`/`contextWindow`/`maxTokens`/`topP`/`inputModalities` 等） | `moonshotai/kimi-k3` |
| `retryPolicy` | 重试策略（`mode`/`maxRetries`/`retryableCodes`/`backoff`，沿用 harness 的 `RetryPolicySchema`） | `normal` 模式重试 5 次，错误码见下 |

### 断流收尾

NVIDIA NIM 在超长流（例如长时间 `reasoning_content`）上偶尔会在**未发送 `[DONE]`** 的情况下关闭连接。适配器据此收尾：

- 已收到 `finish_reason` → 以上游给出的原因为准正常收尾（等同 `[DONE]`）。
- 未收到 `finish_reason` 但**已有内容**（`text` / `reasoning` / `tool-call`，含待定型的 `<invoke>` 候选）→ 按截断定型为 `max-tokens`，harness 会据此丢弃可能不完整的工具调用并优雅结束该轮。
- **完全没有终止信息**（既无 `finish_reason`，也无任何内容）→ 抛出 `STREAM_CLOSED`。

未显式配置 `retryPolicy` 时，默认可重试错误码为 harness 默认集（`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）**加上 `STREAM_CLOSED`**，因此这类断流会自动重试，而不会让整轮静默结束。

## 安装

本包通过 `dsh.bundle`（package.json 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`）声明为一个 profile 层，`dsh plugin add` 会自动识别并加入 `dsh.profile.bundles`。

```bash
cd <你的 profile 目录>
dsh plugin add dsh-llm-nvidia-completions
# 或本地开发（file: 指向本插件 checkout）
dsh plugin add file:/home/mybna134/Projects/dsh-nvidia-chat
```

安装后重启 `dsh web` / 对应 surface，模型选择器会出现 `Nvidia NIM` provider + `Kimi K3`，自定义 Provider 协议里也会多出 `nvidia-completions`。

> 注意：若安装时仍提示 `declares no dsh.bundle`，说明 `package.json` 缺少
> `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明——本仓库已包含，此提示不会再出现。

## TypeScript 开发与 pnpm 安装

服务端适配器位于 `src/index.ts`，Web 设置页位于 `src/client.ts`；`dist/` 是构建产物，请修改 `src/` 后重新构建。

```bash
pnpm install
pnpm typecheck
pnpm test
```

`prepare` 执行 `pnpm run build`：先用 TypeScript 严格检查并生成 `dist/types/*.d.ts`，再构建服务端 ESM 入口 `dist/index.js` 和保持 DSH 模块加载器格式的客户端 `dist/client.js`。也可手动运行 `pnpm run prepare`。`pnpm-workspace.yaml` 明确允许构建依赖 `esbuild` 执行安装脚本，支持新版 pnpm 的构建许可机制。

在其他项目中安装本地插件：

```bash
pnpm add file:/home/mybna134/Projects/dsh-nvidia-chat
```

本地 `file:` 安装前先在插件目录执行 `pnpm install`，以生成构建产物。包内包含运行产物、TypeScript 源码与构建脚本；`pnpm pack` 会执行 `prepare`。Git 安装也具备所需构建文件：

```bash
pnpm add git+https://github.com/mybnn/dsh-nvidia-chat.git
```

如果安装环境禁用了生命周期脚本，请在插件目录手动执行 `pnpm run prepare`。pnpm 的重复安装优化可能跳过未变更项目的生命周期脚本；修改源码后请运行 `pnpm run build`。

## 模型

默认目录：

| 模型 | 上下文 | 能力 |
|---|---|---|
| `moonshotai/kimi-k3` | 256000 | text + image |

## 许可

MIT
