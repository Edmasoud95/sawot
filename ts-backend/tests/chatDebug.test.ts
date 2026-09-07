import assert from "node:assert/strict";
import test from "node:test";
import { runChat } from "../src/chat.js";

async function* stream(chunks: any[]) { for (const c of chunks) yield c; }

test("chat streaming yields debug events for rounds, tools, and the final reply", async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => stream(calls++ === 0
    ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_entities", arguments: "{\"domain\":\"light\"}" } }] } }] }]
    : [{ choices: [{ delta: { content: "All lights are off." } }] }]) } } };
  const tools = [{ name: "get_entities", description: "", parameters: {}, handler: async () => [{ entity_id: "light.a", state: "off" }] }];
  const events: [string, any][] = [];
  for await (const e of runChat(client, "m", tools as any, "sys", [{ role: "user", content: "lights?" }])) events.push(e);
  const debug = events.filter(([e]) => e === "debug").map(([, d]) => d);
  assert.deepEqual(debug.map((d) => d.event), ["llm_round", "tool_call", "tool_result", "llm_round", "reply"]);
  assert.equal(debug[0].data.round, 1);
  assert.deepEqual(debug[1].data.args, { domain: "light" });
  assert.equal(debug[2].data.ok, true);
  assert.equal(typeof debug[2].data.latency_ms, "number");
  assert.equal(debug[4].data.text, "All lights are off.");
  // The user-facing events are unchanged.
  assert.deepEqual(events.filter(([e]) => e === "tool").length, 1);
  assert.equal(events.at(-1)![0], "final");
});
