import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { LlmRuntime, attributionHeaders, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import plugin, { NvidiaAdapter, resolveAdapterOptions } from '../dist/index.js';

const options = resolveAdapterOptions({});
const request = {
  provider: 'nvidia-completions', model: 'moonshotai/kimi-k3',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
};

async function stream(t, payloads, call = request) {
  let body;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, `${options.baseURL}/chat/completions`);
    assert.equal(init.headers.authorization, 'Bearer test-key');
    for (const [name, value] of Object.entries(attributionHeaders())) assert.equal(init.headers[name], value);
    body = JSON.parse(init.body);
    const wire = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('');
    return new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
  });
  const adapter = new NvidiaAdapter({ options: () => options, resolveApiKey: async () => 'test-key' });
  const chunks = await Array.fromAsync(adapter.stream(call));
  return { chunks, body };
}

const delta = (value, finish_reason) => ({ choices: [{ delta: value, finish_reason }] });

test('defaults to an empty catalog and preserves configured models', () => {
  assert.deepEqual(options.models, []);
  const models = [{ id: 'example/model', name: 'Example', inputModalities: ['text'] }];
  assert.deepEqual(resolveAdapterOptions({ models }).models, models);
});

test('streams reasoning, text and disjoint token usage', async (t) => {
  const { chunks, body } = await stream(t, [
    delta({ reasoning_content: 'think' }), delta({ content: 'answer' }, 'stop'),
    { usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, prompt_tokens_details: { cached_tokens: 2 } } },
    '[DONE]',
  ]);
  assert.deepEqual(chunks.filter((c) => c.type === 'block-end').map((c) => c.block), [
    { type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' },
  ]);
  assert.deepEqual(chunks.find((c) => c.type === 'usage').usage, { inputTokens: 10, outputTokens: 5, totalTokens: 17, cacheReadTokens: 2 });
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.equal(body.reasoning_effort, 'max');
  assert.equal(body.stream, true);
});

test('closes an interrupted stream without discarding received text', async (t) => {
  const { chunks } = await stream(t, [delta({ content: 'partial' })]);
  assert.equal(chunks.find((c) => c.type === 'block-end').block.text, 'partial');
  assert.equal(chunks.at(-1).reason.kind, 'max-tokens');
});

test('uses upstream finish_reason even when DONE is absent', async (t) => {
  const { chunks } = await stream(t, [delta({ content: 'complete' }, 'stop')]);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('rejects a completely empty interrupted stream with a retryable code', async (t) => {
  await assert.rejects(stream(t, []), { code: 'STREAM_CLOSED' });
  assert.ok(options.retryPolicy.retryableCodes.includes('STREAM_CLOSED'));
});

test('assembles tool deltas and serializes tool results separately', async (t) => {
  const { chunks, body } = await stream(t, [
    delta({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'search', arguments: '{"q":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] }, 'tool_calls'), '[DONE]',
  ], { ...request, messages: [
    createUserMessage({ content: [{ type: 'text', text: 'next' }], source: { kind: 'user' } }),
    createToolResultMessage({ callId: 'previous', content: [{ type: 'text', text: 'result' }], isError: false }),
  ] });
  assert.deepEqual(chunks.find((c) => c.type === 'block-end').block, {
    type: 'tool-call', id: 'call-1', name: 'search', arguments: '{"q":"hello"}',
  });
  assert.deepEqual(body.messages, [{ role: 'user', content: 'next' }, { role: 'tool', tool_call_id: 'previous', content: 'result' }]);
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
});

test('recovers DSML tool calls split across content deltas', async (t) => {
  const { chunks } = await stream(t, [
    delta({ content: '<inv' }), delta({ content: 'oke name="search"><parameter name="q">hello</parameter></invoke>' }, 'tool_calls'), '[DONE]',
  ]);
  assert.deepEqual(chunks.find((c) => c.type === 'block-end').block, {
    type: 'tool-call', id: 'recovered-1', name: 'search', arguments: '{"q":"hello"}',
  });
});

test('client bundle registers with the DSH loader and exposes a settings plugin', async () => {
  let registered;
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (definition) => { registered = definition; } } },
  });
  assert.equal(registered.id, 'dsh-llm-nim');
  const client = registered.factory(createRequire(import.meta.url));
  assert.equal(typeof client.apply, 'function');
  assert.equal(client.default.apply, client.apply);
  const dictionaries = [];
  let section;
  client.apply({
    locale: { bind: () => (key) => key, register: (...args) => { dictionaries.push(args); return () => {}; } },
    effect: (callback) => callback(), get: () => ({ credentials: {} }),
    configForms: { get: (entryId) => { assert.equal(entryId, 'llm-nvidia-completions'); return {}; } },
    slots: { inject: (_, callback) => callback(), register: (options) => { section = options; } },
  });
  assert.equal(dictionaries.length, 2);
  assert.equal(section.id, 'nvidia-nim');
  assert.equal(plugin.apply.name, 'apply');
});


test('projects developer tool changes to current OpenAI tool declarations', async (t) => {
  const { body } = await stream(t, [delta({ content: 'ok' }, 'stop'), '[DONE]'], {
    ...request,
    messages: [
      { role: 'developer', content: [{ type: 'tool-addition', toolName: 'search' }] },
      ...request.messages,
    ],
    tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
  });
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(body.tools[0].function.name, 'search');
});

