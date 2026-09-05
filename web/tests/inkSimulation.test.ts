import assert from "node:assert/strict";
import test from "node:test";
import { InkSimulation } from "../src/lib/inkSimulation.ts";

const distance = (a: Float32Array, b: Float32Array) => {
  let total = 0;
  for (let i = 0; i < a.length; i += 3) total += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
  return total / (a.length / 3);
};

test("forming a bulb transports the existing ink particles instead of replacing them", () => {
  const ink = new InkSimulation(1024);
  const positions = ink.positions;
  const before = positions.slice();
  ink.setShape(1);
  assert.deepEqual(positions, before, "selecting a shape must not teleport ink");
  for (let i = 0; i < 150; i++) ink.step(1 / 60, i / 60, 0);
  assert.equal(ink.positions, positions);
  assert.ok(distance(before, positions) > .12, "ink must visibly travel");
  assert.ok(distance(positions, ink.targets) < .045, "ink must converge on the bulb");
});

test("changing shapes preserves positions and velocities at the moment of retargeting", () => {
  const ink = new InkSimulation(1024);
  ink.setShape(1);
  for (let i = 0; i < 60; i++) ink.step(1 / 60, i / 60, 0);
  const position = ink.positions.slice();
  const velocity = ink.velocities.slice();
  ink.setShape(3);
  assert.deepEqual(ink.positions, position);
  assert.deepEqual(ink.velocities, velocity);
  ink.step(1 / 60, 1, 0);
  assert.ok(distance(position, ink.positions) < .04, "retargeting must stay continuous");
  for (let i = 1; i < 180; i++) ink.step(1 / 60, 1 + i / 60, 0);
  assert.ok(distance(ink.positions, ink.targets) < .045);
});

test("releasing an expression disperses the same ink back into the orb", () => {
  const ink = new InkSimulation(1024);
  ink.setShape(2);
  for (let i = 0; i < 180; i++) ink.step(1 / 60, i / 60, 0);
  const gathered = ink.positions.slice();
  ink.setShape(0);
  for (let i = 0; i < 240; i++) ink.step(1 / 60, 3 + i / 60, 0);
  assert.ok(distance(gathered, ink.positions) > .2);
  assert.ok(ink.positions.every(Number.isFinite));
  for (let i = 0; i < ink.positions.length; i += 3) {
    assert.ok(Math.hypot(ink.positions[i], ink.positions[i + 1]) < .87);
  }
});

test("reduced motion settles immediately and stays still", () => {
  const ink = new InkSimulation(512);
  ink.setShape(1);
  ink.step(1 / 60, 1, .8, true);
  const still = ink.positions.slice();
  ink.step(1 / 60, 4, .2, true);
  assert.deepEqual(ink.positions, still);
  assert.ok(distance(ink.positions, ink.targets) < .001);
});

test('numeric readouts transport ink and support changing values without teleporting', () => {
  const ink = new InkSimulation(512);
  const initial = ink.positions.slice();
  ink.setReadout('21.5°C');
  ink.setShape(6);
  assert.deepEqual(ink.positions, initial);
  for (let i = 0; i < 180; i++) ink.step(1 / 60, i / 60, 0);
  assert.ok(distance(initial, ink.positions) > .12);
  assert.ok(distance(ink.positions, ink.targets) < .045);
  const previous = ink.positions.slice();
  ink.setReadout('-4°F');
  assert.deepEqual(ink.positions, previous);
  ink.step(1 / 60, 4, 0, true);
  assert.ok(distance(previous, ink.positions) > .05);
  assert.ok(ink.positions.every(Number.isFinite));
});
