import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ChatStore } from '../src/chat.js';
import { registerChatRoutes } from '../src/chatRoutes.js';
import { MemoryStore } from '../src/memory/store.js';

const events = (body: string) => body.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
async function* chunks(delta: any) { yield { choices: [{ delta }] }; }
async function harness(t: any, respond: (request: any) => any) {
  const root = await mkdtemp(join(tmpdir(), 'sawot-memory-chat-'));
  const memory = new MemoryStore(root); await memory.init();
  const store = new ChatStore(join(root, 'conversations'));
  const requests: any[] = [];
  const client = { chat: { completions: { create: async (request: any) => {
    requests.push(structuredClone(request)); return respond(request);
  } } } };
  const app = Fastify();
  registerChatRoutes(app, { memory, store, resolve: () => ({ client, model: 'test' }), haTools: [], searchTools: [], ha: null,
    uploadDir: join(root, 'uploads'), name: 'Test', getEntitySummary: () => '', getChatInstructions: () => '', getDefaultModel: () => 'test' });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const create = () => { const conv = store.create('test'); conv.title = 'Memory test'; store.save(conv); return conv; };
  const send = (id: string, content: string) => app.inject({ method: 'POST', url: `/api/chat/conversations/${id}/messages`, payload: { content } });
  return { memory, store, app, requests, create, send, root, client };
}

test('chat captures a fact, persists activity independently, and recalls across chats', async t => {
  let invoked = false;
  const h = await harness(t, request => {
    if (!invoked) {
      invoked = true;
      assert.ok(request.tools.some((x: any) => x.function.name === 'save_memory'));
      return chunks({ tool_calls: [{ index: 0, id: 'save1', function: { name: 'save_memory', arguments: JSON.stringify({ text: 'User owns an RTX 5070 Ti.', topic: 'gpu', category: 'equipment', quote: 'I own an RTX 5070 Ti' }) } }] });
    }
    const question = request.messages.find((m: any) => m.role === 'user')?.content;
    if (question === 'Can my GPU run this?' && !request.messages.some((m: any) => m.role === 'tool')) {
      assert.ok(!JSON.stringify(request.messages).includes('RTX 5070 Ti'), 'first request contains no saved facts');
      return chunks({ tool_calls: [{ index: 0, id: 'search1', function: { name: 'search_memories', arguments: JSON.stringify({ query: 'gpu' }) } }] });
    }
    return chunks({ content: 'Understood.' });
  });
  const conv = h.create();
  const first = events((await h.send(conv.id, 'I own an RTX 5070 Ti')).body);
  assert.ok(first.some(e => e.type === 'memory' && e.kind === 'saved'));
  assert.ok(first.find(e => e.type === 'done').message.memory.some((e: any) => e.kind === 'saved'));
  const debug = JSON.stringify(first.filter(e => e.type === 'debug' || e.type === 'tool'));
  assert.ok(!debug.includes('RTX 5070'), 'generic debug must not contain memory payloads');
  const saved = JSON.parse(await readFile(join(h.root, 'conversations', conv.id + '.json'), 'utf8'));
  assert.equal(saved.messages[1].memory, undefined, 'memory snapshots are not duplicated into conversations');
  const next = h.create();
  const second = events((await h.send(next.id, 'Can my GPU run this?')).body);
  assert.ok(!h.requests.at(-1).messages[0].content.includes('RTX 5070 Ti'));
  assert.ok(h.requests.at(-1).messages.some((m: any) => m.role === 'tool' && m.content.includes('RTX 5070 Ti')));
  assert.ok(second.some(e => e.type === 'memory' && e.kind === 'recalled'));
  const reloaded = (await h.app.inject({ url: `/api/chat/conversations/${conv.id}` })).json();
  assert.ok(reloaded.messages[1].memory.some((e: any) => e.kind === 'saved'));
  const fact = (await h.memory.list()).memories[0];
  await h.memory.delete(fact.id, fact.revision);
  const deleted = (await h.app.inject({ url: `/api/chat/conversations/${conv.id}` })).json();
  assert.ok(deleted.messages[1].memory.every((e: any) => e.memories.every((m: any) => !m.text)));
});

test('provider rejection does not claim recall; committed saves survive later failure', async t => {
  let round = 0;
  const h = await harness(t, () => {
    if (round++ === 0) return chunks({ tool_calls: [{ index: 0, id: 'save', function: { name: 'save_memory', arguments: JSON.stringify({ text: 'User lives in Warsaw.', topic: 'city', category: 'location', quote: 'I live in Warsaw' }) } }] });
    throw Error('Provider unavailable');
  });
  const conv = h.create();
  const result = events((await h.send(conv.id, 'I live in Warsaw')).body);
  assert.ok(result.some(e => e.type === 'error'));
  assert.equal(result.filter(e => e.type === 'memory' && e.kind === 'recalled').length, 0);
  const restored = (await h.app.inject({ url: `/api/chat/conversations/${conv.id}` })).json();
  assert.ok(restored.messages.some((m: any) => m.memory?.some((e: any) => e.kind === 'saved')));
});

test('disabled memory omits tools and context', async t => {
  const h = await harness(t, () => chunks({ content: 'Hello.' }));
  await h.memory.setEnabled(false);
  const result = events((await h.send(h.create().id, 'I live in Warsaw')).body);
  assert.ok(!result.some(e => e.type === 'memory'));
  assert.ok(!h.requests[0].tools?.some((x: any) => x.function.name.includes('memory')));
  assert.equal((await h.memory.list()).memories.length, 0);
});

