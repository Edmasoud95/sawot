import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../node_modules/esbuild/lib/main.js';

// Real orchestration hook; recorder/browser lifecycle is covered separately.
const modules = {
  react: `export const useRef = current => ({current}); export const useEffect = fn => { globalThis.h.effects.push(fn); };`,
  '../lib/audio': `export const meterFrom = () => {}; export const audioContext = () => ({}); export const playReadyCue = () => {globalThis.h.cues++;}; export const stopPlayback = () => {}; export const playWav = async (_, ended) => {globalThis.h.captureDuringPlayback = globalThis.h.captureActive; globalThis.h.playbackEnded = ended;};`,
  '../lib/voiceSessionRecorder': `export class VoiceSessionRecorder {
    constructor(callbacks) {this.c = callbacks; globalThis.h.recorder = this;}
    start() {globalThis.h.captureActive = true; return new Promise((resolve, reject) => {globalThis.h.ready = resolve; globalThis.h.rejectReady = reject;});}
    listen() {globalThis.h.listens++; this.c.state('listening');}
    pause() {} end() {globalThis.h.captureActive = false;} send() {this.c.utterance(new ArrayBuffer(48));}
  }`,
  '../lib/socket': `export class VoiceSocket { ready = true; constructor(handlers) { globalThis.h.socket = this; this.handlers = handlers; } cancelTurn() {} close() {} sendAudio(buf, ids) { globalThis.h.sent.push({buf,ids,captureActive: globalThis.h.captureActive}); } }`,
  '../store': `export const useVoiceStore = {getState: () => globalThis.h.state, subscribe: fn => {globalThis.h.modeChanged = fn; return () => {};}};`,
  '../debugStore': `export const useDebugStore = {getState: () => ({})};`,
  '../chatStore': `export const useChatStore = {getState: () => ({})};`,
  './useVoicePictures': `export const useVoicePictures = () => ({current: {current: []}, remove() {}});`,
};
const { outputFiles } = await build({
  entryPoints: ['../web/src/hooks/useVoice.ts'], bundle: true, write: false, format: 'esm',
  plugins: [{name: 'browser-boundaries', setup(b) {
    b.onResolve({filter: /.*/}, args => args.path in modules ? {path: args.path, namespace: 'fake'} : undefined);
    b.onLoad({filter: /.*/, namespace: 'fake'}, args => ({contents: modules[args.path], loader: 'js'}));
  }}],
});
const { useVoice } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles![0].text).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const h = {effects: [], sent: [], socket: null as any, recorder: null as any, ready: null as any,
    captureActive: false, captureDuringPlayback: undefined, rejectReady: null as any, playbackEnded: null as any, modeChanged: null as any, cues: 0, listens: 0,
    state: {status: 'idle', sessionActive: false, debugEnabled: false, mode: 'orb',
      setSessionActive(active) {this.sessionActive=active;}, setStatus(status) {this.status = status;}, clearSearch() {}, beginResponse() {}, clearExpression() {}, clearCaptions() {}, setAssistantCaption() {}},
  };
  const events: Record<string, Function> = {};
  Object.assign(globalThis, {h, window: {addEventListener(name,fn) {events[name]=fn;}, removeEventListener() {}},
    document: {hidden: false, addEventListener(name,fn) {events[name]=fn;}, removeEventListener() {}, querySelector: () => null},
  });
  const voice = useVoice(); const cleanup = h.effects.map(fn => fn());
  return {h, voice, events, cleanup: () => cleanup.forEach(fn => fn?.()),
    start: async () => {const p=voice.tapMicrophone(); await tick(); h.ready(true); await p;},
  };
}
test('session waits for capture readiness then listens without a hold gesture', async () => {
  const f = setup(); const starting = f.voice.tapMicrophone(); await tick();
  assert.equal(f.h.state.status,'starting'); assert.equal(f.h.state.sessionActive,true);
  assert.equal(f.h.cues,0); f.h.ready(true); await starting;
  assert.equal(f.h.state.status,'listening'); assert.equal(f.h.cues,1);
  f.voice.endSession(); assert.equal(f.h.state.sessionActive,false); f.cleanup();
});
test('ending during startup prevents a late readiness cue or reactivation', async () => {
  const f = setup(); const p = f.voice.tapMicrophone(); await tick(); f.voice.endSession(); f.h.ready(true); await p;
  assert.equal(f.h.state.status,'idle'); assert.equal(f.h.cues,0); f.cleanup();
});
test('automatic utterance sends and playback returns to listening', async () => {
  const f = setup(); await f.start(); f.h.recorder.c.utterance(new ArrayBuffer(48));
  assert.equal(f.h.sent.length,1); assert.equal(f.h.state.status,'thinking');
  assert.equal(f.h.sent[0].captureActive, false, 'release microphone before sending the turn');
  f.h.socket.handlers.onAudio(new ArrayBuffer(48)); await tick(); f.h.playbackEnded();
  assert.equal(f.h.captureDuringPlayback, false);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(f.h.state.status,'starting');
  assert.equal(f.h.cues,1); f.h.ready(true); await tick();
  assert.equal(f.h.state.status,'listening'); assert.equal(f.h.state.sessionActive,true); f.cleanup();
});
test('tap interrupts reply; its stale completion cannot restart an ended session', async () => {
  const f=setup(); await f.start(); f.h.recorder.c.utterance(new ArrayBuffer(48));
  f.h.socket.handlers.onAudio(new ArrayBuffer(48)); await tick(); const ended=f.h.playbackEnded;
  const restart = f.voice.tapMicrophone(); await tick();
  assert.equal(f.h.state.status,'starting'); f.h.ready(true); await restart;
  assert.equal(f.h.state.status,'listening');
  f.voice.endSession(); ended(); await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(f.h.state.status,'idle'); assert.equal(f.h.state.sessionActive,false); f.cleanup();
});
test('disconnect and switching to chat end session without auto restarting', async () => {
  const f=setup(); await f.start(); f.h.socket.ready=false; f.h.socket.handlers.onClose();
  assert.equal(f.h.state.sessionActive,false); assert.equal(f.h.state.status,'connecting');
  f.h.socket.ready=true; f.h.socket.handlers.onOpen(); assert.equal(f.h.state.status,'idle');
  await f.start(); f.h.modeChanged({mode:'chat'},{mode:'orb'});
  assert.equal(f.h.state.sessionActive,false); f.cleanup();
});
test('backgrounding the page ends listening', async () => {
  const f=setup(); await f.start(); Object.assign(document,{hidden:true}); f.events.visibilitychange();
  assert.equal(f.h.state.sessionActive,false); assert.equal(f.h.state.status,'idle'); f.cleanup();
});

test('ending while reopening the microphone prevents late listening', async () => {
  const f=setup(); await f.start(); f.h.recorder.c.utterance(new ArrayBuffer(48));
  const restart=f.voice.tapMicrophone(); await tick();
  assert.equal(f.h.state.status,'starting'); f.voice.endSession(); f.h.ready(true); await restart;
  assert.equal(f.h.state.status,'idle'); assert.equal(f.h.cues,1); f.cleanup();
});
test('microphone reopen failure ends the hands-free session', async () => {
  const f=setup(); await f.start(); f.h.recorder.c.utterance(new ArrayBuffer(48));
  const restart=f.voice.tapMicrophone(); await tick();
  assert.equal(f.h.state.status,'starting'); f.h.rejectReady(new Error('device unavailable')); await restart;
  assert.equal(f.h.state.status,'idle'); assert.equal(f.h.state.sessionActive,false);
  assert.equal(f.h.captureActive,false); f.cleanup();
});
