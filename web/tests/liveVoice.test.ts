import assert from "node:assert/strict";
import test from "node:test";
import { LiveIdleClock, LiveTranscript } from "../src/lib/liveVoiceState.js";

test("Live closes after 30 quiet seconds, counting from the end of speech or work", () => {
  const clock = new LiveIdleClock(0);
  assert.equal(clock.expired(29_999), false);
  assert.equal(clock.expired(30_000), true);
  clock.activity(31_000);
  assert.equal(clock.expired(60_999), false);
  clock.setBusy(true, 61_000);
  assert.equal(clock.expired(160_000), false);
  clock.setBusy(false, 160_000);
  assert.equal(clock.expired(189_999), false);
  assert.equal(clock.expired(190_000), true);
});

test("overlapping Live captions remain separate and preserve exact transcript fragments", () => {
  const transcript = new LiveTranscript();
  transcript.append("user", "I'd like", 0, 1000);
  transcript.append("assistant", "Sure", 500, 900);
  transcript.append("user", " to talk", 1000, 1500);
  assert.equal(transcript.caption("user"), "I'd like to talk");
  assert.equal(transcript.caption("assistant"), "Sure");
  transcript.append("user", "Another topic", 5000, 6000);
  assert.deepEqual(transcript.turns().map(t => [t.role, t.text]), [["user", "I'd like to talk"], ["assistant", "Sure"], ["user", "Another topic"]]);
});
