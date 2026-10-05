import type { GenerateOptions, ContentBlock, ImageBlock, RequestMessage, StreamChunk, FinishReason, TokenUsage, LlmResolvedModelInfo, LlmModelInfo } from "@deepseek-ai/dsh-llm";
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from "@deepseek-ai/dsh-attachment";
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import type { Context, Volatile } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/cordis-plugin-loader";
import z from "@deepseek-ai/schemastery";
import * as Llm from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { deepEqualJson } from "@deepseek-ai/dsh-util-values";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { EventSourceParserStream } from "eventsource-parser/stream";

const {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  RetryPolicySchema,
  assertUsableApiKey,
  attributionHeaders,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
  resolveRetryPolicy,
  ToolCallId,
  projectToolUpdates
} = Llm;
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
  /** 模型目录，默认为空，需按目标端点配置。 */
  models?: NvidiaCatalogModel[];
  /** 流式读取空闲超时（ms），默认 300000。 */
  streamIdleTimeoutMs?: number;
  retryPolicy?: Llm.RetryPolicyConfig;
}


// ---------------------------------------------------------------------------
// 序列化：把 harness 的消息 / 工具 / 采样参数翻译为 NVIDIA（OpenAI 兼容）wire 请求。
// ---------------------------------------------------------------------------

type RequestImages = Map<ImageAttachmentRef["attachmentId"], RequestImageAttachment>;
export type NvidiaAdapterOptions = ReturnType<typeof resolveAdapterOptions>;
export interface NvidiaAdapterServices {
  options(): NvidiaAdapterOptions;
  resolveApiKey(connection: NvidiaAdapterOptions): Promise<string>;
  resolveAttachments?(): AttachmentStore | undefined;
}
interface WireContent { type: "text" | "image_url"; text?: string; image_url?: { url: string } }
interface WireMessage {
  role: "system" | "developer" | "assistant" | "user" | "tool";
  content: string | WireContent[] | null;
  reasoning_content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
interface WireError { code?: string; type?: string; message?: string }
interface WireChunk {
  choices?: { finish_reason?: string | null; delta?: {
    content?: string | null; reasoning_content?: string | null;
    tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
  } }[];
  usage?: WireUsage;
}
interface PendingBlock {
  index: number;
  kind: "text" | "reasoning" | "tool-call";
  text: string;
  callId?: string;
  name?: string;
}
interface ParsedInvoke { name: string; arguments: string; text: string }

/** 校验适配器持有的 reasoning effort，再产出 wire 字段。 */
function reasoningEffort(effort: string) {
  if (effort === "off" || effort === "low" || effort === "high" || effort === "max") return effort;
  throw new LlmError(`Nvidia NIM does not support reasoning effort "${effort}"`, "UNSUPPORTED_REASONING_EFFORT");
}

/** 收敛纯文本块的字符串形式，用于 system / tool-result 等无富文本的位置。 */
function flattenText(blocks: readonly ContentBlock[]) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}

/** 请求图片最多保留 4194304 像素，编码目标为 1 MiB，保持源图比例。 */
const REQUEST_IMAGE_MAX_PIXELS = 4194304;
const REQUEST_IMAGE_MAX_BYTES = 1048576;

function requestImageTarget(ref: ImageAttachmentRef) {
  const scale = Math.min(1, Math.sqrt(REQUEST_IMAGE_MAX_PIXELS / (ref.width * ref.height)));
  return {
    width: Math.max(1, Math.floor(ref.width * scale)),
    height: Math.max(1, Math.floor(ref.height * scale)),
    maxBytes: REQUEST_IMAGE_MAX_BYTES
  };
}

/**
 * 通过 attachments 服务取出本次请求会发送的图片（仅 user 正文里的 image 块）。
 * image 块只携带持久化引用，`attachment.bytes` 是字节数而非图片数据。
 */
