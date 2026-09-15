import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes, type ChatCtx } from "../src/chatRoutes.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "sawot-chat-")); }

test("conversations carry a Home Assistant flag that defaults to off", () => {
  const root = tmp();
  const store = new ChatStore(root);
  const off = store.create("local::m");
  assert.equal(off.homeAssistant, false);
  const on = store.create("local::m", true);
  assert.equal(on.homeAssistant, true);
  // A file written before the flag existed reads as off.
  writeFileSync(join(root, "abcdefabcdef.json"), JSON.stringify({ id: "abcdefabcdef", title: "Old", model: "m", created: 1, updated: 1, messages: [] }));
  const listing = store.list();
  assert.deepEqual(listing.map((c) => [c.id, c.homeAssistant]).sort(), [[off.id, false], [on.id, true], ["abcdefabcdef", false]].sort());
});

function harness(opts: Partial<ChatCtx> = {}) {
  const dir = tmp();
  const ctx: ChatCtx = {
    store: new ChatStore(join(dir, "conversations")),
    resolve: () => { throw new Error("no model in this test"); },
    haTools: [],
    searchTools: [],
    ha: null,
    uploadDir: join(dir, "uploads"),
    name: "Rita",
    getEntitySummary: () => "(devices)",
    getChatInstructions: () => "",
    getDefaultModel: () => "local::m",
    ...opts,
  };
  const app = Fastify();
  registerChatRoutes(app, ctx);
  return { app, ctx };
}

test("the flag is set on create and toggled by patch", async () => {
  const { app } = harness();
  try {
    let res = await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { homeAssistant: true } });
    const id = res.json().id;
    assert.equal(res.json().homeAssistant, true);
    res = await app.inject({ method: "PATCH", url: `/api/chat/conversations/${id}`, payload: { homeAssistant: false } });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "GET", url: `/api/chat/conversations/${id}` });
    assert.equal(res.json().homeAssistant, false, "the change is persisted");
    res = await app.inject({ method: "GET", url: "/api/chat/conversations" });
    assert.equal(res.json().find((c: any) => c.id === id).homeAssistant, false);
  } finally { await app.close(); }
});

async function* once(text: string) { yield { choices: [{ delta: { content: text } }] }; }

function recordingClient(requests: any[]) {
  return { chat: { completions: { create: async (body: any) => { requests.push(body); return once("done"); } } } };
}

function sseEvents(body: string): any[] {
  return body.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

const haTool = { name: "get_entities", description: "", parameters: {}, handler: async () => [] };
const searchTool = { name: "web_search", description: "", parameters: {}, handler: async () => ({ results: [] }) };

test("a general conversation gets the chat prompt and only the search tools", async () => {
  const requests: any[] = [];
  const { app } = harness({
    resolve: () => ({ client: recordingClient(requests), model: "m" }),
    haTools: [haTool], searchTools: [searchTool],
    getChatInstructions: () => "Call me Ed.",
  });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "hello" } });
    assert.equal(res.statusCode, 200);
    const system = requests[0].messages[0];
    assert.equal(system.role, "system");
    assert.match(system.content, /general-purpose AI assistant/);
    assert.match(system.content, /Call me Ed\./);
    assert.match(system.content, /web_search/);
    assert.doesNotMatch(system.content, /Devices:/);
    assert.deepEqual(requests[0].tools.map((t: any) => t.function.name), ["web_search"]);
    const done = sseEvents(res.body).find((e) => e.type === "done");
    assert.equal(done.message.content, "done");
  } finally { await app.close(); }
});

test("a Home Assistant conversation adds the device block and tools", async () => {
  const requests: any[] = [];
  const { app } = harness({
    resolve: () => ({ client: recordingClient(requests), model: "m" }),
    haTools: [haTool], searchTools: [searchTool],
  });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { homeAssistant: true } })).json();
    await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "lights?" } });
    assert.match(requests[0].messages[0].content, /Devices:\n\(devices\)/);
    assert.deepEqual(requests[0].tools.map((t: any) => t.function.name), ["web_search", "get_entities"]);
  } finally { await app.close(); }
});

test("without a search key and without Home Assistant no tools are sent", async () => {
  const requests: any[] = [];
  const { app } = harness({ resolve: () => ({ client: recordingClient(requests), model: "m" }), haTools: [haTool] });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "hi" } });
    assert.equal("tools" in requests[0], false);
    assert.doesNotMatch(requests[0].messages[0].content, /web_search/);
  } finally { await app.close(); }
});

test("text chat executes find_in_page and gives matching passages to the model", async () => {
  const { buildSearchTools } = await import("../src/search.js");
  const requests: any[] = [];
  const searchTools = buildSearchTools({ search: async () => [] }, {
    lookup: async () => ["93.184.216.34"],
    fetchFn: async () => new Response("Intro ".repeat(5000) + "The warranty lasts two years.", { headers: { "content-type": "text/plain" } }),
  });
  async function* call() {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "find-1", function: {
      name: "find_in_page", arguments: '{"url":"https://example.com/manual","query":"warranty"}',
    } }] } }] };
  }
  const client = { chat: { completions: { create: async (body: any) => {
    requests.push(structuredClone(body));
    return requests.length === 1 ? call() : once("The warranty lasts two years.");
  } } } };
  const { app } = harness({ searchTools, resolve: () => ({ client, model: "m" }) });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Find the warranty in the manual" } });
    assert.equal(res.statusCode, 200);
    assert.ok(requests[0].tools.some((t: any) => t.function.name === "find_in_page"));
    assert.match(requests[0].messages[0].content, /find_in_page/);
    const found = JSON.parse(requests[1].messages.find((m: any) => m.role === "tool").content);
    assert.match(found.matches[0].text, /warranty lasts two years/);
    assert.ok(sseEvents(res.body).some(e => e.type === "tool" && e.name === "find_in_page"));
    assert.equal(sseEvents(res.body).find(e => e.type === "done").message.content, "The warranty lasts two years.");
  } finally { await app.close(); }
});
