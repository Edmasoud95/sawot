import assert from "node:assert/strict";
import test from "node:test";
import { MessageReader, speechChunks, type ReadingState } from "../src/lib/messageReader.ts";

test("long speech is chunked without dropping or repeating text", () => {
  const text = Array.from({ length: 240 }, (_, i) => `word${i}`).join(" ");
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 600));
  assert.equal(chunks.join(" "), text);
  assert.deepEqual(speechChunks("   "), []);
});

test("stopping a pending read suppresses late audio, and selecting another message supersedes it", async () => {
  const pending: Array<(audio: ArrayBuffer) => void> = [];
  const played: ArrayBuffer[] = [];
  const states: ReadingState[] = [];
  const reader = new MessageReader({ unlock: async () => {}, request: () => new Promise(resolve => pending.push(resolve)), play: async audio => { played.push(audio); }, stop: () => {} }, state => states.push(state));
  const first = reader.toggle("first", "Hello");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(states.at(-1), { key: "first", phase: "loading" });
  reader.stop();
  const second = reader.toggle("second", "World");
  await new Promise(resolve => setTimeout(resolve, 0));
  pending[0](new ArrayBuffer(1));
  await first;
  assert.equal(played.length, 0);
  pending[1](new ArrayBuffer(2));
  await second;
  assert.equal(played[0].byteLength, 2);
  assert.equal(states.at(-1), null);
});

test("speech errors are shown and the next click can retry", async () => {
  const states: ReadingState[] = [];
  const reader = new MessageReader({ unlock: async () => {}, request: async () => { throw new Error("Speech offline"); }, play: async () => {}, stop: () => {} }, state => states.push(state));
  await reader.toggle("a", "Hello");
  assert.deepEqual(states.at(-1), { key: "a", phase: "error", error: "Speech offline" });
  await reader.toggle("a", "Hello");
  assert.equal(states.filter(s => s?.phase === "loading").length, 2);
});