async function prepareRequestImages(messages: readonly RequestMessage[], attachments: AttachmentStore | undefined, signal: AbortSignal): Promise<RequestImages> {
  const refs = new Map<ImageAttachmentRef["attachmentId"], ImageAttachmentRef>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const block of message.content) {
      if (block.type === "image") refs.set(block.attachment.attachmentId, block.attachment);
    }
  }
  if (refs.size === 0) return new Map();
  if (attachments === undefined) throw new LlmError("NVIDIA image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
  const ordered = [...refs.values()];
  const prepared = await Promise.all(ordered.map((ref) => attachments.readImageRequest(ref, requestImageTarget(ref), signal)));
  return new Map(ordered.map((ref, index) => [ref.attachmentId, prepared[index]]));
}

/**
 * 把一个 image 内容块投影为 base64 data URL。当前 NVIDIA 不支持 Files API，
 * 图片直接以 inline `image_url` 形式发送。
 */
function inlineImageUrl(block: ImageBlock, requestImages: RequestImages) {
  const version = requestImages.get(block.attachment.attachmentId);
  if (version === undefined) throw new LlmError(`NVIDIA request image ${block.attachment.attachmentId} was not prepared`, "INVALID_REQUEST");
  const base64 = Buffer.from(version.data).toString("base64");
  return `data:${version.mediaType};base64,${base64}`;
}

/** 把一条 harness 消息翻译成 wire 消息（支持 text / image / reasoning / tool-call / tool-result）。 */
function serializeMessage(message: RequestMessage, requestImages: RequestImages): WireMessage {
  if (message.role === "system" || message.role === "developer") {
    return { role: message.role, content: flattenText(message.content) };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: flattenText(message.content) || "(no output)" };
  }
  if (message.role === "assistant") {
    const text = flattenText(message.content);
    const reasoning = message.content
      .filter((block) => block.type === "reasoning")
      .map((block) => block.text)
      .join("");
    const toolCalls = message.content
      .filter((block) => block.type === "tool-call")
      .map((block) => ({
        id: block.id,
        type: "function" as const,
        function: { name: block.name, arguments: block.arguments }
      }));
    return {
      role: "assistant",
      content: text !== "" ? text : null,
      ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    };
  }

  // user 角色：文本 + 图片。
  const content: WireContent[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text.length > 0) content.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      content.push({ type: "image_url", image_url: { url: inlineImageUrl(block, requestImages) } });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  // 若只有单个文本块，退化为纯字符串 content（OpenAI 兼容的紧凑形式）。
  if (content.length === 1 && content[0].type === "text") {
    return { role: "user", content: content[0].text ?? "" };
  }
  return { role: "user", content };
}

/** 组装完整 wire 请求体（始终流式，可配置 usage）。 */
function serializeRequest(options: GenerateOptions, config: NvidiaAdapterOptions, requestImages: RequestImages) {
  const messages: WireMessage[] = [];
  if (options.system !== undefined) messages.push({ role: "system", content: options.system });
  const projected = projectToolUpdates(options.messages, options.tools, undefined, options.toolHistory);
  messages.push(...projected.messages.map((message) => serializeMessage(message, requestImages)));

  const tools = projected.tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  const effort = options.reasoningEffort === undefined
    ? config.defaultReasoningEffort
    : reasoningEffort(options.reasoningEffort);

  // 温度：优先 harness 显式值，否则用插件配置默认值（默认 1，对齐 NVIDIA 示例）。
  const temperature = options.temperature !== undefined
    ? options.temperature
    : config.defaultTemperature;

  // top_p（核采样）：优先该模型的专属默认，否则用 provider 级默认（默认 1，即不额外截断）。
  const modelEntry = config.models.find((entry) => entry.id === options.model);
  const topP = modelEntry?.topP !== undefined ? modelEntry.topP : config.defaultTopP;

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(effort !== undefined && effort !== "off" ? { reasoning_effort: effort } : {}),
    ...(config.seed !== undefined ? { seed: config.seed } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop !== undefined ? { stop: options.stop } : {})
  };
}

// ---------------------------------------------------------------------------
// SSE 解析：读取字节流，产出 data payload 序列。正常以 `[DONE]` 结束；
// 上游提前关闭时则自然结束，是否可接受交由 translate 裁定。
// ---------------------------------------------------------------------------

