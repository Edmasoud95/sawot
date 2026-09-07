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
  ink.setShape("bulb");
  assert.deepEqual(positions, before, "selecting a shape must not teleport ink");
  for (let i = 0; i < 150; i++) ink.step(1 / 60, i / 60, 0);
  assert.equal(ink.positions, positions);
  assert.ok(distance(before, positions) > .12, "ink must visibly travel");
  assert.ok(distance(positions, ink.targets) < .045, "ink must converge on the bulb");
});

test("changing shapes preserves positions and velocities at the moment of retargeting", () => {
  const ink = new InkSimulation(1024);
  ink.setShape("bulb");
  for (let i = 0; i < 60; i++) ink.step(1 / 60, i / 60, 0);
  const position = ink.positions.slice();
  const velocity = ink.velocities.slice();
  ink.setShape("notes");
  assert.deepEqual(ink.positions, position);
  assert.deepEqual(ink.velocities, velocity);
  ink.step(1 / 60, 1, 0);
  assert.ok(distance(position, ink.positions) < .04, "retargeting must stay continuous");
  for (let i = 1; i < 180; i++) ink.step(1 / 60, 1 + i / 60, 0);
  assert.ok(distance(ink.positions, ink.targets) < .045);
});

test("releasing an expression disperses the same ink back into the orb", () => {
  const ink = new InkSimulation(1024);
  ink.setShape("thermometer");
  for (let i = 0; i < 180; i++) ink.step(1 / 60, i / 60, 0);
  const gathered = ink.positions.slice();
  ink.setShape("");
  for (let i = 0; i < 240; i++) ink.step(1 / 60, 3 + i / 60, 0);
  assert.ok(distance(gathered, ink.positions) > .2);
  assert.ok(ink.positions.every(Number.isFinite));
  for (let i = 0; i < ink.positions.length; i += 3) {
    assert.ok(Math.hypot(ink.positions[i], ink.positions[i + 1]) < .87);
  }
});

