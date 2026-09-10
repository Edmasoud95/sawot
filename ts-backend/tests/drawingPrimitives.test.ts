import assert from "node:assert/strict";
import test from "node:test";
import {
  DETAILED_SKETCH_MAX_POINTS, DETAILED_SKETCH_MAX_STROKES, SKETCH_MAX_POINTS, SKETCH_MAX_STROKES,
  expandPrimitive, expressionFromToolArgs, expressionPrompt, orbTool, sketchLimits,
} from "../src/expressions.js";

const within = (pts: number[]) => pts.every((v) => v >= 0 && v <= 1);
const closed = (pts: number[]) => pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];

test("the setting selects the limits and the tool schema", () => {
  assert.deepEqual(sketchLimits(), { strokes: SKETCH_MAX_STROKES, points: SKETCH_MAX_POINTS });
  assert.deepEqual(sketchLimits({ detailed: true }), { strokes: DETAILED_SKETCH_MAX_STROKES, points: DETAILED_SKETCH_MAX_POINTS });
  assert.ok(!("shapes" in (orbTool().parameters.properties as any)), "basic tool has no primitives");
  assert.ok("shapes" in (orbTool({ detailed: true }).parameters.properties as any));
  assert.ok(orbTool({ detailed: true }).parameters.properties.strokes.description.includes(String(DETAILED_SKETCH_MAX_STROKES)));
  assert.ok(!/detailed drawing is on/i.test(expressionPrompt()));
  assert.ok(/detailed drawing is on/i.test(expressionPrompt({ detailed: true })));
  assert.ok(expressionPrompt({ detailed: true }).includes("fill:true"));
});

test("primitives expand to closed polylines inside the unit square", () => {
  const circle = expandPrimitive({ type: "circle", cx: 0.5, cy: 0.5, r: 0.3 })!;
  assert.equal(circle.fill, false);
  assert.ok(closed(circle.points) && within(circle.points));
  assert.ok(circle.points.length / 2 > 20, "smooth");
  assert.ok(Math.abs(circle.points[0] - 0.8) < 1e-9 && Math.abs(circle.points[1] - 0.5) < 1e-9);

  const filled = expandPrimitive({ type: "circle", cx: 0.5, cy: 0.5, r: 0.9, fill: true })!;
  assert.ok(filled.fill && within(filled.points), "clamped to the square");

  const rect = expandPrimitive({ type: "rect", x: 0.1, y: 0.2, w: 0.5, h: 0.3, fill: true })!;
  assert.deepEqual(rect.points, [0.1, 0.2, 0.6, 0.2, 0.6, 0.5, 0.1, 0.5, 0.1, 0.2]);
  assert.equal(rect.fill, true);

  const ellipse = expandPrimitive({ type: "ellipse", cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.1, rotation: 90 })!;
  assert.ok(closed(ellipse.points));
  const ys = ellipse.points.filter((_, i) => i % 2);
  assert.ok(Math.max(...ys) > 0.85, "rotation turns the long axis vertical");

  const poly = expandPrimitive({ type: "polygon", points: [0.5, 0.9, 0.1, 0.1, 0.9, 0.1], fill: true })!;
  assert.ok(closed(poly.points) && poly.fill);
  assert.equal(poly.points.length, 8);

  const line = expandPrimitive({ type: "line", points: [[0, 0], [1, 1]] })!;
  assert.deepEqual(line.points, [0, 0, 1, 1]);
  assert.equal(line.fill, false);
});

test("arcs are open, follow the angles, and never fill", () => {
  const smile = expandPrimitive({ type: "arc", cx: 0.5, cy: 0.5, r: 0.2, start: 200, end: 340, fill: true })!;
  assert.equal(smile.fill, false);
  assert.ok(!closed(smile.points));
  assert.ok(smile.points.filter((_, i) => i % 2).every((y) => y <= 0.5 + 1e-9), "below the centre");
  assert.equal(expandPrimitive({ type: "arc", cx: 0.5, cy: 0.5, r: 0.2, start: 10, end: 10 }), null);
});

test("malformed primitives are rejected rather than drawn", () => {
  assert.equal(expandPrimitive({ type: "circle", cx: 0.5, cy: 0.5 }), null);
  assert.equal(expandPrimitive({ type: "circle", cx: 0.5, cy: 0.5, r: -1 }), null);
  assert.equal(expandPrimitive({ type: "blob" }), null);
  assert.equal(expandPrimitive({ type: "polygon", points: [0, 0, 1, 1] }), null, "a polygon needs three corners");
  assert.equal(expandPrimitive("circle"), null);
});

test("tool arguments combine shapes and strokes into one sketch with fills", () => {
  const payload = expressionFromToolArgs({
    kind: "sketch",
    shapes: [
      { type: "ellipse", cx: 0.5, cy: 0.4, rx: 0.3, ry: 0.2, fill: true },
      { type: "circle", cx: 0.5, cy: 0.75, r: 0.12, fill: true },
      { type: "arc", cx: 0.5, cy: 0.72, r: 0.06, start: 200, end: 340 },
    ],
    strokes: [[0.2, 0.2, 0.2, 0.05], [0.8, 0.2, 0.8, 0.05]],
  }, { detailed: true });
  assert.equal(payload.kind, "sketch");
  if (payload.kind !== "sketch") return;
  assert.equal(payload.fills?.length, 2);
  assert.equal(payload.strokes.length, 3, "two legs and the smile");
  assert.ok(payload.fills!.every(closed));

  const shapesOnly = expressionFromToolArgs({ shapes: [{ type: "rect", x: 0, y: 0, w: 1, h: 1, fill: true }] });
  assert.equal(shapesOnly.kind, "sketch", "kind is inferred from shapes");
  const noFill = expressionFromToolArgs({ kind: "sketch", shapes: [{ type: "circle", cx: 0.5, cy: 0.5, r: 0.2 }] });
  assert.ok(noFill.kind === "sketch" && !("fills" in noFill), "no fills key when nothing is filled");
});

test("primitives count toward the limits and one bad primitive voids the drawing", () => {
  const circles = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "circle", cx: 0.5, cy: 0.5, r: 0.01 + i / 100 }));
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: circles(7) }).kind, "none", "7 circles exceed 200 points at the basic limit");
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: circles(7) }, { detailed: true }).kind, "sketch");
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: circles(13) }, { detailed: true }).kind, "none", "13 circles exceed 400 points");
  const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "line", points: [0, i / 30, 1, i / 30] }));
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: lines(DETAILED_SKETCH_MAX_STROKES) }, { detailed: true }).kind, "sketch");
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: lines(DETAILED_SKETCH_MAX_STROKES + 1) }, { detailed: true }).kind, "none");
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: [{ type: "circle", cx: 0.5, cy: 0.5, r: 0.2 }, { type: "nope" }] }, { detailed: true }).kind, "none");
  assert.equal(expressionFromToolArgs({ kind: "sketch", shapes: "circle" }, { detailed: true }).kind, "none");
});