async function* parseSse(stream: ReadableStream<Uint8Array<ArrayBuffer>>, onActivity?: () => void): AsyncGenerator<string> {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  for await (const event of events) {
    onActivity?.();
    yield event.data;
    if (event.data === "[DONE]") return;
  }
  // 上游未发送 `[DONE]` 就关闭了连接（NVIDIA NIM 在超长流上常见）。这里不报错：
  // 能否收尾取决于已收到的 finish_reason 与已产出的内容块，而这两者只有 translate 掌握。
}

// ---------------------------------------------------------------------------
// 翻译：把 OpenAI 兼容 SSE payload 翻译为 harness StreamChunk。
// ---------------------------------------------------------------------------

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: {
          message: `model stopped: ${reason}`,
          code: String(reason).toUpperCase()
        }
      };
  }
}

function mapUsage(usage: WireUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cacheRead = usage.prompt_tokens_details?.cached_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  // totalTokens 只在 prompt/completion 计数有效且与 wire 总数一致时给出，否则省略。
  const combined = promptTokens + completionTokens;
  const hasExactTotal = Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens! >= 0
    && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens! >= 0
    && (usage.total_tokens === undefined || usage.total_tokens === combined);
  return {
    inputTokens: promptTokens - (cacheRead ?? 0),
    outputTokens: completionTokens,
    ...(hasExactTotal ? { totalTokens: combined } : {}),
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {})
  };
}

function closeBlock(block: PendingBlock): ContentBlock | undefined {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return { type: "tool-call", id: ToolCallId(block.callId ?? ""), name: block.name ?? "", arguments: block.text };
    default:
      return undefined;
  }
}

/**
 * 把模型退化后以纯文本（DSML `<invoke>`）形式输出的工具调用，
 * 解析为结构化 tool-call 块。DeepSeek-V4 等模型在长上下文时可能省略
 * 流式 `tool_calls` 起始标记，把调用写进 `content`/`reasoning_content`；
 * 这里对齐 vllm 社区的做法（recovers_tool_calls_in_reasoning），在 adapter
 * 层做恢复，否则 DSH 会把 `<invoke>` 当作普通文本显示、且不会执行工具。
 * @returns { {name: string, arguments: string, text: string} | undefined } 解析失败返回 undefined。
 */
function tryParseInvokeText(text: string): ParsedInvoke | undefined {
  if (typeof text !== "string" || text.length === 0) return undefined;
  // 扫描任意位置（不强制以 <invoke 开头），以覆盖调用前带说明文字、
  // 或 <invoke 与正文混排的退化情况。要求 name 属性完整，避免误判纯文本。
  const outer = /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/;
  const match = outer.exec(text);
  if (!match) return undefined;
  const name = match[1];
  const inner = match[2];
  const args: Record<string, string> = {};
  const paramRe = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
  let pm;
  while ((pm = paramRe.exec(inner)) !== null) args[pm[1]] = pm[2];
  return { name, arguments: JSON.stringify(args), text };
}

