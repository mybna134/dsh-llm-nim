/**
 * NVIDIA NIM（OpenAI 兼容 chat-completions）适配器类型声明。
 * 为 DeepSeek Harness 增加 `nvidia-completions` provider 协议以支持 kimi-k3。
 */
import type { Context, Plugin } from '@deepseek-ai/cordis';

/** 单个模型目录条目。 */
export interface NvidiaCatalogModel {
  id: string;
  name?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** 核采样 top_p（0~1），缺省继承 provider 默认。 */
  topP?: number;
  inputModalities?: ('text' | 'image')[];
}

/** 插件级配置（对应 settings 命名空间 `llm-nvidia-completions`）。 */
export interface NvidiaConfig {
  /** 承载 API 密钥的环境变量引用，默认 `NVIDIA_API_KEY`。 */
  apiKeyEnv?: string;
  /** 端点 base URL，默认 `https://integrate.api.nvidia.com/v1`。 */
  baseURL?: string;
  /** 请求未显式指定时的推理强度默认值，默认 `max`。 */
  defaultReasoningEffort?: 'off' | 'low' | 'high' | 'max';
  /** 请求未显式指定时的采样温度，默认 1。 */
  defaultTemperature?: number;
  /** 请求未显式指定时的核采样 top_p（0~1），默认 1。 */
  defaultTopP?: number;
  /** 固定随机种子（对齐 NVIDIA 示例），默认 0。 */
  seed?: number;
  /** 单次请求输出上限（token），默认 16384。 */
  maxTokens?: number;
  /** 默认上下文窗口，默认 256000。 */
  defaultContextWindow?: number;
  /** 模型目录，默认 `moonshotai/kimi-k3`。 */
  models?: NvidiaCatalogModel[];
  /** 流式读取空闲超时（ms），默认 300000。 */
  streamIdleTimeoutMs?: number;
  retryPolicy?: unknown;
}

declare const plugin: Plugin;
export { plugin as default };
export { apply, inject, name, Config, NvidiaAdapter, resolveAdapterOptions, PUBLIC_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, DEFAULT_TOP_P, DEFAULT_SEED, DEFAULT_MODELS };

export type { Context };