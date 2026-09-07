import assert from "node:assert/strict";
import test from "node:test";
import { EXPRESSION_CATALOG, SKETCH_MAX_STROKES, parseExpressionMarkers, expressionPrompt } from "../src/expressions.js";

test("the catalogue holds the named expressions with one-line meanings", () => {
  const names = EXPRESSION_CATALOG.map((e) => e.name);
  for (const expected of ["happy", "sad", "surprised", "curious", "wink", "laughing", "sleepy", "love",
    "bulb", "thermometer", "notes", "lock", "unlock", "door", "fan", "bell", "plug", "camera", "home",
    "check", "cross", "question", "exclamation", "clock", "star", "sun", "cloud", "rain"]) {
    assert.ok(names.includes(expected), `catalogue is missing ${expected}`);
  }
  assert.ok(EXPRESSION_CATALOG.every((e) => e.meaning.length > 8));
  assert.equal(new Set(names).size, names.length, "names are unique");
});

test("a catalogue name becomes a shape expression and leaves the spoken text clean", () => {
  const parsed = parseExpressionMarkers("<expression:lock> The front door is locked.");
  assert.equal(parsed.reply, "The front door is locked.");
  assert.deepEqual(parsed.expression, { kind: "shape", name: "lock" });
});

test("unknown names and neutral produce no expression", () => {
  assert.deepEqual(parseExpressionMarkers("<expression:angry> Hmm.").expression, { kind: "none" });
  assert.deepEqual(parseExpressionMarkers("<expression:neutral> Hmm.").expression, { kind: "none" });
  assert.deepEqual(parseExpressionMarkers("Plain reply.").expression, { kind: "none" });
  assert.equal(parseExpressionMarkers("<expression:angry> Hmm.").reply, "Hmm.");
});

test("readouts keep short text within the allowed characters", () => {
  assert.deepEqual(parseExpressionMarkers("<readout:42%> Battery is at 42 percent.").expression, { kind: "readout", text: "42%" });
  assert.deepEqual(parseExpressionMarkers("<readout:3 MIN> Three minutes left.").expression, { kind: "readout", text: "3 MIN" });
  assert.deepEqual(parseExpressionMarkers("<readout:locked> Locked.").expression, { kind: "readout", text: "LOCKED" });
  assert.deepEqual(parseExpressionMarkers("<readout:this is far too long> x").expression, { kind: "none" });
  assert.deepEqual(parseExpressionMarkers("<readout:<b>hi</b>> x").expression, { kind: "none" });
});

test("sketches are parsed into clamped strokes with limits", () => {
  const parsed = parseExpressionMarkers("<sketch:0,0 1,1; 0.2,0.8 0.8,0.8 0.5,1.4> A shape.");
  assert.equal(parsed.reply, "A shape.");
  assert.deepEqual(parsed.expression, { kind: "sketch", strokes: [[0, 0, 1, 1], [0.2, 0.8, 0.8, 0.8, 0.5, 1]] });
  assert.deepEqual(parseExpressionMarkers("<sketch:0,0> x").expression, { kind: "none" }, "a stroke needs two points");
  assert.deepEqual(parseExpressionMarkers("<sketch:a,b c,d> x").expression, { kind: "none" });
  const many = Array.from({ length: SKETCH_MAX_STROKES + 1 }, () => "0,0 1,1").join(";");
  assert.deepEqual(parseExpressionMarkers(`<sketch:${many}> x`).expression, { kind: "none" }, "too many strokes");
});

test("detailed sketches with many points, newlines and loose spacing are accepted", () => {
  const rich = Array.from({ length: 12 }, (_, s) => Array.from({ length: 15 }, (_, i) => `${(i / 14).toFixed(2)},${(s / 11).toFixed(2)}`).join(" ")).join(";\n");
  const parsed = parseExpressionMarkers(`<sketch:${rich}> A detailed drawing.`);
  assert.equal(parsed.expression.kind, "sketch");
  assert.equal((parsed.expression as any).strokes.length, 12);
  assert.equal(parsed.reply, "A detailed drawing.");
  const loose = parseExpressionMarkers("<sketch: 0.1, 0.2  0.3,0.4 ; (0.5,0.6) (0.7,0.8) > x");
  assert.deepEqual(loose.expression, { kind: "sketch", strokes: [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]] });
  // Bare numbers without commas pair up in order; a dangling odd number is dropped.
  const bare = parseExpressionMarkers("<sketch:0.2 0.35 0.3 0.4 0.2 0.45 0.1; 0.25,0.3 0.2 0.4 0.22,0.5> x");
  assert.deepEqual(bare.expression, { kind: "sketch", strokes: [[0.2, 0.35, 0.3, 0.4, 0.2, 0.45], [0.25, 0.3, 0.2, 0.4, 0.22, 0.5]] });
});

test("the prompt teaches how to draw and forbids refusing a drawing", () => {
  const prompt = expressionPrompt();
  assert.ok(/never refuse/i.test(prompt));
  assert.ok(prompt.includes("<sketch:0.5,0.9"), "includes a worked multi-stroke example");
});

test("the prompt asks the model to sketch topical subjects unprompted", () => {
  const prompt = expressionPrompt();
  assert.ok(/draw proactively/i.test(prompt));
  assert.ok(/even if nobody asked/i.test(prompt));
  assert.ok(/reach for a sketch first/i.test(prompt));
});

test("the temperature marker still selects an entity and later markers override earlier ones", () => {
  const parsed = parseExpressionMarkers("<expression:happy> <temperature:sensor.hall> <readout:21°C> It is 21 degrees.");
  assert.equal(parsed.temperatureEntity, "sensor.hall");
  assert.deepEqual(parsed.expression, { kind: "readout", text: "21°C" });
  assert.equal(parsed.reply, "It is 21 degrees.");
});

test("markers anywhere in the reply are consumed and never spoken", () => {
  const middle = parseExpressionMarkers("Sure. <expression:happy> Done.");
  assert.equal(middle.reply, "Sure. Done.");
  assert.deepEqual(middle.expression, { kind: "shape", name: "happy" });
  const trailing = parseExpressionMarkers("I've drawn a tree for you! <sketch:0.45,0.8 0.3,0.9 0.6,0.9; 0.2,0.5 0.2,0.6>");
  assert.equal(trailing.reply, "I've drawn a tree for you!");
  assert.equal(trailing.expression.kind, "sketch");
  const beforePunctuation = parseExpressionMarkers("Here is my attempt at a cat for you <sketch:0,0 1,1>.");
  assert.equal(beforePunctuation.reply, "Here is my attempt at a cat for you.");
  assert.equal(beforePunctuation.expression.kind, "sketch");
});

test("the prompt lists every catalogue name and both free formats", () => {
  const prompt = expressionPrompt();
  for (const e of EXPRESSION_CATALOG) assert.ok(prompt.includes(`<expression:${e.name}>`), e.name);
  assert.ok(prompt.includes("<readout:"));
  assert.ok(prompt.includes("<sketch:"));
});
