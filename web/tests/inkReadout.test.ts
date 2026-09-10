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

test("fills ink the inside of a polygon and take ink in proportion to their area", () => {
  const square = [.25, .25, .75, .25, .75, .75, .25, .75, .25, .25];
  const points = sketchDestinations([], 300, [square])!;
  assert.equal(points.length, 900);
  for (let i = 0; i < 300; i++) {
    assert.ok(Math.abs(points[i * 3]) <= .25 + 1e-9 && Math.abs(points[i * 3 + 1]) <= .25 + 1e-9, "inside the square");
  }
  const box = spread(points);
  assert.ok(box.maxX - box.minX > .4 && box.maxY - box.minY > .4, "spread across the interior, not the edge");

  // A fill next to a short stroke keeps most of the ink.
  const mixed = sketchDestinations([[0, 0, 0.1, 0]], 300, [square])!;
  let insideSquare = 0;
  for (let i = 0; i < 300; i++) if (Math.abs(mixed[i * 3]) <= .25 + 1e-9 && Math.abs(mixed[i * 3 + 1]) <= .25 + 1e-9) insideSquare++;
  assert.ok(insideSquare > 250, `${insideSquare} of 300 in the fill`);

  // Degenerate fills are ignored; nothing at all is null.
  assert.equal(sketchDestinations([], 100, [[0, 0, 1, 1, 0, 0]]), null);
  assert.equal(sketchDestinations([], 100, []), null);
});