async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk, void, unknown> {
  let nextIndex = 0;
  let textBlock: PendingBlock | undefined;
  let reasoningBlock: PendingBlock | undefined;
  const toolBlocks = new Map<number, PendingBlock>();
  const order: PendingBlock[] = [];
  let pendingFinish: FinishReason | undefined;
  let pendingUsage: WireUsage | undefined;
  // 文本工具调用恢复状态：模型把 `<invoke>` 写进 content 时缓存，流结束再定形。
  let pendingContent = "";
  let recoveringInvoke = false;

  function open(kind: PendingBlock["kind"]): PendingBlock {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  }

  // 把已解析的 invoke 参数定形为结构化 tool-call 块，输出其 block-start / tool-call-delta。
  // 用 generator 以便通过 yield* 复用于「流式中途定型」与「[DONE] 收尾定型」两处。
  // parsed 由调用方先经 tryParseInvokeText 得出（失败则不进入这里）。
  function* recoveredToolCallChunks(parsed: ParsedInvoke): Generator<StreamChunk, void, unknown> {
    const block = open("tool-call");
    block.callId = `recovered-${order.length}`; // 唯一伪 id，供 tool-result 配对
    block.name = parsed.name;
    block.text = parsed.arguments; // JSON 字符串
    toolBlocks.set(-1, block); // -1 占位 key，避免与真实流式 tool-calls 冲突
    pendingContent = "";
    recoveringInvoke = false;
    yield { type: "block-start", index: block.index, blockType: "tool-call" };
    yield {
      type: "tool-call-delta",
      index: block.index,
      id: ToolCallId(block.callId),
      name: block.name,
      argumentsDelta: parsed.arguments
    };
  }

  // 收尾定型：把流式期间缓存下的候选文本（以 <invoke 开头）解析为
  // 结构化 tool-call，或按普通文本输出。必须在关闭块之前完成，
  // 这样恢复出的 tool-call 会进入 order 并被 block-end 关闭。
  // `[DONE]` 正常收尾与「上游提前断流但已有终止信息」两条路径共用，
  // 保证两条路径的块关闭、usage 与 finish 输出完全一致。
  function* finalize(reason: FinishReason): Generator<StreamChunk, void, unknown> {
    if (recoveringInvoke) {
      const parsed = tryParseInvokeText(pendingContent);
      if (parsed) {
        yield* recoveredToolCallChunks(parsed);
      } else {
        if (!textBlock) {
          textBlock = open("text");
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.text += pendingContent;
        yield { type: "text-delta", index: textBlock.index, text: pendingContent };
      }
      pendingContent = "";
      recoveringInvoke = false;
    }
    for (const block of order) {
      const closed = closeBlock(block);
      if (closed) yield { type: "block-end", index: block.index, block: closed };
    }
    const usage = mapUsage(pendingUsage);
    if (usage) yield { type: "usage", usage };
    yield {
      type: "finish",
      reason:
        reason.kind === "stop" && order.length === 0
          ? {
              kind: "error",
              failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
            }
          : reason
    };
  }

  for await (const payload of payloads) {
    if (payload === "[DONE]") {
      yield* finalize(pendingFinish ?? { kind: "stop" });
      return;
    }

    let chunk: WireChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      // 推理内容（kimi-k3 在 delta.reasoning_content 流式输出）。
      const reasoning = delta.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      // 正文。
      const content = delta.content;
      if (typeof content === "string" && content.length > 0) {
        if (recoveringInvoke) {
          // 恢复模式：模型把工具调用写成了文本 DSML，继续累积等待完整闭合，流结束再定形。
          pendingContent += content;
        } else {
          // 在 content 的任意位置检测 `<invoke` 的起始片段（含 `<inv` / `<invo` / `<invok` /
          // `<invoke`），以覆盖模型在调用前先输出说明文字、<invoke 与正文混排，以及
          // DeepSeek 流式把 `<invoke` 拆成 `<inv`+`oke` 等分片片段的情况。
          // 用最短前缀 `<inv` 触发候选恢复；最终是否真为工具调用，由 [DONE] 收尾时
          // 的 tryParseInvokeText 校验完整 `<invoke name="...">...</invoke>` 结构决定，
          // 不匹配时安全回退为普通文本。
          const idx = content.indexOf("<inv");
          if (idx !== -1) {
            // 前缀正文先正常流式输出，候选工具调用片段进入恢复模式累积。
            if (idx > 0) {
              const prefix = content.slice(0, idx);
              if (!textBlock) {
                textBlock = open("text");
                yield { type: "block-start", index: textBlock.index, blockType: "text" };
              }
              textBlock.text += prefix;
              yield { type: "text-delta", index: textBlock.index, text: prefix };
            }
            recoveringInvoke = true;
            pendingContent += content.slice(idx);
          } else {
            // 普通文本，立即流式输出。
            if (!textBlock) {
              textBlock = open("text");
              yield { type: "block-start", index: textBlock.index, blockType: "text" };
            }
            textBlock.text += content;
            yield { type: "text-delta", index: textBlock.index, text: content };
          }
        }
      }
      // 工具调用。
      for (const call of delta.tool_calls ?? []) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(call.index, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== undefined) block.callId = call.id;
        if (call.function?.name !== undefined) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: ToolCallId(block.callId ?? ""),
          ...(block.name !== undefined ? { name: block.name } : {}),
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") pendingFinish = mapFinishReason(choice.finish_reason);
    }
    if (chunk.usage) pendingUsage = chunk.usage;
  }
  // 上游未发 `[DONE]` 就断流。只要已经拿到终止信息就正常收尾定型，绝不丢弃已产出的内容：
  //  - 已收到 finish_reason：以上游给出的原因为准，等同于正常结束。
  //  - 仅已有内容（text / reasoning / tool-call，含待定型的 <invoke> 候选）：
  //    按截断定型为 max-tokens——harness 会据此丢弃可能不完整的工具调用并优雅结束该轮。
  // 只有完全没有终止信息（无 finish_reason、也无任何内容）时才报错。该错误码在
  // DEFAULT_RETRYABLE_CODES 中，默认可重试。
  if (pendingFinish !== undefined) {
    yield* finalize(pendingFinish);
    return;
  }
  if (order.length > 0 || recoveringInvoke) {
    yield* finalize({ kind: "max-tokens" });
    return;
  }
  throw new LlmError("SSE stream ended without [DONE] and without any termination", STREAM_CLOSED_CODE);
}

