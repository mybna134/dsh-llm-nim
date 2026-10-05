<div align="center">
  <h1>dsh-llm-nim</h1>
  <a href="LICENCE"><img src="https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge" alt="GPLv3 license"></a>
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript strict mode">
  <img src="https://img.shields.io/badge/Node.js-22%2B-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22 or later">
  <img src="https://img.shields.io/badge/NVIDIA-NIM-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="NVIDIA NIM">
</div>

DeepSeek Harness（DSH）的 NVIDIA NIM 模型插件，通过 OpenAI 兼容接口接入模型，附带中英文 Web 设置页。默认模型目录为空，使用前需添加模型。

支持流式对话、推理内容、图片输入、工具调用和自定义模型目录。适配 DeepSeek Harness `0.2.0-rc.2`；不再支持 `0.1.x` 的消息与设置接口。

## 安装与配置

安装到 DSH 的 Web profile：

```sh
dsh plugin --profile web add dsh-llm-nim
```

1. 重启 DSH，打开 Settings → **Nvidia NIM**。
2. 填写 API 密钥，确认接口地址，并添加目标端点支持的模型 ID。
3. 在模型选择器中选择 **Nvidia NIM** 下已添加的模型。

默认接口地址为 `https://integrate.api.nvidia.com/v1`。也可以在启动前通过环境变量配置：

```sh
export NVIDIA_API_KEY='你的 NVIDIA NIM API 密钥'
# 可选：自定义接口地址
export NVIDIA_BASE_URL='https://integrate.api.nvidia.com/v1'
dsh web
```

Web 设置支持推理强度、温度、`top_p`、随机种子、输出上限和上下文窗口。密钥由 DSH credentials 服务保存；插件配置条目 ID 为 `llm-nvidia-completions`，Provider 标识为 `nvidia-completions`。实际模型能力与限制以目标端点为准。

## 本地开发

需要 Node.js 22+ 和 pnpm：

```sh
pnpm install
pnpm typecheck
pnpm test
```

`pnpm install` 会自动构建；修改源码后运行 `pnpm build`。安装本地插件到 Web profile：

```sh
dsh plugin --profile web add file:/绝对路径/dsh-llm-nim
```

设置通过 DSH `configForms` 按插件条目 ID 读取，保存时一次提交所有字段，并携带读取时的配置修订号。参数更新通过 Loader 的实时配置字段生效，已准备的模型请求保留准备时的配置。

## 许可

[GNU GPLv3](LICENCE)（`GPL-3.0-only`）。