test("reduced motion settles immediately and stays still", () => {
  const ink = new InkSimulation(512);
  ink.setShape("bulb");
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
  ink.setShape("readout");
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

test("particles carry three size tiers so strands mix fine filaments with soft bodies", () => {
  const ink = new InkSimulation(600);
  assert.equal(ink.sizes.length, 600);
  const tiers = new Set(Array.from(ink.sizes, (s) => Math.round(s * 100)));
  assert.ok(tiers.size >= 3, "expected at least three distinct size tiers");
  const min = Math.min(...ink.sizes), max = Math.max(...ink.sizes);
  assert.ok(min > 0 && max / min >= 2, "large bodies must be at least twice the fine filaments");
  const large = Array.from(ink.sizes).filter((s) => s > (min + max) / 2).length;
  assert.ok(large < 600 * .25, "large bodies must be the minority");
});

test("a sudden rise in audio level kicks the ink outward, a steady level does not", () => {
  const settle = (ink: InkSimulation, level = 0) => { for (let i = 0; i < 240; i++) ink.step(1 / 60, i / 60, level); };
  const radialSpeed = (ink: InkSimulation) => {
    let total = 0;
    for (let i = 0; i < ink.count; i++) {
      const x = ink.positions[i * 3], y = ink.positions[i * 3 + 1], r = Math.hypot(x, y) || 1;
      total += (ink.velocities[i * 3] * x + ink.velocities[i * 3 + 1] * y) / r;
    }
    return total / ink.count;
  };
  const steady = new InkSimulation(512);
  settle(steady, .9);
  const before = steady.velocities.slice();
  steady.step(1 / 60, 4, .9);
  const steadyChange = radialSpeed(steady);

  const onset = new InkSimulation(512);
  settle(onset);
  onset.step(1 / 60, 4, 0);
  onset.step(1 / 60, 4 + 1 / 60, .9);
  const kick = radialSpeed(onset);
  assert.ok(kick > steadyChange + .05, `onset must push ink outward (kick ${kick.toFixed(3)}, steady ${steadyChange.toFixed(3)})`);
  assert.ok(onset.velocities.every(Number.isFinite));
  assert.notDeepEqual(onset.velocities, before);
});

test("a symbol gathers only part of the ink; the rest keeps flowing near the rim", () => {
  const ink = new InkSimulation(1024);
  ink.setShape("bulb");
  for (let i = 0; i < 240; i++) ink.step(1 / 60, i / 60, 0);
  let inner = 0, outer = 0;
  for (let i = 0; i < ink.count; i++) {
    const r = Math.hypot(ink.positions[i * 3], ink.positions[i * 3 + 1]);
    if (r < .56) inner++; else outer++;
  }
  assert.ok(inner / ink.count > .35 && inner / ink.count < .6, `symbol share ${inner / ink.count}`);
  assert.ok(outer / ink.count > .4, `ambient share ${outer / ink.count}`);
  assert.ok(distance(ink.positions, ink.targets) < .045, "both groups must converge on their targets");
});

test("ambient ink fades to a haze while a symbol is shown and recovers afterwards", () => {
  const ink = new InkSimulation(400);
  assert.equal(ink.weights.length, 400);
  assert.ok(Array.from(ink.weights).every((w) => w === 1), "all ink starts at full weight");
  ink.setShape("bulb");
  for (let i = 0; i < 120; i++) ink.step(1 / 60, i / 60, 0);
  const full = Array.from(ink.weights).filter((w) => w > .9).length;
  const faded = Array.from(ink.weights).filter((w) => w < .5).length;
  assert.ok(full / ink.count > .4 && full / ink.count < .5, `symbol ink keeps full weight (${full / ink.count})`);
  assert.equal(full + faded, ink.count, "every particle is either symbol ink or faded ambient ink");
  ink.setShape("");
  for (let i = 0; i < 120; i++) ink.step(1 / 60, 3 + i / 60, 0);
  assert.ok(Array.from(ink.weights).every((w) => w > .9), "weight recovers after dispersal");
});

test("catalogue shapes and sketches form by name and unknown names release the ink", () => {
  const ink = new InkSimulation(600);
  ink.setShape("lock");
  for (let i = 0; i < 200; i++) ink.step(1 / 60, i / 60, 0);
  assert.ok(distance(ink.positions, ink.targets) < .045, "lock converges");
  let inside = 0;
  for (let i = 0; i < ink.count; i++) if (Math.hypot(ink.positions[i * 3], ink.positions[i * 3 + 1]) < .5) inside++;
  assert.ok(inside > 150, "symbol ink sits in the centre");
  ink.setSketch([[0, 0, 1, 1], [0, 1, 1, 0]]);
  ink.setShape("sketch");
  for (let i = 0; i < 200; i++) ink.step(1 / 60, 4 + i / 60, 0);
  assert.ok(distance(ink.positions, ink.targets) < .045, "sketch converges");
  assert.ok(ink.positions.every(Number.isFinite));
  ink.setShape("nonsense");
  for (let i = 0; i < 60; i++) ink.step(1 / 60, 8 + i / 60, 0);
  assert.ok(Array.from(ink.weights).every((w) => w > .5), "unknown names release ambient ink");
});

// Mean angular momentum of the ink about the centre: positive means the body
// turns counter-clockwise as a whole. Random currents average near zero.
const spin = (ink: InkSimulation) => {
  let total = 0;
  for (let i = 0; i < ink.count; i++) {
    const x = ink.positions[i * 3], y = ink.positions[i * 3 + 1];
    total += x * ink.velocities[i * 3 + 1] - y * ink.velocities[i * 3];
  }
  return total / ink.count;
};

test("thinking stirs the whole body into a slow coherent rotation that unwinds afterwards", () => {
  const ink = new InkSimulation(1024);
  for (let i = 0; i < 240; i++) ink.step(1 / 60, i / 60, 0);
  const idle = Math.abs(spin(ink));
  ink.setThinking(1);
  const identity = ink.tones.slice();
  for (let i = 0; i < 180; i++) ink.step(1 / 60, 4 + i / 60, 0);
  const churn = spin(ink);
  assert.ok(churn > idle + .01, `thinking must rotate the ink (churn ${churn.toFixed(4)}, idle ${idle.toFixed(4)})`);
  assert.deepEqual(ink.tones, identity, "the same particles keep their identity");
  ink.setThinking(0);
  for (let i = 0; i < 240; i++) ink.step(1 / 60, 7 + i / 60, 0);
  assert.ok(Math.abs(spin(ink)) < churn * .35, "rotation releases once the reply starts");
  assert.ok(ink.positions.every(Number.isFinite));
});

test("thinking sends a few filaments wandering through the voids and calls them back", () => {
  const ink = new InkSimulation(1000);
  for (let i = 0; i < 120; i++) ink.step(1 / 60, i / 60, 0);
  assert.equal(ink.sparks.length, 1000);
  assert.ok(Array.from(ink.sparks).every((s) => s === 0), "no sparks while idle");
  ink.setThinking(1);
  for (let i = 0; i < 120; i++) ink.step(1 / 60, 2 + i / 60, 0);
  const lit = Array.from(ink.sparks).filter((s) => s > .5).length;
  assert.ok(lit > 40 && lit < 160, `about 8% of the ink sparks (${lit})`);
  ink.setThinking(0);
  for (let i = 0; i < 120; i++) ink.step(1 / 60, 4 + i / 60, 0);
  assert.ok(Array.from(ink.sparks).every((s) => s < .1), "sparks fade when thinking ends");
});
