import assert from "node:assert/strict";
import test from "node:test";
import { valueFromPointer, fractionOf } from "../src/lib/touchSlider.ts";

test("pointer position maps linearly onto the range and snaps to the step", () => {
  assert.equal(valueFromPointer(100, { left: 100, width: 200 }, 0, 100, 1), 0);
  assert.equal(valueFromPointer(300, { left: 100, width: 200 }, 0, 100, 1), 100);
  assert.equal(valueFromPointer(150, { left: 100, width: 200 }, 0, 100, 1), 25);
  assert.equal(valueFromPointer(163, { left: 100, width: 200 }, 2000, 6500, 50), 3400);
});

test("pointer positions beyond the bar clamp to the range", () => {
  assert.equal(valueFromPointer(20, { left: 100, width: 200 }, 1, 100, 1), 1);
  assert.equal(valueFromPointer(900, { left: 100, width: 200 }, 1, 100, 1), 100);
});

test("a zero-width bar never produces NaN", () => {
  assert.equal(valueFromPointer(5, { left: 5, width: 0 }, 0, 100, 1), 0);
});

test("fractionOf gives the filled proportion for drawing the bar", () => {
  assert.equal(fractionOf(50, 0, 100), 0.5);
  assert.equal(fractionOf(1, 1, 100), 0);
  assert.equal(fractionOf(200, 0, 100), 1);
});
