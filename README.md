<div align="center">
  <h1>DSH NVIDIA NIM</h1>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT license">
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript strict mode">
  <img src="https://img.shields.io/badge/Node.js-22%2B-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22 or later">
  <img src="https://img.shields.io/badge/NVIDIA-NIM-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="NVIDIA NIM">
</div>

`dsh-llm-nvidia-completions` 为 DeepSeek Harness（DSH）增加 `nvidia-completions` Provider 协议，通过 NVIDIA NIM 的 OpenAI 兼容 `/chat/completions` 接口使用模型。插件默认提供 `moonshotai/kimi-k3` 模型目录，并附带 Web 设置页。

## 功能

### 流式对话与推理

- 使用 `fetch` 和 SSE 接收流式响应。
- 将上游 `reasoning_content` 转换为 DSH 的推理内容块。
- 支持 `off`、`low`、`high`、`max` 四种推理强度。
- 支持配置采样温度、`top_p`、随机种子、输出上限和流式空闲超时。
- 转换上游返回的 Token 用量，包括缓存读取和推理 Token。

### 图片与工具调用

- 从 DSH 附件服务读取图片，以 base64 data URL 形式发送 `image_url`。
- 拼接增量 `tool_calls`，并将工具结果序列化为独立的 `tool` 消息。
- 恢复响应正文中的 `<invoke>` 格式工具调用。

### Web 设置与模型目录

- 在 Settings 中注册独立的 **Nvidia NIM** 设置页，提供中文和英文界面。
- API 密钥通过 DSH credentials 服务保存。
- 支持增删改模型，配置显示名称、描述、上下文窗口、输出上限、`top_p` 和输入模态。
- 在 Settings → Models 中注册 `nvidia-completions` Provider。

### 断流处理

- 上游未发送 `[DONE]` 时，根据 `finish_reason` 或已接收的内容完成收尾。
- 保留已收到的文本和推理内容；没有结束信息且没有内容时抛出可重试错误。
- 将认证、限流、服务端错误和超时等情况转换为 DSH 错误码。

## 快速上手

### 准备

- 已安装 DeepSeek Harness，并有可用的 profile。
- 已取得目标 NVIDIA NIM 端点的 API 密钥。
- 从源码构建时使用 Node.js 22 或更高版本，以及 pnpm。
- 模型 ID、支持的输入模态和采样参数应与实际端点一致。

### 安装插件

在你的 DSH profile 目录运行：

```sh
dsh plugin add dsh-llm-nvidia-completions
```

插件通过 `package.json` 中的 `dsh.bundle.patch` 声明 profile 配置层。DSH 会读取 `cordis.patch.yml`，将插件加入 profile 的 bundles。

本地源码安装方式见下方“构建”。

### 配置并使用

1. 安装后重启 `dsh web` 或正在使用的 DSH surface。
2. 打开 Settings → **Nvidia NIM**，填写 API 密钥并保存。
3. 按需调整端点和模型目录。默认端点为 `https://integrate.api.nvidia.com/v1`。
4. 在模型选择器中选择 **Nvidia NIM → Kimi K3**，开始对话。

也可以在启动 DSH 前通过环境变量提供密钥：

```sh
export NVIDIA_API_KEY='你的 NVIDIA NIM API 密钥'
dsh web
```

## 构建

在仓库根目录运行：

```sh
pnpm install
pnpm typecheck
pnpm test
```

`pnpm install` 的 `prepare` 生命周期会自动构建。修改源码后手动运行：

```sh
pnpm build
```

构建先执行 TypeScript 严格检查并生成声明文件，再生成服务端 ESM 入口和符合 DSH 模块加载器格式的 Web 客户端入口。

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | 服务端适配器、模型目录和配置注册 |
| `src/client.ts` | Web 设置页及中英文文案 |
| `scripts/build.mjs` | TypeScript 检查和 esbuild 构建 |
| `dist/index.js` | 服务端构建产物 |
| `dist/client.js` | Web 客户端构建产物 |
| `dist/types/` | TypeScript 声明文件 |
| `test/plugin.test.mjs` | 流式响应、工具调用和客户端注册测试 |
| `cordis.patch.yml` | DSH profile bundle 配置 |

### 安装本地构建

先在插件目录完成 `pnpm install`，再切换到 DSH profile 目录运行：

```sh
dsh plugin add file:/绝对路径/dsh-nvidia-chat
```

若通过 pnpm 添加本地依赖：

```sh
pnpm add file:/绝对路径/dsh-nvidia-chat
```

