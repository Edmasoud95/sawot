import assert from "node:assert/strict";
import test from "node:test";
import { chunksFromEvents, createViaResponses, fromResponse, toResponsesInput, toResponsesTools } from "../src/responsesTransport.js";

const CHAT_TOOLS = [{ type: "function", function: { name: "get_entities", description: "List devices", parameters: { type: "object", properties: {} } } }];

test("chat messages become Responses input items without item ids", () => {
  const items = toResponsesInput([
    { role: "system", content: "Be brief." },
    { role: "user", content: "Lights?" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_entities", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "[]" },
    { role: "assistant", content: "None found." },
    { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] },
  ]);
  assert.deepEqual(items, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Lights?" },
    { type: "function_call", call_id: "call_1", name: "get_entities", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "[]" },
    { role: "assistant", content: "None found." },
    { role: "user", content: [{ type: "input_text", text: "What is this?" }, { type: "input_image", image_url: "data:image/png;base64,AAA" }] },
  ]);
  assert.ok(items.every((i) => !("id" in i)));
});

test("chat tools become flat Responses function tools", () => {
  assert.deepEqual(toResponsesTools(CHAT_TOOLS), [
    { type: "function", name: "get_entities", description: "List devices", parameters: { type: "object", properties: {} } },
  ]);
  assert.equal(toResponsesTools([]), undefined);
});

test("a completed Response reads like a ChatCompletion", () => {
  const completion = fromResponse({
    id: "resp_1", model: "gpt-6-astra",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "Need the device list." }] },
      { type: "function_call", id: "fc_1", call_id: "call_9", name: "get_entities", arguments: "{\"domain\":\"light\"}" },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  const msg = completion.choices[0].message;
  assert.equal(msg.content, null);
  assert.equal(msg.reasoning_content, "Need the device list.");
  assert.deepEqual(msg.tool_calls, [{ id: "call_9", type: "function", function: { name: "get_entities", arguments: "{\"domain\":\"light\"}" } }]);
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(completion.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

  const text = fromResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }] });
  assert.equal(text.choices[0].message.content, "Done.");
  assert.equal(text.choices[0].finish_reason, "stop");
});

async function* events(list: any[]) { for (const e of list) yield e; }

test("stream events become chat completion chunks the chat path already parses", async () => {
  const chunks: any[] = [];
  for await (const c of chunksFromEvents(events([
    { type: "response.created" },
    { type: "response.reasoning_summary_text.delta", delta: "Think" },
    { type: "response.reasoning_summary_part.done" },
    { type: "response.output_text.delta", delta: "Hel" },
    { type: "response.output_text.delta", delta: "lo" },
    { type: "response.output_item.added", output_index: 2, item: { type: "function_call", call_id: "call_a", name: "get_entities" } },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: "{\"do" },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: "main\":1}" },
    { type: "response.output_item.done", output_index: 3, item: { type: "function_call", call_id: "call_b", name: "whole", arguments: "{}" } },
    { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
  ]))) chunks.push(c);

  // Replay through the same accumulation logic chat.ts uses.
  let content = "", thinking = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  for (const chunk of chunks) {
    const delta = chunk.choices[0].delta;
    if (delta.reasoning_content) thinking += delta.reasoning_content;
    if (delta.content) content += delta.content;
    for (const tc of delta.tool_calls ?? []) {
      const slot = calls.get(tc.index) ?? { id: "", name: "", arguments: "" };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.arguments += tc.function.arguments;
      calls.set(tc.index, slot);
    }
  }
  assert.equal(content, "Hello");
  assert.equal(thinking, "Think\n\n");
  assert.deepEqual([...calls.values()], [
    { id: "call_a", name: "get_entities", arguments: "{\"domain\":1}" },
    { id: "call_b", name: "whole", arguments: "{}" },
  ]);
  assert.equal(chunks[chunks.length - 1].choices[0].finish_reason, "tool_calls");
  assert.deepEqual(chunks[chunks.length - 1].usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test("stream failures surface as errors", async () => {
  await assert.rejects(async () => {
    for await (const _ of chunksFromEvents(events([{ type: "error", message: "boom" }]))) { /* drain */ }
  }, /boom/);
});

test("createViaResponses sends a Responses request and drops the reasoning param when rejected", async () => {
  const sent: any[] = [];
  const client: any = { responses: { create: async (b: any) => {
    sent.push(b);
    if (sent.length === 1) throw Object.assign(new Error("Unsupported parameter: 'reasoning.summary'"), { status: 400 });
    return { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] };
  } } };
  const out = await createViaResponses(client, { model: "m", messages: [{ role: "user", content: "hi" }], tools: CHAT_TOOLS, max_tokens: 50 });
  assert.equal(out.choices[0].message.content, "ok");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].reasoning, { summary: "auto" });
  assert.equal("reasoning" in sent[1], false);
  assert.equal(sent[1].max_output_tokens, 50);
  assert.equal(sent[1].tools[0].name, "get_entities");
  assert.deepEqual(sent[1].input, [{ role: "user", content: "hi" }]);
  assert.equal("messages" in sent[1], false);
});
