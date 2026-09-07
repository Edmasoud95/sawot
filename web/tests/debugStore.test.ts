import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem: () => {} } });
const { useDebugStore } = await import("../src/debugStore.ts");

test("a voice turn opens on stt and collects its events until reply, with stage timings", () => {
  const d = useDebugStore.getState();
  d.clear();
  d.beginTurn("voice", { event: "stt", data: { text: "hi", latency_ms: 120 } });
  d.addEvent({ event: "llm_round", data: { round: 1, latency_ms: 800, tool_calls: ["get_entities"] } });
  d.addEvent({ event: "tool_call", data: { name: "get_entities", args: { domain: "light" } } });
  d.addEvent({ event: "tool_result", data: { name: "get_entities", ok: true, latency_ms: 40 } });
  d.addEvent({ event: "llm_round", data: { round: 2, latency_ms: 500, tool_calls: null } });
  d.addEvent({ event: "reply", data: { raw: "<expression:star> ok", text: "ok", expression: { kind: "shape", name: "star" }, latency_ms: 1400 } });
  d.addEvent({ event: "tts", data: { latency_ms: 300, bytes: 4000 } });
  const turn = useDebugStore.getState().turns.at(-1)!;
  assert.equal(turn.mode, "voice");
  assert.equal(turn.events.length, 7);
  assert.deepEqual(turn.stages, { stt: 120, llm: 1300, tools: 40, tts: 300 });
  assert.equal(turn.total, 1820); // stt + reply latency (which spans rounds and tools) + tts
  assert.equal(turn.toolCalls, 1);
  assert.equal(turn.text, "ok");
  assert.deepEqual(turn.expression, { kind: "shape", name: "star" });
});

test("a chat turn begins explicitly and the log keeps the last twenty turns", () => {
  const d = useDebugStore.getState();
  d.clear();
  for (let i = 0; i < 25; i++) {
    d.beginTurn("chat", { event: "user", data: { text: `q${i}` } });
    d.addEvent({ event: "reply", data: { text: `a${i}`, latency_ms: 10 } });
  }
  const turns = useDebugStore.getState().turns;
  assert.equal(turns.length, 20);
  assert.equal(turns[0].events[0].data.text, "q5");
  assert.equal(turns.at(-1)!.mode, "chat");
  assert.ok(turns.every((t, i) => i === 0 || t.id > turns[i - 1].id), "ids keep increasing across trimming");
});

test("events arriving before any turn are attached to a synthetic turn rather than dropped", () => {
  const d = useDebugStore.getState();
  d.clear();
  d.addEvent({ event: "tool_result", data: { name: "x", ok: false } });
  assert.equal(useDebugStore.getState().turns.length, 1);
  assert.equal(useDebugStore.getState().turns[0].mode, "unknown");
});

test("raw messages are logged in both directions with a cap and can be cleared", () => {
  const d = useDebugStore.getState();
  d.clear();
  for (let i = 0; i < 250; i++) d.logMessage(i % 2 ? "in" : "out", { type: "ping", i });
  assert.equal(useDebugStore.getState().messages.length, 200);
  assert.equal(useDebugStore.getState().messages[0].payload.i, 50);
  assert.equal(useDebugStore.getState().messages[0].direction, "out");
  d.logMessage("in", "binary 12000 bytes");
  assert.equal(useDebugStore.getState().messages.at(-1)!.payload, "binary 12000 bytes");
  d.clearMessages();
  assert.equal(useDebugStore.getState().messages.length, 0);
});
