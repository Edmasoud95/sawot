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

test("an empty tool list leaves the tools field out of the request", async () => {
  const requests: any[] = [];
  const client = { chat: { completions: { create: async (body: any) => { requests.push(body); return stream([{ choices: [{ delta: { content: "hi" } }] }]); } } } };
  for await (const _ of runChat(client, "m", [], "sys", [{ role: "user", content: "hey" }])) { /* drain */ }
  assert.equal("tools" in requests[0], false);
  assert.equal(requests[0].stream, true);
});

test("effort is carried through every tool round and Default omits it", async () => {
  for (const effort of [null, "high", "none"] as const) {
    const requests: any[] = [];
    const client = { chat: { completions: { create: async (body: any) => {
      requests.push(body);
      return stream(requests.length === 1
        ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "lookup", arguments: "{}" } }] } }] }]
        : [{ choices: [{ delta: { content: "Done" } }] }]);
    } } } };
    const tools = [{ name: "lookup", description: "Test lookup", parameters: {}, handler: async () => ({ found: true }) }];
    for await (const _ of runChat(client, "m", tools, "sys", [], undefined, effort)) { /* drain */ }
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.reasoning_effort, effort ?? undefined);
      if (effort === null) assert.equal(Object.hasOwn(request, "reasoning_effort"), false);
    }
    assert.equal(requests[1].messages.at(-1).role, "tool");
  }
});

test("DeepSeek retains reasoning content between tool rounds without sending it to other providers", async () => {
  for (const baseURL of ["https://api.deepseek.com/v1", "https://api.openai.com/v1"]) {
    const requests: any[] = [];
    const client = { baseURL, chat: { completions: { create: async (body: any) => {
      requests.push(structuredClone(body));
      return stream(requests.length === 1
        ? [{ choices: [{ delta: { reasoning_content: "Check the source.", tool_calls: [{ index: 0, id: "c1", function: { name: "lookup", arguments: "{}" } }] } }] }]
        : [{ choices: [{ delta: { content: "Done" } }] }]);
    } } } };
    for await (const _ of runChat(client, "m", [{ name: "lookup", description: "", parameters: {}, handler: async () => ({ found: true }) }], "sys", [], undefined, "high")) {}
    assert.equal(requests[1].messages[1].reasoning_content, baseURL.includes("deepseek") ? "Check the source." : undefined);
    assert.equal(requests[1].reasoning_effort, "high");
  }
});
