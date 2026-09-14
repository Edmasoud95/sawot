import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import Fastify from "fastify";
import { buildSystemPrompt, normalizePersonality } from "../src/agent.js";
import { ProviderRegistry } from "../src/providers.js";
import { registerSettingsRoutes } from "../src/settings.js";

test("the system prompt follows the chosen personality", () => {
  const sassy = buildSystemPrompt("(devices)", "sassy", "Rita");
  assert.match(sassy, /sassy voice assistant/);
  assert.match(sassy, /Next time do it yourself/);
  const plain = buildSystemPrompt("(devices)", "plain", "Rita");
  assert.match(plain, /friendly voice assistant/);
  assert.doesNotMatch(plain, /Next time do it yourself/);
  const custom = buildSystemPrompt("(devices)", "custom", "Rita", "You are a gruff pirate captain who calls the user 'matey'.");
  assert.match(custom, /You are Rita, a voice assistant/);
  assert.match(custom, /Your personality: You are a gruff pirate captain/);
  assert.doesNotMatch(custom, /Next time do it yourself/);
  assert.match(custom, /Devices:\n\(devices\)/, "the functional part is unchanged");
  assert.equal(buildSystemPrompt("x", "custom", "Rita", "   "), plain.replace("(devices)", "x"), "an empty custom prompt falls back to plain");
});

test("stored settings from before the custom option still map to a personality", () => {
  assert.equal(normalizePersonality("custom"), "custom");
  assert.equal(normalizePersonality("plain"), "plain");
  assert.equal(normalizePersonality("sassy"), "sassy");
  assert.equal(normalizePersonality(undefined, true), "sassy");
  assert.equal(normalizePersonality(undefined, false), "plain");
  assert.equal(normalizePersonality("bogus", undefined), "sassy");
});

function llmServer(reply: (body: any) => string) {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "gemma" }] }));
      const body = JSON.parse(raw);
      requests.push(body);
      res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: reply(body) }, finish_reason: "stop" }] }));
    });
  });
  return new Promise<{ url: string; requests: any[]; close: () => void }>((resolve) => server.listen(0, () => resolve({
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`, requests, close: () => server.close(),
  })));
}

async function harness(url: string) {
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: url, builtin: true }, [], { timeoutMs: 1000 });
  registry.setModels("local", ["gemma"]);
  const saved: any[] = [];
  const prompts: string[] = [];
  const state: any = { model: "local::gemma", voice: "af_heart", personality: "sassy", personalityPrompt: "", detailedDrawings: false, chatInstructions: "" };
  const app = Fastify();
  registerSettingsRoutes(app, {
    store: { load: () => ({}), save: (d: any) => saved.push(d) } as any,
    agent: { setClient() {}, setModel() {}, setDetailedDrawings() {} } as any,
    state, registry, fallbackModel: "local::gemma", summary: "(devices)", name: "Rita",
    setSystemPrompt: (p: string) => prompts.push(p),
    inference: { voices: async () => ({ engine: "kokoro", voices: ["af_heart"], default: "af_heart" }) } as any,
  });
  await app.ready();
  return { app, state, saved, prompts };
}

test("a custom personality is saved and applied to the system prompt at once", async () => {
  const llm = await llmServer(() => "unused");
  const { app, state, saved, prompts } = await harness(llm.url);
  try {
    let res = await app.inject({ method: "POST", url: "/api/settings", payload: { personality: "custom", personalityPrompt: "A calm butler." } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().personality, "custom");
    assert.equal(res.json().personalityPrompt, "A calm butler.");
    assert.equal(state.personality, "custom");
    assert.match(prompts.at(-1)!, /Your personality: A calm butler\./);
    assert.equal(saved.at(-1).personalityPrompt, "A calm butler.");

    res = await app.inject({ method: "POST", url: "/api/settings", payload: { personality: "plain" } });
    assert.doesNotMatch(prompts.at(-1)!, /calm butler/);
    assert.equal(res.json().personalityPrompt, "A calm butler.", "the draft is kept while another personality is active");

    res = await app.inject({ method: "POST", url: "/api/settings", payload: { personality: "wizard" } });
    assert.equal(res.statusCode, 400);
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { sassy: true } });
    assert.equal(res.json().personality, "sassy", "the old boolean still works");
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { personalityPrompt: "x".repeat(5000) } });
    assert.equal(res.statusCode, 400, "prompts are capped");
  } finally { await app.close(); llm.close(); }
});

test("the selected model refines a rough personality draft", async () => {
  const llm = await llmServer((body) => `"You have personality: You are a dry, deadpan assistant. ${body.messages.at(-1).content.includes("grumpy") ? "Grumpy." : ""}"`);
  const { app, prompts } = await harness(llm.url);
  try {
    const res = await app.inject({ method: "POST", url: "/api/personality/refine", payload: { text: "kinda grumpy but helpful" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().text, "You are a dry, deadpan assistant. Grumpy.", "surrounding quotes and the echoed lead-in are dropped");
    assert.equal(llm.requests[0].model, "gemma", "uses the model chosen at the top of Settings");
    assert.match(llm.requests[0].messages[0].content, /Rita/);
    assert.equal(prompts.length, 0, "refining does not apply anything until saved");
    const fresh = await app.inject({ method: "POST", url: "/api/personality/refine", payload: { text: "" } });
    assert.equal(fresh.statusCode, 200, "an empty draft asks the model to invent one");
    assert.match(llm.requests[1].messages.at(-1).content, /invent/i);
  } finally { await app.close(); llm.close(); }
});

test("a refine failure is reported, not thrown", async () => {
  const server = createServer((_req, res) => { res.statusCode = 500; res.end("boom"); });
  await new Promise<void>((r) => server.listen(0, r));
  const { app } = await harness(`http://127.0.0.1:${(server.address() as any).port}/v1`);
  try {
    const res = await app.inject({ method: "POST", url: "/api/personality/refine", payload: { text: "x" } });
    assert.equal(res.statusCode, 502);
    assert.match(res.json().detail, /couldn't/i);
  } finally { await app.close(); server.close(); }
});

test("chat instructions are validated, trimmed, saved, and returned", async () => {
  const llm = await llmServer(() => "unused");
  const { app, state, saved, prompts } = await harness(llm.url);
  try {
    let res = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(res.json().chatInstructions, "");
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: "  Prefer Python.  " } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().chatInstructions, "Prefer Python.");
    assert.equal(state.chatInstructions, "Prefer Python.");
    assert.equal(saved.at(-1).chatInstructions, "Prefer Python.");
    assert.equal(prompts.length, 0, "chat instructions do not touch the voice prompt");
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: "x".repeat(2001) } });
    assert.equal(res.statusCode, 400);
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: 42 } });
    assert.equal(res.statusCode, 400);
  } finally { await app.close(); llm.close(); }
});
