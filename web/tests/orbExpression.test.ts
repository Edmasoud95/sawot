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
  assert.equal(useVoiceStore.getState().expression.shape, "music");
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

test('conversation faces expire and neutral releases them', () => {
  const s = useVoiceStore.getState();
  s.clearExpression();
  s.showSentiment('happy');
  assert.equal(useVoiceStore.getState().expression.shape, 'happy');
  assert.ok(useVoiceStore.getState().expression.expiresAt > Date.now() + 4000);
  s.showSentiment('sad');
  assert.equal(useVoiceStore.getState().expression.shape, 'sad');
  s.showSentiment('neutral');
  assert.equal(useVoiceStore.getState().expression, null);
  s.showSentiment('constructor');
  assert.equal(useVoiceStore.getState().expression, null);
});

test('conversation tone cannot replace an active device expression', () => {
  const s = useVoiceStore.getState();
  s.showActivity(activity('light'));
  s.showSentiment('happy');
  assert.equal(useVoiceStore.getState().expression.shape, 'bulb');
  useVoiceStore.setState({ expression: { ...useVoiceStore.getState().expression, expiresAt: Date.now() - 1 } });
  s.showSentiment('sad');
  assert.equal(useVoiceStore.getState().expression.shape, 'sad');
  s.setStatus('recording');
  assert.equal(useVoiceStore.getState().expression, null);
});

test('temperature readouts keep precision, unit and priority over sentiment', () => {
  const s = useVoiceStore.getState();
  s.showReading({ kind: 'temperature', value: 21.5, unit: '°C', entity_id: 'sensor.room' });
  assert.equal(useVoiceStore.getState().expression.text, '21.5°C');
  s.showSentiment('happy');
  assert.equal(useVoiceStore.getState().expression.text, '21.5°C');
  s.showReading({ kind: 'temperature', value: -4, unit: '°F' });
  assert.equal(useVoiceStore.getState().expression.text, '-4°F');
  s.clearExpression();
  s.showReading({ kind: 'temperature', value: null, unit: '°C' });
  assert.equal(useVoiceStore.getState().expression, null);
});
