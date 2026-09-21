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

## 模型

默认目录：

| 模型 | 上下文 | 能力 |
|---|---|---|
| `moonshotai/kimi-k3` | 256000 | text + image |

## 许可

MIT