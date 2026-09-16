import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sessionModule from '../src/voiceSession.js';

test('a cancelled turn cannot send or commit history after a newer turn', async () => {
  assert.equal(typeof sessionModule.VoiceSession, 'function');
  const sent: any[] = [];
  const session = new sessionModule.VoiceSession((...args: any[]) => { sent.push(args); });
  let resume!: () => void;
  let oldSignal!: AbortSignal;
  const first = session.start(1, async (history, send, signal) => {
    oldSignal = signal;
    history.push({ role: 'user', content: 'old question' });
    await new Promise<void>(resolve => { resume = resolve; });
    await send('assistant_text', { text: 'stale answer' });
  });
  session.cancel();
  assert.equal(oldSignal.aborted, true);
  await session.start(2, async (history, send) => {
    assert.deepEqual(history, []);
    history.push({ role: 'user', content: 'new question' });
    await send('assistant_text', { text: 'new answer' });
  });
  resume(); await first;
  await session.start(3, async (history) => {
    assert.deepEqual(history, [{ role: 'user', content: 'new question' }]);
  });
  assert.deepEqual(sent, [[2, 'assistant_text', { text: 'new answer' }]]);
});