// ---------------------------------------------------------------------------
// 常量与 error 映射。
// ---------------------------------------------------------------------------

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
const DEFAULT_CONTEXT_WINDOW = 256000;
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TOP_P = 1;
const DEFAULT_SEED = 0;

const STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";

/** 上游未发送 `[DONE]`、且没有任何终止信息时抛出的错误码。 */
const STREAM_CLOSED_CODE = "STREAM_CLOSED";

/**
 * 本适配器默认的可重试错误码：harness 默认集
 * （EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT）
 * 加上 STREAM_CLOSED——上游在未发 `[DONE]` 的情况下断流是本 provider 的
 * 常见故障，必须重试而不是让整轮静默结束。未显式配置 retryPolicy 时生效。
 */
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
  STREAM_CLOSED_CODE
]);

const OFF_REASONING_EFFORT = ReasoningEffortId("off");
const LOW_REASONING_EFFORT = ReasoningEffortId("low");
const HIGH_REASONING_EFFORT = ReasoningEffortId("high");
const MAX_REASONING_EFFORT = ReasoningEffortId("max");

const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: "Off" },
  { id: LOW_REASONING_EFFORT, name: "Low" },
  { id: HIGH_REASONING_EFFORT, name: "High" },
  { id: MAX_REASONING_EFFORT, name: "Max" }
];

function providerRetryAfterMs(value: string | null) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1e3;
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

function httpErrorCode(status: number, error: WireError | undefined) {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 413) return "INVALID_REQUEST";
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}

// ---------------------------------------------------------------------------
// 适配器实现。
// ---------------------------------------------------------------------------

class NvidiaAdapter extends LlmAdapter {
  constructor(private readonly config: NvidiaAdapterServices) {
    super();
  }

  providerInfo(provider: string) {
    return { id: provider, name: "Nvidia NIM" };
  }

  providerRetryPolicy(_provider: string) {
    return this.config.options().retryPolicy;
  }

  // 未声明 provider 专属图片计价，token meter 使用中性估算。
  imageRequestPricing(_provider: string, _model: string) {
    return undefined;
  }

  listModels(provider: string): Promise<LlmModelInfo[]> {
    return Promise.resolve(
      this.config.options().models.map((model) => ({
        provider,
        id: model.id,
        name: model.name ?? model.id,
        ...(model.description === undefined ? {} : { description: model.description }),
        inputModalities: model.inputModalities ?? ["text"]
      }))
    );
  }

  resolveModel(provider: string, model: string, _signal?: AbortSignal) {
    return Promise.resolve(this.modelInfoFor(provider, model));
  }

