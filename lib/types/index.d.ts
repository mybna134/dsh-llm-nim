import type { GenerateOptions, StreamChunk, LlmResolvedModelInfo, LlmModelInfo } from "@deepseek-ai/dsh-llm";
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import * as Llm from "@deepseek-ai/dsh-llm";
declare const LlmAdapter: typeof Llm.LlmAdapter;
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
    retryPolicy?: Llm.RetryPolicyConfig;
}
export type NvidiaAdapterOptions = ReturnType<typeof resolveAdapterOptions>;
export interface NvidiaAdapterServices {
    options(): NvidiaAdapterOptions;
    resolveApiKey(connection: NvidiaAdapterOptions): Promise<string>;
    resolveAttachments?(): AttachmentStore | undefined;
}
declare const DEFAULT_CONTEXT_WINDOW = 256000;
declare const DEFAULT_MAX_TOKENS = 16384;
declare const DEFAULT_TEMPERATURE = 1;
declare const DEFAULT_TOP_P = 1;
declare const DEFAULT_SEED = 0;
declare class NvidiaAdapter extends LlmAdapter {
    private readonly config;
    constructor(config: NvidiaAdapterServices);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    providerRetryPolicy(_provider: string): Llm.ResolvedRetryPolicy;
    imageRequestPricing(_provider: string, _model: string): undefined;
    listModels(provider: string): Promise<LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    modelInfoFor(provider: string, model: string): LlmResolvedModelInfo;
    prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<{
        model: LlmResolvedModelInfo;
        stream: (callOptions: GenerateOptions) => AsyncGenerator<StreamChunk, void, unknown>;
    }>;
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown>;
    streamWithOptions(options: GenerateOptions, connection: NvidiaAdapterOptions): AsyncGenerator<StreamChunk, void, unknown>;
    request(options: GenerateOptions, signal: AbortSignal, connection: NvidiaAdapterOptions, apiKey: string): AsyncGenerator<StreamChunk, void, unknown>;
}
declare const name = "llm-nvidia-completions";
declare const inject: string[];
declare const DEFAULT_MODELS: NvidiaCatalogModel[];
declare const Config: z<NvidiaConfig>;
declare const PUBLIC_BASE_URL = "https://integrate.api.nvidia.com/v1";
declare function resolveAdapterOptions(config: NvidiaConfig, environment?: LaunchEnvironmentSnapshot): {
    apiKeyEnv: import("@deepseek-ai/dsh-credentials").CredentialRef;
    baseURL: string;
    defaultReasoningEffort: "off" | "low" | "high" | "max";
    defaultTemperature: number;
    defaultTopP: number;
    seed: number;
    maxTokens: number;
    defaultContextWindow: number;
    models: NvidiaCatalogModel[];
    streamIdleTimeoutMs: number;
    retryPolicy: Llm.ResolvedRetryPolicy;
};
declare function apply(ctx: Context, config: NvidiaConfig): void;
export { apply, inject, name, Config, NvidiaAdapter, resolveAdapterOptions, PUBLIC_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, DEFAULT_TOP_P, DEFAULT_SEED, DEFAULT_MODELS };
export type { Context };
declare const _default: {
    name: string;
    inject: string[];
    Config: z<NvidiaConfig>;
    apply: typeof apply;
};
export default _default;
