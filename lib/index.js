import { settingsNamespace } from "@deepseek-ai/dsh-settings";
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
  resolveRetryPolicy
} = Llm;
const llmIds = Llm;
const ToolCallId = llmIds.ToolCallId ?? llmIds.CallId ?? (() => {
  throw new Error("DSH LLM does not expose a tool call ID factory");
});
function reasoningEffort(effort) {
  if (effort === "off" || effort === "low" || effort === "high" || effort === "max") return effort;
  throw new LlmError(`Nvidia NIM does not support reasoning effort "${effort}"`, "UNSUPPORTED_REASONING_EFFORT");
}
function flattenText(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
const REQUEST_IMAGE_POLICY = { maxPixels: 4194304, maxBytes: 1048576 };
async function prepareRequestImages(messages, attachments, signal) {
  const refs = /* @__PURE__ */ new Map();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const block of message.content) {
      if (block.type === "image") refs.set(block.attachment.attachmentId, block.attachment);
    }
  }
  if (refs.size === 0) return /* @__PURE__ */ new Map();
  if (attachments === void 0) throw new LlmError("NVIDIA image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
  const ordered = [...refs.values()];
  const prepared = await Promise.all(ordered.map((ref) => attachments.readImageRequest(ref, REQUEST_IMAGE_POLICY, signal)));
  return new Map(ordered.map((ref, index) => [ref.attachmentId, prepared[index]]));
}
function inlineImageUrl(block, requestImages) {
  const version = requestImages.get(block.attachment.attachmentId);
  if (version === void 0) throw new LlmError(`NVIDIA request image ${block.attachment.attachmentId} was not prepared`, "INVALID_REQUEST");
  const base64 = Buffer.from(version.data).toString("base64");
  return `data:${version.mediaType};base64,${base64}`;
}
function serializeMessage(message, requestImages) {
  if (message.role === "system") {
    return { role: "system", content: flattenText(message.content) };
  }
  if (message.role === "assistant") {
    const text = flattenText(message.content);
    const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
    const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
      id: block.id,
      type: "function",
      function: { name: block.name, arguments: block.arguments }
    }));
    return {
      role: "assistant",
      content: text !== "" ? text : null,
      ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
      ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
    };
  }
  const content = [];
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text.length > 0) content.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      content.push({ type: "image_url", image_url: { url: inlineImageUrl(block, requestImages) } });
    } else if (block.type === "tool-result") {
      const resultText = flattenText(block.content);
      content.push({ type: "text", text: resultText || "(no output)" });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  if (content.length === 1 && content[0].type === "text") {
    return { role: "user", content: content[0].text ?? "" };
  }
  return { role: "user", content };
}
function serializeMessages(messages, requestImages) {
  const wire = [];
  for (const message of messages) {
    if (message.role === "system" || message.role === "assistant") {
      wire.push(serializeMessage(message, requestImages));
      continue;
    }
    const regular = message.content.filter((block) => block.type !== "tool-result");
    const toolResults = message.content.filter((block) => block.type === "tool-result");
    if (regular.length > 0 || toolResults.length === 0) {
      wire.push(serializeMessage({ ...message, content: regular }, requestImages));
    }
    for (const result of toolResults) {
      wire.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: flattenText(result.content) || "(no output)"
      });
    }
  }
  return wire;
}
function serializeRequest(options, config, requestImages) {
  const messages = [];
  if (options.system !== void 0) messages.push({ role: "system", content: options.system });
  messages.push(...serializeMessages(options.messages, requestImages));
  const tools = options.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
  const effort = options.reasoningEffort === void 0 ? config.defaultReasoningEffort : reasoningEffort(options.reasoningEffort);
  const temperature = options.temperature !== void 0 ? options.temperature : config.defaultTemperature;
  const modelEntry = config.models.find((entry) => entry.id === options.model);
  const topP = modelEntry?.topP !== void 0 ? modelEntry.topP : config.defaultTopP;
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...effort !== void 0 && effort !== "off" ? { reasoning_effort: effort } : {},
    ...config.seed !== void 0 ? { seed: config.seed } : {},
    ...temperature !== void 0 ? { temperature } : {},
    ...topP !== void 0 ? { top_p: topP } : {},
    ...tools !== void 0 && tools.length > 0 ? { tools } : {},
    ...options.maxTokens === void 0 ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== void 0 ? { stop: options.stop } : {}
  };
}
async function* parseSse(stream, onActivity) {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  for await (const event of events) {
    onActivity?.();
    yield event.data;
    if (event.data === "[DONE]") return;
  }
}
function mapFinishReason(reason) {
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
function mapUsage(usage) {
  if (!usage) return void 0;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cacheRead = usage.prompt_tokens_details?.cached_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  const combined = promptTokens + completionTokens;
  const hasExactTotal = Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0 && (usage.total_tokens === void 0 || usage.total_tokens === combined);
  return {
    inputTokens: promptTokens - (cacheRead ?? 0),
    outputTokens: completionTokens,
    ...hasExactTotal ? { totalTokens: combined } : {},
    ...cacheRead !== void 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
  };
}
function closeBlock(block) {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return { type: "tool-call", id: ToolCallId(block.callId ?? ""), name: block.name ?? "", arguments: block.text };
    default:
      return void 0;
  }
}
function tryParseInvokeText(text) {
  if (typeof text !== "string" || text.length === 0) return void 0;
  const outer = /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/;
  const match = outer.exec(text);
  if (!match) return void 0;
  const name2 = match[1];
  const inner = match[2];
  const args = {};
  const paramRe = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
  let pm;
  while ((pm = paramRe.exec(inner)) !== null) args[pm[1]] = pm[2];
  return { name: name2, arguments: JSON.stringify(args), text };
}
async function* translate(payloads) {
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;
  let pendingContent = "";
  let recoveringInvoke = false;
  function open(kind) {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  }
  function* recoveredToolCallChunks(parsed) {
    const block = open("tool-call");
    block.callId = `recovered-${order.length}`;
    block.name = parsed.name;
    block.text = parsed.arguments;
    toolBlocks.set(-1, block);
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
  function* finalize(reason) {
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
      reason: reason.kind === "stop" && order.length === 0 ? {
        kind: "error",
        failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
      } : reason
    };
  }
  for await (const payload of payloads) {
    if (payload === "[DONE]") {
      yield* finalize(pendingFinish ?? { kind: "stop" });
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      const content = delta.content;
      if (typeof content === "string" && content.length > 0) {
        if (recoveringInvoke) {
          pendingContent += content;
        } else {
          const idx = content.indexOf("<inv");
          if (idx !== -1) {
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
            if (!textBlock) {
              textBlock = open("text");
              yield { type: "block-start", index: textBlock.index, blockType: "text" };
            }
            textBlock.text += content;
            yield { type: "text-delta", index: textBlock.index, text: content };
          }
        }
      }
      for (const call of delta.tool_calls ?? []) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(call.index, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== void 0) block.callId = call.id;
        if (call.function?.name !== void 0) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: ToolCallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") pendingFinish = mapFinishReason(choice.finish_reason);
    }
    if (chunk.usage) pendingUsage = chunk.usage;
  }
  if (pendingFinish !== void 0) {
    yield* finalize(pendingFinish);
    return;
  }
  if (order.length > 0 || recoveringInvoke) {
    yield* finalize({ kind: "max-tokens" });
    return;
  }
  throw new LlmError("SSE stream ended without [DONE] and without any termination", STREAM_CLOSED_CODE);
}
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
const DEFAULT_CONTEXT_WINDOW = 256e3;
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TOP_P = 1;
const DEFAULT_SEED = 0;
const STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
const STREAM_CLOSED_CODE = "STREAM_CLOSED";
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
function providerRetryAfterMs(value) {
  if (value === null) return void 0;
  if (/^\d+$/.test(value)) {
    const delay2 = Number(value) * 1e3;
    return Number.isFinite(delay2) && delay2 > 0 ? delay2 : void 0;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : void 0;
}
function httpErrorCode(status, error) {
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
class NvidiaAdapter extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config;
  }
  providerInfo(provider) {
    return { id: provider, name: "Nvidia NIM" };
  }
  providerRetryPolicy(_provider) {
    return this.config.options().retryPolicy;
  }
  // 宿主 dsh-llm ≥0.1.5 的 token meter（/compact 等）会同步调用此方法，而本插件解析到的
  // 旧版 LlmAdapter 基类没有它；显式声明无图片计价，让 token meter 回落到中性估算。
  imageRequestPricing(_provider, _model) {
    return void 0;
  }
  listModels(provider) {
    return Promise.resolve(
      this.config.options().models.map((model) => ({
        provider,
        id: model.id,
        name: model.name ?? model.id,
        ...model.description === void 0 ? {} : { description: model.description },
        inputModalities: model.inputModalities ?? ["text"]
      }))
    );
  }
  resolveModel(provider, model, _signal) {
    return Promise.resolve(this.modelInfoFor(provider, model));
  }
  modelInfoFor(provider, model) {
    const options = this.config.options();
    const configured = options.models.find((entry) => entry.id === model);
    const inputModalities = configured?.inputModalities ?? ["text"];
    return {
      ...configured === void 0 ? { provider, id: model, name: model, inputModalities: ["text"] } : {
        provider,
        id: configured.id,
        name: configured.name ?? configured.id,
        ...configured.description === void 0 ? {} : { description: configured.description },
        inputModalities
      },
      context: { contextWindow: configured?.contextWindow ?? options.defaultContextWindow },
      defaultMaxTokens: configured?.maxTokens ?? options.maxTokens,
      reasoning: {
        efforts: REASONING_EFFORTS,
        defaultEffort: options.defaultReasoningEffort === "low" ? LOW_REASONING_EFFORT : options.defaultReasoningEffort === "high" ? HIGH_REASONING_EFFORT : options.defaultReasoningEffort === "max" ? MAX_REASONING_EFFORT : OFF_REASONING_EFFORT
      }
    };
  }
  prepareCall(provider, model, _signal) {
    const options = this.config.options();
    return Promise.resolve({
      model: this.modelInfoFor(provider, model),
      stream: (callOptions) => this.streamWithOptions(callOptions, options)
    });
  }
  stream(options) {
    return this.streamWithOptions(options, this.config.options());
  }
  async *streamWithOptions(options, connection) {
    const hasImages = options.messages.some((message) => contentHasImage(message.content));
    if (hasImages) {
      const model = connection.models.find((entry) => entry.id === options.model);
      if (model?.inputModalities?.includes("image") !== true) {
        throw new LlmError(`NVIDIA model "${options.model}" does not accept image input.`, "UNSUPPORTED_CONTENT");
      }
    }
    const apiKey = await this.config.resolveApiKey(connection);
    const controller = new AbortController();
    const signal = options.signal === void 0 ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
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
      if (iterator.return !== void 0) {
        try {
          await iterator.return();
        } catch {
        }
      }
    }
  }
  async *request(options, signal, connection, apiKey) {
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
      const causeMessage = error instanceof Error ? error.message : String(error);
      throw new LlmError(
        `NVIDIA API request to ${connection.baseURL} failed${causeMessage ? `: ${causeMessage}` : ""}`,
        "TRANSPORT",
        { cause: error }
      );
    }
    if (!response.ok) {
      let providerError;
      const rawResponse = await response.text();
      try {
        providerError = JSON.parse(rawResponse).error;
      } catch {
      }
      const detail = [providerError?.code, providerError?.type, providerError?.message].filter((field) => typeof field === "string").join(" ");
      const message = `NVIDIA API error (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
      const delay = providerRetryAfterMs(response.headers.get("retry-after"));
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        cause: new Error(rawResponse.length > 0 ? rawResponse : `NVIDIA HTTP ${response.status}`),
        status: response.status,
        ...delay === void 0 ? {} : { providerRetryAfterMs: delay }
      });
    }
    if (!response.body) throw new LlmError("NVIDIA API returned no response body", "EMPTY_RESPONSE");
    yield* translate(parseSse(response.body));
  }
}
const name = "llm-nvidia-completions";
const inject = ["llm"];
const NS = settingsNamespace("llm-nvidia-completions");
const DEFAULT_API_KEY_ENV = "NVIDIA_API_KEY";
const PROVIDER = "nvidia-completions";
const DEFAULT_MODELS = [
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    inputModalities: ["text", "image"]
  }
];
const catalogModel = z.object({
  id: z.string().required().description("\u6A21\u578B ID\uFF08provider \u63A5\u53D7\u7684\u786E\u5207\u6807\u8BC6\uFF09"),
  name: z.string().description("\u6A21\u578B\u663E\u793A\u540D\u79F0"),
  description: z.string().description("\u6A21\u578B\u63CF\u8FF0"),
  contextWindow: z.number().step(1).min(1).description("\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF08context window\uFF0Ctoken\uFF09"),
  maxTokens: z.number().step(1).min(1).description("\u6700\u5927\u8F93\u51FA Token\uFF08max output tokens\uFF09"),
  topP: z.number().min(0).max(1).description("\u6838\u91C7\u6837 top_p\uFF080~1\uFF0C\u7F3A\u7701\u7EE7\u627F provider \u9ED8\u8BA4\uFF09"),
  inputModalities: z.array(z.union(["text", "image"])).min(1).default(["text"]).description("\u652F\u6301\u7684\u8F93\u5165\u6A21\u6001")
});
const Config = z.object({
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).description("\u627F\u8F7D API \u5BC6\u94A5\u7684\u73AF\u5883\u53D8\u91CF"),
  baseURL: z.string().description("\u63A5\u53E3 base URL"),
  defaultReasoningEffort: z.union(["off", "low", "high", "max"]).default("max").description("\u9ED8\u8BA4\u63A8\u7406\u5F3A\u5EA6"),
  defaultTemperature: z.number().min(0).max(2).default(DEFAULT_TEMPERATURE).description("\u9ED8\u8BA4\u91C7\u6837\u6E29\u5EA6 temperature\uFF080~2\uFF09"),
  defaultTopP: z.number().min(0).max(1).default(DEFAULT_TOP_P).description("\u9ED8\u8BA4\u6838\u91C7\u6837 top_p\uFF080~1\uFF09"),
  seed: z.number().step(1).min(0).default(DEFAULT_SEED).description("\u56FA\u5B9A\u968F\u673A\u79CD\u5B50"),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).description("\u5355\u6B21\u8F93\u51FA\u4E0A\u9650 maxTokens\uFF08token\uFF09"),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).description("\u9ED8\u8BA4\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF08token\uFF09"),
  models: z.array(catalogModel).default(DEFAULT_MODELS).description("\u6A21\u578B\u76EE\u5F55"),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).description("\u6D41\u5F0F\u8BFB\u53D6\u7A7A\u95F2\u8D85\u65F6\uFF08ms\uFF09"),
  retryPolicy: RetryPolicySchema
});
const BASE_URL_ENV = "NVIDIA_BASE_URL";
const PUBLIC_BASE_URL = "https://integrate.api.nvidia.com/v1";
function resolveModels(models) {
  const seen = /* @__PURE__ */ new Set();
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error("llm-nvidia-completions: catalog model ids must be non-empty");
    if (model.name !== void 0 && model.name.length === 0) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" has an empty name`);
    if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" contextWindow must be a positive integer`);
    if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" maxTokens must be a positive integer`);
    if (model.topP !== void 0 && (!Number.isFinite(model.topP) || model.topP < 0 || model.topP > 1)) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" topP must be a finite number from 0 through 1`);
    const inputModalities = model.inputModalities ?? ["text"];
    if (inputModalities.length === 0) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must not be empty`);
    if (inputModalities.some((m) => !["text", "image"].includes(m))) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must contain only "text" and "image"`);
    if (new Set(inputModalities).size !== inputModalities.length) throw new Error(`llm-nvidia-completions: catalog model "${model.id}" inputModalities must not contain duplicates`);
    if (seen.has(model.id)) throw new Error(`llm-nvidia-completions: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...model.name === void 0 ? {} : { name: model.name },
      ...model.description === void 0 ? {} : { description: model.description },
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
      ...model.topP === void 0 ? {} : { topP: model.topP },
      inputModalities: [...inputModalities]
    };
  });
}
function resolveAdapterOptions(config, environment) {
  if (config.defaultContextWindow !== void 0 && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) throw new Error("llm-nvidia-completions: defaultContextWindow must be a positive integer");
  if (config.maxTokens !== void 0 && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) throw new Error("llm-nvidia-completions: maxTokens must be a positive safe integer");
  if (config.defaultTemperature !== void 0 && (!Number.isFinite(config.defaultTemperature) || config.defaultTemperature < 0 || config.defaultTemperature > 2)) throw new Error("llm-nvidia-completions: defaultTemperature must be a finite number from 0 through 2");
  if (config.defaultTopP !== void 0 && (!Number.isFinite(config.defaultTopP) || config.defaultTopP < 0 || config.defaultTopP > 1)) throw new Error("llm-nvidia-completions: defaultTopP must be a finite number from 0 through 1");
  if (config.seed !== void 0 && (!Number.isSafeInteger(config.seed) || config.seed < 0)) throw new Error("llm-nvidia-completions: seed must be a non-negative safe integer");
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
function apply(ctx, config) {
  let current = () => config;
  let lastRaw;
  let lastGood;
  const options = () => {
    const raw = current();
    if (raw === lastRaw && lastGood !== void 0) return lastGood;
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx));
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === void 0) throw error;
      lastRaw = raw;
      ctx.logger.error("llm-nvidia-completions: keeping the last good configuration after an invalid settings section");
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();
  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyEnv;
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref);
      if (hit !== void 0) return assertUsableApiKey(hit.value, "llm-nvidia-completions", ref);
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref);
      if (ambient !== void 0 && ambient.value.length > 0) return assertUsableApiKey(ambient.value, "llm-nvidia-completions", ref);
    }
    throw new LlmError(`llm-nvidia-completions: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials service (the web Models page writes it), or export ${ref} in the launching environment`, "MISSING_CREDENTIAL");
  };
  const adapter = new NvidiaAdapter({ options, resolveApiKey, resolveAttachments: () => ctx.get("attachments") });
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: "Nvidia NIM",
      settingsNs: NS,
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
  ctx.inject(["settings"], (settingsCtx) => {
    const hooks = {
      setSource: (source) => {
        current = source;
      },
      onChange: ensureRegistrationFacts
    };
    const settings = settingsCtx.settings;
    if (typeof settings.installSection === "function") {
      settings.installSection(ctx, NS, Config, config, hooks);
      return;
    }
    const scope = settingsCtx.settings.register(NS, Config, { base: config });
    hooks.setSource(() => scope.get());
    hooks.onChange();
    scope.watch(() => hooks.onChange());
  });
}
var index_default = { name, inject, Config, apply };
export {
  Config,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  DEFAULT_SEED,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  NvidiaAdapter,
  PUBLIC_BASE_URL,
  apply,
  index_default as default,
  inject,
  name,
  resolveAdapterOptions
};
