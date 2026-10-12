import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { build } = createRequire(new URL('../package.json', import.meta.url))('esbuild');
const bundle = await build({ stdin: { contents: `export { useChatStore } from './chatStore';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' } });
let serial = 0;
async function fixture(age: number, responding = false, draftText = '') {
  const storage = new Map([['sawot-chat-visit', JSON.stringify({ id: 'abcdef123456', lastUsed: Date.now() - age })]]);
  Object.assign(globalThis, { window: { matchMedia: () => ({ matches: false }) }, location: { protocol: 'https:', host: 'localhost' }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) } });
  const { useChatStore: store } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + `\n//visit${serial++}`).toString('base64')}`);
  const calls: string[] = [];
  const old = { id: 'abcdef123456', title: 'Previous topic', responding, draftText, messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' }] };
  globalThis.fetch = async (url, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (String(url).endsWith('/stream')) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', conversation: old })}\n\n`)); init.signal?.addEventListener('abort', () => c.close()); } }));
    return new Response(JSON.stringify(init.method === 'POST' ? { id: '111111111111', messages: [], draftText: '' } : old));
  };
  return { store, calls, storage, old };
}
for (const [label, age, responding, restore] of [
  ['recent finished chat', 5*60000, false, true],
  ['old running chat', 2*3600000, true, true],
  ['old finished chat', 2*3600000, false, false],
] as const) test(`cold startup handles ${label}`, async t => {
  const f = await fixture(age, responding); t.after(() => f.store.getState().detachStream());
  await f.store.getState().restoreVisit();
  assert.equal(f.store.getState().activeId, restore ? f.old.id : '111111111111');
  assert.equal(Boolean(f.store.getState().previousConversation), !restore);
  assert.equal(f.calls.filter(c => c.startsWith('POST')).length, restore ? 0 : 1);
});
test('an old unfinished draft is offered without pre-filling a fresh conversation', async () => {
  const f = await fixture(2*3600000, false, 'Unfinished');
  await f.store.getState().restoreVisit();
  assert.equal(f.store.getState().active.draftText, '');
  assert.equal(f.store.getState().previousConversation.hasDraft, true);
  await f.store.getState().openConversation(f.old.id);
  assert.equal(f.store.getState().active.draftText, 'Unfinished');
  assert.equal(f.store.getState().previousConversation, null);
});
test('remounting Chat preserves the current conversation and draft', async () => {
  const f = await fixture(0); await f.store.getState().restoreVisit();
  f.store.setState(s => ({ active: { ...s.active, draftText: 'Current draft' } }));
  const count = f.calls.length; await f.store.getState().restoreVisit();
  assert.equal(f.calls.length, count); assert.equal(f.store.getState().active.draftText, 'Current draft');
});
test('duplicate startup and delayed restoration cannot replace an explicit selection', async () => {
  const f = await fixture(0); let release!: (r: Response) => void; const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith(f.old.id) ? new Promise(r => { release = r; }) : original(url, init);
  const a = f.store.getState().restoreVisit(); const b = f.store.getState().restoreVisit();
  await f.store.getState().newConversation(); release(new Response(JSON.stringify(f.old))); await Promise.all([a,b]);
  assert.equal(f.store.getState().activeId, '111111111111'); assert.equal(f.calls.filter(c => c.startsWith('POST')).length, 1);
});
test('missing remembered chat falls back cleanly; offline lookup preserves the choice for retry', async () => {
  const f = await fixture(0); const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => init?.method === 'POST' ? original(url, init) : new Response('{"detail":"not found"}', { status: 404 });
  await f.store.getState().restoreVisit(); assert.equal(f.store.getState().activeId, '111111111111');
  const offline = await fixture(0); globalThis.fetch = async () => { throw Error('offline'); };
  await offline.store.getState().restoreVisit(); assert.equal(offline.store.getState().activeId, null);
  assert.ok(offline.store.getState().visitError); assert.ok(offline.storage.get('sawot-chat-visit'));
});
