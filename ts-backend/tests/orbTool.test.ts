import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/agent.js";
import { ORB_TOOL_NAME, expressionFromToolArgs } from "../src/expressions.js";

function agentWith(turns: any[], captured: any[] = []) {
  let i = 0;
  const client = { chat: { completions: { create: async (req: any) => { captured.push(req); return { choices: [{ message: turns[i++] }] }; } } } };
  return new Agent(client as never, "test", [{
    name: "get_entities", description: "List", parameters: {}, handler: async () => [],
  }], "Assistant");
}
const toolCall = (args: unknown) => ({ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: ORB_TOOL_NAME, arguments: JSON.stringify(args) } }] });

test("the orb tool is offered to the model only when expressions are enabled", async () => {
  const captured: any[] = [];
  await agentWith([{ role: "assistant", content: "Hi" }], captured).run([], "hi", undefined, { expressions: true });
  assert.ok(captured[0].tools.some((t: any) => t.function.name === ORB_TOOL_NAME));
  const plain: any[] = [];
  await agentWith([{ role: "assistant", content: "Hi" }], plain).run([], "hi", undefined, {});
  assert.ok(!plain[0].tools.some((t: any) => t.function.name === ORB_TOOL_NAME));
});

test("a sketch drawn through the tool reaches the orb with the final reply", async () => {
  const events: any[] = [];
  const history: any[] = [];
  const agent = agentWith([toolCall({ kind: "sketch", strokes: [[0, 0, 1, 1], [0, 1, 1, 0]] }), { role: "assistant", content: "Here's your dog." }]);
  const reply = await agent.run(history, "Draw a dog", (e, d) => events.push({ e, ...d }), { expressions: true });
  assert.equal(reply, "Here's your dog.");
  const expression = events.find((x) => x.e === "expression");
  assert.deepEqual({ kind: expression.kind, strokes: expression.strokes }, { kind: "sketch", strokes: [[0, 0, 1, 1], [0, 1, 1, 0]] });
  const result = JSON.parse(history.find((m) => m.role === "tool").content);
  assert.equal(result.ok, true);
  assert.ok(events.findIndex((x) => x.e === "expression") > events.findIndex((x) => x.e === "tool_result"));
});

test("the tool accepts strokes written in marker syntax and catalogue names and readouts", () => {
  assert.deepEqual(expressionFromToolArgs({ kind: "sketch", strokes: "0,0 1,1; 0.5,0.5 0.2,0.2" }), { kind: "sketch", strokes: [[0, 0, 1, 1], [0.5, 0.5, 0.2, 0.2]] });
  assert.deepEqual(expressionFromToolArgs({ kind: "shape", name: "Rocket" }), { kind: "none" });
  assert.deepEqual(expressionFromToolArgs({ kind: "shape", name: "star" }), { kind: "shape", name: "star" });
  assert.deepEqual(expressionFromToolArgs({ kind: "readout", text: "42%" }), { kind: "readout", text: "42%" });
  assert.deepEqual(expressionFromToolArgs({ strokes: [[0, 0, 1, 1]] }), { kind: "sketch", strokes: [[0, 0, 1, 1]] }, "kind is inferred from the fields");
  assert.deepEqual(expressionFromToolArgs({ name: "sun" }), { kind: "shape", name: "sun" });
  assert.deepEqual(expressionFromToolArgs({ text: "HELLO" }), { kind: "readout", text: "HELLO" });
  assert.deepEqual(expressionFromToolArgs(null), { kind: "none" });
});

test("invalid tool arguments report an error to the model and show nothing", async () => {
  const events: any[] = [];
  const history: any[] = [];
  await agentWith([toolCall({ kind: "sketch", strokes: "nonsense" }), { role: "assistant", content: "Done." }])
    .run(history, "Draw", (e, d) => events.push({ e, ...d }), { expressions: true });
  assert.equal(events.find((x) => x.e === "expression").kind, "none");
  assert.ok("error" in JSON.parse(history.find((m) => m.role === "tool").content));
});

test("a marker in the final reply overrides an earlier tool choice", async () => {
  const events: any[] = [];
  await agentWith([toolCall({ kind: "shape", name: "sun" }), { role: "assistant", content: "<expression:rain> Actually rain." }])
    .run([], "Weather?", (e, d) => events.push({ e, ...d }), { expressions: true });
  assert.equal(events.find((x) => x.e === "expression").name, "rain");
});

test("raw replies and the parsed expression are appended to the reply log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-log-"));
  const path = join(dir, "orb-replies.log");
  Agent.replyLogPath = path;
  await agentWith([{ role: "assistant", content: "<expression:star> Nice!" }]).run([], "hi", undefined, { expressions: true });
  assert.ok(existsSync(path));
  const line = JSON.parse(readFileSync(path, "utf8").trim().split("\n").at(-1)!);
  assert.equal(line.raw, "<expression:star> Nice!");
  assert.equal(line.expression.name, "star");
  assert.equal(line.user, "hi");
  Agent.replyLogPath = "";
});
