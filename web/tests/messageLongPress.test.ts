import assert from "node:assert/strict";
import test from "node:test";
import { createMessageLongPress, placeMessageMenu } from "../src/lib/messageLongPress.ts";

function fixture() {
  let pending: (() => void) | undefined;
  const opened: { x: number; y: number }[] = [];
  const gesture = createMessageLongPress(point => opened.push(point), {
    schedule: callback => { pending = callback; return 1; },
    cancel: () => { pending = undefined; },
  });
  return { gesture, opened, fire: () => { const callback = pending; pending = undefined; callback?.(); } };
}
test("a stationary hold opens once at the touched message", () => {
  const f = fixture();
  f.gesture.start(40, 90);
  f.gesture.move(43, 94);
  f.fire(); f.fire();
  assert.deepEqual(f.opened, [{ x: 40, y: 90 }]);
});
test("scroll movement and cancellation stop a pending hold", () => {
  for (const stop of [g => g.move(40, 102), g => g.cancel()]) {
    const f = fixture(); f.gesture.start(40, 90); stop(f.gesture); f.fire();
    assert.deepEqual(f.opened, []);
  }
});
test("starting again replaces a stale hold", () => {
  const f = fixture(); f.gesture.start(40, 90); f.gesture.start(60, 80); f.fire();
  assert.deepEqual(f.opened, [{ x: 60, y: 80 }]);
});
test("the menu stays within narrow viewports and flips above the finger near the bottom", () => {
  assert.deepEqual(placeMessageMenu({ x: 310, y: 600 }, 224, 190, { left: 0, top: 0, width: 320, height: 640 }), { left: 84, top: 392 });
  assert.deepEqual(placeMessageMenu({ x: 0, y: 0 }, 224, 190, { left: 0, top: 0, width: 320, height: 640 }), { left: 12, top: 18 });
  assert.deepEqual(placeMessageMenu({ x: 300, y: 400 }, 224, 190, { left: 0, top: 300, width: 390, height: 250 }), { left: 154, top: 312 });
});
