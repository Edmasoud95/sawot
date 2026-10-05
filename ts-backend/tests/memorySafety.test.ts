import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory/store.js';

async function setup(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'memory-safety-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new MemoryStore(dir); await store.init();
  let source = 0;
  const turn = (text: string) => store.beginTurn({ conversationId: 'chat', turnId: `turn${++source}`, sourceMessageId: `source${source}`, text });
  return { store, turn };
}
test('explicit memory supports negative preferences and user-selected third-party facts', async t => {
  const { store, turn } = await setup(t);
  for (const [text, topic] of [['Remember that I do not eat meat', 'diet'], ['Remember that my partner prefers tea', 'partner drink']]) {
    await store.capture(await turn(text), { text, topic, quote: text, captureMode: 'explicit' });
  }
  assert.equal((await store.list()).memories.length, 2);
});
test('grounding distinguishes an assertion followed by a question from a conditional assertion', async t => {
  const { store, turn } = await setup(t);
  await store.capture(await turn('I own a laptop. Can you tell me if it supports Linux?'), { text: 'User owns a laptop', topic: 'laptop', quote: 'I own a laptop' });
  await assert.rejects(store.capture(await turn('If I own a GPU, can I use it?'), { text: 'User owns GPU', topic: 'gpu', quote: 'I own a GPU' }));
  await assert.rejects(store.capture(await turn('I do not own a GPU'), { text: 'User owns GPU', topic: 'gpu', quote: 'I do not own a GPU' }));
  assert.equal((await store.list()).memories.length, 1);
});
test('credential provenance is rejected even when extracted value omits the credential label', async t => {
  const { store, turn } = await setup(t);
  const text = 'Remember my password is made-up-test-value';
  await assert.rejects(store.capture(await turn(text), { text: 'made-up-test-value', topic: 'login', quote: 'my password is made-up-test-value', captureMode: 'explicit' }), /Credentials/);
  assert.equal((await store.list()).memories.length, 0);
});
test('a deleting turn cannot recreate a fact and Settings edits invalidate pending captures', async t => {
  const { store, turn } = await setup(t);
  const event = await store.capture(await turn('I own a GPU'), { text: 'User owns GPU', topic: 'gpu', quote: 'I own a GPU' });
  const scope = await turn('Forget that I own a GPU');
  await store.delete(event.memories[0].id, 1, scope);
  await assert.rejects(store.capture(scope, { text: 'User owns GPU', topic: 'gpu', quote: 'I own a GPU' }));
  const newer = await store.capture(await turn('I live in Warsaw'), { text: 'User lives in Warsaw', topic: 'city', quote: 'I live in Warsaw' });
  const pending = await turn('I own a laptop');
  let invalidated = false;
  const stop = store.subscribe(() => { if (!store.isActive(pending)) invalidated = true; });
  await store.edit(newer.memories[0].id, 'User lives in Kraków', 1); stop();
  assert.equal(invalidated, true);
  await assert.rejects(store.capture(pending, { text: 'User owns laptop', topic: 'laptop', quote: 'I own a laptop' }));
});

test('concurrent captures serialize and repeated facts with different topics stay unique', async t => {
  const { store, turn } = await setup(t);
  const a = await turn('I own a graphics card');
  const b = await turn('I own a graphics card');
  await Promise.all([
    store.capture(a, { text: 'User owns a graphics card', topic: 'hardware', quote: a.text, category: 'equipment' }),
    store.capture(b, { text: 'User owns a graphics card', topic: 'gpu', quote: b.text, category: 'equipment' }),
  ]);
  assert.equal((await store.list()).memories.length, 1);
  const deletion = await turn('Forget which GPU I own');
  const fact = (await store.list()).memories[0];
  await store.delete(fact.id, fact.revision, deletion);
  assert.equal((await store.list()).memories.length, 0);
});
