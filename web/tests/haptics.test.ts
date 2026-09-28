import assert from "node:assert/strict";
import test from "node:test";
import { createHapticTick } from "../src/lib/haptics.ts";

test("step feedback is brief and throttles rapid crossings", () => {
  let time = 0;
  const pulses: number[] = [];
  const tick = createHapticTick(ms => pulses.push(ms), () => time);
  tick();
  time = 10; tick();
  time = 60; tick();
  assert.deepEqual(pulses, [8, 8]);
});

test("unavailable or failing vibration never breaks the control", () => {
  assert.doesNotThrow(createHapticTick(() => { throw new Error("unavailable"); }));
  assert.doesNotThrow(createHapticTick());
});
