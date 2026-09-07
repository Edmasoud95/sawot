import assert from "node:assert/strict";
import test from "node:test";
import { readoutDestinations, sketchDestinations } from "../src/lib/inkReadout.ts";

const spread = (points: Float32Array) => {
  let minX = 1, maxX = -1, minY = 1, maxY = -1;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  return { minX, maxX, minY, maxY };
};

test("numbers, units and short words all become stroke destinations", () => {
  for (const text of ["21.5°C", "-4°F", "42%", "LOCKED", "3 MIN", "12:30"]) {
    const points = readoutDestinations(text, 400);
    assert.ok(points && points.length === 1200, text);
    const box = spread(points!);
    assert.ok(box.maxX <= .56 && box.minX >= -.56 && box.maxY <= .5 && box.minY >= -.5, `${text} fits the vessel`);
  }
});

test("long readouts wrap at a space onto a second line", () => {
  const one = spread(readoutDestinations("LOCKED", 400)!);
  const two = spread(readoutDestinations("FRONT DOOR", 400)!);
  assert.ok(two.maxY - two.minY > (one.maxY - one.minY) * 1.5, "two lines are taller than one");
});

test("unsupported characters and empty text produce nothing", () => {
  assert.equal(readoutDestinations("", 100), null);
  assert.equal(readoutDestinations("héllo", 100), null);
  assert.equal(readoutDestinations("x".repeat(20), 100), null);
});

test("sketch strokes map from the unit square into the vessel with y up", () => {
  const points = sketchDestinations([[0, 0, 1, 1]], 200)!;
  assert.equal(points.length, 600);
  const box = spread(points);
  assert.ok(box.minX < -.4 && box.maxX > .4 && box.minY < -.4 && box.maxY > .4, "the diagonal spans the vessel");
  // The first point (0,0) sits bottom-left: negative x and negative y.
  const bottomLeft = Array.from({ length: 200 }, (_, i) => i).some((i) => points[i * 3] < -.4 && points[i * 3 + 1] < -.4);
  assert.ok(bottomLeft);
  assert.equal(sketchDestinations([], 100), null);
  assert.equal(sketchDestinations([[0, 0]], 100), null);
});