test('uses explicit image dimensions and sends prepared inline bytes', async (t) => {
  const ref = { attachmentId: 'image-1', width: 4096, height: 2048, name: 'image.png' };
  const config = resolveAdapterOptions({ models: [{ id: request.model, inputModalities: ['text', 'image'] }] });
  let body;
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    body = JSON.parse(init.body);
    return new Response(`data: ${JSON.stringify(delta({ content: 'image' }, 'stop'))}\n\ndata: [DONE]\n\n`);
  });
  let target;
  const adapter = new NvidiaAdapter({
    options: () => config, resolveApiKey: async () => 'test-key',
    resolveAttachments: () => ({ readImageRequest: async (received, dimensions) => {
      assert.equal(received, ref);
      target = dimensions;
      return { data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' };
    } }),
  });
  await Array.fromAsync(adapter.stream({ ...request, messages: [{ role: 'user', content: [{ type: 'image', attachment: ref }] }] }));
  assert.deepEqual(target, { width: 2896, height: 1448, maxBytes: 1048576 });
  assert.deepEqual(body.messages[0].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }]);
});

test('does not upload images the host has offloaded', async (t) => {
  const ref = { attachmentId: 'image-1', width: 100, height: 100, name: 'image.png' };
  const { body } = await stream(t, [delta({ content: 'ok' }, 'stop'), '[DONE]'], {
    ...request, messages: [{ role: 'user', content: [{ type: 'image', attachment: ref, offloaded: true }] }],
  });
  assert.equal(typeof body.messages[0].content, 'string');
  assert.ok(body.messages[0].content.includes('image.png'));
});

test('loader updates live config without remounting and retains prepared calls', async (t) => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(LlmRuntime).await();
  await ctx.plugin(Loader).await();
  const loader = ctx.loader;
  loader.builtins.nvidia = plugin;
  const initial = { baseURL: 'https://old.example/v1', models: [{ id: request.model }], maxTokens: 100 };
  await loader.root.update([{ id: 'custom-nvidia', name: 'cordis:nvidia', config: initial }]);
  await loader.await();
  const entry = loader.resolve('custom-nvidia');
  const fiber = entry.fiber;
  assert.ok(fiber);
  assert.equal(ctx.llm.listConfigurableProviders()[0].settingsNs, 'custom-nvidia');
  ctx.provide('credentials', { resolve: async () => ({ value: 'test-key' }) });
  const prepared = await ctx.llm.prepareCall({ provider: request.provider, model: request.model });
  assert.equal(prepared.config.maxTokens, 100);
  const originalRetry = prepared.retryPolicy;
  await entry.update({ config: { ...initial, baseURL: 'https://new.example/v1', maxTokens: 200, retryPolicy: { mode: 'normal', maxRetries: 0 } } });
  await loader.await();
  assert.equal(entry.fiber, fiber);
  const updated = await ctx.llm.prepareCall({ provider: request.provider, model: request.model });
  assert.equal(updated.config.maxTokens, 200);
  assert.notDeepEqual(updated.retryPolicy, originalRetry);
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return new Response(`data: ${JSON.stringify(delta({ content: 'ok' }, 'stop'))}\n\ndata: [DONE]\n\n`);
  });
  for (const call of [prepared, updated]) {
    const chunks = await Array.fromAsync(call.stream({ ...request, ...call.config }));
    assert.equal(chunks.at(-1).reason.kind, 'stop');
  }
  assert.deepEqual(urls, ['https://old.example/v1/chat/completions', 'https://new.example/v1/chat/completions']);
});

async function settingsSave(accepted) {
  let registered;
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (definition) => { registered = definition; } } },
  });
  const changes = [];
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => { changes.push(value); }],
    useEffect: () => {}, useCallback: (callback) => callback,
    useSyncExternalStore: (_, read) => read(),
  };
  const require = createRequire(import.meta.url);
  const client = registered.factory((id) => id === 'react' ? react : require(id));
  let component;
  let injected;
  let mutation;
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: { baseURL: 'https://example.test/v1', models: [] }, writable: true, mode: 'host', revision: 7 }),
    mutate: async (ops, revision) => { mutation = { ops, revision }; return accepted; },
  };
  client.apply({
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (callback) => callback(), get: () => ({ credentials: {} }),
    configForms: { get: () => scope },
    slots: { inject: (_, callback) => callback(), register: (options, render) => { injected = options.inject(); component = render; } },
  });
  const tree = component(injected);
  function findSave(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button' && node.props.children === 'save') return node;
    for (const child of [node.props?.children].flat()) {
      const found = findSave(child);
      if (found) return found;
    }
  }
  await findSave(tree).props.onClick();
  return { mutation, changes };
}

test('settings save submits one atomic mutation using the draft revision', async () => {
  const { mutation, changes } = await settingsSave(true);
  assert.equal(mutation.revision, 7);
  assert.equal(mutation.ops.length, 8);
  assert.equal(mutation.ops[0].op, 'set');
  assert.equal(mutation.ops[0].value, 'https://example.test/v1');
  assert.ok(changes.includes('saved'));
});

test('settings save displays failure when the host refuses the mutation', async () => {
  const { changes } = await settingsSave(false);
  assert.ok(changes.includes('failed'));
  assert.ok(!changes.includes('saved'));
});
