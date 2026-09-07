import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { runVoiceTurn } from "../src/pipeline.js";

async function turn(result: unknown, args: unknown = { domain: "light", service: "turn_on", entity_id: "light.kitchen" }) {
  const events: any[] = [];
  let calls = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: calls++ === 0
    ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "call_service", arguments: JSON.stringify(args) } }] }
    : { role: "assistant", content: "Done." } }] }) } } };
  const agent = new Agent(client as never, "test", [{
    name: "call_service", description: "Control a device", parameters: {},
    handler: async () => { events.push({ type: "device-called" }); return result; },
  }], "Test assistant");
  const inference = { transcribe: async () => "Turn on the kitchen light", synthesize: async () => Buffer.from("wav") };
  await runVoiceTurn(inference as never, agent, Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "test");
  return events;
}

test("activity starts before the device call and completes after it", async () => {
  const events = await turn({ success: true });
  const activity = events.filter((e) => e.type === "activity");
  assert.deepEqual(activity.map(({ phase, domain, service }) => ({ phase, domain, service })), [
    { phase: "start", domain: "light", service: "turn_on" },
    { phase: "complete", domain: "light", service: "turn_on" },
  ]);
  assert.ok(events.indexOf(activity[0]) < events.findIndex((e) => e.type === "device-called"));
  assert.ok(events.indexOf(activity[1]) > events.findIndex((e) => e.type === "device-called"));
});

test("a failed device call emits failure instead of suggesting completion", async () => {
  const events = await turn({ error: "Device offline" });
  assert.deepEqual(events.filter((e) => e.type === "activity").map((e) => e.phase), ["start", "error"]);
});

test("invalid tool arguments do not create an expression", async () => {
  const events = await turn({ error: "Invalid arguments" }, "not an object");
  assert.equal(events.filter((e) => e.type === "activity").length, 0);
});

for (const [content, expected] of [
  ['<expression:happy> Congratulations!', { kind: 'shape', name: 'happy' }],
  ['<expression:sad> I’m sorry to hear that.', { kind: 'shape', name: 'sad' }],
  ['<expression:neutral> It is Tuesday.', { kind: 'none' }],
  ['It is Tuesday.', { kind: 'none' }],
  ['<expression:angry> Let’s work through it.', { kind: 'none' }],
  ['<readout:42%> Battery is at 42 percent.', { kind: 'readout', text: '42%' }],
  ['<sketch:0,0 1,1> A line.', { kind: 'sketch', strokes: [[0, 0, 1, 1]] }],
] as const) {
  test(`voice expression metadata stays out of speech: ${content}`, async () => {
    const events: any[] = [];
    const spoken: string[] = [];
    const history: any[] = [];
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } };
    const agent = new Agent(client as never, 'test', [], 'Assistant');
    const inference = { transcribe: async () => 'Some news', synthesize: async (text: string) => { spoken.push(text); return Buffer.from('wav'); } };
    await runVoiceTurn(inference as never, agent, Buffer.from('audio'), history, (type, data) => { events.push({ type, ...data }); }, 'test');
    const { type: _type, ...payload } = events.find(e => e.type === 'expression');
    assert.deepEqual(payload, expected);
    assert.ok(events.findIndex(e => e.type === 'expression') > events.findIndex(e => e.type === 'assistant_text'), 'face should wait until synthesized speech is ready');
    assert.ok(events.findIndex(e => e.type === 'expression') < events.findIndex(e => e.type === 'wav'));
    const clean = content.replace(/^<(expression|readout|sketch):[^>]+>\s*/, '');
    assert.deepEqual(spoken, [clean]);
    assert.equal(events.find(e => e.type === 'assistant_text').text, clean);
    assert.equal(history.at(-1).content, clean);
  });
}

test("the final reply is traced with its raw text and parsed expression", async () => {
  const events: any[] = [];
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "<expression:star> Nice!" } }] }) } } };
  const agent = new Agent(client as never, "test", [], "Assistant");
  const inference = { transcribe: async () => "hi", synthesize: async () => Buffer.from("wav") };
  await runVoiceTurn(inference as never, agent, Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "test");
  const reply = events.find((e) => e.type === "debug" && e.event === "reply");
  assert.ok(reply, "a reply debug event is sent");
  assert.equal(reply.data.raw, "<expression:star> Nice!");
  assert.equal(reply.data.text, "Nice!");
  assert.deepEqual(reply.data.expression, { kind: "shape", name: "star" });
  assert.equal(typeof reply.data.latency_ms, "number");
});