  modelInfoFor(provider: string, model: string, options = this.config.options()): LlmResolvedModelInfo {
    const configured = options.models.find((entry) => entry.id === model);
    const inputModalities = configured?.inputModalities ?? ["text"];
    return {
      ...(configured === undefined
        ? { provider, id: model, name: model, inputModalities: ["text"] }
        : {
            provider,
            id: configured.id,
            name: configured.name ?? configured.id,
            ...(configured.description === undefined ? {} : { description: configured.description }),
            inputModalities
          }),
      context: { contextWindow: configured?.contextWindow ?? options.defaultContextWindow },
      defaultMaxTokens: configured?.maxTokens ?? options.maxTokens,
      reasoning: {
        efforts: REASONING_EFFORTS,
        defaultEffort: options.defaultReasoningEffort === "low"
          ? LOW_REASONING_EFFORT
          : options.defaultReasoningEffort === "high"
            ? HIGH_REASONING_EFFORT
            : options.defaultReasoningEffort === "max"
              ? MAX_REASONING_EFFORT
              : OFF_REASONING_EFFORT
      }
    };
  }

  prepareCall(provider: string, model: string, _signal?: AbortSignal) {
    const options = this.config.options();
    return Promise.resolve({
      model: this.modelInfoFor(provider, model, options),
      stream: (callOptions: GenerateOptions) => this.streamWithOptions(callOptions, options)
    });
  }

  stream(options: GenerateOptions) {
    return this.streamWithOptions(options, this.config.options());
  }

  async *streamWithOptions(options: GenerateOptions, connection: NvidiaAdapterOptions): AsyncGenerator<StreamChunk, void, unknown> {
    options = { ...options, messages: [...Llm.projectOffloadedImages(options.messages, (ref) => Llm.offloadedImageText(ref))] };
    const hasImages = options.messages.some((message) => contentHasImage(message.content));
    if (hasImages) {
      const model = connection.models.find((entry) => entry.id === options.model);
      if (model?.inputModalities?.includes("image") !== true) {
        throw new LlmError(`NVIDIA model "${options.model}" does not accept image input.`, "UNSUPPORTED_CONTENT");
      }
    }
    const apiKey = await this.config.resolveApiKey(connection);
    const controller = new AbortController();
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal]);

    const iterator = this.request(options, signal, connection, apiKey)[Symbol.asyncIterator]();

    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) return;
        yield result.value;
      }
    } catch (error) {
      if (signal.aborted) {
        if (options.signal?.aborted) {
          throw new LlmError("NVIDIA request aborted by caller", "ABORTED", { cause: error });
        }
        throw new LlmError(`NVIDIA stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, "TIMEOUT", { cause: error });
      }
      if (error instanceof LlmError) throw error;
      throw new LlmError(`NVIDIA API stream from ${connection.baseURL} failed`, "TRANSPORT", { cause: error });
    } finally {
      controller.abort("NVIDIA stream consumer stopped");
      if (iterator.return !== undefined) {
        try {
          await iterator.return();
        } catch {}
      }
    }
  }

  async *request(options: GenerateOptions, signal: AbortSignal, connection: NvidiaAdapterOptions, apiKey: string): AsyncGenerator<StreamChunk, void, unknown> {
    const requestImages = await prepareRequestImages(options.messages, this.config.resolveAttachments?.(), signal);
    const body = serializeRequest(options, connection, requestImages);
    const payload = JSON.stringify(body);

    const headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      ...attributionHeaders()
    };

    let response;
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      // 网络/连接层失败（TRANSPORT）：把底层的 cause message（如 DNS/超时/证书错误）
      // 一并带进错误信息，让前端 turn-error 提示能展示可读的排查依据。
      const causeMessage = error instanceof Error ? error.message : String(error);
      throw new LlmError(
        `NVIDIA API request to ${connection.baseURL} failed${causeMessage ? `: ${causeMessage}` : ""}`,
        "TRANSPORT",
        { cause: error }
      );
    }

    if (!response.ok) {
      let providerError: WireError | undefined;
      const rawResponse = await response.text();
      try {
        providerError = JSON.parse(rawResponse).error;
      } catch {}
      const detail = [providerError?.code, providerError?.type, providerError?.message]
        .filter((field) => typeof field === "string")
        .join(" ");
      // 错误信息带上 HTTP 状态 + NVIDIA 返回的完整错误详情，使前端 turn-error 提示
      // （红点 + 红色标题 + 信息 + 错误码）能展示可读、完整的排查依据。
      const message = `NVIDIA API error (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
      const delay = providerRetryAfterMs(response.headers.get("retry-after"));
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        cause: new Error(rawResponse.length > 0 ? rawResponse : `NVIDIA HTTP ${response.status}`),
        status: response.status,
        ...(delay === undefined ? {} : { providerRetryAfterMs: delay })
      });
    }

    if (!response.body) throw new LlmError("NVIDIA API returned no response body", "EMPTY_RESPONSE");
    yield* translate(parseSse(response.body));
  }
}