test('regeneration never resurrects replaced memory turns or changes the visible message count', async t => {
  let first = true;
  const h = await harness(t, () => {
    if (first) { first = false; return chunks({ tool_calls: [{ index: 0, id: 'save', function: { name: 'save_memory', arguments: JSON.stringify({ text: 'User owns a GPU', topic: 'gpu', category: 'equipment', quote: 'I own a GPU' }) } }] }); }
    return chunks({ content: 'Done.' });
  });
  const conv = h.create(); await h.send(conv.id, 'I own a GPU');
  for (let attempt = 0; attempt < 2; attempt++) {
    const visible = (await h.app.inject({ url: `/api/chat/conversations/${conv.id}` })).json();
    assert.equal(visible.messages.length, h.store.get(conv.id).messages.length);
    const response = await h.app.inject({ method: 'POST', url: `/api/chat/conversations/${conv.id}/messages`, payload: { regenerateFrom: 0, expectedMessageCount: visible.messages.length } });
    assert.equal(response.statusCode, 200);
    assert.ok(events(response.body).some(e => e.type === 'done'));
  }
  assert.equal((await h.memory.list()).memories.length, 1);
});

test('clearing memory during a rejected request prevents a fallback from resending deleted facts', async t => {
  let h: Awaited<ReturnType<typeof harness>>;
  let fallbackCalls = 0;
  h = await harness(t, async request => {
    if (!request.messages.some((m: any) => m.role === 'tool')) {
      return chunks({ tool_calls: [{ index: 0, id: 'search', function: { name: 'search_memories', arguments: JSON.stringify({ query: 'gpu' }) } }] });
    }
    assert.ok(request.messages.some((m: any) => m.role === 'tool' && m.content.includes('RTX 5070 Ti')));
    await h.memory.clear();
    throw Object.assign(new Error('reasoning_effort cannot be used with tools'), { status: 400 });
  });
  (h.client as any).responses = { create: async () => { fallbackCalls++; return {}; } };
  const source = await h.memory.beginTurn({ conversationId: 'seed', turnId: 'seed', sourceMessageId: 'seed', text: 'I own an RTX 5070 Ti' });
  await h.memory.capture(source, { text: 'User owns an RTX 5070 Ti', topic: 'gpu', category: 'equipment', quote: source.text });
  await h.send(h.create().id, 'What GPU do I own?');
  assert.equal(fallbackCalls, 0);
  assert.equal((await h.memory.list()).memories.length, 0);
});

test('crash recovery persists missing assistant identity so later regeneration has consistent counts', async t => {
  const h = await harness(t, () => chunks({ content: 'Recovered.' }));
  const conv = h.create(); conv.messages = [{ id: 'source', role: 'user', content: 'I own a GPU' }]; h.store.save(conv);
  const scope = await h.memory.beginTurn({ conversationId: conv.id, turnId: 'interrupted', sourceMessageId: 'source', text: 'I own a GPU' });
  await h.memory.capture(scope, { text: 'User owns a GPU', topic: 'gpu', quote: scope.text });
  const visible = (await h.app.inject({ url: `/api/chat/conversations/${conv.id}` })).json();
  assert.equal(visible.messages.length, 2);
  assert.equal(h.store.get(conv.id).messages.length, 2);
  assert.equal(visible.messages[1].memory[0].kind, 'saved');
});


test('ten saved core facts are not injected into a greeting; targeted search returns only matches', async t => {
  const h = await harness(t, () => chunks({ content: 'Hello.' }));
  for (let i = 0; i < 10; i++) {
    const text = `I own synthetic-device-${i}`;
    const scope = await h.memory.beginTurn({ conversationId: 'seed', turnId: `seed${i}`, sourceMessageId: `seed${i}`, text });
    await h.memory.capture(scope, { text, topic: `device ${i}`, category: 'equipment', quote: text });
  }
  const response = events((await h.send(h.create().id, 'Hello')).body);
  assert.equal(h.requests.length, 1);
  assert.ok(!JSON.stringify(h.requests[0].messages).includes('synthetic-device'));
  assert.ok(!response.some(e => e.type === 'memory'));
  assert.match(h.requests[0].messages[0].content, /search_memories before answering/);
  const scope = await h.memory.beginTurn({ conversationId: 'search', turnId: 'search', sourceMessageId: 'search', text: 'What is device 7?' });
  assert.equal((await h.memory.search(scope, 'equipment')).memories.length, 3, 'broad searches remain bounded');
  assert.equal((await h.memory.search(scope, '')).memories.length, 3, 'overview does not dump the collection');
  assert.equal((await h.memory.search(scope, 'nonexistent')).memories.length, 0);
  // Use a distinctive word rather than a numeric identifier ignored by the tokenizer.
  const gpu = await h.memory.beginTurn({ conversationId: 'gpu', turnId: 'gpu', sourceMessageId: 'gpu', text: 'I own an RTX 5070 Ti' });
  await h.memory.capture(gpu, { text: 'User owns an RTX 5070 Ti', topic: 'gpu', category: 'equipment', quote: gpu.text });
  const result = await h.memory.search(scope, 'gpu');
  assert.equal(result.memories.length, 1);
  assert.match(result.memories[0].text, /RTX/);
});
