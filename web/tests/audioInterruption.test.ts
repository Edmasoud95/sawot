import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as audio from '../src/lib/audio.ts';
const sources: any[] = [];
let decode: (value: any) => void;
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).AudioContext = class {
  destination = {};
  resume = async () => {};
  createAnalyser = () => ({ frequencyBinCount: 1, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) });
  decodeAudioData = () => new Promise(resolve => { decode = resolve; });
  createBufferSource() {
    const source = { onended: null, started: false, stopped: false, connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
    sources.push(source);
    return source;
  }
};
test('interrupt stops sound and prevents pending decoding from restarting it', async () => {
  assert.equal(typeof audio.stopPlayback, 'function', 'playback needs cancellation');
  let ended = 0;
  const first = audio.playWav(new ArrayBuffer(1), () => ended++);
  await Promise.resolve(); decode({}); await first;
  const staleEnd = sources[0].onended;
  audio.stopPlayback();
  assert.equal(sources[0].stopped, true);
  staleEnd(); assert.equal(ended, 0);
  const pending = audio.playWav(new ArrayBuffer(1), () => ended++);
  await Promise.resolve(); audio.stopPlayback(); decode({}); await pending;
  assert.equal(sources.length, 1, 'cancelled decoding must not start sound');
});
