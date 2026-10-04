import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
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
    body = JSON.parse(init.body);
    const wire = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('');
    return new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
  });
  const adapter = new NvidiaAdapter({ options: () => options, resolveApiKey: async () => 'test-key' });
  const chunks = await Array.fromAsync(adapter.stream(call));
  return { chunks, body };
}

const delta = (value, finish_reason) => ({ choices: [{ delta: value, finish_reason }] });

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
  ], { ...request, messages: [{ role: 'user', content: [
    { type: 'text', text: 'next' }, { type: 'tool-result', toolCallId: 'previous', content: [{ type: 'text', text: 'result' }] },
  ] }] });
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
  assert.equal(registered.id, 'dsh-llm-nvidia-completions');
  const client = registered.factory(createRequire(import.meta.url));
  assert.equal(typeof client.apply, 'function');
  assert.equal(client.default.apply, client.apply);
  const dictionaries = [];
  let section;
  client.apply({
    locale: { bind: () => (key) => key, register: (...args) => { dictionaries.push(args); return () => {}; } },
    effect: (callback) => callback(), get: () => ({ credentials: {} }),
    settingsScope: { bind: () => ({}) },
    slots: { inject: (_, callback) => callback(), register: (options) => { section = options; } },
  });
  assert.equal(dictionaries.length, 2);
  assert.equal(section.id, 'nvidia-nim');
  assert.equal(plugin.apply.name, 'apply');
});
