import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceTurnDetector, encodeWav } from '../src/lib/voiceTurnDetector.ts';
const rate = 16000;
const frame = (level = 0) => new Float32Array(320).fill(level); // 20 ms
function feed(d: VoiceTurnDetector, ms: number, level = 0) {
  let result: Float32Array[] | null = null;
  for (let t = 0; t < ms; t += 20) result = d.push(frame(level)) ?? result;
  return result;
}
test('silence and short clicks never create a turn', () => {
  const d = new VoiceTurnDetector(rate);
  assert.equal(feed(d, 10000), null);
  feed(d, 60, .2);
  assert.equal(feed(d, 2000), null);
  assert.equal(d.speaking, false);
  assert.equal(d.finish(), null);
});
test('retains phrase onset, tolerates short pauses, ends after sustained quiet', () => {
  const d = new VoiceTurnDetector(rate);
  feed(d, 1000);
  assert.equal(feed(d, 400, .1), null);
  assert.equal(d.speaking, true);
  assert.equal(feed(d, 800), null);
  assert.equal(feed(d, 400, .15), null);
  const turn = feed(d, 1500)!;
  assert.ok(turn);
  assert.equal(turn.filter(f => f[0] > .05).length, 40, 'both phrases retained, including onset');
  assert.ok(turn[0].every(v => v === 0), 'prefix before speech retained');
  assert.equal(d.speaking, false);
  assert.equal(d.finish(), null);
});
test('manual send flushes speech exactly once, resetting drops cancelled audio', () => {
  const d = new VoiceTurnDetector(rate);
  feed(d, 400, .12);
  assert.ok(d.finish()); assert.equal(d.finish(), null);
  feed(d, 500, .12); d.reset();
  assert.equal(d.finish(), null);
  assert.equal(feed(d, 2000), null);
});
test('continuous sound has a bounded turn length', () => {
  const d = new VoiceTurnDetector(rate);
  assert.ok(feed(d, 46000, .1));
});
test('WAV header describes complete mono signed PCM with clipping', () => {
  const buffer = encodeWav([new Float32Array([-2, 0, 2])], rate);
  const v = new DataView(buffer);
  assert.equal(new TextDecoder().decode(buffer.slice(0,4)), 'RIFF');
  assert.equal(v.getUint32(24,true), rate);
  assert.equal(v.getUint16(22,true), 1);
  assert.equal(v.getUint32(40,true), 6);
  assert.equal(v.getInt16(44,true), -32768);
  assert.equal(v.getInt16(46,true), 0);
  assert.equal(v.getInt16(48,true), 32767);
});
test('brief unvoiced gaps between syllables do not discard a phrase', () => {
  const d = new VoiceTurnDetector(48000);
  for (let syllable=0;syllable<20;syllable++) {
    for (let i=0;i<5;i++) d.push(new Float32Array(960).fill(.1));
    for (let i=0;i<2;i++) d.push(new Float32Array(960));
  }
  assert.equal(d.speaking,true);
  const turn=d.finish()!;
  assert.ok(turn);
  assert.equal(turn.filter(f=>f[0]>.05).length,100);
});
test('a manually sent short word is retained without accepting an isolated click', () => {
  const d = new VoiceTurnDetector(rate);
  feed(d,100,.1); feed(d,300); assert.ok(d.finish());
  feed(d,40,.2); assert.equal(d.finish(),null);
});
test('repeated subthreshold bursts cannot grow the manual candidate without bound', () => {
  const d = new VoiceTurnDetector(rate);
  for(let i=0;i<100;i++) {feed(d,80,.1); feed(d,300);}
  const turn=d.finish()!;
  assert.ok(turn);
  assert.ok(turn.reduce((n,frame)=>n+frame.length,0)<=rate*1.8);
});
