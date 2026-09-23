import assert from "node:assert/strict";
import test from "node:test";
import { DictationController } from "../src/lib/dictation.ts";

function harness(transcribe = async (_audio: Blob, _signal: AbortSignal) => "spoken words here") {
  let starts = 0, stops = 0, cancellations = 0;
  const inserted: string[] = [];
  const controller = new DictationController({
    recorder: {
      start: async () => { starts++; },
      stop: async () => { stops++; return new Blob(["audio"]); },
      cancel: () => { cancellations++; },
    },
    transcribe,
    onText: text => inserted.push(text),
    onChange: () => {},
  });
  return { controller, inserted, counts: () => ({ starts, stops, cancellations }) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("a tap latches recording until a second activation, then inserts text", async () => {
  const h = harness();
  h.controller.toggle();
  await tick();
  assert.equal(h.controller.state.mode, "latched");
  assert.equal(h.counts().starts, 1);
  assert.equal(h.counts().stops, 0);
  await h.controller.finish();
  assert.deepEqual(h.inserted, ["spoken words here"]);
  assert.equal(h.controller.state.mode, "idle");
});

test("cancellation aborts transcription and ignores a late result", async () => {
  let resolve!: (text: string) => void;
  let signal!: AbortSignal;
  const h = harness(async (_audio, s) => { signal = s; return new Promise(r => { resolve = r; }); });
  h.controller.toggle();
  await tick();
  const finishing = h.controller.finish();
  await tick();
  h.controller.cancel();
  assert.equal(signal.aborted, true);
  resolve("stale transcript");
  await finishing;
  assert.deepEqual(h.inserted, []);
  assert.equal(h.controller.state.mode, "idle");
});

test("a microphone failure returns to idle with a useful error", async () => {
  const controller = new DictationController({
    recorder: { start: async () => { throw new DOMException("Denied", "NotAllowedError"); }, stop: async () => null, cancel: () => {} },
    transcribe: async () => "", onText: () => assert.fail("no text expected"), onChange: () => {},
  });
  controller.toggle();
  await tick();
  assert.equal(controller.state.mode, "idle");
  assert.match(controller.state.error, /microphone permission/i);
});

test("stopping before microphone permission resolves cancels without transcription", async () => {
  let resolve!: () => void;
  let cancelled = false;
  const controller = new DictationController({
    recorder: { start: () => new Promise<void>(r => { resolve = r; }), stop: async () => null, cancel: () => { cancelled = true; } },
    transcribe: async () => { assert.fail("must not transcribe"); return ""; }, onText: () => {}, onChange: () => {},
  });
  controller.toggle();
  await controller.finish();
  resolve();
  await tick();
  assert.equal(cancelled, true);
  assert.equal(controller.state.mode, "idle");
});
