import assert from "node:assert/strict";
import test from "node:test";

// Store persistence is browser-owned; the expression behavior itself is real.
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem: () => {} } });
const { useVoiceStore } = await import("../src/store.ts");
const activity = (domain: string, phase = "start") => ({ domain, phase, tool: "call_service" });

test("a light action produces a bulb without needing diagnostics enabled", () => {
  const s = useVoiceStore.getState();
  assert.equal(typeof s.showActivity, "function", "voice store must consume activity events");
  s.showActivity(activity("light"));
  assert.equal(useVoiceStore.getState().expression.shape, "bulb");
  assert.equal(useVoiceStore.getState().debugEnabled, false);
});

test("successful actions stay visible briefly; failed actions dissolve", () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity("light"));
  s.showActivity(activity("light", "complete"));
  assert.equal(useVoiceStore.getState().expression.shape, "bulb");
  assert.ok(useVoiceStore.getState().expression.expiresAt > Date.now() + 2000);
  s.showActivity(activity("light", "error"));
  assert.equal(useVoiceStore.getState().expression, null);
});

test("device domains choose meaningful shapes and unknown actions stay neutral", () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity("climate"));
  assert.equal(useVoiceStore.getState().expression.shape, "thermometer");
  s.showActivity(activity("media_player"));
  assert.equal(useVoiceStore.getState().expression.shape, "notes");
  s.showActivity(activity("unknown"));
  assert.equal(useVoiceStore.getState().expression, null);
});

test("a new recording or disconnect clears the previous expression", () => {
  const s = useVoiceStore.getState();
  for (const status of ["recording", "connecting"]) {
    s.showActivity(activity("light"));
    s.setStatus(status);
    assert.equal(useVoiceStore.getState().expression, null);
  }
});

test("an older completion cannot replace a newer action", () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity("light"));
  s.showActivity(activity("climate"));
  s.showActivity(activity("light", "complete"));
  assert.equal(useVoiceStore.getState().expression.shape, "thermometer");
});

test("unknown domain names cannot resolve through object prototype properties", () => {
  useVoiceStore.getState().showActivity(activity("constructor"));
  assert.equal(useVoiceStore.getState().expression, null);
});

test("a late completion does not revive a timed-out action", () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity("light"));
  useVoiceStore.setState({ expression: { ...useVoiceStore.getState().expression, expiresAt: Date.now() - 1 } });
  s.showActivity(activity("light", "complete"));
  assert.equal(useVoiceStore.getState().expression, null);
});

test('model-chosen expressions expire and none releases them', () => {
  const s = useVoiceStore.getState();
  s.clearExpression();
  s.showExpression({ kind: 'shape', name: 'happy' });
  assert.equal(useVoiceStore.getState().expression.shape, 'happy');
  assert.ok(useVoiceStore.getState().expression.expiresAt > Date.now() + 4000);
  s.showExpression({ kind: 'shape', name: 'lock' });
  assert.equal(useVoiceStore.getState().expression.shape, 'lock');
  s.showExpression({ kind: 'none' });
  assert.equal(useVoiceStore.getState().expression, null);
  s.showExpression({ kind: 'shape', name: 'constructor' });
  assert.equal(useVoiceStore.getState().expression, null);
  s.showExpression(undefined);
  assert.equal(useVoiceStore.getState().expression, null);
});

test('an explicit model expression replaces a device expression; none keeps it', () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity('light'));
  s.showExpression({ kind: 'none' });
  assert.equal(useVoiceStore.getState().expression.shape, 'bulb');
  s.showExpression({ kind: 'shape', name: 'check' });
  assert.equal(useVoiceStore.getState().expression.shape, 'check');
  s.setStatus('recording');
  assert.equal(useVoiceStore.getState().expression, null);
});

test('readouts and sketches carry their payload and hold longer', () => {
  const s = useVoiceStore.getState();
  s.clearExpression();
  s.showExpression({ kind: 'readout', text: '42%' });
  assert.equal(useVoiceStore.getState().expression.shape, 'readout');
  assert.equal(useVoiceStore.getState().expression.text, '42%');
  assert.ok(useVoiceStore.getState().expression.expiresAt > Date.now() + 9000);
  s.showExpression({ kind: 'sketch', strokes: [[0, 0, 1, 1]] });
  assert.equal(useVoiceStore.getState().expression.shape, 'sketch');
  assert.deepEqual(useVoiceStore.getState().expression.strokes, [[0, 0, 1, 1]]);
  s.showExpression({ kind: 'sketch', strokes: 'nope' });
  assert.equal(useVoiceStore.getState().expression, null);
  // Over-long drawings are trimmed to the cap rather than thrown away.
  const many = Array.from({ length: 20 }, (_, i) => [0, i / 20, 1, i / 20]);
  s.showExpression({ kind: 'sketch', strokes: many });
  assert.equal(useVoiceStore.getState().expression.shape, 'sketch');
  assert.equal(useVoiceStore.getState().expression.strokes.length, 16);
});

test('every catalogue name the backend offers resolves to a shape', async () => {
  const { EXPRESSION_CATALOG } = await import('../../ts-backend/src/expressions.ts');
  const { SHAPES } = await import('../src/lib/inkShapes.ts');
  const s = useVoiceStore.getState();
  for (const { name } of EXPRESSION_CATALOG) {
    s.showExpression({ kind: 'shape', name });
    assert.equal(useVoiceStore.getState().expression?.shape, name, name);
    assert.equal(typeof SHAPES[name], 'function', `no ink shape for ${name}`);
  }
});

test('temperature readouts keep precision, unit and priority over tone', () => {
  const s = useVoiceStore.getState();
  s.showReading({ kind: 'temperature', value: 21.5, unit: '°C', entity_id: 'sensor.room' });
  assert.equal(useVoiceStore.getState().expression.text, '21.5°C');
  s.showExpression({ kind: 'shape', name: 'happy' });
  assert.equal(useVoiceStore.getState().expression.text, '21.5°C');
  s.showReading({ kind: 'temperature', value: -4, unit: '°F' });
  assert.equal(useVoiceStore.getState().expression.text, '-4°F');
  s.clearExpression();
  s.showReading({ kind: 'temperature', value: null, unit: '°C' });
  assert.equal(useVoiceStore.getState().expression, null);
});