// ---------------------------------------------------------------------------
// 插件入口。
// ---------------------------------------------------------------------------

const name = "llm-nim";
const inject = ["llm"];

const SETTINGS_ENTRY_ID = "llm-nvidia-completions";
const DEFAULT_API_KEY_ENV = "NVIDIA_API_KEY";
const PROVIDER = "nvidia-completions";

const DEFAULT_MODELS: NvidiaCatalogModel[] = [];

const catalogModel: z<NvidiaCatalogModel> = z.object({
  id: z.string().required().description("模型 ID（provider 接受的确切标识）"),
  name: z.string().description("模型显示名称"),
  description: z.string().description("模型描述"),
  contextWindow: z.number().step(1).min(1).description("上下文窗口（context window，token）"),
  maxTokens: z.number().step(1).min(1).description("最大输出 Token（max output tokens）"),
  topP: z.number().min(0).max(1).description("核采样 top_p（0~1，缺省继承 provider 默认）"),
  inputModalities: z.array(z.union(["text", "image"])).min(1).default(["text"]).description("支持的输入模态")
});

export type NvidiaLiveConfig = { [K in keyof Required<NvidiaConfig>]: Volatile<NvidiaConfig[K]> };

const Config = z.object({
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).description("承载 API 密钥的环境变量").volatile(),
  baseURL: z.string().description("接口 base URL").volatile(),
  defaultReasoningEffort: z.union(["off", "low", "high", "max"]).default("max").description("默认推理强度").volatile(),
  defaultTemperature: z.number().min(0).max(2).default(DEFAULT_TEMPERATURE).description("默认采样温度 temperature（0~2）").volatile(),
  defaultTopP: z.number().min(0).max(1).default(DEFAULT_TOP_P).description("默认核采样 top_p（0~1）").volatile(),
  seed: z.number().step(1).min(0).default(DEFAULT_SEED).description("固定随机种子").volatile(),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).description("单次输出上限 maxTokens（token）").volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).description("默认上下文窗口（token）").volatile(),
  models: z.array(catalogModel).default(DEFAULT_MODELS).description("模型目录").volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).description("流式读取空闲超时（ms）").volatile(),
  retryPolicy: RetryPolicySchema.volatile()
});

const BASE_URL_ENV = "NVIDIA_BASE_URL";
const PUBLIC_BASE_URL = "https://integrate.api.nvidia.com/v1";

function resolveModels(models: NvidiaCatalogModel[] | undefined): NvidiaCatalogModel[] {
  const seen = new Set();
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error("llm-nvidia-completions: catalog model ids must be non-empty");
    if (model.name !== undefined && model.name.length === 0) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" has an empty name`);
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" contextWindow must be a positive integer`);
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" maxTokens must be a positive integer`);
    if (model.topP !== undefined && (!Number.isFinite(model.topP) || model.topP < 0 || model.topP > 1)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" topP must be a finite number from 0 through 1`);
    const inputModalities = model.inputModalities ?? ["text"];
    if (inputModalities.length === 0) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must not be empty`);
    if (inputModalities.some((m) => !["text", "image"].includes(m))) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must contain only "text" and "image"`);
    if (new Set(inputModalities).size !== inputModalities.length) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must not contain duplicates`);
    if (seen.has(model.id)) throw new Error(`llm-nvidia-completions: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      ...(model.topP === undefined ? {} : { topP: model.topP }),
      inputModalities: [...inputModalities]
    };
  });
}

