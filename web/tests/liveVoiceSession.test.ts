import assert from "node:assert/strict";
import test from "node:test";
import { LiveVoiceSession } from "../src/lib/liveVoiceSession.js";

function browser(t: any) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: any) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); };
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } });
  const track = { enabled: true, stopped: false, onended: null, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let getMedia = async () => stream;
  set("navigator", { mediaDevices: { getUserMedia: () => getMedia() } });
  const meter = { fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(0) };
  set("AudioContext", class { resume() { return Promise.resolve(); } close() { return Promise.resolve(); } createAnalyser() { return meter; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } });
  set("Audio", class { setAttribute() {} pause() {} play() { return Promise.resolve(); } });
  const channel: any = { readyState: "open", sent: [], send(data: string) { this.sent.push(JSON.parse(data)); }, close() { this.readyState = "closed"; this.onclose?.(); } };
  let peerClosed = false;
  set("RTCPeerConnection", class { iceGatheringState = "complete"; localDescription = { sdp: "v=0" }; createDataChannel() { return channel; } addTrack() {} createOffer() { return Promise.resolve({ sdp: "v=0" }); } setLocalDescription() { return Promise.resolve(); } setRemoteDescription() { return Promise.resolve(); } close() { peerClosed = true; } });
  const calls: string[] = [];
  let fetcher = async (url: any) => { calls.push(String(url)); return Response.json({ sdp: "answer" }); };
  set("fetch", (...args: any[]) => (fetcher as any)(...args));
  const ended: any[] = [];
  const captions: any[] = [];
  const session = new LiveVoiceSession({ status() {}, level() {}, caption: (...args) => captions.push(args), ended: (...args) => ended.push(args) });
  return { session, track, stream, channel, calls, ended, captions, peerClosed: () => peerClosed, setMedia: (fn: any) => { getMedia = fn; }, setFetch: (fn: any) => { fetcher = fn; } };
}

test("Live never connects before an explicit start, handles captions, and releases capture on end", async t => {
  const b = browser(t);
  assert.equal(b.calls.length, 0);
  await b.session.start({ providerId: "openai", voice: "marin" });
  assert.equal(b.calls.length, 1);
  assert.equal(b.track.enabled, false);
  b.channel.onmessage({ data: JSON.stringify({ type: "session.started" }) });
  assert.equal(b.track.enabled, true);
  const delta = { type: "session.input_transcript.delta", event_id: "one", delta: "hello", start_ms: 0, end_ms: 100 };
  b.channel.onmessage({ data: JSON.stringify(delta) });
  b.channel.onmessage({ data: JSON.stringify(delta) });
  assert.deepEqual(b.captions, [["user", "hello"]]);
  b.session.end(); b.session.end();
  assert.equal(b.track.stopped, true);
  assert.equal(b.ended.length, 1);
  assert.equal(b.calls.filter(url => url.endsWith("/close")).length, 1);
  assert.deepEqual(b.channel.sent, [{ type: "session.close" }]);
  t.mock.timers.tick(2000);
  assert.equal(b.peerClosed(), true);
});

test("cancelling while microphone permission is pending stops a late microphone and creates no session", async t => {
  const b = browser(t);
  let release!: (stream: any) => void;
  let requested!: () => void;
  const waiting = new Promise<void>(resolve => { requested = resolve; });
  b.setMedia(() => { requested(); return new Promise(resolve => { release = resolve; }); });
  const pending = b.session.start({ providerId: "openai", voice: "marin" });
  await waiting;
  b.session.end();
  release(b.stream);
  await pending;
  assert.equal(b.track.stopped, true);
  assert.equal(b.calls.length, 0);
  t.mock.timers.tick(2000);
});

test("cancellation during paid creation closes immediately and again when the late answer arrives", async t => {
  const b = browser(t);
  let release!: (response: Response) => void;
  let requested!: () => void;
  const waiting = new Promise<void>(resolve => { requested = resolve; });
  b.setFetch(async (url: string) => {
    b.calls.push(url);
    if (url.endsWith("/sessions")) { requested(); return new Promise(resolve => { release = resolve; }); }
    return Response.json({ ok: true });
  });
  const pending = b.session.start({ providerId: "openai", voice: "marin" });
  await waiting;
  b.session.end();
  assert.equal(b.track.stopped, true);
  release(Response.json({ sdp: "answer" }));
  await pending;
  assert.equal(b.calls.filter(url => url.endsWith("/sessions")).length, 1);
  assert.equal(b.calls.filter(url => url.endsWith("/close")).length, 2);
  t.mock.timers.tick(2000);
  assert.equal(b.peerClosed(), true);
});

test("30 seconds of silence releases the microphone and requests remote closure", async t => {
  const b = browser(t);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  await b.session.start({ providerId: "openai", voice: "marin" });
  b.channel.onmessage({ data: JSON.stringify({ type: "session.started" }) });
  now = 29_999; t.mock.timers.tick(100);
  assert.equal(b.track.stopped, false);
  now = 30_000; t.mock.timers.tick(100);
  assert.equal(b.track.stopped, true);
  assert.match(b.ended[0][0], /30 seconds/);
  assert.ok(b.calls.some(url => url.endsWith("/close")));
  t.mock.timers.tick(2000);
});

test("a closed data channel stops capture without reconnecting", async t => {
  const b = browser(t);
  await b.session.start({ providerId: "openai", voice: "marin" });
  b.channel.close();
  assert.equal(b.track.stopped, true);
  assert.equal(b.ended.length, 1);
  t.mock.timers.tick(40_000);
  assert.equal(b.calls.filter(url => url.endsWith("/sessions")).length, 1);
});

test('Live delegates once, pauses idle during work and sends confirmed results back to speech', async t => {
  const b = browser(t);
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  let release!: (value: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  b.setFetch(async (url: string, init: any) => {
    b.calls.push(url);
    if (url.endsWith('/delegate')) {
      const request = JSON.parse(init.body);
      assert.equal(request.delegationId, 'item_test');
      assert.equal(request.turns[0].text, 'Look up the weather');
      started();
      return new Promise(resolve => { release = resolve; });
    }
    return Response.json({ sdp: 'answer', ok: true });
  });
  await b.session.start({ providerId: 'openai', voice: 'marin' });
  const receive = (event: any) => b.channel.onmessage({ data: JSON.stringify(event) });
  receive({ type: 'session.started' });
  receive({ type: 'session.input_transcript.delta', delta: 'Look up the weather', start_ms: 0, end_ms: 500 });
  receive({ type: 'session.delegation.created', delegation: { id: 'item_test', target: 'client' } });
  receive({ type: 'session.delegation.created', delegation: { id: 'item_test', target: 'client' } });
  t.mock.timers.tick(350);
  await ready;
  now = 50_000; t.mock.timers.tick(100);
  assert.equal(b.track.stopped, false);
  release(Response.json({ content: 'Verified forecast', searches: [] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.calls.filter(url => url.endsWith('/delegate')).length, 1);
  assert.ok(b.channel.sent.some(event => event.type === 'session.commentary.append' && event.content === 'Verified forecast'));
  b.session.end(); t.mock.timers.tick(2000);
});
