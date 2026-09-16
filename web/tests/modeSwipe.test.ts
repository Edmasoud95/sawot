import assert from "node:assert/strict";
import test from "node:test";
import { modeAfterSwipe } from "../src/lib/modeSwipe.ts";

test("left advances one mode and right goes back without wrapping", () => {
  assert.equal(modeAfterSwipe("orb", -120, 8, 300), "cards");
  assert.equal(modeAfterSwipe("cards", -120, 8, 300), "chat");
  assert.equal(modeAfterSwipe("chat", 120, 8, 300), "cards");
  assert.equal(modeAfterSwipe("cards", 120, 8, 300), "orb");
  assert.equal(modeAfterSwipe("orb", 120, 0, 300), "orb");
  assert.equal(modeAfterSwipe("chat", -120, 0, 300), "chat");
});

test("taps, vertical scrolling, diagonal drags, and long gestures do not switch modes", () => {
  for (const [dx, dy, duration] of [[20, 2, 100], [5, 140, 300], [90, 80, 300], [150, 0, 1200]]) {
    assert.equal(modeAfterSwipe("cards", dx, dy, duration), "cards");
  }
});