function resolveAdapterOptions(config: NvidiaConfig, environment?: LaunchEnvironmentSnapshot) {
  if (config.defaultContextWindow !== undefined && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) throw new Error("llm-nvidia-completions: defaultContextWindow must be a positive integer");
  if (config.maxTokens !== undefined && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) throw new Error("llm-nvidia-completions: maxTokens must be a positive safe integer");
  if (config.defaultTemperature !== undefined && (!Number.isFinite(config.defaultTemperature) || config.defaultTemperature < 0 || config.defaultTemperature > 2)) throw new Error("llm-nvidia-completions: defaultTemperature must be a finite number from 0 through 2");
  if (config.defaultTopP !== undefined && (!Number.isFinite(config.defaultTopP) || config.defaultTopP < 0 || config.defaultTopP > 1)) throw new Error("llm-nvidia-completions: defaultTopP must be a finite number from 0 through 1");
  if (config.seed !== undefined && (!Number.isSafeInteger(config.seed) || config.seed < 0)) throw new Error("llm-nvidia-completions: seed must be a non-negative safe integer");
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`llm-nvidia-completions: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL: config.baseURL ?? environment?.get(BASE_URL_ENV)?.value ?? PUBLIC_BASE_URL,
    defaultReasoningEffort: config.defaultReasoningEffort ?? "max",
    defaultTemperature: config.defaultTemperature ?? DEFAULT_TEMPERATURE,
    defaultTopP: config.defaultTopP ?? DEFAULT_TOP_P,
    seed: config.seed ?? DEFAULT_SEED,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(
      config.retryPolicy ?? { mode: "normal", retryableCodes: [...DEFAULT_RETRYABLE_CODES] },
      "llm-nvidia-completions: retryPolicy"
    )
  };
}

/** Read a detached snapshot of the Loader's live fields. */
export function plainOptions(config: NvidiaLiveConfig): NvidiaConfig {
  return structuredClone(Object.fromEntries(Object.entries(config).map(([key, ref]) => [key, ref.get()]))) as NvidiaConfig;
}

function apply(ctx: Context, config: NvidiaLiveConfig) {
  let lastRaw: NvidiaConfig | undefined;
  let lastGood: NvidiaAdapterOptions | undefined;

  const options = () => {
    const raw = plainOptions(config);
    if (lastGood !== undefined && deepEqualJson(raw, lastRaw)) return lastGood;
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx));
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === undefined) throw error;
      lastRaw = raw;
      ctx.logger.error("llm-nvidia-completions: keeping the last good configuration after an invalid settings section");
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();

  const resolveApiKey = async (connection: NvidiaAdapterOptions) => {
    const ref = connection.apiKeyEnv;
    const credentials = ctx.get("credentials");
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref);
      if (hit !== undefined) return assertUsableApiKey(hit.value, "llm-nvidia-completions", ref);
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref);
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, "llm-nvidia-completions", ref);
    }
    throw new LlmError(`llm-nvidia-completions: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials service (the web Models page writes it), or export ${ref} in the launching environment`, "MISSING_CREDENTIAL");
  };

  const adapter = new NvidiaAdapter({ options, resolveApiKey, resolveAttachments: () => ctx.get("attachments") });

  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: "Nvidia NIM",
      settingsNs: ctx.fiber.entry?.options.id ?? SETTINGS_ENTRY_ID,
      settingsPath: []
    }
  ]);

  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  let registeredPolicy = options().retryPolicy;
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy;
    if (deepEqualJson(policy, registeredPolicy)) return;
    registration.replace([PROVIDER]);
    registeredPolicy = policy;
  };

  ctx.on("loader/volatile-update", ensureRegistrationFacts);
  ctx.inject(["settings"], (settingsCtx: Context) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
  });
}

export {
  apply,
  inject,
  name,
  Config,
  NvidiaAdapter,
  resolveAdapterOptions,
  PUBLIC_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  DEFAULT_SEED,
  DEFAULT_MODELS
};

export type { Context };
export default { name, inject, Config, apply };