发布包包含构建产物、源码和构建所需文件；`pnpm pack` 会执行 `prepare`。如果安装环境禁用了生命周期脚本，请在插件目录手动运行 `pnpm run prepare`。`pnpm-workspace.yaml` 已允许 esbuild 执行安装脚本。

## 使用

### Web 设置

Settings → **Nvidia NIM** 提供以下配置：

- **Provider**：API 密钥、接口地址、默认推理强度、采样温度、`top_p`、随机种子、输出上限和上下文窗口。
- **模型目录**：模型 ID、显示名称、描述、上下文窗口、输出上限、`top_p` 和 text / image 输入模态。

API 密钥以 `NVIDIA_API_KEY` 凭证保存，输入框留空会保留现有密钥。其他配置写入 `llm-nvidia-completions` settings 命名空间。

### 环境变量

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `NVIDIA_API_KEY` | NVIDIA NIM API 密钥 | 无 |
| `NVIDIA_BASE_URL` | 未设置 `baseURL` 时使用的接口地址 | `https://integrate.api.nvidia.com/v1` |

接口地址按 settings 的 `baseURL` → 启动环境的 `NVIDIA_BASE_URL` → 默认端点的顺序解析。地址应包含 `/v1` 等 API 前缀；插件会追加 `/chat/completions`。

密钥通过 credentials 服务解析；没有该服务时，从 DSH 启动环境读取。修改环境变量后应重新启动 DSH。

### 配置项

以下字段属于 `llm-nvidia-completions` settings 命名空间。空闲超时、重试策略和自定义凭证引用可通过该命名空间配置。

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `apiKeyEnv` | API 密钥凭证引用 | `NVIDIA_API_KEY` |
| `baseURL` | 接口 base URL，优先于环境变量 | 未设置时按上述顺序解析 |
| `defaultReasoningEffort` | 默认推理强度：`off` / `low` / `high` / `max` | `max` |
| `defaultTemperature` | 默认采样温度，范围 `0–2` | `1` |
| `defaultTopP` | 默认核采样值，范围 `0–1` | `1` |
| `seed` | 非负整数随机种子 | `0` |
| `maxTokens` | 默认最大输出 Token 数 | `16384` |
| `defaultContextWindow` | 默认上下文窗口，单位 Token | `256000` |
| `models` | 模型目录 | 见下表 |
| `streamIdleTimeoutMs` | 流式读取空闲超时，单位毫秒 | `300000`（5 分钟） |
| `retryPolicy` | DSH 重试策略，支持 `mode`、`maxRetries`、`retryableCodes`、`backoff` | `normal` 模式，默认重试 5 次 |

### 模型目录

插件内置以下目录项：

| 模型 ID | 显示名称 | 上下文窗口 | 最大输出 Token | 输入模态 |
| --- | --- | --- | --- | --- |
| `moonshotai/kimi-k3` | Kimi K3 | `256000` | `16384` | text、image |

这些数值是插件的默认目录配置；实际可用模型及限制取决于目标端点。

每个模型必须提供唯一的 `id`，其他字段可选。未指定 `contextWindow`、`maxTokens` 或 `topP` 时继承 Provider 默认值；未指定 `inputModalities` 时按仅支持文本处理。

## 细节

### 请求参数

- DSH 显式指定的推理强度和采样温度优先于插件默认值。
- 推理强度为 `off` 时，请求中省略 `reasoning_effort`。
- `top_p` 优先使用模型目录项的 `topP`，否则使用 `defaultTopP`。
- 模型目录的 `maxTokens` 向 DSH 提供默认输出上限，请求中的 `max_tokens` 使用 DSH 传入的值。
- 固定 `seed` 默认发送为 `0`。

### 图片输入

图片输入需要 DSH 的持久化附件服务，且模型目录须声明 `image` 输入模态。插件通过附件服务准备请求图片，策略上限为 4,194,304 像素和 1,048,576 字节，再以内联 `image_url` 发送。

### 断流收尾与重试

当 SSE 连接在发送 `[DONE]` 前关闭时：

| 已接收的信息 | 处理方式 |
| --- | --- |
| 有 `finish_reason` | 按上游结束原因正常收尾 |
| 无 `finish_reason`，但已有文本、推理或工具调用内容 | 保留内容，以 `max-tokens` 截断原因收尾，让 DSH 处理可能不完整的工具调用 |
| 无 `finish_reason`，也没有任何内容 | 抛出 `STREAM_CLOSED` |

未显式配置 `retryPolicy` 时，默认可重试错误码为 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT` 和 `STREAM_CLOSED`。显式配置重试策略后，使用 DSH 对该策略的解析结果。

## 许可

MIT，见 `package.json` 中的 `license` 声明。
