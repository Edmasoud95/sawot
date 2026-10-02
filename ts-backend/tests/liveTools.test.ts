import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveToolSession, liveBackendPrompt } from '../src/liveTools.js';
import { Agent } from '../src/agent.js';

test('Live delegates through the existing agent and never repeats a request ID', async () => {
  let actions = 0;
  let rounds = 0;
  const client: any = { chat: { completions: { create: async () => ({ choices: [{ message: ++rounds === 1
    ? { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'call_service', arguments: '{"entity_id":"light.test"}' } }] }
    : { role: 'assistant', content: 'The test light is on.' } }] }) } } };
  const service = new LiveToolSession(() => new Agent(client, 'test', [{ name: 'call_service', description: '', parameters: {}, handler: async () => { actions++; return { ok: true }; } }], liveBackendPrompt('test')));
  const turns = [{ role: 'user' as const, text: 'Turn on the test light', start: 0, end: 1000 }];
  const [one, two] = await Promise.all([service.run('item_a', turns), service.run('item_a', turns)]);
  assert.equal(one.content, 'The test light is on.');
  assert.deepEqual(one, two);
  assert.equal(actions, 1);
  await service.run('item_b', turns);
  assert.equal(actions, 1, 'a second delegation without new user speech must not repeat an action');
  service.close();
});

test('closing Live cancels queued work and suppresses a late result', async () => {
  let calls = 0;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const service = new LiveToolSession(() => ({ run: async (_history, _text, _event, options) => {
    calls++; entered(); await new Promise<void>(r => { release = r; }); options.signal.throwIfAborted(); return 'done';
  } }) as any);
  const turns = [{ role: 'user' as const, text: 'look up the weather', start: 0, end: 1000 }];
  const first = service.run('item_a', turns);
  await started;
  const second = service.run('item_b', [...turns, { role: 'user', text: 'and tomorrow', start: 2000, end: 3000 }]);
  service.close(); release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('later corrections see earlier tool outcomes and web sources reach the voice UI', async () => {
  const contexts: string[] = [];
  const service = new LiveToolSession(() => ({ run: async (_history, text, emit) => {
    contexts.push(text);
    await emit('tool_call', { name: 'web_search', args: { query: 'test' } });
    await emit('tool_result', { name: 'web_search', ok: true, result: 'Verified test result' });
    await emit('search', { tool: 'web_search', phase: 'complete', sources: [{ url: 'https://example.com', title: 'Example', read: false }] });
    return 'A verified result.';
  } }) as any);
  const turns = [{ role: 'user' as const, text: 'Look up test', start: 0, end: 1000 }];
  const one = await service.run('item_a', turns);
  assert.equal(one.searches[0].sources[0].url, 'https://example.com');
  await service.run('item_b', [...turns, { role: 'user', text: 'Instead look up another test', start: 2000, end: 3000 }]);
  assert.match(contexts[1], /Verified test result/);
  assert.match(contexts[1], /Instead look up another test/);
});
