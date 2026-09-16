import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVoiceTurn } from '../src/pipeline.js';
for (const stage of ['transcribe', 'voices', 'run', 'synthesize']) {
  test(`cancelling during ${stage} prevents later voice output`, async () => {
    const controller = new AbortController();
    const sent: string[] = [];
    const cancel = async (value: any) => { controller.abort(); return value; };
    const inference = {
      transcribe: async () => stage === 'transcribe' ? cancel('hello') : 'hello',
      voices: async () => stage === 'voices' ? cancel({ engine: null }) : { engine: null },
      synthesize: async () => stage === 'synthesize' ? cancel(Buffer.from('wav')) : Buffer.from('wav'),
    };
    const agent = { run: async () => stage === 'run' ? cancel('answer') : 'answer' };
    await runVoiceTurn(inference as any, agent as any, Buffer.alloc(1), [], (kind) => {
      assert.equal(controller.signal.aborted, false, `late ${kind} after cancellation`);
      sent.push(kind);
    }, 'voice', undefined, undefined, controller.signal);
    assert.equal(sent.includes('wav'), false);
    assert.equal(sent.includes('error'), false);
  });
}

import { Agent } from '../src/agent.js';

test('cancelling a tool prevents the remaining tools and model rounds', async () => {
  const controller = new AbortController();
  let calls = 0;
  const effects: string[] = [];
  const client = { chat: { completions: { create: async (_request: any, options: any) => {
    assert.equal(options.signal, controller.signal);
    calls++;
    return { choices: [{ message: { content: null, tool_calls: ['first', 'second'].map(name => ({ id: name, type: 'function', function: { name, arguments: '{}' } })) } }] };
  } } } };
  const agent = new Agent(client as any, 'test', ['first', 'second'].map(name => ({
    name, description: name, parameters: { type: 'object', properties: {} },
    handler: async () => { effects.push(name); controller.abort(); return { ok: true }; },
  })), 'test');
  await assert.rejects(agent.run([], 'go', undefined, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(effects, ['first']);
  assert.equal(calls, 1);
});
