import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory/store.js';
const dir = await mkdtemp(join(tmpdir(), 'sawot-memory-'));
try {
  const store = new MemoryStore(dir);
  await store.init();
  const turn = await store.beginTurn({
    conversationId: 'c1',
    turnId: 't1',
    sourceMessageId: 'm1',
    text: 'I own an RTX 5070 Ti'
  });
  const saved = await store.capture(turn, {
    text: 'User owns an RTX 5070 Ti',
    topic: 'owned gpu',
    category: 'equipment',
    quote: 'I own an RTX 5070 Ti'
  });
  const id = saved.memories[0].id;
  assert.equal((await store.capture(turn, {
    text: 'User owns an RTX 5070 Ti',
    topic: 'owned gpu',
    category: 'equipment',
    quote: 'I own an RTX 5070 Ti'
  })).id, saved.id);
  const reload = new MemoryStore(dir);
  await reload.init();
  assert.equal((await reload.get(id)).text, 'User owns an RTX 5070 Ti');
  const implicit = await store.beginTurn({
    conversationId: 'c2',
    turnId: 't2',
    sourceMessageId: 'm2',
    text: 'Can my GPU run this?'
  });
  const searched = await store.search(implicit, "gpu");
  assert.equal(searched.memories[0].id, id);
  const recall = searched.event;
  assert.equal(recall?.kind, 'recalled');
  await assert.rejects(store.capture(implicit, {
    text: 'Invented',
    topic: 'other',
    quote: 'I own a GPU'
  }));
  const hypothetical = await store.beginTurn({
    conversationId: 'c2',
    turnId: 't3',
    sourceMessageId: 'm3',
    text: 'If I owned an RTX 5070 Ti'
  });
  await assert.rejects(store.capture(hypothetical, {
    text: 'User owns GPU',
    topic: 'gpu2',
    quote: hypothetical.text
  }));
  const broad = await store.beginTurn({
    conversationId: 'c3',
    turnId: 't4',
    sourceMessageId: 'm4',
    text: 'Forget everything you remember about me'
  });
  await assert.rejects(store.delete(id, 1, broad));
  assert.equal((await store.list()).memories.length, 1);
  const specific = await store.beginTurn({
    conversationId: 'c3',
    turnId: 't5',
    sourceMessageId: 'm5',
    text: 'Forget which GPU I own'
  });
  await store.delete(id, 1, specific);
  assert.equal((await store.list()).memories.length, 0);
  assert.equal((await store.eventsForConversation('c1'))[0].memories[0].text, undefined);
  assert.equal((await store.eventsForConversation('c2'))[0].memories[0].text, undefined);
  await assert.rejects(store.capture(turn, {
    text: 'User owns GPU',
    topic: 'owned gpu',
    quote: turn.text
  }));
  assert.ok(!(await readFile(join(dir, 'data/memory/default.json'), 'utf8')).includes('RTX'));
  const fresh = await store.beginTurn({
    conversationId: 'c4',
    turnId: 't6',
    sourceMessageId: 'm6',
    text: 'I own an RTX 5070 Ti'
  });
  const savedAgain = await store.capture(fresh, {
    text: 'User owns an RTX 5070 Ti',
    topic: 'owned gpu',
    category: 'equipment',
    quote: fresh.text
  });
  assert.notEqual(savedAgain.memories[0].id, id);
  await assert.rejects(store.edit(savedAgain.memories[0].id, 'New GPU', 0));
  const old = await store.beginTurn({
    conversationId: 'c4',
    turnId: 't7',
    sourceMessageId: 'm7',
    text: 'I prefer Python'
  });
  await store.clear();
  await assert.rejects(store.capture(old, {
    text: 'User prefers Python',
    topic: 'language',
    quote: old.text
  }));
  await assert.rejects(store.search(old, "gpu"));
  await store.setEnabled(false);
  assert.equal(store.isEnabled(), false);
  const disabled = await store.beginTurn({
    conversationId: 'c4',
    turnId: 't8',
    sourceMessageId: 'm8',
    text: 'I prefer Python'
  });
  await assert.rejects(store.search(disabled, "gpu"));
  await assert.rejects(store.capture(disabled, {
    text: 'User prefers Python',
    topic: 'language',
    quote: disabled.text
  }));
  console.log('Memory persistence, grounding, replay, stale writes, recall and deletion tests passed');
} finally {
  await rm(dir, {
    recursive: true,
    force: true
  });
}
