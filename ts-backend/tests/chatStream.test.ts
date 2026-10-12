import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ChatStream } from '../src/chatStream.js';

function response() {
  return Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableLength: 0, writes: [] as string[],
    writeHead() {}, flushHeaders() {}, write(data: string) { this.writes.push(data); },
    end() { this.writableEnded = true; this.emit('close'); },
    destroy() { this.destroyed = true; this.emit('close'); },
  });
}

test('a browser closed during hydration allocates no heartbeat or subscription', t => {
  const raw = response();
  raw.destroy();
  const interval = t.mock.method(globalThis, 'setInterval');
  const stream = new ChatStream();
  stream.attach(raw as any, { type: 'snapshot' });
  stream.end();
  assert.equal(interval.mock.callCount(), 0);
  assert.deepEqual(raw.writes, []);
});

test('slow readers are detached while healthy viewers keep receiving updates', () => {
  const slow = response(); const fast = response();
  const stream = new ChatStream();
  try {
    stream.attach(slow as any); stream.attach(fast as any);
    slow.writableLength = 2 * 1024 * 1024;
    stream.emit({ type: 'content', delta: 'Still generating' });
    assert.equal(slow.destroyed, true);
    assert.equal(fast.destroyed, false);
    assert.match(fast.writes.join(''), /Still generating/);
  } finally { stream.end(); }
});
