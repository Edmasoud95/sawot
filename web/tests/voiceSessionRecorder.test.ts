import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceSessionRecorder } from '../src/lib/voiceSessionRecorder.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let grant: (s: any) => void;
  let stopped = 0, requests = 0;
  const trackEvents: Record<string, Function> = {};
  const track = {stop() {stopped++;}, addEventListener(name, fn) {trackEvents[name]=fn;}, removeEventListener(name) {delete trackEvents[name];}};
  const stream = {getTracks: () => [track]};
  const context = {sampleRate: 16000, currentTime: 0, state: 'running', resume: async () => {},
    audioWorklet: {addModule: async () => {}}, destination: {},
    createMediaStreamSource: () => ({connect() {}, disconnect() {}}),
    addEventListener() {}, removeEventListener() {},
  };
  let node: any;
  Object.assign(globalThis, {AudioWorkletNode: class {
    port = {onmessage: null, close() {}}; onprocessorerror: any;
    constructor() {node = this;} connect() {} disconnect() {}
  }});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: {getUserMedia() {
    requests++; return new Promise(resolve => {grant = resolve;});
  }}}});
  const states: string[] = [], sent: ArrayBuffer[] = [], errors: string[] = [];
  const recorder = new VoiceSessionRecorder({context: () => context as any,
    state: s => states.push(s), utterance: audio => sent.push(audio), error: e => errors.push(e.message)});
  function frame(level = 0, lag = 0) {
    context.currentTime += .02;
    node.port.onmessage?.({data: {samples: new Float32Array(320).fill(level), time: context.currentTime - lag}});
  }
  return {recorder, grant: () => grant(stream), states, sent, errors, frame,
    mute: () => trackEvents.mute?.(), failProcessor: () => node.onprocessorerror(),
    stopped: () => stopped, requests: () => requests,
    ready: async () => {const p = recorder.start(); await tick(); grant(stream); await tick(); frame(); assert.equal(await p, true);},
  };
}
test('readiness waits for captured audio, microphone persists across turns', async () => {
  const f = fixture(); const p = f.recorder.start(); await tick(); f.grant(); await tick();
  assert.deepEqual(f.states, []);
  f.frame(); assert.equal(await p,true); f.recorder.listen();
  for(let i=0;i<20;i++) f.frame(.1);
  assert.equal(f.states.at(-1),'recording');
  for(let i=0;i<75;i++) f.frame();
  assert.equal(f.sent.length,1); assert.equal(f.stopped(),0);
  for(let i=0;i<100;i++) f.frame(.1);
  assert.equal(f.sent.length,1, 'paused input cannot become another turn');
  f.recorder.listen(); for(let i=0;i<20;i++) f.frame(.1); f.recorder.send();
  assert.equal(f.sent.length,2); assert.equal(f.requests(),1);
  f.recorder.end(); assert.equal(f.stopped(),1);
});
test('end during permission prevents late activation and releases microphone', async () => {
  const f = fixture(); const p = f.recorder.start(); await tick(); f.recorder.end(); f.grant();
  assert.equal(await p,false); assert.equal(f.stopped(),1); assert.deepEqual(f.states,[]);
});
test('end while awaiting first audio settles readiness and drops pending audio', async () => {
  const f = fixture(); const p = f.recorder.start(); await tick(); f.grant(); await tick();
  f.recorder.end(); assert.equal(await p,false); f.frame(.1);
  assert.equal(f.stopped(),1); assert.equal(f.sent.length,0);
});
test('manual send with silence keeps listening; cancelled speech never leaks', async () => {
  const f = fixture(); await f.ready(); f.recorder.listen(); f.recorder.send();
  assert.equal(f.sent.length,0); for(let i=0;i<20;i++) f.frame(.1);
  f.recorder.pause(); f.recorder.listen(); for(let i=0;i<100;i++) f.frame();
  assert.equal(f.sent.length,0); f.recorder.end();
});

test('muted microphone ends capture instead of displaying false readiness', async () => {
  const f=fixture(); await f.ready(); f.recorder.listen(); f.mute();
  assert.equal(f.stopped(),1); assert.equal(f.errors.length,1);
  for(let i=0;i<100;i++) f.frame(.1);
  assert.equal(f.sent.length,0);
});
test('processor failure settles pending startup and releases all tracks', async () => {
  const f=fixture(); const p=f.recorder.start(); await tick(); f.grant(); await tick();
  f.failProcessor(); assert.equal(await p,false);
  assert.equal(f.stopped(),1); assert.equal(f.errors.length,1);
});
test('queued pre-resume frames cannot enter a new turn', async () => {
  const f=fixture(); await f.ready(); f.recorder.listen();
  for(let i=0;i<20;i++) f.frame(.1);
  f.recorder.pause(); f.recorder.listen();
  for(let i=0;i<20;i++) f.frame(.1,10);
  f.recorder.send(); assert.equal(f.sent.length,0); f.recorder.end();
});
